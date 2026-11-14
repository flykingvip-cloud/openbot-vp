import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { confirmPendingTurnDeliveryWithPorts } from "../agent-runtime/delivery/dispatch/confirm-pending.js";
import { prepareVisibleDelivery } from "../agent-runtime/delivery/dispatch/prepare-visible.js";
import { markAsyncWaitRecoveryDelivered } from "../agent-runtime/state/index.js";
import type { OpenBotConfig } from "../config/config.js";
import {
  emptySessionTaskBoard,
  mutateSessionTaskBoard,
  readSessionTaskBoard,
  recordCheckedTaskCompletion,
  isTaskExecutionBindingCurrent,
  cancelCurrentTask,
} from "../conversation-task/session-task-board.js";
import { CHAT_TURN_CONTRACT_V1, resolveTurnTaskContract } from "./chat-entry.js";
import {
  recoverTaskOutcomeConsumersAtGatewayBoot,
  stopTaskOutcomeRuntimeDrainForTests,
} from "./consumer-boot.js";
import { OutcomeConsumerRuntime } from "./consumers.js";
import { ChatTaskOutcomeAdapter } from "./entrypoints/chat.js";
import { clearAwaitingDeliveriesForTests, peekAwaitingDelivery } from "./pending-delivery.js";
import { TaskOutcomeResultService } from "./result-service.js";
import { recordRunnerTurnOutcome, TASK_OUTCOME_STORE_DIRNAME } from "./runtime-from-runner.js";
import { DurableTaskOutcomeStore } from "./store.js";
import type { TrustedScope } from "./types.js";

const scope: TrustedScope = {
  kind: "personal",
  personalDomainId: "personal:s4",
  subjectRef: "u",
  authzScopeRef: "s",
};

