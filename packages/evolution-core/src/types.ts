/**
 * Unified evolution control-plane types.
 *
 * Diagnosis Proposal v1 remains the live write model. This file is the v2 SoT
 * plus shared value objects. Do not copy domain business objects here.
 */

export const EVOLUTION_CORE_VERSION = "0.1.0";
export const EVOLUTION_PROPOSAL_SCHEMA_VERSION = 2 as const;
export const EVOLUTION_EXPERIMENT_SCHEMA_VERSION = 1 as const;
export const EVOLUTION_APPLICATION_SCHEMA_VERSION = 1 as const;
export const EVOLUTION_VERIFICATION_SCHEMA_VERSION = 1 as const;
export const EVOLUTION_LEDGER_SCHEMA_VERSION = 1 as const;

export const EVOLUTION_DOMAINS = [
  "agent",
  "knowledge",
  "capability",
  "organization",
  "system",
] as const;
export type EvolutionDomain = (typeof EVOLUTION_DOMAINS)[number];

export type EvolutionTarget =
  | { domain: "agent"; agentId: string }
  | { domain: "knowledge"; assetId: string }
  | { domain: "capability"; skillId: string }
  | { domain: "organization"; groupId: string }
  | { domain: "system"; componentId: string };

export function evolutionTargetKey(target: EvolutionTarget): string {
  switch (target.domain) {
    case "agent":
      return `agent:${target.agentId}`;
    case "knowledge":
      return `knowledge:${target.assetId}`;
    case "capability":
      return `capability:${target.skillId}`;
    case "organization":
      return `organization:${target.groupId}`;
    case "system":
      return `system:${target.componentId}`;
  }
}

export const EVOLUTION_PROPOSAL_STATUSES = [
  "DISCOVERED",
  "SUGGESTED",
  "PENDING_AUTHORITY",
  "APPROVED_FOR_EXPERIMENT",
  "EXPERIMENTING",
  "HELD",
  "APPROVED_FOR_APPLICATION",
  "CANARY",
  "ACTIVE",
  "VERIFIED",
  "PROMOTED",
  "REJECTED",
  "ROLLED_BACK",
  "EXPIRED",
  "REVOKED",
] as const;
export type EvolutionProposalStatus = (typeof EVOLUTION_PROPOSAL_STATUSES)[number];

export const EVOLUTION_TERMINAL_STATUSES = [
  "REJECTED",
  "ROLLED_BACK",
  "EXPIRED",
  "REVOKED",
  "PROMOTED",
] as const;
export type EvolutionTerminalStatus = (typeof EVOLUTION_TERMINAL_STATUSES)[number];

export const EVOLUTION_COMMANDS = [
  "discover",
  "suggest",
  "submit",
  "authorize",
  "start_experiment",
  "reject",
  "hold",
  "approve_application",
  "apply_canary",
  "activate",
  "verify",
  "promote",
  "rollback",
  "rollback_drill",
  "expire",
  "revoke",
] as const;
export type EvolutionCommand = (typeof EVOLUTION_COMMANDS)[number];

export const EVOLUTION_RISK_LEVELS = ["low", "medium", "high", "critical"] as const;
export type EvolutionRiskLevel = (typeof EVOLUTION_RISK_LEVELS)[number];

export const EVOLUTION_CONFIDENTIALITY_SCOPES = ["personal", "enterprise", "platform"] as const;
export type EvolutionConfidentialityScope = (typeof EVOLUTION_CONFIDENTIALITY_SCOPES)[number];

export const EXPERIMENT_STRATEGIES = ["offline", "shadow", "ab", "canary"] as const;
export type ExperimentStrategy = (typeof EXPERIMENT_STRATEGIES)[number];

export const EXPERIMENT_RESULTS = [
  "pending",
  "improved",
  "neutral",
  "regressed",
  "inconclusive",
] as const;
export type ExperimentResult = (typeof EXPERIMENT_RESULTS)[number];

export const APPLICATION_SCOPES = ["shadow", "canary", "active"] as const;
export type ApplicationScope = (typeof APPLICATION_SCOPES)[number];

export const APPLICATION_STATUSES = ["pending", "applied", "failed", "rolled_back"] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const APPLICATION_PURPOSES = ["canary", "promoted"] as const;
export type ApplicationPurpose = (typeof APPLICATION_PURPOSES)[number];

export const EVOLUTION_DRILL_SCHEMA_VERSION = 1 as const;
export const ROLLBACK_DRILL_RESULTS = ["passed", "failed"] as const;
export type RollbackDrillResult = (typeof ROLLBACK_DRILL_RESULTS)[number];

/**
 * Governed rollback-drill receipt. This is not a business rollback and is
 * not an effect proof. A passed drill only attests that Adapter.rollback
 * restored `targetVersionBefore`.
 */
