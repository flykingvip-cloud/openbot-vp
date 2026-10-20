# Phase 1B Item 7 Batch 25 / S01+S02 Semantic Gate CR

这是 **S01/S02 Semantic Gate CR**，不是一次 retirement。S01、S02 **不退役**，Batch 25 **不视为 Accepted**，本轮 **零退役**。

任务：`kiro-data-governance-phase1b-item7-batch25-s01-s02-semantic-gate`，唯一 owner = `kiro-data-governance`。

背景：S01/S02 是 `src/auto-reply/reply/get-reply.ts` 中最后两个 live-ledger **WRITE** host-resolver 调用点，属于 Stage B 四点原子门禁（S01/S02/S26/S27）中剩余的两点。在干净隔离 worktree（本分支 `kiro-data-governance/item7-retirement-batch25-s01-s02`，base `origin/main` `bece79d62c`，即 Batch A command-hardening #711 落地提交）投产先做 read-only 调查，结论为**不可诚实退役**，遂改走本 Semantic Gate CR。本 CR **不含任何 get-reply.ts 生产代码或测试改动**，也**不改 retirement scan**。

| Field                    | Value                                      |
| ------------------------ | ------------------------------------------ |
| status                   | batch-25-s01-s02-semantic-gate-cr          |
| changeRequest            | true                                       |
| changeRequestKind        | semantic-gate                              |
| stageBSemanticGate       | blocked                                    |
| batch25Accepted          | false                                      |
| previousAcceptedBaseline | 10                                         |
| retiredThisChange        | 0                                          |
| remaining                | 10                                         |
| liveWriteWatchIndex      | 10                                         |
| S01Retired               | false                                      |
| S02Retired               | false                                      |
| item7                    | not-met                                    |
| phase1bExecutionBlocked  | true                                       |
| phase1bUnlock            | not-issued                                 |
| deployAuthorized         | false                                      |
| live                     | forbidden                                  |
| productionCatalogWrite   | none                                       |
| schemaV2ProductionWrite  | false                                      |
| absorbsUnacceptedBatches | false                                      |
| origin/main              | `bece79d62c0bce91bf7d30a28948f40cfccbc515` |

未改 live retirement scan（`remaining` 保持 10，S01/S02 仍在册）。未改 `get-reply.ts`。未启动 Stage C / Stage D。未复审 S27。S24/S25 已接受（landed）状态、以及 Batch 23 S26 semantic-gate 结论不回退。

## §五 CR 结论（必须记录）

1. S01、S02 属于 **personal_local 首次物化（provisioning/create lifecycle）** 的 fallback，不是普通的 read-existing-asset resolver 调用。
2. 承载 S01/S02 的 `personalFallback` 闭包**仅在**安全 profile 为 `personal_local` **且** trusted locator（`resolveAuthorizedToolCwd`）未返回 `authorizedCwd` 时才执行；`managed_enterprise` 直接 fail-closed 返回 `null`，无 legacy path fallback（`resolveWorkspaceDirAfterAuthorization`，`src/gateway/workspace/handler-bridge.ts:872`）。
3. 两个 resolver 都是纯 host-path 拼接、无 Catalog binding（`resolveEmployeeBuiltinStewardWorkspaceDir` @ `src/agents/builtin-steward/employee-isolation.ts:141`；`resolveAgentWorkspaceDir` @ `src/agents/agent-scope.ts:270`）；目录由下游 `ensureAgentWorkspace -> fs.mkdir`（`src/agents/workspace.ts:337`）**现场创建**，因此调用点并不预先存在可读的 Catalog binding。
4. 调用点只持有 `agentId` / `employeeOwnerId` + `cfg`，缺少 `resolveWorkspaceLocator`/`validateWorkspaceLocatorQuery` 所需的 `resourceId`、`catalog`、`tenantContext`、`tenantId`、`actor`、`grant`。在 workspace 被 provisioning 之前读取其 locator binding 构成**循环依赖**。
5. 仓库自身的权威 SoT —— `LEGACY_LOCATOR_CALLER_MATRIX` P1（`src/gateway/workspace-resolver/strict-locator.ts:555-568`）—— 已把 `resolveAgentWorkspaceDir@get-reply.ts`（shape `agentId-only`）预登记为 `expectedReasonCode: agent_id_slug_query_forbidden`；即在该调用点做 resolver 替换**被设计为 fail-closed**，佐证 S02 不可 swap 诚实退役。
6. 仅增加 `catalog`/`grant`/`cfg` 参数不能解决 lifecycle ownership —— binding 仍需先被某个 provisioning owner 创建才能读。
7. 当前 **不得退役 S01 / S02**；accepted baseline **保持 10，不得递减**（不写 9、不写 8）。
8. **S24/S25 已接受状态与 Batch 23 S26 semantic-gate 结论不得回退**；Phase 1B / LIVE / 生产 Catalog / schema v2 / 生产部署继续锁定；Item 7 保持 not-met。

## §四 语义证据（S01 / S02）

来源：`src/auto-reply/reply/get-reply.ts`、`src/gateway/workspace/handler-bridge.ts`、`src/gateway/workspace-resolver/strict-locator.ts`（`origin/main` `bece79d62c`）。

- `get-reply.ts:159-166`：`resolveWorkspaceDirAfterAuthorization({ profile, authorizedCwd, personalFallback })`。`personalFallback` 闭包在 `162-165`：
  - `164` `resolveEmployeeBuiltinStewardWorkspaceDir(employeeOwnerId)`（S01，pathId P5，op write）；
  - `165` `resolveAgentWorkspaceDir(cfg, agentId)`（S02，pathId P1，op write）。
