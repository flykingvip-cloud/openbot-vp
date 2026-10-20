# Implementation Plan: 能力使用管理（Enterprise Capability Usage Management）

## Overview

本实施计划基于 requirements.md（14 个需求 + 10 条 Correctness Properties）与 design.md
（Runtime_Projection_Layer 架构、文件布局、RPC 契约、迁移矩阵、测试策略）展开。

**技术栈锁定（不引入新栈）**：React + TypeScript + Tailwind CSS + lit-html + `GatewayBrowserClient`，
与 `enterprise-capability-asset-library` 完全一致；不使用 NestJS / Ant Design / PostgreSQL / Recharts。

**实施阶段（与 requirements.md 第 1–4 阶段对应）**：

- **基础层（与所有阶段并行/前置）**：Runtime_Projection_Layer、术语黑名单、业务类型、Gateway Client 扩展、构建期 lint 脚本
- **Phase 1**：路由替换 + 权限迁移 + 机器人能力视图 + 旧「企业代理」清理（renderEnterpriseAgentsSupplyConsole、三个子页面、fixture 替换）
- **Phase 2**：能力安装管理双视角（接管 `enterprise-capability-asset-library` 的「能力安装管理」入口）
- **Phase 3**：使用效果分析（KPI / 趋势 / Top 排行）
- **Phase 4**：使用治理（低效 / 僵尸 / 冲突 + 阈值面板 + 操作对话框）
- **集成与守护**：4 个子页接入 `usage-management-page.ts` 总外框；DOM 端到端术语扫描 + VRT；CI gate 串接

**Property 测试范围**严格遵循 design.md：术语黑名单守卫（Property 1）、投影完备性（Property 2）、字段纯净性（Property 3）、安装数不变量（Property 4）、双视角一致性（Property 5）、治理检测器幂等与边界（Property 6）、路由重定向幂等（Property 7）、格式化（Property 8）、权限迁移兼容（Property 9）、默认子页落点（Property 10）。展示文案、空状态、徽章颜色等使用单元 / 快照测试。

## Tasks

- [x] 1. 基础层：业务类型、Runtime_Projection_Layer、术语黑名单
  - [x] 1.1 定义本模块业务类型与运行时字段黑名单类型守卫
    - 新建 `ui/src/ui/capability/runtime-projection/types.ts`
    - 定义 `HealthStatus`（4 文本枚举：效果稳定 / 偶尔不理想 / 建议优化 / 已停用）与渲染期降级值 `"暂无数据"`
    - 定义 `Robot`、`InstallRelationEnhanced`、`RobotCapabilityUsageView`、`RobotDetail`、`GovernanceIssue`、`GovernanceConfig`、`DEFAULT_GOVERNANCE_CONFIG`
    - 用 `Pick<>`/`Omit<>` 显式构造，禁止出现 `runtimeAgentId`、`runtimeVersion`、`bindingId`、`bindingType`、`bindingState`、`loadStrategy`、`routingPriority`、`fallbackBindingId`、`policy`、`hotReloadable`、`cpu`、`memory`、`nodeId`、`presence`、`templateId`、`provider`、`modelRouting`、`workflowJson`、`toolchain`、`qps`、`tps`、`latency`、`p95`、`p99` 等运行时字段
    - 导出 `as const` 数组 `HEALTH_STATUSES`
    - _Requirements: 4.4, 5.10, 8.5, 9.1, 9.7_

  - [x] 1.2 实现术语黑名单（Term_Blacklist）模块
    - 新建 `ui/src/ui/capability/runtime-projection/term-blacklist.ts`
    - 导出常量 `TERM_BLACKLIST`（runtime / agent / template / cpu / memory / node / presence / qps / tps / latency / p95 / p99 / provider / model routing / workflow json / toolchain），`as const`
    - 实现 `scanText(text: string): string | null`、`scanNode(root: Node): string | null`、`assertNoBlacklistedTerm(text, opts: { mode: "throw" | "downgrade" }): string`
    - 命中时：`"throw"` 抛错；`"downgrade"` 返回 `"暂无数据"` 并 warn 日志
    - _Requirements: 8.1, 8.6_

  - [x] 1.3 实现 Runtime_Projection_Layer 投影函数
    - 新建 `ui/src/ui/capability/runtime-projection/projection.ts`
    - 实现 `projectRuntimeHealthToEnterprise(raw): HealthStatus | "暂无数据"`（4 已知值映射 + 未知/null/undefined 降级）
    - 实现 `projectRuntimeAgentToRobot(agent: RuntimeAgent): Robot`（仅业务字段）
    - 实现 `projectBindingToInstallRelation(binding, ctx): InstallRelationEnhanced`（来源 / 状态映射；剥离运行时字段）
    - 实现 `projectTelemetryToBusinessMetrics(telemetry): { monthlyExecutions; successRate }`
    - 实现 `buildRobotCapabilityUsageView(input): RobotCapabilityUsageView`（聚合 agent + bindings + telemetry + capability 名称 + employeeCoverage）
    - 实现 `assertViewIsBusinessClean(view)`（生产构建最后一道扫描）
    - 用 `Pick<>` / 显式字段构造对象，**禁止 `...spread`** 透传未知字段
    - _Requirements: 8.1, 8.2, 9.1, 10.5_

  - [x] 1.4 实现业务格式化工具
    - 新建 `ui/src/ui/capability/runtime-projection/format.ts`
    - 实现 `formatSuccessRate(v: number): string`（[0,1] → `^\d{1,3}\.\d%$`；越界返回 `"暂无数据"`）
    - 实现 `formatExecutions(v: number): string`（ℕ → `^[\d,]+$`；越界返回 `"暂无数据"`）
    - 实现 `formatHealthStatus(s)`、`formatLastActiveAt(ts)` 等业务降级展示
    - _Requirements: 8.3, 8.4_

  - [x] 1.5 实现治理检测器（governance-detector）
    - 新建 `ui/src/ui/capability/runtime-projection/governance-detector.ts`
    - 实现 `detectGovernanceIssues(relations, capabilities, config = DEFAULT_GOVERNANCE_CONFIG, now): GovernanceIssue[]`
    - **低效**：`executions30d > minExecutions && successRate < maxSuccessRate`（严格）
    - **僵尸**：`executions30d === 0 && installDays > minInstallDays`（严格）
    - **冲突**：同 `robotId` 下 `domain` 相同 + 描述余弦相似度 `>= minSimilarity`
    - `issueId` 由 `(type + capabilityId + robotId)` 派生（确定性）
    - 输出前对 `description` 调 `assertNoBlacklistedTerm(..., { mode: "downgrade" })`
    - _Requirements: 7.3, 7.4, 7.5, 7.6_

  - [x] 1.6 创建 runtime-projection 模块索引
    - 新建 `ui/src/ui/capability/runtime-projection/index.ts`
    - 重导出 `types.ts` / `projection.ts` / `format.ts` / `governance-detector.ts` / `term-blacklist.ts` 公开 API
    - _Requirements: 8.2_

