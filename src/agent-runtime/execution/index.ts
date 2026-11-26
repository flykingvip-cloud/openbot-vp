/** Public execution API: admitted-turn orchestration and bounded in-turn recovery. */
export { runExecutionStallContinueLoop } from "./recovery/stall-continuation.js";
export type {
  StallContinueDecision,
  RunExecutionStallContinueLoopParams,
} from "./recovery/stall-continuation.js";

export { runAdmittedTurn } from "./runner/admitted-turn.js";
export {
  createUnifiedExecutionLifecycle,
  runControlledAuxiliaryTurn,
  type UnifiedExecutionLifecycle,
  type UnifiedExecutionLifecycleOptions,
  type UnifiedTurnExecutionLifecycle,
  type UnifiedCommandExecutionLifecycle,
  type UnifiedWorkItemExecutionLifecycle,
  type UnifiedAuxiliaryExecutionLifecycle,
  type UnifiedTurnLifecycleOptions,
  type UnifiedCommandLifecycleOptions,
  type UnifiedWorkItemLifecycleOptions,
  type UnifiedAuxiliaryLifecycleOptions,
  type SupervisorWorkItemAdmission,
  type SupervisorWorkItemLifecyclePorts,
} from "./runner/unified-lifecycle.js";
/** @deprecated Use `createUnifiedExecutionLifecycle`. */
export { createExecutionLifecycle } from "./runner/execution-lifecycle.js";
export {
  CONTROLLED_EXECUTION_STAGE_ORDER,
  assertControlledExecutionStages,
  createControlledExecutionUseCase,
  type ControlledExecutionStage,
  type ControlledExecutionUseCase,
} from "./runner/controlled-execution.js";
/** @deprecated Use `createUnifiedExecutionLifecycle`. */
export { createCommandExecutionLifecycle } from "./runner/command-lifecycle.js";
/** @deprecated Use `createUnifiedExecutionLifecycle`. */
export { createSupervisorWorkItemLifecycle } from "./runner/supervisor-lifecycle.js";
export type { AgentTurnExecutionParams, AgentRunLoopResult } from "./runner/turn-contract.js";

export { runCommandCandidate } from "./runner/command-candidate.js";

export { createCommandBudget, settleCommandBudgetForCloseout } from "./runner/command-budget.js";

export { runCommandAcpTurn } from "./runner/acp-turn.js";

export { createCommandOutcomeCloseout } from "./outcomes/command-outcome.js";

export { recoverContextOverflow } from "./recovery/context-overflow.js";
export { cleanupEmbeddedRun } from "./runner/embedded-cleanup.js";

export {
  createUsageAccumulator,
  mergeUsageIntoAccumulator,
  toNormalizedUsage,
  buildErrorAgentMeta,
} from "./outcomes/usage-summary.js";

export { resolveAttemptEndOfRunAttribution } from "./outcomes/attempt-attribution.js";

export { runEmbeddedPiAgent } from "./runner/embedded-run.js";

export { runCliAgent, runClaudeCliAgent } from "./runner/cli-run.js";

export { cleanupEmbeddedAttempt } from "./runner/attempt-cleanup.js";

export { runQueuedCandidate } from "./runner/queued-candidate.js";

export { runScheduledCandidate } from "./runner/scheduled-candidate.js";

export {
  abortEmbeddedPiRun,
  isEmbeddedPiRunActive,
  isEmbeddedPiRunStreaming,
  queueEmbeddedPiMessage,
  waitForEmbeddedPiRunEnd,
  waitForActiveEmbeddedRuns,
  getActiveEmbeddedRunCount,
} from "./runner/run-registry.js";

export type { EmbeddedPiRunResult } from "./runner/embedded-result.js";

export {
  TASK_BOARD_CONTINUE_DELAY_MS,
  TASK_BOARD_CONTINUE_MAX_PER_TASK,
  TASK_BOARD_CONTINUE_COOLDOWN_MS,
  resetTaskBoardContinueLedgerForTest,
  isTaskBoardContinueInternalPrompt,
  isExplicitHumanGateWait,
  decideTaskBoardContinue,
  scheduleTaskBoardContinueWake,
} from "./runner/task-continuation.js";
