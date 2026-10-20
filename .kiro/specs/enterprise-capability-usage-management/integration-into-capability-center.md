# 整合方案：撤销「能力应用管理」，并入「企业能力中心」

状态：已执行（阶段 A+B+C 完成）
作者：Kiro
日期：2026-05-31
范围：企业端（enterprise port）前端导航与页面结构；不改任何 `enterprise-capability.*` / `enterprise-usage.*` RPC 契约。

---

## 1. 背景与目标

当前企业端把"能力"相关功能拆成两个并列的左侧导航模块：

- **企业能力中心**（`enterpriseCapabilityCenter`，路由 `/enterprise/{tenant}/capabilities`）——业务资产库 + 资产生命周期（贡献/审核/发布/认证/孵化/安装）。
- **能力应用管理**（`enterpriseUsageManagement`，路由 `/enterprise/{tenant}/usage-management/{sub}`）——运行时使用投影（机器人视图/安装关系/效果分析/应用治理）。

经代码核查，两者存在**明确职责重叠且方向上应收敛**：

- "安装关系"在两个模块各实现一次，且能力应用管理的"安装关系"子页底层直接调用的是能力中心的 `enterprise-capability.install-management` / `uninstall`（见 `usage-management-page.ts` 中 `installViewController` 注入的是 `capGateway`）。
- 设计文档已指明应"逐步统一到资产视角"（`.kiro/specs/capability-lifecycle-closure/business-lifecycle-analysis.md`）。

**目标**：撤销顶层「能力应用管理」导航入口，将其**独有价值**（运行效果分析、应用治理、机器人使用视图）整合进「企业能力中心」，消除重复的"安装关系"，对外只保留一个"能力"模块入口，并保证旧链接平滑重定向。

**非目标**：

- 不修改任何后端 RPC 端点与数据契约（`enterprise-usage.*`、`enterprise-capability.*` 均保留）。
- 不改动孵化中心、成本与预算、机巢治理、组织与数字人等其他模块的业务逻辑。

---

## 2. 现状梳理

### 2.1 企业能力中心（保留，作为整合后宿主）

- 入口：左侧导航 `enterpriseCapabilityCenter`；页面 `ui/src/ui/views/enterprise-asset-library/enterprise-capability-center-page.ts`。
- 结构：单个模块抬头 `renderEnterpriseModuleHeader({ title: "企业能力中心" })` + 概况指标区（4 张状态卡）+ 主工作区 Tab。
- 现有主 Tab（`CapabilityCenterMainTab`）：`skills`（全部技能）/ `leaderboard`（贡献排行）/ `install`（能力安装管理）/ `incubation`（孵化中心）。
- 子路由（surface `parseCapabilityCenterRoute`）：`all` / `contribution-records` / `contribution-performance` / `install-management` / `review-queue` / `incubation` / `detail/{capabilityId}`。
- 数据：`enterprise-capability.*`（+ 孵化的 `incubation.*` / `upstream.*`）。

### 2.2 能力应用管理（拟撤销）

- 入口：左侧导航 `enterpriseUsageManagement`；外框 `ui/src/ui/views/enterprise-capability-usage-management/usage-management-page.ts`。
- 子页（`SUB_ROUTE_TABS`）：
  - `robots` 机器人视图 — KPI + 机器人能力使用表 + 详情弹窗（`enterprise-usage.list-robot-capability-views` / `get-robot-detail`）。
  - `installs` 安装关系 — 双视角台账 + 卸载（**调用 `enterprise-capability.*`，与能力中心 install tab 重复**）。
  - `analytics` 效果分析 — 趋势/Top 能力/环比（`enterprise-usage.get-analytics`）。
  - `governance` 应用治理 — 低效/未使用/冲突识别与处置（`enterprise-usage.detect-governance` 等）。
- 控制器目录：`ui/src/ui/controllers/enterprise-capability-usage-management/*`（robot-capability-view / install-management-dual-view / usage-analytics / usage-governance / load-with-retry）。
- 视图目录：`ui/src/ui/views/enterprise-capability-usage-management/*`。
- gateway：`ui/src/ui/capability/enterprise-capability-usage-management/*`。

