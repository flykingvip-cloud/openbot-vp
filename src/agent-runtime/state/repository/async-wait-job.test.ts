import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  clearAsyncWaitJobIntent,
  clearAsyncWaitJobsForTask,
  listWaitingAsyncWaitJobIntents,
  markAsyncWaitJobExited,
  readAsyncWaitJobIntent,
  recordAsyncWaitJobIntent,
} from "./async-wait-job.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function sessionFile() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "async-wait-"));
  roots.push(root);
  const file = path.join(root, "session.jsonl");
  fs.writeFileSync(file, "");
  return file;
}

it("records a waiting intent that survives process restart (re-read from disk)", () => {
  const file = sessionFile();
  const recorded = recordAsyncWaitJobIntent({
    jobId: "job-1",
    sessionKey: "agent:main:main",
    sessionFile: file,
    taskId: "task-a",
    executionAttempt: "attempt-1",
    deliverableVersion: "attempt-1",
    constraints: ["keep sources"],
    pid: 4242,
    startedAt: 1000,
    command: "sleep 10",
  });
  expect(recorded?.status).toBe("waiting");
  // No in-memory index: a fresh read after "restart" is a new process open of the same files.
  expect(readAsyncWaitJobIntent(file, "job-1")).toMatchObject({
    status: "waiting",
    taskId: "task-a",
    pid: 4242,
    constraints: ["keep sources"],
  });
  expect(listWaitingAsyncWaitJobIntents(file)).toHaveLength(1);
});

it("marks exited without dropping durable identity", () => {
  const file = sessionFile();
  recordAsyncWaitJobIntent({
    jobId: "job-2",
    sessionKey: "agent:main:main",
    sessionFile: file,
    taskId: "task-a",
    executionAttempt: "a",
    deliverableVersion: "a",
    startedAt: 1,
  });
  expect(
    markAsyncWaitJobExited({ sessionFile: file, jobId: "job-2", exitStatus: "completed" }),
  ).toMatchObject({
    status: "exited",
    exitStatus: "completed",
  });
  expect(listWaitingAsyncWaitJobIntents(file)).toHaveLength(0);
  expect(readAsyncWaitJobIntent(file, "job-2")?.status).toBe("exited");
});

it("owner clear removes waiting jobs for the task and refuses missing binding writes", () => {
  const file = sessionFile();
  expect(
    recordAsyncWaitJobIntent({
      jobId: "x",
      sessionKey: "s",
      sessionFile: file,
      taskId: "",
      executionAttempt: "a",
      deliverableVersion: "a",
      startedAt: 1,
    }),
  ).toBeUndefined();
  recordAsyncWaitJobIntent({
    jobId: "job-3",
    sessionKey: "agent:main:main",
    sessionFile: file,
    taskId: "task-a",
    executionAttempt: "a",
    deliverableVersion: "a",
    startedAt: 1,
  });
  expect(clearAsyncWaitJobsForTask(file, "task-a")).toBe(1);
  expect(readAsyncWaitJobIntent(file, "job-3")?.status).toBe("cleared");
  expect(clearAsyncWaitJobIntent(file, "job-3")).toBe(true);
  expect(listWaitingAsyncWaitJobIntents(file)).toHaveLength(0);
});

it("markBackgrounded with notify+boundary writes durable intent; markExited marks exited; clear on task stop", async () => {
  const { markBackgrounded, markExited, resetProcessRegistryForTests } =
    await import("../../../agents/bash-process-registry.js");
  resetProcessRegistryForTests();
  const file = sessionFile();
  const session = {
    id: "bg-job-1",
    command: "sleep 1",
    sessionKey: "agent:main:main",
    notifyOnExit: true,
    taskBoundary: {
      sessionFile: file,
      binding: {
        taskId: "task-a",
        executionAttempt: "run-1",
        deliverableVersion: "run-1",
      },
      constraints: [],
    },
    startedAt: Date.now(),
    maxOutputChars: 1000,
    totalOutputChars: 0,
    pendingStdout: [],
    pendingStderr: [],
    pendingStdoutChars: 0,
    pendingStderrChars: 0,
    aggregated: "",
    tail: "",
    exited: false,
    truncated: false,
    backgrounded: false,
    pid: 9991,
  };
  markBackgrounded(session as never);
  expect(readAsyncWaitJobIntent(file, "bg-job-1")).toMatchObject({
    status: "waiting",
    pid: 9991,
    taskId: "task-a",
  });
  markExited(session as never, 0, null, "completed");
  expect(readAsyncWaitJobIntent(file, "bg-job-1")?.status).toBe("exited");
  expect(clearAsyncWaitJobsForTask(file, "task-a")).toBe(1);
  expect(readAsyncWaitJobIntent(file, "bg-job-1")?.status).toBe("cleared");
  resetProcessRegistryForTests();
});
