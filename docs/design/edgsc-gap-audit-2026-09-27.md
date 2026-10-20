# 企业数据治理与供给中心差距审计（2026-09-27）

> 对照冻结总指令：`docs/design/openbot-enterprise-data-governance-and-supply-center-final-instruction-2026-06-05.md` §5、§11、§12。  
> M1 审计基线：`origin/main` `b027aad1ca6d35db5a5dc88233b0c1a4e0199890`。M1 已在 PR #144 squash-merge 后独立验收通过（`74d98e287`）。  
> M2 已在 PR #147 squash-merge 后独立验收通过（`39c8fce85`）。  
> M3 已在 PR #152 squash-merge 后独立验收通过（`3aed9c55`）。  
> M4 已在 PR #155 squash-merge 后独立验收通过（`559c67de0`）。  
> M5 已在 PR #156 squash-merge 后独立验收通过（`812d8e830`）。  
> M6 核对基线：`origin/main` `812d8e83059e41b4af4b547797952b37e65c0776`。M6 可进入专属验收，验收机器人批准前不得写成通过。红线 5 在 M6 收口分支关闭，见 §2。

## 1. 里程碑矩阵

M6 行里的「可进入专属验收」不是验收通过。M1–M5 已独立验收。M6 已核对到可以交给专属验收机器人，批准前仍不是通过。§4–§9 是各里程碑当时的清单；红线 5 的当前状态见 §2，M6 的当前状态见 §10。

| 里程碑 | 状态                         | 证据                                                                                                                                                                                                                                                                                                                                | 说明                                                                                                                                                                                                                      |
| ------ | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **M1** | **已独立验收**               | `src/gateway/enterprise-data/connector-action-store.ts`、`scope-policy-store.ts`、`field-classification-store.ts`、`masking-engine.ts`、`approval-policy-store.ts`、`approval-workflow.ts`、`audit-runtime.ts`、`data-gateway.ts`、`seat-action-grant-store.ts`、`src/gateway/server-methods/enterprise-data-m1.ts`                 | PR #144 squash-merge 后通过。§11 M1 六项都在执行平面。员工执行入口是 `enterprise-data.invoke`。                                                                                                                           |
| **M2** | **已独立验收**               | `data-source-store.ts`、`data-access-policy-store.ts`、`access-governance-store.ts`、`src/gateway/server-methods/enterprise-data-m2.ts`、`enterprise-data.ts` 中的 DataSource / DataAccessPolicy 管理面 RPC                                                                                                                         | PR #147 squash-merge 后通过。证据：`docs/design/edgsc-m2-acceptance-close-2026-09-27.md`。                                                                                                                                |
| **M3** | **已独立验收**               | `data-capability-store.ts`、`capability-governance-store.ts`、`src/gateway/server-methods/enterprise-data-m3.ts`、`enterprise-data.ts` 中的 `capabilities.grant-seat`                                                                                                                                                               | PR #152 squash-merge 后通过。证据：`docs/design/edgsc-m3-acceptance-close-2026-09-27.md`。执行授权仍是 `ConnectorAction@version`。                                                                                        |
| **M4** | **已独立验收**               | `projection-spec-store.ts`、`projection-template-engine.ts`、`projection-materializer.ts`、`knowledge-feed-item-store.ts`、`knowledge-visibility-policy-store.ts`、`enterprise-knowledge-projection-binding-store.ts`、`src/gateway/server-methods/enterprise-data-m4.ts`、`enterprise-data.ts` 中的 projection spec / binding 读取 | PR #155 squash-merge 后通过。证据：`docs/design/edgsc-m4-acceptance-close-2026-09-27.md`。                                                                                                                                |
| **M5** | **已独立验收**               | `knowledge-lineage-store.ts`、`lineage-governance-store.ts`、`knowledge-supply-audit-store.ts`、`governance-approval-store.ts`、`src/gateway/server-methods/enterprise-data-m5.ts`                                                                                                                                                  | PR #156 squash-merge 后通过。证据：`docs/design/edgsc-m5-acceptance-close-2026-09-27.md`。                                                                                                                                |
| **M6** | **可进入专属验收，尚未通过** | `src/gateway/knowledge/feed/knowledge-feed-adapter.ts`、`enterprise-feed-adapter.ts`、`source-bundle.ts`、`runtime/agent-cognitive-adapter.ts`、`lineage/lineage-explain.ts`、`src/gateway/server-methods/knowledge.ts`                                                                                                             | Feed Adapter、知识宇宙装配、Agent 认知包、`knowledge.feed.list` / `knowledge.lineage.explain` / `knowledge.cognitive.bundle`。证据：`docs/design/edgsc-m6-acceptance-close-2026-09-27.md`。批准前不是通过。红线 5 见 §2。 |