### 2.3 功能矩阵（整合判定）

| 现「能力应用管理」子页 | 是否与能力中心重复                             | 整合判定                                   |
| ---------------------- | ---------------------------------------------- | ------------------------------------------ |
| 机器人视图 robots      | 否（能力中心无运行态机器人视角）               | **保留**，作为能力中心新主 Tab             |
| 安装关系 installs      | **是**（能力中心已有 install tab，且同源端点） | **删除**，统一到能力中心既有"能力安装管理" |
| 效果分析 analytics     | 否                                             | **保留**，作为能力中心新主 Tab             |
| 应用治理 governance    | 否                                             | **保留**，作为能力中心新主 Tab             |

---

## 3. 整合后信息架构

把能力中心主 Tab 从 4 个扩展为 6 个（顺序按"资产生命周期 → 安装 → 运行效果 → 治理 → 孵化"组织）：

```
企业能力中心（唯一"能力"入口）
└─ 概况与待办（保留：待审核 / 已发布 / 安装覆盖 / 孵化候选）
└─ 主工作区 Tab：
   1. 全部技能      skills        （原样）
   2. 贡献排行      leaderboard   （原样）
   3. 能力安装管理   install       （原样；吸收原"安装关系"）
   4. 机器人视图    robots        （新增，来自能力应用管理）
   5. 效果分析      analytics     （新增，来自能力应用管理）
   6. 应用治理      governance    （新增，来自能力应用管理）
   7. 孵化中心      incubation    （原样）
```

说明：

- `CapabilityCenterMainTab` 类型从 `"skills" | "leaderboard" | "install" | "incubation"` 扩展为加上 `"robots" | "analytics" | "governance"`。
- Tab 顺序建议把"机器人视图/效果分析/应用治理"插在 `install` 与 `incubation` 之间，形成"资产→安装→运行→治理→孵化"的自然阅读动线。
- "安装关系"不再单列；原能力应用管理 install 子页删除，复用能力中心 install tab（二者本就同源）。

### 路由统一

能力中心既有路由模式：home 用 `?tab=` 查询参数（`changeMainTab` 写 `?tab=leaderboard|install|incubation`，`skills` 不带参数），深链子页用 path 段（`/capabilities/review-queue` 等）。新 Tab 沿用查询参数模式：

- `/enterprise/{tenant}/capabilities?tab=robots`
- `/enterprise/{tenant}/capabilities?tab=analytics`
- `/enterprise/{tenant}/capabilities?tab=governance`

> 决策：新 Tab 采用 `?tab=` 而非新增 path 段，原因是它们是 home 工作区内的视图切换（与 leaderboard/install/incubation 同级），与能力中心既有交互一致，改动最小。

### 旧链接重定向（必须，避免书签/外链 404）

旧 `/enterprise/{tenant}/usage-management/{sub}` 统一重定向到能力中心对应 Tab：

| 旧路径                                                           | 新路径                                                    |
| ---------------------------------------------------------------- | --------------------------------------------------------- |
| `/enterprise/{t}/usage-management` 或 `/usage-management/robots` | `/enterprise/{t}/capabilities?tab=robots`                 |
| `/usage-management/installs`                                     | `/enterprise/{t}/capabilities?tab=install`                |
| `/usage-management/installs/{capabilityId}`                      | `/enterprise/{t}/capabilities/{capabilityId}`（资产详情） |
| `/usage-management/analytics`                                    | `/enterprise/{t}/capabilities?tab=analytics`              |
| `/usage-management/governance`                                   | `/enterprise/{t}/capabilities?tab=governance`             |
| `/enterprise/usage-management`（无租户解析态）                   | `/enterprise/capabilities`                                |

同时 `enterpriseUsageManagement` 与已废弃别名 `enterpriseAgents` 均规范化为 `enterpriseCapabilityCenter`（带 `enterpriseCapabilityRoute`/`?tab=` 上下文）。

