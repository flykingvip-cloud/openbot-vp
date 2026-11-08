import {
  resumeParkedTask,
  type ResumeParkedRecheck,
} from "../agent-runtime/state/mutations/resume-parked.js";
export {
  resumeParkedTask,
  type ResumeParkedRecheck,
} from "../agent-runtime/state/mutations/resume-parked.js";
export { commitInteractionTaskProposal } from "../agent-runtime/state/mutations/interaction-proposal.js";
import { appendTaskConstraint } from "../agent-runtime/state/mutations/task-constraints.js";
export { commitAdmittedSessionTask } from "../agent-runtime/state/mutations/admit-task.js";
import { insertLatestTaskDeferringCurrent } from "../agent-runtime/state/mutations/task-focus.js";
export { insertLatestTaskDeferringCurrent } from "../agent-runtime/state/mutations/task-focus.js";
import { createTask, parkTask } from "../agent-runtime/state/mutations/task-record.js";
export {
  allocateTaskInstanceId,
  taskIdForText,
} from "../agent-runtime/state/repository/task-identity.js";
import { stripInboundStamp as stripStamp } from "../agent-runtime/policy/index.js";
import {
  continueResult,
  suppressCurrentTaskWake,
  cancelCurrentTask,
  pauseParkedTask,
  cancelParkedTask,
} from "../agent-runtime/state/mutations/task-control.js";
export {
  suppressCurrentTaskWake,
  cancelCurrentTask,
  pauseParkedTask,
  cancelParkedTask,
  closeParkedTask,
} from "../agent-runtime/state/mutations/task-control.js";
export {
  formatParkedAt,
  PARKED_TASK_REMINDER_SENTINEL,
} from "../agent-runtime/context/sources/task-completion-notice.js";
export {
  recordCheckedTaskCompletion,
  finishCurrentTask,
} from "../agent-runtime/state/mutations/task-completion.js";
import { cloneBoardShell } from "../agent-runtime/state/repository/task-board-file.js";
export {
  captureTaskCompletionBinding,
  startBoundTaskExecution,
  isTaskExecutionBindingCurrent,
  bindCurrentExecution,
} from "../agent-runtime/state/mutations/execution-binding.js";
import { activeConstraintTexts, isTaskTombstoned } from "../agent-runtime/policy/index.js";
export { activeConstraintTexts, isTaskTombstoned } from "../agent-runtime/policy/index.js";
import {
  withSessionTaskBoardLock,
  readSessionTaskBoardUnlocked,
  writeSessionTaskBoardUnlocked,
  readSessionTaskBoard,
  mutateSessionTaskBoard,
} from "../agent-runtime/state/repository/task-board-file.js";
export {
  emptySessionTaskBoard,
  sessionTaskBoardPath,
  readSessionTaskBoard,
  mutateSessionTaskBoard,
  seedSessionTaskBoard,
  writeSessionTaskBoard,
  StaleSessionTaskBoardWriteError,
} from "../agent-runtime/state/repository/task-board-file.js";
import { normalizeConstraintEntries } from "../agent-runtime/policy/index.js";
export { normalizeConstraintEntries } from "../agent-runtime/policy/index.js";
import { buildResumePrompt } from "../agent-runtime/context/index.js";
export {
  buildResumePrompt,
  sanitizeTaskBoardPathForPrompt,
} from "../agent-runtime/context/index.js";
import type { TaskCompletionBinding } from "../agent-runtime/contracts/task-binding.js";
export type { TaskCompletionBinding } from "../agent-runtime/contracts/task-binding.js";
import { formatTaskBoardFocusLine } from "../agent-runtime/context/task-focus.js";
export { formatTaskBoardFocusLine } from "../agent-runtime/context/task-focus.js";
/**
 * Session task board. One current task per session, at most three parked.
 * This record — not transcript fence markers or token overlap — decides
 * whether a turn stays on the current task or starts different work.
 */
