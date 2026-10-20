# Phase 1B Item 7 Stage C / memory index (op=index) Technical Slice + Semantic Gate CR

这是 **Item 7 Stage C（op=index）技术切片 + Semantic Gate CR**，不是一次生产退役。五个 index 调用点 **不切换生产**（保持 legacy），Stage C **不申请批次 Accept**，本轮 **生产零退役**。

任务：`kiro-data-governance-phase1b-item7-stage-c-memory-index`，owner/agent = `kiro-data-governance`，ide = `kiro`。
干净隔离 worktree：`/Users/daniel/AI项目/openbot-item7-stage-c-memory-index`，分支 `kiro-data-governance/item7-stage-c-memory-index`，base `origin/main` `c014b0247e`。

| Field                               | Value                                         |
| ----------------------------------- | --------------------------------------------- |
| status                              | stage-c-memory-index-technical-slice-proposal |
| changeRequest                       | true                                          |
| changeRequestKind                   | technical-slice + semantic-gate               |
| observedAcceptedBaseline            | 12                                            |
| siteCount                           | 5                                             |
| proposedRetiredThisSlice            | 5                                             |
| projectedRemainingIfAppliedDirectly | 7 (投影，非新 accepted baseline)              |
| retiredThisChange                   | 0                                             |
| canonicalLedgerUpdated              | false                                         |
| canonicalCountClaimed               | false                                         |
| scanModified                        | false                                         |
| stageBDependencyState               | blocked                                       |
| item7                               | not-met                                       |
| phase1bExecutionBlocked             | true                                          |
| phase1bUnlock                       | not-issued                                    |
| deployAuthorized                    | false                                         |
| live                                | forbidden                                     |
| productionCatalogWrite              | none                                          |
| productionIndexSwitch               | false                                         |
| schemaV2ProductionWrite             | false                                         |
| rollbackProof                       | true                                          |
| quarantineProof                     | true                                          |
| frozenWriteWatchIndex               | 38                                            |
| liveWriteWatchIndex                 | 12                                            |
| origin/main                         | `c014b0247e64278e0c60b7d691a31b7ccbaa2f1e`    |

未改 live retirement scan（`remaining` 保持 12，五点仍在册且 op=index）。未处理 Stage B（S01/S02/S26/S27），未处理 Stage D（`manager-sync-ops.ts` S33/S34/S35），未触碰 canonical retirement scan。S25 已接受（landed）状态不回退。

## 一、五点清单（§九）

| 标签 | ledgerId | 文件                               | 行  | op    | 符号                       | 所在                                            |
| ---- | -------- | ---------------------------------- | --- | ----- | -------------------------- | ----------------------------------------------- |
| C1   | S30      | `src/memory/backend-config.ts`     | 417 | index | `resolveAgentWorkspaceDir` | `resolveMemoryBackendConfig`（cogniweave 分支） |
| C2   | S31      | `src/memory/backend-config.ts`     | 444 | index | `resolveAgentWorkspaceDir` | `resolveMemoryBackendConfig`（qmd 分支）        |
| C3   | S32      | `src/memory/cogniweave-manager.ts` | 554 | index | `resolveAgentWorkspaceDir` | `CogniWeaveMemoryManager` 私有构造函数          |
| C4   | S36      | `src/memory/manager.ts`            | 152 | index | `resolveAgentWorkspaceDir` | `MemoryIndexManager.get`（静态缓存工厂）        |
| C5   | S37      | `src/memory/qmd-manager.ts`        | 196 | index | `resolveAgentWorkspaceDir` | `QmdMemoryManager` 私有构造函数                 |

## 二、每点身份来源（§四 语义审计，§九）

对每个调用点回答了 §四 六问；结论：五点均为 **读取既有 index/dir 的 config-time / 构造函数 / 后台任务**，**无创建资产**、**无循环依赖**（区别于 Stage B 的 S26 创建流程），但 **在调用点均无可信请求级身份**：

- **C1/C2（S30/S31）** — `resolveMemoryBackendConfig({ cfg, agentId })` 无身份参数；调用者含后台 `startGatewayMemoryBackend` 循环、`getMemorySearchManager`、`doctor-memory-search` CLI、`conversations/service`、`memory-tool`。可用身份仅 `cfg`+`agentId`；缺 tenantContext/tenantId/userId/actor/ownership grant/resourceId/agentAssetId/Catalog/membership SoT。
- **C3（S32）** — `CogniWeaveMemoryManager` 构造函数。类线程可选 `governance{ tenantId, ownershipProof }`，但 `this.workspaceDir = resolveAgentWorkspaceDir(cfg, agentId)` **无条件执行**，且 `governance` 不含 `userId`/server-trusted `actor`；managed cogniweave 在启动时本已被 defer。可用仅 `cfg`+`agentId`(+可选 governance)；缺 userId/actor/resourceId。
- **C4（S36）** — `MemoryIndexManager.get({ cfg, agentId, purpose })` 静态缓存工厂，`workspaceDir` 作为 cache key 与 index 根输入。无身份。
- **C5（S37）** — `QmdMemoryManager` 构造函数；`QmdMemoryManager.create` 从 `getMemorySearchManager` 调用，**完全未线程 governance**。无身份。

