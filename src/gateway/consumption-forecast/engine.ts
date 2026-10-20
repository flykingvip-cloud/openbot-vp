/**
 * Consumption Forecast 纯函数引擎（P1）。
 *
 * 四输出：Forecast Cost / Credits ETA / Concurrency Risk / Margin Warning。
 */

import type { AgentRunRecord } from "../billing/agent-run-registry.js";
import { daysBetween, predictMonthEndCost } from "../billing/engine.js";
import type { BotResource } from "../billing/types.js";
import {
  assessBotQuotaRisk,
  buildDailyBotCreationSeries,
  computeBotGrowthMetrics,
  countBotsCreatedInCycle,
} from "./bot-growth.js";
import type { ConsumptionForecast, ForecastRiskLevel } from "./types.js";

export type ForecastEngineInput = {
  enterpriseId: string;
  cycleStart: string;
  cycleEnd: string;
  now: Date;
  billingMode: "credits" | "enterprise_budget";
  accruedCostCents: number;
  creditsRemaining: number;
  monthlyCredits: number;
  creditsConsumed: number;
  concurrencyUsed: number;
  concurrencyLimit: number;
  runsInCycle: readonly AgentRunRecord[];
  providerCostCents: number;
  tenantRevenueCents: number;
  marginCents: number;
  /** 按日 provider 成本（周期内）；≥3 日时启用 WMA 预测。 */
  dailyCostSeries?: readonly number[];
  activeBots?: number;
  maxBots?: number;
  botsInEnterprise?: readonly BotResource[];
};

function elapsedDaysInCycle(cycleStart: string, now: Date): number {
  const startMs = Date.parse(cycleStart);
  if (!Number.isFinite(startMs)) {
    return 0;
  }
  return Math.max(0, Math.floor((now.getTime() - startMs) / 86_400_000));
}

/** 扫描线求周期内峰值并发。 */
export function peakConcurrentRuns(
  runs: readonly AgentRunRecord[],
  nowMs: number = Date.now(),
): number {
  const events: Array<{ t: number; delta: 1 | -1 }> = [];
  for (const run of runs) {
    const start = Date.parse(run.startedAt);
    if (!Number.isFinite(start)) {
      continue;
    }
    events.push({ t: start, delta: 1 });
    const endRaw = run.finishedAt ? Date.parse(run.finishedAt) : nowMs;
    const end = Number.isFinite(endRaw) ? endRaw : nowMs;
    events.push({ t: end, delta: -1 });
  }
  events.sort((a, b) => (a.t === b.t ? a.delta - b.delta : a.t - b.t));
  let current = 0;
  let peak = 0;
  for (const event of events) {
    current += event.delta;
    if (current > peak) {
      peak = current;
    }
  }
  return peak;
}

export function computeCreditsEtaDays(input: {
  creditsRemaining: number;
  creditsConsumed: number;
  elapsedDays: number;
}): { etaDays: number | null; insufficientData: boolean } {
  if (input.creditsRemaining <= 0) {
    return { etaDays: 0, insufficientData: false };
  }
  if (input.creditsConsumed <= 0 || input.elapsedDays <= 0) {
    return { etaDays: null, insufficientData: true };
  }
  const dailyBurn = input.creditsConsumed / input.elapsedDays;
  if (dailyBurn <= 0) {
    return { etaDays: null, insufficientData: true };
  }
  return { etaDays: Math.ceil(input.creditsRemaining / dailyBurn), insufficientData: false };
}

export function assessConcurrencyRisk(input: {
  concurrencyUsed: number;
  concurrencyLimit: number;
  concurrencyPeakInCycle: number;
}): { level: ForecastRiskLevel; message?: string } {
  const limit = input.concurrencyLimit;
  if (limit <= 0) {
    return { level: "none" };
  }
  const peak = Math.max(input.concurrencyUsed, input.concurrencyPeakInCycle);
  const ratio = peak / limit;
  if (ratio >= 1) {
    return {
      level: "high",
      message: `周期内峰值并发 ${peak} 已达上限 ${limit}，新任务可能被拒绝。`,
    };
  }
  if (ratio >= 0.85) {
    return {
      level: "medium",
      message: `周期内峰值并发 ${peak}，接近上限 ${limit}（${Math.round(ratio * 100)}%）。`,
    };
  }
  if (ratio >= 0.65) {
    return {
      level: "low",
      message: `周期内峰值并发 ${peak}，占上限 ${limit} 的 ${Math.round(ratio * 100)}%。`,
    };
  }
  return { level: "none" };
}

