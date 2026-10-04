# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-10-04

### Added

- Initial release: v1 Lamp milestone
- Claude Code mod (plugin name: `onair`) that streams session events to local daemon
- Event hooks: session.*, turn.*, tool.call/check, agent.spawn, classic.StopFailure, session.measure
- Event batching (100ms flush, up to 50 events per batch)
- Auto-start daemon via `$.process.run(['onaird', 'up'])`
- Zero-token `/onair` command for status
- Local HTTP daemon (`onaird`) on 127.0.0.1:47800
- State aggregation across multiple sessions (priority: needs-you > error > tool > thinking > done > idle)
- Done state fades to idle after 3 minutes (configurable)
- Debounce (400ms) to avoid flicker
- Security: loopback-only binding, host token (0600), DNS rebinding protection
- 4 hardware drivers:
  - **blink(1)**: USB HID (node-hid + blink1-tool CLI fallback)
  - **WLED**: HTTP JSON API for ESP32/ESP8266 devices
  - **Home Assistant**: REST API (covers Hue, LIFX, Govee, Zigbee, Matter)
  - **Webhook**: Generic HTTP POST endpoint
- CLI commands: `onaird up/stop/status/config/doctor`
- Default "On Air" theme with 7 states
- Config management (YAML/JSON at ~/.config/claude-onair/config.json)
- Test suite: 19 tests (state reducer, HTTP server security)
- GitHub Actions CI (Node 20 & 22)
- MIT license

### Validated

- Plugin structure passes `claude plugin validate`
- All hooks and API calls verified
- TypeScript compiles cleanly (0 errors)
- Test suite: 19/19 pass

### Known Limitations

- Broadcast feature not included (planned for v2)
- Some CLI commands incomplete (onaird stop/logs/test)
- Requires live session testing with real hardware
- Daemon lifecycle: no systemd/launchd service file

## [Unreleased]

### Planned for v1.1

- Stream Deck plugin (output tiles + input keys)
- Native Philips Hue driver
- Native LIFX driver
- Native Govee driver
- MQTT publish support
- Spoken alerts via `$.audio.speak`
- Per-repo colors

### Planned for v2.0 (Broadcast)

- AG-UI 1.0 event streaming to web viewer
- Built with `ag-ui-chat-transport` + AI Elements
- Redaction (summary mode, secret scanner, path denylist)
- Viewer suggestions with host approval
- Mentor mode (remote answers via Channels MCP)
- Local-only hosting with Cloudflare Tunnel + Access docs

[0.1.0]: https://github.com/djig/claude-onair/releases/tag/v0.1.0
