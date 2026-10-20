# 企业端 UI 统一基线（Enterprise UI Baseline）

> **状态**：基线规范（前置文档）
> **Spec**：`.kiro/specs/enterprise-ui-baseline/tasks.md`（Task 0.1）
> **适用范围**：企业端 8 个一级模块（企业总览 / 组织与数字人 / 企业数据能力中心 /
> 企业能力中心 / 机巢治理 / 渠道治理 / 成本与预算 / 系统设置）
> **不适用**：平台端（`ui/src/ui/ports/platform/**`）—— 本基线**不触碰**平台端文件。

本文件固化企业端「现代化简约、全栈统一」设计语言的**强制约定**：token 别名映射、
类名规范、组件签名、字重两档规范、可交互/非交互卡片的 hover/focus 约定。
后续 7 个模块的迁移 PR **必须复用**本文件定义的类与组件，**不得新造并行体系**；
每个模块迁移 PR 的描述需**链接本文件**作为引用依据。

---

## 0. 设计原则（不可协商）

1. **复用既有 foundation，禁止再造并行卡片体系。** 企业端已有
   `ui/src/styles/enterprise-foundation.css` 的 `.enterprise-card` 基元；新模块直接复用，
   不得自造 `.xxx-snapshot__item`、`.xxx-card` 等平行类。
2. **不新增颜色 token。** `ui/src/styles/base.css` 已定义完整颜色 / 语义色 / 圆角 / 阴影 /
   动效 / 焦点令牌。语义色一律引用既有 `--ok / --warn / --danger`，需要弱化时用 `color-mix`。
3. **动效与焦点统一走令牌。** 禁止硬编码 `160ms ease`、`transition: all 0.2s` 等魔法值；
   一律引用本文件 §1 定义的 `--transition-interactive` 与既有 `--focus-ring`。
4. **状态色双编码（无障碍）。** 任何 trend / 状态指示**必须图标方向 + 颜色双编码**，
   不得仅靠纯色区分。
5. **字重只用两档：`600` / `700`。** 禁止 `760 / 740 / 720 / 680 / 640` 等伪精度字重。
6. **可交互与非交互卡片在视觉上必须可区分。** 仅可点击/可聚焦的卡片才有 hover 抬升与焦点环；
   非交互卡片**禁止** hover 抬升（避免误导，见 §5）。

---

## 1. Token 别名映射

本基线**只新增一个语义别名**，其余全部引用 `ui/src/styles/base.css` `:root` 中的既有 token。

### 1.1 新增别名（定义在 `base.css` 的 `:root`）

```css
/* 交互卡片统一过渡：边框 / 阴影 / 位移三属性，全部走既有 duration + ease 令牌 */
--transition-interactive:
  border-color var(--duration-normal) var(--ease-out),
  box-shadow var(--duration-normal) var(--ease-out),
  transform var(--duration-normal) var(--ease-out);
```

> 该别名是企业端所有可交互卡片过渡的**唯一来源**。任何需要过渡的可交互卡片都引用它，
> 不得就地展开三属性或硬编码时长/缓动。

### 1.2 直接引用的既有 token（**不新增**）

| 用途        | Token               | 当前值（dark / light）                       |
| ----------- | ------------------- | -------------------------------------------- |
| 过渡时长    | `--duration-normal` | `200ms`                                      |
| 过渡缓动    | `--ease-out`        | `cubic-bezier(0.16, 1, 0.3, 1)`              |
| 焦点环      | `--focus-ring`      | `0 0 0 2px var(--bg), 0 0 0 4px var(--ring)` |
| 悬停阴影    | `--shadow-md`       | dark `0 4px 12px …` / light `0 4px 12px …`   |
| 强化边框    | `--border-strong`   | dark `#3f3f46` / light `#d4d4d8`             |
| 语义 - 正常 | `--ok`              | dark `#22c55e` / light `#16a34a`             |
| 语义 - 警告 | `--warn`            | dark `#f59e0b` / light `#d97706`             |
| 语义 - 危险 | `--danger`          | dark `#ef4444` / light `#dc2626`             |
| 圆角        | `--radius-lg`       | `12px`                                       |

