# Stage 2.9 — Knowledge tab Web-aligned (slice 3)

SoT: **我的知识库** tree + search; tap doc → fullscreen (tree → left rail).

## Web flows mirrored (do not invent Android-only knowledge system)

| Concern | Web SoT | Gateway / shared Android |
| --- | --- | --- |
| Catalog tree 个人/团队/企业 | `ui/src/ui/chat/context-scope.ts` + `context-scope-catalog.ts` | same as Chat capsule: `context.scope.sources.catalog` → `knowledge.base.list` + `knowledge.base.sources.list` |
| Picker / section labels | `ui/src/ui/views/chat-context-scope.ts` + cockpit `knowledge-universe-cockpit-tree.ts` | Chat capsule keeps 个人/团队/企业; Knowledge tab uses 个人空间/团队空间/企业空间 |
| Home cockpit rail + doc reader | `ui/src/ui/views/knowledge-universe-home-cockpit.ts` + `knowledge-universe-home-document-reader.ts` | fullscreen + collapsed left rail |
| Document preview | `ui/src/ui/controllers/knowledge-universe-document-reader.ts` | `knowledge.document.preview` |
| Visual SoT | four-tab preview `knowledge-tree.jpg` / `knowledge-fullscreen.jpg` | — |

Chat pink「知识库」capsule stays on the **same** catalog StateFlow (`chatContextSourceCatalog` / `refreshChatContextCatalog`) — no second catalog system.

## Gaps

- Favorites funnel (Web `收藏`) shown as empty section — not in context-scope catalog payload.
- Full HTML iframe / rich renderKind from preview reduced to plain/markdown text on phone.
- Create-folder「+」/ rename / ⋯ menus from cockpit tree not ported.
- Client-side tree filter only (same as Chat capsule); dedicated `knowledge.search` RPC list UI deferred.

## Test

- `./gradlew :app:compileDebugKotlin`
- `./gradlew :app:testDebugUnitTest --tests ai.openbot.app.ui.KnowledgeBrowserModelsTest --tests ai.openbot.app.chat.ChatContextScopeTest`
