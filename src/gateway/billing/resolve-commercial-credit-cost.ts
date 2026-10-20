/**
 * Credits 计价门面（P2 Wave 2 + P4 tool/runtime factors）。
 *
 * v1（默认）：tier 固定扣点 + 可选 token-weight 乘子（P1 桥接）。
 * v2（开关开启）：tierWeight × tokenCostFactor × toolFactor × runtimeFactor。
 */

import type { TokenUsageInput } from "../cost-version/provider-cost.js";
import { DEFAULT_BENCHMARK_USAGE } from "../economics/ledger-benchmark.js";
import type { EntitlementSnapshot } from "../package-entitlement/types.js";
import type { CreditWeight } from "../resource-catalog/types.js";
import { resolveCreditCostForTier, resolveTokenWeightedCreditCost } from "./credit-meter.js";
import { resolveV2RuntimeFactor, resolveV2ToolFactor } from "./credits-v2-factors.js";

export type CommercialPricingEngine = "v1" | "v2";

export function resolveCreditsV2Enabled(
  features?: EntitlementSnapshot["features"] | null,
): boolean {
  return features?.creditsV2Enabled === true;
}

export type ResolveCommercialCreditCostInput = {
  creditsV2Enabled: boolean;
  tier: string;
  weights: readonly CreditWeight[];
  tokenUsage?: TokenUsageInput;
  toolCallCount?: number;
  toolClasses?: readonly string[];
  durationMs?: number;
  retryCount?: number;
};

export type ResolveCommercialCreditCostResult = {
  creditsCharged: number;
  pricingEngine: CommercialPricingEngine;
  tierWeight: number;
  tokenCostFactor?: number;
  toolFactor?: number;
  runtimeFactor?: number;
};

function resolveTierCreditWeight(
  tier: string,
  weights: readonly CreditWeight[],
): CreditWeight | undefined {
  const id = tier.trim();
  if (!id) {
    return undefined;
  }
  return weights.find((w) => w.tier === id);
}

function resolveV2TokenCostFactor(tokenUsage?: TokenUsageInput): number {
  if (
    !tokenUsage ||
    (tokenUsage.inputTokens === undefined && tokenUsage.outputTokens === undefined)
  ) {
    return 1;
  }
  const actualTotal =
    Math.max(0, Math.floor(tokenUsage.inputTokens ?? 0)) +
    Math.max(0, Math.floor(tokenUsage.outputTokens ?? 0));
  if (actualTotal <= 0) {
    return 1;
  }
  const benchmark = DEFAULT_BENCHMARK_USAGE;
  const benchTotal = Math.max(
    1,
    Math.max(0, Math.floor(benchmark.inputTokens ?? 0)) +
      Math.max(0, Math.floor(benchmark.outputTokens ?? 0)),
  );
  const weightRatio = actualTotal / benchTotal;
  return Math.min(4, Math.max(0.25, weightRatio));
}

/**
 * 统一 Credits 计价入口；开关关闭时与 P1 `resolveTokenWeightedCreditCost` 行为一致。
 */
export function resolveCommercialCreditCost(
  input: ResolveCommercialCreditCostInput,
): ResolveCommercialCreditCostResult {
  const tierWeight = resolveCreditCostForTier(input.tier, input.weights);
  const tierWeightEntry = resolveTierCreditWeight(input.tier, input.weights);

  if (!input.creditsV2Enabled) {
    return {
      creditsCharged: resolveTokenWeightedCreditCost({
        tierBaseCost: tierWeight,
        tokenUsage: input.tokenUsage,
      }),
      pricingEngine: "v1",
      tierWeight,
    };
  }

  if (tierWeight <= 0) {
    return { creditsCharged: 0, pricingEngine: "v2", tierWeight };
  }

  const tokenCostFactor = resolveV2TokenCostFactor(input.tokenUsage);
  const toolFactor = resolveV2ToolFactor({
    toolCallCount: input.toolCallCount,
    toolClasses: input.toolClasses,
    benchmarkToolCalls: tierWeightEntry?.v2ToolBenchmarkCalls,
  });
  const runtimeFactor = resolveV2RuntimeFactor({
    durationMs: input.durationMs,
    retryCount: input.retryCount,
    benchmarkDurationMs: tierWeightEntry?.v2RuntimeBenchmarkMs,
  });
  const raw = tierWeight * tokenCostFactor * toolFactor * runtimeFactor;
  return {
    creditsCharged: Math.max(1, Math.ceil(raw)),
    pricingEngine: "v2",
    tierWeight,
    tokenCostFactor,
    toolFactor,
    runtimeFactor,
  };
}
