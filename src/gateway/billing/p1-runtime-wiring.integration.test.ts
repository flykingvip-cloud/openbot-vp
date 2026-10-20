// @vitest-environment node
/**
 * P1 主链集成测试 — 覆盖验收口径中的 4 条缺口：
 * 1. 席位 profile.maxConcurrentRuns 接入 authorizeCommercialRun
 * 2. seat/bot 变更后 OverAllocation 刷新
 * 3. seats.set-role 隐式 profile 升档守卫
 * 4. （UI 契约见 overview-governance.browser.test.ts）
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_OVERAGE_POLICY } from "../package-entitlement/normalize-entitlement.js";

const tmpDir = path.join(os.tmpdir(), `openbot-p1-wiring-${Date.now()}`);

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return { ...actual, CONFIG_DIR: tmpDir };
});

vi.mock("../billing/scope.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../billing/scope.js")>();
  return {
    ...actual,
    resolveBillingScope: vi.fn(async () => ({
      enterpriseId: "ent-p1",
      user: { id: "u1@corp.test" },
      membership: null,
      isEnterpriseAdmin: true,
      permissions: new Set([actual.USAGE_BUDGET_PERMISSION]),
    })),
  };
});

async function seedSubscription(opts?: { maxBots?: number; maxConcurrentRuns?: number }) {
  const { createPlan } = await import("./plans-store.js");
  const { createSubscription } = await import("./subscriptions-store.js");
  const { upsertPlanEntitlementSnapshot } =
    await import("../package-entitlement/plan-version-entitlement-store.js");
  const { materializeSubscriptionRuntimeSnapshot } =
    await import("./subscription-transition-engine.js");

  const plan = await createPlan({
    name: "P1 Plan",
    billingCycle: "monthly",
    basePriceCents: 1000,
    seatQuota: { viewer: 10 },
    botQuota: opts?.maxBots ?? 1,
    pricing: [],
    createdByUserId: "tester",
  });
  await upsertPlanEntitlementSnapshot({
    planVersionId: plan.currentVersionId,
    monthlyPriceCents: 1000,
    monthlyCredits: 100,
    maxBots: opts?.maxBots ?? 1,
    maxConcurrentRuns: opts?.maxConcurrentRuns ?? 10,
    overagePolicy: DEFAULT_OVERAGE_POLICY,
  });
  const sub = await createSubscription({
    enterpriseId: "ent-p1",
    planId: plan.id,
    planVersionId: plan.currentVersionId,
  });
  await materializeSubscriptionRuntimeSnapshot({
    enterpriseId: "ent-p1",
    subscription: sub,
  });
}

describe("P1 commercial runtime wiring", () => {
  beforeEach(async () => {
    await fs.mkdir(tmpDir, { recursive: true });
    const { __resetAgentRunRegistryForTest } = await import("./agent-run-registry.js");
    const { __resetOverAllocationForTest } = await import("./over-allocation-store.js");
    const { __resetSeatsForTest } = await import("./seats-store.js");
    const { __resetBotResourcesForTest } = await import("./bot-resources-store.js");
    const { __resetSubscriptionsForTest } = await import("./subscriptions-store.js");
    const { __resetSubscriptionRuntimeSnapshotsForTest } =
      await import("./subscription-runtime-snapshots-store.js");
    await __resetAgentRunRegistryForTest();
    await __resetOverAllocationForTest();
    await __resetSeatsForTest();
    await __resetBotResourcesForTest();
    await __resetSubscriptionsForTest();
    await __resetSubscriptionRuntimeSnapshotsForTest();
  });

  afterEach(async () => {
    const entries = await fs.readdir(tmpDir).catch(() => []);
    await Promise.all(
      entries.map((entry) => fs.rm(path.join(tmpDir, entry), { recursive: true, force: true })),
    );
  });

  it("enforces basic_ai seat concurrency even when tenant allows more", async () => {
    await seedSubscription({ maxConcurrentRuns: 10 });
    const { assignSeat } = await import("./seats-store.js");
    const { upsertSeatEntitlementAssignment } =
      await import("./seat-entitlement-assignments-store.js");
    const { authorizeCommercialRun } = await import("./authorize-commercial-run.js");

    const seat = await assignSeat({
      enterpriseId: "ent-p1",
      userId: "u1@corp.test",
      role: "viewer",
      botQuota: 0,
    });
    await upsertSeatEntitlementAssignment({
      enterpriseId: "ent-p1",
      seatId: seat.id,
      profileId: "basic_ai",
    });

    const first = await authorizeCommercialRun({
      runId: "run-seat-1",
      enterpriseId: "ent-p1",
      userId: "u1@corp.test",
      action: "agent_run",
    });
    expect(first.allowed).toBe(true);

    const second = await authorizeCommercialRun({
      runId: "run-seat-2",
      enterpriseId: "ent-p1",
      userId: "u1@corp.test",
      action: "agent_run",
    });
    expect(second.allowed).toBe(false);
    if (!second.allowed && !second.skipped) {
      expect(second.reason).toBe("SEAT_CONCURRENCY_LIMIT_EXCEEDED");
    }
  });

  it("refreshes over-allocation after bots exceed maxBots", async () => {
    await seedSubscription({ maxBots: 1 });
    const { createBot } = await import("./bot-resources-store.js");
    const { refreshEnterpriseOverAllocationIfSubscribed } =
      await import("./refresh-enterprise-over-allocation.js");
    const { getOverAllocationState } = await import("./over-allocation-store.js");

    await createBot("ent-p1", "u1@corp.test");
    await createBot("ent-p1", "u2@corp.test");
    await refreshEnterpriseOverAllocationIfSubscribed("ent-p1");

    const state = await getOverAllocationState("ent-p1");
    expect(state?.status).toBe("over_allocated");
    expect(state?.botsOver).toBe(1);
    expect(state?.blockedActions).toContain("create_bot");
  });

  it("blocks implicit profile upgrade on set-role when over-allocated", async () => {
    await seedSubscription({ maxBots: 1 });
    const { assignSeat } = await import("./seats-store.js");
    const { upsertOverAllocationState } = await import("./over-allocation-store.js");
    const { seatsHandlers } = await import("../server-methods/seats.js");

    const seat = await assignSeat({
      enterpriseId: "ent-p1",
      userId: "u1@corp.test",
      role: "viewer",
      botQuota: 0,
    });
    await upsertOverAllocationState({
      enterpriseId: "ent-p1",
      subscriptionSnapshotId: "srs-test",
      status: "over_allocated",
      seatsOver: 0,
      botsOver: 1,
      seatProfilesOver: 0,
      privateModelsOver: 0,
      workflowsOver: 0,
      blockedActions: ["upgrade_seat_profile"],
      detectedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    let response: { ok: boolean; error?: { message?: string } } = { ok: false };
    await seatsHandlers["seats.set-role"]({
      req: {} as never,
      params: { seatId: seat.id, role: "admin" },
      client: { user: "admin@corp.test" } as never,
      isWebchatConnect: () => false,
      respond: (ok, _payload, err) => {
        response = { ok, ...(err ? { error: err as { message?: string } } : {}) };
      },
      context: {} as never,
    });

    expect(response.ok).toBe(false);
    expect(response.error?.message).toContain("无法升级席位 AI 档位");
  });

  it("resolves billing seat from modelGateInput.gatewayClientUser for seat concurrency", async () => {
    await seedSubscription({ maxConcurrentRuns: 10 });
    const { assignSeat } = await import("./seats-store.js");
    const { upsertSeatEntitlementAssignment } =
      await import("./seat-entitlement-assignments-store.js");
    const { authorizeCommercialRun } = await import("./authorize-commercial-run.js");

    const seat = await assignSeat({
      enterpriseId: "ent-p1",
      userId: "u1@corp.test",
      role: "viewer",
      botQuota: 0,
    });
    await upsertSeatEntitlementAssignment({
      enterpriseId: "ent-p1",
      seatId: seat.id,
      profileId: "basic_ai",
    });

    const first = await authorizeCommercialRun({
      runId: "run-gw-1",
      enterpriseId: "ent-p1",
      action: "agent_run",
      modelGateInput: { cfg: undefined, gatewayClientUser: "u1@corp.test" },
    });
    expect(first.allowed).toBe(true);

    const second = await authorizeCommercialRun({
      runId: "run-gw-2",
      enterpriseId: "ent-p1",
      action: "agent_run",
      modelGateInput: { cfg: undefined, gatewayClientUser: "u1@corp.test" },
    });
    expect(second.allowed).toBe(false);
    if (!second.allowed && !second.skipped) {
      expect(second.reason).toBe("SEAT_CONCURRENCY_LIMIT_EXCEEDED");
    }
  });
});
