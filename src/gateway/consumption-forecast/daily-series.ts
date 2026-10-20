/**
 * 从 Usage Ledger 构建周期内按日成本序列（供 WMA 预测）。
 */

import type { UsageLedgerEntry } from "../package-entitlement/types.js";

function utcDateKey(iso: string): string | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) {
    return null;
  }
  return new Date(ms).toISOString().slice(0, 10);
}

/** 周期内按 UTC 日聚合 provider 成本（含零消耗日，至 today 止）。 */
export function buildDailyProviderCostSeries(input: {
  entries: readonly UsageLedgerEntry[];
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
  for (const entry of input.entries) {
    const key = utcDateKey(entry.occurredAt);
    if (!key || key < startKey || key >= endKey) {
      continue;
    }
    buckets.set(key, (buckets.get(key) ?? 0) + entry.providerCostCents);
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
