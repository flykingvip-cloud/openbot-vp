# OpenBot Conversation Lifecycle Tasks

## Agents

- cursor-conversation-lifecycle · role: owner · scope: getMemorySearchManager data-plane contract (tenantId/dataPlaneId/dataRoot wiring for purge isolation); unlocks PR #709 diagnostic delta · paths: src/memory/search-manager.ts, src/memory/search-manager.dataplane.test.ts, src/memory/index.ts, src/conversations/purge/real-adapters.dataplane.test.ts, .kiro/specs/openbot-conversation-lifecycle/tasks.md, .loom/registry.yaml · since: 2026-08-25
- cursor-conversation-lifecycle · role: owner · scope: CL wrap-up (deny watermark, UI mount, sessionKey match, recall-deny, history cursor UI, sessions projection, retention cron, CogniWeave source lifecycle, i18n) · paths: .kiro/specs/openbot-conversation-lifecycle/**, .loom/registry.yaml, src/gateway/server-methods/chat.ts, src/gateway/server-methods/chat.restore.test.ts, src/gateway/server-methods/chat.history-cursor.test.ts, src/gateway/server-methods/sessions.ts, src/gateway/session-utils.types.ts, src/gateway/server-cron.ts, src/gateway/server.impl.ts, src/gateway/transcript-truncate.ts, src/conversations/**, src/memory/recall-deny-filter.ts, src/memory/recall-deny-search-wrapper.ts, src/memory/search-manager.ts, src/memory/revoke-outbox-drain.ts, src/memory/session-source-wiring.test.ts, src/memory/cogniweave-manager.ts, src/memory/cogniweave-manager.lifecycle.test.ts, src/memory/types.ts, packages/cogniweave-sdk/src/models.ts, packages/cogniweave-sdk/src/index.ts, packages/cogniweave-sdk/src/contracts.ts, packages/cogniweave-sdk/src/runtime/in-memory-engine.ts, packages/cogniweave-sdk/src/runtime/in-memory-engine.lifecycle.test.ts, package.json, .github/workflows/ci.yml, ui/src/ui/app.ts, ui/src/ui/app-render.ts, ui/src/ui/app-view-state-shell-slices.ts, ui/src/ui/controllers/chat.ts, ui/src/ui/controllers/chat.test.ts, ui/src/ui/capability/chat/facade.ts, ui/src/ui/views/chat.ts, ui/src/i18n/locales/en.ts, ui/src/i18n/locales/zh-CN.ts, ui/src/ui/ports/employee/conversation-i18n.node.test.ts, ui/src/ui/chat-session-key-match.ts, ui/src/ui/chat-session-key-match.node.test.ts, ui/src/ui/ports/employee/conversation-lifecycle-wire.ts, ui/src/ui/ports/employee/render-model.ts, ui/src/ui/ports/employee/views/workbench-stage-conversation.ts, ui/src/ui/ports/employee/views/workbench-stage-contracts.ts, ui/src/ui/ports/employee/views/workbench-types.ts, ui/src/ui/ports/employee/views/workbench-conversation-panel.ts, ui/src/ui/controllers/conversations.ts · since: 2026-07-19
- codex-conversation-lifecycle · role: contributor · scope: conversation lifecycle domain, gateway RPCs, and design docs · paths: docs/design/openbot-conversation-lifecycle-_.md, .kiro/specs/openbot-conversation-lifecycle/**, src/conversations/**, src/gateway/server-methods/conversations.ts, src/gateway/server-methods.ts, src/gateway/server-methods-list.ts, src/gateway/method-scopes.ts, src/memory/recall-deny-filter.ts, src/memory/revoke-outbox-drain.ts, src/memory/session-catalog-identity.ts, src/memory/session-source-index.ts, src/memory/session-_.test.ts, src/context-engine/legacy.ts, src/context-engine/legacy.budget.test.ts, src/context-engine/types.ts, packages/cogniweave-sdk/src/models.ts, packages/cogniweave-sdk/src/index.ts, ui/src/ui/controllers/conversations.ts, ui/src/ui/controllers/conversations.node.test.ts, ui/src/ui/ports/employee/conversation-lifecycle-wire.ts, ui/src/ui/ports/employee/views/workbench-conversation-panel.ts · since: 2026-07-17

## Documentation

- [x] Verify the conversation lifecycle proposal against the current CogniWeave and OpenBot storage architecture. — codex-conversation-lifecycle
- [x] Finalize the implementation-ready v1.1/v1.2 plan with tenant routing, stable source identity, lifecycle governance, migration, and quality gates. — codex-conversation-lifecycle

## Implementation

- [x] Complete P0 domain, tenant data plane, and Catalog contracts (library + tests). — codex-conversation-lifecycle
- [x] Complete Purge FSM + real adapters (gateway `conversations.purge` registered; full CogniWeave SDK archive/restore/forget/purge still pending). — codex-conversation-lifecycle
- [x] Deliver Conversation Gateway API registration (`conversations.*` in handlers/list/scopes) + LegacyContextEngine budget/projection hooks + SourceLifecycleSelector. — codex-conversation-lifecycle
- [x] Complete CogniWeave manager runtime: `archiveSource`/`restoreSource`/`forgetSource`/`purgeSource`（SDK + applyTranscriptSourceLifecycle）；`chat.restore` outbox 走真实 forget。 — cursor-conversation-lifecycle
- [x] Recall-deny production filter: `getMemorySearchManager` 统一 wrap；`chat.restore` 后 kick `drainRevokeOutbox`。 — cursor-conversation-lifecycle
- [x] `chat.restore` deny watermark (B6): truncate 后 `commitTranscriptRangeRevoked` fail-closed；restore 测试覆盖 denied message ids。 — cursor-conversation-lifecycle
- [x] Employee UI mount (CL-P1-03): AppViewState `@state` + stage `conversationCatalogPanel` + wire export。 — cursor-conversation-lifecycle
- [x] Conversation 面板 i18n：`frontstage.workbench.conversations.*` en/zh-CN + `chat.loadEarlier`。 — cursor-conversation-lifecycle
- [x] UI `chat.history` load-more：`loadOlderChatHistory` + thread「加载更早」按钮（`nextBefore`）。 — cursor-conversation-lifecycle
- [x] Steward `sessionKey` 等价匹配：`areChatSessionKeysEquivalent` 接入 `handleChatEvent`。 — cursor-conversation-lifecycle
- [x] Wire `chat.history` cursor (`before` / `nextBefore` / `hasMore`，flag `historyCursorEnabled`)。 — cursor-conversation-lifecycle
- [x] Fix `ChatHistoryParamsSchema.before` 漏提交（否则 load-more 被 additionalProperties 拒绝）。 — cursor-conversation-lifecycle
- [x] CI `test:conversation-lifecycle` script + matrix lane。 — cursor-conversation-lifecycle
- [x] Wire `sessions.list` Conversation projection（catalog + lazyBackfill）。 — cursor-conversation-lifecycle
- [x] Retention cron bootstrap（gateway `ensureConversationRetentionCronJob` + systemEvent intercept）。 — cursor-conversation-lifecycle
- [x] Remediation §2.5：archive/restore 幂等重试仍补偿 CogniWeave（稳定 operationId + 回归测试）。 — cursor-conversation-lifecycle
- [x] Fix getMemorySearchManager data-plane contract: accept and honor tenantId/dataPlaneId/dataRoot so conversation purge MEMORY_REVOKE targets planeDataRoot (unblocks PR #709 diagnostic delta). — cursor-conversation-lifecycle
