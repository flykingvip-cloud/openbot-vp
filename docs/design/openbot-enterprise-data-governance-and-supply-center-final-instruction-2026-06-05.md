# OpenBot 企业数据治理与供给中心最终实施指令

> 状态：最终冻结版（2026-06-05）  
> 用途：作为第三方实施团队后续开发的唯一总指令文档  
> 说明：本文件用于替代此前关于 Enterprise Data Capability Center 的旧总方案、旧升级指令与分散修正说明，避免团队理解分叉

## 1. 文档定位

本文件是第三方实施团队后续继续开发时的**唯一总指令文档**。

它不替代已经冻结的底层设计资产，而是作为这些设计资产之上的总架构与产品实施口径：

- `docs/design/connector-action-versioning.md`
- `docs/design/scope-policy-model.md`
- `docs/design/data-classification-model.md`
- `docs/design/audit-runtime-schema.md`
- `docs/design/approval-workflow-model.md`

这些文档继续作为底层设计约束有效。  
但所有关于“企业数据能力中心到底是什么、做成什么、边界在哪里、怎样和知识宇宙及 Agent Runtime 对接”的问题，统一以本文件为准。

## 2. 最终定位

本模块不应再被定义为：

- Connector 管理后台
- Action 管理后台
- Projection Studio 集合页

也不能被理解为单纯的：

- 企业数据授权中心

本模块的最终定位应冻结为：

## Enterprise Data Governance & Supply Center

中文名称建议冻结为：

**企业数据治理与供给中心**

它承担双重职责：

1. 治理企业数据资产的连接、开放、执行与审计
2. 向知识宇宙和员工机器人持续供给可信的企业认知对象

一句话定义：

**企业数据治理与供给中心是 OpenBot 企业认知体系中的数据治理与知识供给平台。**

## 3. 为什么必须修正方向

如果团队把它做成：

- 连接器管理系统
- Action 管理系统
- Projection 配置工具

都会带来严重偏差。

### 3.1 不能只停留在 Connector / Action

因为企业管理员真正关心的不是：

- CRM API
- ERP API
- `crm.customer.read_summary@v1`

他们关心的是：

- 客户画像
- 销售趋势
- 库存预警
- 现金流预测

### 3.2 也不能跳过 Action 直接做 Knowledge Object

因为真正执行的是：

- `ConnectorAction@version`

不是：

- `Knowledge Object`

如果把管理面直接提升到 Knowledge Object，而底层失去 Action 落点，未来以下能力都会失控：

- 审计
- 审批
- 版本升级
- 脱敏
- Scope 范围控制
- 责任追踪

因此必须建立：

- 上层治理与供给视图
- 下层执行治理内核

两层并存。

## 4. 最终架构结论

## 4.1 不是单内核，而是双内核

### Execution Governance Kernel

负责真实执行治理：

- `Connector`
- `ConnectorAction@version`
- `SeatActionGrant`
- `ScopePolicy`
- `DataClassification`
- `MaskingPolicy`
- `ApprovalPolicy`
- `AuditRuntime`
- `Enterprise Data Gateway`

### Knowledge Supply Kernel

负责认知对象供给：

- `DataSource`
- `DataCapability`
- `EnterpriseKnowledgeProjectionSpec`
- `ProjectionStudio`
- `ProjectionMaterializer`
- `EnterpriseKnowledgeObjectFeedItem`
- `KnowledgeVisibilityPolicy`
- `KnowledgeSupplyAudit`
- `KnowledgeLineageRecord`

### Consumption Layer

负责员工端消费：

- `Knowledge Universe`
- `Knowledge Feed Adapter`
- `Agent Cognitive Runtime`
- `Employee Agent`

## 4.2 最终链路

```text
Connector
  ↓
ConnectorAction@version
  ↓
Enterprise Data Gateway

--------------------------------

DataSource
  ↓
DataCapability
  ↓
EnterpriseKnowledgeProjectionSpec
  ↓
ProjectionMaterializer
  ↓
EnterpriseKnowledgeObjectFeedItem

--------------------------------

Knowledge Universe
  ↓
Agent Cognitive Runtime
  ↓
Employee Agent
```

## 5. 必须冻结的硬原则

## 5.1 Seat 仍是执行授权唯一核心

- 不新增 `DigitalHuman` 权限主体
- 不新增 `KnowledgeObject` 权限主体
- 不引入新的顶级授权主体替代 `Seat`

