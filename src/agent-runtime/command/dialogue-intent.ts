/** User dialogue semantics are independent of executor occupancy. */
import { formatTaskBoardFocusLine } from "../context/task-focus.js";
import type { SessionTaskBoard } from "../contracts/task.js";
import { isProgressStatusQuery, stripInboundStampForDialogue } from "./task-status.js";
export type DialogueIntent =
  | { kind: "task_command" | "progress" | "conversation" }
  | { kind: "board_readonly"; reply: string };
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

export type DialogueRulePorts = {
  activeConstraints: (task: NonNullable<SessionTaskBoard["current"]>) => readonly string[];
  isConversation: (prompt: string, goal: string) => boolean;
};
export function formatTaskQueryReply(
  board: SessionTaskBoard,
  kind: "goal" | "constraints",
  rules: DialogueRulePorts,
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
  const list = rules.activeConstraints(current);
  if (list.length === 0) {
    return `${focus}。任务板最近记录：尚无已登记的有效约束。`;
  }
  const shown = list.map((row, i) => `${i + 1}. ${truncateDisplay(row, 160)}`).join("；");
  return `${focus}。任务板最近记录：有效约束 ${list.length} 条——${shown}。`;
}

export function resolveDialogueIntent(
  params: {
    prompt: string;
    board: SessionTaskBoard;
  },
  rules: DialogueRulePorts,
): DialogueIntent {
  const cleaned = stripInboundStampForDialogue(params.prompt);
  if (!cleaned || cleaned.startsWith("/")) {
    return { kind: "task_command" };
  }
  if (isProgressStatusQuery(cleaned)) {
    return { kind: "progress" };
  }
  // Read-only board projections — check BEFORE classifyTurnRelation, because
  // phrases like「有效约束有哪些」may classify as amend and must not steer.
  if (GOAL_QUERY_RE.test(cleaned)) {
    return {
      kind: "board_readonly",
      reply: formatTaskQueryReply(params.board, "goal", rules),
    };
  }
  if (CONSTRAINT_QUERY_RE.test(cleaned)) {
    return {
      kind: "board_readonly",
      reply: formatTaskQueryReply(params.board, "constraints", rules),
    };
  }
  const goal = params.board.current?.goalText?.trim() ?? "";
  if (!goal) {
    return { kind: "task_command" };
  }
  // Reuse task relation rules; execution occupancy never participates in intent.
  if (!rules.isConversation(cleaned, goal)) {
    return { kind: "task_command" };
  }
  return { kind: "conversation" };
}
