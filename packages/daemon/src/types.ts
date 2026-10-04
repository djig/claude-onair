/**
 * Daemon types
 */

import type { AggregateState, LampState } from '@claude-onair/drivers'

export interface BusEvent {
  v: number // protocol version
  session: string
  seq: number
  ts: number
  agentId?: string
  t: EventType
  data: Record<string, unknown>
}

export type EventType =
  | 'session.start'
  | 'session.end'
  | 'prompt'
  | 'turn.start'
  | 'turn.end'
  | 'step.start'
  | 'step.piece'
  | 'step.end'
  | 'tool.start'
  | 'tool.end'
  | 'needs.permission'
  | 'needs.question'
  | 'needs.resolved'
  | 'error'
  | 'usage'
  | 'subagent'

export interface SessionState {
  sessionId: string
  startedAt: number
  lastEventAt: number
  currentState: LampState
  subagentCount: number
  quotaWarning: boolean
  isActive: boolean
}

export interface DaemonConfig {
  host: string
  port: number
  tokenPath: string
  theme: ThemeConfig
  drivers: DriverConfig[]
  debounceMs: number
  doneFadeMinutes: number
  quietHours?: {
    enabled: boolean
    start: string // HH:MM
    end: string // HH:MM
  }
}

export interface ThemeConfig {
  name: string
  states: Record<LampState, {
    color: string
    pattern: string
    speed?: string
  }>
}

export interface DriverConfig {
  type: 'blink1' | 'wled' | 'home-assistant' | 'govee' | 'webhook'
  enabled: boolean
  config: Record<string, unknown>
}