---

## 4. 详细改动清单（按文件）

> 原则：复用现有 `usage-management/*` 视图与控制器组件（它们与能力中心解耦良好），仅改变**挂载点**——从独立 surface 改为能力中心的 Tab 面板。尽量少删业务代码，多删导航/外框胶水。

### 4.1 导航与路由（`ui/src/ui/navigation.ts`）

1. `ENTERPRISE_SURFACE_TABS`：移除 `"enterpriseUsageManagement"`（保留在 `LEGACY_ENTERPRISE_TABS` 以兼容旧入参）。
2. `TAB_GROUPS` 的 `enterprise` 组随 `ENTERPRISE_SURFACE_TABS` 自动收缩（左侧导航不再显示"能力应用管理"）。
3. `Tab` 联合类型：把 `enterpriseUsageManagement` 标注为 `@deprecated`（与 `enterpriseAgents` 同处理），保留以兼容外部入参与权限映射。
4. `TAB_PATHS` / `TAB_PORTS`：`enterpriseUsageManagement` 保留映射到 enterprise 端口（兼容期），但 `buildEnterpriseTabPath` 改为返回 `/capabilities`（不再 `/usage-management/robots`）。
5. `matchEnterpriseRoute`：`/enterprise/usage-management*` 解析为 `enterpriseCapabilityCenter`，并把子段映射到 `enterpriseCapabilityRoute` 上下文（见 §3 重定向表）。
6. `appendContextToTabPath`：删除 `enterpriseUsageManagement` 分支；`enterpriseCapabilityCenter` 分支已支持 `enterpriseCapabilityRoute`，新增对 `?tab=robots/analytics/governance` 的支持。
7. `normalizeLegacyTab`：新增 `enterpriseUsageManagement → enterpriseCapabilityCenter`（保留 `enterpriseAgents → enterpriseCapabilityCenter`，原先它指向 usage-management，需改向）。
8. `LEGACY_AGENTS_REDIRECTS`：把 `/agents/*` 与 `/usage-management/*` 的目标从 usage-management 改写到 capabilities（见 §3）。
9. 删除 `USAGE_MANAGEMENT_SUB_ROUTES` / `UsageManagementSubRoute` 导出（或保留为内部兼容常量，视引用面而定）。
10. `iconForTab` / `titleForTab`：`enterpriseUsageManagement` 分支可保留兜底（兼容期），但不再出现在导航。

### 4.2 能力中心页面（`ui/src/ui/views/enterprise-asset-library/enterprise-capability-center-page.ts`）

1. `CapabilityCenterMainTab` 增加 `"robots" | "analytics" | "governance"`。
2. `renderMainTabs`：tabs 数组按 §3 顺序加入 机器人视图 / 效果分析 / 应用治理。
3. `EnterpriseCapabilityCenterPageProps` 增加三块面板入参：`robotsPanel` / `analyticsPanel` / `governancePanel`（`TemplateResult`），与现有 `installManagementPanel`/`incubationPanel` 同构。
4. `renderMainTabPanel`：新增三个 case，分别渲染对应 panel。

### 4.3 能力中心 surface（`ui/src/ui/ports/enterprise/views/enterprise-capability-center-surface.ts`）

1. 引入 usage-management 的三个控制器与视图（机器人 / 分析 / 治理），在 surface 内以"受管状态"（与现有 `assetListSurfaceState` 等同构）持有 state。
2. `parseMainTabFromLocation`：识别 `?tab=robots|analytics|governance`。
3. `renderOverviewRoute`：当 `activeTab` 为新 Tab 时，按需 `ensure*Loaded()` 并构建对应 panel（`buildRobotsPanel` / `buildAnalyticsPanel` / `buildGovernancePanel`）。
4. 复用 usage-management 的 gateway（`createEnterpriseUsageGateway`）；analytics/governance 的能力深链继续用 `pathForTab("enterpriseCapabilityCenter", {context:{capabilityId}})`（已是站内同模块跳转，体验更顺）。

