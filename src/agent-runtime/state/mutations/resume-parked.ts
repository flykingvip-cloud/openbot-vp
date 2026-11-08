import { buildResumePrompt } from "../../context/index.js";
import { dropSentence } from "../../context/task-focus.js";
import type {
  SessionTaskBoard,
  IncomingTurnResult,
  ArchivedTask,
  TrackedTask,
} from "../../contracts/task.js";
import { isTaskTombstoned } from "../../policy/index.js";
import { cloneBoardShell } from "../repository/task-board-file.js";
import { findParked, continueResult } from "./task-control.js";
import { bumpFocusRevision } from "./task-focus.js";
import { parkTask } from "./task-record.js";

export type ResumeParkedRecheck = {
  /** False when current auth/ownership no longer allows this session. */
  authOk?: boolean;
  /**
   * Broad session-level stop barrier. Used when `isTaskStopActive` is absent.
   * Prefer `isTaskStopActive` so resume checks the original taskId.
   */
  stopActive?: boolean;
  /**
   * Authoritative per-taskId stop lookup. When set, resume of task T is denied
   * iff this returns true for T — even after AbortController records are deleted.
   */
  isTaskStopActive?: (taskId: string) => boolean;
  /** False when budget / quota no longer allows resume (C6). */
  budgetOk?: boolean;
  /** False when plan / policy no longer allows resume (C6). */
  planOk?: boolean;
  /** False when workspace binding is invalid for resume (C6). */
  workspaceOk?: boolean;
};

export function resumeParkedTask(params: {
  board: SessionTaskBoard;
  taskId: string;
  nowMs?: number;
  workspacePaths?: string[];
  /** Optional live auth + stop re-check at resume time (fail-closed when set). */
  recheck?: ResumeParkedRecheck;
}): IncomingTurnResult {
  const nowMs = params.nowMs ?? Date.now();
  const paths = params.workspacePaths?.filter(Boolean) ?? [];
  const board = cloneBoardShell(params.board);
  const needle = params.taskId.trim();
  if (needle && isTaskTombstoned(board, needle)) {
    return {
      ...continueResult(board, board.current?.taskId ?? ""),
      focusRevision: board.focusRevision,
      scheduleContinue: false,
      rejectedReason: "tombstoned",
      statusLine: `恢复被拒绝：任务已关闭（墓碑）。`,
    };
  }
  const parked = findParked(board, params.taskId);
  if (!parked) {
    return {
      ...continueResult(board, board.current?.taskId ?? ""),
      focusRevision: board.focusRevision,
      scheduleContinue: false,
    };
  }
  if (params.recheck?.authOk === false) {
    return {
      ...continueResult(board, board.current?.taskId ?? ""),
      focusRevision: board.focusRevision,
      scheduleContinue: false,
      rejectedReason: "auth",
      statusLine: `恢复「${parked.title}」被拒绝：当前授权无效。`,
    };
  }
  const stopBlocked =
    typeof params.recheck?.isTaskStopActive === "function"
      ? params.recheck.isTaskStopActive(parked.taskId)
      : params.recheck?.stopActive === true;
  if (stopBlocked) {
    return {
      ...continueResult(board, board.current?.taskId ?? ""),
      focusRevision: board.focusRevision,
      scheduleContinue: false,
      rejectedReason: "stop",
      statusLine: `恢复「${parked.title}」被拒绝：任务已停止。`,
    };
  }
  if (params.recheck?.budgetOk === false) {
    return {
      ...continueResult(board, board.current?.taskId ?? ""),
      focusRevision: board.focusRevision,
      scheduleContinue: false,
      rejectedReason: "budget",
      statusLine: `恢复「${parked.title}」被拒绝：预算不足。`,
    };
  }
  if (params.recheck?.planOk === false) {
    return {
      ...continueResult(board, board.current?.taskId ?? ""),
      focusRevision: board.focusRevision,
      scheduleContinue: false,
      rejectedReason: "plan",
      statusLine: `恢复「${parked.title}」被拒绝：计划不允许。`,
    };
  }
  if (params.recheck?.workspaceOk === false) {
    return {
      ...continueResult(board, board.current?.taskId ?? ""),
      focusRevision: board.focusRevision,
      scheduleContinue: false,
      rejectedReason: "workspace",
      statusLine: `恢复「${parked.title}」被拒绝：工作区无效。`,
    };
  }
  let nextParked = board.parked.filter((row) => row.taskId !== parked.taskId);
  let archived: ArchivedTask | undefined;
  const current = board.current;
  if (current?.unfinished) {
    const parkedCurrent: TrackedTask = {
      ...current,
      stop: {
        summary: current.stop.summary || `未完成：${current.title}`,
        workspacePaths:
          current.stop.workspacePaths.length > 0 ? current.stop.workspacePaths : paths,
      },
    };
    const parkedResult = parkTask(nextParked, parkedCurrent, nowMs, "resume_swap");
    nextParked = parkedResult.parked;
    archived = parkedResult.archived;
  }
  const restored: TrackedTask = {
    ...parked,
    unfinished: true,
    parkedAtMs: undefined,
    parkReason: undefined,
    wakeSuppress: false,
    // A resumed task is a new claim; late output from its parked attempt is obsolete.
    executionAttempt: undefined,
    deliverableVersion: undefined,
    deliverableChecked: false,
  };
  const restoredPrompt = buildResumePrompt(restored);
  const archivedText = dropSentence(archived);
  const nextRevision = bumpFocusRevision(board);
  const archivedList = [...(board.archived ?? [])];
  if (archived) {
    archivedList.unshift(archived);
  }
  const nextBoard: SessionTaskBoard = {
    ...board,
    current: restored,
    parked: nextParked,
    focusRevision: nextRevision,
    ...(archivedList.length > 0 ? { archived: archivedList } : {}),
  };
  return {
    board: nextBoard,
    action: "resume",
    taskId: restored.taskId,
    cutContext: true,
    currentTitle: current?.title,
    incomingTitle: restored.title,
    restoredPrompt,
    focusRevision: nextRevision,
    // C6: resume success ≠ immediate auto-execute
    scheduleContinue: false,
    statusLine: `继续「${restored.title}」。停在：${restored.stop.summary}${
      restored.stop.workspacePaths.length > 0
        ? `。文件：${restored.stop.workspacePaths.join("、")}`
        : ""
    }。${archivedText}`,
    ...(archived
      ? { droppedTitle: archived.title, droppedPaths: archived.stop.workspacePaths }
      : {}),
  };
}
