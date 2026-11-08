/**
 * Cross-process child for Package2 async-wait recovery (lock / receipt wiring).
 * Modes: write-wait | claim-once | clear-stop | arm-and-execute | crash-after-claim | retry-after-crash
 *
 * Evidence: real process. arm-and-execute manually injects claim + outcome + confirmPending —
 * it is NOT the production followup→transport loop (see production-path.test.ts).
 */
import fs from "node:fs";
import path from "node:path";
import { confirmPendingTurnDeliveryWithPorts } from "../../../src/agent-runtime/delivery/dispatch/confirm-pending.js";
import { claimQueuedExecution } from "../../../src/agent-runtime/state/mutations/claim-queued-execution.js";
import { armAsyncWaitRecoveryContinuation } from "../../../src/agent-runtime/state/repository/async-wait-job-recovery.js";
import {
  clearAsyncWaitJobIntent,
  markAsyncWaitJobExited,
  readAsyncWaitJobIntent,
  recordAsyncWaitJobIntent,
} from "../../../src/agent-runtime/state/repository/async-wait-job.js";
import { claimAsyncWaitJobForRecovery } from "../../../src/agent-runtime/state/repository/async-wait-recovery-claim.js";
import {
  markAsyncWaitRecoveryDelivered,
  bindAsyncWaitRecoveryTurn,
} from "../../../src/agent-runtime/state/repository/async-wait-recovery-turn.js";
import {
  emptySessionTaskBoard,
  mutateSessionTaskBoard,
  readSessionTaskBoard,
  recordCheckedTaskCompletion,
  isTaskExecutionBindingCurrent,
  captureTaskCompletionBinding,
  startBoundTaskExecution,
  suppressCurrentTaskWake,
} from "../../../src/conversation-task/session-task-board.js";
import {
  registerAwaitingDelivery,
  peekAwaitingDelivery,
  clearAwaitingDeliveriesForTests,
} from "../../../src/task-outcome/pending-delivery.js";
import { recordRunnerTurnOutcome } from "../../../src/task-outcome/runtime-from-runner.js";

const root = process.argv[2];
const mode = process.argv[3];
const sessionFile = path.join(root, "session.jsonl");
const persistRoot = path.join(root, "task-outcomes");
const jobId = "job-cross";
const sessionKey = "agent:bot:main";

function ensureBoard() {
  if (!fs.existsSync(sessionFile)) {
    fs.writeFileSync(sessionFile, "");
  }
  const board = readSessionTaskBoard(sessionFile);
  if (board.current?.taskId) {
    return startBoundTaskExecution(
      sessionFile,
      captureTaskCompletionBinding(sessionFile),
      board.current.executionAttempt ?? "run-a",
    )!;
  }
  mutateSessionTaskBoard(sessionFile, () => ({
    board: {
      ...emptySessionTaskBoard(),
      focusRevision: 1,
      current: {
        taskId: "task-a",
        title: "A",
        goalText: "A",
        unfinished: true,
        createdAtMs: 1,
        stop: { summary: "waiting", workspacePaths: [] },
      },
    },
    value: undefined,
  }));
  return startBoundTaskExecution(sessionFile, captureTaskCompletionBinding(sessionFile), "run-a")!;
}

