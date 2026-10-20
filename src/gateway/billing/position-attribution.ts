/**
 * 岗位成本归因 —— 组织岗位 × 旗下机器人 × 账单口径 Usage/Seat。
 *
 * 纯函数；handler 负责加载 org seats、billing seats 与 usage 记录。
 * 无法归属到岗位的用量进入 `_unallocated`，不得丢弃金额。
 */

import {
  computeAiAuthorizationCost,
  type AiProfileHistoryInterval,
} from "./ai-authorization-cost.ts";
import { computeExtraCost, computeSeatCost } from "./engine.ts";
import type { MeterDefinition } from "./meter-contract.ts";
import {
  computePayableUsageAttributionByUser,
  mapSeatCostCentsByBillingSeatId,
  UNALLOCATED_SEAT_ID,
} from "./seat-attribution.ts";
import type { PlanVersion, Seat, SeatHistoryInterval, SeatRole, UsageRecord } from "./types.ts";

export type OrgPositionContext = {
  orgSeatId: string;
  positionTitle: string;
  teamLabel: string;
  memberUserId: string | null;
  agentIds: readonly string[];
};

export type PositionAgentAttributionRow = {
  agentId: string;
  usageQuantity: number;
  usageCostCents: number;
  byKey: Record<string, number>;
};

export type PositionAttributionRow = {
  orgSeatId: string;
  positionTitle: string;
  teamLabel: string;
  memberUserId: string | null;
  billingSeatId: string | null;
  billingRole: SeatRole | null;
  seatCostCents: number;
  usageCostCents: number;
  extraCostCents: number;
  totalCostCents: number;
  usageQuantity: number;
  agents: PositionAgentAttributionRow[];
  /** 已归因到岗位、但未指定 agentId 的用量。 */
  unallocatedAgentUsageQuantity: number;
  unallocatedAgentUsageCostCents: number;
};

export type PositionAttributionResult = {
  cycleStart: string;
  cycleEnd: string;
  rows: PositionAttributionRow[];
  summary: {
    seatCostCents: number;
    usageCostCents: number;
    extraCostCents: number;
    totalCostCents: number;
  };
  missingPriceKeys: string[];
};

type UsageSlice = {
  quantity: number;
  costCents: number;
  byKey: Record<string, number>;
};

function emptySlice(): UsageSlice {
  return { quantity: 0, costCents: 0, byKey: {} };
}

function addToSlice(slice: UsageSlice, key: string, quantity: number, costCents: number): void {
  slice.quantity += quantity;
  slice.costCents += costCents;
  slice.byKey[key] = (slice.byKey[key] ?? 0) + quantity;
}

function normalizeUserKey(userId: string): string {
  return userId.trim().toLowerCase();
}

function buildAgentOwnerSeatMap(positions: readonly OrgPositionContext[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const position of positions) {
    for (const agentId of position.agentIds) {
      if (!map.has(agentId)) {
        map.set(agentId, position.orgSeatId);
      }
    }
  }
  return map;
}

function buildMemberSeatMap(positions: readonly OrgPositionContext[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const position of positions) {
    if (!position.memberUserId?.trim()) {
      continue;
    }
    const key = normalizeUserKey(position.memberUserId);
    if (!map.has(key)) {
      map.set(key, position.orgSeatId);
    }
  }
  return map;
}

/** 将单条用量记录归属到最多一个组织岗位。 */
export function resolveUsageRecordOrgSeatId(
  rec: UsageRecord,
  positions: readonly OrgPositionContext[],
): string | null {
  if (rec.orgSeatId?.trim()) {
    const explicit = rec.orgSeatId.trim();
    if (positions.some((p) => p.orgSeatId === explicit)) {
      return explicit;
    }
  }
  const agentId = rec.agentId?.trim();
  if (agentId) {
    const owner = buildAgentOwnerSeatMap(positions).get(agentId);
    if (owner) {
      return owner;
    }
  }
  const memberSeat = buildMemberSeatMap(positions).get(normalizeUserKey(rec.userId));
  return memberSeat ?? null;
}

