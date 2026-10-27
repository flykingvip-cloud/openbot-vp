import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../config/config.js";
import {
  CHAT_TURN_CONTRACT_V1,
  resolveChatTurnCloseGates,
  resolveTurnTaskContract,
} from "./chat-entry.js";
import {
  drainAllAgentsPendingGrowth,
  recoverTaskOutcomeConsumersAtGatewayBoot,
  stopTaskOutcomeRuntimeDrainForTests,
} from "./consumer-boot.js";
import { ChatTaskOutcomeAdapter } from "./entrypoints/chat.js";
import {
  clearAwaitingDeliveriesForTests,
  peekAwaitingDelivery,
  registerAwaitingDelivery,
  resolveAndTakeAwaitingDelivery,
} from "./pending-delivery.js";
import { TaskOutcomeResultService } from "./result-service.js";
import {
  confirmRunnerTurnDelivery,
  recordRunnerTurnOutcome,
  TASK_OUTCOME_STORE_DIRNAME,
} from "./runtime-from-runner.js";
import { DurableTaskOutcomeStore } from "./store.js";
import type { TrustedScope } from "./types.js";

const scope: TrustedScope = {
  kind: "personal",
  personalDomainId: "personal:boot",
  subjectRef: "u",
  authzScopeRef: "s",
};

describe("task-outcome consumer boot / runtime drain", () => {
  let agentDir = "";
  let storeRoot = "";
  let cfg: OpenBotConfig;

  beforeEach(() => {
    agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "to-boot-"));
    storeRoot = path.join(agentDir, TASK_OUTCOME_STORE_DIRNAME);
    cfg = { agents: { list: [{ id: "bot", agentDir }] } } as unknown as OpenBotConfig;
    clearAwaitingDeliveriesForTests();
  });

  afterEach(() => {
    stopTaskOutcomeRuntimeDrainForTests();
    clearAwaitingDeliveriesForTests(storeRoot);
    fs.rmSync(agentDir, { recursive: true, force: true });
  });

  it("drains pending outbox without a subsequent user turn", async () => {
    const store = new DurableTaskOutcomeStore(storeRoot);
    const service = new TaskOutcomeResultService({ store, submittedBy: "t" });
    const chat = new ChatTaskOutcomeAdapter(service);
    const opened = chat.createOrRestore({
      taskId: "boot-1",
      scope,
      taskContractVersion: "1",
    });
    if (!opened.ok) {
      throw new Error("open");
    }
    let r = chat.recordAttempt(
      "boot-1",
      opened.record.outcomeVersion,
      opened.fencingToken,
      {
        attemptId: "a1",
        runId: "r1",
        status: "succeeded",
        observedAt: new Date().toISOString(),
      },
      {
        runId: "r1",
        attemptIds: ["a1"],
        effectiveAttemptId: "a1",
        fencingToken: opened.fencingToken,
        status: "succeeded",
      },
      { scope },
    );
    if (!r.ok) {
      throw new Error(r.code);
    }
    r = chat.setAcceptance(
      "boot-1",
      r.record.outcomeVersion,
      opened.fencingToken,
      { status: "not_required", reason: "t" },
      { allowRetry: true, scope },
    );
    if (!r.ok) {
      throw new Error(r.code);
    }
    r = chat.setDelivery(
      "boot-1",
      r.record.outcomeVersion,
      opened.fencingToken,
      { status: "not_required", reason: "t" },
      "d",
      { scope },
    );
    if (!r.ok) {
      throw new Error(r.code);
    }
    expect(store.listPendingOutbox().length).toBeGreaterThan(0);

    const boot = await recoverTaskOutcomeConsumersAtGatewayBoot({
      cfg,
      startRuntimeDrain: false,
    });
    expect(boot.agentsScanned).toBe(1);
    expect(boot.hydrated).toBe(0);
    expect(boot.processed).toBeGreaterThan(0);
    expect(store.listPendingOutbox()).toHaveLength(0);

    // Second drain is a no-op without new events (proves independent of user messages).
    const again = await drainAllAgentsPendingGrowth(cfg);
    expect(again.processed).toBe(0);
  });

  it("boot hydrates awaiting deliveries so deliveryId lookup works without runId or persistRoot", async () => {
    const runId = "boot-run-hydrate";
    const taskId = "chat:bot:sess:boot-run-hydrate";
    const deliveryId = "delivery:boot-run-hydrate:visible";

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
    expect(fs.existsSync(path.join(storeRoot, "pending-deliveries"))).toBe(true);

    // Simulate process restart: memory wiped; durable file remains.
    clearAwaitingDeliveriesForTests();
    expect(peekAwaitingDelivery(runId)).toBeUndefined();
    // Without persistRoot, lazy disk read cannot run — proves we need boot hydrate.
    expect(peekAwaitingDelivery({ deliveryId })).toBeUndefined();

    const boot = await recoverTaskOutcomeConsumersAtGatewayBoot({
      cfg,
      startRuntimeDrain: false,
    });
    expect(boot.agentsScanned).toBe(1);
    expect(boot.hydrated).toBeGreaterThanOrEqual(1);

    // After boot: deliveryId-only (no runId, no persistRoot) hits memory index.
    const pending = peekAwaitingDelivery({ deliveryId });
    expect(pending?.taskId).toBe(taskId);
    expect(pending?.runId).toBe(runId);
    expect(pending?.deliveryId).toBe(deliveryId);

    // runId-only also works from memory after hydrate.
    expect(peekAwaitingDelivery(runId)?.taskId).toBe(taskId);

    // Confirm can close using ids recovered from hydrated memory (caller omitted runId).
    const confirmed = await confirmRunnerTurnDelivery(cfg, "bot", {
      taskId: pending!.taskId,
      deliveryId: pending!.deliveryId,
      status: "delivered",
      scope,
    });
    resolveAndTakeAwaitingDelivery({
      runId: pending!.runId,
      deliveryId: pending!.deliveryId,
      persistRoot: storeRoot,
    });
    expect(confirmed.record.lifecycle).toBe("closed");
    expect(confirmed.record.taskJudgement).toBe("success");
  });
});
