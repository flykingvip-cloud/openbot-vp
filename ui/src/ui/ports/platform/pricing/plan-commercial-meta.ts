import type { Plan, PlanVersion } from "../../../capability/cost-budget-billing/index.ts";
import type { PlatformPlanBundleVersionRow } from "../../../capability/platform-plan-bundle/index.ts";
import type { PlatformCommercialSummary } from "../../../capability/platform-subscriptions/index.ts";

type VersionMetaIndex = Record<string, PlatformPlanBundleVersionRow>;
type VersionsByPlanIndex = Record<string, PlanVersion[]>;

function uniqueSorted(values: readonly string[]): string[] {
  return [
    ...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0)),
  ].toSorted();
}

export function planDisplayMeta(
  plan: Pick<Plan, "currentVersionId">,
  versionMetaById: VersionMetaIndex,
): {
  tiers: string[];
  monthlyCredits: number | null;
  policyId: string | null;
} {
  const meta = versionMetaById[plan.currentVersionId];
  const tiers = uniqueSorted(
    meta?.binding?.allowedTiers ?? meta?.entitlementSnapshot?.allowedTiers ?? [],
  );
  const monthlyCredits = meta?.entitlementSnapshot?.monthlyCredits ?? null;
  const policyId = meta?.binding?.policyId ?? null;
  return { tiers, monthlyCredits, policyId };
}

export function versionCommercialMeta(
  versionId: string,
  versionMetaById: VersionMetaIndex,
  versionsByPlan: VersionsByPlanIndex,
): {
  tiers: string[];
  monthlyCredits: number | null;
  policyId: string | null;
  botQuota: number | null;
} {
  const meta = versionMetaById[versionId];
  const version = Object.values(versionsByPlan)
    .flat()
    .find((entry) => entry.id === versionId);
  return {
    tiers: uniqueSorted(
      meta?.binding?.allowedTiers ?? meta?.entitlementSnapshot?.allowedTiers ?? [],
    ),
    monthlyCredits: meta?.entitlementSnapshot?.monthlyCredits ?? null,
    policyId: meta?.binding?.policyId ?? null,
    botQuota: version?.snapshot.botQuota ?? null,
  };
}

export function planCommercialMetrics(
  planId: string,
  commercialSummary: PlatformCommercialSummary | null,
) {
  return commercialSummary?.plans[planId] ?? null;
}

export function versionLockedSubscriptions(
  planId: string,
  versionId: string,
  commercialSummary: PlatformCommercialSummary | null,
): number {
  return commercialSummary?.plans[planId]?.versions[versionId]?.lockedSubscriptions ?? 0;
}
