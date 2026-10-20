# 平台端统一 UI 规范（Platform UI Spec）

> **状态：平台端 UI 唯一验收基准 · 已由专家团队批准、正式生效（2026-06-15，8/8 模块完成）。** 后续平台端 UI 变更以本规范为准绳。

适用范围：平台端（Platform Port）全部模块的主页面与二级页面。目标是建立**现代化、简约、全栈统一**的设计语言。本规范在「平台总览」模块落地，并作为后续模块（租户管理、套餐与定价、能力中心、模型管理、资产管理、高级治理、系统设置）逐一验收的基准。

死代码清理（与本规范配套）：见 `docs/design/platform-dead-code-consolidated-2026-06-15.md`（已批准，严格两步走、独立 PR；第二步以「跨端消费核验」为硬性前置闸门）。

---

## 1. 设计原则

1. **简约优先**：界面只承载「数据 + 动作」，不承载「释义」。删除一切解释面板用途的整句描述性文案。
2. **统一语言**：所有模块复用同一套设计令牌、卡片结构、状态色与间距节奏，不允许各模块自造样式。
3. **层级清晰**：一屏之内信息有主次，避免等权平铺；同一数据不在同屏重复出现。
4. **交互友好**：可点击区域有 hover 反馈，状态色一眼可辨，空态有明确指引。

---

## 2. 设计令牌（唯一色彩 / 圆角 / 阴影来源）

禁止硬编码颜色/圆角/阴影，一律使用 CSS 变量：

| 类别 | 令牌                                                      | 用途                                  |
| ---- | --------------------------------------------------------- | ------------------------------------- |
| 文本 | `--text-strong` / `--text` / `--muted`                    | 标题 / 正文 / 次要说明                |
| 容器 | `--card` / `--secondary` / `--border` / `--border-strong` | 卡片底 / 内嵌块底 / 边框 / hover 边框 |
| 强调 | `--accent`                                                | 链接、主图标底色                      |
| 状态 | `--ok` / `--warn` / `--danger`                            | 正常 / 关注 / 告警                    |
| 圆角 | `--radius-sm/md/lg/full`                                  | 统一圆角档位                          |
| 阴影 | `--shadow-sm` + `inset 0 1px 0 var(--card-highlight)`     | 卡片标准阴影                          |

状态底色统一用 `color-mix(in srgb, var(--<tone>) 12~16%, var(--card))`，前景用 `var(--<tone>)`。

---

## 3. 状态色语义（三态制）

只使用三种状态色，禁止引入第四种语义色：

- **ok（绿）**：健康、正向增长、达成。
- **warn（黄）**：需要关注、待补齐、成本上升。
- **danger（红）**：告警、失败、到期/暂停。
- 中性数据不着色（使用 `--text-strong`）。

**趋势着色按业务语义**，而非单纯方向：

- 规模型指标（调用量、租户、能力）上升 = ok，下降 = warn。
- 成本型指标（成本、错误率）上升 = warn，下降 = ok。
- 持平 = 中性。

---

## 4. 页面骨架

```
platform-surface
├── platform-surface-header   标题 + 一句话副标题 + 右上动作区
└── platform-surface__body    模块内容（gap 18px 网格）
```

- **页头副标题**：每个模块保留**一行**模块定位语（导航语义），这是模块身份，不属于「释义性内容」，予以保留并跨模块统一为一行。
- **页头动作区**：动作按钮语义必须与当前页面 scope 一致。
  - 「刷新数据」可出现在任何有远程数据的模块。
  - 「导出报表」只出现在导出内容与页面 scope 一致的模块（例如租户清单导出仅在「租户管理」）。**禁止**在 A 页面导出 B 页面的数据。

---

## 5. 组件规范

### 5.1 KPI 指标卡（metric-card）

- 结构固定：`图标(左) + 趋势 chip(右) / 标签 / 数值 / meta`，**所有卡片结构一致**。
- **不在 KPI 卡内放迷你折线图（sparkline）**：曾经只有部分卡片有 sparkline，造成视觉参差。统一移除，趋势用 chip 表达。
- 数量控制在 **4–6 张**，按语义分组；避免 7+ 张等权平铺。
- 卡片可点击则整卡为链接，hover 时 `border-color: var(--border-strong)`。

### 5.2 健康条（health-bar）

- 专注**可用性/健康**语义，指标控制在 **4 项**一行（如 Runtime / 模型提供方 / 分发通道 / 错误率）。
- **不与 KPI 卡重复**：成本、版本等「经营/状态」指标归 KPI，不在健康条重复出现。

