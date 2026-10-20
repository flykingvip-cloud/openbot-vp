# Implementation Plan: 企业能力中心（Enterprise Capability Center）

## Overview

基于专业建议修订后的实施方案。核心变更：

- UI 名称统一为"企业能力中心"（内部模块名保留 enterprise-capability-asset-library）
- 新增能力领域版图（CapabilityDomain）、能力价值摘要（EnterpriseCapabilityValueSummary）、能力可信度（CredibilityIndicators）
- 成熟度新增"企业标准"等级
- 健康状态措辞业务化（效果稳定/偶尔结果不理想/建议重新整理/已不适合继续推广）
- 页面结构从"后台表格"调整为"能力概览 → 领域分布 → 高价值卡片 → 全部能力表格"
- 强化 EnterpriseCapabilityProjection 投影层为核心架构边界
- Property Test 收敛到生命周期/审核/可见性/投影/状态机/安装约束，UI 展示逻辑改用 unit test

## Tasks

- [x] 1. 基础类型与投影层
  - [x] 1.1 创建企业能力中心核心类型
    - 创建 `ui/src/ui/capability/enterprise-capability/types.ts`
    - 定义 `AssetLifecycle`（submitted/reviewing/approved/published/deprecated/retired）
    - 定义 `CapabilityMaturity`（初步形成/稳定使用/多人复用/企业认证/企业标准/核心资产）— 6 级
    - 定义 `EnterpriseHealthStatus`（效果稳定/偶尔结果不理想/建议重新整理/已不适合继续推广）
    - 定义 `ApplicableScope`（enterprise/department/group/role，含 id + name）
    - 定义 `EnterpriseCapabilityValueSummary`（monthlyExecutions, departmentCoverageCount, reuseGrowthRate30d）
    - 定义 `EnterpriseReuseData`（robotCount, employeeCount, departmentCount, trend30Days, growthPercentage）
    - 定义 `CredibilityIndicators`（verifiedDepartments: string[], productionUsageDays: number）
    - 定义 `CapabilityDomain`（id, name, capabilityCount, capabilities）
    - 定义 `ContributionRecord`、`ReviewRecord`、`SourceInfo`
    - 定义 `EnterpriseCapabilityAsset`（完整详情，含 valueSummary + credibility）
    - 定义 `EnterpriseAssetListItem`（列表投影）
    - 定义 `StatisticsDashboardData`、`InstallRelation`、`ContributionPerformanceItem`
    - 定义 `PaginationState`、`AssetListFilters`、`SidebarEntry`、`AssetSortConfig`
    - 定义 `ReviewQueueItem`、`ReviewAssessment`
    - 使用 `as const` 数组导出所有枚举值

  - [x] 1.2 创建 RPC 端点定义
    - 创建 `ui/src/ui/capability/enterprise-capability/endpoints.ts`
    - 定义 `ENTERPRISE_CAPABILITY_ENDPOINTS` 常量（13 个端点）：list, detail, review, reviewQueue, installToRobots, uninstall, stats, contributionRecords, installManagement, contributionPerformance, certify, updateHealthStatus, domainMap
    - 为每个端点定义 Request/Response 类型对
    - 确保所有 Response 类型中不含 runtime 字段（prompt, workflow json, toolchain, model routing, provider, memory strategy）

  - [x] 1.3 创建 Gateway 客户端
    - 创建 `ui/src/ui/capability/enterprise-capability/gateway-client.ts`
    - 实现 `createEnterpriseCapabilityGateway(client: GatewayBrowserClient)`
    - 遵循 `employee-capability/gateway-client.ts` 的完全相同模式
    - 导出 `EnterpriseCapabilityGateway` 类型

  - [x] 1.4 实现 EnterpriseCapabilityProjection 投影层
    - 创建 `ui/src/ui/capability/enterprise-capability/projection.ts`
    - 实现 `projectToEnterpriseView(raw: unknown): EnterpriseCapabilityAsset` — 核心投影函数
    - 实现 runtime field stripping（强制剔除 prompt/workflow/toolchain/routing/provider/memory/execution policy）
    - 实现业务语言规范化（将内部枚举转为企业语言）
    - 实现 `projectValueSummary()` — 将原始数值转为业务语言（"本月已被调用 1,284 次"）

  - [x] 1.5 创建模块索引与 Mock 后端
    - 创建 `ui/src/ui/capability/enterprise-capability/index.ts`
    - 创建 `ui/src/ui/capability/enterprise-capability/mock-backend.ts`（含示例数据生成器）

