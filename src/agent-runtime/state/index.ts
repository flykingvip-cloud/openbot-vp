/** Public task-state access. The original board remains the sole storage/lock adapter. */
export { sessionTaskState } from "./repository/session-task.js";
export { createTaskStopRepository } from "./repository/task-stop.js";
export {
  recordAsyncWaitJobIntent,
  readAsyncWaitJobIntent,
  listAsyncWaitJobIntents,
  listWaitingAsyncWaitJobIntents,
  markAsyncWaitJobExited,
  markAsyncWaitJobRecoveryWakeIssued,
  markAsyncWaitJobProactiveDeliveryIssued,
  clearAsyncWaitJobIntent,
  clearAsyncWaitJobsForTask,
  type AsyncWaitJobIntent,
} from "./repository/async-wait-job.js";
export {
  recoverAsyncWaitJobsAtGatewayBoot,
  deliverRecoveredAsyncWaitCompletion,
  claimAsyncWaitJobIntent,
  collectRecoverableAsyncWaitIntents,
  startAsyncWaitJobRecoveryRecheck,
  stopAsyncWaitJobRecoveryRecheckForTests,
  type AsyncWaitRecoveryResult,
} from "./repository/async-wait-job-recovery.js";
export type { ResumeParkedRecheck } from "./mutations/resume-parked.js";

export { resetCorruptedSession, prepareReplacementSessionEntry } from "./session-recovery.js";
export type { CorruptedSessionResetInput, SessionRecoveryPorts } from "./session-recovery.js";

export { persistCommandSessionEntry } from "./command-session.js";

export { persistAcpTurnTranscript } from "./acp-transcript.js";

export { persistInteractionMessage } from "./interaction-transcript.js";

export { claimQueuedExecution } from "./mutations/claim-queued-execution.js";

export { repairTrailingUserTurn, persistAttemptPromptError } from "./attempt-transcript.js";

export { openAttemptSession, prepareAttemptSessionTranscript } from "./prepare-attempt-session.js";

export { checkTaskActionBoundary } from "./task-action.js";

export { persistSessionUsageUpdate } from "./session-usage.js";
export { incrementCompactionCount } from "./session-compaction.js";
export { persistRunSessionUsage, incrementRunCompactionCount } from "./session-run-accounting.js";

export {
  buildTaskBoardContinuePrompt,
  claimTaskBoardContinue,
  revalidateContinueTicket,
  countRecentTaskContinuations,
  reserveTaskContinuation,
} from "./continuation-ticket.js";