- [x] 2. 投影层属性测试（Property 1 文本子集 / Property 2 / Property 3 / Property 6 / Property 8）
  - [x] 2.1 编写投影正确性属性测试
    - 新建 `ui/src/ui/capability/runtime-projection/__tests__/projection.property.test.ts`
    - **Property 2: Runtime_Projection_Layer 健康状态映射完备性**
    - **Property 3: Runtime_Projection_Layer 字段纯净性**
    - **Property 8: 成功率与调用量格式化**
    - 用 `fast-check` 生成 `RuntimeAgent` / `RuntimeCapabilityBinding` / `RuntimeTelemetry`（含/不含运行时字段、嵌套）
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5, 9.1, 10.5**

  - [x]\* 2.2 编写治理检测器属性测试
    - 新建 `ui/src/ui/capability/runtime-projection/__tests__/governance-detector.property.test.ts`
    - **Property 6: 治理检测器幂等性与边界**
    - 验证：相同输入连续两次 `detectGovernanceIssues()` 结果集合相等（含 `issueId` 稳定）
    - 验证：阈值边界（`executions30d === 50 && successRate === 0.70`）样本不上榜；严格越界样本上榜
    - **Validates: Requirements 7.3, 7.4, 7.5, 7.6**

  - [x]\* 2.3 编写术语黑名单文本扫描属性测试
    - 新建 `ui/src/ui/capability/runtime-projection/__tests__/term-blacklist.node.test.ts`
    - **Property 1（文本子集）: 术语黑名单守卫**
    - 验证：任意 `RuntimeAgent` / 含运行时字段的 telemetry 经投影后输出对象中所有字符串字段经 `scanText` 不命中
    - 验证：恶意 payload（runtime 字段值嵌入业务相关 string）经投影 → 渲染前的字段不含黑名单 token
    - **Validates: Requirements 8.1, 8.6**

- [x] 3. 构建期术语扫描脚本与 CI Gate
  - [x] 3.1 新建 enterprise-usage-terminology-lint 脚本
    - 新建 `scripts/enterprise-usage-terminology-lint.ts`
    - 扫描 `ui/src/ui/views/enterprise-capability-usage-management/**/*.{ts,tsx}` 的字符串字面量
    - 扫描 `ui/src/i18n/locales/*.ts` 中以 `enterpriseUsage.*` / `enterprise-usage-*` / `tabs.enterpriseUsageManagement` / `subtitles.enterpriseUsageManagement` / `nav.items.enterpriseUsageManagement` 开头的 key 的值
    - 命中黑名单 → `process.exit(1)`
    - 与 `scripts/employee-capability-terminology-lint.ts` 复用相同 CLI 接口与退出码
    - _Requirements: 8.7_

  - [x] 3.2 接入 CI Gate
    - 在 `.github/workflows/ci.yml` 或对应 ui 子工作流中，于 `pnpm check` 之后串行执行 `bun scripts/enterprise-usage-terminology-lint.ts`
    - 失败即阻断合入（与 employee 同款）
    - _Requirements: 8.7_

