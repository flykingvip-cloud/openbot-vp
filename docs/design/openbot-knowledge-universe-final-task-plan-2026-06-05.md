# OpenBot 员工端 Knowledge Universe（知识宇宙）最终实施 Task 方案

Date: 2026-06-05

## 1. 文档目标

本方案用于指导 OpenBot 员工端 `Knowledge Universe` 模块的最终实施。

适用范围：

- 仅针对员工端当前导航中的 `knowledge` 模块
- 不调整现有导航栏模块设置
- 同时覆盖：
  - 员工侧 `Knowledge UI`
  - 机器人侧 `Knowledge Runtime`

本方案以 v5 为最终定稿，替代此前的知识宇宙任务草案。

## 2. 最终定位

知识宇宙不是：

- 搜索系统
- 知识库系统
- 企业知识管理后台
- 工作驾驶舱
- 任务中心
- 协作中心

知识宇宙最终定义为：

> OpenBot 员工端与 Agent Runtime 共享的统一认知层（Unified Cognitive Layer）

其首页默认呈现方式是：

> 智能关系网络（Intelligent Relationship Network）

因此：

```text
Knowledge Universe
=
智能关系网络
+ 知识来源管理
+ 数据能力入口
+ Agent Runtime 认知入口
```

进一步拆解为运行结构：

```text
Knowledge Universe
=
Knowledge Sources
+ Knowledge Router
+ Intelligent Relationship Runtime
+ Agent Cognitive Runtime
```

## 3. 当前代码现状

当前员工端已经有知识宇宙入口，但仍处于占位态：

- `knowledge` 已经是员工端主模块之一：`ui/src/ui/ports/employee/views/workbench-types.ts:40`
- 左侧导航已渲染知识宇宙入口：`ui/src/ui/ports/employee/views/workbench-nav-model.ts:214`
- knowledge 模块当前仍是占位页：`ui/src/ui/ports/employee/views/workbench-stage-module.ts:2120`
- knowledge surface 仍为 future placeholder：`ui/src/ui/ports/employee/views/home-page-contracts.ts:17`
- workbench 主模块状态已存在：`ui/src/ui/app.ts:407`
- knowledge 分支已可在 render-model 中装配：`ui/src/ui/ports/employee/render-model.ts:2633`

可直接复用能力：

- 我的资产：`ui/src/ui/views/my-accumulation.ts:1162`
- 本地/工作区文件：`ui/src/ui/capability/agent-files/facade.ts:1`
- 会话数据：`ui/src/ui/capability/sessions/facade.ts:1`
- 协作空间：`ui/src/ui/capability/spaces/facade.ts:1`
- 员工能力推荐/安装：`ui/src/ui/capability/employee-capability/gateway-client.ts:11`
- 机器人能力视图：`ui/src/ui/views/robot-capability-tab.ts:243`

## 4. 员工视角与页面原则

员工进入知识宇宙后，不应首先看到：

- 目录树
- 文件夹
- 文档列表
- 三个 Tab 对应的列表页

员工应首先看到：

- 以“我”为中心的工作认知网络
- 我的知识、企业知识、数据能力之间的关系
- 与当前工作相关的项目、机器人、负责人

### 强制页面原则

- 不允许出现：
  - `Knowledge Universe -> 目录树 -> 文件夹 -> 文档`
- 不允许把“知识图谱”做成独立菜单
- 首页必须是智能关系网络
- 三类知识源是供给层，不是首页主结构
- 详情区必须围绕“这个东西和什么有关”组织

## 5. 首页信息结构

首页推荐结构如下：

