/**
 * 平台 Economics Center handler（Package V2 Phase 4）。
 */

import { resolveCycleWindow } from "../billing/runtime.js";
import {
  listAllUsageLedgerEntries,
  listFilteredUsageLedgerEntries,
} from "../billing/usage-ledger-store.js";
import { getActiveCostVersion } from "../cost-version/cost-version-store.js";
import { aggregateLedgerEconomicsByPlan } from "../economics/aggregate-by-plan.js";
import { aggregateLedgerEconomicsByPricingEngine } from "../economics/aggregate-by-pricing-engine.js";
import { aggregateLedgerEconomics } from "../economics/aggregate.js";
import { buildEnterprisePlanIndex } from "../economics/enterprise-plan-index.js";
import { buildEconomicsProjectionContext } from "../economics/projection-context.js";
import { listCreditWeights } from "../resource-catalog/credit-weights-store.js";
import { listResourceModelCatalog } from "../resource-catalog/models-catalog-store.js";
import { numberValue, respondUnavailable, stringValue } from "./billing-helpers.js";
import type { GatewayRequestHandlers } from "./types.js";

function resolvePreviousCycleWindow(cycleStartIso: string): {
  startTime: string;
  endTime: string;
} {
  const cycleStart = new Date(cycleStartIso);
  const prevEnd = new Date(cycleStart.getTime());
  const prevStart = new Date(
    Date.UTC(prevEnd.getUTCFullYear(), prevEnd.getUTCMonth() - 1, 1, 0, 0, 0, 0),
  );
  return { startTime: prevStart.toISOString(), endTime: prevEnd.toISOString() };
}

function marginRate(summary: ReturnType<typeof aggregateLedgerEconomics>): number | null {
  if (summary.tenantRevenueCents <= 0) {
    return null;
  }
  return summary.marginCents / summary.tenantRevenueCents;
}

export const platformEconomicsHandlers: GatewayRequestHandlers = {
  "platform-economics.overview": async ({ params, respond }) => {
    try {
      const now = new Date();
      const { cycleStart, cycleEnd } = resolveCycleWindow(now);
      const startTime = stringValue(params.startTime) ?? cycleStart;
      const endTime = stringValue(params.endTime) ?? cycleEnd;
      const previousWindow = resolvePreviousCycleWindow(startTime);
      const [entries, previousEntries, activeCostVersion, models, creditWeights, enterprisePlans] =
        await Promise.all([
          listAllUsageLedgerEntries({ startTime, endTime }),
          listAllUsageLedgerEntries(previousWindow),
          getActiveCostVersion(),
          listResourceModelCatalog(),
          listCreditWeights(),
          buildEnterprisePlanIndex(),
        ]);
      const byPlan = await aggregateLedgerEconomicsByPlan(entries);
      const previousByPlan = await aggregateLedgerEconomicsByPlan(previousEntries);
      const byEnterprise: Record<string, ReturnType<typeof aggregateLedgerEconomics>> = {};
      const grouped = new Map<string, typeof entries>();
      for (const entry of entries) {
        const bucket = grouped.get(entry.enterpriseId) ?? [];
        bucket.push(entry);
        grouped.set(entry.enterpriseId, bucket);
      }
      for (const [enterpriseId, bucket] of grouped) {
        byEnterprise[enterpriseId] = aggregateLedgerEconomics(bucket);
      }
      const summary = aggregateLedgerEconomics(entries);
      const byPricingEngine = aggregateLedgerEconomicsByPricingEngine(entries);
      const previousSummary = aggregateLedgerEconomics(previousEntries);
      const currentRate = marginRate(summary);
      const previousRate = marginRate(previousSummary);
      const marginTrendDelta =
        currentRate !== null && previousRate !== null ? currentRate - previousRate : null;
      respond(true, {
        startTime,
        endTime,
        previousStartTime: previousWindow.startTime,
        previousEndTime: previousWindow.endTime,
        activeCostVersionId: activeCostVersion?.id ?? null,
        summary,
        byPricingEngine,
        previousSummary,
        marginTrendDelta,
        byEnterprise,
        byPlan,
        previousByPlan,
        enterprisePlans,
        projectionContext: buildEconomicsProjectionContext({
          models,
          creditWeights,
          activeCostVersion,
          ledgerEntries: entries,
        }),
      });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "platform-economics.ledger": async ({ params, respond }) => {
    try {
      const now = new Date();
      const { cycleStart, cycleEnd } = resolveCycleWindow(now);
      const startTime = stringValue(params.startTime) ?? cycleStart;
      const endTime = stringValue(params.endTime) ?? cycleEnd;
      const planId = stringValue(params.planId) ?? undefined;
      const enterpriseId = stringValue(params.enterpriseId) ?? undefined;
      const limit = numberValue(params.limit) ?? undefined;
      const result = await listFilteredUsageLedgerEntries({
        startTime,
        endTime,
        planId,
        enterpriseId,
        limit,
      });
      respond(true, result);
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },
};
