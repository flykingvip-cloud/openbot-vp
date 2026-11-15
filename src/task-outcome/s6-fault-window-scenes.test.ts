import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { confirmPendingTurnDeliveryWithPorts } from "../agent-runtime/delivery/dispatch/confirm-pending.js";
import { prepareVisibleDelivery } from "../agent-runtime/delivery/dispatch/prepare-visible.js";
import { INTERACTION_MODEL_FAILURE_TEXT } from "../agent-runtime/model/interaction-resource-wait.js";
import { markAsyncWaitRecoveryDelivered } from "../agent-runtime/state/index.js";
import type { OpenBotConfig } from "../config/config.js";
import {
  cancelCurrentTask,
  emptySessionTaskBoard,
  isTaskExecutionBindingCurrent,
  mutateSessionTaskBoard,
  readSessionTaskBoard,
  recordCheckedTaskCompletion,
} from "../conversation-task/session-task-board.js";
import {
  persistRejectedInteractionTurn,
  readChatTurnTerminal,
  reconcileChatTurnTerminal,
} from "../gateway/chat-interaction-failure.js";
import {
  recoverTaskOutcomeConsumersAtGatewayBoot,
  stopTaskOutcomeRuntimeDrainForTests,
} from "./consumer-boot.js";
import { clearAwaitingDeliveriesForTests, peekAwaitingDelivery } from "./pending-delivery.js";
import { recordRunnerTurnOutcome, TASK_OUTCOME_STORE_DIRNAME } from "./runtime-from-runner.js";
import { DurableTaskOutcomeStore } from "./store.js";
import type { TrustedScope } from "./types.js";

const scope: TrustedScope = {
  kind: "personal",
  personalDomainId: "personal:s6",
  subjectRef: "u",
  authzScopeRef: "s",
};

