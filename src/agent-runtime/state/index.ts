/** Public task-state access. The original board remains the sole storage/lock adapter. */
export { sessionTaskState } from "./repository/session-task.js";

export { resetCorruptedSession } from "./session-recovery.js";
export type { CorruptedSessionResetInput, SessionRecoveryPorts } from "./session-recovery.js";
