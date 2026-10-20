# Implementation Plan: 企业端 UI 统一基线（Enterprise UI Baseline）

> **目标**：为企业端 8 个一级模块建立一套**现代化简约、全栈统一**的设计语言基线——
> 统一的模块页眉、卡片基元、KPI 卡组件、动效令牌、键盘焦点态与字重规范。
> 先把基线沉淀为**共享组件 + 共享类**，再以「企业总览」为首个样板模块完成迁移，
> 供后续 7 个模块（组织与数字人 / 企业数据能力中心 / 企业能力中心 / 机巢治理 / 渠道治理 /
> 成本与预算 / 系统设置）逐一套用。

## Agents

- codex-v111-recovery · role: owner · scope: 恢复企业系统设置与成本预算最新功能基线 · paths: ui/src/ui/views/cost-budget-v2/\*\*, ui/src/ui/capability/cost-budget-billing/index.ts, ui/src/styles/cost-budget-v2.css, ui/src/i18n/locales/en.ts, ui/src/i18n/locales/zh-CN.ts, ui/src/ui/app-settings.ts, ui/src/ui/app-settings.test.ts, ui/src/ui/controllers/tenant-channel-config.ts, ui/src/ui/controllers/tenant-channel-config.test.ts, ui/src/ui/navigation.ts, ui/src/ui/navigation.test.ts, ui/src/ui/ports/enterprise/port-state.ts, ui/src/ui/ports/enterprise/render-model.ts, ui/src/ui/ports/enterprise/view-types.ts, ui/src/ui/ports/enterprise/views/enterprise-access-control-surface.ts, ui/src/ui/ports/enterprise/views/enterprise-channel-credentials-surface.ts, ui/src/ui/ports/enterprise/views/enterprise-channel-credentials-surface.browser.test.ts, ui/src/ui/ports/enterprise/views/enterprise-shell.ts, ui/src/ui/ports/enterprise/views/enterprise-surface-types.ts, ui/src/ui/ports/enterprise/views/enterprise-surfaces-core.ts, deploy/production/RELEASE_RECORD.md, .kiro/specs/enterprise-ui-baseline/tasks.md, .loom/registry.yaml · since: 2026-07-25

## Recovery Checkpoint (2026-07-25)

- [x] 恢复成本预算 v2 的租户隔离加载、失败重试和状态机修复；21 个相关测试文件、63 项测试通过。— codex-v111-recovery
- [x] 恢复租户渠道配置，并将渠道凭证嵌入企业系统设置；5 个相关测试文件、147 项测试通过，UI production build 通过。— codex-v111-recovery

## Overview

将企业端专家 UI 评审（2026-06-15，P1–P7）的「统一基线」结论，转化为可执行、可勾选的实施计划：
先沉淀共享 token 别名、卡片基元交互态、统一模块页眉、统一 KPI 卡组件与字重两档规范，
再以「企业总览」模块完成首个样板迁移，作为后续 7 个企业端模块迁移的参照实现与依赖。

## 背景与现状（落地锚点）

- 设计令牌体系已就绪：`ui/src/styles/base.css` 已定义颜色 / 语义色（`--ok/--warn/--danger`）/
  圆角（`--radius-*`）/ 阴影（`--shadow-*`）/ 动效（`--duration-fast|normal|slow`、`--ease-out`）/
  焦点（`--focus-ring`）/ 明暗主题。**本基线不新增颜色 token**。
- 企业端**已有** foundation 基元：`ui/src/styles/enterprise-foundation.css` 的
  `.enterprise-card`（带 token 化过渡 + `--flat/--compact` 变体）、`.enterprise-stats-grid`、
  `.enterprise-stat-card`、`.enterprise-page__title/__subtitle`。
- 问题：企业总览 surface（`ui/src/ui/ports/enterprise/views/enterprise-overview-surface.ts`）
  **未复用** foundation，而是自造了 `.enterprise-overview-snapshot__*` 等并行类；
  页眉缺副标题、刷新按钮为裸 `<button>刷新</button>`（无图标/无 pending 态）；
  动效硬编码 `160ms ease`；可点击卡片无 `:focus-visible`；存在非常规字重（760/740/720/680/640）；
  非交互 `<div>` 卡片仍有 hover 抬升。
- 共享页眉组件已存在：`ui/src/ui/views/enterprise-module-header.ts`
  （`renderEnterpriseModuleHeader` / `renderEnterpriseSubpageHeader`），需扩展而非重写。

### 验收来源（专家 UI 评审，2026-06-15）

本基线对应评审中的 P1–P7：P1 页眉跨端不统一、P2 KPI 两套语言、P3 卡片基元重复、
P4 动效未走令牌、P5 焦点态缺失、P6 字重伪精度、P7 非交互卡 hover 误导。

## 约束（强制）

