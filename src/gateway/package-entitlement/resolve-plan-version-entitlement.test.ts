import { describe, expect, it } from "vitest";
import { createPlan } from "../billing/plans-store.js";
import { upsertPlanEntitlementSnapshot } from "./plan-version-entitlement-store.js";
import {
  resolvePlanEntitlementsForPlans,
  resolvePlanVersionEntitlement,
} from "./resolve-plan-version-entitlement.js";

describe("resolvePlanVersionEntitlement", () => {
  it("returns stored snapshot when present", async () => {
    const plan = await createPlan({
      name: "Resolve Ent Test",
      billingCycle: "monthly",
      basePriceCents: 1000,
      seatQuota: { viewer: 2 },
      botQuota: 5,
      pricing: [],
      createdByUserId: "test",
    });
    await upsertPlanEntitlementSnapshot({
      planVersionId: plan.currentVersionId,
      monthlyPriceCents: 1000,
      monthlyCredits: 500,
      maxSeats: { viewer: 2 },
      maxBots: 5,
      maxConcurrentRuns: 2,
      allowedPolicies: ["balanced"],
      allowedTiers: ["tier_a"],
    });
    const entitlement = await resolvePlanVersionEntitlement(plan.currentVersionId);
    expect(entitlement?.monthlyCredits).toBe(500);
    expect(entitlement?.maxConcurrentRuns).toBe(2);
  });

  it("falls back to plan version when snapshot missing", async () => {
    const plan = await createPlan({
      name: "Fallback Ent Test",
      billingCycle: "monthly",
      basePriceCents: 2000,
      seatQuota: { viewer: 3, creator: 1 },
      botQuota: 10,
      pricing: [],
      createdByUserId: "test",
    });
    const entitlement = await resolvePlanVersionEntitlement(plan.currentVersionId);
    expect(entitlement?.maxBots).toBe(10);
    expect(entitlement?.maxSeats.viewer).toBe(3);
    expect(entitlement?.maxConcurrentRuns).toBeGreaterThan(0);
  });

  it("resolvePlanEntitlementsForPlans maps by plan id", async () => {
    const plan = await createPlan({
      name: "Map Ent Test",
      billingCycle: "monthly",
      basePriceCents: 0,
      seatQuota: {},
      botQuota: 1,
      pricing: [],
      createdByUserId: "test",
    });
    const map = await resolvePlanEntitlementsForPlans([plan]);
    expect(map[plan.id]?.planVersionId).toBe(plan.currentVersionId);
  });
});
