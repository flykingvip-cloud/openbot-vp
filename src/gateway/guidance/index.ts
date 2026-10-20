export { buildDegradedGuidanceSnapshot } from "./degrade.js";
export { buildUserGuidanceSnapshotFromDaibai, type DaibaiGuideSignalInput } from "./from-daibai.js";
export {
  buildRobotGuidanceSnapshot,
  buildRobotGuidanceSnapshotFromGrowth,
  gapIsActionable,
  mapGrowthActionToGuidanceNextAction,
  mapGrowthGapsToBlockers,
  stageFromGrowthLifecycle,
} from "./from-growth.js";
export { buildTeamGuidanceSnapshot, type TeamGuidanceSignalInput } from "./from-team.js";
export { buildGuidanceSnapshot, resolvePrimaryGuidance } from "./resolve.js";
export {
  GUIDANCE_NONE_ACTION,
  isGuidanceDegradeReason,
  isGuidanceScope,
  type GuidanceActionRisk,
  type GuidanceBlocker,
  type GuidanceBlockerKind,
  type GuidanceConfidence,
  type GuidanceDegradeReason,
  type GuidanceNextAction,
  type GuidanceNextActionTarget,
  type GuidanceScope,
  type GuidanceSnapshot,
  type GuidanceSource,
} from "./types.js";
export {
  isValidGuidanceSnapshot,
  validateGuidanceSnapshot,
  type GuidanceSnapshotValidationIssue,
} from "./validate.js";
export {
  abandonGuidanceProgress,
  advanceGuidanceProgress,
  applyGuidanceEventToProgress,
  authorizeGuidanceProgressAccess,
  createFileGuidanceProgressStore,
  formatGuidanceProgressKey,
  GUIDANCE_PROGRESS_DEFAULT_RETENTION_MS,
  GUIDANCE_PROGRESS_VERSION,
  GuidanceProgressAuthError,
  GuidanceProgressValidationError,
  isGuidanceProgressExpired,
  mapGuidanceEventToProgressFields,
  normalizeGuidanceProgressKey,
  readGuidanceProgress,
  resolveAuthorizedProgressKey,
  resolveGuidanceProgressPath,
  sanitizeGuidanceProgressMetadata,
  upsertGuidanceProgress,
  type GuidanceProgressActor,
  type GuidanceProgressKey,
  type GuidanceProgressRecord,
  type GuidanceProgressStore,
} from "./progress/index.js";
export {
  GUIDANCE_METRIC_EVENTS,
  GUIDANCE_METRICS_VERSION,
  createFileGuidanceMetricsStore,
  parseGuidanceMetricInput,
  recordGuidanceMetricSafe,
  type GuidanceMetricEvent,
  type GuidanceMetricEventType,
  type GuidanceMetricsStore,
} from "./metrics/index.js";
export {
  applyGuidanceLlmCopyRefine,
  createFileGuidanceSuppressionStore,
  evaluateGuidanceSuppression,
  GUIDANCE_SIGNAL_PRIORITY,
  markGuidanceSuppressionOutcome,
  rankGuidanceCandidates,
  recordGuidanceAutoPrompt,
  scoreGuidanceCandidate,
  selectTopPermittedCandidateId,
  setGuidanceGlobalSuppression,
  type GuidanceLlmCopyRefine,
  type GuidancePersonalizationSignals,
  type GuidanceRankableCandidate,
  type GuidanceRankResult,
  type GuidanceSuppressionDecision,
  type GuidanceSuppressionRecord,
} from "./personalization/index.js";
