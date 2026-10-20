# Stage 44 — mobile design tokens (check, not generate)

**Date:** 2026-10-03 (Asia/Shanghai)  
**Branch:** `app/stage44-mobile-tokens`  
**Base:** `app/stage43-multiplatform-sharing` @ `42be6ab0a`  
**Goal:** One JSON record of the existing Android/iOS hex twins, plus a check that fails on mismatch. No third palette. No generator. No Android product-feature work.

## Added

```
design/mobile-tokens.json
design/README.md
scripts/check-mobile-tokens.mjs
```

Run `node scripts/check-mobile-tokens.mjs` from the repo root. `package.json` is not wired: that file is on the WPL exclusive loom stream, and this slice must not mix it in.

## Sources compared

- Android colors / type / gutter: `apps/android/.../MobileUiTokens.kt`
- Android tab chrome (24 / 16 / 58 / white 0.97): `PostOnboardingTabs.kt`
- iOS: `apps/ios/Sources/MobileUI/OpenBotMobileTokens.swift`

`moduleTitle` 26/700 is recorded as iOS-only. It is not in `MobileUiTokens.kt`.

## Check

```bash
node scripts/check-mobile-tokens.mjs
```

Expected: exit 0 and a line `check-mobile-tokens: ok (20 hex colors ...)`.

## Out of scope

- Generating Kotlin, Swift, or CSS
- Web token file
- Chat chrome (stage 45)
- Merge to `main`