判定：因五点均 **缺可信身份**，按 §四 强制要求 **不得用 cfg-only Resolver 伪装完成**；本轮对五点 **产出 Semantic Gate CR**，并 **保持整个 Stage C 不申请批次 Accept**。同时印证 shadow `item7-w5-index-last.ts` 的 `decideItem7W5IndexSwitch()` = `{ allow:false, action:"keep-legacy-index" }`。

## 三、Resolver / binding（§五、§九）

本轮交付 **受控窄接口** `resolveMemoryIndexWorkspaceHandle`（`src/memory/memory-index-workspace-handle.ts`）：

- 只负责 **授权并返回受限 handle/locator**；**不创建目录、不写 Catalog、不启用 schema v2 / LIVE**。
- **只解析既有 canonical/active binding**，通过 canonical Resource Resolver `resolveMemoryWorkspaceHandle`（以 **port 注入**，使 memory 层不静态 import gateway）。
- 信任模型二分：
  - `personal_local` → **由明确 security profile 门控的 legacy 兼容 locator**；仅当服务端解析出的 profile 为 personal_local 时可达；**绝不作为 managed_enterprise 的 fallback**（判别联合类型结构上保证）。
  - `managed_enterprise` → 要求 server-trusted `tenantId + userId + actor` 及 canonical resolver 校验的 ownership 绑定（agentAssetId/resourceId + Catalog）；缺任一即 fail-closed。
- `agentId` slug **不作为所有权证明**。
- index namespace 由 `deriveManagedMemoryIndexNamespace(handle)` = `managed:<tenantId>:<resourceId>` 派生，绑定 tenantId + resourceId。

配套 `guardedMemoryIndexStart`：先授权后启动；拒绝路径 **不调用 startIndex**（零 scan/read/index-write）。

## 四、fail-closed 行为（§五、§七、§九）

窄接口在以下情况 **一律拒绝、绝不 host fallback**（拒绝码）：

- `op` 非 index → `op_not_index`；非 Stage C ledgerId（如 Stage D S33）→ `unknown_stage_c_site`。
- personal_local 缺 compat locator → `personal_local_compat_locator_missing`；locator 为空/默认 → `personal_local_compat_locator_empty`。
- managed 缺 tenant context / actor / grant → `managed_requires_trusted_identity`（即使传入 personal compat locator 也不回退）。
- managed actor 跨租户 → `managed_identity_actor_tenant_mismatch`。
- managed 缺 canonical resolver port → `managed_requires_canonical_resolver`。
- canonical 拒绝（Catalog miss / ambiguous / cross-tenant / grant mismatch / missing binding / stale fencing token）→ `managed_resolver_denied`（透传 `canonicalReasonCode`）。
- 解析出的 handle 跨租户 → `managed_cross_tenant_handle`。
- 非分支 handle → `managed_forbidden_host_fallback`。

## 五、索引停止条件（§六、§九）

- workspace handle 与 index namespace **绑定 tenantId/resourceId**；**同名 agent 跨租户不共用索引根**（测试验证 namespace 与 locator 均不同）。
- index rebuild **不越过 canonical binding**（managed 仅经 canonical resolver 拿到既有 binding）。
- provenance 保留 resourceId/tenantId（handle 自带）。
- workspace 被 **tombstone/revoked（`retired`/`purged`/`moving`/`recovery_required`）后新的索引任务不得启动** → `managed_workspace_not_indexable`。
- **已运行任务收到 revoke**：重解析返回 tombstoned handle → `guardedMemoryIndexStart` 拒绝再启动（halt/quarantine，测试覆盖）。
- **不得从旧 host path 恢复扫描**：managed 拒绝返回 **无 locator/无 handle**。
- **不得将索引存在视为访问授权**：即使 legacy 路径“存在”，managed 仍必须经 canonical resolver；传入的 personal compat locator 在 managed 分支被忽略。

## 六、建议解锁设计（诚实 remediation）

