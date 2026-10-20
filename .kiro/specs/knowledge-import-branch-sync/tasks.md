# knowledge-import-branch-sync

## Agents

- grok · role: owner · scope: merge localFolder + passive connector import package into fix-scoped-package-templates; reconcile cloud-drive; closed-loop verify · paths: `src/gateway/knowledge/**`, `src/gateway/server-methods/knowledge.ts`, `src/gateway/server-methods-list.ts`, `src/gateway/method-scopes.ts`, `src/gateway/server-startup.ts`, `src/gateway/server-http.ts`, `ui/src/ui/views/knowledge-universe-space-import*`, `ui/src/ui/controllers/knowledge-universe-local-folder.ts`, `ui/src/ui/controllers/knowledge-universe-passive-connector.ts`, `ui/src/ui/capability/knowledge-universe/**`, `ui/src/ui/ports/employee/views/home-page-contracts.ts`, `ui/src/ui/ports/employee/render-model.ts`, `ui/src/ui/app.ts`, `ui/src/ui/app-view-state-shell-slices.ts`, `ui/src/i18n/locales/**`, `.kiro/specs/knowledge-import-branch-sync/**`, `docs/design/grok-knowledge-import-branch-sync-execution-instruction-2026-07-20.md` · since: 2026-07-20

## Status

- [x] Backend local-folder + passive-connector package — grok
- [x] RPC list + scopes + startup watcher — grok
- [x] UI import funnel + SpaceImportKind + render-model/i18n wiring — grok
- [x] Cloud-drive reconcile (baidu/aliyun/quark + OAuth HTTP register) — grok
- [x] Scoped unit/UI tests (46 passed) — grok
- [x] Golden path E2E (`src/gateway/knowledge/sources/local-folder-import.golden-path.test.ts`) — grok
- [ ] Deploy — **未部署**

## Merge commits on `fix-scoped-package-templates`

1. `69b62c2a31` feat(knowledge): localFolder + passive connector gateway (P0–P5)
2. `b4a4783fb6` feat(gateway): register local-folder and passive connector methods
3. `87be1721a5` feat(gateway): resume local-folder watchers on startup
4. `5c6a63478b` feat(ui): localFolder and passive connector import funnel
5. `6513be67ef` feat(ui): wire localFolder import into app state and render-model
6. `7421efcd7c` feat(knowledge): align cloudDrive providers with baidu/aliyun/quark
7. `15addf5373` feat(gateway): register cloud-drive OAuth HTTP callback

## Remaining gaps (do not claim releasable)

- ~~No golden-path E2E~~ — added `local-folder-import.golden-path.test.ts` (team KB → bind → scan → search → sources → runtime/workspace → reload).
- `gitRepo` / `mailAttachment` remain bind-scaffold (`ready: false`); cloudDrive marked ready but full OAuth UI / credential UX may still need follow-up beyond Baidu HTTP callback.
- Aliyun/Quark OAuth HTTP not implemented (adapters + credentials only).
