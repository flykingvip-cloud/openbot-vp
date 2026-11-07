import { switchStatus } from "../../context/task-focus.js";
import type { SessionTaskBoard, TrackedTask, IncomingTurnResult } from "../../contracts/task.js";
import { stripInboundStamp as stripStamp } from "../../policy/index.js";
import { cloneBoardShell } from "../repository/task-board-file.js";
import { allocateTaskInstanceId } from "../repository/task-identity.js";
import { continueResult } from "./task-control.js";
import { createTask, parkTask } from "./task-record.js";

export function bumpFocusRevision(board: SessionTaskBoard): number {
  return (board.focusRevision ?? 0) + 1;
}

/**
 * Interrupt unfinished current (if any) and bind a NEW task as board.current.
 * Prior unfinished work is deferred/parked with wakeSuppress — it must not own
 * auto-continue, wake, or 「当前任务」. The inserted task is always LATEST.
 */
export function insertLatestTaskDeferringCurrent(params: {
  board: SessionTaskBoard;
  goalText: string;
  nowMs?: number;
  workspacePaths?: string[];
  parkReason?: string;
  inboundRequestId?: string;
}): IncomingTurnResult {
  const nowMs = params.nowMs ?? Date.now();
  const paths = params.workspacePaths?.filter(Boolean) ?? [];
  const goal = stripStamp(params.goalText);
  const board = cloneBoardShell(params.board);
  if (!goal) {
    return continueResult(board, board.current?.taskId ?? "");
  }
  if (board.current?.unfinished && params.inboundRequestId) {
    const idempotentId = allocateTaskInstanceId({ inboundRequestId: params.inboundRequestId });
    if (board.current.taskId === idempotentId) {
      return {
        ...continueResult(board, board.current.taskId),
        focusRevision: board.focusRevision,
        scheduleContinue: false,
      };
    }
  }
  const created = createTask(goal, nowMs, paths, {
    inboundRequestId: params.inboundRequestId,
    entropy: nowMs,
  });
  const current = board.current;
  const nextRevision = bumpFocusRevision(board);
  if (!current?.unfinished) {
    const nextBoard: SessionTaskBoard = {
      ...board,
      current: created,
      focusRevision: nextRevision,
    };
    return {
      board: nextBoard,
      action: "switch",
      taskId: created.taskId,
      cutContext: true,
      currentTitle: current?.title,
      incomingTitle: created.title,
      statusLine: `开始「${created.title}」。`,
      focusRevision: nextRevision,
      scheduleContinue: false,
    };
  }
  const parkedCurrent: TrackedTask = {
    ...current,
    stop: {
      summary: current.stop.summary || `未完成：${current.title}`,
      workspacePaths: current.stop.workspacePaths.length > 0 ? current.stop.workspacePaths : paths,
    },
  };
  const parked = parkTask(board.parked, parkedCurrent, nowMs, params.parkReason ?? "user_switch");
  const archivedList = [...(board.archived ?? [])];
  if (parked.archived) {
    archivedList.unshift(parked.archived);
  }
  const nextBoard: SessionTaskBoard = {
    ...board,
    current: created,
    parked: parked.parked,
    focusRevision: nextRevision,
    ...(archivedList.length > 0 ? { archived: archivedList } : {}),
  };
  return {
    board: nextBoard,
    action: "switch",
    taskId: created.taskId,
    cutContext: true,
    currentTitle: current.title,
    incomingTitle: created.title,
    statusLine: switchStatus(current.title, created.title, parked.archived, parked.parked.length),
    focusRevision: nextRevision,
    scheduleContinue: false,
    ...(parked.archived
      ? {
          droppedTitle: parked.archived.title,
          droppedPaths: parked.archived.stop.workspacePaths,
        }
      : {}),
  };
}