if (mode === "write-wait") {
  fs.mkdirSync(root, { recursive: true });
  const binding = ensureBoard();
  recordAsyncWaitJobIntent({
    jobId,
    sessionKey,
    sessionFile,
    taskId: binding.taskId,
    executionAttempt: binding.executionAttempt!,
    deliverableVersion: binding.deliverableVersion!,
    constraints: [...(binding.constraints ?? [])],
    pid: 999_999_880,
    startedAt: Date.now(),
    command: "sleep 1",
  });
  markAsyncWaitJobExited({
    sessionFile,
    jobId,
    exitStatus: "completed",
    exitCode: 0,
    summary: "cross-process result ready",
  });
  console.log(JSON.stringify({ wrote: true, taskId: binding.taskId }));
} else if (mode === "claim-once") {
  const claimed = claimAsyncWaitJobForRecovery({
    sessionFile,
    jobId,
    isPidAlive: () => false,
  });
  const outPath = path.join(root, `claim-${process.pid}.json`);
  fs.writeFileSync(
    outPath,
    JSON.stringify({
      ok: claimed.ok,
      claimToken: claimed.ok ? claimed.claimToken : null,
      freshClaim: claimed.ok ? claimed.freshClaim : false,
      stage: claimed.ok ? claimed.intent.recovery?.stage : null,
      generation: claimed.ok ? claimed.intent.recovery?.claimGeneration : null,
    }),
  );
  console.log(JSON.stringify({ pid: process.pid, wrote: outPath }));
} else if (mode === "clear-stop") {
  ensureBoard();
  mutateSessionTaskBoard(sessionFile, (board) => {
    const result = suppressCurrentTaskWake({ board, sessionFile });
    return { board: result.board, value: undefined };
  });
  clearAsyncWaitJobIntent(sessionFile, jobId);
  console.log(
    JSON.stringify({ cleared: true, status: readAsyncWaitJobIntent(sessionFile, jobId)?.status }),
  );
} else if (mode === "crash-after-claim") {
  const claimed = claimAsyncWaitJobForRecovery({
    sessionFile,
    jobId,
    isPidAlive: () => false,
  });
  fs.writeFileSync(
    path.join(root, "crash-claim.json"),
    JSON.stringify({
      ok: claimed.ok,
      claimToken: claimed.ok ? claimed.claimToken : null,
      stage: claimed.ok ? claimed.intent.recovery?.stage : null,
    }),
  );
  // Simulate crash before enqueue / continue_armed.
  console.log(JSON.stringify({ crashedAfterClaim: true }));
  process.exit(0);
} else if (mode === "retry-after-crash") {
  const intent = readAsyncWaitJobIntent(sessionFile, jobId)!;
  let enqueued = 0;
  const result = armAsyncWaitRecoveryContinuation({
    intent,
    isPidAlive: () => false,
    enqueue: () => {
      enqueued += 1;
      return true;
    },
  });
  console.log(
    JSON.stringify({
      outcome: result.outcome,
      enqueued,
      stage: readAsyncWaitJobIntent(sessionFile, jobId)?.recovery?.stage,
      evidenceKind: readAsyncWaitJobIntent(sessionFile, jobId)?.resultEvidence?.kind,
    }),
  );
} else if (mode === "arm-and-execute") {
  clearAwaitingDeliveriesForTests();
  const binding = ensureBoard();
  const intent = readAsyncWaitJobIntent(sessionFile, jobId)!;
  const cfg = { agents: { list: [{ id: "bot", agentDir: root }] } };
  let enqueuedPrompt = "";
  const arm = armAsyncWaitRecoveryContinuation({
    intent,
    isPidAlive: () => false,
    enqueue: (params) => {
      enqueuedPrompt = params.prompt;
      return true;
    },
  });
  // Real mainline claim with continuation ticket + binding from board.
  const board = readSessionTaskBoard(sessionFile);
  const runId = `run-recovery-${process.pid}`;
  const claimed = claimQueuedExecution({
    sessionFile,
    runId,
    prompt: enqueuedPrompt || "continue",
    binding: captureTaskCompletionBinding(sessionFile) ?? undefined,
    continuationTicket: {
      taskId: binding.taskId,
      focusRevision: board.focusRevision ?? 1,
    },
    collaboration: false,
    privatePlan: false,
  });
  if (claimed.kind !== "accepted" || !claimed.binding) {
    console.log(JSON.stringify({ arm: arm.outcome, claimed, error: "claim_rejected" }));
    process.exit(0);
  }
  const deliveryId = `delivery:${runId}:visible`;
  const outcomeTaskId = `outcome-${binding.taskId}`;
  await recordRunnerTurnOutcome(cfg, "bot", {
    success: true,
    runId,
    taskId: outcomeTaskId,
    scope: {
      kind: "personal",
      personalDomainId: "domain",
      subjectRef: "user",
      authzScopeRef: "scope",
    },
    acceptance: { status: "passed" },
    delivery: { status: "pending" },
    deliveryId,
  });
  registerAwaitingDelivery({
    taskId: outcomeTaskId,
    deliveryId,
    agentId: "bot",
    runId,
    persistRoot,
    checkedTask: { sessionFile, binding: claimed.binding },
  });
  const armedIntent = readAsyncWaitJobIntent(sessionFile, jobId);
  bindAsyncWaitRecoveryTurn({
    sessionFile,
    taskId: binding.taskId,
    jobId,
    claimToken: armedIntent?.recovery?.claimToken,
    runId,
    deliveryId,
    outcomeTaskId,
    executionAttempt: claimed.binding.executionAttempt,
    deliverableVersion: claimed.binding.deliverableVersion,
  });
  await confirmPendingTurnDeliveryWithPorts(
    {
      cfg: cfg as never,
      runId,
      deliveryId,
      taskId: outcomeTaskId,
      sessionKey,
      status: "delivered",
    },
    {
      resolvePersistRoot: () => persistRoot,
      completeTask: ({ sessionFile: sf, binding: b, closed, appendNotice }) =>
        recordCheckedTaskCompletion({
          sessionFile: sf,
          binding: b,
          closed,
          appendNotice,
        }),
      bindingCurrent: (sf, b) => isTaskExecutionBindingCurrent(sf, b),
    },
  );
  // confirm hook should mark delivered; also call explicitly for clarity in child
  markAsyncWaitRecoveryDelivered({ sessionFile, runId });
  const after = readAsyncWaitJobIntent(sessionFile, jobId);
  const boardAfter = readSessionTaskBoard(sessionFile);
  console.log(
    JSON.stringify({
      arm: arm.outcome,
      claimKind: claimed.kind,
      runId,
      deliveryId,
      pendingAfter: Boolean(peekAwaitingDelivery(runId)),
      recoveryStage: after?.recovery?.stage,
      boundRunId: after?.recovery?.boundRunId,
      taskUnfinished: boardAfter.current?.unfinished ?? null,
      promptHasUnconfirmed:
        enqueuedPrompt.includes("unconfirmed") || enqueuedPrompt.includes("WARNING"),
      promptHasEvidence: enqueuedPrompt.includes("evidenceKind="),
      claimedPromptHasEvidence: claimed.prompt.includes(
        "Async-wait job recovery context (Package2):",
      ),
      claimedPromptHasWarning:
        claimed.prompt.includes("WARNING") || claimed.prompt.includes("unconfirmed"),
    }),
  );
} else {
  console.error(`unknown mode ${mode}`);
  process.exit(2);
}
