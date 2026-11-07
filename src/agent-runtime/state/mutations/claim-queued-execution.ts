import {
  activeConstraintTexts,
  readSessionTaskBoard,
  startBoundTaskExecution,
} from "../../../conversation-task/session-task-board.js";
import { claimTaskBoardContinue } from "../../../conversation-task/task-board-continue.js";
import type { TaskCompletionBinding } from "../../contracts/task.js";

/** Claim the original queued identity before commercial admission or provider work. */
export function claimQueuedExecution(input: {
  sessionFile: string;
  runId: string;
  prompt: string;
  binding?: TaskCompletionBinding;
  continuationTicket?: { taskId: string; focusRevision: number };
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
    prompt = wake.prompt;
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
  return { kind: "accepted", prompt, binding };
}
