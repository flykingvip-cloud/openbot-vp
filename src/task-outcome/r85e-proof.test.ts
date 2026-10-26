/**
 * R85e proof: real deliver callbacks, id threading, AND aggregation, restart recovery.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createReplyDispatcher } from "../auto-reply/reply/reply-dispatcher.js";
import type { OpenBotConfig } from "../config/config.js";
import {
  CHAT_TURN_CONTRACT_V1,
  resolveChatTurnCloseGates,
  resolveTurnTaskContract,
} from "./chat-entry.js";
import { resolveRequiredDeliveryConfirmStatus } from "./delivery-confirm.js";
import { readEffectiveEvolutionTaskOutcomes } from "./growth-bridge.js";
import {
  clearAwaitingDeliveriesForTests,
  hydrateAwaitingDeliveriesFromDisk,
  peekAwaitingDelivery,
  registerAwaitingDelivery,
  resolveAndTakeAwaitingDelivery,
} from "./pending-delivery.js";
import { confirmRunnerTurnDelivery, recordRunnerTurnOutcome } from "./runtime-from-runner.js";
import type { TrustedScope } from "./types.js";

const scope: TrustedScope = {
  kind: "personal",
  personalDomainId: "personal:u1",
  subjectRef: "u1",
  authzScopeRef: "chat-entry",
};

/**
 * Mirrors dispatch-from-config confirmPendingTurnDelivery clear rule:
 * unknown keeps association; delivered/failed take it.
 */
async function confirmLikeDispatch(params: {
  cfg: OpenBotConfig;
  agentId: string;
  lookup: { runId?: string; deliveryId?: string; taskId?: string; persistRoot?: string };
  status: "delivered" | "failed" | "delivery_unknown";
  error?: string;
}): Promise<void> {
  const pending = peekAwaitingDelivery(params.lookup);
  if (!pending) {
    return;
  }
  await confirmRunnerTurnDelivery(params.cfg, params.agentId, {
    taskId: pending.taskId,
    deliveryId: pending.deliveryId,
    status: params.status,
    scope,
    ...(params.error ? { failureDetail: params.error } : {}),
  });
  if (params.status === "delivered" || params.status === "failed") {
    resolveAndTakeAwaitingDelivery({
      runId: pending.runId,
      deliveryId: pending.deliveryId,
      taskId: pending.taskId,
      ...(params.lookup.persistRoot ? { persistRoot: params.lookup.persistRoot } : {}),
    });
  }
}

