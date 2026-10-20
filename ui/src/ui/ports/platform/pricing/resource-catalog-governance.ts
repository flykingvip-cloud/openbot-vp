import type { Plan } from "../../../capability/cost-budget-billing/index.ts";
import type { RoutingPolicy } from "../../../capability/policy-engine/index.ts";
import type {
  ResourceModelCatalogEntry,
  ResourceTier,
  TierUsageStat,
} from "../../../capability/resource-catalog/index.ts";
import type { TierModelGroup } from "./resource-catalog-display.ts";
import { sortTiers } from "./resource-catalog-display.ts";
import type { ResourceCatalogSectionOptions } from "./resource-catalog-plan-preview.ts";

export type RoutingStrategyReference = {
  id: string;
  implemented: boolean;
};

export const ROUTING_STRATEGY_REFERENCES: RoutingStrategyReference[] = [
  { id: "cheapest", implemented: true },
  { id: "balanced", implemented: true },
  { id: "best_quality", implemented: true },
  { id: "bandit", implemented: true },
  { id: "failover", implemented: false },
  { id: "latency_first", implemented: false },
];

export function tierDisplayCode(tier: ResourceTier): string {
  const code = tier.code?.trim();
  if (code) {
    return code.length === 1 ? code.toUpperCase() : code;
  }
  const match = tier.id.match(/tier_([a-z0-9]+)/i);
  if (match) {
    return match[1].toUpperCase();
  }
  return tier.name.charAt(0).toUpperCase();
}

export function tierHeadline(tier: ResourceTier): string {
  return `Tier ${tierDisplayCode(tier)} · ${tier.name}`;
}

/** Tier 治理卡标题：Tier 代码 + 能力层副标题。 */
export function tierCardHeadline(tier: ResourceTier, layerLabel: string): string {
  return `Tier ${tierDisplayCode(tier)} · ${layerLabel}`;
}

function resolvePlanAllowedTiers(
  plan: Plan,
  versionMetaById: ResourceCatalogSectionOptions["versionMetaById"],
): string[] {
  const meta = versionMetaById?.[plan.currentVersionId];
  return meta?.binding?.allowedTiers ?? meta?.entitlementSnapshot?.allowedTiers ?? [];
}

export function activePlans(options: ResourceCatalogSectionOptions): Plan[] {
  return (options.plans ?? []).filter((plan) => plan.status === "active");
}

export function plansUnlockingTier(tierId: string, options: ResourceCatalogSectionOptions): Plan[] {
  return activePlans(options).filter((plan) =>
    resolvePlanAllowedTiers(plan, options.versionMetaById).includes(tierId),
  );
}

export type PlanTierMatrixRow = {
  planId: string;
  planName: string;
  tierLabels: string;
};

export function buildPlanTierMatrix(
  tiers: ResourceTier[],
  options: ResourceCatalogSectionOptions,
): PlanTierMatrixRow[] {
  const sorted = sortTiers(tiers);
  return activePlans(options)
    .map((plan) => {
      const allowed = new Set(resolvePlanAllowedTiers(plan, options.versionMetaById));
      const labels = sorted
        .filter((tier) => allowed.has(tier.id))
        .map((tier) => `Tier ${tierDisplayCode(tier)}`);
      return {
        planId: plan.id,
        planName: plan.name,
        tierLabels: labels.length > 0 ? labels.join(" + ") : "—",
      };
    })
    .toSorted((left, right) => left.planName.localeCompare(right.planName));
}

export function summarizeModelPool(models: TierModelGroup["models"]): string {
  if (models.length === 0) {
    return "";
  }
  return models.map((model) => model.displayName).join(" · ");
}

export function routingSummaryForTier(
  tierId: string,
  options: ResourceCatalogSectionOptions,
  policies: RoutingPolicy[],
): string {
  const labels = new Set<string>();
  for (const plan of plansUnlockingTier(tierId, options)) {
    const meta = options.versionMetaById?.[plan.currentVersionId];
    const policyId = meta?.binding?.policyId ?? "balanced";
    const policy = policies.find((entry) => entry.id === policyId);
    labels.add(policy?.name ?? policyId);
  }
  if (labels.size === 0) {
    const fallback = policies.find((entry) => entry.selectorStrategy === "balanced");
    return fallback?.name ?? "balanced";
  }
  return [...labels].join(" / ");
}

export function policyByStrategy(
  strategy: string,
  policies: RoutingPolicy[],
): RoutingPolicy | undefined {
  return policies.find((policy) => policy.selectorStrategy === strategy);
}

export function formatTierTaskCount(count: number): string {
  return count.toLocaleString();
}

export function formatTierLatencyMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || ms <= 0) {
    return "";
  }
  if (ms >= 1000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  return `${Math.round(ms)}ms`;
}

export function formatTierFailureRate(rate: number | null | undefined): string {
  if (rate === null || rate === undefined) {
    return "";
  }
  return `${rate.toFixed(1)}%`;
}