### 4.4 删除/退役（`enterpriseUsageManagement` surface 侧）

- `ui/src/ui/ports/enterprise/views/enterprise-usage-management-surface.ts`：删除（其连接态空页可由能力中心既有 data-notice 覆盖）。
- `enterprise-surfaces-core.ts`：移除 `case "enterpriseUsageManagement"` 分支与 `renderUsageManagementSurface` 引用（`enterpriseAgents` 也改指 capability center）。
- `enterprise-shell.ts`：移除 `enterpriseUsageManagement` 的 resolver 预览分支（其文案"机器人能力配置/安装关系/效果分析/应用治理"可合并到能力中心预览）。
- `ui/src/ui/views/enterprise-capability-usage-management/install-management-dual-view-page.ts` 及其控制器 `install-management-dual-view.ts`：删除（去重，统一到能力中心 install tab）。
- 保留并复用：`robot-capability-view-page.ts` / `usage-analytics-page.ts` / `usage-governance-page.ts` 及对应控制器、`robot-detail-panel.ts`、`load-with-retry.ts`、gateway。

> 目录归属可选项：可将保留的 robots/analytics/governance 视图从 `views/enterprise-capability-usage-management/` 迁移到 `views/enterprise-asset-library/`（用 smartRelocate 自动改 import），让"能力中心"代码内聚。本方案建议**第一阶段先不迁目录**（降低 diff/冲突风险），仅改挂载点；目录归并作为后续清理项。

### 4.5 actions / read-model（`ui/src/ui/ports/enterprise/*`）

- `view-types.ts` / `render-model.ts` / `render-actions.ts`：`usageManagement` action 组（`onRefresh`/`onUninstall`/`onRefreshAssignments`）保留即可（能力中心 surface 可复用），但若仅 robots/analytics/governance 需要，可精简。`enterprise-surface-types.ts` 的 tab 联合类型移除 `enterpriseUsageManagement`（保留 `enterpriseAgents` 兼容或一并清理）。

### 4.6 i18n（`ui/src/i18n/locales/zh-CN.ts` / `en.ts`）

- `nav.items.enterpriseUsageManagement` / 顶层 `enterpriseUsageManagement` / `*.subtitle` 不再用于左侧导航；可保留键值（兼容）或移除。
- 能力中心若要展示新 Tab 标签，沿用页面内中文常量（与现有 `全部技能/贡献排行/...` 一致，非 i18n 键），保持风格统一。

### 4.7 样式（`ui/src/styles/enterprise-usage-management.css`）

- 现有 `.enterprise-usage-*` 类全部保留（robots/analytics/governance 视图仍在用）。
- 删除针对独立 surface 的全屏布局 hack：`.content:has(.enterprise-surface--usage-management)` 等（整合后这些视图改为能力中心 Tab 面板，由能力中心容器布局接管）。分页底部吸附等需在能力中心 panel 容器内重新校准。

---

## 5. 兼容与迁移

- **路由兼容**：所有旧 `usage-management` 路径经 §3 重定向到 capabilities，幂等（二次解析不再跳转）。`resolveUrl`/`LEGACY_AGENTS_REDIRECTS` 的属性测试需更新目标。
- **权限兼容**：`port-permissions.ts` 中 `enterpriseUsageManagement` 的 scope 映射保留（兼容期）；新 Tab 不引入新 RPC scope（沿用 `enterprise-usage.*` 既有 scope）。
- **外部链接**：`builders.ts`、`enterprise-overview-surface.ts` 中 `pathForTab("enterpriseUsageManagement", ...)` 调用点改为 `pathForTab("enterpriseCapabilityCenter", { context:{ ... } })` 或保留（经 normalize 自动落到 capabilities）。建议显式改为 capability center 以免依赖兼容层。

---

## 6. 风险与缓解

