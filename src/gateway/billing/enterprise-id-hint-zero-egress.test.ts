// @vitest-environment node
/**
 * Authorize + Supervisor: known enterpriseId with no agent/seat mapping → MODEL_GATE_DENIED
 * (zero model egress).
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../platform-auth/resolve-tenant-lifecycle-access.js", () => ({
  resolveTenantLifecycleAccess: vi.fn(async () => ({ allowed: true })),
}));
vi.mock("../model-entitlement/resolve-agent-run-scope.js", () => ({
  resolveAgentRunEntitlementScope: vi.fn(async () => null),
}));

import type { OpenBotConfig } from "../../config/types.js";
import { upsertPlanEntitlementSnapshot } from "../package-entitlement/plan-version-entitlement-store.js";
import { authorizeCommercialRun } from "./authorize-commercial-run.js";
import { createPlan } from "./plans-store.js";
import { materializeSubscriptionRuntimeSnapshot } from "./subscription-transition-engine.js";
import { createSubscription } from "./subscriptions-store.js";

describe("enterpriseIdHint zero model egress", () => {
  let dir = "";

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "hint-egress-"));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function seedEnterprise(enterpriseId: string) {
    const plan = await createPlan(
      {
        name: "Plan",
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
        monthlyCredits: 100,
        maxBots: 5,
        maxConcurrentRuns: 4,
        overagePolicy: { type: "block", allowBurstConcurrency: false },
      },
      path.join(dir, "ent.json"),
      { plans: path.join(dir, "plans.json"), subscriptions: path.join(dir, "subs.json") },
    );
    const sub = await createSubscription(
      {
        enterpriseId,
        planId: plan.id,
        planVersionId: plan.currentVersionId,
      },
      path.join(dir, "subs.json"),
    );
    await materializeSubscriptionRuntimeSnapshot({
      enterpriseId,
      subscription: sub,
      storePaths: {
        plans: path.join(dir, "plans.json"),
        entitlementSnapshot: path.join(dir, "ent.json"),
        runtimeSnapshots: path.join(dir, "snap.json"),
      },
    });
  }

  it("authorizeCommercialRun injects enterpriseIdHint and denies when no seat/agent mapping", async () => {
    const enterpriseId = "ent-hint-only";
    await seedEnterprise(enterpriseId);
    const cfg = {
      gateway: {
        platform: {
          models: {
            mode: "native",
            entitlement: { enforce: "missing-allow", scope: "employee-chat" },
          },
        },
      },
      models: { providers: {} },
    } as unknown as OpenBotConfig;

    const result = await authorizeCommercialRun({
      enterpriseId,
      action: "agent_run",
      runId: "run-hint-1",
      // No agentId / userId / billingSeat — commercial layer still knows enterpriseId.
      modelGateInput: {
        cfg,
        // deliberately omit agentId and employee session
      },
      storePaths: {
        subscriptions: path.join(dir, "subs.json"),
        runtimeSnapshots: path.join(dir, "snap.json"),
        plans: path.join(dir, "plans.json"),
        entitlementSnapshot: path.join(dir, "ent.json"),
        agentRunRegistry: path.join(dir, "runs.json"),
      },
    });

    expect(result.allowed).toBe(false);
    if (!result.allowed && !result.skipped) {
      expect(result.reason).toBe("MODEL_GATE_DENIED");
    }
  });
});
