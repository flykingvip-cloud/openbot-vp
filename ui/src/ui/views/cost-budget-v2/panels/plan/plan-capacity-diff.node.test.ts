import { describe, expect, it } from "vitest";
import type { PlanCapacitySummary } from "../../../cost-budget/plan-capacity-display.ts";
import { buildPlanCapacityDiff } from "./plan-capacity-diff.ts";

function summary(partial: Partial<PlanCapacitySummary>): PlanCapacitySummary {
  return {
    slotKey: "business",
    planId: "plan-business",
    planName: "Business",
    teamMembers: 17,
    aiEmployees: 60,
    concurrentRuns: 8,
    monthlyCredits: 1000,
    monthlyPriceCents: 299_900,
    allowedTiers: ["standard", "advanced"],
    allowedPolicies: [],
    contactSales: false,
    capacitySource: "plan",
    ...partial,
  };
}

describe("buildPlanCapacityDiff", () => {
  it("lists rows where target exceeds current", () => {
    const rows = buildPlanCapacityDiff({
      current: summary({}),
      target: summary({
        planName: "Enterprise",
        teamMembers: 200,
        aiEmployees: 500,
        concurrentRuns: 32,
        monthlyCredits: 50_000,
        allowedTiers: ["standard", "advanced", "frontier"],
      }),
    });
    expect(rows.some((row) => row.id === "aiEmployees" && row.direction === "up")).toBe(true);
    expect(rows.some((row) => row.id === "monthlyCredits" && row.direction === "up")).toBe(true);
  });

  it("omits unchanged metrics", () => {
    const rows = buildPlanCapacityDiff({
      current: summary({}),
      target: summary({}),
    });
    expect(rows).toHaveLength(0);
  });
});
