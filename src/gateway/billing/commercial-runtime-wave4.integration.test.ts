// @vitest-environment node
/**
 * Wave 4 E2E — ownerSeatId 归属链 + Bot 交接后授权席位切换。
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_OVERAGE_POLICY } from "../package-entitlement/normalize-entitlement.js";
import { upsertPlanEntitlementSnapshot } from "../package-entitlement/plan-version-entitlement-store.js";
import { authorizeCommercialRun } from "./authorize-commercial-run.js";
import {
  __resetBotResourcesForTest,
  createBot,
  updateBotGovernance,
} from "./bot-resources-store.js";
import { createPlan } from "./plans-store.js";
import { upsertSeatEntitlementAssignment } from "./seat-entitlement-assignments-store.js";
import { assignSeat, __resetSeatsForTest } from "./seats-store.js";
import { materializeSubscriptionRuntimeSnapshot } from "./subscription-transition-engine.js";
import { createSubscription } from "./subscriptions-store.js";

async function tempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "openbot-w4-e2e-"));
}

describe("commercial runtime wave4 E2E", () => {
  let dir: string;

  afterEach(async () => {
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("uses transferred ownerSeatId for agent_run seat concurrency", async () => {
    dir = await tempDir();
    const enterpriseId = "ent-w4";
    const plansPath = path.join(dir, "plans.json");
    const subsPath = path.join(dir, "subs.json");
    const entitlementPath = path.join(dir, "entitlement.json");
    const seatsPath = path.join(dir, "seats.json");
    const botsPath = path.join(dir, "bots.json");
    const seatAssignmentsPath = path.join(dir, "seat-assignments.json");
    const runtimePath = path.join(dir, "runtime.json");

    await __resetSeatsForTest(seatsPath);
    await __resetBotResourcesForTest(botsPath);

    const plan = await createPlan(
      {
        name: "Wave4",
        billingCycle: "monthly",
        basePriceCents: 1000,
        seatQuota: { viewer: 10 },
        botQuota: 5,
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
        maxBots: 5,
        maxConcurrentRuns: 10,
        overagePolicy: DEFAULT_OVERAGE_POLICY,
      },
      entitlementPath,
    );
    const sub = await createSubscription(
      {
        enterpriseId,
        planId: plan.id,
        planVersionId: plan.currentVersionId,
        resolvedFromPlanId: true,
      },
      subsPath,
    );
    await materializeSubscriptionRuntimeSnapshot({
      enterpriseId,
      subscription: sub,
      storePaths: {
        plans: plansPath,
        entitlementSnapshot: entitlementPath,
        modelBinding: path.join(dir, "binding.json"),
        runtimeSnapshots: runtimePath,
      },
    });

    const seatA = await assignSeat(
      { enterpriseId, userId: "user-a", role: "viewer", botQuota: 1 },
      seatsPath,
    );
    const seatB = await assignSeat(
      { enterpriseId, userId: "user-b", role: "viewer", botQuota: 1 },
      seatsPath,
    );
    await upsertSeatEntitlementAssignment(
      {
        enterpriseId,
        seatId: seatA.id,
        profileId: "basic_ai",
      },
      seatAssignmentsPath,
    );
    await upsertSeatEntitlementAssignment(
      {
        enterpriseId,
        seatId: seatB.id,
        profileId: "basic_ai",
      },
      seatAssignmentsPath,
    );

    const bot = await createBot(enterpriseId, "user-a", {
      ownerSeatId: seatA.id,
      visibility: "team",
      storePath: botsPath,
    });

    const storePaths = {
      subscriptions: subsPath,
      plans: plansPath,
      entitlementSnapshot: entitlementPath,
      runtimeSnapshots: runtimePath,
      seats: seatsPath,
      botResources: botsPath,
      seatEntitlementAssignments: seatAssignmentsPath,
    };

    const first = await authorizeCommercialRun({
      runId: "run-bot-a",
      enterpriseId,
      botId: bot.id,
      action: "agent_run",
      storePaths,
    });
    expect(first.allowed).toBe(true);

    const blocked = await authorizeCommercialRun({
      runId: "run-bot-a-2",
      enterpriseId,
      botId: bot.id,
      action: "agent_run",
      storePaths,
    });
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed && !blocked.skipped) {
      expect(blocked.reason).toBe("SEAT_CONCURRENCY_LIMIT_EXCEEDED");
    }

    await updateBotGovernance(
      enterpriseId,
      bot.id,
      { ownerSeatId: seatB.id, visibility: "enterprise" },
      botsPath,
    );

    const afterTransfer = await authorizeCommercialRun({
      runId: "run-bot-b",
      enterpriseId,
      botId: bot.id,
      action: "agent_run",
      storePaths,
    });
    expect(afterTransfer.allowed).toBe(true);
  });
});
