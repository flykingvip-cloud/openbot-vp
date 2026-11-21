import type { TurnExecutionAdmission } from "../../contracts/execution.js";
import type { TaskAcceptanceCheck } from "../../contracts/quality.js";
import type { TaskCompletionBinding } from "../../contracts/task-binding.js";
import { isTaskTombstoned, parseTaskAcceptanceChecks } from "../../policy/index.js";
import {
  withSessionTaskBoardLock,
  readSessionTaskBoardUnlocked,
  writeSessionTaskBoardUnlocked,
} from "../repository/task-board-file.js";
import { insertLatestTaskDeferringCurrent } from "./task-focus.js";

/** Execution admission. Only explicitly planned long tasks persist a task focus. */
export function commitAdmittedSessionTask(params: {
  sessionFile: string;
  requestId: string;
  goal: string;
  lifecycle?: "turn" | "long_task";
  acceptance: readonly string[];
  checks?: readonly TaskAcceptanceCheck[];
  expectedFocusRevision: number;
  expectedWriteEpoch: number;
  expectedTaskId?: string;
}):
  | { kind: "accepted"; binding: TaskCompletionBinding }
  | { kind: "accepted_turn"; admission: TurnExecutionAdmission }
  | { kind: "duplicate"; binding: TaskCompletionBinding }
  | { kind: "rejected"; reason: string } {
  return withSessionTaskBoardLock(params.sessionFile, () => {
    const parsedChecks = parseTaskAcceptanceChecks(params.checks, params.acceptance.length);
    if (!parsedChecks.ok) {
      return { kind: "rejected", reason: "invalid_acceptance_checks" };
    }
    if (
      params.lifecycle !== undefined &&
      params.lifecycle !== "turn" &&
      params.lifecycle !== "long_task"
    ) {
      return { kind: "rejected", reason: "invalid_request" };
    }
    const board = readSessionTaskBoardUnlocked(params.sessionFile, true);
    const current = board.current;
    if (params.lifecycle !== "long_task") {
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
      // No focus insertion, parking, attempt binding, acceptance state or wake.
      return {
        kind: "accepted_turn",
        admission: {
          requestId: params.requestId,
          sessionFile: params.sessionFile,
          goal: params.goal,
          acceptance: [...params.acceptance],
          focusRevision: board.focusRevision,
          writeEpoch: board.writeEpoch ?? 0,
        },
      };
    }
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
          logicalExecutionId: current.logicalExecutionId,
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
      admittedGeneration: board.resetGeneration ?? 0,
    };
    writeSessionTaskBoardUnlocked(params.sessionFile, result.board);
    return { kind: "accepted", binding: { taskId: result.taskId } };
  });
}

/** Recheck the captured owner-control snapshot before starting the shared runner. */
export function isTurnExecutionAdmissionCurrent(
  sessionFile: string,
  admission: TurnExecutionAdmission,
): boolean {
  if (
    !admission.requestId?.trim() ||
    admission.sessionFile !== sessionFile ||
    !admission.goal?.trim()
  ) {
    return false;
  }
  return withSessionTaskBoardLock(sessionFile, () => {
    const board = readSessionTaskBoardUnlocked(sessionFile, true);
    return (
      board.focusRevision === admission.focusRevision &&
      (board.writeEpoch ?? 0) === admission.writeEpoch
    );
  });
}
