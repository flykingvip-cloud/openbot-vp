/**
 * CostVersion 满额成本预测上下文（纯函数 + IO 组装）。
 *
 * 用各 Tier 代表模型 + 基准 token 用量 + Credit 权重，估算 cost/credit，
 * 供 UI 做满额配额 provider cost 预测（不依赖历史 avg cost/credit 启发式）。
 */

import type { SelectionStrategy } from "@openbot/aor-core";
import { resolveCreditCostForTier } from "../billing/credit-meter.js";
import {
  computeProviderCostCentsFloat,
  type TokenUsageInput,
} from "../cost-version/provider-cost.js";
import type { CostVersion } from "../cost-version/types.js";
import type { UsageLedgerEntry } from "../package-entitlement/types.js";
import type { CreditWeight, ResourceModelCatalogEntry } from "../resource-catalog/types.js";
import {
  deriveBenchmarkUsageFromLedger,
  deriveObservedTierMixFromLedger,
  DEFAULT_BENCHMARK_USAGE,
} from "./ledger-benchmark.js";
import {
  buildSelectorMixProfiles,
  resolveTierMixForPlan,
  type TierMixWeights,
  weightedCostPerCredit,
} from "./tier-mix-weights.js";

export { DEFAULT_BENCHMARK_USAGE } from "./ledger-benchmark.js";

export type TierProjectionCost = {
  tier: string;
  modelId: string;
  creditCost: number;
  providerCostPerTaskCents: number;
  providerCostPerCreditCents: number | null;
};

export type EconomicsProjectionContext = {
  benchmark: TokenUsageInput;
  benchmarkSource: "ledger" | "default";
  benchmarkSampleCount: number;
  creditWeights: Array<{ tier: string; creditCost: number }>;
  tierCosts: Record<
    string,
    {
      modelId: string;
      inputCostPer1MCents: number;
      outputCostPer1MCents: number;
      creditCost: number;
      providerCostPerTaskCents: number;
      providerCostPerCreditCents: number | null;
    }
  >;
  tierObservedMix: TierMixWeights;
  selectorMixProfiles: Partial<Record<SelectionStrategy, TierMixWeights>>;
};

function resolveModelRates(
  modelId: string,
  activeCostVersion: CostVersion | null | undefined,
  catalogEntry: ResourceModelCatalogEntry,
): { inputCostPer1MCents: number; outputCostPer1MCents: number } {
  const fromVersion = activeCostVersion?.modelCosts[modelId];
  if (fromVersion) {
    return {
      inputCostPer1MCents: fromVersion.inputCostPer1MCents,
      outputCostPer1MCents: fromVersion.outputCostPer1MCents,
    };
  }
  return {
    inputCostPer1MCents: catalogEntry.inputCostPer1MCents,
    outputCostPer1MCents: catalogEntry.outputCostPer1MCents,
  };
}

function combinedRate(inputCostPer1MCents: number, outputCostPer1MCents: number): number {
  return inputCostPer1MCents + outputCostPer1MCents;
}

export function pickRepresentativeModelForTier(
  tier: string,
  models: readonly ResourceModelCatalogEntry[],
  activeCostVersion: CostVersion | null | undefined,
): ResourceModelCatalogEntry | null {
  const enabled = models.filter((m) => m.tier === tier && m.enabled);
  if (enabled.length === 0) {
    return null;
  }
  return enabled.toSorted((a, b) => {
    const aRates = resolveModelRates(a.modelId, activeCostVersion, a);
    const bRates = resolveModelRates(b.modelId, activeCostVersion, b);
    return (
      combinedRate(aRates.inputCostPer1MCents, aRates.outputCostPer1MCents) -
      combinedRate(bRates.inputCostPer1MCents, bRates.outputCostPer1MCents)
    );
  })[0];
}

export function buildTierProjectionCost(params: {
  tier: string;
  model: ResourceModelCatalogEntry;
  activeCostVersion: CostVersion | null | undefined;
  creditWeights: readonly CreditWeight[];
  benchmark?: TokenUsageInput;
}): TierProjectionCost {
  const benchmark = params.benchmark ?? DEFAULT_BENCHMARK_USAGE;
  const rates = resolveModelRates(params.model.modelId, params.activeCostVersion, params.model);
  const creditCost = resolveCreditCostForTier(params.tier, params.creditWeights);
  const providerCostPerTaskCents = computeProviderCostCentsFloat({
    usage: benchmark,
    inputCostPer1MCents: rates.inputCostPer1MCents,
    outputCostPer1MCents: rates.outputCostPer1MCents,
  });
  const providerCostPerCreditCents = creditCost > 0 ? providerCostPerTaskCents / creditCost : null;
  return {
    tier: params.tier,
    modelId: params.model.modelId,
    creditCost,
    providerCostPerTaskCents,
    providerCostPerCreditCents,
  };
}

