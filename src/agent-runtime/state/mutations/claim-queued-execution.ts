import type { TaskCompletionBinding } from "../../contracts/task.js";
import { activeConstraintTexts } from "../../policy/index.js";
import { claimTaskBoardContinue } from "../continuation-ticket.js";
import { bindAsyncWaitRecoveryTurn } from "../repository/async-wait-job.js";
import { readSessionTaskBoard } from "../repository/task-board-file.js";
import { startBoundTaskExecution } from "./execution-binding.js";

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

/** Claim the original queued identity before commercial admission or provider work. */
export function claimQueuedExecution(input: {
  sessionFile: string;
  runId: string;
  prompt: string;
  binding?: TaskCompletionBinding;
  continuationTicket?: { taskId: string; focusRevision: number };
  /** Package2: bind specific job + claimToken (not first open job by taskId). */
  asyncWaitRecovery?: { jobId: string; claimToken: string };
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
    // Preserve recovery appendix (incl. unconfirmed-result WARNING) into final claimed prompt.
    prompt = mergeContinuePromptWithRecoveryAppendix(wake.prompt, input.prompt);
    binding = { ...binding, constraints: activeConstraintTexts(wake.task) };
  }
  const trackedIndividual =
    !input.collaboration &&
    !input.privatePlan &&
    Boolean(readSessionTaskBoard(input.sessionFile).current);
  if (binding || trackedIndividual) {
    const claimed = startBoundTaskExecution(input.sessionFile, binding, input.runId);
    if (!claimed) {
      return { kind: "rejected", reason: "invalid_binding" };
    }
    binding = claimed;
  }
  if (binding?.taskId) {
    bindAsyncWaitRecoveryTurn({
      sessionFile: input.sessionFile,
      taskId: binding.taskId,
      runId: input.runId,
      ...(input.asyncWaitRecovery
        ? {
            jobId: input.asyncWaitRecovery.jobId,
            claimToken: input.asyncWaitRecovery.claimToken,
          }
        : {}),
      // Sync intent attempt to the newly bound execution so recheck cannot clear with stale attempt.
      executionAttempt: binding.executionAttempt,
      deliverableVersion: binding.deliverableVersion,
    });
  }
  return { kind: "accepted", prompt, binding };
}
