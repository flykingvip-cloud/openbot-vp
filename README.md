# 🐲 OpenBot — Enterprise Agent OS

<p align="center">
    <picture>
        <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/gmood2008/openbot/main/docs/assets/openbot-logo-text-dark.png">
        <img src="https://raw.githubusercontent.com/gmood2008/openbot/main/docs/assets/openbot-logo-text.png" alt="OpenBot" width="500">
    </picture>
</p>

<p align="center">
  <a href="https://github.com/gmood2008/openbot/actions/workflows/ci.yml?branch=main"><img src="https://img.shields.io/github/actions/workflow/status/gmood2008/openbot/ci.yml?branch=main&style=for-the-badge" alt="CI status"></a>
  <a href="https://github.com/gmood2008/openbot/releases"><img src="https://img.shields.io/github/v/release/gmood2008/openbot?include_prereleases&style=for-the-badge" alt="GitHub release"></a>
  <a href="https://discord.gg/clawd"><img src="https://img.shields.io/discord/1456350064065904867?label=Discord&logo=discord&logoColor=white&color=5865F2&style=for-the-badge" alt="Discord"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="MIT License"></a>
</p>

**OpenBot** (`@upbeyond/openbot`) is an **enterprise Agent OS for digital employees**.
The product is not a personal 20-channel inbox. You manage digital employees in the
employee and enterprise consoles: lifecycle, collaboration, knowledge, skills, and
governance. The Gateway is the control plane those consoles talk to.

Primary workplace IM is **WeCom, Feishu, and DingTalk** (Enterprise console → Message
channels, long-connection first). In-product chat is **WebChat / Control UI**.

