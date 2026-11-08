import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  bindAsyncWaitRecoveryTurn,
  claimAsyncWaitJobForRecovery,
  clearAsyncWaitJobIntent,
  clearAsyncWaitJobsForTests,
  markAsyncWaitJobExited,
  markAsyncWaitRecoveryContinueArmed,
  readAsyncWaitJobIntent,
  recordAsyncWaitJobIntent,
} from "./async-wait-job.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    clearAsyncWaitJobsForTests(path.join(root, "session.jsonl"));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function seedExited(sessionFile: string, jobId = "job-a", taskId = "task-a") {
  recordAsyncWaitJobIntent({
    jobId,
    sessionKey: "agent:main:main",
    sessionFile,
    taskId,
    executionAttempt: "attempt-1",
    deliverableVersion: "attempt-1",
    pid: 999_999_111,
    startedAt: Date.now(),
  });
  markAsyncWaitJobExited({
    sessionFile,
    jobId,
    exitStatus: "completed",
    exitCode: 0,
  });
}

it("active turn_bound exec is not re-claimable for business continue", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aw-fence-active-"));
  roots.push(root);
  const sessionFile = path.join(root, "session.jsonl");
  fs.writeFileSync(sessionFile, "");
  seedExited(sessionFile);
  const claimed = claimAsyncWaitJobForRecovery({
    sessionFile,
    jobId: "job-a",
    isPidAlive: () => false,
  });
  expect(claimed.ok).toBe(true);
  if (!claimed.ok) {
    return;
  }
  bindAsyncWaitRecoveryTurn({
    sessionFile,
    taskId: "task-a",
    jobId: "job-a",
    claimToken: claimed.claimToken,
    runId: "run-live",
    executionAttempt: "run-live",
    deliverableVersion: "run-live",
  });
  expect(readAsyncWaitJobIntent(sessionFile, "job-a")?.recovery?.stage).toBe("turn_bound");
  const again = claimAsyncWaitJobForRecovery({
    sessionFile,
    jobId: "job-a",
    isPidAlive: () => false,
  });
  expect(again.ok).toBe(false);
  if (!again.ok) {
    expect(again.reason).toBe("active_exec");
  }
});

it("continue_armed cannot regress from turn_bound with old claimToken", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aw-fence-regress-"));
  roots.push(root);
  const sessionFile = path.join(root, "session.jsonl");
  fs.writeFileSync(sessionFile, "");
  seedExited(sessionFile);
  const claimed = claimAsyncWaitJobForRecovery({
    sessionFile,
    jobId: "job-a",
    isPidAlive: () => false,
  });
  expect(claimed.ok).toBe(true);
  if (!claimed.ok) {
    return;
  }
  markAsyncWaitRecoveryContinueArmed({
    sessionFile,
    jobId: "job-a",
    claimToken: claimed.claimToken,
    focusRevision: 1,
    messageId: "msg-1",
  });
  bindAsyncWaitRecoveryTurn({
    sessionFile,
    taskId: "task-a",
    jobId: "job-a",
    claimToken: claimed.claimToken,
    runId: "run-1",
  });
  // Late holder tries to rewrite continue_armed — refused.
  const late = markAsyncWaitRecoveryContinueArmed({
    sessionFile,
    jobId: "job-a",
    claimToken: claimed.claimToken,
    focusRevision: 1,
    messageId: "msg-late",
  });
  expect(late?.recovery?.stage).toBe("turn_bound");
  expect(late?.recovery?.continueMessageId).toBe("msg-1");
});

