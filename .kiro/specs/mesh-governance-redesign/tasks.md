# Implementation Plan: 机巢治理重构（Mesh Governance Redesign）

## Overview

本计划将机巢治理模块从"数据完整性修补"模式重构为"运营健康度管理"模式，分四阶段交付：

- **Phase 1 — 归属模型重构**：建立岗位归属数据模型，实现创建时自动绑定和岗位人员变动时自动继承，移除 `MeshCreatorStatus` 及相关伪治理逻辑。
- **Phase 2 — 运营治理引擎**：实现纯函数治理检测引擎，覆盖状态异常、成本效率、质量表现、安全合规、协作小组运营五大维度。
- **Phase 3 — UI 重构**：压缩 Hero 区域为单行头部，实现三级治理队列 UI，空队列折叠，detail panel 固定，排名列表增加归属列。
- **Phase 4 — 治理配置与通知**：实现阈值配置面板、治理动作执行、审计日志、通知升级。

**共同约束**：

- 治理队列中不得出现 `missing_owner` 或 `missing_attribution` 类别
- 所有新创建的机器人/协作小组必须有非空 `ownership.positionId`
- 治理检测引擎为纯函数，确定性输出
- UI 首屏即工作区，头部高度 ≤ 64px

## Tasks

### Phase 1：归属模型重构

- [x] 1. 定义 MeshOwnership 类型与迁移类型
  - 修改 `ui/src/ui/ports/enterprise/semantic/enterprise-read-model.ts`
  - 新增 `MeshOwnership` 类型：`{ positionId, positionLabel, createdByUserId, createdByUserLabel, currentManagerUserId, currentManagerLabel, createdAt }`
  - 标记 `MeshCreatorStatus` 为 `@deprecated`（兼容窗口期保留）
  - 修改 `EnterpriseMeshAgent` 类型：新增 `ownership: MeshOwnership`，标记 `creatorUser` / `creatorLabel` / `creatorStatus` 为 `@deprecated`
  - 修改 `EnterpriseMeshGroup` 类型：新增 `ownership: MeshOwnership`，移除硬编码 `creatorStatus = "unowned"`
  - 修改 `MeshSummary`：移除 `unownedAssetCount` / `unattributedCostCount`，新增 `criticalIssueCount` / `warningIssueCount` / `infoIssueCount` / `totalGovernanceIssueCount`
  - _Requirements: 1, 2, 3, 4_

- [x] 2. 实现 Ownership Service（创建时自动绑定）
  - 新建 `ui/src/ui/ports/enterprise/governance/ownership-service.ts`
  - 实现 `resolveOwnershipOnCreate(params: { operatorUserId, operatorPositionId, operatorPositionLabel, operatorUserLabel }): MeshOwnership`
  - 实现 `resolveOwnershipOnImport(params: { positionId?, fallbackPositionId }): MeshOwnership`（批量导入场景）
  - 确保返回的 `ownership.positionId` 始终非空
  - _Requirements: 1, 2_

- [x] 3. 实现岗位人员变动时的管理权继承
  - 修改 `ui/src/ui/ports/enterprise/governance/ownership-service.ts`
  - 实现 `transferOwnershipOnPositionChange(params: { positionId, previousUserId, newUserId, newUserLabel, agents: MeshAgent[], groups: MeshGroup[] }): { updatedAgents, updatedGroups, transferLog }`
  - 保留 `createdByUserId` 不变，仅更新 `currentManagerUserId` 和 `currentManagerLabel`
  - 返回变动日志：`{ positionId, previousUserId, newUserId, transferredAt, affectedAgentCount, affectedGroupCount }`
  - _Requirements: 3_

- [x] 4. 重构 enterprise-read-model 中的 Agent/Group 投影逻辑
  - 修改 `ui/src/ui/ports/enterprise/semantic/enterprise-read-model.ts`
  - Agent 投影：从 `agent.ownerId` + 岗位数据推导 `ownership`（兼容旧数据：无 ownerId 时使用默认管理岗位）
  - Group 投影：从小组元数据或成员推断 `ownership`（替代硬编码 `"unowned"`）
  - 移除 `creatorStatus` 的计算逻辑
  - 移除 `unownedAssetCount` 的计算逻辑
  - _Requirements: 1, 2, 3, 4_

- [x] 5. 存量数据迁移逻辑
  - 新建 `ui/src/ui/ports/enterprise/governance/ownership-migration.ts`
  - 实现 `migrateAgentOwnership(agent, positionLookup, defaultPositionId): MeshOwnership`
  - 实现 `migrateGroupOwnership(group, memberActivity, positionLookup, defaultPositionId): MeshOwnership`
  - 规则：有 ownerId → 映射到岗位；无 ownerId → 默认管理岗位 + 标记迁移来源
  - _Requirements: 1.4_

