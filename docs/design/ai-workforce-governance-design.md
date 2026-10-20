# AI Workforce Governance (机巢治理模块) 设计文档

Date: 2026-05-30

## 1. 概述

机巢治理模块是企业内部AI资产治理系统，用于统一管理机器人（Bot）和协作小组（Group），监控运行指标，自动检测异常，快速定位责任人，提供治理操作入口。

## 2. 系统特性

- **单企业系统**：无多租户设计，所有数据默认属于当前企业
- **高性能查询**：指标数据基于预聚合表，支持≥10万资产
- **自动异常检测**：定时扫描，自动识别异常情况
- **快速治理路径**：3步内找到责任人，2步内执行治理动作

## 3. 模块架构

```
ai-workforce-governance/
├── ai-assets/          # AI资产模块 - 管理机器人/协作组基础信息
├── ai-runs/            # 运行日志模块 - 记录每次任务执行
├── metrics-aggregator/ # 指标聚合模块 - 定时计算统计指标
├── anomaly-engine/     # 异常检测模块 - 自动识别异常
├── governance-api/     # 治理API模块 - 提供前端接口
└── governance-ui/        # 前端模块 - React组件
```

## 4. 数据模型

### 4.1 AI资产表 (ai_assets)

| 字段              | 类型       | 说明                    |
| ----------------- | ---------- | ----------------------- |
| id                | VARCHAR PK | 资产ID                  |
| type              | VARCHAR    | bot / group             |
| name              | VARCHAR    | 资产名称                |
| position_id       | VARCHAR    | 绑定岗位ID              |
| digital_worker_id | VARCHAR    | 绑定数字人ID            |
| owner_user_id     | VARCHAR    | 负责人用户ID            |
| runtime_id        | VARCHAR    | Runtime实例ID           |
| template_id       | VARCHAR    | 模板ID                  |
| status            | VARCHAR    | active / paused / error |
| created_at        | TIMESTAMP  | 创建时间                |
| updated_at        | TIMESTAMP  | 更新时间                |

### 4.2 运行日志表 (ai_runs)

| 字段          | 类型       | 说明                       |
| ------------- | ---------- | -------------------------- |
| id            | VARCHAR PK | 运行记录ID                 |
| asset_id      | VARCHAR    | 关联资产ID                 |
| task_id       | VARCHAR    | 任务ID                     |
| start_time    | TIMESTAMP  | 开始时间                   |
| end_time      | TIMESTAMP  | 结束时间                   |
| duration_ms   | INT        | 执行时长(毫秒)             |
| status        | VARCHAR    | success / failed / timeout |
| error_code    | VARCHAR    | 错误码                     |
| tokens_input  | INT        | 输入token数                |
| tokens_output | INT        | 输出token数                |
| cost          | DECIMAL    | 成本(美元)                 |
| created_at    | TIMESTAMP  | 创建时间                   |

### 4.3 指标日汇总表 (ai_metrics_daily)

| 字段              | 类型       | 说明           |
| ----------------- | ---------- | -------------- |
| id                | VARCHAR PK | 记录ID         |
| asset_id          | VARCHAR    | 资产ID         |
| date              | DATE       | 日期           |
| task_count        | INT        | 任务总数       |
| success_count     | INT        | 成功数         |
| fail_count        | INT        | 失败数         |
| avg_latency_ms    | INT        | 平均延迟(ms)   |
| total_duration_ms | BIGINT     | 总执行时长(ms) |
| total_tokens      | INT        | 总token数      |
| total_cost        | DECIMAL    | 总成本         |
| avg_cost_per_task | DECIMAL    | 平均单任务成本 |
| error_count       | INT        | 错误数         |
| success_rate      | DECIMAL    | 成功率(0-1)    |
| cost_growth_rate  | DECIMAL    | 成本增长率     |

### 4.4 异常记录表 (ai_anomalies)

