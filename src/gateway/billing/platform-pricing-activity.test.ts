// @vitest-environment node

import { describe, expect, it } from "vitest";
import { createPlan, getPlan, setPlanMarketingTags, __resetPlansForTest } from "./plans-store.js";
import { buildPlatformPricingActivityFeed } from "./platform-pricing-activity.js";
import {
  createSubscription,
  transitionSubscriptionStatus,
  __resetSubscriptionsForTest,
} from "./subscriptions-store.js";

describe("platform-pricing-activity", () => {
  it("merges cancel+create into upgrade activity", async () => {
    await __resetPlansForTest();
    await __resetSubscriptionsForTest();
    const basic = await createPlan({
      name: "Basic",
      billingCycle: "monthly",
      basePriceCents: 1000,
      seatQuota: {},
      botQuota: 1,
      pricing: [],
      createdByUserId: "admin",
    });
    const pro = await createPlan({
      name: "Pro",
      billingCycle: "monthly",
      basePriceCents: 5000,
      seatQuota: {},
      botQuota: 5,
      pricing: [],
      createdByUserId: "admin",
    });
    const sub = await createSubscription({
      enterpriseId: "ent-upgrade",
      planId: basic.id,
      planVersionId: basic.currentVersionId,
    });
    await transitionSubscriptionStatus("ent-upgrade", sub.id, "canceled");
    await createSubscription({
      enterpriseId: "ent-upgrade",
      planId: pro.id,
      planVersionId: pro.currentVersionId,
    });

    const feed = await buildPlatformPricingActivityFeed({ limit: 10 });
    const upgrade = feed.find((item) => item.kind === "subscription_upgraded");
    expect(upgrade).toBeDefined();
    expect(upgrade?.enterpriseId).toBe("ent-upgrade");
    expect(upgrade?.fromPlanName).toBe("Basic");
    expect(upgrade?.planName).toBe("Pro");
    expect(
      feed.some(
        (item) => item.kind === "subscription_started" && item.enterpriseId === "ent-upgrade",
      ),
    ).toBe(true);
    expect(
      feed.filter(
        (item) => item.kind === "subscription_ended" && item.enterpriseId === "ent-upgrade",
      ),
    ).toHaveLength(0);
  });

  it("detects downgrade when moving to cheaper plan", async () => {
    await __resetPlansForTest();
    await __resetSubscriptionsForTest();
    const pro = await createPlan({
      name: "Pro",
      billingCycle: "monthly",
      basePriceCents: 5000,
      seatQuota: {},
      botQuota: 5,
      pricing: [],
      createdByUserId: "admin",
    });
    const basic = await createPlan({
      name: "Basic",
      billingCycle: "monthly",
      basePriceCents: 1000,
      seatQuota: {},
      botQuota: 1,
      pricing: [],
      createdByUserId: "admin",
    });
    const sub = await createSubscription({
      enterpriseId: "ent-downgrade",
      planId: pro.id,
      planVersionId: pro.currentVersionId,
    });
    await transitionSubscriptionStatus("ent-downgrade", sub.id, "canceled");
    await createSubscription({
      enterpriseId: "ent-downgrade",
      planId: basic.id,
      planVersionId: basic.currentVersionId,
    });

    const feed = await buildPlatformPricingActivityFeed({ limit: 10 });
    expect(feed.some((item) => item.kind === "subscription_downgraded")).toBe(true);
  });
});

describe("setPlanMarketingTags", () => {
  it("keeps default tag unique across plans", async () => {
    await __resetPlansForTest();
    const a = await createPlan({
      name: "A",
      billingCycle: "monthly",
      basePriceCents: 1000,
      seatQuota: {},
      botQuota: 1,
      pricing: [],
      createdByUserId: "admin",
    });
    const b = await createPlan({
      name: "B",
      billingCycle: "monthly",
      basePriceCents: 2000,
      seatQuota: {},
      botQuota: 1,
      pricing: [],
      createdByUserId: "admin",
    });
    await setPlanMarketingTags(a.id, ["default"]);
    const updatedB = await setPlanMarketingTags(b.id, ["default", "recommended"]);
    expect(updatedB?.marketingTags).toEqual(["default", "recommended"]);
    const refreshedA = await getPlan(a.id);
    expect(refreshedA?.marketingTags).toBeUndefined();
  });
});