| 风险                                                                                          | 缓解                                                                          |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 能力中心 Tab 过多（7 个）显得拥挤                                                             | 按生命周期排序分组；移动端 Tab 已 `flex-wrap`；后续可考虑二级分组，但本期不做 |
| 模块级 state 全局单例（usage-management 控制器是 module-level 变量）迁入 surface 后多租户串扰 | 复用能力中心 `buildSurfaceKey` 受管状态模式，按 client/tenant key 重置        |
| 旧路由重定向遗漏导致 404                                                                      | 用属性测试覆盖 `resolveUrl` 幂等 + 全量旧路径映射                             |
| 分页底部吸附/空带布局在新容器下错位                                                           | 在能力中心 panel 容器内重测 §4.7 布局                                         |
| `enterpriseUsageManagement` 仍被外部引用                                                      | 保留为 `@deprecated` 兼容 tab + normalizeLegacyTab，≥1 个发布周期后再删       |

---

## 7. 验证计划

- **导航**：左侧企业导航不再出现"能力应用管理"；"企业能力中心"出现 6 个工作区 Tab。
- **路由**（browser 测试，参考 `navigation.browser.test.ts`）：
  - 直接打开 `/enterprise/acme/usage-management/analytics` → 落到 `/capabilities?tab=analytics` 且渲染效果分析。
  - 直接打开 `/usage-management/installs/{capabilityId}` → 落到 `/capabilities/{capabilityId}` 资产详情。
  - 点击能力中心新 Tab 切换正确（`aria-selected`）且 URL 同步 `?tab=`。
- **功能**：robots/analytics/governance 在能力中心 Tab 下数据加载正常（沿用 `enterprise-usage.*`，含 `load-with-retry` 瞬时重试）。
- **单测/属性测试**：更新 `navigation.test.ts`、`route-redirect.property.test.ts`、`enterprise-surfaces.browser.test.ts`、usage-management `visual-regression`/`integration` 测试（断言从独立 surface 改为能力中心 Tab）。
- **构建**：`pnpm build` / `pnpm tsgo` 通过；`pnpm check`。

---

## 8. 分阶段执行建议

1. **阶段 A（导航与重定向）**：扩展 `CapabilityCenterMainTab`、能力中心 page/surface 挂载三块 panel；navigation 重定向与 normalize；左侧导航移除入口。产出可用整合页面。
2. **阶段 B（去重）**：删除 usage-management 独立 surface、install 双视角子页及控制器；改写外部 `pathForTab` 调用点。
3. **阶段 C（清理）**：移除/迁移 `views/enterprise-capability-usage-management` 目录到 `enterprise-asset-library`（smartRelocate），收敛 i18n 与样式 hack；删除兼容期可去除的 deprecated 项（视发布周期）。

> 建议先合入阶段 A+B（功能等价、入口统一、去重完成），阶段 C 作为后续低风险清理单独提交，便于回滚与评审。

---

## 9. 已确认决策（执行依据）

1. **新 Tab 文案**：沿用原文案——机器人视图 / 效果分析 / 应用治理。
2. **Tab 形态**：7 个主 Tab 扁平排列（不做二级折叠）。
3. **目录迁移**：本期执行（阶段 C），把保留的 robots/analytics/governance 视图与控制器迁入 `enterprise-asset-library`，并收敛 i18n/样式。
4. **兼容 tab 保留时长**：参照既有 `enterpriseAgents` 先例——`enterpriseUsageManagement` 保留为 `@deprecated` 兼容 Tab + 路由重定向 ≥1 个发布周期；本期立即从左侧导航与活动 surface 移除，兼容期结束后再删除类型与重定向。

---

## 10. 执行记录（实际落地）

### 导航与路由（`ui/src/ui/navigation.ts`）

