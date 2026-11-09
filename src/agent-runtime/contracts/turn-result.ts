import type { SessionTaskBoard } from "./task.js";

/** Legacy / mutation turn result — return shape only; fields and action enum unchanged. */
export type IncomingTurnResult = {
  board: SessionTaskBoard;
  action: "continue" | "switch" | "resume" | "cancel_parked";
  taskId: string;
  cutContext: boolean;
  statusLine?: string;
  restoredPrompt?: string;
  currentTitle?: string;
  incomingTitle?: string;
  droppedTitle?: string;
  droppedPaths?: string[];
  /** Focus revision after this mutation (C1). */
  focusRevision?: number;
  /**
   * Resume success does NOT imply immediate auto-execute (C6).
   * Callers must not schedule continue solely because action==="resume".
   */
  scheduleContinue?: boolean;
  rejectedReason?: string;
  /**
   * Owner pause/cancel of the *current* unfinished task: callers must abort the
   * in-flight run via the existing abort path (same as task-park cutContext).
   * Does not by itself bump focusRevision.
   */
  abortInFlight?: boolean;
};
