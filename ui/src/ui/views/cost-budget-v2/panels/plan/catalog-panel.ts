import { html, nothing, type TemplateResult } from "lit";
import { t } from "../../../../../i18n/index.ts";
import type { SubscriptionGetResponse } from "../../../../capability/cost-budget-billing/index.ts";
import type { PricingPlanViewModel } from "../../../../capability/platform-pricing-catalog/index.ts";
import type { GatewayBrowserClient } from "../../../../gateway.ts";
import type { BillingCycle } from "../../../../ports/platform/pricing/pricing-cycle.ts";
import { renderPricingPage } from "../../../pricing-v3/pricing-page.ts";

export type CatalogPanelOptions = {
  client: GatewayBrowserClient | null;
  subscription: SubscriptionGetResponse | null;
  loading: boolean;
  error: string | null;
  /** Independent subscription RPC error for diagnostics. */
  subscriptionError?: string | null;
  selectedCycle: BillingCycle;
  actionNotice: string | null;
  actionError: string | null;
  actionBusy: boolean;
  onSelectCycle: (cycle: BillingCycle) => void;
  onSelectPlan: (plan: PricingPlanViewModel) => void;
  onContactSales: (plan: PricingPlanViewModel) => void;
  onReload?: () => void;
};

export function renderCatalogPanel(options: CatalogPanelOptions): TemplateResult {
  const hasSubscription = Boolean(options.subscription?.subscription);
  const catalog = options.subscription?.pricingCatalog ?? null;

  return html`
    <section class="cost-budget-v2-catalog-panel" data-testid="cost-budget-v2-catalog-panel">
      ${
        options.actionNotice
          ? html`<div class="callout" data-testid="cost-budget-v2-action-notice">${options.actionNotice}</div>`
          : nothing
      }
      ${
        options.actionError
          ? html`<div class="callout warning" data-testid="cost-budget-v2-action-error">${options.actionError}</div>`
          : nothing
      }
      ${
        options.loading && !catalog
          ? html`<div class="enterprise-empty" data-testid="cost-budget-v2-catalog-loading">${t("costBudget.v2.loadingSubscription")}</div>`
          : options.error && !catalog
            ? html`
                <div class="callout warning" data-testid="cost-budget-v2-catalog-error">
                  <p>${options.error}</p>
                  ${
                    options.subscriptionError
                      ? html`<p class="muted">subscriptions.get：${options.subscriptionError}</p>`
                      : nothing
                  }
                  ${
                    options.onReload
                      ? html`
                          <button
                            type="button"
                            class="btn btn--sm"
                            data-testid="cost-budget-v2-catalog-reload"
                            @click=${options.onReload}
                          >
                            重新加载
                          </button>
                        `
                      : nothing
                  }
                </div>
              `
            : html`
                <h3 class="enterprise-section-title">
                  ${
                    hasSubscription
                      ? t("costBudget.allocation.changePlanTitle")
                      : t("costBudget.allocation.availablePlans")
                  }
                </h3>
                ${renderPricingPage({
                  catalog,
                  loading: options.loading,
                  error: options.error,
                  selectedCycle: options.selectedCycle,
                  onSelectCycle: options.onSelectCycle,
                  currentPlanId: options.subscription?.subscription?.planId,
                  // 与平台套餐预览对齐：展示付费功能对比 + 常见问题（非 publicSurface）
                  showCta: !options.actionBusy,
                  readOnly: options.actionBusy,
                  compareIncludeTrial: false,
                  onContactSales: options.onContactSales,
                  onSelectPlan: (plan) => {
                    if (!options.client || options.actionBusy) {
                      return;
                    }
                    options.onSelectPlan(plan);
                  },
                })}
              `
      }
    </section>
  `;
}