> 规则：当 `--transition-interactive` 引用 `--duration-normal`（200ms）时，**不要**再就地写
> `--duration-normal, 150ms` 之类的回退魔法值——令牌已在 `:root` 保证存在。

---

## 2. 类名规范

所有类名定义在 `ui/src/styles/enterprise-foundation.css`，按 BEM 风格命名。

### 2.1 卡片基元

| 类名                            | 语义                                                                                                                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `.enterprise-card`              | 卡片基元（背景 / 圆角 / 边框 / 内边距 / `--shadow-sm`）。**非交互卡片只用这一个类。**                                                                                    |
| `.enterprise-card--interactive` | 可交互修饰符：`cursor:pointer; text-decoration:none; color:inherit; transition: var(--transition-interactive);`，并附 `:hover` 抬升与 `:focus-visible` 焦点环（见 §5）。 |
| `.enterprise-card--flat`        | 既有变体：去阴影。                                                                                                                                                       |
| `.enterprise-card--compact`     | 既有变体：紧凑内边距。                                                                                                                                                   |
| `.enterprise-card.is-ok`        | 语义色左/全边框染 `--ok`（用 `color-mix` 弱化）。                                                                                                                        |
| `.enterprise-card.is-warn`      | 语义色边框染 `--warn`。                                                                                                                                                  |
| `.enterprise-card.is-danger`    | 语义色边框染 `--danger`。                                                                                                                                                |

**组合用法：**

- 可点击卡片（`<a>` / `<button>` / `role` 可聚焦元素）：
  `class="enterprise-card enterprise-card--interactive"`，需要状态色时再叠 `is-warn` 等。
- 非交互卡片（纯 `<div>` 展示）：`class="enterprise-card"`，**不加** `--interactive`。

### 2.2 KPI 卡组

| 类名                             | 语义                                                                                          |
| -------------------------------- | --------------------------------------------------------------------------------------------- |
| `.enterprise-kpi-grid`           | KPI 容器，`display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));`。      |
| `.enterprise-kpi-card`           | 单个 KPI 项的根（在 `enterprise-card` 之上）；有 `href` 时叠 `enterprise-card--interactive`。 |
| `.enterprise-kpi-card__icon`     | 可选图标位。                                                                                  |
| `.enterprise-kpi-card__label`    | 标签：`12px`，`--muted`，字重 `600`。                                                         |
| `.enterprise-kpi-card__value`    | 数值：`24px`，字重 `700`，`letter-spacing:-0.02em`。                                          |
| `.enterprise-kpi-card__trend`    | 趋势 chip：图标方向 + 颜色**双编码**（禁止纯色区分）。                                        |
| `.enterprise-kpi-card__arrow`    | 下钻箭头（仅可交互卡片显示）。                                                                |
| `.enterprise-kpi-card.is-active` | 选中态（「KPI 即筛选器」）：accent 边框 + 轻 accent 底色，见 §5.3。                           |

> 原则：企业端 KPI 可比平台端更轻量，但**必须是同一组件**（见 §3.2）；
> 禁止在任一 surface 内手写 KPI 结构。

### 2.3 模块页眉（既有类，复用）

| 类名                                  | 语义                                           |
| ------------------------------------- | ---------------------------------------------- |
| `.enterprise-module-header`           | 主导航模块页眉容器。                           |
| `.enterprise-module-header__copy`     | 标题 + 副标题文案块。                          |
| `.enterprise-module-header__trailing` | 右侧操作区（刷新、导出、主操作）。             |
| `.enterprise-page__title`             | 标题：`22px`，字重 `700`，`line-height:1.2`。  |
| `.enterprise-page__subtitle`          | 副标题：`13px`，`--muted`，`line-height:1.5`。 |

#### 2.3.1 页眉书面约定（可 review / 可校验，强制）

以下为**可逐条勾选**的页眉硬性规范，迁移各模块时由 PR 评审逐项核对：

- **禁止英文眉题（kicker / eyebrow）。** 模块页眉不得出现英文眉题字面量，
  例如系统设置的 `"Settings center"`（见 Task 18.1，迁移时一并删除）。页眉文案一律走 i18n。
- **禁止渐变卡片页眉（gradient-card header）。** 不得用渐变背景卡片包裹页眉；
  页眉统一走 `renderEnterpriseModuleHeader`（主）/ `renderEnterpriseSubpageHeader`（子区段），
  不得自造带 `linear-gradient(...)` 的页眉容器。
