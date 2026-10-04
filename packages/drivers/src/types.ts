/**
 * Shared types for claude-onair drivers
 */

export type LampState = 'idle' | 'thinking' | 'tool' | 'needs-you' | 'done' | 'error' | 'off'

export interface AggregateState {
  state: LampState
  subagentCount?: number
  quotaWarning?: boolean
  timestamp: number
}

export interface ColorHSB {
  h: number // 0-360
  s: number // 0-100
  b: number // 0-100
}

export interface ColorRGB {
  r: number // 0-255
  g: number // 0-255
  b: number // 0-255
}

export type PatternSpeed = 'slow' | 'medium' | 'fast'
export type Pattern = 'solid' | 'breathe' | 'blink' | 'pulse' | 'off'

export interface StateTheme {
  color: string // hex color
  pattern: Pattern
  speed?: PatternSpeed
}

export interface LampDriver {
  readonly name: string
  connect(): Promise<void>
  setState(state: AggregateState): Promise<void>
  disconnect(): Promise<void>
}

export function hexToRGB(hex: string): ColorRGB {
  const clean = hex.replace(/^#/, '')
  const num = parseInt(clean, 16)
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  }
}

export function hexToHSB(hex: string): ColorHSB {
  const rgb = hexToRGB(hex)
  const r = rgb.r / 255
  const g = rgb.g / 255
  const b = rgb.b / 255

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min

  let h = 0
  let s = 0
  const v = max

  if (delta !== 0) {
    s = delta / max
    if (max === r) {
      h = ((g - b) / delta + (g < b ? 6 : 0)) / 6
    } else if (max === g) {
      h = ((b - r) / delta + 2) / 6
    } else {
      h = ((r - g) / delta + 4) / 6
    }
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    b: Math.round(v * 100),
  }
}
