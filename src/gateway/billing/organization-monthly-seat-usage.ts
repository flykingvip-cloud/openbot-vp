/**
 * 组织月度岗位用量聚合（纯函数）。
 * agents / users / seats 三路切片；员工账号归因以 UsageRecord.userId 为准。
 */

import { getPrice } from "./engine.ts";
import { resolveUsageRecordOrgSeatId, type OrgPositionContext } from "./position-attribution.ts";
import type { PlanVersion, UsageRecord } from "./types.ts";

export type OrganizationMonthlyUsageSlice = {
  totalTokens: number;
  totalCost: number;
  sessionCount: number;
  lastActiveAt: number | null;
};

export type OrganizationMonthlyAgentUsageRow = OrganizationMonthlyUsageSlice & {
  agentId: string;
};

export type OrganizationMonthlyUserUsageRow = OrganizationMonthlyUsageSlice & {
  userId: string;
};

export type OrganizationMonthlySeatUsageRow = OrganizationMonthlyUsageSlice & {
  seatId: string;
  agentIds: string[];
  unmatchedAgentIds: string[];
};

export type OrganizationMonthlySeatUsageResult = {
  agents: OrganizationMonthlyAgentUsageRow[];
  users: OrganizationMonthlyUserUsageRow[];
  seats: OrganizationMonthlySeatUsageRow[];
  unmatchedAgentIds: string[];
};

type MutableSlice = {
  totalTokens: number;
  totalCost: number;
  sessionCount: number;
  lastActiveAt: number | null;
};

function emptySlice(): MutableSlice {
  return { totalTokens: 0, totalCost: 0, sessionCount: 0, lastActiveAt: null };
}

export function normalizeOrganizationUsageUserId(userId: string | null | undefined): string | null {
  const trimmed = typeof userId === "string" ? userId.trim() : "";
  if (!trimmed) {
    return null;
  }
  return trimmed.toLowerCase();
}

export function normalizeOrganizationUsageAgentId(
  agentId: string | null | undefined,
): string | null {
  const trimmed = typeof agentId === "string" ? agentId.trim() : "";
  if (!trimmed) {
    return null;
  }
  return trimmed.toLowerCase();
}

function addRecordToSlice(slice: MutableSlice, rec: UsageRecord, costCents: number): void {
  const tokens = tokensForRecord(rec);
  slice.totalTokens += tokens;
  slice.totalCost += costCents / 100;
  slice.sessionCount += 1;
  const at = Date.parse(rec.occurredAt);
  if (Number.isFinite(at)) {
    slice.lastActiveAt = Math.max(slice.lastActiveAt ?? 0, at);
  }
}

/** ai_token / *token* 计 tokens；其余计量类型不计 tokens，但仍计入会话事件数。 */
export function tokensForRecord(rec: UsageRecord): number {
  const key = rec.key.trim().toLowerCase();
  if (key === "ai_token" || key.includes("token")) {
    return Number.isFinite(rec.quantity) ? rec.quantity : 0;
  }
  return 0;
}

export function costCentsForRecord(
  rec: UsageRecord,
  version: PlanVersion | null,
  missingPriceKeys: Set<string>,
): number {
  if (!version) {
    return 0;
  }
  const price = getPrice(version, "usage", rec.key);
  if ("missing" in price) {
    missingPriceKeys.add(`usage/${rec.key}`);
    return 0;
  }
  return Math.round(price.priceCents * rec.quantity);
}

/**
 * 将 YYYY-MM-DD + 可选时区解释转为 [startTime, endTime) ISO 字符串。
 * endDate 当天含在内（次日 00:00 为开区间上界）。
 */
export function resolveOrganizationMonthlyUsageTimeRange(params: {
  startDate: string;
  endDate: string;
  mode?: "utc" | "specific";
  utcOffset?: string;
}): { startTime: string; endTime: string; startDate: string; endDate: string } {
  const startDate = params.startDate.trim();
  const endDate = params.endDate.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    throw new Error("startDate and endDate must be YYYY-MM-DD");
  }
  if (startDate > endDate) {
    throw new Error("startDate must be on or before endDate");
  }
  const offset =
    params.mode === "specific" && params.utcOffset?.trim()
      ? normalizeUtcOffset(params.utcOffset.trim())
      : "+00:00";
  const startTime = `${startDate}T00:00:00.000${offset}`;
  // end exclusive: next calendar day at 00:00
  const endExclusive = addOneCalendarDay(endDate);
  const endTime = `${endExclusive}T00:00:00.000${offset}`;
  return { startTime, endTime, startDate, endDate };
}