- **标题取 `t("tabs.<tab>")`。** 标题必须来自 i18n 的 `tabs.<tab>` 键
  （例如 `t("tabs.enterpriseOverview")`），与左侧一级导航名保持一致。
- **副标题取 `t("subtitles.<tab>")`。** 副标题必须来自 i18n 的 `subtitles.<tab>` 键
  （例如 `t("subtitles.enterpriseOverview")`）。
- **禁止硬编码标题字面量。** 页眉标题 / 副标题不得直接写中英文字面量绕过 i18n；
  如需新文案，先在 i18n 资源中补键值，再在页眉引用，不得内联硬编码。

> 校验锚点：迁移模块的页眉调用处应只出现 `t("tabs.…")` / `t("subtitles.…")`，
> 不应出现引号包裹的标题字面量，亦不应出现英文眉题或 `linear-gradient` 页眉容器。

### 2.4 唯一卡片基元约定（源自数据能力中心 P4：`.card` 与 `.enterprise-card` 并行）

企业端历史上同时存在泛化 `.card` 与模块化 `.enterprise-card` 两套卡片体系。基线**收敛为单一基元**：

- **模块级卡片统一用 `.enterprise-card`。** 所有企业端模块卡（KPI 卡、治理卡、区段卡、入口卡等）
  一律基于 `.enterprise-card`（可交互时叠 `.enterprise-card--interactive`，见 §2.1 / §5）。
- **泛化 `.card` 仅作底层通用原语。** `.card` 保留为最底层的通用容器原语，
  **新代码不得直接用于模块卡**；迁移时把模块内的 `.card` 用法替换为 `.enterprise-card` 体系。

**`.card-title` / `.card-sub` → 基线映射（迁移替换内联用法时使用）：**

| 旧类          | 旧语义       | 迁移到基线                                                                   |
| ------------- | ------------ | ---------------------------------------------------------------------------- |
| `.card-title` | 卡片标题文案 | **700 档**字重（与 `.enterprise-card` 标题一致：字重 `700`，对齐 §4 两档）。 |
| `.card-sub`   | 卡片说明文案 | `--muted`，`12px`（次级说明文案）。                                          |

> 替换原则：迁移时把内联 `.card-title` / `.card-sub` 用法替换为 `.enterprise-card` 内的
> 标题（700 档）/ 说明（`--muted` 12px）结构，不再保留泛化 `.card-*` 文案类。

**禁止内联 `style=`（强制）：**

- 模块卡的**间距 / 对齐一律走类**，不得用内联样式。
- 反例（禁止）：`style="margin-top: 12px"`、`style="display:flex; gap:8px"` 等。
- 正例：用 foundation 中的间距 / 布局类（如 `.enterprise-card--compact`、section 间距类）表达，
  需要新间距时在 `enterprise-foundation.css` 中补类，而非内联。

---

## 3. 组件签名（TypeScript）

### 3.1 模块页眉 `renderEnterpriseModuleHeader`

文件：`ui/src/ui/views/enterprise-module-header.ts`

```ts
export type EnterpriseModuleHeaderProps = {
  title: string;
  /** 主导航模块建议必填；最多一行，13px muted */
  subtitle?: string;
  /** 标准刷新按钮：传入即渲染，pending 时禁用并显示「刷新中…」 */
  refresh?: { onRefresh: () => unknown; pending?: boolean };
  /** 标题右侧附加操作（导出等），可与 refresh 叠加 */
  trailing?: TemplateResult;
};

export function renderEnterpriseModuleHeader(props: EnterpriseModuleHeaderProps): TemplateResult;
```

**刷新按钮约定（组件内部渲染，模块不得自造裸 `<button>刷新</button>`）：**

```ts
// btn btn--sm + refreshCw 图标 + pending 禁用 + 文案切换
html`
  <button
    class="btn btn--sm"
    ?disabled=${props.refresh.pending}
    @click=${() => props.refresh!.onRefresh()}
  >
    ${renderIcon("refreshCw", "btn__icon")} ${props.refresh.pending ? "刷新中…" : "刷新"}
  </button>
`;
```

