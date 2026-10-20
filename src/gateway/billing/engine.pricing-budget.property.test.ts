// @vitest-environment node
// Feature: cost-budget-billing
// Property 2: 价格查询确定性与缺失处理
// Property 3: 预算检查边界

import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { checkBudget, getPrice } from "./engine.ts";
import type { PlanPricing, PlanVersion, PricingType } from "./types.ts";

function makeVersion(pricing: PlanPricing[]): PlanVersion {
  return {
    id: "pv-1",
    planId: "plan-1",
    version: 1,
    status: "active",
    snapshot: { basePriceCents: 0, seatQuota: {}, botQuota: 0, pricing },
    createdAt: "2026-03-01T00:00:00.000Z",
    createdByUserId: "admin",
  };
}

const typeArb: fc.Arbitrary<PricingType> = fc.constantFrom("seat", "usage", "extra");

describe("Property 2: get_price 确定性与缺失处理", () => {
  it("命中返回价；同输入连调一致", () => {
    fc.assert(
      fc.property(
        typeArb,
        fc.string({ minLength: 1, maxLength: 8 }),
        fc.integer({ min: 0, max: 999999 }),
        (type, key, price) => {
          const version = makeVersion([
            { id: "p", planId: "plan-1", planVersionId: "pv-1", type, key, priceCents: price },
          ]);
          const a = getPrice(version, type, key);
          const b = getPrice(version, type, key);
          expect(a).toEqual(b);
          expect(a).toEqual({ priceCents: price });
        },
      ),
      { numRuns: 200 },
    );
  });

  it("未命中返回 missing，绝不返回隐式默认价或 0", () => {
    fc.assert(
      fc.property(typeArb, fc.string({ minLength: 1, maxLength: 8 }), (type, key) => {
        const version = makeVersion([]); // 空定价
        const result = getPrice(version, type, key);
        expect(result).toEqual({ missing: true });
        expect("priceCents" in result).toBe(false);
      }),
      { numRuns: 200 },
    );
  });
});

describe("Property 3: 预算检查边界", () => {
  it("边界：>=limit×threshold 触发提醒；<不触发；>limit 超限；恰等阈值触发", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.float({ min: 0, max: 1, noNaN: true }),
        fc.integer({ min: 0, max: 2_000_000 }),
        (monthlyLimitCents, alertThreshold, totalCostCents) => {
          const { level } = checkBudget({ totalCostCents, monthlyLimitCents, alertThreshold });
          const alertPoint = monthlyLimitCents * alertThreshold;
          if (totalCostCents > monthlyLimitCents) {
            expect(level).toBe("exceeded");
          } else if (totalCostCents >= alertPoint) {
            expect(level).toBe("alert");
          } else {
            expect(level).toBe("ok");
          }
        },
      ),
      { numRuns: 500 },
    );
  });

  it("恰好等于阈值判定为 alert", () => {
    const monthlyLimitCents = 10000;
    const alertThreshold = 0.8;
    const exactly = monthlyLimitCents * alertThreshold; // 8000
    expect(checkBudget({ totalCostCents: exactly, monthlyLimitCents, alertThreshold }).level).toBe(
      "alert",
    );
    expect(
      checkBudget({ totalCostCents: exactly - 1, monthlyLimitCents, alertThreshold }).level,
    ).toBe("ok");
  });

  it("limit<=0 视为未设预算，恒 ok", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000 }), (totalCostCents) => {
        expect(
          checkBudget({ totalCostCents, monthlyLimitCents: 0, alertThreshold: 0.8 }).level,
        ).toBe("ok");
      }),
      { numRuns: 100 },
    );
  });
});
