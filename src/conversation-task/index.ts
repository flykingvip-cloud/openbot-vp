/**
 * ConversationTask Runtime — public surface.
 *
 * P0 exports domain contracts, reason codes, feature gates, invariants and the
 * offline dataset. P1 adds the deterministic signal extractor, detector,
 * qualifier, offline replay and shadow metrics. Nothing here activates a task,
 * writes a ledger, or changes chat.send / Cron behavior.
 */

// P0 — contracts
export {
  CONVERSATION_TASK_DECISION_VERSION,
  WORK_TYPES,
  NON_LEDGER_WORK_TYPES,
  TASK_SIGNAL_KEYS,
  QUALIFICATION_KINDS,
  SIDE_EFFECT_CLASSES,
  CANDIDATE_FORBIDDEN_CAPABILITIES,
  CONVERSATION_TASK_FORBIDDEN_FIELDS,
  emptyTaskSignals,
  countSignals,
  workTypeForQualification,
  requiresAuthorization,
} from "./types.js";
export type {
  ActivationConditions,
  ActivationDecision,
  AcceptanceRule,
  AuthorizationState,
  ConversationTask,
  ConversationTaskLifecycle,
  ConversationTurnInput,
  DeliverySpec,
  DetectionConfidence,
  DetectionResult,
  MissionBoundaryMarker,
  QualificationKind,
  QualificationResult,
  ScheduleSpec,
  ShadowDecisionLog,
  SideEffectClass,
  TaskCandidate,
  TaskCandidateStatus,
  TaskRevisionEvent,
  TaskRevisionField,
  TaskRevisionReason,
  TaskSignals,
  TurnMode,
  WorkType,
} from "./types.js";

export { REASON, ALL_REASON_CODES, isReasonCode } from "./reason-codes.js";
export type { ReasonCode } from "./reason-codes.js";

export {
  CONVERSATION_TASK_FLAG_NAMES,
  CONVERSATION_TASK_ENV,
  SHADOW_ALLOWED_FLAGS,
  SHADOW_FORBIDDEN_FLAGS,
  isConversationTaskFlagEnabled,
  readConversationTaskFlags,
  isShadowModeOnly,
} from "./feature.js";
export type { ConversationTaskFlag, ConversationTaskFlags } from "./feature.js";

export { ConversationTaskInvariantError } from "./errors.js";
export {
  assertCandidateBoundary,
  assertConversationTaskBoundary,
  assertQualificationPure,
  assertNoInsufficientUpgrade,
  assertSideEffectOrthogonal,
  resolveAuthorization,
  evaluateActivation,
  assertActivationRequiresAllConditions,
  assertIdempotentDecisions,
  isModelCompletionClaim,
  assertCompletionClaimIgnored,
  assertShadowOnly,
  assertNoMissionInPersonalScope,
} from "./invariants.js";
export type { ConversationTaskInvariantId, InvariantViolation } from "./invariants.js";

export { CONVERSATION_TASK_SAMPLES, SAMPLE_CATEGORIES, samplesByCategory } from "./dataset.js";
export type { ConversationTaskSample, SampleCategory } from "./dataset.js";

// P1 — offline detection, qualification, replay and shadow metrics
export { analyzeTurn, classifySideEffect, extractSignals, isExplicitWorkflow } from "./signals.js";
export type { TurnFeatures } from "./signals.js";
export { detectTurn } from "./detector.js";
export { isLongRunningCandidate, qualifyTurn } from "./qualification.js";
export { evaluateTurn, evaluateTurnGated, fingerprintText, replayTurns } from "./replay.js";
export type { ShadowDecision } from "./replay.js";
export { evaluateDataset } from "./metrics.js";
export type { ClassScore, ConfusionMatrix, DetectionScore, EvaluationReport } from "./metrics.js";
export { formatEvaluationReport, runEvaluation } from "./evaluate.js";
export { BLIND_SAMPLES } from "./blind-dataset.js";
export { runBlindEvaluation } from "./evaluate-blind.js";