- [x] 2. 核心业务逻辑
  - [x] 2.1 实现数据验证逻辑
    - 来源完整性验证（source.employee/robot/task 非空，contributionHistory 非空列表）
    - 来源不可变性保护（禁止修改已有 source 字段和 contribution 条目）
    - 审核意见最小长度验证（拒绝/需修改时 ≥ 10 字符）
    - 重复审核提交检查
    - 认证前置条件守卫（未达"稳定使用"不可标记"企业认证"）

  - [x] 2.2 实现筛选与搜索逻辑
    - 关键词子串匹配（名称 + 说明）
    - 多筛选器 AND 语义
    - "只看我可安装"开关（基于 ApplicableScope 判断）
    - 筛选重置到默认状态

  - [x] 2.3 实现分页逻辑
    - 页面切片计算：`min(S, N - (P-1)*S)` items at index `(P-1)*S`
    - 页码超出自动修正
    - 分页变更时保持筛选状态不变

  - [x] 2.4 实现排序逻辑
    - 默认排序：成熟度降序（核心资产 > 企业标准 > 企业认证 > 多人复用 > 稳定使用 > 初步形成），同级内按复用价值降序
    - 时间戳记录排序（贡献记录/审核历史/安装记录）

  - [x] 2.5 实现成熟度计算引擎
    - 基于阈值的 6 级成熟度计算（使用次数/使用人数/复用率/成功率/企业采用率）
    - 成熟度降级逻辑（指标持续下降时）
    - "企业认证"需管理员主动授予
    - "企业标准"需满足规模化采用条件

  - [x] 2.6 实现健康状态映射
    - 24 小时成功率 → 业务健康状态映射（≥95%→效果稳定, 70-94%→偶尔结果不理想, 50-69%→建议重新整理, <50%→已不适合继续推广）
    - 手动锁定逻辑（管理员调整后不被自动覆盖）
    - 无遥测数据时默认"效果稳定" + "暂无运行数据"标识

  - [x] 2.7 实现能力领域聚合逻辑
    - 按 CapabilityDomain 聚合能力列表
    - 计算每个领域的能力数量
    - 支持领域内能力排序（按成熟度/复用价值）

- [x] 3. Property Tests（核心不变量）
  - [x]\* 3.1 投影正确性属性测试
    - 验证：任何含 runtime 字段的原始数据经投影后，输出中不含 prompt/workflow/toolchain/routing/provider/memory/execution policy
    - 验证：投影输出仅含业务能力视图字段

  - [x]\* 3.2 生命周期与审核约束属性测试
    - 验证：来源不完整时拒绝发布
    - 验证：来源字段不可变（仅允许追加贡献记录）
    - 验证：审核意见 < 10 字符时拒绝
    - 验证：重复审核提交被拒绝
    - 验证：合法状态流转路径（submitted→reviewing→approved→published→deprecated→retired + reviewing→rejected）

  - [x]\* 3.3 可见性与安装约束属性测试
    - 验证：仅 published 且非"已不适合继续推广"的能力可安装
    - 验证：安装目标必须为机器人（非员工/部门/小组）
    - 验证：ApplicableScope 范围内员工可见，范围外不可见

  - [x]\* 3.4 成熟度计算属性测试
    - 验证：计算结果为满足所有阈值条件的最高等级
    - 验证：未达"稳定使用"时拒绝"企业认证"标记
    - 验证：默认排序为成熟度降序 + 同级内复用价值降序

  - [x]\* 3.5 筛选与分页属性测试
    - 验证：多筛选器 AND 语义（结果同时满足所有条件）
    - 验证：重置后状态等于初始默认状态
    - 验证：分页切片正确性
    - 验证：分页变更不影响筛选状态

- [x] 4. Checkpoint — 确保基础层与属性测试全部通过

