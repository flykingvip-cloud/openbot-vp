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
import {
  armAsyncWaitRecoveryContinuation,
  collectRecoverableAsyncWaitIntents,
  findAsyncWaitJobsDirs,
  recoverAsyncWaitJobsAtGatewayBoot,
  stopAsyncWaitJobRecoveryRecheckForTests,
} from "./async-wait-job-recovery.js";
import {
  claimAsyncWaitJobForRecovery,
  clearAsyncWaitJobsForTests,
  markAsyncWaitJobExited,
  readAsyncWaitJobIntent,
  recordAsyncWaitJobIntent,
} from "./async-wait-job.js";

const roots: string[] = [];
const prevState = process.env.OPENBOT_STATE_DIR;
const prevOperator = process.env.OPENBOT_OPERATOR_ID;

afterEach(() => {
  stopAsyncWaitJobRecoveryRecheckForTests();
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
      focusRevision: 1,
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

it("pid alive → still waiting; no continue arm", () => {
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
  const enqueue = vi.fn(() => true);
  expect(armAsyncWaitRecoveryContinuation({ intent, enqueue }).outcome).toBe("still_waiting");
  expect(enqueue).not.toHaveBeenCalled();
  expect(readAsyncWaitJobIntent(sessionFile, "job-alive")?.status).toBe("waiting");
});

it("exited → arm continue once; second call retries open stage without double enqueue success required", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aw-exit-"));
  roots.push(root);
  const sessionFile = path.join(root, "session.jsonl");
  fs.writeFileSync(sessionFile, "");
  const binding = liveBoard(sessionFile);
  recordAsyncWaitJobIntent({
    jobId: "job-exit",
    sessionKey: "agent:main:main",
    sessionFile,
    taskId: binding.taskId,
    executionAttempt: binding.executionAttempt,
    deliverableVersion: binding.deliverableVersion,
    pid: 999_999_999,
    startedAt: Date.now(),
  });
  markAsyncWaitJobExited({
    sessionFile,
    jobId: "job-exit",
    exitStatus: "completed",
    exitCode: 0,
    summary: "done",
  });
  const intent = readAsyncWaitJobIntent(sessionFile, "job-exit")!;
  expect(intent.resultEvidence?.kind).toBe("process_exit_observed");
  const enqueue = vi.fn(() => true);
  const first = armAsyncWaitRecoveryContinuation({ intent, enqueue });
  expect(first.outcome).toBe("continue_armed");
  expect(enqueue).toHaveBeenCalledTimes(1);
  expect(readAsyncWaitJobIntent(sessionFile, "job-exit")?.recovery?.stage).toBe("continue_armed");
  // Second arm: open stage retries (enqueue may run again) — NOT skipped as delivered
  const second = armAsyncWaitRecoveryContinuation({ intent, enqueue });
  expect(["continue_armed", "retried_open"]).toContain(second.outcome);
  expect(readAsyncWaitJobIntent(sessionFile, "job-exit")?.recovery?.stage).not.toBe("delivered");
});

it("pid missing → unconfirmed evidence, never packaged as success", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aw-miss-"));
  roots.push(root);
  const sessionFile = path.join(root, "session.jsonl");
  fs.writeFileSync(sessionFile, "");
  const binding = liveBoard(sessionFile);
  recordAsyncWaitJobIntent({
    jobId: "job-miss",
    sessionKey: "agent:main:main",
    sessionFile,
    taskId: binding.taskId,
    executionAttempt: binding.executionAttempt,
    deliverableVersion: binding.deliverableVersion,
    pid: 999_999_991,
    startedAt: Date.now(),
  });
  const claimed = claimAsyncWaitJobForRecovery({
    sessionFile,
    jobId: "job-miss",
    isPidAlive: () => false,
  });
  expect(claimed.ok).toBe(true);
  if (claimed.ok) {
    expect(claimed.intent.resultEvidence?.kind).toBe("process_missing_unconfirmed");
    expect(claimed.intent.resultEvidence?.summary).toMatch(/unconfirmed/i);
  }
});

it("pause clears; recovery does not arm continue", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aw-pause-"));
  roots.push(root);
  const sessionFile = path.join(root, "session.jsonl");
  fs.writeFileSync(sessionFile, "");
  const binding = liveBoard(sessionFile);
  const intent = recordAsyncWaitJobIntent({
    jobId: "job-pause",
    sessionKey: "agent:main:main",
    sessionFile,
    taskId: binding.taskId,
    executionAttempt: binding.executionAttempt,
    deliverableVersion: binding.deliverableVersion,
    pid: 999_999_992,
    startedAt: Date.now(),
  })!;
  markAsyncWaitJobExited({
    sessionFile,
    jobId: "job-pause",
    exitStatus: "completed",
  });
  mutateSessionTaskBoard(sessionFile, (board) => ({
    board: {
      ...board,
      current: { ...board.current!, wakeSuppress: true },
    },
    value: undefined,
  }));
  const enqueue = vi.fn(() => true);
  expect(armAsyncWaitRecoveryContinuation({ intent, enqueue }).outcome).toBe("cleared");
  expect(enqueue).not.toHaveBeenCalled();
});

it("boot recovery scans agent sessions and arms continue (not delivered)", () => {
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
  const enqueue = vi.fn(() => true);
  const first = recoverAsyncWaitJobsAtGatewayBoot({
    cfg,
    startRecheck: false,
    enqueue,
  });
  expect(first.intentsSeen).toBeGreaterThanOrEqual(1);
  expect(first.continueArmed).toBe(1);
  expect(enqueue).toHaveBeenCalledTimes(1);
  expect(collectRecoverableAsyncWaitIntents(cfg).some((row) => row.jobId === "job-boot")).toBe(
    true,
  );
  clearAsyncWaitJobsForTests(sessionFile);
});
