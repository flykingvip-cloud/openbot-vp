import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { upsertPlanEntitlementSnapshot } from "../package-entitlement/plan-version-entitlement-store.js";
import { createPlan } from "./plans-store.js";
import { computeBudgetStatus } from "./runtime.js";
import { createSubscription } from "./subscriptions-store.js";
import { appendUsageLedgerEntry } from "./usage-ledger-store.js";

async function tempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "openbot-budget-"));
}

describe("computeBudgetStatus enterprise_budget", () => {
  let dir: string;

  afterEach(async () => {
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("uses ledger providerCostCents instead of bill total when monthlyCredits=0", async () => {
    dir = await tempDir();
    const plansPath = path.join(dir, "plans.json");
    const subsPath = path.join(dir, "subs.json");
    const entitlementPath = path.join(dir, "entitlement.json");
    const ledgerPath = path.join(dir, "ledger.json");
    const seatsPath = path.join(dir, "seats.json");
    const usagePath = path.join(dir, "usage.json");
    const budgetsPath = path.join(dir, "budgets.json");

    const plan = await createPlan(
      {
        name: "Enterprise",
        billingCycle: "monthly",
        basePriceCents: 0,
        seatQuota: { viewer: 10 },
        botQuota: 10,
        pricing: [{ type: "seat", key: "viewer", priceCents: 5000 }],
        createdByUserId: "test",
      },
      plansPath,
    );
    await upsertPlanEntitlementSnapshot(
      {
        planVersionId: plan.currentVersionId,
        monthlyPriceCents: 0,
        monthlyCredits: 0,
        maxSeats: { viewer: 10 },
        maxBots: 10,
        allowedPolicies: ["balanced"],
        allowedTiers: ["tier_a"],
      },
      entitlementPath,
    );
    await createSubscription(
      {
        enterpriseId: "ent-budget",
        planId: plan.id,
        planVersionId: plan.currentVersionId,
        resolvedFromPlanId: true,
      },
      subsPath,
    );
    await appendUsageLedgerEntry(
      {
        enterpriseId: "ent-budget",
        taskId: "t1",
        modelId: "openai/gpt-4o",
        tier: "tier_a",
        policyId: "balanced",
        creditsCharged: 0,
        providerCostCents: 4200,
        tenantRevenueCents: 0,
      },
      ledgerPath,
    );

    const status = await computeBudgetStatus("ent-budget", new Date("2026-06-15T12:00:00.000Z"), {
      plans: plansPath,
      subscriptions: subsPath,
      entitlementSnapshot: entitlementPath,
      ledger: ledgerPath,
      seats: seatsPath,
      usage: usagePath,
      budgets: budgetsPath,
    });

    expect(status.billingMode).toBe("enterprise_budget");
    expect(status.accruedCents).toBe(4200);
  });
});
