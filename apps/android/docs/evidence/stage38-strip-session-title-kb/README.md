# Stage 3.8 — Strip→session + module title polish + Knowledge search below title

Stacked on Stage 3.7 (`app/stage37-me-bot-workspace-tabs` / PR #284). **No merge to main.**

## Asks (screenshots)

1. **图二 Chat Agent Strip**: tapping bot/collab chip switches chat session (same Web `onSelectSession` / Android `switchChatSession` binding). Red box on 助手甲 = annotation only.
2. **图一「我的机器人」**: keep top-level「我的」context; unify title position/font for **任务 / 知识 / 我的** module headers and tertiary Me sheets.
3. **图三 知识**: move search bar **below** title「我的知识库」.

## Preview (Desktop HTML SoT)

Path: `/Users/daniel/Desktop/openbot-four-tab-frontend-preview/`

- Strip chips carry `data-session` / `data-session-label`; click → `switchChatSession` swaps `#chatScroll` from `chatBySession` (steward / 助手甲 product-spec thread / 助手乙 / 协作组A).
- Module titles share `.module-title` (26px / 700 / -0.3px) across 任务 · 我的知识库 · 我的.
- Knowledge: title then search (was search above title).
- Me tertiary: keep **tabbar** (「我的」selected); hide fake status only. Nav = circular back | kicker「我的」+ centered title | circular +.

```bash
cd "/Users/daniel/Desktop/openbot-four-tab-frontend-preview"
python3 -m http.server 8765 --bind 127.0.0.1
# http://127.0.0.1:8765/
```

## Android

| Fix | Change |
| --- | --- |
| Strip→session | `onSelect` → `viewModel.switchChatSession` (unchanged Web RPC path). DEMO strip seeds 助手甲/乙 + `space:collab-a` and `demoStripMessagesForSession(sessionKey)` so offline taps switch transcripts. |
| Module titles | Knowledge uses `MobilePageHeader("我的知识库")` (same as 任务/我的 `mobileTitle1`). |
| Knowledge search | Search field **below** header. |
| 我的机器人 etc. | `MeSubScaffold`: circular back/+, centered title, kicker `parentContext="我的"`. |

## Test

```bash
export JAVA_HOME="$(/usr/libexec/java_home -v 17)"
cd apps/android
./gradlew :app:testDebugUnitTest --tests ai.openbot.app.ui.chat.DemoStripSessionTest --tests ai.openbot.app.ui.chat.AgentStripNavTest :app:assembleDebug
adb -s emulator-5554 install -r app/build/outputs/apk/debug/app-debug.apk
# or openbot-*-debug.apk depending on archive name
```

No merge to main.
