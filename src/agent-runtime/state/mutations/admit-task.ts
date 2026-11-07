import type { TaskAcceptanceCheck } from "../../contracts/quality.js";
import type { TaskCompletionBinding } from "../../contracts/task.js";
import { isTaskTombstoned, parseTaskAcceptanceChecks } from "../../policy/index.js";
import {
  withSessionTaskBoardLock,
  readSessionTaskBoardUnlocked,
  writeSessionTaskBoardUnlocked,
} from "../repository/task-board-file.js";
import { insertLatestTaskDeferringCurrent } from "./task-focus.js";

/** Explicit execution admission; ordinary dialogue never calls this transaction. */
export function commitAdmittedSessionTask(params: {
  sessionFile: string;
  requestId: string;
  goal: string;
  acceptance: readonly string[];
  checks?: readonly TaskAcceptanceCheck[];
  expectedFocusRevision: number;
  expectedWriteEpoch: number;
  expectedTaskId?: string;
}):
  | { kind: "accepted"; binding: TaskCompletionBinding }
  | { kind: "duplicate"; binding: TaskCompletionBinding }
  | { kind: "rejected"; reason: string } {
  return withSessionTaskBoardLock(params.sessionFile, () => {
    const parsedChecks = parseTaskAcceptanceChecks(params.checks, params.acceptance.length);
    if (!parsedChecks.ok) {
      return { kind: "rejected", reason: "invalid_acceptance_checks" };
    }
    const board = readSessionTaskBoardUnlocked(params.sessionFile);
    const current = board.current;
    if (current?.admissionRequestId === params.requestId) {
      if (!current.unfinished || current.wakeSuppress || isTaskTombstoned(board, current.taskId)) {
        return { kind: "rejected", reason: "task_not_executable" };
      }
      if (
        current.goalText !== params.goal ||
        JSON.stringify(current.acceptanceCriteria) !== JSON.stringify(params.acceptance) ||
        JSON.stringify(current.acceptanceChecks ?? []) !== JSON.stringify(parsedChecks.checks)
      ) {
        return { kind: "rejected", reason: "request_conflict" };
      }
      return {
        kind: "duplicate",
        binding: {
          taskId: current.taskId,
          executionAttempt: current.executionAttempt,
          deliverableVersion: current.deliverableVersion,
        },
      };
    }
    if (
      board.focusRevision !== params.expectedFocusRevision ||
      (board.writeEpoch ?? 0) !== params.expectedWriteEpoch ||
      current?.taskId !== params.expectedTaskId
    ) {
      return { kind: "rejected", reason: "revision_mismatch" };
    }
    if (
      !params.requestId.trim() ||
      !params.goal.trim() ||
      !params.acceptance.length ||
      params.acceptance.some((item) => !item.trim())
    ) {
      return { kind: "rejected", reason: "invalid_request" };
    }
    const result = insertLatestTaskDeferringCurrent({
      board,
      goalText: params.goal,
      inboundRequestId: params.requestId,
    });
    if (
      !result.board.current ||
      isTaskTombstoned(board, result.taskId) ||
      board.parked.some((task) => task.taskId === result.taskId) ||
      board.archived?.some((task) => task.taskId === result.taskId)
    ) {
      return { kind: "rejected", reason: "request_already_retired" };
    }
    result.board.current = {
      ...result.board.current,
      acceptanceCriteria: [...params.acceptance],
      ...(params.checks !== undefined ? { acceptanceChecks: parsedChecks.checks } : {}),
      admissionRequestId: params.requestId,
    };
    writeSessionTaskBoardUnlocked(params.sessionFile, result.board);
    return { kind: "accepted", binding: { taskId: result.taskId } };
  });
}
