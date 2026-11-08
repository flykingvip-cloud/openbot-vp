/**
 * Package2 remelt regressions for acceptance defects:
 * 1) delivery-only resends original payloads (not placeholder)
 * 2) failed-claim board rollback CAS (no overwrite of concurrent attempt; absent prior shape)
 * 3) bind returns accepted/rejected (keep/record ≠ success)
 * 4) liveness covers prepare/cross-process; dead re-claim fences old holders
 * 5) same token + different runId bind refused (already_bound); original unchanged
 * 6) Gateway-alive holder released after turn failure → recoverable, no permanent active_exec
 * 7) absent identity fields survive rollback; original binding can re-claim
 */

import { expect, it } from "vitest";
import {
  mutateSessionTaskBoard,
  readSessionTaskBoard,
} from "../../../conversation-task/session-task-board.js";
import {
  claimQueuedExecution,
  restoreBoardExecutionAttemptAfterFailedBind,
} from "../mutations/claim-queued-execution.js";
import { readAsyncWaitJobIntent } from "./async-wait-job.js";
import { claimAsyncWaitJobForRecovery } from "./async-wait-recovery-claim.js";
import { bindAsyncWaitRecoveryTurn } from "./async-wait-recovery-turn.js";
import { seed } from "./async-wait-recovery.four-defects.fixture.js";

it("bind stores original payloads; delivery_pending retains them for retry match", () => {
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
  const payloads = [
    { text: "recovery report with verified sources", mediaUrl: "file://report.pdf" },
    { text: "appendix", mediaUrls: ["file://a.png", "file://b.png"] },
  ];
  const bound = bindAsyncWaitRecoveryTurn({
    sessionFile,
    taskId,
    jobId,
    claimToken: claimed.claimToken,
    runId: "run-vis",
    deliveryId: "delivery:run-vis:visible",
    executionAttempt: "run-vis",
    deliverableVersion: "run-vis",
    payloads,
  });
  expect(bound.accepted).toBe(true);
  const intent = readAsyncWaitJobIntent(sessionFile, jobId);
  expect(intent?.recovery?.stage).toBe("delivery_pending");
  expect(intent?.recovery?.boundPayloads).toEqual(payloads);
  expect(intent?.recovery?.boundDeliverableVersion).toBe("run-vis");
  // Must not look like the forbidden placeholder.
  const blob = JSON.stringify(intent?.recovery?.boundPayloads);
  expect(blob).not.toMatch(/Delivery retry/);
  expect(blob).toMatch(/recovery report with verified sources/);
  expect(blob).toMatch(/report\.pdf/);
});

it("bind rejected after token change/clear — accepted=false; keep/record ≠ success", () => {
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
  const ok = bindAsyncWaitRecoveryTurn({
    sessionFile,
    taskId,
    jobId,
    claimToken: claimed.claimToken,
    runId: "run-1",
  });
  expect(ok.accepted).toBe(true);
  // Stale token → explicit reject (record still exists).
  const stale = bindAsyncWaitRecoveryTurn({
    sessionFile,
    taskId,
    jobId,
    claimToken: "stale-token-not-current",
    runId: "run-2",
  });
  expect(stale.accepted).toBe(false);
  if (!stale.accepted) {
    expect(stale.reason).toBe("token_mismatch");
    expect(stale.intent?.recovery?.boundRunId).toBe("run-1");
  }
  // Missing jobId/token → reject (not first-open success).
  const missing = bindAsyncWaitRecoveryTurn({
    sessionFile,
    taskId,
    runId: "run-3",
  });
  expect(missing.accepted).toBe(false);
});

it("failed-claim rollback CAS: concurrent new attempt not overwritten; empty prior restored", () => {
  const { sessionFile, taskId } = seed();
  // Simulate startBound wrote run-old, then concurrent writer moved to run-new.
  mutateSessionTaskBoard(sessionFile, (board) => ({
    board: {
      ...board,
      current: board.current
        ? { ...board.current, executionAttempt: "run-new", deliverableVersion: "run-new" }
        : board.current,
    },
    value: undefined,
  }));
  const skipped = restoreBoardExecutionAttemptAfterFailedBind(
    sessionFile,
    taskId,
    "run-old", // this write's attempt — board already moved on
    { executionAttempt: "attempt-0", deliverableVersion: "attempt-0" },
  );
  expect(skipped).toBe(false);
  expect(readSessionTaskBoard(sessionFile).current?.executionAttempt).toBe("run-new");

  // Empty original attempt: board still has this write → restore to empty.
  mutateSessionTaskBoard(sessionFile, (board) => ({
    board: {
      ...board,
      current: board.current
        ? { ...board.current, executionAttempt: "run-fail", deliverableVersion: "run-fail" }
        : board.current,
    },
    value: undefined,
  }));
  const restored = restoreBoardExecutionAttemptAfterFailedBind(sessionFile, taskId, "run-fail", {
    executionAttempt: "",
    deliverableVersion: "",
  });
  expect(restored).toBe(true);
  expect(readSessionTaskBoard(sessionFile).current?.executionAttempt).toBe("");
});

