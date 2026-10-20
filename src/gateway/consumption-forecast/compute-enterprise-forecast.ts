/**
 * 加载租户信号并产出 ConsumptionForecast。
 */

import { countActiveAgentRuns, listAgentRunsForEnterprise } from "../billing/agent-run-registry.js";
import { listEnterpriseBotHistory, countActiveBots } from "../billing/bot-resources-store.js";
import { resolveModelBudgetStatuses } from "../billing/model-budget-status.js";
import {
  resolveEnterpriseEconomics,
  resolveTenantCreditsStatus,
} from "../billing/record-credit-usage.js";
import { resolveEnterpriseEntitlement } from "../billing/resolve-enterprise-entitlement.js";
import { computeCurrentCycleCost, resolveCycleWindow } from "../billing/runtime.js";
import { listUsageLedgerEntries } from "../billing/usage-ledger-store.js";
import { resolveEnterpriseBillingMode } from "../package-entitlement/resolve-billing-mode.js";
import { buildDailyProviderCostSeries } from "./daily-series.js";
import { buildConsumptionForecast } from "./engine.js";
import type { ConsumptionForecast } from "./types.js";

function runOverlapsCycle(
  run: { startedAt: string; finishedAt?: string },
  cycleStart: string,
  cycleEnd: string,
  nowMs: number,
): boolean {
  const start = Date.parse(run.startedAt);
  const cycleStartMs = Date.parse(cycleStart);
  const cycleEndMs = Date.parse(cycleEnd);
  if (!Number.isFinite(start) || !Number.isFinite(cycleStartMs) || !Number.isFinite(cycleEndMs)) {
    return false;
  }
  const end = run.finishedAt ? Date.parse(run.finishedAt) : nowMs;
  const endMs = Number.isFinite(end) ? end : nowMs;
  return start < cycleEndMs && endMs >= cycleStartMs;
}

export async function computeEnterpriseConsumptionForecast(
  enterpriseId: string,
  now: Date = new Date(),
): Promise<ConsumptionForecast | null> {
  const entitlement = await resolveEnterpriseEntitlement(enterpriseId);
  if (!entitlement) {
    return null;
  }

  const billingMode = await resolveEnterpriseBillingMode(enterpriseId);
  const { cycleStart, cycleEnd } = resolveCycleWindow(now);
  const cost = await computeCurrentCycleCost(enterpriseId, "estimated", now);
  const economics = await resolveEnterpriseEconomics(enterpriseId, undefined, now);
  const creditsStatus = await resolveTenantCreditsStatus(enterpriseId);
  const concurrencyUsed = await countActiveAgentRuns(enterpriseId);
  const activeBots = await countActiveBots(enterpriseId);
  const botsInEnterprise = await listEnterpriseBotHistory(enterpriseId);
  const runs = await listAgentRunsForEnterprise(enterpriseId, { limit: 500 });
  const runsInCycle = runs.filter((run) =>
    runOverlapsCycle(run, cycleStart, cycleEnd, now.getTime()),
  );
  const ledgerEntries = await listUsageLedgerEntries(enterpriseId, {
    startTime: cycleStart,
    endTime: cycleEnd,
  });
  const dailyCostSeries = buildDailyProviderCostSeries({
    entries: ledgerEntries,
    cycleStart,
    cycleEnd,
    now,
  });

  // Phase 4（Forecast 联动）：附加模型级预算分账状态（口径独立于套餐总 Credits；
  // 未配置 modelBudgets 时为空，省略该字段，不影响既有预测主体）。
  const modelBudgets = await resolveModelBudgetStatuses(enterpriseId, { now });

  const accruedCostCents =
    billingMode === "enterprise_budget"
      ? economics.providerCostCents
      : (cost?.bill.totalCostCents ?? 0);

  const forecast = buildConsumptionForecast({
    enterpriseId,
    cycleStart,
    cycleEnd,
    now,
    billingMode,
    accruedCostCents,
    creditsRemaining: creditsStatus?.creditsRemaining ?? entitlement.creditsRemaining,
    monthlyCredits: creditsStatus?.monthlyCredits ?? entitlement.monthlyCredits,
    creditsConsumed: creditsStatus?.creditsConsumed ?? 0,
    concurrencyUsed,
    concurrencyLimit: entitlement.maxConcurrentRuns,
    runsInCycle,
    providerCostCents: economics.providerCostCents,
    tenantRevenueCents: economics.tenantRevenueCents,
    marginCents: economics.marginCents,
    dailyCostSeries,
    activeBots,
    maxBots: entitlement.maxBots,
    botsInEnterprise,
  });

  return modelBudgets.length > 0 ? { ...forecast, modelBudgets } : forecast;
}
