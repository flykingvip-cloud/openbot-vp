# Phase 1B Item 7 Batch 23 / S26 Semantic Gate CR

这是 **Stage B / S26 Semantic Gate CR**，不是一次 retirement。S26 **不退役**，Batch 23 **不视为 Accepted**，本轮 **零退役**。

任务：`kiro-data-governance-phase1b-item7-batch23-s26-semantic-gate`，唯一 owner = `kiro-data-governance`。

背景：#674 把 Batch 23 重切为单点 S26；随后在同一 worktree 出现并发的 S26 退役实现（resolver 替换）。经操作者裁决：并发退役冻结、由其作者自行处理其 WIP；S26 改走本 Semantic Gate CR，在**干净隔离 worktree**（本分支 `kiro-data-governance/item7-batch23-s26-semantic-gate-cr`，base `origin/main` `67cfe64d44`）产出。本 CR **不含任何 S26/S27 生产代码或测试改动**，也**不并入并发 src diff**。

| Field                    | Value                                      |
| ------------------------ | ------------------------------------------ |
| status                   | batch-23-s26-semantic-gate-cr              |
| changeRequest            | true                                       |
| stageBSemanticGate       | blocked                                    |
| batch23Accepted          | false                                      |
| previousAcceptedBaseline | 12                                         |
| retiredThisChange        | 0                                          |
| remaining                | 12                                         |
| liveWriteWatchIndex      | 12                                         |
| S26Retired               | false                                      |
| S27Retired               | false                                      |
| item7                    | not-met                                    |
| phase1bExecutionBlocked  | true                                       |
| phase1bUnlock            | not-issued                                 |
| deployAuthorized         | false                                      |
| live                     | forbidden                                  |
| productionCatalogWrite   | none                                       |
| schemaV2ProductionWrite  | false                                      |
| absorbsUnacceptedBatches | false                                      |
| origin/main              | `67cfe64d44a974b4a2c5d51a1a06a4c66bd01acf` |

未改 live retirement scan（`remaining` 保持 12，S26 仍在册）。未启动 Stage C / Stage D。未复审 S01 / S02 / S27。S25 已接受（landed）状态不回退。

## §五 CR 结论（必须记录）

1. S26 属于 **provisioning/create lifecycle**，不是普通的 read-existing-asset。
2. 当前 binding 由本流程内的 `buildEmployeeStewardCutoverCatalog` 依据 `sourceRoot`/`targetRoot` **现场构建**，在 S26 调用点并不预先存在。
3. 在 provisioning 之前调用 Resolver 读取同一 binding 构成**循环依赖**（binding 尚未被本流程创建，无法先读）。
4. 仅给 `runEmployeeStewardCutoverPilot` **增加 `catalog`/`grant`/`cfg` 参数不能解决 lifecycle ownership** —— binding 仍需先被某方创建才能读；否则要么 fail-closed，要么重新引入隐式 host fallback。
5. 当前 **不得退役 S26 / S27**。
6. **Stage B 四点批量原子门禁（S01/S02/S26/S27）未通过**；即便重切为单点 S26，仍不可诚实退役。
7. accepted baseline **保持 12，不得递减**（不写 11、不写 8）。
8. **S25 已接受状态不得回退**。

## §四 语义证据（S26）

来源：`docs/design/evidence/memory-workspace-phase1b-item7-callsite-ledger.json` 与 `src/gateway/workspace-resolver/steward-write.ts`（`origin/main` `67cfe64d44`）。

- `steward-write.ts:279` `resolveEmployeeStewardSourceWorkspaceDir(userId, params.stateDir)` 位于 `runEmployeeStewardCutoverPilot`。
- 下游 `fs.mkdirSync(..., sourceRoot)` 创建源目录；`buildEmployeeStewardCutoverCatalog({ tenantId, userId, sourceRoot, targetRoot })` 从算出的 host 根构建 source/target bindings；`verifiedCopyStewardWorkspace({ sourceRoot, targetRoot })` 复制。
- 该行同时为 S26/S27 调度 W4 shadow，均带 `catalogResourceId: null`（无 Catalog 资源）。
- ledger：`replacementImplemented=false`、`deleteNow=false`、`retirementPrerequisite`「W2/W3 callers gone; source Catalog binding exists; independent unlock」**未满足**。

与已验收批次对比：