import fs from "node:fs";
import type {
  TaskStop,
  ConstraintEntry,
  ConstraintEntryInput,
  TrackedTask,
  TaskTombstone,
  ArchivedTask,
  TaskBoardScope,
  SessionTaskBoard,
} from "../agent-runtime/contracts/task.js";
import type { IncomingTurnResult } from "../agent-runtime/contracts/turn-result.js";
import { isTaskSurfaceUtterance } from "../agents/task-surface/surface.js";
import type { FocusSnapshot } from "./focus-policy.js";
import {
  classifyTurnRelation,
  isOwnerConstraintFullReplace,
  isOwnerConstraintRevision,
  shouldPersistOwnerConstraint,
} from "./turn-relation.js";
export { MAX_PARKED_TASKS } from "../agent-runtime/policy/task-board-limits.js";

// Compatibility type exports; definitions have a single owner in runtime contracts.
export type {
  TaskStop,
  ConstraintEntry,
  ConstraintEntryInput,
  TrackedTask,
  TaskTombstone,
  ArchivedTask,
  TaskBoardScope,
  SessionTaskBoard,
} from "../agent-runtime/contracts/task.js";
export type { IncomingTurnResult } from "../agent-runtime/contracts/turn-result.js";
/** Sure means new_work. amend and aside stay on the current task. */
export function isSureDistinctWork(incoming: string, currentGoal: string): boolean {
  const text = stripStamp(incoming);
  const current = currentGoal.trim();
  if (!text || !current || text.startsWith("/")) {
    return false;
  }
  return classifyTurnRelation(text, current) === "new_work";
}

/** Compatibility classifier; admitted changes already carry their scope. */
export function appendSameTaskConstraint(params: {
  board: SessionTaskBoard;
  constraintText: string;
  nowMs?: number;
  admittedAmendment?: boolean;
  amendmentMode?: "supplement" | "revise" | "replace_all";
}): SessionTaskBoard {
  const cleaned = stripStamp(params.constraintText).replace(/\s+/g, " ").trim();
  if (!params.admittedAmendment && !shouldPersistOwnerConstraint(cleaned)) {
    return cloneBoardShell(params.board);
  }
  const mode = params.admittedAmendment
    ? params.amendmentMode
    : isOwnerConstraintFullReplace(cleaned)
      ? "replace_all"
      : isOwnerConstraintRevision(cleaned)
        ? "revise"
        : "supplement";
  return appendTaskConstraint({
    board: params.board,
    constraintText: cleaned,
    nowMs: params.nowMs,
    mode,
  });
}

/**
 * File-backed entry used by reply path — does not invent a second update rule.
 * `expectedTaskId` must still be the unfinished current task that received the
 * constraint; a focus switch mid-steer must not write A's constraint onto B.
 * Optional `expectedWriteEpoch` refuses stale callers; the read/check/mutate/write
 * runs under the shared board file lock (`withFileLockSync` on the board path).
 * Returns false on identity mismatch, epoch mismatch, non-persistable text, or write failure.
 */
export function commitSameTaskConstraint(params: {
  sessionFile: string;
  constraintText: string;
  expectedTaskId: string;
  expectedWriteEpoch?: number;
}): boolean {
  const sessionFile = params.sessionFile.trim();
  const expectedTaskId = params.expectedTaskId.trim();
  if (!sessionFile || !expectedTaskId) {
    return false;
  }
  if (!shouldPersistOwnerConstraint(params.constraintText)) {
    return false;
  }
  try {
    return withSessionTaskBoardLock(sessionFile, () => {
      const live = readSessionTaskBoardUnlocked(sessionFile);
      const current = live.current;
      if (!current?.unfinished) {
        return false;
      }
      if (current.taskId !== expectedTaskId) {
        return false;
      }
      const epoch = live.writeEpoch ?? 0;
      if (typeof params.expectedWriteEpoch === "number" && params.expectedWriteEpoch !== epoch) {
        return false;
      }
      const beforeLog = JSON.stringify(normalizeConstraintEntries(current.effectiveConstraints));
      const committed = appendSameTaskConstraint({
        board: live,
        constraintText: params.constraintText,
      });
      if (committed.current?.taskId !== expectedTaskId) {
        return false;
      }
      const afterLog = JSON.stringify(
        normalizeConstraintEntries(committed.current?.effectiveConstraints),
      );
      if (beforeLog === afterLog) {
        // Idempotent: focus-gate applyIncoming may already have written the same
        // owner text. If it is already an active constraint on the expected task,
        // treat as persisted success so steer ack is not a false "未能写入".
        const cleaned = stripStamp(params.constraintText).replace(/\s+/g, " ").trim();
        const alreadyActive = normalizeConstraintEntries(
          committed.current?.effectiveConstraints,
        ).some((row) => row.text === cleaned && !row.superseded);
        return alreadyActive;
      }
      writeSessionTaskBoardUnlocked(sessionFile, committed);
      return true;
    });
  } catch {
    return false;
  }
}

