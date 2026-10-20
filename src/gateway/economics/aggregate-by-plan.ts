/**
 * 将 Usage Ledger 按 planId 聚合（通过 active 订阅映射 enterprise → plan）。
 */

import { listActiveSubscriptions } from "../billing/subscriptions-store.js";
import type { UsageLedgerEntry } from "../package-entitlement/types.js";
import { aggregateLedgerEconomics, type EconomicsSummary } from "./aggregate.js";

export async function aggregateLedgerEconomicsByPlan(
  entries: readonly UsageLedgerEntry[],
  storePath?: string,
): Promise<Record<string, EconomicsSummary>> {
  const subscriptions = await listActiveSubscriptions(storePath);
  const enterpriseToPlan = new Map<string, string>();
  for (const sub of subscriptions) {
    if (sub.enterpriseId) {
      enterpriseToPlan.set(sub.enterpriseId, sub.planId);
    }
  }
  const grouped = new Map<string, UsageLedgerEntry[]>();
  for (const entry of entries) {
    const planId = entry.planId ?? enterpriseToPlan.get(entry.enterpriseId);
    if (!planId) {
      continue;
    }
    const bucket = grouped.get(planId) ?? [];
    bucket.push(entry);
    grouped.set(planId, bucket);
  }
  const byPlan: Record<string, EconomicsSummary> = {};
  for (const [planId, bucket] of grouped) {
    byPlan[planId] = aggregateLedgerEconomics(bucket);
  }
  return byPlan;
}
