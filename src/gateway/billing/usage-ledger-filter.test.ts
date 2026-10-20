// @vitest-environment node

import { describe, expect, it } from "vitest";
import { createPlan, __resetPlansForTest } from "./plans-store.js";
import { createSubscription, __resetSubscriptionsForTest } from "./subscriptions-store.js";
import {
  appendUsageLedgerEntry,
  listFilteredUsageLedgerEntries,
  __resetUsageLedgerForTest,
} from "./usage-ledger-store.js";

describe("listFilteredUsageLedgerEntries", () => {
  it("filters by planId and enterpriseId", async () => {
    await __resetUsageLedgerForTest();
    await __resetSubscriptionsForTest();
    await __resetPlansForTest();

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
    await createSubscription({
      enterpriseId: "ent-a",
      planId: basic.id,
      planVersionId: basic.currentVersionId,
    });
    await createSubscription({
      enterpriseId: "ent-b",
      planId: pro.id,
      planVersionId: pro.currentVersionId,
    });

    await appendUsageLedgerEntry({
      enterpriseId: "ent-a",
      taskId: "task-a",
      modelId: "openai/gpt-4o",
      tier: "tier_a",
      policyId: "balanced",
      creditsCharged: 1,
      providerCostCents: 10,
      tenantRevenueCents: 20,
      planId: basic.id,
    });
    await appendUsageLedgerEntry({
      enterpriseId: "ent-b",
      taskId: "task-b",
      modelId: "openai/gpt-4o",
      tier: "tier_b",
      policyId: "balanced",
      creditsCharged: 5,
      providerCostCents: 50,
      tenantRevenueCents: 100,
      planId: pro.id,
    });

    const byPlan = await listFilteredUsageLedgerEntries({ planId: basic.id, limit: 10 });
    expect(byPlan.total).toBe(1);
    expect(byPlan.entries[0]?.enterpriseId).toBe("ent-a");

    const byEnterprise = await listFilteredUsageLedgerEntries({
      enterpriseId: "ent-b",
      limit: 10,
    });
    expect(byEnterprise.total).toBe(1);
    expect(byEnterprise.entries[0]?.planId).toBe(pro.id);
  });
});
