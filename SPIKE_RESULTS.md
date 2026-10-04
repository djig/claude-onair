# Phase 0 Spike Results

## Verification Methodology

The following API assumptions were verified against the official Claude Code mods documentation:

- ✅ **Verified by docs**: Explicitly documented in the official reference
- 🟡 **Inferred from docs**: Strongly implied but not directly shown in examples
- ❓ **Unverified**: Requires testing with live Claude Code session or real hardware

## API Verification Results

### 1. Event Availability (All ✅ Verified)

| Event | Status | Notes |
|-------|--------|-------|
| `session.start` / `session.end` | ✅ | Documented in events reference; `e.reason` includes `clear`, `resume`, `logout`, `prompt_input_exit`, `other` |
| `turn.start` / `turn.complete` | ✅ | Documented with `e.turnId`, `e.answer`, `e.durationMs`, `e.usage`, `e.isAborted` |
| `turn.step` (async generator) | ✅ | Documented as async generator; `yield* next(e)` forwards response as it streams |
| `tool.call` | ✅ | Documented; hook can return `next(e)`, `{deny}`, or `{result}` |
| `tool.check` | ✅ | Documented; `await next(e)` resolves to `allow`, `ask`, or `deny` |
| `prompt.submit` | ✅ | Documented with `e.text` |
| `agent.spawn` | ✅ | Documented with `e.isTeammate` |
| `session.measure` | ✅ | Documented; fires after each turn and when plan-limit percent changes |
| `classic.*` (settings hook events) | ✅ | Documented; includes `StopFailure`, `Notification`, etc. |

### 2. Mods API Methods (All ✅ Verified)

| Method | Status | Notes |
|--------|--------|-------|
| `$.session.id()` | ✅ | Documented in session namespace |
| `$.session.usage()` | ✅ | Returns `{startedAt, context: {tokens, window, percent}, rateLimits, cost}` |
| `$.fs.read(path)` | ✅ | Documented; reads files up to 4 MiB |
| `$.http.fetch(url, options)` | ✅ | Documented; resolves to `{status, ok, headers, text}` once body is read |
| `$.process.run(argv)` | ✅ | Documented; no shell, 30s default timeout, 10min max |
| `$.state.get/set` | ✅ | Documented; session-scoped, survives hot reload, auto-redraws |
| `$.clock.every(ms, fn)` | ✅ | Documented; periodic timers |
| `$.command.register` | ✅ | Documented; zero-token commands |
| `$.ui.invalidate('ui.render')` | ✅ | Documented; triggers redraws |
| `$.ui.log(message)` | ✅ | Documented; logs to debug output |
| `$.env.get(name)` | ✅ | Documented; reads environment variables |

### 3. Hook Behavior

