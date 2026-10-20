import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPlan } from "../billing/plans-store.js";
import { recordCreditUsage } from "../billing/record-credit-usage.js";
import { createSubscription } from "../billing/subscriptions-store.js";
import { upsertPlanEntitlementSnapshot } from "../package-entitlement/plan-version-entitlement-store.js";
import { upsertCreditWeight } from "../resource-catalog/credit-weights-store.js";
import { upsertResourceModelCatalogEntry } from "../resource-catalog/models-catalog-store.js";
import {
  activateCostVersion,
  createCostVersionFromCatalog,
  resolveModelCostRates,
} from "./cost-version-store.js";

async function tempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "openbot-costv-"));
}

describe("cost-version economics integration", () => {
  let dir: string;

  afterEach(async () => {
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("active cost version drives ledger providerCostCents", async () => {
    dir = await tempDir();
    const plansPath = path.join(dir, "plans.json");
    const subsPath = path.join(dir, "subs.json");
    const entitlementPath = path.join(dir, "entitlement.json");
    const catalogPath = path.join(dir, "catalog.json");
    const weightsPath = path.join(dir, "weights.json");
    const costVersionsPath = path.join(dir, "cost-versions.json");
    const creditsPath = path.join(dir, "credits.json");
    const ledgerPath = path.join(dir, "ledger.json");
    const usagePath = path.join(dir, "usage.json");

    await upsertResourceModelCatalogEntry(
      {
        modelId: "openai/gpt-4o",
        tier: "tier_b",
        displayName: "GPT-4o",
        inputCostPer1MCents: 999,
        outputCostPer1MCents: 1999,
      },
      catalogPath,
    );
    const draft = await createCostVersionFromCatalog(costVersionsPath, catalogPath);
    await activateCostVersion(draft.id, costVersionsPath);
    const rates = await resolveModelCostRates("openai/gpt-4o", {
      costVersions: costVersionsPath,
      modelCatalog: catalogPath,
    });
    expect(rates.source).toBe("cost_version");

    const plan = await createPlan(
      {
        name: "Pro",
        billingCycle: "monthly",
        basePriceCents: 9900,
        seatQuota: {},
        botQuota: 3,
        pricing: [{ type: "usage", key: "ai_credits", priceCents: 2 }],
        createdByUserId: "test",
      },
      plansPath,
    );
    await upsertPlanEntitlementSnapshot(
      {
        planVersionId: plan.currentVersionId,
        monthlyPriceCents: 9900,
        monthlyCredits: 100,
        maxSeats: {},
        maxBots: 3,
        allowedPolicies: ["balanced"],
        allowedTiers: ["tier_b"],
      },
      entitlementPath,
    );
    await upsertCreditWeight({ tier: "tier_b", creditCost: 5 }, weightsPath);
    await createSubscription(
      {
        enterpriseId: "ent-econ",
        planId: plan.id,
        planVersionId: plan.currentVersionId,
        resolvedFromPlanId: true,
      },
      subsPath,
    );

    const storePaths = {
      subscriptions: subsPath,
      plans: plansPath,
      entitlementSnapshot: entitlementPath,
      modelCatalog: catalogPath,
      creditWeights: weightsPath,
      costVersions: costVersionsPath,
      tenantCredits: creditsPath,
      usageLedger: ledgerPath,
      usage: usagePath,
    };

    const result = await recordCreditUsage({
      enterpriseId: "ent-econ",
      taskId: "run-econ-1",
      modelId: "openai/gpt-4o",
      policyId: "balanced",
      tokenUsage: { inputTokens: 1_000_000, outputTokens: 0 },
      storePaths,
    });

    expect(result.recorded).toBe(true);
    expect(result.providerCostCents).toBe(999);
    expect(result.tenantRevenueCents).toBe(10);
    expect(result.creditsCharged).toBe(5);
  });
});
