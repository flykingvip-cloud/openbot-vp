# Design Document

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Enterprise Mesh Governance                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  ┌──────────────┐    ┌──────────────────┐    ┌───────────────────┐  │
│  │ Ownership    │    │ Governance       │    │ UI Layer          │  │
│  │ Service      │    │ Engine           │    │                   │  │
│  │              │    │                  │    │ ┌───────────────┐ │  │
│  │ • 创建时绑定  │    │ • 状态监控        │    │ │ 紧凑头部      │ │  │
│  │ • 岗位继承    │    │ • 成本监控        │    │ │ (单行指标)    │ │  │
│  │ • 变动日志    │    │ • 质量监控        │    │ ├───────────────┤ │  │
│  │              │    │ • 安全监控        │    │ │ 治理队列      │ │  │
│  └──────┬───────┘    │ • 协作小组监控    │    │ │ (三级分类)    │ │  │
│         │            │                  │    │ ├───────────────┤ │  │
│         │            └────────┬─────────┘    │ │ 排名工作台    │ │  │
│         │                     │              │ │ (4 tabs)      │ │  │
│         ▼                     ▼              │ └───────────────┘ │  │
│  ┌──────────────────────────────────────┐    │                   │  │
│  │         Enterprise Read Model         │    └───────────────────┘  │
│  │                                        │                          │
│  │ • meshAgents[] (含 ownership)          │                          │
│  │ • meshGroups[] (含 ownership)          │                          │
│  │ • governanceQueue[] (运营异常)          │                          │
│  │ • meshSummary (聚合指标)               │                          │
│  └────────────────────────────────────────┘                          │
└─────────────────────────────────────────────────────────────────────┘
```

## Data Model Changes

### 1. Ownership Model（新增）

```typescript
// ui/src/ui/ports/enterprise/semantic/enterprise-read-model.ts

/** 岗位归属信息 — 创建时自动写入，岗位人员变动时 currentManagerUserId 自动更新 */
export type MeshOwnership = {
  positionId: string; // 归属岗位 ID（必填，创建时写入）
  positionLabel: string; // 岗位名称（展示用）
  createdByUserId: string; // 原始创建人 ID（历史记录，不变）
  createdByUserLabel: string; // 原始创建人名称
  currentManagerUserId: string; // 当前管理人 ID（随岗位人员变动更新）
  currentManagerLabel: string; // 当前管理人名称
  createdAt: string; // 创建时间 ISO
};
```

### 2. MeshAgent 类型变更

```typescript
// 移除字段
- creatorUser: string | null;
- creatorLabel: string | null;
- creatorStatus: MeshCreatorStatus;  // 整个类型废弃

// 新增字段
+ ownership: MeshOwnership;          // 必填，创建时自动填充
```

### 3. MeshGroup 类型变更

```typescript
// 移除
- creatorStatus: MeshCreatorStatus;  // 不再硬编码 "unowned"
- creatorUser: null;
- creatorLabel: null;

// 新增
+ ownership: MeshOwnership;          // 必填，创建时自动填充
```

### 4. Governance Queue Model（重构）

```typescript
/** 治理项级别 */
export type GovernanceLevel = "critical" | "warning" | "info";

/** 治理项分类 */
export type GovernanceCategory =
  // 状态异常
  | "consecutive_errors"
  | "offline_with_active_sessions"
  | "zombie_agent"
  | "high_error_rate"
  // 成本异常
  | "cost_spike"
  | "budget_exceeded"
  | "inefficient_cost"
  | "group_budget_exceeded"
  // 质量异常
  | "quality_degradation"
  | "quality_drop"
  // 安全合规
  | "sensitive_content"
  | "permission_violation"
  // 协作小组
  | "zombie_group"
  | "redundant_members"
  | "group_quality_issue";

/** 治理项 */
export type GovernanceItem = {
  id: string; // 确定性 ID: `${category}:${targetKind}:${targetId}`
  level: GovernanceLevel;
  category: GovernanceCategory;
  target: {
    kind: "agent" | "group";
    id: string;
    name: string;
    ownership: MeshOwnership;
  };
  title: string; // 人类可读标题
  evidence: Record<string, unknown>; // 具体证据数据
  suggestedAction: string; // 建议动作描述
  detectedAt: string; // ISO 时间
};

