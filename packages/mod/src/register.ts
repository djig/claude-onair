/**
 * claude-onair mod
 * 
 * Hooks Claude Code session events and streams them to the local onaird daemon.
 */

import type { SessionState, FlushState } from '../.claude-plugin/types/index.js'

const DAEMON_URL = 'http://127.0.0.1:47800'
const FLUSH_INTERVAL_MS = 100
const MAX_BATCH_SIZE = 50

// Module state (survives hot reload via $.state)
const sessionKey = { plugin: 'onair', key: 'session' }
const flushKey = { plugin: 'onair', key: 'lastFlush' }

let eventSeq = 0

export async function register(on: any, options: any) {
  // Session start: initialize state, start daemon if needed, register command
  on('session.start', async ($: any, e: any, next: any) => {
    const result = await next(e)
    
    const sessionId = $.session.id()
    const home = $.env.get('HOME') || $.env.get('USERPROFILE') || '/tmp'
    const tokenPath = `${home}/.config/claude-onair/token`
    
    await $.state.set(sessionKey, {
      sessionId,
      startedAt: Date.now(),
      currentState: 'idle',
      lastEventSeq: 0,
    } as SessionState)

    await $.state.set(flushKey, {
      lastFlushAt: 0,
      pendingEvents: [],
    } as FlushState)

    // Register /onair command
    await $.command.register({
      name: 'onair',
      description: 'onair status and controls',
    })

    // Check if daemon is running; if not, start it
    try {
      const token = await $.fs.read(tokenPath)
      await $.http.fetch(`${DAEMON_URL}/healthz`, {
        headers: { 'Authorization': `Bearer ${token.trim()}` },
      })
    } catch {
      // Daemon not running; start it (daemonize and exit)
      try {
        await $.process.run(['onaird', 'up'])
      } catch (startErr) {
        // Ignore; daemon might already be starting or user needs to install it
      }
    }

    await queueEvent($, {
      t: 'session.start',
      data: { surface: e.surface, isInteractive: e.isInteractive },
    })

    // Start periodic flush
    $.clock.every(FLUSH_INTERVAL_MS, async () => {
      await flushEvents($)
    })

    return result
  })

  // Session end
  on('session.end', async ($: any, e: any, next: any) => {
    await queueEvent($, {
      t: 'session.end',
      data: { reason: e.reason },
    })
    
    await flushEvents($, true) // force flush
    return next(e)
  })

  // Prompt submitted
  on('prompt.submit', async ($: any, e: any, next: any) => {
    await queueEvent($, {
      t: 'prompt',
      data: { length: e.text?.length || 0 },
    })
    return next(e)
  })

  // Turn start
  on('turn.start', async ($: any, e: any, next: any) => {
    await queueEvent($, {
      t: 'turn.start',
      data: { turnId: e.turnId },
    }, e.agentId)
    return next(e)
  })

  // Turn step (thinking/model request)
  on('turn.step', async function* ($: any, e: any, next: any) {
    await queueEvent($, {
      t: 'step.start',
      data: { turnId: e.turnId, index: e.index, model: e.model },
    }, e.agentId)

    // Forward pieces (we don't tap them individually in v1)
    const it = next(e)
    let result
    while (!(result = await it.next()).done) {
      yield result.value
    }

    await queueEvent($, {
      t: 'step.end',
      data: { 
        turnId: e.turnId,
        index: e.index,
        usage: result.value.usage,
        stopReason: result.value.stopReason,
      },
    }, e.agentId)

    return result.value
  })

  // Tool call
  on('tool.call', async ($: any, e: any, next: any) => {
    await queueEvent($, {
      t: 'tool.start',
      data: { tool: e.tool },
    }, e.agentId)

    // Check if it's AskUserQuestion
    if (e.tool === 'AskUserQuestion') {
      await queueEvent($, {
        t: 'needs.question',
        data: { questions: e.questions?.length || 0 },
      }, e.agentId)
    }

    const result = await next(e)

    await queueEvent($, {
      t: 'tool.end',
      data: { tool: e.tool, denied: 'deny' in result },
    }, e.agentId)

    return result
  })

  // Permission check
  on('tool.check', async ($: any, e: any, next: any) => {
    const decision = await next(e)

    if (decision === 'ask') {
      await queueEvent($, {
        t: 'needs.permission',
        data: { tool: e.tool },
      })
    }

    return decision
  })

  // Turn complete
  on('turn.complete', async ($: any, e: any, next: any) => {
    await queueEvent($, {
      t: 'turn.end',
      data: {
        turnId: e.turnId,
        isAborted: e.isAborted,
        durationMs: e.durationMs,
      },
    }, e.agentId)

    await flushEvents($) // flush at turn boundaries
    return next(e)
  })

  // Error
  on('classic.StopFailure', async ($: any, e: any, next: any) => {
    await queueEvent($, {
      t: 'error',
      data: { reason: e.reason || 'unknown' },
    })
    return next(e)
  })

  // Usage
  on('session.measure', async ($: any, e: any, next: any) => {
    const result = await next(e)
    
    const usage = await $.session.usage()
    if (usage.rateLimits) {
      const maxPercent = Math.max(...usage.rateLimits.map((rl: any) => rl.percentUsed || 0))
      await queueEvent($, {
        t: 'usage',
        data: { percentUsed: maxPercent },
      })
    }

    return result
  })

  // Subagent spawn
  on('agent.spawn', async ($: any, e: any, next: any) => {
    await queueEvent($, {
      t: 'subagent',
      data: { delta: 1, isTeammate: e.isTeammate },
    })
    return next(e)
  })

  // Handle /onair command
  on('command.run', { command: 'onair' }, async ($: any, e: any) => {
    const subcommand = e.args?.[0] || 'status'

    if (subcommand === 'status') {
      const session = await $.state.get(sessionKey)
      const text = session.value
        ? `onair: ${session.value.currentState}`
        : 'onair: not initialized'
      return { text }
    }

    if (subcommand === 'test' && e.args?.[1] === 'colors') {
      return { text: 'Test not implemented in mod yet. Use `onaird test` CLI.' }
    }

    return { text: 'Usage: /onair [status | test colors]' }
  })
}

