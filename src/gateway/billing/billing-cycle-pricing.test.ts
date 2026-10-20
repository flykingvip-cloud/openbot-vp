import { describe, expect, it } from "vitest";
import {
  CYCLE_DISCOUNT_MULTIPLIER,
  CYCLE_MONTHS,
  computeAllCyclePrices,
  computeCyclePrice,
  normalizeBillingCycle,
} from "./billing-cycle-pricing.js";

describe("billing-cycle-pricing", () => {
  it("月度无折扣，总价 = 月价", () => {
    const q = computeCyclePrice(49_900, "monthly");
    expect(q.months).toBe(1);
    expect(q.totalCents).toBe(49_900);
    expect(q.effectiveMonthlyCents).toBe(49_900);
    expect(q.savingsCents).toBe(0);
    expect(q.discountRate).toBeCloseTo(0);
  });

  it("季度 95 折：总价 = 月价×3×0.95", () => {
    const q = computeCyclePrice(49_900, "quarterly");
    expect(q.months).toBe(3);
    expect(q.listTotalCents).toBe(49_900 * 3);
    expect(q.totalCents).toBe(Math.round(49_900 * 3 * 0.95));
    expect(q.discountRate).toBeCloseTo(0.05);
    expect(q.savingsCents).toBe(q.listTotalCents - q.totalCents);
  });

  it("年度 85 折：总价 = 月价×12×0.85", () => {
    const q = computeCyclePrice(49_900, "annual");
    expect(q.months).toBe(12);
    expect(q.totalCents).toBe(Math.round(49_900 * 12 * 0.85));
    expect(q.discountRate).toBeCloseTo(0.15);
  });

  it("等效月价单调递减不倒挂：月度 > 季度 > 年度", () => {
    const [m, q, a] = computeAllCyclePrices(49_900);
    expect(m.effectiveMonthlyCents).toBeGreaterThan(q.effectiveMonthlyCents);
    expect(q.effectiveMonthlyCents).toBeGreaterThan(a.effectiveMonthlyCents);
  });

  it("免费档（0 元）各周期均为 0", () => {
    for (const quote of computeAllCyclePrices(0)) {
      expect(quote.totalCents).toBe(0);
      expect(quote.effectiveMonthlyCents).toBe(0);
      expect(quote.savingsCents).toBe(0);
    }
  });

  it("常量自洽：月数与折扣键覆盖三周期", () => {
    expect(Object.keys(CYCLE_MONTHS).toSorted()).toEqual(["annual", "monthly", "quarterly"]);
    expect(Object.keys(CYCLE_DISCOUNT_MULTIPLIER).toSorted()).toEqual([
      "annual",
      "monthly",
      "quarterly",
    ]);
  });

  it("normalizeBillingCycle maps legacy semiannual to quarterly", () => {
    expect(normalizeBillingCycle("semiannual")).toBe("quarterly");
    expect(normalizeBillingCycle("quarterly")).toBe("quarterly");
  });
});
