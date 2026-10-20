# CogniWeave Memory Engine v2 Tasks

## Agents

- cursor-conversation-lifecycle · role: owner · scope: CW2 P0–P6 MemorySubject / sync / Memory Center · paths: packages/cogniweave-sdk/**, src/config/data-space.ts, src/config/cogniweave-migration.ts, src/config/cogniweave-migration.test.ts, src/config/types.memory.ts, src/config/zod-schema.ts, src/memory/backend-config.ts, src/memory/backend-config.test.ts, src/memory/cogniweave-manager.ts, src/memory/cogniweave-cloud-sync-drain.ts, src/memory/cogniweave-cloud-sync-drain.test.ts, src/memory/memory-center-atoms.ts, src/memory/memory-center-atoms.test.ts, src/memory/search-manager.ts, src/memory/cogniweave-manager*.test.ts, src/memory/types.ts, src/memory/recall-deny-search-wrapper.ts, src/data/memory-lifecycle.ts, src/data/memory-lifecycle.test.ts, src/config/data-space.test.ts, src/gateway/server-methods/memory-center-access.ts, src/gateway/server-methods/memory-center-access.test.ts, src/gateway/server-methods/agents.ts, src/gateway/server-methods/data.ts, ui/src/ui/ports/employee/views/memory-center-page.ts, ui/src/ui/ports/employee/views/memory-center-page.node.test.ts, ui/src/ui/ports/employee/render-model-memory-center.ts, ui/src/ui/ports/employee/render-model.ts, ui/src/ui/ports/employee/views/workbench*.ts, ui/src/ui/app.ts, ui/src/ui/app-view-state-shell-slices.ts, .kiro/specs/cogniweave-memory-engine-v2/**, docs/design/openbot-cogniweave-memory-engine-v2-implementation-plan-2026-07-16.md, docs/design/openbot-cogniweave-cw2-remediation-execution-instruction-2026-07-18.md, .loom/registry.yaml, package.json · since: 2026-07-19
- codex-cogniweave-v2 · role: contributor · scope: CogniWeave v2 implementation and remediation documentation · paths: docs/design/openbot-cogniweave-memory-engine-v2-implementation-plan-2026-07-16.md, docs/design/openbot-cogniweave-cw2-remediation-execution-instruction-2026-07-18.md, .kiro/specs/cogniweave-memory-engine-v2/\*\* · since: 2026-07-16

## Documentation

- [x] Audit the current OpenBot and CogniWeave memory architecture and record the implementation baseline. — codex-cogniweave-v2
- [x] Define the phased v2 implementation plan, migration strategy, quality gates, and commercial readiness criteria. — codex-cogniweave-v2
- [x] Re-audit current/release branch integrity and publish the Grok remediation execution instruction. — codex-cogniweave-v2

## Implementation

- [x] Complete P0 write-operation idempotency and restart recovery.（SDK：op-key + writeBack 短路 + recoverFromCanonical×100 不增 WRITE + compact/CLI；Ops SLO soak 见 CW2-P0-04） — cursor-conversation-lifecycle
- [x] CW2-P0-00/01（切片）：MemoryPartitionKeyV1 + operationKeyVersion + stableMetadata whitelist；`write_operations` + writeBack 同 key 短路；schema v4 / data_plane_id。 — cursor-conversation-lifecycle
- [x] CW2-P0-02/03（切片）：`recoverFromCanonical`（禁 writeBack replay）+ `compactJournals`（保留 pinned/FAILED）。 — cursor-conversation-lifecycle
- [x] CW2-P0-03 CLI：`doctor` / `recover` / `compact` / `journal-stats`（--dry-run / --keep-completed）。 — cursor-conversation-lifecycle
- [x] CW2-P0-04（切片）：Ops SLO soak — Local SQLite seed + recover p95 预算（CI 默认 800 atoms；`COGNIWEAVE_SLO_SOAK_ATOMS=10000` 验满配 &lt;5s）+ idle DB 不膨胀 + searchEvidence 响应。 — cursor-conversation-lifecycle
- [x] CW2-P1-04（切片）：真实 Postgres 迁移演练 — `createPgSqlClient` + factory client 注入 + Local→Postgres canonical copy + recoverFromCanonical；live test（`COGNIWEAVE_POSTGRES_URL` 或本地 `cogniweave_drill`）。 — cursor-conversation-lifecycle
- [x] SourceBinding Local persistence: `source_bindings` + `source_lifecycle_operations` + engine hydrate/write-through（不含 object_links）。 — cursor-conversation-lifecycle
- [x] CW2-P1-00（evidence 切片）：`source_object_links` Local/InMemory + forget unlink / purge orphan hard-delete；atom provenance recompute 仍待。 — cursor-conversation-lifecycle
- [x] CW2-P1-00（atom 切片）：forget/purge 后 atom provenance recompute；零 live source → deprecated tombstone / purge hard-delete。 — cursor-conversation-lifecycle
- [x] CW2-P1-00（event/relation 切片）：event/relation `source_object_links` ensure + sibling backfill；relation provenance recompute；purge orphan 对 live evidence 保底。 — cursor-conversation-lifecycle
- [x] CW2-P1-00（entity/scenario/problem 切片）：provenance 对象 ensure/recompute/purge orphan；CW2-P1-00 全 objectType 闭环。 — cursor-conversation-lifecycle
- [x] Postgres SourceBinding / object_links / write_operations / data_plane_id parity（schema + adapter CRUD；假 client 单测）。 — cursor-conversation-lifecycle
- [x] Complete canonical lifecycle and Data Space migration.（P1-02a/b/c + P1-03 + P1-04 真实 PG 演练已落地） — cursor-conversation-lifecycle
- [x] CW2-P1-02a（切片）：portable canonical `{dataRoot}/.meta/cogniweave/canonical.sqlite` + legacy stateDir 懒 cutover + `migration_state.json`；manager cache key 含 dataRoot/storePath。完整 FSM / memory-lifecycle→SDK 仍待。 — cursor-conversation-lifecycle
- [x] CW2-P1-03（切片）：export/migration-bundle denylist（outbox/cursors/leases/locks/runtime）；restore 清空 runtime 子树；tenant-import walk 同步过滤。 — cursor-conversation-lifecycle
- [x] CW2-P1-02b（切片）：`memory-lifecycle.ts` → SDK Forget/Purge（仅已索引路径；无投机 SourceBinding）；Data Space unlink 仍保留。完整 migration FSM 仍待。 — cursor-conversation-lifecycle
- [x] CW2-P1-02c（切片）：durable migration FSM（freeze_writes→completed）+ pre-cutover crash rollback + post-cutover roll-forward + switch-back + write-freeze gate。 — cursor-conversation-lifecycle
- [ ] Extend the v2 memory domain and enterprise subject model.（P2 + P3-01/02 已落地；manager 全路径 ACL / Postgres subject parity / completeSeatHandover 接线仍待）
- [x] CW2-P2-01（切片）：Atom additive `privacy` / `lifecycle` / `governance` + `withAtomV2Defaults`（writeBack/merge/upsert）+ identity-boundary strip。 — cursor-conversation-lifecycle
- [x] CW2-P2-02（切片）：admission/retrieval/promotion 分轨评分 + atom type policy registry + dual-source coverage metric。 — cursor-conversation-lifecycle
- [x] CW2-P3-01（切片）：MemorySubject + partition↔subject binding（Local/InMemory）+ authorize（tenant/owner/local sentinel）+ op-key 不变；Postgres/manager 全路径仍待。 — cursor-conversation-lifecycle
- [x] CW2-P3-02（切片）：SDK `applySeatMemorySuccession`（inheritable/review_required/private）+ private 零泄漏 + op-key 不变；completeSeatHandover / manager ACL 接线仍待。 — cursor-conversation-lifecycle
- [ ] Deliver production-shaped local retrieval and performance gates.（P4-01/02 已落地；FTS5 / 真 embedding / reasonWithDebug 迁移 / p95 soak 仍待）
- [x] CW2-P4-01（切片）：scope-aware `queryAtoms`/`queryEvidence` + ACL authorize + lifecycle gate；production 路径不再 `listAtoms` 全表扫。 — cursor-conversation-lifecycle
- [x] CW2-P4-02（切片）：`queryAtomsHybrid`（lexical FTS + optional vector stub + relation boost）+ `listRelationsByNode` + VectorStore.search/delete stub。 — cursor-conversation-lifecycle
- [x] Deliver governed Cloud Intelligence sync and Memory Center UI.（P5 SDK + P6-01/02 + manager outbox drain/mirror pull 接线 + atom 级 Memory Center DTO 已落地；真 HTTP CloudIntelligenceClient 仍待） — cursor-conversation-lifecycle
- [x] CW2-P5-01（切片）：PromotionPolicy + decidePromotion + consent grant/revoke + denylist envelope hygiene（无网络/outbox）。 — cursor-conversation-lifecycle
- [x] CW2-P5-02（切片）：SyncOutbox（InMemory/File@stateDir）+ CloudIntelligenceClient（auth/anti-replay/idempotency/tenant）+ enqueue/drain + revoke→delete_tombstone；manager `cloudSync` 异步 drain 已接线；真 HTTP 仍待。 — cursor-conversation-lifecycle
- [x] CW2-P5-03（切片）：Cloud pull + LocalIntelligenceMirror（InMemory/File@stateDir）+ freshness（fresh/stale/never_synced）+ tombstone 冲突；离线读 last-good；manager mirror pull 已接线；真 HTTP 仍待。 — cursor-conversation-lifecycle
- [x] CW2-P6-01（切片）：Memory Center 用户 UI（个人设置→记忆中心）+ 注册 `data.memory.list` + view/delete via `data.memory.forget`；`atoms[]`/`viewMode` atom 级 DTO 已接线；`data.memory.forgetAtom` 仍待。 — cursor-conversation-lifecycle
- [x] CW2-P6-02（切片）：enterprise admin 禁读员工 private memory（`data.memory.*` + `agents.files.get/set` MEMORY.md 跨员工拒绝）+ `enterprise-memory.governance.overview`（org-scope 元数据 only）+ 企业数据能力中心「记忆范围」段；succession 接线仍待。 — cursor-conversation-lifecycle
