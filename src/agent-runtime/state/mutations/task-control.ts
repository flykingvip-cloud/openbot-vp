import type { SessionTaskBoard, TrackedTask } from "../../contracts/task.js";
import type { IncomingTurnResult } from "../../contracts/turn-result.js";
import { clearAsyncWaitJobsForTask } from "../repository/async-wait-job.js";
import { cloneBoardShell } from "../repository/task-board-file.js";

export function findParked(board: SessionTaskBoard, token: string): TrackedTask | undefined {
  const needle = token.trim();
  if (!needle) {
    return undefined;
  }
  return board.parked.find((row) => row.taskId === needle || row.title === needle);
}

export function continueResult(
  board: SessionTaskBoard,
  taskId: string,
  statusLine?: string,
): IncomingTurnResult {
  return {
    board,
    action: "continue",
    taskId,
    cutContext: false,
    ...(statusLine ? { statusLine } : {}),
  };
}

export function suppressCurrentTaskWake(params: {
  board: SessionTaskBoard;
  reason?: string;
  sessionFile?: string;
}): IncomingTurnResult {
  const board = cloneBoardShell(params.board);
  const current = board.current;
  if (!current?.unfinished) {
    return {
      ...continueResult(board, current?.taskId ?? ""),
      focusRevision: board.focusRevision,
      statusLine: "当前没有进行中的任务可暂停。",
    };
  }
  const nextBoard: SessionTaskBoard = {
    ...board,
    current: { ...current, wakeSuppress: true },
  };
  const sessionFile = params.sessionFile?.trim();
  if (sessionFile) {
    clearAsyncWaitJobsForTask(sessionFile, current.taskId);
  }
  return {
    ...continueResult(nextBoard, current.taskId),
    focusRevision: board.focusRevision,
    abortInFlight: true,
    statusLine: `已暂停「${current.title}」：活动执行将停止新增业务动作，且不会因旧唤醒复活。`,
  };
}

export function cancelCurrentTask(params: {
  board: SessionTaskBoard;
  nowMs?: number;
  sessionFile?: string;
}): IncomingTurnResult {
  const board = cloneBoardShell(params.board);
  const current = board.current;
  if (!current) {
    return {
      ...continueResult(board, ""),
      focusRevision: board.focusRevision,
      statusLine: "当前没有任务可取消。",
    };
  }
  const closedAtMs = params.nowMs ?? Date.now();
  const tombstones = [
    { taskId: current.taskId, closedAtMs, title: current.title },
    ...(board.tombstones ?? []).filter((row) => row.taskId !== current.taskId),
  ];
  const nextBoard: SessionTaskBoard = {
    ...board,
    current: undefined,
    tombstones,
  };
  const sessionFile = params.sessionFile?.trim();
  if (sessionFile) {
    clearAsyncWaitJobsForTask(sessionFile, current.taskId);
  }
  return {
    board: nextBoard,
    action: "cancel_parked",
    taskId: "",
    cutContext: false,
    focusRevision: board.focusRevision,
    scheduleContinue: false,
    abortInFlight: true,
    statusLine: `已取消「${current.title}」：活动执行将停止新增业务动作，已移出任务板。`,
    incomingTitle: current.title,
  };
}

export function pauseParkedTask(params: {
  board: SessionTaskBoard;
  taskId: string;
}): IncomingTurnResult {
  const parked = findParked(params.board, params.taskId);
  if (!parked) {
    return continueResult(params.board, params.board.current?.taskId ?? "");
  }
  // Keep the task parked; acknowledge so the UI can close the reminder card.
  return {
    board: params.board,
    action: "continue",
    taskId: params.board.current?.taskId ?? "",
    cutContext: false,
    statusLine: `已暂停挂起的「${parked.title}」。仍在挂起列表，可稍后再继续或关闭。`,
    incomingTitle: parked.title,
  };
}

export function cancelParkedTask(params: {
  board: SessionTaskBoard;
  taskId: string;
  nowMs?: number;
}): IncomingTurnResult {
  const board = cloneBoardShell(params.board);
  const parked = findParked(board, params.taskId);
  if (!parked) {
    return {
      ...continueResult(board, board.current?.taskId ?? ""),
      focusRevision: board.focusRevision,
    };
  }
  const closedAtMs = params.nowMs ?? Date.now();
  const tombstones = [
    { taskId: parked.taskId, closedAtMs, title: parked.title },
    ...(board.tombstones ?? []).filter((row) => row.taskId !== parked.taskId),
  ];
  return {
    board: {
      ...board,
      current: board.current,
      parked: board.parked.filter((row) => row.taskId !== parked.taskId),
      tombstones,
    },
    action: "cancel_parked",
    taskId: board.current?.taskId ?? "",
    cutContext: false,
    focusRevision: board.focusRevision,
    scheduleContinue: false,
    statusLine: `已关闭「${parked.title}」，已移出任务板。`,
    incomingTitle: parked.title,
  };
}

/** Owner CLOSE — same as cancelParkedTask: item leaves the board and is not a continue target. */
export const closeParkedTask = cancelParkedTask;
