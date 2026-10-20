import { html, nothing, type TemplateResult } from "lit";
import type { PricingCatalogViewModel } from "../../capability/platform-pricing-catalog/index.ts";
import type { BillingCycle } from "../../ports/platform/pricing/pricing-cycle.ts";
import { renderBillingCycleSwitcher } from "./billing-cycle-switcher.ts";
import {
  renderCapabilityCompareSection,
  updateCompareScrollHint,
} from "./capability-compare-section.ts";
import { renderEnterpriseValueStrip } from "./enterprise-cta.ts";
import { renderFaqSection } from "./faq-section.ts";
import type { PricingCardOptions } from "./pricing-card.ts";
import { renderPricingGrid } from "./pricing-grid.ts";

export type PricingPageOptions = {
  catalog: PricingCatalogViewModel | null;
  loading?: boolean;
  error?: string | null;
  selectedCycle: BillingCycle;
  onSelectCycle: (cycle: BillingCycle) => void;
  /** Hide purchase CTAs (legacy). Prefer hideCta / showCta. */
  readOnly?: boolean;
  hideCta?: boolean;
  /** Force show purchase CTAs (public catalog). */
  showCta?: boolean;
  currentPlanId?: string;
  onSelectPlan?: PricingCardOptions["onSelectPlan"];
  onContactSales?: PricingCardOptions["onContactSales"];
  onEditPlan?: PricingCardOptions["onEditPlan"];
  /** 平台管理端预览：显示创建套餐等管理操作区。 */
  adminToolbar?: TemplateResult;
  /** 公共站点定价页：仅展示套餐卡片，不渲染对比表/FAQ 等附加区块。 */
  publicSurface?: boolean;
  /** 功能对比是否包含试用列（默认 false = 付费套餐对比）。 */
  compareIncludeTrial?: boolean;
};

export function renderPricingPage(options: PricingPageOptions): TemplateResult {
  if (options.loading) {
    return html`
      <div class="pricing-v3 pricing-v3--loading" data-testid="pricing-v3-loading">加载套餐…</div>
    `;
  }
  if (options.error) {
    return html`<div class="pricing-v3 pricing-v3--error" data-testid="pricing-v3-error">${options.error}</div>`;
  }
  if (!options.catalog || options.catalog.plans.length === 0) {
    return html`
      <div class="pricing-v3 pricing-v3--empty" data-testid="pricing-v3-empty">暂无可用套餐</div>
    `;
  }

  // After paint: show compare scroll hint only when table actually overflows.
  if (typeof queueMicrotask === "function") {
    queueMicrotask(() => {
      if (typeof document !== "undefined") {
        updateCompareScrollHint(document);
      }
    });
  }

  return html`
    <div class="pricing-v3" data-testid="pricing-v3-page">
      <div class="pricing-v3__container">
        ${options.adminToolbar ?? nothing}
        ${renderBillingCycleSwitcher({
          selectedCycle: options.selectedCycle,
          onSelectCycle: options.onSelectCycle,
        })}
        ${renderPricingGrid({
          plans: options.catalog.plans,
          selectedCycle: options.selectedCycle,
          hideCta: options.hideCta,
          readOnly: options.readOnly,
          showCta: options.showCta,
          currentPlanId: options.currentPlanId,
          onSelectPlan: options.onSelectPlan,
          onContactSales: options.onContactSales,
          onEditPlan: options.onEditPlan,
        })}
        ${
          options.publicSurface
            ? nothing
            : html`
                ${renderEnterpriseValueStrip()}
                ${renderCapabilityCompareSection(
                  options.catalog.compareRows,
                  options.catalog.plans,
                  {
                    includeTrial: options.compareIncludeTrial === true,
                  },
                )}
                ${renderFaqSection(options.catalog.faq)}
              `
        }
      </div>
    </div>
  `;
}
