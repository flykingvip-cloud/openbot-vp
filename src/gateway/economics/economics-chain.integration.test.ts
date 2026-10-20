import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPlan } from "../billing/plans-store.js";
import { recordCreditUsage } from "../billing/record-credit-usage.js";
import { createSubscription, __resetSubscriptionsForTest } from "../billing/subscriptions-store.js";
import { listAllUsageLedgerEntries } from "../billing/usage-ledger-store.js";
import {
  activateCostVersion,
  createCostVersionFromCatalog,
} from "../cost-version/cost-version-store.js";
import { upsertPlanEntitlementSnapshot } from "../package-entitlement/plan-version-entitlement-store.js";
import { upsertCreditWeight } from "../resource-catalog/credit-weights-store.js";
import { upsertResourceModelCatalogEntry } from "../resource-catalog/models-catalog-store.js";
import { aggregateLedgerEconomicsByPlan } from "./aggregate-by-plan.js";
import { buildEconomicsProjectionContext, projectFullQuotaForPlan } from "./projection-context.js";

async function tempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "openbot-econ-chain-"));
}

describe("economics chain integration", () => {
  let dir: string;

  afterEach(async () => {
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("records ledger with planId/tokens, attributes byPlan, and projects quota cost", async () => {
    dir = await tempDir();
    await __resetSubscriptionsForTest(path.join(dir, "subs.json"));

    const plansPath = path.join(dir, "plans.json");
    const subsPath = path.join(dir, "subs.json");
    const entitlementPath = path.join(dir, "entitlement.json");
    const catalogPath = path.join(dir, "catalog.json");
    const weightsPath = path.join(dir, "weights.json");
    const creditsPath = path.join(dir, "credits.json");
    const ledgerPath = path.join(dir, "ledger.json");
    const usagePath = path.join(dir, "usage.json");
    const costVersionsPath = path.join(dir, "cost-versions.json");

    const starter = await createPlan(
      {
        name: "Starter",
        billingCycle: "monthly",
        basePriceCents: 4900,
        seatQuota: {},
        botQuota: 5,
        pricing: [],
        createdByUserId: "test",
      },
      plansPath,
    );
    const pro = await createPlan(
      {
        name: "Pro",
        billingCycle: "monthly",
        basePriceCents: 9900,
        seatQuota: {},
        botQuota: 10,
        pricing: [],
        createdByUserId: "test",
      },
      plansPath,
    );

    for (const [plan, credits, tiers] of [
      [starter, 100, ["tier_a"]],
      [pro, 200, ["tier_a", "tier_b"]],
    ] as const) {
      await upsertPlanEntitlementSnapshot(
        {
          planVersionId: plan.currentVersionId,
          monthlyPriceCents: plan.basePriceCents,
          monthlyCredits: credits,
          maxSeats: {},
          maxBots: plan.botQuota,
          allowedPolicies: ["cheapest"],
          allowedTiers: [...tiers],
        },
        entitlementPath,
      );
    }

    await upsertResourceModelCatalogEntry(
      {
        modelId: "openai/gpt-4o-mini",
        tier: "tier_a",
        displayName: "Mini",
        inputCostPer1MCents: 100,
        outputCostPer1MCents: 200,
      },
      catalogPath,
    );
    await upsertResourceModelCatalogEntry(
      {
        modelId: "openai/gpt-4o",
        tier: "tier_b",
        displayName: "GPT-4o",
        inputCostPer1MCents: 500,
        outputCostPer1MCents: 1000,
      },
      catalogPath,
    );
    await upsertCreditWeight({ tier: "tier_a", creditCost: 1 }, weightsPath);
    await upsertCreditWeight({ tier: "tier_b", creditCost: 5 }, weightsPath);

    await createSubscription(
      {
        enterpriseId: "ent-starter",
        planId: starter.id,
        planVersionId: starter.currentVersionId,
      },
      subsPath,
    );
    await createSubscription(
      {
        enterpriseId: "ent-pro",
        planId: pro.id,
        planVersionId: pro.currentVersionId,
      },
      subsPath,
    );

    const storePaths = {
      subscriptions: subsPath,
      plans: plansPath,
      entitlementSnapshot: entitlementPath,
      modelCatalog: catalogPath,
      creditWeights: weightsPath,
      tenantCredits: creditsPath,
      usageLedger: ledgerPath,
      usage: usagePath,
      costVersions: costVersionsPath,
    };

    await recordCreditUsage({
      enterpriseId: "ent-starter",
      taskId: "run-starter",
      modelId: "openai/gpt-4o-mini",
      policyId: "cheapest",
      tokenUsage: { inputTokens: 2000, outputTokens: 400 },
      storePaths,
    });
    await recordCreditUsage({
      enterpriseId: "ent-pro",
      taskId: "run-pro",
      modelId: "openai/gpt-4o",
      policyId: "cheapest",
      tokenUsage: { inputTokens: 4000, outputTokens: 800 },
      storePaths,
    });

    const entries = await listAllUsageLedgerEntries({}, ledgerPath);
    expect(entries).toHaveLength(2);
    expect(entries.find((e) => e.enterpriseId === "ent-starter")?.planId).toBe(starter.id);
    expect(entries.find((e) => e.enterpriseId === "ent-starter")?.inputTokens).toBe(2000);

    // 企业换套餐后，历史 ledger 仍按写入时 planId 归因
    await createSubscription(
      {
        enterpriseId: "ent-starter",
        planId: pro.id,
        planVersionId: pro.currentVersionId,
      },
      subsPath,
    );
    const byPlan = await aggregateLedgerEconomicsByPlan(entries, subsPath);
    expect(byPlan[starter.id]?.creditsCharged).toBe(1);
    expect(byPlan[pro.id]?.creditsCharged).toBe(5);

    const draft = await createCostVersionFromCatalog(costVersionsPath, catalogPath);
    await activateCostVersion(draft.id, costVersionsPath);

    const projectionContext = buildEconomicsProjectionContext({
      models: [
        {
          modelId: "openai/gpt-4o-mini",
          provider: "openai",
          displayName: "Mini",
          tier: "tier_a",
          enabled: true,
          inputCostPer1MCents: 100,
          outputCostPer1MCents: 200,
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        {
          modelId: "openai/gpt-4o",
          provider: "openai",
          displayName: "GPT-4o",
          tier: "tier_b",
          enabled: true,
          inputCostPer1MCents: 500,
          outputCostPer1MCents: 1000,
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      creditWeights: [
        { tier: "tier_a", creditCost: 1, updatedAt: "2026-01-01T00:00:00.000Z" },
        { tier: "tier_b", creditCost: 5, updatedAt: "2026-01-01T00:00:00.000Z" },
      ],
      activeCostVersion: draft,
      ledgerEntries: entries,
    });

    expect(projectionContext.benchmarkSource).toBe("ledger");
    expect(projectionContext.benchmark.inputTokens).toBe(3000);
    expect(projectionContext.tierObservedMix.tier_b).toBeGreaterThan(0);

    const projected = projectFullQuotaForPlan({
      monthlyCredits: 100,
      allowedTiers: ["tier_a"],
      selectorStrategy: "cheapest",
      projectionContext,
    });
    expect(projected).not.toBeNull();
    expect(projected!).toBeGreaterThan(0);
    expect(projected!).toBeLessThan(4900);
  });
});
