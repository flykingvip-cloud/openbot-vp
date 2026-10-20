/**
 * 从 Usage Ledger 推导 benchmark token 用量（P4）。
 */

import type { TokenUsageInput } from "../cost-version/provider-cost.js";
import type { UsageLedgerEntry } from "../package-entitlement/types.js";

export const DEFAULT_BENCHMARK_USAGE: TokenUsageInput = {
  inputTokens: 1_500,
  outputTokens: 500,
};

function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = values.toSorted((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  }
  return sorted[mid];
}

export type LedgerBenchmarkResult = {
  benchmark: TokenUsageInput;
  source: "ledger" | "default";
  sampleCount: number;
};

export function deriveBenchmarkUsageFromLedger(
  entries: readonly UsageLedgerEntry[],
): LedgerBenchmarkResult {
  const withTokens = entries.filter(
    (entry) => entry.inputTokens !== undefined || entry.outputTokens !== undefined,
  );
  if (withTokens.length === 0) {
    return {
      benchmark: DEFAULT_BENCHMARK_USAGE,
      source: "default",
      sampleCount: 0,
    };
  }
  const inputTokens = median(
    withTokens.map((entry) => Math.max(0, Math.floor(entry.inputTokens ?? 0))),
  );
  const outputTokens = median(
    withTokens.map((entry) => Math.max(0, Math.floor(entry.outputTokens ?? 0))),
  );
  return {
    benchmark: {
      inputTokens: inputTokens ?? DEFAULT_BENCHMARK_USAGE.inputTokens ?? 0,
      outputTokens: outputTokens ?? DEFAULT_BENCHMARK_USAGE.outputTokens ?? 0,
    },
    source: "ledger",
    sampleCount: withTokens.length,
  };
}

export function deriveObservedTierMixFromLedger(
  entries: readonly UsageLedgerEntry[],
): Record<string, number> {
  const totals = new Map<string, number>();
  let sum = 0;
  for (const entry of entries) {
    if (entry.creditsCharged <= 0) {
      continue;
    }
    const tier = entry.tier.trim();
    if (!tier) {
      continue;
    }
    totals.set(tier, (totals.get(tier) ?? 0) + entry.creditsCharged);
    sum += entry.creditsCharged;
  }
  if (sum <= 0) {
    return {};
  }
  const mix: Record<string, number> = {};
  for (const [tier, credits] of totals) {
    mix[tier] = credits / sum;
  }
  return mix;
}