- [x] 4. Gateway Client 扩展与 RPC 契约
  - [x] 4.1 扩展 enterprise-capability 类型定义
    - 修改 `ui/src/ui/capability/enterprise-capability/types.ts`
    - 追加 `InstallRelationEnhanced`（向后兼容 `InstallRelation`：新增 `businessSource`、`usageStats`、新 `status` 三态）
    - 追加 `RobotCapabilityUsageView`、`RobotDetail`、`GovernanceIssue`、`GovernanceConfig`、`HealthStatus` 重导出
    - _Requirements: 4.4, 5.5, 9.1_

  - [x] 4.2 扩展 endpoints.ts 添加 `enterprise-usage.*` 端点常量
    - 修改 `ui/src/ui/capability/enterprise-capability/endpoints.ts`
    - 追加 `ENTERPRISE_USAGE_ENDPOINTS`：`listRobotCapabilityViews` / `getRobotDetail` / `getAnalytics` / `detectGovernance` / `acknowledgeGovernance` / `updateGovernanceConfig`
    - 为每个端点定义 Request / Response 类型对（见 design.md §9.2）
    - 复用既有 `enterprise-capability.list` / `.detail` / `.install-management` / `.uninstall` / `.domain-distribution`，不修改契约
    - _Requirements: 5.8, 6.1, 7.7, 9.3_

  - [x] 4.3 创建 EnterpriseUsageGateway 客户端
    - 修改 `ui/src/ui/capability/enterprise-capability/gateway-client.ts`
    - 在原 `createEnterpriseCapabilityGateway()` 之外追加 `createEnterpriseUsageGateway(client: GatewayBrowserClient)`
    - 实现 6 个方法（与 4.2 端点一一对应）
    - 导出 `EnterpriseUsageGateway` 类型
    - _Requirements: 11.1_

  - [x] 4.4 扩展 install-management RPC 响应字段（向后兼容）
    - 修改 `ui/src/ui/capability/enterprise-capability/types.ts` 与 `gateway-client.ts` 中 `install-management` 响应解析逻辑
    - 追加可选字段 `businessSource`、`usageStats`、新 `status` 三态；保留旧 `source` / 旧 `status` 字段兼容
    - 在 mock-backend 中提供新字段的样例数据
    - _Requirements: 5.5, 5.6, 10.3_

- [x] 5. Phase 1：路由、导航、权限、i18n 迁移
  - [x] 5.1 navigation.ts 添加 enterpriseUsageManagement tab 与子路由
    - 修改 `ui/src/ui/navigation.ts`
    - 在 `ENTERPRISE_SURFACE_TABS` 中以 `enterpriseUsageManagement` 替换 `enterpriseAgents` 的位置
    - 在 `Tab` 联合类型中保留 `enterpriseAgents` 并标 `@deprecated`，新增 `enterpriseUsageManagement`
    - `buildEnterpriseTabPath` 添加 `enterpriseUsageManagement` 分支（默认 `/usage-management/robots`）
    - 定义 `USAGE_MANAGEMENT_SUB_ROUTES = ["robots", "installs", "analytics", "governance"]` 与 `appendContextToTabPath` 支持
    - _Requirements: 1.1, 1.2_

  - [x] 5.2 实现 normalizeLegacyTab 兼容垫片与 LEGACY_AGENTS_REDIRECTS
    - 修改 `ui/src/ui/navigation.ts`
    - 导出 `normalizeLegacyTab(tab: Tab): Tab`：`enterpriseAgents` → `enterpriseUsageManagement`
    - 定义 `LEGACY_AGENTS_REDIRECTS` 数组（`/agents/templates` → `/usage-management/installs`；`/agents` 与子路径 → `/usage-management/robots`；`/enterprise/agents` → `/enterprise/usage-management`）
    - _Requirements: 1.5, 1.7, 13.4_

  - [x] 5.3 实现 route-redirect.ts 解析器
    - 新建 `ui/src/ui/controllers/enterprise-capability-usage-management/route-redirect.ts`
    - 实现 `resolveLegacyAgentsUrl(url: string): string`（应用 `LEGACY_AGENTS_REDIRECTS`，最多一跳，幂等）
    - 实现 `resolveLegacyInstallManagementUrl(url: string): string`（`/enterprise/{tenantId}/capabilities/install-management` → `/enterprise/{tenantId}/usage-management/installs`）
    - 解析后路径再次喂入解析器返回相同结果
    - _Requirements: 1.5, 3.5_

  - [x] 5.4 实现默认子页落点解析
    - 修改 `ui/src/ui/controllers/enterprise-capability-usage-management/route-redirect.ts`
    - 实现 `resolveUsageManagementSubRoute(url: string): string`：`/usage-management`（无子路径）→ `/usage-management/robots`；明确子路径原样返回
    - _Requirements: 1.3_

  - [x] 5.5 权限迁移：catalog、角色映射、兼容映射
    - 修改 `ui/src/ui/ports/enterprise/views/enterprise-surfaces.ts`
    - `ACCESS_PERMISSION_CATALOG`：移除 `agent:view` / `agent:create`；新增 `usage:view`、`usage:install-manage`、`usage:governance`
    - `ACCESS_ROLE_PERMISSIONS`：viewer → `usage:view`；operator → `usage:view + usage:install-manage`；admin 全权限
    - 新建 `ui/src/ui/controllers/enterprise-capability-usage-management/permissions.ts`
    - 实现 `LEGACY_PERMISSION_EQUIVALENCE` 映射（`agent:view` → `usage:view`；`agent:create` → `usage:install-manage`）
    - 实现 `canAccessUsageManagement(user)`、`canManageInstall(user)`、`canHandleGovernance(user)`
    - _Requirements: 2.1, 2.2, 2.3, 2.7, 2.8_

  - [x] 5.6 i18n key 迁移（中英对照）
    - 修改 `ui/src/i18n/locales/zh-CN.ts` 与 `ui/src/i18n/locales/en.ts`（或对应 locale 文件）
    - 新增 `tabs.enterpriseUsageManagement`、`subtitles.enterpriseUsageManagement`、`nav.items.enterpriseUsageManagement`
    - 新增 4 个子页文案：`enterpriseUsage.robots / installs / analytics / governance`
    - 新增空状态、卸载对话框、阈值面板等文案 key
    - 兼容窗口期内保留 `tabs.enterpriseAgents` / `subtitles.enterpriseAgents` / `nav.items.enterpriseAgents`，标注 deprecated 注释
    - _Requirements: 1.4, 1.8, 13.5_

