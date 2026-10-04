/**
 * State reducer: aggregates events from all sessions into a single lamp state
 */

import type { BusEvent, SessionState } from './types.js'
import type { LampState, AggregateState } from '@claude-onair/drivers'

const STATE_PRIORITY: Record<LampState, number> = {
  'needs-you': 100,
  'error': 90,
  'tool': 80,
  'thinking': 80,
  'done': 70,
  'idle': 60,
  'off': 0,
}

export class StateReducer {
  private sessions = new Map<string, SessionState>()
  private lastAggregate: AggregateState | null = null
  private doneFadeTimers = new Map<string, NodeJS.Timeout>()

  constructor(private doneFadeMinutes: number) {}

  reduce(event: BusEvent): AggregateState {
    const session = this.getOrCreateSession(event.session)

    switch (event.t) {
      case 'session.start':
        session.isActive = true
        session.startedAt = event.ts
        session.currentState = 'idle'
        break

      case 'session.end':
        session.isActive = false
        this.clearDoneFadeTimer(event.session)
        break

      case 'turn.start':
        if (!event.agentId) {
          session.currentState = 'thinking'
        }
        break

      case 'step.start':
      case 'step.piece':
        if (!event.agentId) {
          session.currentState = 'thinking'
        }
        break

      case 'tool.start':
        if (!event.agentId) {
          session.currentState = 'tool'
        }
        break

      case 'needs.permission':
      case 'needs.question':
        if (!event.agentId) {
          session.currentState = 'needs-you'
        }
        break

      case 'needs.resolved':
        // Resolved; go back to tool or thinking
        if (!event.agentId && session.currentState === 'needs-you') {
          session.currentState = 'tool'
        }
        break

      case 'turn.end':
        if (!event.agentId) {
          const isAborted = (event.data.isAborted as boolean) ?? false
          if (isAborted) {
            session.currentState = 'idle'
          } else {
            session.currentState = 'done'
            this.scheduleDoneFade(event.session)
          }
        }
        break

      case 'error':
        if (!event.agentId) {
          session.currentState = 'error'
        }
        break

      case 'usage':
        const percentUsed = (event.data.percentUsed as number) ?? 0
        session.quotaWarning = percentUsed >= 80
        break

      case 'subagent':
        const delta = (event.data.delta as number) ?? 0
        session.subagentCount = Math.max(0, session.subagentCount + delta)
        break
    }

    session.lastEventAt = event.ts

    const aggregate = this.aggregate()
    this.lastAggregate = aggregate
    return aggregate
  }

  private aggregate(): AggregateState {
    const activeSessions = Array.from(this.sessions.values()).filter(s => s.isActive)

    if (activeSessions.length === 0) {
      return {
        state: 'off',
        timestamp: Date.now(),
      }
    }

    // Pick the highest-priority state
    const topSession = activeSessions.reduce((top, s) => {
      const topPrio = STATE_PRIORITY[top.currentState] ?? 0
      const sPrio = STATE_PRIORITY[s.currentState] ?? 0
      return sPrio > topPrio ? s : top
    })

    const totalSubagents = activeSessions.reduce((sum, s) => sum + s.subagentCount, 0)
    const anyQuotaWarning = activeSessions.some(s => s.quotaWarning)

    return {
      state: topSession.currentState,
      subagentCount: totalSubagents > 0 ? totalSubagents : undefined,
      quotaWarning: anyQuotaWarning ? true : undefined,
      timestamp: Date.now(),
    }
  }

  private getOrCreateSession(sessionId: string): SessionState {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, {
        sessionId,
        startedAt: Date.now(),
        lastEventAt: Date.now(),
        currentState: 'idle',
        subagentCount: 0,
        quotaWarning: false,
        isActive: true,
      })
    }
    return this.sessions.get(sessionId)!
  }

  private scheduleDoneFade(sessionId: string): void {
    this.clearDoneFadeTimer(sessionId)

    const timer = setTimeout(() => {
      const session = this.sessions.get(sessionId)
      if (session && session.currentState === 'done') {
        session.currentState = 'idle'
        this.lastAggregate = this.aggregate()
      }
    }, this.doneFadeMinutes * 60 * 1000)

    this.doneFadeTimers.set(sessionId, timer)
  }

  private clearDoneFadeTimer(sessionId: string): void {
    const timer = this.doneFadeTimers.get(sessionId)
    if (timer) {
      clearTimeout(timer)
      this.doneFadeTimers.delete(sessionId)
    }
  }

  getLastAggregate(): AggregateState | null {
    return this.lastAggregate
  }

  getSessions(): SessionState[] {
    return Array.from(this.sessions.values())
  }
}