- `renderIcon` 与 `IconName` 来自 `ui/src/ui/icons.ts`：
  `renderIcon(name: IconName, className = "nav-item__icon"): TemplateResult`。
- **向后兼容**：未传 `refresh` 时不渲染刷新按钮；`trailing` 仍可叠加额外操作。

### 3.2 KPI 卡组 `renderEnterpriseKpiGrid` + `EnterpriseKpiItem`

文件（新建）：`ui/src/ui/views/enterprise-kpi-card.ts`

```ts
import type { IconName } from "../icons";

export type EnterpriseKpiTone = "neutral" | "warn" | "danger" | "ok";

export type EnterpriseKpiTrend = {
  direction: "up" | "down" | "flat";
  label: string;
  /** 趋势语义色（双编码：方向图标 + 颜色） */
  tone: EnterpriseKpiTone;
};

export type EnterpriseKpiItem = {
  label: string;
  value: string;
  /** 有 href 时卡片可交互（叠 enterprise-card--interactive + 下钻箭头） */
  href?: string;
  icon?: IconName;
  tone?: EnterpriseKpiTone;
  trend?: EnterpriseKpiTrend;
  /** 下钻提示文案（无障碍 aria-label / 视觉箭头旁） */
  drilldown?: string;
  /**
   * 选中态（来自组织模块「KPI 即筛选器」模式）：active=true 时叠 .is-active 类，
   * 并在可交互 <a> 上设 aria-current="true"。
   */
  active?: boolean;
};

export function renderEnterpriseKpiGrid(items: EnterpriseKpiItem[]): TemplateResult;
```

**渲染约定：**

- 容器 `.enterprise-kpi-grid`；每项基于 `.enterprise-card`，有 `href` 时叠 `.enterprise-card--interactive` 并染 `is-<tone>`。
- 结构顺序：可选图标位 → `label`（12px / muted / 600）→ `value`（24px / 700）→ 可选 trend chip（**方向图标 + 颜色双编码**）→ 下钻箭头（仅可交互项）。
- 无 `href` 时退化为静态卡（无 `--interactive`、无下钻箭头、无 hover 抬升）。
- **`active` 选中态**（「KPI 即筛选器」）：`active === true` 时叠 `.is-active` 类（accent 边框 + 轻 accent 底色，见 §5.3），
  并在可交互的 `<a>` 上设置 `aria-current="true"`，以无障碍方式表达「当前选中的筛选器」。

### 3.3 共享二级导航 `renderEnterpriseSegmentedNav`（segmented nav，Task 8）

文件（新建）：`ui/src/ui/views/enterprise-segmented-nav.ts`

```ts
export type EnterpriseSegmentedNavItem = {
  id: string;
  label: string;
  hint?: string;
  active: boolean;
};

export function renderEnterpriseSegmentedNav(
  items: EnterpriseSegmentedNavItem[],
  onSelect: (id: string) => unknown,
): TemplateResult;
```

**用途约定（两种范式，各保留一个共享实现，禁止逐模块重写）：**

- **顶部药丸（pill segmented control）= 同一数据的视图切换。** 在同一份数据上切换不同视图 / 维度
  （如「概览 / 明细」「按部门 / 按数字人」），用顶部药丸 segmented control。
- **左侧子导航 = 多区段并列。** 多个相对独立的并列区段（如企业数据能力中心的 `activeSection`），
  用左侧子导航表达「区段切换」。
- **两种范式各保留一个共享实现。** 顶部药丸与左侧子导航各自只保留**一个**共享组件实现，
  各模块一律复用，**禁止**逐模块重写自造 `*-subnav` / `*-surface-nav` / `*-tabs` 等并行导航。

> 无障碍：`role="tablist"`，各项 `role="tab"` + `aria-selected`，`title=hint`；
> 选中态 `:focus-visible` 走 `--focus-ring`（见 §5）。

### 3.4 唯一按钮基元（Task 12）

企业端**唯一按钮基元是 `.btn`**（站点通用按钮体系）。约定如下：