- 路径全部仓库根相对（per AGENTS.md）。
- TypeScript（ESM），严格类型，**禁止 `any` / `@ts-nocheck`**。
- 复用既有 `enterprise-foundation.css` 基元，**禁止**再造并行卡片体系。
- 不新增颜色 token；动效/焦点统一引用既有 token。
- **不触碰平台端文件**（`ui/src/ui/ports/platform/**`）与其他 agent 的 WIP；仅改本任务文件。
- 提交用 `scripts/committer "<msg>" <file...>`，带 `Task: enterprise-ui-baseline` / `Agent: <agent-id>` trailer；禁止 `git add .`。
- 改动文件 `get_diagnostics` 干净；`pnpm check` + 相关 `*.browser.test.ts` 全绿。

## 范围边界

- **In scope**：企业端共享基线（token 别名、foundation 卡片态、模块页眉、KPI 组件、字重）
  - 「企业总览」样板迁移。
- **Out of scope（开放项，需 owner 决策）**：
  1. 两端标题字号是否统一（平台 `clamp(28-38px)` vs 企业 22px）——本期保留差异。
  2. 是否把 `enterprise-card` 上升为跨端 `surface-card`（会触及平台端）——独立任务。
  3. 后续 7 个模块的逐一迁移——本 spec 只交付基线 + 企业总览样板，其余模块另起任务。

## 执行进度核验与执行指令（验收方核验于 2026-06-15）

> ✅ **2026-06-16 复验结论：通过（含 1 处非阻断残留）**。执行团队已补齐基线层与全部 8 模块迁移，
> 共享组件真实存在且被各模块实际引用，两处实质 Bug 已修复，相关测试全绿、改动文件诊断干净。

### 复验证据（2026-06-16）

- **基线层落地**：`enterprise-foundation.css` 有 `.enterprise-card--interactive`（hover + `:focus-visible`）、
  `.is-warn/.is-danger/.is-ok`、`.enterprise-kpi-grid`、`.enterprise-kpi-card.is-active`、`.enterprise-segmented-nav`；
  新建共享组件 `enterprise-kpi-card.ts` / `enterprise-segmented-nav.ts`（均带 browser 测试）；`base.css` 有 `--transition-interactive`。
- **8 模块均消费共享组件**：overview / organization / data-capability（metrics-overview-cards 已成薄封装）/
  capability-center / cost-budget / channels / settings 全部 `import` 并使用 `renderEnterpriseKpiGrid` 或 `renderEnterpriseSegmentedNav`；
  overview/channels 页眉用标准 `renderEnterpriseModuleHeader`（title/subtitle/refresh）。
- **两处实质 Bug 已修**：(1) 全仓已无 `var(--success)` 引用；(2) 机巢治理 `assets-page.ts` 全量 token 化
  （`var(--card)/--text/--border/--shadow-lg/--radius-xl`），深色白底孤岛消除；`.enterprise-btn--primary` 改 `var(--accent)`（红色品牌），蓝色分叉消除。
- **测试**：18（kpi-card/segmented-nav/module-header）+ 85（enterprise-surfaces/capability-center-page/cost-budget-page）全通过；8 个改动文件 `get_diagnostics` 干净。

### ⚠️ 非阻断残留（建议补完再 land）

- **T13.2 硬编码 hex 未清干净**：`enterprise-components.css` 仍约 18 处 `[data-theme="light"]` 蓝色硬编码
  （`#3b82f6/#2563eb/#1d4ed8`），分布在 asset-library 子组件（contribution tab、pagination、asset-table、asset-detail-page、high-value-\* 等）。
  仅浅色主题可见，不影响默认深色。建议将其改为 `var(--accent)` 并删除 light 分支。
- 全量 `pnpm check`（whole-repo lint/format）与 `pnpm tsgo` 未由验收方运行（工作树含他人 WIP）；建议 land 前由执行团队跑一次。

## Tasks

- [ ] 0. 基线规范文档（前置）
  - [ ] 0.1 新建 `docs/design/enterprise-ui-baseline.md`
    - 固化：token 别名映射、类名规范（卡片/页眉/KPI）、组件签名（TS）、字重两档规范、
      可交互卡片的 hover/focus 约定、非交互卡片禁止 hover 抬升的规则。
    - **页眉书面约定（可 review/校验）**：模块页眉禁止英文眉题（如 "Settings center"）与渐变卡片页眉；
      标题取 `t("tabs.<tab>")`，副标题取 `t("subtitles.<tab>")`，禁止硬编码标题字面量。
    - 作为后续模块迁移 PR 的**引用依据**（每个模块 PR 描述需链接本文件）。
    - _前置：无_

- [ ] 1. 动效与焦点令牌别名（`ui/src/styles/base.css`）
  - [x] 1.1 在 `:root` 新增交互过渡语义别名（不新增颜色 token）- 新增 `--transition-interactive: border-color var(--duration-normal) var(--ease-out),
box-shadow var(--duration-normal) var(--ease-out), transform var(--duration-normal) var(--ease-out);` - 确认 `--focus-ring`、`--duration-normal`、`--ease-out` 已存在可直接引用（无需新增）。- _前置：无_

