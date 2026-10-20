// @vitest-environment node
/**
 * P2 主链集成 — Concurrency queue 经 authorizeCommercialRun 接线。
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_OVERAGE_POLICY } from "../package-entitlement/normalize-entitlement.js";

const tmpDir = path.join(os.tmpdir(), `openbot-p2-wiring-${Date.now()}`);

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return { ...actual, CONFIG_DIR: tmpDir };
});

async function seedQueueSubscription() {
  const { createPlan } = await import("./plans-store.js");
  const { createSubscription } = await import("./subscriptions-store.js");
  const { upsertPlanEntitlementSnapshot } =
    await import("../package-entitlement/plan-version-entitlement-store.js");
  const { appendSubscriptionRuntimeSnapshot } =
    await import("./subscription-runtime-snapshots-store.js");
  const { materializeSubscriptionRuntimeSnapshot } =
    await import("./subscription-transition-engine.js");

  const plan = await createPlan({
    name: "P2 Queue Plan",
    billingCycle: "monthly",
    basePriceCents: 1000,
    seatQuota: { viewer: 10 },
    botQuota: 5,
    pricing: [],
    createdByUserId: "tester",
  });
  await upsertPlanEntitlementSnapshot({
    planVersionId: plan.currentVersionId,
    monthlyPriceCents: 1000,
    monthlyCredits: 100,
    maxBots: 5,
    maxConcurrentRuns: 1,
    overagePolicy: { ...DEFAULT_OVERAGE_POLICY, allowBurstConcurrency: true },
  });
  const sub = await createSubscription({
    enterpriseId: "ent-p2",
    planId: plan.id,
    planVersionId: plan.currentVersionId,
  });
  const base = await materializeSubscriptionRuntimeSnapshot({
    enterpriseId: "ent-p2",
    subscription: sub,
  });
  await appendSubscriptionRuntimeSnapshot({
    enterpriseId: "ent-p2",
    subscriptionId: sub.id,
    planId: plan.id,
    planVersionId: plan.currentVersionId,
    pricingSnapshot: base.pricingSnapshot,
    modelBindingSnapshot: base.modelBindingSnapshot,
    billingMode: base.billingMode,
    entitlementSnapshot: {
      ...base.entitlementSnapshot,
      maxConcurrentRuns: 1,
      concurrencyPolicy: {
        includedRuns: 1,
        maxBurstRuns: 1,
        mode: "queue",
      },
      overagePolicy: { ...DEFAULT_OVERAGE_POLICY, allowBurstConcurrency: true },
    },
  });
}

describe("P2 commercial runtime wiring", () => {
  beforeEach(async () => {
    await fs.mkdir(tmpDir, { recursive: true });
    const { __resetAgentRunRegistryForTest } = await import("./agent-run-registry.js");
    const { __resetAgentRunQueueForTest } = await import("./agent-run-queue.js");
    const { __resetSubscriptionsForTest } = await import("./subscriptions-store.js");
    const { __resetSubscriptionRuntimeSnapshotsForTest } =
      await import("./subscription-runtime-snapshots-store.js");
    await __resetAgentRunRegistryForTest();
    await __resetAgentRunQueueForTest();
    await __resetSubscriptionsForTest();
    await __resetSubscriptionRuntimeSnapshotsForTest();
  });

  afterEach(async () => {
    const entries = await fs.readdir(tmpDir).catch(() => []);
    await Promise.all(
      entries.map((entry) => fs.rm(path.join(tmpDir, entry), { recursive: true, force: true })),
    );
  });

  it("authorizeCommercialRun queue mode grants second run after first releases", async () => {
    await seedQueueSubscription();
    const { authorizeCommercialRun, releaseCommercialRunSlot } =
      await import("./authorize-commercial-run.js");

    const first = await authorizeCommercialRun({
      runId: "p2-run-1",
      enterpriseId: "ent-p2",
      action: "agent_run",
    });
    expect(first.allowed).toBe(true);

    const waitPromise = authorizeCommercialRun({
      runId: "p2-run-2",
      enterpriseId: "ent-p2",
      action: "agent_run",
    });

    await new Promise((r) => setTimeout(r, 50));
    await releaseCommercialRunSlot("p2-run-1");

    const second = await waitPromise;
    expect(second.allowed).toBe(true);
  });
});
