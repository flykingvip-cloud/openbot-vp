import { describe, expect, it } from "vitest";
import {
  buildSeatAttribution,
  computePayableUsageAttributionByUser,
  mapSeatCostCentsByBillingSeatId,
} from "./seat-attribution.ts";
import type { PlanVersion, Seat, SeatHistoryInterval, UsageRecord } from "./types.ts";

const version: PlanVersion = {
  id: "pv-1",
  planId: "plan-1",
  version: 1,
  status: "active",
  snapshot: {
    basePriceCents: 0,
    seatQuota: { viewer: 0, creator: 0, admin: 0 },
    botQuota: 5,
    pricing: [
      {
        id: "p1",
        planId: "plan-1",
        planVersionId: "pv-1",
        type: "extra",
        key: "seat:viewer",
        priceCents: 1000,
      },
      {
        id: "p2",
        planId: "plan-1",
        planVersionId: "pv-1",
        type: "extra",
        key: "seat:creator",
        priceCents: 3000,
      },
      {
        id: "p3",
        planId: "plan-1",
        planVersionId: "pv-1",
        type: "extra",
        key: "ai_token",
        priceCents: 2,
      },
    ],
  },
  createdAt: "2026-01-01T00:00:00.000Z",
  createdByUserId: "admin",
};

const meters = [
  {
    key: "ai_token",
    unit: "token" as const,
    includedQuota: 0,
    chargeIncludedAtUsagePrice: false,
    allowOverage: true,
    aggregate: "sum" as const,
    rounding: "integer" as const,
  },
];

describe("seat-attribution", () => {
  it("maps seat cost items by billing seat id", () => {
    const map = mapSeatCostCentsByBillingSeatId([
      { detail: "seat:seat-a role:viewer overage", amountCents: 800 },
      { detail: "seat:seat-b role:creator overage", amountCents: 1200 },
    ]);
    expect(map.get("seat-a")).toBe(800);
    expect(map.get("seat-b")).toBe(1200);
  });

  it("computes payable usage cost by user (extra only)", () => {
    const records: UsageRecord[] = [
      {
        id: "u1",
        enterpriseId: "ent",
        userId: "alice@example.com",
        eventId: "e1",
        key: "ai_token",
        quantity: 500,
        occurredAt: "2026-03-10T00:00:00.000Z",
        ingestedAt: "2026-03-10T00:00:00.000Z",
      },
      {
        id: "u2",
        enterpriseId: "ent",
        userId: "alice@example.com",
        eventId: "e2",
        key: "ai_token",
        quantity: 100,
        occurredAt: "2026-03-11T00:00:00.000Z",
        ingestedAt: "2026-03-11T00:00:00.000Z",
      },
    ];
    const result = computePayableUsageAttributionByUser({ version, records, meters });
    expect(result.byUser["alice@example.com"]).toEqual({ quantity: 600, costCents: 1200 });
  });

  it("builds per-seat attribution rows with totals", () => {
    const cycleStart = "2026-03-01T00:00:00.000Z";
    const cycleEnd = "2026-04-01T00:00:00.000Z";
    const seats: Seat[] = [
      {
        id: "seat-a",
        enterpriseId: "ent",
        userId: "alice@example.com",
        currentRole: "viewer",
        botQuota: 1,
        createdAt: cycleStart,
      },
    ];
    const intervals: SeatHistoryInterval[] = [
      {
        id: "sh-1",
        seatId: "seat-a",
        enterpriseId: "ent",
        role: "viewer",
        startTime: cycleStart,
        endTime: null,
      },
    ];
    const usageRecords: UsageRecord[] = [
      {
        id: "u1",
        enterpriseId: "ent",
        userId: "alice@example.com",
        eventId: "e1",
        key: "ai_token",
        quantity: 1000,
        occurredAt: "2026-03-15T00:00:00.000Z",
        ingestedAt: "2026-03-15T00:00:00.000Z",
      },
    ];
    const result = buildSeatAttribution({
      version,
      seats,
      intervals,
      usageRecords,
      cycleStart,
      cycleEnd,
      meters,
    });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.seatCostCents).toBe(1000);
    expect(result.rows[0]?.usageQuantity).toBe(1000);
    expect(result.rows[0]?.usageCostCents).toBe(2000);
    expect(result.rows[0]?.totalCostCents).toBe(3000);
    expect(result.summary.totalCostCents).toBe(3000);
  });
});
