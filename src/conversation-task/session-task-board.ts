/**
 * Session task board. One current task per session, at most three parked.
 * This record — not transcript fence markers or token overlap — decides
 * whether a turn stays on the current task or starts different work.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
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
  IncomingTurnResult,
} from "../agent-runtime/contracts/task.js";
import { isTaskSurfaceUtterance } from "../agents/task-surface/surface.js";
import { SESSION_TASK_BOARD_LOCK_OPTIONS, withFileLockSync } from "../infra/file-lock.js";
import { formatDroppedParkedTaskSentence, type FocusSnapshot } from "./focus-policy.js";
import {
  classifyTurnRelation,
  isOwnerConstraintFullReplace,
  isOwnerConstraintRevision,
  shouldPersistOwnerConstraint,
  titleFromGoal,
} from "./turn-relation.js";

export const MAX_PARKED_TASKS = 3;

const INBOUND_STAMP_RE = /^\[[A-Za-z]{3} \d{4}-\d{2}-\d{2} [0-9:]{4,8} GMT[+-]\d+\]\s*/;

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
  IncomingTurnResult,
} from "../agent-runtime/contracts/task.js";

export function emptySessionTaskBoard(scope?: TaskBoardScope): SessionTaskBoard {
  return { parked: [], focusRevision: 0, ...(scope ? { scope } : {}) };
}

/** Legacy body-hash helper (not the sole identity source — see allocateTaskInstanceId). */
export function taskIdForText(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  const digest = createHash("sha256").update(normalized).digest("hex").slice(0, 12);
  return `task-${digest}`;
}

/**
 * C3: independent instance IDs (not body-hash-only).
 * - same body again without inboundRequestId → new id
 * - same inbound request retry (same inboundRequestId) → idempotent same id
 */
export function allocateTaskInstanceId(params?: {
  inboundRequestId?: string;
  entropy?: string | number;
}): string {
  const inbound = params?.inboundRequestId?.trim();
  if (inbound) {
    const digest = createHash("sha256").update(`inbound-req:${inbound}`).digest("hex").slice(0, 12);
    return `task-${digest}`;
  }
  const entropy = `${Date.now()}:${randomBytes(16).toString("hex")}:${params?.entropy ?? ""}:${process.hrtime.bigint()}`;
  const digest = createHash("sha256").update(entropy).digest("hex").slice(0, 12);
  return `task-${digest}`;
}

export function isTaskTombstoned(board: SessionTaskBoard, taskId: string): boolean {
  const id = taskId.trim();
  if (!id) {
    return false;
  }
  return (board.tombstones ?? []).some((row) => row.taskId === id);
}

function cloneBoardShell(board: SessionTaskBoard): SessionTaskBoard {
  return {
    current: board.current,
    parked: [...board.parked],
    focusRevision: board.focusRevision ?? 0,
    ...(typeof board.writeEpoch === "number" ? { writeEpoch: board.writeEpoch } : {}),
    ...(board.tombstones ? { tombstones: [...board.tombstones] } : {}),
    ...(board.archived ? { archived: [...board.archived] } : {}),
    ...(board.scope ? { scope: { ...board.scope } } : {}),
  };
}

function bumpFocusRevision(board: SessionTaskBoard): number {
  return (board.focusRevision ?? 0) + 1;
}

export function sessionTaskBoardPath(sessionFile: string): string {
  return `${sessionFile}.task-board.json`;
}

function stripStamp(text: string): string {
  return text.replace(INBOUND_STAMP_RE, "").trim();
}

export function normalizeConstraintEntries(
  raw: ConstraintEntryInput[] | undefined,
): ConstraintEntry[] {
  if (!raw || raw.length === 0) {
    return [];
  }
  const out: ConstraintEntry[] = [];
  for (const row of raw) {
    if (typeof row === "string") {
      const text = row.replace(/\s+/g, " ").trim();
      if (!text) {
        continue;
      }
      out.push({ text, atMs: 0, kind: "supplement" });
      continue;
    }
    if (!row || typeof row !== "object") {
      continue;
    }
    const text = String(row.text ?? "")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) {
      continue;
    }
    out.push({
      text,
      atMs: typeof row.atMs === "number" ? row.atMs : 0,
      kind: row.kind === "revise" ? "revise" : "supplement",
      ...(row.superseded ? { superseded: true } : {}),
    });
  }
  return out;
}

