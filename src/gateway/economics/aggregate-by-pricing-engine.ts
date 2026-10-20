/**
 * Usage Ledger → 按 Credits 计价引擎（v1 / v2）分列聚合。
 */

import type { UsageLedgerEntry } from "../package-entitlement/types.js";
import { aggregateLedgerEconomics, type EconomicsSummary } from "./aggregate.js";

export type CommercialPricingEngine = "v1" | "v2";

export type EconomicsByPricingEngine = Record<CommercialPricingEngine, EconomicsSummary>;

const EMPTY_SUMMARY: EconomicsSummary = {
  taskCount: 0,
  creditsCharged: 0,
  providerCostCents: 0,
  tenantRevenueCents: 0,
  marginCents: 0,
};

/** 缺省 pricingEngine 的历史行视为 v1（ADR：开关前语义）。 */
export function resolveLedgerPricingEngine(
  entry: Pick<UsageLedgerEntry, "pricingEngine">,
): CommercialPricingEngine {
  return entry.pricingEngine === "v2" ? "v2" : "v1";
}

export function aggregateLedgerEconomicsByPricingEngine(
  entries: readonly UsageLedgerEntry[],
): EconomicsByPricingEngine {
  const buckets: Record<CommercialPricingEngine, UsageLedgerEntry[]> = { v1: [], v2: [] };
  for (const entry of entries) {
    buckets[resolveLedgerPricingEngine(entry)].push(entry);
  }
  return {
    v1: aggregateLedgerEconomics(buckets.v1),
    v2: aggregateLedgerEconomics(buckets.v2),
  };
}

export function sumLedgerCreditsByPricingEngine(entries: readonly UsageLedgerEntry[]): Pick<
  EconomicsByPricingEngine,
  "v1" | "v2"
> & {
  ledgerCreditsV1: number;
  ledgerCreditsV2: number;
} {
  const byEngine = aggregateLedgerEconomicsByPricingEngine(entries);
  return {
    v1: byEngine.v1,
    v2: byEngine.v2,
    ledgerCreditsV1: byEngine.v1.creditsCharged,
    ledgerCreditsV2: byEngine.v2.creditsCharged,
  };
}

export function emptyEconomicsByPricingEngine(): EconomicsByPricingEngine {
  return { v1: { ...EMPTY_SUMMARY }, v2: { ...EMPTY_SUMMARY } };
}
