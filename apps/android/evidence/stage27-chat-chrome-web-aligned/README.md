# Stage 2.7 — Chat chrome Web-aligned (Slice 1)

Branch: `app/stage27-chat-chrome-web-aligned` (off stage26 tip).

## Implemented
- Agent Strip: icons + names under; 管家/steward fixed first via existing `agents.list` nav model (no Android-only roster).
- Pink「知识库」capsule + bottom-sheet tree (个人/团队/企业, chevron expand, cascade select) using Web context-scope semantics.
- Catalog RPCs: `context.scope.sources.catalog` → fallback `knowledge.base.list` + `knowledge.base.sources.list`.
- `chat.send` `contextScope` payload via Web `toChatSendContextScope`.
- Composer SoT: white pill — 📎 | 「继续输入消息...」 | 🎤 | red circular send → stop square + `chat.abort` while running.
- Attachments: existing image attach pipeline unchanged.
- Pull-to-reconnect: kept from stage26.

## Gaps / later
- Agent strip drag-reorder: SoT preview has it; Web `workbench-chrome` does **not** persist reorder — skipped (no parallel Android-only order store).
- Mic recording → voice bubble: chrome affordance present; recording still TalkMode path (not re-invented here).
- Tasks / Knowledge tab / Me hub: out of scope for this slice.

## Web files mirrored
- `ui/src/ui/chat/context-scope.ts`
- `ui/src/ui/chat/context-scope-catalog.ts`
- `ui/src/ui/views/chat-context-scope.ts`
- `ui/src/ui/app-chat.ts` (`handleAbortChat` / send `contextScope`)
- `ui/src/ui/ports/employee/views/workbench-nav-model.ts` / `workbench-chrome.ts` (strip roster + badge)
- Four-tab SoT preview composer (`web-composer-sot.png` / `index.html`)

## Verify
```bash
cd apps/android
./gradlew :app:compileDebugKotlin :app:testDebugUnitTest \
  --tests ai.openbot.app.chat.ChatContextScopeTest \
  --tests ai.openbot.app.ui.chat.AgentStripNavTest
```
