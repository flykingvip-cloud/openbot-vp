# Knowledge Consume Precision

## Agents

- cursor-knowledge-consume · role: owner · scope: runtime-first typed knowledge identity, deterministic evidence, consume receipts, and the approved P2 parent-scoped chat selection protocol · paths: `.kiro/specs/knowledge-consume-precision/**`, `docs/design/knowledge-consume-precision-plan-2026-08-26.md`, `apps/macos/Sources/OpenBotProtocol/GatewayModels.swift`, `apps/shared/OpenBotKit/Sources/OpenBotProtocol/GatewayModels.swift`, `src/gateway/knowledge/**`, `src/gateway/context-scope/**`, `src/gateway/protocol/schema/logs-chat*.ts`, `src/gateway/server-methods/chat*.ts`, `src/gateway/server-methods/knowledge.ts`, `src/auto-reply/reply/get-reply-run.ts`, `src/auto-reply/reply/knowledge-universe-context*.ts`, `ui/src/ui/app-chat.ts`, `ui/src/ui/controllers/chat*.ts`, `ui/src/ui/test-helpers/chat-context-scope-send.ts`, `ui/src/ui/views/chat-context-scope-send.browser.test.ts` · since: 2026-08-26

## G0 decision

- [x] Use path A (runtime first): keep chat picker and CSC protocol out of this delivery until a separate protocol PR lands. — cursor-knowledge-consume
- [x] Base implementation on freshly fetched `origin/main` (`83c6718cb74373a1aa8144f89e81b724c3d5e8a2`) in an isolated worktree. — cursor-knowledge-consume
- [x] Preserve `runKnowledgeRuntimeEngine` as the only public composition pass; do not introduce a parallel assembler or prompt builder. — cursor-knowledge-consume

## Runtime-first delivery

- [x] P0: add typed consume refs, canonical keys, controlled legacy resolution, and fail-closed ambiguity. — cursor-knowledge-consume
- [x] P0: remove bare-ID fan-out from governance writeback and preserve parent/domain scope in object filtering. — cursor-knowledge-consume
- [x] P0: default live API policy to denied unless an explicit typed API ref or audited policy permits it. — cursor-knowledge-consume
- [x] P1: extract the preview read fallback into one shared document-content primitive. — cursor-knowledge-consume
- [x] P1: resolve selected files deterministically by `parentId + id`, with exact original/local-index/chunk fallback. — cursor-knowledge-consume
- [x] P1: emit exactly one auditable consume receipt for each explicit selection in the runtime result. — cursor-knowledge-consume
- [x] P1: delete query-keyword connector expansion from the runtime evidence path. — cursor-knowledge-consume
- [x] P1: add deterministic deliverable-body and bounded folder-child evidence instead of object-only/unavailable receipts. — cursor-knowledge-consume
- [x] Verify 44 focused runtime, identity, preview, and policy tests plus targeted Oxlint. — cursor-knowledge-consume
- [ ] Clear trunk-wide pre-existing `pnpm tsgo` / `pnpm check` failures outside this task; no changed knowledge-consume file appears in the TypeScript failures.

## P2 selection protocol

- [x] Preserve `parentId` from the client `chat.send.contextScope` payload through gateway validation and CSC source parsing. — cursor-knowledge-consume
- [x] Resolve legacy parentless child ids only when the authorized catalog has one canonical match; reject cross-parent collisions as `ambiguous_identity`. — cursor-knowledge-consume
- [x] Map authorized CSC sources to `KnowledgeConsumeRef[]` and pass them into the existing `runKnowledgeRuntimeEngine` composition pass. — cursor-knowledge-consume
- [x] Stop lowering focused file, folder, and API selections into bare `requestedObjectIds`. — cursor-knowledge-consume
- [x] Return consume receipts through the cognitive adapter/runtime-context RPC and record them in chat stage diagnostics and context-scope audit. — cursor-knowledge-consume
- [x] Forward `contextScope` through direct 1:1 `chat.send` dispatch and regenerate the Swift protocol clients from the authoritative schema. — cursor-knowledge-consume
- [x] Verify 53 focused protocol, CSC, authorization, adapter, audit, runtime-context, gateway dispatch, and client transport tests plus targeted Oxlint. — cursor-knowledge-consume
- [x] Add Chromium composer + real WebSocket/Gateway E2E proving parentId survives UI send and 1:1 dispatch (shared fixture; production picker now sends parentId). — cursor-knowledge-consume
- [x] Authorization exceptions fail closed: optional sources are cleared, optional retrieve is skipped, and deniedSources are recorded. — cursor-knowledge-consume
- [x] Explicit API refs require an authorizing live policy; query keywords never select connectors. — cursor-knowledge-consume
- [x] Auto-reply consumes knowledge through one `runKnowledgeRuntimeEngine` composition pass; engine failure does not inject a parallel file prompt. — cursor-knowledge-consume
- [x] Add the first-party visual catalog picker and receipt status display; picker send keeps parentId, and consume receipts render under the context tab. — cursor-knowledge-consume

## Deferred by the G0 decision

- [ ] P3: unify live-source and derived-snapshot semantics after runtime-first receipts are established.
- [ ] P4: migrate knowledge assets out of the skill lifecycle as a separate governance task.
