// @vitest-environment node
// Feature: cost-budget-billing
// Property 11: 估算成本与最终成本的收敛与标记
// Property 13: 系统级跨模块一致性（端到端不变量）

import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { projectFromEvents, settleCycle, type SettleInput } from "./engine.ts";
import type { BillingDomainEvent, PlanPricing, PlanVersion } from "./types.ts";

const CYCLE_START = "2026-03-01T00:00:00.000Z";
const CYCLE_END = "2026-03-31T00:00:00.000Z";

const PRICING: PlanPricing[] = [
  {
    id: "p1",
    planId: "plan-1",
    planVersionId: "pv-1",
    type: "seat",
    key: "viewer",
    priceCents: 3000,
  },
  {
    id: "p2",
    planId: "plan-1",
    planVersionId: "pv-1",
    type: "seat",
    key: "creator",
    priceCents: 9000,
  },
  {
    id: "p3",
    planId: "plan-1",
    planVersionId: "pv-1",
    type: "usage",
    key: "ai_token",
    priceCents: 2,
  },
];

const version: PlanVersion = {
  id: "pv-1",
  planId: "plan-1",
  version: 1,
  status: "active",
  snapshot: {
    basePriceCents: 0,
    seatQuota: { viewer: 100, creator: 100 },
    botQuota: 1000,
    pricing: PRICING,
  },
  createdAt: CYCLE_START,
  createdByUserId: "admin",
};

// 生成落在周期窗口内的用量事件
const usageEventArb: fc.Arbitrary<BillingDomainEvent> = fc
  .record({
    eventId: fc.string({ minLength: 1, maxLength: 6 }),
    quantity: fc.integer({ min: 0, max: 5000 }),
    day: fc.integer({ min: 1, max: 29 }),
    userId: fc.constantFrom("user-a", "user-b", "user-c"),
  })
  .map(({ eventId, quantity, day, userId }) => ({
    type: "usage.reported" as const,
    enterpriseId: "ent-1",
    userId,
    eventId,
    key: "ai_token",
    quantity,
    occurredAt: new Date(new Date(CYCLE_START).getTime() + day * 24 * 60 * 60 * 1000).toISOString(),
  }));

function settleFromEvents(
  events: BillingDomainEvent[],
  snapshotType: "estimated" | "final",
): SettleInput {
  const slice = projectFromEvents(events, "ent-1");
  // 至少一个 seat 区间（占满周期）以产生稳定 seat 成本
  const intervals = slice.intervals.length
    ? slice.intervals
    : [
        {
          id: "iv",
          seatId: "s1",
          enterpriseId: "ent-1",
          role: "viewer" as const,
          startTime: CYCLE_START,
          endTime: null,
        },
      ];
  return {
    enterpriseId: "ent-1",
    version,
    cycleStart: CYCLE_START,
    cycleEnd: CYCLE_END,
    date: "2026-03-15",
    intervals,
    usage: slice.usage,
    usageQuota: { ai_token: 1_000_000 },
    snapshotType,
    generatedAt: CYCLE_START,
    billId: "b1",
    snapshotId: "snap1",
  };
}

describe("Property 13: 系统级端到端一致性（事件→投影→账本）", () => {
  it("Σ items == bill.total == snapshot.total", () => {
    fc.assert(
      fc.property(fc.array(usageEventArb, { maxLength: 30 }), (events) => {
        const { bill, snapshot } = settleCycle(settleFromEvents(events, "final"));
        const sumItems = bill.items.reduce((acc, it) => acc + it.amountCents, 0);
        expect(sumItems).toBe(bill.totalCostCents);
        expect(snapshot.totalCostCents).toBe(bill.totalCostCents);
      }),
      { numRuns: 200 },
    );
  });

  it("重放同一事件日志结果一致；重复投递（at-least-once）不改变投影", () => {
    fc.assert(
      fc.property(fc.array(usageEventArb, { maxLength: 30 }), (events) => {
        const once = settleCycle(settleFromEvents(events, "final"));
        // 重复投递：把事件复制一份追加（相同 eventId 应被投影去重）
        const duplicated = [...events, ...events];
        const twice = settleCycle(settleFromEvents(duplicated, "final"));
        expect(twice.bill.totalCostCents).toBe(once.bill.totalCostCents);
        expect(twice.bill.usageCostCents).toBe(once.bill.usageCostCents);
      }),
      { numRuns: 200 },
    );
  });
});

describe("Property 11: estimated → final 收敛与标记", () => {
  it("estimated 与 final 金额一致，仅 snapshotType 不同", () => {
    fc.assert(
      fc.property(fc.array(usageEventArb, { maxLength: 30 }), (events) => {
        const estimated = settleCycle(settleFromEvents(events, "estimated"));
        const final = settleCycle(settleFromEvents(events, "final"));
        expect(estimated.snapshot.totalCostCents).toBe(final.snapshot.totalCostCents);
        expect(estimated.snapshot.snapshotType).toBe("estimated");
        expect(final.snapshot.snapshotType).toBe("final");
      }),
      { numRuns: 200 },
    );
  });
});