/** Compatibility-only text control adapter; typed interaction uses runtime mutations. */
export function applyLegacyTaskControl(sessionFile: string, prompt: string): IncomingTurnResult {
  return mutateSessionTaskBoard(sessionFile, (board) => {
    const result = applyIncomingUserMessage({ board, incomingText: prompt });
    return { board: result.board, value: result };
  });
}

export function isOwnerCurrentTaskControlUtterance(text: string): boolean {
  const incoming = stripStamp(text);
  if (!incoming || incoming.startsWith("/")) {
    return false;
  }
  return (
    /^(?:暂停(?:当前(?:任务)?)?|先暂停)[。.!！]?$/u.test(incoming) ||
    /^(?:取消当前(?:任务)?|取消任务)[。.!！]?$/u.test(incoming)
  );
}

export function applyIncomingUserMessage(params: {
  board: SessionTaskBoard;
  sessionFile?: string;
  incomingText: string;
  nowMs?: number;
  workspacePaths?: string[];
  recheck?: ResumeParkedRecheck;
  inboundRequestId?: string;
}): IncomingTurnResult {
  const nowMs = params.nowMs ?? Date.now();
  const paths = params.workspacePaths?.filter(Boolean) ?? [];
  const incoming = stripStamp(params.incomingText);
  const board = cloneBoardShell(params.board);
  if (!incoming || incoming.startsWith("/")) {
    return continueResult(board, board.current?.taskId ?? "");
  }
  // Hang-list and keep-only are surface commands, not a new task.
  // The task-surface reply path mutates the board against the shown ordinals.
  if (isTaskSurfaceUtterance(incoming)) {
    return continueResult(board, board.current?.taskId ?? "");
  }

  // CONTINUE resumes a deferred prior task (Owner: invite CONTINUE or CLOSE).
  const resumeMatch = incoming.match(/^(?:继续挂起|CONTINUE)\s+(\S+)/iu);
  if (resumeMatch) {
    return resumeParkedTask({
      board,
      taskId: resumeMatch[1] ?? "",
      nowMs,
      workspacePaths: paths,
      recheck: params.recheck,
    });
  }
  // Owner pause of the *current* unfinished task: suppress auto-continue wakes.
  // Does not bump focusRevision (same-task control, not a focus switch).
  if (/^(?:暂停(?:当前(?:任务)?)?|先暂停)[。.!！]?$/u.test(incoming)) {
    return suppressCurrentTaskWake({ board, sessionFile: params.sessionFile });
  }
  const pauseMatch = incoming.match(/^暂停挂起\s+(\S+)/u);
  if (pauseMatch) {
    return pauseParkedTask({ board, taskId: pauseMatch[1] ?? "" });
  }
  // Cancel the *current* unfinished task (tombstone + clear current).
  if (/^(?:取消当前(?:任务)?|取消任务)[。.!！]?$/u.test(incoming)) {
    return cancelCurrentTask({ board, nowMs, sessionFile: params.sessionFile });
  }
  // CLOSE / 关闭挂起 / 取消挂起 — remove deferred item from the board entirely.
  const cancelMatch = incoming.match(/^(?:取消挂起|关闭挂起|CLOSE)\s+(\S+)/iu);
  if (cancelMatch) {
    return cancelParkedTask({ board, taskId: cancelMatch[1] ?? "", nowMs });
  }

  const current = board.current;
  if (!current) {
    const created = createTask(incoming, nowMs, paths, {
      inboundRequestId: params.inboundRequestId,
      entropy: nowMs,
    });
    return {
      ...continueResult({ ...board, current: created }, created.taskId),
      focusRevision: board.focusRevision,
    };
  }
  if (!current.unfinished) {
    if (!isSureDistinctWork(incoming, current.goalText)) {
      return { ...continueResult(board, current.taskId), focusRevision: board.focusRevision };
    }
    return insertLatestTaskDeferringCurrent({
      board,
      goalText: incoming,
      nowMs,
      workspacePaths: paths,
      parkReason: "user_switch",
      inboundRequestId: params.inboundRequestId,
    });
  }
  if (!isSureDistinctWork(incoming, current.goalText)) {
    // Same-task amend: persist full constraint via the sole board updater (no focusRevision bump).
    let nextBoard: SessionTaskBoard = {
      ...board,
      current: {
        ...current,
        stop: {
          ...current.stop,
          workspacePaths: paths.length > 0 ? paths : current.stop.workspacePaths,
        },
      },
    };
    if (
      classifyTurnRelation(incoming, current.goalText, {
        activeConstraints: activeConstraintTexts(current),
      }) === "amend"
    ) {
      nextBoard = appendSameTaskConstraint({ board: nextBoard, constraintText: incoming });
    }
    return {
      ...continueResult(nextBoard, current.taskId),
      focusRevision: board.focusRevision,
    };
  }

  return insertLatestTaskDeferringCurrent({
    board,
    goalText: incoming,
    nowMs,
    workspacePaths: paths,
    parkReason: "user_switch",
    inboundRequestId: params.inboundRequestId,
  });
}