- [x] 6. 路由 / 权限 / 默认子页属性测试（Property 7 / 9 / 10）
  - [x]\* 6.1 路由重定向幂等属性测试
    - 新建 `ui/src/ui/controllers/enterprise-capability-usage-management/__tests__/route-redirect.property.test.ts`
    - **Property 7: 路由重定向幂等**
    - 用 fast-check 生成 `(tenantId, suffix ∈ {"", "/", "/my-agents", "/team-agents", "/templates", "/foo/bar"})`
    - 验证：`resolve(legacy)` 落在 `/usage-management/*`；`resolve(resolve(legacy)) === resolve(legacy)`
    - 同样验证 `/enterprise/{tenantId}/capabilities/install-management` 重定向幂等
    - **Validates: Requirements 1.5, 3.5**

  - [x]\* 6.2 权限迁移兼容性属性测试
    - 新建 `ui/src/ui/controllers/enterprise-capability-usage-management/__tests__/permissions.property.test.ts`
    - **Property 9: 权限迁移兼容性**
    - 用 fast-check 生成权限子集（含 `agent:view` / `agent:create` / `usage:view` / `usage:install-manage` / `usage:governance` / 噪声项）
    - 验证：仅持 `agent:view` 时 `canAccessUsageManagement` === true；仅持 `agent:create` 时 `canManageInstall` === true
    - **Validates: Requirements 2.7, 2.8**

  - [x]\* 6.3 默认子页落点属性测试
    - 新建 `ui/src/ui/controllers/enterprise-capability-usage-management/__tests__/default-subroute.property.test.ts`
    - **Property 10: 默认子页落点**
    - 用 fast-check 生成 `(tenantId, suffix ∈ {"", "/", "/robots", "/installs", "/analytics", "/governance"})`
    - 验证：空子路径 → `/robots`；明确子路径 → 原样返回
    - **Validates: Requirements 1.2, 1.3**

- [x] 7. Phase 1：机器人能力视图（Robot_Capability_View）
  - [x] 7.1 实现 robot-capability-view controller
    - 新建 `ui/src/ui/controllers/enterprise-capability-usage-management/robot-capability-view.ts`
    - 实现 `RobotCapabilityViewState`、`createRobotCapabilityViewController(gateway)`
    - 方法：`load()`、`updateFilter()`、`changeSort()`、`changePage()`、`changePageSize()`、`openDetail(robotId)`、`closeDetail()`
    - 200 ms 后展示骨架；10 s 超时展示重试
    - _Requirements: 4.1, 4.2, 4.3, 4.5, 4.6, 4.9, 4.10, 12.3, 12.4_

  - [x] 7.2 实现共享 UI 组件（薄包装）
    - 新建 `ui/src/ui/views/enterprise-capability-usage-management/shared/kpi-card.ts`（包装 `value-summary-card.ts` 风格）
    - 新建 `ui/src/ui/views/enterprise-capability-usage-management/shared/empty-state.ts`（业务语言空状态）
    - 新建 `ui/src/ui/views/enterprise-capability-usage-management/shared/filter-bar.ts`（包装 `asset-filter-bar.ts`）
    - 新建 `ui/src/ui/views/enterprise-capability-usage-management/shared/format.ts`（重导出 `runtime-projection/format.ts` 业务格式化）
    - 新建 `ui/src/ui/views/enterprise-capability-usage-management/shared/styles.css.ts`（仅本模块 Tailwind class 组合）
    - _Requirements: 11.2, 11.4, 11.5_

  - [x] 7.3 实现 robot-capability-table 组件
    - 新建 `ui/src/ui/views/enterprise-capability-usage-management/robot-capability-table.ts`
    - 列：机器人名称 / 已安装能力数 / 本月调用量 / 覆盖员工数 / 成功率 / 健康状态 / Top 3 能力 / 操作
    - 复用 `views/enterprise-asset-library/asset-table.ts` 的 grid + `enterprise-foundation.css` token
    - 复用 `health-badge.ts` 限制只渲染 4 个文本（+ `"暂无数据"` 降级）
    - Top 3 标签溢出折叠为 `+N`
    - _Requirements: 4.4, 4.5, 8.5, 11.4, 11.6, 11.7_

  - [x] 7.4 实现 robot-detail-panel 组件
    - 新建 `ui/src/ui/views/enterprise-capability-usage-management/robot-detail-panel.ts`
    - 三分区：基础信息 / 能力列表 / 使用统计（30 天迷你折线图复用 `mini-trend-chart.ts`）
    - 基础信息严禁展示 runtime version、CPU、内存、节点 ID、Agent ID、template ID、provider、model routing 等任何字段
    - _Requirements: 4.7, 4.8_

  - [x] 7.5 实现 robot-capability-view-page 子页外框
    - 新建 `ui/src/ui/views/enterprise-capability-usage-management/robot-capability-view-page.ts`
    - 编排：Page Header → 4 KPI 卡片 → 筛选栏 → robot-capability-table → Pagination（复用 `views/enterprise-asset-library/pagination.ts`）→ robot-detail-panel
    - 默认按本月调用量降序；点列头切排序
    - _Requirements: 4.1, 4.2, 4.3, 4.5, 4.6_

  - [x]\* 7.6 robot-capability-view 单元测试
    - 新建 `ui/src/ui/controllers/enterprise-capability-usage-management/__tests__/robot-capability-view.test.ts`
    - 覆盖 loading / error / 筛选 / 排序 / 分页 / 详情面板开关
    - _Requirements: 4.5, 4.6, 4.9, 4.10, 12.3, 12.4_

  - [x]\* 7.7 robot-capability-table / robot-detail-panel 组件单元测试
    - 新建 `ui/src/ui/views/enterprise-capability-usage-management/__tests__/robot-capability-table.test.ts` 与 `robot-detail-panel.test.ts`
    - 覆盖：Top 3 折叠、健康徽章 4 文本、降级"暂无数据"、详情面板分区渲染
    - _Requirements: 4.4, 4.7, 4.8, 8.5_

