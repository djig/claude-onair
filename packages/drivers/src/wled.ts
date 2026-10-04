/**
 * WLED driver
 * 
 * Controls WLED devices (ESP32/ESP8266 with WLED firmware) via HTTP JSON API.
 * Maps states to presets for smooth device-side animations.
 */

import type { LampDriver, AggregateState, StateTheme } from './types.js'
import { hexToRGB } from './types.js'

export interface WLEDConfig {
  ip: string
  theme: Record<string, StateTheme>
  presets?: Record<string, number> // state name -> preset number
  segment?: number // segment to control (default 0)
}

export class WLEDDriver implements LampDriver {
  readonly name = 'wled'
  private currentState: AggregateState | null = null
  private baseUrl: string

  constructor(private config: WLEDConfig) {
    this.baseUrl = `http://${config.ip}/json`
  }

  async connect(): Promise<void> {
    try {
      const response = await fetch(`${this.baseUrl}/info`, {
        signal: AbortSignal.timeout(5000),
      })
      
      if (!response.ok) {
        throw new Error(`WLED returned ${response.status}`)
      }
      
      const info = await response.json() as any
      console.log(`[wled] Connected to ${info.name || 'WLED'} at ${this.config.ip}`)
    } catch (err: any) {
      throw new Error(`Failed to connect to WLED at ${this.config.ip}: ${err.message}`)
    }
  }

  async setState(state: AggregateState): Promise<void> {
    if (this.currentState?.state === state.state) {
      return // no change
    }

    this.currentState = state
    const theme = this.config.theme[state.state]
    if (!theme) {
      console.warn(`[wled] No theme for state: ${state.state}`)
      return
    }

    // If a preset is configured for this state, use it (best for complex effects)
    if (this.config.presets?.[state.state]) {
      await this.setPreset(this.config.presets[state.state])
      return
    }

    // Otherwise, set color and effect directly
    const rgb = hexToRGB(theme.color)
    const seg = this.config.segment ?? 0

    const effectId = this.mapPatternToEffect(theme.pattern)
    const speed = theme.speed === 'fast' ? 200 : theme.speed === 'slow' ? 80 : 128

    await this.postState({
      on: theme.pattern !== 'off',
      bri: theme.pattern === 'off' ? 0 : 255,
      seg: [{
        id: seg,
        col: [[rgb.r, rgb.g, rgb.b]],
        fx: effectId,
        sx: speed,
      }],
    })
  }

  async disconnect(): Promise<void> {
    try {
      await this.postState({ on: false })
    } catch (err) {
      console.warn('[wled] Error during disconnect:', err)
    }
  }

  private async setPreset(presetId: number): Promise<void> {
    await this.postState({ ps: presetId })
  }

  private async postState(payload: Record<string, any>): Promise<void> {
    try {
      const response = await fetch(`${this.baseUrl}/state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000),
      })

      if (!response.ok) {
        throw new Error(`WLED returned ${response.status}`)
      }
    } catch (err: any) {
      console.error('[wled] Failed to set state:', err.message)
    }
  }

  private mapPatternToEffect(pattern: string): number {
    // WLED effect IDs (common ones)
    // 0 = solid, 1 = blink, 2 = breathe, 43 = android, etc.
    // See https://kno.wled.ge/features/effects/
    switch (pattern) {
      case 'solid':
        return 0
      case 'blink':
        return 1
      case 'breathe':
        return 2
      case 'pulse':
        return 43 // Android effect (pulse from center)
      case 'off':
        return 0
      default:
        return 0
    }
  }
}
