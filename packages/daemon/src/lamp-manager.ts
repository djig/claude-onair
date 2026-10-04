/**
 * Lamp manager: loads drivers and sends state updates
 */

import type { LampDriver, AggregateState } from '@claude-onair/drivers'
import type { DaemonConfig } from './types.js'
import { Blink1Driver } from '@claude-onair/drivers'
import { WLEDDriver } from '@claude-onair/drivers'
import { HomeAssistantDriver } from '@claude-onair/drivers'
import { WebhookDriver } from '@claude-onair/drivers'

export class LampManager {
  private drivers: LampDriver[] = []
  private lastState: AggregateState | null = null
  private lastUpdateAt = 0

  constructor(private config: DaemonConfig) {}

  async start(): Promise<void> {
    for (const driverConfig of this.config.drivers) {
      if (!driverConfig.enabled) continue

      try {
        const driver = this.createDriver(driverConfig.type, driverConfig.config)
        await driver.connect()
        this.drivers.push(driver)
        console.log(`[lamp-manager] Started driver: ${driver.name}`)
      } catch (err: any) {
        console.error(`[lamp-manager] Failed to start ${driverConfig.type} driver:`, err.message)
      }
    }

    if (this.drivers.length === 0) {
      console.warn('[lamp-manager] No drivers loaded')
    }
  }

  async stop(): Promise<void> {
    for (const driver of this.drivers) {
      try {
        await driver.disconnect()
        console.log(`[lamp-manager] Stopped driver: ${driver.name}`)
      } catch (err: any) {
        console.error(`[lamp-manager] Error stopping ${driver.name}:`, err.message)
      }
    }
    this.drivers = []
  }

  async setState(state: AggregateState): Promise<void> {
    const now = Date.now()

    // Debounce: ignore updates within debounceMs of last update
    if (this.lastState && now - this.lastUpdateAt < this.config.debounceMs) {
      // unless it's a high-priority state change
      if (state.state === this.lastState.state) {
        return
      }
    }

    this.lastState = state
    this.lastUpdateAt = now

    // Send to all drivers in parallel
    await Promise.allSettled(
      this.drivers.map(driver => driver.setState(state))
    )
  }

  private createDriver(type: string, config: Record<string, unknown>): LampDriver {
    const themeStates = this.config.theme.states as any

    switch (type) {
      case 'blink1':
        return new Blink1Driver({
          theme: themeStates,
          useFallback: config.useFallback as boolean | undefined,
        })

      case 'wled':
        return new WLEDDriver({
          ip: config.ip as string,
          theme: themeStates,
          presets: config.presets as Record<string, number> | undefined,
          segment: config.segment as number | undefined,
        })

      case 'home-assistant':
        return new HomeAssistantDriver({
          url: config.url as string,
          token: config.token as string,
          entity: config.entity as string,
          theme: themeStates,
        })

      case 'webhook':
        return new WebhookDriver({
          url: config.url as string,
          theme: themeStates,
          headers: config.headers as Record<string, string> | undefined,
          method: config.method as 'POST' | 'PUT' | 'PATCH' | undefined,
          timeout: config.timeout as number | undefined,
        })

      default:
        throw new Error(`Unknown driver type: ${type}`)
    }
  }
}