async function queueEvent($: any, partial: { t: string; data: Record<string, unknown> }, agentId?: string) {
  const session = await $.state.get(sessionKey)
  if (!session.value) return

  const { value: flush } = await $.state.get(flushKey)
  if (!flush) return

  const event = {
    v: 1,
    session: session.value.sessionId,
    seq: ++eventSeq,
    ts: Date.now(),
    ...(agentId && { agentId }),
    ...partial,
  }

  flush.pendingEvents.push(event)

  // Update session state hint
  if (!agentId) {
    const stateMap: Record<string, any> = {
      'turn.start': 'thinking',
      'step.start': 'thinking',
      'tool.start': 'tool',
      'needs.permission': 'needs-you',
      'needs.question': 'needs-you',
      'turn.end': partial.data.isAborted ? 'idle' : 'done',
      'error': 'error',
    }
    
    if (stateMap[partial.t]) {
      session.value.currentState = stateMap[partial.t]
      await $.state.set(sessionKey, session.value)
    }
  }

  await $.state.set(flushKey, flush)

  // If batch is full, flush now
  if (flush.pendingEvents.length >= MAX_BATCH_SIZE) {
    await flushEvents($, true)
  }
}

async function flushEvents($: any, force = false): Promise<void> {
  const { value: flush } = await $.state.get(flushKey)
  if (!flush || flush.pendingEvents.length === 0) return

  const now = Date.now()
  if (!force && now - flush.lastFlushAt < FLUSH_INTERVAL_MS) {
    return // too soon
  }

  const events = [...flush.pendingEvents]
  flush.pendingEvents = []
  flush.lastFlushAt = now
  await $.state.set(flushKey, flush)

  try {
    const home = $.env.get('HOME') || $.env.get('USERPROFILE') || '/tmp'
    const tokenPath = `${home}/.config/claude-onair/token`
    const token = await $.fs.read(tokenPath)
    
    // Fire and forget (don't await so we don't exceed hook budget)
    // In a real production version, we'd use $.http.fetch with a timeout
    // For now, we rely on the fact that the daemon is local and fast
    await $.http.fetch(`${DAEMON_URL}/v1/ingest`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(events),
    })
  } catch (err) {
    // Fail silently; mod should never crash the session
    $.ui.log('[claude-onair] Failed to flush events')
  }
}
