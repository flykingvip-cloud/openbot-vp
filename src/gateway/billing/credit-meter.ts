/**
 * Credits 计量纯函数（framework-free）。
 */

import type { TokenUsageInput } from "../cost-version/provider-cost.js";
import { DEFAULT_BENCHMARK_USAGE } from "../economics/ledger-benchmark.js";
import type { TenantCreditsBalance } from "../package-entitlement/types.js";
import type { CreditWeight } from "../resource-catalog/types.js";

export function resolveCreditCostForTier(tier: string, weights: readonly CreditWeight[]): number {
  const id = tier.trim();
  if (!id) {
    return 0;
  }
  const match = weights.find((w) => w.tier === id);
  return match?.creditCost ?? 0;
}

/** P3：在 tier 固定扣点基础上按 token 用量加权（相对 benchmark，0.25x–4x 钳制）。 */
export function resolveTokenWeightedCreditCost(input: {
  tierBaseCost: number;
  tokenUsage?: TokenUsageInput;
  benchmark?: TokenUsageInput;
}): number {
  const base = Math.max(0, Math.floor(input.tierBaseCost));
  if (base <= 0) {
    return 0;
  }
  const usage = input.tokenUsage;
  if (!usage || (usage.inputTokens === undefined && usage.outputTokens === undefined)) {
    return base;
  }
  const actualTotal =
    Math.max(0, Math.floor(usage.inputTokens ?? 0)) +
    Math.max(0, Math.floor(usage.outputTokens ?? 0));
  if (actualTotal <= 0) {
    return base;
  }
  const benchmark = input.benchmark ?? DEFAULT_BENCHMARK_USAGE;
  const benchTotal = Math.max(
    1,
    Math.max(0, Math.floor(benchmark.inputTokens ?? 0)) +
      Math.max(0, Math.floor(benchmark.outputTokens ?? 0)),
  );
  const weightRatio = actualTotal / benchTotal;
  const clamped = Math.min(4, Math.max(0.25, weightRatio));
  return Math.max(1, Math.ceil(base * clamped));
}

export function computeCreditsBalance(input: {
  enterpriseId: string;
  cycleStart: string;
  monthlyCredits: number;
  creditsConsumed: number;
  now?: string;
}): TenantCreditsBalance {
  const allocated = Math.max(0, Math.floor(input.monthlyCredits));
  const consumed = Math.max(0, Math.floor(input.creditsConsumed));
  const remaining = Math.max(0, allocated - consumed);
  return {
    enterpriseId: input.enterpriseId,
    cycleStart: input.cycleStart,
    monthlyCredits: allocated,
    creditsConsumed: consumed,
    creditsRemaining: remaining,
    updatedAt: input.now ?? new Date().toISOString(),
  };
}

export function wouldExceedCredits(input: {
  monthlyCredits: number;
  creditsConsumed: number;
  creditsToCharge: number;
}): boolean {
  if (input.monthlyCredits <= 0) {
    return false;
  }
  return input.creditsConsumed + input.creditsToCharge > input.monthlyCredits;
}