执行权限仍然只能围绕：

- `Seat`
- `ConnectorAction@version`

展开。

## 5.2 双授权模型正式成立

本项目必须明确存在两个授权层：

### 执行授权层

`Seat -> ConnectorAction@version`

由以下对象控制：

- `SeatActionGrant`
- `ScopePolicy`
- `MaskingPolicy`
- `ApprovalPolicy`

### 消费可见性层

`Seat / Team / AgentType -> Knowledge Object`

由以下对象控制：

- `KnowledgeVisibilityPolicy`

这两个授权层不是二选一，而是必须并存。

### 5.2.1 示例

销售经理可以拥有：

- `crm.customer.read_summary@v1`

但不一定有权查看：

- 客户流失风险洞察

此时：

- Execution Policy 通过
- Knowledge Visibility Policy 拒绝

这是正常行为。

## 5.3 Knowledge Universe 不得直接访问 Data Gateway

知识宇宙不得直接消费：

- `Connector`
- `ConnectorAction`
- `DataSource`
- `Enterprise Data Gateway`

知识宇宙只能消费：

- `EnterpriseKnowledgeObjectFeedItem`

## 5.4 Agent Runtime 不得直接申请 Connector Action

Agent Runtime 未来不应直接请求：

- `ConnectorAction@version`

它应只消费：

- `Knowledge Object`

真正能调用 `Enterprise Data Gateway` 的只有：

- `ProjectionMaterializer`

## 5.5 ProjectionStudio 必须是声明式编排器

禁止把 `ProjectionStudio` 做成：

- SQL Builder
- 脚本平台
- 任意逻辑执行器

它只能是：

- 选择 DataCapability
- 选择标准模板
- 定义输出对象类别
- 定义刷新策略
- 定义可见性策略

## 6. 对现有既定开发方案的修正原则

当前团队既定方案中，底层执行治理部分已经相对明确：

- `ConnectorAction@version`
- `ScopePolicy`
- `DataClassification`
- `MaskingPolicy`
- `ApprovalPolicy`
- `AuditRuntime`
- `Enterprise Data Gateway`

这些不得推翻。

本次修正不是推翻原方案，而是在其上增加一个更准确的上层抽象。

## 6.1 原方案中必须保留的内容

- `ConnectorAction@version` 是真实执行落点
- 审计、审批、脱敏、Scope 都必须继续围绕 Action 生效
- 网关仍然是唯一企业数据执行入口

## 6.2 原方案中必须升级的内容

- 从“Action Governance Center”升级为“Governance & Supply Center”
- 新增上层对象：`DataSource`、`DataCapability`、`Projection`、`Feed`、`Lineage`
- 新增知识供给主线

## 7. 对核心领域模型的最终修正建议

## 7.1 DataSource

`DataSource` 是企业可治理的数据资产入口，不是 `Connector` 的别名。

建议冻结定义：

```ts
type DataSource = {
  sourceId: string;
  sourceKey: string;
  displayName: string;
  category: "crm" | "erp" | "finance" | "oa" | "mes" | "external";
  status: "connected" | "disconnected" | "error";
  connectorId: string;
  createdAt: string;
};
```

解释：

- `Connector` 是技术执行对象
- `DataSource` 是企业治理对象
- 两者关系应是：

`DataSource -> connectorId -> Connector`

## 7.2 DataCapability

`DataCapability` 是业务能力抽象，不是执行权限对象。

当前方案里它只挂 `sourceIds` 和 `actionRefs` 的方向是对的，但必须加强：

- `sourceIds` 只是来源展示
- `actionRefs` 才是真实执行来源
- 必须保留精确版本引用

建议冻结定义：

```ts
type DataCapability = {
  capabilityId: string;
  capabilityKey: string;
  displayName: string;
  description: string;
  sourceIds: string[];
  actionRefs: Array<{
    connectorId: string;
    actionKey: string;
    version: string;
  }>;
  enabled: boolean;
};
```

## 7.3 DataAccessPolicy

当前方案中的 `DataAccessPolicy` 不能直接作为最终执行权限模型。

它应被视为：

- 管理面抽象

而不是：

- 运行时直接权限对象

也就是说，管理员看到和编辑的是：

- `DataAccessPolicy`

但系统最终必须把它编译成：