- [x] 5. Controllers（状态管理）
  - [x] 5.1 实现统计概览 Controller
    - 创建 `ui/src/ui/controllers/enterprise-asset-library/statistics.ts`
    - `loadStatistics()` — 3 秒超时，失败时展示缓存 + 时间戳
    - 处理加载/错误/缓存状态

  - [x] 5.2 实现能力领域分布 Controller
    - 创建 `ui/src/ui/controllers/enterprise-asset-library/domain-map.ts`
    - `loadDomainMap()` — 加载按领域聚合的能力分布
    - 支持展开某领域查看其下能力列表

  - [x] 5.3 实现资产列表 Controller
    - 创建 `ui/src/ui/controllers/enterprise-asset-library/asset-list.ts`
    - `loadAssetList()`、`updateFilter()`、`resetFilters()`、`changePage()`、`changePageSize()`、`changeSidebarEntry()`、`changeSort()`
    - 200ms 延迟后展示骨架屏，10s 超时展示错误

  - [x] 5.4 实现资产详情 Controller
    - 创建 `ui/src/ui/controllers/enterprise-asset-library/asset-detail.ts`
    - 分区加载（基本信息/溯源/复用数据/审核历史/安装记录）
    - 部分加载失败时保留已成功区域

  - [x] 5.5 实现审核队列 Controller
    - 创建 `ui/src/ui/controllers/enterprise-asset-library/review-queue.ts`
    - `loadReviewQueue()`、`submitReview()`（通过/拒绝/需修改）
    - 通过时要求指定 ApplicableScope
    - 拒绝/需修改时强制意见 ≥ 10 字符

  - [x] 5.6 实现安装管理 Controller
    - 创建 `ui/src/ui/controllers/enterprise-asset-library/install-management.ts`
    - `loadInstallRelations()`、`uninstallCapability()`（含确认流程）
    - 按能力名/机器人名/时间/来源筛选

  - [x] 5.7 实现贡献记录 Controller
    - 创建 `ui/src/ui/controllers/enterprise-asset-library/contribution-records.ts`
    - 分页（20条/页）、按员工/时间/审核状态筛选
    - AssetLifecycle → 业务语言标签映射

  - [x] 5.8 实现贡献绩效 Controller
    - 创建 `ui/src/ui/controllers/enterprise-asset-library/contribution-performance.ts`
    - 按员工聚合指标、排行榜（数量/质量）、按部门/时间筛选、CSV 导出

  - [x] 5.9 创建 Controllers 索引
    - 创建 `ui/src/ui/controllers/enterprise-asset-library/index.ts`

- [x] 6. Checkpoint — 确保所有 Controller 测试通过

- [x] 7. 共享 UI 组件
  - [x] 7.1 实现 MaturityIndicator 组件
    - 创建 `ui/src/ui/views/enterprise-capability-center/MaturityIndicator.tsx`
    - 1-6 个圆点（对应 6 级成熟度）+ 文字标签徽章

  - [x] 7.2 实现 HealthBadge 组件
    - 创建 `ui/src/ui/views/enterprise-capability-center/HealthBadge.tsx`
    - 颜色编码（绿/黄/橙/灰）+ 文字标签（效果稳定/偶尔结果不理想/建议重新整理/已不适合继续推广）
    - 无遥测数据时附加"暂无运行数据"

  - [x] 7.3 实现 MiniTrendChart 组件
    - 创建 `ui/src/ui/views/enterprise-capability-center/MiniTrendChart.tsx`
    - 30 天趋势折线 + 增长百分比（绿色正/红色负/默认零）

  - [x] 7.4 实现 ValueSummaryCard 组件
    - 创建 `ui/src/ui/views/enterprise-capability-center/ValueSummaryCard.tsx`
    - 业务语言展示："本月已被调用 N 次" / "已覆盖 N 个部门" / "近 30 天复用增长 +N%"

  - [x] 7.5 实现 CredibilityBadge 组件
    - 创建 `ui/src/ui/views/enterprise-capability-center/CredibilityBadge.tsx`
    - 展示已验证部门列表 + 生产使用天数

  - [x] 7.6 实现 Pagination 组件
    - 创建 `ui/src/ui/views/enterprise-capability-center/Pagination.tsx`
    - 总数文本 + 页码导航 + 每页条数选择器（10/20/50）