export function assessMarginWarning(input: { marginCents: number; tenantRevenueCents: number }): {
  level: ForecastRiskLevel;
  ratio: number | null;
  message?: string;
} {
  const revenue = input.tenantRevenueCents;
  if (revenue <= 0) {
    if (input.marginCents < 0) {
      return {
        level: "high",
        ratio: null,
        message: "本周期供应商成本高于客户侧收入归因，毛利为负。",
      };
    }
    return { level: "none", ratio: null };
  }
  const ratio = input.marginCents / revenue;
  if (ratio < 0) {
    return {
      level: "high",
      ratio,
      message: `毛利率 ${Math.round(ratio * 100)}%，成本已超过收入归因。`,
    };
  }
  if (ratio < 0.15) {
    return {
      level: "medium",
      ratio,
      message: `毛利率 ${Math.round(ratio * 100)}%，接近盈亏平衡，建议关注模型成本。`,
    };
  }
  if (ratio < 0.3) {
    return {
      level: "low",
      ratio,
      message: `毛利率 ${Math.round(ratio * 100)}%，仍有优化空间。`,
    };
  }
  return { level: "none", ratio };
}

export function buildConsumptionForecast(input: ForecastEngineInput): ConsumptionForecast {
  const totalDays = daysBetween(input.cycleStart, input.cycleEnd);
  const elapsedDays = elapsedDaysInCycle(input.cycleStart, input.now);
  const useWma = (input.dailyCostSeries?.length ?? 0) >= 3;
  const costPrediction = predictMonthEndCost({
    accruedCents: input.accruedCostCents,
    elapsedDays,
    totalDays,
    ...(useWma ? { dailySeries: input.dailyCostSeries, mode: "wma" as const } : {}),
  });
  const creditsEta =
    input.monthlyCredits > 0
      ? computeCreditsEtaDays({
          creditsRemaining: input.creditsRemaining,
          creditsConsumed: input.creditsConsumed,
          elapsedDays,
        })
      : { etaDays: null, insufficientData: true };
  const concurrencyPeakInCycle = peakConcurrentRuns(input.runsInCycle, input.now.getTime());
  const concurrency = assessConcurrencyRisk({
    concurrencyUsed: input.concurrencyUsed,
    concurrencyLimit: input.concurrencyLimit,
    concurrencyPeakInCycle,
  });
  const margin = assessMarginWarning({
    marginCents: input.marginCents,
    tenantRevenueCents: input.tenantRevenueCents,
  });

  const activeBots = Math.max(0, Math.floor(input.activeBots ?? 0));
  const maxBots = Math.max(0, Math.floor(input.maxBots ?? 0));
  const botsInEnterprise = input.botsInEnterprise ?? [];
  const botsCreatedInCycle = countBotsCreatedInCycle(
    botsInEnterprise,
    input.cycleStart,
    input.cycleEnd,
  );
  const dailyBotSeries = buildDailyBotCreationSeries({
    bots: botsInEnterprise,
    cycleStart: input.cycleStart,
    cycleEnd: input.cycleEnd,
    now: input.now,
  });
  const botGrowth = computeBotGrowthMetrics({
    activeBots,
    botsCreatedInCycle,
    dailyCreationSeries: dailyBotSeries,
    cycleStart: input.cycleStart,
    cycleEnd: input.cycleEnd,
    now: input.now,
  });
  const botQuota = assessBotQuotaRisk({
    activeBots,
    maxBots,
    projectedBotsAtCycleEnd: botGrowth.projectedBotsAtCycleEnd,
  });

  return {
    enterpriseId: input.enterpriseId,
    cycleStart: input.cycleStart,
    cycleEnd: input.cycleEnd,
    computedAt: input.now.toISOString(),
    forecastCostCents: "predictedCents" in costPrediction ? costPrediction.predictedCents : null,
    forecastCostInsufficientData: "insufficientData" in costPrediction,
    creditsRemaining: input.creditsRemaining,
    monthlyCredits: input.monthlyCredits,
    creditsEtaDays: creditsEta.etaDays,
    creditsEtaInsufficientData: creditsEta.insufficientData,
    concurrencyUsed: input.concurrencyUsed,
    concurrencyLimit: input.concurrencyLimit,
    concurrencyPeakInCycle,
    concurrencyRisk: concurrency.level,
    ...(concurrency.message ? { concurrencyRiskMessage: concurrency.message } : {}),
    marginCents: input.marginCents,
    tenantRevenueCents: input.tenantRevenueCents,
    providerCostCents: input.providerCostCents,
    marginRatio: margin.ratio,
    marginWarning: margin.level,
    ...(margin.message ? { marginWarningMessage: margin.message } : {}),
    forecastCostMode: useWma ? "wma" : "linear",
    activeBots,
    maxBots,
    botsCreatedInCycle,
    botGrowthRatePerDay: botGrowth.botGrowthRatePerDay,
    projectedBotsAtCycleEnd: botGrowth.projectedBotsAtCycleEnd,
    botGrowthInsufficientData: botGrowth.botGrowthInsufficientData,
    botQuotaRisk: botQuota.level,
    ...(botQuota.message ? { botQuotaRiskMessage: botQuota.message } : {}),
  };
}
