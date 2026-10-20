/**
 * Phase D1 decision-surface contracts.
 * Pure types and functions. No Gateway, Ledger write, Proposal store, or Adapter.
 * Claim grade: code-present. Not runtime-enabled. Not production-proven.
 */
export {
  EVOLUTION_DECISION_ACTIONS,
  EVOLUTION_DECISION_CLIENT_FORBIDDEN_FIELDS,
  EVOLUTION_DECISION_COMMAND_FIELDS,
  EVOLUTION_DECISION_ENDPOINTS,
  EVOLUTION_DECISION_OUTCOMES,
  EVOLUTION_DECISION_PARTICIPATIONS,
  EVOLUTION_DECISION_REQUIRED_AUTHORITIES,
  EVOLUTION_DECISION_SCHEMA_VERSION,
  EVOLUTION_DECISION_STATUSES,
  EVOLUTION_DECISION_SURFACE_WRITES,
  EVOLUTION_DECISION_TYPES,
  EVOLUTION_DECISION_VERSIONLESS_ACTIONS,
  RESERVED_ENGINEERING_REMEDIATION_SURFACE_ID,
  evolutionDecisionActionRequiresVersion,
  evolutionDecisionCommandExpired,
  isEvolutionDecisionAction,
  projectEvolutionDecisionStatus,
  readEvolutionDecisionCommand,
} from "./dto.js";
export type {
  EvolutionDecisionAction,
  EvolutionDecisionAuthorityFacts,
  EvolutionDecisionCommand,
  EvolutionDecisionEndpoint,
  EvolutionDecisionItem,
  EvolutionDecisionOutcome,
  EvolutionDecisionParticipation,
  EvolutionDecisionPrincipal,
  EvolutionDecisionReceipt,
  EvolutionDecisionRequiredAuthority,
  EvolutionDecisionStatus,
  EvolutionDecisionType,
} from "./dto.js";

export {
  EVOLUTION_DECISION_CROSS_TENANT_CASE_ACTIONS,
  EVOLUTION_DECISION_ENDPOINT_ACTIONS,
  EVOLUTION_DECISION_UNAVAILABLE_ACTIONS,
  classifyEvolutionDecisionActionToken,
  evolutionDecisionEndpointAllows,
  mapEvolutionDecisionCommand,
} from "./command-map.js";
export type {
  EvolutionDecisionActionRefusal,
  EvolutionDecisionControlPlaneMapping,
  EvolutionDecisionSurfaceOperation,
} from "./command-map.js";

export { routeEvolutionDecisionSurface } from "./router.js";
export type {
  EvolutionDecisionOwnership,
  EvolutionDecisionRoute,
  EvolutionDecisionRouteInput,
} from "./router.js";

export { resolveEvolutionDecisionAuthority } from "./authority.js";
export type { EvolutionDecisionAuthorityDenial } from "./authority.js";

export {
  EVOLUTION_DECISION_ENTERPRISE_PARTICIPATIONS,
  evolutionDecisionTenantMatches,
  projectEvolutionDecisionAudience,
  projectEvolutionDecisionVisibility,
} from "./visibility.js";
export type {
  EvolutionDecisionAudienceView,
  EvolutionDecisionEmployeeParticipationView,
  EvolutionDecisionEnterpriseParticipation,
  EvolutionDecisionEnterpriseParticipationView,
  EvolutionDecisionVisibilityDenial,
} from "./visibility.js";

export {
  captureEvolutionDecisionCommandRecord,
  classifyEvolutionDecisionIdempotency,
  evolutionDecisionIdempotencyKey,
  evolutionDecisionReplayBindingMatches,
  freshEvolutionDecisionExpired,
} from "./idempotency.js";
export type { EvolutionDecisionCommandRecord } from "./idempotency.js";

export { judgeEvolutionDecisionCommand } from "./judge.js";
export type { EvolutionDecisionJudgement } from "./judge.js";

