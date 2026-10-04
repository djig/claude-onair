/**
 * blink(1) USB HID driver
 * 
 * Controls blink(1) mk2/mk3 devices via node-hid or fallback to blink1-tool CLI.
 * Supports two LEDs: LED 0 for main state, LED 1 for accents (subagent count, quota).
 */

import type { LampDriver, AggregateState, StateTheme, ColorRGB } from './types.js'
import { hexToRGB } from './types.js'
import { spawn } from 'node:child_process'

const BLINK1_VENDOR_ID = 0x27b8
const BLINK1_PRODUCT_ID = 0x01ed

// Pattern timing in ms
const FADE_TIMES = {
  slow: 1500,
  medium: 800,
  fast: 300,
}

export interface Blink1Config {
  theme: Record<string, StateTheme>
  useFallback?: boolean // force blink1-tool even if HID works
}

export class Blink1Driver implements LampDriver {
  readonly name = 'blink1'
  private device: any = null
  private useCLI = false
  private currentState: AggregateState | null = null

  constructor(private config: Blink1Config) {}

  async connect(): Promise<void> {
    if (this.config.useFallback) {
      this.useCLI = true
      await this.testCLI()
      return
    }

    try {
      const HID = await import('node-hid')
      const devices = HID.devices(BLINK1_VENDOR_ID, BLINK1_PRODUCT_ID)
      
      if (devices.length === 0) {
        throw new Error('No blink(1) device found')
      }

      this.device = new HID.HID(devices[0].path!)
      console.log('[blink1] Connected via HID:', devices[0].path)
    } catch (err: any) {
      console.warn('[blink1] HID failed, falling back to blink1-tool:', err.message)
      this.useCLI = true
      await this.testCLI()
    }
  }

  async setState(state: AggregateState): Promise<void> {
    if (this.currentState?.state === state.state && 
        this.currentState?.subagentCount === state.subagentCount &&
        this.currentState?.quotaWarning === state.quotaWarning) {
      return // no change
    }

    this.currentState = state
    const theme = this.config.theme[state.state]
    if (!theme) {
      console.warn(`[blink1] No theme for state: ${state.state}`)
      return
    }

    const rgb = hexToRGB(theme.color)
    const fadeMs = theme.speed ? FADE_TIMES[theme.speed] : FADE_TIMES.medium

    switch (theme.pattern) {
      case 'solid':
        await this.setLED(0, rgb, fadeMs)
        break
      case 'breathe':
        await this.playPattern(0, 'breathe', rgb, fadeMs)
        break
      case 'blink':
        await this.playPattern(0, 'blink', rgb, fadeMs)
        break
      case 'pulse':
        await this.playPattern(0, 'pulse', rgb, fadeMs)
        break
      case 'off':
        await this.setLED(0, { r: 0, g: 0, b: 0 }, fadeMs)
        break
    }

    // LED 1: accent for subagent count or quota warning
    if (state.quotaWarning) {
      await this.setLED(1, hexToRGB('#ff8800'), 500) // amber
    } else if (state.subagentCount && state.subagentCount > 0) {
      // dim white, brightness proportional to count (cap at 5)
      const brightness = Math.min(state.subagentCount * 40, 200)
      await this.setLED(1, { r: brightness, g: brightness, b: brightness }, 500)
    } else {
      await this.setLED(1, { r: 0, g: 0, b: 0 }, 500) // off
    }
  }

  async disconnect(): Promise<void> {
    if (this.device) {
      try {
        // Turn off both LEDs
        await this.setLED(0, { r: 0, g: 0, b: 0 }, 300)
        await this.setLED(1, { r: 0, g: 0, b: 0 }, 300)
        this.device.close()
      } catch (err) {
        console.warn('[blink1] Error during disconnect:', err)
      }
      this.device = null
    }
  }

  private async setLED(led: number, rgb: ColorRGB, fadeMs: number): Promise<void> {
    if (this.useCLI) {
      await this.runCLI(['--rgb', `${rgb.r},${rgb.g},${rgb.b}`, '--led', String(led), '--millis', String(fadeMs)])
    } else if (this.device) {
      this.sendFeatureReport([
        0x01, // report ID
        0x63, // 'c' command (fade to RGB)
        rgb.r,
        rgb.g,
        rgb.b,
        (fadeMs >> 8) & 0xff,
        fadeMs & 0xff,
        led,
      ])
    }
  }

  private async playPattern(led: number, pattern: 'breathe' | 'blink' | 'pulse', rgb: ColorRGB, fadeMs: number): Promise<void> {
    if (this.useCLI) {
      const args = ['--rgb', `${rgb.r},${rgb.g},${rgb.b}`, '--led', String(led)]
      if (pattern === 'blink') {
        args.push('--blink', '1')
      } else {
        // breathe and pulse: write pattern to device memory
        args.push('--millis', String(fadeMs))
      }
      await this.runCLI(args)
      
      if (pattern === 'breathe' || pattern === 'pulse') {
        await this.runCLI(['--play', '1', '--led', String(led)])
      }
    } else if (this.device) {
      // For HID, patterns need to be written to device pattern memory
      // then played. For simplicity in v1, we just do a solid color.
      // Full pattern support would write pattern lines then trigger playback.
      await this.setLED(led, rgb, fadeMs)
    }
  }

  private sendFeatureReport(data: number[]): void {
    if (!this.device) return
    try {
      const buffer = Buffer.from(data)
      this.device.sendFeatureReport(buffer)
    } catch (err) {
      console.error('[blink1] Failed to send feature report:', err)
    }
  }

  private async testCLI(): Promise<void> {
    try {
      await this.runCLI(['--version'])
      console.log('[blink1] Using blink1-tool CLI')
    } catch (err) {
      throw new Error('blink1-tool not found. Install from https://blink1.thingm.com/blink1-tool/')
    }
  }

  private runCLI(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn('blink1-tool', args, { stdio: 'pipe' })
      let stderr = ''
      
      proc.stderr?.on('data', (chunk) => {
        stderr += chunk.toString()
      })

      proc.on('close', (code) => {
        if (code === 0) {
          resolve()
        } else {
          reject(new Error(`blink1-tool exited with code ${code}: ${stderr}`))
        }
      })

      proc.on('error', (err) => {
        reject(err)
      })
    })
  }
}
