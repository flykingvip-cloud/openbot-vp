import { describe, expect, it } from "vitest";
import { isEnterpriseModelBudgetExceeded } from "./budget-gate.js";

describe("isEnterpriseModelBudgetExceeded", () => {
  it("allows when no cap is configured", () => {
    expect(isEnterpriseModelBudgetExceeded({ spendCentsInCycle: 999_999 })).toBe(false);
  });

  it("blocks when spend reaches the monthly cap", () => {
    expect(
      isEnterpriseModelBudgetExceeded({
        monthlySpendCapCents: 1000,
        spendCentsInCycle: 1000,
      }),
    ).toBe(true);
  });

  it("allows when spend is still under the cap", () => {
    expect(
      isEnterpriseModelBudgetExceeded({
        monthlySpendCapCents: 1000,
        spendCentsInCycle: 999,
      }),
    ).toBe(false);
  });

  it("blocks immediately when monthlySpendCapCents is 0 (any spend >= 0)", () => {
    expect(
      isEnterpriseModelBudgetExceeded({
        monthlySpendCapCents: 0,
        spendCentsInCycle: 0,
      }),
    ).toBe(true);
  });
});
