/**
 * Govee LAN driver
 * 
 * Controls Govee lights over LAN using UDP (requires "LAN Control" enabled in Govee Home app).
 * Tested with H612F LED strip.
 * 
 * Protocol:
 * - Commands: JSON UDP to <ip>:4003
 * - Discovery: multicast 'scan' to 239.255.255.250:4001, replies on port 4002
 * - Device DROPS back-to-back commands, so we queue and space them ~150ms apart
 */

import dgram from 'node:dgram'
import type { LampDriver, AggregateState, StateTheme } from './types.js'

export interface GoveeConfig {
  ip: string
  theme?: {
    thinking?: StateTheme
    tool?: StateTheme
    'needs-you'?: StateTheme
    done?: StateTheme
    error?: StateTheme
    idle?: StateTheme
    off?: StateTheme
  }
}

interface GoveeCommand {
  cmd: 'turn' | 'brightness' | 'colorwc' | 'devStatus'
  data: any
}

const NAMED_COLORS: Record<string, string> = {
  red: 'ff0000',
  green: '00cc00',
  blue: '0066ff',
  cyan: '00cccc',
  orange: 'ff8800',
  yellow: 'ffcc00',
  purple: '8800ff',
  white: 'ffffff',
  pink: 'ff3399',
}

// Default theme colors for each state
const DEFAULT_THEME: Record<string, StateTheme> = {
  thinking: { color: '#0066ff', pattern: 'solid', speed: 'slow' },
  tool: { color: '#00cccc', pattern: 'solid' },
  'needs-you': { color: '#ff8800', pattern: 'blink', speed: 'fast' },
  done: { color: '#00cc00', pattern: 'solid' },
  error: { color: '#ff0000', pattern: 'solid' },
  idle: { color: '#000000', pattern: 'off' },
  off: { color: '#000000', pattern: 'off' },
}

export class GoveeDriver implements LampDriver {
  readonly name = 'govee'
  private config: GoveeConfig
  private socket?: dgram.Socket
  private queue: GoveeCommand[] = []
  private draining = false
  private blinkTimer?: NodeJS.Timeout
  private currentState?: string

  constructor(config: GoveeConfig) {
    this.config = config
  }

  async connect(): Promise<void> {
    this.socket = dgram.createSocket('udp4')
    this.socket.on('error', (err) => {
      console.error(`[govee] socket error: ${err.message}`)
    })
  }

  async setState(state: AggregateState): Promise<void> {
    const stateKey = state.state
    
    // Don't repeat the same state
    if (this.currentState === stateKey) {
      return
    }
    this.currentState = stateKey

    this.stopBlink()

    // Get theme for this state (user config or default)
    const theme = this.config.theme?.[stateKey] || DEFAULT_THEME[stateKey] || DEFAULT_THEME.idle

    // Handle off/idle states
    if (theme.pattern === 'off' || stateKey === 'off' || stateKey === 'idle') {
      this.send('turn', { value: 0 })
      return
    }

    // Parse color
    const color = this.parseColor(theme.color)
    if (!color) {
      console.log(`[govee] invalid color for state ${stateKey}: ${theme.color}`)
      return
    }

    // Set color and brightness
    this.send('turn', { value: 1 })
    this.send('brightness', { value: 100 })
    this.send('colorwc', { color, colorTemInKelvin: 0 })

    // Handle patterns
    if (theme.pattern === 'blink') {
      this.startBlink(theme.speed || 'medium')
    } else if (theme.pattern === 'breathe' || theme.pattern === 'pulse') {
      this.startBreath(theme.speed || 'slow')
    }
  }

  async disconnect(): Promise<void> {
    this.stopBlink()
    this.queue = []
    if (this.socket) {
      this.socket.close()
      this.socket = undefined
    }
  }

  /**
   * Discover Govee devices on the network
   * Returns array of { ip, sku } for devices that respond within timeout
   */
  static async discover(timeoutMs = 5000): Promise<Array<{ ip: string; sku: string }>> {
    return new Promise((resolve) => {
      const devices: Array<{ ip: string; sku: string }> = []
      const listener = dgram.createSocket({ type: 'udp4', reuseAddr: true })

      listener.on('message', (buf) => {
        try {
          const msg = JSON.parse(buf.toString())
          const data = msg.msg?.data
          if (data?.ip && data?.sku) {
            devices.push({ ip: data.ip, sku: data.sku })
          }
        } catch {
          // Ignore parse errors
        }
      })

      listener.bind(4002, () => {
        const scanner = dgram.createSocket('udp4')
        const scanMsg = JSON.stringify({
          msg: { cmd: 'scan', data: { account_topic: 'reserve' } },
        })
        scanner.send(scanMsg, 4001, '239.255.255.250', () => {
          scanner.close()
        })

        setTimeout(() => {
          listener.close()
          resolve(devices)
        }, timeoutMs)
      })
    })
  }

  private send(cmd: GoveeCommand['cmd'], data: any): void {
    this.queue.push({ cmd, data })
    if (!this.draining) {
      this.drain()
    }
  }

  private drain(): void {
    const next = this.queue.shift()
    if (!next) {
      this.draining = false
      return
    }

    this.draining = true

    if (!this.socket || !this.config.ip) {
      console.error('[govee] socket not connected or no IP configured')
      setTimeout(() => this.drain(), 150)
      return
    }

    const message = JSON.stringify({ msg: next })
    this.socket.send(message, 4003, this.config.ip, (err) => {
      if (err) {
        console.error(`[govee] send ${next.cmd} failed: ${err.message}`)
      }
    })

    setTimeout(() => this.drain(), 150)
  }

  private stopBlink(): void {
    if (this.blinkTimer) {
      clearInterval(this.blinkTimer)
      this.blinkTimer = undefined
    }
    this.queue = []
  }

  private startBlink(speed: 'slow' | 'medium' | 'fast'): void {
    const ms = speed === 'fast' ? 500 : speed === 'slow' ? 1500 : 1000
    let on = true

    this.blinkTimer = setInterval(() => {
      on = !on
      this.send('brightness', { value: on ? 100 : 5 })
    }, ms)
  }

  private startBreath(speed: 'slow' | 'medium' | 'fast'): void {
    // For breathe/pulse, do a gentle brightness ramp
    const ms = speed === 'fast' ? 1500 : speed === 'slow' ? 4000 : 2500
    const steps = 20
    const stepMs = ms / steps
    let step = 0
    let increasing = true

    this.blinkTimer = setInterval(() => {
      const brightness = Math.round(10 + (90 * step) / steps)
      this.send('brightness', { value: brightness })
      
      if (increasing) {
        step++
        if (step >= steps) {
          increasing = false
        }
      } else {
        step--
        if (step <= 0) {
          increasing = true
        }
      }
    }, stepMs)
  }

  private parseColor(hex: string): { r: number; g: number; b: number } | null {
    if (typeof hex !== 'string') return null
    
    let value = hex.trim().toLowerCase()
    
    // Handle named colors
    value = NAMED_COLORS[value] || value.replace('#', '')
    
    // Expand 3-char hex to 6-char
    if (/^[0-9a-f]{3}$/.test(value)) {
      value = value.split('').map((c) => c + c).join('')
    }
    
    // Validate 6-char hex
    if (!/^[0-9a-f]{6}$/.test(value)) {
      return null
    }
    
    const num = parseInt(value, 16)
    return {
      r: (num >> 16) & 255,
      g: (num >> 8) & 255,
      b: num & 255,
    }
  }
}