export function tierUsageStatById(
  stats: readonly TierUsageStat[],
  tierId: string,
): TierUsageStat | undefined {
  return stats.find((entry) => entry.tierId === tierId);
}

export type GovernanceOverviewKpis = {
  activeModels: number;
  tierCount: number;
  enterpriseCount: number | null;
  periodCostCents: number | null;
};

export function buildGovernanceOverviewKpis(
  models: ResourceModelCatalogEntry[],
  tiers: ResourceTier[],
  options: ResourceCatalogSectionOptions,
): GovernanceOverviewKpis {
  return {
    activeModels: models.filter((model) => model.enabled).length,
    tierCount: tiers.filter((tier) => tier.status === "active").length,
    enterpriseCount: options.commercialSummary?.totals.activeSubscriptions ?? null,
    periodCostCents:
      options.economicsSummary && options.economicsSummary.providerCostCents > 0
        ? options.economicsSummary.providerCostCents
        : null,
  };
}

export function fmtGovernanceMoney(cents: number): string {
  return `¥${(cents / 100).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

export type GovernanceSystemSignal = {
  id: string;
  tone: "ok" | "warn" | "danger";
  messageKey:
    | "governanceStatusOk"
    | "governanceStatusTierPressure"
    | "governanceStatusHighFailure"
    | "governanceStatusDisabledModels";
  tierCode?: string;
  disabledModelCount?: number;
};

export function buildGovernanceSystemSignals(
  groups: TierModelGroup[],
  tierUsageStats: readonly TierUsageStat[],
  models: ResourceModelCatalogEntry[],
): GovernanceSystemSignal[] {
  const signals: GovernanceSystemSignal[] = [];
  for (const group of groups) {
    const usage = tierUsageStatById(tierUsageStats, group.tier.id);
    if (usage?.avgLatencyMs && usage.avgLatencyMs >= 5000) {
      signals.push({
        id: `latency-${group.tier.id}`,
        tone: "warn",
        messageKey: "governanceStatusTierPressure",
        tierCode: tierDisplayCode(group.tier),
      });
    }
    if (usage?.failureRate !== null && usage?.failureRate !== undefined && usage.failureRate >= 2) {
      signals.push({
        id: `failure-${group.tier.id}`,
        tone: "danger",
        messageKey: "governanceStatusHighFailure",
        tierCode: tierDisplayCode(group.tier),
      });
    }
  }
  const disabledCount = models.filter((model) => !model.enabled).length;
  if (disabledCount > 0) {
    signals.push({
      id: "disabled-models",
      tone: "warn",
      messageKey: "governanceStatusDisabledModels",
      disabledModelCount: disabledCount,
    });
  }
  if (signals.length === 0) {
    signals.push({ id: "ok", tone: "ok", messageKey: "governanceStatusOk" });
  }
  return signals;
}

export function countEnterprisesServingTier(
  tierId: string,
  options: ResourceCatalogSectionOptions,
): number {
  return plansUnlockingTier(tierId, options).reduce((sum, plan) => {
    return sum + (options.commercialSummary?.plans[plan.id]?.activeSubscriptions ?? 0);
  }, 0);
}

export type PlanAuthorizationRow = {
  planId: string;
  planName: string;
  tierLabels: string;
  policyLabel: string;
  maxConcurrentLabel: string;
  maxBotsLabel: string;
};

export function formatGovernanceConcurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "—";
  }
  if (value === 0) {
    return "∞";
  }
  return String(value);
}

export function buildPlanAuthorizationRows(
  tiers: ResourceTier[],
  options: ResourceCatalogSectionOptions,
  policies: RoutingPolicy[],
): PlanAuthorizationRow[] {
  const sorted = sortTiers(tiers);
  return activePlans(options)
    .map((plan) => {
      const meta = options.versionMetaById?.[plan.currentVersionId];
      const entitlement = meta?.entitlementSnapshot;
      const allowed = new Set(resolvePlanAllowedTiers(plan, options.versionMetaById));
      const tierLabels =
        sorted
          .filter((tier) => allowed.has(tier.id))
          .map((tier) => `Tier ${tierDisplayCode(tier)}`)
          .join(" + ") || "—";
      const policyId = meta?.binding?.policyId ?? "balanced";
      const policy = policies.find((entry) => entry.id === policyId);
      const policyLabel = policy?.name ?? policyId;
      const maxBots = entitlement?.maxBots ?? plan.botQuota;
      return {
        planId: plan.id,
        planName: plan.name,
        tierLabels,
        policyLabel,
        maxConcurrentLabel: formatGovernanceConcurrency(entitlement?.maxConcurrentRuns),
        maxBotsLabel: maxBots > 0 ? String(maxBots) : "—",
      };
    })
    .toSorted((left, right) => left.planName.localeCompare(right.planName));
}

export function modelCostLevelLabel(creditCost: number | null | undefined): "low" | "mid" | "high" {
  if (creditCost === null || creditCost === undefined || creditCost <= 1) {
    return "low";
  }
  if (creditCost <= 5) {
    return "mid";
  }
  return "high";
}
