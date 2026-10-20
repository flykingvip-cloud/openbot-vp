# Seat Asset 与 Model Entitlement 统一建模评估（P4 任务 16）

> 关联：`.kiro/specs/model-entitlement-chain/design.md`（§1.5「不照搬」、§5.4、§8.1 P4）、`tasks.md` 任务 16。
> 结论先行：**维持独立并行授权层（`SeatModelGrantStore`），不收编进 `EnterpriseManagedAssetType`**。除非后续出现明确的统一收益信号（见「重估触发条件」）。

## 1. 背景与问题

P1–P3 已落地一条独立的模型授权链：

- `EnterpriseModelEntitlementStore`（企业 entitlement，由订阅 planVersion 投影）
- `SeatModelGrantStore`（seat / employee 粒度授权，`subjectType` + `subjectId`）
- 运行时 `resolveEffectiveModelSet` + hard-deny gate（仅 employee chat）

席位资产体系（`src/gateway/enterprise-seat-assets-store.ts`）已有成熟的 `EnterpriseManagedAssetType = "agent" | "space" | "memory" | "connector" | "capability"`，并自带交接（handover）、冻结（freeze）、审计（`EnterpriseAssetAuditEventType`）等语义。

任务 16 的决策点：是否把「模型授权」收编为第 6 种资产类型（`"model"`），让 `SeatModelGrant` 复用 seat asset 的生命周期机制。

## 2. 两种方案

### 方案 A：维持独立并行层（现状，推荐）

- 独立 store + 独立审计（`model.granted` / `model.revoked`）。
- 授权语义自洽：`grantedModelIds ⊆ EnterpriseModelEntitlement.allowedModelIds`，运行时交集即 EffectiveModelSet。

### 方案 B：收编进 `EnterpriseManagedAssetType`

- 新增资产类型 `"model"`，`SeatModelGrant` 改为 seat asset 记录；复用 handover/freeze/审计。

## 3. 代价分析

| 维度             | 方案 A（独立）                                                                      | 方案 B（收编）                                                                                            |
| ---------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 数据模型         | 简单：`{tenant, subjectType, subjectId, grantedModelIds[]}`                         | 需把「集合型授权」塞进「单资产实例」模型；模型是**多对一集合**，与 agent/space 的**单实例资产**形态不一致 |
| 交接（handover） | 授权天然跟 `subjectType="seat"` 走（交接后归属新员工）；employee 级授权显式绑定员工 | 复用 handover 流程，但模型授权多为「席位级集合」，handover 的单资产转移语义需特化                         |
| 冻结（freeze）   | 撤销 = `status:"revoked"`，运行时即时 hard-deny                                     | 复用 freeze，但模型冻结的运行时效果仍需回到 EffectiveModelSet 解析，收编不省这层                          |
| 审计             | 独立轻量事件，口径清晰                                                              | 混入 `EnterpriseAssetAuditEventType`，需区分「模型授权」与「资产授权」语义，查询/报表更复杂               |
| 运行时解析       | `resolveEffectiveModelSet` 直接读两个独立 store，路径短                             | 需从 seat asset 体系反查模型集合，解析路径变长、与资产生命周期耦合                                        |
| 回归风险         | 低：不动 `enterprise-seat-assets-store.ts` 主结构                                   | 高：改动 seat asset 核心类型，波及现有 agent/space/memory/connector/capability 全链路与既有测试           |
| 计费投影         | entitlement 由 planVersion 投影，与 billing 解耦                                    | 资产体系与 billing/seat quota 已有耦合，叠加模型集合易放大耦合面                                          |

## 4. 关键判断

1. **形态不匹配**：现有 seat asset 是「单实例可托管资产」（一个 agent、一个 space）。模型授权是「一个主体 → 一组 modelId 的集合」，更接近 ACL 而非资产实例。强行收编会引入 `assetType="model"` 但 `assetId` 语义含糊（是单个 model 还是一组？）的建模债。
2. **收编不省运行时层**：无论是否收编，运行时仍需 `resolveEffectiveModelSet`（entitlement ∩ grant ∩ catalog）。收编只改存储归属，不消除解析层，收益有限。
3. **风险/收益不对称**：收编需改动 seat asset 核心类型与审计枚举，回归面大；而独立层已满足 P1–P3 全部验收门，且对交接/撤销已有等价语义。
4. **设计已显式采纳独立**（design §1.5「不照搬-1」、§5.4）：本评估复核后维持该决策。

## 5. 结论

- **维持方案 A（独立并行授权层）**。
- 交接语义通过 `subjectType="seat"`（授权跟随席位）与 `subjectType="employee"`（绑定员工）已自然覆盖；冻结/撤销通过 `status` 即时反映到运行时 hard-deny。
- 不新增 `EnterpriseManagedAssetType="model"`，不改 `enterprise-seat-assets-store.ts` 主结构与 `EnterpriseAssetAuditEventType`。

## 6. 重估触发条件（出现任一再考虑收编）

1. 产品要求模型授权与其它资产**共用同一套交接审批流 / 冻结策略 / 配额结算**，且独立层无法低成本对齐。
2. 出现「模型作为可计费、可转移的单实例资产」（如绑定专属微调模型实例）需求，使模型从「集合 ACL」转为「单实例资产」。
3. 运维上需要在**单一资产视图**里统一审计全部授权（含模型），且跨 store 聚合成本过高。

## 7. 后续（非阻塞）

- 若 P4 凭证收敛（任务 15）推广到 `catalog` 模式，平台模型目录 `credentialRef` 成为运行时 key 单源；届时可在平台端把「目录条目 + 凭证」纳入资产视图展示，但**授权（grant）仍建议保持独立 ACL 层**。
