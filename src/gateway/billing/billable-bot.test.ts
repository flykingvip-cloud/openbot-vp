// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authorizeCommercialRunMock = vi.fn();
const findBillingSeatByUserIdMock = vi.fn();
const publishMock = vi.fn(async (..._args: unknown[]) => ({}));
const refreshMock = vi.fn(async (..._args: unknown[]) => null);

vi.mock("./authorize-commercial-run.js", () => ({
  authorizeCommercialRun: (...args: unknown[]) => authorizeCommercialRunMock(...args),
}));

vi.mock("./seats-store.js", () => ({
  findBillingSeatByUserId: (...args: unknown[]) => findBillingSeatByUserIdMock(...args),
}));

vi.mock("./event-bus.js", () => ({
  billingEventBus: { publish: (...args: unknown[]) => publishMock(...args) },
}));

vi.mock("./refresh-enterprise-over-allocation.js", () => ({
  refreshEnterpriseOverAllocationIfSubscribed: (...args: unknown[]) => refreshMock(...args),
}));

const {
  authorizeBillableBotCreate,
  registerBillableBot,
  publishBillableBotChanged,
  releaseBillableBotForAgent,
} = await import("./billable-bot.js");
const { __resetBotResourcesForTest, countActiveBots, botCountsByUser, setUserBotLimit } =
  await import("./bot-resources-store.js");

async function tempStore(): Promise<{ path: string; dir: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-billable-bot-"));
  return { dir, path: path.join(dir, "bots.json") };
}

describe("billable-bot helper", () => {
  let storePath: string;
  let dir: string;

  beforeEach(async () => {
    authorizeCommercialRunMock.mockReset();
    findBillingSeatByUserIdMock.mockReset();
    publishMock.mockReset();
    refreshMock.mockReset();
    authorizeCommercialRunMock.mockResolvedValue({
      allowed: true,
      skipped: false,
      authorizationDecisionId: "auth-1",
      enterpriseId: "ent-1",
      subscriptionId: "sub-1",
      planId: "plan-1",
      planVersionId: "pv-1",
      subscriptionSnapshotId: "snap-1",
      policyDecision: { allowed: true },
      creditDecision: { allowed: true, creditsRemaining: 100, billingMode: "prepaid" },
      concurrencyDecision: { allowed: true },
      slotAcquired: false,
    });
    findBillingSeatByUserIdMock.mockResolvedValue({ id: "billing-seat-1" });
    publishMock.mockResolvedValue({});
    refreshMock.mockResolvedValue(null);
    ({ path: storePath, dir } = await tempStore());
    await __resetBotResourcesForTest(storePath);
  });

  afterEach(async () => {
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("denies when commercial gate rejects bot_create", async () => {
    authorizeCommercialRunMock.mockResolvedValue({
      allowed: false,
      skipped: false,
      authorizationDecisionId: "auth-deny",
      enterpriseId: "ent-1",
      reason: "NO_SUBSCRIPTION",
      message: "当前企业没有生效订阅，无法执行该操作。请先订阅或续费。",
      policyDecision: { allowed: true },
    });
    const gate = await authorizeBillableBotCreate({
      enterpriseId: "ent-1",
      ownerUserId: "user-a",
      sourceAgentId: "agent-a",
      storePaths: { bots: storePath },
    });
    expect(gate.allowed).toBe(false);
    if (!gate.allowed) {
      expect(gate.message).toContain("没有生效订阅");
    }
    expect(authorizeCommercialRunMock).toHaveBeenCalledWith(
      expect.objectContaining({ enterpriseId: "ent-1", action: "bot_create" }),
    );
  });

  it("denies when user bot limit is reached", async () => {
    await setUserBotLimit("ent-1", "user-a", 1, storePath);
    await registerBillableBot({
      enterpriseId: "ent-1",
      ownerUserId: "user-a",
      sourceAgentId: "agent-first",
      storePaths: { bots: storePath },
    });
    const gate = await authorizeBillableBotCreate({
      enterpriseId: "ent-1",
      ownerUserId: "user-a",
      sourceAgentId: "agent-second",
      storePaths: { bots: storePath },
    });
    expect(gate.allowed).toBe(false);
    if (!gate.allowed) {
      expect(gate.message).toContain("上限");
    }
  });

  it("registers billable bot with ownerSeatId and increments perUser counts", async () => {
    const gate = await authorizeBillableBotCreate({
      enterpriseId: "ent-1",
      ownerUserId: "user-a",
      sourceAgentId: "agent-dh-1",
      storePaths: { bots: storePath },
    });
    expect(gate.allowed).toBe(true);

    const { bot, created } = await registerBillableBot({
      enterpriseId: "ent-1",
      ownerUserId: "user-a",
      sourceAgentId: "agent-dh-1",
      storePaths: { bots: storePath, seats: "ignored" },
    });
    expect(created).toBe(true);
    expect(bot.sourceAgentId).toBe("agent-dh-1");
    expect(bot.ownerSeatId).toBe("billing-seat-1");
    expect(await countActiveBots("ent-1", storePath)).toBe(1);
    expect(await botCountsByUser("ent-1", storePath)).toEqual({ "user-a": 1 });

    await publishBillableBotChanged({ enterpriseId: "ent-1", bot, action: "created" });
    expect(publishMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "bot.changed",
        enterpriseId: "ent-1",
        botId: bot.id,
        action: "created",
      }),
    );
    expect(refreshMock).toHaveBeenCalledWith("ent-1");
  });

  it("is idempotent for the same sourceAgentId and skips commercial gate on retry", async () => {
    await registerBillableBot({
      enterpriseId: "ent-1",
      ownerUserId: "user-a",
      sourceAgentId: "agent-dh-1",
      storePaths: { bots: storePath },
    });
    authorizeCommercialRunMock.mockClear();

    const gate = await authorizeBillableBotCreate({
      enterpriseId: "ent-1",
      ownerUserId: "user-a",
      sourceAgentId: "agent-dh-1",
      storePaths: { bots: storePath },
    });
    expect(gate.allowed).toBe(true);
    if (gate.allowed) {
      expect(gate.existing?.sourceAgentId).toBe("agent-dh-1");
    }
    expect(authorizeCommercialRunMock).not.toHaveBeenCalled();

    const again = await registerBillableBot({
      enterpriseId: "ent-1",
      ownerUserId: "user-a",
      sourceAgentId: "agent-dh-1",
      storePaths: { bots: storePath },
    });
    expect(again.created).toBe(false);
    expect(await countActiveBots("ent-1", storePath)).toBe(1);
  });

  it("soft-deletes the billable bot on agent release", async () => {
    const { bot } = await registerBillableBot({
      enterpriseId: "ent-1",
      ownerUserId: "user-a",
      sourceAgentId: "agent-dh-1",
      storePaths: { bots: storePath },
    });
    const deleted = await releaseBillableBotForAgent({
      enterpriseId: "ent-1",
      agentId: "agent-dh-1",
      storePaths: { bots: storePath },
    });
    expect(deleted?.id).toBe(bot.id);
    expect(deleted?.deletedAt).toBeTruthy();
    expect(await countActiveBots("ent-1", storePath)).toBe(0);
    expect(publishMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: "bot.changed", action: "deleted", botId: bot.id }),
    );
  });
});
