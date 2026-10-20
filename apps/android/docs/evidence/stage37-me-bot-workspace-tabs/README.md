# Stage 3.7 — Me「更多」cleanup + bot workspace tabs

Stacked on Stage 3.6 (`app/stage36-me-secondary-pages-cleanup`).

## Ask (screenshots)

1. 我的→更多：DELETE grey subtitle「更多」under segment control.
2. Bot detail「助手甲」：DELETE duplicate fake status (preview); tabs 身份|能力|成长|运营授权|协作 each open editable panels using **same Web mechanisms**.

## Preview (Desktop HTML SoT)

Path: `/Users/daniel/Desktop/openbot-four-tab-frontend-preview/`

- Removed `<div class="section">更多</div>` under 更多 pane.
- `.phone.me-sheet-open` hides fake `.status` + tabbar so secondary sheets no longer stack a second 09:41 bar.
- Robot edit `#reTabs` wired (`data-re-tab` = Web `MyBotDetailTabId`): identity / capabilities / growth / auth / collaboration panes.

Server: `python3 -m http.server 8765 --bind 127.0.0.1` → http://127.0.0.1:8765/

## Android (native, Web RPCs)

| Tab | Web cite | Android |
| --- | --- | --- |
| 身份 | `my-bot-workspace-panel.ts` `renderIdentityTab` + `robot.workspace.updateIdentity` | Editable name/定位/角色/人格 → save |
| 能力 | `renderCapabilitiesTab` via `robot.workspace.get` capabilities/personas | List +「探索能力」notice → Web |
| 成长 | `renderGrowthTab` growth dossier | KV from `robot.workspace.get` → growth |
| 运营授权 | `renderAuthTab` + `user-operational-identity.access.list-for-agent` / `grants.upsert` | Checkbox grants + confirm |
| 协作 | `renderCollaborationTab` collaborations[] | Nav rows → group detail |

No Android-only editor; no Employee Shell embed for these panels (Web mobile also uses workbench panel + thin RPCs).

## Test

```bash
export JAVA_HOME="$(/usr/libexec/java_home -v 17)"
./gradlew :app:testDebugUnitTest --tests ai.openbot.app.ui.MeHubModelsTest :app:assembleDebug
adb -s emulator-5554 install -r app/build/outputs/apk/debug/app-debug.apk
```

No merge to main.
