# Stage 42 — Drop OpenClaw compatibility dual-reads

**Date:** 2026-10-02 (Asia/Shanghai)  
**Branch:** `app/stage42-ios-drop-openclaw-compat`  
**Base:** `app/stage41-ios-rename-openbot-api` (PR #291)  
**Choice:** **Hard cut to OpenBot-only** for app/kit surfaces. One-shot migrate-then-drop for on-disk state (no forever dual-read).

## Removed / hard-cut

| Surface | Change |
|---------|--------|
| Deep links | `openclaw://` **rejected**; only `openbot://` |
| App Support / Caches | Rename `OpenClaw` → `OpenBot` once; never keep serving legacy |
| macOS `~/.openclaw` / `openclaw.json` | Rename → `~/.openbot` / `openbot.json` once; env `OPENBOT_*` only |
| Canvas path | Only `/__openbot__/cap/` (no `__openclaw__` accept list) |
| JS / WK | `__openbot`, `openbotA2UI`, `openbot:a2ui-action-status`, `openbotCanvasA2UIAction` only |
| Vault exclude | `/.openbot/` only |
| TalkMode sentinel | `__OPENBOT_REDACTED__` only |
| Bonjour / DeviceIdentity env | `OPENBOT_*` only |
| Discovery display strip | `(OpenBot)` only |
| Onboarding / tests hosts | `openbot.local` (drop `openclaw.local`) |
| fastlane ASC keychain | `openbot-asc-key` only (operators must rename keychain item) |
| macOS UserDefaults | Keys `openbot.*`; one-shot copy from `openclaw.*` via `migrateLegacyDefaults()` |
| Logger subsystems / temp paths | `ai.openbot`, `openbot-*` prefixes |

## Intentionally still present (thin / one-shot / historical)

| Leftover | Why |
|----------|-----|
| Literal `"OpenClaw"` / `openclaw.json` / `.openclaw` **only inside migrate helpers** | Source string for one-shot rename; not dual-read after migrate |
| `legacyLaunchdLabels = ["ai.openclaw.mac"]` (+ gateway) | Needed to **stop/unload** old LaunchAgents during upgrade |
| `CommandResolver` still looking for `openclaw.mjs` / `bin/openclaw.js` / `openclaw` on PATH | Repo entrypoints / installed CLI may still use that binary name until CLI package rename |
| `PortGuardian` may still match process cmd containing `openclaw` | Running gateway processes from older installs |
| Stage39–41 evidence docs | Historical record |
| Broader repo CLI/podman `OPENCLAW_*` outside app/kit | Out of scope |

## Verify

```bash
cd apps/shared/OpenBotKit && swift build
swift test --filter DeepLinksGrammarTests
cd ../../ios && xcodegen generate  # scheme OpenBot
```

**Results:** swift build OK; DeepLinksGrammarTests 24/24 including `rejectsLegacyOpenClawScheme`.
