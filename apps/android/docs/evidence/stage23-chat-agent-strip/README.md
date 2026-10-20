# Stage 2.3 — Chat Agent Strip + TO: (evidence)

Locks (核查验收): Strip = `assistantItems` + `spaceItems` (Web SoT: workbench-nav-model / chrome / stage / shell-model; steward `13556f487` / `aab45779f`). Roster from **`agents.list`** (assistants) + space-scoped sessions (spaces) — **not** 近24h `resolveSessionChoices` / `sessions.list`. Select → `sessionKey`; default **大白管家**; `TO: {name}` + doc icon. Badge ≤9 (workbench-chrome). Hangs in `ChatSheetContent`; red send; placeholder `输入消息`. No routing / #238 changes; no full WebView.

| File | What it must show |
| --- | --- |
| `reference-target.png` | Product target (IMG_1711): agent strip, `TO: 大白管家`, doc icon, pill composer with red send + `输入消息`. |
| `A-strip-to-daibai.png` | Emulator: strip with **大白管家** selected (pink), `TO: 大白管家` + doc icon, red circular send, `输入消息`, 四 Tab with 对话 selected. |
| `B-strip-select-other.png` | Emulator: select non-steward assistant (**市场助手**); `TO: 市场助手` updates. |
| `C-chat-tab-full.png` | Full 对话 Tab frame: 四 Tab with **对话** selected; strip + TO: + composer visible (not a composer crop). |

## TODO

- [x] Commit `reference-target.png` from IMG_1711.
- [x] Capture A + C on Mac AVD `OpenBot_API34` (SHOW_COMPANION, offline).
- [x] Capture B (DEMO_AGENT_STRIP debug seed when gateway agents.list empty).
