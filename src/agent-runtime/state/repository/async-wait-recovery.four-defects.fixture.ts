/**
 * Shared roots / afterEach / seed for async-wait four-defects regressions.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach } from "vitest";
import {
  emptySessionTaskBoard,
  mutateSessionTaskBoard,
} from "../../../conversation-task/session-task-board.js";
import {
  clearAsyncWaitJobsForTests,
  markAsyncWaitJobExited,
  recordAsyncWaitJobIntent,
} from "./async-wait-job.js";

export const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    clearAsyncWaitJobsForTests(path.join(root, "session.jsonl"));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

export function seed(jobId = "job-a", taskId = "task-a") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aw-4def-"));
  roots.push(root);
  const sessionFile = path.join(root, "session.jsonl");
  fs.writeFileSync(sessionFile, "");
  mutateSessionTaskBoard(sessionFile, () => ({
    board: {
      ...emptySessionTaskBoard(),
      current: {
        taskId,
        title: "t",
        goalText: "g",
        unfinished: true,
        createdAtMs: 1,
        executionAttempt: "attempt-0",
        deliverableVersion: "attempt-0",
        stop: { summary: "", workspacePaths: [] },
      },
    },
    value: undefined,
  }));
  recordAsyncWaitJobIntent({
    jobId,
    sessionKey: "agent:bot:main",
    sessionFile,
    taskId,
    executionAttempt: "attempt-0",
    deliverableVersion: "attempt-0",
    pid: 999_888_777,
    startedAt: Date.now(),
  });
  markAsyncWaitJobExited({ sessionFile, jobId, exitStatus: "completed", exitCode: 0 });
  return { root, sessionFile, jobId, taskId };
}