- [x] 6. Ownership 属性测试
  - 新建 `ui/src/ui/ports/enterprise/governance/__tests__/ownership-service.property.test.ts`
  - **Property: 归属完整性** — fast-check 生成任意创建参数 → `ownership.positionId` 非空
  - **Property: 继承一致性** — 岗位变动后所有对象的 `currentManagerUserId` === 新人员 ID
  - 单元测试覆盖：正常创建、批量导入、岗位变动、边界条件
  - _Requirements: Correctness Properties 1, 2_

### Phase 2：运营治理引擎

- [x] 7. 实现治理检测引擎（纯函数）
  - 新建 `ui/src/ui/ports/enterprise/governance/governance-engine.ts`
  - 实现 `detectGovernanceIssues(agents, groups, config, now): GovernanceItem[]`
  - 实现各检测规则（按优先级）：
    - `detectSecurityViolations` → Critical
    - `detectConsecutiveErrors` → Critical
    - `detectOfflineWithActiveSessions` → Critical
    - `detectCostSpike` → Critical
    - `detectBudgetExceeded` → Warning
    - `detectHighErrorRate` → Warning
    - `detectQualityDegradation` → Warning
    - `detectQualityDrop` → Warning
    - `detectInefficientCost` → Warning
    - `detectGroupBudgetExceeded` → Warning
    - `detectGroupQualityIssue` → Warning
    - `detectZombieAgent` → Info
    - `detectZombieGroup` → Info
    - `detectRedundantMembers` → Info
  - ID 生成规则：`${category}:${target.kind}:${target.id}`
  - 输出按 level（Critical > Warning > Info）排序，同级别按 detectedAt 降序
  - _Requirements: 5, 6, 7, 8, 9, 10_

- [x] 8. 实现治理配置管理
  - 新建 `ui/src/ui/ports/enterprise/governance/governance-config.ts`
  - 导出 `DEFAULT_GOVERNANCE_CONFIG` 常量
  - 实现 `validateConfig(partial): GovernanceConfig`（合并默认值 + 范围校验）
  - 实现 `persistConfig(config)` 和 `loadConfig(): GovernanceConfig`
  - _Requirements: 15_

- [x] 9. 实现治理动作执行
  - 新建 `ui/src/ui/ports/enterprise/governance/governance-actions.ts`
  - 实现 `executeGovernanceAction(params: { issueId, actionType, targetId, operatorUserId, operatorPositionId, reason? }): ActionResult`
  - 动作类型：`pause` / `throttle` / `offline` / `downgrade_model` / `set_budget_cap` / `mark_known` / `archive` / `merge` / `ignore`
  - 执行成功后：更新目标对象状态 + 从队列移除治理项 + 写入审计日志
  - 执行失败：保留原状态 + 返回错误
  - _Requirements: 11_

- [x] 10. 治理引擎属性测试
  - 新建 `ui/src/ui/ports/enterprise/governance/__tests__/governance-engine.property.test.ts`
  - **Property: 检测幂等性** — 相同输入两次调用结果 deep-equal（含 id）
  - **Property: 阈值边界** — 恰好等于阈值不触发；严格超过触发
  - **Property: 队列纯净性** — 输出中不含 `missing_owner` / `missing_attribution`
  - **Property: ID 稳定性** — 相同 (category, kind, id) → 相同 issueId
  - 单元测试覆盖每个检测规则的边界条件
  - _Requirements: Correctness Properties 3, 4, 5_

- [x] 11. 治理动作单元测试
  - 新建 `ui/src/ui/ports/enterprise/governance/__tests__/governance-actions.test.ts`
  - 覆盖：每种动作类型的成功/失败路径
  - 验证：动作执行后审计日志存在
  - 验证：动作执行后队列中对应项被移除
  - _Requirements: 11, Correctness Properties 6, 7_

### Phase 3：UI 重构

- [x] 12. 重构页面头部为紧凑单行
  - 修改 `ui/src/ui/ports/enterprise/views/enterprise-surfaces.ts`
  - 重写 `renderManagementHeader` 的 `mesh` tone 分支：
    - 移除 `enterprise-hero__eyebrow`（"Mesh governance"）
    - 移除大面积渐变背景和 min-height
    - 改为 flex 单行：标题 + inline metrics（机器人数、协作小组数、本月成本）+ 刷新按钮
    - 高度 ≤ 64px
  - 移除右侧 `enterprise-action-board` 中的"治理队列"/"待补归因"/"待补创建人"/"刷新机巢" cards
  - _Requirements: 12_

