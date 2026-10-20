import type { SubscriptionPreviewPlanAllocationResponse } from "../../../capability/cost-budget-billing/endpoints.ts";
import { createCostBudgetGateway } from "../../../capability/cost-budget-billing/gateway-client.ts";
import type { PricingDiff } from "../../../capability/cost-budget-billing/index.ts";
import type { GatewayBrowserClient } from "../../../gateway.ts";
import { getSubscriptionStoreState } from "../stores/subscription-store.ts";

export type ChangePlanServerDiffResult = {
  pricingDiff: PricingDiff | null;
  preview: SubscriptionPreviewPlanAllocationResponse | null;
  error: string | null;
};

export async function loadChangePlanServerDiff(
  client: GatewayBrowserClient,
  targetPlanId: string,
): Promise<ChangePlanServerDiffResult> {
  const sub = getSubscriptionStoreState().data;
  const fromVersionId = sub?.subscription?.planVersionId;
  const targetPlan = sub?.availablePlans.find((plan) => plan.id === targetPlanId);
  if (!sub?.subscription || !fromVersionId || !targetPlan) {
    return { pricingDiff: null, preview: null, error: "无法加载套餐对比" };
  }
  const gw = createCostBudgetGateway(client);
  try {
    const previewPromise = gw.previewPlanAllocationByPlanId(targetPlanId);
    const diffPromise =
      fromVersionId === targetPlan.currentVersionId
        ? Promise.resolve({ diff: null as PricingDiff | null })
        : gw
            .diffPlanVersions({
              fromVersionId,
              toVersionId: targetPlan.currentVersionId,
            })
            .then((res) => ({ diff: res.diff }))
            .catch(() => ({ diff: null as PricingDiff | null }));

    const [previewRes, diffRes] = await Promise.all([previewPromise, diffPromise]);
    return {
      pricingDiff: diffRes.diff,
      preview: previewRes,
      error: null,
    };
  } catch (err) {
    return {
      pricingDiff: null,
      preview: null,
      error: err instanceof Error ? err.message : "加载失败",
    };
  }
}
