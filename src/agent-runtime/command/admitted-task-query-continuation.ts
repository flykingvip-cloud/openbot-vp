/**
 * Query / run / wait / stop: a status or clarifying question must not idle an
 * already-admitted task, and the query reply must not assume “continue?”
 * scheduling duty. The host continues the admitted work when it is still
 * runnable. This does not start execution from prose_downgrade.
 */
import { INTERACTION_PROSE_PROTOCOL_DOWNGRADE } from "../contracts/interaction.js";
import type { SessionTaskBoard } from "../contracts/task.js";
import { taskMatchesResetGeneration } from "../state/mutations/session-reset-focus.js";

export type AdmittedTaskQueryContinuation = {
  shouldContinue: boolean;
  taskId?: string;
  reason:
    | "continue_admitted"
    | "no_current_task"
    | "task_paused"
    | "generation_mismatch"
    | "prose_downgrade"
    | "already_finished";
};

export function admittedTaskQueryContinuation(params: {
  board: SessionTaskBoard;
  protocolDowngrade?: typeof INTERACTION_PROSE_PROTOCOL_DOWNGRADE;
}): AdmittedTaskQueryContinuation {
  const current = params.board.current;
  if (!current?.taskId) {
    return { shouldContinue: false, reason: "no_current_task" };
  }
  if (!current.unfinished) {
    return { shouldContinue: false, taskId: current.taskId, reason: "already_finished" };
  }
  if (current.wakeSuppress === true) {
    return { shouldContinue: false, taskId: current.taskId, reason: "task_paused" };
  }
  if (!taskMatchesResetGeneration(current, params.board)) {
    return { shouldContinue: false, taskId: current.taskId, reason: "generation_mismatch" };
  }
  if (params.protocolDowngrade === INTERACTION_PROSE_PROTOCOL_DOWNGRADE) {
    return { shouldContinue: false, taskId: current.taskId, reason: "prose_downgrade" };
  }
  return { shouldContinue: true, taskId: current.taskId, reason: "continue_admitted" };
}
