# Implementation Plan: Platform Agent Runtime Center

## Overview

本计划围绕"Runtime Canonical Model + Projection Layer"双核心展开，分三阶段交付平台侧 Agent Runtime Center：

- **Phase 1**：建立 Runtime Canonical Model（类型 / 投影 / Health 计算 / Lifecycle 状态机 / Governance 检测器）+ Gateway 端点 + UI 五标签页（Catalog / Bindings / Health / Lifecycle / Governance）。
- **Phase 2**：完善 Lifecycle 转换、Governance 配置、Projection 事件总线、企业端反向触发、Capability Center 联动、术语守卫、端到端集成测试。
- **Phase 3**：延后实施 Runtime Intelligence（动态编排 / 热更新 / Canary / Agent Mesh）。

共同约束：

- 平台侧严禁出现业务术语（企业价值、贡献绩效、部门覆盖、复用价值、机器人、我的能力等），由术语守卫强制。
- 所有跨层数据流必须经过 `runtime-canonical/projection.ts` 的纯函数投影；运行时字段不得透传到企业端 / 员工端。
- 投影 / Health / Lifecycle / Governance 四类纯函数模块必须配套 fast-check 属性测试。

## Tasks

### Phase 1：Runtime Canonical Model + Catalog + Bindings + Health

- [x] 1. 建立 Runtime Canonical Model 类型定义
  - 创建 `ui/src/ui/capability/runtime-canonical/types.ts`
  - 定义 `RuntimeLifecycle`、`RuntimeHealth`、`BindingType`、`LoadStrategy`、`BindingState` 枚举
  - 定义 `RuntimeAgent`、`RuntimeCapabilityBinding`、`RuntimeTelemetry` 核心模型
  - 定义 `RuntimeGovernanceIssue`、`RuntimeGovernanceIssueCategory` 治理类型
  - 定义 `RUNTIME_LIFECYCLE_TRANSITIONS` 状态机常量
  - 严格不引入任何业务字段（贡献绩效、企业价值、部门覆盖等）
  - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [x] 2. 实现 Projection Layer（核心）
  - 创建 `ui/src/ui/capability/runtime-canonical/projection.ts`
  - 实现 `projectHealthToEnterprise`：RuntimeHealth → EnterpriseHealthProjection（4 → 4 映射）
  - 实现 `projectHealthToEmployee`：RuntimeHealth → EmployeeHealthProjection（unavailable 返回 null）
  - 实现 `projectBindingToInstallRelation`：RuntimeCapabilityBinding → 企业端 InstallRelation
  - 实现 `projectBindingTypeToSource` 和 `projectBindingStateToStatus` 辅助投影
  - 实现 `projectLifecycleToNotification`：deprecated/archived 触发通知
  - 实现 `isProjectionClean` 纯净性校验函数（运行时字段黑名单）
  - 所有投影函数为纯函数，无外部依赖
  - _Requirements: 1.5, 1.6, 1.7, 7.1, 7.2, 7.3, 7.4, 7.5_

- [x] 3. 实现 Projection 属性测试
  - 创建 `ui/src/ui/capability/runtime-canonical/__tests__/projection.property.test.ts`
  - Property 1：完备性 — RuntimeHealth 4 个枚举值都有非 undefined 投影
  - Property 2：纯净性 — projectBindingToInstallRelation 输出不含 RUNTIME_INTERNAL_FIELDS
  - Property 3：幂等性 — 同一输入多次调用返回 deep-equal
  - 使用 fast-check，每个属性最少 100 次迭代
  - CI 必须通过
  - _Requirements: 7.4, 7.5_

- [x] 4. 实现 RuntimeHealth 计算器
  - 创建 `ui/src/ui/capability/runtime-canonical/health-calculator.ts`
  - 实现 `calculateRuntimeHealth(telemetry, thresholds?)` 函数
  - 定义 `DEFAULT_HEALTH_THRESHOLDS` 默认阈值
  - 实现映射规则：成功率 ≥ 95% 且延迟正常 → healthy；70-94% → degraded；50-69% → unhealthy；< 50% → unavailable
  - _Requirements: 4.3_

- [x] 5. 实现 Health Calculator 属性测试
  - 创建 `ui/src/ui/capability/runtime-canonical/__tests__/health-calculator.property.test.ts`
  - Property 4：单调性 — successRate 上升时健康状态不会变差
  - 阈值边界单元测试：0.95、0.70、0.50 三个边界点
  - _Requirements: 4.3_

