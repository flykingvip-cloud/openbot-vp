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
type Relation = "amend" | "aside" | "new_work" | null;
export type ActiveTurnPorts = {
  readBoard: (file: string) => SessionTaskBoard;
  isOwnerControl: (prompt: string) => boolean;
  control: (file: string) => CurrentTaskControlPorts;
  resolveAside: (params: {
    prompt: string;
    board: SessionTaskBoard;
  }) =>
    | { kind: "not_aside" | "progress" | "reply_lane_pending" }
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

export type ActiveTurnDisposition =
  | { kind: "reply"; text: string }
  | { kind: "aside"; board: SessionTaskBoard }
  | { kind: "amended"; result: Exclude<ActiveTaskAmendmentResult, { kind: "defer" }> }
  | { kind: "steered" | "enqueue-followup" | "drop" | "execute" };

/** Route an existing reply turn. Transport, typing and asynchronous aside execution stay with the caller. */
export function handleActiveTurn(
  input: QueueInput & { prompt: string; sessionFile?: string },
  ports: ActiveTurnPorts,
): ActiveTurnDisposition {
  const { prompt, sessionFile } = input;
  if (input.isActive && ports.isOwnerControl(prompt) && sessionFile) {
    const result = controlCurrentTask(prompt, ports.control(sessionFile.trim()));
    return { kind: "reply", text: result.statusLine?.trim() || "已处理任务控制指令。" };
  }
  if (input.isActive && sessionFile) {
    const text = queryCurrentTaskStatus(prompt, () => ports.readBoard(sessionFile));
    if (text !== undefined) {
      return { kind: "reply", text };
    }
    // The aside decision takes a fresh snapshot, separate from a status query.
    const board = ports.readBoard(sessionFile);
    if (board.current) {
      const aside = ports.resolveAside({ prompt, board });
      if (aside.kind === "board_readonly") {
        return { kind: "reply", text: aside.reply };
      }
      if (aside.kind === "reply_lane_pending") {
        return { kind: "aside", board };
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
