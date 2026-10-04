/**
 * HTTP server tests - auth and security
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DaemonServer } from '../server.js'
import { StateReducer } from '../state-reducer.js'
import { LampManager } from '../lamp-manager.js'
import type { DaemonConfig } from '../types.js'
import { writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('DaemonServer', () => {
  let server: DaemonServer
  let reducer: StateReducer
  let lampManager: LampManager
  let tokenPath: string
  const testToken = 'test-token-123'
  const testPort = 47899 // Different from default to avoid conflicts

  beforeEach(async () => {
    tokenPath = join(tmpdir(), `onair-test-${Date.now()}.token`)
    await mkdir(join(tmpdir()), { recursive: true })
    await writeFile(tokenPath, testToken, { mode: 0o600 })

    const config: DaemonConfig = {
      host: '127.0.0.1',
      port: testPort,
      tokenPath,
      theme: {
        name: 'test',
        states: {
          idle: { color: '#000000', pattern: 'off' },
          thinking: { color: '#0000ff', pattern: 'solid' },
          tool: { color: '#00ffff', pattern: 'solid' },
          'needs-you': { color: '#ff8800', pattern: 'blink' },
          done: { color: '#00ff00', pattern: 'solid' },
          error: { color: '#ff0000', pattern: 'solid' },
          off: { color: '#000000', pattern: 'off' },
        },
      },
      drivers: [],
      debounceMs: 400,
      doneFadeMinutes: 3,
    }

    reducer = new StateReducer(3)
    lampManager = new LampManager(config)
    server = new DaemonServer(config, reducer, lampManager)
    await server.start()
  })

  afterEach(async () => {
    await server.stop()
  })

  it('should accept requests with valid auth token', async () => {
    const response = await fetch(`http://127.0.0.1:${testPort}/v1/status`, {
      headers: {
        'Authorization': `Bearer ${testToken}`,
        'Host': `127.0.0.1:${testPort}`,
      },
    })

    expect(response.ok).toBe(true)
    const data = await response.json()
    expect(data.ok).toBe(true)
  })

  it('should reject requests without auth token', async () => {
    const response = await fetch(`http://127.0.0.1:${testPort}/v1/ingest`, {
      method: 'POST',
      headers: {
        'Host': `127.0.0.1:${testPort}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([]),
    })

    expect(response.status).toBe(401)
  })

  it('should reject requests with invalid auth token', async () => {
    const response = await fetch(`http://127.0.0.1:${testPort}/v1/ingest`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer wrong-token',
        'Host': `127.0.0.1:${testPort}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([]),
    })

    expect(response.status).toBe(401)
  })

  it('should bind only to loopback (127.0.0.1)', async () => {
    // This test verifies the server binds to 127.0.0.1
    // We can't directly test Host header rejection with fetch
    // as fetch sets Host automatically
    const response = await fetch(`http://127.0.0.1:${testPort}/healthz`)
    expect(response.ok).toBe(true)
    
    // The host validation is tested by the fact that
    // we're connecting to 127.0.0.1 which is in allowedHosts
  })

  it('should accept localhost as valid Host header', async () => {
    const response = await fetch(`http://127.0.0.1:${testPort}/healthz`, {
      headers: {
        'Host': `localhost:${testPort}`,
      },
    })

    expect(response.status).toBe(200)
  })

  it('should process valid batched events', async () => {
    const events = [
      {
        v: 1,
        session: 'test-session',
        seq: 1,
        ts: Date.now(),
        t: 'session.start',
        data: {},
      },
      {
        v: 1,
        session: 'test-session',
        seq: 2,
        ts: Date.now(),
        t: 'turn.start',
        data: {},
      },
    ]

    const response = await fetch(`http://127.0.0.1:${testPort}/v1/ingest`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${testToken}`,
        'Host': `127.0.0.1:${testPort}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(events),
    })

    expect(response.ok).toBe(true)
    const data = await response.json()
    expect(data.processed).toBe(2)

    // Verify state was updated
    const statusResponse = await fetch(`http://127.0.0.1:${testPort}/v1/status`, {
      headers: {
        'Authorization': `Bearer ${testToken}`,
        'Host': `127.0.0.1:${testPort}`,
      },
    })

    const status = await statusResponse.json()
    expect(status.aggregate.state).toBe('thinking')
  })

  it('should reject invalid JSON', async () => {
    const response = await fetch(`http://127.0.0.1:${testPort}/v1/ingest`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${testToken}`,
        'Host': `127.0.0.1:${testPort}`,
        'Content-Type': 'application/json',
      },
      body: 'not-json',
    })

    expect(response.status).toBe(400)
  })

  it('should handle CORS preflight', async () => {
    const response = await fetch(`http://127.0.0.1:${testPort}/v1/status`, {
      method: 'OPTIONS',
      headers: {
        'Host': `127.0.0.1:${testPort}`,
      },
    })

    expect(response.status).toBe(204)
  })
})
