/**
 * 解析套餐版本 Entitlement（stored snapshot 优先，PlanVersion 回退）。
 */

import { getPlanVersion } from "../billing/plans-store.js";
import { getPlanVersionModelBinding } from "../model-entitlement/plan-version-model-binding-store.js";
import {
  DEFAULT_OVERAGE_POLICY,
  defaultMaxConcurrentRuns,
  normalizeEntitlementSnapshot,
} from "./normalize-entitlement.js";
import { getPlanEntitlementSnapshot } from "./plan-version-entitlement-store.js";
import type { EntitlementSnapshot } from "./types.js";

export async function resolvePlanVersionEntitlement(
  planVersionId: string,
): Promise<EntitlementSnapshot | null> {
  const id = planVersionId.trim();
  if (!id) {
    return null;
  }
  const stored = await getPlanEntitlementSnapshot(id);
  if (stored) {
    return stored;
  }
  const version = await getPlanVersion(id);
  if (!version) {
    return null;
  }
  const binding = await getPlanVersionModelBinding(id);
  return normalizeEntitlementSnapshot({
    planVersionId: id,
    monthlyPriceCents: version.snapshot.basePriceCents ?? 0,
    monthlyCredits: 0,
    maxSeats: version.snapshot.seatQuota ?? {},
    maxBots: version.snapshot.botQuota ?? 0,
    maxConcurrentRuns: defaultMaxConcurrentRuns(version.snapshot.botQuota ?? 0),
    allowedPolicies: binding?.allowedPolicies ?? [],
    allowedTiers: binding?.allowedTiers ?? [],
    overagePolicy: DEFAULT_OVERAGE_POLICY,
    updatedAt: new Date().toISOString(),
  });
}

export async function resolvePlanEntitlementsForPlans(
  plans: ReadonlyArray<{ id: string; currentVersionId: string }>,
): Promise<Record<string, EntitlementSnapshot | null>> {
  const entries = await Promise.all(
    plans.map(async (plan) => {
      const entitlement = await resolvePlanVersionEntitlement(plan.currentVersionId);
      return [plan.id, entitlement] as const;
    }),
  );
  return Object.fromEntries(entries);
}
