/**
 * Webhook driver
 * 
 * Generic HTTP webhook driver for custom integrations.
 * POSTs state changes to a configured URL.
 */

import type { LampDriver, AggregateState, StateTheme } from './types.js'

export interface WebhookConfig {
  url: string
  theme: Record<string, StateTheme>
  headers?: Record<string, string>
  method?: 'POST' | 'PUT' | 'PATCH'
  timeout?: number // ms
}

export class WebhookDriver implements LampDriver {
  readonly name = 'webhook'
  private currentState: AggregateState | null = null

  constructor(private config: WebhookConfig) {}

  async connect(): Promise<void> {
    // Send a test ping
    try {
      const response = await fetch(this.config.url, {
        method: 'HEAD',
        headers: this.config.headers,
        signal: AbortSignal.timeout(this.config.timeout ?? 5000),
      })
      
      // HEAD may not be supported, so accept any 2xx/4xx
      if (response.status >= 500) {
        throw new Error(`Webhook endpoint returned ${response.status}`)
      }
      
      console.log(`[webhook] Connected to ${this.config.url}`)
    } catch (err: any) {
      console.warn(`[webhook] Warning: could not test ${this.config.url}: ${err.message}`)
      // Don't fail connect; the endpoint might only support POST
    }
  }

  async setState(state: AggregateState): Promise<void> {
    if (this.currentState?.state === state.state) {
      return
    }

    this.currentState = state
    const theme = this.config.theme[state.state]

    const payload = {
      state: state.state,
      theme: theme || null,
      subagentCount: state.subagentCount ?? 0,
      quotaWarning: state.quotaWarning ?? false,
      timestamp: state.timestamp,
    }

    try {
      const response = await fetch(this.config.url, {
        method: this.config.method ?? 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.config.headers,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.config.timeout ?? 5000),
      })

      if (!response.ok) {
        console.warn(`[webhook] Endpoint returned ${response.status}`)
      }
    } catch (err: any) {
      console.error('[webhook] Failed to send state:', err.message)
    }
  }

  async disconnect(): Promise<void> {
    // Optionally send an "off" state
    try {
      await this.setState({
        state: 'off',
        timestamp: Date.now(),
      })
    } catch (err) {
      console.warn('[webhook] Error during disconnect:', err)
    }
  }
}
