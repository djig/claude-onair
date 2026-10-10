<div align="center">

# claude-onair

**A desk light that tells you what Claude Code is doing, and blinks amber the moment it needs you.**

[![CI](https://github.com/djig/claude-onair/actions/workflows/ci.yml/badge.svg)](https://github.com/djig/claude-onair/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

</div>

You kick off a long Claude Code task, switch to Slack, and come back 20 minutes later to find it has been waiting on a permission prompt the whole time. **claude-onair** fixes that with a light you can see from across the room:

| Light | Meaning |
|---|---|
| 🔵 slow blue breathe | Claude is thinking |
| 🩵 cyan | running a tool |
| 🟠 **fast amber blink** | **needs you** (permission, question, or input) |
| 🟢 green, then fades | done |
| 🔴 red | error |

- **Exact state, not guesses.** Built as a Claude Code [mod](https://code.claude.com/docs/en/plugins/mods), so it sees `tool.check → ask` and every turn step inside Claude Code, with no polling or transcript scraping.
- **All your sessions, one light.** A small local daemon merges every Claude Code session into one state (needs-you always wins).
- **Bring your own light.** blink(1) (USB), WLED (ESP32), Govee (LAN, no cloud), anything in Home Assistant (Hue, LIFX, Zigbee, Matter), or any webhook. Run several at once.
- **Local only.** Binds to 127.0.0.1 with a per-user token. No cloud, no account.

> **No light?** Use the webhook driver to send state changes to ntfy, Slack, or any service that accepts a POST.

## Hardware

**Recommended for v1:**

| Device | Price | Control | Why |
|--------|-------|---------|-----|
| **[blink(1) mk3](https://buy.thingm.com/blink1)** | $29.95 | USB HID | No network, no pairing. Two RGB LEDs (main state + subagent/quota accent). Works on macOS/Win/Linux. |
| **WLED (ESP32)** | ~$20 | Local HTTP JSON API | DIY, bright, hackable. Store effects as presets and switch with one command. Perfect for desk "ON AIR" signs. |
| **Govee (LAN)** | varies | UDP (no cloud) | Direct LAN control for H6xxx series. Bright, affordable LED strips. Works offline. |
| **Home Assistant** (any light) | varies | REST API | Covers Hue, LIFX, Govee, Zigbee, Matter, and anything else HA integrates. |
| **Webhook** | free | HTTP POST | Send state to ntfy, Slack, Home Assistant, or any webhook endpoint. No hardware needed. |

## Install

### Prerequisites

- **Claude Code v2.1.287+** (mods support)
- **Node.js 20+** or **Bun**
- **pnpm** (`npm install -g pnpm`)

### Quick start

```bash
# 1. Clone and build
git clone https://github.com/djig/claude-onair.git
cd claude-onair
pnpm install
pnpm build

# 2. Install the mod (inside Claude Code)
/plugin marketplace add djig/claude-onair
/plugin install onair@claude-onair

# 3. Make onaird available globally
cd packages/daemon
pnpm link --global

# 4. Start the daemon
onaird up

# 5. Configure your driver
onaird config set driver blink1  # or wled | govee | home-assistant | webhook
onaird doctor
```

After installing, start a Claude Code session and run:

```
/onair status
```

### Update the mod after changes

If you pull updates or edit the mod locally:

```bash
pnpm build
# In a Claude Code session:
/reload-plugins
```

### Setup your hardware

#### blink(1)

**macOS / Windows:** Plug it in. Done.

**Linux:** Add a udev rule so the device is accessible without root:

```bash
# Create rule file
sudo tee /etc/udev/rules.d/51-blink1.rules > /dev/null <<EOF
SUBSYSTEM=="usb", ATTR{idVendor}=="27b8", ATTR{idProduct}=="01ed", MODE="0666"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="27b8", ATTRS{idProduct}=="01ed", MODE="0666"
EOF

# Reload rules
sudo udevadm control --reload-rules
sudo udevadm trigger

# Unplug and replug the blink(1)
```

Run `onaird doctor` to verify:

```bash
onaird doctor
```

#### WLED

1. Flash an ESP32 with WLED (follow [WLED install guide](https://kno.wled.ge/basics/install-binary/))
2. Note its IP address
3. Configure `claude-onair`:

```bash
onaird config set driver wled
onaird config set wled.ip 192.168.1.100
```

Store your color patterns as **presets** in WLED's web UI. The daemon sends `{"ps": <presetNumber>}` to switch states, so you get smooth device-side animations with zero flicker.

#### Govee (LAN Control)

Govee H6xxx series LED strips support direct LAN control via UDP (no cloud required). Tested with H612F.

1. **Enable LAN Control** in the Govee Home app:
   - Open Govee Home app
   - Select your device
   - Go to Settings (gear icon)
   - Enable "LAN Control"

2. **Find your device IP**:
   - Check your router's DHCP client list, or
   - Use the built-in discovery (coming soon)

3. **Configure**:

```bash
onaird config set driver govee
onaird config set govee.ip 192.168.1.50
onaird doctor
```

**macOS Note**: The first time you send UDP to a LAN device, macOS may show a "Local Network" permission prompt. Grant access in **System Settings → Privacy & Security → Local Network** and enable the checkbox for Terminal (or iTerm, etc.).

**Compatible models**: H6xxx series (H6104, H6159, H6163, H6173, H618x, H619x, H612x, etc.). Check Govee's spec sheet for "LAN Control" support.

#### Home Assistant

1. Create a long-lived access token in HA (Settings → Security → Long-lived access tokens)
2. Note your HA URL and the entity ID of your light (e.g., `light.office_lamp`)
3. Configure:

```bash
onaird config set driver home-assistant
onaird config set ha.url http://homeassistant.local:8123
onaird config set ha.token YOUR_TOKEN_HERE
onaird config set ha.entity light.office_lamp
```

#### Webhook

Send state changes to any HTTP endpoint. Perfect for ntfy, Slack webhooks, or custom integrations:

```bash
onaird config set driver webhook
onaird config set webhook.url https://ntfy.sh/your-topic
# Optional: add custom headers
onaird config set webhook.headers.Authorization "Bearer YOUR_TOKEN"
```

The webhook driver POSTs JSON on every state change:

```json
{
  "state": "needs-you",
  "theme": {
    "color": "#ff8800",
    "pattern": "blink",
    "speed": "fast"
  },
  "subagentCount": 0,
  "quotaWarning": false,
  "timestamp": 1728579123456
}
```

## Configuration

Config lives at `~/.config/claude-onair/config.json`. Edit via CLI:

```bash
# View current config
onaird config list

# Set a driver
onaird config set driver blink1  # or wled, home-assistant, webhook

# Theme colors (HSB)
onaird config set theme.thinking.color "#0066ff"
onaird config set theme.thinking.pattern breathe

# Quiet hours (lamp stays dim)
onaird config set quiet-hours.enabled true
onaird config set quiet-hours.start "22:00"
onaird config set quiet-hours.end "08:00"

# How long "done" stays green before fading
onaird config set done-fade-minutes 3
```

### Theme

The default "On Air" theme ships with these states:

```yaml
thinking:
  color: "#0066ff"     # blue
  pattern: breathe
  speed: slow

tool:
  color: "#00cccc"     # cyan
  pattern: solid

needs-you:
  color: "#ff8800"     # amber
  pattern: blink
  speed: fast

done:
  color: "#00cc00"     # green
  pattern: solid
  fade-after-minutes: 3

error:
  color: "#ff0000"     # red
  pattern: solid

idle:
  color: "#000000"     # off
  pattern: off
```

You can define custom themes in `config.json` under `themes: { "my-theme": { ... } }`, then activate with:

```bash
onaird config set active-theme my-theme
```

## CLI Commands

### In a Claude Code session

```
/onair              # Status overview
```

### Shell

```bash
onaird status       # Daemon status, active sessions, current state
onaird config list  # Show full config
onaird config set <key> <value>
onaird doctor       # Check setup (drivers, permissions)
onaird up           # Start daemon (usually automatic)
```

**Note**: `onaird stop` and `onaird logs` are not yet implemented. To stop the daemon, use `pkill onaird` or send SIGTERM to the process.

## Security Model

1. **Loopback only by default**: The daemon binds to `127.0.0.1` and validates the `Host` header to block DNS rebinding.
2. **Host token**: On first run, `onaird` generates a token at `~/.config/claude-onair/token` (mode `0600`). The mod reads it via Claude Code's `$.fs.read`.
3. **No remote access** in v1. The control port (`:47800`) is never exposed. Broadcast (v2) will add a separate viewer port with read-only tokens.

## How It Works

### Architecture

```
Claude Code session(s)              onaird (Node daemon, per user)
┌─────────────────────────┐  POST /v1/ingest (batched)  ┌─────────────────────────┐
│ claude-onair mod        │ ───────────────────────────▶│ Event bus               │
│  hooks: prompt.submit,  │                             │  ├─ StateReducer         │
│  turn.*, tool.call,     │                             │  │   └─ Lamp drivers      │
│  tool.check, session.*  │                             │  │      (blink1, WLED,    │
│                         │                             │  │       HA/webhook)      │
└─────────────────────────┘                             └─────────────────────────┘
                                                          127.0.0.1:47800
```

### Event Mapping

The mod taps these Claude Code events and batches them to the daemon:

| Claude Code Event | Mapped State | Notes |
|-------------------|--------------|-------|
| `turn.start`, `turn.step` in flight | `thinking` | Slow blue breathe |
| `tool.call` before `next` resolves | `tool` | Cyan; counts subagents on LED 2 (blink(1)) |
| `tool.check` → `ask` | `needs-you` | **Amber fast blink** |
| `tool.call` where `e.tool === 'AskUserQuestion'` | `needs-you` | Same as above |
| `turn.complete` (not aborted, no `agentId`) | `done` | Green for N minutes, then fade |
| `turn.complete` with `e.isAborted` | `idle` | Grey flash (device-dependent) |
| `classic.StopFailure` | `error` | Red solid |
| `session.measure` → `rateLimits[].percentUsed ≥ 80` | accent | Amber on LED 2 or dim (quota warning) |

### State Aggregation

The daemon reduces events from all sessions to a single aggregate state. Priority:

```
needs-you > error > tool ≈ thinking > done (fades) > idle > off
```

**Debounce**: Transitions shorter than ~400ms are coalesced to avoid flicker.

### Drivers

Each driver implements:

```typescript
interface LampDriver {
  async connect(): Promise<void>
  async setState(state: AggregateState): Promise<void>
  async disconnect(): Promise<void>
}
```

The daemon loads the configured driver(s) at startup. Multiple drivers can run simultaneously (e.g., blink(1) **and** WLED).

## Development

```bash
# Clone and install
git clone https://github.com/djig/claude-onair.git
cd claude-onair
pnpm install

# Build everything
pnpm build

# Run tests
pnpm test

# Typecheck
pnpm typecheck

# Watch mode for the daemon
pnpm dev:daemon

# Load the mod with hot reload
claude --plugin-dir ./packages/mod
```

### Validate the mod

```bash
cd packages/mod
claude plugin validate .
```

Expected output:

```
> types ./types/index.d.ts declares state: claude-onair.session, claude-onair.lastFlush
> ./hooks/register.ts hooks: session.start, turn.start, turn.step, tool.call, tool.check, turn.complete, classic.StopFailure, session.measure, ui.render{component=AbovePrompt}, command.run{command=onair}
> ./hooks/register.ts calls: $.fs.read, $.http.fetch, $.clock.every, $.process.run, $.ui.invalidate, $.command.register, $.state.get, $.state.set
√ Validation passed
```

### Test the mod

```bash
cd packages/mod
claude plugin test .
```

Tests stub `$.http.fetch` and verify:
- Event batching and flush timing
- State transitions (idle → thinking → tool → done)
- Auto-start of the daemon via `$.process.run`
- Command handling (`/onair status`)

## Testing with Real Hardware

To test with physical hardware:

1. **blink(1)**: Plug in the device, enable its driver in the daemon configuration, and verify with `onaird doctor`.
2. **WLED**: Set up an ESP32 with WLED, configure the driver with the device IP, and verify connectivity.
3. **Govee**: Enable LAN Control in the Govee Home app, configure the driver with the device IP, and test.
4. **Home Assistant**: Configure the driver with the URL, token, and light entity.
5. **Webhook**: Point the webhook driver at an ntfy topic, Slack webhook, or any POST endpoint.
6. **Live session**: Start a coding task in Claude Code and watch the lamp reflect thinking → tool → needs-you → done.

Run `onaird doctor` to check driver connectivity and permissions before testing.

## Roadmap

### v1.1

- **Stream Deck** plugin (output tiles per session + input keys: Approve / Deny / Answer)
- Native **Philips Hue** and **LIFX** drivers
- MQTT publish (`claude/onair/state`) for Home Assistant, Node-RED, ESPHome

### v2.0: Broadcast

- Stream your Claude Code session as **AG-UI 1.0 events** to a web viewer (built with `ag-ui-chat-transport` + AI Elements)
- Viewers see tool cards, subagents, and token usage live
- Viewer suggestions land in a pane where you forward the good ones to Claude with one key
- Mentor mode: a senior watches remotely and answers held questions
- Redaction (summary mode for tool calls, secret scanner, path denylist, pause hotkey)
- Local-only hosting by default, plus documented Cloudflare Tunnel + Access setup

### Later

- Per-repo colors
- Spoken alerts via `$.audio.speak` when a request waits >2 min
- Focus mode (red when Claude needs you during a meeting, via calendar)
- Tiny e-ink or LED-matrix "ON AIR" sign

## Prior Art

- **[Roach/airglow](https://github.com/Roach/airglow)**: Hue MCP server + hooks for agent status colors (Hue only, hook scripts)
- **[yzhao062/vibesignal](https://github.com/yzhao062/vibesignal)**: Physical status light (blink(1)/Luxafor) via settings hooks (coarser states, no live `turn.step`/`tool.check` granularity, no in-TUI approval band)
- **[paultyng/agentsd](https://github.com/paultyng/agentsd)**: Stream Deck plugin with Approve / Always / Deny via HTTP `PermissionRequest` hooks (no lamp or broadcast)

**How claude-onair differs:**
- **Mod-based**: runs in-process for exact state (`turn.step`, `tool.check` → `ask`, `session.measure` usage)
- **Multi-session aggregate** lamp with many drivers through one daemon
- **Designed for Broadcast** (AG-UI streaming to a web viewer), with the lamp as the first subscriber
- Only project mapping Claude Code to **AG-UI 1.0** for live remote viewing

## Troubleshooting

### Mod doesn't load

1. Check Claude Code version: `claude --version` (need 2.1.287+)
2. Verify mod is installed: `claude plugin list`
3. Check the debug log: `claude --debug` and look for "claude-onair"
4. Ensure it's enabled: `/plugin` in a session should list it

### Lamp doesn't light up

1. Check daemon status: `onaird status` (should show "running")
2. Run diagnostics: `onaird doctor`
3. Start a coding task in Claude Code and check whether the lamp follows the session states.
4. Check the daemon's terminal output for driver connection errors. If the daemon is not running, start it in a terminal with `onaird up` to see its output.

**blink(1) specific:**
- Linux: confirm the udev rule is active (`ls -l /dev/hidraw*` should show mode 0666)
- macOS: System Settings → Privacy & Security → Input Monitoring (if using the HID library)

**WLED specific:**
- Ping the IP: `ping 192.168.1.100`
- Open WLED's web UI in a browser: `http://192.168.1.100`
- Check the JSON API manually: `curl http://192.168.1.100/json/state`

**Govee specific:**
- Ensure "LAN Control" is enabled in the Govee Home app (device Settings)
- **macOS**: Grant Local Network permission: System Settings → Privacy & Security → Local Network → enable Terminal (or your terminal app). This is required for Node to send UDP packets to LAN devices.
- Verify the IP: `ping 192.168.1.50`
- Check for EHOSTUNREACH errors in daemon logs (indicates missing Local Network permission)

**Home Assistant specific:**
- Test the token: `curl -H "Authorization: Bearer YOUR_TOKEN" http://homeassistant.local:8123/api/`
- Check the entity ID in HA Developer Tools → States

**Webhook specific:**
- Test the endpoint manually: `curl -X POST -H "Content-Type: application/json" -d '{"state":"test"}' YOUR_WEBHOOK_URL`
- Check for CORS or authentication errors in daemon logs

### Daemon won't start

1. Check if it's already running: `ps aux | grep onaird`
2. Check port availability: `lsof -i :47800` (should be free or owned by `onaird`)
3. Try manual start: `onaird up --verbose`
4. Check for permission issues: `ls -la ~/.config/claude-onair/` (token file should be mode 0600)

### onaird command not found

If `onaird` is not found after installing:

```bash
# Link the daemon globally
cd packages/daemon
pnpm link --global

# Or use npx
npx @claude-onair/daemon up
```

### Lamp flickers or changes too fast

The daemon debounces state changes (400ms default). If flicker persists:

```bash
onaird config set debounce-ms 800
```

For devices with rate limits (Hue bridge ~10 cmds/s), the driver only sends commands on state changes, not every event.

## Contributing

Contributions welcome! Please open an issue first to discuss your idea.

### Adding a Driver

1. Create a new file in `packages/drivers/src/` (e.g., `lifx.ts`)
2. Implement the `LampDriver` interface
3. Export it from `packages/drivers/src/index.ts`
4. Add config schema to `packages/daemon/src/config.ts`
5. Register it in `packages/daemon/src/lamp/manager.ts`
6. Add tests in `packages/drivers/src/__tests__/`
7. Update this README with setup instructions

## License

MIT © 2026 Jignesh Dhamecha

## Acknowledgments

- Built on [Claude Code mods](https://code.claude.com/docs/en/plugins/mods) (v2.1.287+)
- blink(1) by ThingM
- WLED by Aircoookie
- Home Assistant community

---

More Claude Code tools by [@djig](https://github.com/djig): [ui-loop](https://github.com/djig/ui-loop) (token-budgeted visual feedback MCP) · [drift-guard](https://github.com/djig/drift-guard) (blocks stale React/Next/Tailwind patterns) · [route-impact](https://github.com/djig/route-impact) (which Next.js routes a diff affects)

**Status**: v1 Lamp milestone. Broadcast feature (v2) coming soon.

**Feedback**: Open an issue
