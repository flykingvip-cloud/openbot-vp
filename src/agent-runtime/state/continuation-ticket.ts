import { buildResumePrompt } from "../context/index.js";
import type { TaskBoardContinueSkipReason } from "../contracts/continuation.js";
import type { SessionTaskBoard, TrackedTask } from "../contracts/task.js";
import { isTaskTombstoned } from "../policy/index.js";
import {
  TASK_BOARD_CONTINUE_MAX_PER_TASK,
  TASK_BOARD_CONTINUE_COOLDOWN_MS,
} from "../policy/task-board-limits.js";
import {
  readSessionTaskBoard,
  withSessionTaskBoardLock,
  readSessionTaskBoardUnlocked,
  writeSessionTaskBoardUnlocked,
} from "./repository/task-board-file.js";

export function countRecentTaskContinuations(task: TrackedTask, nowMs: number): number {
  return (task.continuationWakeAtMs ?? []).filter(
    (at) => Number.isFinite(at) && at >= nowMs - TASK_BOARD_CONTINUE_COOLDOWN_MS,
  ).length;
}

/** Reserve under the existing board lock; concurrent processes share the same cap. */
export function reserveTaskContinuation(params: {
  sessionFile: string;
  taskId: string;
  focusRevision: number;
  nowMs: number;
}): { ok: true } | { ok: false; reason: TaskBoardContinueSkipReason } {
  return withSessionTaskBoardLock(params.sessionFile, () => {
    const board = readSessionTaskBoardUnlocked(params.sessionFile);
    const checked = revalidateContinueTicket({ board, ...params });
    if (!checked.ok) {
      return checked;
    }
    if (
      countRecentTaskContinuations(checked.task, params.nowMs) >= TASK_BOARD_CONTINUE_MAX_PER_TASK
    ) {
      return { ok: false, reason: "continue_cap" };
    }
    const recent = (checked.task.continuationWakeAtMs ?? []).filter(
      (at) => Number.isFinite(at) && at >= params.nowMs - TASK_BOARD_CONTINUE_COOLDOWN_MS,
    );
    writeSessionTaskBoardUnlocked(params.sessionFile, {
      ...board,
      current: { ...checked.task, continuationWakeAtMs: [...recent, params.nowMs] },
    });
    return { ok: true };
  });
}
const INTERNAL_CONTINUE_PREFIX = "Internal task-board continue:";

export function buildTaskBoardContinuePrompt(task: TrackedTask): string {
  return [
    INTERNAL_CONTINUE_PREFIX,
    "The previous turn ended while this task is still unfinished on the session task board.",
    "Continue the same task now: call tools and deliver an openable result.",
    "Stop only for a true human gate (permission you lack, payment/QR, irreversible outbound, or a fact only the user knows).",
    "Do not ask soft confirmation such as whether to push a draft or reuse an asset — produce the deliverable and report.",
    buildResumePrompt(task),
  ].join("\n");
}

/**
 * C2: revalidate taskId + focusRevision against the live board (enqueue and claim).
 */
export function revalidateContinueTicket(params: {
  board: SessionTaskBoard;
  taskId: string;
  focusRevision: number;
}): { ok: true; task: TrackedTask } | { ok: false; reason: TaskBoardContinueSkipReason } {
  const taskId = params.taskId.trim();
  if (!taskId) {
    return { ok: false, reason: "task_id_mismatch" };
  }
  if (isTaskTombstoned(params.board, taskId)) {
    return { ok: false, reason: "tombstoned" };
  }
  const current = params.board.current;
  if (!current?.unfinished || !current.taskId) {
    return { ok: false, reason: "no_unfinished_current" };
  }
  if (current.taskId !== taskId) {
    return { ok: false, reason: "task_id_mismatch" };
  }
  if ((params.board.focusRevision ?? 0) !== params.focusRevision) {
    return { ok: false, reason: "revision_mismatch" };
  }
  if (current.wakeSuppress === true) {
    return { ok: false, reason: "wake_suppress" };
  }
  return { ok: true, task: current };
}

/** Claim-time revalidation (C2). A queued then insert B → claim A rejects. */
export function claimTaskBoardContinue(params: {
  sessionFile?: string | null;
  taskId: string;
  focusRevision: number;
}):
  | { ok: true; task: TrackedTask; focusRevision: number; prompt: string }
  | { ok: false; reason: TaskBoardContinueSkipReason } {
  const sessionFile = typeof params.sessionFile === "string" ? params.sessionFile.trim() : "";
  if (!sessionFile) {
    return { ok: false, reason: "no_session_file" };
  }
  let board: SessionTaskBoard;
  try {
    board = readSessionTaskBoard(sessionFile);
  } catch {
    return { ok: false, reason: "no_session_file" };
  }
  const checked = revalidateContinueTicket({
    board,
    taskId: params.taskId,
    focusRevision: params.focusRevision,
  });
  if (!checked.ok) {
    return checked;
  }
  return {
    ok: true,
    task: checked.task,
    focusRevision: board.focusRevision ?? 0,
    prompt: buildTaskBoardContinuePrompt(checked.task),
  };
}
