/**
 * Session task board. One current task per session, at most three parked.
 * This record — not transcript fence markers or token overlap — decides
 * whether a turn stays on the current task or starts different work.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import { isTaskSurfaceUtterance } from "../agents/task-surface/surface.js";
import { formatDroppedParkedTaskSentence, type FocusSnapshot } from "./focus-policy.js";
import { classifyTurnRelation, titleFromGoal } from "./turn-relation.js";

export const MAX_PARKED_TASKS = 3;

const INBOUND_STAMP_RE = /^\[[A-Za-z]{3} \d{4}-\d{2}-\d{2} [0-9:]{4,8} GMT[+-]\d+\]\s*/;

export type TaskStop = {
  summary: string;
  workspacePaths: string[];
};

export type TrackedTask = {
  taskId: string;
  title: string;
  goalText: string;
  unfinished: boolean;
  deliverableChecked?: boolean;
  stop: TaskStop;
  parkedAtMs?: number;
  createdAtMs: number;
  /** Why this task was parked (automatic switch, cron surface, etc.). */
  parkReason?: string;
  /** When true, automatic task_board_continue wake stays suppressed until resume. */
  wakeSuppress?: boolean;
};

export type SessionTaskBoard = {
  current?: TrackedTask;
  parked: TrackedTask[];
};

export type IncomingTurnResult = {
  board: SessionTaskBoard;
  action: "continue" | "switch" | "resume" | "cancel_parked";
  taskId: string;
  cutContext: boolean;
  statusLine?: string;
  restoredPrompt?: string;
  currentTitle?: string;
  incomingTitle?: string;
  droppedTitle?: string;
  droppedPaths?: string[];
};

export function emptySessionTaskBoard(): SessionTaskBoard {
  return { parked: [] };
}

export function taskIdForText(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  const digest = createHash("sha256").update(normalized).digest("hex").slice(0, 12);
  return `task-${digest}`;
}

export function sessionTaskBoardPath(sessionFile: string): string {
  return `${sessionFile}.task-board.json`;
}

