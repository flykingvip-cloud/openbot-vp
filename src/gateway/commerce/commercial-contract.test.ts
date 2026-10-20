// @vitest-environment node
import { describe, expect, it } from "vitest";
import { addUtcMonths } from "../billing/billing-period.ts";
import { buildCommercialContract, computeContractEnd } from "./commercial-contract.ts";

describe("computeContractEnd — aligned with billing-period addUtcMonths", () => {
  it("clamps month-end anchors (Jan 31) instead of rolling to March", () => {
    const start = new Date("2026-01-31T00:00:00.000Z");
    const monthly = computeContractEnd(start, "monthly");
    expect(monthly.toISOString()).toBe("2026-02-28T00:00:00.000Z");
    expect(monthly.toISOString()).toBe(addUtcMonths(start.toISOString(), 1));
    // Date.UTC day overflow would wrongly yield March 3
    expect(monthly.toISOString()).not.toBe("2026-03-03T00:00:00.000Z");
  });

  it("annual from Jan 31 ends Jan 31 next year (same as addUtcMonths 12)", () => {
    const start = new Date("2026-01-31T12:00:00.000Z");
    expect(computeContractEnd(start, "annual").toISOString()).toBe(
      addUtcMonths(start.toISOString(), 12),
    );
  });

  it("buildCommercialContract uses clamped contractEnd for quarterly", () => {
    const c = buildCommercialContract(new Date("2026-01-31T00:00:00.000Z"), "quarterly");
    expect(c.contractEnd).toBe(addUtcMonths(c.contractStart, 3));
    expect(c.contractEnd).toBe("2026-04-30T00:00:00.000Z");
  });
});