describe("S6 fault-window production-consumer scenes", () => {
  let agentDir = "";
  let storeRoot = "";
  let terminalDir = "";
  let cfg: OpenBotConfig;

  beforeEach(() => {
    agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "s6-fault-"));
    storeRoot = path.join(agentDir, TASK_OUTCOME_STORE_DIRNAME);
    terminalDir = path.join(agentDir, "terminals");
    cfg = {
      agents: { list: [{ id: "bot", agentDir }] },
      channels: { telegram: { enabled: true, defaultTo: "111" } },
    } as unknown as OpenBotConfig;
    clearAwaitingDeliveriesForTests();
  });

  afterEach(() => {
    stopTaskOutcomeRuntimeDrainForTests();
    clearAwaitingDeliveriesForTests(storeRoot);
    fs.rmSync(agentDir, { recursive: true, force: true });
  });

  function seedBoundBoard(
    sessionFile: string,
    binding: { taskId: string; executionAttempt: string; deliverableVersion: string },
  ) {
    fs.writeFileSync(sessionFile, "");
    mutateSessionTaskBoard(sessionFile, () => ({
      board: {
        ...emptySessionTaskBoard(),
        current: {
          ...binding,
          title: "S6 fault",
          goalText: "S6 fault",
          unfinished: true,
          createdAtMs: 1,
          stop: { summary: "waiting", workspacePaths: [] },
        },
      },
      value: undefined,
    }));
  }

  async function persistThenCrash(params: {
    runId: string;
    taskId: string;
    sessionFile: string;
    binding: { taskId: string; executionAttempt: string; deliverableVersion: string };
    payloads: { text: string }[];
    target: { channel: string; to: string };
  }) {
    await expect(
      prepareVisibleDelivery({
        resolvePersistRoot: () => storeRoot,
        agentId: "bot",
        runId: params.runId,
        outcomeTaskId: params.taskId,
        sessionKey: "agent:bot:main",
        sessionFile: params.sessionFile,
        completionBinding: params.binding,
        contract: {
          id: "report-v1",
          version: "1",
          kind: "document",
          requiredValidators: ["check"],
          acceptanceVerified: true,
        },
        payloads: params.payloads,
        target: params.target,
        authorization: {
          subjectRef: "u",
          sessionKey: "agent:bot:main",
          tenantId: "personal:s6",
          channel: params.target.channel,
          to: params.target.to,
        },
        commitOutcome: async (_success, opts) => {
          await recordRunnerTurnOutcome(cfg, "bot", {
            success: true,
            runId: params.runId,
            taskId: params.taskId,
            scope,
            acceptance: opts.acceptance,
            delivery: opts.delivery,
            deliveryId: opts.deliveryId,
          });
          throw new Error("crash after persist before notify");
        },
        publishPending: () => {
          throw new Error("publish must not run when persist notify crashes");
        },
      }),
    ).rejects.toThrow("crash after persist before notify");
    expect(new DurableTaskOutcomeStore(storeRoot).loadTask(params.taskId)?.delivery.status).toBe(
      "pending",
    );
  }

  it("recovers accepted-message terminals, result-to-delivery, unknown send, and restart without duplicate business", async () => {
    const sessionKey = "agent:bot:main";
    const acceptedRunId = "accepted-msg-1";
    let terminalAppends = 0;
    const firstTerminal = await persistRejectedInteractionTurn({
      error: Object.assign(new Error("provider 500"), { interactionPhase: "interpretation" }),
      runId: acceptedRunId,
      sessionKey,
      storeDir: terminalDir,
      append: async (text, key) => {
        terminalAppends += 1;
        expect(text).toBe(INTERACTION_MODEL_FAILURE_TEXT);
        expect(key).toBe(`${acceptedRunId}:interaction-rejected`);
        return { ok: true };
      },
    });
    expect(firstTerminal.persisted).toBe(true);
    const sealed = readChatTurnTerminal(acceptedRunId, terminalDir, sessionKey);
    expect(sealed?.persistedToTranscript).toBe(true);
    expect(sealed?.businessExecution).toBe("none");

    const replay = await persistRejectedInteractionTurn({
      error: Object.assign(new Error("provider 500"), { interactionPhase: "interpretation" }),
      runId: acceptedRunId,
      sessionKey,
      storeDir: terminalDir,
      append: async () => {
        terminalAppends += 1;
        return { ok: true };
      },
    });
    expect(replay.persisted).toBe(true);
    const afterReplay = await reconcileChatTurnTerminal({
      runId: acceptedRunId,
      storeDir: terminalDir,
      sessionKey,
      append: async () => {
        terminalAppends += 1;
        return { ok: true };
      },
    });
    expect(afterReplay.reconciled).toBe(false);
    expect(terminalAppends).toBe(1);
    expect(readChatTurnTerminal(acceptedRunId, terminalDir, sessionKey)?.text).toBe(
      INTERACTION_MODEL_FAILURE_TEXT,
    );

    const crashRunId = "s6-run-crash";
    const outcomeTaskId = "s6-task-crash";
    const deliveryId = "delivery:s6-run-crash:visible";
    const sessionFile = path.join(agentDir, "session-fault.jsonl");
    const binding = {
      taskId: "board-s6-fault",
      executionAttempt: crashRunId,
      deliverableVersion: "v1",
    };
    const payloads = [{ text: "original artifact v1" }];
    const target = { channel: "telegram", to: "111" };
    seedBoundBoard(sessionFile, binding);
    await persistThenCrash({
      runId: crashRunId,
      taskId: outcomeTaskId,
      sessionFile,
      binding,
      payloads,
      target,
    });
    expect(peekAwaitingDelivery({ deliveryId, persistRoot: storeRoot })).toBeUndefined();

    let sendCalls = 0;
    const seenPayloads: unknown[] = [];
    const sendPendingVisible = async (input: {
      payloads?: { text?: string }[];
      target?: { channel?: string; to?: string };
    }) => {
      sendCalls += 1;
      seenPayloads.push(input.payloads);
      expect(input.payloads).toEqual(payloads);
      expect(input.target).toMatchObject(target);
      return [{ messageId: "unknown" }];
    };
    const bootArgs = { cfg, startRuntimeDrain: false as const, sendPendingVisible };
    const boot = await recoverTaskOutcomeConsumersAtGatewayBoot(bootArgs);
    expect(boot.agentsScanned).toBe(1);
    expect(boot.hydrated).toBeGreaterThanOrEqual(1);
    expect(sendCalls).toBe(1);
    expect(seenPayloads).toEqual([payloads]);
    expect(new DurableTaskOutcomeStore(storeRoot).loadTask(outcomeTaskId)?.delivery.status).toBe(
      "delivery_unknown",
    );
    expect(peekAwaitingDelivery({ deliveryId, persistRoot: storeRoot })).toBeDefined();
    expect(readSessionTaskBoard(sessionFile).current?.unfinished).toBe(true);

    await recoverTaskOutcomeConsumersAtGatewayBoot(bootArgs);
    expect(sendCalls).toBe(1);
    expect(new DurableTaskOutcomeStore(storeRoot).loadTask(outcomeTaskId)?.delivery.status).toBe(
      "delivery_unknown",
    );

    mutateSessionTaskBoard(sessionFile, (board) => ({
      board: cancelCurrentTask({ board, sessionFile }).board,
      value: undefined,
    }));
    expect(isTaskExecutionBindingCurrent(sessionFile, binding)).toBe(false);
    const lateClose = recordCheckedTaskCompletion({
      sessionFile,
      closed: true,
      binding,
    });
    expect(lateClose.persisted).toBe(false);

    let closes = 0;
    await confirmPendingTurnDeliveryWithPorts(
      {
        cfg,
        sessionKey,
        deliveryId,
        status: "delivery_unknown",
      },
      {
        resolvePersistRoot: () => storeRoot,
        completeTask: (input) => {
          const result = recordCheckedTaskCompletion(input);
          if (result.persisted) {
            closes += 1;
          }
          return result;
        },
        bindingCurrent: isTaskExecutionBindingCurrent,
        recordRecoveryDelivered: markAsyncWaitRecoveryDelivered,
      },
    );
    expect(new DurableTaskOutcomeStore(storeRoot).loadTask(outcomeTaskId)?.delivery.status).toBe(
      "delivery_unknown",
    );
    expect(closes).toBe(0);
    expect(peekAwaitingDelivery({ deliveryId, persistRoot: storeRoot })).toBeDefined();
    expect(readSessionTaskBoard(sessionFile).current).toBeUndefined();
    expect(
      readSessionTaskBoard(sessionFile).tombstones?.some((row) => row.taskId === binding.taskId),
    ).toBe(true);
    expect(isTaskExecutionBindingCurrent(sessionFile, binding)).toBe(false);

    const restart = await recoverTaskOutcomeConsumersAtGatewayBoot(bootArgs);
    expect(restart.agentsScanned).toBe(1);
    expect(sendCalls).toBe(1);
    expect(new DurableTaskOutcomeStore(storeRoot).loadTask(outcomeTaskId)?.delivery.status).toBe(
      "delivery_unknown",
    );
    expect(
      readChatTurnTerminal(acceptedRunId, terminalDir, sessionKey)?.persistedToTranscript,
    ).toBe(true);
  });
});