- `ENTERPRISE_SURFACE_TABS` 移除 `enterpriseUsageManagement`；该 tab 降级为 `LEGACY_ENTERPRISE_TABS` 兼容项（`isEnterpriseTab` 仍识别）。
- `canonicalizeTab` / `normalizeLegacyTab`：`enterpriseUsageManagement` 与 `enterpriseAgents` 均收敛到 `enterpriseCapabilityCenter`。
- `buildEnterpriseTabPath`：两个废弃 tab 解析到 `/capabilities`。
- `matchEnterpriseRoute` + `buildTenantEnterpriseResolverContext` + `translateUsageSubRouteToCapabilityRoute`：`/usage-management/*` 与 `/agents/*` 解析为 `enterpriseCapabilityCenter`，子段映射为 `enterpriseCapabilityRoute`（robots/analytics/governance/install-management，installs/{id} → 资产详情）。
- `ENTERPRISE_CAPABILITY_SUB_ROUTES` 新增 `robots/analytics/governance`。
- `LEGACY_AGENTS_REDIRECTS` 重写为指向 `/capabilities/*`。

### 能力中心页面与 surface

- `enterprise-capability-center-page.ts`：`CapabilityCenterMainTab` 增加 `robots/analytics/governance`；主 Tab 7 个扁平排列；新增三块 panel 入参与渲染分支。
- `enterprise-capability-center-surface.ts`：`parseMainTabFromLocation` / `CapabilityCenterRoute` / 路由分发新增三个 Tab；按需 `prepareUsagePanels` 懒加载；新增 `renderRobotsRoute/renderAnalyticsRoute/renderGovernanceRoute`。
- 新增编排器 `views/enterprise-asset-library/capability-center-usage-panels.ts`（复用运行态控制器与子页）。

### 去重与删除

- 删除独立 surface `enterprise-usage-management-surface.ts`、旧编排器 `usage-management-page.ts`、重复的安装关系子页 `install-management-dual-view-page.ts` + `install-relation-row.ts` + 控制器 `install-management-dual-view.ts` 及其测试。
- `enterprise-surfaces-core.ts` 移除 usage-management 分发分支。
- `enterprise-shell.ts` resolver 预览合并到能力中心。
- 外部 `pathForTab("enterpriseUsageManagement", …)` 调用点（builders / overview-surface）改指能力中心。

### 目录迁移（阶段 C）

- `views/enterprise-capability-usage-management/` → `views/enterprise-asset-library-usage/`
- `controllers/enterprise-capability-usage-management/` → `controllers/enterprise-asset-library-usage/`
- `capability/enterprise-capability-usage-management/` → `capability/enterprise-asset-library-usage/`
- 同深度重命名，`../../` 相对导入保持有效；外部引用全部 sed 批量更新。

### 验证

- `pnpm`(vite) build 通过；导航 + 能力中心 + 迁移目录共 300+ 用例通过。
- i18n 旧键（`tabs.enterpriseUsageManagement` 等）保留用于兼容（≥1 发布周期）。
- 已知无关失败：`enterprise-read-model.node.test.ts`（`process is not defined`，与本次无关，stash 验证为既有问题）。

### 兼容期清理项（后续可删）

- `Tab` 联合中的 `enterpriseUsageManagement` 与 `enterpriseAgents`、`normalizeLegacyTab`、`LEGACY_AGENTS_REDIRECTS` 中的 usage-management 规则、`CrossPortContext.usageManagementRoute` 字段、i18n 旧键。

---

## 11. Tab 精细化去重（第二轮优化）

在整合（撤销「能力应用管理」并入能力中心）完成后，对 7 个主 Tab 做了内容级去重与信息架构优化（保持 7 Tab 扁平，不再合并 Tab）。

### 重合点（核对后确认）

- **KPI 三处重复**：「概况」「机器人视图」「效果分析」各自展示"本月调用量 / 覆盖员工 / 覆盖机器人 / 平均成功率"，且分别来自 `enterprise-capability.stats`、`enterprise-usage.list-robot-capability-views`、`enterprise-usage.get-analytics` 三个 RPC，口径可能不一致。
- **Top 能力排行 vs 全部技能**：效果分析的 Top 能力榜与全部技能的能力列表同为"能力维度"，仅排序键不同。
- 安装管理 vs 机器人视图（视角重叠，本轮保留，作为后续可选合并项）。

### 本轮落地

