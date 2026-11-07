import type { SessionTaskBoard } from "../contracts/task.js";
import {
  amendActiveTask,
  type ActiveTaskAmendmentPorts,
  type ActiveTaskAmendmentResult,
} from "./amend-active-task.js";
import { controlCurrentTask, type CurrentTaskControlPorts } from "./current-task-control.js";
import { queryCurrentTaskStatus } from "./task-status.js";

type QueueInput = {
  isActive: boolean;
  isHeartbeat: boolean;
  isStreaming: boolean;
  shouldSteer: boolean;
  shouldFollowup: boolean;
  queueMode: "steer" | "followup" | "collect" | "steer-backlog" | "interrupt" | "queue";
};
type Relation = "amend" | "conversation" | "new_work" | null;
export type InteractionPorts = {
  readBoard: (file: string) => SessionTaskBoard;
  isOwnerControl: (prompt: string) => boolean;
  control: (file: string) => CurrentTaskControlPorts;
  resolveDialogue: (params: {
    prompt: string;
    board: SessionTaskBoard;
  }) =>
    | { kind: "task_command" | "progress" | "conversation" }
    | { kind: "board_readonly"; reply: string };
  steer: () => boolean;
  resolveRelation: (prompt: string, board: SessionTaskBoard) => Relation;
  shouldPersistConstraint: (prompt: string) => boolean;
  shouldCollectAmend: (
    params: QueueInput & { turnRelation: Relation; persistOwnerConstraint: boolean },
  ) => boolean;
  isBarrier: (prompt: string) => boolean;
  amendment: (file: string) => ActiveTaskAmendmentPorts;
  queueAction: (params: QueueInput) => "run-now" | "enqueue-followup" | "drop";
};

export type InteractionDisposition =
  | { kind: "reply"; text: string }
  | { kind: "dialogue"; board: SessionTaskBoard }
  | { kind: "amended"; result: Exclude<ActiveTaskAmendmentResult, { kind: "defer" }> }
  | { kind: "steered" | "enqueue-followup" | "drop" | "execute" };

/** Uniform interaction entry. Execution occupancy selects resources, not a special user-message category. */
export function handleInteraction(
  input: QueueInput & { prompt: string; sessionFile?: string; internalExecution?: boolean },
  ports: InteractionPorts,
): InteractionDisposition {
  if (input.internalExecution) {
    const action = ports.queueAction(input);
    return { kind: action === "run-now" ? "execute" : action };
  }
  const { prompt, sessionFile } = input;
  if (ports.isOwnerControl(prompt) && sessionFile) {
    const result = controlCurrentTask(prompt, ports.control(sessionFile.trim()));
    return { kind: "reply", text: result.statusLine?.trim() || "已处理任务控制指令。" };
  }
  if (sessionFile) {
    const text = queryCurrentTaskStatus(prompt, () => ports.readBoard(sessionFile));
    if (text !== undefined) {
      return { kind: "reply", text };
    }
    // Dialogue semantics are independent of execution occupancy; only resource selection uses isActive.
    const board = ports.readBoard(sessionFile);
    if (board.current) {
      const dialogue = ports.resolveDialogue({ prompt, board });
      if (dialogue.kind === "board_readonly") {
        return { kind: "reply", text: dialogue.reply };
      }
      if (dialogue.kind === "conversation" && input.isActive) {
        return { kind: "dialogue", board };
      }
    }
  }
  if (input.shouldSteer && input.isStreaming) {
    if (ports.steer() && !input.shouldFollowup) {
      return { kind: "steered" };
    }
  } else {
    const file = sessionFile?.trim() ?? "";
    const turnRelation = file ? ports.resolveRelation(prompt, ports.readBoard(file)) : null;
    if (
      ports.shouldCollectAmend({
        ...input,
        turnRelation,
        persistOwnerConstraint: ports.shouldPersistConstraint(prompt),
      })
    ) {
      const result = amendActiveTask(ports.isBarrier(prompt), ports.amendment(file));
      if (result.kind !== "defer") {
        return { kind: "amended", result };
      }
    }
  }
  const action = ports.queueAction(input);
  return { kind: action === "run-now" ? "execute" : action };
}