/** Oldest-first parked slots from the session board, when that file is known. */
export function enrichFocusSnapshotWithBoard(
  snapshot: FocusSnapshot,
  sessionFile?: string,
): FocusSnapshot {
  const file = sessionFile?.trim();
  if (!file) {
    return snapshot;
  }
  const oldestFirst = [...readSessionTaskBoard(file).parked].toReversed();
  if (oldestFirst.length === 0) {
    return snapshot;
  }
  return {
    ...snapshot,
    parkedTaskIds: oldestFirst.map((task) => task.taskId),
    parkedTitles: oldestFirst.map((task) => task.title),
    parkedWorkspacePaths: oldestFirst.map((task) => [...task.stop.workspacePaths]),
  };
}

/** Keep the most recent 3 parked tasks. Drops the oldest when the incoming task is new. */
export function commitAutomaticPark(params: {
  sessionFile?: string;
  incomingTaskId: string;
  nowMs?: number;
}): TrackedTask | undefined {
  const file = params.sessionFile?.trim();
  const incomingTaskId = params.incomingTaskId.trim();
  if (!file || !incomingTaskId) {
    return undefined;
  }
  const nowMs = params.nowMs ?? Date.now();
  return mutateSessionTaskBoard(file, (board) => {
    if (board.parked.some((row) => row.taskId === incomingTaskId)) {
      return { board, value: undefined };
    }
    if (isTaskTombstoned(board, incomingTaskId)) {
      return { board, value: undefined };
    }
    const incoming: TrackedTask = {
      taskId: incomingTaskId,
      title: incomingTaskId,
      goalText: incomingTaskId,
      unfinished: true,
      stop: { summary: `未完成：${incomingTaskId}`, workspacePaths: [] },
      createdAtMs: nowMs,
      parkReason: "automatic_incoming",
      wakeSuppress: true,
    };
    const parked = parkTask(board.parked, incoming, nowMs, "automatic_incoming");
    const archived = [...(board.archived ?? [])];
    if (parked.archived) {
      archived.unshift(parked.archived);
    }
    return {
      board: {
        ...board,
        current: board.current,
        parked: parked.parked,
        ...(archived.length > 0 ? { archived } : {}),
      },
      value: parked.archived,
    };
  });
}

