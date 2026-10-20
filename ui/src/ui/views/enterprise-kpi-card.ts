/**
 * 企业端统一 KPI 卡组组件（基线共享组件）
 *
 * ## 规范（见 docs/design/enterprise-ui-baseline.md §2.2 / §3.2 / §5.3）
 * - 容器 `.enterprise-kpi-grid`；每项基于 `.enterprise-card`。
 * - 有 `href` 时叠 `.enterprise-card--interactive` 并渲染为 `<a>`（带下钻箭头 + hover 抬升 + 焦点环）；
 *   无 `href` 时退化为静态 `<div>`（无 `--interactive`、无下钻箭头、无 hover 抬升）。
 * - `tone` 非 `neutral` 时叠 `is-<tone>`（映射 foundation 的 `.enterprise-card.is-warn/.is-danger/.is-ok`）。
 * - 结构顺序：可选图标位 → label（12px / muted / 600）→ value（24px / 700）
 *   → 可选 detail（12px / muted，占位一致）→ 可选 trend chip（**方向图标 + 颜色双编码**）
 *   → 下钻箭头（仅可交互项）。
 * - `active === true`：叠 `.is-active` 类；可交互 `<a>` 上设 `aria-current="true"`（「KPI 即筛选器」选中态）。
 *
 * 企业端 KPI **必须是同一组件**：禁止在任一 surface 内手写 KPI 结构。
 */

import { html, nothing, type TemplateResult } from "lit";
import { renderIcon, type IconName } from "../icons.ts";

/** KPI 语义色调；`neutral` 不染边框。 */
export type EnterpriseKpiTone = "neutral" | "warn" | "danger" | "ok";

export type EnterpriseKpiTrend = {
  direction: "up" | "down" | "flat";
  label: string;
  /** 趋势语义色（双编码：方向图标 + 颜色）。 */
  tone: EnterpriseKpiTone;
};

export type EnterpriseKpiItem = {
  label: string;
  value: string;
  /** 辅助说明（12px muted）；留空仍保留占位以统一卡片高度。 */
  detail?: string;
  /** 有 href 时卡片可交互（叠 enterprise-card--interactive + 下钻箭头）。 */
  href?: string;
  icon?: IconName;
  tone?: EnterpriseKpiTone;
  trend?: EnterpriseKpiTrend;
  /** 下钻提示文案（无障碍 aria-label / 视觉箭头旁）。 */
  drilldown?: string;
  /**
   * 同页下钻。普通左键会 preventDefault，避免只改 hash 却不重绘。
   * Ctrl/中键等仍走 href。
   */
  onSelect?: (event: MouseEvent) => void;
  /**
   * 选中态（来自组织模块「KPI 即筛选器」模式）：active=true 时叠 .is-active 类，
   * 并在可交互 <a> 上设 aria-current="true"。
   */
  active?: boolean;
};

/** trend 方向 → 双编码方向图标。 */
const TREND_ICON: Record<EnterpriseKpiTrend["direction"], IconName> = {
  up: "trendingUp",
  down: "trendingDown",
  flat: "minus",
};

/** tone → `is-<tone>` 修饰类；`neutral`（或缺省）不染色。 */
function toneClass(tone: EnterpriseKpiTone | undefined): string {
  return tone && tone !== "neutral" ? `is-${tone}` : "";
}

/** 渲染趋势 chip：方向图标 + 颜色双编码（颜色来自 trend.tone）。 */
function renderTrend(trend: EnterpriseKpiTrend): TemplateResult {
  const chipClasses = ["enterprise-kpi-card__trend", toneClass(trend.tone)]
    .filter(Boolean)
    .join(" ");
  return html`
    <span class=${chipClasses}>
      ${renderIcon(TREND_ICON[trend.direction], "enterprise-kpi-card__trend-icon")}
      <span class="enterprise-kpi-card__trend-label">${trend.label}</span>
    </span>
  `;
}

export type EnterpriseKpiGridOptions = {
  /** 紧凑两行布局：标题行 + 数值行，省略 detail/trend 与独立图标行。 */
  variant?: "default" | "compact";
};

/** 渲染单个 KPI 项的内部结构（图标 → label → value → trend → 可选箭头）。 */
function renderKpiBody(
  item: EnterpriseKpiItem,
  interactive: boolean,
  variant: EnterpriseKpiGridOptions["variant"] = "default",
): TemplateResult {
  if (variant === "compact") {
    return html`
      ${item.icon ? renderIcon(item.icon, "enterprise-kpi-card__icon") : nothing}
      <div class="enterprise-kpi-card__head">
        <span class="enterprise-kpi-card__label">${item.label}</span>
      </div>
      ${interactive ? renderIcon("chevronRight", "enterprise-kpi-card__arrow") : nothing}
      <span class="enterprise-kpi-card__value">${item.value}</span>
    `;
  }
  return html`
    ${item.icon ? renderIcon(item.icon, "enterprise-kpi-card__icon") : nothing}
    <span class="enterprise-kpi-card__label">${item.label}</span>
    <span class="enterprise-kpi-card__value">${item.value}</span>
    <span class="enterprise-kpi-card__detail">${item.detail ?? ""}</span>
    ${item.trend ? renderTrend(item.trend) : nothing}
    ${interactive ? renderIcon("chevronRight", "enterprise-kpi-card__arrow") : nothing}
  `;
}

/** 渲染单个 KPI 项：有 href → 可交互 `<a>`；否则 → 静态 `<div>`。 */
function renderKpiItem(
  item: EnterpriseKpiItem,
  variant: EnterpriseKpiGridOptions["variant"] = "default",
): TemplateResult {
  const interactive = item.href !== undefined;
  const classes = [
    "enterprise-card",
    "enterprise-kpi-card",
    variant === "compact" ? "enterprise-kpi-card--compact" : "",
    interactive ? "enterprise-card--interactive" : "",
    toneClass(item.tone),
    item.active ? "is-active" : "",
  ]
    .filter(Boolean)
    .join(" ");

  if (interactive) {
    return html`
      <a
        class=${classes}
        href=${item.href}
        aria-current=${item.active ? "true" : nothing}
        aria-label=${item.drilldown ?? item.label}
        @click=${(event: MouseEvent) => {
          if (!item.onSelect) {
            return;
          }
          if (
            event.defaultPrevented ||
            event.button !== 0 ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey
          ) {
            return;
          }
          event.preventDefault();
          item.onSelect(event);
        }}
      >
        ${renderKpiBody(item, true, variant)}
      </a>
    `;
  }

  return html`<div class=${classes}>${renderKpiBody(item, false, variant)}</div>`;
}

/** 渲染统一 KPI 卡组网格。 */
export function renderEnterpriseKpiGrid(
  items: EnterpriseKpiItem[],
  options?: EnterpriseKpiGridOptions,
): TemplateResult {
  const variant = options?.variant ?? "default";
  const gridClass =
    variant === "compact"
      ? "enterprise-kpi-grid enterprise-kpi-grid--compact"
      : "enterprise-kpi-grid";
  return html`<div class=${gridClass}>${items.map((item) => renderKpiItem(item, variant))}</div>`;
}
