import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  captureTaskCompletionBinding,
  emptySessionTaskBoard,
  mutateSessionTaskBoard,
  startBoundTaskExecution,
} from "../../../conversation-task/session-task-board.js";
import { requestHeartbeatNow } from "../../../infra/heartbeat-wake.js";
import { enqueueSystemEvent } from "../../../infra/system-events.js";
import { claimQueuedExecution } from "../mutations/claim-queued-execution.js";
import { cancelCurrentTask, suppressCurrentTaskWake } from "../mutations/task-control.js";
import { captureTaskActionBoundary, checkTaskActionBoundary } from "../task-action.js";
import { claimAsyncWaitJobIntent } from "./async-wait-job-recovery.js";
import {
  clearAsyncWaitJobIntent,
  readAsyncWaitJobIntent,
  recordAsyncWaitJobIntent,
} from "./async-wait-job.js";

vi.mock("../../../infra/system-events.js", () => ({ enqueueSystemEvent: vi.fn() }));
vi.mock("../../../infra/heartbeat-wake.js", () => ({ requestHeartbeatNow: vi.fn() }));

const roots: string[] = [];
afterEach(() => {
  vi.clearAllMocks();
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aw-stale-"));
  roots.push(root);
  const sessionFile = path.join(root, "session.jsonl");
  fs.writeFileSync(sessionFile, "");
  mutateSessionTaskBoard(sessionFile, () => ({
    board: {
      ...emptySessionTaskBoard(),
      current: {
        taskId: "task-a",
        title: "A",
        goalText: "A",
        unfinished: true,
        createdAtMs: 1,
        stop: { summary: "running", workspacePaths: [] },
      },
    },
    value: undefined,
  }));
  const binding = startBoundTaskExecution(
    sessionFile,
    captureTaskCompletionBinding(sessionFile),
    "run-a",
  );
  if (!binding?.taskId || !binding.executionAttempt || !binding.deliverableVersion) {
    throw new Error("binding");
  }
  const intent = recordAsyncWaitJobIntent({
    jobId: "job-stale",
    sessionKey: "agent:main:main",
    sessionFile,
    taskId: binding.taskId,
    executionAttempt: binding.executionAttempt,
    deliverableVersion: binding.deliverableVersion,
    constraints: [...(binding.constraints ?? [])],
    pid: 999_999_997,
    startedAt: Date.now(),
  })!;
  return { sessionFile, binding, intent };
}

it("pause then recovery claim clears intent and does not wake", () => {
  const { sessionFile, intent } = setup();
  mutateSessionTaskBoard(sessionFile, (board) => {
    const result = suppressCurrentTaskWake({ board, sessionFile });
    return { board: result.board, value: undefined };
  });
  expect(readAsyncWaitJobIntent(sessionFile, "job-stale")?.status).toBe("cleared");
  expect(claimAsyncWaitJobIntent(intent).outcome).toBe("skipped");
  expect(enqueueSystemEvent).not.toHaveBeenCalled();
  expect(requestHeartbeatNow).not.toHaveBeenCalled();
});

it("cancel then recovery claim does not wake; claimQueuedExecution rejects", () => {
  const { sessionFile, binding, intent } = setup();
  mutateSessionTaskBoard(sessionFile, (board) => {
    const result = cancelCurrentTask({ board, sessionFile });
    return { board: result.board, value: undefined };
  });
  expect(readAsyncWaitJobIntent(sessionFile, "job-stale")?.status).toBe("cleared");
  expect(claimAsyncWaitJobIntent(intent).outcome).toBe("skipped");
  const claimed = claimQueuedExecution({
    sessionFile,
    runId: "run-stale",
    prompt: "continue",
    binding,
    collaboration: false,
    privatePlan: false,
  });
  expect(claimed.kind).toBe("rejected");
  expect(enqueueSystemEvent).not.toHaveBeenCalled();
});

it("replace binding refuses TaskActionBoundary and blocks delivery-style check", () => {
  const { sessionFile, binding } = setup();
  const boundary = captureTaskActionBoundary(sessionFile, binding);
  mutateSessionTaskBoard(sessionFile, (board) => ({
    board: {
      ...board,
      current: { ...board.current!, taskId: "task-b" },
    },
    value: undefined,
  }));
  expect(checkTaskActionBoundary(boundary)).toMatch(/paused, cancelled, completed or replaced/);
  clearAsyncWaitJobIntent(sessionFile, "job-stale");
  expect(readAsyncWaitJobIntent(sessionFile, "job-stale")?.status).toBe("cleared");
});