describe("S4 result persist → notify → delivery receipt", () => {
  let agentDir = "";
  let storeRoot = "";
  let cfg: OpenBotConfig;

  beforeEach(() => {
    agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "s4-loop-"));
    storeRoot = path.join(agentDir, TASK_OUTCOME_STORE_DIRNAME);
    cfg = { agents: { list: [{ id: "bot", agentDir }] } } as unknown as OpenBotConfig;
    clearAwaitingDeliveriesForTests();
  });

  afterEach(() => {
    stopTaskOutcomeRuntimeDrainForTests();
    clearAwaitingDeliveriesForTests(storeRoot);
    fs.rmSync(agentDir, { recursive: true, force: true });
  });

  it("reopens a published commit and notifies consumers after a crash before outbox", async () => {
    const store = new DurableTaskOutcomeStore(storeRoot);
    const service = new TaskOutcomeResultService({ store, submittedBy: "s4" });
    const chat = new ChatTaskOutcomeAdapter(service);
    const opened = chat.createOrRestore({
      taskId: "s4-outbox",
      scope,
      taskContractVersion: "1",
    });
    if (!opened.ok) {
      throw new Error("open");
    }
    let r = chat.recordAttempt(
      "s4-outbox",
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
      "s4-outbox",
      r.record.outcomeVersion,
      opened.fencingToken,
      { status: "not_required", reason: "s4" },
      { allowRetry: true, scope },
    );
    if (!r.ok) {
      throw new Error(r.code);
    }
    r = chat.setDelivery(
      "s4-outbox",
      r.record.outcomeVersion,
      opened.fencingToken,
      { status: "not_required", reason: "s4" },
      "d-s4",
      { scope },
    );
    if (!r.ok) {
      throw new Error(r.code);
    }
    const pending = store.listPendingOutbox();
    expect(pending.length).toBeGreaterThan(0);
    const closed = pending.find((row) => row.eventType === "task.closed");
    expect(closed).toBeDefined();
    // Crash after tip/version persist, before outbox (applied marker not written yet).
    for (const ev of pending) {
      fs.unlinkSync(path.join(storeRoot, "outbox", `${ev.eventId}.json`));
    }
    for (const name of fs.readdirSync(path.join(storeRoot, "commits-applied"))) {
      fs.unlinkSync(path.join(storeRoot, "commits-applied", name));
    }
    expect(store.loadTask("s4-outbox")?.lifecycle).toBe("closed");
    store.close();

    const recovered = new DurableTaskOutcomeStore(storeRoot);
    expect(recovered.listPendingOutbox().some((row) => row.eventType === "task.closed")).toBe(true);
    const runtime = new OutcomeConsumerRuntime(recovered);
    const first = await runtime.drain((taskId) => recovered.loadTask(taskId));
    expect(first.processed).toBeGreaterThan(0);
    expect(recovered.listPendingOutbox()).toHaveLength(0);
    const second = await runtime.drain((taskId) => recovered.loadTask(taskId));
    expect(second.processed).toBe(0);
    expect(runtime.getProjection().successCount).toBe(1);
  });

  it("recovers notify after prepare persists and crashes before awaiting-delivery registration", async () => {
    const runId = "s4-run-crash";
    const taskId = "s4-task-crash";
    const deliveryId = "delivery:s4-run-crash:visible";
    const contract = resolveTurnTaskContract({
      explicitChatTurn: true,
      contractId: CHAT_TURN_CONTRACT_V1,
    });
    const publish = async () => {
      throw new Error("publish must not run when persist notify crashes");
    };
    await expect(
      prepareVisibleDelivery({
        resolvePersistRoot: () => storeRoot,
        agentId: "bot",
        runId,
        outcomeTaskId: taskId,
        sessionKey: "agent:bot:main",
        contract,
        commitOutcome: async (_success, opts) => {
          await recordRunnerTurnOutcome(cfg, "bot", {
            success: true,
            runId,
            taskId,
            scope,
            acceptance: opts.acceptance,
            delivery: opts.delivery,
            deliveryId: opts.deliveryId,
          });
          throw new Error("crash after persist before notify");
        },
        publishPending: publish,
      }),
    ).rejects.toThrow("crash after persist before notify");

    const persisted = new DurableTaskOutcomeStore(storeRoot).loadTask(taskId);
    expect(persisted?.delivery.status).toBe("pending");
    expect(persisted?.deliveryId).toBe(deliveryId);
    expect(peekAwaitingDelivery({ deliveryId, persistRoot: storeRoot })).toBeUndefined();
    expect(fs.existsSync(path.join(storeRoot, "pending-deliveries"))).toBe(false);

    const boot = await recoverTaskOutcomeConsumersAtGatewayBoot({
      cfg,
      startRuntimeDrain: false,
    });
    expect(boot.agentsScanned).toBe(1);
    expect(boot.hydrated).toBeGreaterThanOrEqual(1);
    const pending = peekAwaitingDelivery({ deliveryId });
    expect(pending).toMatchObject({
      taskId,
      runId,
      deliveryId,
      agentId: "bot",
    });

    const sessionFile = path.join(agentDir, "session.jsonl");
    fs.writeFileSync(sessionFile, "");
    const binding = {
      taskId: "board-s4",
      executionAttempt: runId,
      deliverableVersion: "v1",
    };
    mutateSessionTaskBoard(sessionFile, () => ({
      board: {
        ...emptySessionTaskBoard(),
        current: {
          ...binding,
          title: "S4",
          goalText: "S4",
          unfinished: true,
          createdAtMs: 1,
          stop: { summary: "waiting", workspacePaths: [] },
        },
      },
      value: undefined,
    }));
    mutateSessionTaskBoard(sessionFile, (board) => ({
      board: cancelCurrentTask({ board }).board,
      value: undefined,
    }));
    const before = readSessionTaskBoard(sessionFile);
    let closes = 0;
    const ports = {
      resolvePersistRoot: () => storeRoot,
      completeTask: (input: Parameters<typeof recordCheckedTaskCompletion>[0]) => {
        const result = recordCheckedTaskCompletion(input);
        if (result.persisted) {
          closes += 1;
        }
        return result;
      },
      bindingCurrent: isTaskExecutionBindingCurrent,
      recordRecoveryDelivered: markAsyncWaitRecoveryDelivered,
    };

    await confirmPendingTurnDeliveryWithPorts(
      {
        cfg,
        sessionKey: "agent:bot:main",
        deliveryId,
        status: "delivery_unknown",
      },
      ports,
    );
    expect(new DurableTaskOutcomeStore(storeRoot).loadTask(taskId)?.delivery.status).toBe(
      "delivery_unknown",
    );
    expect(peekAwaitingDelivery({ deliveryId, persistRoot: storeRoot })).toBeDefined();
    expect(closes).toBe(0);
    expect(readSessionTaskBoard(sessionFile)).toEqual(before);

    await confirmPendingTurnDeliveryWithPorts(
      {
        cfg,
        sessionKey: "agent:bot:main",
        deliveryId,
        status: "delivered",
      },
      ports,
    );
    const confirmed = new DurableTaskOutcomeStore(storeRoot).loadTask(taskId);
    expect(confirmed?.delivery.status).toBe("delivered");
    expect(confirmed?.deliveryId).toBe(deliveryId);
    // Recovered identity has no checkedTask; do not invent a board close or revive a cancelled task.
    expect(closes).toBe(0);
    expect(readSessionTaskBoard(sessionFile).current?.unfinished).toBe(before.current?.unfinished);
    expect(peekAwaitingDelivery({ deliveryId, persistRoot: storeRoot })).toBeUndefined();

    await confirmPendingTurnDeliveryWithPorts(
      {
        cfg,
        sessionKey: "agent:bot:main",
        deliveryId,
        status: "delivered",
      },
      ports,
    );
    expect(new DurableTaskOutcomeStore(storeRoot).loadTask(taskId)?.delivery.status).toBe(
      "delivered",
    );
    expect(closes).toBe(0);
  });
});