function stripStamp(text: string): string {
  return text.replace(INBOUND_STAMP_RE, "").trim();
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

function createTask(text: string, nowMs: number, workspacePaths: string[]): TrackedTask {
  const title = titleFromGoal(text);
  return {
    taskId: taskIdForText(text),
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
): { parked: TrackedTask[]; dropped?: TrackedTask } {
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
  return {
    parked: newestFirst.slice(0, MAX_PARKED_TASKS),
    dropped: newestFirst[newestFirst.length - 1],
  };
}

function dropSentence(dropped: TrackedTask | undefined): string {
  if (!dropped) {
    return "";
  }
  return formatDroppedParkedTaskSentence({
    droppedTaskId: dropped.taskId,
    droppedTitle: dropped.title,
    droppedPaths: dropped.stop.workspacePaths,
  });
}

function switchStatus(
  currentTitle: string,
  incomingTitle: string,
  dropped?: TrackedTask,
  parkedCount?: number,
): string {
  const droppedText = dropSentence(dropped);
  const count = typeof parkedCount === "number" ? parkedCount : 1;
  const line = `已挂起「${currentTitle}」，开始「${incomingTitle}」。当前任务：「${incomingTitle}」；已挂起 ${count} 项。`;
  return droppedText ? `${line}${droppedText}` : line;
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

export function buildResumePrompt(task: TrackedTask): string {
  const paths = task.stop.workspacePaths.filter(Boolean);
  const pathLine = paths.length > 0 ? `\n文件：${paths.join("、")}` : "";
  return `继续任务「${task.title}」（${task.taskId}）。\n停在：${task.stop.summary}${pathLine}`;
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
}): IncomingTurnResult {
  const nowMs = params.nowMs ?? Date.now();
  const paths = params.workspacePaths?.filter(Boolean) ?? [];
  const goal = stripStamp(params.goalText);
  const board = {
    current: params.board.current,
    parked: [...params.board.parked],
  };
  if (!goal) {
    return continueResult(board, board.current?.taskId ?? "");
  }
  const created = createTask(goal, nowMs, paths);
  const current = board.current;
  if (!current?.unfinished) {
    return {
      board: { current: created, parked: board.parked },
      action: "switch",
      taskId: created.taskId,
      cutContext: true,
      currentTitle: current?.title,
      incomingTitle: created.title,
      statusLine: `开始「${created.title}」。`,
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
  return {
    board: { current: created, parked: parked.parked },
    action: "switch",
    taskId: created.taskId,
    cutContext: true,
    currentTitle: current.title,
    incomingTitle: created.title,
    statusLine: switchStatus(current.title, created.title, parked.dropped, parked.parked.length),
    ...(parked.dropped
      ? {
          droppedTitle: parked.dropped.title,
          droppedPaths: parked.dropped.stop.workspacePaths,
        }
      : {}),
  };
}

export function applyIncomingUserMessage(params: {
  board: SessionTaskBoard;
  incomingText: string;
  nowMs?: number;
  workspacePaths?: string[];
  recheck?: ResumeParkedRecheck;
}): IncomingTurnResult {
  const nowMs = params.nowMs ?? Date.now();
  const paths = params.workspacePaths?.filter(Boolean) ?? [];
  const incoming = stripStamp(params.incomingText);
  const board = {
    current: params.board.current,
    parked: [...params.board.parked],
  };
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
  const pauseMatch = incoming.match(/^暂停挂起\s+(\S+)/u);
  if (pauseMatch) {
    return pauseParkedTask({ board, taskId: pauseMatch[1] ?? "" });
  }
  // CLOSE / 关闭挂起 / 取消挂起 — remove deferred item from the board entirely.
  const cancelMatch = incoming.match(/^(?:取消挂起|关闭挂起|CLOSE)\s+(\S+)/iu);
  if (cancelMatch) {
    return cancelParkedTask({ board, taskId: cancelMatch[1] ?? "" });
  }

  const current = board.current;
  if (!current) {
    const created = createTask(incoming, nowMs, paths);
    return continueResult({ current: created, parked: board.parked }, created.taskId);
  }
  if (!current.unfinished) {
    if (!isSureDistinctWork(incoming, current.goalText)) {
      return continueResult(board, current.taskId);
    }
    return insertLatestTaskDeferringCurrent({
      board,
      goalText: incoming,
      nowMs,
      workspacePaths: paths,
      parkReason: "user_switch",
    });
  }
  if (!isSureDistinctWork(incoming, current.goalText)) {
    const nextCurrent: TrackedTask = {
      ...current,
      stop: {
        summary: current.stop.summary,
        workspacePaths: paths.length > 0 ? paths : current.stop.workspacePaths,
      },
    };
    return continueResult({ current: nextCurrent, parked: board.parked }, current.taskId);
  }

  return insertLatestTaskDeferringCurrent({
    board,
    goalText: incoming,
    nowMs,
    workspacePaths: paths,
    parkReason: "user_switch",
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
  const parked = findParked(params.board, params.taskId);
  if (!parked) {
    return continueResult(params.board, params.board.current?.taskId ?? "");
  }
  if (params.recheck?.authOk === false) {
    return {
      ...continueResult(params.board, params.board.current?.taskId ?? ""),
      statusLine: `恢复「${parked.title}」被拒绝：当前授权无效。`,
    };
  }
  const stopBlocked =
    typeof params.recheck?.isTaskStopActive === "function"
      ? params.recheck.isTaskStopActive(parked.taskId)
      : params.recheck?.stopActive === true;
  if (stopBlocked) {
    return {
      ...continueResult(params.board, params.board.current?.taskId ?? ""),
      statusLine: `恢复「${parked.title}」被拒绝：任务已停止。`,
    };
  }
  let nextParked = params.board.parked.filter((row) => row.taskId !== parked.taskId);
  let dropped: TrackedTask | undefined;
  const current = params.board.current;
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
    dropped = parkedResult.dropped;
  }
  const restored: TrackedTask = {
    ...parked,
    unfinished: true,
    parkedAtMs: undefined,
    parkReason: undefined,
    wakeSuppress: false,
  };
  const restoredPrompt = buildResumePrompt(restored);
  const droppedText = dropSentence(dropped);
  return {
    board: { current: restored, parked: nextParked },
    action: "resume",
    taskId: restored.taskId,
    cutContext: true,
    currentTitle: current?.title,
    incomingTitle: restored.title,
    restoredPrompt,
    statusLine: `继续「${restored.title}」。停在：${restored.stop.summary}${
      restored.stop.workspacePaths.length > 0
        ? `。文件：${restored.stop.workspacePaths.join("、")}`
        : ""
    }。${droppedText}`,
    ...(dropped ? { droppedTitle: dropped.title, droppedPaths: dropped.stop.workspacePaths } : {}),
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
}): IncomingTurnResult {
  const parked = findParked(params.board, params.taskId);
  if (!parked) {
    return continueResult(params.board, params.board.current?.taskId ?? "");
  }
  return {
    board: {
      current: params.board.current,
      parked: params.board.parked.filter((row) => row.taskId !== parked.taskId),
    },
    action: "cancel_parked",
    taskId: params.board.current?.taskId ?? "",
    cutContext: false,
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
  const board = file ? readSessionTaskBoard(file) : emptySessionTaskBoard();
  const finished = board.current
    ? finishCurrentTask({ board, deliverableChecked: true })
    : { board, notice: renderCompletionNotice(board.parked) };
  const notice = finished.notice ?? renderCompletionNotice(board.parked);
  let persisted = false;
  if (file) {
    writeSessionTaskBoard(file, finished.board);
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
  const board = readSessionTaskBoard(file);
  if (board.parked.some((row) => row.taskId === incomingTaskId)) {
    return undefined;
  }
  const nowMs = params.nowMs ?? Date.now();
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
  writeSessionTaskBoard(file, { current: board.current, parked: parked.parked });
  return parked.dropped;
}

export function finishCurrentTask(params: {
  board: SessionTaskBoard;
  deliverableChecked: boolean;
}): { board: SessionTaskBoard; notice?: string } {
  const current = params.board.current;
  if (!current) {
    return { board: params.board };
  }
  const nextCurrent: TrackedTask = {
    ...current,
    unfinished: false,
    deliverableChecked: params.deliverableChecked,
  };
  const board: SessionTaskBoard = { current: nextCurrent, parked: params.board.parked };
  if (!params.deliverableChecked) {
    return { board };
  }
  return { board, notice: renderCompletionNotice(board.parked) };
}

export function readSessionTaskBoard(sessionFile?: string): SessionTaskBoard {
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
    return { current: parsed.current, parked: parsed.parked };
  } catch {
    return emptySessionTaskBoard();
  }
}

export function writeSessionTaskBoard(sessionFile: string, board: SessionTaskBoard): void {
  fs.writeFileSync(sessionTaskBoardPath(sessionFile), `${JSON.stringify(board)}\n`, "utf8");
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
    const result = applyIncomingUserMessage({
      board: readSessionTaskBoard(sessionFile),
      incomingText: incoming,
      nowMs: params.nowMs,
      workspacePaths: params.workspacePaths,
      recheck: params.recheck,
    });
    writeSessionTaskBoard(sessionFile, result.board);
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