- [x] 13. 实现三级治理队列 KPI 指标行
  - 修改 `ui/src/ui/ports/enterprise/views/enterprise-surfaces.ts`
  - 在头部下方新增 KPI 指标行（3 个紧凑 metric card）：
    - 🔴 待处置 (criticalIssueCount)
    - ⚠️ 待复核 (warningIssueCount)
    - ℹ️ 待优化 (infoIssueCount)
  - 点击 metric card → 筛选队列到对应级别
  - _Requirements: 5, 12_

- [x] 14. 重写治理队列面板（替代 renderMeshAnomalyPanel）
  - 修改 `ui/src/ui/ports/enterprise/views/enterprise-surfaces.ts`
  - 移除 `renderMeshAnomalyPanel` 函数
  - 新建 `renderGovernanceQueuePanel` 函数：
    - 按 level 分组展示（Critical → Warning → Info）
    - 空级别折叠为单行（标题 + "0 项"），不展开空态文案
    - 治理项行：目标名称 + 问题类型标签 + 检测时间 + 建议动作按钮
    - 点击治理项 → 右侧 detail panel 展示完整证据
  - _Requirements: 13_

- [x] 15. 实现固定 Detail Panel
  - 修改 `ui/src/ui/ports/enterprise/views/enterprise-surfaces.ts`
  - 重写 `renderMeshDetailPanel`：
    - `position: sticky; top: 0` 固定在右侧
    - 展示：目标对象信息（含归属岗位/当前负责人）、问题证据数据、趋势图（复用 mini-trend-chart）、可执行动作按钮
    - 未选中时展示空态提示"选择左侧治理项查看详情"
  - _Requirements: 13_

- [x] 16. 排名列表增加归属列
  - 修改 `ui/src/ui/ports/enterprise/views/enterprise-surfaces.ts`
  - 修改 `renderMeshUserDistribution`：员工排名表格增加"管理机器人数"列
  - 修改 `renderMeshAgentPerformance`：机器人排名表格增加"归属岗位"和"当前负责人"列
  - 修改 `renderMeshGroupPerformance`：协作小组排名表格增加"归属岗位"和"当前负责人"列
  - 点击归属岗位 → 跳转组织架构岗位详情
  - _Requirements: 4, 14_

- [x] 17. 移除旧治理逻辑的 UI 引用
  - 修改 `ui/src/ui/ports/enterprise/views/enterprise-surfaces.ts`
  - 移除 `meshOwnershipLabel` 函数
  - 移除 `meshAttributionLabel` 函数
  - 移除 `classifyMeshQueue` 中的 `"owner"` 和 `"attribution"` 分支
  - 移除 `buildMeshQueueCounts` 中的 `attribution` 和 `owner` 计数
  - 移除 `renderMeshActionCards` 中"待补归因"和"待补创建人"的 card
  - 更新 `renderEnterpriseSurface` 的 `enterpriseMesh` case：使用新的 `renderGovernanceQueuePanel`
  - _Requirements: 5, 12, 13_

- [x] 18. UI 重构单元测试
  - 修改 `ui/src/ui/ports/enterprise/views/enterprise-surfaces.browser.test.ts`
  - 移除"待补创建人"/"待补归因"相关断言
  - 新增断言：
    - 头部高度 ≤ 64px（或验证不含 `enterprise-hero__eyebrow`）
    - 治理队列按三级分组渲染
    - 空级别折叠为单行
    - 排名列表包含"归属岗位"列
    - 不存在 `unownedAssetCount` 或 `unattributedCostCount` 的展示
  - _Requirements: 12, 13, 14_

### Phase 4：治理配置与通知

- [x] 19. 实现治理阈值配置面板 UI
  - 修改 `ui/src/ui/ports/enterprise/views/enterprise-surfaces.ts`
  - 新增 `renderGovernanceConfigPanel` 函数：
    - 7 个阈值输入（含默认值标注）
    - 修改后立即触发 `detectGovernanceIssues` 重新计算
    - 保存按钮持久化到企业配置
  - 配置面板入口：治理队列面板右上角齿轮图标
  - _Requirements: 15_