export type RollbackDrillRecord = {
  schemaVersion: 1;
  drillId: string;
  proposalId: string;
  experimentId: string;
  applicationId: string;
  targetVersionBefore: string;
  targetVersionAfter: string;
  restoredVersion: string;
  startedAt: string;
  completedAt: string;
  result: RollbackDrillResult;
  domainReceiptRef: string;
  verifiedBy: string;
  evidenceRefs: string[];
  reason?: string;
};

export const VERIFICATION_OUTCOMES = ["improved", "neutral", "regressed", "inconclusive"] as const;
export type VerificationOutcome = (typeof VERIFICATION_OUTCOMES)[number];

/** v1 `outcome: "linked"` only means the receipt exists. It is not a v2 effect. */
export const V1_LINKED_VERIFICATION_OUTCOME = "linked" as const;

export type MetricExpectation = {
  metricId: string;
  improveWhen: "increase" | "decrease";
  minimumEffect: number;
};

export type EvolutionProposal = {
  schemaVersion: 2;
  proposalId: string;
  sourceEvidenceRefs: string[];
  sourceMechanismRef: string;
  target: EvolutionTarget;
  candidateRef: string;
  surfaceId: string;
  expectedEffects: MetricExpectation[];
  riskLevel: EvolutionRiskLevel;
  confidentialityScope: EvolutionConfidentialityScope;
  tenantScope: string | null;
  grantId: string;
  status: EvolutionProposalStatus;
  createdAt: string;
  expiresAt: string;
  experimentId?: string;
  applicationId?: string;
  verificationId?: string;
  /** Present when projected from Diagnosis v1. Never written back to v1 storage. */
  legacy?: {
    schemaVersion: 1;
    targetDomain: DiagnosisProposalV1Domain;
    status: DiagnosisProposalV1Status;
    linkedVerificationOnly?: boolean;
  };
};

export const DIAGNOSIS_PROPOSAL_V1_DOMAINS = [
  "skill",
  "agent_working_dna",
  "collaboration_capsule",
  "fabric_feedback",
  "evolution_governance",
] as const;
export type DiagnosisProposalV1Domain = (typeof DIAGNOSIS_PROPOSAL_V1_DOMAINS)[number];

export const DIAGNOSIS_PROPOSAL_V1_STATUSES = [
  "SUGGESTED",
  "PENDING_APPROVAL",
  "APPROVED",
  "APPLIED",
  "VERIFIED",
  "ROLLED_BACK",
  "REJECTED",
  "EXPIRED",
  "REVOKED",
] as const;
export type DiagnosisProposalV1Status = (typeof DIAGNOSIS_PROPOSAL_V1_STATUSES)[number];

export const DIAGNOSIS_PROPOSAL_V1_RISK_LEVELS = ["low", "medium", "high"] as const;
export type DiagnosisProposalV1RiskLevel = (typeof DIAGNOSIS_PROPOSAL_V1_RISK_LEVELS)[number];

/**
 * Structural twin of the live Diagnosis v1 proposal.
 * Used only for read projection. Not a second write model.
 */
export type DiagnosisProposalV1 = {
  schemaVersion: 1;
  proposalId: string;
  sourceCaseId?: string;
  sourceMissionId?: string;
  sourceConversationRunId?: string;
  sourceFindingIds: string[];
  sourceEvidenceRefs: string[];
  sourceReportRef?: string;
  tenantScope: string | null;
  targetDomain: DiagnosisProposalV1Domain;
  proposedChange: { summary: string; action?: string };
  expectedEffect: string;
  riskLevel: DiagnosisProposalV1RiskLevel;
  confidentialityScope: EvolutionConfidentialityScope;
  status: DiagnosisProposalV1Status;
  approvalRequired: true;
  approverScope: EvolutionConfidentialityScope;
  grantId: string;
  missionId?: string;
  evidenceShareGrantId?: string;
  reportShareGrantId?: string;
  createdAt: string;
  expiresAt: string;
  auditReceipt: string;
  verificationRef?: string;
  candidateRef?: string;
  approvalRef?: string;
  applicationRef?: string;
};

export type MetricContract = {
  metricId: string;
  kind: "primary" | "guardrail";
  improveWhen: "increase" | "decrease";
  minimumEffect: number;
  maxRegression?: number;
  critical?: boolean;
};

export const OBSERVATION_PHASES = ["baseline", "treatment"] as const;
export type ObservationPhase = (typeof OBSERVATION_PHASES)[number];

export type ObservationWindow = {
  windowId: string;
  experimentId: string;
  phase: ObservationPhase;
  startedAt: string;
  endedAt: string;
  tenantScope: string | null;
  targetKey: string;
  modelRevision: string;
  configRevision: string;
  cohortRef: string;
};