- [x] 6. 实现 Lifecycle 状态机
  - 在 `runtime-canonical/lifecycle-state-machine.ts` 实现状态转换验证
  - 实现 `canTransition(current, target): boolean`
  - 实现 `validateTransition(current, target): { ok: true } | { ok: false; reason: string }`
  - 合法路径：deployed→draining→suspended→{deployed|archived}；deployed→deprecated→archived
  - _Requirements: 5.1_

- [x] 7. 实现 Lifecycle 状态机属性测试
  - Property 5：状态转换合法性 — 仅 RUNTIME_LIFECYCLE_TRANSITIONS 内的转换被接受
  - Property 6：与 AssetLifecycle 独立性 — 类型系统层面通过 nominal type 隔离
  - 单元测试覆盖每条合法路径和典型非法路径
  - _Requirements: 5.1, 5.6_

- [x] 8. 实现 Governance Issue Detector
  - 创建 `ui/src/ui/capability/runtime-canonical/governance-detector.ts`
  - 实现 `detectGovernanceIssues(agents, bindings, config?, now?)` 主检测器
  - 实现 `detectZombieBindings`：BindingState=active 且 calls7d=0 且超过阈值天数
  - 实现 `detectOrphanedAgents`：Agent 无 binding 且无活跃会话超过阈值
  - 实现 `detectVersionDrift`：同 capabilityId 在不同 Agent 上版本不一致
  - 实现 `detectFallbackChainBroken`：fallbackBindingId 指向的 binding 也是 unhealthy
  - 实现 `detectResourceOvercommit`：Agent 总 quota 超过可用资源
  - 实现 `detectCapabilityConflict`：同 Agent 上能力 taxonomy 重叠
  - 检测器为纯函数，确定性输出
  - _Requirements: 6.2, 6.3_

- [x] 9. 实现 Governance Detector 属性测试
  - Property 7：确定性 — 同输入返回相同 issue 集合
  - Property 8：Zombie 检测正确性 — 满足条件的 binding 必生成 issue
  - 每个检测器的边界条件单元测试
  - _Requirements: 6_

- [x] 10. 新增 Gateway RPC 端点定义
  - 创建 `ui/src/ui/capability/agent-runtime/endpoints.ts`
  - 定义 `AGENT_RUNTIME_ENDPOINTS` 常量（list/get/create/update/delete agents、bindings、telemetry、lifecycle、governance）
  - 创建 Gateway Client 封装：`createAgentRuntimeGateway(client)`
  - _Requirements: 5.6_（注：endpoints 列表见 design.md）

- [x] 11. 扩展 PlatformPortReadModel
  - 修改 `ui/src/ui/ports/platform/semantic/platform-read-model.ts`
  - 新增可选字段：`runtimeAgents?`、`runtimeBindings?`、`runtimeTelemetry?`、`runtimeGovernanceIssues?`、`runtimeKpi?`
  - 保持向后兼容（字段全部 optional）
  - _Requirements: 1.1, 1.2_

- [x] 12. 重构 Agents Page 标签页结构
  - 重写 `ui/src/ui/ports/platform/agents/page.ts`
  - 移除旧标签页：fleet/health/lifecycle/governance（与新结构语义不同）
  - 新增 5 标签页：catalog/bindings/health/lifecycle/governance
  - 标签页标题使用 Runtime 术语：Runtime Catalog、Capability Bindings、Runtime Health、Deployment Lifecycle、Governance & Policy
  - Hash prefix 改为 `#agent-runtime:`
  - _Requirements: 9.4, 9.5_

- [x] 13. 实现 Runtime Catalog 标签页
  - 创建 `agents/sections/RuntimeCatalogSection.ts`
  - 渲染 Agent Runtime 表格：名称、Runtime Version、Lifecycle、Health、绑定能力数、租户覆盖、活跃会话、资源使用、最近活跃
  - 使用 RuntimeLifecycle 和 RuntimeHealth 原始枚举（不投影）
  - 支持按 lifecycle、health、租户筛选
  - 支持名称关键词搜索
  - 点击行展开详情面板
  - _Requirements: 2.1, 2.2, 2.4, 2.5, 2.6_

- [x] 14. 实现 Runtime KPI 卡片
  - 创建 `agents/components/RuntimeKpiCards.ts`
  - 5 个 KPI：Agent 总数（按 lifecycle 分组）、总绑定数（含均值）、Runtime 健康率、租户覆盖、活跃会话
  - 不展示业务指标（如"覆盖部门""企业价值"）
  - _Requirements: 2.3, 4.8_