```text
┌────────────────────────────────────────────────────────────┐
│                    Knowledge Universe                      │
└────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────┐
│ 🔍 搜索知识、企业知识、数据能力、项目、机器人、负责人      │
└────────────────────────────────────────────────────────────┘

┌───────────────┬───────────────┬────────────────────────────┐
│ 我的知识       │ 企业知识       │ 数据能力                   │
│ 128 文档      │ 42 知识库      │ 12 已授权能力             │
│ 最近更新 8    │ 可访问 17      │ 5 待申请能力              │
│               │               │ 3 外部数据源              │
└───────────────┴───────────────┴────────────────────────────┘

══════════════════════════════════════════════════════════════
                智 能 关 系 网 络
══════════════════════════════════════════════════════════════

                    [我]
          ╱          │          ╲
     [我的知识]   [企业知识]   [数据能力]
         │            │            │
      [项目A]      [销售制度]   [销售分析能力]
         │            │            │
    [项目文档]    [合同模板]   [客户画像]
         ╲            │           ╱
             [销售机器人]
                     │
                 [负责人]

══════════════════════════════════════════════════════════════

右侧/下方：知识对象详情预览区
```

## 6. 三类知识来源

知识宇宙页面结构的核心是关系网络，但底层供给必须来自三类来源：

```text
Knowledge Sources
├── 我的知识
├── 企业知识
└── 数据能力
```

### 6.1 我的知识

定位：

- 员工个人知识空间

来源：

- 本地上传
- AI 助理会话收录
- 机器人产出收录
- 已沉淀个人资产

支持内容：

- PDF
- Word
- Excel
- PPT
- Markdown
- 图片
- 分析报告
- 研究摘要
- 项目方案
- 市场调研

功能：

- 上传文档
- 一键收录
- 标签管理
- 收藏
- 最近收录
- 最近引用
- 版本管理
- 版本历史
- 差异比较
- 知识关系自动发现

### 6.2 企业知识

定位：

- 企业知识访问层
- 不是企业知识管理系统

员工能力边界：

- 查看
- 搜索
- 引用
- 关联发现
- 权限申请

来源：

- 销售知识库
- 运营知识库
- 研发知识库
- HR 知识库
- 其他企业端投影出的知识空间

强制要求：

- 打开任意企业知识对象时，必须展示其关联：
  - 项目
  - 模板
  - 制度
  - 机器人
  - 数据能力
  - 负责人

### 6.3 数据能力

定位：

- Data Capability Space
- 不是对象展示层
- 不是连接器展示层

员工关心的问题：

- 我有哪些能力已开放
- 哪些能力待申请
- 这些能力能帮我解决什么问题
- 我还能扩展哪些外部数据源

页面结构：

- 已授权能力
- 待申请能力
- 我的扩展数据源

每个能力详情必须展示：

- 能力说明
- 数据来源
- 可获得内容
- 使用机器人
- 权限范围
- 场景列表

场景是一级信息，例如：

- 销售分析能力
  - 客户分析
  - 销售预测
  - 流失预警
- 市场情报能力
  - 竞品跟踪
  - 行业监测
  - 风险预警

## 7. 架构设计

### 7.1 总体运行结构

```text
Knowledge Universe
  ↓
knowledge.*
  ↓
Knowledge Resolve Engine
  ↓
Knowledge Router
  ↓
Knowledge Sources
  ├── Personal Source
  ├── Enterprise Source
  └── Data Capability Source
  ↓
Intelligent Relationship Runtime
  ↓
Relationship Graph
  ↓
Employee UI / Agent Runtime
```

### 7.2 各层职责

#### Knowledge Sources

负责供给：

- 我的知识
- 企业知识
- 数据能力

#### Knowledge Router

负责：

- Search
- Resolve
- Route
- Merge

不负责关系发现。

#### Intelligent Relationship Runtime

这是必须新增的独立运行层，不能写死在 View 层。

负责：

- 关系发现
- 关系计算
- 关系更新
- 冲突检测
- 推荐生成

#### Agent Cognitive Runtime

负责：

- 消费知识对象
- 消费关系网络推荐
- 构建任务知识上下文
- 禁止直连 Connector / CRM / ERP

## 8. 领域模型

