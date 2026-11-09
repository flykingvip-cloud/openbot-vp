/** Public task-state access. The original board remains the sole storage/lock adapter. */
export { sessionTaskState } from "./repository/session-task.js";
export { createTaskStopRepository } from "./repository/task-stop.js";
export {
  recordAsyncWaitJobIntent,
  readAsyncWaitJobIntent,
  listAsyncWaitJobIntents,
  listWaitingAsyncWaitJobIntents,
  markAsyncWaitJobExited,
  clearAsyncWaitJobIntent,
  clearAsyncWaitJobsForTask,
  transitionAsyncWaitJobIntent,
} from "./repository/async-wait-job.js";
export {
  type AsyncWaitJobIntent,
  type AsyncWaitRecoveryStage,
  type AsyncWaitResultEvidence,
  type AsyncWaitBoundPayload,
} from "./repository/async-wait-job-store.js";
export {
  claimAsyncWaitJobForRecovery,
  markAsyncWaitRecoveryContinueArmed,
  buildAsyncWaitRecoveryPromptAppendix,
  isBoundAsyncWaitRunLive,
} from "./repository/async-wait-recovery-claim.js";
export {
  bindAsyncWaitRecoveryTurn,
  releaseAsyncWaitRecoveryTurn,
  markAsyncWaitRecoveryDelivered,
  sanitizeAsyncWaitBoundPayloads,
  type BindAsyncWaitRecoveryTurnResult,
} from "./repository/async-wait-recovery-turn.js";
export {
  recoverAsyncWaitJobsAtGatewayBoot,
  armAsyncWaitRecoveryContinuation,
  setAsyncWaitRecoveryContinueEnqueue,
  startAsyncWaitJobRecoveryRecheck,
  stopAsyncWaitJobRecoveryRecheckForTests,
  type AsyncWaitRecoveryResult,
  type AsyncWaitRecoveryContinueEnqueue,
} from "./repository/async-wait-job-recovery.js";
export { collectRecoverableAsyncWaitIntents } from "./repository/async-wait-recovery-scan.js";
export {
  createAsyncWaitRecoveryContinueEnqueue,
  setAsyncWaitRecoveryFollowupConsumerEnsure,
} from "./repository/async-wait-recovery-enqueue.js";
export { ensureAsyncWaitRecoveryFollowupConsumer } from "./repository/async-wait-recovery-followup-consumer.js";
export type { ResumeParkedRecheck } from "./mutations/resume-parked.js";

export { resetCorruptedSession, prepareReplacementSessionEntry } from "./session-recovery.js";
export type { CorruptedSessionResetInput, SessionRecoveryPorts } from "./session-recovery.js";

export { persistCommandSessionEntry } from "./command-session.js";

export { persistAcpTurnTranscript } from "./acp-transcript.js";

export { persistInteractionMessage } from "./interaction-transcript.js";

export {
  claimQueuedExecution,
  restoreBoardExecutionAttemptAfterFailedBind,
} from "./mutations/claim-queued-execution.js";

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
export {
  mutateBoardClaimLog,
  appendBoardClaimLog,
  commitPrivateTodolistLog,
  appendPeerReviewLog,
} from "./collaboration/round-txn.js";
export {
  commitProposedHandoff,
  acceptHandoffTransaction,
  approveHandoffTransaction,
  applyApprovedHandoffTransaction,
  recoverHandoffTransactions,
} from "./collaboration/handoff-txn.js";
export type { HandoffLedgerPort, HandoffStoredFact } from "./collaboration/handoff-txn.js";
export {
  commitMemberArtifactDeliveryAssociation,
  deliveryKeyHash,
  noteAssociationRenamedAwayFromStaged,
  publishMemberArtifactDelivery,
  recoverMemberArtifactBridgeDelivery,
  recoverPartialStagedAssociation,
} from "./collaboration/accepted-artifact-delivery-txn.js";
export type {
  AssociationCommitResult,
  DeliveryAssociationPhase,
  DeliveryExternalEffect,
  MemberArtifactDeliveryIntent,
} from "./collaboration/accepted-artifact-delivery-txn.js";
export {
  DIRECTORY_LOCK_STALE_MS,
  withDirectoryLock,
  appendJsonlDurable,
  writeJsonDurable,
} from "./repository/durable-json.js";