总计划状态见 `docs/design/edgsc-master-implementation-plan-2026-06-05.md`。M1–M5 已独立验收。M6 可进入专属验收，批准前不是通过。

## 2. 五条红线

| #   | 红线                                                | 状态                      | 证据                                                                                                                                                                                                                                                                                   |
| --- | --------------------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | DataSource ≠ Connector 别名                         | **PASS**                  | `types.ts` 中 `DataSource` 有独立 `sourceId` / `sourceKey`，`connectorId` 只是技术关联。`data-source-store.ts` 写入前要求该 Connector 已注册 Action，不把两者做成同一标识。                                                                                                            |
| 2   | DataCapability 不取代 ConnectorAction@version       | **PASS**                  | Gateway 仍按 `actionKey + version` 找 Action、Grant、Handler。Capability 的 `actionRefs` 是精确版本引用。                                                                                                                                                                              |
| 3   | ProjectionStudio 不是 SQL/脚本平台                  | **PASS**                  | `ProjectionTemplateKey` 只有 Normalize / Aggregate / Trend / RiskDetection / Forecast。`projection-template-engine.ts` 无 SQL、`eval` 或脚本执行。                                                                                                                                     |
| 4   | Knowledge Universe 不直接接 Enterprise Data Gateway | **PASS**（有残留，见 §3） | 知识平面边界测试禁止 import Gateway。宇宙加载不再调用按需物化。知识平面没有 `knowledge.data.invoke`。                                                                                                                                                                                  |
| 5   | Agent Runtime 不直接申请 ConnectorAction            | **PASS**                  | M6 收口关闭原路径。`data_capability` 的 invoke 返回 `knowledge-object-only`。`invokeDataCapabilityWithContext` 不再请求 ConnectorAction。生产调用只剩 `enterprise-data-m1.ts` 的员工执行与 `projection-materializer.ts`。证据：`docs/design/edgsc-m6-acceptance-close-2026-09-27.md`。 |

Seat 仍是执行授权主体：Gateway 在没有 `seatId` 时返回 `NO_SEAT_CONTEXT`；部门/角色策略在 `policy-backed-grant-resolver.ts` 里合成的仍是带 `seatId` 的 `SeatActionGrant`，没有新增 DigitalHuman 或 KnowledgeObject 权限主体。

供给侧允许调用 Gateway 的实现是 `projection-materializer.ts` 里的 `runProjectionMaterialization`。员工执行 RPC 仍是 `enterprise-data.invoke`。

## 3. 仍记录在案的残留

1. **红线 5 已在 M6 收口关闭。** 旧路径不再请求 ConnectorAction。不要把 M6 里程碑写成通过；那要等专属验收机器人。
2. **供给节拍仍在知识目录里调用物化。** `scheduled-projection-materializer.ts` 由网关维护节拍调用 `runProjectionMaterialization`。宇宙加载已经不再调用按需物化。`on_demand` 绑定不会因为打开知识宇宙而自动拉 Gateway。
3. **能力 Feed 读取 DataSource 元数据。** `src/gateway/knowledge/feed/data-capability-feed-adapter.ts` 用 DataSource 状态计算新鲜度，不调用 Gateway。这和「知识宇宙只消费已物化 FeedItem、不消费 DataSource」的字面边界不完全重合，属于展示层读取。本轮没有改这条读取。

## 4. M1 验收应看什么

M1 代码无需再补功能。验收机器人 / 评审人请核对：