- `SeatActionGrant`
- `ScopePolicy`
- `ApprovalPolicy`

否则会和既定执行治理模型冲突。

## 7.4 EnterpriseKnowledgeProjectionSpec

命名必须冻结为：

- `EnterpriseKnowledgeProjectionSpec`

不得使用：

- `KnowledgeProjection`

原因：

- 仓库内已有 `LearningProjection` 语义
- 避免与协作学习域冲突

它表示的是：

- 企业知识投影规范

不是：

- 投影结果对象

## 7.5 KnowledgeProjectionBinding

当前定义太薄，不能只是一个简单关联表。

建议强化为绑定对象，至少补充：

- `materializationMode`
- `freshnessSlaMinutes`
- `enabled`
- `generatorVersion`
- `visibilityPolicyId`

否则它无法支撑真正供给链。

## 7.6 EnterpriseKnowledgeObjectFeedItem

这是知识宇宙和 Agent Runtime 的标准输入对象，必须冻结为消费层唯一入口。

建议维持并强化：

```ts
type EnterpriseKnowledgeObjectFeedItem = {
  objectId: string;
  tenantId: string;
  projectionId: string;
  title: string;
  kind: "data" | "metric" | "insight";
  category: string;
  sourceSystems: string[];
  scopeApplied: string;
  maskedFields: string[];
  generatedAt: string;
  freshnessStatus: "fresh" | "stale" | "expired";
  traceRefs: string[];
  payload: Record<string, unknown>;
};
```

## 7.7 KnowledgeVisibilityPolicy

这是第二层授权的核心对象，必须纳入正式实施范围。

## 7.8 KnowledgeLineageRecord

这是必须新增的正式对象，不得省略。

建议冻结定义：

```ts
type KnowledgeLineageRecord = {
  objectId: string;
  projectionId: string;
  sourceActions: string[];
  sourceTraceIds: string[];
  generatedAt: string;
  generatorVersion: string;
};
```

它是后续以下三类系统的共同底座：

- 知识宇宙解释性
- Agent Runtime 可追溯性
- 企业治理审计

## 8. 一级模块设计的最终优化建议

当前团队提出的模块结构方向基本正确，但需要明确每个模块的本质职责，避免开发团队把它们做成单一 CRUD 页。

建议冻结企业端结构为：

`Enterprise Data Governance & Supply Center`

- `Overview`
- `Data Sources`
- `Access Governance`
- `Data Capabilities`
- `Projection Studio`
- `Knowledge Supply`
- `Audit & Lineage`
- `Approval Center`
- `System Settings`

## 8.1 Overview

不是简单看板，而是回答四个问题：

- 企业接入了哪些数据资产
- 这些数据开放给谁
- 形成了哪些数据能力
- 当前供给与治理是否健康

## 8.2 Data Sources

不是接入配置页，而是企业数据资产总览页。

除接入配置外，还必须能反查：

- 该 DataSource 产生了哪些 DataCapability
- 该 DataSource 支撑了哪些 Projection
- 该 DataSource 当前供给健康状态

## 8.3 Access Governance

这一页最容易走偏。

要求：

- UI 可按 Source / Department / Role / Seat 展示
- 但运行时不得只把授权落到 `DataSource`
- 系统必须能够反编译看到底映射到了哪些 `ConnectorAction@version`

## 8.4 Data Capabilities

这里不是静态目录，而应成为：

- 能力定义中心
- 来源追踪中心
- 使用统计中心
- 供给关系中心

至少应展示：

- 来源数据源
- 来源动作
- 关联 Projection
- 当前供给状态
- 当前开放范围

## 8.5 Projection Studio

这是声明式供给工作台。

允许：

- 选择 `DataCapability`
- 选择标准模板
- 选择输出类别：`data / metric / insight`
- 选择刷新策略
- 选择 Visibility Policy

禁止：

- 任意脚本
- 任意 SQL
- 自定义执行逻辑
- 用户自由表达式

### 8.5.1 模板建议冻结为五类

- `NormalizeTemplate`
- `AggregateTemplate`
- `TrendTemplate`
- `RiskDetectionTemplate`
- `ForecastTemplate`

## 8.6 Knowledge Supply

这是最关键的新模块。

它不是知识宇宙页面，而是供给运营页。

必须展示：

