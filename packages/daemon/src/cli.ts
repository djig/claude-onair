#!/usr/bin/env node

/**
 * CLI for onaird
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { loadConfig, setConfigValue, CONFIG_PATH, TOKEN_PATH } from './config.js'
import { Daemon } from './daemon.js'

const command = process.argv[2]
const args = process.argv.slice(3)

async function main() {
  switch (command) {
    case 'up':
    case 'start':
      await startDaemon()
      break

    case 'stop':
      await stopDaemon()
      break

    case 'status':
      await showStatus()
      break

    case 'config':
      await handleConfig(args)
      break

    case 'doctor':
      await runDoctor()
      break

    case 'logs':
      console.log('Logs not implemented yet (daemon runs in foreground for now)')
      break

    case 'test':
      console.log('Test mode not implemented yet')
      break

    default:
      showHelp()
      process.exit(1)
  }
}

async function startDaemon() {
  const daemon = new Daemon()
  await daemon.start({ idleExitMinutes: 30 })
}

async function stopDaemon() {
  console.log('Stop not implemented (send SIGTERM to the daemon process)')
  process.exit(1)
}

async function showStatus() {
  const config = await loadConfig()
  
  if (!existsSync(TOKEN_PATH)) {
    console.log('Status: not running (no token file)')
    return
  }

  const token = (await readFile(TOKEN_PATH, 'utf-8')).trim()

  try {
    const response = await fetch(`http://${config.host}:${config.port}/v1/status`, {
      headers: { 'Authorization': `Bearer ${token}` },
      signal: AbortSignal.timeout(3000),
    })

    if (!response.ok) {
      console.log(`Status: error (daemon returned ${response.status})`)
      return
    }

    const data = await response.json() as any
    console.log('Status: running')
    console.log(`Active sessions: ${data.sessions.filter((s: any) => s.isActive).length}`)
    console.log(`Current state: ${data.aggregate?.state || 'off'}`)
    console.log('')
    console.log('Sessions:')
    for (const session of data.sessions) {
      console.log(`  - ${session.sessionId.slice(0, 8)}: ${session.state} ${session.isActive ? '(active)' : '(inactive)'}`)
    }
  } catch (err: any) {
    console.log('Status: not running')
  }
}

async function handleConfig(args: string[]) {
  const subcommand = args[0]

  if (subcommand === 'list') {
    const config = await loadConfig()
    console.log('Configuration:')
    console.log(JSON.stringify(config, null, 2))
  } else if (subcommand === 'set' && args.length >= 3) {
    const key = args[1]
    const value = parseValue(args[2])
    await setConfigValue(key, value)
    console.log(`Set ${key} = ${JSON.stringify(value)}`)
  } else {
    console.log('Usage: onaird config list')
    console.log('       onaird config set <key> <value>')
    process.exit(1)
  }
}

async function runDoctor() {
  console.log('Running diagnostics...')
  console.log('')

  const config = await loadConfig()

  // Check config file
  console.log(`✓ Config file: ${CONFIG_PATH}`)

  // Check token
  if (existsSync(TOKEN_PATH)) {
    console.log(`✓ Token file: ${TOKEN_PATH}`)
  } else {
    console.log(`✗ Token file missing: ${TOKEN_PATH}`)
  }

  // Check drivers
  console.log('')
  console.log('Drivers:')
  for (const driver of config.drivers) {
    if (!driver.enabled) {
      console.log(`  - ${driver.type}: disabled`)
      continue
    }

    switch (driver.type) {
      case 'blink1':
        await checkBlink1(driver.config)
        break
      case 'wled':
        await checkWLED(driver.config)
        break
      case 'home-assistant':
        await checkHomeAssistant(driver.config)
        break
      case 'govee':
        await checkGovee(driver.config)
        break
      case 'webhook':
        await checkWebhook(driver.config)
        break
    }
  }

  console.log('')
  console.log('Doctor check complete.')
}

async function checkBlink1(config: Record<string, unknown>) {
  try {
    const HID = await import('node-hid')
    const blink1Devices = HID.devices(0x27b8, 0x01ed)
    
    if (blink1Devices.length > 0) {
      console.log(`  ✓ blink(1): found ${blink1Devices.length} device(s)`)
    } else {
      console.log(`  ✗ blink(1): no devices found`)
      console.log(`    On Linux, check udev rules (see README)`)
    }
  } catch (err: any) {
    console.log(`  ✗ blink(1): node-hid failed (${err.message})`)
    console.log(`    Trying blink1-tool...`)
    
    try {
      await new Promise((resolve, reject) => {
        const proc = spawn('blink1-tool', ['--version'])
        proc.on('close', (code) => code === 0 ? resolve(null) : reject(new Error(`Exit code ${code}`)))
        proc.on('error', reject)
      })
      console.log(`  ✓ blink(1): blink1-tool found (CLI fallback available)`)
    } catch {
      console.log(`  ✗ blink(1): blink1-tool not found`)
      console.log(`    Install from https://blink1.thingm.com/blink1-tool/`)
    }
  }
}

async function checkWLED(config: Record<string, unknown>) {
  const ip = config.ip as string
  if (!ip) {
    console.log(`  ✗ WLED: no IP configured`)
    return
  }

  try {
    const response = await fetch(`http://${ip}/json/info`, {
      signal: AbortSignal.timeout(3000),
    })
    
    if (response.ok) {
      const info = await response.json() as any
      console.log(`  ✓ WLED: connected to ${info.name || 'device'} at ${ip}`)
    } else {
      console.log(`  ✗ WLED: ${ip} returned ${response.status}`)
    }
  } catch (err: any) {
    console.log(`  ✗ WLED: cannot reach ${ip} (${err.message})`)
  }
}

async function checkHomeAssistant(config: Record<string, unknown>) {
  const url = config.url as string
  const token = config.token as string

  if (!url || !token) {
    console.log(`  ✗ Home Assistant: missing url or token`)
    return
  }

  try {
    const response = await fetch(`${url}/api/`, {
      headers: { 'Authorization': `Bearer ${token}` },
      signal: AbortSignal.timeout(3000),
    })

    if (response.ok) {
      console.log(`  ✓ Home Assistant: connected to ${url}`)
    } else {
      console.log(`  ✗ Home Assistant: ${url} returned ${response.status}`)
    }
  } catch (err: any) {
    console.log(`  ✗ Home Assistant: cannot reach ${url} (${err.message})`)
  }
}

async function checkGovee(config: Record<string, unknown>) {
  const ip = config.ip as string
  if (!ip) {
    console.log(`  ✗ Govee: no IP configured`)
    console.log(`    Run: onaird config set govee.ip <device-ip>`)
    console.log(`    Or use discovery to find devices on your network`)
    return
  }

  console.log(`  ✓ Govee: configured for ${ip}`)
  console.log(`    Note: Requires "LAN Control" enabled in Govee Home app`)
  console.log(`    Note: On macOS, allow Local Network access in System Settings > Privacy & Security`)
}

async function checkWebhook(config: Record<string, unknown>) {
  const url = config.url as string
  if (!url) {
    console.log(`  ✗ Webhook: no URL configured`)
    return
  }

  console.log(`  ✓ Webhook: configured (${url})`)
}

function parseValue(str: string): unknown {
  if (str === 'true') return true
  if (str === 'false') return false
  if (str === 'null') return null
  if (/^-?\d+$/.test(str)) return parseInt(str, 10)
  if (/^-?\d+\.\d+$/.test(str)) return parseFloat(str)
  return str
}

function showHelp() {
  console.log('onaird - claude-onair daemon')
  console.log('')
  console.log('Usage: onaird <command> [options]')
  console.log('')
  console.log('Commands:')
  console.log('  up, start       Start the daemon')
  console.log('  stop            Stop the daemon')
  console.log('  status          Show daemon and session status')
  console.log('  config list     Show current configuration')
  console.log('  config set <key> <value>  Set a config value')
  console.log('  doctor          Run diagnostics (check drivers, permissions)')
  console.log('  logs            Tail daemon logs (not implemented)')
  console.log('  test            Send test states to hardware (not implemented)')
  console.log('')
  console.log('Examples:')
  console.log('  onaird up')
  console.log('  onaird status')
  console.log('  onaird config set driver wled')
  console.log('  onaird config set wled.ip 192.168.1.100')
  console.log('  onaird config set driver govee')
  console.log('  onaird config set govee.ip 192.168.1.50')
  console.log('  onaird doctor')
}

main().catch((err) => {
  console.error('Error:', err.message)
  process.exit(1)
})