- [ ] 2. 共享卡片基元补齐（`ui/src/styles/enterprise-foundation.css`）
  - [ ] 2.1 在既有 `.enterprise-card` 上新增交互态 - `.enterprise-card--interactive`：`cursor:pointer; text-decoration:none; color:inherit;
transition: var(--transition-interactive);` - `:hover` → `transform: translateY(-1px); border-color: var(--border-strong); box-shadow: var(--shadow-md);` - `:focus-visible` → `outline:none; box-shadow: var(--focus-ring);`（修复 P5）- _前置：1.1_
  - [ ] 2.2 新增语义色边 modifier（复用语义 token + color-mix）
    - `.enterprise-card.is-warn / .is-danger / .is-ok` 各染 `border-color`。
    - _前置：2.1_
  - [ ] 2.3 规则文档化：可点击卡片用 `enterprise-card enterprise-card--interactive`，
        非交互卡片用 `enterprise-card`（无 hover 抬升，修复 P7）。
    - _前置：2.1_
  - [ ] 2.4 唯一卡片基元约定（源自数据能力中心 P4：`.card` 与 `.enterprise-card` 并行）
    - 在 0.1 文档中明确：**模块级卡片统一用 `enterprise-card`**；泛化 `.card` 仅作底层通用原语，
      新代码不直接用于模块卡。
    - 给出 `.card-title` / `.card-sub` 到基线的映射（标题→700 档、说明→`--muted` 12px），
      供迁移时替换内联 `.card-title/.card-sub` 用法。
    - **禁止内联 `style=`**：模块卡的间距/对齐一律走类，不得用 `style="margin-top:…"`。
    - _前置：2.1_

- [ ] 3. 统一模块页眉（`ui/src/ui/views/enterprise-module-header.ts` + foundation CSS）
  - [x] 3.1 扩展 `EnterpriseModuleHeaderProps` 签名
    - 新增 `subtitle?: string`（主导航模块建议必填）与
      `refresh?: { onRefresh: () => unknown; pending?: boolean }`。
    - 内部渲染标准刷新按钮：`btn btn--sm` + `renderIcon("refreshCw", "btn__icon")` +
      `?disabled=${pending}` + 文案 `pending ? "刷新中…" : "刷新"`。
    - 保持向后兼容：未传 `refresh` 时不渲染刷新按钮；`trailing` 仍可叠加额外操作（导出等）。
    - _前置：无_
  - [x] 3.2 页眉 CSS 内部自洽（`enterprise-foundation.css`）
    - `.enterprise-page__title` 统一 `font-size:22px; font-weight:700; line-height:1.2;`；
      `.enterprise-page__subtitle` `font-size:13px; color:var(--muted); line-height:1.5;`。
    - 同步更新 `enterprise-module-header.ts` 顶部文档注释（删除"20px"，与 22px 对齐，修复 P1 内部不自洽）。
    - **强制约定**：模块页眉禁止英文眉题与渐变卡片（既有 header 书面规范），迁移各模块时一并清除
      （如系统设置的 "Settings center" 眉题，见任务 18.1）。
    - _前置：3.1_
  - [ ]\* 3.3 页眉单测：`enterprise-module-header` 渲染 subtitle、pending 态禁用 + "刷新中…" 文案、
    无 refresh 时不渲染按钮。
    - _前置：3.1_

- [ ] 4. 统一 KPI 卡组件（新建共享组件）
  - [ ] 4.1 新建 `ui/src/ui/views/enterprise-kpi-card.ts` - 导出类型 `EnterpriseKpiItem`（`label/value/href?/icon?:IconName/tone?:"neutral"|"warn"|"danger"|"ok"/
trend?:{direction,label,tone}/drilldown?/active?:boolean`）与函数 `renderEnterpriseKpiGrid(items): TemplateResult`。- 容器 `.enterprise-kpi-grid`（`repeat(auto-fit, minmax(200px,1fr))`）；
        每项基于 `enterprise-card enterprise-card--interactive`（有 href 时）+ `is-<tone>`。- 结构：可选图标位 → label(12px muted) → value(24px/700) → 可选 trend chip（图标方向 + 颜色**双编码**，
        禁止纯色区分）+ 下钻箭头。- **`active` 选中态**（来自组织模块「KPI 即筛选器」模式）：`active=true` 时加 `is-active` 类，
        用 accent 边框 + 轻 accent 底色表达选中，并在 `<a>` 上设 `aria-current="true"`。- _前置：2.2_
  - [ ] 4.2 新增 `.enterprise-kpi-grid` / `.enterprise-kpi-card__*` 样式到 `enterprise-foundation.css` - 数值/标签字重走任务 6 两档规范。- 含 `.enterprise-kpi-card.is-active`：`border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
background: var(--accent-subtle);`（选中态与 hover/focus 不冲突）。- _前置：4.1, 6.1_
  - [ ]\* 4.3 KPI 组件单测：tone→类名映射、href→可交互 + 下钻箭头、trend 双编码渲染、无 href 退化为静态卡、
    `active`→`is-active` + `aria-current`。
    - _前置：4.1_

