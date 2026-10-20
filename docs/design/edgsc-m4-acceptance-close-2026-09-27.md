# 企业数据治理与供给中心 M4 验收收口（2026-09-27）

> 基线：`origin/main` `3aed9c55c215ad3b216287f3e0b9b731b117bdec`（M3 验收合入之后）。  
> 依据：最终指令 §5.3–5.5、§7.4–7.7、§8.5–8.6、§11 M4、§12。  
> 本文只说明 M4 可以交给专属验收机器人。**验收机器人批准前，M4 不是通过。** M5–M6 不在本文验收范围内。红线 5 仍是 OPEN GAP。

## 1. 结论

M4 的 `EnterpriseKnowledgeProjectionSpec`（显式 `sourceActions`）、五类声明式模板、`ProjectionMaterializer`、`EnterpriseKnowledgeObjectFeedItem`、`KnowledgeVisibilityPolicy`，以及 M4 RPC，在上述基线上已经落在代码里。本分支修了两处投影读接口的二次错误帧，并修正了草稿物化测试仍指向已改为 active 的流失风险种子。

未改 Agent 直接调用 Gateway 的路径。未把 M5 SupplyAudit 闭环或 M6 Feed Adapter / Universe 写成验收通过。

## 2. 对照

| 条款                                           | 核对                                                                                                                                                                                                                                                       | 代码                                                                                                     |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| §7.4 / §11 `EnterpriseKnowledgeProjectionSpec` | 类型名是 `EnterpriseKnowledgeProjectionSpec`。`sourceActions` 必填，且必须带 `connectorId + actionKey + version`。空数组即使用了 `capabilityId` 也拒绝。多源拒绝。链接了 DataCapability 时，显式动作必须落在该能力的 `actionRefs` 上，不能从能力反推补齐。 | `types.ts`；`projection-spec-store.ts`                                                                   |
| §5.5 / §8.5 Projection Studio                  | 模板键只有 Normalize / Aggregate / Trend / RiskDetection / Forecast。RPC 拒绝 `SqlTemplate`。模板引擎对未知键抛 `PROJECTION_TEMPLATE_UNSUPPORTED`，不执行 SQL、`eval` 或脚本。Studio 表单是五个 `<option>`，没有 SQL / 脚本输入。                          | `projection-template-engine.ts`；`enterprise-data-m4.ts`；`enterprise-data-governance-center-surface.ts` |
| §7.5 Binding                                   | 绑定带 `materializationMode`、`freshnessSlaMinutes`、`enabled`、`generatorVersion`、`visibilityPolicyId`，以及物化团队标签。                                                                                                                               | `EnterpriseKnowledgeProjectionBinding`                                                                   |
| §5.3 / §5.4 / §12 红线 4                       | 供给侧调用 `invokeEnterpriseDataAction` 的实现是 `projection-materializer.ts` 的 `runProjectionMaterialization`。知识平面边界测试禁止 import `data-gateway`。员工执行入口仍是 `enterprise-data.invoke`。                                                   | `projection-materializer.ts`；`knowledge-consumption-boundary.test.ts`；`enterprise-data-m1.ts`          |
| §7.6 FeedItem                                  | 物化写入 `EnterpriseKnowledgeObjectFeedItem`：`objectId`、`projectionId`、`title`、`kind`、`category`、`sourceSystems`、`scopeApplied`、`maskedFields`、`generatedAt`、`freshnessStatus`、`traceRefs`、`payload`。                                         | `knowledge-feed-item-store.ts`                                                                           |
| §7.7 / §5.2 Visibility                         | `KnowledgeVisibilityPolicy` 按 seat / team / department / role / agent type 评估。`feed-items.list` 预览用 `agentType`，拒绝 `agentId`。                                                                                                                   | `knowledge-visibility-policy-store.ts`；`enterprise-data-m4.ts`                                          |
| §8.6 供给运营                                  | `knowledge-supply.overview` 返回投影、绑定、可见性策略、Feed 计数、新鲜度和最近 FeedItem。失败事件账本属于 M5 `KnowledgeSupplyAudit`，本阶段不把它写成 M5 通过。                                                                                           | `knowledge-supply-store.ts`                                                                              |
| §11 M4 RPC 管理员门禁                          | `enterprise-data-m4.ts` 的 handler 在管理员拒绝后直接返回。`projection-specs.get` 与 `projection-bindings.get` 原先把 `!tenantId` 和缺 id 写在一起，现已分开。                                                                                             | `enterprise-data.ts`、`enterprise-data-m4.ts`                                                            |
| §12 红线 5                                     | **OPEN GAP，本分支不修。** 路径仍是 `src/agents/tools/data-capability-tool.ts` → `capability-agent-invoke-runtime.ts` → `invokeEnterpriseDataAction`。                                                                                                     | 差距审计 §2                                                                                              |

