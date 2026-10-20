# Stage 3.5 — Prior-design restore (calibrated)

Stacked on `app/stage34-four-tab-sot-pages` (PR #280). Restores / locks only what **prior design notes ∩ stage22→34 evidence READMEs ∩ Desktop HTML SoT** agree on. Preview supersets contradicted by stage31–34 intentional gaps are **not** implemented on Android.

Desktop SoT: `/Users/daniel/Desktop/openbot-four-tab-frontend-preview/` (open via `python3 -m http.server 8765 --bind 127.0.0.1` for mic).

## IMPLEMENT (kept / verified)

| Item | Android | Web / evidence |
| --- | --- | --- |
| Send → stop square → `chat.abort` | ChatComposer + `abortChat` | stage27/33 |
| Attach capsules | ChatAttachments | stage33 ← `views/chat.ts` |
| Pink「知识库」capsule | KnowledgeCapsuleViews | stage27/32 |
| Strip icon-above-name, steward first, **no TO:** | AgentStripViews / ChatSheetContent | stage34 |
| Chat「打开成果」footer | DeliverableFooter | stage25 |
| Tasks 定时任务\|待我处理 + 接受/完成 **without** deliverable card | MobileTasksScreen | stage28/34 |
| Create bots/spaces via **我的→更多** | MeTabScreen CreateBot/CreateGroup | stage30 Me |
| Mic → VoiceTabScreen / TalkMode | ChatSheetContent overlay | stage33 (Web mic disabled) |

## DO NOT IMPLEMENT (ignored notes — preview-only supersets)

| Note | Why ignored |
| --- | --- |
| Mic → playable voice bubble in chat | stage33: Web chat mic disabled; TalkMode separate |
| Strip drag-reorder persistence | stage31–34: Web does not persist strip order |
| Strip「+」create wizard | Create via 我的→更多 (agents.create / spaces) |
| Task detail「任务成果」+「打开全文」fullscreen | stage28/31/34: Web assigned-tasks has no result preview |
| stage30 Shell WebView embed as primary | Parallel route; native Compose + HTML remain SoT |

## Optional visual (this PR — cheap, preview-aligned)

| Item | Change |
| --- | --- |
| 📌 on steward | `AgentStripChip` when `id == BUILTIN_STEWARD_NAV_ID` |
| Collab corner radius | Collaboration chips `16.dp` vs assistants `14.dp` |
| Green/red status dots | **Not** ported (stage23 locks numeric badge ≤9) |

## Build / emulator

```bash
export JAVA_HOME="$(/usr/libexec/java_home -v 17)"
cd apps/android
./gradlew :app:assembleDebug
adb -s emulator-5554 install -r app/build/outputs/apk/debug/openbot-1.0.0-debug.apk
```

**Do not merge to main** — stacked review only.