- [ ] 5. 企业总览样板迁移（`ui/src/ui/ports/enterprise/views/enterprise-overview-surface.ts`）
  - [ ] 5.1 页眉接入：用 3.1 的 `refresh: { onRefresh: actions.overview.onRefresh, pending }`,
        补 `subtitle: t("subtitles.enterpriseOverview")`，删除裸 `<button>刷新</button>`。
    - _前置：3.1_
  - [ ] 5.2 KPI 区改用 `renderEnterpriseKpiGrid(kpis)`，删除 `enterprise-overview-snapshot__*`
        内联结构与其专用 CSS。
    - _前置：4.1_
  - [ ] 5.3 优先处理卡 / 资产闭环卡 / 治理队列行迁移到 `enterprise-card[ --interactive ]`,
        删除重复的 `border/radius/background/box-shadow/transition` 声明；
        非交互 `<div>` 变体不加 `--interactive`（修复 P7）。
    - _前置：2.2_
  - [ ] 5.4 清除本文件相关 CSS 中所有硬编码 `160ms ease` → `var(--transition-interactive)`。
    - _前置：1.1_
  - [ ]\* 5.5 更新 `ui/src/ui/ports/enterprise/views/enterprise-surfaces.browser.test.ts`
    中 `enterpriseOverview` 用例：旧类名断言改新类名，保留语义文案断言
    （"优先处理"/"试用席位已满"/"治理队列" 等不变）；新增"页眉含副标题 + 刷新按钮"断言。
    - _前置：5.1, 5.2, 5.3_

- [ ] 6. 字重规范收敛（企业端范围）
  - [ ] 6.1 将 `enterprise-foundation.css` + `components.css` 内 `enterprise-*` 选择器的
        非常规字重（`760/740/720/680/640`）收敛为 **`600` / `700` 两档**（标题/数值 700，次级强调 600）。
        **核验：foundation.css 已干净，但 `components.css` 内 `enterprise-*` 仍有非常规字重，未完成。**
    - grep 锚点：`font-weight: 7[0-6][0-9]`、`font-weight: 6[4-9]0`（限企业端选择器）。
    - _前置：无_

- [ ] 7. 集成与验收守护
  - [~] 7.1 `pnpm check`（oxlint + oxfmt）通过；本任务全部改动文件 `get_diagnostics` 干净。
  - [~] 7.2 运行 `OPENBOT_TEST_PROFILE=low pnpm test ui/src/ui/ports/enterprise/views/enterprise-surfaces.browser.test.ts
ui/src/ui/views/enterprise-module-header*.test.ts ui/src/ui/views/enterprise-kpi-card*.test.ts` 全绿。
  - [ ] 7.3 视觉自检（结构断言或截图）：
        企业总览页眉有副标题 + 带 `refreshCw` 图标的刷新按钮 + pending 禁用态；
        可点击卡片键盘 Tab 有 `--focus-ring` 焦点环；非交互卡片无 hover 抬升；
        企业端范围内无残留 `160ms ease` 硬编码动效。
  - [~] 7.4 Checkpoint —— 基线（任务 1–4、6）+ 企业总览样板（任务 5）完成；
    其余 7 个模块迁移另起任务，引用 `docs/design/enterprise-ui-baseline.md`。

- [ ] 8. 共享二级导航组件（segmented nav，源自组织模块 P5）
  - [ ] 8.1 新建 `ui/src/ui/views/enterprise-segmented-nav.ts`
    - 导出 `EnterpriseSegmentedNavItem`（`id/label/hint?/active`）与
      `renderEnterpriseSegmentedNav(items, onSelect): TemplateResult`。
    - 抽取组织模块 `.enterprise-org-surface-nav` 的药丸 segmented control 为通用组件：
      `role="tablist"`、各项 `role="tab"` + `aria-selected`、`title=hint`。
    - 用途约定（写入 0.1 文档）：**顶部药丸 = 同一数据的视图切换**；
      **左侧子导航 = 多区段并列**（如企业数据能力中心的 `activeSection`）。两种范式各保留一个共享实现，禁止逐模块重写。
  - [ ] 8.2 样式落 `enterprise-foundation.css`：`.enterprise-segmented-nav` / `__tab` / `__tab.is-active`，
        圆角/间距/选中态走 token；选中态 `:focus-visible` 用 `--focus-ring`。
    - _前置：1.1_
  - [ ]\* 8.3 组件单测：active→`aria-selected=true` + `is-active`；点击触发 `onSelect(id)`。
    - _前置：8.1_