执行主体仍是 Seat。物化上下文来自绑定上的 `materializationTeamLabel` 和固定 Materializer Seat，RPC 不能改写 `materializerSeatId` 或 `teamLabel`。本分支不新增 DigitalHuman 或 KnowledgeObject 权限主体。

## 3. 本分支修的缺口

`enterprise-data.projection-specs.get` 与 `enterprise-data.projection-bindings.get` 原先把 `!tenantId` 和缺 id 写在同一个判断里。

`requireResolvedEnterpriseAdminTenantId` 在非管理员时已经回复管理员拒绝。随后的判断仍为真，于是再发一帧 `projectionId is required` 或 `bindingId is required`。Gateway 的 `respond` 会把两帧都发出去。

这两条现在与 `enterprise-data-m4.ts` 一致：管理员拒绝后直接返回，参数校验只在管理员通过之后发生，并且只回复一次。读到的规格仍带显式 `sourceActions`。

草稿物化测试原先用种子 `sales.churn-risk`。该种子现为 `active`，注释写明是为了定时刷新。测试现改为把客户画像规格改成 `draft` 后再物化，期望 `PROJECTION_NOT_ACTIVE`。种子生命周期没有改。

## 4. 留给验收机器人、本分支不改的行为

`capability-agent-invoke-runtime.ts` 仍可按 capability 触发 `invokeEnterpriseDataAction`。这不把红线 5 变成 PASS。本分支不改这条路径。

知识宇宙装配仍会经 `on-demand-projection-materializer.ts` 调用 `runProjectionMaterialization`。知识平面没有直接 import Gateway。这条残留保持差距审计 §3 的记录，本分支不改 M6 装配。

`KnowledgeSupplyAudit` 的失败账本、Approval Center、Feed Adapter 与 Agent 认知包仍属 M5–M6。本分支不改它们的验收状态。

## 5. 验收机器人应核对

1. `EnterpriseKnowledgeProjectionSpec.sourceActions` 含 `connectorId`、`actionKey`、`version`。缺 `sourceActions`、多源、未知 Action，或动作不在已链接 DataCapability 的 `actionRefs` 里时，写入失败。
2. 模板只有 Normalize / Aggregate / Trend / RiskDetection / Forecast。`SqlTemplate` 在 RPC 被拒绝，引擎不执行 SQL 或脚本。
3. `runProjectionMaterialization` 是供给侧调用 Enterprise Data Gateway 的实现。它写入 FeedItem 与一条 lineage。草稿规格返回 `PROJECTION_NOT_ACTIVE`。禁用绑定返回 `PROJECTION_BINDING_DISABLED`。
4. `KnowledgeVisibilityPolicy` 按 seat、team、agent type 过滤 `feed-items.list`。`agentId` 预览参数被拒绝。
5. 成员调用 `projection-specs.get`、`projection-bindings.get`、`projection-materializer.run` 只收到一次管理员拒绝。
6. diff 不把红线 5 写成 PASS，也不把 M5–M6 写成通过。批准前不要把 M4 写成通过。

## 6. 测试

```bash
OPENBOT_TEST_PROFILE=low OPENBOT_TEST_SERIAL_GATEWAY=1 pnpm exec vitest run \
  src/gateway/enterprise-data/projection-materializer.test.ts \
  src/gateway/enterprise-data/knowledge-supply.test.ts \
  src/gateway/server-methods/enterprise-data-m4.test.ts \
  src/gateway/knowledge/knowledge-consumption-boundary.test.ts
```

结果：**4 files, 29 tests passed**（2026-09-27，分支 `cursor-grok/edgsc-m4-acceptance-close`，基线 `3aed9c55`）。其中 `projection-materializer.test.ts` 9 条，含 FeedItem 写入、显式 `sourceActions`、能力对齐、草稿拒绝和未知模板；`knowledge-supply.test.ts` 2 条，含可见性评估；`enterprise-data-m4.test.ts` 15 条，含成员读取投影规格与绑定只收到一次管理员拒绝；`knowledge-consumption-boundary.test.ts` 3 条，知识平面不 import Gateway。
