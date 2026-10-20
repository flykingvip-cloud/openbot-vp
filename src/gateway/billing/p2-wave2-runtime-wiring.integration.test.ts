// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { upsertPlanEntitlementSnapshot } from "../package-entitlement/plan-version-entitlement-store.js";
import { upsertCreditWeight } from "../resource-catalog/credit-weights-store.js";
import { upsertResourceModelCatalogEntry } from "../resource-catalog/models-catalog-store.js";
import { createPlan } from "./plans-store.js";
import { recordCreditUsage } from "./record-credit-usage.js";
import { resolveEnterpriseAIGovernanceProjection } from "./resolve-enterprise-ai-governance.js";
import { materializeSubscriptionRuntimeSnapshot } from "./subscription-transition-engine.js";
import { createSubscription } from "./subscriptions-store.js";

async function tempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "openbot-p2-w2-"));
}

describe("P2 Wave 2 runtime wiring", () => {
  let dir: string;

  afterEach(async () => {
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("records pricingEngine v2 when creditsV2Enabled on entitlement", async () => {
    const prevRollout = process.env.OPENBOT_CREDITS_V2_ROLLOUT;
    process.env.OPENBOT_CREDITS_V2_ROLLOUT = "full";
    try {
      dir = await tempDir();
      const plansPath = path.join(dir, "plans.json");
      const subsPath = path.join(dir, "subs.json");
      const entitlementPath = path.join(dir, "entitlement.json");
      const catalogPath = path.join(dir, "catalog.json");
      const weightsPath = path.join(dir, "weights.json");
      const ledgerPath = path.join(dir, "ledger.json");
      const runtimePath = path.join(dir, "runtime.json");

      const plan = await createPlan(
        {
          name: "Pro",
          billingCycle: "monthly",
          basePriceCents: 9900,
          seatQuota: { creator: 5 },
          botQuota: 3,
          pricing: [],
          createdByUserId: "test",
        },
        plansPath,
      );
      await upsertPlanEntitlementSnapshot(
        {
          planVersionId: plan.currentVersionId,
          monthlyPriceCents: 9900,
          monthlyCredits: 100,
          maxSeats: { creator: 5 },
          maxBots: 3,
          allowedPolicies: ["balanced"],
          allowedTiers: ["tier_b"],
          features: { creditsV2Enabled: true },
        },
        entitlementPath,
      );
      await upsertResourceModelCatalogEntry(
        { modelId: "openai/gpt-4o", tier: "tier_b", displayName: "GPT-4o" },
        catalogPath,
      );
      await upsertCreditWeight({ tier: "tier_b", creditCost: 5 }, weightsPath);

      const sub = await createSubscription(
        {
          enterpriseId: "ent-w2",
          planId: plan.id,
          planVersionId: plan.currentVersionId,
          resolvedFromPlanId: true,
        },
        subsPath,
      );
      await materializeSubscriptionRuntimeSnapshot({
        enterpriseId: "ent-w2",
        subscription: sub,
        storePaths: {
          plans: plansPath,
          entitlementSnapshot: entitlementPath,
          modelBinding: path.join(dir, "binding.json"),
          runtimeSnapshots: runtimePath,
        },
      });

      const storePaths = {
        subscriptions: subsPath,
        plans: plansPath,
        entitlementSnapshot: entitlementPath,
        modelCatalog: catalogPath,
        creditWeights: weightsPath,
        usageLedger: ledgerPath,
        runtimeSnapshots: runtimePath,
        tenantCredits: path.join(dir, "credits.json"),
        usage: path.join(dir, "usage.json"),
      };

      const result = await recordCreditUsage({
        enterpriseId: "ent-w2",
        taskId: "run-v2",
        modelId: "openai/gpt-4o",
        policyId: "balanced",
        storePaths,
      });
      expect(result.recorded).toBe(true);
      expect(result.creditsCharged).toBe(5);

      const ledgerRaw = JSON.parse(await fs.readFile(ledgerPath, "utf8")) as {
        entries: Array<{ pricingEngine?: string }>;
      };
      expect(ledgerRaw.entries[0]?.pricingEngine).toBe("v2");

      const governance = await resolveEnterpriseAIGovernanceProjection("ent-w2", {
        runtimeSnapshots: runtimePath,
      });
      expect(governance.creditsV2Enabled).toBe(true);
      expect(governance.creditsV2Effective).toBe(true);
      expect(governance.creditsPricingEngine).toBe("v2");
    } finally {
      if (prevRollout === undefined) {
        delete process.env.OPENBOT_CREDITS_V2_ROLLOUT;
      } else {
        process.env.OPENBOT_CREDITS_V2_ROLLOUT = prevRollout;
      }
    }
  });
});
