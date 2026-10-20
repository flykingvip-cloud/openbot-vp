import { html, type TemplateResult } from "lit";
import { t } from "../../../../i18n/index.ts";
import type { GatewayBrowserClient } from "../../../gateway.ts";
import { renderPricingContactSales } from "../../../ports/platform/pricing/pricing-contact-sales.ts";
import { renderCostBudgetOrdersPage } from "../../cost-budget/cost-budget-orders.ts";
import { renderEnterpriseSegmentedNav } from "../../enterprise-segmented-nav.ts";
import { executePlanSelectionV2 } from "../actions/plan-selection.ts";
import { renderCatalogPanel } from "../panels/plan/catalog-panel.ts";
import { openChangePlanForPricingPlanId } from "../panels/plan/change-plan-drawer.ts";
import {
  defaultPlanOrdersPanelForSubscription,
  renderMyPlanPanel,
} from "../panels/plan/my-plan-panel.ts";
import type {
  CostBudgetV2NavigateTarget,
  CostBudgetV2PlanOrdersPanel,
} from "../shell/cost-budget-v2-routes.ts";
import { isCostBudgetGatewayReady } from "../stores/gateway-ready.ts";
import {
  closeContactSales,
  ensureSubscriptionStore,
  getSubscriptionStoreState,
  hasActiveSubscription,
  markContactSalesSubmitted,
  openContactSales,
  setSubscriptionComparisonCycle,
} from "../stores/subscription-store.ts";

const PLAN_ORDERS_PANELS: readonly CostBudgetV2PlanOrdersPanel[] = ["plan", "catalog", "orders"];

export type PlanOrdersPageOptions = {
  client: GatewayBrowserClient | null;
  tenantId: string;
  activePanel: CostBudgetV2PlanOrdersPanel;
  onNavigate: (target: CostBudgetV2NavigateTarget) => void;
  onRefresh: () => void;
};

function planOrdersPanelLabel(panel: CostBudgetV2PlanOrdersPanel): string {
  switch (panel) {
    case "plan":
      return t("costBudget.v2.planOrders.panelPlan");
    case "catalog":
      return t("costBudget.v2.planOrders.panelCatalog");
    case "orders":
      return t("costBudget.v2.planOrders.panelOrders");
  }
}

function renderPanelNav(
  activePanel: CostBudgetV2PlanOrdersPanel,
  onSelect: (panel: CostBudgetV2PlanOrdersPanel) => void,
): TemplateResult {
  return html`
    <nav class="cost-budget-commerce-panel-nav" data-testid="cost-budget-v2-plan-orders-nav">
      ${renderEnterpriseSegmentedNav(
        PLAN_ORDERS_PANELS.map((panel) => ({
          id: panel,
          label: planOrdersPanelLabel(panel),
          active: activePanel === panel,
        })),
        (id) => onSelect(id as CostBudgetV2PlanOrdersPanel),
      )}
    </nav>
  `;
}

export function renderPlanOrdersPage(options: PlanOrdersPageOptions): TemplateResult {
  const store = getSubscriptionStoreState();
  const subscription = store.data;
  const activePanel = defaultPlanOrdersPanelForSubscription(
    options.activePanel,
    hasActiveSubscription(),
  );

  if (store.contactSalesPlanId && subscription) {
    const salesPlan =
      subscription.availablePlans.find((plan) => plan.id === store.contactSalesPlanId) ?? null;
    return renderPricingContactSales({
      plan: salesPlan,
      submitted: store.contactSalesSubmitted,
      onBack: () => {
        closeContactSales();
        options.onRefresh();
      },
      onSubmit: () => {
        markContactSalesSubmitted();
        options.onRefresh();
      },
    });
  }

  if (!options.client) {
    return html`<div class="enterprise-empty">${t("costBudget.v2.gatewayDisconnected")}</div>`;
  }

  if (!isCostBudgetGatewayReady(options.client)) {
    return html`
      <div class="enterprise-empty muted" data-testid="cost-budget-v2-gateway-reconnect-hint">
        ${t("costBudget.v2.gatewayReconnecting")}
      </div>
    `;
  }

  const navigate = options.onNavigate;

  return html`
    <div class="cost-budget-v2-plan-orders-page" data-testid="cost-budget-v2-plan-orders-page">
      ${renderPanelNav(activePanel, (panel) => {
        navigate({
          route: "plan-orders",
          planOrdersPanel: panel,
          hash: panel === "catalog" ? "" : `#${panel}`,
        });
      })}
      ${
        activePanel === "plan"
          ? renderMyPlanPanel({
              subscription,
              subscriptionLoading: store.loading && !store.loadAttempted,
              selectedCycle: store.comparisonCycle,
              onOpenCatalog: () => navigate({ route: "plan-orders", planOrdersPanel: "catalog" }),
              onChangePlan: () => navigate({ route: "plan-orders", planOrdersPanel: "catalog" }),
              onNavigate: navigate,
              onRefresh: options.onRefresh,
            })
          : activePanel === "catalog"
            ? renderCatalogPanel({
                client: options.client,
                subscription,
                loading: store.loading || store.status === "loading",
                error: store.error,
                subscriptionError: store.subscriptionError,
                selectedCycle: store.comparisonCycle,
                actionNotice: store.actionNotice,
                actionError: store.actionError,
                actionBusy: store.actionBusy,
                onSelectCycle: (cycle) => {
                  setSubscriptionComparisonCycle(cycle);
                  options.onRefresh();
                },
                onContactSales: (plan) => {
                  openContactSales(plan.id);
                  options.onRefresh();
                },
                onReload: () => {
                  if (!options.client) {
                    return;
                  }
                  ensureSubscriptionStore(options.client, options.onRefresh, {
                    force: true,
                    tenantId: options.tenantId,
                  });
                },
                onSelectPlan: (plan) => {
                  if (!options.client || store.actionBusy) {
                    return;
                  }
                  if (hasActiveSubscription()) {
                    openChangePlanForPricingPlanId(
                      options.client,
                      plan.id,
                      subscription?.subscription?.planId,
                      options.onRefresh,
                    );
                    return;
                  }
                  void executePlanSelectionV2(options.client, plan, false, {
                    onNavigate: navigate,
                  }).then(() => options.onRefresh());
                },
              })
            : renderCostBudgetOrdersPage(options.client, options.onRefresh, {
                initialOrderId: store.pendingOrderId,
                onNavigateSeats: () => navigate({ route: "seats" }),
              })
      }
    </div>
  `;
}