### 5.3 面板（panel）

- 结构：`panel-header(标题 + 可选徽标 + 可选「查看全部」链接) + 内容`。
- **不写描述性副标题**（`panel-subtitle`）。面板用途由标题 + 内容自解释。
- 计数类信息用 `panel-badge`（带状态色），不用整句文字描述。

### 5.4 空态（empty state）

- 虚线边框容器 + 图标 + 一行标题 + 一行指引动作，保持克制。

### 5.5 卡片交互基线（全栈复用）

所有可点击卡片（KPI 卡 / 健康指标 / 快捷入口卡）统一使用以下微交互，禁止硬切：

```css
transition:
  border-color var(--duration-fast) var(--ease-out),
  box-shadow var(--duration-fast) var(--ease-out),
  transform var(--duration-fast) var(--ease-out);

/* hover：边框强化 + 轻微悬浮 + 阴影抬升 */
:hover {
  border-color: var(--border-strong);
  box-shadow: var(--shadow-md);
  transform: translateY(-1px);
}

/* 键盘可达：可见焦点环，移除默认 outline */
:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}
```

### 5.6 KPI 卡双轨说明（已固化，代码不合并）

平台端 KPI 存在**两条受控并行的卡语言**，均为合法基线，**不强制合并**：

1. **`metric-card` / `platform-capabilities__summary-card` 语言**（首选）：`图标块(36×36 圆角，状态色) + label + value + meta`。已统一用于：平台总览、租户管理、套餐与定价（含经营分析/经营仪表盘）、资产管理、高级治理、系统设置。新建 KPI 一律用此。
2. **通用 `.stat` 原语**（受控保留）：`label + value`，是**全 App 共享原语**（员工端/企业端通用）。模型管理 live 路径沿用 `.stat`；高级治理「使用」tab 也用 `.stat`。**不强改为 metric-card**，以免 App 级连锁。

判定：平台专属 KPI 用语言 1；跨端共享/已大面积使用 `.stat` 的场景维持语言 2。

### 5.7 共享原语 `platform-capabilities__*`（跨模块复用）

`platform-capabilities__*` 是一套**已沉淀的共享 UI 原语**，被能力中心、资产管理、高级治理、系统设置共同复用，包括：

- `__summary` / `__summary-card` / `__summary-icon`（带图标 KPI 卡）
- `__distribution` / `__distribution-table` / `__sortable-header`（数据表 + 排序表头）
- `__empty` / `__empty-icon`（空态）
- `__chip`、`__tab`（状态片、标签）

**规则**：跨模块的 KPI 卡 / 数据表 / 空态**优先复用这套原语**，不要各模块自造同义类。改动这些类属**全栈影响**，需评估所有消费方。

---

## 6. 间距、字重与响应式

### 6.1 字重规范（两档制）

只使用 **600 / 700** 两档字重，禁止 650/680/720/750/760 等「伪精度」值（系统字体栈下会回退且跨平台不稳）：

- **700**：标题、数值、KPI value、卡片标题（panel-title / metric-value / quick-label）。
- **600**：次级标签、链接、chip、meta（metric-label / panel-link / trend / attention-title）。

### 6.2 间距

- 模块级网格 gap：`18px`；卡片内 gap：`12px`。
- 卡片内边距：`18px`；内嵌小块：`10~12px`。

### 6.3 响应式断点

- 健康指标网格用 `repeat(auto-fit, minmax(160px, 1fr))` 自适应，避免末行单格。
- `≤1100px`：双栏 shell、健康条塌缩为单列。
- `≤760px`：页头动作区换行、KPI/快捷网格单列。

---

## 7. 文案与命名规范

### 7.1 清除释义性内容

- **删除**：解释面板/区块「是什么、为什么、怎么用」的整句描述。
- **保留**：标题、数据、状态、动作标签、空态指引。
- 避免在标题/锚点中使用破折号与撇号（兼容 Mintlify 锚点）。

#### 7.1.1 保留白名单（不算「释义性内容」，禁止误删）

下列副标题/说明承载功能价值，**予以保留**：

