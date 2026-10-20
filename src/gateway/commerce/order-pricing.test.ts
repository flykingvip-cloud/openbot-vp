// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { Plan, PlanVersion } from "../billing/types.js";
import { quoteChangePlanOrder, quoteSubscribeOrder } from "./order-pricing.js";
import { versionPricingSource } from "./pricing-version-source.js";

function plan(partial: Partial<Plan> & Pick<Plan, "id" | "name" | "basePriceCents">): Plan {
  return {
    billingCycle: "monthly",
    currentVersionId: "pv-1",
    seatQuota: {},
    botQuota: 1,
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

function version(planRef: Plan, snapshotBaseCents: number, id = "pv-1"): PlanVersion {
  return {
    id,
    planId: planRef.id,
    version: 1,
    status: "active",
    snapshot: {
      basePriceCents: snapshotBaseCents,
      seatQuota: planRef.seatQuota,
      botQuota: planRef.botQuota,
      pricing: [],
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    createdByUserId: "u1",
  };
}

describe("order-pricing", () => {
  it("quoteSubscribeOrder uses PlanVersion snapshot not Plan head", () => {
    const p = plan({ id: "p1", name: "Professional", basePriceCents: 999_999 });
    const v = version(p, 10_000);
    const quote = quoteSubscribeOrder({
      source: versionPricingSource(p, v, "monthly"),
    });
    expect(quote.amountCents).toBe(10_000);
  });

  it("quoteSubscribeOrder applies annual discount on snapshot price", () => {
    const p = plan({ id: "p1", name: "Professional", basePriceCents: 10_000 });
    const v = version(p, 10_000);
    const quote = quoteSubscribeOrder({
      source: versionPricingSource(p, v, "annual"),
    });
    expect(quote.amountCents).toBe(Math.round(10_000 * 12 * 0.85));
  });

  it("quoteChangePlanOrder uses locked current version snapshot", () => {
    const currentPlan = plan({ id: "p-old", name: "Old", basePriceCents: 50_000 });
    const currentVersion = version(currentPlan, 20_000, "pv-old");
    const targetPlan = plan({ id: "p-new", name: "New", basePriceCents: 1_000 });
    const targetVersion = version(targetPlan, 30_000, "pv-new");
    const quote = quoteChangePlanOrder({
      current: versionPricingSource(currentPlan, currentVersion, "monthly"),
      target: versionPricingSource(targetPlan, targetVersion, "monthly"),
      now: new Date("2026-06-15T12:00:00.000Z"),
    });
    expect(quote.amountCents).toBeGreaterThanOrEqual(0);
    expect(quote.planVersionIds).toEqual(["pv-old", "pv-new"]);
  });
});