1. **优化 A — 统一 KPI 口径（去重）**：移除「机器人视图」顶部的 4 张聚合 KPI 卡（机器人总数/本月调用量/覆盖员工/平均成功率）。全局静态聚合只由顶部「概况与待办」承载（单一来源 `enterprise-capability.stats`）；「效果分析」保留其 KPI，因其差异化价值是**带环比趋势**。机器人视图进入即为筛选栏 + 机器人表（运行表现明细），不再与概况重复数字。
2. **优化 C — Top 能力榜去重**：从「效果分析」移除 Top 能力排行表，效果分析只保留独有的两张趋势图（调用量趋势、能力复用增长）+ 环比 KPI。删除组件 `top-capabilities-table.ts`；能力的"按调用量/成功率"浏览归口到「全部技能」。
3. **优化 E — Tab 按生命周期重排**：`全部技能 / 贡献排行 / 孵化中心`（资产域）→ `能力安装管理 / 机器人视图 / 效果分析`（运行域）→ `应用治理`（治理域）。

### 测试与验证

- 更新能力中心 page 测试（7 Tab 顺序）、usage VRT（效果分析断言改为趋势图）、integration 测试（移除 Top 能力表用例）；删除 `usage-analytics-navigation.test.ts`（Top 能力跳转已随表移除）。
- `vite build` 通过；能力中心 + usage + navigation + 控制器共 180+ 用例通过。

### 后续可选项（未做，记录）

- ~~**优化 B**：将「能力安装管理」与「机器人视图」合并~~ → 已在第三轮落地（见 §12）。
- 清理控制器中不再渲染的 `RobotCapabilityViewState.kpis`、`UsageAnalyticsState.topCapabilities`（当前保留，由 RPC 填充但不展示，无副作用）。

---

## 12. 安装与运行合并（第三轮，优化 B 落地）

将「能力安装管理」与「机器人视图」合并为单一主 Tab「安装与运行」，主 Tab 从 7 个降为 6 个，消除二者"机器人 × 能力"视角重叠。

### 设计

- 保留底层路由 id `install` 与 `robots` 不变（兼容旧 `/usage-management/installs`、`/usage-management/robots` 重定向与 `?tab=` 深链，均 1:1 落到合并 Tab 的对应子视图）。
- 主 Tab 栏只显示一个「安装与运行」，当 `activeTab` 为 `install` 或 `robots` 时该 Tab 高亮（`isInstallRuntimeTab`）。
- 合并 Tab 内部用二级子视图切换：**安装关系**（install，安装关系台账 + 卸载）/ **运行表现**（robots，机器人运行明细 + 详情）。点击子视图调用既有 `onTabChange("install"|"robots")`，URL 同步 `?tab=`。

### 实现要点

- `enterprise-capability-center-page.ts`：`renderMainTabs` 合并 Tab；新增 `renderInstallRuntimeTab`（子视图切换 + 按 `activeTab` 选 panel）；`renderMainTabPanel` 的 `install`/`robots` 两个 case 都走合并面板。
- `enterprise-capability-center-surface.ts`：当 `activeTab` 为 `install` 或 `robots` 时，**同时预载** install 数据（`ensureInstallManagementLoaded`）与 robots 数据（`prepareUsagePanels(..., "robots")`），保证子视图即时切换无空白。
- 新增 CSS `enterprise-capability-center-page__install-runtime-panel`；补齐 analytics/governance tab 的 grid 样式。

### 验证

- `vite build` 通过；导航 + 能力中心 + usage + 控制器 + surfaces 共 453 用例通过。
- 更新 page 测试：6 主 Tab、合并 Tab 在 install/robots 两路由下都高亮、子视图切换显示对应 panel；补齐 surfaces 测试 mock 覆盖合并 Tab 的双数据预载。

### 最终主 Tab 结构（6 个，扁平，按生命周期）

```
全部技能 → 贡献排行 → 孵化中心 → 安装与运行（安装关系 / 运行表现）→ 效果分析 → 应用治理
```
