import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  emptySessionTaskBoard,
  mutateSessionTaskBoard,
  readSessionTaskBoard,
} from "../conversation-task/session-task-board.js";
import {
  clearAwaitingDeliveriesForTests,
  hydrateAwaitingDeliveriesFromDisk,
  registerAwaitingDelivery,
  peekAwaitingDelivery,
} from "./pending-delivery.js";
const confirm = vi.hoisted(() => vi.fn());
vi.mock("./runtime-from-runner.js", async (original) => ({
  ...(await original<typeof import("./runtime-from-runner.js")>()),
  confirmRunnerTurnDelivery: confirm,
}));
import { confirmPendingTurnDelivery } from "../auto-reply/reply/dispatch-from-config.js";
const dirs: string[] = [];
afterEach(() => {
  clearAwaitingDeliveriesForTests();
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  confirm.mockReset();
});
function setup(acceptance = "passed") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "late-task-"));
  dirs.push(root);
  const sessionFile = path.join(root, "session.jsonl");
  fs.writeFileSync(sessionFile, "");
  const binding = { taskId: "board-a", executionAttempt: "run-a", deliverableVersion: "v1" };
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
  registerAwaitingDelivery({
    taskId: "outcome-a",
    runId: "run-a",
    deliveryId: "delivery-a",
    agentId: "bot",
    persistRoot: root,
    checkedTask: { sessionFile, binding },
  });
  confirm.mockResolvedValue({
    record: {
      taskId: "outcome-a",
      decisiveRunId: "run-a",
      deliveryId: "delivery-a",
      acceptance: { status: acceptance },
      delivery: { status: "delivered" },
    },
  });
  return { root, sessionFile };
}
it("recovers the captured completion identity after restart and closes only after confirmed delivery", async () => {
  const { root, sessionFile } = setup();
  clearAwaitingDeliveriesForTests();
  expect(hydrateAwaitingDeliveriesFromDisk(root)).toBe(1);
  expect(readSessionTaskBoard(sessionFile).current?.unfinished).toBe(true);
  await confirmPendingTurnDelivery({
    cfg: {},
    deliveryId: "delivery-a",
    status: "delivery_unknown",
  });
  expect(readSessionTaskBoard(sessionFile).current?.unfinished).toBe(true);
  expect(peekAwaitingDelivery("run-a")).toBeDefined();
  await confirmPendingTurnDelivery({ cfg: {}, deliveryId: "delivery-a", status: "delivered" });
  expect(readSessionTaskBoard(sessionFile).current?.unfinished).toBe(false);
  expect(fs.readFileSync(sessionFile, "utf8")).toBe("");
  const before = readSessionTaskBoard(sessionFile);
  await confirmPendingTurnDelivery({ cfg: {}, deliveryId: "delivery-a", status: "delivered" });
  expect(readSessionTaskBoard(sessionFile)).toEqual(before);
});
it.each(["pending", "not_required", "failed"])(
  "does not turn acceptance %s into board completion",
  async (acceptance) => {
    const { sessionFile } = setup(acceptance);
    await confirmPendingTurnDelivery({ cfg: {}, runId: "run-a", status: "delivered" });
    expect(readSessionTaskBoard(sessionFile).current?.unfinished).toBe(true);
  },
);
it.each(["paused", "new task", "new attempt", "new version"])(
  "rejects a late receipt for %s",
  async (change) => {
    const { sessionFile } = setup();
    mutateSessionTaskBoard(sessionFile, (board) => ({
      board: {
        ...board,
        current: {
          ...board.current!,
          ...(change === "paused"
            ? { wakeSuppress: true }
            : change === "new task"
              ? { taskId: "board-b" }
              : change === "new attempt"
                ? { executionAttempt: "run-b" }
                : { deliverableVersion: "v2" }),
        },
      },
      value: undefined,
    }));
    const before = readSessionTaskBoard(sessionFile);
    await confirmPendingTurnDelivery({ cfg: {}, runId: "run-a", status: "delivered" });
    expect(readSessionTaskBoard(sessionFile)).toEqual(before);
  },
);
it("rejects conflicting receipt locators before outcome confirmation", async () => {
  const { sessionFile } = setup();
  await confirmPendingTurnDelivery({
    cfg: {},
    runId: "run-a",
    deliveryId: "another-delivery",
    status: "delivered",
  });
  expect(confirm).not.toHaveBeenCalled();
  expect(readSessionTaskBoard(sessionFile).current?.unfinished).toBe(true);
});
it("does not close on failed send or a mismatched confirmed run", async () => {
  const { sessionFile } = setup();
  await confirmPendingTurnDelivery({ cfg: {}, runId: "run-a", status: "failed" });
  expect(readSessionTaskBoard(sessionFile).current?.unfinished).toBe(true);
});

it("runs real preparation and durable outcome confirmation before closing the captured board task", async () => {
  const actual = await vi.importActual<typeof import("./runtime-from-runner.js")>(
    "./runtime-from-runner.js",
  );
  const { prepareVisibleDelivery } = await import("../agent-runtime/delivery/index.js");
  const { chatTurnTaskId } = await import("./chat-entry.js");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "late-real-"));
  dirs.push(root);
  const persistRoot = path.join(root, actual.TASK_OUTCOME_STORE_DIRNAME);
  const sessionFile = path.join(root, "session.jsonl");
  fs.writeFileSync(sessionFile, "");
  const cfg = { agents: { list: [{ id: "bot", agentDir: root }] } };
  const sessionKey = "agent:bot:main";
  const binding = {
    taskId: "real-board-a",
    executionAttempt: "real-run",
    deliverableVersion: "v1",
  };
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
  const taskId = chatTurnTaskId({ agentId: "bot", runId: "real-run", sessionKey });
  await prepareVisibleDelivery({
    resolvePersistRoot: () => persistRoot,
    agentId: "bot",
    runId: "real-run",
    sessionKey,
    sessionFile,
    completionBinding: binding,
    contract: {
      id: "report-v1",
      version: "1",
      kind: "document",
      requiredValidators: ["report-check"],
      acceptanceVerified: true,
    },
    commitOutcome: (success, options) =>
      actual.recordRunnerTurnOutcome(cfg, "bot", {
        success,
        ...options,
        runId: "real-run",
        taskId,
        scope: {
          kind: "personal",
          personalDomainId: "personal:test",
          subjectRef: "user:test",
          authzScopeRef: "test",
        },
      }),
    publishPending: () => {},
  });
  expect(peekAwaitingDelivery("real-run")?.checkedTask?.binding).toEqual(binding);
  clearAwaitingDeliveriesForTests();
  confirm.mockImplementation(actual.confirmRunnerTurnDelivery);
  await confirmPendingTurnDelivery({
    cfg,
    sessionKey,
    runId: "real-run",
    status: "delivery_unknown",
  });
  expect(readSessionTaskBoard(sessionFile).current?.unfinished).toBe(true);
  await confirmPendingTurnDelivery({ cfg, sessionKey, runId: "real-run", status: "delivered" });
  expect(readSessionTaskBoard(sessionFile).current?.unfinished).toBe(false);
  expect(peekAwaitingDelivery({ runId: "real-run", persistRoot })).toBeUndefined();
  expect(fs.readFileSync(sessionFile, "utf8")).toBe("");
});
