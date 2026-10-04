/**
 * Driver tests - blink(1), WLED, Home Assistant, Webhook
 * Uses mocks to verify color/pattern outputs and error resilience
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Blink1Driver } from '../blink1.js'
import { WLEDDriver } from '../wled.js'
import { HomeAssistantDriver } from '../home-assistant.js'
import { WebhookDriver } from '../webhook.js'
import type { AggregateState } from '../types.js'
import { createServer, type Server } from 'node:http'
import { AddressInfo } from 'node:net'

// Mock HID device for blink(1)
const createMockHIDDevice = () => ({
  sendFeatureReport: vi.fn(),
  close: vi.fn(),
})

let mockHIDDevice = createMockHIDDevice()

// Mock constructor that returns the mock device
class MockHID {
  constructor(path: string) {
    return mockHIDDevice as any
  }
}

const mockDevices = vi.fn(() => [{ path: '/dev/hidraw0' }])

vi.mock('node-hid', () => ({
  default: {
    HID: MockHID,
    devices: mockDevices,
  },
  HID: MockHID,
  devices: mockDevices,
}))

// Mock HTTP servers for WLED, HA, webhook
describe('Blink1Driver', () => {
  let driver: Blink1Driver

  beforeEach(() => {
    vi.clearAllMocks()
    mockHIDDevice = createMockHIDDevice()
    mockDevices.mockReturnValue([{ path: '/dev/hidraw0' }])
    driver = new Blink1Driver({
      theme: {
        idle: { color: '#000000', pattern: 'off' },
        thinking: { color: '#0000ff', pattern: 'solid' },
        tool: { color: '#00ffff', pattern: 'solid' },
        'needs-you': { color: '#ff8800', pattern: 'blink' },
        done: { color: '#00ff00', pattern: 'solid' },
        error: { color: '#ff0000', pattern: 'solid' },
        off: { color: '#000000', pattern: 'off' },
      },
      useFallback: false, // use mocked HID
    })
  })

  it('should connect to mocked HID device', async () => {
    await driver.connect()
    expect(mockDevices).toHaveBeenCalledWith(0x27b8, 0x01ed)
  })

  it('should send correct RGB for thinking state', async () => {
    await driver.connect()
    
    const state: AggregateState = {
      state: 'thinking',
      timestamp: Date.now(),
    }
    
    await driver.setState(state)
    
    // Check that sendFeatureReport was called with blue color (0, 0, 255)
    expect(mockHIDDevice.sendFeatureReport).toHaveBeenCalled()
    const buffer = mockHIDDevice.sendFeatureReport.mock.calls[0][0]
    expect(buffer[0]).toBe(0x01) // report ID
    expect(buffer[1]).toBe(0x63) // 'c' command
    expect(buffer[2]).toBe(0)    // r
    expect(buffer[3]).toBe(0)    // g
    expect(buffer[4]).toBe(255)  // b
    expect(buffer[7]).toBe(0)    // LED 0
  })

  it('should send correct RGB for needs-you state', async () => {
    await driver.connect()
    
    const state: AggregateState = {
      state: 'needs-you',
      timestamp: Date.now(),
    }
    
    await driver.setState(state)
    
    const buffer = mockHIDDevice.sendFeatureReport.mock.calls[0][0]
    expect(buffer[2]).toBe(255)  // r
    expect(buffer[3]).toBe(136)  // g
    expect(buffer[4]).toBe(0)    // b (orange #ff8800)
  })

  it('should send correct RGB for error state', async () => {
    await driver.connect()
    
    const state: AggregateState = {
      state: 'error',
      timestamp: Date.now(),
    }
    
    await driver.setState(state)
    
    const buffer = mockHIDDevice.sendFeatureReport.mock.calls[0][0]
    expect(buffer[2]).toBe(255)  // r (red)
    expect(buffer[3]).toBe(0)    // g
    expect(buffer[4]).toBe(0)    // b
  })

  it('should handle missing device gracefully', async () => {
    mockDevices.mockReturnValueOnce([])
    
    const driver2 = new Blink1Driver({
      theme: {},
      useFallback: false,
    })

    // HID fails with no devices, then falls back to CLI which also fails
    // Either way, the driver should throw an error without crashing
    await expect(driver2.connect()).rejects.toThrow()
  })

  it('should turn off LEDs on disconnect', async () => {
    // Ensure mock is reset
    mockHIDDevice = createMockHIDDevice()
    mockDevices.mockReturnValue([{ path: '/dev/hidraw0' }])
    
    const testDriver = new Blink1Driver({
      theme: {
        idle: { color: '#000000', pattern: 'off' },
      },
      useFallback: false,
    })
    
    await testDriver.connect()
    await testDriver.disconnect()
    
    // Should have sent off commands to both LEDs
    const calls = mockHIDDevice.sendFeatureReport.mock.calls
    const lastCalls = calls.slice(-2)
    
    lastCalls.forEach(call => {
      const buffer = call[0]
      expect(buffer[2]).toBe(0)  // r = 0
      expect(buffer[3]).toBe(0)  // g = 0
      expect(buffer[4]).toBe(0)  // b = 0
    })
    
    expect(mockHIDDevice.close).toHaveBeenCalled()
  })
})

describe('WLEDDriver', () => {
  let server: Server
  let port: number
  let driver: WLEDDriver
  let lastRequest: any = null

  beforeEach(async () => {
    lastRequest = null
    
    // Create mock WLED HTTP server
    server = createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', chunk => chunks.push(chunk))
      req.on('end', () => {
        const body = chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString()) : null
        lastRequest = { method: req.method, url: req.url, body }
        
        if (req.url === '/json/info') {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ name: 'Test WLED', ver: '0.14.0' }))
        } else if (req.url === '/json/state') {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ on: true }))
        } else {
          res.writeHead(404)
          res.end()
        }
      })
    })

    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    port = (server.address() as AddressInfo).port

    driver = new WLEDDriver({
      ip: `127.0.0.1:${port}`,
      theme: {
        thinking: { color: '#0000ff', pattern: 'solid' },
        tool: { color: '#00ffff', pattern: 'solid' },
        error: { color: '#ff0000', pattern: 'blink' },
        off: { color: '#000000', pattern: 'off' },
      },
    })
  })

  afterEach(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()))
  })

  it('should connect to WLED device', async () => {
    await driver.connect()
    expect(lastRequest?.url).toBe('/json/info')
  })

  it('should send correct color for thinking state', async () => {
    await driver.connect()
    lastRequest = null
    
    const state: AggregateState = {
      state: 'thinking',
      timestamp: Date.now(),
    }
    
    await driver.setState(state)
    
    expect(lastRequest?.url).toBe('/json/state')
    expect(lastRequest?.body.on).toBe(true)
    expect(lastRequest?.body.seg[0].col[0]).toEqual([0, 0, 255]) // blue
    expect(lastRequest?.body.seg[0].fx).toBe(0) // solid effect
  })

  it('should send correct color for error state with blink pattern', async () => {
    await driver.connect()
    lastRequest = null
    
    const state: AggregateState = {
      state: 'error',
      timestamp: Date.now(),
    }
    
    await driver.setState(state)
    
    expect(lastRequest?.body.seg[0].col[0]).toEqual([255, 0, 0]) // red
    expect(lastRequest?.body.seg[0].fx).toBe(1) // blink effect
  })

  it('should turn off on disconnect', async () => {
    await driver.connect()
    lastRequest = null
    
    await driver.disconnect()
    
    expect(lastRequest?.body.on).toBe(false)
  })

  it('should handle unreachable device gracefully', async () => {
    const failDriver = new WLEDDriver({
      ip: '127.0.0.1:9999', // non-existent port
      theme: { thinking: { color: '#0000ff', pattern: 'solid' } },
    })

    await expect(failDriver.connect()).rejects.toThrow()
  })
})

describe('HomeAssistantDriver', () => {
  let server: Server
  let port: number
  let driver: HomeAssistantDriver
  let lastRequest: any = null

  beforeEach(async () => {
    lastRequest = null
    
    // Create mock Home Assistant HTTP server
    server = createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', chunk => chunks.push(chunk))
      req.on('end', () => {
        const body = chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString()) : null
        lastRequest = { 
          method: req.method, 
          url: req.url, 
          body,
          headers: req.headers,
        }
        
        if (req.url === '/api/') {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ message: 'API running' }))
        } else if (req.url?.startsWith('/api/services/')) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify([{ state: 'on' }]))
        } else {
          res.writeHead(404)
          res.end()
        }
      })
    })

    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    port = (server.address() as AddressInfo).port

    driver = new HomeAssistantDriver({
      url: `http://127.0.0.1:${port}`,
      token: 'test-token-ha',
      entity: 'light.office_lamp',
      theme: {
        thinking: { color: '#0000ff', pattern: 'solid' },
        'needs-you': { color: '#ff8800', pattern: 'solid' },
        done: { color: '#00ff00', pattern: 'solid' },
        off: { color: '#000000', pattern: 'off' },
      },
    })
  })

  afterEach(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()))
  })

  it('should connect with auth token', async () => {
    await driver.connect()
    expect(lastRequest?.headers.authorization).toBe('Bearer test-token-ha')
  })

  it('should send correct RGB for thinking state', async () => {
    await driver.connect()
    lastRequest = null
    
    const state: AggregateState = {
      state: 'thinking',
      timestamp: Date.now(),
    }
    
    await driver.setState(state)
    
    expect(lastRequest?.url).toBe('/api/services/light/turn_on')
    expect(lastRequest?.body.entity_id).toBe('light.office_lamp')
    expect(lastRequest?.body.rgb_color).toEqual([0, 0, 255]) // blue
    expect(lastRequest?.body.brightness).toBe(255)
  })

  it('should send correct RGB for needs-you state', async () => {
    await driver.connect()
    lastRequest = null
    
    const state: AggregateState = {
      state: 'needs-you',
      timestamp: Date.now(),
    }
    
    await driver.setState(state)
    
    expect(lastRequest?.body.rgb_color).toEqual([255, 136, 0]) // orange
  })

  it('should turn off for off state', async () => {
    await driver.connect()
    lastRequest = null
    
    const state: AggregateState = {
      state: 'off',
      timestamp: Date.now(),
    }
    
    await driver.setState(state)
    
    expect(lastRequest?.url).toBe('/api/services/light/turn_off')
  })

  it('should handle unreachable HA server gracefully', async () => {
    const failDriver = new HomeAssistantDriver({
      url: 'http://127.0.0.1:9998',
      token: 'test',
      entity: 'light.test',
      theme: {},
    })

    await expect(failDriver.connect()).rejects.toThrow()
  })
})

describe('WebhookDriver', () => {
  let server: Server
  let port: number
  let driver: WebhookDriver
  let lastRequest: any = null

  beforeEach(async () => {
    lastRequest = null
    
    // Create mock webhook HTTP server
    server = createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', chunk => chunks.push(chunk))
      req.on('end', () => {
        const body = chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString()) : null
        lastRequest = { 
          method: req.method, 
          url: req.url, 
          body,
          headers: req.headers,
        }
        
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
      })
    })

    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    port = (server.address() as AddressInfo).port

    driver = new WebhookDriver({
      url: `http://127.0.0.1:${port}/webhook`,
      headers: { 'X-Custom-Header': 'test' },
      theme: {
        thinking: { color: '#0000ff', pattern: 'solid' },
        tool: { color: '#00ffff', pattern: 'solid' },
        error: { color: '#ff0000', pattern: 'solid' },
      },
    })
  })

  afterEach(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()))
  })

  it('should connect to webhook endpoint', async () => {
    await driver.connect()
    expect(lastRequest?.method).toBe('HEAD')
  })

  it('should POST state changes with correct payload', async () => {
    await driver.connect()
    lastRequest = null
    
    const state: AggregateState = {
      state: 'thinking',
      timestamp: 1234567890,
      subagentCount: 2,
      quotaWarning: false,
    }
    
    await driver.setState(state)
    
    expect(lastRequest?.method).toBe('POST')
    expect(lastRequest?.body.state).toBe('thinking')
    expect(lastRequest?.body.theme.color).toBe('#0000ff')
    expect(lastRequest?.body.subagentCount).toBe(2)
    expect(lastRequest?.body.quotaWarning).toBe(false)
    expect(lastRequest?.body.timestamp).toBe(1234567890)
  })

  it('should include custom headers', async () => {
    await driver.connect()
    lastRequest = null
    
    const state: AggregateState = {
      state: 'tool',
      timestamp: Date.now(),
    }
    
    await driver.setState(state)
    
    expect(lastRequest?.headers['x-custom-header']).toBe('test')
  })

  it('should handle unreachable webhook gracefully without crashing', async () => {
    const failDriver = new WebhookDriver({
      url: 'http://127.0.0.1:9997/hook',
      theme: { thinking: { color: '#0000ff', pattern: 'solid' } },
    })

    // connect may warn but shouldn't throw
    await failDriver.connect()
    
    // setState should not throw even if endpoint is unreachable
    const state: AggregateState = {
      state: 'thinking',
      timestamp: Date.now(),
    }
    
    await expect(failDriver.setState(state)).resolves.not.toThrow()
  })

  it('should send off state on disconnect', async () => {
    await driver.connect()
    lastRequest = null
    
    await driver.disconnect()
    
    expect(lastRequest?.body.state).toBe('off')
  })
})