- [x] 20. 实现治理动作对话框
  - 修改 `ui/src/ui/ports/enterprise/views/enterprise-surfaces.ts`
  - 新增 `renderGovernanceActionDialog` 函数：
    - Critical 动作：暂停、限流、下线（含确认提示和影响评估）
    - Warning 动作：降级模型、设置预算上限、标记为已知问题
    - Info 动作：归档、合并、忽略（本周期不再提醒）
    - 执行成功 → 关闭对话框 + 刷新队列
    - 执行失败 → 保留对话框 + 展示错误
  - _Requirements: 11_

- [x] 21. 实现治理通知与升级
  - 新建 `ui/src/ui/ports/enterprise/governance/governance-notification.ts`
  - 实现 `notifyOnCriticalIssue(issue: GovernanceItem): void`
    - 向归属岗位当前负责人发送通知
    - 通知内容：问题摘要、目标对象、检测时间、建议动作、直达链接
  - 实现 `escalateUnhandledIssue(issue: GovernanceItem, hoursUnhandled: number): void`
    - 超过 4 小时未处理 → 升级到上级管理岗位
  - _Requirements: 16_

- [x] 22. Gateway RPC 端点实现
  - 修改 `src/gateway/server-methods/capability-governance.ts`（或新建 mesh-governance handler）
  - 实现 `mesh.governance.listQueue`（read scope）
  - 实现 `mesh.governance.executeAction`（admin scope）
  - 实现 `mesh.governance.getConfig`（read scope）
  - 实现 `mesh.governance.updateConfig`（admin scope）
  - 实现 `mesh.ownership.transfer`（admin scope）
  - _Requirements: 11, 15_

- [x] 23. 端到端集成测试
  - 新建 `ui/src/ui/ports/enterprise/governance/__tests__/integration.test.ts`
  - 测试 1：创建机器人 → 验证 ownership 自动填充 → 列表展示归属信息
  - 测试 2：岗位人员变动 → 验证所有对象 currentManagerUserId 更新
  - 测试 3：触发成本突增阈值 → 验证 Critical 治理项生成 → 执行暂停动作 → 验证队列清除 + 审计日志
  - 测试 4：修改阈值 → 验证队列立即重新计算
  - 测试 5：验证治理队列中不存在 `missing_owner` / `missing_attribution` 类别
  - _Requirements: All Correctness Properties_

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2", "3", "5"] },
    { "id": 2, "tasks": ["4", "6"] },
    { "id": 3, "tasks": ["7", "8"] },
    { "id": 4, "tasks": ["9", "10"] },
    { "id": 5, "tasks": ["11"] },
    { "id": 6, "tasks": ["12", "13", "14"] },
    { "id": 7, "tasks": ["15", "16", "17"] },
    { "id": 8, "tasks": ["18"] },
    { "id": 9, "tasks": ["19", "20", "21"] },
    { "id": 10, "tasks": ["22"] },
    { "id": 11, "tasks": ["23"] }
  ]
}
```

### 执行顺序说明

```
数据模型（必须先完成）:
1 → 2, 3, 5 → 4, 6 (归属模型是一切基础)

治理引擎（依赖数据模型）:
7, 8 → 9, 10 → 11

UI 重构（依赖治理引擎）:
12, 13, 14 → 15, 16, 17 → 18

配置与通知（依赖 UI + 引擎）:
19, 20, 21 → 22 → 23
```

## Notes

### 验收门槛

每个任务完成时必须满足：

- 类型检查通过：`pnpm tsgo`
- 构建通过：`pnpm build`
- 治理队列中不存在 `missing_owner` / `missing_attribution` 类别
- 新创建的机器人/协作小组 `ownership.positionId` 非空
- 治理检测引擎为纯函数（无副作用、确定性输出）
- UI 头部高度 ≤ 64px，治理队列首屏可见

### 兼容窗口（≥ 1 个发布周期）

- `MeshCreatorStatus` 类型保留但标记 `@deprecated`
- `unownedAssetCount` 字段保留（始终返回 0）
- `creatorStatus` 字段保留（始终返回 "owned"）
- `classifyMeshQueue` 的 `"owner"` / `"attribution"` 分支保留但永远不会命中

### 移除清单（兼容窗口结束后）

- `MeshCreatorStatus` 类型
- `meshOwnershipLabel` 函数
- `meshAttributionLabel` 函数
- `unownedAssetCount` / `unattributedCostCount` 字段
- `creatorUser` / `creatorLabel` / `creatorStatus` 字段
- `classifyMeshQueue` 中的 `"owner"` / `"attribution"` 分支
- `buildMeshQueueCounts` 中的 `attribution` / `owner` 计数
- `renderMeshAnomalyPanel` 函数（已被 `renderGovernanceQueuePanel` 替代）
