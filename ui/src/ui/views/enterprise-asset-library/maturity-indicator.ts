/**
 * 能力成熟度指示器（MaturityIndicator）
 *
 * 以 6 个圆点的形式展示能力资产的成熟度等级（1–6 级），并可选附加文字标签。
 *
 * 等级映射（{@link maturityToDotCount}）：
 *   初步形成 → 1, 稳定使用 → 2, 多人复用 → 3,
 *   企业认证 → 4, 企业标准 → 5, 核心资产 → 6
 *
 * 视觉规则：
 *   - 默认等级（初步形成/稳定使用/多人复用）填充使用蓝色 (#3B82F6)
 *   - 高阶等级（企业认证/企业标准/核心资产）填充使用金色 (#F59E0B)
 *   - 未填充圆点统一为浅灰色 (#E5E7EB)
 *
 * 样式：通过 enterprise-components.css 的 .maturity-indicator__dot--filled
 * 和 wrapper 上的 .maturity-indicator--{high-tier|default-tier} 修饰类应用颜色。
 *
 * 验证需求：4.5, 5.6, 5.7, 5.10
 */

import { html, nothing, type TemplateResult } from "lit";
import type { CapabilityMaturity } from "../../capability/enterprise-capability/types.ts";

/** 指示器视觉变体：`compact` 仅渲染圆点；`with-label` 圆点 + 文字标签 */
export type MaturityIndicatorVariant = "compact" | "with-label";

export type MaturityIndicatorProps = {
  maturity: CapabilityMaturity;
  /** 视觉变体；默认 `with-label`（用于卡片/详情），表格中可使用 `compact` */
  variant?: MaturityIndicatorVariant;
};

/** 6 级成熟度对应的圆点总数恒为 6。 */
const TOTAL_DOTS = 6;

/** 成熟度 → 填充圆点数量映射。 */
const MATURITY_TO_DOT_COUNT: Record<CapabilityMaturity, number> = {
  初步形成: 1,
  稳定使用: 2,
  多人复用: 3,
  企业认证: 4,
  企业标准: 5,
  核心资产: 6,
};

/** 视为"高阶等级"的成熟度集合。 */
const HIGH_TIER_MATURITIES: ReadonlySet<CapabilityMaturity> = new Set<CapabilityMaturity>([
  "企业认证",
  "企业标准",
  "核心资产",
]);

/**
 * 获取某成熟度对应的填充圆点数。
 */
export function maturityToDotCount(maturity: CapabilityMaturity): number {
  return MATURITY_TO_DOT_COUNT[maturity];
}

/**
 * 判断某成熟度是否属于高阶等级（企业认证 / 企业标准 / 核心资产）。
 */
function isHighTierMaturity(maturity: CapabilityMaturity): boolean {
  return HIGH_TIER_MATURITIES.has(maturity);
}

/**
 * 渲染成熟度指示器。
 */
export function renderMaturityIndicator(props: MaturityIndicatorProps): TemplateResult {
  const { maturity } = props;
  const variant: MaturityIndicatorVariant = props.variant ?? "with-label";

  const filledCount = maturityToDotCount(maturity);
  const tierClass = isHighTierMaturity(maturity)
    ? "maturity-indicator--high-tier"
    : "maturity-indicator--default-tier";

  // 构造定长 6 项数组，第 i 项决定是否填充。
  const dots: TemplateResult[] = [];
  for (let i = 0; i < TOTAL_DOTS; i++) {
    const filled = i < filledCount;
    dots.push(
      html`<span
        class="maturity-indicator__dot ${
          filled ? "maturity-indicator__dot--filled" : "maturity-indicator__dot--empty"
        }"
        aria-hidden="true"
      ></span>`,
    );
  }

  return html`
    <span
      class="maturity-indicator maturity-indicator--${variant} ${tierClass}"
      role="img"
      aria-label="能力成熟度：${maturity}"
    >
      <span class="maturity-indicator__dots">${dots}</span>
      ${
        variant === "with-label"
          ? html`<span class="maturity-indicator__label">${maturity}</span>`
          : nothing
      }
    </span>
  `;
}
