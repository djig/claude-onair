/**
 * State reducer tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { StateReducer } from '../state-reducer.js'
import type { BusEvent } from '../types.js'

describe('StateReducer', () => {
  let reducer: StateReducer

  beforeEach(() => {
    reducer = new StateReducer(3) // 3 minute done fade
    vi.useFakeTimers()
  })

  it('should start with off state when no sessions', () => {
    const state = reducer.getLastAggregate()
    expect(state).toBeNull()
  })

  it('should transition to idle on session.start', () => {
    const event: BusEvent = {
      v: 1,
      session: 'test-session',
      seq: 1,
      ts: Date.now(),
      t: 'session.start',
      data: {},
    }

    const state = reducer.reduce(event)
    expect(state.state).toBe('idle')
  })

  it('should transition to thinking on turn.start', () => {
    reducer.reduce({
      v: 1,
      session: 'test-session',
      seq: 1,
      ts: Date.now(),
      t: 'session.start',
      data: {},
    })

    const state = reducer.reduce({
      v: 1,
      session: 'test-session',
      seq: 2,
      ts: Date.now(),
      t: 'turn.start',
      data: {},
    })

    expect(state.state).toBe('thinking')
  })

  it('should transition to tool on tool.start', () => {
    reducer.reduce({
      v: 1,
      session: 'test-session',
      seq: 1,
      ts: Date.now(),
      t: 'session.start',
      data: {},
    })

    const state = reducer.reduce({
      v: 1,
      session: 'test-session',
      seq: 2,
      ts: Date.now(),
      t: 'tool.start',
      data: { tool: 'Bash' },
    })

    expect(state.state).toBe('tool')
  })

  it('should prioritize needs-you over other states', () => {
    reducer.reduce({
      v: 1,
      session: 'session1',
      seq: 1,
      ts: Date.now(),
      t: 'session.start',
      data: {},
    })

    reducer.reduce({
      v: 1,
      session: 'session1',
      seq: 2,
      ts: Date.now(),
      t: 'tool.start',
      data: {},
    })

    reducer.reduce({
      v: 1,
      session: 'session2',
      seq: 1,
      ts: Date.now(),
      t: 'session.start',
      data: {},
    })

    const state = reducer.reduce({
      v: 1,
      session: 'session2',
      seq: 2,
      ts: Date.now(),
      t: 'needs.permission',
      data: {},
    })

    expect(state.state).toBe('needs-you')
  })

  it('should prioritize error over tool and thinking', () => {
    reducer.reduce({
      v: 1,
      session: 'session1',
      seq: 1,
      ts: Date.now(),
      t: 'session.start',
      data: {},
    })

    reducer.reduce({
      v: 1,
      session: 'session1',
      seq: 2,
      ts: Date.now(),
      t: 'tool.start',
      data: {},
    })

    const state = reducer.reduce({
      v: 1,
      session: 'session1',
      seq: 3,
      ts: Date.now(),
      t: 'error',
      data: {},
    })

    expect(state.state).toBe('error')
  })

  it('should aggregate subagent count across sessions', () => {
    reducer.reduce({
      v: 1,
      session: 'session1',
      seq: 1,
      ts: Date.now(),
      t: 'session.start',
      data: {},
    })

    reducer.reduce({
      v: 1,
      session: 'session1',
      seq: 2,
      ts: Date.now(),
      t: 'subagent',
      data: { delta: 2 },
    })

    reducer.reduce({
      v: 1,
      session: 'session2',
      seq: 1,
      ts: Date.now(),
      t: 'session.start',
      data: {},
    })

    const state = reducer.reduce({
      v: 1,
      session: 'session2',
      seq: 2,
      ts: Date.now(),
      t: 'subagent',
      data: { delta: 1 },
    })

    expect(state.subagentCount).toBe(3)
  })

  it('should set quota warning flag when any session has high usage', () => {
    reducer.reduce({
      v: 1,
      session: 'session1',
      seq: 1,
      ts: Date.now(),
      t: 'session.start',
      data: {},
    })

    const state = reducer.reduce({
      v: 1,
      session: 'session1',
      seq: 2,
      ts: Date.now(),
      t: 'usage',
      data: { percentUsed: 85 },
    })

    expect(state.quotaWarning).toBe(true)
  })

  it('should fade done to idle after timeout', () => {
    reducer.reduce({
      v: 1,
      session: 'test-session',
      seq: 1,
      ts: Date.now(),
      t: 'session.start',
      data: {},
    })

    reducer.reduce({
      v: 1,
      session: 'test-session',
      seq: 2,
      ts: Date.now(),
      t: 'turn.end',
      data: { isAborted: false },
    })

    const beforeFade = reducer.getLastAggregate()
    expect(beforeFade?.state).toBe('done')

    // Fast-forward 3 minutes
    vi.advanceTimersByTime(3 * 60 * 1000)

    // Trigger a new event to see the updated state
    const afterFade = reducer.reduce({
      v: 1,
      session: 'test-session',
      seq: 3,
      ts: Date.now(),
      t: 'session.start',
      data: {},
    })

    expect(afterFade.state).toBe('idle')
  })

  it('should ignore events from subagents for main state', () => {
    reducer.reduce({
      v: 1,
      session: 'test-session',
      seq: 1,
      ts: Date.now(),
      t: 'session.start',
      data: {},
    })

    reducer.reduce({
      v: 1,
      session: 'test-session',
      seq: 2,
      ts: Date.now(),
      t: 'tool.start',
      data: {},
    })

    // Subagent event should not change main state
    const state = reducer.reduce({
      v: 1,
      session: 'test-session',
      agentId: 'subagent-123',
      seq: 3,
      ts: Date.now(),
      t: 'turn.start',
      data: {},
    })

    expect(state.state).toBe('tool') // Still tool, not thinking
  })

  it('should return off when all sessions end', () => {
    reducer.reduce({
      v: 1,
      session: 'test-session',
      seq: 1,
      ts: Date.now(),
      t: 'session.start',
      data: {},
    })

    const state = reducer.reduce({
      v: 1,
      session: 'test-session',
      seq: 2,
      ts: Date.now(),
      t: 'session.end',
      data: {},
    })

    expect(state.state).toBe('off')
  })
})
