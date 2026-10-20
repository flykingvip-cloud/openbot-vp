# 企业数据治理与供给中心总实施计划（最终冻结版 v2）

> **唯一总指令**：`docs/design/openbot-enterprise-data-governance-and-supply-center-final-instruction-2026-06-05.md`

## 0. 架构硬约束

- **`ConnectorAction@version` 是唯一执行落点**（审计/审批/脱敏/Scope/血缘均落 Action）
- **上层对象 = 治理与供给视图层**，不是新的执行权限层
- **Knowledge Universe 只吃 Feed**；**Agent Runtime 只吃 Knowledge Object**
- **只有 ProjectionMaterializer 可调 Enterprise Data Gateway**

## 1. 模块定位

**Enterprise Data Governance & Supply Center**（企业数据治理与供给中心）

## 2. 双内核 + 消费层

```text
Execution Governance Kernel（运行时权限链）
  Seat → SeatActionGrant → ConnectorAction@version → Gateway

Knowledge Supply Kernel（治理/供给声明层）
  DataSource → DataCapability → EnterpriseKnowledgeProjectionSpec
  → EnterpriseKnowledgeProjectionBinding → [M4+] Materializer → FeedItem

Consumption Layer
  Feed Adapter → Knowledge Universe → Agent Runtime → Employee Agent
```

## 3. 当前阶段

**2026-09-27 审计：M1–M6 的 §11 代码能在 `main` 上找到。** 对照见 `docs/design/edgsc-gap-audit-2026-09-27.md`。M1–M5 已独立验收。M6 可进入专属验收，批准前不是通过。

历史口径（不再描述当前代码是否存在）：Execution Governance 主线补齐期曾要求上层 DataSource / DataCapability / Projection 只做模型与只读视图。

红线 5 在 M6 收口分支为 **PASS**。Agent 工具 invoke 与 `invokeDataCapabilityWithContext` 失败关闭，不再请求 ConnectorAction。生产调用只剩员工 `enterprise-data.invoke` 与 `runProjectionMaterialization`。M6 里程碑本身在验收机器人批准前不是通过。

## 4. 里程碑

M1–M5 已独立验收。M6 可进入专属验收，批准前不是通过。

| 里程碑 | 内容                                                                  | 状态（审计 2026-09-27）                                                                                |
| ------ | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **M1** | Action、Scope、Masking、Approval、Audit、**Gateway**                  | 已独立验收（PR #144）。                                                                                |
| **M2** | DataSource、DataAccessPolicy（管理面编译）                            | 已独立验收（PR #147）。证据：`docs/design/edgsc-m2-acceptance-close-2026-09-27.md`。                   |
| **M3** | DataCapability                                                        | 已独立验收（PR #152）。证据：`docs/design/edgsc-m3-acceptance-close-2026-09-27.md`。                   |
| **M4** | ProjectionSpec（显式 sourceActions）、Binding、Materializer、FeedItem | 已独立验收（PR #155）。证据：`docs/design/edgsc-m4-acceptance-close-2026-09-27.md`。                   |
| **M5** | Lineage、SupplyAudit、Approval Center                                 | 已独立验收（PR #156）。证据：`docs/design/edgsc-m5-acceptance-close-2026-09-27.md`。                   |
| **M6** | Feed Adapter、Universe、Agent Runtime                                 | 可进入专属验收，尚未通过。证据：`docs/design/edgsc-m6-acceptance-close-2026-09-27.md`。红线 5 已关闭。 |

## 5. 五条红线

1. DataSource ≠ Connector 别名
2. DataCapability **不取代** ConnectorAction@version
3. ProjectionStudio 非脚本/SQL 平台
4. Knowledge Universe **不接** Data Gateway
5. Agent Runtime **不直接申请** Action。审计状态：**PASS**（M6 收口）。Agent invoke 失败关闭，不再请求 ConnectorAction。

## 6. 代码锚点

```
src/gateway/enterprise-data/
  connector-action-store.ts              # M1 执行落点
  runtime-registry.ts
  seat-action-grant-store.ts             # M1 运行时授权
  data-source-store.ts                   # M2 治理视图
  data-access-policy-store.ts            # M2 管理面 → 编译 Grant
  data-capability-store.ts               # M3 治理视图
  projection-spec-store.ts               # 显式 sourceActions 必填
  enterprise-knowledge-projection-binding-store.ts
```
