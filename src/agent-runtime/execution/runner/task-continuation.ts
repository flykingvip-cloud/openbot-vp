/**
 * Private-chat SessionTaskBoard auto-continue after a turn ends with stop.
 *
 * When task-board.current.unfinished is true and the assistant stopped without an
 * explicit human gate, schedule a followup agentTurn on the same sessionKey
 * (source=task_board_continue). Collaboration self_advance / confirmTodolist are
 * out of scope — do not widen those semantics here.
 */
import { createSubsystemLogger } from "../../../logging/subsystem.js";
import type {
  TaskBoardContinueDecision,
  TaskBoardContinueTicket,
} from "../../contracts/continuation.js";
import {
  sessionTaskState,
  buildTaskBoardContinuePrompt,
  claimTaskBoardContinue,
  revalidateContinueTicket,
  countRecentTaskContinuations,
  reserveTaskContinuation,
} from "../../state/index.js";
const readSessionTaskBoard = sessionTaskState.read;

const log = createSubsystemLogger("conversation-task/task-board-continue");

/** Default short delay before the continue wake (ms). */
export const TASK_BOARD_CONTINUE_DELAY_MS = 1_500;

/** Cap chained auto-continues per taskId within the cooldown window. */
import { TASK_BOARD_CONTINUE_MAX_PER_TASK } from "../../policy/task-board-limits.js";
export {
  TASK_BOARD_CONTINUE_MAX_PER_TASK,
  TASK_BOARD_CONTINUE_COOLDOWN_MS,
} from "../../policy/task-board-limits.js";

/** Cooldown window for the per-task continue cap (ms). */

const INTERNAL_CONTINUE_PREFIX = "Internal task-board continue:";

/** Structured / hard human-gate markers — do not auto-wake. */
const HUMAN_GATE_RE =
  /\[turn_completion\s+state=(?:permanent_block|true_fork)\b|waiting_confirmation|owner-decision|owner_decision|等待你确认|等待确认后|请扫码|请支付|二维码|验证码|授权登录/iu;

/** Soft 「要不要…」 alone is NOT a human gate for P0 (narrowed in P1 prompts). */

/** Compatibility test hook: authority now lives on the persisted task. */
export function resetTaskBoardContinueLedgerForTest(): void {}

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
  if (countRecentTaskContinuations(current, nowMs) >= TASK_BOARD_CONTINUE_MAX_PER_TASK) {
    return {
      action: "skip",
      reason: "continue_cap",
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

export type TaskBoardContinueEnqueue = (
  prompt: string,
  messageId: string,
  ticket: TaskBoardContinueTicket,
) => boolean;

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
  const reservation = reserveTaskContinuation({
    sessionFile: params.sessionFile?.trim() ?? "",
    taskId: decision.taskId,
    focusRevision: decision.focusRevision,
    nowMs,
  });
  if (!reservation.ok) {
    return {
      action: "skip",
      reason: reservation.reason,
      wakeRecorded: false,
      taskId: decision.taskId,
      focusRevision: decision.focusRevision,
      dispatched: false,
    };
  }
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
      dispatched = params.enqueue(claimed.prompt, messageId, { ...ticket, prompt: claimed.prompt });
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
