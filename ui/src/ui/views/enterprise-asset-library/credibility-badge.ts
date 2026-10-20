import { html, type TemplateResult } from "lit";
import type { CredibilityIndicators } from "../../capability/enterprise-capability/types.ts";
import { renderIcon } from "../../icons.ts";

/**
 * 可信度徽章变体：
 * - "inline" 用于高价值卡片等紧凑场景，溢出部门以 +N 显示
 * - "detail" 用于详情页可信度区，完整展示所有已验证部门
 *
 * 验证需求：20.5 / 20.6（《企业能力中心》Credibility Indicators 展示规范）
 */
export type CredibilityBadgeVariant = "inline" | "detail";

export type CredibilityBadgeProps = {
  credibility: CredibilityIndicators;
  /** 默认 "inline" */
  variant?: CredibilityBadgeVariant;
};

/** inline 变体下最多展示的部门 chip 数量，溢出显示 +N */
const INLINE_MAX_DEPARTMENT_CHIPS = 3;

/**
 * 盾形图标：使用统一的 renderIcon 渲染，class 控制尺寸/颜色。
 * 仅在 inline 变体作为前缀展示，提示"可信度"语义。
 */
const SHIELD_ICON = renderIcon("shield", "credibility-badge__shield");

/**
 * 将生产环境使用天数格式化为业务语言。
 * - 0 天：标识为新上架（尚未在生产环境长期运行）
 * - >= 365 天：归并为"稳定运行超过 1 年"
 * - 其他：按 variant 选择"运行 N 天"或"稳定运行 N 天"
 */
function formatProductionUsage(days: number, variant: CredibilityBadgeVariant): string {
  if (days <= 0) {
    return "新上架，尚未在生产环境长期运行";
  }
  if (days >= 365) {
    return "已稳定运行超过 1 年";
  }
  return variant === "detail" ? `已在生产环境稳定运行 ${days} 天` : `已在生产环境运行 ${days} 天`;
}

/**
 * 渲染 inline 变体（紧凑卡片场景）。
 * 布局：盾形图标 · 生产运行天数 · 已验证部门（最多 3 个 chip + "+N" 溢出）
 *
 * 示例：🛡 已在生产环境运行 305 天 · 已验证部门：法务部、采购部、销售部 +5
 */
function renderInline(props: CredibilityBadgeProps): TemplateResult {
  const { verifiedDepartments, productionUsageDays } = props.credibility;
  const usageText = formatProductionUsage(productionUsageDays, "inline");

  const visibleDepartments = verifiedDepartments.slice(0, INLINE_MAX_DEPARTMENT_CHIPS);
  const overflowCount = Math.max(0, verifiedDepartments.length - INLINE_MAX_DEPARTMENT_CHIPS);

  return html`
    <span class="credibility-badge credibility-badge--inline">
      <span class="credibility-badge__icon">${SHIELD_ICON}</span>
      <span class="credibility-badge__usage">${usageText}</span>
      <span class="credibility-badge__separator" aria-hidden="true">·</span>
      ${
        verifiedDepartments.length === 0
          ? html`
              <span class="credibility-badge__empty">暂无已验证部门</span>
            `
          : html`
              <span class="credibility-badge__departments-label">已验证部门：</span>
              <span class="credibility-badge__departments">
                ${visibleDepartments.map(
                  (dept) =>
                    html`<span class="credibility-badge__chip credibility-badge__chip--inline">${dept}</span>`,
                )}
                ${
                  overflowCount > 0
                    ? html`<span class="credibility-badge__overflow">+${overflowCount}</span>`
                    : ""
                }
              </span>
            `
      }
    </span>
  `;
}

/**
 * 渲染 detail 变体（详情页可信度区）。
 * 布局：
 *   ├─ 区段标题 "可信度"
 *   ├─ 生产运行说明（"已在生产环境稳定运行 N 天"）
 *   └─ 全量已验证部门 chip 列表（不截断）
 */
function renderDetail(props: CredibilityBadgeProps): TemplateResult {
  const { verifiedDepartments, productionUsageDays } = props.credibility;
  const usageText = formatProductionUsage(productionUsageDays, "detail");

  return html`
    <section class="credibility-badge credibility-badge--detail">
      <header class="credibility-badge__heading">可信度</header>
      <p class="credibility-badge__usage">${usageText}</p>
      ${
        verifiedDepartments.length === 0
          ? html`
              <p class="credibility-badge__empty">暂无已验证部门</p>
            `
          : html`
              <ul class="credibility-badge__departments credibility-badge__departments--detail">
                ${verifiedDepartments.map(
                  (dept) =>
                    html`<li class="credibility-badge__chip credibility-badge__chip--detail">${dept}</li>`,
                )}
              </ul>
            `
      }
    </section>
  `;
}

/**
 * 渲染 CredibilityBadge —— 可信度徽章。
 *
 * 展示 {@link CredibilityIndicators} 的两个字段：
 * - verifiedDepartments：已验证使用部门列表
 * - productionUsageDays：生产环境使用天数
 *
 * 验证需求：
 * - 20.5：高价值卡片 inline 变体快速判断
 * - 20.6：详情页 detail 变体完整展示
 */
export function renderCredibilityBadge(props: CredibilityBadgeProps): TemplateResult {
  const variant: CredibilityBadgeVariant = props.variant ?? "inline";
  return variant === "detail" ? renderDetail(props) : renderInline(props);
}
