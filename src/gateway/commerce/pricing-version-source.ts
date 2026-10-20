/**
 * 商业报价真源：PlanVersion.snapshot.basePriceCents（非 Plan 头记录）。
 */

import { normalizeBillingCycle } from "../billing/billing-cycle-pricing.js";
import type { BillingCycle, Plan, PlanVersion } from "../billing/types.js";

export type VersionPricingSource = {
  planVersionId: string;
  planId: string;
  planName: string;
  basePriceCents: number;
  billingCycle: BillingCycle;
};

export function versionPricingSource(
  plan: Plan,
  version: PlanVersion,
  billingCycle?: BillingCycle,
): VersionPricingSource {
  const resolvedBillingCycle =
    normalizeBillingCycle(billingCycle ?? plan.billingCycle) ?? "monthly";
  return {
    planVersionId: version.id,
    planId: plan.id,
    planName: plan.name,
    basePriceCents: version.snapshot.basePriceCents,
    billingCycle: resolvedBillingCycle,
  };
}
