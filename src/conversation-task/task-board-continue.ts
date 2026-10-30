/**
 * Private-chat SessionTaskBoard auto-continue after a turn ends with stop.
 *
 * When task-board.current.unfinished is true and the assistant stopped without an
 * explicit human gate, schedule a followup agentTurn on the same sessionKey
 * (source=task_board_continue). Collaboration self_advance / confirmTodolist are
 * out of scope — do not widen those semantics here.
 */
import { createSubsystemLogger } from "../logging/subsystem.js";
import {
  buildResumePrompt,
  isTaskTombstoned,
  readSessionTaskBoard,
  type SessionTaskBoard,
  type TrackedTask,
} from "./session-task-board.js";

const log = createSubsystemLogger("conversation-task/task-board-continue");

/** Default short delay before the continue wake (ms). */
export const TASK_BOARD_CONTINUE_DELAY_MS = 1_500;

/** Cap chained auto-continues per taskId within the cooldown window. */
export const TASK_BOARD_CONTINUE_MAX_PER_TASK = 3;

/** Cooldown window for the per-task continue cap (ms). */
export const TASK_BOARD_CONTINUE_COOLDOWN_MS = 15 * 60 * 1000;

const INTERNAL_CONTINUE_PREFIX = "Internal task-board continue:";

/** Structured / hard human-gate markers — do not auto-wake. */
const HUMAN_GATE_RE =
  /\[turn_completion\s+state=(?:permanent_block|true_fork)\b|waiting_confirmation|owner-decision|owner_decision|等待你确认|等待确认后|请扫码|请支付|二维码|验证码|授权登录/iu;

/** Soft 「要不要…」 alone is NOT a human gate for P0 (narrowed in P1 prompts). */

export type TaskBoardContinueSkipReason =
  | "heartbeat"
  | "tools_disabled"
  | "no_session_file"
  | "no_unfinished_current"
  | "human_gate"
  | "wake_suppress"
  | "internal_continue_prompt"
  | "continue_cap"
  | "missing_queue"
  | "revision_mismatch"
  | "task_id_mismatch"
  | "tombstoned";

/** Continue ticket carrying taskId + focus revision (C2). */
export type TaskBoardContinueTicket = {
  taskId: string;
  focusRevision: number;
  prompt: string;
};

export type TaskBoardContinueDecision =
  | {
      action: "skip";
      reason: TaskBoardContinueSkipReason;
      wakeRecorded: false;
      taskId?: string;
      focusRevision?: number;
    }
  | {
      action: "schedule";
      reason: "task_board_continue";
      wakeRecorded: true;
      taskId: string;
      focusRevision: number;
      prompt: string;
      delayMs: number;
      ticket: TaskBoardContinueTicket;
    };

type ContinueLedgerEntry = { taskId: string; atMs: number };

const continueLedger: ContinueLedgerEntry[] = [];

export function resetTaskBoardContinueLedgerForTest(): void {
  continueLedger.length = 0;
}

export function isTaskBoardContinueInternalPrompt(text: string): boolean {
  return text.trimStart().startsWith(INTERNAL_CONTINUE_PREFIX);
}

/**
 * Explicit human-gate wait: structured turn_completion permanent_block / true_fork,
 * owner-decision / waiting_confirmation markers, or hard auth/payment pauses.
 * Soft 「请确认」 without those markers is not a gate here (in-turn stall continue
 * already handles a bounded soft confirm).
 */
export function isExplicitHumanGateWait(assistantText: string): boolean {
  const text = assistantText.trim();
  if (!text) {
    return false;
  }
  return HUMAN_GATE_RE.test(text);
}

function pruneLedger(nowMs: number): void {
  const cutoff = nowMs - TASK_BOARD_CONTINUE_COOLDOWN_MS;
  while (continueLedger.length > 0 && continueLedger[0].atMs < cutoff) {
    continueLedger.shift();
  }
}

function continuesForTask(taskId: string, nowMs: number): number {
  pruneLedger(nowMs);
  return continueLedger.filter((row) => row.taskId === taskId).length;
}

function rememberContinue(taskId: string, nowMs: number): void {
  pruneLedger(nowMs);
  continueLedger.push({ taskId, atMs: nowMs });
}

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

export function decideTaskBoardContinue(params: {
  sessionFile?: string | null;
  assistantText?: string | null;
  isHeartbeat?: boolean;
  toolsDisabled?: boolean;
  nowMs?: number;
  delayMs?: number;
}): TaskBoardContinueDecision {
  if (params.isHeartbeat) {
    return { action: "skip", reason: "heartbeat", wakeRecorded: false };
  }
  if (params.toolsDisabled) {
    return { action: "skip", reason: "tools_disabled", wakeRecorded: false };
  }
  const sessionFile = typeof params.sessionFile === "string" ? params.sessionFile.trim() : "";
  if (!sessionFile) {
    return { action: "skip", reason: "no_session_file", wakeRecorded: false };
  }
  const assistantText = typeof params.assistantText === "string" ? params.assistantText : "";
  if (isTaskBoardContinueInternalPrompt(assistantText)) {
    // Defense in depth: never chain from our own prompt text as "assistant".
    return {
      action: "skip",
      reason: "internal_continue_prompt",
      wakeRecorded: false,
    };
  }
  if (isExplicitHumanGateWait(assistantText)) {
    return { action: "skip", reason: "human_gate", wakeRecorded: false };
  }

  let board;
  try {
    board = readSessionTaskBoard(sessionFile);
  } catch {
    return { action: "skip", reason: "no_session_file", wakeRecorded: false };
  }
  const current = board.current;
  if (!current?.unfinished || !current.taskId) {
    return { action: "skip", reason: "no_unfinished_current", wakeRecorded: false };
  }
  if (current.wakeSuppress === true) {
    return {
      action: "skip",
      reason: "wake_suppress",
      wakeRecorded: false,
      taskId: current.taskId,
    };
  }

  const nowMs = params.nowMs ?? Date.now();
  if (continuesForTask(current.taskId, nowMs) >= TASK_BOARD_CONTINUE_MAX_PER_TASK) {
    return {
      action: "skip",
      reason: "continue_cap",
      wakeRecorded: false,
      taskId: current.taskId,
      focusRevision: board.focusRevision ?? 0,
    };
  }

  if (isTaskTombstoned(board, current.taskId)) {
    return {
      action: "skip",
      reason: "tombstoned",
      wakeRecorded: false,
      taskId: current.taskId,
      focusRevision: board.focusRevision ?? 0,
    };
  }

  const focusRevision = board.focusRevision ?? 0;
  const prompt = buildTaskBoardContinuePrompt(current);
  // C2 enqueue-time revalidation of the ticket we are about to arm.
  const enqueueCheck = revalidateContinueTicket({
    board,
    taskId: current.taskId,
    focusRevision,
  });
  if (!enqueueCheck.ok) {
    return {
      action: "skip",
      reason: enqueueCheck.reason,
      wakeRecorded: false,
      taskId: current.taskId,
      focusRevision,
    };
  }

  return {
    action: "schedule",
    reason: "task_board_continue",
    wakeRecorded: true,
    taskId: current.taskId,
    focusRevision,
    prompt,
    delayMs: params.delayMs ?? TASK_BOARD_CONTINUE_DELAY_MS,
    ticket: { taskId: current.taskId, focusRevision, prompt },
  };
}

export type TaskBoardContinueEnqueue = (prompt: string, messageId: string) => boolean;

/**
 * Decide + optionally schedule a delayed enqueue. Returns the decision for tests
 * and gateway observability (wakeRecorded / reason / dispatched).
 */
export function scheduleTaskBoardContinueWake(params: {
  sessionFile?: string | null;
  assistantText?: string | null;
  isHeartbeat?: boolean;
  toolsDisabled?: boolean;
  nowMs?: number;
  delayMs?: number;
  /** When false, only decide + log; do not arm the timer (tests). */
  armTimer?: boolean;
  enqueue: TaskBoardContinueEnqueue;
  setTimer?: typeof setTimeout;
}): TaskBoardContinueDecision & { dispatched?: boolean } {
  const decision = decideTaskBoardContinue(params);
  if (decision.action !== "schedule") {
    log.info("task_board_continue skip", {
      reason: decision.reason,
      wakeRecorded: false,
      dispatched: false,
      taskId: decision.taskId,
    });
    return { ...decision, dispatched: false };
  }

  const nowMs = params.nowMs ?? Date.now();
  rememberContinue(decision.taskId, nowMs);
  const messageId = `task-board-continue:${decision.taskId}:r${decision.focusRevision}:${nowMs}`;
  log.info("task_board_continue wakeRecorded", {
    reason: decision.reason,
    wakeRecorded: true,
    dispatched: false,
    taskId: decision.taskId,
    delayMs: decision.delayMs,
    messageId,
  });

  if (params.armTimer === false) {
    return { ...decision, dispatched: false };
  }

  const setTimer = params.setTimer ?? setTimeout;
  const ticket = decision.ticket;
  const sessionFile = typeof params.sessionFile === "string" ? params.sessionFile.trim() : "";
  setTimer(() => {
    let dispatched = false;
    try {
      // C2 claim-time revalidation: A queued then insert B → reject A.
      const claimed = claimTaskBoardContinue({
        sessionFile,
        taskId: ticket.taskId,
        focusRevision: ticket.focusRevision,
      });
      if (!claimed.ok) {
        log.info("task_board_continue claim rejected", {
          reason: claimed.reason,
          wakeRecorded: true,
          dispatched: false,
          taskId: ticket.taskId,
          focusRevision: ticket.focusRevision,
          messageId,
        });
        return;
      }
      dispatched = params.enqueue(claimed.prompt, messageId);
    } catch (err) {
      log.warn("task_board_continue enqueue failed", {
        reason: decision.reason,
        wakeRecorded: true,
        dispatched: false,
        taskId: decision.taskId,
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    log.info("task_board_continue dispatched", {
      reason: decision.reason,
      wakeRecorded: true,
      dispatched,
      taskId: decision.taskId,
      focusRevision: decision.focusRevision,
      messageId,
    });
  }, decision.delayMs);

  return { ...decision, dispatched: false };
}