- FeedItem 列表
- 来源 ProjectionSpec
- 来源 DataCapability
- 来源 DataSource
- 可见范围
- 生成时间
- 新鲜度状态
- 失败状态
- 关联 `traceRefs`

## 8.7 Audit & Lineage

这里不能只做成“审计列表页”，而必须围绕 `KnowledgeLineageRecord` 建模。

系统必须能够回答：

`Insight`
`-> Metric`
`-> Projection`
`-> ConnectorAction@version`
`-> Source Data`

这就是后续的：

- 企业 AI 审计中心
- 认知解释性中心

## 8.8 Approval Center

建议至少分为三类审批：

- `Data Source Onboarding Approval`
- `Data Access Approval`
- `Capability Exposure Approval`

不要混成一个简单待办列表。

## 9. 与知识宇宙的关系必须写死

这一点是后续所有开发边界的核心：

### 企业端负责管理

- 数据源
- 权限
- 能力
- 投影
- 知识供给
- 血缘

### 知识宇宙负责消费

- 组织知识对象
- 提供检索与推荐
- 提供消费入口

关系固定为：

`Data Sources`
`-> Data Capability`
`-> Projection Studio`
`-> Enterprise Knowledge Feed`
`-> Knowledge Universe`
`-> Employee / Agent`

## 10. 与 Agent Runtime 的边界必须写死

Agent 永远不直接访问：

- `Connector`
- `ConnectorAction`
- `DataSource`

Agent 只能访问：

- `Knowledge Object`

因此必须冻结：

- 企业端负责：治理 + 供给
- 知识宇宙负责：组织 + 发现 + 消费
- Agent Runtime 负责：检索 + 推理 + 回答

## 11. 对当前开发里程碑的修正建议

原里程碑总体方向可用，但建议按“底层执行先于上层供给”的顺序重写。

### M1 执行治理基线

- `ConnectorAction@version`
- `ScopePolicy`
- `DataClassification`
- `MaskingPolicy`
- `ApprovalPolicy`
- `Enterprise Data Gateway`

### M2 数据治理入口

- `DataSource`
- `DataAccessPolicy`
- `Access Governance`

### M3 数据能力建设

- `DataCapability`
- `Capability Source Mapper`
- `Capability Action Mapper`

### M4 投影与供给

- `EnterpriseKnowledgeProjectionSpec`
- `Projection Studio`
- `ProjectionMaterializer`
- `EnterpriseKnowledgeObjectFeedItem`
- `KnowledgeVisibilityPolicy`

### M5 治理闭环

- `KnowledgeSupplyAudit`
- `KnowledgeLineageRecord`
- `Approval Center`
- `Audit & Lineage`

### M6 知识宇宙与 Agent 联调

- `Knowledge Feed Adapter`
- `Knowledge Universe`
- `Agent Cognitive Runtime`
- `Employee Agent`

## 12. 最容易走错的 5 个方向

请将以下 5 条作为实施红线加入团队执行说明：

1. 不要把 `DataSource` 做成 `Connector` 的别名
2. 不要让 `DataCapability` 取代 `ConnectorAction@version`
3. 不要把 `Projection Studio` 做成脚本平台或 SQL Builder
4. 不要让 `Knowledge Universe` 直接接 `Enterprise Data Gateway`
5. 不要让 `Agent Runtime` 直接申请底层 Action

## 13. 对第三方团队的具体升级要求

第三方团队后续开发时必须同时维护两条主线：

### 主线 A：Execution Governance

- `Connector`
- `ConnectorAction@version`
- `SeatActionGrant`
- `ScopePolicy`
- `MaskingPolicy`
- `ApprovalPolicy`
- `AuditRuntime`
- `Enterprise Data Gateway`

### 主线 B：Knowledge Supply

- `DataSource`
- `DataCapability`
- `EnterpriseKnowledgeProjectionSpec`
- `ProjectionStudio`
- `ProjectionMaterializer`
- `EnterpriseKnowledgeObjectFeedItem`
- `KnowledgeVisibilityPolicy`
- `KnowledgeLineageRecord`

## 14. 最终执行口径

请第三方团队按以下一句话理解本模块：

**企业数据治理与供给中心不是“连接器管理工具”，而是 OpenBot 企业认知体系中的数据治理与知识供给平台。**

它必须同时提供：

- 可信执行治理
- 结构化知识供给
- 可追溯认知链路

三者缺一不可。
