/**
 * Type definitions for Claude Code mod runtime $ API
 * Based on Claude Code v2.1.287+ mod runtime behavior
 */

export interface ClaudeModRuntime {
  // Environment variables - returns Promise
  env: {
    get(key: string): Promise<string | undefined>
  }
  
  // Session information - returns Promise
  session: {
    id(): Promise<string>
    usage(): Promise<{
      rateLimits?: Array<{
        percentUsed?: number
      }>
    }>
  }
  
  // File system - may return string or object with text field
  fs: {
    read(path: string): Promise<string | { text?: string; content?: string; value?: string }>
  }
  
  // HTTP - standard fetch
  http: {
    fetch(url: string, options?: RequestInit): Promise<Response>
  }
  
  // State management
  state: {
    get<T = any>(key: { plugin: string; key: string }): Promise<{ value: T | null }>
    set<T = any>(key: { plugin: string; key: string }, value: T): Promise<void>
  }
  
  // Clock/timers
  clock: {
    every(ms: number, callback: () => void | Promise<void>): void
  }
  
  // Process execution
  process: {
    run(args: string[]): Promise<void>
  }
  
  // Command registration
  command: {
    register(config: { name: string; description: string }): Promise<void>
  }
  
  // UI logging
  ui: {
    log(message: string): void
  }
}