/** 治理配置（阈值） */
export type GovernanceConfig = {
  consecutiveErrorThreshold: number; // 默认 5
  offlineAlertHours: number; // 默认 24
  zombieDays: number; // 默认 30
  errorRateThreshold: number; // 默认 0.30
  costSpikeMultiplier: number; // 默认 3
  qualityDropPoints: number; // 默认 20
  groupZombieDays: number; // 默认 30
};

export const DEFAULT_GOVERNANCE_CONFIG: GovernanceConfig = {
  consecutiveErrorThreshold: 5,
  offlineAlertHours: 24,
  zombieDays: 30,
  errorRateThreshold: 0.3,
  costSpikeMultiplier: 3,
  qualityDropPoints: 20,
  groupZombieDays: 30,
};
```

### 5. MeshSummary 变更

```typescript
// 移除
- unownedAssetCount: number;
- unattributedCostCount: number;

// 新增
+ criticalIssueCount: number;
+ warningIssueCount: number;
+ infoIssueCount: number;
+ totalGovernanceIssueCount: number;  // = critical + warning + info
```

## Module Layout

```
ui/src/ui/ports/enterprise/
├── semantic/
│   └── enterprise-read-model.ts          # MeshOwnership 类型 + 投影逻辑重构
├── governance/
│   ├── ownership-service.ts              # 岗位归属写入 + 继承逻辑
│   ├── governance-engine.ts              # 运营治理检测引擎（纯函数）
│   ├── governance-config.ts              # 阈值配置管理
│   ├── governance-actions.ts             # 治理动作执行（暂停/限流/下线/归档等）
│   └── __tests__/
│       ├── ownership-service.test.ts
│       ├── governance-engine.test.ts
│       ├── governance-engine.property.test.ts
│       └── governance-actions.test.ts
└── views/
    └── enterprise-surfaces.ts            # UI 渲染重构