| site | 位置                           | 可读的既有 binding                    | 退役方式                        |
| ---- | ------------------------------ | ------------------------------------- | ------------------------------- |
| S24  | writable-dir source resolver   | canonical/active source（已存在）     | `resolveWorkspaceLocator`       |
| S25  | writable-dir target resolver   | compatibility/read_only（cutover 后） | `resolveWorkspaceTargetBinding` |
| S26  | **pilot 源根构建（创建流程）** | **无（binding 由本流程现场创建）**    | **不可 resolver 替换**          |

## §六 建议解锁设计：`provisionEmployeeStewardCutoverWorkspace(...)`

CR 提议：退役 S26/S27 之前，先实现一个窄领域命令并**单独验收**。命令契约必须包含：

1. 接收服务端可信 `tenantContext`、`actor`、ownership proof；
2. 分配稳定 `resourceId`；
3. 通过 placement policy 计算 source/target placement；
4. 写入唯一 source `canonical/active` binding；
5. 写入唯一 target `compatibility/read_only` binding；
6. 生成 Catalog receipt；
7. 生成 `operationId` 与 fencing marker；
8. **Catalog 成功后**才允许 `mkdir`/`copy`；
9. 任一步失败：`recovery_required` + halt；
10. 禁止无 Catalog 目录、半创建、双写、隐式 host fallback。

该命令完成并单独验收后：

- S26 使用 canonical source handle；
- S27 使用 controlled target handle；
- pilot 不再现场拼路径或重建身份。

## 定向测试

```bash
node --test \
  docs/design/evidence/memory-workspace-phase1b-item7-batch23-s26-semantic-gate.test.mjs
```

结果：**3 passed / 0 failed**（§七 状态字段 + §五 八条结论 + §六 十点契约 + scan 保持 12 且 S26 仍在册 + 治理指针继续锁定 + `BASELINE=67cfe64d44` ancestor 校验）。本轮无源码改动，故不涉及 vitest；**不新增** `steward-write-item7-s26.test.ts`（属退役实现路径）。

## 本轮提交范围（§八）

仅：semantic gate evidence JSON、evidence test、semantic gate handoff、tasks 签名、Loom session/ownership 记录。**不含任何 S26/S27 生产代码或测试行为修改**。trailers：

```
Task: kiro-data-governance-phase1b-item7-batch23-s26-semantic-gate
Agent: kiro-data-governance
```

## 本轮未做 / 禁止

- 未退役 S26/S27；未改 retirement scan；`remaining`/`liveWriteWatchIndex` 保持 12（未写 11/8/0）。
- 未改 `steward-write.ts` / pilot 代码；未新增 `steward-write-item7-s26.test.ts`；未并入并发 src diff。
- 未标 Batch 23 / S26 Accepted；未申请 batch Accept。
- 未复审 S01/S02/S27；未启动 Stage C/D；未标 Item 7 met；未 unlock Phase 1B；无 LIVE / schema v2 生产写入 / 生产 Catalog；未重写 Phase 0 冻结基线（保持 38）。
- 未 abandon 并发退役任务：其携带并发执行者在另一 worktree 的活跃未提交 WIP（§一 禁止我碰/回退），`loom task abandon` 会因未提交工作而拒绝或有风险；建议由操作者/该执行者在其 WIP 处理后正式关闭。本 CR 任务只认领自身 3 个 `-semantic-gate` 文件（与退役任务路径不相交，单一 active lander、无 CONFLICT/UNATTRIBUTED）。

## Rollback / quarantine

- `rollbackProof=true`：仅新增 evidence/handoff/attribution，无代码、无 scan 变更；回滚 = revert 本 CR 提交，12 个在册点（含 S26）与 scan 未动。
- `quarantineProof=true`：design-only；`quarantineNormalWrites=0`；`rewriteIntoNormalCatalog=false`。

## SHAs

- originMainSha：`67cfe64d44a974b4a2c5d51a1a06a4c66bd01acf`（#675；worktree 创建时 origin/main tip；push 前再次 fetch，如前进则停止并报告，不做破坏性历史改写）。
- branch：`kiro-data-governance/item7-batch23-s26-semantic-gate-cr`。
- implementationSha / reviewTipSha：见落地 PR 评论。

## 请求审查（§九）

**Stage B / S26 Semantic Gate CR Review only.** 不申请：S26 Accept、Batch 23 Accept、baseline 12→8、Stage C unlock、Item 7 met、Phase 1B unlock、LIVE 或生产部署。
