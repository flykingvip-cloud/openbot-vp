import type { PlatformPlanBundleVersionRow } from "../../../capability/platform-plan-bundle/index.ts";
import type { RoutingPolicy } from "../../../capability/policy-engine/index.ts";
import type { ResourceTier } from "../../../capability/resource-catalog/index.ts";

export type EntitlementDiffRow = {
  label: string;
  from: string;
  to: string;
};

export function tierCapabilityLabels(
  tierIds: readonly string[],
  catalog: readonly ResourceTier[],
): string[] {
  return tierIds.map((tierId) => {
    const tier = catalog.find((entry) => entry.id === tierId);
    if (tier?.description?.trim()) {
      return tier.description.trim();
    }
    if (tier?.name?.trim()) {
      return tier.name.trim();
    }
    return tierId;
  });
}

export function policyDisplay(
  policyId: string,
  catalog: readonly RoutingPolicy[],
): { name: string; description: string } {
  const policy = catalog.find((entry) => entry.id === policyId);
  return {
    name: policy?.name?.trim() || policyId,
    description: policy?.description?.trim() || "",
  };
}

function formatTierList(tierIds: string[], catalog: ResourceTier[]): string {
  if (tierIds.length === 0) {
    return "—";
  }
  return tierCapabilityLabels(tierIds, catalog).join("、");
}

function formatCredits(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "—";
  }
  if (value === 0) {
    return "Enterprise 预算";
  }
  return String(value);
}

function formatPolicy(policyId: string | undefined, catalog: RoutingPolicy[]): string {
  if (!policyId) {
    return "—";
  }
  const { name, description } = policyDisplay(policyId, catalog);
  return description ? `${name} · ${description}` : name;
}

function formatConcurrencyLimit(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "—";
  }
  if (value === 0) {
    return "不限";
  }
  return String(value);
}

function formatOveragePolicy(
  policy: { type: string; allowBurstConcurrency: boolean } | undefined,
): string {
  if (!policy) {
    return "—";
  }
  const typeLabel =
    policy.type === "credits_only"
      ? "仅扣 Credits"
      : policy.type === "pay_as_you_go"
        ? "按量付费"
        : "超额阻断";
  return policy.allowBurstConcurrency ? `${typeLabel} · 允许 burst` : typeLabel;
}

export function computeEntitlementDiff(
  fromMeta: PlatformPlanBundleVersionRow | null,
  toMeta: PlatformPlanBundleVersionRow | null,
  catalogTiers: ResourceTier[],
  catalogPolicies: RoutingPolicy[],
): EntitlementDiffRow[] {
  const fromCredits = fromMeta?.entitlementSnapshot?.monthlyCredits;
  const toCredits = toMeta?.entitlementSnapshot?.monthlyCredits;
  const fromTiers = uniqueSorted([
    ...(fromMeta?.binding?.allowedTiers ?? []),
    ...(fromMeta?.entitlementSnapshot?.allowedTiers ?? []),
  ]);
  const toTiers = uniqueSorted([
    ...(toMeta?.binding?.allowedTiers ?? []),
    ...(toMeta?.entitlementSnapshot?.allowedTiers ?? []),
  ]);
  const fromPolicy = fromMeta?.binding?.policyId;
  const toPolicy = toMeta?.binding?.policyId;
  const fromConcurrency = fromMeta?.entitlementSnapshot?.maxConcurrentRuns;
  const toConcurrency = toMeta?.entitlementSnapshot?.maxConcurrentRuns;
  const fromOverage = fromMeta?.entitlementSnapshot?.overagePolicy;
  const toOverage = toMeta?.entitlementSnapshot?.overagePolicy;

  const rows: EntitlementDiffRow[] = [];
  if (formatCredits(fromCredits ?? null) !== formatCredits(toCredits ?? null)) {
    rows.push({
      label: "Credits",
      from: formatCredits(fromCredits ?? null),
      to: formatCredits(toCredits ?? null),
    });
  }
  if (formatTierList(fromTiers, catalogTiers) !== formatTierList(toTiers, catalogTiers)) {
    rows.push({
      label: "Tier",
      from: formatTierList(fromTiers, catalogTiers),
      to: formatTierList(toTiers, catalogTiers),
    });
  }
  if (formatPolicy(fromPolicy, catalogPolicies) !== formatPolicy(toPolicy, catalogPolicies)) {
    rows.push({
      label: "Policy",
      from: formatPolicy(fromPolicy, catalogPolicies),
      to: formatPolicy(toPolicy, catalogPolicies),
    });
  }
  if (formatConcurrencyLimit(fromConcurrency) !== formatConcurrencyLimit(toConcurrency)) {
    rows.push({
      label: "Concurrency",
      from: formatConcurrencyLimit(fromConcurrency),
      to: formatConcurrencyLimit(toConcurrency),
    });
  }
  if (formatOveragePolicy(fromOverage) !== formatOveragePolicy(toOverage)) {
    rows.push({
      label: "Overage",
      from: formatOveragePolicy(fromOverage),
      to: formatOveragePolicy(toOverage),
    });
  }
  return rows;
}

export function groupVersionsForTimeline<T extends { status: string; version: number }>(
  versions: T[],
): { active: T | null; drafts: T[]; historical: T[] } {
  const sorted = [...versions].toSorted((a, b) => b.version - a.version);
  return {
    active: sorted.find((entry) => entry.status === "active") ?? null,
    drafts: sorted.filter((entry) => entry.status === "draft"),
    historical: sorted.filter((entry) => entry.status === "deprecated"),
  };
}

function uniqueSorted(values: readonly string[]): string[] {
  return [
    ...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0)),
  ].toSorted();
}