export const EXPERIMENT_BASELINE_STATUSES = ["missing", "incomplete", "frozen"] as const;
export type ExperimentBaselineStatus = (typeof EXPERIMENT_BASELINE_STATUSES)[number];

export type ExperimentBaselineCapture = {
  status: ExperimentBaselineStatus;
  window?: ObservationWindow;
  primaryPresent: boolean;
  missingCriticalGuardrails: string[];
};

export const STATISTICAL_METHODS = [
  "two-proportion-z",
  "wilson-score",
  "deterministic-fixture",
  "insufficient-sample",
] as const;
export type StatisticalMethod = (typeof STATISTICAL_METHODS)[number];

export type StatisticalAssessment = {
  method: StatisticalMethod;
  baselineTrials: number;
  treatmentTrials: number;
  confidence: number | null;
  notes: string[];
};

export type EvolutionExperiment = {
  schemaVersion: 1;
  experimentId: string;
  proposalId: string;
  surfaceId: string;
  target: EvolutionTarget;
  tenantScope: string | null;
  baselineRef: string;
  candidateRef: string;
  datasetRef?: string;
  modelRef?: string;
  configRef: string;
  assignment: {
    strategy: ExperimentStrategy;
    treatmentRefs: string[];
    controlRefs: string[];
  };
  primaryMetric: MetricContract;
  guardrailMetrics: MetricContract[];
  minimumSampleSize: number;
  requiredConfidence: number;
  startedAt?: string;
  expiresAt: string;
  result: ExperimentResult;
  frozen: ExperimentFreeze;
  baselineCapture?: ExperimentBaselineCapture;
  candidateValidated?: boolean;
  /** Set only for a diagnosis experiment whose result is improved. Not an Apply. */
  applyApproval?: "pending_apply_approval";
};

export type ExperimentFreeze = {
  baselineVersion: string;
  candidateVersion: string;
  codeSha: string;
  modelRef: string;
  providerVersion: string;
  configSnapshotRef: string;
  datasetOrCohortRef: string;
  tenantScope: string | null;
  confidentialityScope: EvolutionConfidentialityScope;
  startedAt?: string;
  expiresAt: string;
  maxResourceBudget: number;
};

export type EvolutionApplication = {
  schemaVersion: 1;
  applicationId: string;
  proposalId: string;
  experimentId: string;
  adapterId: string;
  idempotencyKey: string;
  targetVersionBefore: string;
  targetVersionAfter: string;
  rollbackRef: string;
  scope: ApplicationScope;
  status: ApplicationStatus;
  appliedToRuntime: boolean;
  appliedAt?: string;
  purpose?: ApplicationPurpose;
  rollbackDrillId?: string;
};

export type GuardrailResult = {
  metricId: string;
  baseline: number;
  treatment: number;
  degraded: boolean;
  critical: boolean;
  withinBudget: boolean;
};

export type EvolutionVerification = {
  schemaVersion: 1;
  verificationId: string;
  applicationId: string;
  baselineWindowRef: string;
  evaluationWindowRef: string;
  primaryEffect: number | null;
  guardrailResults: GuardrailResult[];
  sampleSize: number;
  confidence: number | null;
  outcome: VerificationOutcome;
  evidenceRefs: string[];
  verifiedAt: string;
  assessment?: StatisticalAssessment;
};

export const EVOLUTION_LEDGER_EVENT_TYPES = [
  "proposal.created",
  "proposal.suggested",
  "proposal.expired",
  "proposal.authorized",
  "experiment.started",
  "experiment.held",
  "experiment.shadow_observed",
  "experiment.completed",
  "application.approved",
  "application.approval_pending",
  "application.applied",
  "application.rolled_back",
  "verification.completed",
  "promotion.completed",
  "receipt.created",
  "rollback.started",
  "rollback.completed",
  "rollback_drill.started",
  "rollback_drill.completed",
  "proposal.rejected",
  "proposal.revoked",
  "legacy.imported",
  "observation.excluded",
  "external_effect.recorded",
] as const;
export type EvolutionLedgerEventType = (typeof EVOLUTION_LEDGER_EVENT_TYPES)[number];

export type EvolutionLedgerEvent = {
  schemaVersion: 1;
  eventId: string;
  type: EvolutionLedgerEventType;
  timestamp: string;
  proposalId: string;
  target: EvolutionTarget;
  surfaceId: string;
  tenantScope: string | null;
  principalRef: string;
  grantId: string;
  evidenceRefs: string[];
  experimentId?: string;
  applicationId?: string;
  verificationId?: string;
  drillId?: string;
  domainReceiptRef?: string;
  previousEventHash: string | null;
  eventHash: string;
  /** Legacy import only. Never implies approval or verification. */
  legacySource?: boolean;
  /** Observation exclusion only. Never a forged cluster reference. */
  exclusionReason?: string;
  externalEffectOutcome?: string;
};
