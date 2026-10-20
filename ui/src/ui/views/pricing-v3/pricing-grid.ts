import { html, type TemplateResult } from "lit";
import type { PricingPlanViewModel } from "../../capability/platform-pricing-catalog/index.ts";
import type { BillingCycle } from "../../ports/platform/pricing/pricing-cycle.ts";
import { renderPricingCard, type PricingCardOptions } from "./pricing-card.ts";

export type PricingGridOptions = {
  plans: readonly PricingPlanViewModel[];
  selectedCycle: BillingCycle;
  hideCta?: boolean;
  readOnly?: boolean;
  showCta?: boolean;
  currentPlanId?: string;
  onSelectPlan?: PricingCardOptions["onSelectPlan"];
  onContactSales?: PricingCardOptions["onContactSales"];
  onEditPlan?: PricingCardOptions["onEditPlan"];
};

export function renderPricingGrid(options: PricingGridOptions): TemplateResult {
  return html`
    <div class="pricing-v3__grid" data-testid="pricing-v3-grid">
      ${options.plans.map((plan) =>
        renderPricingCard({
          plan,
          selectedCycle: options.selectedCycle,
          hideCta: options.hideCta,
          readOnly: options.readOnly,
          showCta: options.showCta,
          currentPlanId: options.currentPlanId,
          onSelectPlan: options.onSelectPlan,
          onContactSales: options.onContactSales,
          onEditPlan: options.onEditPlan,
        }),
      )}
    </div>
  `;
}