1. **数据 / 参数化**：含动态值或插值的副标题（如 `${plan.name}`、`已选 X 个 / 全部`、统计周期 `start → end`、`X 个在线 · Y 台主机`）。
2. **空态指引**：`__empty` 容器内的标题 + 一行下一步指引。
3. **登录 / 权限门禁引导**：如「创建租户需平台管理权限，请先切换到平台管理员账号」。
4. **动作后果警告**：可能造成影响/不可逆/降级的操作说明（如网关服务端更新、强制 MFA 关闭风险、删除版本确认、提交到平台默认配置的影响）。
5. **跨模块指引**：指向另一模块完成配置的提示（如「Provider 凭证由模型治理模块管理」「凭证已迁移企业端」）。
6. **表单/向导分步引导**：创建类多步表单（如 create-tenant 向导）的 section 引导，表单场景予以保留。

判定口径：**纯静态「介绍此面板用途」的整句 → 删**；上述 6 类 → 留。

### 7.2 模块命名规范（canonical，唯一权威词）

同一模块在**侧边栏导航、页头标题、i18n（zh-CN / en）、跳转文案**四处必须完全一致，不允许同义词漂移。

| tab                      | 规范中文   | 规范英文            |
| ------------------------ | ---------- | ------------------- |
| `platformDashboard`      | 平台总览   | Platform Overview   |
| `platformTenants`        | 租户管理   | Tenant Management   |
| `platformPricing`        | 套餐与定价 | Plans & Pricing     |
| `platformCapabilities`   | 能力中心   | Capability Center   |
| `platformModels`         | 模型管理   | Models              |
| `platformAgents`         | 资产管理   | Asset Management    |
| `platformAdvanced`       | 高级治理   | Advanced Governance |
| `platformSystemSettings` | 系统设置   | System Settings     |

- 「能力市场」是**能力中心内部的子标签/概念**（员工/岗位/平台能力市场），不是模块名；模块名一律「能力中心」。
- 历史词「机器人运行资产 / 高级控制 / 能力市场（作模块名）」已废弃。

---

## 8. 「平台总览」落地记录（基准样例）

| 优化项                | 处理                                                                         |
| --------------------- | ---------------------------------------------------------------------------- |
| 健康条 ↔ KPI 指标重复 | 健康条收敛为可用性四项（Runtime/提供方/通道/错误率）；成本、版本仅保留在 KPI |
| KPI 数量与层级        | 8 张 → 6 张（去除「运行主机」「平台关注」重复卡）；关注项由专属面板承载      |
| sparkline 不一致      | 全量移除 KPI sparkline，卡片结构统一                                         |
| 趋势色彩失效          | 按业务语义着色（调用↑=ok，成本↑=warn）                                       |
| 导出语义错位          | 「导出报表」仅在租户管理出现，总览仅保留「刷新数据」                         |
| 释义性副标题          | 移除关注项/快速入口/平台观察/贡献榜的描述性副标题                            |
| 健康指标布局          | 网格改为 `auto-fit minmax(160px,1fr)` 自适应                                 |
| 导航 ↔ 页头命名不一致 | 锁定 canonical：能力中心 / 高级治理；统一 i18n、侧边栏、页头四处             |
| 卡片缺微交互/焦点态   | KPI/健康/快捷卡统一加 transition + hover 悬浮 + `:focus-visible` 焦点环      |
| 伪精度字重            | 总览相关字重归并到 600/700 两档                                              |
| 贡献榜生产不可达      | 修复 `contributionLeaderboards` 未接线：现代 VM 直接构建，生产可见           |
| VM 体积虚胖           | 删除从不读取的 `legacyMetrics/legacyAttention/legacyQuickLinks` 字段         |

涉及文件：

- `ui/src/ui/ports/platform/view-models/builders.ts`
- `ui/src/ui/ports/platform/view-models/types.ts`
- `ui/src/ui/ports/platform/dashboard/page.ts` 及 `dashboard/sections/*`
- `ui/src/ui/ports/platform/views/platform-surfaces.ts`
- `ui/src/ui/app-render.helpers.ts`
- `ui/src/i18n/locales/zh-CN.ts`、`ui/src/i18n/locales/en.ts`
- `ui/src/styles/components.css`

> 待办（后续低优先）：`renderLegacyDashboard` 降级渲染路径仅在 `pageViewModels` 缺省时触发（生产恒由 `render-model.ts` 注入，不可达），目前为 `port-shells` 等导航行为测试提供兜底；后续可在补齐这些测试的现代 VM 后收敛为单一渲染路径。

---

## 9. 「租户管理」落地记录

