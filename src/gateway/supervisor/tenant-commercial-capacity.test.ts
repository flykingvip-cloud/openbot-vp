// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  __resetAgentRunRegistryForTest,
  tryAcquireAgentRunSlot,
} from "../billing/agent-run-registry.js";
import { createPlan } from "../billing/plans-store.js";
import {
  appendSubscriptionRuntimeSnapshot,
  getActiveSubscriptionRuntimeSnapshot,
} from "../billing/subscription-runtime-snapshots-store.js";
import { materializeSubscriptionRuntimeSnapshot } from "../billing/subscription-transition-engine.js";
import { createSubscription } from "../billing/subscriptions-store.js";
import { upsertPlanEntitlementSnapshot } from "../package-entitlement/plan-version-entitlement-store.js";
import { assertSupervisorTenantCommercialCapacity } from "../supervisor/commercial-run-gate.js";
import { createTask } from "../supervisor/store.js";
import { resolveSupervisorTenantCommercialCapacity } from "../supervisor/tenant-commercial-capacity.js";
import type { SupervisedTask } from "../supervisor/types.js";

async function tempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "openbot-w6-"));
}

function baseTask(overrides: Partial<SupervisedTask> = {}): SupervisedTask {
  const now = new Date().toISOString();
  return {
    taskId: "sup_test",
    goal: "test",
    repoRoot: "/tmp/repo",
    tenantId: "ent-w6",
    worker: { backendId: "gateway" },
    workspace: { id: "ws-1", root: "/tmp/ws", kind: "directory" },
    acceptance: { steps: [], source: "user" },
    state: "executing",
    iterations: [],
    budget: {
      maxIterations: 5,
      maxCostUsd: 1,
      maxDurationMinutes: 30,
      spentCostUsd: 0.25,
    },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("supervisor tenant commercial capacity", () => {
  let dir: string;

  afterEach(async () => {
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("aggregates in-flight supervisor tasks and commercial runs", async () => {
    dir = await tempDir();
    const supervisorDir = path.join(dir, "supervisor");
    const registryPath = path.join(dir, "registry.json");
    await __resetAgentRunRegistryForTest(registryPath);

    await createTask(
      baseTask({
        taskId: "sup_1",
        state: "executing",
        budget: {
          maxIterations: 5,
          maxCostUsd: 1,
          maxDurationMinutes: 30,
          spentCostUsd: 0.1,
        },
      }),
      supervisorDir,
    );
    await createTask(
      baseTask({
        taskId: "sup_2",
        state: "planned",
        budget: {
          maxIterations: 5,
          maxCostUsd: 1,
          maxDurationMinutes: 30,
          spentCostUsd: 0.2,
        },
      }),
      supervisorDir,
    );
    await tryAcquireAgentRunSlot(
      {
        enterpriseId: "ent-w6",
        runId: "run-1",
        maxConcurrentRuns: 2,
        allowBurstConcurrency: false,
      },
      registryPath,
    );

    const plansPath = path.join(dir, "plans.json");
    const subsPath = path.join(dir, "subs.json");
    const entitlementPath = path.join(dir, "entitlement.json");
    const runtimePath = path.join(dir, "runtime.json");
    const plan = await createPlan(
      {
        name: "Scale",
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
        enterpriseId: "ent-w6",
        planId: plan.id,
        planVersionId: plan.currentVersionId,
        resolvedFromPlanId: true,
      },
      subsPath,
    );
    const base = await materializeSubscriptionRuntimeSnapshot({
      enterpriseId: "ent-w6",
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
        enterpriseId: "ent-w6",
        subscriptionId: sub.id,
        planId: plan.id,
        planVersionId: plan.currentVersionId,
        pricingSnapshot: base.pricingSnapshot,
        modelBindingSnapshot: base.modelBindingSnapshot,
        billingMode: base.billingMode,
        entitlementSnapshot: base.entitlementSnapshot,
      },
      runtimePath,
    );
    const snapshot = await getActiveSubscriptionRuntimeSnapshot("ent-w6", runtimePath);
    expect(snapshot?.entitlementSnapshot.maxConcurrentRuns).toBe(2);

    const capacity = await resolveSupervisorTenantCommercialCapacity("ent-w6", {
      supervisorStoreDir: supervisorDir,
      agentRunRegistry: registryPath,
      subscriptions: subsPath,
      runtimeSnapshots: runtimePath,
    });
    expect(capacity.inFlightSupervisorTasks).toBe(1);
    expect(capacity.activeCommercialRuns).toBe(1);
    expect(capacity.combinedConcurrentUsage).toBe(2);
    expect(capacity.totalSupervisorSpentCostUsd).toBeCloseTo(0.3);
    expect(capacity.allowed).toBe(false);
    expect(capacity.reason).toContain("已满");

    await expect(
      assertSupervisorTenantCommercialCapacity("ent-w6", {
        supervisorStoreDir: supervisorDir,
        agentRunRegistry: registryPath,
        subscriptions: subsPath,
        runtimeSnapshots: runtimePath,
      }),
    ).rejects.toThrow(/已满/);
  });
});
