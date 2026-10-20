# Stage 41 — OpenBotKit / iOS API rename OpenClaw → OpenBot

**Date:** 2026-10-02 (Asia/Shanghai)  
**Branch:** `app/stage41-ios-rename-openbot-api`  
**Base:** `app/stage40-ios-rename-openbot` (PR #288 shell rename)  
**Goal:** Clear remaining **Swift API / type** OpenClaw* names in OpenBotKit + iOS (and macOS call sites that consume the kit). Keep wire/compat strings that existing installs and gateways still emit.

## Renamed (Swift API)

All public/internal `OpenClaw*` types → `OpenBot*` across:

- `apps/shared/OpenBotKit` (`OpenBotKit`, `OpenBotChatUI`, tests)
- `apps/ios` call sites / local typealiases
- `apps/macos` call sites (required — shared kit; Android untouched)

Examples: `OpenBotCapability`, `OpenBotNodeError`, `OpenBotChatView` / `OpenBotChatViewModel`, command enums (`OpenBotCanvasCommand`, `OpenBotWatchCommand`, …), `OpenBotBonjour`, `OpenBotNodeStorage`.

Command **raw string values** were already wire-neutral (`device.status`, `screen.record`, …) and are unchanged.

## Migrations / dual-read (compat)

| Surface | Primary | Legacy kept |
|---------|---------|-------------|
| Deep link URL scheme | `openbot://` (`DeepLinkSchemeSupport.canonicalScheme`) | `openclaw://` still accepted |
| App Support / Caches folder | `OpenBot` (rename-in-place from legacy when possible) | `OpenClaw` folder still readable |
| macOS state dir / config | `.openbot` / `openbot.json`; `OPENBOT_*` env | `.openclaw` / `openclaw.json`; `OPENCLAW_*` env |
| Canvas capability path | `/__openbot__/cap/` | `/__openclaw__/cap/` normalized on read |
| A2UI JS events / globals | `openbot:a2ui-action-status`, `__openbot`, `openbotA2UI` | `openclaw:*`, `__openclaw`, `openclawA2UI` |
| WK handler name | `openbotCanvasA2UIAction` | `openclawCanvasA2UIAction` |
| Vault exclude markers | `/.openbot/` | `/.openclaw/` |
| Wide-area Bonjour env | `OPENBOT_WIDE_AREA_DOMAIN` | `OPENCLAW_WIDE_AREA_DOMAIN` |
| TalkMode redaction sentinel | `__OPENBOT_REDACTED__` | `__OPENCLAW_REDACTED__` |
| Discovery display strip | `(OpenBot\|OpenClaw)` | both |

## Intentionally not renamed (wire / install compat)

- Gateway canvas capability path segment `__openclaw__` (legacy marker list)
- Hostnames in tests / onboarding: `openclaw.local` still treated as local
- fastlane keychain alias `openclaw-asc-key` (stage40)
- Broader repo CLI/podman `OPENCLAW_*` outside iOS/mac node paths
- Android product code

## Verify

```bash
cd apps/shared/OpenBotKit && swift build
swift test --filter DeepLinksGrammarTests
cd ../../ios && xcodegen generate
# scheme OpenBot (stage40); full app build still needs iOS 26.5 platform
```

**Results (2026-10-02):** `swift build` OK for OpenBotKit + OpenBotChatUI. `DeepLinksGrammarTests` 24/24 including `acceptsLegacyOpenClawScheme`.

## Follow-up

Compat dual-reads dropped in **stage42** (`app/stage42-ios-drop-openclaw-compat`).
