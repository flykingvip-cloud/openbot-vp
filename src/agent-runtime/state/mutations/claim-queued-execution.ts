import type { TaskCompletionBinding } from "../../contracts/task.js";
import { activeConstraintTexts } from "../../policy/index.js";
import { claimTaskBoardContinue } from "../continuation-ticket.js";
import { bindAsyncWaitRecoveryTurn } from "../repository/async-wait-job.js";
import { mutateSessionTaskBoard, readSessionTaskBoard } from "../repository/task-board-file.js";
import { bindCurrentExecution, startBoundTaskExecution } from "./execution-binding.js";

const RECOVERY_APPENDIX_MARKER = "Async-wait job recovery context (Package2):";

/** Extract Package2 recovery evidence appendix so wake.prompt cannot drop it. */
export function extractAsyncWaitRecoveryAppendix(prompt: string): string | undefined {
  const text = prompt ?? "";
  const idx = text.indexOf(RECOVERY_APPENDIX_MARKER);
  if (idx < 0) {
    return undefined;
  }
  return text.slice(idx).trim();
}

/** Merge board continue prompt with preserved recovery evidence appendix. */
export function mergeContinuePromptWithRecoveryAppendix(
  wakePrompt: string,
  inputPrompt: string,
): string {
  const appendix = extractAsyncWaitRecoveryAppendix(inputPrompt);
  if (!appendix) {
    return wakePrompt;
  }
  if (wakePrompt.includes(RECOVERY_APPENDIX_MARKER)) {
    return wakePrompt;
  }
  return [wakePrompt.trimEnd(), "", appendix].join("\n");
}

/** Restore board attempt after a failed exclusive recovery bind. */
function restoreBoardExecutionAttempt(
  sessionFile: string,
  taskId: string,
  previous: { executionAttempt?: string; deliverableVersion?: string },
): void {
  mutateSessionTaskBoard(sessionFile, (board) => {
    const current = board.current;
    if (!current || current.taskId !== taskId) {
      return { board, value: undefined };
    }
    if (!previous.executionAttempt || !previous.deliverableVersion) {
      return { board, value: undefined };
    }
    return {
      board: bindCurrentExecution({
        board,
        taskId,
        executionAttempt: previous.executionAttempt,
        deliverableVersion: previous.deliverableVersion,
      }),
      value: undefined,
    };
  });
}

/** Claim the original queued identity before commercial admission or provider work. */
export function claimQueuedExecution(input: {
  sessionFile: string;
  runId: string;
  prompt: string;
  binding?: TaskCompletionBinding;
  continuationTicket?: { taskId: string; focusRevision: number };
  /** Package2: bind specific job + claimToken (required for exclusive recovery bind). */
  asyncWaitRecovery?: { jobId: string; claimToken: string };
  /** Session id for live-vs-dead run liveness on the recovery intent. */
  sessionId?: string;
  collaboration: boolean;
  privatePlan: boolean;
}):
  | { kind: "accepted"; prompt: string; binding?: TaskCompletionBinding }
  | { kind: "rejected"; reason: "stale_wake" | "invalid_binding" } {
  let prompt = input.prompt;
  let binding = input.binding;
  const ticket = input.continuationTicket;
  if (ticket) {
    const wake = claimTaskBoardContinue({ sessionFile: input.sessionFile, ...ticket });
    if (!wake.ok || binding?.taskId !== ticket.taskId) {
      return { kind: "rejected", reason: "stale_wake" };
    }
    prompt = mergeContinuePromptWithRecoveryAppendix(wake.prompt, input.prompt);
    binding = { ...binding, constraints: activeConstraintTexts(wake.task) };
  }
  const trackedIndividual =
    !input.collaboration &&
    !input.privatePlan &&
    Boolean(readSessionTaskBoard(input.sessionFile).current);

  const previousAttempt = binding?.executionAttempt;
  const previousDeliverable = binding?.deliverableVersion;
  const recoveryRequired = Boolean(
    input.asyncWaitRecovery?.jobId?.trim() && input.asyncWaitRecovery?.claimToken?.trim(),
  );

  if (binding || trackedIndividual) {
    const claimed = startBoundTaskExecution(input.sessionFile, binding, input.runId);
    if (!claimed) {
      return { kind: "rejected", reason: "invalid_binding" };
    }
    binding = claimed;
  }

  if (recoveryRequired && binding?.taskId) {
    const bound = bindAsyncWaitRecoveryTurn({
      sessionFile: input.sessionFile,
      taskId: binding.taskId,
      runId: input.runId,
      jobId: input.asyncWaitRecovery!.jobId,
      claimToken: input.asyncWaitRecovery!.claimToken,
      sessionId: input.sessionId,
      executionAttempt: binding.executionAttempt,
      deliverableVersion: binding.deliverableVersion,
    });
    if (!bound) {
      // Bind failure MUST refuse execution and must not leave the wrong board attempt.
      restoreBoardExecutionAttempt(input.sessionFile, binding.taskId, {
        executionAttempt: previousAttempt,
        deliverableVersion: previousDeliverable,
      });
      return { kind: "rejected", reason: "invalid_binding" };
    }
  } else if (binding?.taskId && input.asyncWaitRecovery) {
    // Partial recovery bind params → refuse rather than first-open-by-taskId.
    restoreBoardExecutionAttempt(input.sessionFile, binding.taskId, {
      executionAttempt: previousAttempt,
      deliverableVersion: previousDeliverable,
    });
    return { kind: "rejected", reason: "invalid_binding" };
  }

  return { kind: "accepted", prompt, binding };
}
