# OpenBot default capability P0

第一批：八类能力矩阵、上下文开关与运行时一致、builtin 记忆剩余闭环。不合并，不部署。

## Agents

- cursor-grok-default-capability · role: owner · scope: P0 context/memory + P1-C privateMemory promote RPC + P1-D learning skill draft closed loop + P1-E shadow intent authorize + P1-F knowledge materialization false-availability + P2-G platform models smart config + P2-H cron closed-loop · paths: src/conversations/flags.ts, src/conversations/flags.test.ts, src/context-engine/legacy.ts, src/context-engine/types.ts, src/context-engine/registry.ts, src/context-engine/legacy.default-capability.test.ts, src/memory/collaboration-index-scope.ts, src/memory/collaboration-index-scope.test.ts, src/memory/manager.ts, src/memory/manager-sync-ops.ts, src/memory/search-manager.ts, src/memory/manager.collab-continuity.test.ts, src/memory/search-manager.managed-tool-profile.test.ts, src/gateway/collaboration-learning/private-memory-promote-entry.ts, src/gateway/collaboration-learning/private-memory-promote-entry.test.ts, src/gateway/server-methods/collaboration-learning.ts, src/gateway/server-methods/collaboration-private-memory-promote.test.ts, src/gateway/server-methods-list.ts, src/gateway/method-scopes.ts, src/auto-reply/reply/learning-skill-curation.ts, src/gateway/collaboration-learning/learning-skill-draft-entry.ts, src/gateway/collaboration-learning/learning-skill-draft-entry.test.ts, src/gateway/collaboration-learning/learning-skill-draft-closed-loop.test.ts, src/gateway/server-methods/collaboration-learning-skill-draft.test.ts, src/gateway/evolution-control/authorize-shadow-intent.ts, src/gateway/evolution-control/authorize-shadow-intent.test.ts, src/gateway/server-methods/evolution-control.ts, src/gateway/server-methods/evolution-control.pack.ts, src/gateway/server-methods/packs/manifest.ts, src/gateway/enterprise-data/knowledge-publication.ts, src/gateway/enterprise-data/knowledge-publication.test.ts, src/gateway/enterprise-data/enterprise-knowledge-projection-binding-store.ts, src/gateway/enterprise-data/source-connection-probe.ts, src/gateway/enterprise-data/connector-handler-runtime.ts, src/gateway/enterprise-data/connector-handler-runtime.test.ts, src/gateway/enterprise-data/connector-catalog.test.ts, src/gateway/server-methods/enterprise-data-m4.ts, src/gateway/server-methods/enterprise-data-m4.test.ts, src/gateway/model-entitlement/aor-selection.ts, src/gateway/model-entitlement/aor-selection.test.ts, src/gateway/model-entitlement/aor-catalog-adapter.ts, src/gateway/model-entitlement/aor-catalog-adapter.test.ts, src/gateway/model-entitlement/employee-model-gate.ts, src/gateway/models/platform-models-config.p2g.test.ts, src/agents/model-fallback.p2g-outbound.test.ts, src/cron/isolated-agent/run.ts, src/cron/isolated-agent/run.long-horizon-ledger.test.ts, src/gateway/server.cron.test.ts, src/gateway/enterprise-data/event-driven-projection-materializer.ts, src/gateway/enterprise-data/event-driven-projection-materializer.test.ts, src/gateway/server-methods/enterprise-data-events.ts, src/cron/service.delivery-adapter-evidence.p2h.test.ts, docs/design/evidence/openbot-default-capability-matrix-2026-10-30.md, docs/design/collab-context-p3-private-memory-promote-2026-10-14.md, .kiro/specs/openbot-default-capability-p0/\*\* · since: 2026-10-30

## Takeover note

`openbot-conversation-lifecycle:codex-conversation-lifecycle` 仍为 active，`lastSignalAt` 为 2026-07-16。工作区在基线上是干净的，没有该任务的未提交 WIP。本任务只登记上面的精确路径，不接收 `src/conversations/**`、`package.json`、`.github/workflows/ci.yml` 或 UI。