export function projectFullQuotaProviderCostCents(params: {
  monthlyCredits: number;
  allowedTiers: readonly string[];
  tierProjections: readonly TierProjectionCost[];
  tierWeights?: TierMixWeights;
}): number | null {
  const credits = Math.max(0, Math.floor(params.monthlyCredits));
  if (credits <= 0 || params.allowedTiers.length === 0) {
    return null;
  }
  const costPerCreditByTier = Object.fromEntries(
    params.tierProjections.map((row) => [row.tier, row.providerCostPerCreditCents]),
  );
  const tierSet = new Set(params.allowedTiers.map((t) => t.trim()).filter(Boolean));
  const filteredCosts: Record<string, number | null> = {};
  for (const tier of tierSet) {
    filteredCosts[tier] = costPerCreditByTier[tier] ?? null;
  }
  if (params.tierWeights && Object.keys(params.tierWeights).length > 0) {
    const blended = weightedCostPerCredit({
      tierMix: params.tierWeights,
      costPerCreditByTier: filteredCosts,
    });
    return blended !== null ? Math.round(credits * blended) : null;
  }
  const relevant = params.tierProjections.filter(
    (row) => tierSet.has(row.tier) && row.providerCostPerCreditCents !== null,
  );
  if (relevant.length === 0) {
    return null;
  }
  const blendedCostPerCredit =
    relevant.reduce((sum, row) => sum + row.providerCostPerCreditCents!, 0) / relevant.length;
  return Math.round(credits * blendedCostPerCredit);
}

export function projectFullQuotaForPlan(params: {
  monthlyCredits: number;
  allowedTiers: readonly string[];
  selectorStrategy: SelectionStrategy;
  projectionContext: EconomicsProjectionContext;
}): number | null {
  const tierProjections = Object.entries(params.projectionContext.tierCosts).map(([tier, row]) => ({
    tier,
    modelId: row.modelId,
    creditCost: row.creditCost,
    providerCostPerTaskCents: row.providerCostPerTaskCents,
    providerCostPerCreditCents: row.providerCostPerCreditCents,
  }));
  const tierWeights = resolveTierMixForPlanProjection({
    allowedTiers: params.allowedTiers,
    selectorStrategy: params.selectorStrategy,
    projectionContext: params.projectionContext,
  });
  return projectFullQuotaProviderCostCents({
    monthlyCredits: params.monthlyCredits,
    allowedTiers: params.allowedTiers,
    tierProjections,
    tierWeights,
  });
}

export function resolveTierMixForPlanProjection(params: {
  allowedTiers: readonly string[];
  selectorStrategy: SelectionStrategy;
  projectionContext: EconomicsProjectionContext;
}): TierMixWeights {
  return resolveTierMixForPlan({
    allowedTiers: params.allowedTiers,
    selectorStrategy: params.selectorStrategy,
    selectorMixProfiles: params.projectionContext.selectorMixProfiles,
    tierObservedMix: params.projectionContext.tierObservedMix,
  });
}

export function buildEconomicsProjectionContext(params: {
  models: readonly ResourceModelCatalogEntry[];
  creditWeights: readonly CreditWeight[];
  activeCostVersion: CostVersion | null | undefined;
  ledgerEntries?: readonly UsageLedgerEntry[];
  benchmark?: TokenUsageInput;
}): EconomicsProjectionContext {
  const ledgerBenchmark = deriveBenchmarkUsageFromLedger(params.ledgerEntries ?? []);
  const benchmark = params.benchmark ?? ledgerBenchmark.benchmark;
  const benchmarkSource = params.benchmark ? "default" : ledgerBenchmark.source;
  const benchmarkSampleCount = params.benchmark ? 0 : ledgerBenchmark.sampleCount;
  const tiers = [...new Set(params.models.filter((m) => m.enabled).map((m) => m.tier))];
  const tierCosts: EconomicsProjectionContext["tierCosts"] = {};
  for (const tier of tiers) {
    const model = pickRepresentativeModelForTier(tier, params.models, params.activeCostVersion);
    if (!model) {
      continue;
    }
    const projection = buildTierProjectionCost({
      tier,
      model,
      activeCostVersion: params.activeCostVersion,
      creditWeights: params.creditWeights,
      benchmark,
    });
    const rates = resolveModelRates(model.modelId, params.activeCostVersion, model);
    tierCosts[tier] = {
      modelId: model.modelId,
      inputCostPer1MCents: rates.inputCostPer1MCents,
      outputCostPer1MCents: rates.outputCostPer1MCents,
      creditCost: projection.creditCost,
      providerCostPerTaskCents: projection.providerCostPerTaskCents,
      providerCostPerCreditCents: projection.providerCostPerCreditCents,
    };
  }
  return {
    benchmark,
    benchmarkSource,
    benchmarkSampleCount,
    creditWeights: params.creditWeights.map((w) => ({
      tier: w.tier,
      creditCost: w.creditCost,
    })),
    tierCosts,
    tierObservedMix: deriveObservedTierMixFromLedger(params.ledgerEntries ?? []),
    selectorMixProfiles: buildSelectorMixProfiles({
      tiers: Object.keys(tierCosts),
      costPerCreditByTier: Object.fromEntries(
        Object.entries(tierCosts).map(([tier, row]) => [tier, row.providerCostPerCreditCents]),
      ),
      creditCostByTier: Object.fromEntries(
        Object.entries(tierCosts).map(([tier, row]) => [tier, row.creditCost]),
      ),
    }),
  };
}