/** Currently binding constraint texts (history retained separately via superseded flag). */
export function activeConstraintTexts(task: TrackedTask | undefined | null): string[] {
  return normalizeConstraintEntries(task?.effectiveConstraints)
    .filter((row) => !row.superseded)
    .map((row) => row.text);
}

/** Sure means new_work. amend and aside stay on the current task. */
export function isSureDistinctWork(incoming: string, currentGoal: string): boolean {
  const text = stripStamp(incoming);
  const current = currentGoal.trim();
  if (!text || !current || text.startsWith("/")) {
    return false;
  }
  return classifyTurnRelation(text, current) === "new_work";
}

function createTask(
  text: string,
  nowMs: number,
  workspacePaths: string[],
  opts?: { inboundRequestId?: string; entropy?: string | number },
): TrackedTask {
  const title = titleFromGoal(text);
  return {
    taskId: allocateTaskInstanceId({
      inboundRequestId: opts?.inboundRequestId,
      entropy: opts?.entropy ?? `${nowMs}:${title}`,
    }),
    title,
    goalText: text.trim(),
    unfinished: true,
    stop: {
      summary: `未完成：${title}`,
      workspacePaths: [...workspacePaths],
    },
    createdAtMs: nowMs,
  };
}

function parkTask(
  parked: readonly TrackedTask[],
  task: TrackedTask,
  nowMs: number,
  parkReason?: string,
): { parked: TrackedTask[]; archived?: ArchivedTask } {
  const stamped: TrackedTask = {
    ...task,
    unfinished: true,
    parkedAtMs: nowMs,
    parkReason: parkReason ?? task.parkReason ?? "automatic_switch",
    wakeSuppress: true,
  };
  const newestFirst = [stamped, ...parked.filter((row) => row.taskId !== stamped.taskId)];
  if (newestFirst.length <= MAX_PARKED_TASKS) {
    return { parked: newestFirst };
  }
  const overflow = newestFirst[newestFirst.length - 1];
  return {
    parked: newestFirst.slice(0, MAX_PARKED_TASKS),
    archived: overflow
      ? {
          ...overflow,
          archivedAtMs: nowMs,
          archiveReason: "parked_capacity",
        }
      : undefined,
  };
}

function dropSentence(archived: TrackedTask | undefined): string {
  if (!archived) {
    return "";
  }
  return formatDroppedParkedTaskSentence({
    droppedTaskId: archived.taskId,
    droppedTitle: archived.title,
    droppedPaths: archived.stop.workspacePaths,
  });
}

function switchStatus(
  currentTitle: string,
  incomingTitle: string,
  archived?: TrackedTask,
  parkedCount?: number,
): string {
  const archivedText = dropSentence(archived);
  const count = typeof parkedCount === "number" ? parkedCount : 1;
  const line = `已挂起「${currentTitle}」，开始「${incomingTitle}」。当前任务：「${incomingTitle}」；已挂起 ${count} 项。`;
  return archivedText ? `${line}${archivedText}` : line;
}

/** Compact focus line for UI / status: 当前任务 / 已挂起 N 项. */
export function formatTaskBoardFocusLine(board: SessionTaskBoard): string {
  const current = board.current?.title?.trim();
  const n = board.parked.length;
  if (current) {
    return `当前任务：「${current}」；已挂起 ${n} 项`;
  }
  if (n > 0) {
    return `当前无进行中任务；已挂起 ${n} 项`;
  }
  return "当前无进行中任务；已挂起 0 项";
}

export function formatParkedAt(ms?: number): string {
  if (typeof ms !== "number" || !Number.isFinite(ms)) {
    return "未知时间";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(ms));
}

/** Redact absolute tenant/workspace paths before any prompt or UI copy. */
export function sanitizeTaskBoardPathForPrompt(raw: string): string {
  const value = raw.trim();
  if (!value) {
    return value;
  }
  const tenant = value.match(
    /\/openbot-tenants\/[^/]+\/users\/[^/]+\/OpenBot\/agents\/[^/]+\/workspace\/?(.*)$/,
  );
  if (tenant) {
    const rest = (tenant[1] ?? "").replace(/^\/+/, "");
    return rest || "workspace";
  }
  if (/^\/(?:root|var|tmp)\//.test(value) || value.startsWith("/Users/")) {
    const base = value.replace(/\/+$/, "").split("/").pop();
    return base || "workspace";
  }
  return value;
}

