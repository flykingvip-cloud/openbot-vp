// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { upsertPlanEntitlementSnapshot } from "../package-entitlement/plan-version-entitlement-store.js";
import { createBot } from "./bot-resources-store.js";
import { __resetBotResourcesForTest } from "./bot-resources-store.js";
import { refreshOverAllocationState } from "./compute-over-allocation.js";
import { getOverAllocationState, __resetOverAllocationForTest } from "./over-allocation-store.js";
import { createPlan } from "./plans-store.js";
import { __resetSeatsForTest } from "./seats-store.js";
import { __resetSubscriptionRuntimeSnapshotsForTest } from "./subscription-runtime-snapshots-store.js";
import { materializeSubscriptionRuntimeSnapshot } from "./subscription-transition-engine.js";
import { createSubscription } from "./subscriptions-store.js";

async function tempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "openbot-oa-"));
}

describe("over-allocation", () => {
  let dir: string;

  afterEach(async () => {
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("marks over_allocated when bots exceed snapshot maxBots", async () => {
    dir = await tempDir();
    const plansPath = path.join(dir, "plans.json");
    const subsPath = path.join(dir, "subs.json");
    const entPath = path.join(dir, "ent.json");
    const runtimePath = path.join(dir, "runtime.json");
    const botsPath = path.join(dir, "bots.json");
    const seatsPath = path.join(dir, "seats.json");
    const oaPath = path.join(dir, "oa.json");

    await __resetOverAllocationForTest(oaPath);
    await __resetBotResourcesForTest(botsPath);
    await __resetSeatsForTest(seatsPath);
    await __resetSubscriptionRuntimeSnapshotsForTest(runtimePath);

    const plan = await createPlan(
      {
        name: "Small",
        billingCycle: "monthly",
        basePriceCents: 1000,
        seatQuota: { creator: 5 },
        botQuota: 1,
        pricing: [],
        createdByUserId: "test",
      },
      plansPath,
    );
    await upsertPlanEntitlementSnapshot(
      {
        planVersionId: plan.currentVersionId,
        monthlyPriceCents: 1000,
        monthlyCredits: 100,
        maxBots: 1,
        maxConcurrentRuns: 1,
      },
      entPath,
    );
    const sub = await createSubscription(
      {
        enterpriseId: "ent-oa",
        planId: plan.id,
        planVersionId: plan.currentVersionId,
      },
      subsPath,
    );
    const snapshot = await materializeSubscriptionRuntimeSnapshot({
      enterpriseId: "ent-oa",
      subscription: sub,
      storePaths: { plans: plansPath, entitlementSnapshot: entPath, runtimeSnapshots: runtimePath },
    });

    await createBot("ent-oa", "u1", { storePath: botsPath });
    await createBot("ent-oa", "u2", { storePath: botsPath });

    await refreshOverAllocationState({
      enterpriseId: "ent-oa",
      snapshot,
      storePaths: { bots: botsPath, seats: seatsPath, overAllocation: oaPath },
    });

    const state = await getOverAllocationState("ent-oa", oaPath);
    expect(state?.status).toBe("over_allocated");
    expect(state?.botsOver).toBe(1);
    expect(state?.blockedActions).toContain("create_bot");
  });
});