/**
 * Locked file-backed switch: read → apply → write only if focusRevision still matches (C6/AC16).
 * Uses the same board file lock as other writers; concurrent losers must retry.
 */
export function commitBoardMutation(params: {
  sessionFile: string;
  expectedRevision: number;
  mutate: (board: SessionTaskBoard) => IncomingTurnResult;
}): IncomingTurnResult | { rejected: true; reason: "revision_mismatch"; board: SessionTaskBoard } {
  return withSessionTaskBoardLock(params.sessionFile, () => {
    const board = readSessionTaskBoardUnlocked(params.sessionFile);
    if ((board.focusRevision ?? 0) !== params.expectedRevision) {
      return { rejected: true, reason: "revision_mismatch", board };
    }
    const result = params.mutate(board);
    writeSessionTaskBoardUnlocked(params.sessionFile, result.board);
    return result;
  });
}

export type FocusSwitchDecision =
  | { action: "continue"; cutContext: false; taskId: string }
  | {
      action: "auto_park";
      cutContext: true;
      taskId: string;
      currentTitle: string;
      incomingTitle: string;
      statusLine: string;
      droppedTitle?: string;
      droppedPaths?: string[];
    }
  | {
      action: "resume";
      cutContext: true;
      taskId: string;
      currentTitle: string;
      incomingTitle: string;
      statusLine: string;
      restoredPrompt: string;
    };

export function evaluateFocusSwitch(params: {
  currentFocusText?: string;
  incomingText: string;
  proceed?: boolean;
  parked?: TrackedTask[];
  nowMs?: number;
  workspacePaths?: string[];
  recheck?: ResumeParkedRecheck;
}): FocusSwitchDecision {
  const currentText = params.currentFocusText?.trim() ?? "";
  const board: SessionTaskBoard = {
    current: currentText
      ? createTask(currentText, params.nowMs ?? 0, params.workspacePaths ?? [])
      : undefined,
    parked: params.parked ? [...params.parked] : [],
    focusRevision: 0,
  };
  if (params.proceed) {
    return {
      action: "continue",
      cutContext: false,
      taskId: board.current?.taskId ?? "",
    };
  }
  const result = applyIncomingUserMessage({
    board,
    incomingText: params.incomingText,
    nowMs: params.nowMs,
    workspacePaths: params.workspacePaths,
    recheck: params.recheck,
  });
  if (result.action === "resume" && result.restoredPrompt) {
    return {
      action: "resume",
      cutContext: true,
      taskId: result.taskId,
      currentTitle: result.currentTitle ?? "",
      incomingTitle: result.incomingTitle ?? "",
      statusLine: result.statusLine ?? "",
      restoredPrompt: result.restoredPrompt,
    };
  }
  if (result.action !== "switch") {
    return { action: "continue", cutContext: false, taskId: result.taskId };
  }
  return {
    action: "auto_park",
    cutContext: true,
    taskId: result.taskId,
    currentTitle: result.currentTitle ?? "",
    incomingTitle: result.incomingTitle ?? "",
    statusLine: result.statusLine ?? "",
    ...(result.droppedTitle ? { droppedTitle: result.droppedTitle } : {}),
    ...(result.droppedPaths ? { droppedPaths: result.droppedPaths } : {}),
  };
}

export type FocusGateDecisionCode =
  | "focus_clear"
  | "focus_proceed"
  | "focus_state_unavailable"
  | "focus_switched";

export type FocusSwitchGateDecision =
  | {
      action: "continue" | "cancel_parked";
      decisionCode: Exclude<FocusGateDecisionCode, "focus_switched">;
      cutContext: false;
      taskId: string;
      statusLine?: string;
      /** Owner pause/cancel: abort in-flight via existing chat abort path. */
      abortInFlight?: boolean;
    }
  | {
      action: "auto_park" | "resume";
      decisionCode: "focus_switched";
      cutContext: true;
      taskId: string;
      currentTitle: string;
      incomingTitle: string;
      statusLine: string;
      restoredPrompt?: string;
      droppedTitle?: string;
      droppedPaths?: string[];
      abortInFlight?: boolean;
    };

