# OpenBot 数据存储治理代码与组件审查索引

> 用途：配合 `docs/design/openbot-data-storage-governance-implementation-summary-2026-08-28.md`，帮助第三方专家在 GitHub 上定位本次任务形成的代码、测试、证据和生产门禁。  
> 清单基线：`origin/main@b7ebb6b893`（2026-08-28 本地最后一次成功 fetch 后的主干）。  
> 仓库：<https://github.com/gmood2008/openbot>。  
> 注意：`main` 会继续前进。正式验收应记录实际 review SHA，并使用该 SHA 替换 URL 中的 `main`，形成不可变审查链接。

## 1. 建议审查顺序

1. 先读类型、Envelope、Catalog 和 ownership proof。
2. 再读 Workspace Resolver，确认 authorize-before-resolve 和 fail-closed。
3. 审查 Lifecycle 的状态机、receipt、marker 和 destructive adapter。
4. 审查 Cognitive Governance 的身份、CAS fencing、promotion、revoke 和 anchor。
5. 审查 Placement、Export/Restore 和长期运维组件。
6. 审查旧数据迁移与 Item 7 retirement，确认生产仍保留的路径。
7. 最后审查 delivery gate、release ledger 和当前 canonical evidence。

## 2. 组件总览

| 领域                 | GitHub 入口                                                                                                                                 | 主要职责                                                              | 当前边界                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------ |
| Data Governance 核心 | [src/gateway/data-governance](https://github.com/gmood2008/openbot/tree/main/src/gateway/data-governance)                                   | Catalog、Envelope、生命周期、认知治理、放置、迁移、长期运维           | first-wave 主体已落地    |
| Workspace Resolver   | [src/gateway/workspace-resolver](https://github.com/gmood2008/openbot/tree/main/src/gateway/workspace-resolver)                             | 统一授权解析、canonical/target binding、受限 locator/handle、tool cwd | managed 收敛进行中       |
| Memory 接入          | [src/memory](https://github.com/gmood2008/openbot/tree/main/src/memory)                                                                     | Memory identity、root guard、Stage C index、Stage D sync              | Stage C/D 未完成生产切换 |
| Gateway shadow 接入  | [src/gateway/item7-stage-c-identity-shadow.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/item7-stage-c-identity-shadow.ts) | Stage C managed identity 只读 shadow                                  | 默认关闭、非生产 switch  |
| Inventory/Audit      | [scripts/audit](https://github.com/gmood2008/openbot/tree/main/scripts/audit)                                                               | Workspace inventory 和隔离 probe                                      | 只读证据工具             |
| Delivery Governance  | [scripts/delivery](https://github.com/gmood2008/openbot/tree/main/scripts/delivery)                                                         | LIVE 解析、forward-only、账本、merge-back、retire plan                | 生产硬门禁               |
| Production scripts   | [deploy/production/scripts](https://github.com/gmood2008/openbot/tree/main/deploy/production/scripts)                                       | forward-only 和 delivery alignment shell gate                         | 部署前必须通过           |
| Canonical evidence   | [docs/design/evidence](https://github.com/gmood2008/openbot/tree/main/docs/design/evidence)                                                 | 状态、扫描、receipt、handoff 的机器可读证据                           | 状态判断 SoT 之一        |

## 3. P0/P1：身份、Catalog、Envelope 与 Resolver

### 3.1 类型与 Envelope

- [types.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/data-governance/types.ts)：资源、owner scope、binding、生命周期等基础类型。
- [envelope.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/data-governance/envelope.ts)：Data Governance Envelope 的核心构建与验证。
- [envelope-cognitive.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/data-governance/envelope-cognitive.ts)：认知资产 Envelope 扩展。
- [envelope.test.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/data-governance/envelope.test.ts)：Envelope 正负向合同。

专家应确认：资源身份与存储路径分离；tenant/owner/lifecycle 字段不能由不可信 wire 任意覆盖；非法 scope 和缺失身份必须拒绝。

### 3.2 Ownership 与资产身份

- [ownership-proof.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/data-governance/ownership-proof.ts)：OwnershipProof 类型和匹配规则。
- [agent-asset-manifest.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/data-governance/agent-asset-manifest.ts)：Agent 资产 manifest。
- [agent-asset-manifest-store.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/data-governance/agent-asset-manifest-store.ts)：manifest 持久化。
- [workspace-identity-fail-closed.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/data-governance/workspace-identity-fail-closed.ts)：Workspace 身份缺失/歧义阻断。
- [workspace-identity-fail-closed.test.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/data-governance/workspace-identity-fail-closed.test.ts)：fail-closed 回归测试。

### 3.3 Catalog 与 Binding

- [catalog-store.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/data-governance/catalog-store.ts)：Catalog 的读取、写入与 CAS。
- [catalog-cache.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/data-governance/catalog-cache.ts)：tenant/resource/epoch 相关缓存。
- [bindings.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/data-governance/bindings.ts)：binding 合同与选择规则。
- [runtime-catalog.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/data-governance/runtime-catalog.ts)：运行时 Catalog 入口。
- [workspace-catalog-projection.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/data-governance/workspace-catalog-projection.ts)：Workspace projection。
- [catalog-store.test.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/data-governance/catalog-store.test.ts) 与 [catalog-cache.test.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/data-governance/catalog-cache.test.ts)：唯一性、CAS、缓存隔离测试。

重点审查：一个资源只能有一个 active canonical binding；compatibility/target 不得被普通 resolver 当作 canonical；跨租户、重复和 ambiguous 必须拒绝。

### 3.4 Workspace Resolver

- [resolve.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/workspace-resolver/resolve.ts)：统一 Workspace resolution 主实现。
- [access.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/workspace-resolver/access.ts)：访问决策入口。
- [strict-locator.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/workspace-resolver/strict-locator.ts)：strict canonical locator 和受控 target-binding 查询。
- [types.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/workspace-resolver/types.ts)：resolver query/result/handle 类型。
- [catalog.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/workspace-resolver/catalog.ts)：resolver 的 Catalog adapter。
- [cache.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/workspace-resolver/cache.ts)：解析缓存。
- [tool-cwd.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/workspace-resolver/tool-cwd.ts)：工具工作目录接线。
- [group-read.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/workspace-resolver/group-read.ts)：group read 边界。
- [memory-workspace-resolve.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/workspace-resolver/memory-workspace-resolve.ts)：Memory Workspace 受控解析。
- [strict-locator.test.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/workspace-resolver/strict-locator.test.ts) 与 [workspace-resolver.test.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/workspace-resolver/workspace-resolver.test.ts)：核心 resolver 合同。

## 4. P2：生命周期与删除闭环

### 4.1 状态机与授权

- [lifecycle-transition.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/data-governance/lifecycle-transition.ts)：生命周期状态迁移。
- [lifecycle-access.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/data-governance/lifecycle-access.ts)：actor/command 授权矩阵。
- [lifecycle-receipt-store.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/data-governance/lifecycle-receipt-store.ts)：可恢复 receipt。
- [operation-marker.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/data-governance/operation-marker.ts)：operationId 和磁盘 marker。
- [deletion-auth-marker.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/data-governance/deletion-auth-marker.ts)：删除授权 marker。

### 4.2 Conversation、Memory 与 Purge

- [lifecycle-conversation.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/data-governance/lifecycle-conversation.ts)：Conversation Archive 生命周期。
- [lifecycle-conversation-adapter.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/data-governance/lifecycle-conversation-adapter.ts)：Conversation 存储适配器。
- [lifecycle-memory.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/data-governance/lifecycle-memory.ts)：Memory forget 领域逻辑。
- [lifecycle-memory-staging.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/data-governance/lifecycle-memory-staging.ts)：两阶段 staging。
- [lifecycle-memory-adapter.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/data-governance/lifecycle-memory-adapter.ts)：Memory 物理适配器。
- [lifecycle-purge.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/data-governance/lifecycle-purge.ts)：request/resume purge 主状态机。
- [lifecycle-purge-adapters.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/data-governance/lifecycle-purge-adapters.ts)：物理删除和云墓碑适配合同。
- [lifecycle-durable-fs.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/data-governance/lifecycle-durable-fs.ts)：durable filesystem 操作。
- [lifecycle-adapter-matrix.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/data-governance/lifecycle-adapter-matrix.ts)：first-wave 资源类型能力矩阵。

测试入口：[lifecycle-p2a.test.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/data-governance/lifecycle-p2a.test.ts) 至 [lifecycle-p2e.test.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/data-governance/lifecycle-p2e.test.ts)。重点验证 legal hold、失败后保持 deletion_pending、CAS lose recovery、缺 cloud adapter 拒绝。

## 5. P3：CogniWeave 认知治理

### 5.1 身份、推荐与审批

- [cognitive-recommendation-auth.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/data-governance/cognitive-recommendation-auth.ts)：可信 recommendation caller context。
- [cognitive-approval-auth.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/data-governance/cognitive-approval-auth.ts)：审批 actor 和 delegation 授权。
- [cognitive-recommendation.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/data-governance/cognitive-recommendation.ts)：推荐领域入口。
- [cognitive-recommendation-store.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/data-governance/cognitive-recommendation-store.ts)：推荐持久化。

### 5.2 冲突、合并与恢复

- [cognitive-conflict-graph.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/data-governance/cognitive-conflict-graph.ts)：冲突图和 reservation。
- [cognitive-cas-internal.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/data-governance/cognitive-cas-internal.ts)：内部 CAS 边界。
- [cognitive-merge.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/data-governance/cognitive-merge.ts)：认知合并。
- [cognitive-merge-fencing.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/data-governance/cognitive-merge-fencing.ts)：graph/epoch fencing。
- [cognitive-merge-recovery.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/data-governance/cognitive-merge-recovery.ts)：崩溃恢复。
- [cognitive-merge-reclaim.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/data-governance/cognitive-merge-reclaim.ts)：orphan reclaim。
- [pointer-orphan-reclamation.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/data-governance/pointer-orphan-reclamation.ts)：指针孤儿回收。

### 5.3 Promotion、Provenance、Continuity 与 Anchor

- [cognitive-promotion.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/data-governance/cognitive-promotion.ts)：promotion decision。
- [cognitive-promotion-apply.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/data-governance/cognitive-promotion-apply.ts)：promotion apply、CAS 和 tombstone。
- [cognitive-provenance-store.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/data-governance/cognitive-provenance-store.ts)：provenance。
- [cognitive-anchor.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/data-governance/cognitive-anchor.ts)：anchor lifecycle。
- [cognitive-anchor-store.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/data-governance/cognitive-anchor-store.ts)：anchor 持久化。
- [continuity-longevity.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/data-governance/continuity-longevity.ts)：continuity manifest 和长期连续性。

测试入口为 `src/gateway/data-governance/cognitive-p3a.test.ts` 至 `cognitive-p3g.test.ts`，并包含 promotion、CAS、conflict 和 closure evaluator 的专项测试。

## 6. P4：Placement、Promotion 与 Export/Restore

- [placement-resolve.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/data-governance/placement-resolve.ts)：策略放置解析。
- [placement-platform-root.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/data-governance/placement-platform-root.ts)：平台根边界。
- [placement-platform-bindings.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/data-governance/placement-platform-bindings.ts)：平台 binding。
- [placement-consent-store.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/data-governance/placement-consent-store.ts)：consent 记录。
- [cognitive-promotion-adapters.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/data-governance/cognitive-promotion-adapters.ts)：promotion storage adapter。
- [placement-export.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/data-governance/placement-export.ts)：治理导出与恢复。
- [placement-export-store.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/data-governance/placement-export-store.ts)：导出状态存储。
- [later-wave-cutover-gate.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/data-governance/later-wave-cutover-gate.ts)：later-wave cutover gate。
- [later-wave-production-gate.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/data-governance/later-wave-production-gate.ts)：tenant-cloud/BYOS 等生产资格门禁。

测试入口：`placement-resolve.test.ts`、`placement-export.test.ts`、`cognitive-promotion*.test.ts`、`later-wave-*-gate.test.ts`。专家应确认 later adapter 缺失时拒绝，而不是使用假成功 stub。

## 7. P5：长期运维

- [schema-ladder.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/data-governance/schema-ladder.ts) 与 [schema-ladder-reader.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/data-governance/schema-ladder-reader.ts)：schema/version ladder 和兼容读取。
- [key-rotation.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/data-governance/key-rotation.ts)、[key-rotation-auth.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/data-governance/key-rotation-auth.ts)、[key-rotation-store.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/data-governance/key-rotation-store.ts)：认证密钥轮换。
- [format-migration-locator.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/data-governance/format-migration-locator.ts)：格式迁移、immutable locator CAS 和路径安全。
- [restore-drill.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/data-governance/restore-drill.ts)：恢复演练。
- [exit-export.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/data-governance/exit-export.ts)：租户退出导出/导入合同。
- [longevity-report.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/data-governance/longevity-report.ts)：租户 longevity report。
- [longevity-policy-store.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/data-governance/longevity-policy-store.ts)：长期策略 SLO。

对应测试与实现同名 colocated `*.test.ts`，包括 schema ladder、key rotation、restore drill、exit export、continuity longevity 和 longevity report。

## 8. 旧数据迁移 M0-M4

- [migration-inventory.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/data-governance/migration-inventory.ts)：legacy roots、未知归属和 quarantine inventory。
- [migration-identity-plan.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/data-governance/migration-identity-plan.ts)：旧资源到稳定 identity/canonical target 的迁移计划。
- [migration-apply.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/data-governance/migration-apply.ts)：可恢复迁移应用。
- [migration-verify.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/data-governance/migration-verify.ts)：digest、binding 和结果验证。
- [migration-closure.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/data-governance/migration-closure.ts)：旧根退役与 closure。
- [second-wave-migrate.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/data-governance/second-wave-migrate.ts)：后续资源迁移切片。

对应测试：`migration-inventory.test.ts`、`migration-identity-plan.test.ts`、`migration-apply.test.ts`、`migration-verify.test.ts`、`migration-closure.test.ts`、`second-wave-migrate.test.ts`。

## 9. Memory/Workspace Phase 1B 与 Item 7

### 9.1 Root Guard

- [v1-root-guard.ts](https://github.com/gmood2008/openbot/blob/main/src/memory/v1-root-guard.ts)：旧 SQLite/index root 的 HMAC 授权、冲突检测和 destructive 操作止损。
- [manager-sync-ops.v1-root-guard.test.ts](https://github.com/gmood2008/openbot/blob/main/src/memory/manager-sync-ops.v1-root-guard.test.ts)：sync/reset/prune/rebuild 门禁测试。
- [v1-root-guard.test.ts](https://github.com/gmood2008/openbot/blob/main/src/memory/v1-root-guard.test.ts)：root guard 单测。

### 9.2 Stage C：Memory Index Identity

- [memory-search-governance.ts](https://github.com/gmood2008/openbot/blob/main/src/memory/memory-search-governance.ts)：Memory search governance context。
- [item7-stage-c-identity-thread.test.ts](https://github.com/gmood2008/openbot/blob/main/src/memory/item7-stage-c-identity-thread.test.ts)：C1-C5 身份线程合同。
- [item7-stage-c-identity-shadow.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/item7-stage-c-identity-shadow.ts)：managed identity shadow evaluator。
- [item7-stage-c-identity-shadow.test.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/item7-stage-c-identity-shadow.test.ts)：shadow 的 defer/deny/success 分类。

当前状态：shadow 默认关闭，五个 legacy index 调用仍在 canonical retirement scan 中。专家不能把该模块解释为生产切换已经完成。

### 9.3 Stage D：Memory Sync

- [item7-stage-d-memory-sync.ts](https://github.com/gmood2008/openbot/blob/main/src/memory/item7-stage-d-memory-sync.ts)：受控同步命令与三业务阶段定义。
- [item7-stage-d-persistent-store.ts](https://github.com/gmood2008/openbot/blob/main/src/memory/item7-stage-d-persistent-store.ts)：跨进程 fencing、operation 和 recovery 持久化。
- [item7-stage-d-local-adapter.ts](https://github.com/gmood2008/openbot/blob/main/src/memory/item7-stage-d-local-adapter.ts)：local-only adapter。
- [item7-stage-d-shadow-canary.ts](https://github.com/gmood2008/openbot/blob/main/src/memory/item7-stage-d-shadow-canary.ts)：dark canary。
- [item7-stage-d-readiness.ts](https://github.com/gmood2008/openbot/blob/main/src/memory/item7-stage-d-readiness.ts)：S33/S34/S35 生产资格聚合器。
- [manager-sync-ops.ts](https://github.com/gmood2008/openbot/blob/main/src/memory/manager-sync-ops.ts)：仍含实际 legacy sync 调用点的生产文件。

对应测试包括 persistent-store 单进程/跨进程、local adapter、shadow canary、memory sync 和 readiness。当前 controlled path 是 shadow-only；cloud/BYOS 未启用。

### 9.4 Item 7 扫描与 Retirement

- [item7-retirement-preflight.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/data-governance/item7-retirement-preflight.ts)：retirement 预检。
- [item7-retirement-preflight-matrix.ts](https://github.com/gmood2008/openbot/blob/main/src/gateway/data-governance/item7-retirement-preflight-matrix.ts)：调用点资格矩阵。
- [memory-workspace-phase1b-item7-retirement-scan.json](https://github.com/gmood2008/openbot/blob/main/docs/design/evidence/memory-workspace-phase1b-item7-retirement-scan.json)：当前 canonical 调用点与计数。
- [memory-workspace-phase1b-item7-retirement-ledger.json](https://github.com/gmood2008/openbot/blob/main/docs/design/evidence/memory-workspace-phase1b-item7-retirement-ledger.json)：逐批 retirement ledger。
- [memory-workspace-phase1b-unlock-current.json](https://github.com/gmood2008/openbot/blob/main/docs/design/evidence/memory-workspace-phase1b-unlock-current.json)：当前 unlock 指针。

截至本清单基线，canonical scan 为 `item7=not-met`、`liveWriteWatchIndex=10`、`deployAuthorized=false`。

## 10. 审计、Freeze 与证据

- [workspace-inventory.ts](https://github.com/gmood2008/openbot/blob/main/scripts/audit/workspace-inventory.ts)：Workspace inventory。
- [workspace-isolation-probe.mjs](https://github.com/gmood2008/openbot/blob/main/scripts/audit/workspace-isolation-probe.mjs)：隔离 probe。
- [memory-workspace-phase0-inventory.mjs](https://github.com/gmood2008/openbot/blob/main/docs/design/evidence/memory-workspace-phase0-inventory.mjs)：Phase 0 inventory scanner。
- [memory-workspace-phase0-exit-gate.mjs](https://github.com/gmood2008/openbot/blob/main/docs/design/evidence/memory-workspace-phase0-exit-gate.mjs)：Phase 0 exit gate。
- [memory-workspace-phase0-run-trusted-freeze.sh](https://github.com/gmood2008/openbot/blob/main/docs/design/evidence/memory-workspace-phase0-run-trusted-freeze.sh)：可信 freeze 执行入口。
- [memory-workspace-phase1b-item7-stage-c-prod-identity-wiring-shadow.json](https://github.com/gmood2008/openbot/blob/main/docs/design/evidence/memory-workspace-phase1b-item7-stage-c-prod-identity-wiring-shadow.json)：Stage C 当前证据。
- [memory-workspace-phase1b-item7-stage-d-prod-readiness.json](https://github.com/gmood2008/openbot/blob/main/docs/design/evidence/memory-workspace-phase1b-item7-stage-d-prod-readiness.json)：Stage D 当前证据。

审查证据时应同时执行对应 `.test.mjs`，并核对 evidence 中的 SHA、digest、operationId 和状态字段，不能只阅读 Markdown handoff。

## 11. 生产发布与血缘门禁

- [verify-forward-only.sh](https://github.com/gmood2008/openbot/blob/main/deploy/production/scripts/verify-forward-only.sh)：验证 LIVE 是 candidate 的祖先；LIVE unknown 时 exit 21。
- [verify-delivery-alignment.sh](https://github.com/gmood2008/openbot/blob/main/deploy/production/scripts/verify-delivery-alignment.sh)：L1/L2/L3 发布对齐。
- [resolve-live-sha.ts](https://github.com/gmood2008/openbot/blob/main/scripts/delivery/resolve-live-sha.ts)：从实际运行 artifact 解析 LIVE。
- [forward-guard.ts](https://github.com/gmood2008/openbot/blob/main/scripts/delivery/forward-guard.ts)：forward-only 逻辑。
- [ledger.ts](https://github.com/gmood2008/openbot/blob/main/scripts/delivery/ledger.ts) 与 [ledger-audit.ts](https://github.com/gmood2008/openbot/blob/main/scripts/delivery/ledger-audit.ts)：发布账本和一致性审计。
- [merge-back.ts](https://github.com/gmood2008/openbot/blob/main/scripts/delivery/merge-back.ts)：cutover 后 merge-back 计划。
- [retire-plan.ts](https://github.com/gmood2008/openbot/blob/main/scripts/delivery/retire-plan.ts)：发布资产退役计划。
- [releases.jsonl](https://github.com/gmood2008/openbot/blob/main/deploy/production/releases.jsonl)：机器可读发布 SoT。
- [RELEASE_RECORD.md](https://github.com/gmood2008/openbot/blob/main/deploy/production/RELEASE_RECORD.md)：人工发布视图。

## 12. 推荐定向测试

第三方团队可按领域运行下列测试集，再根据改动扩大范围：

```bash
OPENBOT_TEST_PROFILE=low OPENBOT_TEST_SERIAL_GATEWAY=1 pnpm exec vitest run \
  src/gateway/data-governance/catalog-store.test.ts \
  src/gateway/data-governance/envelope.test.ts \
  src/gateway/data-governance/lifecycle-p2a.test.ts \
  src/gateway/data-governance/lifecycle-p2b.test.ts \
  src/gateway/data-governance/lifecycle-p2c.test.ts \
  src/gateway/data-governance/lifecycle-p2d.test.ts \
  src/gateway/data-governance/lifecycle-p2e.test.ts \
  src/gateway/workspace-resolver/strict-locator.test.ts \
  src/gateway/workspace-resolver/workspace-resolver.test.ts
```

```bash
OPENBOT_TEST_PROFILE=low OPENBOT_TEST_SERIAL_GATEWAY=1 pnpm exec vitest run \
  src/gateway/data-governance/cognitive-p3a.test.ts \
  src/gateway/data-governance/cognitive-p3b.test.ts \
  src/gateway/data-governance/cognitive-p3c.test.ts \
  src/gateway/data-governance/cognitive-p3d.test.ts \
  src/gateway/data-governance/cognitive-p3e.test.ts \
  src/gateway/data-governance/cognitive-p3f.test.ts \
  src/gateway/data-governance/cognitive-p3g.test.ts \
  src/gateway/data-governance/placement-resolve.test.ts \
  src/gateway/data-governance/placement-export.test.ts
```

```bash
OPENBOT_TEST_PROFILE=low OPENBOT_TEST_SERIAL_GATEWAY=1 pnpm exec vitest run \
  src/memory/item7-stage-c-identity-thread.test.ts \
  src/gateway/item7-stage-c-identity-shadow.test.ts \
  src/memory/item7-stage-d-memory-sync.test.ts \
  src/memory/item7-stage-d-persistent-store.test.ts \
  src/memory/item7-stage-d-persistent-store.crossproc.test.ts \
  src/memory/item7-stage-d-local-adapter.test.ts \
  src/memory/item7-stage-d-shadow-canary.test.ts \
  src/memory/item7-stage-d-readiness.test.ts
```

生产 go-live 之前还必须运行：

```bash
pnpm build
pnpm check
pnpm delivery:ledger:audit
pnpm delivery:check-sot -- --use-release-record-live
./deploy/production/scripts/verify-forward-only.sh --candidate <fresh-origin-main-sha>
./deploy/production/scripts/verify-delivery-alignment.sh
```

## 13. 审查结论口径

代码存在于 `main` 只证明实现已合入，不代表功能已在生产启用。第三方报告应分别记录：

1. **Implementation present**：代码与测试是否存在并符合合同。
2. **Wired**：真实生产入口是否调用新组件。
3. **Enabled**：feature flag、Catalog 和 adapter 是否启用。
4. **Authorized**：canonical evidence 是否允许 production/LIVE。
5. **Deployed**：运行容器 `build-info.commit` 是否包含实现。
6. **Observed**：canary、隔离负例、恢复和回滚证据是否来自实际运行环境。

当前不能把 Stage C/D shadow、有限 implementation unlock、P0-P5 first-wave Accept 或代码已合入 `main`，单独解释为完整数据迁移、full Phase 1B unlock 或生产 cutover 完成。
