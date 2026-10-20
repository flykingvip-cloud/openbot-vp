/**
 * 席位成本归因 —— 与正式账单同口径：
 * seat 超额 + meter（套餐内 0 / 仅 extra 超额）+ bot/profile 等无法拆分部分进 _unallocated。
 */

import {
  computeAiAuthorizationCost,
  type AiProfileHistoryInterval,
} from "./ai-authorization-cost.ts";
import { computeExtraCost, computeSeatCost, getPrice } from "./engine.ts";
import { buildMeterDefinitions, chargeMeters, type MeterDefinition } from "./meter-contract.ts";
import type { PlanVersion, Seat, SeatHistoryInterval, SeatRole, UsageRecord } from "./types.ts";

export const UNALLOCATED_SEAT_ID = "_unallocated";

export type SeatAttributionRow = {
  billingSeatId: string;
  userId: string;
  billingRole: SeatRole | null;
  seatCostCents: number;
  usageQuantity: number;
  usageCostCents: number;
  extraCostCents: number;
  totalCostCents: number;
};

export type SeatAttributionResult = {
  cycleStart: string;
  cycleEnd: string;
  rows: SeatAttributionRow[];
  summary: {
    seatCostCents: number;
    usageCostCents: number;
    extraCostCents: number;
    totalCostCents: number;
  };
  missingPriceKeys: string[];
};

export type UsageAttributionByUser = Record<
  string,
  {
    quantity: number;
    costCents: number;
  }
>;

/** 从 computeSeatCost 明细解析各 billing seatId 的本周期 Seat 成本。 */
export function mapSeatCostCentsByBillingSeatId(
  items: ReadonlyArray<{ detail: string; amountCents: number }>,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const item of items) {
    const match = /^seat:([^\s]+)\s/.exec(item.detail);
    if (!match?.[1]) {
      continue;
    }
    const seatId = match[1];
    map.set(seatId, (map.get(seatId) ?? 0) + item.amountCents);
  }
  return map;
}

/**
 * 按用户聚合应付用量成本：套餐内免费计量不计入；超额仅按 extra/{key}。
 * 无 userId 的记录进入 `_unallocated`。
 */
export function computePayableUsageAttributionByUser(args: {
  version: PlanVersion;
  records: readonly UsageRecord[];
  meters?: readonly MeterDefinition[];
}): { byUser: UsageAttributionByUser; missingPriceKeys: string[]; unallocatedQuantity: number } {
  const byUser: UsageAttributionByUser = {};
  const missing = new Set<string>();
  let unallocatedQuantity = 0;

  const usageByKey: Record<string, number> = {};
  const recordsByUserKey = new Map<string, UsageRecord[]>();
  for (const rec of args.records) {
    const userKey = rec.userId.trim() || UNALLOCATED_SEAT_ID;
    if (userKey === UNALLOCATED_SEAT_ID) {
      unallocatedQuantity += rec.quantity;
    }
    usageByKey[rec.key] = (usageByKey[rec.key] ?? 0) + rec.quantity;
    const list = recordsByUserKey.get(userKey) ?? [];
    list.push(rec);
    recordsByUserKey.set(userKey, list);
  }

  const meters =
    args.meters && args.meters.length > 0
      ? args.meters
      : buildMeterDefinitions({
          version: args.version,
          usageKeys: Object.keys(usageByKey),
        });
  const charged = chargeMeters({
    meters,
    usageByKey,
    pricing: args.version.snapshot.pricing,
    strict: true,
  });
  for (const key of charged.missingPriceKeys) {
    missing.add(key);
  }
  for (const key of charged.missingQuotaKeys) {
    missing.add(`quota/${key}`);
  }

  // 将超额金额按用户用量占比拆分到各 user（同 key）。
  const overageByKey = new Map<string, number>();
  for (const item of charged.items) {
    if (item.type === "extra") {
      overageByKey.set(item.key, (overageByKey.get(item.key) ?? 0) + item.amountCents);
    }
  }

  for (const [userKey, recs] of recordsByUserKey) {
    let quantity = 0;
    let costCents = 0;
    const qtyByKey: Record<string, number> = {};
    for (const rec of recs) {
      quantity += rec.quantity;
      qtyByKey[rec.key] = (qtyByKey[rec.key] ?? 0) + rec.quantity;
    }
    for (const [key, userQty] of Object.entries(qtyByKey)) {
      const totalQty = usageByKey[key] ?? 0;
      const overageCents = overageByKey.get(key) ?? 0;
      if (totalQty > 0 && overageCents > 0) {
        costCents += Math.round((overageCents * userQty) / totalQty);
      } else if (overageCents === 0) {
        // 套餐内：应付 0。若缺 extra 价已记 missing。
        const meter = meters.find((m) => m.key === key);
        if (meter?.chargeIncludedAtUsagePrice) {
          const price = getPrice(args.version, "usage", key);
          if ("missing" in price) {
            missing.add(`usage/${key}`);
          } else {
            costCents += Math.round(price.priceCents * userQty);
          }
        }
      }
    }
    byUser[userKey] = { quantity, costCents };
  }

  return { byUser, missingPriceKeys: [...missing], unallocatedQuantity };
}

