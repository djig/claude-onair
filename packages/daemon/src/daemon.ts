/**
 * Main daemon process
 */

import { randomBytes } from 'node:crypto'
import { writeFile, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { StateReducer } from './state-reducer.js'
import { LampManager } from './lamp-manager.js'
import { DaemonServer } from './server.js'
import { loadConfig, ensureConfigDir } from './config.js'
import type { DaemonConfig } from './types.js'

export class Daemon {
  private config: DaemonConfig | null = null
  private reducer: StateReducer | null = null
  private lampManager: LampManager | null = null
  private server: DaemonServer | null = null
  private idleTimer: NodeJS.Timeout | null = null
  private lastActivityAt = Date.now()

  async start(options: { verbose?: boolean; idleExitMinutes?: number } = {}): Promise<void> {
    console.log('[daemon] Starting claude-onair daemon...')

    this.config = await loadConfig()
    await this.ensureHostToken()

    this.reducer = new StateReducer(this.config.doneFadeMinutes)
    this.lampManager = new LampManager(this.config)
    this.server = new DaemonServer(this.config, this.reducer, this.lampManager)

    await this.lampManager.start()
    await this.server.start()

    console.log('[daemon] Started successfully')

    // Idle auto-exit (optional)
    if (options.idleExitMinutes && options.idleExitMinutes > 0) {
      this.startIdleTimer(options.idleExitMinutes)
    }

    // Handle shutdown
    process.on('SIGINT', () => this.stop())
    process.on('SIGTERM', () => this.stop())
  }

  async stop(): Promise<void> {
    console.log('[daemon] Shutting down...')

    if (this.idleTimer) {
      clearInterval(this.idleTimer)
    }

    if (this.server) {
      await this.server.stop()
    }

    if (this.lampManager) {
      await this.lampManager.stop()
    }

    console.log('[daemon] Stopped')
    process.exit(0)
  }

  private async ensureHostToken(): Promise<void> {
    await ensureConfigDir()

    if (!existsSync(this.config!.tokenPath)) {
      const token = randomBytes(32).toString('hex')
      await writeFile(this.config!.tokenPath, token, { mode: 0o600 })
      console.log(`[daemon] Generated host token at ${this.config!.tokenPath}`)
    } else {
      // Verify token is readable
      try {
        await readFile(this.config!.tokenPath, 'utf-8')
      } catch (err: any) {
        throw new Error(`Host token at ${this.config!.tokenPath} is not readable. Check permissions (should be 0600).`)
      }
    }
  }

  private startIdleTimer(minutes: number): void {
    const checkIntervalMs = 60 * 1000 // check every minute
    const idleThresholdMs = minutes * 60 * 1000

    this.idleTimer = setInterval(() => {
      const sessions = this.reducer!.getSessions()
      const activeSessions = sessions.filter(s => s.isActive)

      if (activeSessions.length === 0) {
        const idleMs = Date.now() - this.lastActivityAt
        if (idleMs >= idleThresholdMs) {
          console.log(`[daemon] No active sessions for ${minutes} minutes, exiting`)
          this.stop()
        }
      } else {
        this.lastActivityAt = Date.now()
      }
    }, checkIntervalMs)
  }
}