### 8.1 KnowledgeSource

```ts
type KnowledgeSource = "personal" | "enterprise" | "data";
```

### 8.2 KnowledgeObject

```ts
type KnowledgeObjectKind =
  | "document"
  | "policy"
  | "template"
  | "project"
  | "contract"
  | "metric"
  | "insight";

type KnowledgeObject = {
  id: string;
  title: string;
  source: KnowledgeSource;
  kind: KnowledgeObjectKind;
  summary: string;
  tags: string[];
  updatedAt: number;
  relatedObjectIds?: string[];
  sourceSystem?: string;
  scopeLabel?: string;
  maskingSummary?: string;
  relationshipSummary?: {
    relatedCount: number;
    conflictCount: number;
    supportingCount: number;
  };
};
```

### 8.3 RelationshipEdge

```ts
type RelationshipEdge = {
  sourceId: string;
  targetId: string;
  relationType:
    | "related"
    | "supports"
    | "conflicts"
    | "derived-from"
    | "owned-by"
    | "used-by"
    | "recommended-for";
  score: number;
};
```

### 8.4 RelationshipGraph

```ts
type RelationshipNodeKind = "knowledge-object" | "data-capability" | "agent" | "owner" | "project";

type RelationshipNode = {
  id: string;
  kind: RelationshipNodeKind;
  title: string;
  summary?: string;
  objectId?: string;
};

type RelationshipGraph = {
  nodes: RelationshipNode[];
  edges: RelationshipEdge[];
};
```

### 8.5 DataCapabilityDescriptor

```ts
type DataCapabilityDescriptor = {
  id: string;
  title: string;
  summary: string;
  sourceSystems: string[];
  scenarios: string[];
  visibleAgents: string[];
  scopeLabel?: string;
  accessState: "granted" | "requestable" | "external";
};
```

### 8.6 Agent Runtime 模型

```ts
type KnowledgeAgentProfile = {
  agentId: string;
  enabledSources: KnowledgeSource[];
  preferredKnowledgeKinds: KnowledgeObjectKind[];
  retrievalMode: "balanced" | "precision" | "breadth";
  allowDataCapabilities: string[];
  confidenceThreshold: number;
};

type KnowledgeTaskContext = {
  taskType: string;
  sessionKey?: string | null;
  seatId?: string | null;
  agentId?: string | null;
  requestedSourceHints?: KnowledgeSource[];
  requestedKinds?: KnowledgeObjectKind[];
  requestedCapabilities?: string[];
};
```

### 8.7 KnowledgeFeedItem

`Enterprise Source` 与 `Data Capability Source` 不能直接把各自原始结构推给知识宇宙，必须先标准化为统一 Feed 项。

```ts
type KnowledgeFeedItem = {
  objectId: string;
  projectionId: string;
  sourceType: "personal" | "enterprise" | "data";
  objectKind: string;
  title: string;
  summary: string;
  tags: string[];
  payload: Record<string, unknown>;
  generatedAt: string;
  visibilityPolicyId?: string;
  lineageId?: string;
};
```

该结构是：

- `Enterprise Knowledge Feed`
- `Data Capability Source`
- 后续 `Knowledge Router`

之间的标准交换对象。

## 9. RPC 设计

### 9.1 UI RPC

| RPC                         | 用途                                   |
| --------------------------- | -------------------------------------- |
| `knowledge.search`          | 全局搜索                               |
| `knowledge.object`          | 获取知识对象详情                       |
| `knowledge.recommendations` | 获取推荐对象                           |
| `knowledge.relationships`   | 查询关系图                             |
| `knowledge.related`         | 获取关联知识、数据能力、机器人、负责人 |

### 9.2 Runtime RPC

| RPC                       | 用途                   |
| ------------------------- | ---------------------- |
| `knowledge.resolve`       | 机器人任务中的知识解析 |
| `knowledge.context`       | 构建任务知识上下文     |
| `knowledge.agent-profile` | 获取机器人认知配置     |

