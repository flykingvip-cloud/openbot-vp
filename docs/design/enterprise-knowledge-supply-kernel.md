# Enterprise Knowledge Supply Kernel 设计文档

> 状态：最终冻结版 v2（2026-06-05）  
> 总指令：`docs/design/openbot-enterprise-data-governance-and-supply-center-final-instruction-2026-06-05.md`

## 0. 与执行层边界

本内核对象是**治理与供给视图/声明层**，不是执行权限层：

| 对象                                | 是否执行权限       | 说明                                   |
| ----------------------------------- | ------------------ | -------------------------------------- |
| `ConnectorAction@version`           | **是（唯一落点）** | 属于 Execution Kernel                  |
| `DataSource`                        | 否                 | 企业治理视图                           |
| `DataCapability`                    | 否                 | 业务能力抽象；`actionRefs` 指向 Action |
| `EnterpriseKnowledgeProjectionSpec` | 否                 | 必须显式 `sourceActions`               |
| `EnterpriseKnowledgeObjectFeedItem` | 否                 | 消费层入口                             |

## 1. 消费层边界（写死）

- `Knowledge Universe` → 仅 `EnterpriseKnowledgeObjectFeedItem`（经 Feed Adapter）
- `Agent Runtime` → 仅 Knowledge Object；**禁止** `ConnectorAction@version`
- `ProjectionMaterializer` → **唯一**可调 `Enterprise Data Gateway`

## 2. 对象链路

```text
DataSource → DataCapability → EnterpriseKnowledgeProjectionSpec
  (+ explicit sourceActions → ConnectorAction@version)
  → EnterpriseKnowledgeProjectionBinding
  → [M4+] ProjectionMaterializer → FeedItem
```

## 3. EnterpriseKnowledgeProjectionSpec 规则

- **可以**关联 `capabilityId`（治理视图）
- **必须**显式保留 `sourceActions`（精确版本）
- **禁止**从 DataCapability 隐式派生 sourceActions

## 4. EnterpriseKnowledgeProjectionBinding

原 `KnowledgeProjectionBinding` 已更名为 **`EnterpriseKnowledgeProjectionBinding`**，避免与 `LearningProjection` 混淆。仅承载供给元数据（materialization/freshness/generatorVersion），不是执行授权。

## 5. 当前实现范围

| 项                                      | 状态                        |
| --------------------------------------- | --------------------------- |
| 模型 + 只读 RPC                         | ✅                          |
| Materializer / Feed / Visibility 运行时 | ❌ 禁止抢跑（待 M1 完成后） |