| 优化项             | 处理                                                                                                                         |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| 图标体系不统一     | KPI 卡 ASCII 字符图标（T/$/!/↗…）与行内 Unicode 字形（▥/⋯/⧖/⏸/▶/⚠）全部替换为共享 SVG（`renderIcon`）                        |
| KPI 卡结构对齐总览 | 卡片改为「图标块（36×36 圆角方形，状态色）+ label + value + meta」竖向结构，与总览同一卡语言                                 |
| 释义性内容         | 删除详情 8 个 tab 的长句说明、工作区副标题、完整创建页副标题、抽屉「数据接入说明」整段                                       |
| 伪精度字重         | metric-value 750→700、table-primary 680→700、th/kicker/summary-label 650→600                                                 |
| 卡片/行交互基线    | 可点击 KPI 卡 + 表格行 + 分段/详情/分页按钮统一加 transition + hover + `:focus-visible`；表格行补 hover/选中底色与键盘焦点环 |
| 装饰性空 sparkline | 删除增长列空渐变 div，仅保留趋势色标签                                                                                       |

涉及文件：

- `ui/src/ui/ports/platform/tenants/page.ts`
- `ui/src/styles/components.css`
- `ui/src/ui/ports/port-shells.browser.test.ts`（同步断言）

---

## 10. 「套餐与定价」落地记录

| 优化项               | 处理                                                                                                                                                                                                                                          |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 释义性内容           | 移除子 Tab 下方 `tab-hint` 整段说明（pricing + resource-catalog 两层）、prereq banner 说明句；保留 button `title` tooltip                                                                                                                     |
| `card-sub` 激进清理  | 删除纯释义副标题（资源目录/能力/成本版本/创建套餐/credit ladder/policies/modelsByTier/planMargin/ledger/economics 等）；保留含数据的（单元经济=套餐名、`economicsPreviewSub`={credits}、周期、删除确认警告、binding-diff 状态、section 标签） |
| KPI 卡统一（三模块） | 经营仪表盘 + 经营分析 KPI 由 `label/value/sub` 小卡升级为统一 metric-card 语言（36×36 图标块 + label + value + meta），与总览/租户同源；KPI 配图标                                                                                            |
| 伪精度字重           | pricing/resource-catalog 全量 650→600、720/750→700（tier-name/policy-name/preview-credits/operating-plan-name/adoption-plan-name 等）                                                                                                         |
| 交互基线             | `tab-segment-btn`、`plan-card` 补 transition + `:focus-visible`；圆角/阴影改用 `--radius-lg`/`--shadow-md`（去硬编码 12px / 0 2px 8px）                                                                                                       |

涉及文件：

- `ui/src/ui/ports/platform/pricing/page.ts`
- `ui/src/ui/ports/platform/pricing/pricing-operating-dashboard.ts`
- `ui/src/ui/ports/platform/pricing/economics-section.ts`
- `ui/src/ui/ports/platform/pricing/resource-catalog-section.ts`
- `ui/src/styles/components.css`
- `ui/src/ui/ports/platform/pricing/page.browser.test.ts`、`views/platform-pricing-shell.browser.test.ts`（同步断言）

> 说明：`platform-pricing__kpi` 现为统一 metric-card 结构，三模块（平台总览 / 租户管理 / 套餐与定价）KPI 卡视觉语言已完全统一。

---

## 11. 「能力中心」落地记录

底子较好：已全程 SVG 图标、空态规范、KPI 以 Tab 计数承载（主路径无独立 KPI 卡，无需统一）、主 chrome 无释义副标题。本轮聚焦字重、交互基线与 token。

| 优化项                   | 处理                                                                                                                                                                                                                                                                                           |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 字重伪精度（P2）         | capabilities 全量 650→600、750→700（distribution 表头/名称/覆盖值、card-metric value/label、tab-label/chip-label、hero-button、card-primary-action、model-assets-summary value、review-header 等）                                                                                             |
| 交互基线（P3）           | `__tab` 补 transition + hover + `:focus-visible`；`__segment` 补 `:focus-visible`；`__category-chip` 补 transition + hover；为 chip/hero-button/card-action/card-primary-action/card-status/search-clear/sortable-header/distribution-action/health-item-action 统一补 `:focus-visible` 焦点环 |
| token 化（P6）           | `__segment` 硬编码 `border-radius:16px`→`--radius-lg`、`color-mix(...white)`→`--secondary`、`160ms`→`--duration-fast`、`box-shadow 0 10px 24px`→`--shadow-md`；`__discovery-item` 过渡令牌化；review-check 状态色 `#22c55e/#f59e0b/#ef4444`→`--ok/--warn/--danger`                             |
| 状态符 SVG 化（P-minor） | 审阅校验 `✓/⚠/✗` Unicode → `renderIcon`(checkCircle/alertCircle/alertTriangle)，并加 `__review-check-icon` 尺寸与状态色                                                                                                                                                                        |

