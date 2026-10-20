// @vitest-environment node
// Feature: cost-budget-billing
// Property 1: 成本计算单一入口求和不变量
// Property 4: 成本计算确定性（可重现）

import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { computeTotalCost, settleCycle, type SettleInput } from "./engine.ts";
import type { PlanPricing, PlanVersion, SeatRole, UsageRecord } from "./types.ts";

const CYCLE_START = "2026-03-01T00:00:00.000Z";
const CYCLE_END = "2026-04-01T00:00:00.000Z";

function makeVersion(pricing: PlanPricing[]): PlanVersion {
  return {
    id: "pv-1",
    planId: "plan-1",
    version: 1,
    status: "active",
    snapshot: {
      basePriceCents: 0,
      seatQuota: { viewer: 100, creator: 100, admin: 100 },
      botQuota: 1000,
      pricing,
    },
    createdAt: CYCLE_START,
    createdByUserId: "admin",
  };
}

const STANDARD_PRICING: PlanPricing[] = [
  {
    id: "p1",
    planId: "plan-1",
    planVersionId: "pv-1",
    type: "seat",
    key: "viewer",
    priceCents: 1000,
  },
  {
    id: "p2",
    planId: "plan-1",
    planVersionId: "pv-1",
    type: "seat",
    key: "creator",
    priceCents: 3000,
  },
  {
    id: "p3",
    planId: "plan-1",
    planVersionId: "pv-1",
    type: "usage",
    key: "ai_token",
    priceCents: 2,
  },
  {
    id: "p4",
    planId: "plan-1",
    planVersionId: "pv-1",
    type: "extra",
    key: "ai_token",
    priceCents: 3,
  },
];

const usageArb = fc.array(
  fc.record({
    key: fc.constantFrom("ai_token", "task"),
    quantity: fc.integer({ min: 0, max: 100000 }),
    occurredAt: fc.constant("2026-03-15T00:00:00.000Z"),
  }),
  { maxLength: 20 },
);

const roleArb: fc.Arbitrary<SeatRole> = fc.constantFrom("viewer", "creator", "admin");

function toUsageRecords(
  raw: Array<{ key: string; quantity: number; occurredAt: string }>,
): UsageRecord[] {
  return raw.map((r, i) => ({
    id: `u${i}`,
    enterpriseId: "ent-1",
    userId: "user",
    eventId: `e${i}`,
    key: r.key,
    quantity: r.quantity,
    occurredAt: r.occurredAt,
    ingestedAt: r.occurredAt,
  }));
}

describe("Property 1: total = seat + usage + extra（与顺序无关）", () => {
  it("求和满足结合律/交换律", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: 0, max: 1_000_000 }),
        (seat, usage, extra) => {
          const base = computeTotalCost({
            seatCostCents: seat,
            usageCostCents: usage,
            extraCostCents: extra,
          });
          // 交换分量顺序不改变结果
          const swapped = computeTotalCost({
            seatCostCents: extra,
            usageCostCents: seat,
            extraCostCents: usage,
          });
          expect(base).toBe(seat + usage + extra);
          expect(swapped).toBe(seat + usage + extra);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("账单总额恒等于三分量之和", () => {
    fc.assert(
      fc.property(usageArb, roleArb, (rawUsage, role) => {
        const input: SettleInput = {
          enterpriseId: "ent-1",
          version: makeVersion(STANDARD_PRICING),
          cycleStart: CYCLE_START,
          cycleEnd: CYCLE_END,
          date: "2026-03-15",
          intervals: [
            {
              id: "iv1",
              seatId: "s1",
              enterpriseId: "ent-1",
              role,
              startTime: CYCLE_START,
              endTime: null,
            },
          ],
          usage: toUsageRecords(rawUsage),
          snapshotType: "estimated",
          generatedAt: CYCLE_START,
          billId: "b1",
          snapshotId: "snap1",
        };
        const { bill } = settleCycle(input);
        expect(bill.totalCostCents).toBe(
          bill.seatCostCents + bill.usageCostCents + bill.extraCostCents,
        );
      }),
      { numRuns: 200 },
    );
  });
});

describe("Property 4: 计算确定性（可重现）", () => {
  it("相同输入两次结算返回完全相同的结果", () => {
    fc.assert(
      fc.property(usageArb, roleArb, (rawUsage, role) => {
        const build = (): SettleInput => ({
          enterpriseId: "ent-1",
          version: makeVersion(STANDARD_PRICING),
          cycleStart: CYCLE_START,
          cycleEnd: CYCLE_END,
          date: "2026-03-15",
          intervals: [
            {
              id: "iv1",
              seatId: "s1",
              enterpriseId: "ent-1",
              role,
              startTime: CYCLE_START,
              endTime: null,
            },
          ],
          usage: toUsageRecords(rawUsage),
          snapshotType: "estimated",
          generatedAt: CYCLE_START,
          billId: "b1",
          snapshotId: "snap1",
        });
        const a = settleCycle(build());
        const b = settleCycle(build());
        expect(a).toEqual(b);
      }),
      { numRuns: 200 },
    );
  });
});
