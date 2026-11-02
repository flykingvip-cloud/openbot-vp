/**
 * Mid-task aside disposition (slice2 design): classify aside while A is active.
 * board_readonly answers are projections only — never mutate the task board.
 * General reply_lane timely LLM replies remain unfinished (see design doc).
 */
import {
  activeConstraintTexts,
  formatTaskBoardFocusLine,
  type SessionTaskBoard,
} from "../../conversation-task/session-task-board.js";
import { classifyTurnRelation } from "../../conversation-task/turn-relation.js";
import { isProgressStatusQuery, stripInboundStampForDialogue } from "./mid-task-dialogue.js";

export type MidTaskAsideDisposition =
  | { kind: "not_aside" }
  | { kind: "progress" }
  | { kind: "board_readonly"; reply: string }
  | { kind: "reply_lane_pending" };

const GOAL_QUERY_RE =
  /^(?:请问?)?(?:当前)?(?:任务)?(?:目标|在做什么|做什么任务|任务是什么|现在的目标)(?:是|的)?(?:什么|嘛|吗)?[?？!！。.\s]*$/u;

const CONSTRAINT_QUERY_RE =
  /^(?:请问?)?(?:当前)?(?:有哪些|有什么|有效的?|有效)?(?:约束|限制|补充要求|补充约束)(?:有哪些|有什么|是什么)?[?？!！。.\s]*$/u;

function truncateDisplay(text: string, max: number): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) {
    return cleaned;
  }
  return `${cleaned.slice(0, max)}…`;
}

export function formatBoardReadonlyAsideReply(
  board: SessionTaskBoard,
  kind: "goal" | "constraints",
): string {
  const focus = formatTaskBoardFocusLine(board);
  const current = board.current;
  if (!current) {
    return `${focus}。任务板最近记录：没有未完成任务可汇报。`;
  }
  if (kind === "goal") {
    const goal = current.goalText?.trim() || current.title;
    return `${focus}。任务板最近记录：目标「${truncateDisplay(goal, 120)}」。`;
  }
  const list = activeConstraintTexts(current);
  if (list.length === 0) {
    return `${focus}。任务板最近记录：尚无已登记的有效约束。`;
  }
  const shown = list.map((row, i) => `${i + 1}. ${truncateDisplay(row, 160)}`).join("；");
  return `${focus}。任务板最近记录：有效约束 ${list.length} 条——${shown}。`;
}

/**
 * Resolve aside / board-readonly handling while a background task is active.
 * Goal/constraint *read* asks are recognized before turn-relation (which may
 * label them amend). Does not write the board. progress stays a separate kind
 * so the existing progress path remains the sole owner of progress replies.
 */
export function resolveMidTaskAsideDisposition(params: {
  prompt: string;
  board: SessionTaskBoard;
}): MidTaskAsideDisposition {
  const cleaned = stripInboundStampForDialogue(params.prompt);
  if (!cleaned || cleaned.startsWith("/")) {
    return { kind: "not_aside" };
  }
  if (isProgressStatusQuery(cleaned)) {
    return { kind: "progress" };
  }
  // Read-only board projections — check BEFORE classifyTurnRelation, because
  // phrases like「有效约束有哪些」may classify as amend and must not steer.
  if (GOAL_QUERY_RE.test(cleaned)) {
    return {
      kind: "board_readonly",
      reply: formatBoardReadonlyAsideReply(params.board, "goal"),
    };
  }
  if (CONSTRAINT_QUERY_RE.test(cleaned)) {
    return {
      kind: "board_readonly",
      reply: formatBoardReadonlyAsideReply(params.board, "constraints"),
    };
  }
  const goal = params.board.current?.goalText?.trim() ?? "";
  if (!goal) {
    return { kind: "not_aside" };
  }
  if (classifyTurnRelation(cleaned, goal) !== "aside") {
    return { kind: "not_aside" };
  }
  return { kind: "reply_lane_pending" };
}