- **`.btn` 为单一按钮基元。** 所有企业端按钮一律基于 `.btn`（及其尺寸 / 变体修饰符，如 `.btn--sm`、`.btn--primary`）。
- **`.enterprise-btn*` 收敛为 `.btn*` 的薄别名。** 历史的 `.enterprise-btn` 双系统
  （`--primary/--secondary/--danger/--ghost/--success/--warning`）应收敛为 `.btn*` 的**薄别名**
  （保留选择器兼容、统一视觉），不再维护独立的按钮视觉实现。
- **企业端主色走 `--accent` / `--accent-hover` token。** 主操作按钮的主色一律引用
  `--accent`（默认）与 `--accent-hover`（hover），与全站主色一致。
- **禁止硬编码蓝。** 禁止在企业端按钮中硬编码蓝色 hex（`#3b82f6` / `#2563eb` 等）；
  浅 / 深色主题均由 token 主题切换覆盖，不再写 `[data-theme=…]` 蓝色硬编码块。

> 校验锚点（限企业端样式文件）：按钮选择器内不应出现 `#3b82f6` / `#2563eb`；
> 主色引用应为 `var(--accent)` / `var(--accent-hover)`。

---

## 4. 字重两档规范

企业端选择器**只允许** `600` 与 `700` 两档：

| 字重  | 用途                                                    |
| ----- | ------------------------------------------------------- |
| `700` | 标题（`.enterprise-page__title`）、KPI 数值、强调数字。 |
| `600` | 次级强调：标签、section 标题、表头、chip 文案。         |

**禁止值**：`760 / 740 / 720 / 680 / 640` 等伪精度字重。
迁移时的 grep 锚点（限企业端选择器）：

```
font-weight: 7[0-6][0-9]
font-weight: 6[4-9]0
```

> 收敛映射建议：`760/740/720/700 → 700`；`680/640/600 → 600`。

---

## 5. 卡片 hover / focus 约定

### 5.1 可交互卡片（`.enterprise-card--interactive`）

```css
.enterprise-card--interactive {
  cursor: pointer;
  text-decoration: none;
  color: inherit;
  transition: var(--transition-interactive);
}

.enterprise-card--interactive:hover {
  transform: translateY(-1px);
  border-color: var(--border-strong);
  box-shadow: var(--shadow-md);
}

.enterprise-card--interactive:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}
```

- **hover**：轻微上抬 `translateY(-1px)` + 强化边框 + `--shadow-md`。
- **focus-visible**：键盘 Tab 必须出现 `--focus-ring` 焦点环（修复焦点态缺失）。
- 必须是真正可聚焦的元素（`<a href>` / `<button>` / 设置了 `tabindex` 的可聚焦元素）。

### 5.2 非交互卡片（仅 `.enterprise-card`）

- **禁止 hover 抬升、禁止 hover 阴影变化、禁止焦点环。**
- 纯展示 `<div>` 一律只用 `.enterprise-card`，不得叠 `--interactive`。
- 理由：hover 抬升是「可点击」的视觉承诺；非交互卡片有抬升会误导用户去点击。

> 既有 `.enterprise-card:hover` 的 border/shadow 变化在迁移时应收敛到
> `.enterprise-card--interactive:hover`，使**基础** `.enterprise-card` 在非交互场景下保持静止。

### 5.3 KPI 选中态（`.enterprise-kpi-card.is-active`，「KPI 即筛选器」）

```css
.enterprise-kpi-card.is-active {
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
  background: var(--accent-subtle);
}
```

- 用 **accent 边框** + **轻 accent 底色** 表达「当前选中的筛选器」，与 hover / focus 态互不冲突
  （hover 仍可抬升，focus-visible 仍出 `--focus-ring`）。
- 可交互的选中项须同时在 `<a>` 上设置 `aria-current="true"`（见 §3.2），保证无障碍可达。

---

## 6. 迁移检查清单（每个模块 PR 自检）

