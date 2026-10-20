import { describe, expect, it } from "vitest";
import { buildPlatformCommercialSummary } from "../billing/plan-commercial-summary.js";
import { createPlan } from "../billing/plans-store.js";
import { createSubscription, __resetSubscriptionsForTest } from "../billing/subscriptions-store.js";

describe("buildPlatformCommercialSummary", () => {
  it("aggregates active subscriptions and MRR by plan/version", async () => {
    await __resetSubscriptionsForTest();
    const plan = await createPlan({
      name: "Starter",
      billingCycle: "monthly",
      basePriceCents: 4900,
      botQuota: 5,
      seatQuota: {},
      pricing: [],
      createdByUserId: "test-admin",
    });
    const versionId = plan.currentVersionId;
    await createSubscription({
      enterpriseId: "ent-a",
      planId: plan.id,
      planVersionId: versionId,
    });
    await createSubscription({
      enterpriseId: "ent-b",
      planId: plan.id,
      planVersionId: versionId,
    });

    const summary = await buildPlatformCommercialSummary();
    expect(summary.totals.activeSubscriptions).toBe(2);
    expect(summary.totals.mrrCents).toBe(9800);
    expect(summary.plans[plan.id]?.activeSubscriptions).toBe(2);
    expect(summary.plans[plan.id]?.mrrCents).toBe(9800);
    expect(summary.plans[plan.id]?.versions[versionId]?.lockedSubscriptions).toBe(2);
    expect(summary.totals.previousActiveSubscriptions).toBe(0);
    expect(summary.totals.subsTrendDelta).toBe(2);
    expect(summary.recentActivity?.some((item) => item.kind === "subscription_started")).toBe(true);
  });
});