### 9.3 Supporting Mutation RPC

| RPC                           | 用途                      |
| ----------------------------- | ------------------------- |
| `knowledge.personal.upload`   | 上传个人知识文件          |
| `knowledge.personal.collect`  | 从聊天/机器人产出一键收录 |
| `knowledge.personal.update`   | 修改标签、收藏、元信息    |
| `knowledge.personal.versions` | 获取版本历史              |
| `knowledge.personal.compare`  | 获取版本差异              |
| `knowledge.access.request`    | 企业知识/数据能力权限申请 |

## 10. 代码落点

### 10.1 UI Capability

新增目录：

```text
ui/src/ui/capability/knowledge-universe/
```

新增文件：

- `types.ts`
- `endpoints.ts`
- `gateway-client.ts`
- `facade.ts`
- `mock-backend.ts`
- `index.ts`

### 10.2 Controllers

新增文件：

- `ui/src/ui/controllers/knowledge-universe-search.ts`
- `ui/src/ui/controllers/knowledge-universe-detail.ts`
- `ui/src/ui/controllers/knowledge-universe-relationships.ts`
- `ui/src/ui/controllers/knowledge-universe-recommendations.ts`
- `ui/src/ui/controllers/knowledge-universe-context.ts`
- `ui/src/ui/controllers/knowledge-universe-personal.ts`
- `ui/src/ui/controllers/knowledge-universe-data-capabilities.ts`

### 10.3 Views

新增文件：

- `ui/src/ui/views/knowledge-universe-page.ts`
- `ui/src/ui/views/knowledge-universe-graph-canvas.ts`
- `ui/src/ui/views/knowledge-universe-source-cards.ts`
- `ui/src/ui/views/knowledge-universe-detail-preview.ts`
- `ui/src/ui/views/knowledge-universe-data-capability-card.ts`

新增前端图谱适配层：

- `ui/src/ui/capability/knowledge-universe/graph-view-model.ts`

### 10.4 Workbench 接入

修改：

- `ui/src/ui/ports/employee/views/home-page-contracts.ts`
- `ui/src/ui/ports/employee/views/workbench-stage-contracts.ts`
- `ui/src/ui/ports/employee/views/workbench-stage-module.ts`
- `ui/src/ui/ports/employee/render-model.ts`

### 10.5 状态层

修改：

- `ui/src/ui/capability/app-view-state-slices.ts`
- `ui/src/ui/app-view-state.ts`
- `ui/src/ui/app.ts`

建议新增状态：

- `knowledgeUniverseQuery`
- `knowledgeUniverseGraph`
- `knowledgeUniverseSelectedNodeId`
- `knowledgeUniverseSelectedObject`
- `knowledgeUniverseSearchResults`
- `knowledgeUniverseRecommendations`
- `knowledgeUniverseRecent`
- `knowledgeUniverseSourceView`
- `knowledgeUniverseError`

### 10.6 Gateway

新增目录：

```text
src/gateway/knowledge/
```

新增文件：

- `src/gateway/knowledge/types.ts`
- `src/gateway/knowledge/router.ts`
- `src/gateway/knowledge/feed/types.ts`
- `src/gateway/knowledge/sources/personal-source.ts`
- `src/gateway/knowledge/sources/enterprise-source.ts`
- `src/gateway/knowledge/sources/data-capability-source.ts`

新增关系运行时目录：

```text
src/gateway/knowledge/relationships/
```

新增文件：

- `src/gateway/knowledge/relationships/relationship-runtime.ts`
- `src/gateway/knowledge/relationships/relationship-builder.ts`
- `src/gateway/knowledge/relationships/relationship-scoring.ts`
- `src/gateway/knowledge/relationships/relationship-conflict-detector.ts`
- `src/gateway/knowledge/relationships/relationship-recommendation.ts`

