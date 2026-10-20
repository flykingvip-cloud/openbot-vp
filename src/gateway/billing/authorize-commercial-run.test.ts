// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_OVERAGE_POLICY } from "../package-entitlement/normalize-entitlement.js";

const resolveAgentRunEntitlementScope = vi.fn();

vi.mock("../model-entitlement/resolve-agent-run-scope.js", () => ({
  resolveAgentRunEntitlementScope,
}));

const resolveTenantLifecycleAccess = vi.fn();

vi.mock("../platform-auth/resolve-tenant-lifecycle-access.js", () => ({
  resolveTenantLifecycleAccess,
}));

async function tempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "openbot-auth-run-"));
}

const { __resetAgentRunRegistryForTest } = await import("./agent-run-registry.js");
const { __resetSubscriptionRuntimeSnapshotsForTest } =
  await import("./subscription-runtime-snapshots-store.js");
const { __resetSubscriptionsForTest } = await import("./subscriptions-store.js");
const { createPlan } = await import("./plans-store.js");
const { createSubscription } = await import("./subscriptions-store.js");
const { upsertPlanEntitlementSnapshot } =
  await import("../package-entitlement/plan-version-entitlement-store.js");
const { ensureTenantCreditsAllocation } = await import("./tenant-credits-store.js");
const { authorizeCommercialRun } = await import("./authorize-commercial-run.js");
const { materializeSubscriptionRuntimeSnapshot } =
  await import("./subscription-transition-engine.js");
const { createBot } = await import("./bot-resources-store.js");

async function seedEnterpriseSubscription(
  dir: string,
  opts?: { maxConcurrentRuns?: number; monthlyCredits?: number },
) {
  const plan = await createPlan(
    {
      name: "Auth Plan",
      billingCycle: "monthly",
      basePriceCents: 1000,
      seatQuota: {},
      botQuota: 5,
      pricing: [{ type: "usage", key: "ai_credits", priceCents: 1 }],
      createdByUserId: "tester",
    },
    path.join(dir, "plans.json"),
  );
  await upsertPlanEntitlementSnapshot(
    {
      planVersionId: plan.currentVersionId,
      monthlyPriceCents: 1000,
      monthlyCredits: opts?.monthlyCredits ?? 100,
      maxBots: 5,
      maxConcurrentRuns: opts?.maxConcurrentRuns ?? 2,
      overagePolicy: DEFAULT_OVERAGE_POLICY,
    },
    path.join(dir, "ent.json"),
    { plans: path.join(dir, "plans.json"), subscriptions: path.join(dir, "subs.json") },
  );
  const sub = await createSubscription(
    {
      enterpriseId: "ent-auth",
      planId: plan.id,
      planVersionId: plan.currentVersionId,
    },
    path.join(dir, "subs.json"),
  );
  await materializeSubscriptionRuntimeSnapshot({
    enterpriseId: "ent-auth",
    subscription: sub,
    storePaths: {
      plans: path.join(dir, "plans.json"),
      entitlementSnapshot: path.join(dir, "ent.json"),
      modelBinding: path.join(dir, "binding.json"),
      runtimeSnapshots: path.join(dir, "runtime.json"),
    },
  });
  const { cycleStart } = (await import("./runtime.js")).resolveCycleWindow();
  await ensureTenantCreditsAllocation(
    {
      enterpriseId: "ent-auth",
      cycleStart,
      monthlyCredits: opts?.monthlyCredits ?? 100,
    },
    path.join(dir, "credits.json"),
  );
  return { plan, sub, paths: dir };
}

