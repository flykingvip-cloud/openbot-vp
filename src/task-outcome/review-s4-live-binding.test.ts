import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { confirmPendingTurnDeliveryWithPorts } from "../agent-runtime/delivery/index.js";
import { prepareVisibleDelivery } from "../agent-runtime/delivery/index.js";
import { markAsyncWaitRecoveryDelivered } from "../agent-runtime/state/index.js";
import {
  emptySessionTaskBoard,
  isTaskExecutionBindingCurrent,
  mutateSessionTaskBoard,
  readSessionTaskBoard,
  recordCheckedTaskCompletion,
} from "../conversation-task/session-task-board.js";
import {
  recoverTaskOutcomeConsumersAtGatewayBoot,
  stopTaskOutcomeRuntimeDrainForTests,
} from "./consumer-boot.js";
import { clearAwaitingDeliveriesForTests, peekAwaitingDelivery } from "./pending-delivery.js";
import { recordRunnerTurnOutcome, TASK_OUTCOME_STORE_DIRNAME } from "./runtime-from-runner.js";
import { DurableTaskOutcomeStore } from "./store.js";

it("review: valid live bound task still settles after persist-before-register crash and actual receipt", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "s4-live-binding-review-"));
  const storeRoot = path.join(root, TASK_OUTCOME_STORE_DIRNAME);
  const cfg = { agents: { list: [{ id: "bot", agentDir: root }] } };
  const sessionFile = path.join(root, "session.jsonl");
  fs.writeFileSync(sessionFile, "");
  const runId = "review-live-run";
  const taskId = "review-outcome";
  const deliveryId = `delivery:${runId}:visible`;
  const binding = {
    taskId: "review-board-task",
    executionAttempt: runId,
    deliverableVersion: "v1",
  };
  clearAwaitingDeliveriesForTests();
  try {
    mutateSessionTaskBoard(sessionFile, () => ({
      board: {
        ...emptySessionTaskBoard(),
        current: {
          ...binding,
          title: "Live",
          goalText: "Live",
          unfinished: true,
          createdAtMs: 1,
          stop: { summary: "Waiting", workspacePaths: [] },
        },
      },
      value: undefined,
    }));
    await expect(
      prepareVisibleDelivery({
        resolvePersistRoot: () => storeRoot,
        agentId: "bot",
        runId,
        outcomeTaskId: taskId,
        sessionKey: "agent:bot:main",
        sessionFile,
        completionBinding: binding,
        contract: {
          id: "report-v1",
          version: "1",
          kind: "document",
          requiredValidators: ["check"],
          acceptanceVerified: true,
        },
        commitOutcome: async (success, opts) => {
          await recordRunnerTurnOutcome(cfg, "bot", {
            success,
            ...opts,
            runId,
            taskId,
            scope: {
              kind: "personal",
              personalDomainId: "personal:review",
              subjectRef: "u",
              authzScopeRef: "review",
            },
          });
          throw new Error("crash before register");
        },
        publishPending: () => {
          throw new Error("must not publish");
        },
      }),
    ).rejects.toThrow("crash before register");
    expect(new DurableTaskOutcomeStore(storeRoot).loadTask(taskId)?.acceptance.status).toBe(
      "passed",
    );
    await recoverTaskOutcomeConsumersAtGatewayBoot({ cfg, startRuntimeDrain: false });
    expect(peekAwaitingDelivery({ deliveryId, persistRoot: storeRoot })).toBeDefined();
    await confirmPendingTurnDeliveryWithPorts(
      { cfg, sessionKey: "agent:bot:main", deliveryId, status: "delivered" },
      {
        resolvePersistRoot: () => storeRoot,
        completeTask: recordCheckedTaskCompletion,
        bindingCurrent: isTaskExecutionBindingCurrent,
        recordRecoveryDelivered: markAsyncWaitRecoveryDelivered,
      },
    );
    expect(new DurableTaskOutcomeStore(storeRoot).loadTask(taskId)?.delivery.status).toBe(
      "delivered",
    );
    console.log(
      "REVIEW_LIVE_BINDING",
      JSON.stringify({
        unfinished: readSessionTaskBoard(sessionFile).current?.unfinished,
        pendingRemoved: !peekAwaitingDelivery({ deliveryId, persistRoot: storeRoot }),
      }),
    );
    expect(readSessionTaskBoard(sessionFile).current?.unfinished).toBe(false);
  } finally {
    stopTaskOutcomeRuntimeDrainForTests();
    clearAwaitingDeliveriesForTests();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