| 字段        | 类型       | 说明                |
| ----------- | ---------- | ------------------- |
| id          | VARCHAR PK | 异常ID              |
| asset_id    | VARCHAR    | 关联资产ID          |
| type        | VARCHAR    | 异常类型            |
| severity    | VARCHAR    | low / medium / high |
| description | TEXT       | 描述                |
| detected_at | TIMESTAMP  | 检测时间            |
| status      | VARCHAR    | pending / resolved  |

## 5. 指标计算逻辑

定时任务（每5分钟执行）：

```typescript
// 核心指标计算
FOR each asset_id IN active_assets:
  runs = SELECT * FROM ai_runs
         WHERE asset_id = ? AND start_time >= today_start

  task_count = COUNT(runs)
  success_count = COUNT(runs WHERE status = 'success')
  fail_count = COUNT(runs WHERE status = 'failed')

  avg_latency = AVG(duration_ms)
  total_duration = SUM(duration_ms)

  total_cost = SUM(cost)
  total_tokens = SUM(tokens_input + tokens_output)

  success_rate = success_count / task_count
  avg_cost_per_task = total_cost / task_count

  // 增长率计算
  today_cost = total_cost
  yesterday_cost = SELECT total_cost FROM ai_metrics_daily
                   WHERE asset_id = ? AND date = yesterday
  cost_growth_rate = (today_cost - yesterday_cost) / yesterday_cost
```

## 6. 异常检测规则

### 6.1 无任务异常 (no_task)

```
IF task_count == 0 AND total_cost > 0:
  severity = "high"
  INSERT ai_anomalies(type="no_task", ...)
```

### 6.2 成本异常 (cost_spike)

```
IF cost_growth_rate > 0.3:
  severity = "medium"
  INSERT ai_anomalies(type="cost_spike", ...)
```

### 6.3 失败率异常 (high_failure)

```
IF fail_count / task_count > 0.3:
  severity = "high"
  INSERT ai_anomalies(type="high_failure", ...)
```

### 6.4 Runtime异常 (runtime_error)

```
IF error_count > threshold:
  severity = "high"
  INSERT ai_anomalies(type="runtime_error", ...)
```

## 7. API接口定义

### 7.1 获取AI资产列表

```
GET /api/governance/assets

Query参数:
- type: bot|group
- search: 关键词
- owner: 用户ID
- position: 岗位ID
- risk_level: low|medium|high
- sort: cost|task|success_rate

Response:
{
  items: [{
    id: string,
    name: string,
    type: "bot" | "group",
    position: string,
    owner: string,
    metrics: {
      task_count: number,
      success_rate: number,
      avg_latency: number,
      total_cost: number
    },
    risk_level: "low" | "medium" | "high"
  }],
  pagination: { page, pageSize, total }
}
```

### 7.2 获取治理队列（异常列表）

```
GET /api/governance/anomalies

Query参数:
- severity: low|medium|high
- status: pending|resolved
- asset_id: 资产ID

Response:
{
  items: [{
    id: string,
    asset_id: string,
    asset_name: string,
    type: string,
    severity: string,
    description: string,
    detected_at: string,
    status: string
  }]
}
```

### 7.3 获取资产详情

```
GET /api/governance/assets/{id}

Response:
{
  asset: {
    id, name, type, status,
    position: { id, title },
    owner: { id, name, email },
    runtime: { id, status },
    metrics: { /* 详细指标 */ },
    recent_runs: [],
    active_anomalies: []
  }
}
```

### 7.4 执行治理操作

```
POST /api/governance/assets/{id}/action

Request:
{
  action: "pause" | "resume" | "limit" | "redirect",
  reason?: string,
  params?: object
}

Response:
{
  success: boolean,
  action: string,
  applied_at: string
}
```

## 8. 前端组件架构

### 8.1 组件列表

