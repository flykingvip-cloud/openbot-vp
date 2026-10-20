/**
 * AI 能力授权超额计费（纯函数）。
 *
 * - 套餐内 `aiProfileQuota`（basic/pro/elite）免费。
 * - 超额仅使用 `extra/profile:{bucket}` 单价。
 * - 支持授权历史区间与月中升级按时间比例计费。
 * - 明细可下钻到 seatId，供席位/岗位归因。
 */

import { getPrice } from "./engine.ts";
import type { BillItem, PlanVersion, SeatEntitlementProfileId } from "./types.ts";

export type AiProfileQuotaBucket = "basic" | "pro" | "elite";

export type AiProfileHistoryInterval = {
  id: string;
  seatId: string;
  enterpriseId: string;
  profileId: SeatEntitlementProfileId;
  startTime: string;
  endTime: string | null;
};

export type AiAuthorizationCostResult = {
  authorizationCostCents: number;
  items: BillItem[];
  missingPriceKeys: string[];
  /** seatId → 本周期授权超额成本（归因用）。 */
  costBySeatId: Map<string, number>;
};

const MS = (iso: string) => new Date(iso).getTime();

/** 席位档位 → 套餐配额桶。premier 计入 elite 配额桶。 */
export function profileIdToQuotaBucket(profileId: SeatEntitlementProfileId): AiProfileQuotaBucket {
  switch (profileId) {
    case "pro_ai":
      return "pro";
    case "elite_ai":
    case "premier_ai":
      return "elite";
    default:
      return "basic";
  }
}

/**
 * 计算 AI 授权超额成本。
 * 时间片内按 bucket 扣除 includedQuota，超额席位按 seatId 字典序选取。
 */
export function computeAiAuthorizationCost(args: {
  version: PlanVersion;
  intervals: readonly AiProfileHistoryInterval[];
  cycleStart: string;
  cycleEnd: string;
  aiProfileQuota?: Partial<Record<AiProfileQuotaBucket, number>>;
}): AiAuthorizationCostResult {
  const cycleStart = MS(args.cycleStart);
  const cycleEnd = MS(args.cycleEnd);
  const cycleMs = cycleEnd - cycleStart;
  const missing = new Set<string>();
  const exactBySeat = new Map<string, number>();
  const bucketBySeat = new Map<string, AiProfileQuotaBucket>();

  if (cycleMs <= 0) {
    return {
      authorizationCostCents: 0,
      items: [],
      missingPriceKeys: [],
      costBySeatId: new Map(),
    };
  }

  type Presence = {
    seatId: string;
    bucket: AiProfileQuotaBucket;
    profileId: SeatEntitlementProfileId;
    startMs: number;
    endMs: number;
  };
  const presence: Presence[] = [];
  const boundaries = new Set<number>([cycleStart, cycleEnd]);
  for (const iv of args.intervals) {
    const start = Math.max(MS(iv.startTime), cycleStart);
    const end = Math.min(iv.endTime ? MS(iv.endTime) : cycleEnd, cycleEnd);
    if (end <= start) {
      continue;
    }
    const bucket = profileIdToQuotaBucket(iv.profileId);
    presence.push({
      seatId: iv.seatId,
      bucket,
      profileId: iv.profileId,
      startMs: start,
      endMs: end,
    });
    boundaries.add(start);
    boundaries.add(end);
  }

  const points = [...boundaries].toSorted((a, b) => a - b);
  for (let i = 0; i < points.length - 1; i += 1) {
    const segStart = points[i];
    const segEnd = points[i + 1];
    if (segStart === undefined || segEnd === undefined) {
      continue;
    }
    const segMs = segEnd - segStart;
    if (segMs <= 0) {
      continue;
    }
    const activeByBucket = new Map<
      AiProfileQuotaBucket,
      Array<{ seatId: string; profileId: string }>
    >();
    for (const p of presence) {
      if (p.startMs <= segStart && p.endMs >= segEnd) {
        const list = activeByBucket.get(p.bucket) ?? [];
        list.push({ seatId: p.seatId, profileId: p.profileId });
        activeByBucket.set(p.bucket, list);
      }
    }
    for (const [bucket, rows] of activeByBucket) {
      const unique = [...new Map(rows.map((r) => [r.seatId, r])).values()].toSorted((a, b) =>
        a.seatId.localeCompare(b.seatId, "en"),
      );
      const quota = Math.max(0, args.aiProfileQuota?.[bucket] ?? 0);
      const over = unique.slice(quota);
      if (over.length === 0) {
        continue;
      }
      const price = getPrice(args.version, "extra", `profile:${bucket}`);
      if ("missing" in price) {
        missing.add(`extra/profile:${bucket}`);
        continue;
      }
      const fraction = segMs / cycleMs;
      for (const row of over) {
        exactBySeat.set(
          row.seatId,
          (exactBySeat.get(row.seatId) ?? 0) + price.priceCents * fraction,
        );
        bucketBySeat.set(row.seatId, bucket);
      }
    }
  }

  const items: BillItem[] = [];
  const costBySeatId = new Map<string, number>();
  let total = 0;
  const seatIds = [...exactBySeat.keys()].toSorted((a, b) => a.localeCompare(b, "en"));
  for (let i = 0; i < seatIds.length; i += 1) {
    const seatId = seatIds[i];
    if (seatId === undefined) {
      continue;
    }
    const exact = exactBySeat.get(seatId) ?? 0;
    const isLast = i === seatIds.length - 1;
    const amount = isLast
      ? Math.round(seatIds.reduce((acc, id) => acc + (exactBySeat.get(id) ?? 0), 0)) - total
      : Math.round(exact);
    const bucket = bucketBySeat.get(seatId) ?? "basic";
    items.push({
      type: "extra",
      key: `profile:${bucket}`,
      detail: `seat:${seatId} profile:${bucket} overage`,
      amountCents: amount,
    });
    costBySeatId.set(seatId, amount);
    total += amount;
  }

  return {
    authorizationCostCents: total,
    items,
    missingPriceKeys: [...missing].toSorted(),
    costBySeatId,
  };
}
