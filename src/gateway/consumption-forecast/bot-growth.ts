/**
 * Bot 增长趋势信号（P3）：周期内创建速率 → 配额风险。
 */

import type { BotResource } from "../billing/types.js";
import type { ForecastRiskLevel } from "./types.js";

function utcDateKey(iso: string): string | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) {
    return null;
  }
  return new Date(ms).toISOString().slice(0, 10);
}

function elapsedDaysInCycle(cycleStart: string, now: Date): number {
  const startMs = Date.parse(cycleStart);
  if (!Number.isFinite(startMs)) {
    return 0;
  }
  return Math.max(0, Math.floor((now.getTime() - startMs) / 86_400_000));
}

function totalDaysInCycle(cycleStart: string, cycleEnd: string): number {
  const startMs = Date.parse(cycleStart);
  const endMs = Date.parse(cycleEnd);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return 30;
  }
  return Math.max(1, Math.ceil((endMs - startMs) / 86_400_000));
}

/** 周期内按 UTC 日统计 Bot 创建数（含零日，至 today 止）。 */
export function buildDailyBotCreationSeries(input: {
  bots: readonly BotResource[];
  cycleStart: string;
  cycleEnd: string;
  now: Date;
}): number[] {
  const startKey = utcDateKey(input.cycleStart);
  const endKey = utcDateKey(input.cycleEnd);
  const todayKey = utcDateKey(input.now.toISOString());
  if (!startKey || !endKey || !todayKey) {
    return [];
  }
  const lastKey = todayKey < endKey ? todayKey : endKey;
  const buckets = new Map<string, number>();
  const cycleStartMs = Date.parse(input.cycleStart);
  const cycleEndMs = Date.parse(input.cycleEnd);
  for (const bot of input.bots) {
    const createdMs = Date.parse(bot.createdAt);
    if (!Number.isFinite(createdMs) || createdMs < cycleStartMs || createdMs >= cycleEndMs) {
      continue;
    }
    const key = utcDateKey(bot.createdAt);
    if (!key || key < startKey || key >= endKey) {
      continue;
    }
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  const series: number[] = [];
  let cursor = startKey;
  while (cursor <= lastKey) {
    series.push(buckets.get(cursor) ?? 0);
    const [y, m, d] = cursor.split("-").map((v) => Number.parseInt(v, 10));
    const next = new Date(Date.UTC(y, m - 1, d + 1));
    cursor = next.toISOString().slice(0, 10);
  }
  return series;
}

export function countBotsCreatedInCycle(
  bots: readonly BotResource[],
  cycleStart: string,
  cycleEnd: string,
): number {
  const cycleStartMs = Date.parse(cycleStart);
  const cycleEndMs = Date.parse(cycleEnd);
  if (!Number.isFinite(cycleStartMs) || !Number.isFinite(cycleEndMs)) {
    return 0;
  }
  return bots.filter((bot) => {
    const createdMs = Date.parse(bot.createdAt);
    return Number.isFinite(createdMs) && createdMs >= cycleStartMs && createdMs < cycleEndMs;
  }).length;
}

export function computeBotGrowthMetrics(input: {
  activeBots: number;
  botsCreatedInCycle: number;
  dailyCreationSeries: readonly number[];
  cycleStart: string;
  cycleEnd: string;
  now: Date;
}): {
  botGrowthRatePerDay: number | null;
  projectedBotsAtCycleEnd: number | null;
  botGrowthInsufficientData: boolean;
} {
  const elapsedDays = elapsedDaysInCycle(input.cycleStart, input.now);
  const totalDays = totalDaysInCycle(input.cycleStart, input.cycleEnd);
  const remainingDays = Math.max(0, totalDays - elapsedDays);

  let rate: number | null = null;
  if (input.botsCreatedInCycle > 0 && elapsedDays > 0) {
    rate = input.botsCreatedInCycle / elapsedDays;
  } else if (input.dailyCreationSeries.length >= 3) {
    const nonZero = input.dailyCreationSeries.filter((n) => n > 0);
    if (nonZero.length >= 2) {
      rate =
        input.dailyCreationSeries.reduce((sum, n) => sum + n, 0) / input.dailyCreationSeries.length;
    }
  }

  if (rate == null || rate <= 0) {
    return {
      botGrowthRatePerDay: null,
      projectedBotsAtCycleEnd: null,
      botGrowthInsufficientData: input.botsCreatedInCycle === 0 && elapsedDays > 0,
    };
  }

  const projected = Math.ceil(input.activeBots + rate * remainingDays);
  return {
    botGrowthRatePerDay: rate,
    projectedBotsAtCycleEnd: projected,
    botGrowthInsufficientData: false,
  };
}

export function assessBotQuotaRisk(input: {
  activeBots: number;
  maxBots: number;
  projectedBotsAtCycleEnd: number | null;
}): { level: ForecastRiskLevel; message?: string } {
  const limit = input.maxBots;
  if (limit <= 0) {
    return { level: "none" };
  }
  const peak = Math.max(input.activeBots, input.projectedBotsAtCycleEnd ?? input.activeBots);
  const ratio = peak / limit;
  if (ratio >= 1) {
    return {
      level: "high",
      message: `Bot 配额峰值预计达 ${peak}，上限 ${limit}，创建新 AI 员工可能被拒绝。`,
    };
  }
  if (ratio >= 0.85) {
    return {
      level: "medium",
      message: `Bot 占用 ${input.activeBots}/${limit}，按增长趋势周期末或达 ${peak}（${Math.round(ratio * 100)}%）。`,
    };
  }
  if (ratio >= 0.65) {
    return {
      level: "low",
      message: `Bot 占用 ${input.activeBots}/${limit}，增长趋势需关注。`,
    };
  }
  return { level: "none" };
}