窄接口是 §五 提议的授权边界。将其接入五点生产需 **向这些（当前仅 cfg+agentId 的）后台/构造函数点线程 server-trusted 调用入口身份**（personal_local 兼容 vs managed_enterprise fail-closed），该线程跨越 Stage C 固定文件集之外的调用者，须 **单独验收** 后方可切换生产。切换后：C1/C2 让 `resolveMemoryBackendConfig` 接收调用入口身份；C3 让 `CogniWeaveMemoryManager` 接收完整身份（含 userId+actor）而非仅 governance；C4 让 `MemoryIndexManager.get` 的 cache key 由 canonical namespace 派生；C5 为 QMD 路径补齐身份。

## 七、rollback / quarantine（§九）

- `rollbackProof=true`：本切片仅 **新增** 窄接口模块 + 测试 + proposal + proposal test + 本 handoff；**未改五个 legacy 源文件**，**未改 retirement scan**。回滚 = revert 本切片提交；12 个在册点（含五点）与 scan 未动。
- `quarantineProof=true`：design-only；`guardedMemoryIndexStart` 在重解析得到 tombstoned/revoked handle 时 halt（quarantine）运行中的索引；`quarantineNormalWrites=0`，无 Catalog 重写。

## 八、测试结果（§九）

- `src/memory/memory-index-workspace-handle.test.ts`（vitest）：**106 passed**。每点（C1..C5）独立覆盖：缺 tenant context / 缺 actor|grant / Catalog miss / Catalog ambiguous / 跨租户 / id 不匹配 / membership 缺失 / 合法完整查询 / personal_local 明确兼容 / managed 禁止 fallback / 拒绝路径零 scan-read-index-write / tombstone·revoke 后停止 / canonical locator 正确；加聚合与 §六 生命周期。
  - 命令：`OPENBOT_TEST_PROFILE=low OPENBOT_TEST_SERIAL_GATEWAY=1 pnpm exec vitest run src/memory/memory-index-workspace-handle.test.ts`
- `docs/design/evidence/memory-workspace-phase1b-item7-stage-c-memory-index-proposal.test.mjs`（node:test）：**3 passed**（§八 计数 + scan 保持 12 且五点在册 op=index + 治理指针锁定 + 窄接口无 gateway 静态 import + `is-ancestor c014b0247e HEAD`）。
  - 命令：`node --test docs/design/evidence/memory-workspace-phase1b-item7-stage-c-memory-index-proposal.test.mjs`
- Batch 22 回归：`src/gateway/workspace-resolver/steward-write-item7-s25.test.ts` 保持通过（本切片未触碰 steward-write）。

## 九、SHAs（§九）

- originMainSha：`c014b0247e64278e0c60b7d691a31b7ccbaa2f1e`（worktree 创建时 origin/main tip；push 前再次 `git fetch origin`，若前进则停止并报告，不做破坏性历史改写）。
- branch：`kiro-data-governance/item7-stage-c-memory-index`。
- implementationSha / reviewTipSha：见落地 PR 评论（handoff 属提交内容，二者为落地后 SHA）。

## 十、attribution / clean tree（§九）

- Loom：task `kiro-data-governance-phase1b-item7-stage-c-memory-index`，owner/agent `kiro-data-governance`，ide `kiro`，session 已注册。
- 认领路径仅本切片自有文件（窄接口 + 其测试 + proposal + proposal test + 本 handoff + `.loom/registry.yaml`）；**未认领四个 legacy 源文件**（保持 legacy、与并发 shadow 任务无 CONFLICT）。
- `bun scripts/agent-attribution.ts` 期望：无 CONFLICT / 无 UNATTRIBUTED。
- 提交前工作树仅含本切片文件；trailers：

```
Task: kiro-data-governance-phase1b-item7-stage-c-memory-index
Agent: kiro-data-governance
```

## 本轮未做 / 禁止

- 未切换五个 index 生产调用点（保持 legacy）；未改 `backend-config.ts` / `cogniweave-manager.ts` / `manager.ts` / `qmd-manager.ts`。
- 未改 retirement scan；`remaining`/`liveWriteWatchIndex` 保持 12（未写 11/7/0）；未重写 Phase 0 冻结基线（保持 38）。
- 未处理 Stage B（S01/S02/S26/S27）；未处理 Stage D（`manager-sync-ops.ts` S33/S34/S35）；未碰其他 locator。
- 未标 Stage C Accepted；未申请 batch Accept；未标 Item 7 met；未 unlock Phase 1B；无 LIVE / schema v2 生产写入 / 生产 Catalog 写入 / 生产部署。
- `projectedRemainingIfAppliedDirectly=7` 仅为基于观察基线的数学投影，非新 accepted baseline；最终计数由 integration owner 按实际合并顺序重算。

## 请求审查（§九）

**Item 7 Stage C Technical Slice Review only.** 不申请：canonical count update、Stage C Accepted baseline、Item 7 met、Phase 1B unlock、LIVE / 生产部署。