function sliceToAgentRow(agentId: string, slice: UsageSlice): PositionAgentAttributionRow {
  return {
    agentId,
    usageQuantity: slice.quantity,
    usageCostCents: slice.costCents,
    byKey: { ...slice.byKey },
  };
}

/** 按企业总量计算每条记录的应付分摊（仅超额）。 */
function allocatePayableCostPerRecord(
  version: PlanVersion,
  records: readonly UsageRecord[],
  meters: readonly MeterDefinition[] | undefined,
): { costByEventId: Map<string, number>; missingPriceKeys: string[] } {
  const payable = computePayableUsageAttributionByUser({ version, records, meters });
  let totalPayable = 0;
  for (const slice of Object.values(payable.byUser)) {
    totalPayable += slice.costCents;
  }
  const totalQty = records.reduce((acc, r) => acc + r.quantity, 0);
  const costByEventId = new Map<string, number>();
  let assigned = 0;
  for (let i = 0; i < records.length; i += 1) {
    const rec = records[i];
    if (!rec) {
      continue;
    }
    const isLast = i === records.length - 1;
    const amount =
      isLast && totalQty > 0
        ? totalPayable - assigned
        : totalQty > 0
          ? Math.round((totalPayable * rec.quantity) / totalQty)
          : 0;
    costByEventId.set(rec.eventId, amount);
    assigned += amount;
  }
  return { costByEventId, missingPriceKeys: payable.missingPriceKeys };
}