- `enterprise-data.invoke` 仍是员工执行入口；治理 RPC 走 `requireResolvedEnterpriseAdminTenantId`。
- 客户端传入 `tenantId` / `seatId` / `employeeId` / `teamLabel` 等身份字段时，`assertNoClientExecutionIdentity` 拒绝。
- TEAM Scope 缺 `teamLabel` 返回 `SCOPE_CONTEXT_MISSING`（`data-gateway.test.ts`）。
- v2 未登记字段 fail-closed；export 的 PER_REQUEST 批准后同上下文不能再用；HIGH 审计失败返回 `AUDIT_WRITE_FAILED`。
- 本 PR 只改两份设计文档，不改 `src/gateway/enterprise-data/**`。
- 红线 5 保持 **OPEN GAP**。已核实路径 `src/agents/tools/data-capability-tool.ts` → `src/gateway/enterprise-data/capability-agent-invoke-runtime.ts` → `invokeEnterpriseDataAction`。本 PR 不修复，留给后续专阶段。不要把它写成 PASS，也不要因为该缺口把 M1 执行基线判成未实现。

## 5. 本次测试

```bash
OPENBOT_TEST_PROFILE=low OPENBOT_TEST_SERIAL_GATEWAY=1 pnpm exec vitest run \
  src/gateway/enterprise-data/data-gateway.test.ts \
  src/gateway/enterprise-data/connector-action-store.test.ts \
  src/gateway/enterprise-data/audit-runtime.test.ts \
  src/gateway/enterprise-data/enterprise-data-seat-context.test.ts \
  src/gateway/enterprise-data/enterprise-data-seat-context.session.test.ts \
  src/gateway/enterprise-data/enterprise-data-tenant-scope.test.ts \
  src/gateway/enterprise-data/enterprise-data-admin-scope.test.ts \
  src/gateway/knowledge/knowledge-consumption-boundary.test.ts
```

结果：**8 files, 43 tests passed**（2026-09-27，对照上述 `origin/main`）。

仓库里没有 `src/gateway/server-methods/enterprise-data-m1.test.ts`。M1 行为由 Gateway 与 Seat 上下文单测覆盖，不构成缺实现。

## 6. M2 专属验收应看什么

M2 已在 PR #147 独立验收通过。当时的核对清单见 `docs/design/edgsc-m2-acceptance-close-2026-09-27.md`：

- `DataSource.sourceId` 独立于 `connectorId`。同一 Connector 可以挂多个 DataSource。没有已注册 Action 的 Connector 不能登记 DataSource。
- `compileDataAccessPolicy` 只编译 `seat` 目标，产物是带 `scopePolicyId` / `approvalPolicyId` 的 `SeatActionGrant`。department / role 登记返回 `DATA_ACCESS_POLICY_COMPILE_UNSUPPORTED`。
- Access Governance 的 matrix / resolve-target / policy detail 暴露 `runtimeActionRefs`，含 `connectorId + actionKey + version`。
- `enterprise-data-m2.ts` 与 DataSource / DataAccessPolicy 管理面 RPC 在参数校验之前返回管理员拒绝，且只回复一次。
- 本阶段不改 ProjectionMaterializer、Feed、Knowledge Universe。红线 5 保持 **OPEN GAP**。

## 7. M3 专属验收应看什么

M3 已在 PR #152 独立验收通过。当时的核对清单见 `docs/design/edgsc-m3-acceptance-close-2026-09-27.md`：

- `DataCapability.actionRefs` 保留 `connectorId + actionKey + version`。Gateway 执行授权仍查 `SeatActionGrant` 与 `ConnectorAction@version`，不把 DataCapability 当成执行主体。
- Capability Source Mapper 只按 `sourceIds` 反查。Capability Action Mapper 与 `resolve-by-action` 按完整版本键区分同一 `actionKey` 的 v1 与 v2。
- `governance-view` 返回来源数据源、来源动作、按 `capabilityId` 关联的 Projection、开放范围和供给健康。只引用 v2 的能力不带上 v1 策略或 v1 Grant。
- `enterprise-data-m3.ts` 与 `capabilities.grant-seat` 在参数校验之前返回管理员拒绝，且只回复一次。
- 该次收口不改 ProjectionMaterializer、Feed、Knowledge Universe。红线 5 保持 **OPEN GAP**。M4 已独立验收。M5 见 §9，批准前不是通过。M6 仍未独立验收。

