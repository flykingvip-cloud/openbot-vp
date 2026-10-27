export * from "./types.js";
export * from "./judge.js";
export * from "./eligibility.js";
export * from "./store.js";
export * from "./transitions.js";
export * from "./result-service.js";
export * from "./consumers.js";
export { ChatTaskOutcomeAdapter } from "./entrypoints/chat.js";
export { GatewayAgentTaskOutcomeAdapter } from "./entrypoints/gateway-agent.js";
export { CronTaskOutcomeAdapter } from "./entrypoints/cron.js";
export { CliTaskOutcomeAdapter } from "./entrypoints/cli.js";
export { CollabTaskOutcomeAdapter } from "./entrypoints/collab.js";
export {
  recordRunnerTurnOutcome,
  confirmRunnerTurnDelivery,
  drainPendingGrowthEvolution,
  TASK_OUTCOME_STORE_DIRNAME,
  type GrowthOutcomeCommitOpts,
  type RunnerTurnFailureReason,
  type RunnerTurnOutcomeInput,
} from "./runtime-from-runner.js";
export {
  registerAwaitingDelivery,
  peekAwaitingDelivery,
  takeAwaitingDelivery,
  resolveAndTakeAwaitingDelivery,
  hydrateAwaitingDeliveriesFromDisk,
  clearAwaitingDeliveriesForTests,
} from "./pending-delivery.js";
export {
  resolveRequiredDeliveryConfirmStatus,
  type RequiredDeliveryAttempt,
  type RequiredDeliveryConfirmStatus,
} from "./delivery-confirm.js";

export {
  OutcomeConsumerRuntime,
  GROWTH_EVOLUTION_CONSUMER_ID,
  SKILL_CONSUMER_ID,
  MODE_CONSUMER_ID,
} from "./consumers.js";
export {
  publishEvolutionFromTaskOutcome,
  readEffectiveEvolutionTaskOutcomes,
} from "./growth-bridge.js";
export {
  recoverTaskOutcomeConsumersAtGatewayBoot,
  hydrateAllAgentsAwaitingDeliveries,
  drainAllAgentsPendingGrowth,
  startTaskOutcomeRuntimeDrain,
  stopTaskOutcomeRuntimeDrainForTests,
} from "./consumer-boot.js";
export * from "./chat-entry.js";

export {
  cronTurnTaskId,
  cliTurnTaskId,
  collabTurnTaskId,
  gatewayAgentTurnTaskId,
  followupTurnTaskId,
  ensureCronTurnTaskOutcome,
  ensureCliTurnTaskOutcome,
  ensureCollabTurnTaskOutcome,
  ensureGatewayAgentTurnTaskOutcome,
  ensureFollowupTurnTaskOutcome,
} from "./entrypoint-ensure.js";

export {
  createSkillQualityHandler,
  createModeQualityHandler,
  rebuildQualityProjectionFromContributions,
  type QualityHandlerOptions,
} from "./quality-handlers.js";
export {
  backfillAttemptSamplesFromTaskOutcome,
  resolveAttemptBackfillJudgement,
  type AttemptBackfillResult,
} from "./attempt-backfill.js";

export {
  DEFAULT_TASK_BUDGET_LIMITS,
  accumulateTaskBudgetSpend,
  applySpendAndAssess,
  assessTaskBudgetExhaustion,
  buildTaskBudgetState,
  ensureTaskBudgetStarted,
  projectTipBudgetFromSupervisor,
  resolveEffectiveTaskBudget,
  type TaskBudgetExhaustion,
  type TaskBudgetLimits,
  type TaskBudgetState,
} from "./budget.js";
// W3 acceptance: reuse chat-entry (CHAT_TURN_CONTRACT_V1 / resolveTurnTaskContract /
// resolveChatTurnCloseGates) — do not re-export a parallel task-type-acceptance module.

export {
  applyOutcomeVerifiedContributionKey,
  OUTCOME_VERIFIED_CONTRIBUTION_KEYS_FILENAME,
  revokeOutcomeVerifiedContributionKey,
  type OutcomeVerifiedContributionKeyEntry,
  type OutcomeVerifiedContributionKeyStatus,
} from "./experience-verified-counts.js";
export {
  EXPERIENCE_VERIFIED_CONSUMER_ID,
  applyExperienceVerification,
  buildExperienceVerifiedContributionKey,
  clearExperienceVerifiedContribution,
  createExperienceVerifiedHandler,
  loadExperienceVerifiedContribution,
  resolveExperienceVerificationPlan,
  saveExperienceVerifiedContribution,
  type ExperienceVerifiedContribution,
} from "./experience-verified-handler.js";

export {
  attachAdoptedLearningAssetsToTask,
  mergeAdoptedIntoExperienceExposure,
  type AttachAdoptedLearningAssetsParams,
  type AttachAdoptedLearningAssetsResult,
} from "./learning-adoption.js";

export {
  assessRunnerTurnBudgetGate,
  chargeRunnerTurnBudgetSpend,
  TaskBudgetExceededError,
  type RunnerBudgetGateResult,
} from "./runtime-from-runner.js";
