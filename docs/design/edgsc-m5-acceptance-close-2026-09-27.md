# 企业数据治理与供给中心 M5 验收收口（2026-09-27）

> 基线：`origin/main` `559c67de068148af2314aea4cfda6d8e156ad819`（M4 验收合入之后）。  
> 依据：最终指令 §7.8、§8.7–8.8、§11 M5、§12。  
> 本文只说明 M5 可以交给专属验收机器人。**验收机器人批准前，M5 不是通过。** M6 不在本文验收范围内。红线 5 仍是 OPEN GAP。

## 1. 结论

M5 的 `KnowledgeLineageRecord`、`KnowledgeSupplyAudit`、三类治理审批，以及 M5 RPC，在上述基线上已经落在代码里。本分支补上了 §8.7 要求的反向链，并把审批中心的三类待办分成独立通道。

未改 Agent 直接调用 Gateway 的路径。未把 M6 Feed Adapter、知识宇宙装配或 Agent 认知包写成验收通过。

## 2. 对照

| 条款                          | 核对                                                                                                                                                                                               | 代码                                                                   |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| §7.8 `KnowledgeLineageRecord` | 记录含 `objectId`、`projectionId`、`sourceActions`、`sourceTraceIds`、`generatedAt`、`generatorVersion`。物化成功时写入。                                                                          | `types.ts`；`knowledge-lineage-store.ts`；`projection-materializer.ts` |
| §11 `KnowledgeSupplyAudit`    | 物化成功写 `materialization_success`，失败写 `materialization_failure`。没有跨租户报表或外部导出。                                                                                                 | `knowledge-supply-audit-store.ts`                                      |
| §8.8 Approval Center          | 三类是 `source_onboarding`、`data_access`、`capability_exposure`。列表按类别过滤，不会把三类混成一条结果。批准后分别接通数据源、编译 `SeatActionGrant`、打开能力。与 M1 `ApprovalRequest` 分库存。 | `governance-approval-store.ts`；待审批面板三条通道                     |
| §8.7 反向链                   | 洞察先找到同一能力上的指标，再落到投影、带 `connectorId + actionKey + version` 的动作，最后才是源数据。另一能力的更新指标不会被接上。数据类对象不编造洞察或指标。                                  | `lineage-governance-store.ts` 的 `reverseChain`；审计面板              |
| 知识平面 / lineage explain    | `explainKnowledgeLineage` 只读存储并带回反向链。知识平面边界测试禁止 import Gateway。没有 `knowledge.data.invoke`。                                                                                | `lineage-explain.ts`；`knowledge-consumption-boundary.test.ts`         |
| §11 M5 RPC 管理员门禁         | `enterprise-data-m5.ts` 在管理员拒绝后直接返回。`lineage.get`、`supply-audit.get`、`governance-approvals.get` 不再补一帧缺 id。                                                                    | `enterprise-data-m5.ts`                                                |
| §12 红线 5                    | **OPEN GAP，本分支不修。** 路径仍是 `src/agents/tools/data-capability-tool.ts` → `capability-agent-invoke-runtime.ts` → `invokeEnterpriseDataAction`。                                             | 差距审计 §2                                                            |

执行主体仍是 Seat。治理审批通过后的数据访问副作用仍是 `compileDataAccessPolicy` 写出的 `SeatActionGrant`。本分支不新增 DigitalHuman 或 KnowledgeObject 权限主体。

## 3. 本分支修的缺口

`resolveKnowledgeLineageChain` 原先只回答 Feed → Projection → Capability → Source → Action → Trace。动作展示串是 `actionKey@version`，没有 `connectorId`，源数据排在动作前面。这答不上 §8.7。

现在同一份解析额外给出 `reverseChain`：

`Insight → Metric → Projection → ConnectorAction@version → Source Data`

指标只从洞察的 `payload.metricObjectId`、同一 `capabilityId`，或完全相同的 `connectorId + actionKey + version` 里找。找不到就不编造。动作节点 id 是 `connectorId::actionKey@version`。

待审批面板把数据源接入、数据访问、能力开放分成三条通道。审批管理列表按这三类分节，不再是一张不分类的待办表。

## 4. 留给验收机器人、本分支不改的行为

`capability-agent-invoke-runtime.ts` 仍可按 capability 触发 `invokeEnterpriseDataAction`。这不把红线 5 变成 PASS。本分支不改这条路径。

`knowledge.lineage.explain` 仍只读。它现在会带上反向链，但不会调用 Gateway。Feed Adapter、知识宇宙装配和 Agent 认知包仍属 M6。本分支不改它们的验收状态。

身份绑定、员工能力申请等额外审批类别仍可存在。§8.8 要求至少三类，这三类保持独立。

## 5. 验收机器人应核对

1. 物化写入 `KnowledgeLineageRecord`，并在成功和失败时各写一条 `KnowledgeSupplyAudit`。
2. 洞察的反向链角色顺序是 insight、metric、projection、connector_action、source_data。动作带 `connectorId`、`actionKey`、`version`。另一能力的指标不会出现在这条链上。
3. 数据类对象的反向链从 projection 开始，不编造 insight 或 metric。
4. 三类治理审批可以按类别单独列出。批准后数据源变为 connected，访问策略编译出 Grant，能力变为 enabled。
5. 成员调用 `lineage.resolve`、`lineage.get`、`supply-audit.get`、`governance-approvals.get` 只收到一次管理员拒绝。
6. 知识平面不 import Gateway。`explainKnowledgeLineage` 的反向链与解析结果一致，且不发起执行。
7. diff 不把红线 5 写成 PASS，也不把 M6 写成通过。批准前不要把 M5 写成通过。

## 6. 测试

```bash
OPENBOT_TEST_PROFILE=low OPENBOT_TEST_SERIAL_GATEWAY=1 pnpm exec vitest run \
  src/gateway/enterprise-data/lineage-governance.test.ts \
  src/gateway/enterprise-data/governance-approval.test.ts \
  src/gateway/server-methods/enterprise-data-m5.test.ts \
  src/gateway/knowledge/lineage/lineage-explain.test.ts \
  src/gateway/knowledge/knowledge-consumption-boundary.test.ts \
  ui/src/ui/views/enterprise-data-capability/panels.browser.test.ts \
  ui/src/ui/ports/enterprise/views/enterprise-data-capability/audit-lineage-panel.node.test.ts
```

结果：**7 files, 29 tests passed**（2026-09-27，分支 `cursor-grok/edgsc-m5-acceptance-close`，基线 `559c67de0`）。其中 `lineage-governance.test.ts` 3 条，含完整反向链与另一能力指标不串入；`governance-approval.test.ts` 3 条，含三类审批分列与副作用；`enterprise-data-m5.test.ts` 5 条，含成员读取只收到一次管理员拒绝；`lineage-explain.test.ts` 1 条，解释只读并带回反向链；`knowledge-consumption-boundary.test.ts` 3 条，知识平面不 import Gateway。`panels.browser.test.ts` 另有 1 条既有跳过，与本分支无关。