| 组件                | 路径                                        | 职责         |
| ------------------- | ------------------------------------------- | ------------ |
| GovernanceDashboard | governance-ui/pages/GovernanceDashboard.tsx | 治理总览页   |
| AnomalyQueue        | governance-ui/components/AnomalyQueue.tsx   | 异常队列组件 |
| AssetTable          | governance-ui/components/AssetTable.tsx     | AI资产表格   |
| AssetDrawer         | governance-ui/components/AssetDrawer.tsx    | 资产详情抽屉 |
| OwnerPanel          | governance-ui/components/OwnerPanel.tsx     | 负责人侧栏   |
| MetricsCard         | governance-ui/components/MetricsCard.tsx    | 指标卡片     |
| RiskBadge           | governance-ui/components/RiskBadge.tsx      | 风险等级徽章 |

### 8.2 状态管理 (Zustand Store)

```typescript
interface GovernanceStore {
  // 资产列表
  assets: Asset[];
  assetFilters: AssetFilters;
  assetPagination: PaginationState;

  // 异常队列
  anomalies: Anomaly[];
  anomalyFilters: AnomalyFilters;

  // 选中资产
  selectedAssetId: string | null;
  assetDetail: AssetDetail | null;

  // 操作
  isLoading: boolean;
  lastAction: GovernanceAction | null;

  // Actions
  fetchAssets: () => Promise<void>;
  fetchAnomalies: () => Promise<void>;
  selectAsset: (id: string) => void;
  executeAction: (action: GovernanceAction) => Promise<void>;
}
```

## 9. 性能要求

- 列表响应 < 200ms
- 支持 ≥ 10万资产
- 强制要求：查询必须基于 ai_metrics_daily，禁止扫描 ai_runs

## 10. 文件结构

```
src/gateway/ai-workforce-governance/
├── ai-assets/
│   ├── store.ts          # 存储层
│   ├── queries.ts        # 查询逻辑
│   └── types.ts          # 类型定义
├── ai-runs/
│   ├── store.ts
│   ├── queries.ts
│   └── types.ts
├── metrics-aggregator/
│   ├── aggregator.ts     # 定时聚合任务
│   ├── calculator.ts     # 指标计算
│   └── types.ts
├── anomaly-engine/
│   ├── detector.ts       # 异常检测引擎
│   ├── rules.ts          # 检测规则定义
│   └── types.ts
├── governance-api/
│   ├── endpoints.ts      # API端点定义
│   ├── handlers.ts       # 请求处理器
│   └── client.ts         # API客户端
└── shared/
    ├── db-schema.ts      # 数据库Schema
    ├── types.ts          # 共享类型
    └── utils.ts          # 工具函数

ui/src/ui/capability/ai-workforce-governance/
├── components/
│   ├── AnomalyQueue.tsx
│   ├── AssetTable.tsx
│   ├── AssetDrawer.tsx
│   ├── OwnerPanel.tsx
│   ├── MetricsCard.tsx
│   └── RiskBadge.tsx
├── pages/
│   └── GovernanceDashboard.tsx
├── store/
│   └── governanceStore.ts
├── services/
│   └── governanceApi.ts
├── types/
│   └── index.ts
├── index.ts
└── README.md
```

## 11. 验收标准

### 功能验收

- [x] 资产列表可展示，支持筛选和排序
- [x] 指标数据准确，实时更新
- [x] 异常自动生成，进入治理队列
- [x] 可进入资产详情查看完整信息
- [x] 可执行治理操作（暂停/恢复/限制）

### 体验验收

- [x] 3步内可找到责任人
- [x] 2步内可执行治理动作
- [x] 列表响应 < 200ms

### 技术验收

- [x] 代码通过 ESLint + Prettier 检查
- [x] 所有组件包含 Storybook 示例
- [x] TypeScript 类型完整
- [x] 单元测试覆盖率 ≥ 70%

## 12. 扩展规划

### 12.1 排名算法（下一迭代）

- 多维度评分：成功率权重40%、成本效率权重30%、活跃度权重30%
- 动态排名更新

### 12.2 治理动作引擎（下一迭代）

- 自动治理策略配置
- 条件触发器（如连续3天失败率>30%自动暂停）
