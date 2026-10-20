/**
 * Economics 聚合纯函数（Usage Ledger → 毛利视图）。
 */

import { computeMarginCents } from "../cost-version/provider-cost.js";
import type { UsageLedgerEntry } from "../package-entitlement/types.js";

export type EconomicsSummary = {
  taskCount: number;
  creditsCharged: number;
  providerCostCents: number;
  tenantRevenueCents: number;
  marginCents: number;
};

export function aggregateLedgerEconomics(entries: readonly UsageLedgerEntry[]): EconomicsSummary {
  let creditsCharged = 0;
  let providerCostCents = 0;
  let tenantRevenueCents = 0;
  for (const entry of entries) {
    creditsCharged += entry.creditsCharged;
    providerCostCents += entry.providerCostCents;
    tenantRevenueCents += entry.tenantRevenueCents;
  }
  return {
    taskCount: entries.length,
    creditsCharged,
    providerCostCents,
    tenantRevenueCents,
    marginCents: computeMarginCents({ tenantRevenueCents, providerCostCents }),
  };
}