新增 Resolve Engine 目录：

```text
src/gateway/knowledge/resolve/
```

新增文件：

- `src/gateway/knowledge/resolve/resolve-engine.ts`
- `src/gateway/knowledge/resolve/intent-classifier.ts`
- `src/gateway/knowledge/resolve/source-selector.ts`
- `src/gateway/knowledge/resolve/context-builder.ts`

新增 handler：

- `src/gateway/server-methods/knowledge.ts`

修改：

- `src/gateway/server-methods.ts`
- `src/gateway/server-methods-list.ts`
- `src/gateway/method-scopes.ts`
- `src/gateway/protocol/schema/knowledge.ts`
- `src/gateway/protocol/schema/protocol-schemas.ts`

## 11. Implementation Architecture

这一章用于把“概念任务”下沉为“研发可编码任务”。

### 11.1 Intelligent Relationship Runtime

新增目录：

```text
src/gateway/knowledge/relationships/
```

职责拆分：

- `relationship-runtime.ts`
  - 编排 Builder / Scoring / Conflict / Recommendation
- `relationship-builder.ts`
  - 从 `KnowledgeObject[]` 生成候选 `RelationshipEdge[]`
- `relationship-scoring.ts`
  - 计算边权重 `score`
- `relationship-conflict-detector.ts`
  - 检测冲突对象
- `relationship-recommendation.ts`
  - 基于图生成推荐对象

#### 11.1.1 Relationship Builder

输入：

- `KnowledgeObject[]`

输出：

- `RelationshipEdge[]`

最小规则集：

- 标签重叠 -> `related`
- 同项目 -> `related` / `supports`
- 明确引用 -> `derived-from`
- 相同负责人 -> `owned-by`
- 数据能力被某机器人消费 -> `used-by`
- 某对象适配当前用户/任务 -> `recommended-for`

研发任务：

- `KU-11-1` 实现 `Relationship Builder`

#### 11.1.2 Relationship Score Engine

输入因子建议：

- 标签重叠度
- 时间接近度
- 显式引用关系
- 共同项目
- 共同负责人
- 共同机器人使用记录

输出：

- `score: 0-100`

研发任务：

- `KU-11-2` 实现 `Relationship Score Engine`

#### 11.1.3 Conflict Detector

职责：

- 发现同主题但结论冲突的知识对象

最小判定信号建议：

- 同标签/同主题
- 不同结论字段或冲突摘要
- 同时间窗口内互斥判断

输出：

- `conflicts`

研发任务：

- `KU-11-3` 实现 `Conflict Detector`

#### 11.1.4 Recommendation Engine

输入：

- `RelationshipGraph`
- 当前用户/当前任务上下文

输出：

- 推荐知识对象
- 推荐数据能力
- 推荐机器人
- 推荐负责人

研发任务：

- `KU-11-4` 实现 `Recommendation Engine`

### 11.2 Knowledge Resolve Engine

新增目录：

```text
src/gateway/knowledge/resolve/
```

职责拆分：

- `resolve-engine.ts`
- `intent-classifier.ts`
- `source-selector.ts`
- `context-builder.ts`

#### 11.2.1 Intent Classifier

职责：

- 从任务问题中识别任务类型

示例：

- “客户成交率为什么下降” -> 企业知识 + 数据能力
- “帮我整理这个项目复盘” -> 我的知识 + 企业知识

研发任务：

- `KU-19-1` 实现 `Intent Classifier`

#### 11.2.2 Source Selector

职责：

- 选择知识来源：
  - `personal`
  - `enterprise`
  - `data`

输入：

- intent
- task context
- agent profile

研发任务：

- `KU-19-2` 实现 `Source Selector`

#### 11.2.3 Context Builder

职责：

- 将 resolve 结果拼装成 Agent 可消费的上下文对象

输出建议：

- 主知识对象
- 关联对象
- 推荐数据能力
- 推荐机器人
- 推荐负责人

