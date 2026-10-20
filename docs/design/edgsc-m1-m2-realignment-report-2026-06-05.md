# 企业数据治理与供给中心 M1/M2 重组完成报告（修订版 v2，2026-06-05）

> 依据：`docs/design/openbot-enterprise-data-governance-and-supply-center-final-instruction-2026-06-05.md`

## 〇、架构硬约束（必读）

以下原则优先级高于任何“新增对象清单”：

1. **`ConnectorAction@version` 仍然是唯一执行落点**  
   审计、审批、脱敏、Scope、版本升级、血缘追踪都必须直接落到 Action，不能跳过。

2. **上层对象是治理与供给视图层，不是新的执行权限层**  
   `DataSource`、`DataCapability`、`EnterpriseKnowledgeProjectionSpec`、`EnterpriseKnowledgeObjectFeedItem` **均不是**执行权限对象，**不能**替代 `SeatActionGrant`。

3. **运行时执行授权链不变**  
   `Seat → SeatActionGrant → ConnectorAction@version → Enterprise Data Gateway`  
   `DataAccessPolicy` 仅是管理面抽象，必须编译为 `SeatActionGrant`。

4. **消费层边界（写死）**
   - `Knowledge Universe` **不得**直接调用 `Enterprise Data Gateway` / `ConnectorAction` / `DataSource`
   - `Knowledge Universe` **只能**消费 `EnterpriseKnowledgeObjectFeedItem`（经 Knowledge Feed Adapter）
   - `Agent Runtime` **不得**直接申请 `ConnectorAction@version`；**只能**消费 Knowledge Object
   - **唯一**可调用底层执行平面的是 `ProjectionMaterializer`

## 一、当前阶段定位

**我们仍处在 Execution Governance 主线补齐期（M1），不是上层供给全面展开期。**

| 类别     | 当前允许                                                                         | 当前禁止（抢跑）                                                      |
| -------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 执行治理 | Action、Registry、Grant、Policy 编译                                             | —                                                                     |
| 上层模型 | DataSource / DataCapability / ProjectionSpec / Binding 的**模型 + 只读治理 RPC** | ProjectionMaterializer 实质运行                                       |
| 供给消费 | —                                                                                | FeedItem 写入、Visibility 运行时、Feed Adapter、Universe 直连 Gateway |

已落地的 M2/M3 上层对象均为**治理视图层 scaffolding**，服务于管理面反查与编译，不扩展新的运行时权限链。

## 二、重组原因

专家团队最终指令要求：

1. 模块定位为 **Enterprise Data Governance & Supply Center**（治理 + 供给）
2. 双内核并存，但**底层执行先于上层供给**
3. 上层对象用于治理视图与供给编排声明，**不得**成为执行权限替代品
4. `DataAccessPolicy` 编译为 `SeatActionGrant`（管理面 → 运行时）

## 三、治理视图层对象（非执行权限层）

| 对象                                   | 层级       | 职责                                                        |
| -------------------------------------- | ---------- | ----------------------------------------------------------- |
| `DataSource`                           | 治理视图   | 企业数据资产入口；`connectorId` 关联技术 Connector          |
| `DataCapability`                       | 治理视图   | 业务能力抽象；`actionRefs` 指向真实 Action（展示/编排）     |
| `DataAccessPolicy`                     | 管理面抽象 | 编译为 `SeatActionGrant`；**不是**运行时权限对象            |
| `EnterpriseKnowledgeProjectionSpec`    | 供给声明   | 必须**显式**保留 `sourceActions`；`capabilityId` 仅可选关联 |
| `EnterpriseKnowledgeProjectionBinding` | 供给元数据 | 物化/新鲜度/生成器版本；**不是**执行授权                    |

> 命名修订：原 `KnowledgeProjectionBinding` 已更名为 **`EnterpriseKnowledgeProjectionBinding`**，避免与 `LearningProjection` 语义混淆。

## 四、ProjectionSpec 与 Action 追踪（修订）

**正确口径：**

- `EnterpriseKnowledgeProjectionSpec` **可以**关联 `capabilityId`（治理视图关联）
- **必须显式保留**精确 `sourceActions`（`connectorId + actionKey + version`）
- **禁止**仅靠 DataCapability 隐式派生 `sourceActions`（代码已强制：`sourceActions` 必填）

`capabilityId` 仅用于治理交叉校验（`sourceActions` 须与 Capability 的 `actionRefs` 对齐），不替代直接 Action 引用。

## 五、代码交付（Execution + 治理视图 scaffolding）

### M1 执行治理（已落地 / 补齐中）

- `ConnectorAction@version`
- `ConnectorRuntimeRegistry`
- `SeatActionGrant`
- 待补齐：`ScopePolicy`、`MaskingPolicy`、`Classification`、`Enterprise Data Gateway`

### 治理视图层 scaffolding（只读 + 编译，非抢跑）

| 模块                                               | 说明                                     |
| -------------------------------------------------- | ---------------------------------------- |
| `data-source-store.ts`                             | DataSource                               |
| `data-capability-store.ts`                         | DataCapability                           |
| `data-access-policy-store.ts`                      | 管理面策略 + `compileDataAccessPolicy()` |
| `projection-spec-store.ts`                         | 显式 `sourceActions` 必填                |
| `enterprise-knowledge-projection-binding-store.ts` | `EnterpriseKnowledgeProjectionBinding`   |

## 六、新增 RPC（治理视图只读为主）

| 方法                                    | 层级                           |
| --------------------------------------- | ------------------------------ |
| `enterprise-data.sources.*`             | 治理视图                       |
| `enterprise-data.capabilities.*`        | 治理视图                       |
| `enterprise-data.access-policies.*`     | 管理面（`compile` 产出 Grant） |
| `enterprise-data.projection-specs.*`    | 供给声明（含显式 Action 引用） |
| `enterprise-data.projection-bindings.*` | 供给元数据                     |

## 七、测试

```bash
pnpm exec vitest run src/gateway/enterprise-data/connector-action-store.test.ts
```

覆盖：

- Action 为唯一执行落点（Grant 编译链）
- DataSource ≠ Connector
- ProjectionSpec **拒绝**无显式 `sourceActions`
- `EnterpriseKnowledgeProjectionBinding` 元数据存储
- @v1/@v2 并存

## 八、下一步（严格顺序）

### 当前优先级：M1 Execution Governance 补齐

1. `ScopePolicy` + `DataClassification` + `MaskingPolicy`
2. `Enterprise Data Gateway`（唯一执行入口）
3. `ApprovalPolicy` + `AuditRuntime`（双层审计）

### 明确不抢跑（待 M1 完成 + 专家验收后）

- `ProjectionMaterializer` 实质运行
- `EnterpriseKnowledgeObjectFeedItem` 写入
- `KnowledgeVisibilityPolicy` 运行时 enforcement
- `Knowledge Feed Adapter` / `Knowledge Universe` 对接
- `Agent Cognitive Runtime` 消费链路

## 九、消费层边界声明（冻结）

```text
ProjectionMaterializer  →  Enterprise Data Gateway  →  ConnectorAction@version
Knowledge Feed Adapter  →  EnterpriseKnowledgeObjectFeedItem  →  Knowledge Universe
Agent Cognitive Runtime →  Knowledge Object only（禁止直连 Action/Gateway）
```

## 十、复验结论（请专家团队填写）

- [ ] v2 修订通过，可继续 M1 Execution Governance 补齐
- [ ] 仍有问题（请注明）
