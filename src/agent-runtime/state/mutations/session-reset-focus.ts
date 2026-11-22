/**
 * /new unbinds the previous current task as the default modification target.
 * The old task is parked with an independent status; it is not cancelled.
 * Later admissions stamp the new reset generation and become the only
 * default target for revisions.
 */
import type { SessionTaskBoard, TrackedTask } from "../../contracts/task.js";
import {
  readSessionTaskBoardUnlocked,
  withSessionTaskBoardLock,
  writeSessionTaskBoardUnlocked,
} from "../repository/task-board-file.js";
import { bumpFocusRevision } from "./task-focus.js";
import { parkTask } from "./task-record.js";

export const SESSION_RESET_PARK_REASON = "session_reset";

export function currentResetGeneration(board: SessionTaskBoard): number {
  return board.resetGeneration ?? 0;
}

export function taskMatchesResetGeneration(
  task: TrackedTask | undefined,
  board: SessionTaskBoard,
): boolean {
  if (!task) {
    return false;
  }
  return (task.admittedGeneration ?? 0) === currentResetGeneration(board);
}

export type SessionResetFocusResult = {
  resetGeneration: number;
  parkedTaskId?: string;
  changed: boolean;
};

function unbindBoard(
  board: SessionTaskBoard,
  nowMs: number,
): {
  board: SessionTaskBoard;
  result: SessionResetFocusResult;
} {
  const current = board.current;
  const nextGeneration = currentResetGeneration(board) + 1;
  if (!current) {
    if (currentResetGeneration(board) === nextGeneration) {
      return {
        board,
        result: { resetGeneration: currentResetGeneration(board), changed: false },
      };
    }
    const nextBoard: SessionTaskBoard = {
      ...board,
      current: undefined,
      resetGeneration: nextGeneration,
      focusRevision: bumpFocusRevision(board),
    };
    return {
      board: nextBoard,
      result: { resetGeneration: nextGeneration, changed: true },
    };
  }
  const parkedCurrent: TrackedTask = {
    ...current,
    stop: {
      summary: current.stop.summary || `未完成：${current.title}`,
      workspacePaths: current.stop.workspacePaths,
    },
  };
  const parked = parkTask(board.parked, parkedCurrent, nowMs, SESSION_RESET_PARK_REASON);
  const archivedList = [...(board.archived ?? [])];
  if (parked.archived) {
    archivedList.unshift(parked.archived);
  }
  const nextBoard: SessionTaskBoard = {
    ...board,
    current: undefined,
    parked: parked.parked,
    archived: archivedList,
    resetGeneration: nextGeneration,
    focusRevision: bumpFocusRevision(board),
  };
  return {
    board: nextBoard,
    result: {
      resetGeneration: nextGeneration,
      parkedTaskId: current.taskId,
      changed: true,
    },
  };
}

/** Park the current task (do not cancel) and bump the session reset generation. */
export function unbindCurrentTaskOnSessionReset(
  sessionFile: string,
  nowMs = Date.now(),
): SessionResetFocusResult {
  const file = sessionFile.trim();
  if (!file) {
    return { resetGeneration: 0, changed: false };
  }
  return withSessionTaskBoardLock(file, () => {
    const live = readSessionTaskBoardUnlocked(file);
    const next = unbindBoard(live, nowMs);
    if (next.result.changed) {
      writeSessionTaskBoardUnlocked(file, next.board);
    }
    return next.result;
  });
}