- `handler-bridge.ts:872-888`：若 `authorizedCwd` 非空则用之；否则 `managed_enterprise` 返回 `null`（fail-closed），**仅** `personal_local` 才调用 `personalFallback`。managed 路径的 Catalog/trusted-locator 读取已由 `get-reply.ts:149-158` 的 `resolveAuthorizedToolCwd` 完成。
- 下游 `ensureAgentWorkspace`（`src/agents/workspace.ts:321`）在 `337` 执行 `fs.mkdir(dir, { recursive: true })`，即 workspace 的 create/first-write；不存在可先读的 binding。
- 两个 resolver 均为纯 host-path：`employee-isolation.ts:141`、`agent-scope.ts:270`，无 Catalog 资源。

与已验收批次对比：

| site    | 位置                                 | 可读的既有 binding                    | 退役方式                            |
| ------- | ------------------------------------ | ------------------------------------- | ----------------------------------- |
| S24     | writable-dir source resolver         | canonical/active source（已存在）     | `resolveWorkspaceLocator`           |
| S25     | writable-dir target resolver         | compatibility/read_only（cutover 后） | `resolveWorkspaceTargetBinding`     |
| S26     | pilot 源根构建（创建流程）           | 无（binding 现场创建）                | 不可 resolver 替换（semantic gate） |
| S01/S02 | **personal_local 首次物化 fallback** | **无（binding 由 mkdir 现场创建）**   | **不可 resolver 替换**              |

## §六 建议解锁设计：personal_local provisioning + 身份直通

CR 提议：退役 S01/S02 之前，先在 personal_local 首次物化路径上**串接服务端可信身份并预置 Catalog binding**，复用已验收的 provisioning-command 形态（`provisionEmployeeStewardCutoverWorkspace`，已在 #711 加固）。命令契约必须包含：

1. 在 personal_local 首次物化边界接收服务端可信 `tenantContext`、`actor`、ownership proof；
2. 为 agent/steward workspace 分配稳定 `resourceId`；
3. 通过 placement policy 计算 placement（realpath 包含、拒绝 symlink、tenant/user/resourceId 绑定）；
4. **在任何 mkdir 之前**写入唯一 workspace `canonical/active` binding；
5. 生成 Catalog receipt 与带 fencing marker 的 `operationId`；
6. **Catalog 成功后**才允许 `ensureAgentWorkspace` mkdir；
7. 任一步失败：`recovery_required` + halt；
8. 禁止无 Catalog 目录、半创建、双写、隐式 host fallback。

该命令完成并**单独验收**后：

- S01 使用 canonical steward-workspace handle；
- S02 使用 canonical agent-workspace handle；
- `getReply` 的 personal_local fallback 不再现场拼 host 路径。

此为**独立的后续工作**，不属于本 double-point semantic-gate 批次。

## 定向测试

```bash
node --test \
  docs/design/evidence/memory-workspace-phase1b-item7-batch25-s01-s02-semantic-gate.test.mjs
```

结果：**4 passed / 0 failed**（状态字段 + 八条结论 + 两点 per-site 评估 + 八点契约 + scan 保持 10 且 S01/S02 仍在册 + `get-reply.ts:164/165` 保持不变 + 治理指针继续锁定 + `BASELINE=bece79d62c` ancestor 校验）。本轮无源码改动，故不涉及 vitest。

## 本轮提交范围（§八）

仅：semantic gate evidence JSON、evidence test、semantic gate handoff、tasks 签名、Loom session/ownership 记录。**不含任何 get-reply.ts 生产代码或测试行为修改**（无 DGV2 code stream）。trailers：

```
Task: kiro-data-governance-phase1b-item7-batch25-s01-s02-semantic-gate
Agent: kiro-data-governance
```

## 本轮未做 / 禁止

- 未退役 S01/S02；未改 retirement scan；`remaining`/`liveWriteWatchIndex` 保持 10（未写 9/8/0）。
- 未改 `get-reply.ts` / `handler-bridge.ts` / resolver 代码；未新增 get-reply 相关退役测试。
- 未标 Batch 25 / S01 / S02 Accepted；未申请 batch Accept。
- 未复审 S27；未启动 Stage C/D；未标 Item 7 met；未 unlock Phase 1B；无 LIVE / schema v2 生产写入 / 生产 Catalog；未重写 Phase 0 冻结基线（保持 38）。

## Rollback / quarantine

- `rollbackProof=true`：仅新增 evidence/handoff/attribution，无代码、无 scan 变更；回滚 = revert 本 CR 提交，10 个在册点（含 S01/S02）与 scan 未动。
- `quarantineProof=true`：design-only；`quarantineNormalWrites=0`；`rewriteIntoNormalCatalog=false`。

## SHAs

- originMainSha：`bece79d62c0bce91bf7d30a28948f40cfccbc515`（#711 落地；worktree 创建时 origin/main tip；push 前再次 fetch，如前进则 rebase 到最新 `origin/main` 后再推，不做破坏性历史改写）。
- branch：`kiro-data-governance/item7-retirement-batch25-s01-s02`。
- implementationSha / reviewTipSha：见落地 PR 评论。

## 请求审查（§九）

**S01/S02 Semantic Gate CR Review only.** 不申请：S01 Accept、S02 Accept、Batch 25 Accept、baseline 10→9 或 10→8、Stage C unlock、Item 7 met、Phase 1B unlock、LIVE 或生产部署。
