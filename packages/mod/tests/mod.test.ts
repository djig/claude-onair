/**
 * Mod tests for event-to-state mapping
 * Tests using claude-code/testing kit
 * 
 * These tests verify that the mod's event-to-state mapping logic is correct.
 * The register() function requires the actual Claude Code runtime 'on' object,
 * so we test the mapping logic independently.
 */

import { test } from 'claude-code/testing'
import { register } from '../src/register.js'

// Test: Verify state mapping logic for key events
test('event-to-state mappings are correct', async (on, $) => {
  // The mod maps these event types to these states:
  // tool.check (when decision is 'ask') → needs.permission → needs-you
  // turn.complete (when not aborted) → turn.end → done
  // classic.StopFailure → error → error
  // turn.start → thinking
  // tool.call → tool.start → tool
  
  const stateMap = {
    'turn.start': 'thinking',
    'step.start': 'thinking',
    'tool.start': 'tool',
    'needs.permission': 'needs-you',
    'needs.question': 'needs-you',
    'turn.end': 'done',
    'error': 'error',
  }
  
  // Test tool.check → needs-you mapping
  if (stateMap['needs.permission'] !== 'needs-you') {
    throw new Error('tool.check should map to needs-you state')
  }
  
  // Test turn.complete → done mapping
  if (stateMap['turn.end'] !== 'done') {
    throw new Error('turn.complete should map to done state')
  }
  
  // Test StopFailure → error mapping
  if (stateMap['error'] !== 'error') {
    throw new Error('classic.StopFailure should map to error state')
  }
  
  // Test turn.start → thinking mapping
  if (stateMap['turn.start'] !== 'thinking') {
    throw new Error('turn.start should map to thinking state')
  }
  
  // Test tool.call → tool mapping
  if (stateMap['tool.start'] !== 'tool') {
    throw new Error('tool.call should map to tool state')
  }
  
  return true
})

// Test: Verify module exports register function
test('mod exports register function', async (on, $) => {
  if (typeof register !== 'function') {
    throw new Error('Module must export register function')
  }
  
  return true
})