涉及文件：

- `ui/src/ui/ports/platform/capabilities/page.ts`
- `ui/src/styles/components.css`

---

## 12. 「模型管理」落地记录

模块大、live 路径用通用 `.stat` KPI 原语（非 metric-card）。经确认 KPI 语言**保留 `.stat`**（不强改，避免 App 级连锁）。

| 优化项                    | 处理                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `card-sub` 激进清理（P1） | 移除 live sections 约 20 处纯释义副标题（Provider 管理 / 模型目录对照 / Provider 接入健康 / 平台标准模型配置 / 智能路由中心 / 任务方案中心 / Task Plan Table / Governance Overview / 问题列表 / Risk Detection / Asset·Plan·Policy Optimization / By Model·Task·Plan / 使用观测中心 / 筛选区 / 详情区 等）。保留：含数据/参数化（如所选模型列表、`${plan.name}`）、空态描述、错误提示、动作后果警告（提交到平台默认配置） |
| KPI 语言（P-KPI）         | 维持通用 `.stat`（`.stat-value` 已 700）；不改 metric-card                                                                                                                                                                                                                                                                                                                                                                |
| 交互基线（P3）            | 共享 `platform-module-tab` 补 `:focus-visible`（同时惠及资产管理模块）；live 可点击元素以 `.btn`/`.stat`(展示态) 为主，焦点由全局样式承载                                                                                                                                                                                                                                                                                 |
| 字重（P2）                | live 路径字重由全局原语（`.card-title` 600 / `.stat-value` 700）承载，无模块内非标字重                                                                                                                                                                                                                                                                                                                                    |

死代码：发现 11 个未被 live 引用的组件/区块（`ModelsOverviewSection`、`ModelKpiGrid`、`ModelSummarySection`、`RoutingHealthPanel`、`TopModelPanels`、`GovernancePreviewPanel`、`ModelMatchingSection`、`ModelAllowlistSection`、`ModelPolicySection`、`ModelRoutingSection`、`ModelOverrideSection`）。**本轮不删除**，详见汇总文档 `docs/design/platform-dead-code-consolidated-2026-06-15.md`。

涉及文件：

- `ui/src/ui/ports/platform/models/sections/{AorIntegrationPanel,ModelUsageAnalyticsSection,ModelGovernanceSection,ModelCatalogSection,ModelProviderHealthSection,ModelProviderSection,ModelPoolSection,ModelTaskPlansSection,SmartRoutingSection,ModelAssetsSection}.ts`
- `ui/src/styles/components.css`（`platform-module-tab:focus-visible`）
- `ui/src/ui/ports/port-shells.browser.test.ts`（同步断言）

---

## 13. 「资产管理」落地记录

底子好：live 页复用 `platform-capabilities__*` 设计系统（KPI summary 卡含 SVG 图标）+ `platform-module-tab`（已含 focus），专属 `platform-agents-runtime.css` 字重已是 600/700。

| 优化项                     | 处理                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `card-sub` 清理（P1）      | 删除 5 处静态副标题：策略中心 4 张策略卡（`renderPolicyCard` 移除 `sub` 形参 + 4 个 `sub:` 实参）+ 治理问题卡"由策略检测器实时计算…"。保留生命周期分组副标题（状态机数据）、toolbar 状态（数据）、空态                                                                                                                                                   |
| 字形图标 SVG 化（P-minor） | 治理问题列表 `⚠`（×3）→ `renderIcon("alertTriangle")` + `__issue-icon` 尺寸                                                                                                                                                                                                                                                                              |
| token 化（P6）             | `platform-agents-runtime.css` 状态色块（signal-list warn/danger/ok 硬编码 hex）→ `color-mix(var(--warn/danger/ok)…)`；强调蓝 `rgba(37,99,235,…)`（toolbar/bulk/selected/expanded/focus/bucket）→ `color-mix(var(--accent)…)`；阴影 `rgba(0,0,0,…)` → `var(--shadow-sm)`；error 态 `#fef2f2/#fecaca` → danger color-mix。**保留**装饰性头像渐变（按确认） |

