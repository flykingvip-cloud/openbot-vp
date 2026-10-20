import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { upsertPlanEntitlementSnapshot } from "../package-entitlement/plan-version-entitlement-store.js";
import { upsertCreditWeight } from "../resource-catalog/credit-weights-store.js";
import { upsertResourceModelCatalogEntry } from "../resource-catalog/models-catalog-store.js";
import { createPlan } from "./plans-store.js";
import { recordCreditUsage, resolveTenantCreditsStatus } from "./record-credit-usage.js";
import { materializeSubscriptionRuntimeSnapshot } from "./subscription-transition-engine.js";
import { createSubscription, transitionSubscriptionStatus } from "./subscriptions-store.js";
import { listUsageRecords } from "./usage-records-store.js";

async function tempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "openbot-credits-"));
}

describe("recordCreditUsage", () => {
  let dir: string;

  afterEach(async () => {
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("charges credits and dual-writes ledger + ai_credits usage", async () => {
    dir = await tempDir();
    const plansPath = path.join(dir, "plans.json");
    const subsPath = path.join(dir, "subs.json");
    const entitlementPath = path.join(dir, "entitlement.json");
    const catalogPath = path.join(dir, "catalog.json");
    const weightsPath = path.join(dir, "weights.json");
    const creditsPath = path.join(dir, "credits.json");
    const ledgerPath = path.join(dir, "ledger.json");
    const usagePath = path.join(dir, "usage.json");

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
      },
      entitlementPath,
    );
    await upsertResourceModelCatalogEntry(
      { modelId: "openai/gpt-4o", tier: "tier_b", displayName: "GPT-4o" },
      catalogPath,
    );
    await upsertCreditWeight({ tier: "tier_b", creditCost: 5 }, weightsPath);

    await createSubscription(
      {
        enterpriseId: "ent-credits",
        planId: plan.id,
        planVersionId: plan.currentVersionId,
        resolvedFromPlanId: true,
      },
      subsPath,
    );

    const storePaths = {
      subscriptions: subsPath,
      entitlementSnapshot: entitlementPath,
      modelCatalog: catalogPath,
      creditWeights: weightsPath,
      tenantCredits: creditsPath,
      usageLedger: ledgerPath,
      usage: usagePath,
    };

    const first = await recordCreditUsage({
      enterpriseId: "ent-credits",
      taskId: "run-1",
      modelId: "openai/gpt-4o",
      policyId: "balanced",
      storePaths,
    });
    expect(first.recorded).toBe(true);
    expect(first.creditsCharged).toBe(5);
    expect(first.skippedConsumption).toBe(false);

    const { readFile } = await import("node:fs/promises");
    const ledgerRaw = JSON.parse(await readFile(ledgerPath, "utf8")) as {
      entries: Array<{ planId?: string; inputTokens?: number }>;
    };
    expect(ledgerRaw.entries[0]?.planId).toBe(plan.id);

    const second = await recordCreditUsage({
      enterpriseId: "ent-credits",
      taskId: "run-1",
      modelId: "openai/gpt-4o",
      policyId: "balanced",
      storePaths,
    });
    expect(second.deduped).toBe(true);

    const status = await resolveTenantCreditsStatus("ent-credits", storePaths);
    expect(status?.creditsConsumed).toBe(5);
    expect(status?.creditsRemaining).toBe(95);

    const usage = await listUsageRecords("ent-credits", {}, usagePath);
    expect(usage.some((r) => r.key === "ai_credits" && r.quantity === 5)).toBe(true);
  });

  it("applies token-weight multiplier for heavy token usage", async () => {
    dir = await tempDir();
    const plansPath = path.join(dir, "plans.json");
    const subsPath = path.join(dir, "subs.json");
    const entitlementPath = path.join(dir, "entitlement.json");
    const catalogPath = path.join(dir, "catalog.json");
    const weightsPath = path.join(dir, "weights.json");
    const creditsPath = path.join(dir, "credits.json");
    const ledgerPath = path.join(dir, "ledger.json");
    const usagePath = path.join(dir, "usage.json");

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
      },
      entitlementPath,
    );
    await upsertResourceModelCatalogEntry(
      { modelId: "openai/gpt-4o", tier: "tier_b", displayName: "GPT-4o" },
      catalogPath,
    );
    await upsertCreditWeight({ tier: "tier_b", creditCost: 5 }, weightsPath);
    await createSubscription(
      {
        enterpriseId: "ent-heavy",
        planId: plan.id,
        planVersionId: plan.currentVersionId,
        resolvedFromPlanId: true,
      },
      subsPath,
    );

    const storePaths = {
      subscriptions: subsPath,
      entitlementSnapshot: entitlementPath,
      modelCatalog: catalogPath,
      creditWeights: weightsPath,
      tenantCredits: creditsPath,
      usageLedger: ledgerPath,
      usage: usagePath,
    };

    const result = await recordCreditUsage({
      enterpriseId: "ent-heavy",
      taskId: "run-heavy",
      modelId: "openai/gpt-4o",
      policyId: "balanced",
      tokenUsage: { inputTokens: 6000, outputTokens: 2000 },
      storePaths,
    });
    expect(result.creditsCharged).toBe(20);
  });

  it("enterprise_budget 模式跳过 Credits 并记录 ai_provider_cost", async () => {
    dir = await tempDir();
    const plansPath = path.join(dir, "plans.json");
    const subsPath = path.join(dir, "subs.json");
    const entitlementPath = path.join(dir, "entitlement.json");
    const catalogPath = path.join(dir, "catalog.json");
    const weightsPath = path.join(dir, "weights.json");
    const ledgerPath = path.join(dir, "ledger.json");
    const usagePath = path.join(dir, "usage.json");

    const plan = await createPlan(
      {
        name: "Enterprise",
        billingCycle: "monthly",
        basePriceCents: 99000,
        seatQuota: { creator: 50 },
        botQuota: 100,
        pricing: [],
        createdByUserId: "test",
      },
      plansPath,
    );
    await upsertPlanEntitlementSnapshot(
      {
        planVersionId: plan.currentVersionId,
        monthlyPriceCents: 99000,
        monthlyCredits: 0,
        maxSeats: { creator: 50 },
        maxBots: 100,
        allowedPolicies: ["balanced"],
        allowedTiers: ["tier_b"],
      },
      entitlementPath,
    );
    await upsertResourceModelCatalogEntry(
      {
        modelId: "openai/gpt-4o",
        tier: "tier_b",
        displayName: "GPT-4o",
        inputCostPer1MCents: 250,
        outputCostPer1MCents: 1000,
      },
      catalogPath,
    );
    await upsertCreditWeight({ tier: "tier_b", creditCost: 5 }, weightsPath);

    await createSubscription(
      {
        enterpriseId: "ent-enterprise",
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
      usageLedger: ledgerPath,
      usage: usagePath,
    };

    const result = await recordCreditUsage({
      enterpriseId: "ent-enterprise",
      taskId: "run-ent-1",
      modelId: "openai/gpt-4o",
      policyId: "balanced",
      tokenUsage: { inputTokens: 1_000_000, outputTokens: 500_000 },
      storePaths,
    });
    expect(result.recorded).toBe(true);
    expect(result.skippedConsumption).toBe(true);
    expect(result.providerCostCents).toBe(750);

    const usage = await listUsageRecords("ent-enterprise", {}, usagePath);
    expect(usage.some((r) => r.key === "ai_provider_cost" && r.quantity === 750)).toBe(true);
    expect(usage.some((r) => r.key === "ai_credits")).toBe(false);
  });

  it("BYOK ent/ model skips platform Credits debit and tags enterprise billingOwner", async () => {
    dir = await tempDir();
    const plansPath = path.join(dir, "plans.json");
    const subsPath = path.join(dir, "subs.json");
    const entitlementPath = path.join(dir, "entitlement.json");
    const catalogPath = path.join(dir, "catalog.json");
    const weightsPath = path.join(dir, "weights.json");
    const creditsPath = path.join(dir, "credits.json");
    const ledgerPath = path.join(dir, "ledger.json");
    const usagePath = path.join(dir, "usage.json");
    const bucketsPath = path.join(dir, "buckets.json");

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
      },
      entitlementPath,
    );
    const byokModelId = "ent/abcd1234/gpt-4o";
    await upsertResourceModelCatalogEntry(
      {
        modelId: byokModelId,
        tier: "tier_b",
        displayName: "BYOK GPT-4o",
        inputCostPer1MCents: 250,
        outputCostPer1MCents: 1000,
      },
      catalogPath,
    );
    await upsertCreditWeight({ tier: "tier_b", creditCost: 5 }, weightsPath);
    await createSubscription(
      {
        enterpriseId: "ent-byok",
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
      tenantCredits: creditsPath,
      usageLedger: ledgerPath,
      usage: usagePath,
      creditBuckets: bucketsPath,
    };

    const result = await recordCreditUsage({
      enterpriseId: "ent-byok",
      taskId: "run-byok-1",
      modelId: byokModelId,
      policyId: "balanced",
      tokenUsage: { inputTokens: 1_000_000, outputTokens: 500_000 },
      storePaths,
    });

    expect(result.recorded).toBe(true);
    expect(result.skippedConsumption).toBe(true);
    expect(result.creditsCharged).toBe(0);
    expect(result.tenantRevenueCents).toBe(0);
    expect(result.providerCostCents).toBe(750);

    const { listUsageLedgerEntries } = await import("./usage-ledger-store.js");
    const ledger = await listUsageLedgerEntries("ent-byok", {}, ledgerPath);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]?.billingOwner).toBe("enterprise");
    expect(ledger[0]?.source).toBe("enterprise");
    expect(ledger[0]?.creditsCharged).toBe(0);

    const usage = await listUsageRecords("ent-byok", {}, usagePath);
    expect(usage.some((r) => r.key === "ai_credits")).toBe(false);
    expect(usage.some((r) => r.key === "ai_provider_cost")).toBe(true);
  });

  it("tags ai_credits usage with agentId and resolved orgSeatId", async () => {
    dir = await tempDir();
    const plansPath = path.join(dir, "plans.json");
    const subsPath = path.join(dir, "subs.json");
    const entitlementPath = path.join(dir, "entitlement.json");
    const catalogPath = path.join(dir, "catalog.json");
    const weightsPath = path.join(dir, "weights.json");
    const creditsPath = path.join(dir, "credits.json");
    const ledgerPath = path.join(dir, "ledger.json");
    const usagePath = path.join(dir, "usage.json");
    const seatAssetsPath = path.join(dir, "seat-assets.json");

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
      },
      entitlementPath,
    );
    await upsertResourceModelCatalogEntry(
      { modelId: "openai/gpt-4o", tier: "tier_b", displayName: "GPT-4o" },
      catalogPath,
    );
    await upsertCreditWeight({ tier: "tier_b", creditCost: 5 }, weightsPath);

    await createSubscription(
      {
        enterpriseId: "ent-credits",
        planId: plan.id,
        planVersionId: plan.currentVersionId,
        resolvedFromPlanId: true,
      },
      subsPath,
    );

    const { saveEnterpriseSeatAssetsStore } = await import("../enterprise-seat-assets-store.js");
    await saveEnterpriseSeatAssetsStore(seatAssetsPath, {
      version: 4,
      seats: {
        "seat-bot": {
          seatId: "seat-bot",
          tenantId: "ent-credits",
          title: "机器人岗位",
          status: "occupied",
          defaultSpaceIds: [],
          defaultAgentAssetIds: ["agent-tagged"],
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      },
      bindings: {},
      accessPolicies: {},
      assetBindings: {},
      credentialBindings: {},
      handovers: {},
      offers: {},
      auditEvents: {},
      enterpriseIdentities: {},
      identityUsagePolicies: {},
      dataSourceIdentityBindings: {},
      employeeIdentityEnrollments: {},
    });

    await recordCreditUsage({
      enterpriseId: "ent-credits",
      taskId: "run-tagged",
      modelId: "openai/gpt-4o",
      policyId: "balanced",
      agentId: "agent-tagged",
      storePaths: {
        subscriptions: subsPath,
        entitlementSnapshot: entitlementPath,
        modelCatalog: catalogPath,
        creditWeights: weightsPath,
        tenantCredits: creditsPath,
        usageLedger: ledgerPath,
        usage: usagePath,
        seatAssets: seatAssetsPath,
      },
    });

    const usage = await listUsageRecords("ent-credits", {}, usagePath);
    const creditsRow = usage.find(
      (r) => r.key === "ai_credits" && r.eventId === "credit:run-tagged",
    );
    expect(creditsRow?.agentId).toBe("agent-tagged");
    expect(creditsRow?.orgSeatId).toBe("seat-bot");
  });

  it("locks ledger attribution to authorization-time subscription facts", async () => {
    dir = await tempDir();
    const plansPath = path.join(dir, "plans.json");
    const subsPath = path.join(dir, "subs.json");
    const entitlementPath = path.join(dir, "entitlement.json");
    const catalogPath = path.join(dir, "catalog.json");
    const weightsPath = path.join(dir, "weights.json");
    const creditsPath = path.join(dir, "credits.json");
    const ledgerPath = path.join(dir, "ledger.json");
    const usagePath = path.join(dir, "usage.json");
    const runtimePath = path.join(dir, "runtime.json");

    const planA = await createPlan(
      {
        name: "Plan A",
        billingCycle: "monthly",
        basePriceCents: 1000,
        seatQuota: {},
        botQuota: 1,
        pricing: [],
        createdByUserId: "test",
      },
      plansPath,
    );
    const planB = await createPlan(
      {
        name: "Plan B",
        billingCycle: "monthly",
        basePriceCents: 2000,
        seatQuota: {},
        botQuota: 1,
        pricing: [],
        createdByUserId: "test",
      },
      plansPath,
    );
    for (const plan of [planA, planB]) {
      await upsertPlanEntitlementSnapshot(
        {
          planVersionId: plan.currentVersionId,
          monthlyPriceCents: 1000,
          monthlyCredits: 100,
          maxBots: 1,
          allowedPolicies: ["balanced"],
          allowedTiers: ["tier_b"],
        },
        entitlementPath,
      );
    }
    await upsertResourceModelCatalogEntry(
      { modelId: "openai/gpt-4o", tier: "tier_b", displayName: "GPT-4o" },
      catalogPath,
    );
    await upsertCreditWeight({ tier: "tier_b", creditCost: 5 }, weightsPath);

    const subA = await createSubscription(
      {
        enterpriseId: "ent-lock",
        planId: planA.id,
        planVersionId: planA.currentVersionId,
      },
      subsPath,
    );
    const snapshot = await materializeSubscriptionRuntimeSnapshot({
      enterpriseId: "ent-lock",
      subscription: subA,
      storePaths: {
        plans: plansPath,
        entitlementSnapshot: entitlementPath,
        runtimeSnapshots: runtimePath,
      },
    });

    const storePaths = {
      subscriptions: subsPath,
      entitlementSnapshot: entitlementPath,
      modelCatalog: catalogPath,
      creditWeights: weightsPath,
      tenantCredits: creditsPath,
      usageLedger: ledgerPath,
      usage: usagePath,
      runtimeSnapshots: runtimePath,
      plans: plansPath,
    };

    await recordCreditUsage({
      enterpriseId: "ent-lock",
      taskId: "run-locked",
      modelId: "openai/gpt-4o",
      policyId: "balanced",
      subscriptionId: subA.id,
      planId: planA.id,
      planVersionId: planA.currentVersionId,
      subscriptionSnapshotId: snapshot.id,
      storePaths,
    });

    await transitionSubscriptionStatus("ent-lock", subA.id, "canceled");
    await createSubscription(
      {
        enterpriseId: "ent-lock",
        planId: planB.id,
        planVersionId: planB.currentVersionId,
      },
      subsPath,
    );

    const ledgerRaw = JSON.parse(await fs.readFile(ledgerPath, "utf8")) as {
      entries: Array<{
        subscriptionId?: string;
        planId?: string;
        planVersionId?: string;
        subscriptionSnapshotId?: string;
      }>;
    };
    const entry = ledgerRaw.entries.find((e) => e.subscriptionSnapshotId === snapshot.id);
    expect(entry?.subscriptionId).toBe(subA.id);
    expect(entry?.planId).toBe(planA.id);
    expect(entry?.planVersionId).toBe(planA.currentVersionId);
    expect(entry?.planId).not.toBe(planB.id);
  });
  it("resumes incomplete stages after ledger was written (not false-done)", async () => {
    dir = await tempDir();
    const plansPath = path.join(dir, "plans.json");
    const subsPath = path.join(dir, "subs.json");
    const entitlementPath = path.join(dir, "entitlement.json");
    const catalogPath = path.join(dir, "catalog.json");
    const weightsPath = path.join(dir, "weights.json");
    const creditsPath = path.join(dir, "credits.json");
    const ledgerPath = path.join(dir, "ledger.json");
    const usagePath = path.join(dir, "usage.json");
    const stagesPath = path.join(dir, "stages.json");
    const bucketsPath = path.join(dir, "buckets.json");

    const plan = await createPlan(
      {
        name: "Stage",
        billingCycle: "monthly",
        basePriceCents: 1000,
        seatQuota: {},
        botQuota: 1,
        pricing: [{ type: "usage", key: "ai_credits", priceCents: 1 }],
        createdByUserId: "test",
      },
      plansPath,
    );
    await upsertPlanEntitlementSnapshot(
      {
        planVersionId: plan.currentVersionId,
        monthlyPriceCents: 1000,
        monthlyCredits: 50,
        maxBots: 1,
        allowedPolicies: ["balanced"],
        allowedTiers: ["tier_b"],
      },
      entitlementPath,
    );
    await upsertResourceModelCatalogEntry(
      { modelId: "openai/gpt-4o", tier: "tier_b", displayName: "GPT-4o" },
      catalogPath,
    );
    await upsertCreditWeight({ tier: "tier_b", creditCost: 5 }, weightsPath);
    await createSubscription(
      {
        enterpriseId: "ent-stage",
        planId: plan.id,
        planVersionId: plan.currentVersionId,
      },
      subsPath,
    );

    const storePaths = {
      subscriptions: subsPath,
      entitlementSnapshot: entitlementPath,
      plans: plansPath,
      modelCatalog: catalogPath,
      creditWeights: weightsPath,
      tenantCredits: creditsPath,
      usageLedger: ledgerPath,
      usage: usagePath,
      creditUsageStages: stagesPath,
      creditBuckets: bucketsPath,
    };

    const first = await recordCreditUsage({
      enterpriseId: "ent-stage",
      taskId: "task-resume-1",
      modelId: "openai/gpt-4o",
      policyId: "balanced",
      storePaths,
    });
    expect(first.recorded).toBe(true);
    expect(first.stage).toBe("done");
    expect(first.creditsCharged).toBeGreaterThan(0);

    // 模拟崩溃：stage 退回到 ledger_written（测试 reset 后只写 ledger 阶段）
    const { upsertCreditUsageStage, __resetCreditUsageStagesForTest } =
      await import("./credit-usage-stage-store.js");
    await __resetCreditUsageStagesForTest(stagesPath);
    await upsertCreditUsageStage(
      {
        enterpriseId: "ent-stage",
        taskId: "task-resume-1",
        stage: "ledger_written",
        creditsCharged: first.creditsCharged,
      },
      stagesPath,
    );

    // 清空 bucket/tenant 消费侧后重试应能从 bucket_debited 续跑（ledger 不重复）
    const second = await recordCreditUsage({
      enterpriseId: "ent-stage",
      taskId: "task-resume-1",
      modelId: "openai/gpt-4o",
      policyId: "balanced",
      storePaths,
    });
    expect(second.resumed).toBe(true);
    expect(second.stage).toBe("done");
    expect(second.deduped).toBe(false);
    expect(second.creditsCharged).toBe(first.creditsCharged);

    // 已 done 再次调用为 deduped
    const third = await recordCreditUsage({
      enterpriseId: "ent-stage",
      taskId: "task-resume-1",
      modelId: "openai/gpt-4o",
      policyId: "balanced",
      storePaths,
    });
    expect(third.deduped).toBe(true);
    expect(third.stage).toBe("done");
  });
});