- [ ] 9. 组织与数字人模块迁移（`ui/src/ui/ports/enterprise/views/enterprise-organization-surface.ts`）
  - [ ] 9.1 页眉迁移：用 `renderEnterpriseModuleHeader` 替换自造 `renderOrganizationWorkforceHeader`；
        `title = t("tabs.enterpriseOrganization")`、补 `subtitle = t("subtitles.enterpriseOrganization")`；
        搜索框 + 搭建组织/添加岗位/邀请激活/发起交接 按钮移入 `trailing`。修复标题与 nav 名不符（P1）。
    - _前置：3.1_
  - [ ] 9.2 组织快照 6 个 KPI → `renderEnterpriseKpiGrid`（用 `active` 表达"KPI 即筛选器"选中态）；
        删除 `.enterprise-org-kpi` 内联结构与专用 CSS。
    - _前置：4.1_
  - [ ] 9.3 优先治理 4 张卡 → `enterprise-card enterprise-card--interactive` + `is-<tone>`；
        删除 `.enterprise-org-priority-card` 专用样式（保留语义 dot/icon 如需，但走基线卡片基元）。
    - _前置：2.2_
  - [ ] 9.4 子导航（组织治理/组织架构）→ `renderEnterpriseSegmentedNav`，删除 `.enterprise-org-surface-nav` 专用样式。
    - _前置：8.1_
  - [ ] 9.5 本模块范围内字重 750/650 → 600/700（并入任务 6 口径）；可交互卡片去硬编码动效（如有）。
    - _前置：1.1, 6.1_
  - [ ]\* 9.6 更新组织模块相关 `*.browser.test.ts`：旧类名/旧标题断言改为新组件与
    `tabs.enterpriseOrganization` 标题；保留筛选/分页/抽屉等行为断言不变。
    - _前置：9.1, 9.2, 9.3, 9.4_

- [ ] 10. 共享数据表组件（独立立项占位，源自组织模块 P7）
  - [ ] 10.1 现状记录：企业端多张列表（岗位/数字人/协作组/成员/激活等）各自手写
        `enterprise-org-*-table` 网格 + 工具栏 + 分页，是企业端体量最大的未统一资产。
  - [ ] 10.2 **本基线不实现**；建议另开 spec `enterprise-data-table` 抽共享表格
        （表头/行/空态/分页/工具栏/筛选），后续列表模块统一复用。此条仅作为追踪锚点。

- [ ] 11. 企业数据能力中心模块迁移（`ui/src/ui/ports/enterprise/views/enterprise-data-governance-center-surface.ts` + 相关组件）
  - [ ] 11.1 首页 KPI 迁移：`renderMetricsOverviewCards`（5 张）与 `renderSummaryStatCard`
        （知识供给 / 审计血缘）改用基线 `renderEnterpriseKpiGrid`；删除 `ui/src/ui/views/enterprise-data-capability/metrics-overview-cards.ts`
        内的自造结构或改为薄封装。
    - _前置：4.1_
  - [ ] 11.2 去内联样式：清除该模块及其子组件所有内联 `style="margin-top:…"` 等，改类（并入 2.4 口径）。
    - _前置：2.4_
  - [ ] 11.3 卡片基元归一：模块内泛化 `.card` + `.card-title/.card-sub` 迁移到 `enterprise-card` 体系（按 2.4 映射）。
    - _前置：2.4_
  - [ ] 11.4 子导航迁移：`.enterprise-data-capability__subnav`（下划线 tab）改用共享 `enterprise-segmented-nav`（任务 8）；
        去硬编码 `0.15s ease`，补 `:focus-visible`。
    - _前置：8.1_
  - [ ] 11.5 文档订正：修订 `.kiro/specs/enterprise-data-capability-center/tasks.md` Phase 4.3 表述
        （"左侧子导航" → 实际"横向分段导航"），与实现一致。
    - _前置：11.4_
  - [ ]\* 11.6 更新该模块 `*.browser.test.ts`：KPI/卡片/子导航类名断言改新组件；
    保留各区段数据与状态（加载/错误/空态/alert banner）断言不变。
    - _前置：11.1, 11.3, 11.4_

- [ ] 12. 按钮系统统一 + 品牌色归一（源自能力中心 P1）
  - [ ] 12.1 收敛双按钮系统：`.enterprise-btn`（`enterprise-components.css`，含
        `--primary/--secondary/--danger/--ghost/--success/--warning`）收敛为 `.btn` 体系，
        或令 `.enterprise-btn*` 成为 `.btn*` 的薄别名（保留选择器兼容，统一视觉）。
        在 0.1 文档登记**唯一按钮基元**与变体映射。
    - _前置：无_
  - [ ] 12.2 消除品牌色分叉：`.enterprise-btn--primary` 等在浅/深色主题**硬编码蓝**（`#3b82f6/#2563eb`）
        改为 `--accent`/`--accent-hover` token，使企业端与全站红色主色一致；删除蓝色 hex。
    - _前置：12.1_
  - [ ]\* 12.3 视觉回归：抽查能力中心/被迁移模块按钮在浅/深色下均为 accent 主色（非蓝）。
    - _前置：12.1, 12.2_

- [ ] 13. Token 卫生（源自能力中心 P0/P2）
  - [ ] 13.1 修复未定义 token：全仓 `var(--success)` → `var(--ok)`
        （如 `.enterprise-capability-center-page__status-card--ready` 的 `color-mix` 因 `--success` 未定义而静默失效）。
    - _前置：无_
  - [ ] 13.2 清查并消除企业端 CSS 中硬编码 hex（蓝 `#3b82f6/#2563eb/#1d4ed8`、灰 `#374151/#d1d5db` 等），
        改用对应 token（`--accent`/`--text`/`--muted`/`--border` 等）；浅/深色统一走 token，
        不再写 `[data-theme=…]` 硬编码色块（颜色已由 token 主题切换覆盖）。
        grep 锚点（限企业端样式文件）：`#[0-9a-fA-F]{6}`。
    - _前置：无_
  - [ ]\* 13.3 守护：企业端样式文件内不应再出现裸 hex 颜色（除 token 定义处）；以 grep 断言或评审清单形式记录。
    - _前置：13.2_