研发任务：

- `KU-19-3` 实现 `Context Builder`

### 11.3 Knowledge Feed 标准化

这是 `Enterprise Source` 与 `Data Capability Source` 的统一入口。

建议文件：

- `src/gateway/knowledge/feed/types.ts`

核心输出：

- `KnowledgeFeedItem`

研发任务：

- `KU-15-1` 定义 `KnowledgeFeedItem`
- `KU-15-2` 实现 `Enterprise Feed Adapter`
- `KU-15-3` 实现 `Data Capability Feed Adapter`
- `KU-15-4` 实现 `Visibility Policy Mapping`

### 11.4 Relationship Graph View Model

后端返回：

- `RelationshipGraph`

前端展示：

- `CanvasNode`
- `CanvasEdge`

二者不能直接共用，需要独立适配层。

建议文件：

- `ui/src/ui/capability/knowledge-universe/graph-view-model.ts`

建议模型：

```ts
type GraphViewNode = {
  id: string;
  x: number;
  y: number;
  radius: number;
  label: string;
  category: "knowledge" | "data" | "agent" | "project" | "owner";
};
```

研发任务：

- `KU-10A-1` 实现 `Graph Layout Engine`
- `KU-10A-2` 实现 `Graph View Model Adapter`

### 11.5 首页 UI 研发拆解

当前 `KU-05 知识宇宙首页` 需要继续拆分：

- `KU-05-1` 搜索区
- `KU-05-2` 来源卡片区
- `KU-05-3` 关系网络画布
- `KU-05-4` 详情预览区
- `KU-05-5` 节点选中状态管理
- `KU-05-6` 关系边高亮
- `KU-05-7` 关系网络缩放
- `KU-05-8` 关系网络布局算法接线

### 11.6 数据能力模块服务拆解

当前 `KU-09 数据能力空间` 需要继续拆分：

- `KU-09-1` `Capability Catalog Service`
- `KU-09-2` `Capability Access State Resolver`
- `KU-09-3` `Capability Scenario Mapper`

其中 `Capability Scenario Mapper` 负责把：

- 销售分析能力 -> 客户分析 / 销售预测 / 流失预警

这样的“能力 -> 场景”关系落成可展示结构。

### 11.7 Agent Runtime Adapter 拆解

当前 `KU-22 Agent Runtime Adapter` 需要继续拆分：

- `KU-22-1` `Knowledge Resolver Adapter`
- `KU-22-2` `Relationship Recommendation Adapter`
- `KU-22-3` `Knowledge Context Adapter`
- `KU-22-4` `Agent Memory Adapter`

目标：

- Agent 不只是“会搜索”
- Agent 能同时消费：
  - 知识对象
  - 关系网络推荐
  - 构建后的上下文

## 12. 里程碑与任务拆解

### M1 基础页面与关系网络首页

| ID       | Task                               | 目标                                   |
| -------- | ---------------------------------- | -------------------------------------- |
| KU-01    | `knowledge-universe capability`    | capability 模块、typed RPC client      |
| KU-02    | `knowledge surface contract`       | 升级 knowledge surface contract        |
| KU-03    | `knowledge state slice`            | 增加知识宇宙状态切片                   |
| KU-04    | `render-model 接入`                | knowledge 模块装配                     |
| KU-05    | `知识宇宙首页`                     | 搜索、来源概览、关系网络、详情预览     |
| KU-05-1  | `搜索区`                           | 首页全局搜索输入与事件处理             |
| KU-05-2  | `来源卡片区`                       | 我的知识 / 企业知识 / 数据能力摘要卡片 |
| KU-05-3  | `关系网络画布`                     | 首页主画布容器                         |
| KU-05-4  | `详情预览区`                       | 节点点击后的详情侧栏/底栏              |
| KU-05-5  | `节点选中状态管理`                 | 当前聚焦节点与详情联动                 |
| KU-05-6  | `关系边高亮`                       | hover / select 后边与邻居节点高亮      |
| KU-05-7  | `关系网络缩放`                     | 缩放、平移、复位                       |
| KU-05-8  | `关系网络布局算法接线`             | 布局与 canvas 渲染接线                 |
| KU-06    | `替换占位页`                       | 替换当前 knowledge placeholder         |
| KU-10A   | `Intelligent Relationship Network` | 关系网络主画布骨架与默认节点集         |
| KU-10A-1 | `Graph Layout Engine`              | 节点布局算法                           |
| KU-10A-2 | `Graph View Model Adapter`         | `RelationshipGraph -> GraphViewModel`  |

