import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { recordAsyncWaitJobIntent } from "./async-wait-job.js";
import { visibleAsyncWaitIdentity } from "./async-wait-visible-identity.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function sessionFile() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "async-wait-visible-"));
  roots.push(root);
  const file = path.join(root, "session.jsonl");
  fs.writeFileSync(file, "");
  return file;
}

describe("visible async wait identity", () => {
  it("does not invent a job when none exists", () => {
    expect(visibleAsyncWaitIdentity({ sessionFile: sessionFile(), taskId: "task-a" })).toBeUndefined();
  });

  it("returns the waiting job identity only for a real recorded job", () => {
    const file = sessionFile();
    recordAsyncWaitJobIntent({
      jobId: "job-live-1",
      sessionKey: "agent:main:employee:demo",
      sessionFile: file,
      taskId: "task-attach",
      executionAttempt: "attempt-1",
      deliverableVersion: "attempt-1",
      constraints: [],
      startedAt: 1,
    });
    expect(visibleAsyncWaitIdentity({ sessionFile: file, taskId: "task-attach" })).toEqual({
      jobId: "job-live-1",
      taskId: "task-attach",
      status: "waiting",
      executionAttempt: "attempt-1",
    });
    expect(visibleAsyncWaitIdentity({ sessionFile: file, taskId: "other-task" })).toBeUndefined();
  });
});