`conversation-lifecycle-memory-search-dataplane` 对 `src/memory/search-manager.ts` 的 lander 信号停在 2026-08-25，同样没有脏 WIP。本 PR 只增加 managed continuity profile 的 fail-closed，以及把 caller 身份传给 builtin manager。

## Checklist

- [x] 能力矩阵写入 `docs/design/evidence/openbot-default-capability-matrix-2026-10-30.md` — cursor-grok-default-capability
- [x] P0-A：无 env + 默认配置产生 budgetTrace；显式开关；env 覆盖 config；afterTurn 投影被下一轮消费并在新引擎实例中仍在 — cursor-grok-default-capability
- [x] P0-B：小组文件 add/modify/delete 不强制 sync；跨租户同名组隔离；撤权后旧 manager 无 snippet；FTS-only 降级报告；managed 工具路径 fail-closed — cursor-grok-default-capability
- [x] P1-C：`collaboration.learning.privateMemory.promote` 生产入口（flag 默认仍 OFF；RPC+tests；无 UI）— cursor-grok-default-capability
- [x] P1-D：学习策展 draft owner 戳记 + skillDraft.list/finalize + install/remove + identity **execute**/归因 + revoke 停用；ownerless 组草稿覆盖边界 — cursor-grok-default-capability（已推送待复验）
- [x] P1-E：assist-shadow DISCOVERED → `evolution.proposals.authorize` → experiment/Apply/rollback（skill-installation；runtime-binding observe-only）— cursor-grok-default-capability
- [x] P1-F：虚假可用性修复保留；最小 event_driven 物化（`runEventDrivenProjectionsForEvent` + events.ingest）；完整 KB 目标未宣称 — cursor-grok-default-capability（已推送待复验）
- [x] P2-G：合成中性不得冒充已验证优化；partial catalog 合成项不进 rankModels；preferredOrder→outbound primary；native 合法默认 — cursor-grok-default-capability（已推送待复验）
- [x] P2-H：完成 ledger 空完成误报修复 + gateway CRUD 容忍 retention；单元+adapter 送达证据（真实 HTTP 未跑）— cursor-grok-default-capability（已推送待复验）

## 验收回退修复（A/B）

- [x] A: toolCall/toolResult 单元裁剪 + assemble 后 sanitize（context-assemble / legacy / attempt）
- [x] B: INDEX_CACHE_PENDING epoch 撤权，过期 pending 不发布
- 状态：部分验证；交新 SHA 由验收方复验，不自行宣告 P0 通过

## 第二轮回退

- [x] 过期 pending orphan 跟踪 + closeAll 释放 SQLite
- [x] runEmbeddedAttempt 真实边界配对测试
- check/build 证据随本轮提交

## 验收回退修复（P1-C / P1-E）

- [x] P1-C：policy-before-write；稳定 `proj:`/`asset:` 幂等 id；RPC 可信 tenant/stores → entry（managed fail-closed）— 已推送待复验 / 部分验证（已推送≠验收通过）
- [x] P1-E：authorize `existingEvent` / APPROVED 早退前校验 trusted tenant+principal+grant；撤销/过期 fail-closed；拒绝不泄漏越权正文；replay 正负矩阵 — 已推送待复验 / 部分验证
- 状态：已推送待复验；交新 SHA 由验收方复验，不自行宣告通过

## 验收回退修复（P1-D / P1-F / P2-G / P2-H）

- [x] P1-D：closed-loop 补 identity tool `execute` + start/result 归因 + remove 后停归因；ownerless 组草稿记为覆盖边界 — 已推送待复验 / 部分验证
- [x] P1-F：最小 `runEventDrivenProjectionsForEvent` + events.ingest 接线；event_driven 可写；不宣称 durable queue/完整 KB — 已推送待复验 / 部分验证
- [x] P2-G：partial catalog 合成档案不进 `rankModels`（追加保集合）；合成中性不得赢 cheapest — 已推送待复验 / 部分验证
- [x] P2-H：adapter 送达证据（dispatch→deliverOutboundPayloads→CronService persist）；真实 HTTP 仍缺 — 已推送待复验 / 部分验证
- 仍已知缺口：真实 HTTP/provider；ownerless 组草稿；P1-F durable restart/限流；P2-H live channel
- 状态：已推送待复验；**已推送≠验收通过**；不自行宣告通过