- [x] 8. Phase 1：旧「企业代理」清理（render-actions / render-model / view-types / surface / shell / fixtures / pathForTab 调用点）
  - [x] 8.1 移除 enterpriseAgents 在 render-actions / render-model / view-types 中的字段
    - 修改 `ui/src/ui/ports/enterprise/render-actions.ts`：移除 `enterpriseAgents` 块；新增 `usageManagement` 块（含 `onRefresh` / `onUninstall` / `onAcknowledge` / `onUpdateGovernanceConfig`）
    - 修改 `ui/src/ui/ports/enterprise/render-model.ts`：替换 `enterpriseAgents` 字段为 `usageManagement`
    - 修改 `ui/src/ui/ports/enterprise/view-types.ts`：替换 `surfaceActions` 类型中的 `enterpriseAgents` 为 `usageManagement`
    - _Requirements: 1.6, 13.1, 13.3_

  - [x] 8.2 删除 renderEnterpriseAgentsSupplyConsole 与三个旧子页面，新增 renderUsageManagementSurface
    - 修改 `ui/src/ui/ports/enterprise/views/enterprise-surfaces.ts`
    - 删除 `renderEnterpriseAgentsSupplyConsole` 函数及其引用
    - 删除「我的代理 / 团队代理 / 分配模板」三个子页面渲染逻辑
    - 新增 `renderUsageManagementSurface`（按子路由分发到 4 个子页 view）
    - _Requirements: 1.6, 13.1_

  - [x] 8.3 enterprise-shell.ts 替换子标题分支
    - 修改 `ui/src/ui/ports/enterprise/views/enterprise-shell.ts`
    - 删除 `enterpriseAgents` 子标题分支
    - 新增 `enterpriseUsageManagement` 分支（4 组子页对应的页头 / 副标题）
    - _Requirements: 13.1_

  - [x] 8.4 替换全部 pathForTab("enterpriseAgents", ...) 调用点
    - 修改 `ui/src/ui/ports/platform/view-models/builders.ts` 与其它命中文件
    - 全部替换为 `pathForTab("enterpriseUsageManagement", basePath, { tenantId })`，子路径默认指向 `/usage-management/robots`
    - 用 grep 验证：仓库内不再存在 `pathForTab("enterpriseAgents", ...)` 调用（兼容窗口期保留 `enterpriseAgents` 类型定义本身不视为调用）
    - _Requirements: 13.3_

  - [x] 8.5 替换 enterpriseAgents 测试 fixture
    - 修改 `ui/src/ui/ports/enterprise/views/__tests__/enterprise-surfaces.browser.test.ts`、`port-shells.browser.test.ts` 等命中文件
    - 移除 `tab === "enterpriseAgents"` 的用例 / fixture
    - 新增 `tab === "enterpriseUsageManagement"` 等价用例 / fixture
    - 添加一条 `normalizeLegacyTab("enterpriseAgents") === "enterpriseUsageManagement"` 的兼容测试
    - _Requirements: 13.2, 13.4_

  - [x] 8.6 在 surface 渲染分发入口接入 normalizeLegacyTab
    - 修改 `ui/src/ui/ports/enterprise/views/enterprise-surfaces.ts` 的 surface 分发主入口
    - 收到 `tab === "enterpriseAgents"` 入参 → `normalizeLegacyTab(tab)` → 分发至 `enterpriseUsageManagement`
    - _Requirements: 1.7, 13.4_

- [x] 9. Checkpoint —— 确保 Phase 1（路由、权限、机器人能力视图、旧模块清理）测试全部通过；ask the user if questions arise.