M1 验收标准：

- 知识宇宙模块可访问
- 首页核心是智能关系网络
- 支持搜索知识、企业知识、数据能力、项目、机器人、负责人
- 点击节点后可显示详情预览
- 不允许首页退化为 `Tab + 列表`

### M2 知识源接入

| ID      | Task                               | 目标                                         |
| ------- | ---------------------------------- | -------------------------------------------- |
| KU-07   | `我的知识`                         | 上传、收录、标签、版本、关系摘要             |
| KU-08   | `企业知识`                         | 企业知识投影、权限过滤、关系入口             |
| KU-09   | `数据能力空间`                     | 已授权能力、待申请能力、扩展数据源、能力场景 |
| KU-09-1 | `Capability Catalog Service`       | 数据能力目录服务                             |
| KU-09-2 | `Capability Access State Resolver` | 访问状态解析                                 |
| KU-09-3 | `Capability Scenario Mapper`       | 能力与场景映射                               |

M2 验收标准：

- 三类知识源全部接入
- 来源卡片展示真实摘要数据
- 企业知识支持关系入口
- 数据能力支持“能力场景”展示

### M3 关系运行时与认知层

| ID      | Task                               | 目标                                     |
| ------- | ---------------------------------- | ---------------------------------------- |
| KU-10   | `知识对象模型升级`                 | 增加关系摘要与关系图模型                 |
| KU-11   | `Intelligent Relationship Runtime` | 关系发现、计算、更新、冲突检测、推荐生成 |
| KU-11-1 | `Relationship Builder`             | 从知识对象生成候选关系边                 |
| KU-11-2 | `Relationship Score Engine`        | 关系边打分                               |
| KU-11-3 | `Conflict Detector`                | 冲突关系发现                             |
| KU-11-4 | `Recommendation Engine`            | 基于关系图输出推荐                       |
| KU-12   | `知识对象详情页`                   | 完整详情页/详情预览区                    |
| KU-13   | `最近访问`                         | 最近访问记录                             |
| KU-14   | `推荐系统`                         | 推荐知识、数据能力、机器人、负责人       |
| KU-14A  | `knowledge.related`                | 获取关联知识、数据能力、机器人、负责人   |

M3 验收标准：

- 任意知识对象至少能发现：
  - 相关知识
  - 相关数据能力
  - 相关机器人
  - 相关负责人
- 企业知识不再只是目录投影
- 推荐系统由关系运行时驱动，不是静态推荐

### M4 企业接入与治理

| ID      | Task                           | 目标                                   |
| ------- | ------------------------------ | -------------------------------------- |
| KU-15   | `Enterprise Knowledge Feed`    | 企业知识投影流接入                     |
| KU-15-1 | `KnowledgeFeedItem`            | 定义统一 feed 结构                     |
| KU-15-2 | `Enterprise Feed Adapter`      | 企业知识标准化 feed 适配               |
| KU-15-3 | `Data Capability Feed Adapter` | 数据能力标准化 feed 适配               |
| KU-15-4 | `Visibility Policy Mapping`    | 可见性策略映射                         |
| KU-16   | `Enterprise Data Gateway`      | 数据能力真实接入                       |
| KU-17   | `Visibility Policy`            | Seat / Department / Role / Policy 对接 |
| KU-18   | `权限 / 脱敏 / 审计`           | 企业知识与数据能力合规注入             |