/** @deprecated 使用 computePayableUsageAttributionByUser；保留旧名避免外部断链。 */
export function computeUsageAttributionByUser(args: {
  version: PlanVersion;
  records: readonly UsageRecord[];
}): { byUser: UsageAttributionByUser; missingPriceKeys: string[] } {
  const result = computePayableUsageAttributionByUser(args);
  return { byUser: result.byUser, missingPriceKeys: result.missingPriceKeys };
}

function normalizeUserKey(userId: string): string {
  return userId.trim().toLowerCase();
}

function resolveUsageForUser(
  userId: string,
  byUser: UsageAttributionByUser,
): { quantity: number; costCents: number } {
  const direct = byUser[userId];
  if (direct) {
    return direct;
  }
  const normalized = normalizeUserKey(userId);
  for (const [key, value] of Object.entries(byUser)) {
    if (normalizeUserKey(key) === normalized) {
      return value;
    }
  }
  return { quantity: 0, costCents: 0 };
}

export function buildSeatAttribution(args: {
  version: PlanVersion;
  seats: readonly Seat[];
  intervals: readonly SeatHistoryInterval[];
  usageRecords: readonly UsageRecord[];
  cycleStart: string;
  cycleEnd: string;
  meters?: readonly MeterDefinition[];
  botCount?: number;
  aiProfileIntervals?: readonly AiProfileHistoryInterval[];
  aiProfileQuota?: Partial<Record<"basic" | "pro" | "elite", number>>;
}): SeatAttributionResult {
  const seatCost = computeSeatCost({
    version: args.version,
    intervals: args.intervals,
    cycleStart: args.cycleStart,
    cycleEnd: args.cycleEnd,
  });
  const seatCostById = mapSeatCostCentsByBillingSeatId(seatCost.items);
  const usage = computePayableUsageAttributionByUser({
    version: args.version,
    records: args.usageRecords,
    meters: args.meters,
  });
  const auth = args.aiProfileQuota
    ? computeAiAuthorizationCost({
        version: args.version,
        intervals: args.aiProfileIntervals ?? [],
        cycleStart: args.cycleStart,
        cycleEnd: args.cycleEnd,
        aiProfileQuota: args.aiProfileQuota,
      })
    : {
        authorizationCostCents: 0,
        items: [] as const,
        missingPriceKeys: [] as string[],
        costBySeatId: new Map<string, number>(),
      };
  const botExtra = computeExtraCost({
    version: args.version,
    usageByKey: {},
    usageQuota: {},
    botCount: args.botCount,
  });

  const missing = new Set<string>([
    ...seatCost.missingPriceKeys,
    ...usage.missingPriceKeys,
    ...auth.missingPriceKeys,
    ...botExtra.missingPriceKeys,
  ]);

  const claimedUsers = new Set<string>();
  const rows: SeatAttributionRow[] = args.seats
    .map((seat) => {
      claimedUsers.add(normalizeUserKey(seat.userId));
      const usageForUser = resolveUsageForUser(seat.userId, usage.byUser);
      const seatCostCents = seatCostById.get(seat.id) ?? 0;
      const authExtra = auth.costBySeatId.get(seat.id) ?? 0;
      const usageCostCents = usageForUser.costCents;
      const extraCostCents = authExtra;
      return {
        billingSeatId: seat.id,
        userId: seat.userId,
        billingRole: seat.currentRole,
        seatCostCents,
        usageQuantity: usageForUser.quantity,
        usageCostCents,
        extraCostCents,
        totalCostCents: seatCostCents + usageCostCents + extraCostCents,
      };
    })
    .toSorted((left, right) => left.userId.localeCompare(right.userId, "en"));

  // 未归属成员用量 + 无法拆分到席位的 bot 超额 → _unallocated
  let unallocQty = 0;
  let unallocUsageCost = 0;
  for (const [userKey, slice] of Object.entries(usage.byUser)) {
    if (userKey === UNALLOCATED_SEAT_ID) {
      unallocQty += slice.quantity;
      unallocUsageCost += slice.costCents;
      continue;
    }
    if (![...claimedUsers].some((u) => u === normalizeUserKey(userKey))) {
      unallocQty += slice.quantity;
      unallocUsageCost += slice.costCents;
    }
  }
  const unallocExtra = botExtra.extraCostCents;
  if (unallocQty > 0 || unallocUsageCost > 0 || unallocExtra > 0) {
    rows.push({
      billingSeatId: UNALLOCATED_SEAT_ID,
      userId: UNALLOCATED_SEAT_ID,
      billingRole: null,
      seatCostCents: 0,
      usageQuantity: unallocQty,
      usageCostCents: unallocUsageCost,
      extraCostCents: unallocExtra,
      totalCostCents: unallocUsageCost + unallocExtra,
    });
  }

  let summarySeat = 0;
  let summaryUsage = 0;
  let summaryExtra = 0;
  for (const row of rows) {
    summarySeat += row.seatCostCents;
    summaryUsage += row.usageCostCents;
    summaryExtra += row.extraCostCents;
  }

  return {
    cycleStart: args.cycleStart,
    cycleEnd: args.cycleEnd,
    rows,
    summary: {
      seatCostCents: summarySeat,
      usageCostCents: summaryUsage,
      extraCostCents: summaryExtra,
      totalCostCents: summarySeat + summaryUsage + summaryExtra,
    },
    missingPriceKeys: [...missing].toSorted(),
  };
}