- [x] 15. 实现 Capability Bindings 标签页
  - 创建 `agents/sections/CapabilityBindingsSection.ts`
  - 渲染 Binding 表格：Agent 名称、Capability 名称、Version、BindingType、RoutingPriority、LoadStrategy、BindingState、Health、7日调用、成功率、延迟
  - 支持按 Agent、Capability、BindingType、BindingState、Health 筛选
  - 顶部统计：总数、按 BindingState 分布、按 BindingType 分布
  - 降级指示器：unhealthy 且有 fallbackBindingId 时展示
  - _Requirements: 3.1, 3.2, 3.6, 3.8_

- [x] 16. 实现 Binding 操作（State/Priority/Strategy 修改）
  - Binding 行操作：修改 BindingState（active ↔ disabled）
  - 修改 RoutingPriority（数值输入）
  - 修改 LoadStrategy（下拉选择）
  - 操作触发对应的 Gateway RPC
  - 修改后立即更新 UI 并记录操作日志
  - _Requirements: 3.3, 3.4, 3.5_

- [x] 17. 实现 Binding 详情视图
  - 点击 Binding 行展开详情
  - 展示完整字段：bindingId、policy（sandbox/resourceQuota/hotReloadable）、invocationMetrics 详情、fallbackBindingId
  - 提供"前往能力中心查看定义"跳转链接
  - _Requirements: 3.7, 8.3_

- [x] 18. 企业端"安装到机器人"反向集成
  - 在企业端 `enterprise-capability.install-to-robots` 处理器中调用平台端 Binding 创建
  - 自动设置 bindingType=tenant-installed、loadStrategy=lazy、bindingState=active
  - 创建后通过 Projection 回流到企业端 InstallRelation
  - _Requirements: 3.9, 10.2_

- [x] 19. 实现 Runtime Health 标签页
  - 创建 `agents/sections/RuntimeHealthSection.ts`
  - 按严重程度分组：unavailable/unhealthy/degraded/healthy
  - 每个非 healthy 项展示：问题类型、影响范围、持续时间、遥测证据
  - 支持时间范围切换（1h/6h/24h/7d/30d）
  - 不展示业务指标（如"覆盖部门""企业价值"）
  - _Requirements: 4.1, 4.2, 4.5, 4.6, 4.8_

- [x] 20. 实现 Health 趋势图组件
  - 创建 `agents/components/TelemetryMiniChart.ts`
  - 渲染延迟（avg/p95/p99）、吞吐量、错误率、Token 消耗的迷你趋势图
  - 不展示原始错误堆栈或 PII
  - _Requirements: 4.5, 4.6_

- [x] 21. 实现 Health 事件告警机制
  - Runtime Health 状态变更时记录 health event
  - 集成系统设置中的告警通道配置
  - _Requirements: 4.7_

### Phase 2：Lifecycle + Governance + Projection 事件传播

- [x] 22. 实现 Deployment Lifecycle 标签页
  - 创建 `agents/sections/DeploymentLifecycleSection.ts`
  - 按 lifecycle 状态分组展示 Agent
  - 提供状态转换操作按钮（仅展示合法的下一步状态）
  - 转换前展示影响评估：受影响 binding 数、活跃会话数、租户数
  - 状态变更记录审计日志
  - _Requirements: 5.2, 5.3, 5.7_

- [x] 23. 实现 Lifecycle 转换的 Projection 触发
  - deployed → deprecated 时通过 Projection 触发企业端"即将下线"提示和员工端"即将下线"提示
  - deprecated → archived 时自动 disable 该 Agent 上所有 Binding
  - archived 时通过 Projection 触发企业端"已下线"和员工端"已下线"
  - _Requirements: 5.4, 5.5_

- [x] 24. 实现 Governance & Policy 标签页
  - 创建 `agents/sections/GovernancePolicySection.ts`
  - 调用 `detectGovernanceIssues` 获取问题列表
  - 按严重程度分组展示
  - 每条 issue 展示：描述、影响范围、证据数据、建议操作
  - 支持 acknowledge 操作
  - 不展示业务治理问题
  - _Requirements: 6.1, 6.4, 6.5_

