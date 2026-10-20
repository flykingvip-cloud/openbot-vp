// @vitest-environment node
/**
 * Wave 5 E2E — 充值分桶、套餐升级快照、credits v2 rollout 门控。
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { upsertPlanEntitlementSnapshot } from "../package-entitlement/plan-version-entitlement-store.js";
import { upsertCreditWeight } from "../resource-catalog/credit-weights-store.js";
import { upsertResourceModelCatalogEntry } from "../resource-catalog/models-catalog-store.js";
import { tryAcquireAgentRunSlot, __resetAgentRunRegistryForTest } from "./agent-run-registry.js";
import {
  appendCreditBucket,
  consumeCreditBuckets,
  ensurePlanCycleCreditBucket,
  __resetCreditBucketsForTest,
} from "./credit-buckets-store.js";
import { resolveEffectiveCreditsV2Enabled } from "./credits-v2-rollout.js";
import { createPlan } from "./plans-store.js";
import { recordCreditUsage } from "./record-credit-usage.js";
import {
  appendSubscriptionRuntimeSnapshot,
  getActiveSubscriptionRuntimeSnapshot,
} from "./subscription-runtime-snapshots-store.js";
import { materializeSubscriptionRuntimeSnapshot } from "./subscription-transition-engine.js";
import { createSubscription } from "./subscriptions-store.js";

async function tempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "openbot-w5-"));
}

describe("commercial runtime wave5 E2E", () => {
  let dir: string;

  afterEach(async () => {
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("consumes recharge bucket after plan_cycle is exhausted", async () => {
    dir = await tempDir();
    const bucketPath = path.join(dir, "buckets.json");
    await __resetCreditBucketsForTest(bucketPath);
    const cycleStart = "2026-06-01T00:00:00.000Z";
    await ensurePlanCycleCreditBucket(
      { enterpriseId: "ent-w5", cycleStart, monthlyCredits: 50 },
      bucketPath,
    );
    await appendCreditBucket(
      {
        enterpriseId: "ent-w5",
        cycleStart,
        bucketType: "recharge",
        creditsGranted: 30,
      },
      bucketPath,
    );
    const balance = await consumeCreditBuckets(
      { enterpriseId: "ent-w5", cycleStart, credits: 70 },
      bucketPath,
    );
    expect(balance.creditsRemaining).toBe(10);
  });

  it("upgrade snapshot raises monthly credits for new runs", async () => {
    dir = await tempDir();
    const plansPath = path.join(dir, "plans.json");
    const subsPath = path.join(dir, "subs.json");
    const entitlementPath = path.join(dir, "entitlement.json");
    const runtimePath = path.join(dir, "runtime.json");

    const plan = await createPlan(
      {
        name: "Starter",
        billingCycle: "monthly",
        basePriceCents: 1000,
        seatQuota: { viewer: 5 },
        botQuota: 3,
        pricing: [],
        createdByUserId: "tester",
      },
      plansPath,
    );
    await upsertPlanEntitlementSnapshot(
      {
        planVersionId: plan.currentVersionId,
        monthlyPriceCents: 1000,
        monthlyCredits: 100,
        maxBots: 3,
        maxConcurrentRuns: 2,
      },
      entitlementPath,
    );
    const sub = await createSubscription(
      {
        enterpriseId: "ent-upgrade",
        planId: plan.id,
        planVersionId: plan.currentVersionId,
        resolvedFromPlanId: true,
      },
      subsPath,
    );
    const base = await materializeSubscriptionRuntimeSnapshot({
      enterpriseId: "ent-upgrade",
      subscription: sub,
      storePaths: {
        plans: plansPath,
        entitlementSnapshot: entitlementPath,
        modelBinding: path.join(dir, "binding.json"),
        runtimeSnapshots: runtimePath,
      },
    });
    await appendSubscriptionRuntimeSnapshot(
      {
        enterpriseId: "ent-upgrade",
        subscriptionId: sub.id,
        planId: plan.id,
        planVersionId: plan.currentVersionId,
        pricingSnapshot: base.pricingSnapshot,
        modelBindingSnapshot: base.modelBindingSnapshot,
        billingMode: base.billingMode,
        entitlementSnapshot: {
          ...base.entitlementSnapshot,
          monthlyCredits: 500,
          maxConcurrentRuns: 5,
        },
      },
      runtimePath,
    );

    const snapshot = await getActiveSubscriptionRuntimeSnapshot("ent-upgrade", runtimePath);
    expect(snapshot?.entitlementSnapshot.monthlyCredits).toBe(500);
    expect(snapshot?.entitlementSnapshot.maxConcurrentRuns).toBe(5);
  });

  it("blocks credits v2 when rollout is off despite tenant feature flag", async () => {
    const prev = process.env.OPENBOT_CREDITS_V2_ROLLOUT;
    delete process.env.OPENBOT_CREDITS_V2_ROLLOUT;
    try {
      expect(resolveEffectiveCreditsV2Enabled("ent-w5", { creditsV2Enabled: true })).toBe(false);
    } finally {
      if (prev === undefined) {
        delete process.env.OPENBOT_CREDITS_V2_ROLLOUT;
      } else {
        process.env.OPENBOT_CREDITS_V2_ROLLOUT = prev;
      }
    }
  });

  it("allows burst concurrency up to maxBurstRuns", async () => {
    dir = await tempDir();
    const registryPath = path.join(dir, "registry.json");
    await __resetAgentRunRegistryForTest(registryPath);
    const base = {
      enterpriseId: "ent-burst-w5",
      maxConcurrentRuns: 1,
      maxBurstRuns: 2,
      allowBurstConcurrency: true,
    };
    expect((await tryAcquireAgentRunSlot({ ...base, runId: "b1" }, registryPath)).ok).toBe(true);
    expect((await tryAcquireAgentRunSlot({ ...base, runId: "b2" }, registryPath)).ok).toBe(true);
    const blocked = await tryAcquireAgentRunSlot({ ...base, runId: "b3" }, registryPath);
    expect(blocked.ok).toBe(false);
  });

  it("records v1 pricing when rollout off but tenant has creditsV2Enabled", async () => {
    const prevRollout = process.env.OPENBOT_CREDITS_V2_ROLLOUT;
    delete process.env.OPENBOT_CREDITS_V2_ROLLOUT;
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
          name: "W5",
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
          enterpriseId: "ent-w5-v2off",
          planId: plan.id,
          planVersionId: plan.currentVersionId,
          resolvedFromPlanId: true,
        },
        subsPath,
      );
      await materializeSubscriptionRuntimeSnapshot({
        enterpriseId: "ent-w5-v2off",
        subscription: sub,
        storePaths: {
          plans: plansPath,
          entitlementSnapshot: entitlementPath,
          modelBinding: path.join(dir, "binding.json"),
          runtimeSnapshots: runtimePath,
        },
      });

      const result = await recordCreditUsage({
        enterpriseId: "ent-w5-v2off",
        taskId: "task-w5",
        modelId: "openai/gpt-4o",
        policyId: "balanced",
        storePaths: {
          subscriptions: subsPath,
          entitlementSnapshot: entitlementPath,
          modelCatalog: catalogPath,
          creditWeights: weightsPath,
          usageLedger: ledgerPath,
          runtimeSnapshots: runtimePath,
          tenantCredits: path.join(dir, "credits.json"),
          usage: path.join(dir, "usage.json"),
        },
      });
      expect(result.recorded).toBe(true);
      const ledgerRaw = JSON.parse(await fs.readFile(ledgerPath, "utf8")) as {
        entries: Array<{ pricingEngine?: string }>;
      };
      expect(ledgerRaw.entries[0]?.pricingEngine).toBe("v1");
    } finally {
      if (prevRollout === undefined) {
        delete process.env.OPENBOT_CREDITS_V2_ROLLOUT;
      } else {
        process.env.OPENBOT_CREDITS_V2_ROLLOUT = prevRollout;
      }
    }
  });
});
