export {
  buildNormalizedIntentKey,
  intentKeyLabel,
  suggestedAssetTypeForIntent,
} from "./intent-key.ts";
export {
  buildPatternFingerprint,
  buildOutputSchemaHash,
  buildWorkflowSignature,
} from "./pattern-fingerprint.ts";
export {
  deriveEditTransformSignature,
  maxStableEditPatternCount,
  recordLocalEditPattern,
  MIN_REPEAT_FOR_EVIDENCE,
} from "./edit-pattern-stability.ts";
export {
  countExternalizationSignals,
  recordExternalizationSignal,
  setExternalizationSessionKey,
  type ExternalizationKind,
} from "./externalization-tracker.ts";
export {
  fetchGatewayEvidenceSummary,
  loadLocalEvidenceOverlay,
  mergeEvidenceLayers,
  scheduleReviewWithSync,
  syncEditPatternToGateway,
  syncSessionEventToGateway,
  type ReviewSuggestionView,
} from "./evidence-sync.ts";
export {
  adoptionFromShareVisibility,
  clearAdoptionStorageForTests,
  fetchGatewayAdoptionSummary,
  loadLocalAdoptionOverlay,
  mergeAdoptionEvidence,
  recordLocalAdoption,
  recordLocalUserInitiatedSave,
  syncContextCapabilityLink,
  syncUserInitiatedSave,
} from "./adoption-sync.ts";
export {
  applyAutofillHintsToForm,
  buildAutofillHintText,
  runIncubationAutofill,
} from "./incubation-autofill.ts";
export { maybeRecordSessionIncubationEvent } from "./record-session-event.ts";
export {
  buildReviewSuggestion,
  clusterSessionEvents,
  dismissReviewSuggestion,
  recordSessionIncubationFromChat,
  scheduleReview,
  type AssetReviewSuggestion,
  type ReviewCluster,
  type ReviewScheduleResult,
} from "./review-engine.ts";
export {
  MAX_VISIBLE_ASSET_REVIEW_SUGGESTIONS,
  isKnowledgeAssetReviewSuggestion,
  selectVisibleAssetReviewSuggestions,
} from "./review-suggestion-scope.ts";
export {
  ackWeeklyDigest,
  buildLocalWeeklyDigest,
  clearDigestStorageForTests,
  currentWeekKey,
  scheduleDigestWithSync,
  shouldShowWeeklyDigest,
  type WeeklyDigestEntryView,
  type WeeklyDigestView,
} from "./digest-engine.ts";
export {
  deriveOrganizationalIncubationBadge,
  organizationalBadgeLabel,
  type OrganizationalIncubationBadge,
} from "./capability-incubation-badge.ts";
export {
  decideIncubationFromChatFinal,
  projectedRecurrenceForFingerprint,
  recurrenceCountFromRuntime,
  shouldSurfaceSystemAssetSuggestion,
  shouldSurfaceWeakAssetHint,
} from "./from-chat-final.ts";
export {
  ASSET_SUGGESTION_DISMISS_TTL_MS,
  buildAssetSuggestionDismissKeys,
  clearAssetSuggestionDismissalsForTests,
  dismissAssetSuggestion,
  isAssetSuggestionDismissed,
} from "./suggestion-dismiss.ts";
export { deriveIncubationFromPatternHint, sessionInputFromPatternHint } from "./session-bridge.ts";
export {
  computeSessionQuality,
  deriveIncubationDecision,
  deriveLevelFromEvidence,
  isL4WithoutAdoption,
  meetsL4Adoption,
  shouldShowSystemSuggestCta,
  shouldShowWeakHint,
  type SessionQualityInput,
} from "./scorer.ts";
export {
  createEmptyAdoptionEvidence,
  createEmptyEvidence,
  DEFAULT_INCUBATION_THRESHOLDS,
  type AssetAdoptionEvidence,
  type AssetEvidence,
  type AssetIncubationDecision,
  type AssetIncubationLevel,
  type AssetIncubationRecord,
  type AssetIncubationSource,
  type AssetIncubationThresholds,
  type AssetSignalTraceEntry,
  type PatternFingerprint,
  type SkillSaveIncubationContext,
} from "./types.ts";