- [x] 8. 主页面：企业能力概览（第一屏）
  - [x] 8.1 实现 CapabilityOverview 组件
    - 创建 `ui/src/ui/views/enterprise-capability-center/CapabilityOverview.tsx`
    - 4 个核心指标卡片：企业已形成能力数、已覆盖部门、本月能力调用量、高成熟度能力数
    - 加载骨架屏、错误重试、环比变化（↑/↓/持平）
    - 千位分隔符格式化

  - [x] 8.2 实现 DomainDistribution 组件（第二屏）
    - 创建 `ui/src/ui/views/enterprise-capability-center/DomainDistribution.tsx`
    - 按业务领域（销售/HR/客服/财务/法务/数据分析）聚合展示
    - 领域卡片：领域名称 + 能力数量 + 代表性能力列表
    - 点击领域可展开查看该领域下所有能力

  - [x] 8.3 实现 HighValueCapabilityCards 组件（第三屏）
    - 创建 `ui/src/ui/views/enterprise-capability-center/HighValueCapabilityCards.tsx`
    - 卡片流布局展示高价值能力（按复用价值排序 Top N）
    - 每张卡片含：能力名称、一句话描述、ValueSummary（业务语言）、成熟度徽章、CredibilityBadge
    - "查看全部能力" 链接跳转到完整表格视图

  - [x] 8.4 实现 EnterpriseCapabilityCenterPage 主布局
    - 创建 `ui/src/ui/views/enterprise-capability-center/EnterpriseCapabilityCenterPage.tsx`
    - 页面标题："企业能力中心"
    - 副标题："企业 AI 能力沉淀中心 · 由员工贡献，经企业审核，沉淀为可复用、可治理的企业能力资产"
    - 头部按钮："能力贡献记录"（次要）+ "能力安装管理"（主要）
    - 编排：CapabilityOverview → DomainDistribution → HighValueCapabilityCards → "查看全部"入口
    - 白色背景 + 蓝色主色调企业管理后台主题

- [x] 9. 全部能力表格视图
  - [x] 9.1 实现 AssetFilterBar 组件
    - 创建 `ui/src/ui/views/enterprise-capability-center/AssetFilterBar.tsx`
    - 搜索框 + 4 个下拉筛选器 + "只看我可安装"开关 + 重置按钮
    - 500ms 防抖

  - [x] 9.2 实现 AssetTable 与 AssetTableRow 组件
    - 创建 `ui/src/ui/views/enterprise-capability-center/AssetTable.tsx` + `AssetTableRow.tsx`
    - 7 列：能力名称与说明、使用场景、适用对象、能力成熟度、健康状态、企业复用数据、操作
    - 文本截断（30/50 字符）、标签溢出（+N）、成熟度圆点、健康徽章、迷你趋势图
    - "安装到机器人"按钮 / "已停用"状态
    - 1280px 以下水平滚动

  - [x] 9.3 实现 QuickEntrySidebar 组件
    - 创建 `ui/src/ui/views/enterprise-capability-center/QuickEntrySidebar.tsx`
    - 3 个快捷入口：我的安装能力、我贡献的能力、能力安装管理
    - 高亮激活态、空状态提示

  - [x] 9.4 实现 AllCapabilitiesPage 组件
    - 创建 `ui/src/ui/views/enterprise-capability-center/AllCapabilitiesPage.tsx`
    - 编排：QuickEntrySidebar + AssetFilterBar + AssetTable + Pagination
    - 返回主页链接

