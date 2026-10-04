/**
 * Configuration management
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { DaemonConfig, ThemeConfig } from './types.js'

const CONFIG_DIR = join(homedir(), '.config', 'claude-onair')
const CONFIG_PATH = join(CONFIG_DIR, 'config.json')
const TOKEN_PATH = join(CONFIG_DIR, 'token')

const DEFAULT_THEME: ThemeConfig = {
  name: 'On Air',
  states: {
    'idle': {
      color: '#000000',
      pattern: 'off',
    },
    'thinking': {
      color: '#0066ff',
      pattern: 'breathe',
      speed: 'slow',
    },
    'tool': {
      color: '#00cccc',
      pattern: 'solid',
    },
    'needs-you': {
      color: '#ff8800',
      pattern: 'blink',
      speed: 'fast',
    },
    'done': {
      color: '#00cc00',
      pattern: 'solid',
    },
    'error': {
      color: '#ff0000',
      pattern: 'solid',
    },
    'off': {
      color: '#000000',
      pattern: 'off',
    },
  },
}

const DEFAULT_CONFIG: DaemonConfig = {
  host: '127.0.0.1',
  port: 47800,
  tokenPath: TOKEN_PATH,
  theme: DEFAULT_THEME,
  drivers: [
    {
      type: 'blink1',
      enabled: true,
      config: {},
    },
  ],
  debounceMs: 400,
  doneFadeMinutes: 3,
}

export async function ensureConfigDir(): Promise<void> {
  if (!existsSync(CONFIG_DIR)) {
    await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 })
  }
}

export async function loadConfig(): Promise<DaemonConfig> {
  await ensureConfigDir()

  if (!existsSync(CONFIG_PATH)) {
    await saveConfig(DEFAULT_CONFIG)
    return DEFAULT_CONFIG
  }

  try {
    const content = await readFile(CONFIG_PATH, 'utf-8')
    const loaded = JSON.parse(content) as Partial<DaemonConfig>
    
    // Merge with defaults
    return {
      ...DEFAULT_CONFIG,
      ...loaded,
      theme: loaded.theme || DEFAULT_THEME,
      drivers: loaded.drivers || DEFAULT_CONFIG.drivers,
    }
  } catch (err: any) {
    console.error('[config] Failed to load config, using defaults:', err.message)
    return DEFAULT_CONFIG
  }
}

export async function saveConfig(config: DaemonConfig): Promise<void> {
  await ensureConfigDir()
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 })
}

export async function setConfigValue(key: string, value: unknown): Promise<void> {
  const config = await loadConfig()
  
  // Support dot notation: e.g., "wled.ip" -> config.drivers[wled].config.ip
  const parts = key.split('.')
  
  if (parts[0] === 'driver' && parts.length === 2) {
    // Set active driver: "driver" = "wled"
    // Disable all other drivers and enable only the selected one
    const driverType = value as string
    
    // Find existing driver or create new one
    let driver = config.drivers.find(d => d.type === driverType)
    if (!driver) {
      driver = { type: driverType as any, enabled: true, config: {} }
      config.drivers.push(driver)
    } else {
      driver.enabled = true
    }
    
    // Disable all other drivers
    config.drivers.forEach(d => {
      if (d.type !== driverType) {
        d.enabled = false
      }
    })
  } else if (parts.length >= 2 && ['blink1', 'wled', 'home-assistant', 'govee', 'webhook', 'ha'].includes(parts[0])) {
    // Driver-specific config
    const driverType = parts[0] === 'ha' ? 'home-assistant' : parts[0]
    const configKey = parts.slice(1).join('.')
    
    let driver = config.drivers.find(d => d.type === driverType)
    if (!driver) {
      driver = { type: driverType as any, enabled: true, config: {} }
      config.drivers.push(driver)
    }
    
    setNestedValue(driver.config, configKey, value)
  } else {
    // Top-level config
    setNestedValue(config as any, key, value)
  }

  await saveConfig(config)
}

function setNestedValue(obj: any, path: string, value: unknown): void {
  const parts = path.split('.')
  let current = obj
  
  for (let i = 0; i < parts.length - 1; i++) {
    if (!(parts[i] in current)) {
      current[parts[i]] = {}
    }
    current = current[parts[i]]
  }
  
  current[parts[parts.length - 1]] = value
}

export { CONFIG_DIR, CONFIG_PATH, TOKEN_PATH, DEFAULT_THEME }
