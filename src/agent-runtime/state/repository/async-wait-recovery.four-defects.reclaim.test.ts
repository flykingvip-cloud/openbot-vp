/**
 * Package2 remelt regressions continued:
 * 6) Gateway-alive holder released after turn failure → recoverable, no permanent active_exec
 * 7) absent identity fields survive rollback; original binding can re-claim
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import {
  emptySessionTaskBoard,
  mutateSessionTaskBoard,
  readSessionTaskBoard,
} from "../../../conversation-task/session-task-board.js";
import { claimQueuedExecution } from "../mutations/claim-queued-execution.js";
import {
  markAsyncWaitJobExited,
  readAsyncWaitJobIntent,
  recordAsyncWaitJobIntent,
} from "./async-wait-job.js";
import { claimAsyncWaitJobForRecovery } from "./async-wait-recovery-claim.js";
import {
  bindAsyncWaitRecoveryTurn,
  releaseAsyncWaitRecoveryTurn,
} from "./async-wait-recovery-turn.js";
import { roots, seed } from "./async-wait-recovery.four-defects.fixture.js";

it("Gateway-alive holder after turn failure release: recoverable, no permanent active_exec", () => {
  const { sessionFile, jobId, taskId } = seed();
  const claimed = claimAsyncWaitJobForRecovery({
    sessionFile,
    jobId,
    isPidAlive: () => false,
  });
  expect(claimed.ok).toBe(true);
  if (!claimed.ok) {
    return;
  }
  mutateSessionTaskBoard(sessionFile, (board) => ({
    board: {
      ...board,
      current: board.current
        ? {
            ...board.current,
            executionAttempt: "run-auth-fail",
            deliverableVersion: "run-auth-fail",
          }
        : board.current,
    },
    value: undefined,
  }));
  const bound = bindAsyncWaitRecoveryTurn({
    sessionFile,
    taskId,
    jobId,
    claimToken: claimed.claimToken,
    runId: "run-auth-fail",
    sessionId: "sess-auth",
    holderPid: process.pid, // Gateway process still alive
  });
  expect(bound.accepted).toBe(true);

  // Before release: alive holder ⇒ active_exec (cannot dual-claim).
  const blocked = claimAsyncWaitJobForRecovery({
    sessionFile,
    jobId,
    isPidAlive: (pid) => pid === process.pid,
    isEmbeddedPiRunActive: () => false,
  });
  expect(blocked.ok).toBe(false);
  if (!blocked.ok) {
    expect(blocked.reason).toBe("active_exec");
  }

  // Controlled-turn auth/provider failure → release holder (fence old token).
  const released = releaseAsyncWaitRecoveryTurn({
    sessionFile,
    jobId,
    claimToken: claimed.claimToken,
    runId: "run-auth-fail",
  });
  expect(released.released).toBe(true);
  if (!released.released) {
    return;
  }
  expect(released.claimToken).not.toBe(claimed.claimToken);
  const mid = readAsyncWaitJobIntent(sessionFile, jobId);
  expect(mid?.recovery?.stage).toBe("continue_armed");
  expect(mid?.recovery?.boundRunId).toBeUndefined();
  expect(mid?.recovery?.holderPid).toBeUndefined();

  // Gateway still alive, but claim is released → recovery can proceed again
  // (continue_armed with fenced token; not permanent active_exec).
  const again = claimAsyncWaitJobForRecovery({
    sessionFile,
    jobId,
    isPidAlive: (pid) => pid === process.pid,
    isEmbeddedPiRunActive: () => false,
  });
  expect(again.ok).toBe(true);
  if (!again.ok) {
    return;
  }
  // Release already bumped generation/token; recheck returns that armed claim (not active_exec).
  expect(again.claimToken).not.toBe(claimed.claimToken);
  expect(again.claimToken).toBe(released.claimToken);
  // New token can bind a recovery run.
  mutateSessionTaskBoard(sessionFile, (board) => ({
    board: {
      ...board,
      current: board.current
        ? { ...board.current, executionAttempt: "run-retry", deliverableVersion: "run-retry" }
        : board.current,
    },
    value: undefined,
  }));
  const rebind = bindAsyncWaitRecoveryTurn({
    sessionFile,
    taskId,
    jobId,
    claimToken: again.claimToken,
    runId: "run-retry",
    holderPid: process.pid,
  });
  expect(rebind.accepted).toBe(true);
  // Old token cannot bind (fenced by release).
  const oldBind = bindAsyncWaitRecoveryTurn({
    sessionFile,
    taskId,
    jobId,
    claimToken: claimed.claimToken,
    runId: "run-stale",
  });
  expect(oldBind.accepted).toBe(false);
});

it("absent identity fields survive failed-claim rollback; original binding re-claims", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aw-4def-absent-"));
  roots.push(root);
  const sessionFile = path.join(root, "session.jsonl");
  fs.writeFileSync(sessionFile, "");
  const taskId = "task-absent";
  const jobId = "job-absent";
  // Board current with MISSING executionAttempt / deliverableVersion (not "").
  mutateSessionTaskBoard(sessionFile, () => ({
    board: {
      ...emptySessionTaskBoard(),
      current: {
        taskId,
        title: "t",
        goalText: "g",
        unfinished: true,
        createdAtMs: 1,
        stop: { summary: "", workspacePaths: [] },
      },
    },
    value: undefined,
  }));
  const board0 = readSessionTaskBoard(sessionFile).current;
  expect(board0?.executionAttempt).toBeUndefined();
  expect(board0?.deliverableVersion).toBeUndefined();

  recordAsyncWaitJobIntent({
    jobId,
    sessionKey: "agent:bot:main",
    sessionFile,
    taskId,
    executionAttempt: "placeholder",
    deliverableVersion: "placeholder",
    pid: 999_888_777,
    startedAt: Date.now(),
  });
  markAsyncWaitJobExited({ sessionFile, jobId, exitStatus: "completed", exitCode: 0 });

  const claimed = claimAsyncWaitJobForRecovery({
    sessionFile,
    jobId,
    isPidAlive: () => false,
  });
  expect(claimed.ok).toBe(true);
  if (!claimed.ok) {
    return;
  }

  // Original binding with absent identity fields.
  const originalBinding = {
    taskId,
    constraints: [] as string[],
    // executionAttempt / deliverableVersion intentionally omitted (undefined)
  };

  // Failed claim (wrong token) → CAS rollback must restore absent shape, not "".
  const failed = claimQueuedExecution({
    sessionFile,
    runId: "run-should-roll-back",
    prompt: "go",
    binding: originalBinding,
    asyncWaitRecovery: { jobId, claimToken: "wrong-token" },
    sessionId: "sess",
    collaboration: false,
    privatePlan: false,
  });
  expect(failed.kind).toBe("rejected");
  const afterRollback = readSessionTaskBoard(sessionFile).current;
  expect(afterRollback?.executionAttempt).toBeUndefined();
  expect(afterRollback?.deliverableVersion).toBeUndefined();
  // Must not be empty string — that would break strict identity compare.
  expect(afterRollback).not.toHaveProperty("executionAttempt", "");
  expect(Object.prototype.hasOwnProperty.call(afterRollback ?? {}, "executionAttempt")).toBe(false);

  // Re-claim with the original binding succeeds.
  const ok = claimQueuedExecution({
    sessionFile,
    runId: "run-reclaim-ok",
    prompt: "go again",
    binding: originalBinding,
    asyncWaitRecovery: { jobId, claimToken: claimed.claimToken },
    sessionId: "sess",
    collaboration: false,
    privatePlan: false,
  });
  expect(ok.kind).toBe("accepted");
  if (ok.kind === "accepted") {
    expect(ok.binding?.executionAttempt).toBe("run-reclaim-ok");
  }
  expect(readAsyncWaitJobIntent(sessionFile, jobId)?.recovery?.boundRunId).toBe("run-reclaim-ok");
});
