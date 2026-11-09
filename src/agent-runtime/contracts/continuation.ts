export type TaskBoardContinueSkipReason =
  | "heartbeat"
  | "tools_disabled"
  | "no_session_file"
  | "no_unfinished_current"
  | "human_gate"
  | "wake_suppress"
  | "internal_continue_prompt"
  | "continue_cap"
  | "missing_queue"
  | "revision_mismatch"
  | "task_id_mismatch"
  | "tombstoned";

/** Continue ticket carrying taskId + focus revision (C2). */
export type TaskBoardContinueTicket = {
  taskId: string;
  focusRevision: number;
  prompt: string;
};

export type TaskBoardContinueDecision =
  | {
      action: "skip";
      reason: TaskBoardContinueSkipReason;
      wakeRecorded: false;
      taskId?: string;
      focusRevision?: number;
    }
  | {
      action: "schedule";
      reason: "task_board_continue";
      wakeRecorded: true;
      taskId: string;
      focusRevision: number;
      prompt: string;
      delayMs: number;
      ticket: TaskBoardContinueTicket;
    };
