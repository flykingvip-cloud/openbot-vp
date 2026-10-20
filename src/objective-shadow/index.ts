/**
 * Phase 2 Objective Resolver shadow.
 *
 * Observes ResolvedObjective + proposed WorkUnitDefinition only.
 * Default OFF. At most one redacted JSONL record per runId.
 * Does not write Participation / Lease / Pointer / Contribution / Ledger.
 */

export {
  OBJECTIVE_SHADOW_FLAG_ENV,
  OBJECTIVE_SHADOW_HMAC_KEY_ENV,
  OBJECTIVE_SHADOW_HMAC_KEY_FILE_ENV,
  isObjectiveShadowEnabled,
  isObjectiveShadowWritable,
  readObjectiveShadowHmacKey,
} from "./feature.js";
export {
  defaultObjectiveShadowLogPath,
  defaultObjectiveShadowWindowPath,
  findRecordByRunId,
  readShadowRecords,
} from "./log.js";
export { deriveWorkUnitId, observeObjective, validateProposedWorkUnits } from "./observe.js";
export { replayObserve, stableReplayHash } from "./replay.js";
export { maybeObserveObjectiveShadow, storeNowMs, tryObserveObjectiveShadow } from "./runtime.js";
export {
  LOCAL_UNSCOPED_TENANT_ID,
  normalizeObservedRunId,
  resolveShadowTenant,
} from "./candidates.js";
export {
  CRON_OBJECTIVE_ID_PREFIX,
  cronCandidatesFromJob,
  deriveCronObjectiveId,
  deriveCronObjectiveIdentity,
} from "./cron-objective.js";
export { OBJECTIVE_SHADOW_LOG_ENV, observeObjectiveShadowFromIngress } from "./ingress-hook.js";
export type { IngressObserveParams } from "./ingress-hook.js";
export {
  OBJECTIVE_SHADOW_CT_STORE_ENV,
  readConversationTaskCandidates,
  readSharedTaskCandidates,
} from "./read-existing-objectives.js";
export type { ObjectiveShadowDeps } from "./runtime.js";
export { hmacHash16 } from "./redact.js";
export { FORBIDDEN_WRITE_SYMBOLS, createForbiddenWriteGuard } from "./write-guard.js";
export { SHADOW_WINDOW_MS, SHADOW_WINDOW_N } from "./window.js";
export {
  OBSERVATION_REPORT_SCHEMA,
  detectFabricatedIdentity,
  formatObservationReportMarkdown,
  loadObservationInput,
  scanShadowPayloadForLeaks,
  summarizeObservation,
} from "./observation-report.js";
export type { ObservationReport, ObservationReportInput } from "./observation-report.js";
export type {
  ProposedWorkUnitDefinition,
  ShadowObserveInput,
  ShadowObserveRecord,
  ShadowRuntimeResult,
} from "./types.js";
