import { formatTaskBoardFocusLine } from "../../conversation-task/session-task-board.js";
/**
 * Current-task status query: classification, read-only lookup and factual projection.
 * Display / classification only — task mutations go through session-task-board.
 */
import type { SessionTaskBoard } from "../contracts/task.js";

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

function truncateDisplay(text: string, max: number): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) {
    return cleaned;
  }
  return `${cleaned.slice(0, max)}…`;
}

/**
 * Progress answer from the task-board projection only.
 * unfinished ≠ "正在推进"; never echo internal fields such as wakeSuppress.
 */
export function formatTaskBoardProgressReply(board: SessionTaskBoard): string {
  const current = board.current;
  const focus = formatTaskBoardFocusLine(board);
  if (!current) {
    return `${focus}。任务板最近记录：没有未完成任务可汇报。`;
  }
  const parts = [focus, `任务板最近记录：${current.unfinished ? "未完成" : "已结束待核对"}`];
  if (current.wakeSuppress === true) {
    parts.push("主人已暂停自动续跑");
  }
  const stopSummary = current.stop.summary?.trim();
  if (stopSummary) {
    parts.push(`停点摘要：${truncateDisplay(stopSummary, 80)}`);
  }
  if (current.goalText?.trim()) {
    parts.push(`目标：${truncateDisplay(current.goalText, 80)}`);
  }
  return parts.join("。") + "。";
}

/** Read only after a recognized query; never mutate or synthesize live run status. */
export function queryCurrentTaskStatus(
  prompt: string,
  readBoard: () => SessionTaskBoard,
): string | undefined {
  if (!isProgressStatusQuery(prompt)) {
    return undefined;
  }
  const board = readBoard();
  return board.current ? formatTaskBoardProgressReply(board) : undefined;
}
