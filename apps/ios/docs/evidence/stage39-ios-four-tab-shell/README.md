# Stage 39 — iOS four-tab shell (slice 1)

**Date:** 2026-10-02 (Asia/Shanghai)  
**Branch:** `app/stage39-ios-four-tab-shell`  
**Base:** `app/stage38-strip-session-title-kb` @ `4bbeeb9cb`  
**Goal:** Design tokens + post-onboarding four tabs matching Web/Android IA — **not** stage30 Employee Shell WebView embeds.

## SoT

- HTML: `/Users/daniel/AI VP/openbot-four-tab-frontend-preview/`
- Android: `PostOnboardingTabs.kt`, `MobileUiTokens.kt`
- Reuse plan + expert review: `apps/android/docs/evidence/stage38-strip-session-title-kb/IOS_REUSE.md`

## Paths added

```
apps/ios/Sources/MobileUI/OpenBotMobileTokens.swift
apps/ios/Sources/MobileUI/MobilePageComponents.swift
apps/ios/Sources/MobileUI/EmployeeRootTabs.swift
apps/ios/Sources/MobileUI/ChatTabView.swift
apps/ios/Sources/MobileUI/TasksTabStub.swift
apps/ios/Sources/MobileUI/KnowledgeTabStub.swift
apps/ios/Sources/MobileUI/MeTabShell.swift
```

## Wire

- `RootView`: cloud signed-in → `EmployeeRootTabs` (native)
- Employee Shell: optional via 我的 → 更多 → 打开员工工作台
- Legacy Screen/Voice/Settings: 我的 → 本机与连接 (sheets)

## Product name vs Xcode scheme (important)

The **product is OpenBot** (home-screen / App Store name, `CFBundleDisplayName: OpenBot`, URL scheme `openbot`, bundle IDs `ai.openbot.*`).

There is **no** Xcode scheme or `.xcodeproj` literally named `OpenBot` under `apps/ios/`.

| What you open | Actual name | Role |
|---------------|-------------|------|
| Project | `apps/ios/OpenClaw.xcodeproj` | iOS **app** project (xcodegen `name: OpenClaw`) |
| App scheme / target | **`OpenClaw`** | Builds `OpenClaw.app` — this **is** the OpenBot iOS client |
| Package schemes | `OpenBotKit`, `OpenBotChatUI`, `OpenBotProtocol` | Shared SPM libraries only — **not** the app |
| Display name | OpenBot | What users see on the device |

`xcodebuild -scheme OpenBot` → error: project does not contain a scheme named OpenBot.  
fastlane beta also archives `scheme: "OpenClaw"` / `OpenClaw.xcodeproj` for the OpenBot App Store client.

Do **not** rename targets in this slice; OpenClaw is a legacy Xcode identifier for the OpenBot app.

## How to build (OpenBot iOS app)

```bash
cd apps/ios
xcodegen generate
# Product = OpenBot; Xcode scheme = OpenClaw (legacy name)
xcodebuild -project OpenClaw.xcodeproj -scheme OpenClaw \
  -destination 'platform=iOS Simulator,name=iPhone 16' \
  -configuration Debug build
```

Env: Debug scheme still sets `OPENBOT_ENABLE_LEGACY_UI_SHELL=1` for manual-setup canvas; post-auth path no longer depends on it.

## Hard constraints honored

- No stage30 full-tab WebView embed as primary
- No merge to `main` in this slice
- No force-push
- Reuse OpenBotKit chat stack

## Build status (2026-10-02 19:50 CST)

**Checkout:** `/Users/daniel/AI VP/openbot-app-stage38-strip-session-title-kb`  
**Branch / HEAD:** `app/stage39-ios-four-tab-shell` @ `b6a6367a9` (PR #287)

### Xcode / SDK / runtime inventory

| Item | Value |
|------|--------|
| `xcode-select -p` | `/Applications/Xcode.app/Contents/Developer` |
| Xcode | **26.6** (17F113) |
| iOS SDK (listed) | `iphoneos26.5` / `iphonesimulator26.5` |
| Simulator runtimes (`simctl list runtimes`) | **none installed** |
| Available devices | only unavailable placeholders (`iOS-26-4`, `iOS-26-5`) |
| `iPhoneSimulator.platform` on disk | ~100 MB stub (platform content missing) |

### Commands tried

1. `xcodegen` — already OK; `OpenClaw.xcodeproj` present; scheme **OpenClaw**.
2. `xcodebuild -project OpenClaw.xcodeproj -scheme OpenClaw -destination 'generic/platform=iOS' -configuration Debug CODE_SIGNING_ALLOWED=NO build`  
   → **FAIL**: `Unable to find a destination…` / `iOS 26.5 is not installed. Please download and install the platform from Xcode > Settings > Components.`
3. Simulator destinations — **FAIL** (no runtime). Same root cause for device + sim.
4. `xcodebuild -downloadPlatform iOS` — **started** (downloads **iOS 26.5 Simulator (23F77) arm64**, ~8.52 GB). Progress observed ~0.3 MB/s (ETA many hours under current network). Leave running or prefer GUI below.

### Single clear user action (blocks green build + Run)

**Install the iOS 26.5 platform / Simulator runtime**, then rebuild:

1. Open **Xcode** (already open on this Mac).
2. **Xcode → Settings… → Platforms** (label may still say **Components** on some builds).
3. Find **iOS 26.5** (Simulator) → **Get** / **Download** → wait until installed (~8.5 GB).
4. Confirm: `xcrun simctl list runtimes` shows an iOS 26.x runtime (not empty).
5. Build:

```bash
cd "/Users/daniel/AI VP/openbot-app-stage38-strip-session-title-kb/apps/ios"
xcodegen generate
xcodebuild -project OpenClaw.xcodeproj -scheme OpenClaw \
  -destination 'platform=iOS Simulator,name=iPhone 17' \
  -configuration Debug build
```

If no “iPhone 17” device appears after install, pick any listed iPhone from `xcrun simctl list devices available`, or open the project in Xcode and Run on a simulator.

**Note:** A local proxy (e.g. Clash) can throttle Apple CDN; pause it if the Platforms download stalls. CLI download may already be running: `pgrep -lf 'xcodebuild -downloadPlatform'`.

**App cannot run on Simulator until that platform finishes installing.** No product-code change in this status update.

### Naming check (2026-10-02 19:59 CST)

- Confirmed again: **OpenBot iOS app = scheme `OpenClaw`** in `OpenClaw.xcodeproj`.
- `-scheme OpenBot` does not exist.
- `OpenBotKit` / `OpenBotChatUI` / `OpenBotProtocol` are SPM libs, not the app.
- Simulator runtime still **not** installed; `xcodebuild -downloadPlatform iOS` still in progress (~2% of 8.52 GB when last checked).
- Same platform blocker for the OpenBot app build (via scheme OpenClaw).


## Naming follow-up (Stage 40)

Xcode project/scheme/target rename **OpenClaw → OpenBot** landed on branch `app/stage40-ios-rename-openbot`.
See `apps/ios/docs/evidence/stage40-ios-rename-openbot/README.md`. Historical commands above that say `-scheme OpenClaw` / `OpenClaw.xcodeproj` are superseded.