// P2 — Activation Gate, tenant-scoped Task store, ACL, flag cache, shadow logs,
// auto-degrade. Flag-gated: `activation`/`projection`/`authorization` stay OFF in
// production; nothing here touches chat.send, the Progress Ledger, or side effects.
export {
  canonicalizeActivationEpoch,
  canonicalSerialize,
  canonicalTenantId,
  deriveCandidateId,
  deriveTaskKey,
  fileKeyForTenant,
  normalizeGoal,
  sha256Hex,
} from "./canonical.js";
export type { CandidateKeyTuple, TaskKeyTuple } from "./canonical.js";
export {
  ConversationTaskAccessError,
  ConversationTaskStoreError,
  TenantIsolationViolationError,
} from "./errors.js";
export type { TenantIsolationViolationReason } from "./errors.js";
export { openTaskStore, openTenantScopedDb, TaskStore } from "./store.js";
export type {
  CreateCandidateInput,
  CreateTaskInput,
  IsolationViolationRecord,
  OpenTaskStoreParams,
  OpenTenantScopedDbParams,
  StoredCandidate,
  StoredConversationTask,
  TenantScopedDb,
} from "./store.js";
export {
  ConversationTaskFlagCache,
  FLAG_CACHE_DEFAULT_TTL_MS,
  FLAG_CACHE_MAX_TTL_MS,
} from "./flag-cache.js";
export type { FlagCacheOptions, FlagReader } from "./flag-cache.js";
export {
  assertConversationTaskAccess,
  assertDetectionScope,
  assertTenantStoreBinding,
} from "./acl.js";
export type { ConversationTaskAccess } from "./acl.js";
export {
  CONTROL_PLANE_UNINITIALIZED_REASON,
  DEFAULT_MIN_REOPEN_INTERVAL_MS,
  evaluateReopen,
  InMemoryActivationControlPlane,
  SqliteActivationControlPlane,
} from "./control-plane.js";
export type {
  ActivationControlPlane,
  ControlPlaneSnapshot,
  ForceOffInput,
  ReopenAttempt,
  ReopenOutcome,
  SqliteActivationControlPlaneOptions,
} from "./control-plane.js";
export {
  deriveActivationConditions,
  frozenActiveTaskCount,
  runActivationGate,
} from "./activation.js";
export type { ActivationGateInput, ActivationMode, ActivationOutcome } from "./activation.js";
export {
  HMAC_KEY_MAX_AGE_MS,
  isHmacRotationDue,
  ShadowLogBook,
  SHADOW_LOG_DEFAULT_TTL_MS,
  tenantFingerprint,
  verifyShadowReceipt,
} from "./shadow.js";
export type {
  ShadowDeletionReceipt,
  ShadowLogBookOptions,
  ShadowLogInput,
  StoredShadowLog,
  TenantHmacKey,
  TenantHmacKeyProvider,
} from "./shadow.js";
export {
  ActivationDegradeController,
  DEGRADE_DEFAULT_MIN_INTERVAL_MS,
  DEGRADE_REASON,
  DEGRADE_THRESHOLDS,
} from "./degrade.js";
export type {
  ActivationDegradeOptions,
  ActivationDegradeState,
  DegradeEvaluation,
  DegradeMetrics,
  DegradeReason,
} from "./degrade.js";

// P2.5 — shadow-only production integration (admission §5). Persistent config store
// (tenant allowlist + detection/qualification flags), async shadow runner, passive
// observer + runtime, and the gateway bridge. Flag-gated + fail-closed; nothing here
// activates a task, opens the Task store, writes a ledger, launches an agent, or
// changes chat.send. `activation`/`projection`/`authorization` stay OFF.
export { keyedIdHmac } from "./shadow.js";
export {
  ALLOWLIST_CACHE_DEFAULT_TTL_MS,
  ALLOWLIST_CACHE_MAX_TTL_MS,
  ConversationTaskConfigStore,
  TenantAllowlistCache,
} from "./config-store.js";
export type {
  AllowlistReader,
  ConfigCasResult,
  ConversationTaskConfigStoreOptions,
  SetTenantAllowInput,
  TenantAllowlistCacheOptions,
} from "./config-store.js";
export {
  SHADOW_RUNNER_DEFAULT_DRAIN_CAP_MS,
  SHADOW_RUNNER_DEFAULT_ITEM_TIMEOUT_MS,
  SHADOW_RUNNER_DEFAULT_MAX_CONCURRENCY,
  SHADOW_RUNNER_DEFAULT_MAX_QUEUE,
  ShadowRunner,
} from "./shadow-runner.js";
export type {
  ShadowRunnerEvent,
  ShadowRunnerOptions,
  ShadowRunnerShutdownResult,
} from "./shadow-runner.js";
export {
  createShadowRuntime,
  makeShadowWriteHandler,
  ShadowBookRegistry,
  ShadowObserver,
} from "./shadow-observer.js";
export type {
  CreateShadowRuntimeOptions,
  ShadowJob,
  ShadowMetricEvent,
  ShadowObserveStatus,
  ShadowObserverDeps,
  ShadowRuntime,
  ShadowServerContext,
  ShadowTurn,
} from "./shadow-observer.js";
export {
  initShadowHook,
  isShadowHookInitialized,
  observeInboundTurnShadow,
  shutdownShadowHook,
} from "./gateway-shadow-hook.js";
export type { GatewayShadowInput } from "./gateway-shadow-hook.js";
export {
  defaultShadowStoreRoot,
  envTenantHmacKeyProvider,
  initShadowHookFromServerConfig,
  SHADOW_HMAC_KEY_ENV,
  SHADOW_HMAC_KEY_ID_ENV,
} from "./runtime-bootstrap.js";

export {
  isHmacKeyConfigured,
  readEnablementStatusView,
  setShadowFlag,
  setTenantAllowlistEntry,
} from "./enablement.js";
export type {
  EnablementStatusView,
  EnablementWriteResult,
  ShadowEnablementFlag,
} from "./enablement.js";

export {
  HEARTBEAT_FORBIDDEN_ACTIONS,
  MAX_FOCUS_SLOTS,
  MAX_PARKED_SLOTS,
  WAKE_REASONS,
  decideWake,
  isHeartbeatActionAllowed,
} from "./focus-policy.js";
export type {
  FocusDecision,
  FocusSnapshot,
  HeartbeatForbiddenAction,
  WakeReason,
} from "./focus-policy.js";
