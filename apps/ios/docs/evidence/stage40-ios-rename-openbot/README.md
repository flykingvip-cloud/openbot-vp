# Stage 40 — iOS Xcode rename OpenClaw → OpenBot

**Date:** 2026-10-02 (Asia/Shanghai)  
**Branch:** `app/stage40-ios-rename-openbot`  
**Base:** `app/stage39-ios-four-tab-shell`  
**Goal:** Remove the OpenClaw Xcode shell identity so `xcodebuild -scheme OpenBot` works. Product display name / bundle IDs were already OpenBot.

## Renamed (iOS app shell identity)

| Before | After |
|--------|--------|
| `OpenClaw.xcodeproj` / xcodegen `name: OpenClaw` | `OpenBot.xcodeproj` / `name: OpenBot` |
| Scheme / app target `OpenClaw` | `OpenBot` (`OpenBot.app`) |
| `OpenClawTests` / `OpenClawLogicTests` | `OpenBotTests` / `OpenBotLogicTests` |
| `OpenClawShareExtension` / `OpenClawActivityWidget` / `OpenClawWatchApp` / `OpenClawWatchExtension` | `OpenBot*` equivalents |
| Package local alias `OpenClawKit` → path `../shared/OpenBotKit` | Package key `OpenBotKit` (products unchanged) |
| `OPENCLAW_*` xcconfig keys | `OPENBOT_*` (scripts accept legacy `OPENCLAW_*` env as fallback) |
| `Sources/OpenClaw.entitlements`, `OpenClawApp.swift`, Live Activity / Widget / Watch entry types | `OpenBot*` filenames + `OpenBotApp` / `OpenBotAppDelegate` / `OpenBotActivityAttributes` / `OpenBotLiveActivity` / `OpenBotActivityWidgetBundle` / `OpenBotWatchApp` |
| `@testable import OpenClaw` | `@testable import OpenBot` |
| fastlane archive `OpenClaw.xcodeproj` / scheme `OpenClaw` / `OpenClaw-*.ipa` | `OpenBot.xcodeproj` / `OpenBot` / `OpenBot-*.ipa` |
| `.github/workflows/codeql.yml` Swift build | `-project OpenBot.xcodeproj -scheme OpenBot` |

## Intentionally NOT renamed

- **OpenBotKit / OpenBotProtocol Swift API** still uses `OpenClaw*` type prefixes (`OpenClawCapability`, `OpenClawPhotosLatestParams`, `OpenClawNodeError`, chat/canvas/watch command types, etc.). Renaming those would ripple into shared kit + Android-adjacent contracts; out of scope for app-shell rename.
- Bundle IDs remain `ai.openbot.*`.
- `CFBundleDisplayName` was already `OpenBot`.
- Android product code untouched (only `IOS_REUSE.md` note).
- Broader repo docs / CLI / podman `OPENCLAW_*` compat paths outside iOS signing scripts.

## How to build

```bash
cd apps/ios
xcodegen generate
xcodebuild -project OpenBot.xcodeproj -scheme OpenBot \
  -destination 'platform=iOS Simulator,name=iPhone 17' \
  -configuration Debug build
```

## Scheme proof (2026-10-02 ~20:10 CST)

- Generated schemes: `OpenBot.xcscheme`, `OpenBotLogicTests.xcscheme`.
- BlueprintName / BuildableName = `OpenBot` / `OpenBot.app`.
- `xcodebuild … -scheme OpenBot -destination 'generic/platform=iOS'` resolves packages and reports **Ineligible destinations for the "OpenBot" scheme** → `iOS 26.5 is not installed` (same stage39 platform blocker). Scheme name is accepted.

## Related

- Stage39 evidence historical note updated to point here.
- Android `IOS_REUSE.md` updated with stage40 naming status.

## Follow-up

API/type rename continued in **stage41** (`app/stage41-ios-rename-openbot-api`). See `../stage41-ios-rename-openbot-api/README.md`.