| Behavior | Status | Notes |
|----------|--------|-------|
| Hook budget (10s per event, time in `$` calls doesn't count) | ✅ | Documented in limits reference |
| `$.process.run(['sleep', 'N'])` doesn't count against budget | ✅ | Documented: "Time spent inside `next` or any `$` call does not count, except `$.clock.sleep`" |
| Module variables reset on hot reload, `$.state` survives | ✅ | Documented; examples show this pattern |
| Hooks chain like middleware; first installed is outermost | ✅ | Documented in ordering section |

### 4. Critical Unverified Items (❓)

These require live testing with an authenticated Claude Code session:

1. **`turn.step` piece-by-piece streaming**
   - The docs say "`yield* next(e)` forwards the response as it streams"
   - ❓ Whether we can iterate the inner generator by hand to observe each piece without breaking the chain
   - ❓ Field names for pieces other than `{kind:'text', index, text}`
   - Fallback: use complete blocks from `turn.complete` or `session.append`

2. **Un-awaited `$.http.fetch` completion**
   - ❓ Whether an un-awaited fetch started in a hook completes after the hook returns
   - Mitigation: always flush with an awaited fetch at natural boundaries (`step.end`, `tool.call` start, `turn.complete`)

3. **`tool.check` → `ask` observability**
   - ✅ The docs confirm `tool.check` resolves to `ask` when the native prompt is about to show
   - ❓ Whether we can distinguish between `ask` due to a rule vs. `ask` due to no explicit `allow`
   - Note: The design doc's "holding `tool.check`" pattern (path A) is for Stream Deck input, not implemented in v1

4. **`AskUserQuestion` tool call visibility**
   - ✅ The docs show `tool.call` fires for `AskUserQuestion` with `e.questions`
   - ❓ Whether `e.questions[i].question` and `e.questions[i].options` field names are correct
   - Note: Returning `{result: {answers}}` to answer without showing native dialog is documented in test examples

5. **Daemon auto-start reliability**
   - ❓ Whether `$.process.run(['onaird', 'up'])` successfully daemonizes and returns
   - ❓ Whether the spawned daemon survives mod reloads
   - Alternative: document systemd/launchd user service setup

## Test Coverage

### What We Can Test Without Live Session

- ✅ **State reducer logic**: unit tests for event → state mapping and priority aggregation
- ✅ **Driver connection logic**: mock HID devices, mock HTTP servers for WLED/HA/webhook
- ✅ **TypeScript compilation**: `tsc` and `claude plugin validate` (no runtime errors)
- ✅ **Config management**: loading, saving, merging defaults

### What Requires Live Session (`claude plugin test`)

- ❓ **Mod hooks with stubbed `$` methods**: The test kit can stub `$.http.fetch`, `$.session.usage`, etc.
- ❓ **Event batching and flush timing**: Verify events reach daemon within FLUSH_INTERVAL_MS
- ❓ **State transitions**: idle → thinking → tool → needs-you → done → idle
- ❓ **Command handling**: `/onair status` returns correct state

### What Requires Real Hardware

- ❓ **blink(1)**: Plug in device, run `/onair test colors`, verify LED cycles through states
- ❓ **WLED**: Connect ESP32, configure IP, verify strip changes colors
- ❓ **Home Assistant**: Configure light entity, verify it follows states
- ❓ **Permissions (Linux)**: Verify udev rule allows non-root HID access

## Known Limitations (To Be Tested by User)

1. **No live Claude Code session available in this environment**
   - Cannot run `claude --plugin-dir ./packages/mod` with authentication
   - Cannot verify `claude plugin test` actually works with the test kit
   - Cannot confirm the mod loads and hooks fire in a real session

2. **No real hardware available**
   - Cannot test blink(1) USB HID communication
   - Cannot test WLED HTTP commands reach a real device
   - Cannot test Home Assistant integration with actual lights

3. **`claude` CLI not available**
   - Cannot run `claude plugin validate ./packages/mod` to see the real output
   - Cannot verify the plugin manifest and marketplace.json are valid
   - Build passes; validation would be the final check

4. **Pattern timing not validated**
   - The blink(1) breathe/blink patterns send commands but haven't been seen on hardware
   - WLED effect IDs (0=solid, 1=blink, 2=breathe) are from docs but not tested
   - Debounce timing (400ms) is a guess; may need tuning for bulbs with rate limits

## Recommendations for User Testing

### 1. Validate the mod

```bash
cd /workspace/packages/mod
claude plugin validate .
```

Expected output should list:
- `hooks: session.start, turn.start, turn.step, tool.call, tool.check, turn.complete, classic.StopFailure, session.measure, agent.spawn, command.run`
- `calls: $.fs.read, $.http.fetch, $.process.run, $.state.get, $.state.set, $.clock.every, $.command.register`

### 2. Test with live session

```bash
cd /workspace
pnpm build
claude --plugin-dir ./packages/mod
```

Then in the session:
- Type a prompt and watch the lamp
- Verify `/onair status` shows current state
- Check daemon status: `onaird status` (in another terminal)

### 3. Hardware tests

For each driver type:

**blink(1):**
```bash
onaird doctor  # should find the device
onaird config set driver blink1
# Then run a Claude Code session and watch the LED
```

**WLED:**
```bash
onaird config set driver wled
onaird config set wled.ip 192.168.1.100
onaird doctor  # should connect to WLED
```

**Home Assistant:**
```bash
onaird config set driver home-assistant
onaird config set ha.url http://homeassistant.local:8123
onaird config set ha.token YOUR_TOKEN
onaird config set ha.entity light.office_lamp
onaird doctor  # should authenticate
```

### 4. Run mod tests (if test kit works)

```bash
cd /workspace/packages/mod
claude plugin test .
```

This would verify event handling, state transitions, and command responses in isolation.

## Build Verification

- ✅ `pnpm install` succeeds
- ✅ `pnpm typecheck` passes (no TypeScript errors)
- ✅ `pnpm build` produces `dist/` output for all packages
- ✅ Daemon CLI (`onaird`) is executable via `node packages/daemon/dist/cli.js`
- ✅ Mod hooks module compiles to `packages/mod/hooks/register.js`
- ✅ CI workflow defined for Node 20 and 22

## Summary

**High confidence (✅ Verified):**
- All core events and API methods exist as documented
- Hook lifecycle, budget rules, and state survival are confirmed
- TypeScript types compile without errors

**Medium confidence (🟡 Inferred):**
- Token-level streaming via manual iteration of `turn.step`
- Daemon auto-start survives mod reload

**Requires user testing (❓):**
- Real hardware communication (blink(1) HID, WLED HTTP, HA API)
- `claude plugin validate` and `claude plugin test` output
- Live session behavior (event timing, state transitions)
- Un-awaited fetch completion behavior

**Next steps:**
1. User runs `claude plugin validate` to confirm manifest is valid
2. User tests with `claude --plugin-dir` in a real session
3. User tests with at least one hardware driver (recommend blink(1))
4. If issues found, file them as GitHub issues with repro steps
