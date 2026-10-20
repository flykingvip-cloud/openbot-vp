# 企业数据治理与供给中心 M2 验收收口（2026-09-27）

> 基线：`origin/main` `74d98e2879fa26e8f071f3b0f623cf510e6c8fc3`（M1 验收文档合入之后）。  
> 依据：最终指令 §7.1、§7.3、§8.2、§8.3、§11 M2、§12。  
> 本文只说明 M2 可以交给专属验收机器人。**验收机器人批准前，M2 不是通过。** M3–M6 不在本文验收范围内。红线 5 仍是 OPEN GAP。

## 1. 结论

M2 的 DataSource、DataAccessPolicy 管理面编译、Access Governance 反查，在上述基线上已经落在代码里。本分支只修了一处管理面 RPC 门禁：管理员拒绝之后又回了一帧参数错误。

未改 ProjectionMaterializer、FeedItem、Knowledge Universe，也未改 Agent 直接调用 Gateway 的路径。

## 2. 对照

| 条款                                 | 核对                                                                                                                                                              | 代码                                                              |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| §7.1 DataSource 不是 Connector 别名  | `sourceId` 独立生成。`connectorId` 只是技术关联。同一 Connector 可挂第二个 DataSource。未注册 Action 的 Connector 拒绝登记。                                      | `src/gateway/enterprise-data/types.ts`、`data-source-store.ts`    |
| §7.3 DataAccessPolicy 是管理面       | 管理员编辑策略。运行时执行对象是 `SeatActionGrant`。                                                                                                              | `data-access-policy-store.ts` 的 `compileDataAccessPolicy`        |
| §7.3 编译到 Grant / Scope / Approval | seat 策略编译出 Grant，并带上已校验的 `scopePolicyId` 与 `approvalPolicyId`。department / role 可登记，编译抛 `DATA_ACCESS_POLICY_COMPILE_UNSUPPORTED`。          | 同上；种子策略见 `seeds.ts`                                       |
| §8.2 Data Sources 反查               | `governance-view` 按绑定了该 `sourceId` 的 DataCapability 反查能力与投影，不用 `connectorId` 兜底。同时返回策略与供给健康摘要。                                   | `access-governance-store.ts` 的 `resolveDataSourceGovernanceView` |
| §8.3 Access Governance 反编译        | matrix、resolve-target、policy detail 都暴露 `runtimeActionRefs`（`connectorId + actionKey + version`）和已编译 Grant。维度为 source / seat / department / role。 | `access-governance-store.ts`、`enterprise-data-m2.ts`             |
| §11 M2 RPC 管理员门禁                | M2 handler 先 `requireResolvedEnterpriseAdminTenantId`，失败即返回。                                                                                              | `enterprise-data-m2.ts`                                           |
| §12 红线 1                           | 与 §7.1 同一证据。                                                                                                                                                | 见上                                                              |
| §12 红线 5                           | **OPEN GAP，本分支不修。** 路径仍是 `src/agents/tools/data-capability-tool.ts` → `capability-agent-invoke-runtime.ts` → `invokeEnterpriseDataAction`。            | 差距审计 §2                                                       |

执行主体仍是 Seat。Gateway 没有 `seatId` 时返回 `NO_SEAT_CONTEXT`。本分支不新增 DigitalHuman 或 KnowledgeObject 权限主体。

## 3. 本分支修的缺口

`enterprise-data.sources.get`、`enterprise-data.access-policies.upsert`、`enterprise-data.access-policies.compile`、`enterprise-data.access-policies.resolve-actions` 原先把 `!tenantId` 和参数缺失写在同一个判断里。

`requireResolvedEnterpriseAdminTenantId` 在非管理员时已经回复 `GOVERNANCE_ADMIN_REQUIRED_MESSAGE`。随后的判断仍为真，于是再发一帧参数错误（例如已经带了 `policyId`，第二帧仍说 `policyId is required`）。Gateway 的 `respond` 会把两帧都发出去。

这四条现在与 `enterprise-data-m2.ts` 一致：管理员拒绝后直接返回，参数校验只在管理员通过之后发生，并且只回复一次。

## 4. 留给验收机器人、本分支不改的行为

`data-gateway.ts` 在找不到已编译 Grant 时，会调用 `resolvePolicyBackedSeatActionGrant`。department / role 策略可以在调用时合成一条仍带 `seatId` 的 Grant，并带上策略上的 Scope / Approval 引用。`compileDataAccessPolicy` 对这两类目标仍然拒绝。

M1 差距审计已经把这条记成 Seat 执行主体，不是新的权限主体。本分支不改调用链，避免把 M2 收口做成执行内核行为变更。

## 5. 验收机器人应核对

1. DataSource 的 `sourceId` 不等于 `connectorId`；无 Action 的 Connector 不能 `upsert`。
2. seat 策略编译后的 Grant 带有 `scopePolicyId`、`approvalPolicyId`、`actionKey`、`version`。归档策略会撤销这些 Grant。
3. governance matrix / resolve-target 能看到 `ConnectorAction@version`，投影反查不按 `connectorId` 串到另一个 DataSource。
4. 成员调用上述四条管理面 RPC，以及 `enterprise-data-m2.ts` 里的治理 RPC，只收到一次管理员拒绝。
5. diff 不包含 Materializer、Feed、Universe 行为变更。红线 5 仍是 OPEN GAP。批准前不要把 M2 写成通过，也不要把 M3–M6 写成通过。

## 6. 测试

```bash
OPENBOT_TEST_PROFILE=low OPENBOT_TEST_SERIAL_GATEWAY=1 pnpm exec vitest run \
  src/gateway/server-methods/enterprise-data-m2.test.ts \
  src/gateway/enterprise-data/access-governance.test.ts \
  src/gateway/enterprise-data/connector-action-store.test.ts \
  src/gateway/enterprise-data/policy-backed-grant-resolver.test.ts
```

仓库没有单独的 `data-source-store.test.ts` 或 `data-access-policy-store.test.ts`。DataSource 与 DataAccessPolicy 由 `access-governance.test.ts`、`enterprise-data-m2.test.ts` 和 `connector-action-store.test.ts` 覆盖。

结果：**4 files, 43 tests passed**（2026-09-27，worktree `cursor-grok/edgsc-m2-acceptance-close`，基线 `74d98e287`）。其中 `enterprise-data-m2.test.ts` 21 条，含成员调用只收到一次管理员拒绝。
