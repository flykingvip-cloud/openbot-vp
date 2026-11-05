/** Compatibility vocabulary only; production interaction owns classification. */
import { resolveDialogueIntent } from "../../agent-runtime/command/index.js";
import { formatTaskQueryReply } from "../../agent-runtime/command/index.js";
import { activeConstraintTexts } from "../../conversation-task/session-task-board.js";
import { classifyTurnRelation } from "../../conversation-task/turn-relation.js";
const rules = {
  activeConstraints: activeConstraintTexts,
  isConversation: (prompt: string, goal: string) =>
    classifyTurnRelation(prompt, goal) === "conversation",
};
export function formatBoardReadonlyAsideReply(
  board: Parameters<typeof formatTaskQueryReply>[0],
  kind: "goal" | "constraints",
) {
  return formatTaskQueryReply(board, kind, rules);
}
export type MidTaskAsideDisposition =
  | { kind: "not_aside" | "progress" | "reply_lane_pending" }
  | { kind: "board_readonly"; reply: string };
export function resolveMidTaskAsideDisposition(
  params: Parameters<typeof resolveDialogueIntent>[0],
): MidTaskAsideDisposition {
  const result = resolveDialogueIntent(params, rules);
  switch (result.kind) {
    case "task_command":
      return { kind: "not_aside" };
    case "conversation":
      return { kind: "reply_lane_pending" };
    case "progress":
      return { kind: "progress" };
    case "board_readonly":
      return { kind: "board_readonly", reply: result.reply };
  }
}
