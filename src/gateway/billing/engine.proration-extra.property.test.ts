// @vitest-environment node
// Feature: cost-budget-billing
// Property 7: Seat 与 Usage 配额及超额计算
// Property 8: 账单明细求和一致性
// Property 10: Seat 角色变更按比例计费（Proration）—— 超额席位时间线

import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { computeExtraCost, computeSeatCost, settleCycle, type SettleInput } from "./engine.ts";
import type {
  PlanPricing,
  PlanVersion,
  SeatHistoryInterval,
  SeatRole,
  UsageRecord,
} from "./types.ts";

const CYCLE_START = "2026-03-01T00:00:00.000Z";
const CYCLE_END = "2026-03-31T00:00:00.000Z"; // 30 天，便于占比
const VIEWER_PRICE = 3000;
const CREATOR_PRICE = 9000;

function makeVersion(
  pricing: PlanPricing[],
  seatQuota: Partial<Record<SeatRole, number>> = {},
  botQuota = 1000,
): PlanVersion {
  return {
    id: "pv-1",
    planId: "plan-1",
    version: 1,
    status: "active",
    snapshot: { basePriceCents: 0, seatQuota, botQuota, pricing },
    createdAt: CYCLE_START,
    createdByUserId: "admin",
  };
}

const SEAT_OVERAGE_PRICING: PlanPricing[] = [
  {
    id: "p1",
    planId: "plan-1",
    planVersionId: "pv-1",
    type: "extra",
    key: "seat:viewer",
    priceCents: VIEWER_PRICE,
  },
  {
    id: "p2",
    planId: "plan-1",
    planVersionId: "pv-1",
    type: "extra",
    key: "seat:creator",
    priceCents: CREATOR_PRICE,
  },
];

describe("Property 10: Proration（席位超额区间占比计费）", () => {
  it("quota=0 时单角色占满全周期 = 全额超额单价", () => {
    const result = computeSeatCost({
      version: makeVersion(SEAT_OVERAGE_PRICING, { viewer: 0 }),
      intervals: [
        {
          id: "iv",
          seatId: "s1",
          enterpriseId: "e",
          role: "viewer",
          startTime: CYCLE_START,
          endTime: null,
        },
      ],
      cycleStart: CYCLE_START,
      cycleEnd: CYCLE_END,
    });
    expect(result.seatCostCents).toBe(VIEWER_PRICE);
  });

  it("套餐内配额席位不计费", () => {
    const result = computeSeatCost({
      version: makeVersion(SEAT_OVERAGE_PRICING, { viewer: 1 }),
      intervals: [
        {
          id: "iv",
          seatId: "s1",
          enterpriseId: "e",
          role: "viewer",
          startTime: CYCLE_START,
          endTime: null,
        },
      ],
      cycleStart: CYCLE_START,
      cycleEnd: CYCLE_END,
    });
    expect(result.seatCostCents).toBe(0);
  });

  it("周期中点 viewer→creator 切换（quota=0）：各占一半，合计≈半价之和", () => {
    const mid = "2026-03-16T00:00:00.000Z";
    const result = computeSeatCost({
      version: makeVersion(SEAT_OVERAGE_PRICING, { viewer: 0, creator: 0 }),
      intervals: [
        {
          id: "iv1",
          seatId: "s1",
          enterpriseId: "e",
          role: "viewer",
          startTime: CYCLE_START,
          endTime: mid,
        },
        {
          id: "iv2",
          seatId: "s1",
          enterpriseId: "e",
          role: "creator",
          startTime: mid,
          endTime: null,
        },
      ],
      cycleStart: CYCLE_START,
      cycleEnd: CYCLE_END,
    });
    const expected = Math.round(VIEWER_PRICE / 2) + Math.round(CREATOR_PRICE / 2);
    expect(result.seatCostCents).toBe(expected);
  });

  it("明细求和 = seatCostCents（Property 8）", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            seatId: fc.constantFrom("s1", "s2", "s3"),
            role: fc.constantFrom("viewer", "creator", "admin") as fc.Arbitrary<SeatRole>,
            dayOffset: fc.integer({ min: 0, max: 28 }),
          }),
          { minLength: 1, maxLength: 6 },
        ),
        (raw) => {
          const intervals: SeatHistoryInterval[] = raw.map((r, idx) => {
            const start = new Date(CYCLE_START);
            start.setUTCDate(start.getUTCDate() + r.dayOffset);
            return {
              id: `iv-${idx}`,
              seatId: r.seatId,
              enterpriseId: "e",
              role: r.role,
              startTime: start.toISOString(),
              endTime: null,
            };
          });
          const result = computeSeatCost({
            version: makeVersion(SEAT_OVERAGE_PRICING, { viewer: 0, creator: 0, admin: 0 }),
            intervals,
            cycleStart: CYCLE_START,
            cycleEnd: CYCLE_END,
          });
          const sum = result.items.reduce((acc, i) => acc + i.amountCents, 0);
          expect(sum).toBe(result.seatCostCents);
        },
      ),
      { numRuns: 40 },
    );
  });
});

describe("Property 7: 超额计算（用量/Bot）", () => {
  it("botCount > botQuota 产生 extra/bot", () => {
    const version = makeVersion(
      [
        {
          id: "pb",
          planId: "plan-1",
          planVersionId: "pv-1",
          type: "extra",
          key: "bot",
          priceCents: 500,
        },
      ],
      {},
      2,
    );
    const result = computeExtraCost({
      version,
      usageByKey: {},
      botCount: 5,
    });
    expect(result.extraCostCents).toBe(1500);
    expect(result.items.some((i) => i.key === "bot")).toBe(true);
  });

  it("settleCycle 总分 = seat+usage+extra", () => {
    const version = makeVersion(
      [
        ...SEAT_OVERAGE_PRICING,
        {
          id: "pe",
          planId: "plan-1",
          planVersionId: "pv-1",
          type: "extra",
          key: "ai_credits",
          priceCents: 1,
        },
        {
          id: "pb",
          planId: "plan-1",
          planVersionId: "pv-1",
          type: "extra",
          key: "bot",
          priceCents: 100,
        },
      ],
      { viewer: 0 },
      1,
    );
    const usage: UsageRecord[] = [
      {
        id: "rec-e1",
        eventId: "e1",
        enterpriseId: "e",
        userId: "u1",
        key: "ai_credits",
        quantity: 10,
        occurredAt: "2026-03-10T00:00:00.000Z",
        ingestedAt: "2026-03-10T00:00:00.000Z",
      },
    ];
    const input: SettleInput = {
      enterpriseId: "e",
      version,
      planVersionId: "pv-1",
      cycleStart: CYCLE_START,
      cycleEnd: CYCLE_END,
      date: "2026-03-15",
      intervals: [
        {
          id: "iv",
          seatId: "s1",
          enterpriseId: "e",
          role: "viewer",
          startTime: CYCLE_START,
          endTime: null,
        },
      ],
      usage,
      meters: [
        {
          key: "ai_credits",
          unit: "credit",
          includedQuota: 0,
          chargeIncludedAtUsagePrice: false,
          allowOverage: true,
          aggregate: "sum",
          rounding: "integer",
        },
      ],
      botCount: 3,
      snapshotType: "estimated",
      generatedAt: CYCLE_START,
      billId: "bill-1",
      snapshotId: "snap-1",
    };
    const settled = settleCycle(input);
    expect(settled.bill.totalCostCents).toBe(
      settled.bill.seatCostCents + settled.bill.usageCostCents + settled.bill.extraCostCents,
    );
  });
});
