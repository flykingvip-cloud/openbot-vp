import { html, type TemplateResult } from "lit";
import type { EnterpriseCapabilityValueSummary } from "../../capability/enterprise-capability/types.ts";

/**
 * 企业能力价值摘要卡片（ValueSummaryCard）
 *
 * 以业务语言渲染 {@link EnterpriseCapabilityValueSummary} 的三个字段：
 * - monthlyExecutions       → "本月已被调用 N 次"（千位分隔符），零值降级为"本月暂未被调用"
 * - departmentCoverageCount → "已覆盖 N 个部门"，零值降级为"暂未覆盖任何部门"
 * - reuseGrowthRate30d      → "近 30 天复用增长 +N%"（负值/零值分别降级为"复用下降 -N%" / "复用持平"）
 *
 * 严禁以原始字段名或纯数字形式暴露数据（如 "monthlyExecutions: 1284"）。
 *
 * 样式：通过 enterprise-components.css 的 .value-summary-card 类体系。
 * 增长方向通过 .--growth-positive / --growth-negative / --growth-neutral
 * 修饰类应用语义颜色。
 *
 * 验证需求：20.1, 20.2, 20.3, 20.4
 */

export type ValueSummaryCardVariant = "card" | "inline";

export type ValueSummaryCardProps = {
  summary: EnterpriseCapabilityValueSummary;
  /** 默认 "card"（多行卡片）；"inline" 用于行内紧凑展示 */
  variant?: ValueSummaryCardVariant;
};

/** 增长率方向 → 图标 / class 后缀的视觉映射 */
type GrowthDirection = "positive" | "negative" | "neutral";

/** 正/负/零增长对应的箭头图标 */
const GROWTH_ICON: Record<GrowthDirection, string> = {
  positive: "📈",
  negative: "📉",
  neutral: "➡️",
};

/** 月度调用次数行的图标 */
const MONTHLY_EXECUTIONS_ICON = "📊";
/** 部门覆盖行的图标 */
const DEPARTMENT_COVERAGE_ICON = "🏢";

/**
 * 将整数 / 大数字格式化为带千位分隔符的中文格式。
 */
function formatThousands(count: number): string {
  return count.toLocaleString("zh-CN");
}

/**
 * 解析增长率方向：> 0 / < 0 / === 0 三态。
 */
function resolveGrowthDirection(rate: number): GrowthDirection {
  if (rate > 0) {
    return "positive";
  }
  if (rate < 0) {
    return "negative";
  }
  return "neutral";
}

/**
 * 月度调用次数 → 业务语言。
 */
export function formatMonthlyExecutions(count: number): string {
  if (count === 0) {
    return "本月暂未被调用";
  }
  return `本月已被调用 ${formatThousands(count)} 次`;
}

/**
 * 覆盖部门数 → 业务语言。
 */
export function formatDepartmentCoverage(count: number): string {
  if (count === 0) {
    return "暂未覆盖任何部门";
  }
  return `已覆盖 ${count} 个部门`;
}

/**
 * 近 30 天复用增长率 → 业务语言。
 */
export function formatReuseGrowthRate(rate: number): string {
  const direction = resolveGrowthDirection(rate);
  if (direction === "neutral") {
    return "近 30 天复用持平";
  }

  const abs = Math.abs(rate);
  if (direction === "positive") {
    return `近 30 天复用增长 +${abs}%`;
  }
  return `近 30 天复用下降 -${abs}%`;
}

/**
 * 渲染一行（图标 + 文本）。
 */
function renderLine(opts: { icon: string; text: string; variantClass: string }): TemplateResult {
  return html`
    <span class="value-summary-card__line ${opts.variantClass}">
      <span class="value-summary-card__icon" aria-hidden="true">${opts.icon}</span>
      <span class="value-summary-card__text">${opts.text}</span>
    </span>
  `;
}

/**
 * 渲染企业能力价值摘要卡片。
 *
 * 行为：
 * - "card" 变体：三行垂直堆叠
 * - "inline" 变体：单行紧凑展示，三段文本以 " · " 分隔
 * - 增长率行的颜色通过 .value-summary-card__line--growth-{direction} 类映射
 *
 * 验证需求：20.1 / 20.2 / 20.3 / 20.4
 */
export function renderValueSummaryCard(props: ValueSummaryCardProps): TemplateResult {
  const variant: ValueSummaryCardVariant = props.variant ?? "card";
  const { summary } = props;

  const direction = resolveGrowthDirection(summary.reuseGrowthRate30d);
  const growthIcon = GROWTH_ICON[direction];

  const monthlyText = formatMonthlyExecutions(summary.monthlyExecutions);
  const departmentText = formatDepartmentCoverage(summary.departmentCoverageCount);
  const growthText = formatReuseGrowthRate(summary.reuseGrowthRate30d);

  if (variant === "inline") {
    return html`
      <span class="value-summary-card value-summary-card--inline">
        ${renderLine({
          icon: MONTHLY_EXECUTIONS_ICON,
          text: monthlyText,
          variantClass: "value-summary-card__line--inline",
        })}
        <span class="value-summary-card__separator" aria-hidden="true">·</span>
        ${renderLine({
          icon: DEPARTMENT_COVERAGE_ICON,
          text: departmentText,
          variantClass: "value-summary-card__line--inline",
        })}
        <span class="value-summary-card__separator" aria-hidden="true">·</span>
        ${renderLine({
          icon: growthIcon,
          text: growthText,
          variantClass: `value-summary-card__line--inline value-summary-card__line--growth-${direction}`,
        })}
      </span>
    `;
  }

  return html`
    <section class="value-summary-card value-summary-card--card" aria-label="能力价值摘要">
      ${renderLine({
        icon: MONTHLY_EXECUTIONS_ICON,
        text: monthlyText,
        variantClass: "value-summary-card__line--card",
      })}
      ${renderLine({
        icon: DEPARTMENT_COVERAGE_ICON,
        text: departmentText,
        variantClass: "value-summary-card__line--card",
      })}
      ${renderLine({
        icon: growthIcon,
        text: growthText,
        variantClass: `value-summary-card__line--card value-summary-card__line--growth-${direction}`,
      })}
    </section>
  `;
}
