/**
 * 平台 Pricing v3 对外 catalog（PlanVersion + EntitlementSnapshot → ViewModel）。
 */

import { listPlans } from "../billing/plans-store.js";
import { getPlanEntitlementSnapshot } from "../package-entitlement/plan-version-entitlement-store.js";
import type { EntitlementSnapshot } from "../package-entitlement/types.js";
import { buildPricingCatalogViewModel } from "../platform/pricing/pricing-view-model.js";
import type { GatewayRequestHandlers } from "./types.js";

async function loadEntitlementsByPlanVersion(
  planVersionIds: readonly string[],
): Promise<Map<string, EntitlementSnapshot | undefined>> {
  const map = new Map<string, EntitlementSnapshot | undefined>();
  await Promise.all(
    planVersionIds.map(async (planVersionId) => {
      const snapshot = await getPlanEntitlementSnapshot(planVersionId);
      map.set(planVersionId, snapshot ?? undefined);
    }),
  );
  return map;
}

export const platformPricingCatalogHandlers: GatewayRequestHandlers = {
  "platform-pricing.catalog": async ({ respond }) => {
    const plans = (await listPlans()).filter((plan) => plan.status === "active");
    const entitlementByPlanVersionId = await loadEntitlementsByPlanVersion(
      plans.map((plan) => plan.currentVersionId),
    );
    const catalog = buildPricingCatalogViewModel({
      plans,
      entitlementByPlanVersionId,
    });
    respond(true, catalog);
  },
};
