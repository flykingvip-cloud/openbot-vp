import type { InteractionModelDecision } from "../../contracts/interaction.js";
import { isTaskTombstoned } from "../../policy/index.js";
import {
  withSessionTaskBoardLock,
  readSessionTaskBoardUnlocked,
  writeSessionTaskBoardUnlocked,
} from "../repository/task-board-file.js";
import { appendTaskConstraint } from "./task-constraints.js";
import { suppressCurrentTaskWake, cancelCurrentTask } from "./task-control.js";

/** Explicit execution admission; ordinary dialogue never calls this transaction. */
export function commitInteractionTaskProposal(params: {
  sessionFile: string;
  expectedFocusRevision: number;
  expectedWriteEpoch: number;
  decision: Extract<InteractionModelDecision, { kind: "task_change" | "task_control" }>;
}): { kind: "applied"; text: string; abort: boolean } | { kind: "rejected"; reason: string } {
  return withSessionTaskBoardLock(params.sessionFile, () => {
    const board = readSessionTaskBoardUnlocked(params.sessionFile);
    const current = board.current;
    if (
      !current?.unfinished ||
      current.taskId !== params.decision.target.taskId ||
      board.focusRevision !== params.expectedFocusRevision ||
      (board.writeEpoch ?? 0) !== params.expectedWriteEpoch ||
      params.decision.target.revision !== String(params.expectedWriteEpoch) ||
      isTaskTombstoned(board, current.taskId)
    ) {
      return { kind: "rejected", reason: "revision_mismatch" };
    }
    if (params.decision.kind === "task_change") {
      const next = appendTaskConstraint({
        board,
        constraintText: params.decision.text,
        mode: params.decision.mode,
      });
      writeSessionTaskBoardUnlocked(params.sessionFile, next);
      return {
        kind: "applied",
        text: "要求已写入原任务板；后续恢复将读取最新要求。",
        abort: false,
      };
    }
    if (params.decision.action === "resume") {
      // Resume still requires Gateway's live authorization and stop recheck.
      return { kind: "rejected", reason: "resume_requires_live_recheck" };
    }
    const result =
      params.decision.action === "pause"
        ? suppressCurrentTaskWake({ board })
        : cancelCurrentTask({ board });
    writeSessionTaskBoardUnlocked(params.sessionFile, result.board);
    return { kind: "applied", text: result.statusLine ?? "已处理任务控制。", abort: true };
  });
}