it("claimQueuedExecution refuses when bind rejected; does not leave wrong board attempt", () => {
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
  const before = readSessionTaskBoard(sessionFile).current?.executionAttempt;
  const result = claimQueuedExecution({
    sessionFile,
    runId: "run-should-refuse",
    prompt: "go",
    binding: {
      taskId,
      executionAttempt: before!,
      deliverableVersion: before!,
      constraints: [],
    },
    asyncWaitRecovery: { jobId, claimToken: "wrong-token" },
    sessionId: "sess",
    collaboration: false,
    privatePlan: false,
  });
  expect(result.kind).toBe("rejected");
  // Board must not stay on the refused run.
  expect(readSessionTaskBoard(sessionFile).current?.executionAttempt).toBe(before);
});

it("prepare-phase holder (no embedded) is live; dead holder fences with new token", () => {
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
        ? { ...board.current, executionAttempt: "run-prep", deliverableVersion: "run-prep" }
        : board.current,
    },
    value: undefined,
  }));
  const bound = bindAsyncWaitRecoveryTurn({
    sessionFile,
    taskId,
    jobId,
    claimToken: claimed.claimToken,
    runId: "run-prep",
    sessionId: "sess-prep",
    holderPid: 424242,
  });
  expect(bound.accepted).toBe(true);
  expect(readAsyncWaitJobIntent(sessionFile, jobId)?.recovery?.holderPid).toBe(424242);

  // Prepare/cross-process: holder pid alive, embedded inactive → still active_exec.
  const preparing = claimAsyncWaitJobForRecovery({
    sessionFile,
    jobId,
    isPidAlive: (pid) => pid === 424242,
    isEmbeddedPiRunActive: () => false,
  });
  expect(preparing.ok).toBe(false);
  if (!preparing.ok) {
    expect(preparing.reason).toBe("active_exec");
  }

  // Holder dead → fence old token.
  const dead = claimAsyncWaitJobForRecovery({
    sessionFile,
    jobId,
    isPidAlive: () => false,
    isEmbeddedPiRunActive: () => false,
  });
  expect(dead.ok).toBe(true);
  if (!dead.ok) {
    return;
  }
  expect(dead.freshClaim).toBe(true);
  expect(dead.claimToken).not.toBe(claimed.claimToken);
  // Old token cannot bind anymore.
  const oldBind = bindAsyncWaitRecoveryTurn({
    sessionFile,
    taskId,
    jobId,
    claimToken: claimed.claimToken,
    runId: "run-old-holder",
  });
  expect(oldBind.accepted).toBe(false);
});

it("recheck during prepare does not double-claim while holder live", () => {
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
        ? { ...board.current, executionAttempt: "run-hold", deliverableVersion: "run-hold" }
        : board.current,
    },
    value: undefined,
  }));
  bindAsyncWaitRecoveryTurn({
    sessionFile,
    taskId,
    jobId,
    claimToken: claimed.claimToken,
    runId: "run-hold",
    sessionId: "sess-hold",
    holderPid: process.pid,
  });
  const gen = readAsyncWaitJobIntent(sessionFile, jobId)?.recovery?.claimGeneration;
  const again = claimAsyncWaitJobForRecovery({
    sessionFile,
    jobId,
    isPidAlive: (pid) => pid === process.pid,
    isEmbeddedPiRunActive: () => false,
  });
  expect(again.ok).toBe(false);
  if (!again.ok) {
    expect(again.reason).toBe("active_exec");
  }
  expect(readAsyncWaitJobIntent(sessionFile, jobId)?.recovery?.claimGeneration).toBe(gen);
  expect(readAsyncWaitJobIntent(sessionFile, jobId)?.recovery?.claimToken).toBe(claimed.claimToken);
});

it("same token different runId bind refused; original binding unchanged", () => {
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
  const first = bindAsyncWaitRecoveryTurn({
    sessionFile,
    taskId,
    jobId,
    claimToken: claimed.claimToken,
    runId: "run-original",
    sessionId: "sess-a",
    holderPid: 111,
  });
  expect(first.accepted).toBe(true);
  const before = readAsyncWaitJobIntent(sessionFile, jobId);
  expect(before?.recovery?.boundRunId).toBe("run-original");
  expect(before?.recovery?.holderPid).toBe(111);
  const gen = before?.recovery?.claimGeneration;

  // Same token, different run → refuse overwrite under lock.
  const second = bindAsyncWaitRecoveryTurn({
    sessionFile,
    taskId,
    jobId,
    claimToken: claimed.claimToken,
    runId: "run-intruder",
    sessionId: "sess-b",
    holderPid: 222,
  });
  expect(second.accepted).toBe(false);
  if (!second.accepted) {
    expect(second.reason).toBe("already_bound");
  }
  const after = readAsyncWaitJobIntent(sessionFile, jobId);
  expect(after?.recovery?.boundRunId).toBe("run-original");
  expect(after?.recovery?.holderPid).toBe(111);
  expect(after?.recovery?.claimToken).toBe(claimed.claimToken);
  expect(after?.recovery?.claimGeneration).toBe(gen);

  // Same-run idempotent retry still accepted.
  const idem = bindAsyncWaitRecoveryTurn({
    sessionFile,
    taskId,
    jobId,
    claimToken: claimed.claimToken,
    runId: "run-original",
    sessionId: "sess-a",
    holderPid: 111,
  });
  expect(idem.accepted).toBe(true);
});
