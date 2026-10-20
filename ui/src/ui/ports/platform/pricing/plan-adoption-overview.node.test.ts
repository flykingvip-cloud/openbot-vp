// @vitest-environment node

import { describe, expect, it } from "vitest";
import { buildPlanAdoptionRows, formatAdoptionShare } from "./plan-adoption-overview.ts";

describe("buildPlanAdoptionRows", () => {
  it("sorts by active subscriptions descending and computes share", () => {
    const plans = [
      {
        id: "plan-a",
        name: "Starter",
        billingCycle: "monthly" as const,
        basePriceCents: 4900,
        currentVersionId: "pv-a",
        seatQuota: {},
        botQuota: 5,
        status: "active" as const,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "plan-b",
        name: "Professional",
        billingCycle: "monthly" as const,
        basePriceCents: 49900,
        currentVersionId: "pv-b",
        seatQuota: {},
        botQuota: 20,
        status: "active" as const,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    const summary = {
      totals: { activeSubscriptions: 5, mrrCents: 74500 },
      plans: {
        "plan-a": {
          planId: "plan-a",
          activeSubscriptions: 3,
          mrrCents: 14700,
          versions: {},
        },
        "plan-b": {
          planId: "plan-b",
          activeSubscriptions: 2,
          mrrCents: 99800,
          versions: {},
        },
      },
    };

    const rows = buildPlanAdoptionRows(plans, summary);
    expect(rows.map((row) => row.planId)).toEqual(["plan-a", "plan-b"]);
    expect(rows[0]?.sharePercent).toBeCloseTo(60, 5);
    expect(rows[1]?.sharePercent).toBeCloseTo(40, 5);
  });

  it("returns zero rows metrics when summary is missing", () => {
    const plans = [
      {
        id: "plan-a",
        name: "Starter",
        billingCycle: "monthly" as const,
        basePriceCents: 4900,
        currentVersionId: "pv-a",
        seatQuota: {},
        botQuota: 5,
        status: "active" as const,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    const rows = buildPlanAdoptionRows(plans, null);
    expect(rows[0]?.activeSubscriptions).toBe(0);
    expect(rows[0]?.sharePercent).toBeNull();
  });
});

describe("formatAdoptionShare", () => {
  it("formats fractional shares with one decimal below 10 percent", () => {
    expect(formatAdoptionShare(8.5)).toBe("8.5%");
    expect(formatAdoptionShare(50)).toBe("50%");
    expect(formatAdoptionShare(null)).toBe("—");
  });
});
