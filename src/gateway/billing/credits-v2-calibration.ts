/**
 * Credits v2 口径校准：对 ledger 行回放 v1/v2 价差，供 rollout 监控。
 */

import type { UsageLedgerEntry } from "../package-entitlement/types.js";
import type { CreditWeight } from "../resource-catalog/types.js";
import { resolveCommercialCreditCost } from "./resolve-commercial-credit-cost.js";

export type CreditsV2CalibrationRow = {
  entryId: string;
  taskId: string;
  observedEngine: "v1" | "v2" | "unknown";
  observedCredits: number;
  replayV1Credits: number;
  replayV2Credits: number;
  deltaV2MinusV1: number;
};

export type CreditsV2CalibrationSummary = {
  sampleCount: number;
  v1LedgerCount: number;
  v2LedgerCount: number;
  meanDeltaV2MinusV1: number | null;
  maxAbsDelta: number;
  rows: CreditsV2CalibrationRow[];
};

export function calibrateCreditsV2AgainstLedger(
  entries: readonly UsageLedgerEntry[],
  weights: readonly CreditWeight[],
  opts?: { limit?: number },
): CreditsV2CalibrationSummary {
  const limit = opts?.limit ?? 200;
  const sample = entries.slice(0, limit);
  const rows: CreditsV2CalibrationRow[] = [];
  let v1LedgerCount = 0;
  let v2LedgerCount = 0;
  let deltaSum = 0;
  let maxAbsDelta = 0;

  for (const entry of sample) {
    const tokenUsage =
      entry.inputTokens !== undefined || entry.outputTokens !== undefined
        ? {
            inputTokens: entry.inputTokens,
            outputTokens: entry.outputTokens,
          }
        : undefined;
    const v1 = resolveCommercialCreditCost({
      creditsV2Enabled: false,
      tier: entry.tier,
      weights,
      tokenUsage,
      toolCallCount: entry.toolCallCount,
      durationMs: entry.durationMs,
      retryCount: entry.retryCount,
    });
    const v2 = resolveCommercialCreditCost({
      creditsV2Enabled: true,
      tier: entry.tier,
      weights,
      tokenUsage,
      toolCallCount: entry.toolCallCount,
      durationMs: entry.durationMs,
      retryCount: entry.retryCount,
    });
    const observedEngine =
      entry.pricingEngine === "v2" ? "v2" : entry.pricingEngine === "v1" ? "v1" : "unknown";
    if (observedEngine === "v1") {
      v1LedgerCount += 1;
    } else if (observedEngine === "v2") {
      v2LedgerCount += 1;
    }
    const delta = v2.creditsCharged - v1.creditsCharged;
    deltaSum += delta;
    maxAbsDelta = Math.max(maxAbsDelta, Math.abs(delta));
    rows.push({
      entryId: entry.id,
      taskId: entry.taskId,
      observedEngine,
      observedCredits: entry.creditsCharged,
      replayV1Credits: v1.creditsCharged,
      replayV2Credits: v2.creditsCharged,
      deltaV2MinusV1: delta,
    });
  }

  return {
    sampleCount: rows.length,
    v1LedgerCount,
    v2LedgerCount,
    meanDeltaV2MinusV1: rows.length > 0 ? deltaSum / rows.length : null,
    maxAbsDelta,
    rows,
  };
}