死代码：`agents/sections/{AgentSummary,AgentDistribution,AgentWorkspace,AgentFleet}Section.ts` + `agents/adapter.ts` + `agents/view-model.ts`（legacy VM 路径，live 页走 runtime-canonical）零引用。**本轮不删除**，详见汇总文档 `docs/design/platform-dead-code-consolidated-2026-06-15.md`。

涉及文件：

- `ui/src/ui/ports/platform/agents/page.ts`
- `ui/src/styles/platform-agents-runtime.css`

---

## 14. 「高级治理」落地记录

live 页内联渲染 7 Tab，复用 `platform-capabilities__*` + `platform-module-tab`。

| 优化项                   | 处理                                                                                                                                                                                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `card-sub` 清理（P1）    | 删除 4 个 tab header 静态副标题（通道/设备/会话/日志）+ 展开通道治理详情的「治理动作」纯解释项。保留：实例/使用/路由 header（数据）、展开通道顶部 callout（含"凭证已迁移企业端"，有指引且被测试断言）、「连接器定位」（可载 `channelMeta.description` 数据） |
| 命名 canon（P-naming）   | summary `aria-label` "高级控制总览"→"高级治理总览"；tab bar "高级控制模块"→"高级治理模块"                                                                                                                                                                    |
| KPI 卡补图标（P-KPI）    | summary 卡接入 `platform-capabilities__summary-icon` + SVG（cable/smartphone/messagesSquare/fileText/server/activity/compass），与资产管理 KPI 卡彻底统一                                                                                                    |
| 使用 tab 规整（P-usage） | 「平台使用概览」由裸 div + 内联 `font-size/font-weight` 手搓 4 列 → `.stat-grid`/`.stat` 原语，与全栈 KPI 一致                                                                                                                                               |

死代码：`advanced/sections/{AdvancedChannels,AdvancedDomains,AdvancedRuntime,AdvancedSummary,AdvancedUsage}Section.ts` + `advanced/view-model.ts` + `advanced/adapter.ts` 零引用。**不删除**，详见汇总文档 `docs/design/platform-dead-code-consolidated-2026-06-15.md`。

涉及文件：

- `ui/src/ui/ports/platform/advanced/page.ts`

---

## 15. 「系统设置」落地记录（平台端收官）

底子好：summary KPI 卡已用 `platform-capabilities__summary-card` + SVG 图标（与全栈统一）；tab 用 `platform-module-tab`；命名「系统设置」正确；无字形图标。

| 优化项                | 处理                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `card-sub` 清理（P1） | 删除 8 处静态释义副标题：租户创建默认策略 / 模型管理运行模式 / 试用策略 / 安全态势 / 审计事件流 / 安全策略（计划中）/ 平台 API Key / 平台 Token（计划中）。**保留**：登录门禁引导（创建租户需平台管理权限等）、动作后果警告（网关服务端更新、强制 MFA 关闭风险）、跨模块指引（Provider 凭证由模型治理管理）、数据副标题（当前用户·角色）、create-tenant 向导的表单分步引导（表单场景保留指引） |

死代码：`system-settings/sections/{Console,QuickActions,Summary}Section.ts` + `system-settings/adapter.ts` 零引用。**不删除**，详见汇总文档 `docs/design/platform-dead-code-consolidated-2026-06-15.md`（特别标注 `route.ts`/`create-tenant-drawer.ts`/`view-model.ts` 仍被 live/租户页引用，勿误删）。

涉及文件：

- `ui/src/ui/ports/platform/system-settings/page.ts`

---

## 平台端 UI 验收总结（8/8 完成）

| #   | 模块       | 状态 |
| --- | ---------- | ---- |
| 1   | 平台总览   | ✅   |
| 2   | 租户管理   | ✅   |
| 3   | 套餐与定价 | ✅   |
| 4   | 能力中心   | ✅   |
| 5   | 模型管理   | ✅   |
| 6   | 资产管理   | ✅   |
| 7   | 高级治理   | ✅   |
| 8   | 系统设置   | ✅   |

统一成果：模块命名 canon、KPI 卡语言（icon + label + value + meta / `.stat` 受控保留）、卡片交互基线（transition + hover + `:focus-visible`）、600/700 两档字重、状态三态色 token 化、清除释义性内容。

待办（已汇总为一份决策文档 `docs/design/platform-dead-code-consolidated-2026-06-15.md`，待专家评估后统一清理）：模型管理 / 资产管理 / 高级治理 / 系统设置 各自的 legacy section + VM + adapter 死代码。