## 8. M4 专属验收应看什么

M4 已在 PR #155 独立验收通过。当时的核对清单见 `docs/design/edgsc-m4-acceptance-close-2026-09-27.md`：

- `EnterpriseKnowledgeProjectionSpec.sourceActions` 显式必填，含 `connectorId + actionKey + version`。空 `sourceActions` 不能靠 `capabilityId` 补齐。链接能力时，动作必须落在该能力的 `actionRefs` 上。
- Projection Studio 只有 Normalize / Aggregate / Trend / RiskDetection / Forecast。没有 SQL Builder 或脚本执行。
- 供给侧调用 Enterprise Data Gateway 的实现是 `runProjectionMaterialization`。它写入 `EnterpriseKnowledgeObjectFeedItem`。知识平面不 import Gateway。
- `KnowledgeVisibilityPolicy` 过滤 Feed 列表。`feed-items.list` 用 `agentType`，拒绝 `agentId`。
- `enterprise-data-m4.ts` 与 `projection-specs.get` / `projection-bindings.get` 在参数校验之前返回管理员拒绝，且只回复一次。
- 红线 5 保持 **OPEN GAP**。M5 见 §9，批准前不是通过。M6 仍未独立验收。

## 9. M5 专属验收应看什么

M5 已在 PR #156 独立验收通过。当时的核对清单见 `docs/design/edgsc-m5-acceptance-close-2026-09-27.md`：

- `KnowledgeLineageRecord` 带 `objectId`、`projectionId`、`sourceActions`、`sourceTraceIds`、`generatedAt`、`generatorVersion`。物化成功时写入一条记录。
- `KnowledgeSupplyAudit` 只记录物化成功和失败，不作为跨租户报表或外部导出。
- Approval Center 把数据源接入、数据访问、能力开放分成三条通道。批准后分别把 DataSource 标为 connected、把策略编译成 `SeatActionGrant`、把 DataCapability `enabled` 设为 true。这三类与 M1 执行审批 `ApprovalRequest` 分开。
- Audit & Lineage 能回答 Insight → Metric → Projection → ConnectorAction@version → Source Data。动作节点带 `connectorId`、`actionKey`、`version`。源数据排在动作之后。同一能力上的指标才会接到洞察；另一能力的指标不会串进来。
- `knowledge.lineage.explain` 只读存储，知识平面不调用 Gateway。
- `enterprise-data-m5.ts` 的血缘、供给审计、治理审批读取在参数校验之前返回管理员拒绝，且只回复一次。
- M5 已在 PR #156 独立验收通过。红线 5 的当前状态见 §2。M6 见 §10，批准前不是通过。

## 10. M6 专属验收应看什么

M6 代码核对见 `docs/design/edgsc-m6-acceptance-close-2026-09-27.md`。验收机器人批准前，本行不是通过。请核对：

- Knowledge Feed Adapter 合并企业 Feed 与数据能力 Feed。企业宇宙对象只来自已写入的 FeedItem。没有物化记录的投影规格不会出现在企业 Feed 里。
- `knowledge.feed.list` 不触发物化，也不调用 Gateway。`source-bundle.ts` 不调用 `ensureOnDemandProjectionsMaterialized`。
- `knowledge.cognitive.bundle` 只把非 restricted 的 Knowledge Object 交给 Agent。`knowledge.lineage.explain` 只读存储。
- 知识平面不 import Gateway。没有 `knowledge.data.invoke`。
- 红线 5 为 **PASS**。`data_capability` invoke 与 `invokeDataCapabilityWithContext` 返回 `knowledge-object-only`。生产代码里 Gateway 动作调用只剩员工 `enterprise-data.invoke` 与 `runProjectionMaterialization`。
- 数据能力 Feed 仍用 DataSource 状态计算新鲜度。这是 §3 的展示层残留，不把红线 4 改回失败。
- 批准前不要把 M6 写成通过。
