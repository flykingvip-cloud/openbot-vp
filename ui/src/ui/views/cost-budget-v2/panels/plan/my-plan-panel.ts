import { html, type TemplateResult } from "lit";
import { t } from "../../../../../i18n/index.ts";
import type { SubscriptionGetResponse } from "../../../../capability/cost-budget-billing/index.ts";
import type { BillingCycle } from "../../../../ports/platform/pricing/pricing-cycle.ts";
import { renderPricingCard } from "../../../pricing-v3/pricing-card.ts";
import type {
  CostBudgetV2NavigateTarget,
  CostBudgetV2PlanOrdersPanel,
} from "../../shell/cost-budget-v2-routes.ts";
import { getOperationsStoreState } from "../../stores/operations-store.ts";
import { getSubscriptionStoreState } from "../../stores/subscription-store.ts";
import { renderPlanGrowthPathPanel } from "./plan-growth-path-panel.ts";

export type MyPlanPanelOptions = {
  subscription: SubscriptionGetResponse | null;
  subscriptionLoading?: boolean;
  selectedCycle: BillingCycle;
  onOpenCatalog: () => void;
  onChangePlan?: () => void;
  onNavigate?: (target: CostBudgetV2NavigateTarget) => void;
  onRefresh?: () => void;
};

export function renderMyPlanPanel(options: MyPlanPanelOptions): TemplateResult {
  const currentPlanId = options.subscription?.subscription?.planId;
  const catalog = options.subscription?.pricingCatalog;
  const currentCard = catalog?.plans.find((plan) => plan.id === currentPlanId) ?? null;
  const lockedVersionNumber = options.subscription?.planVersion?.version ?? null;
  const latestVersionNumber = options.subscription?.currentPlanVersion?.version ?? null;
  const versionLagging =
    lockedVersionNumber !== null &&
    latestVersionNumber !== null &&
    lockedVersionNumber !== latestVersionNumber;

  if (options.subscriptionLoading && !options.subscription?.subscription) {
    return html`
      <section class="cost-budget-v2-my-plan-panel card" data-testid="cost-budget-v2-my-plan-loading">
        <div class="enterprise-empty muted">${t("costBudget.v2.loadingSubscription")}</div>
      </section>
    `;
  }

  if (!options.subscription?.subscription) {
    return html`
      <section class="cost-budget-v2-my-plan-panel card" data-testid="cost-budget-v2-my-plan-empty">
        <div class="card-sub">${t("costBudget.emptyNoSubscription")}</div>
        <button type="button" class="btn btn--primary btn--sm" @click=${options.onOpenCatalog}>
          ${t("costBudget.v2.planOrders.openCatalog")}
        </button>
      </section>
    `;
  }

  const subscriptionState = getSubscriptionStoreState();
  const operations = getOperationsStoreState();

  return html`
    <section class="cost-budget-v2-my-plan-panel" data-testid="cost-budget-v2-my-plan-panel">
      <div class="cost-budget-v2-my-plan-panel__toolbar">
        <div>
          <h3 class="enterprise-section-title">${t("costBudget.v2.planOrders.myPlanTitle")}</h3>
          <p class="enterprise-hint cost-budget-v2-my-plan-panel__subtitle">
            ${t("costBudget.v2.myPlan.pageSubtitle")}
          </p>
        </div>
        <button
          type="button"
          class="btn btn--sm"
          data-testid="cost-budget-v2-open-catalog"
          @click=${options.onChangePlan ?? options.onOpenCatalog}
        >
          ${t("costBudget.v2.planOrders.changePlan")}
        </button>
      </div>

      <div class="cost-budget-v2-my-plan-layout cost-budget-v2-my-plan-layout--split">
        <div class="enterprise-card cost-budget-v2-my-plan-layout__primary">
          ${
            currentCard
              ? html`
                  <div class="cost-budget-v2-my-plan-panel__card">
                    ${renderPricingCard({
                      plan: currentCard,
                      selectedCycle: options.selectedCycle,
                      readOnly: true,
                      currentPlanId,
                    })}
                  </div>
                `
              : html`
                  <div class="muted">${options.subscription.planView?.name ?? currentPlanId}</div>
                `
          }
          ${
            lockedVersionNumber !== null || latestVersionNumber !== null
              ? html`
                  <div class="cost-budget-v2-my-plan-panel__version-row">
                    ${
                      lockedVersionNumber !== null
                        ? html`
                            <span class="cost-budget-v2-overview-chip cost-budget-v2-overview-chip--muted">
                              ${t("costBudget.v2.myPlan.lockedVersion", {
                                version: `v${lockedVersionNumber}`,
                              })}
                            </span>
                          `
                        : null
                    }
                    ${
                      versionLagging && latestVersionNumber !== null
                        ? html`
                            <span class="cost-budget-v2-overview-chip">
                              ${t("costBudget.v2.myPlan.latestVersion", {
                                version: `v${latestVersionNumber}`,
                              })}
                            </span>
                          `
                        : null
                    }
                  </div>
                  <div class="enterprise-hint cost-budget-v2-my-plan-panel__version-hint">
                    ${t(
                      versionLagging
                        ? "costBudget.v2.myPlan.versionLagging"
                        : "costBudget.v2.myPlan.versionCurrent",
                    )}
                  </div>
                `
              : null
          }
        </div>

        <aside class="cost-budget-v2-my-plan-layout__aside">
          ${renderPlanGrowthPathPanel({
            subscription: options.subscription,
            operations,
            orders: subscriptionState.commercialOrders,
            onRefresh: options.onRefresh,
          })}
        </aside>
      </div>
    </section>
  `;
}

/** 未订阅时「我的套餐」无内容，回退到选购对比；已订阅用户显式进入 catalog 须保留。 */
export function defaultPlanOrdersPanelForSubscription(
  panel: CostBudgetV2PlanOrdersPanel,
  hasSubscription: boolean,
): CostBudgetV2PlanOrdersPanel {
  if (!hasSubscription && panel === "plan") {
    return "catalog";
  }
  return panel;
}
