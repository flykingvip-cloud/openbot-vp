/**
 * Commercial Runtime 偏差快照：对账 + Credits v2 校准摘要（Wave 3 dashboard）。
 */

import { aggregateLedgerEconomicsByPricingEngine } from "../economics/aggregate-by-pricing-engine.js";
import type { CreditWeight } from "../resource-catalog/types.js";
import { reconcileEnterpriseCredits } from "./billing-reconciliation.js";
import { calibrateCreditsV2AgainstLedger } from "./credits-v2-calibration.js";
import { resolveCycleWindow } from "./runtime.js";
import { listUsageLedgerEntries } from "./usage-ledger-store.js";

export type CommercialRuntimeDriftSnapshot = {
  enterpriseId: string;
  cycleStart: string;
  cycleEnd: string;
  reconciliationAligned: boolean;
  reconciliationDriftCredits: number;
  ledgerCreditsV1: number;
  ledgerCreditsV2: number;
  calibrationSampleCount: number;
  calibrationMeanDeltaV2MinusV1: number | null;
  calibrationMaxAbsDelta: number;
};

export async function resolveCommercialRuntimeDrift(
  enterpriseId: string,
  weights: readonly CreditWeight[],
  opts?: {
    now?: Date;
    storePaths?: {
      creditBuckets?: string;
      tenantCredits?: string;
      usageLedger?: string;
    };
  },
): Promise<CommercialRuntimeDriftSnapshot> {
  const now = opts?.now ?? new Date();
  const { cycleStart, cycleEnd } = resolveCycleWindow(now);
  const [reconciliation, entries] = await Promise.all([
    reconcileEnterpriseCredits(enterpriseId, { now, storePaths: opts?.storePaths }),
    listUsageLedgerEntries(
      enterpriseId,
      { startTime: cycleStart, endTime: cycleEnd },
      opts?.storePaths?.usageLedger,
    ),
  ]);
  const byEngine = aggregateLedgerEconomicsByPricingEngine(entries);
  const calibration = calibrateCreditsV2AgainstLedger(entries, weights, { limit: 100 });
  return {
    enterpriseId,
    cycleStart,
    cycleEnd,
    reconciliationAligned: reconciliation.aligned,
    reconciliationDriftCredits: reconciliation.driftCredits,
    ledgerCreditsV1: byEngine.v1.creditsCharged,
    ledgerCreditsV2: byEngine.v2.creditsCharged,
    calibrationSampleCount: calibration.sampleCount,
    calibrationMeanDeltaV2MinusV1: calibration.meanDeltaV2MinusV1,
    calibrationMaxAbsDelta: calibration.maxAbsDelta,
  };
}
