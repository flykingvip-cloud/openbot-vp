import type { TaskCompletionBinding } from "../../contracts/task-binding.js";
import type { SessionTaskBoard } from "../../contracts/task.js";
import { activeConstraintTexts, isTaskTombstoned, isLiveTaskBinding } from "../../policy/index.js";
import {
  cloneBoardShell,
  mutateSessionTaskBoard,
  readSessionTaskBoard,
} from "../repository/task-board-file.js";

/** Capture only an already-associated task; never bind completion to a newer current task. */
export function captureTaskCompletionBinding(
  sessionFile?: string | null,
  expectedGoal?: string,
): TaskCompletionBinding | undefined {
  if (!sessionFile?.trim()) {
    return undefined;
  }
  const task = readSessionTaskBoard(sessionFile).current;
  if (
    expectedGoal !== undefined &&
    task?.goalText.replace(/\s+/g, " ").trim() !== expectedGoal.replace(/\s+/g, " ").trim()
  ) {
    return undefined;
  }
  return task?.unfinished
    ? {
        taskId: task.taskId,
        executionAttempt: task.executionAttempt,
        deliverableVersion: task.deliverableVersion,
        constraints: activeConstraintTexts(task),
      }
    : undefined;
}

/** Bind a new execution only to the task already captured by its request. */
export function startBoundTaskExecution(
  sessionFile: string,
  binding: TaskCompletionBinding | undefined,
  executionAttempt: string,
): TaskCompletionBinding | undefined {
  if (!binding?.taskId || !executionAttempt.trim()) {
    return undefined;
  }
  return mutateSessionTaskBoard(sessionFile, (board) => {
    const current = board.current;
    if (
      !current?.unfinished ||
      current.wakeSuppress ||
      isTaskTombstoned(board, binding.taskId) ||
      current.taskId !== binding.taskId ||
      current.executionAttempt !== binding.executionAttempt ||
      current.deliverableVersion !== binding.deliverableVersion
    ) {
      return { board, value: undefined };
    }
    if (
      JSON.stringify(binding.constraints ?? []) !== JSON.stringify(activeConstraintTexts(current))
    ) {
      return { board, value: undefined };
    }
    const next = {
      ...binding,
      executionAttempt,
      deliverableVersion: executionAttempt,
      constraints: activeConstraintTexts(current),
    };
    return {
      board: bindCurrentExecution({
        board,
        taskId: next.taskId,
        executionAttempt: next.executionAttempt,
        deliverableVersion: next.deliverableVersion,
      }),
      value: next,
    };
  });
}

/** Read-only startup guard for an already-claimed execution. */
export function isTaskExecutionBindingCurrent(
  sessionFile: string,
  binding: TaskCompletionBinding,
): boolean {
  const board = readSessionTaskBoard(sessionFile);
  return isLiveTaskBinding(board, binding, activeConstraintTexts(board.current));
}

/**
 * Stamp the current focus with deliverable version + attempt before execution (C4).
 * No-op when taskId does not match current.
 */
export function bindCurrentExecution(params: {
  board: SessionTaskBoard;
  taskId: string;
  deliverableVersion: string;
  executionAttempt: string;
}): SessionTaskBoard {
  const board = cloneBoardShell(params.board);
  const current = board.current;
  if (!current || current.taskId !== params.taskId.trim()) {
    return params.board;
  }
  return {
    ...board,
    current: {
      ...current,
      deliverableVersion: params.deliverableVersion,
      executionAttempt: params.executionAttempt,
    },
  };
}
