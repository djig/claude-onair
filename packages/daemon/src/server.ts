/**
 * HTTP server for the daemon
 * 
 * POST /v1/ingest - receive batched events from mods
 * GET /v1/status - daemon status
 * GET /healthz - health check
 */

import { createServer, IncomingMessage, ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import type { BusEvent, DaemonConfig } from './types.js'
import type { StateReducer } from './state-reducer.js'
import type { LampManager } from './lamp-manager.js'

export class DaemonServer {
  private server: ReturnType<typeof createServer> | null = null
  private token: string | null = null

  constructor(
    private config: DaemonConfig,
    private reducer: StateReducer,
    private lampManager: LampManager
  ) {}

  async start(): Promise<void> {
    // Load host token
    try {
      this.token = (await readFile(this.config.tokenPath, 'utf-8')).trim()
    } catch (err: any) {
      throw new Error(`Failed to read host token from ${this.config.tokenPath}: ${err.message}`)
    }

    this.server = createServer((req, res) => this.handleRequest(req, res))

    return new Promise((resolve, reject) => {
      this.server!.listen(this.config.port, this.config.host, () => {
        console.log(`[server] Listening on ${this.config.host}:${this.config.port}`)
        resolve()
      })
      this.server!.on('error', reject)
    })
  }

  async stop(): Promise<void> {
    if (this.server) {
      return new Promise((resolve) => {
        this.server!.close(() => {
          console.log('[server] Stopped')
          resolve()
        })
      })
    }
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url!, `http://${req.headers.host}`)

    // Validate Host header (DNS rebinding protection)
    const allowedHosts = [
      `${this.config.host}:${this.config.port}`,
      `localhost:${this.config.port}`,
    ]
    if (!allowedHosts.includes(req.headers.host!)) {
      res.writeHead(400, { 'Content-Type': 'text/plain' })
      res.end('Bad Request: invalid Host header')
      return
    }

    // CORS: strict, no wildcard
    res.setHeader('Access-Control-Allow-Origin', `http://${req.headers.host}`)
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    // Routes
    if (url.pathname === '/healthz' && req.method === 'GET') {
      await this.handleHealthz(req, res)
    } else if (url.pathname === '/v1/ingest' && req.method === 'POST') {
      await this.handleIngest(req, res)
    } else if (url.pathname === '/v1/status' && req.method === 'GET') {
      await this.handleStatus(req, res)
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('Not Found')
    }
  }

  private async handleHealthz(req: IncomingMessage, res: ServerResponse): Promise<void> {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('ok')
  }

  private async handleIngest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Check auth
    const authHeader = req.headers['authorization']
    if (!this.checkAuth(authHeader)) {
      res.writeHead(401, { 'Content-Type': 'text/plain' })
      res.end('Unauthorized')
      return
    }

    // Read body
    const chunks: Buffer[] = []
    for await (const chunk of req) {
      chunks.push(chunk as Buffer)
    }
    const body = Buffer.concat(chunks).toString('utf-8')

    let events: BusEvent[]
    try {
      events = JSON.parse(body)
      if (!Array.isArray(events)) {
        throw new Error('Expected array of events')
      }
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Invalid JSON' }))
      return
    }

    // Process events
    for (const event of events) {
      try {
        // Validate session field is a non-empty string
        if (!event.session || typeof event.session !== 'string' || !event.session.trim()) {
          console.warn('[server] Skipping event with invalid session:', event.session)
          continue
        }
        
        const newState = this.reducer.reduce(event)
        await this.lampManager.setState(newState)
      } catch (err: any) {
        console.error('[server] Error processing event:', err.message)
      }
    }

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, processed: events.length }))
  }

  private async handleStatus(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const sessions = this.reducer.getSessions()
    const lastAggregate = this.reducer.getLastAggregate()

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      ok: true,
      status: 'running',
      sessions: sessions.map(s => ({
        sessionId: s.sessionId,
        state: s.currentState,
        subagents: s.subagentCount,
        quotaWarning: s.quotaWarning,
        isActive: s.isActive,
      })),
      aggregate: lastAggregate,
    }, null, 2))
  }

  private checkAuth(authHeader: string | undefined): boolean {
    if (!authHeader) return false
    const match = authHeader.match(/^Bearer (.+)$/)
    if (!match) return false
    return match[1] === this.token
  }
}
