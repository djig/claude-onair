/**
 * Tests for Govee LAN driver
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import dgram from 'node:dgram'
import { GoveeDriver } from '../govee.js'
import type { AggregateState } from '../types.js'

// Mock dgram
vi.mock('node:dgram', () => ({
  default: {
    createSocket: vi.fn(),
  },
}))

describe('GoveeDriver', () => {
  let driver: GoveeDriver
  let mockSocket: any

  beforeEach(() => {
    // Create a mock socket
    mockSocket = {
      on: vi.fn(),
      send: vi.fn((msg, port, ip, callback) => {
        if (callback) callback(null)
      }),
      close: vi.fn(),
    }

    // Mock createSocket to return our mock
    vi.mocked(dgram.createSocket).mockReturnValue(mockSocket as any)

    driver = new GoveeDriver({ ip: '192.168.1.100' })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should connect and create a UDP socket', async () => {
    await driver.connect()
    
    expect(dgram.createSocket).toHaveBeenCalledWith('udp4')
    expect(mockSocket.on).toHaveBeenCalledWith('error', expect.any(Function))
  })

  it('should send turn on command for thinking state', async () => {
    await driver.connect()
    
    const state: AggregateState = {
      state: 'thinking',
      timestamp: Date.now(),
    }

    await driver.setState(state)

    // Wait for all queued commands to process (3 commands * 150ms)
    await new Promise((resolve) => setTimeout(resolve, 600))

    // Should send turn on command
    expect(mockSocket.send).toHaveBeenCalledWith(
      expect.stringContaining('"cmd":"turn"'),
      4003,
      '192.168.1.100',
      expect.any(Function)
    )

    // Should send brightness command
    expect(mockSocket.send).toHaveBeenCalledWith(
      expect.stringContaining('"cmd":"brightness"'),
      4003,
      '192.168.1.100',
      expect.any(Function)
    )

    // Should send color command
    expect(mockSocket.send).toHaveBeenCalledWith(
      expect.stringContaining('"cmd":"colorwc"'),
      4003,
      '192.168.1.100',
      expect.any(Function)
    )
  })

  it('should send turn off command for idle state', async () => {
    await driver.connect()
    
    const state: AggregateState = {
      state: 'idle',
      timestamp: Date.now(),
    }

    await driver.setState(state)

    // Wait for queued commands
    await new Promise((resolve) => setTimeout(resolve, 50))

    // Should send turn off command
    expect(mockSocket.send).toHaveBeenCalledWith(
      expect.stringContaining('"value":0'),
      4003,
      '192.168.1.100',
      expect.any(Function)
    )
  })

  it('should parse hex colors correctly', async () => {
    await driver.connect()
    
    // Test with #rrggbb format
    const state: AggregateState = {
      state: 'done',
      timestamp: Date.now(),
    }

    await driver.setState(state)
    await new Promise((resolve) => setTimeout(resolve, 600))

    // Should parse #00cc00 (green) correctly
    const colorCalls = mockSocket.send.mock.calls.filter((call: any) => 
      call[0].includes('"cmd":"colorwc"')
    )
    expect(colorCalls.length).toBeGreaterThan(0)
    
    const colorCall = colorCalls[0][0]
    const parsed = JSON.parse(colorCall)
    expect(parsed.msg.data.color).toEqual({ r: 0, g: 204, b: 0 })
  })

  it('should parse 3-char hex colors correctly', async () => {
    const customDriver = new GoveeDriver({
      ip: '192.168.1.100',
      theme: {
        error: { color: '#f00', pattern: 'solid' },
      },
    })

    await customDriver.connect()
    
    const state: AggregateState = {
      state: 'error',
      timestamp: Date.now(),
    }

    await customDriver.setState(state)
    await new Promise((resolve) => setTimeout(resolve, 600))

    // Should expand #f00 to #ff0000 (red)
    const colorCalls = mockSocket.send.mock.calls.filter((call: any) => 
      call[0].includes('"cmd":"colorwc"')
    )
    expect(colorCalls.length).toBeGreaterThan(0)
    
    const colorCall = colorCalls[0][0]
    const parsed = JSON.parse(colorCall)
    expect(parsed.msg.data.color).toEqual({ r: 255, g: 0, b: 0 })
  })

  it('should parse named colors correctly', async () => {
    const customDriver = new GoveeDriver({
      ip: '192.168.1.100',
      theme: {
        done: { color: 'green', pattern: 'solid' },
      },
    })

    await customDriver.connect()
    
    const state: AggregateState = {
      state: 'done',
      timestamp: Date.now(),
    }

    await customDriver.setState(state)
    await new Promise((resolve) => setTimeout(resolve, 600))

    // Should parse 'green' to #00cc00
    const colorCalls = mockSocket.send.mock.calls.filter((call: any) => 
      call[0].includes('"cmd":"colorwc"')
    )
    expect(colorCalls.length).toBeGreaterThan(0)
    
    const colorCall = colorCalls[0][0]
    const parsed = JSON.parse(colorCall)
    expect(parsed.msg.data.color).toEqual({ r: 0, g: 204, b: 0 })
  })

  it('should handle invalid colors gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    
    const customDriver = new GoveeDriver({
      ip: '192.168.1.100',
      theme: {
        error: { color: 'invalid-color', pattern: 'solid' },
      },
    })

    await customDriver.connect()
    
    const state: AggregateState = {
      state: 'error',
      timestamp: Date.now(),
    }

    await customDriver.setState(state)
    await new Promise((resolve) => setTimeout(resolve, 50))

    // Should log error for invalid color
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('invalid color')
    )

    consoleSpy.mockRestore()
  })

  it('should not send duplicate state changes', async () => {
    await driver.connect()
    
    const state: AggregateState = {
      state: 'thinking',
      timestamp: Date.now(),
    }

    await driver.setState(state)
    await new Promise((resolve) => setTimeout(resolve, 50))
    
    const callCount1 = mockSocket.send.mock.calls.length

    // Set same state again
    await driver.setState(state)
    await new Promise((resolve) => setTimeout(resolve, 50))
    
    const callCount2 = mockSocket.send.mock.calls.length

    // Should not send more commands
    expect(callCount2).toBe(callCount1)
  })

  it('should space commands ~150ms apart', async () => {
    await driver.connect()
    
    const state: AggregateState = {
      state: 'tool',
      timestamp: Date.now(),
    }

    const startTime = Date.now()
    await driver.setState(state)

    // Wait for all commands to complete
    await new Promise((resolve) => setTimeout(resolve, 600))

    const endTime = Date.now()
    const elapsed = endTime - startTime

    // Should take at least 300ms for 3 commands (turn, brightness, color) with 150ms spacing
    expect(elapsed).toBeGreaterThanOrEqual(300)
  })

  it('should disconnect and clean up', async () => {
    await driver.connect()
    await driver.disconnect()
    
    expect(mockSocket.close).toHaveBeenCalled()
  })

  it('should use custom theme colors when provided', async () => {
    const customDriver = new GoveeDriver({
      ip: '192.168.1.100',
      theme: {
        thinking: { color: '#ff00ff', pattern: 'solid' },
      },
    })

    await customDriver.connect()
    
    const state: AggregateState = {
      state: 'thinking',
      timestamp: Date.now(),
    }

    await customDriver.setState(state)
    await new Promise((resolve) => setTimeout(resolve, 600))

    // Should use custom color #ff00ff (magenta)
    const colorCalls = mockSocket.send.mock.calls.filter((call: any) => 
      call[0].includes('"cmd":"colorwc"')
    )
    expect(colorCalls.length).toBeGreaterThan(0)
    
    const colorCall = colorCalls[0][0]
    const parsed = JSON.parse(colorCall)
    expect(parsed.msg.data.color).toEqual({ r: 255, g: 0, b: 255 })
  })

  it('should fall back to default colors when theme color is missing', async () => {
    const customDriver = new GoveeDriver({
      ip: '192.168.1.100',
      theme: {
        // No color specified for 'needs-you'
      },
    })

    await customDriver.connect()
    
    const state: AggregateState = {
      state: 'needs-you',
      timestamp: Date.now(),
    }

    await customDriver.setState(state)
    await new Promise((resolve) => setTimeout(resolve, 600))

    // Should use default color #ff8800 (orange)
    const colorCalls = mockSocket.send.mock.calls.filter((call: any) => 
      call[0].includes('"cmd":"colorwc"')
    )
    expect(colorCalls.length).toBeGreaterThan(0)
    
    const colorCall = colorCalls[0][0]
    const parsed = JSON.parse(colorCall)
    expect(parsed.msg.data.color).toEqual({ r: 255, g: 136, b: 0 })
  })
})