export function buildPositionAttribution(args: {
  version: PlanVersion;
  positions: readonly OrgPositionContext[];
  billingSeats: readonly Seat[];
  intervals: readonly SeatHistoryInterval[];
  usageRecords: readonly UsageRecord[];
  cycleStart: string;
  cycleEnd: string;
  meters?: readonly MeterDefinition[];
  botCount?: number;
  aiProfileIntervals?: readonly AiProfileHistoryInterval[];
  aiProfileQuota?: Partial<Record<"basic" | "pro" | "elite", number>>;
}): PositionAttributionResult {
  const missing = new Set<string>();
  const seatCost = computeSeatCost({
    version: args.version,
    intervals: args.intervals,
    cycleStart: args.cycleStart,
    cycleEnd: args.cycleEnd,
  });
  for (const key of seatCost.missingPriceKeys) {
    missing.add(key);
  }
  const seatCostByBillingId = mapSeatCostCentsByBillingSeatId(seatCost.items);
  const { costByEventId, missingPriceKeys } = allocatePayableCostPerRecord(
    args.version,
    args.usageRecords,
    args.meters,
  );
  for (const key of missingPriceKeys) {
    missing.add(key);
  }
  const botExtra = computeExtraCost({
    version: args.version,
    usageByKey: {},
    botCount: args.botCount,
  });
  for (const key of botExtra.missingPriceKeys) {
    missing.add(key);
  }
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
  for (const key of auth.missingPriceKeys) {
    missing.add(key);
  }

  const billingSeatByUser = new Map<string, Seat>();
  for (const seat of args.billingSeats) {
    billingSeatByUser.set(normalizeUserKey(seat.userId), seat);
  }

  const positionAgentSlices = new Map<string, Map<string, UsageSlice>>();
  const positionUnallocated = new Map<string, UsageSlice>();
  const positionUsageTotals = new Map<string, UsageSlice>();
  const globalUnallocated = emptySlice();

  const ensurePositionMaps = (orgSeatId: string) => {
    if (!positionAgentSlices.has(orgSeatId)) {
      positionAgentSlices.set(orgSeatId, new Map());
    }
    if (!positionUnallocated.has(orgSeatId)) {
      positionUnallocated.set(orgSeatId, emptySlice());
    }
    if (!positionUsageTotals.has(orgSeatId)) {
      positionUsageTotals.set(orgSeatId, emptySlice());
    }
  };

  for (const rec of args.usageRecords) {
    const costCents = costByEventId.get(rec.eventId) ?? 0;
    const orgSeatId = resolveUsageRecordOrgSeatId(rec, args.positions);
    if (!orgSeatId) {
      addToSlice(globalUnallocated, rec.key, rec.quantity, costCents);
      continue;
    }
    ensurePositionMaps(orgSeatId);
    const totalSlice = positionUsageTotals.get(orgSeatId)!;
    addToSlice(totalSlice, rec.key, rec.quantity, costCents);

    const agentId = rec.agentId?.trim();
    if (agentId) {
      const agents = positionAgentSlices.get(orgSeatId)!;
      const slice = agents.get(agentId) ?? emptySlice();
      addToSlice(slice, rec.key, rec.quantity, costCents);
      agents.set(agentId, slice);
    } else {
      const unalloc = positionUnallocated.get(orgSeatId)!;
      addToSlice(unalloc, rec.key, rec.quantity, costCents);
    }
  }

  const claimedBillingSeatIds = new Set<string>();
  const rows: PositionAttributionRow[] = args.positions.map((position) => {
    const billingSeat = position.memberUserId
      ? (billingSeatByUser.get(normalizeUserKey(position.memberUserId)) ?? null)
      : null;
    const seatCostCents = billingSeat ? (seatCostByBillingId.get(billingSeat.id) ?? 0) : 0;
    let authExtra = 0;
    if (billingSeat && !claimedBillingSeatIds.has(billingSeat.id)) {
      authExtra = auth.costBySeatId.get(billingSeat.id) ?? 0;
      claimedBillingSeatIds.add(billingSeat.id);
    }
    const usageSlice = positionUsageTotals.get(position.orgSeatId) ?? emptySlice();
    const unalloc = positionUnallocated.get(position.orgSeatId) ?? emptySlice();
    const agentSlices = positionAgentSlices.get(position.orgSeatId) ?? new Map();

    const configuredAgents = new Set(position.agentIds);
    const agentRows: PositionAgentAttributionRow[] = [];

    for (const agentId of position.agentIds) {
      const slice = agentSlices.get(agentId);
      if (slice && slice.quantity > 0) {
        agentRows.push(sliceToAgentRow(agentId, slice));
      } else {
        agentRows.push({
          agentId,
          usageQuantity: 0,
          usageCostCents: 0,
          byKey: {},
        });
      }
    }

    for (const [agentId, slice] of agentSlices) {
      if (!configuredAgents.has(agentId) && slice.quantity > 0) {
        agentRows.push(sliceToAgentRow(agentId, slice));
      }
    }

    agentRows.sort((left, right) => right.usageCostCents - left.usageCostCents);

    const usageCostCents = usageSlice.costCents;
    const extraCostCents = authExtra;
    return {
      orgSeatId: position.orgSeatId,
      positionTitle: position.positionTitle,
      teamLabel: position.teamLabel,
      memberUserId: position.memberUserId,
      billingSeatId: billingSeat?.id ?? null,
      billingRole: billingSeat?.currentRole ?? null,
      seatCostCents,
      usageCostCents,
      extraCostCents,
      totalCostCents: seatCostCents + usageCostCents + extraCostCents,
      usageQuantity: usageSlice.quantity,
      agents: agentRows,
      unallocatedAgentUsageQuantity: unalloc.quantity,
      unallocatedAgentUsageCostCents: unalloc.costCents,
    };
  });

  let unallocAuthExtra = 0;
  for (const [seatId, amount] of auth.costBySeatId) {
    if (!claimedBillingSeatIds.has(seatId)) {
      unallocAuthExtra += amount;
    }
  }
  const unallocExtra = botExtra.extraCostCents + unallocAuthExtra;
  if (globalUnallocated.quantity > 0 || globalUnallocated.costCents > 0 || unallocExtra > 0) {
    rows.push({
      orgSeatId: UNALLOCATED_SEAT_ID,
      positionTitle: UNALLOCATED_SEAT_ID,
      teamLabel: UNALLOCATED_SEAT_ID,
      memberUserId: null,
      billingSeatId: null,
      billingRole: null,
      seatCostCents: 0,
      usageCostCents: globalUnallocated.costCents,
      extraCostCents: unallocExtra,
      totalCostCents: globalUnallocated.costCents + unallocExtra,
      usageQuantity: globalUnallocated.quantity,
      agents: [],
      unallocatedAgentUsageQuantity: globalUnallocated.quantity,
      unallocatedAgentUsageCostCents: globalUnallocated.costCents,
    });
  }

  rows.sort((left, right) => {
    if (left.orgSeatId === UNALLOCATED_SEAT_ID) {
      return 1;
    }
    if (right.orgSeatId === UNALLOCATED_SEAT_ID) {
      return -1;
    }
    const byDept = left.teamLabel.localeCompare(right.teamLabel, "zh-CN");
    if (byDept !== 0) {
      return byDept;
    }
    return left.positionTitle.localeCompare(right.positionTitle, "zh-CN");
  });

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

/** 导出用：按日 × 岗位 × 机器人聚合用量（账单口径应付成本）。 */
export function buildPositionDailyUsageRows(args: {
  version: PlanVersion;
  positions: readonly OrgPositionContext[];
  usageRecords: readonly UsageRecord[];
  meters?: readonly MeterDefinition[];
}): Array<{
  date: string;
  orgSeatId: string;
  positionTitle: string;
  teamLabel: string;
  agentId: string;
  usageQuantity: number;
  usageCostCents: number;
}> {
  const { costByEventId } = allocatePayableCostPerRecord(
    args.version,
    args.usageRecords,
    args.meters,
  );
  const buckets = new Map<
    string,
    {
      quantity: number;
      costCents: number;
      position: OrgPositionContext;
      agentId: string;
      date: string;
    }
  >();

  for (const rec of args.usageRecords) {
    const orgSeatId = resolveUsageRecordOrgSeatId(rec, args.positions) ?? UNALLOCATED_SEAT_ID;
    const position =
      args.positions.find((p) => p.orgSeatId === orgSeatId) ??
      ({
        orgSeatId: UNALLOCATED_SEAT_ID,
        positionTitle: UNALLOCATED_SEAT_ID,
        teamLabel: UNALLOCATED_SEAT_ID,
        memberUserId: null,
        agentIds: [],
      } satisfies OrgPositionContext);
    const date = rec.occurredAt.slice(0, 10);
    const agentId = rec.agentId?.trim() || UNALLOCATED_SEAT_ID;
    const bucketKey = `${date}|${orgSeatId}|${agentId}`;
    const costCents = costByEventId.get(rec.eventId) ?? 0;
    const existing = buckets.get(bucketKey);
    if (existing) {
      existing.quantity += rec.quantity;
      existing.costCents += costCents;
    } else {
      buckets.set(bucketKey, {
        date,
        position,
        agentId,
        quantity: rec.quantity,
        costCents,
      });
    }
  }

  return [...buckets.values()]
    .map((entry) => ({
      date: entry.date,
      orgSeatId: entry.position.orgSeatId,
      positionTitle: entry.position.positionTitle,
      teamLabel: entry.position.teamLabel,
      agentId: entry.agentId,
      usageQuantity: entry.quantity,
      usageCostCents: entry.costCents,
    }))
    .toSorted((left, right) => {
      const byDate = left.date.localeCompare(right.date);
      if (byDate !== 0) {
        return byDate;
      }
      const bySeat = left.orgSeatId.localeCompare(right.orgSeatId);
      if (bySeat !== 0) {
        return bySeat;
      }
      return left.agentId.localeCompare(right.agentId);
    });
}
