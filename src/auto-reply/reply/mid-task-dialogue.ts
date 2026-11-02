/**
 * Mid-task dialogue helpers: progress status projection and amend-once ack.
 * Reuses SessionTaskBoard as the sole task-state projection — not a second controller.
 */
import {
  formatTaskBoardFocusLine,
  type SessionTaskBoard,
  type TrackedTask,
} from "../../conversation-task/session-task-board.js";

const INBOUND_STAMP_RE = /^\[[A-Za-z]{3} \d{4}-\d{2}-\d{2} [0-9:]{4,8} GMT[+-]\d+\]\s*/;

/** Narrow progress / status asks that can be answered from the board alone. */
const PROGRESS_STATUS_QUERY_RE =
  /^(?:请问?)?(?:现在)?(?:任务)?(?:进度(?:如何|怎样|怎么样)?|做到哪(?:里|儿)?了?|怎么样了|进行到哪了|还差(?:什么|多少)?|完成了吗|完成了没|到哪一步了|当前进度)[?？!！。.\s]*$/u;

export function stripInboundStampForDialogue(text: string): string {
  return text.replace(INBOUND_STAMP_RE, "").trim();
}

export function isProgressStatusQuery(text: string): boolean {
  const cleaned = stripInboundStampForDialogue(text);
  if (!cleaned || cleaned.startsWith("/")) {
    return false;
  }
  return PROGRESS_STATUS_QUERY_RE.test(cleaned);
}

export function formatTaskBoardProgressReply(board: SessionTaskBoard): string {
  const current = board.current;
  const focus = formatTaskBoardFocusLine(board);
  if (!current) {
    return `${focus}。没有正在推进的任务可汇报。`;
  }
  const parts = [
    focus,
    current.unfinished ? "状态：进行中" : "状态：已结束待核对",
    current.wakeSuppress === true ? "自动续跑：已暂停（wakeSuppress）" : "自动续跑：未抑制",
    `停点：${current.stop.summary || "未记录"}`,
  ];
  if (current.goalText?.trim()) {
    const goal = current.goalText.trim().replace(/\s+/g, " ");
    parts.push(`目标：${goal.length > 80 ? `${goal.slice(0, 80)}…` : goal}`);
  }
  return parts.join("。") + "。";
}

export function formatAmendConstraintAck(prompt: string): string {
  const cleaned = stripInboundStampForDialogue(prompt).replace(/\s+/g, " ").trim();
  const short = cleaned.length > 60 ? `${cleaned.slice(0, 60)}…` : cleaned;
  return `已将补充约束注入当前执行（仅一次）：${short || "（空）"}。后台任务继续，不会因这条补充另起一轮业务执行。`;
}

/** Append a same-task constraint note onto stop.summary without bumping focusRevision. */
export function applySameTaskConstraintNote(
  task: TrackedTask,
  constraintText: string,
): TrackedTask {
  const cleaned = stripInboundStampForDialogue(constraintText).replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return task;
  }
  const short = cleaned.length > 48 ? `${cleaned.slice(0, 48)}…` : cleaned;
  const marker = `约束：${short}`;
  const prior = task.stop.summary?.trim() || `未完成：${task.title}`;
  if (prior.includes(marker)) {
    return task;
  }
  return {
    ...task,
    stop: {
      ...task.stop,
      summary: `${marker}｜${prior}`,
    },
  };
}