- [x] 10. 详情与管理子页面
  - [x] 10.1 实现 AssetDetailPage 组件
    - 创建 `ui/src/ui/views/enterprise-capability-center/AssetDetailPage.tsx`
    - 分区：基本信息、溯源信息（含 CredibilityBadge）、复用数据面板（部门分布/趋势图/Top10 机器人）、审核历史时间线、安装记录
    - 分区空状态、加载失败重试
    - "前往平台治理台查看技术详情"跳转链接

  - [x] 10.2 实现 ReviewQueuePage 组件
    - 创建 `ui/src/ui/views/enterprise-capability-center/ReviewQueuePage.tsx`
    - 审核队列（按提交时间升序）
    - 审核评估维度展示（安全性 + 质量）
    - 审核操作：通过（选 ApplicableScope）/ 拒绝 / 需修改（意见 ≥ 10 字符）

  - [x] 10.3 实现 InstallManagementPage 组件
    - 创建 `ui/src/ui/views/enterprise-capability-center/InstallManagementPage.tsx`
    - 分页列表（50条/页）、搜索筛选（能力名/机器人名/时间/来源）
    - 安装状态徽章（正常运行/已暂停/待更新）
    - 卸载确认对话框 + 来源统计摘要

  - [x] 10.4 实现 ContributionRecordsPage 组件
    - 创建 `ui/src/ui/views/enterprise-capability-center/ContributionRecordsPage.tsx`
    - 分页（20条/页）、按员工/时间/审核状态筛选
    - 审核状态业务语言标签

  - [x] 10.5 实现 ContributionPerformancePage 组件
    - 创建 `ui/src/ui/views/enterprise-capability-center/ContributionPerformancePage.tsx`
    - 贡献排行榜（数量/质量双维度）
    - 按部门/时间筛选、CSV 导出
    - "本月活跃贡献者" Top 5

  - [x] 10.6 实现 InstallToRobotDialog 组件
    - 创建 `ui/src/ui/views/enterprise-capability-center/InstallToRobotDialog.tsx`
    - 机器人多选器（最多 20 个）
    - 已安装标记 + 禁用
    - 安装结果摘要（成功/失败数 + 失败列表）

- [x] 11. Checkpoint — 确保所有组件测试通过

- [x] 12. 集成与路由
  - [x] 12.1 路由与页面导航连接
    - 主入口：EnterpriseCapabilityCenterPage
    - 子页面导航：详情、审核队列、安装管理、贡献记录、贡献绩效、全部能力
    - 侧边栏入口 → 筛选状态联动
    - 头部按钮 → 页面跳转

  - [x] 12.2 Controller 与 View 连接
    - 各 View 组件连接对应 Controller
    - 初始化 Gateway Client 并注入 Controller
    - 加载状态转换（200ms 延迟后骨架屏）
    - 错误处理与重试机制

  - [x]\* 12.3 集成测试
    - 资产列表加载 → 筛选 → 分页完整流程
    - 审核队列 → 提交审核 → 通知流程
    - 安装对话框 → 确认 → 结果摘要流程
    - 能力领域分布 → 展开领域 → 查看能力流程

  - [x]\* 12.4 UI 单元测试（非 Property Test）
    - 文本截断正确性
    - 标签溢出 +N 展示
    - 增长指标颜色映射
    - 统计仪表盘加载/错误/缓存状态
    - 响应式水平滚动

- [x] 13. Final Checkpoint — 确保全部测试通过

## Notes

- 标记 `*` 的任务为可选（可跳过以加速 MVP）
- UI 面向名称统一为"企业能力中心"，内部模块名保留 enterprise-capability-asset-library
- Property Test 仅覆盖核心不变量（投影/生命周期/审核/可见性/安装/成熟度计算）
- UI 展示逻辑（截断/溢出/颜色）使用 unit test 覆盖
- 页面结构优先级：概览 → 领域版图 → 高价值卡片 → 全部表格（非表格优先）
- 所有业务数据展示使用业务语言（"本月已被调用 N 次"而非 monthlyExecutions: N）

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["1.3", "1.4", "1.5"] },
    { "id": 3, "tasks": ["2.1", "2.2", "2.3", "2.4", "2.5", "2.6", "2.7"] },
    { "id": 4, "tasks": ["3.1", "3.2", "3.3", "3.4", "3.5"] },
    { "id": 5, "tasks": ["5.1", "5.2", "5.3", "5.4", "5.5", "5.6", "5.7", "5.8", "5.9"] },
    { "id": 6, "tasks": ["7.1", "7.2", "7.3", "7.4", "7.5", "7.6"] },
    { "id": 7, "tasks": ["8.1", "8.2", "8.3", "8.4"] },
    { "id": 8, "tasks": ["9.1", "9.2", "9.3", "9.4"] },
    { "id": 9, "tasks": ["10.1", "10.2", "10.3", "10.4", "10.5", "10.6"] },
    { "id": 10, "tasks": ["12.1", "12.2"] },
    { "id": 11, "tasks": ["12.3", "12.4"] }
  ]
}
```