[Docs](docs/index.md) · [Vision](VISION.md) · [DeepWiki](https://deepwiki.com/gmood2008/openbot) · [Getting Started](docs/start/getting-started.md) · [Updating](docs/install/updating.md) · [Showcase](docs/start/showcase.md) · [FAQ](docs/help/faq.md) · [Wizard](docs/start/wizard.md) · [Nix](https://github.com/openbot/nix-openbot) · [Docker](docs/install/docker.md) · [Discord](https://discord.gg/clawd)

Preferred setup: run the onboarding wizard (`openbot onboard`) in your terminal.
The wizard guides you step by step through setting up the gateway, workspace, channels, and skills. The CLI wizard is the recommended path and works on **macOS, Linux, and Windows (via WSL2; strongly recommended)**.
Works with npm, pnpm, or bun.
New install? Start here: [Getting started](docs/start/getting-started.md)

## Sponsors

| OpenAI                                                            | Vercel                                                            | Blacksmith                                                                   | Convex                                                                |
| ----------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| [![OpenAI](docs/assets/sponsors/openai.svg)](https://openai.com/) | [![Vercel](docs/assets/sponsors/vercel.svg)](https://vercel.com/) | [![Blacksmith](docs/assets/sponsors/blacksmith.svg)](https://blacksmith.sh/) | [![Convex](docs/assets/sponsors/convex.svg)](https://www.convex.dev/) |

**Subscriptions (OAuth):**

- **[OpenAI](https://openai.com/)** (ChatGPT/Codex)

Model note: while many providers/models are supported, for the best experience and lower prompt-injection risk use the strongest latest-generation model available to you. See [Onboarding](docs/start/onboarding.md).

## Models (selection + auth)

- Models config + CLI: [Models](docs/concepts/models.md)
- Auth profile rotation (OAuth vs API keys) + fallbacks: [Model failover](docs/concepts/model-failover.md)

## Install (recommended)

Runtime: **Node ≥22**.

```bash
npm install -g @upbeyond/openbot@latest
# or: pnpm add -g @upbeyond/openbot@latest

openbot onboard --install-daemon
```

The wizard installs the Gateway daemon (launchd/systemd user service) so it stays running.

## Quick start (TL;DR)

Runtime: **Node ≥22**.

Full beginner guide (auth, pairing, channels): [Getting started](docs/start/getting-started.md)

```bash
openbot onboard --install-daemon

openbot gateway --port 18789 --verbose

# Send a message
openbot message send --to +1234567890 --message "Hello from OpenBot"

# Talk to a digital employee (deliver via WebChat or a connected workplace channel)
openbot agent --message "Ship checklist" --thinking high
```

Upgrading? [Updating guide](docs/install/updating.md) (and run `openbot doctor`).

## Development channels

- **stable**: tagged releases (`vYYYY.M.D` or `vYYYY.M.D-<patch>`), npm dist-tag `latest`.
- **beta**: prerelease tags (`vYYYY.M.D-beta.N`), npm dist-tag `beta` (macOS app may be missing).
- **dev**: moving head of `main`, npm dist-tag `dev` (when published).

Switch channels (git + npm): `openbot update --channel stable|beta|dev`.
Details: [Development channels](docs/install/development-channels.md).

## From source (development)

Prefer `pnpm` for builds from source. Bun is optional for running TypeScript directly.

```bash
git clone https://github.com/gmood2008/openbot.git
cd openbot

pnpm install
pnpm ui:build # auto-installs UI deps on first run
pnpm build

pnpm openbot onboard --install-daemon

# Dev loop (auto-reload on TS changes)
pnpm gateway:watch
```

Note: `pnpm openbot ...` runs TypeScript directly (via `tsx`). `pnpm build` produces `dist/` for running via Node / the packaged `openbot` binary.

## Security defaults (DM access)

OpenBot connects to real messaging surfaces. Treat inbound DMs as **untrusted input**.

Full security guide: [Security](docs/gateway/security/index.md)

Product workplace IM (WeCom / Feishu / DingTalk) is configured from the enterprise
console. The pairing defaults below apply to **inherited** consumer adapters if you
still enable them:

Default behavior on Telegram/WhatsApp/Signal/iMessage/Microsoft Teams/Discord/Google Chat/Slack:

- **DM pairing** (`dmPolicy="pairing"` / `channels.discord.dmPolicy="pairing"` / `channels.slack.dmPolicy="pairing"`; legacy: `channels.discord.dm.policy`, `channels.slack.dm.policy`): unknown senders receive a short pairing code and the bot does not process their message.
- Approve with: `openbot pairing approve <channel> <code>` (then the sender is added to a local allowlist store).
- Public inbound DMs require an explicit opt-in: set `dmPolicy="open"` and include `"*"` in the channel allowlist (`allowFrom` / `channels.discord.allowFrom` / `channels.slack.allowFrom`; legacy: `channels.discord.dm.allowFrom`, `channels.slack.dm.allowFrom`).

Run `openbot doctor` to surface risky/misconfigured DM policies.

## Highlights

- **[Gateway control plane](docs/gateway/index.md)** — sessions, routing, tools, events, and the browser Control UI on one process.
- **[Enterprise IM](docs/channels/enterprise-im.md)** — WeCom, Feishu, and DingTalk from Enterprise console → Message channels (long-connection first).
- **[Digital employees](docs/concepts/multi-agent.md)** — isolated agents with their own workspace, memory, skills, and audit trail.
- **[Employee + enterprise consoles](docs/web/index.md)** — roster, collaboration groups, knowledge, and capability governance — not a personal messenger wall.
- **[WebChat](docs/web/webchat.md)** — in-product chat over the Gateway WebSocket.
- **[Skills + tools](docs/tools/skills.md)** — bundled / workspace skills, browser, cron, and canvas where you enable them.
- **[Companion nodes](docs/nodes/index.md)** (optional) — macOS / iOS / Android for local device actions; these are nodes, not inbox channels.
- **[Onboarding](docs/start/wizard.md) + [doctor](docs/gateway/doctor.md)** — `openbot onboard` then verify with `openbot doctor`.

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=gmood2008/openbot&type=date&legend=top-left)](https://www.star-history.com/#gmood2008/openbot&type=date&legend=top-left)

## What ships today

### Core platform

- [Gateway WS control plane](docs/gateway/index.md) with sessions, config, cron, webhooks, [Control UI](docs/web/index.md), and [Canvas host](docs/platforms/mac/canvas.md#canvas-a2ui).
- [CLI](docs/tools/agent-send.md): `openbot` (`openclaw` is a compatibility alias only) — gateway, agent, [onboard](docs/start/wizard.md), [doctor](docs/gateway/doctor.md).
- [Pi agent runtime](docs/concepts/agent.md) in RPC mode with tool streaming.
- [Session model](docs/concepts/session.md) plus collaboration groups in the employee console. Group rules: [Groups](docs/channels/groups.md).
- [Media pipeline](docs/nodes/images.md): images/audio/video, size caps, temp file lifecycle. Audio: [Audio](docs/nodes/audio.md).

### Channels (product vs leftover adapters)

- **Product channels:** [WeCom](docs/channels/wecom.md), [Feishu](docs/channels/feishu.md), [DingTalk](docs/channels/dingtalk.md) via [Enterprise IM setup](docs/channels/enterprise-im.md), plus [WebChat](docs/web/webchat.md).
- **Not the product headline:** inherited OpenClaw consumer adapters (WhatsApp, Telegram, Slack, Discord, iMessage/BlueBubbles, Signal, IRC, LINE, Matrix, Teams, Mattermost, Nextcloud Talk, Nostr, Synology Chat, Tlon, Twitch, Zalo, Zalo Personal, Google Chat, and similar) may still exist as plugins. They are not OpenBot’s current workplace IM surface. Catalog: [Chat Channels](docs/channels/index.md).
- [Group routing](docs/channels/group-messages.md) still applies when a channel is enabled.

### Consoles + optional nodes

- [Control UI](docs/web/index.md) / employee workspace / enterprise console — primary operator surface.
- Optional companion [nodes](docs/nodes/index.md): [macOS](docs/platforms/macos.md), [iOS](docs/platforms/ios.md), [Android](docs/platforms/android.md) for local camera/canvas/voice. These are device nodes, not inbox channels.

### Tools + automation

- [Skills](docs/tools/skills.md): bundled and workspace skills with install gating in the console.
- [Browser control](docs/tools/browser.md), [Canvas / A2UI](docs/platforms/mac/canvas.md), [cron](docs/automation/cron-jobs.md), [webhooks](docs/automation/webhook.md).

### Runtime + safety

- [Channel routing](docs/channels/channel-routing.md), [retry policy](docs/concepts/retry.md), and [streaming/chunking](docs/concepts/streaming.md).
- [Presence](docs/concepts/presence.md), [typing indicators](docs/concepts/typing-indicators.md), and [usage tracking](docs/concepts/usage-tracking.md).
- [Models](docs/concepts/models.md), [model failover](docs/concepts/model-failover.md), and [session pruning](docs/concepts/session-pruning.md).
- [Security](docs/gateway/security/index.md) and [troubleshooting](docs/channels/troubleshooting.md).

### Ops + packaging

- [Control UI](docs/web/index.md) + [WebChat](docs/web/webchat.md) served directly from the Gateway.
- [Tailscale Serve/Funnel](docs/gateway/tailscale.md) or [SSH tunnels](docs/gateway/remote.md) with token/password auth.
- [Nix mode](docs/install/nix.md) for declarative config; [Docker](docs/install/docker.md)-based installs.
- [Doctor](docs/gateway/doctor.md) migrations, [logging](docs/logging.md).

## How it works (short)

```
WeCom / Feishu / DingTalk / WebChat
               │
               ▼
┌───────────────────────────────┐
│            Gateway            │
│       (control plane)         │
│     ws://127.0.0.1:18789      │
└──────────────┬────────────────┘
               │
               ├─ Digital employees (Pi RPC)
               ├─ CLI (openbot …)
               ├─ Control UI / employee console
               └─ Optional companion nodes
```

## Key subsystems

- **[Gateway WebSocket network](docs/concepts/architecture.md)** — single WS control plane for clients, tools, and events (plus ops: [Gateway runbook](docs/gateway/index.md)).
- **[Tailscale exposure](docs/gateway/tailscale.md)** — Serve/Funnel for the Gateway dashboard + WS (remote access: [Remote](docs/gateway/remote.md)).
- **[Browser control](docs/tools/browser.md)** — openbot-managed Chrome/Chromium with CDP control.
- **[Canvas + A2UI](docs/platforms/mac/canvas.md)** — agent‑driven visual workspace (A2UI host: [Canvas/A2UI](docs/platforms/mac/canvas.md#canvas-a2ui)).
- **[Voice Wake](docs/nodes/voicewake.md) + [Talk Mode](docs/nodes/talk.md)** — wake words on macOS/iOS plus continuous voice on Android.
- **[Nodes](docs/nodes/index.md)** — Canvas, camera snap/clip, screen record, `location.get`, notifications, plus macOS‑only `system.run`/`system.notify`.

## Tailscale access (Gateway dashboard)

OpenBot can auto-configure Tailscale **Serve** (tailnet-only) or **Funnel** (public) while the Gateway stays bound to loopback. Configure `gateway.tailscale.mode`:

- `off`: no Tailscale automation (default).
- `serve`: tailnet-only HTTPS via `tailscale serve` (uses Tailscale identity headers by default).
- `funnel`: public HTTPS via `tailscale funnel` (requires shared password auth).

Notes:

- `gateway.bind` must stay `loopback` when Serve/Funnel is enabled (OpenBot enforces this).
- Serve can be forced to require a password by setting `gateway.auth.mode: "password"` or `gateway.auth.allowTailscale: false`.
- Funnel refuses to start unless `gateway.auth.mode: "password"` is set.
- Optional: `gateway.tailscale.resetOnExit` to undo Serve/Funnel on shutdown.

Details: [Tailscale guide](docs/gateway/tailscale.md) · [Web surfaces](docs/web/index.md)

## Remote Gateway (Linux is great)

It’s perfectly fine to run the Gateway on a small Linux instance. Clients (macOS app, CLI, WebChat) can connect over **Tailscale Serve/Funnel** or **SSH tunnels**, and you can still pair device nodes (macOS/iOS/Android) to execute device‑local actions when needed.

- **Gateway host** runs the exec tool and channel connections by default.
- **Device nodes** run device‑local actions (`system.run`, camera, screen recording, notifications) via `node.invoke`.
  In short: exec runs where the Gateway lives; device actions run where the device lives.

Details: [Remote access](docs/gateway/remote.md) · [Nodes](docs/nodes/index.md) · [Security](docs/gateway/security/index.md)

## macOS permissions via the Gateway protocol

The macOS app can run in **node mode** and advertises its capabilities + permission map over the Gateway WebSocket (`node.list` / `node.describe`). Clients can then execute local actions via `node.invoke`:

- `system.run` runs a local command and returns stdout/stderr/exit code; set `needsScreenRecording: true` to require screen-recording permission (otherwise you’ll get `PERMISSION_MISSING`).
- `system.notify` posts a user notification and fails if notifications are denied.
- `canvas.*`, `camera.*`, `screen.record`, and `location.get` are also routed via `node.invoke` and follow TCC permission status.

Elevated bash (host permissions) is separate from macOS TCC:

- Use `/elevated on|off` to toggle per‑session elevated access when enabled + allowlisted.
- Gateway persists the per‑session toggle via `sessions.patch` (WS method) alongside `thinkingLevel`, `verboseLevel`, `model`, `sendPolicy`, and `groupActivation`.

Details: [Nodes](docs/nodes/index.md) · [macOS app](docs/platforms/macos.md) · [Gateway protocol](docs/concepts/architecture.md)

## Agent to Agent (sessions\_\* tools)

- Use these to coordinate work across sessions without jumping between chat surfaces.
- `sessions_list` — discover active sessions (agents) and their metadata.
- `sessions_history` — fetch transcript logs for a session.
- `sessions_send` — message another session; optional reply‑back ping‑pong + announce step (`REPLY_SKIP`, `ANNOUNCE_SKIP`).

Details: [Session tools](docs/concepts/session-tool.md)

## Skills (built-in CLI)

OpenBot ships a built-in skills runtime: skills are folders with a `SKILL.md` file inside the
local workspace, the user-level `~/.openbot/skills/`, the bundled set, or any path configured via
`skills.load.extraDirs`. Use the `openbot skills` CLI to list, inspect, install, and update them.
There is no third-party registry dependency.

[OpenBot Skills CLI guide](docs/tools/skills-cli.md)

## Chat commands

Send these in WhatsApp/Telegram/Slack/Google Chat/Microsoft Teams/WebChat (group commands are owner-only):

- `/status` — compact session status (model + tokens, cost when available)
- `/new` or `/reset` — reset the session
- `/compact` — compact session context (summary)
- `/think <level>` — off|minimal|low|medium|high|xhigh (GPT-5.2 + Codex models only)
- `/verbose on|off`
- `/usage off|tokens|full` — per-response usage footer
- `/restart` — restart the gateway (owner-only in groups)
- `/activation mention|always` — group activation toggle (groups only)

## Apps (optional)

The Gateway alone delivers a great experience. All apps are optional and add extra features.

If you plan to build/run companion apps, follow the platform runbooks below.

### macOS (OpenBot.app) (optional)

- Menu bar control for the Gateway and health.
- Voice Wake + push-to-talk overlay.
- WebChat + debug tools.
- Remote gateway control over SSH.

Note: signed builds required for macOS permissions to stick across rebuilds (see `docs/mac/permissions.md`).

### iOS node (optional)

- Pairs as a node over the Gateway WebSocket (device pairing).
- Voice trigger forwarding + Canvas surface.
- Controlled via `openbot nodes …`.

Runbook: [iOS connect](docs/platforms/ios.md).

### Android node (optional)

- Pairs as a WS node via device pairing (`openbot devices ...`).
- Exposes Connect/Chat/Voice tabs plus Canvas, Camera, Screen capture, and Android device command families.
- Runbook: [Android connect](docs/platforms/android.md).

## Agent workspace + skills

- Workspace root: `~/.openbot/workspace` (configurable via `agents.defaults.workspace`).
- Injected prompt files: `AGENTS.md`, `SOUL.md`, `TOOLS.md`.
- Skills: `~/.openbot/workspace/skills/<skill>/SKILL.md`.

## Configuration

Minimal `~/.openbot/openbot.json` (model + defaults):

```json5
{
  agent: {
    model: "anthropic/claude-opus-4-6",
  },
}
```

[Full configuration reference (all keys + examples).](docs/gateway/configuration.md)

## Security model (important)

- **Default:** tools run on the host for the **main** session, so the agent has full access when it’s just you.
- **Group/channel safety:** set `agents.defaults.sandbox.mode: "non-main"` to run **non‑main sessions** (groups/channels) inside per‑session Docker sandboxes; bash then runs in Docker for those sessions.
- **Sandbox defaults:** allowlist `bash`, `process`, `read`, `write`, `edit`, `sessions_list`, `sessions_history`, `sessions_send`, `sessions_spawn`; denylist `browser`, `canvas`, `nodes`, `cron`, `discord`, `gateway`.

Details: [Security guide](docs/gateway/security/index.md) · [Docker + sandboxing](docs/install/docker.md) · [Sandbox config](docs/gateway/configuration.md)

### [WhatsApp](docs/channels/whatsapp.md)

- Link the device: `pnpm openbot channels login` (stores creds in `~/.openbot/credentials`).
- Allowlist who can talk to the assistant via `channels.whatsapp.allowFrom`.
- If `channels.whatsapp.groups` is set, it becomes a group allowlist; include `"*"` to allow all.

### [Telegram](docs/channels/telegram.md)

- Set `TELEGRAM_BOT_TOKEN` or `channels.telegram.botToken` (env wins).
- Optional: set `channels.telegram.groups` (with `channels.telegram.groups."*".requireMention`); when set, it is a group allowlist (include `"*"` to allow all). Also `channels.telegram.allowFrom` or `channels.telegram.webhookUrl` + `channels.telegram.webhookSecret` as needed.

```json5
{
  channels: {
    telegram: {
      botToken: "123456:ABCDEF",
    },
  },
}
```

### [Slack](docs/channels/slack.md)

- Set `SLACK_BOT_TOKEN` + `SLACK_APP_TOKEN` (or `channels.slack.botToken` + `channels.slack.appToken`).

### [Discord](docs/channels/discord.md)

- Set `DISCORD_BOT_TOKEN` or `channels.discord.token` (env wins).
- Optional: set `commands.native`, `commands.text`, or `commands.useAccessGroups`, plus `channels.discord.allowFrom`, `channels.discord.guilds`, or `channels.discord.mediaMaxMb` as needed.

```json5
{
  channels: {
    discord: {
      token: "1234abcd",
    },
  },
}
```

### [Signal](docs/channels/signal.md)

- Requires `signal-cli` and a `channels.signal` config section.

### [BlueBubbles (iMessage)](docs/channels/bluebubbles.md)

- **Recommended** iMessage integration.
- Configure `channels.bluebubbles.serverUrl` + `channels.bluebubbles.password` and a webhook (`channels.bluebubbles.webhookPath`).
- The BlueBubbles server runs on macOS; the Gateway can run on macOS or elsewhere.

### [iMessage (legacy)](docs/channels/imessage.md)

- Legacy macOS-only integration via `imsg` (Messages must be signed in).
- If `channels.imessage.groups` is set, it becomes a group allowlist; include `"*"` to allow all.

### [Microsoft Teams](docs/channels/msteams.md)

- Configure a Teams app + Bot Framework, then add a `msteams` config section.
- Allowlist who can talk via `msteams.allowFrom`; group access via `msteams.groupAllowFrom` or `msteams.groupPolicy: "open"`.

### [WebChat](docs/web/webchat.md)

- Uses the Gateway WebSocket; no separate WebChat port/config.

Browser control (optional):

```json5
{
  browser: {
    enabled: true,
    color: "#FF4500",
  },
}
```

## Docs

Use these when you’re past the onboarding flow and want the deeper reference.

- [Start with the docs index for navigation and “what’s where.”](docs/index.md)
- [Read the architecture overview for the gateway + protocol model.](docs/concepts/architecture.md)
- [Use the full configuration reference when you need every key and example.](docs/gateway/configuration.md)
- [Run the Gateway by the book with the operational runbook.](docs/gateway/index.md)
- [Learn how the Control UI/Web surfaces work and how to expose them safely.](docs/web/index.md)
- [Understand remote access over SSH tunnels or tailnets.](docs/gateway/remote.md)
- [Follow the onboarding wizard flow for a guided setup.](docs/start/wizard.md)
- [Wire external triggers via the webhook surface.](docs/automation/webhook.md)
- [Set up Gmail Pub/Sub triggers.](docs/automation/gmail-pubsub.md)
- [Learn the macOS menu bar companion details.](docs/platforms/mac/menu-bar.md)
- [Platform guides: Windows (WSL2)](docs/platforms/windows.md), [Linux](docs/platforms/linux.md), [macOS](docs/platforms/macos.md), [iOS](docs/platforms/ios.md), [Android](docs/platforms/android.md)
- [Debug common failures with the troubleshooting guide.](docs/channels/troubleshooting.md)
- [Review security guidance before exposing anything.](docs/gateway/security/index.md)

## Advanced docs (discovery + control)

- [Discovery + transports](docs/gateway/discovery.md)
- [Bonjour/mDNS](docs/gateway/bonjour.md)
- [Gateway pairing](docs/gateway/pairing.md)
- [Remote gateway README](docs/gateway/remote-gateway-readme.md)
- [Control UI](docs/web/control-ui.md)
- [Dashboard](docs/web/dashboard.md)

## Operations & troubleshooting

- [Health checks](docs/gateway/health.md)
- [Gateway lock](docs/gateway/gateway-lock.md)
- [Background process](docs/gateway/background-process.md)
- [Browser troubleshooting (Linux)](docs/tools/browser-linux-troubleshooting.md)
- [Logging](docs/logging.md)

## Deep dives

- [Agent loop](docs/concepts/agent-loop.md)
- [Presence](docs/concepts/presence.md)
- [TypeBox schemas](docs/concepts/typebox.md)
- [RPC adapters](docs/reference/rpc.md)
- [Queue](docs/concepts/queue.md)

## Workspace & skills

- [Skills config](docs/tools/skills-config.md)
- [Default AGENTS](docs/reference/AGENTS.default.md)
- [Templates: AGENTS](docs/reference/templates/AGENTS.md)
- [Templates: BOOTSTRAP](docs/reference/templates/BOOTSTRAP.md)
- [Templates: IDENTITY](docs/reference/templates/IDENTITY.md)
- [Templates: SOUL](docs/reference/templates/SOUL.md)
- [Templates: TOOLS](docs/reference/templates/TOOLS.md)
- [Templates: USER](docs/reference/templates/USER.md)

## Platform internals

- [macOS dev setup](docs/platforms/mac/dev-setup.md)
- [macOS menu bar](docs/platforms/mac/menu-bar.md)
- [macOS voice wake](docs/platforms/mac/voicewake.md)
- [iOS node](docs/platforms/ios.md)
- [Android node](docs/platforms/android.md)
- [Windows (WSL2)](docs/platforms/windows.md)
- [Linux app](docs/platforms/linux.md)

## Email hooks (Gmail)

- [Gmail Pub/Sub guide](docs/automation/gmail-pubsub.md)

## Molty

OpenBot was built for **Molty**, a space lobster AI assistant. 🐲
by Peter Steinberger and the community.

- [soul.md](https://soul.md)
- [steipete.me](https://steipete.me)

## Community

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines, maintainers, and how to submit PRs.
AI/vibe-coded PRs welcome! 🤖

Special thanks to [Mario Zechner](https://mariozechner.at/) for his support and for
[pi-mono](https://github.com/badlogic/pi-mono).
Special thanks to Adam Doppelt for lobster.bot.
