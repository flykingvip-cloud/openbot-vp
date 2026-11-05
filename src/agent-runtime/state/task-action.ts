import {
  activeConstraintTexts,
  isTaskExecutionBindingCurrent,
  readSessionTaskBoard,
} from "../../conversation-task/session-task-board.js";
import type { TaskCompletionBinding } from "../contracts/task.js";

export type TaskActionBoundary = {
  sessionFile: string;
  binding: TaskCompletionBinding;
  constraints: readonly string[];
};

/** Capture the constraints the current model attempt actually received. */
export function captureTaskActionBoundary(
  sessionFile: string,
  binding: TaskCompletionBinding,
): TaskActionBoundary {
  return {
    sessionFile,
    binding,
    constraints:
      binding.constraints ?? activeConstraintTexts(readSessionTaskBoard(sessionFile).current),
  };
}

/** Every action rechecks owner control, attempt identity and the model's constraint view. */
export function checkTaskActionBoundary(boundary: TaskActionBoundary): string | undefined {
  if (
    !isTaskExecutionBindingCurrent(boundary.sessionFile, {
      ...boundary.binding,
      constraints: undefined,
    })
  ) {
    return "Task action refused: original task was paused, cancelled, completed or replaced.";
  }
  const current = readSessionTaskBoard(boundary.sessionFile).current;
  if (JSON.stringify(activeConstraintTexts(current)) !== JSON.stringify(boundary.constraints)) {
    return "Task action refused: accepted constraints changed; resume the original task with its latest constraints before another tool action.";
  }
  return undefined;
}