M4 验收标准：

- 企业知识可见性正确
- 数据能力真实可用
- 所有受控对象均显示来源、范围、脱敏摘要

### M5 Agent Runtime 集成

| ID      | Task                                  | 目标                                     |
| ------- | ------------------------------------- | ---------------------------------------- |
| KU-19   | `knowledge.resolve`                   | 机器人任务知识解析                       |
| KU-19-1 | `Intent Classifier`                   | 任务意图识别                             |
| KU-19-2 | `Source Selector`                     | 知识来源选择                             |
| KU-19-3 | `Context Builder`                     | Agent 上下文组装                         |
| KU-20   | `knowledge.context`                   | 任务知识上下文构建                       |
| KU-21   | `knowledge.agent-profile`             | 机器人认知配置                           |
| KU-22   | `Agent Runtime Adapter`               | 建立 Agent Cognitive Runtime Adapter     |
| KU-22-1 | `Knowledge Resolver Adapter`          | resolve 接线                             |
| KU-22-2 | `Relationship Recommendation Adapter` | 推荐结果接线                             |
| KU-22-3 | `Knowledge Context Adapter`           | context 接线                             |
| KU-22-4 | `Agent Memory Adapter`                | 与 Agent memory 侧适配                   |
| KU-23   | `Cognitive Runtime Integration`       | 让 Employee Agent 消费知识宇宙与关系网络 |

M5 验收标准：

- 机器人执行任务时自动检索知识宇宙
- 自动构建知识上下文
- 自动消费企业知识与数据能力
- 自动获取关联知识、关联负责人、关联机器人
- 不允许机器人直连 Connector / CRM / ERP

## 13. 测试要求

### UI 侧

- `ui/src/ui/capability/knowledge-universe/*.test.ts`
- `ui/src/ui/controllers/knowledge-universe-*.test.ts`
- `ui/src/ui/views/knowledge-universe-*.test.ts`
- `ui/src/ui/ports/employee/views/workbench-stage-module.knowledge.test.ts`

### Gateway 侧

- `src/gateway/server-methods/knowledge.test.ts`
- `src/gateway/protocol/schema/knowledge.test.ts`
- `src/gateway/knowledge/router.test.ts`
- `src/gateway/knowledge/relationship-runtime.test.ts`
- `src/gateway/knowledge/resolve-engine.test.ts`

### 核心覆盖项

- 搜索融合
- 关系边生成
- 推荐生成
- 冲突检测
- 企业知识权限过滤
- 数据能力场景映射
- `knowledge.related` 正确性
- `knowledge.resolve` 与 `knowledge.context` 的 Agent 链路一致性

## 14. 最终架构

```text
Enterprise Capability Center
        │
        ▼
Enterprise Knowledge Feed
        │
        ▼
Knowledge Universe
        │
        ├── 智能关系网络（默认主页）
        ├── 我的知识
        ├── 企业知识
        └── 数据能力
        │
        ▼
Intelligent Relationship Runtime
        │
        ▼
Knowledge Resolve Engine
        │
        ▼
Agent Cognitive Runtime
        │
        ▼
Employee Agent
```

## 15. 最终结论

知识宇宙首页不能做成：

- 高级搜索页
- 三个 Tab 的知识库页
- 企业知识入口页

它必须是：

> 围绕“我”与当前工作目标组织起来的智能关系网络首页

员工进入知识宇宙后首先看到的应该是：

- 我的知识
- 企业知识
- 数据能力
- 项目
- 机器人
- 负责人

之间的关系，而不是一堆文档或列表。

这才真正符合知识宇宙的最终定位：

```text
Unified Cognitive Layer
=
智能关系网络
+ 知识来源管理
+ 数据能力入口
+ Agent Runtime 认知入口
```
