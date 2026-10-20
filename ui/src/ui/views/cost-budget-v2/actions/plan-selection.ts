import { createCostBudgetGateway } from "../../../capability/cost-budget-billing/gateway-client.ts";
import type { PricingPlanViewModel } from "../../../capability/platform-pricing-catalog/index.ts";
import type { GatewayBrowserClient } from "../../../gateway.ts";
import { setCostBudgetSeatBootstrapGuide } from "../../cost-budget/cost-budget-seats-workspace.ts";
import type { CostBudgetV2NavigateTarget } from "../shell/cost-budget-v2-routes.ts";
import {
  reloadSubscriptionStore,
  setPendingOrderId,
  setSubscriptionActionBusy,
  setSubscriptionActionError,
  setSubscriptionActionNotice,
} from "../stores/subscription-store.ts";
import { formatSubscriptionProvisioningNotice } from "./subscription-notice.ts";

export type PlanSelectionCallbacks = {
  onNavigate: (target: CostBudgetV2NavigateTarget) => void;
};

export async function executePlanSelectionV2(
  client: GatewayBrowserClient,
  plan: PricingPlanViewModel,
  hasSubscription: boolean,
  callbacks: PlanSelectionCallbacks,
): Promise<void> {
  setSubscriptionActionNotice(null);
  setSubscriptionActionError(null);
  setSubscriptionActionBusy(true);
  const gw = createCostBudgetGateway(client);
  try {
    if (!hasSubscription) {
      const result = await gw.subscribe({ planId: plan.id });
      if (result.commerce && !result.autoPaid && result.order) {
        setPendingOrderId(result.order.id);
        setSubscriptionActionNotice(`订单已创建（${result.order.id}），请完成支付后等待核销。`);
        await reloadSubscriptionStore(client);
        callbacks.onNavigate({
          route: "plan-orders",
          planOrdersPanel: "orders",
          hash: "#orders",
        });
        return;
      }
      const prov = result.provisioning ?? null;
      setCostBudgetSeatBootstrapGuide(prov);
      setSubscriptionActionNotice(formatSubscriptionProvisioningNotice(prov, "subscribe"));
      await reloadSubscriptionStore(client);
      callbacks.onNavigate({ route: "seats" });
      return;
    }

    const result = await gw.changePlan({ targetPlanId: plan.id, effective: "now" });
    if (result.commerce && !result.autoPaid && result.order) {
      setPendingOrderId(result.order.id);
      setSubscriptionActionNotice(`换套餐订单已创建（${result.order.id}），请完成支付后等待核销。`);
      await reloadSubscriptionStore(client);
      callbacks.onNavigate({
        route: "plan-orders",
        planOrdersPanel: "orders",
        hash: "#orders",
      });
      return;
    }
    const prov = result.provisioning ?? null;
    setCostBudgetSeatBootstrapGuide(prov);
    setSubscriptionActionNotice(formatSubscriptionProvisioningNotice(prov, "changePlan"));
    await reloadSubscriptionStore(client);
    callbacks.onNavigate({ route: "seats" });
  } catch (err) {
    setSubscriptionActionError(err instanceof Error ? err.message : "操作失败");
  } finally {
    setSubscriptionActionBusy(false);
  }
}