function normalizeUtcOffset(raw: string): string {
  // Accept UTC+8 / UTC+08:00 / +08:00
  const utcMatch = /^UTC([+-])(\d{1,2})(?::?(\d{2}))?$/i.exec(raw);
  if (utcMatch) {
    const sign = utcMatch[1];
    const hours = utcMatch[2].padStart(2, "0");
    const minutes = (utcMatch[3] ?? "00").padStart(2, "0");
    return `${sign}${hours}:${minutes}`;
  }
  const plain = /^([+-])(\d{2}):?(\d{2})?$/.exec(raw);
  if (plain) {
    return `${plain[1]}${plain[2]}:${(plain[3] ?? "00").padStart(2, "0")}`;
  }
  return "+00:00";
}

function addOneCalendarDay(yyyyMmDd: string): string {
  const [y, m, d] = yyyyMmDd.split("-").map((part) => Number(part));
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export function buildOrganizationMonthlySeatUsage(params: {
  positions: readonly OrgPositionContext[];
  usageRecords: readonly UsageRecord[];
  planVersion?: PlanVersion | null;
}): OrganizationMonthlySeatUsageResult {
  const missingPriceKeys = new Set<string>();
  const version = params.planVersion ?? null;
  const agentMap = new Map<string, { displayId: string; slice: MutableSlice }>();
  const userMap = new Map<string, { displayId: string; slice: MutableSlice }>();
  const seatMap = new Map<string, MutableSlice>();
  const seatAgentIds = new Map<string, string[]>();
  const seatUnmatched = new Map<string, string[]>();

  for (const position of params.positions) {
    seatAgentIds.set(position.orgSeatId, [...position.agentIds]);
    seatMap.set(position.orgSeatId, emptySlice());
    seatUnmatched.set(position.orgSeatId, []);
  }

  const seenUsageAgentKeys = new Set<string>();

  for (const rec of params.usageRecords) {
    const costCents = costCentsForRecord(rec, version, missingPriceKeys);
    const userKey = normalizeOrganizationUsageUserId(rec.userId);
    if (userKey) {
      const existing = userMap.get(userKey);
      if (existing) {
        addRecordToSlice(existing.slice, rec, costCents);
      } else {
        const slice = emptySlice();
        addRecordToSlice(slice, rec, costCents);
        userMap.set(userKey, { displayId: rec.userId.trim(), slice });
      }
    }

    const agentKey = normalizeOrganizationUsageAgentId(rec.agentId);
    if (agentKey) {
      seenUsageAgentKeys.add(agentKey);
      const displayId = rec.agentId!.trim();
      const existing = agentMap.get(agentKey);
      if (existing) {
        addRecordToSlice(existing.slice, rec, costCents);
      } else {
        const slice = emptySlice();
        addRecordToSlice(slice, rec, costCents);
        agentMap.set(agentKey, { displayId, slice });
      }
    }

    const seatId = resolveUsageRecordOrgSeatId(rec, params.positions);
    if (seatId) {
      const seatSlice = seatMap.get(seatId) ?? emptySlice();
      if (!seatMap.has(seatId)) {
        seatMap.set(seatId, seatSlice);
      }
      addRecordToSlice(seatSlice, rec, costCents);
    }
  }

  const unmatchedAgentIds: string[] = [];
  for (const position of params.positions) {
    const unmatchedForSeat: string[] = [];
    for (const agentId of position.agentIds) {
      const key = normalizeOrganizationUsageAgentId(agentId);
      if (!key) {
        continue;
      }
      if (!seenUsageAgentKeys.has(key)) {
        unmatchedForSeat.push(agentId);
        if (!unmatchedAgentIds.includes(agentId)) {
          unmatchedAgentIds.push(agentId);
        }
      }
    }
    seatUnmatched.set(position.orgSeatId, unmatchedForSeat);
  }

  const agents: OrganizationMonthlyAgentUsageRow[] = [...agentMap.values()]
    .map(({ displayId, slice }) => ({
      agentId: displayId,
      ...slice,
    }))
    .toSorted((a, b) => a.agentId.localeCompare(b.agentId));

  // users[]：仅有用量的员工；空岗无成员不会出现
  const users: OrganizationMonthlyUserUsageRow[] = [...userMap.values()]
    .map(({ displayId, slice }) => ({
      userId: displayId,
      ...slice,
    }))
    .toSorted((a, b) => a.userId.localeCompare(b.userId));

  const seats: OrganizationMonthlySeatUsageRow[] = [...seatMap.entries()]
    .map(([seatId, slice]) => ({
      seatId,
      agentIds: seatAgentIds.get(seatId) ?? [],
      unmatchedAgentIds: seatUnmatched.get(seatId) ?? [],
      totalTokens: slice.totalTokens,
      totalCost: slice.totalCost,
      sessionCount: slice.sessionCount,
      lastActiveAt: slice.lastActiveAt,
    }))
    .toSorted((a, b) => a.seatId.localeCompare(b.seatId));

  void missingPriceKeys;

  return { agents, users, seats, unmatchedAgentIds };
}
