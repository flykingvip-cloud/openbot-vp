/**
 * Host-bound modification target. An old task must not default as the
 * revision target of a new message. After /new, only a task admitted in the
 * current reset generation may be bound. If none is bound, the model must
 * clarify instead of writing the previous board.
 */
import type { InteractionTaskTarget } from "../contracts/interaction.js";
import type { SessionTaskBoard } from "../contracts/task.js";
import { isTaskTombstoned } from "../policy/index.js";
import { taskMatchesResetGeneration } from "../state/mutations/session-reset-focus.js";

export const UNBOUND_TASK_TARGET_CLARIFY =
  "当前没有绑定可修改的任务目标。请说明要修改哪一项已准入工作，或提出新的任务。修订不会默认写到上一轮任务板。";

export function hostBoundTaskTarget(board: SessionTaskBoard): InteractionTaskTarget | undefined {
  const current = board.current;
  if (!current?.taskId || isTaskTombstoned(board, current.taskId)) {
    return undefined;
  }
  if (!taskMatchesResetGeneration(current, board)) {
    return undefined;
  }
  return { taskId: current.taskId, revision: String(board.writeEpoch ?? 0) };
}