- [ ] 14. 企业能力中心模块迁移（`ui/src/ui/views/enterprise-asset-library/enterprise-capability-center-page.ts` + 相关组件）
  - [x] 14.1 页眉：`renderEnterpriseModuleHeader` 标题改 `t("tabs.enterpriseCapabilityCenter")`（去硬编码字面量），
        补 `subtitle = t("subtitles.enterpriseCapabilityCenter")`，刷新走标准 `refresh` 参数。 — kiro-capability-center
    - _前置：3.1_
  - [x] 14.2 状态卡（`renderStatusCard` 待审核/已发布/安装覆盖/孵化候选）→ 基线 `renderEnterpriseKpiGrid`
        （`tone` + 可点击 `href`/`active`）；删除 `__status-card` 专用样式。 — kiro-capability-center
    - _前置：4.1_
  - [x] 14.3 主工作区 tab（`__tab` 含自相矛盾的 `--main`/药丸两套定义）+ 安装内层 `enterprise-usage-subtab`
        → 共享 `enterprise-segmented-nav`（任务 8）；删除两套旧 tab 样式。 — kiro-capability-center
    - _前置：8.1_
  - [x] 14.4 卡片基元归一 + 字重收敛 + 按钮改 `.btn`（并入 2.4 / 6.1 / 12.1 口径）。 — kiro-capability-center
    - _前置：2.4, 6.1, 12.1_
  - [x]\* 14.5 更新能力中心相关 `*.browser.test.ts`：标题/状态卡/tab 类名断言改新组件与 i18n 标题；
    保留各 Tab 切换与子面板行为断言不变。 — kiro-capability-center
    - _前置：14.1, 14.2, 14.3_

- [ ] 15. 机巢治理 Web Component 重新主题化（**高优先级 / 实质视觉 Bug**）
  - 范围：`ui/src/ui/capability/ai-workforce-governance/pages/{assets-page,ranking-page,actions-page}.ts`
    （Shadow DOM LitElement，`static styles` 内硬编码浅色，默认深色主题下渲染为"白色孤岛"）。
  - [ ] 15.1 架构决策门禁（前置）：选定方案 A 或 B 并记入 0.1 文档。
    - **方案 A（止血）**：保留 Web Component，`static styles` 全量改消费设计 token（颜色/圆角/阴影/字体），
      修正错误 token 名，补深色；卡片/导航仍为组件私有实现但视觉对齐 token。
    - **方案 B（彻底统一）**：重写为 light-DOM 函数式 lit-html，复用基线 `enterprise-card` /
      `enterprise-segmented-nav` / 统一表格组件。
    - 未决策不得进入 15.2/15.3。
  - [ ] 15.2 token 化（P0/P1/P3，无论 A/B 都要做）：
    - 颜色硬编码 hex（`#ffffff/#111827/#e5e7eb/#3b82f6/#6b7280` 等）→ `var(--card)/--text/--border/--accent/--muted`；
    - 状态/分数徽章 pastel（`#dcfce7/#166534`、`#dbeafe/#1e40af` 等）→ `--ok/--warn/--danger` + `color-mix`；
    - 修正**错误的外来 token 名**：`--text-primary→--text`、`--text-secondary→--muted`、
      `--bg-secondary→--secondary`、`--accent` 蓝色 fallback（`#007bff`）→ 设计系统 accent；
    - 圆角/阴影 → `--radius-*`/`--shadow-*`；字体 → `--font-body`。
    - 验收：CSS 自定义属性穿透 Shadow DOM，token 化后明暗主题自动跟随，无需 `data-theme` 分支。
    - _前置：15.1_
  - [ ] 15.3（仅方案 B）重写为 light-DOM lit 模板，接入基线卡片/导航/表格组件，删除私有 `.card`/tab/table 体系。
    - _前置：15.1, 8.1, 2.4_
  - [ ]\* 15.4 明暗主题视觉回归：默认深色与浅色下，机巢治理三页背景/文本/边框/强调色均跟随 token，
    不再出现白底孤岛；主色为 accent（非蓝）。
    - _前置：15.2_

- [ ] 16. 渠道治理模块迁移（`ui/src/ui/ports/enterprise/views/enterprise-channel-credentials-surface.ts`）
  - [ ] 16.1 页眉：`card-head` 改用 `renderEnterpriseModuleHeader`，`title = t("tabs.enterpriseChannels")`、
        补 `subtitle = t("subtitles.enterpriseChannels")`，"重新加载"走标准 `refresh` 参数。
    - _前置：3.1_
  - [ ] 16.2 页壳：套用 `renderEnterprisePage`（error 走 notices 槽），与其他模块统一外壳结构。
    - _前置：无_
  - [ ] 16.3 渠道选择：`class="btn primary"` 按钮组 → 共享 `enterprise-segmented-nav`（任务 8）；
        Tab 标签用渠道**展示名**（接入既有 `channelId→label` 映射，无则补），不再显示原始技术 ID。
    - _前置：8.1_
  - [ ] 16.4 去内联 `style=`（`gap/flex-wrap/margin-top` 等全部类化，并入 2.4）；
        加载/空/错态改用统一样式（对齐数据能力中心 alert/empty）；空态给"前往平台开通"等引导。
    - _前置：2.4_
  - [ ]\* 16.5 更新该模块 `*.browser.test.ts`：标题/Tab/页壳类名断言改新组件与 i18n 标题；
    保留渠道选择/保存/重载行为断言不变。
    - _前置：16.1, 16.3_