- [x] 10. Phase 2：能力安装管理双视角（迁入）
  - [x] 10.1 实现 install-management-dual-view controller
    - 新建 `ui/src/ui/controllers/enterprise-capability-usage-management/install-management-dual-view.ts`
    - 实现 `InstallManagementDualViewState`、`createInstallManagementDualViewController(gateway)`
    - 方法：`load()`、`updateFilter()`、`changeViewMode("byRobot" | "byCapability")`（仅切分组维度，不重新拉数据）、`changePage()`、`requestUninstall(id)`、`confirmUninstall()`、`cancelUninstall()`
    - 实现纯函数 `groupByRobot(items)` 与 `groupByCapability(items)`
    - `viewMode` 通过 URL 查询参数 `?view=robot|capability` 持久化
    - _Requirements: 5.2, 5.5, 5.7, 5.8, 5.9_

  - [x] 10.2 实现 install-relation-row 共享行组件
    - 新建 `ui/src/ui/views/enterprise-capability-usage-management/install-relation-row.ts`
    - 双视角共用：能力名称 / 机器人名称 / 来源（员工沉淀 / 企业发布）/ 本月调用量 / 成功率 / 状态（正常 / 待优化）/ 操作（卸载）
    - 严禁字段：`runtime binding ID` / `binding type` / `load strategy` / `routing priority`（投影时已剥离）
    - _Requirements: 5.3, 5.4, 5.10_

  - [x] 10.3 实现 install-management-dual-view-page 子页
    - 新建 `ui/src/ui/views/enterprise-capability-usage-management/install-management-dual-view-page.ts`
    - 顶部 Tabs（按机器人 / 按能力）+ KPI 区（总安装关系数 / 覆盖机器人数 / 覆盖能力数）+ 筛选栏（共享）+ 分组表格 + 分页
    - 卸载二次确认对话框（含目标机器人名称、能力名称、当前状态、安装来源）
    - 卸载失败保留原关系并展示对话框错误
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.6, 5.7, 5.8, 5.9_

  - [x] 10.4 从 enterprise-capability-asset-library 迁出旧入口
    - 修改 `ui/src/ui/views/enterprise-asset-library/enterprise-capability-center-page.ts`：移除头部"能力安装管理"按钮（或将点击重定向至 `/usage-management/installs`，保留按钮兼容外链 ≥ 1 发布周期）
    - 修改 `ui/src/ui/views/enterprise-asset-library/quick-entry-sidebar.ts`：移除"能力安装管理"快捷入口，仅保留"我的安装能力"和"我贡献的能力"
    - _Requirements: 3.1, 3.3, 3.4, 3.6_

  - [x] 10.5 接入 /capabilities/install-management → /usage-management/installs 路由 301
    - 修改 `ui/src/ui/controllers/enterprise-capability-usage-management/route-redirect.ts`（如未在 5.3 实现则补齐）
    - 在 surface 路由解析层接入 `resolveLegacyInstallManagementUrl`，使旧链接 301 至新路径
    - _Requirements: 3.5_

  - [x]\* 10.6 安装数 / 双视角一致性属性测试
    - 新建 `ui/src/ui/controllers/enterprise-capability-usage-management/__tests__/install-count.property.test.ts`
    - **Property 4: 已安装能力数 = 去重活跃能力关系数**
    - **Validates: Requirements 4.4, 5.5, 5.6**
    - 新建 `ui/src/ui/controllers/enterprise-capability-usage-management/__tests__/dual-view.property.test.ts`
    - **Property 5: 双视角数据一致性**
    - **Validates: Requirements 5.5, 5.7**

  - [x]\* 10.7 install-management-dual-view 单元测试
    - 新建 `ui/src/ui/controllers/enterprise-capability-usage-management/__tests__/install-management-dual-view.test.ts`
    - 覆盖：viewMode 切换不重新拉数据、`?view=` 持久化、卸载流程（成功 / 失败）、筛选共享
    - _Requirements: 5.2, 5.7, 5.8, 5.9_

- [x] 11. Phase 3：使用效果分析（Usage_Analytics）
  - [x] 11.1 实现 usage-analytics controller
    - 新建 `ui/src/ui/controllers/enterprise-capability-usage-management/usage-analytics.ts`
    - 状态：`window: 7 | 30 | 90`、4 项 KPI（含环比）、`trendExecutions`、`trendCapabilityReuse`、`topCapabilities`
    - 方法：`load()`、`changeWindow()`、`navigateToCapability(capabilityId)` → `/enterprise/{tenantId}/capabilities/{capabilityId}`
    - 严禁 KPI / 图表中出现 QPS / p95 latency / error rate / token consumption / CPU / memory
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10_

  - [x] 11.2 实现 usage-analytics-kpi-cards 组件（含环比箭头）
    - 新建 `ui/src/ui/views/enterprise-capability-usage-management/usage-analytics-kpi-cards.ts`
    - 4 个 KPI：本月总调用量 / 覆盖机器人数 / 覆盖员工数 / 平均成功率
    - 正增长：↑ + 绿色；负增长：↓ + 红色；零变化：持平 + 默认色
    - _Requirements: 6.2, 6.3_

  - [x] 11.3 实现 usage-trend-chart 组件
    - 新建 `ui/src/ui/views/enterprise-capability-usage-management/usage-trend-chart.ts`
    - 基于 `views/enterprise-asset-library/mini-trend-chart.ts` 升级（扩展尺寸 / 7 / 30 / 90 天窗口切换 props）
    - 不引入 Recharts 等第三方库
    - _Requirements: 6.4, 6.5_

  - [x] 11.4 实现 top-capabilities-table 组件
    - 新建 `ui/src/ui/views/enterprise-capability-usage-management/top-capabilities-table.ts`
    - 列：能力名称 / 本月调用量 / 成功率 / 覆盖机器人数；最多 Top 20
    - 行点击 → `pathForTab("enterpriseCapabilityCenter", ...)` 拼接 `capabilityId`
    - 复用 `asset-table.ts` 的 grid
    - _Requirements: 6.6, 6.7_

  - [x] 11.5 实现 usage-analytics-page 子页
    - 新建 `ui/src/ui/views/enterprise-capability-usage-management/usage-analytics-page.ts`
    - 编排：Page Header → KPI 卡片 → 30 天调用趋势 → 能力复用增长 → Top 排行
    - 加载骨架 / 重试 / 空数据"暂无使用数据"
    - _Requirements: 6.1, 6.8, 6.10_

  - [x]\* 11.6 usage-analytics 单元测试
    - 新建 `ui/src/ui/controllers/enterprise-capability-usage-management/__tests__/usage-analytics.test.ts`
    - 覆盖：窗口切换、KPI 环比、Top 行跨页跳转、空数据占位
    - _Requirements: 6.4, 6.7, 6.10_

