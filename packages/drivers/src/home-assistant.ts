/**
 * Home Assistant driver
 * 
 * Controls lights via Home Assistant REST API.
 * Covers Hue, LIFX, Govee, Zigbee, Matter, and anything else HA integrates.
 */

import type { LampDriver, AggregateState, StateTheme } from './types.js'
import { hexToRGB } from './types.js'

export interface HomeAssistantConfig {
  url: string // e.g., http://homeassistant.local:8123
  token: string // long-lived access token
  entity: string // e.g., light.office_lamp
  theme: Record<string, StateTheme>
}

export class HomeAssistantDriver implements LampDriver {
  readonly name = 'home-assistant'
  private currentState: AggregateState | null = null
  private baseUrl: string

  constructor(private config: HomeAssistantConfig) {
    this.baseUrl = config.url.replace(/\/$/, '')
  }

  async connect(): Promise<void> {
    try {
      const response = await fetch(`${this.baseUrl}/api/`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(5000),
      })

      if (!response.ok) {
        throw new Error(`Home Assistant returned ${response.status}`)
      }

      const data = await response.json() as any
      console.log(`[home-assistant] Connected to ${data.message || 'Home Assistant'}`)
    } catch (err: any) {
      throw new Error(`Failed to connect to Home Assistant at ${this.config.url}: ${err.message}`)
    }
  }

  async setState(state: AggregateState): Promise<void> {
    if (this.currentState?.state === state.state) {
      return // no change
    }

    this.currentState = state
    const theme = this.config.theme[state.state]
    if (!theme) {
      console.warn(`[home-assistant] No theme for state: ${state.state}`)
      return
    }

    if (theme.pattern === 'off') {
      await this.turnOff()
      return
    }

    const rgb = hexToRGB(theme.color)
    
    // HA light.turn_on supports rgb_color and brightness
    // Effects (like breathe/blink) depend on the light's capabilities
    // For simplicity, we set color and brightness only.
    // Advanced: check light's supported_features and use effect if available.
    
    await this.callService('light', 'turn_on', {
      entity_id: this.config.entity,
      rgb_color: [rgb.r, rgb.g, rgb.b],
      brightness: 255,
      transition: theme.speed === 'fast' ? 0.3 : theme.speed === 'slow' ? 1.5 : 0.8,
    })
  }

  async disconnect(): Promise<void> {
    try {
      await this.turnOff()
    } catch (err) {
      console.warn('[home-assistant] Error during disconnect:', err)
    }
  }

  private async turnOff(): Promise<void> {
    await this.callService('light', 'turn_off', {
      entity_id: this.config.entity,
      transition: 0.5,
    })
  }

  private async callService(domain: string, service: string, data: Record<string, any>): Promise<void> {
    try {
      const response = await fetch(`${this.baseUrl}/api/services/${domain}/${service}`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(data),
        signal: AbortSignal.timeout(5000),
      })

      if (!response.ok) {
        const text = await response.text()
        throw new Error(`Home Assistant returned ${response.status}: ${text}`)
      }
    } catch (err: any) {
      console.error(`[home-assistant] Failed to call ${domain}.${service}:`, err.message)
    }
  }

  private headers(): Record<string, string> {
    return {
      'Authorization': `Bearer ${this.config.token}`,
      'Content-Type': 'application/json',
    }
  }
}
