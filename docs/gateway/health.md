---
summary: "Health check steps for channel connectivity"
read_when:
  - Diagnosing WhatsApp channel health
title: "Health Checks"
---

# Health Checks (CLI)

Short guide to verify channel connectivity without guessing.

## Quick checks

- `openbot status` — local summary: gateway reachability/mode, update hint, linked channel auth age, sessions + recent activity.
- `openbot status --all` — full local diagnosis (read-only, color, safe to paste for debugging).
- `openbot status --deep` — also probes the running Gateway (per-channel probes when supported).
- `openbot health --json` — asks the running Gateway for a full health snapshot (WS-only; no direct Baileys socket).
- Send `/status` as a standalone message in WhatsApp/WebChat to get a status reply without invoking the agent.
- Logs: tail `/tmp/gmood2008/openbot-*.log` and filter for `web-heartbeat`, `web-reconnect`, `web-auto-reply`, `web-inbound`.

## Deep diagnostics

- Creds on disk: `ls -l ~/.openbot/credentials/whatsapp/<accountId>/creds.json` (mtime should be recent).
- Session store: `ls -l ~/.openbot/agents/<agentId>/sessions/sessions.json` (path can be overridden in config). Count and recent recipients are surfaced via `status`.
- Relink flow: `openbot channels logout && openbot channels login --verbose` when status codes 409–515 or `loggedOut` appear in logs. (Note: the QR login flow auto-restarts once for status 515 after pairing.)

## Live versus ready

`/health` and `/healthz` are liveness. They stay successful when the gateway process is up, including when one channel is down.

`/ready` and `/readyz` may still return 503 after startup grace when a required managed channel is disconnected. That probe includes channels on purpose. A channel failure is not a gateway process failure. The Control UI gateway banner follows the WebSocket connection phase. The channel card shows the channel fault.

## When something fails

- `logged out` or status 409–515 → relink with `openbot channels logout` then `openbot channels login`.
- Gateway unreachable → start it: `openbot gateway --port 18789` (use `--force` if the port is busy).
- No inbound messages → confirm linked phone is online and the sender is allowed (`channels.whatsapp.allowFrom`); for group chats, ensure allowlist + mention rules match (`channels.whatsapp.groups`, `agents.list[].groupChat.mentionPatterns`).

## Dedicated "health" command

`openbot health --json` asks the running Gateway for its health snapshot (no direct channel sockets from the CLI). It reports linked creds/auth age when available, per-channel probe summaries, session-store summary, and a probe duration. It exits non-zero if the Gateway is unreachable or the probe fails/timeouts. Use `--timeout <ms>` to override the 10s default.
