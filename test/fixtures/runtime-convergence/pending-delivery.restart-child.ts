import fs from "node:fs";
import path from "node:path";
import { confirmPendingTurnDeliveryWithPorts } from "../../../src/agent-runtime/delivery/dispatch/confirm-pending.js";
import {
  emptySessionTaskBoard,
  mutateSessionTaskBoard,
  readSessionTaskBoard,
  recordCheckedTaskCompletion,
  isTaskExecutionBindingCurrent,
  cancelCurrentTask,
} from "../../../src/conversation-task/session-task-board.js";
import {
  registerAwaitingDelivery,
  hydrateAwaitingDeliveriesFromDisk,
  peekAwaitingDelivery,
} from "../../../src/task-outcome/pending-delivery.js";
import { recordRunnerTurnOutcome } from "../../../src/task-outcome/runtime-from-runner.js";
const root = process.argv[2];
const mode = process.argv[3];
const sessionFile = path.join(root, "session.jsonl");
const persistRoot = path.join(root, "task-outcomes");
const cfg = { agents: { list: [{ id: "bot", agentDir: root }] } };
const binding = { taskId: "board-a", executionAttempt: "run-a", deliverableVersion: "v1" };
if (mode === "prepare") {
  fs.writeFileSync(sessionFile, "");
  mutateSessionTaskBoard(sessionFile, () => ({
    board: {
      ...emptySessionTaskBoard(),
      current: {
        ...binding,
        title: "A",
        goalText: "A",
        unfinished: true,
        createdAtMs: 1,
        stop: { summary: "waiting", workspacePaths: [] },
      },
    },
    value: undefined,
  }));
  await recordRunnerTurnOutcome(cfg, "bot", {
    success: true,
    runId: "run-a",
    taskId: "outcome-a",
    scope: {
      kind: "personal",
      personalDomainId: "domain",
      subjectRef: "user",
      authzScopeRef: "scope",
    },
    acceptance: { status: "passed" },
    delivery: { status: "pending" },
    deliveryId: "delivery-a",
  });
  registerAwaitingDelivery({
    taskId: "outcome-a",
    deliveryId: "delivery-a",
    agentId: "bot",
    runId: "run-a",
    persistRoot,
    checkedTask: { sessionFile, binding },
  });
  console.log(JSON.stringify({ prepared: true }));
} else {
  const hydrated = hydrateAwaitingDeliveriesFromDisk(persistRoot);
  const pending = peekAwaitingDelivery({ deliveryId: "delivery-a", persistRoot });
  if (mode === "paused") {
    mutateSessionTaskBoard(sessionFile, (board) => ({
      board: { ...board, current: { ...board.current!, wakeSuppress: true } },
      value: undefined,
    }));
  }
  if (mode === "cancelled") {
    mutateSessionTaskBoard(sessionFile, (board) => ({
      board: cancelCurrentTask({ board }).board,
      value: undefined,
    }));
  }
  const before = readSessionTaskBoard(sessionFile);
  let closes = 0;
  const ports = {
    resolvePersistRoot: () => persistRoot,
    completeTask: (input: Parameters<typeof recordCheckedTaskCompletion>[0]) => {
      const result = recordCheckedTaskCompletion(input);
      if (result.persisted) {
        closes++;
      }
      return result;
    },
    bindingCurrent: isTaskExecutionBindingCurrent,
  };
  const receipt = {
    cfg,
    sessionKey: "agent:bot:main",
    deliveryId: "delivery-a",
    status: "delivered" as const,
  };
  await confirmPendingTurnDeliveryWithPorts(receipt, ports);
  const after = readSessionTaskBoard(sessionFile);
  await confirmPendingTurnDeliveryWithPorts(receipt, ports);
  console.log(
    JSON.stringify({
      hydrated,
      pending,
      before,
      after,
      repeated: readSessionTaskBoard(sessionFile),
      closes,
    }),
  );
}