- [ ] 页眉用 `renderEnterpriseModuleHeader`，含 `subtitle` 与（如适用）`refresh`，无裸 `<button>刷新</button>`。
- [ ] 页眉标题取 `t("tabs.<tab>")`、副标题取 `t("subtitles.<tab>")`，无硬编码标题字面量、无英文眉题、无渐变卡片页眉（§2.3.1）。
- [ ] KPI 区用 `renderEnterpriseKpiGrid(items)`，无手写 KPI 结构、无并行 `*-snapshot__*` 类；筛选器选中项用 `active`（§3.2 / §5.3）。
- [ ] 卡片复用 `.enterprise-card`；可点击卡片叠 `.enterprise-card--interactive`，非交互卡片不叠；模块卡不再用泛化 `.card` / `.card-title` / `.card-sub`（§2.4）。
- [ ] 二级导航用共享 `renderEnterpriseSegmentedNav`（顶部药丸 = 视图切换；左侧子导航 = 多区段并列），无自造 `*-subnav` / `*-tabs`（§3.3）。
- [ ] 按钮基于唯一基元 `.btn`（`.enterprise-btn*` 仅作薄别名），主色走 `--accent` / `--accent-hover`，无硬编码蓝（§3.4）。
- [ ] 无内联 `style=`（间距 / 对齐走类，§2.4）。
- [ ] 无硬编码动效（`160ms ease` 等），过渡走 `var(--transition-interactive)`。
- [ ] 状态/趋势色为图标 + 颜色双编码。
- [ ] 字重仅 `600` / `700`。
- [ ] 未触碰平台端文件（`ui/src/ui/ports/platform/**`）。
- [ ] PR 描述链接本文件 `docs/design/enterprise-ui-baseline.md`。
- [ ] 改动文件 diagnostics 干净；`pnpm check` + 相关 `*.browser.test.ts` 全绿。

---

## 7. 开放项（需 owner 决策，不在本基线内擅自处理）

1. 两端标题字号是否统一（平台 `clamp(28-38px)` vs 企业 `22px`）—— 本期保留差异。
2. 是否把 `enterprise-card` 上升为跨端 `surface-card`（会触及平台端）—— 独立任务。
3. 后续 7 个模块的逐一迁移 —— 本 spec 只交付基线 + 企业总览样板，其余模块另起任务并引用本文件。

---

## 8. 架构决策记录（机巢治理 Web Component 重新主题化，Task 15.1）

**决策：机巢治理三页采用方案 A（token 化止血），不重写为 light-DOM。**

- **背景**：`ui/src/ui/capability/ai-workforce-governance/pages/{assets-page,ranking-page,actions-page}.ts`
  为 Shadow DOM 的 `LitElement`，其 `static styles` 硬编码浅色（`#ffffff` / `#111827` / `#e5e7eb` 等），
  在默认深色主题下渲染为「白色孤岛」——这是实质性的深色破图视觉 Bug（**高优先级**）。
- **方案 A（已选定 / 止血）**：保留 Web Component，将 `static styles` 全量改为消费设计 token
  （颜色 / 圆角 / 阴影 / 字体），修正错误的外来 token 名，补深色支持。卡片 / 导航仍为组件私有实现，
  但视觉对齐设计 token。
- **方案 B（已推迟 / light-DOM 重写）**：重写为 light-DOM 函数式 lit-html，复用基线
  `enterprise-card` / `enterprise-segmented-nav` / 统一表格组件，删除私有 `.card` / tab / table 体系。
- **选择理由**：
  - CSS 自定义属性（`:root` 上定义的 token）**天然穿透 Shadow DOM**，因此 token 化即可让明暗主题
    自动跟随，**无需任何 `data-theme` 分支**——以最小改动消除深色破图，立即止血。
  - light-DOM 重写（方案 B）需要重做表格 / 抽屉 / 侧栏的交互结构与既有 KPI/卡片/导航组件接线，
    风险与体量远大于本期目标；故**推迟**至独立任务（依赖 Task 8 共享导航与统一表格组件）。
- **范围（Task 15.2，方案 A 必做）**：硬编码 hex → token；状态/分数 pastel 徽章 → `--ok/--warn/--danger`
  - `color-mix`；修正外来 token 名（`--text-primary→--text`、`--text-secondary→--muted`、
    `--bg-secondary→--secondary`、`--accent` 的蓝色 fallback `#007bff` → 去除蓝色 fallback 用 `var(--accent)`）；
    圆角/阴影 → `--radius-*`/`--shadow-*`；字体 → `--font-body`。
- **验收**：token 化后明暗主题自动跟随，三页不再出现白底孤岛；主色为 accent（非蓝）；
  组件内**无 `data-theme` 分支**。
- **Task 15.3（方案 B 重写）**：本期**不执行**，留待后续独立任务。