- [x] 12. Phase 4：使用治理（Usage_Governance）
  - [x] 12.1 实现 usage-governance controller
    - 新建 `ui/src/ui/controllers/enterprise-capability-usage-management/usage-governance.ts`
    - 状态：`activeTab ∈ {"低效能力", "未使用能力", "冲突能力"}`、3 类 issue 列表、`config: GovernanceConfig`、`acknowledgedIssues: Set<string>`（仅内存）
    - 方法：`load()`、`changeTab()`、`updateConfig(partial)`、`acknowledge(issueId)`、`executeSuggestion(issue)`（卸载 / 跳详情 / 转移对话框）
    - 阈值更新立即重新计算（调 `detectGovernanceIssues`）
    - 不展示 `runtime overcommit` / `orphaned agent` / `version drift` / `fallback chain broken`
    - _Requirements: 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 7.10_

  - [x] 12.2 实现 governance-tab 三个 tab 组件
    - 新建 `ui/src/ui/views/enterprise-capability-usage-management/governance-tab-low-efficiency.ts`
    - 新建 `ui/src/ui/views/enterprise-capability-usage-management/governance-tab-zombie.ts`
    - 新建 `ui/src/ui/views/enterprise-capability-usage-management/governance-tab-conflict.ts`
    - 各 Tab 标签上展示问题数量徽章
    - 空状态文案"暂无低效能力 / 暂无未使用能力 / 暂无冲突能力"
    - _Requirements: 7.2, 7.3, 7.4, 7.5, 7.10_

  - [x] 12.3 实现 governance-threshold-panel 阈值配置面板
    - 新建 `ui/src/ui/views/enterprise-capability-usage-management/governance-threshold-panel.ts`
    - 4 个阈值输入：低效成功率（默认 0.70）/ 低效调用量（默认 50）/ 僵尸天数（默认 30）/ 冲突相似度（默认 0.80）
    - 调整后立即触发 controller `updateConfig`
    - _Requirements: 7.6_

  - [x] 12.4 实现 governance-action-dialogs（卸载 / 转移 / acknowledge）
    - 新建 `ui/src/ui/views/enterprise-capability-usage-management/governance-action-dialogs.ts`
    - 卸载对话框：调 `enterprise-capability.uninstall`
    - 转移对话框：选择目标机器人
    - acknowledge："暂不处理"按钮 + 仅当前会话生效
    - 失败保留原状态 + 错误提示（不整页崩溃）
    - _Requirements: 7.7, 7.8, 12.6_

  - [x] 12.5 实现 usage-governance-page 子页外框
    - 新建 `ui/src/ui/views/enterprise-capability-usage-management/usage-governance-page.ts`
    - 编排：Page Header → 三个 Tabs（低效 / 未使用 / 冲突，含数量徽章）→ 阈值配置面板 → Tab 内容（problem rows + suggestion 按钮）→ "前往平台代理资产治理中心查看技术详情" 跳转链接
    - _Requirements: 7.1, 7.2, 7.9, 9.6_

  - [x]\* 12.6 usage-governance 单元测试
    - 新建 `ui/src/ui/controllers/enterprise-capability-usage-management/__tests__/usage-governance.test.ts`
    - 覆盖：阈值更新即重算、acknowledge 仅内存、suggestion 操作分发、跨平台跳转链接
    - _Requirements: 7.6, 7.7, 7.8, 7.9_