```

## Governance Engine Design

治理引擎是一个**纯函数**，输入当前状态数据，输出治理项列表：

```typescript
function detectGovernanceIssues(
  agents: EnterpriseMeshAgent[],
  groups: EnterpriseMeshGroup[],
  config: GovernanceConfig,
  now: number,
): GovernanceItem[];
```

### 检测规则优先级

| 优先级 | Category                     | Level    | 条件                             |
| ------ | ---------------------------- | -------- | -------------------------------- |
| 1      | sensitive_content            | critical | 触发敏感词过滤器                 |
| 2      | permission_violation         | critical | 越权操作                         |
| 3      | consecutive_errors           | critical | 连续错误 ≥ threshold             |
| 4      | offline_with_active_sessions | critical | 离线 ≥ N 小时且有活跃会话        |
| 5      | cost_spike                   | critical | 单日成本 ≥ 7 日均值 × multiplier |
| 6      | budget_exceeded              | warning  | 月度成本 ≥ 预算                  |
| 7      | high_error_rate              | warning  | 错误率 ≥ threshold               |
| 8      | quality_degradation          | warning  | 7 日成功率 < threshold           |
| 9      | quality_drop                 | warning  | 成功率环比下降 ≥ N 百分点        |
| 10     | inefficient_cost             | warning  | 单次会话成本 ≥ 同类均值 × 2      |
| 11     | group_budget_exceeded        | warning  | 小组月度成本 ≥ 预算              |
| 12     | group_quality_issue          | warning  | 小组错误率 ≥ threshold           |
| 13     | zombie_agent                 | info     | 无会话 ≥ N 天且已部署 > 30 天    |
| 14     | zombie_group                 | info     | 无会话 ≥ N 天                    |
| 15     | redundant_members            | info     | 同组内能力域重叠                 |

### ID 生成规则

```typescript
// 确定性 ID，保证幂等
const issueId = `${category}:${target.kind}:${target.id}`;
```

## UI Layout Design

### 页面结构（重构后）

```
┌─────────────────────────────────────────────────────────────┐
│ 机巢治理  │ 机器人 6 │ 协作小组 1 │ 本月成本 $0.00 │ [刷新] │  ← 单行头部 (48-56px)
├─────────────────────────────────────────────────────────────┤
│ ┌─────────┐ ┌─────────┐ ┌─────────┐                        │
│ │🔴 待处置 │ │⚠️ 待复核 │ │ℹ️ 待优化 │                        │  ← KPI 指标行 (64px)
│ │   0 项   │ │   3 项   │ │   5 项   │                        │
│ └─────────┘ └─────────┘ └─────────┘                        │
├─────────────────────────────────────────────────────────────┤
│ [治理队列●] [员工排名] [机器人排名] [协作小组排名]              │  ← Tabs
├────────────────────────────────┬────────────────────────────┤
│ ▸ 待处置 (0)                   │                            │
│ ▾ 待复核 (3)                   │  对象详情                   │  ← Master-Detail
│   ├ Bot-A  成本突增 3.2x        │  ┌────────────────────┐   │
│   ├ Bot-B  错误率 45%           │  │ 证据 + 趋势图      │   │
│   └ Group-1 预算超标            │  │ + 可执行动作按钮    │   │
│ ▾ 待优化 (5)                   │  └────────────────────┘   │
│   ├ Bot-C  僵尸 45 天           │                            │
│   └ ...                        │                            │
└────────────────────────────────┴────────────────────────────┘
```

### 关键 UI 规则

1. **头部单行化**：去掉 `enterprise-hero` 的 eyebrow、大标题、副标题、渐变背景。改为 flex 单行：标题 + inline metrics + 刷新按钮。
2. **KPI 指标行**：3 个紧凑 metric card（待处置/待复核/待优化），点击可快速筛选队列。
3. **空队列折叠**：count = 0 的级别折叠为单行，不展开空态文案。
4. **Detail panel 固定**：右侧详情面板 `position: sticky`，不随列表滚动消失。
5. **排名列表增加归属列**：机器人排名和协作小组排名表格中增加"归属岗位"和"当前负责人"列。

## Migration Strategy

### 数据迁移（存量数据）

1. 对于已有 `ownerId` 的机器人：将 `ownerId` 映射到对应岗位的 `positionId`。
2. 对于无 `ownerId` 的机器人（历史遗留）：分配到企业默认管理岗位，并生成一次性迁移报告。
3. 对于所有协作小组（当前全部 `creatorStatus = "unowned"`）：根据小组内最早活跃的成员推断归属岗位，无法推断的分配到默认管理岗位。

### 代码迁移

1. 移除 `MeshCreatorStatus` 类型及所有引用。
2. 移除 `classifyMeshQueue` 中的 `"owner"` 和 `"attribution"` 分支。
3. 移除 `meshOwnershipLabel` 函数（不再需要 "已记录"/"创建人不清"/"未记录" 三态）。
4. 移除 `buildMeshQueueCounts` 中的 `attribution` 和 `owner` 计数。
5. 重写 `buildMeshAnomalyView` → 新的 `detectGovernanceIssues` 纯函数。
6. 重写 `renderMeshAnomalyPanel` → 新的三级队列渲染。
7. 重写 `renderManagementHeader` 的 mesh 分支 → 紧凑单行头部。

### 兼容窗口

- `unownedAssetCount` 字段保留 1 个发布周期（返回 0），之后移除。
- `creatorStatus` 字段保留 1 个发布周期（始终返回 "owned"），之后移除。
- 旧的 `meshAnomalies` 数据格式保留 1 个发布周期（映射到新格式），之后移除。

## Gateway RPC Changes

### 新增端点

| Method                          | Scope | Description            |
| ------------------------------- | ----- | ---------------------- |
| `mesh.governance.listQueue`     | read  | 返回当前治理队列       |
| `mesh.governance.executeAction` | admin | 执行治理动作           |
| `mesh.governance.getConfig`     | read  | 获取治理阈值配置       |
| `mesh.governance.updateConfig`  | admin | 更新治理阈值配置       |
| `mesh.ownership.transfer`       | admin | 手动转移归属（极少用） |

### 废弃端点（兼容窗口后移除）

- 与"待补创建人"相关的任何 RPC 逻辑

## Testing Strategy

### Property Tests

1. **归属完整性**：fast-check 生成任意创建请求 → `ownership.positionId` 非空。
2. **检测幂等性**：相同输入 → `detectGovernanceIssues` 两次调用结果 deep-equal。
3. **阈值边界**：恰好等于阈值不触发；严格超过触发。
4. **队列纯净性**：输出中不含 `missing_owner` / `missing_attribution` category。
5. **ID 稳定性**：相同 (category, kind, id) → 相同 issueId。

### Unit Tests

- 每个检测规则的边界条件
- 岗位继承的正确性
- 治理动作的状态转换
- UI 渲染的空态/满态

### Integration Tests

- 创建机器人 → 验证 ownership 自动填充
- 岗位人员变动 → 验证管理权继承
- 触发阈值 → 验证治理项生成 → 执行动作 → 验证队列清除