- [x] 25. 实现治理策略配置
  - 创建治理策略配置 UI（zombie 阈值、orphan 阈值、overcommit 阈值）
  - 调用 `agent-runtime.update-governance-config` 端点持久化
  - _Requirements: 6.6_

- [x] 26. 实现 Projection 事件总线
  - 设计事件格式：`{ eventType, source, timestamp, payload }`
  - 实现事件订阅/发布机制
  - 关键事件：RuntimeHealth 变更、RuntimeLifecycle 变更、Binding 创建/删除/状态变更
  - 失败事件入重试队列
  - _Requirements: 10.1, 10.3, 10.5_

- [x] 27. 实现企业端反向触发的平台响应
  - 企业端"卸载能力" → 平台 disable 对应 Binding
  - 企业端"标记为已不适合继续推广" → 平台 disable Binding
  - 验证企业端和员工端不能直接修改 Runtime 字段（仅通过定义好的接口）
  - _Requirements: 10.2, 10.4_

- [x] 28. 实现 Capability Center 联动
  - Capability Center 标记 capability 为 retired 时，自动 disable 所有引用该 capability 的 Binding
  - 提供从 Agent Runtime Center 到 Capability Center 的双向跳转链接
  - _Requirements: 8.3, 8.4, 8.6_

- [x] 29. 实现术语扫描守卫（构建期 + 运行期）
  - 构建期脚本：扫描 `agents/` 目录的 i18n 资源和模板字符串
  - 黑名单：企业价值、贡献绩效、部门覆盖、复用价值、机器人、我的能力等
  - 运行期属性测试：DOM 渲染输出不含黑名单术语
  - _Requirements: 9.1, 9.2_

- [x] 30. 端到端集成测试
  - 测试 1：企业端"安装到机器人" → 平台创建 Binding → 企业端 InstallRelation 更新
  - 测试 2：RuntimeHealth degraded → 企业端"偶尔结果不理想" + 员工端"偶尔异常"
  - 测试 3：RuntimeLifecycle deprecated → 企业端和员工端"即将下线"提示
  - 测试 4：Capability retired → 所有 Binding disabled → Projection 同步到下游
  - _Requirements: 7, 10_

### Phase 3：Runtime Intelligence（架构钩子已交付，算法待 Phase 3 落地）

- [x] 31. 动态能力编排（基于 RoutingPriority + LoadStrategy）
- [x] 32. 热更新支持（基于 HotReloadable 标记）
- [x] 33. Canary 发布（基于 BindingType=dynamic-runtime）
- [x] 34. Agent Mesh 协同（多 Agent 间能力共享和路由）

---

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2", "4", "6", "8"] },
    { "id": 2, "tasks": ["3", "5", "7", "9"] },
    { "id": 3, "tasks": ["10"] },
    { "id": 4, "tasks": ["11"] },
    { "id": 5, "tasks": ["12"] },
    { "id": 6, "tasks": ["13", "15", "18", "19"] },
    { "id": 7, "tasks": ["14", "16", "20"] },
    { "id": 8, "tasks": ["17", "21"] },
    { "id": 9, "tasks": ["22", "24", "26"] },
    { "id": 10, "tasks": ["23", "25", "27"] },
    { "id": 11, "tasks": ["28"] },
    { "id": 12, "tasks": ["29", "30"] },
    { "id": 13, "tasks": ["31", "32", "33", "34"] }
  ]
}
```

### 执行顺序与依赖（说明）

```
建模阶段（必须先完成）:
1 → 2 → 3 (Projection 是核心，必须最先确立)
4 → 5 (Health Calculator)
6 → 7 (Lifecycle State Machine)
8 → 9 (Governance Detector)

Gateway 与数据层:
10 → 11 (扩展 readModel)

UI 重构（Phase 1 主体）:
12 → 13 → 14 (Runtime Catalog)
12 → 15 → 16 → 17 (Capability Bindings)
18 (企业端反向集成)
12 → 19 → 20 → 21 (Runtime Health)

Phase 2:
22 → 23 (Lifecycle)
24 → 25 (Governance)
26 → 27 → 28 (Projection 事件传播)
29 (术语守卫)
30 (集成测试)

Phase 3 延后
```

## Notes

### 验收门槛

每个任务完成时必须满足：

- 类型检查通过：`pnpm tsgo`
- 构建通过：`pnpm build`
- 相关属性测试通过（特别是 Projection 属性测试）
- 不引入新的术语黑名单违规
- 不修改员工端和企业端的现有行为（除明确标注的反向集成任务）
