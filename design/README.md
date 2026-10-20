# Mobile design tokens

`mobile-tokens.json` is the shared hex / type / gutter / gradient / tab-size record for the four-tab companion (对话 / 任务 / 知识 / 我的).

It was copied from the twins that already ship. It is **not** a new palette.

| Platform | Source today                                                                                                 | How to consume                                                                           |
| -------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Android  | `apps/android/app/src/main/java/ai/openbot/app/ui/MobileUiTokens.kt` (tab chrome in `PostOnboardingTabs.kt`) | Keep Compose literals. Do not generate Kotlin in this slice.                             |
| iOS      | `apps/ios/Sources/MobileUI/OpenBotMobileTokens.swift` plus `apps/ios/Sources/Fonts/`                         | Keep SwiftUI color literals. Text styles use Manrope (same bytes as Android `res/font`). |
| Web      | HTML SoT CSS vars (`--blue`, `--blue-soft`, …)                                                               | When a Web token file is added, point it at this JSON. No Web generator in this slice.   |

## Check

From the repo root:

```bash
node scripts/check-mobile-tokens.mjs
```

The script fails if any `#RRGGBB` in the JSON palette or background gradient is missing from **either** Android `Color(0xFF……)` or iOS `Color(hex: 0x……)`, or if either source has a hex the JSON does not list. Named palette keys must match the same hex on both platforms. It also checks gutter, type sizes, tab-bar numbers, and that `apps/ios/Sources/Fonts/manrope_*.ttf` is byte-identical to Android `res/font` and registered in `UIAppFonts`.

Changing a color means editing the JSON **and** both platform sources in the same PR, then re-running the check.