export {
  EVOLUTION_DECISION_WEEK_MS,
  EVOLUTION_DECISION_WEEK_TOLERANCE_MS,
  checkEvolutionDecisionWeeklyWindow,
  diffEvolutionDecisionStatusTransitions,
  projectEvolutionDecisionSnapshot,
} from "./snapshot.js";
export type {
  EvolutionDecisionRoutedRoute,
  EvolutionDecisionSnapshotEntry,
  EvolutionDecisionSnapshotFact,
  EvolutionDecisionSnapshotOmission,
  EvolutionDecisionStatusTransition,
  EvolutionDecisionWeeklyWindowRefusal,
} from "./snapshot.js";

export {
  EVOLUTION_EMPLOYEE_ACTION_UNAVAILABLE_CODES,
  EVOLUTION_EMPLOYEE_DECISION_HISTORY_UNAVAILABLE_REASONS,
  EVOLUTION_EMPLOYEE_DECISION_RUNTIME_ENABLED,
  EVOLUTION_EMPLOYEE_DECISION_UI_STATUSES,
  EVOLUTION_EMPLOYEE_DECISION_WEEK_MS,
  EVOLUTION_EMPLOYEE_DECISION_WEEK_TOLERANCE_MS,
  EVOLUTION_EMPLOYEE_EVIDENCE_AVAILABILITY,
  buildEvolutionEmployeeWeekOverWeekSummary,
  correlateEvolutionPerceptionDecision,
  evolutionEmployeeDecisionLoadFailView,
  projectEvolutionEmployeeDecisionSurface,
  projectEvolutionEmployeeDecisionUiStatus,
  submitEvolutionEmployeeDecisionCommand,
  summarizeEvolutionEmployeeEvidence,
} from "./employee-surface.js";
export type {
  EvolutionEmployeeActionUnavailableCode,
  EvolutionEmployeeDecisionFact,
  EvolutionEmployeeDecisionHistory,
  EvolutionEmployeeDecisionHistoryUnavailableReason,
  EvolutionEmployeeDecisionRow,
  EvolutionEmployeeDecisionRowView,
  EvolutionEmployeeDecisionSnapshot,
  EvolutionEmployeeDecisionStatusCounts,
  EvolutionEmployeeDecisionSubmitResult,
  EvolutionEmployeeDecisionSurfaceView,
  EvolutionEmployeeDecisionTransition,
  EvolutionEmployeeDecisionUiStatus,
  EvolutionEmployeeEvidenceAvailability,
  EvolutionEmployeeEvidenceSummary,
  EvolutionEmployeeWeekOverWeekSummary,
} from "./employee-surface.js";

export {
  EVOLUTION_ENTERPRISE_DECISION_DENIALS,
  EVOLUTION_ENTERPRISE_DECISION_HISTORY_UNAVAILABLE_REASONS,
  EVOLUTION_ENTERPRISE_DECISION_RUNTIME_ENABLED,
  EVOLUTION_ENTERPRISE_DECISION_UI_STATUSES,
  buildEvolutionEnterpriseWeekOverWeekSummary,
  evolutionEnterpriseDecisionDenial,
  evolutionEnterpriseDecisionLoadFailView,
  projectEvolutionEnterpriseDecisionSurface,
  projectEvolutionEnterpriseDecisionUiStatus,
  submitEvolutionEnterpriseDecisionCommand,
} from "./enterprise-surface.js";
export type {
  EvolutionEnterpriseDecisionDenial,
  EvolutionEnterpriseDecisionFact,
  EvolutionEnterpriseDecisionHistory,
  EvolutionEnterpriseDecisionHistoryUnavailableReason,
  EvolutionEnterpriseDecisionRow,
  EvolutionEnterpriseDecisionSnapshot,
  EvolutionEnterpriseDecisionStatusCounts,
  EvolutionEnterpriseDecisionSubmitResult,
  EvolutionEnterpriseDecisionSurfaceView,
  EvolutionEnterpriseDecisionTransition,
  EvolutionEnterpriseDecisionUiStatus,
  EvolutionEnterpriseEvidenceSummary,
  EvolutionEnterpriseWeekOverWeekSummary,
} from "./enterprise-surface.js";
