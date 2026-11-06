import {
  activeConstraintTexts,
  readSessionTaskBoard,
} from "../../conversation-task/session-task-board.js";
import type { TaskCompletionBinding } from "../contracts/task.js";
import { isLiveTaskBinding } from "../policy/index.js";

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
  const board = readSessionTaskBoard(boundary.sessionFile);
  const constraints = activeConstraintTexts(board.current);
  if (
    !isLiveTaskBinding(
      board,
      {
        ...boundary.binding,
        constraints: undefined,
      },
      constraints,
    )
  ) {
    return "Task action refused: original task was paused, cancelled, completed or replaced.";
  }
  if (JSON.stringify(constraints) !== JSON.stringify(boundary.constraints)) {
    return "Task action refused: accepted constraints changed; resume the original task with its latest constraints before another tool action.";
  }
  return undefined;
}