export function buildResumePrompt(task: TrackedTask): string {
  const paths = task.stop.workspacePaths
    .filter(Boolean)
    .map((entry) => sanitizeTaskBoardPathForPrompt(entry))
    .filter(Boolean);
  const pathLine = paths.length > 0 ? `\n文件：${paths.join("、")}` : "";
  // Only currently binding constraints — superseded history stays on the board
  // but must not be presented as simultaneously valid instructions (slice3).
  const entries = normalizeConstraintEntries(task.effectiveConstraints).filter(
    (row) => !row.superseded,
  );
  const constraints = entries.map((row) => row.text);
  const hasLocalReviseAmongActive =
    entries.length > 1 && entries.some((row) => row.kind === "revise");
  const constraintHeader = hasLocalReviseAmongActive
    ? "有效约束（按登记顺序；后文修订仅覆盖与其冲突的部分，其余条目仍有效）："
    : "有效约束（按登记顺序）：";
  const constraintBlock =
    constraints.length > 0
      ? `\n${constraintHeader}\n${constraints
          .map((row, index) => `${index + 1}. ${row}`)
          .join("\n")}`
      : "";
  // Keep taskId on a machine line for the model; never echo raw ids in the
  // human-facing 「继续任务」 sentence (that line previously leaked into chat).
  // Full owner constraints live in effectiveConstraints — stop.summary is display/stop only.
  return [
    `task_id: ${task.taskId}`,
    `继续任务「${task.title}」。`,
    `停在：${task.stop.summary}${pathLine}`,
    constraintBlock,
  ]
    .filter(Boolean)
    .join("\n");
}

function findParked(board: SessionTaskBoard, token: string): TrackedTask | undefined {
  const needle = token.trim();
  if (!needle) {
    return undefined;
  }
  return board.parked.find((row) => row.taskId === needle || row.title === needle);
}