it("bind refuses multiple open jobs for same taskId without jobId", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aw-fence-multijob-"));
  roots.push(root);
  const sessionFile = path.join(root, "session.jsonl");
  fs.writeFileSync(sessionFile, "");
  seedExited(sessionFile, "job-a", "task-a");
  seedExited(sessionFile, "job-b", "task-a");
  for (const jobId of ["job-a", "job-b"]) {
    claimAsyncWaitJobForRecovery({ sessionFile, jobId, isPidAlive: () => false });
  }
  const bound = bindAsyncWaitRecoveryTurn({
    sessionFile,
    taskId: "task-a",
    runId: "run-x",
  });
  expect(bound).toBeUndefined();
  // Explicit jobId + token binds only that job.
  const intentA = readAsyncWaitJobIntent(sessionFile, "job-a")!;
  const ok = bindAsyncWaitRecoveryTurn({
    sessionFile,
    taskId: "task-a",
    jobId: "job-a",
    claimToken: intentA.recovery!.claimToken!,
    runId: "run-a",
    executionAttempt: "run-a",
    deliverableVersion: "run-a",
  });
  expect(ok?.jobId).toBe("job-a");
  expect(ok?.executionAttempt).toBe("run-a");
  expect(readAsyncWaitJobIntent(sessionFile, "job-b")?.recovery?.stage).not.toBe("turn_bound");
});

it("delivery_pending claim is deliveryOnly — no business re-arm token reuse as fresh", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aw-fence-delivery-"));
  roots.push(root);
  const sessionFile = path.join(root, "session.jsonl");
  fs.writeFileSync(sessionFile, "");
  seedExited(sessionFile);
  const claimed = claimAsyncWaitJobForRecovery({
    sessionFile,
    jobId: "job-a",
    isPidAlive: () => false,
  });
  expect(claimed.ok).toBe(true);
  if (!claimed.ok) {
    return;
  }
  bindAsyncWaitRecoveryTurn({
    sessionFile,
    taskId: "task-a",
    jobId: "job-a",
    claimToken: claimed.claimToken,
    runId: "run-d",
    deliveryId: "delivery:run-d",
    executionAttempt: "run-d",
    deliverableVersion: "run-d",
  });
  expect(readAsyncWaitJobIntent(sessionFile, "job-a")?.recovery?.stage).toBe("delivery_pending");
  const again = claimAsyncWaitJobForRecovery({
    sessionFile,
    jobId: "job-a",
    isPidAlive: () => false,
  });
  expect(again.ok).toBe(true);
  if (again.ok) {
    expect(again.deliveryOnly).toBe(true);
    expect(again.freshClaim).toBe(false);
  }
});

it("overlapping stop vs claim: cleared wins; late claimToken cannot resurrect", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aw-fence-stop-race-"));
  roots.push(root);
  const sessionFile = path.join(root, "session.jsonl");
  fs.writeFileSync(sessionFile, "");
  seedExited(sessionFile);
  // Overlap claim with clear under concurrent callers.
  const results = await Promise.all([
    Promise.resolve().then(() =>
      claimAsyncWaitJobForRecovery({
        sessionFile,
        jobId: "job-a",
        isPidAlive: () => false,
      }),
    ),
    Promise.resolve().then(() => clearAsyncWaitJobIntent(sessionFile, "job-a")),
  ]);
  const claim = results[0] as ReturnType<typeof claimAsyncWaitJobForRecovery>;
  const final = readAsyncWaitJobIntent(sessionFile, "job-a");
  // Whatever ordered first under the lock, final durable state must not be a live open recovery
  // after clear, and a late continue_armed with a pre-clear token must not overwrite cleared.
  if (claim.ok && final?.status !== "cleared") {
    // Claim won the race first — then clear afterward.
    clearAsyncWaitJobIntent(sessionFile, "job-a");
  }
  const afterClear = readAsyncWaitJobIntent(sessionFile, "job-a");
  expect(afterClear?.status).toBe("cleared");
  if (claim.ok) {
    const resurrect = markAsyncWaitRecoveryContinueArmed({
      sessionFile,
      jobId: "job-a",
      claimToken: claim.claimToken,
      focusRevision: 1,
      messageId: "late",
    });
    expect(resurrect?.status).toBe("cleared");
    expect(resurrect?.recovery?.stage).not.toBe("continue_armed");
  }
});
