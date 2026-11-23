import type {
  CurrentTaskResumeRequest,
  CurrentTaskResumeResult,
} from "../../contracts/task-binding.js";
import { activeConstraintTexts, isTaskTombstoned } from "../../policy/index.js";
import { mutateSessionTaskBoard } from "../repository/task-board-file.js";
class RejectedResume extends Error {}
/** Fixed host authorization is mandatory; reuse the original locked state mutation. */
export function resumePausedCurrentTask(
  sessionFile: string,
  request: CurrentTaskResumeRequest,
  recheck: {
    authOk: boolean;
    stopActive: boolean;
    budgetOk?: boolean;
    planOk?: boolean;
    workspaceOk?: boolean;
  },
): CurrentTaskResumeResult {
  if (
    !recheck.authOk ||
    recheck.stopActive ||
    recheck.budgetOk === false ||
    recheck.planOk === false ||
    recheck.workspaceOk === false
  ) {
    return { kind: "rejected", reason: "resume_not_authorized" };
  }
  try {
    return mutateSessionTaskBoard(sessionFile, (board) => {
      const task = board.current;
      if (
        !task?.unfinished ||
        task.taskId !== request.taskId ||
        board.focusRevision !== request.expectedFocusRevision ||
        (board.writeEpoch ?? 0) !== request.expectedWriteEpoch ||
        isTaskTombstoned(board, request.taskId)
      ) {
        throw new RejectedResume("revision_mismatch");
      }
      if (request.action === "continue" && task.wakeSuppress === true) {
        throw new RejectedResume("task_paused_requires_resume");
      }
      if (request.action !== "continue" && task.wakeSuppress !== true) {
        throw new RejectedResume("not_paused");
      }
      return {
        board: {
          ...board,
          focusRevision:
            request.action === "continue" ? board.focusRevision : board.focusRevision + 1,
          current: {
            ...task,
            wakeSuppress: false,
            executionAttempt: undefined,
            deliverableVersion: undefined,
            deliverableChecked: false,
          },
        },
        value: {
          kind: "accepted" as const,
          binding: { taskId: task.taskId, constraints: activeConstraintTexts(task) },
          acceptance: task.acceptanceCriteria ?? [],
        },
      };
    });
  } catch (error) {
    if (error instanceof RejectedResume) {
      return { kind: "rejected", reason: error.message };
    }
    throw error;
  }
}