describe("R85e: deliver callback + id threading + AND + restart", () => {
  let agentDir = "";
  let storeRoot = "";
  let cfg: OpenBotConfig;

  beforeEach(() => {
    agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "r85e-agent-"));
    storeRoot = path.join(agentDir, "task-outcomes");
    cfg = { agents: { list: [{ id: "bot", agentDir }] } } as unknown as OpenBotConfig;
    clearAwaitingDeliveriesForTests(storeRoot);
  });

  afterEach(() => {
    clearAwaitingDeliveriesForTests(storeRoot);
    fs.rmSync(agentDir, { recursive: true, force: true });
  });

  describe("AND aggregation (mixed must not deliver early)", () => {
    it("deliver ok + enqueue_only ok → delivery_unknown (not delivered)", () => {
      expect(
        resolveRequiredDeliveryConfirmStatus([
          { source: "deliver", ok: true },
          { source: "enqueue_only", ok: true },
        ]),
      ).toBe("delivery_unknown");
    });

    it("unknown + deliver ok → delivery_unknown", () => {
      expect(
        resolveRequiredDeliveryConfirmStatus([
          { source: "enqueue_only", ok: true },
          { source: "deliver", ok: true },
        ]),
      ).toBe("delivery_unknown");
    });

    it("multi-required partial fail → failed", () => {
      expect(
        resolveRequiredDeliveryConfirmStatus([
          { source: "deliver", ok: true },
          { source: "deliver", ok: false, error: "b_failed" },
          { source: "enqueue_only", ok: true },
        ]),
      ).toBe("failed");
    });

    it("all actual delivers ok → delivered", () => {
      expect(
        resolveRequiredDeliveryConfirmStatus([
          { source: "deliver", ok: true },
          { source: "deliver", ok: true },
        ]),
      ).toBe("delivered");
    });
  });

  it("1) real dispatcher deliver success → can close / positive evolution", async () => {
    const runId = "run-r85e-ok";
    const deliveryId = `delivery:${runId}:visible`;
    const taskId = `chat:bot:sess:${runId}`;
    const contract = resolveTurnTaskContract({
      explicitChatTurn: true,
      contractId: CHAT_TURN_CONTRACT_V1,
    });
    const gates = resolveChatTurnCloseGates({
      deliveryId,
      contract,
      deliveryPhase: "awaiting",
    });
    await recordRunnerTurnOutcome(cfg, "bot", {
      success: true,
      runId,
      taskId,
      scope,
      acceptance: gates.acceptance,
      delivery: gates.delivery,
      deliveryId,
    });
    registerAwaitingDelivery({
      taskId,
      deliveryId,
      agentId: "bot",
      runId,
      persistRoot: storeRoot,
    });

    const delivered: string[] = [];
    const dispatcher = createReplyDispatcher({
      deliver: async (payload) => {
        delivered.push(payload.text ?? "");
      },
    });
    // Enqueue only — not yet a receipt.
    expect(dispatcher.sendFinalReply({ text: "hello-r85e" })).toBe(true);
    await confirmLikeDispatch({
      cfg,
      agentId: "bot",
      lookup: { deliveryId, persistRoot: storeRoot },
      status: "delivery_unknown",
      error: "enqueue_only_not_a_send_receipt",
    });
    // Unknown must keep association.
    expect(peekAwaitingDelivery({ deliveryId, persistRoot: storeRoot })?.taskId).toBe(taskId);

    await dispatcher.waitForIdle();
    const outcomes = dispatcher.getDeliveryOutcomes?.() ?? [];
    expect(outcomes).toEqual([{ kind: "final", ok: true }]);
    expect(delivered).toEqual(["hello-r85e"]);

    const status = resolveRequiredDeliveryConfirmStatus(
      outcomes.map((o) => ({
        source: "deliver" as const,
        ok: o.ok,
        ...(o.error ? { error: o.error } : {}),
      })),
    );
    expect(status).toBe("delivered");

    await confirmLikeDispatch({
      cfg,
      agentId: "bot",
      lookup: { deliveryId, persistRoot: storeRoot },
      status: "delivered",
    });
    expect(peekAwaitingDelivery({ deliveryId, persistRoot: storeRoot })).toBeUndefined();

    const store = new (await import("./store.js")).DurableTaskOutcomeStore(storeRoot);
    const record = store.loadTask(taskId);
    expect(record?.lifecycle).toBe("closed");
    expect(record?.taskJudgement).toBe("success");
    expect(
      readEffectiveEvolutionTaskOutcomes(cfg, "bot").some(
        (r) => r.taskId === taskId && r.succeeded,
      ),
    ).toBe(true);
  });

  it("2) real dispatcher async deliver throw → no positive sample", async () => {
    const runId = "run-r85e-fail";
    const deliveryId = `delivery:${runId}:visible`;
    const taskId = `chat:bot:sess:${runId}`;
    const contract = resolveTurnTaskContract({
      explicitChatTurn: true,
      contractId: CHAT_TURN_CONTRACT_V1,
    });
    const gates = resolveChatTurnCloseGates({
      deliveryId,
      contract,
      deliveryPhase: "awaiting",
    });
    await recordRunnerTurnOutcome(cfg, "bot", {
      success: true,
      runId,
      taskId,
      scope,
      acceptance: gates.acceptance,
      delivery: gates.delivery,
      deliveryId,
    });
    registerAwaitingDelivery({
      taskId,
      deliveryId,
      agentId: "bot",
      runId,
      persistRoot: storeRoot,
    });

    const dispatcher = createReplyDispatcher({
      deliver: async () => {
        await Promise.resolve();
        throw new Error("channel_send_boom");
      },
      onError: () => {
        // swallow like production channels
      },
    });
    expect(dispatcher.sendFinalReply({ text: "will-fail" })).toBe(true);
    await confirmLikeDispatch({
      cfg,
      agentId: "bot",
      lookup: { deliveryId, persistRoot: storeRoot },
      status: "delivery_unknown",
    });
    expect(peekAwaitingDelivery({ deliveryId, persistRoot: storeRoot })?.taskId).toBe(taskId);

    await dispatcher.waitForIdle();
    const outcomes = dispatcher.getDeliveryOutcomes?.() ?? [];
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.ok).toBe(false);
    expect(outcomes[0]?.error).toContain("channel_send_boom");

    const status = resolveRequiredDeliveryConfirmStatus(
      outcomes.map((o) => ({
        source: "deliver" as const,
        ok: o.ok,
        ...(o.error ? { error: o.error } : {}),
      })),
    );
    expect(status).toBe("failed");

    await confirmLikeDispatch({
      cfg,
      agentId: "bot",
      lookup: { deliveryId, persistRoot: storeRoot },
      status: "failed",
      error: outcomes[0]?.error,
    });

    const store = new (await import("./store.js")).DurableTaskOutcomeStore(storeRoot);
    const record = store.loadTask(taskId);
    expect(record?.taskJudgement).not.toBe("success");
    expect(record?.delivery.status).toBe("failed");
    expect(
      readEffectiveEvolutionTaskOutcomes(cfg, "bot").filter(
        (r) => r.taskId === taskId && r.succeeded,
      ),
    ).toHaveLength(0);
  });

  it("3) no runId + two parallel tasks — confirm by deliveryId does not cross-wire", async () => {
    const specs = [
      { runId: "run-a", deliveryId: "delivery:run-a:visible", taskId: "chat:bot:sess:run-a" },
      { runId: "run-b", deliveryId: "delivery:run-b:visible", taskId: "chat:bot:sess:run-b" },
    ] as const;

    for (const s of specs) {
      const contract = resolveTurnTaskContract({
        explicitChatTurn: true,
        contractId: CHAT_TURN_CONTRACT_V1,
      });
      const gates = resolveChatTurnCloseGates({
        deliveryId: s.deliveryId,
        contract,
        deliveryPhase: "awaiting",
      });
      await recordRunnerTurnOutcome(cfg, "bot", {
        success: true,
        runId: s.runId,
        taskId: s.taskId,
        scope,
        acceptance: gates.acceptance,
        delivery: gates.delivery,
        deliveryId: s.deliveryId,
      });
      registerAwaitingDelivery({
        taskId: s.taskId,
        deliveryId: s.deliveryId,
        agentId: "bot",
        runId: s.runId,
        persistRoot: storeRoot,
      });
    }

    // Caller omits runId — locate solely via deliveryId (+ persistRoot).
    const pendingA = peekAwaitingDelivery({
      deliveryId: "delivery:run-a:visible",
      persistRoot: storeRoot,
    });
    const pendingB = peekAwaitingDelivery({
      deliveryId: "delivery:run-b:visible",
      persistRoot: storeRoot,
    });
    expect(pendingA?.taskId).toBe("chat:bot:sess:run-a");
    expect(pendingB?.taskId).toBe("chat:bot:sess:run-b");
    expect(pendingA?.runId).toBe("run-a");
    expect(pendingB?.runId).toBe("run-b");

    await confirmLikeDispatch({
      cfg,
      agentId: "bot",
      lookup: { deliveryId: "delivery:run-a:visible", persistRoot: storeRoot },
      status: "delivered",
    });
    // B untouched.
    expect(
      peekAwaitingDelivery({ deliveryId: "delivery:run-b:visible", persistRoot: storeRoot })
        ?.taskId,
    ).toBe("chat:bot:sess:run-b");

    const store = new (await import("./store.js")).DurableTaskOutcomeStore(storeRoot);
    expect(store.loadTask("chat:bot:sess:run-a")?.taskJudgement).toBe("success");
    expect(store.loadTask("chat:bot:sess:run-b")?.lifecycle).toBe("awaiting_delivery");
  });

  it("4) restart: unknown keeps durable intent; hydrate then verify to delivered", async () => {
    const runId = "run-r85e-restart";
    const deliveryId = `delivery:${runId}:visible`;
    const taskId = `chat:bot:sess:${runId}`;
    const contract = resolveTurnTaskContract({
      explicitChatTurn: true,
      contractId: CHAT_TURN_CONTRACT_V1,
    });
    const gates = resolveChatTurnCloseGates({
      deliveryId,
      contract,
      deliveryPhase: "awaiting",
    });
    await recordRunnerTurnOutcome(cfg, "bot", {
      success: true,
      runId,
      taskId,
      scope,
      acceptance: gates.acceptance,
      delivery: gates.delivery,
      deliveryId,
    });
    registerAwaitingDelivery({
      taskId,
      deliveryId,
      agentId: "bot",
      runId,
      persistRoot: storeRoot,
    });

    // Enqueue phase → unknown, association retained.
    await confirmLikeDispatch({
      cfg,
      agentId: "bot",
      lookup: { runId, persistRoot: storeRoot },
      status: "delivery_unknown",
    });
    expect(peekAwaitingDelivery({ runId, persistRoot: storeRoot })?.deliveryId).toBe(deliveryId);

    // Process crash: memory wiped, durable file remains.
    clearAwaitingDeliveriesForTests(); // memory only — do not wipe disk
    expect(peekAwaitingDelivery(runId)).toBeUndefined();
    // Disk file still there (clearAwaitingDeliveriesForTests() without root only clears memory).
    expect(fs.existsSync(path.join(storeRoot, "pending-deliveries"))).toBe(true);

    const hydrated = hydrateAwaitingDeliveriesFromDisk(storeRoot);
    expect(hydrated).toBeGreaterThanOrEqual(1);

    // No runId — recover via deliveryId.
    const pending = peekAwaitingDelivery({ deliveryId, persistRoot: storeRoot });
    expect(pending?.taskId).toBe(taskId);

    await confirmLikeDispatch({
      cfg,
      agentId: "bot",
      lookup: { deliveryId, persistRoot: storeRoot },
      status: "delivered",
    });

    const store = new (await import("./store.js")).DurableTaskOutcomeStore(storeRoot);
    const record = store.loadTask(taskId);
    expect(record?.lifecycle).toBe("closed");
    expect(record?.taskJudgement).toBe("success");
    expect(record?.delivery.status).toBe("delivered");
    expect(peekAwaitingDelivery({ deliveryId, persistRoot: storeRoot })).toBeUndefined();
  });
});
