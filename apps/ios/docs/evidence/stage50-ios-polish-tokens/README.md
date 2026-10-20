# Stage 50 — iOS polish: Manrope + token check

Date: 2026-10-03 (Asia/Shanghai). Branch `app/stage50-ios-polish-tokens` from `app/stage49-ios-me-deepen` @ `1f5a7c60d01814cf04b4daade7c34df60eab3911`.

No phone IA change. No WebView tab. Colors were not regenerated and no third palette was added.

## Landed

- `OpenBotMobileTokens` text styles (`title1` through `caption2`, plus iOS-only `moduleTitle`) use the Manrope PostScript faces Android already ships: Regular 400, Medium 500, SemiBold 600, Bold 700. Sizes and weights are unchanged.
- The four `.ttf` files in `apps/ios/Sources/Fonts` are byte-copies of `apps/android/app/src/main/res/font`. `MANROPE_OFL.txt` is the same SIL OFL text as `apps/android/THIRD_PARTY_LICENSES/MANROPE_OFL.txt`. `UIAppFonts` in `Sources/Info.plist` and `project.yml` registers the four files. `xcodegen` puts them in the app bundle root.
- `scripts/check-mobile-tokens.mjs` still checks the JSON hex set against both Android `MobileUiTokens.kt` and iOS `OpenBotMobileTokens.swift`. It now also checks named palette keys, the background gradient order, and that each iOS font file hashes equal to the Android source and is named in `UIAppFonts` / `project.yml`. iOS text styles fail the check if they go back to `.system(size:)`.

## Check

```bash
node scripts/check-mobile-tokens.mjs
```

Result (2026-10-03 09:28 CST): **exit 0**

`check-mobile-tokens: ok (20 hex colors match Android MobileUiTokens.kt and iOS OpenBotMobileTokens.swift; Manrope faces match)`

## Build

`cd apps/ios && xcodebuild -scheme OpenBot -destination 'platform=iOS Simulator,name=iPhone 17 Pro,OS=26.5' build`

Result (2026-10-03 09:29 CST): **BUILD SUCCEEDED**. SwiftFormat (lint) and SwiftLint run-script phases stayed on. SwiftLint: 17 violations, 0 serious, including the pre-existing `SettingsTab.swift` `superfluous_disable_command`. `OpenBotMobileTokens.swift` had none.

Built `OpenBot.app` contains `manrope_400_regular.ttf`, `manrope_500_medium.ttf`, `manrope_600_semibold.ttf`, `manrope_700_bold.ttf`, `MANROPE_OFL.txt`, and `UIAppFonts` lists those four filenames.

## Not done

- No Kotlin/Swift/CSS color generator. Palette literals stay hand-written.
- Letter-spacing stays on the Android `TextStyle`s only. `Font` does not carry tracking, and this slice does not change call sites.
- No merge.