- [x] 17. 成本与预算模块迁移（`ui/src/ui/views/cost-budget/cost-budget-page.ts` + 相关组件）
  - 现状：token 合规度高（已走 `--card/--border/--radius-lg`），但 KPI/Tab/表格/卡片各自一套词汇，
    标题/副标题硬编码绕过 i18n。
  - **IA 收敛 v2.1（Frozen）**：四 Tab 视觉 + 九 legacy subRoute、commerce/invoice/cycle-bills/todos 面板、
    `pendingOrders`-only 待办、`aorTotal > 0` analytics 显隐；设计文档
    `docs/design/openbot-enterprise-cost-budget-ia-consolidation-2026-06-19.md` §18 验收通过 — cursor-agent
  - [x] 17.1 页眉：标题改 `t("tabs.enterpriseUsage")`、副标题改 `t("subtitles.enterpriseUsage")`
        （去硬编码字面量；若用新副标题文案则更新 i18n 值，不内联）。 — cursor-agent
    - _前置：3.1_
  - [x] 17.2 KPI：`cost-budget-kpi-grid`（总览/资源/分析/控制）→ 基线 `renderEnterpriseKpiGrid`
        （计费数值可设 `tone`，部分下钻到子 Tab）。 — cursor-agent
    - _前置：4.1_
  - [x] 17.3 子 Tab：`cost-budget-tab`/`cost-budget-tabs` → 共享 `enterprise-segmented-nav`（任务 8）。 — cursor-agent
    - _前置：8.1_
  - [x] 17.4 表格：`cost-budget-table`/`cost-budget-row` → 统一表格组件（任务 10）。 — cursor-agent
    - _前置：10.2_
  - [x] 17.5 卡片归一（`cost-budget-section`/`cost-budget-plan-card` → `enterprise-card` 体系）+
        去内联 `style=`（区段标题统一 `.enterprise-section-title` 类）+ 字重收敛（并入 2.4 / 6.1）。 — cursor-agent
    - _前置：2.4, 6.1_
  - [x]\* 17.6 更新 `cost-budget-page.browser.test.ts`：标题/KPI/Tab/表格类名断言改新组件与 i18n 标题；
    保留 7 子页切换与计费数据行为断言不变。 — cursor-agent
    - _前置：17.1, 17.2, 17.3_

- [ ] 18. 系统设置模块迁移（`ui/src/ui/ports/enterprise/views/enterprise-access-control-surface.ts`）
  - [ ] 18.1 页眉：双自造页眉（`enterprise-settings-hub` + `enterprise-access-header`）→ 标准
        `renderEnterpriseModuleHeader`（主）+ `renderEnterpriseSubpageHeader`（access 等子区段）；
        **删除英文眉题 "Settings center"**（违反 header 书面规范）；标题改 `t("tabs.enterpriseSettings")` + 补 `subtitle`。
    - _前置：3.1_
  - [ ] 18.2 导航：设置中心区段导航（`enterprise-settings-card` 卡片网格 + actionbar）与 access 子 Tab
        （`enterprise-access-tabs/enterprise-access-tab`）→ 共享 `enterprise-segmented-nav`（任务 8）；
        入口卡若保留则走 `enterprise-card--interactive`。
    - _前置：8.1_
  - [ ] 18.3 卡片/列表：`enterprise-settings-card`/`enterprise-settings-panel`/`enterprise-access-list-row`/
        `enterprise-access-layout` → `enterprise-card` 体系 + 统一列表/表格（任务 10）。
    - _前置：2.4_
  - [ ] 18.4 去内联 `style=` + 字重收敛（并入 2.4 / 6.1）；token 卫生（并入 13）。
    - _前置：2.4, 6.1_
  - [ ]\* 18.5 更新该模块 `*.browser.test.ts`：页眉/区段导航/access Tab/卡片类名断言改新组件与 i18n 标题；
    保留各区段切换、权限矩阵、抽屉行为断言不变。
    - _前置：18.1, 18.2, 18.3_

## Notes

- 标 `*` 为测试/守护项；为加速可暂缓，但页眉（3.3）、KPI 组件（4.3）、企业总览（5.5）的测试强烈建议保留。
- KPI「同一组件、企业端 density 变体」原则：企业端可比平台端更轻量，但**必须是同一组件**，
  禁止在 surface 内手写 KPI 结构。
