import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { OpenBotConfig } from "../../../config/config.js";
import {
  captureTaskCompletionBinding,
  emptySessionTaskBoard,
  mutateSessionTaskBoard,
  startBoundTaskExecution,
} from "../../../conversation-task/session-task-board.js";
import { requestHeartbeatNow } from "../../../infra/heartbeat-wake.js";
import { enqueueSystemEvent } from "../../../infra/system-events.js";
import {
  claimAsyncWaitJobIntent,
  collectRecoverableAsyncWaitIntents,
  findAsyncWaitJobsDirs,
  recoverAsyncWaitJobsAtGatewayBoot,
  stopAsyncWaitJobRecoveryRecheckForTests,
} from "./async-wait-job-recovery.js";
import {
  clearAsyncWaitJobsForTests,
  markAsyncWaitJobExited,
  readAsyncWaitJobIntent,
  recordAsyncWaitJobIntent,
} from "./async-wait-job.js";

vi.mock("../../../infra/system-events.js", () => ({ enqueueSystemEvent: vi.fn() }));
vi.mock("../../../infra/heartbeat-wake.js", () => ({ requestHeartbeatNow: vi.fn() }));

const roots: string[] = [];
const prevState = process.env.OPENBOT_STATE_DIR;
const prevOperator = process.env.OPENBOT_OPERATOR_ID;

afterEach(() => {
  stopAsyncWaitJobRecoveryRecheckForTests();
  vi.clearAllMocks();
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  if (prevState === undefined) {
    delete process.env.OPENBOT_STATE_DIR;
  } else {
    process.env.OPENBOT_STATE_DIR = prevState;
  }
  if (prevOperator === undefined) {
    delete process.env.OPENBOT_OPERATOR_ID;
  } else {
    process.env.OPENBOT_OPERATOR_ID = prevOperator;
  }
});

function liveBoard(sessionFile: string, taskId = "task-a") {
  mutateSessionTaskBoard(sessionFile, () => ({
    board: {
      ...emptySessionTaskBoard(),
      current: {
        taskId,
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
    throw new Error("expected live binding");
  }
  return {
    taskId: binding.taskId,
    executionAttempt: binding.executionAttempt,
    deliverableVersion: binding.deliverableVersion,
  };
}

it("findAsyncWaitJobsDirs discovers nested async-wait-jobs folders", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aw-dirs-"));
  roots.push(root);
  const nested = path.join(root, "sub", "async-wait-jobs");
  fs.mkdirSync(nested, { recursive: true });
  expect(findAsyncWaitJobsDirs(root)).toEqual([nested]);
});

it("pid alive → still waiting; no wake", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aw-alive-"));
  roots.push(root);
  const sessionFile = path.join(root, "session.jsonl");
  fs.writeFileSync(sessionFile, "");
  const binding = liveBoard(sessionFile);
  const intent = recordAsyncWaitJobIntent({
    jobId: "job-alive",
    sessionKey: "agent:main:main",
    sessionFile,
    taskId: binding.taskId,
    executionAttempt: binding.executionAttempt,
    deliverableVersion: binding.deliverableVersion,
    pid: process.pid,
    startedAt: Date.now(),
  })!;
  expect(claimAsyncWaitJobIntent(intent).outcome).toBe("still_waiting");
  expect(readAsyncWaitJobIntent(sessionFile, "job-alive")?.status).toBe("waiting");
  expect(enqueueSystemEvent).not.toHaveBeenCalled();
  expect(requestHeartbeatNow).not.toHaveBeenCalled();
});

it("exited pid → one bounded wake; second claim skips", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aw-exit-"));
  roots.push(root);
  const sessionFile = path.join(root, "session.jsonl");
  fs.writeFileSync(sessionFile, "");
  const binding = liveBoard(sessionFile);
  const intent = recordAsyncWaitJobIntent({
    jobId: "job-exit",
    sessionKey: "agent:main:main",
    sessionFile,
    taskId: binding.taskId,
    executionAttempt: binding.executionAttempt,
    deliverableVersion: binding.deliverableVersion,
    pid: 999_999_999,
    startedAt: Date.now(),
  })!;
  expect(claimAsyncWaitJobIntent(intent).outcome).toBe("woke");
  expect(readAsyncWaitJobIntent(sessionFile, "job-exit")?.status).toBe("exited");
  expect(readAsyncWaitJobIntent(sessionFile, "job-exit")?.recoveryWakeIssuedAtMs).toEqual(
    expect.any(Number),
  );
  expect(enqueueSystemEvent).toHaveBeenCalledTimes(1);
  expect(requestHeartbeatNow).toHaveBeenCalledTimes(1);
  expect(claimAsyncWaitJobIntent(intent).outcome).toBe("skipped");
  expect(enqueueSystemEvent).toHaveBeenCalledTimes(1);
});

it("paused/cancelled binding clears without wake", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aw-clear-"));
  roots.push(root);
  const sessionFile = path.join(root, "session.jsonl");
  fs.writeFileSync(sessionFile, "");
  const binding = liveBoard(sessionFile);
  const intent = recordAsyncWaitJobIntent({
    jobId: "job-stale",
    sessionKey: "agent:main:main",
    sessionFile,
    taskId: binding.taskId,
    executionAttempt: binding.executionAttempt,
    deliverableVersion: binding.deliverableVersion,
    pid: 999_999_999,
    startedAt: Date.now(),
  })!;
  mutateSessionTaskBoard(sessionFile, (board) => ({
    board: {
      ...board,
      current: { ...board.current!, wakeSuppress: true },
    },
    value: undefined,
  }));
  expect(claimAsyncWaitJobIntent(intent).outcome).toBe("cleared");
  expect(readAsyncWaitJobIntent(sessionFile, "job-stale")?.status).toBe("cleared");
  expect(enqueueSystemEvent).not.toHaveBeenCalled();
});

it("boot recovery scans agent sessions and wakes exited intents once", () => {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), "aw-boot-"));
  roots.push(state);
  process.env.OPENBOT_STATE_DIR = state;
  delete process.env.OPENBOT_OPERATOR_ID;
  const sessions = path.join(state, "agents", "bot", "sessions");
  fs.mkdirSync(sessions, { recursive: true });
  const sessionFile = path.join(sessions, "session.jsonl");
  fs.writeFileSync(sessionFile, "");
  const binding = liveBoard(sessionFile);
  recordAsyncWaitJobIntent({
    jobId: "job-boot",
    sessionKey: "agent:bot:main",
    sessionFile,
    taskId: binding.taskId,
    executionAttempt: binding.executionAttempt,
    deliverableVersion: binding.deliverableVersion,
    pid: 999_999_998,
    startedAt: Date.now(),
  });
  markAsyncWaitJobExited({
    sessionFile,
    jobId: "job-boot",
    exitStatus: "completed",
  });
  const cfg = { agents: { list: [{ id: "bot" }] } } as unknown as OpenBotConfig;
  const first = recoverAsyncWaitJobsAtGatewayBoot({ cfg, startRecheck: false });
  expect(first.intentsSeen).toBeGreaterThanOrEqual(1);
  expect(first.woke).toBe(1);
  expect(collectRecoverableAsyncWaitIntents(cfg).some((row) => row.jobId === "job-boot")).toBe(
    true,
  );
  const second = recoverAsyncWaitJobsAtGatewayBoot({ cfg, startRecheck: false });
  expect(second.woke).toBe(0);
  expect(enqueueSystemEvent).toHaveBeenCalledTimes(1);
  clearAsyncWaitJobsForTests(sessionFile);
});