function continueResult(
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

/** Display-only short constraint marker for stop.summary (not the persistence source). */
function constraintDisplayMarker(fullText: string): string {
  const short = fullText.length > 48 ? `${fullText.slice(0, 48)}…` : fullText;
  return `约束：${short}`;
}

/**
 * Sole same-task constraint updater for the board.
 * Persists the *full* owner text on the constraint log; stop.summary gets a short display marker only.
 * - Bare continue / read queries are not persisted.
 * - Explicit *full replace* supersedes prior active rows (history kept with superseded=true).
 * - Local revision / supplement append without auto-discarding unrelated active rows.
 * Never deletes rows by keyword scan; never invents a second adjudicator.
 */
export function appendSameTaskConstraint(params: {
  board: SessionTaskBoard;
  constraintText: string;
  nowMs?: number;
}): SessionTaskBoard {
  const board = cloneBoardShell(params.board);
  const current = board.current;
  if (!current?.unfinished) {
    return board;
  }
  const cleaned = stripStamp(params.constraintText).replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return board;
  }
  if (!shouldPersistOwnerConstraint(cleaned)) {
    return board;
  }
  const nowMs = params.nowMs ?? Date.now();
  const priorList = normalizeConstraintEntries(current.effectiveConstraints);
  if (priorList.some((row) => row.text === cleaned && !row.superseded)) {
    return board;
  }
  const fullReplace = isOwnerConstraintFullReplace(cleaned);
  const revise = fullReplace || isOwnerConstraintRevision(cleaned);
  // Only wholesale replace marks prior active rows superseded. Local revise keeps them.
  const nextList: ConstraintEntry[] = fullReplace
    ? priorList.map((row) => (row.superseded ? row : { ...row, superseded: true }))
    : [...priorList];
  nextList.push({
    text: cleaned,
    atMs: nowMs,
    kind: revise ? "revise" : "supplement",
  });
  const marker = constraintDisplayMarker(cleaned);
  const priorSummary = current.stop.summary?.trim() || `未完成：${current.title}`;
  const nextSummary = priorSummary.includes(marker) ? priorSummary : `${marker}｜${priorSummary}`;
  return {
    ...board,
    current: {
      ...current,
      // Owner pause must survive concurrent constraint appends (cross-process).
      ...(current.wakeSuppress ? { wakeSuppress: true } : {}),
      effectiveConstraints: nextList,
      stop: {
        ...current.stop,
        summary: nextSummary,
      },
    },
  };
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
    return suppressCurrentTaskWake({ board });
  }
  const pauseMatch = incoming.match(/^暂停挂起\s+(\S+)/u);
  if (pauseMatch) {
    return pauseParkedTask({ board, taskId: pauseMatch[1] ?? "" });
  }
  // Cancel the *current* unfinished task (tombstone + clear current).
  if (/^(?:取消当前(?:任务)?|取消任务)[。.!！]?$/u.test(incoming)) {
    return cancelCurrentTask({ board, nowMs });
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

export function suppressCurrentTaskWake(params: {
  board: SessionTaskBoard;
  reason?: string;
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

/** Transcript / UI marker: current focus finished; remind about parked prior tasks. */
export const PARKED_TASK_REMINDER_SENTINEL = "[PARKED_TASK_REMINDER]";

function renderCompletionNotice(parked: readonly TrackedTask[]): string {
  if (parked.length === 0) {
    return "当前任务已完成，交付已核对。";
  }
  // newest-first board: slot 0 is the prior task the user most recently left.
  const primary = parked[0];
  if (!primary) {
    return "当前任务已完成，交付已核对。";
  }
  const where = primary.stop.summary || "未记录停点";
  const files = primary.stop.workspacePaths.filter(Boolean);
  const lines = [
    "**挂起提醒** · 还有未结束的任务",
    "",
    PARKED_TASK_REMINDER_SENTINEL,
    "",
    `当前任务已完成，交付已核对。已挂起 ${parked.length} 项；可 CONTINUE 继续一项，或 CLOSE 关闭并移出任务板。`,
    "",
    `前任务：「${primary.title}」`,
    `任务 ID：\`${primary.taskId}\``,
    `停在：${where}`,
  ];
  if (files.length > 0) {
    lines.push(`文件：${files.join("、")}`);
  }
  lines.push(`挂起于：${formatParkedAt(primary.parkedAtMs)}`);
  if (parked.length > 1) {
    const others = parked
      .slice(1, MAX_PARKED_TASKS)
      .map((task) => `「${task.title}」`)
      .join("、");
    lines.push("", `另有 ${parked.length - 1} 个挂起任务：${others}。`);
  }
  // Text fallbacks for non-UI / copy-paste clients (CONTINUE / CLOSE aliases accepted).
  lines.push(
    "",
    `继续挂起 ${primary.taskId}`,
    `取消挂起 ${primary.taskId}`,
    `CONTINUE ${primary.taskId}`,
    `CLOSE ${primary.taskId}`,
  );
  return lines.join("\n");
}

/** Real close only. A model claim with closed=false does not announce or rewrite the board. */
export function recordCheckedTaskCompletion(params: { sessionFile?: string; closed: boolean }): {
  notice?: string;
  persisted: boolean;
} {
  if (!params.closed) {
    return { persisted: false };
  }
  const file = params.sessionFile?.trim();
  if (!file) {
    return { persisted: false };
  }
  // Lock contention / stale CAS must not crash the caller (cross-process completer
  // busy-loops). Surface persisted:false so the peer can retry.
  let finished: { board: SessionTaskBoard; notice?: string };
  try {
    finished = mutateSessionTaskBoard(file, (board) => {
      const result = board.current
        ? finishCurrentTask({ board, deliverableChecked: true })
        : { board, notice: renderCompletionNotice(board.parked) };
      return { board: result.board, value: result };
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
  const notice = finished.notice ?? renderCompletionNotice(finished.board.parked);
  let persisted = false;
  if (fs.existsSync(file)) {
    const message = {
      role: "assistant",
      content: [{ type: "text", text: notice }],
      timestamp: Date.now(),
      taskCompletionNotice: true,
    };
    fs.appendFileSync(file, `${JSON.stringify({ message })}\n`, "utf8");
    persisted = true;
  }
  return { notice, persisted };
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

function normalizeTrackedTask(task: TrackedTask | undefined): TrackedTask | undefined {
  if (!task) {
    return undefined;
  }
  const entries = normalizeConstraintEntries(task.effectiveConstraints);
  return {
    ...task,
    ...(entries.length > 0
      ? { effectiveConstraints: entries }
      : { effectiveConstraints: undefined }),
  };
}

function withSessionTaskBoardLock<T>(sessionFile: string, fn: () => T): T {
  const boardPath = sessionTaskBoardPath(sessionFile);
  return withFileLockSync(boardPath, SESSION_TASK_BOARD_LOCK_OPTIONS, fn);
}

function readSessionTaskBoardUnlocked(sessionFile?: string): SessionTaskBoard {
  const file = sessionFile?.trim();
  if (!file) {
    return emptySessionTaskBoard();
  }
  try {
    const raw = fs.readFileSync(sessionTaskBoardPath(file), "utf8");
    const parsed = JSON.parse(raw) as SessionTaskBoard;
    if (!parsed || !Array.isArray(parsed.parked)) {
      return emptySessionTaskBoard();
    }
    return {
      current: normalizeTrackedTask(parsed.current),
      parked: parsed.parked.map((row) => normalizeTrackedTask(row) ?? row),
      focusRevision: typeof parsed.focusRevision === "number" ? parsed.focusRevision : 0,
      ...(typeof parsed.writeEpoch === "number" ? { writeEpoch: parsed.writeEpoch } : {}),
      ...(Array.isArray(parsed.tombstones) ? { tombstones: parsed.tombstones } : {}),
      ...(Array.isArray(parsed.archived) ? { archived: parsed.archived } : {}),
      ...(parsed.scope ? { scope: parsed.scope } : {}),
    };
  } catch {
    return emptySessionTaskBoard();
  }
}

/**
 * Write under an already-held board lock. Epoch always advances from the *on-disk*
 * value so concurrent callers cannot invent a non-monotonic generation from a stale board.
 */
function writeSessionTaskBoardUnlocked(sessionFile: string, board: SessionTaskBoard): void {
  const disk = readSessionTaskBoardUnlocked(sessionFile);
  const diskEpoch = typeof disk.writeEpoch === "number" ? disk.writeEpoch : 0;
  const normalized: SessionTaskBoard = {
    ...board,
    focusRevision: board.focusRevision ?? 0,
    writeEpoch: diskEpoch + 1,
    parked: board.parked ?? [],
    current: normalizeTrackedTask(board.current) ?? board.current,
  };
  const target = sessionTaskBoardPath(sessionFile);
  const tmp = `${target}.${process.pid}.${randomUUID()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(normalized)}\n`, "utf8");
  fs.renameSync(tmp, target);
}

export function readSessionTaskBoard(sessionFile?: string): SessionTaskBoard {
  return readSessionTaskBoardUnlocked(sessionFile);
}

export class StaleSessionTaskBoardWriteError extends Error {
  readonly claimedEpoch: number | undefined;
  readonly diskEpoch: number;
  constructor(claimedEpoch: number | undefined, diskEpoch: number) {
    super(
      `stale session task board write: claimed writeEpoch=${String(claimedEpoch)} disk=${diskEpoch}`,
    );
    this.name = "StaleSessionTaskBoardWriteError";
    this.claimedEpoch = claimedEpoch;
    this.diskEpoch = diskEpoch;
  }
}

/**
 * Locked read → mutate → write. Production RMW must use this (or commitSameTaskConstraint /
 * commitBoardMutation). Never read outside the lock and call writeSessionTaskBoard with a snapshot.
 */
export function mutateSessionTaskBoard<T>(
  sessionFile: string,
  mutate: (live: SessionTaskBoard) => { board: SessionTaskBoard; value: T },
): T {
  return withSessionTaskBoardLock(sessionFile, () => {
    const live = readSessionTaskBoardUnlocked(sessionFile);
    const { board, value } = mutate(live);
    writeSessionTaskBoardUnlocked(sessionFile, board);
    return value;
  });
}

/**
 * Fixture/bootstrap replace under the same file lock, without writeEpoch CAS.
 * Runtime production paths must not call this — use mutateSessionTaskBoard /
 * commitSameTaskConstraint / commitBoardMutation.
 */
export function seedSessionTaskBoard(sessionFile: string, board: SessionTaskBoard): void {
  withSessionTaskBoardLock(sessionFile, () => {
    writeSessionTaskBoardUnlocked(sessionFile, board);
  });
}

/**
 * Locked write with explicit writeEpoch compare-and-set against the on-disk board.
 * - Empty / epoch-0 disk: bootstrap allowed without a claimed epoch.
 * - Non-zero disk epoch: caller must pass board.writeEpoch equal to disk; otherwise throws
 *   StaleSessionTaskBoardWriteError (closes the stale-snapshot overwrite window).
 * Production RMW should prefer mutateSessionTaskBoard so the mutate fn sees the live board.
 */
export function writeSessionTaskBoard(sessionFile: string, board: SessionTaskBoard): void {
  withSessionTaskBoardLock(sessionFile, () => {
    const disk = readSessionTaskBoardUnlocked(sessionFile);
    const diskEpoch = typeof disk.writeEpoch === "number" ? disk.writeEpoch : 0;
    const claimed = board.writeEpoch;
    if (diskEpoch > 0 && claimed !== diskEpoch) {
      throw new StaleSessionTaskBoardWriteError(claimed, diskEpoch);
    }
    writeSessionTaskBoardUnlocked(sessionFile, board);
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