describe("authorizeCommercialRun", () => {
  let dir: string;
  const storePaths = () => ({
    subscriptions: path.join(dir, "subs.json"),
    runtimeSnapshots: path.join(dir, "runtime.json"),
    plans: path.join(dir, "plans.json"),
    entitlementSnapshot: path.join(dir, "ent.json"),
    modelBinding: path.join(dir, "binding.json"),
    agentRunRegistry: path.join(dir, "registry.json"),
    tenantCredits: path.join(dir, "credits.json"),
    botResources: path.join(dir, "bots.json"),
  });

  beforeEach(async () => {
    dir = await tempDir();
    await __resetAgentRunRegistryForTest(path.join(dir, "registry.json"));
    await __resetSubscriptionsForTest(path.join(dir, "subs.json"));
    await __resetSubscriptionRuntimeSnapshotsForTest(path.join(dir, "runtime.json"));
    resolveAgentRunEntitlementScope.mockReset();
    resolveTenantLifecycleAccess.mockReset();
    resolveTenantLifecycleAccess.mockResolvedValue({ blocked: false });
  });

  afterEach(async () => {
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("skips when no enterprise scope", async () => {
    resolveAgentRunEntitlementScope.mockResolvedValue(null);
    const result = await authorizeCommercialRun({
      runId: "r-skip",
      agentId: "agent-x",
      action: "agent_run",
    });
    expect(result).toEqual({ allowed: false, skipped: true });
  });

  it("hard-denies before subscription checks when tenant lifecycle is expired", async () => {
    resolveTenantLifecycleAccess.mockResolvedValue({
      blocked: true,
      status: "expired",
      reason: "expired",
      message: "试用已到期",
    });
    const result = await authorizeCommercialRun({
      runId: "r-expired",
      enterpriseId: "ent-auth",
      agentId: "agent-x",
      action: "agent_run",
    });
    expect(result).toMatchObject({
      allowed: false,
      skipped: false,
      enterpriseId: "ent-auth",
      reason: "TENANT_EXPIRED",
    });
  });

  it("hard-denies when tenant lifecycle is suspended", async () => {
    resolveTenantLifecycleAccess.mockResolvedValue({
      blocked: true,
      status: "suspended",
      reason: "suspended",
      message: "已暂停",
    });
    const result = await authorizeCommercialRun({
      runId: "r-suspended",
      enterpriseId: "ent-auth",
      agentId: "agent-x",
      action: "agent_run",
    });
    expect(result).toMatchObject({
      allowed: false,
      skipped: false,
      reason: "TENANT_SUSPENDED",
    });
  });

  it("allows active subscription agent_run and acquires slot", async () => {
    await seedEnterpriseSubscription(dir);
    const result = await authorizeCommercialRun({
      runId: "r-ok",
      enterpriseId: "ent-auth",
      action: "agent_run",
      storePaths: storePaths(),
    });
    expect(result.allowed).toBe(true);
    if (result.allowed && !result.skipped) {
      expect(result.authorizationDecisionId).toMatch(/^auth-/);
      expect(result.subscriptionSnapshotId).toMatch(/^srs-/);
      expect(result.slotAcquired).toBe(true);
    }
  });

  it("rejects when concurrency limit exceeded", async () => {
    await seedEnterpriseSubscription(dir, { maxConcurrentRuns: 1 });
    await authorizeCommercialRun({
      runId: "r-fill",
      enterpriseId: "ent-auth",
      action: "agent_run",
      storePaths: storePaths(),
    });
    const blocked = await authorizeCommercialRun({
      runId: "r-block",
      enterpriseId: "ent-auth",
      action: "agent_run",
      storePaths: storePaths(),
    });
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed && !blocked.skipped) {
      expect(blocked.reason).toBe("CONCURRENCY_LIMIT_EXCEEDED");
    }
  });

  it("hard denies when enterprise has no active subscription", async () => {
    const result = await authorizeCommercialRun({
      enterpriseId: "ent-no-sub",
      action: "agent_run",
      runId: "r-no-sub",
      storePaths: storePaths(),
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed && !result.skipped) {
      expect(result.reason).toBe("NO_SUBSCRIPTION");
      expect(result.skipped).toBe(false);
    }
  });

  it("rejects bot_create when bot quota full", async () => {
    await seedEnterpriseSubscription(dir);
    for (let i = 0; i < 5; i++) {
      await createBot("ent-auth", `user-${i}`, { storePath: path.join(dir, "bots.json") });
    }
    const result = await authorizeCommercialRun({
      enterpriseId: "ent-auth",
      action: "bot_create",
      storePaths: storePaths(),
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed && !result.skipped) {
      expect(result.reason).toBe("BOT_LIMIT_EXCEEDED");
    }
  });
});

describe("authorizeCommercialRun overagePolicy", () => {
  let dir: string;

  afterEach(async () => {
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
    resolveAgentRunEntitlementScope.mockReset();
    resolveTenantLifecycleAccess.mockReset();
  });

  async function seedWithPolicy(
    policy: { type: "block" | "credits_only" | "pay_as_you_go"; allowBurstConcurrency: boolean },
    monthlyCredits = 10,
  ) {
    dir = await tempDir();
    const pricing =
      policy.type === "pay_as_you_go"
        ? [
            { type: "usage" as const, key: "ai_credits", priceCents: 1 },
            { type: "extra" as const, key: "ai_credits", priceCents: 5 },
          ]
        : [{ type: "usage" as const, key: "ai_credits", priceCents: 1 }];
    const plan = await createPlan(
      {
        name: "Overage Plan",
        billingCycle: "monthly",
        basePriceCents: 1000,
        seatQuota: {},
        botQuota: 5,
        pricing,
        createdByUserId: "tester",
        ...(policy.type === "pay_as_you_go"
          ? {
              meters: [
                {
                  key: "ai_credits",
                  unit: "credit",
                  includedQuota: monthlyCredits,
                  allowOverage: true,
                  chargeIncludedAtUsagePrice: false,
                },
              ],
            }
          : {}),
      } as never,
      path.join(dir, "plans.json"),
    );
    await upsertPlanEntitlementSnapshot(
      {
        planVersionId: plan.currentVersionId,
        monthlyPriceCents: 1000,
        monthlyCredits,
        maxBots: 5,
        maxConcurrentRuns: 4,
        overagePolicy: policy,
      },
      path.join(dir, "ent.json"),
      { plans: path.join(dir, "plans.json"), subscriptions: path.join(dir, "subs.json") },
    );
    const sub = await createSubscription(
      {
        enterpriseId: "ent-ov",
        planId: plan.id,
        planVersionId: plan.currentVersionId,
      },
      path.join(dir, "subs.json"),
    );
    await materializeSubscriptionRuntimeSnapshot({
      enterpriseId: "ent-ov",
      subscription: sub,
      storePaths: {
        plans: path.join(dir, "plans.json"),
        entitlementSnapshot: path.join(dir, "ent.json"),
        runtimeSnapshots: path.join(dir, "snap.json"),
      },
    });
    // exhaust credits
    await ensureTenantCreditsAllocation(
      {
        enterpriseId: "ent-ov",
        cycleStart: new Date().toISOString().slice(0, 7) + "-01T00:00:00.000Z",
        monthlyCredits,
      },
      path.join(dir, "credits.json"),
    );
    // consume all via balance: allocate then we'd need consume — use 0 remaining by monthlyCredits with consumed=monthly
    // Simpler: monthlyCredits 10, creditsRequired 100 with remaining from status
    resolveTenantLifecycleAccess.mockResolvedValue({ allowed: true });
    resolveAgentRunEntitlementScope.mockResolvedValue({
      enterpriseId: "ent-ov",
      denied: false,
    });
    return dir;
  }

  it("pay_as_you_go allows agent_run when credits insufficient", async () => {
    await seedWithPolicy({ type: "pay_as_you_go", allowBurstConcurrency: false }, 5);
    // force low remaining: don't allocate credits so remaining may be 5 after ensure in authorize path
    const result = await authorizeCommercialRun({
      enterpriseId: "ent-ov",
      action: "agent_run",
      runId: "run-payg-1",
      creditsRequired: 999,
      storePaths: {
        subscriptions: path.join(dir, "subs.json"),
        runtimeSnapshots: path.join(dir, "snap.json"),
        plans: path.join(dir, "plans.json"),
        entitlementSnapshot: path.join(dir, "ent.json"),
        agentRunRegistry: path.join(dir, "runs.json"),
        tenantCredits: path.join(dir, "credits.json"),
      },
    } as never);
    // resolveTenantCreditsStatus may return remaining=5; 999 required → overage
    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.creditDecision.overageAllowed).toBe(true);
      expect(result.creditDecision.overagePolicyType).toBe("pay_as_you_go");
    }
  });

  it("block denies agent_run when credits insufficient", async () => {
    await seedWithPolicy({ type: "block", allowBurstConcurrency: false }, 5);
    const result = await authorizeCommercialRun({
      enterpriseId: "ent-ov",
      action: "agent_run",
      runId: "run-block-1",
      creditsRequired: 999,
      storePaths: {
        subscriptions: path.join(dir, "subs.json"),
        runtimeSnapshots: path.join(dir, "snap.json"),
        plans: path.join(dir, "plans.json"),
        entitlementSnapshot: path.join(dir, "ent.json"),
        agentRunRegistry: path.join(dir, "runs.json"),
        tenantCredits: path.join(dir, "credits.json"),
      },
    } as never);
    expect(result.allowed).toBe(false);
    if (!result.allowed && !result.skipped) {
      expect(result.reason).toBe("CREDITS_EXHAUSTED");
    }
  });
});