const focusDecisionCounts = new Map<string, number>();

export function resetFocusSwitchDecisionCountsForTest(): void {
  focusDecisionCounts.clear();
}

export function recordFocusSwitchDecision(decisionCode: string): void {
  focusDecisionCounts.set(decisionCode, (focusDecisionCounts.get(decisionCode) ?? 0) + 1);
}

export function readFocusSwitchDecisionCount(decisionCode: string): number {
  return focusDecisionCounts.get(decisionCode) ?? 0;
}

function recordFocusDecision<T extends { decisionCode: string }>(decision: T): T {
  recordFocusSwitchDecision(decision.decisionCode);
  return decision;
}

export function applyFocusSwitchGate(params: {
  proceed?: boolean;
  sessionFile?: string;
  incomingText: string;
  nowMs?: number;
  workspacePaths?: string[];
  recheck?: ResumeParkedRecheck;
}): FocusSwitchGateDecision {
  if (params.proceed) {
    const board = readSessionTaskBoard(params.sessionFile);
    return recordFocusDecision({
      action: "continue",
      decisionCode: "focus_proceed",
      cutContext: false,
      taskId: board.current?.taskId ?? "",
    });
  }
  const incoming = params.incomingText.trim();
  if (!incoming || incoming.startsWith("/")) {
    return recordFocusDecision({
      action: "continue",
      decisionCode: "focus_clear",
      cutContext: false,
      taskId: "",
    });
  }
  const sessionFile = params.sessionFile?.trim();
  if (!sessionFile) {
    return recordFocusDecision({
      action: "continue",
      decisionCode: "focus_state_unavailable",
      cutContext: false,
      taskId: "",
    });
  }
  try {
    if (!fs.existsSync(sessionFile)) {
      return recordFocusDecision({
        action: "continue",
        decisionCode: "focus_state_unavailable",
        cutContext: false,
        taskId: "",
      });
    }
    const result = mutateSessionTaskBoard(sessionFile, (board) => {
      const next = applyIncomingUserMessage({
        board,
        sessionFile,
        incomingText: incoming,
        nowMs: params.nowMs,
        workspacePaths: params.workspacePaths,
        recheck: params.recheck,
      });
      return { board: next.board, value: next };
    });
    if (result.action === "switch" || result.action === "resume") {
      return recordFocusDecision({
        action: result.action === "resume" ? "resume" : "auto_park",
        decisionCode: "focus_switched",
        cutContext: true,
        taskId: result.taskId,
        currentTitle: result.currentTitle ?? "",
        incomingTitle: result.incomingTitle ?? "",
        statusLine: result.statusLine ?? "",
        ...(result.restoredPrompt ? { restoredPrompt: result.restoredPrompt } : {}),
        ...(result.droppedTitle ? { droppedTitle: result.droppedTitle } : {}),
        ...(result.droppedPaths ? { droppedPaths: result.droppedPaths } : {}),
      });
    }
    return recordFocusDecision({
      action: result.action === "cancel_parked" ? "cancel_parked" : "continue",
      decisionCode: "focus_clear",
      cutContext: false,
      taskId: result.taskId,
      ...(result.statusLine ? { statusLine: result.statusLine } : {}),
      ...(result.abortInFlight ? { abortInFlight: true } : {}),
    });
  } catch {
    return recordFocusDecision({
      action: "continue",
      decisionCode: "focus_state_unavailable",
      cutContext: false,
      taskId: "",
    });
  }
}

/** Current-task sends deliver. Owner confirmation is not a gate. */
export function evaluateCurrentTaskSend(params: { currentTaskId?: string; taskId?: string }): {
  action: "deliver";
  taskId?: string;
  requiresOwner: false;
} {
  const explicit = params.taskId?.trim() ?? "";
  const current = params.currentTaskId?.trim() ?? "";
  const taskId = explicit || current || undefined;
  return { action: "deliver", taskId, requiresOwner: false };
}
