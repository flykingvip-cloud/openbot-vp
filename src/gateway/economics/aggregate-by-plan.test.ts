import { describe, expect, it } from "vitest";
import { createPlan } from "../billing/plans-store.js";
import { createSubscription, __resetSubscriptionsForTest } from "../billing/subscriptions-store.js";
import type { UsageLedgerEntry } from "../package-entitlement/types.js";
import { aggregateLedgerEconomicsByPlan } from "./aggregate-by-plan.js";

function ledgerEntry(
  over: Partial<UsageLedgerEntry> & Pick<UsageLedgerEntry, "enterpriseId">,
): UsageLedgerEntry {
  const { enterpriseId, ...rest } = over;
  return {
    taskId: "task-1",
    modelId: "openai/gpt-4o",
    tier: "tier_a",
    policyId: "balanced",
    creditsCharged: over.creditsCharged ?? 10,
    providerCostCents: over.providerCostCents ?? 100,
    tenantRevenueCents: over.tenantRevenueCents ?? 200,
    occurredAt: "2026-06-10T00:00:00.000Z",
    id: `le-${enterpriseId}`,
    enterpriseId,
    ...rest,
  };
}

describe("aggregateLedgerEconomicsByPlan", () => {
  it("groups ledger entries by active subscription planId", async () => {
    await __resetSubscriptionsForTest();
    const starter = await createPlan({
      name: "Starter",
      billingCycle: "monthly",
      basePriceCents: 4900,
      botQuota: 5,
      seatQuota: {},
      pricing: [],
      createdByUserId: "admin",
    });
    const pro = await createPlan({
      name: "Professional",
      billingCycle: "monthly",
      basePriceCents: 9900,
      botQuota: 10,
      seatQuota: {},
      pricing: [],
      createdByUserId: "admin",
    });
    await createSubscription({
      enterpriseId: "ent-a",
      planId: starter.id,
      planVersionId: starter.currentVersionId,
    });
    await createSubscription({
      enterpriseId: "ent-b",
      planId: pro.id,
      planVersionId: pro.currentVersionId,
    });

    const byPlan = await aggregateLedgerEconomicsByPlan([
      ledgerEntry({ enterpriseId: "ent-a", providerCostCents: 300, creditsCharged: 20 }),
      ledgerEntry({ enterpriseId: "ent-b", providerCostCents: 500, creditsCharged: 30 }),
    ]);

    expect(byPlan[starter.id]?.providerCostCents).toBe(300);
    expect(byPlan[starter.id]?.creditsCharged).toBe(20);
    expect(byPlan[pro.id]?.providerCostCents).toBe(500);
  });

  it("prefers ledger planId over current subscription mapping", async () => {
    await __resetSubscriptionsForTest();
    const starter = await createPlan({
      name: "Starter",
      billingCycle: "monthly",
      basePriceCents: 4900,
      botQuota: 5,
      seatQuota: {},
      pricing: [],
      createdByUserId: "admin",
    });
    const pro = await createPlan({
      name: "Professional",
      billingCycle: "monthly",
      basePriceCents: 9900,
      botQuota: 10,
      seatQuota: {},
      pricing: [],
      createdByUserId: "admin",
    });
    await createSubscription({
      enterpriseId: "ent-a",
      planId: pro.id,
      planVersionId: pro.currentVersionId,
    });

    const byPlan = await aggregateLedgerEconomicsByPlan([
      ledgerEntry({
        enterpriseId: "ent-a",
        planId: starter.id,
        providerCostCents: 300,
        creditsCharged: 20,
      }),
    ]);

    expect(byPlan[starter.id]?.providerCostCents).toBe(300);
    expect(byPlan[pro.id]).toBeUndefined();
  });
});
