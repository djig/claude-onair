/**
 * Type contract for claude-onair mod state.
 * Declares values held in $.state for this plugin.
 */

export interface SessionState {
  sessionId: string
  startedAt: number
  currentState: 'idle' | 'thinking' | 'tool' | 'needs-you' | 'done' | 'error'
  lastEventSeq: number
}

export interface FlushState {
  lastFlushAt: number
  pendingEvents: Array<{
    v: number
    session: string
    seq: number
    ts: number
    t: string
    data: Record<string, unknown>
  }>
}

declare module 'claude-code' {
  interface PluginState {
    'claude-onair': {
      session: SessionState
      lastFlush: FlushState
    }
  }
}