- [x] 13. 集成与守护：总外框、术语 DOM 端到端、VRT、跨模块跳转
  - [x] 13.1 实现 usage-management-page 总外框
    - 新建 `ui/src/ui/views/enterprise-capability-usage-management/usage-management-page.ts`
    - 顶部 Tabs（4 个子页）+ 子路由分发器（按 `USAGE_MANAGEMENT_SUB_ROUTES` 路由到 4 个子页 view）
    - Gateway 客户端（`createEnterpriseCapabilityGateway` + `createEnterpriseUsageGateway`）注入到 4 个 controller
    - 复用 `GatewayBrowserClient` 的指数退避重连，断连展示离线横幅
    - _Requirements: 1.2, 11.3, 12.7_

  - [x] 13.2 接入 enterprise-shell 与 surface 渲染分发
    - 修改 `ui/src/ui/ports/enterprise/views/enterprise-surfaces.ts` 与 `enterprise-shell.ts`
    - `renderUsageManagementSurface` 接到主分发表
    - 兼容 `tab === "enterpriseAgents"`：经 `normalizeLegacyTab` 归一化后渲染 usageManagement surface
    - _Requirements: 1.7, 13.4_

  - [x]\* 13.3 术语黑名单 DOM 端到端属性测试
    - 新建 `ui/src/ui/views/enterprise-capability-usage-management/__tests__/term-blacklist.property.test.ts`
    - **Property 1（DOM 端到端）: 术语黑名单守卫**
    - 用 fast-check 生成任意 `RuntimeAgent` / `RuntimeCapabilityBinding` / `RuntimeTelemetry`（含运行时字段值刻意嵌入业务 string 字段，含 malformed payload）
    - 注入 4 个子页（robot view / install dual view / analytics / governance）渲染 → `scanNode(root)` 不命中黑名单 → 文本中只有"暂无数据"作为降级
    - **Validates: Requirements 8.1, 8.5, 8.6**

  - [x]\* 13.4 4 子页 VRT
    - 新建 `ui/src/ui/views/enterprise-capability-usage-management/__tests__/visual-regression.browser.test.ts`
    - 复用 `views/enterprise-asset-library/__tests__/visual-regression.browser.test.ts` 的 fixture/断言模式
    - 4 个子页各一份截图基线（robot view / installs / analytics / governance）
    - _Requirements: 11.1, 11.5_

  - [x]\* 13.5 i18n 完整性 + 展示格式化 + 空状态单元测试
    - 新建 `ui/src/ui/views/enterprise-capability-usage-management/__tests__/i18n-keys.test.ts`：4×2 中英对照存在
    - 新建 `ui/src/ui/views/enterprise-capability-usage-management/__tests__/format.test.ts`：`formatSuccessRate` / `formatExecutions` 边界 + 异常输入降级
    - 新建 `ui/src/ui/views/enterprise-capability-usage-management/__tests__/empty-states.test.ts`：4 子页各自空状态文案
    - 新建 `ui/src/ui/views/enterprise-capability-usage-management/__tests__/health-badge.test.ts`：4 文本 + 降级
    - _Requirements: 1.8, 8.3, 8.4, 8.5, 4.10, 5.7, 6.10, 7.10_

  - [x]\* 13.6 跨模块跳转与员工通知集成测试
    - 新建 `ui/src/ui/controllers/enterprise-capability-usage-management/__tests__/integration.test.ts`
    - 覆盖：Top 能力点击 → `/enterprise/{tenantId}/capabilities/{capabilityId}`；卸载完成后员工通知文案"机器人 X 上的能力 Y 已被企业管理员卸载"
    - 注入 `RuntimeAgent` + 含运行时字段的 telemetry → 完整渲染流 → DOM 扫描无黑名单
    - _Requirements: 6.7, 9.6, 14.2, 14.3_

- [x] 14. Final Checkpoint —— 确保所有 PBT、单元测试、VRT、术语 lint、CI gate 通过；ask the user if questions arise.

## Notes

- 标记 `*` 的任务为可选（可跳过以加速 MVP），但 Property 1–10 对应的 PBT 文件强烈建议保留
- 所有 RPC 端点新增使用 `enterprise-usage.*` 前缀；旧 `enterprise-capability.uninstall` / `.install-management` / `.list` / `.detail` / `.domain-distribution` 直接复用
- 兼容窗口期（≥ 1 个发布周期）覆盖：`enterpriseAgents` Tab 类型、`agent:view` / `agent:create` 权限、旧 i18n key、`/enterprise/{tenantId}/capabilities/install-management` 路径、「企业能力中心」头部"能力安装管理"按钮
- 永久保留：`/enterprise/{tenantId}/agents/*` 与 `/enterprise/{tenantId}/capabilities/install-management` 的路由解析层 301 重定向
- 文件路径全部仓库根相对（per AGENTS.md 要求）
- 任何 view 输出渲染前必须经过 `assertNoBlacklistedTerm` 或类型层 `Pick<>` 守卫；`...spread` 透传 runtime 对象禁止使用

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["1.3", "1.4", "1.5"] },
    { "id": 2, "tasks": ["1.6", "2.1", "2.2", "2.3", "3.1", "4.1"] },
    { "id": 3, "tasks": ["3.2", "4.2", "5.6"] },
    { "id": 4, "tasks": ["4.3", "4.4", "5.1"] },
    { "id": 5, "tasks": ["5.2", "5.5"] },
    { "id": 6, "tasks": ["5.3", "5.4", "7.1", "7.2"] },
    { "id": 7, "tasks": ["6.1", "6.2", "6.3", "7.3", "7.4"] },
    { "id": 8, "tasks": ["7.5", "7.6", "7.7", "8.1"] },
    { "id": 9, "tasks": ["8.2", "8.3", "8.4"] },
    { "id": 10, "tasks": ["8.5", "8.6"] },
    { "id": 11, "tasks": ["10.1", "10.2", "10.4"] },
    { "id": 12, "tasks": ["10.3", "10.5", "10.6", "10.7"] },
    { "id": 13, "tasks": ["11.1", "11.2", "11.3", "11.4"] },
    { "id": 14, "tasks": ["11.5", "11.6", "12.1"] },
    { "id": 15, "tasks": ["12.2", "12.3", "12.4"] },
    { "id": 16, "tasks": ["12.5", "12.6"] },
    { "id": 17, "tasks": ["13.1"] },
    { "id": 18, "tasks": ["13.2", "13.3", "13.4", "13.5", "13.6"] }
  ]
}
```
