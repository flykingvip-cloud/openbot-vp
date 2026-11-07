import fs from "node:fs";
import { renderCompletionNotice } from "../../context/sources/task-completion-notice.js";
import type { SessionTaskBoard, TaskCompletionBinding, TrackedTask } from "../../contracts/task.js";
import { activeConstraintTexts, isLiveTaskBinding, isTaskTombstoned } from "../../policy/index.js";
import { appendTaskCompletionNotice } from "../completion-notice.js";
import {
  cloneBoardShell,
  withSessionTaskBoardLock,
  readSessionTaskBoardUnlocked,
  writeSessionTaskBoardUnlocked,
} from "../repository/task-board-file.js";

/** Real close only. A model claim with closed=false does not announce or rewrite the board. */
export function recordCheckedTaskCompletion(params: {
  sessionFile?: string;
  closed: boolean;
  binding?: TaskCompletionBinding;
  /** Delivered result needs no extra transcript bubble. */
  appendNotice?: boolean;
}): {
  notice?: string;
  persisted: boolean;
} {
  if (!params.closed || !params.binding?.taskId?.trim()) {
    return { persisted: false };
  }
  const file = params.sessionFile?.trim();
  if (!file) {
    return { persisted: false };
  }
  // Lock contention / stale CAS must not crash the caller (cross-process completer
  // busy-loops). Surface persisted:false so the peer can retry.
  let finished: { board: SessionTaskBoard; notice?: string; rejected?: boolean };
  try {
    finished = withSessionTaskBoardLock(file, () => {
      const board = readSessionTaskBoardUnlocked(file);
      const binding = params.binding!;
      if (!isLiveTaskBinding(board, binding, activeConstraintTexts(board.current))) {
        return { board, rejected: true };
      }
      const result = finishCurrentTask({ board, deliverableChecked: true, ...binding });
      if (!result.rejected) {
        writeSessionTaskBoardUnlocked(file, result.board);
      }
      return result;
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    const message = err instanceof Error ? err.message : String(err);
    if (
      name === "StaleSessionTaskBoardWriteError" ||
      /lock|ELOCKED|timed out|timeout/i.test(message)
    ) {
      return { persisted: false };
    }
    throw err;
  }
  if (finished.rejected) {
    return { persisted: false };
  }
  if (params.appendNotice === false) {
    return { persisted: true };
  }
  const notice = finished.notice ?? renderCompletionNotice(finished.board.parked);
  let persisted = false;
  if (fs.existsSync(file)) {
    persisted = appendTaskCompletionNotice(file, params.binding, notice);
  }
  return { notice, persisted };
}

export function finishCurrentTask(params: {
  board: SessionTaskBoard;
  deliverableChecked: boolean;
  /** C4: complete must bind this taskId; mismatch → reject, board unchanged. */
  taskId?: string;
  /** C4: deliverable version stamp. */
  deliverableVersion?: string;
  /** C4: execution attempt stamp. */
  executionAttempt?: string;
}): {
  board: SessionTaskBoard;
  notice?: string;
  rejected?: boolean;
  reason?: string;
} {
  const board = cloneBoardShell(params.board);
  const current = board.current;
  if (!current) {
    return { board };
  }
  const expectedTaskId = params.taskId?.trim();
  if (expectedTaskId && expectedTaskId !== current.taskId) {
    return {
      board: params.board,
      rejected: true,
      reason: "task_id_mismatch",
    };
  }
  if (isTaskTombstoned(board, current.taskId)) {
    return {
      board: params.board,
      rejected: true,
      reason: "tombstoned",
    };
  }
  if (
    params.deliverableVersion &&
    current.deliverableVersion &&
    params.deliverableVersion !== current.deliverableVersion
  ) {
    return {
      board: params.board,
      rejected: true,
      reason: "deliverable_version_mismatch",
    };
  }
  if (
    params.executionAttempt &&
    current.executionAttempt &&
    params.executionAttempt !== current.executionAttempt
  ) {
    return {
      board: params.board,
      rejected: true,
      reason: "execution_attempt_mismatch",
    };
  }
  const nextCurrent: TrackedTask = {
    ...current,
    unfinished: false,
    deliverableChecked: params.deliverableChecked,
    ...(params.deliverableVersion ? { deliverableVersion: params.deliverableVersion } : {}),
    ...(params.executionAttempt ? { executionAttempt: params.executionAttempt } : {}),
  };
  const nextBoard: SessionTaskBoard = { ...board, current: nextCurrent };
  if (!params.deliverableChecked) {
    return { board: nextBoard };
  }
  return { board: nextBoard, notice: renderCompletionNotice(nextBoard.parked) };
}