- trend / 状态色一律**图标 + 颜色双编码**，不得纯色区分（无障碍）。
- 模块页眉**禁止英文眉题与渐变卡片页眉**；标题取 `t("tabs.<tab>")`、副标题取 `t("subtitles.<tab>")`，禁止硬编码字面量。
- 本规范覆盖**全部 8 个企业端模块**（2026-06-15 专家 UI 验收）：
  T5 企业总览样板（基线参照实现）；T9 组织与数字人；T11 数据能力中心；T14 企业能力中心；
  T15 机巢治理（**高优先级，深色破图**）；T16 渠道治理；T17 成本与预算；T18 系统设置。
  基线层 T1–T4/T6/T8 与卡片/动效/焦点/字重/导航的共享组件为各模块迁移的硬前置；
  T10（共享数据表）与 T13（token 卫生）跨模块复用。模块迁移 PR 须复用基线组件，不得新造。

## Agents

| agent-id                 | role  | scope                                                         | paths                                                                                                                                                                                                                                                                                                                                                                            | since      |
| ------------------------ | ----- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| kiro-enterprise-baseline | owner | 企业端 UI 统一基线 + 企业总览样板                             | `ui/src/styles/base.css`, `ui/src/styles/enterprise-foundation.css`, `ui/src/styles/components.css`, `ui/src/ui/views/enterprise-module-header.ts`, `ui/src/ui/views/enterprise-kpi-card.ts`, `ui/src/ui/ports/enterprise/views/enterprise-overview-surface.ts`, `ui/src/ui/ports/enterprise/views/enterprise-surfaces.browser.test.ts`, `docs/design/enterprise-ui-baseline.md` | 2026-06-15 |
| kiro-mesh-governance     | owner | T15 机巢治理 Web Component 重新主题化（方案 A，token 化止血） | `ui/src/ui/capability/ai-workforce-governance/pages/assets-page.ts`, `ui/src/ui/capability/ai-workforce-governance/pages/ranking-page.ts`, `ui/src/ui/capability/ai-workforce-governance/pages/actions-page.ts`                                                                                                                                                                  | 2026-06-15 |
| kiro-capability-center   | owner | T14 企业能力中心模块迁移                                      | `ui/src/ui/views/enterprise-asset-library/enterprise-capability-center-page.ts`, `ui/src/ui/views/enterprise-asset-library/enterprise-capability-center-page.browser.test.ts`, `ui/src/styles/enterprise-components.css`                                                                                                                                                         | 2026-06-16 |
| cursor-agent             | owner | T17 成本与预算 IA 收敛 v2.1 + 基线迁移                        | `docs/design/openbot-enterprise-cost-budget-ia-consolidation-2026-06-19.md`, `ui/src/ui/views/cost-budget/**`, `ui/src/styles/cost-budget.css`, `ui/src/ui/navigation.ts`, `ui/src/i18n/locales/en.ts`, `ui/src/i18n/locales/zh-CN.ts`                                                                                                                                           | 2026-06-21 |
| cursor-auto              | owner | platform create-tenant invite code（latestInvite 契约对齐）   | `ui/src/ui/ports/platform/system-settings/page.ts`                                                                                                                                                                                                                                                                                                                               | 2026-07-13 |

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["0.1", "1.1", "3.1", "6.1"] },
    { "id": 1, "tasks": ["2.1", "3.2", "3.3"] },
    { "id": 2, "tasks": ["2.2", "2.3"] },
    { "id": 3, "tasks": ["4.1"] },
    { "id": 4, "tasks": ["4.2", "4.3"] },
    { "id": 5, "tasks": ["5.1", "5.2", "5.3", "5.4"] },
    { "id": 6, "tasks": ["5.5"] },
    { "id": 7, "tasks": ["7.1", "7.2", "7.3", "7.4"] },
    { "id": 8, "tasks": ["8.1", "8.2", "8.3"] },
    { "id": 9, "tasks": ["9.1", "9.2", "9.3", "9.4", "9.5"] },
    { "id": 10, "tasks": ["9.6", "10.1", "10.2"] },
    { "id": 11, "tasks": ["11.1", "11.2", "11.3", "11.4"] },
    { "id": 12, "tasks": ["11.5", "11.6"] },
    { "id": 13, "tasks": ["12.1", "13.1", "13.2"] },
    { "id": 14, "tasks": ["12.2", "12.3", "13.3"] },
    { "id": 15, "tasks": ["14.1", "14.2", "14.3", "14.4"] },
    { "id": 16, "tasks": ["14.5"] },
    { "id": 17, "tasks": ["15.1"] },
    { "id": 18, "tasks": ["15.2", "15.3"] },
    { "id": 19, "tasks": ["15.4"] },
    { "id": 20, "tasks": ["16.1", "16.2", "16.3", "16.4"] },
    { "id": 21, "tasks": ["16.5"] },
    { "id": 22, "tasks": ["17.1", "17.2", "17.3", "17.4", "17.5"] },
    { "id": 23, "tasks": ["17.6"] },
    { "id": 24, "tasks": ["18.1", "18.2", "18.3", "18.4"] },
    { "id": 25, "tasks": ["18.5"] }
  ]
}
```
