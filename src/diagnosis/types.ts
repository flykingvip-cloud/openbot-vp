/**
 * Diagnosis Protocol v1 — domain contract + pure validators.
 * Phase 0: no runtime integration, storage, or RPC.
 */

export const DIAGNOSIS_SCHEMA_VERSION = 1 as const;
export type DiagnosisSchemaVersion = typeof DIAGNOSIS_SCHEMA_VERSION;

export const FORBIDDEN_UI_FIELD_KEYS = ["uiText", "reportMarkdown", "locale"] as const;
export type ForbiddenUiFieldKey = (typeof FORBIDDEN_UI_FIELD_KEYS)[number];

export const DIAGNOSIS_COMPLETIONS = [
  "CONFIRMED",
  "PROBABLE",
  "INCONCLUSIVE",
  "BLOCKED",
  "TIMED_OUT",
] as const;
export type DiagnosisCompletion = (typeof DIAGNOSIS_COMPLETIONS)[number];

export const MUTATION_POLICIES = ["READ_ONLY", "SUGGEST"] as const;
export type MutationPolicy = (typeof MUTATION_POLICIES)[number];

export const RELATION_DERIVATIONS = [
  "EVIDENCE_DERIVED",
  "RULE_DERIVED",
  "HUMAN_CONFIRMED",
  "MODEL_INFERRED",
] as const;
export type RelationDerivation = (typeof RELATION_DERIVATIONS)[number];

export const RELATION_STATES = ["candidate", "accepted", "rejected"] as const;
export type RelationState = (typeof RELATION_STATES)[number];

export const EVIDENCE_COLLECTION_METHODS = ["event_adapter", "query", "probe", "snapshot"] as const;
export type EvidenceCollectionMethod = (typeof EVIDENCE_COLLECTION_METHODS)[number];

export const EVIDENCE_COMPLETENESS = ["complete", "partial", "unknown", "source_expired"] as const;
export type EvidenceCompleteness = (typeof EVIDENCE_COMPLETENESS)[number];

export const PRIVACY_CLASSIFICATIONS = ["public", "internal", "restricted"] as const;
export type PrivacyClassification = (typeof PRIVACY_CLASSIFICATIONS)[number];

export const DIAGNOSIS_STORE_CAPABILITIES = [
  "index",
  "snapshot_summary",
  "content_hash",
  "reference",
] as const;
export type DiagnosisStoreCapability = (typeof DIAGNOSIS_STORE_CAPABILITIES)[number];

export const FORBIDDEN_RUNTIME_MUTATION_OPS = [
  "update_session",
  "update_skill_invocation",
  "update_transcript",
  "update_otel",
  "doctor_fix",
  "restart_gateway",
  "replay_tool",
] as const;
export type ForbiddenRuntimeMutationOp = (typeof FORBIDDEN_RUNTIME_MUTATION_OPS)[number];

export const DIAGNOSTIC_TARGET_TYPES = [
  "gateway",
  "channel",
  "agent",
  "skill",
  "tool",
  "session",
  "run",
  "workflow",
  "data_source",
  "host",
] as const;
export type DiagnosticTargetType = (typeof DIAGNOSTIC_TARGET_TYPES)[number];

/** Protocol run modes. INCIDENT is reserved for Phase 3 — validate may accept; planner/runner reject. */
export const DIAGNOSTIC_RUN_MODES = ["QUICK", "TARGETED", "FULL", "INCIDENT"] as const;
export type DiagnosticRunMode = (typeof DIAGNOSTIC_RUN_MODES)[number];

export const DIAGNOSTIC_RUN_STATUSES = [
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
] as const;
export type DiagnosticRunStatus = (typeof DIAGNOSTIC_RUN_STATUSES)[number];

export const CAUSES_ACCEPTABLE_DERIVATIONS = [
  "EVIDENCE_DERIVED",
  "RULE_DERIVED",
  "HUMAN_CONFIRMED",
] as const;

export const EVIDENCE_TYPES = [
  "event",
  "metric",
  "snapshot",
  "config_check",
  "probe",
  "transcript_ref",
] as const;
export type DiagnosticEvidenceType = (typeof EVIDENCE_TYPES)[number];

export const FINDING_DOMAINS = [
  "user_interaction",
  "agent_model",
  "skill_tool",
  "channel_delivery",
  "system_configuration",
  "business_workflow",
  "external_dependency",
  "unknown",
] as const;
export type DiagnosticFindingDomain = (typeof FINDING_DOMAINS)[number];

export const RELATION_KINDS = [
  "derived_from",
  "correlated_with",
  "depends_on",
  "causes",
  "contributes_to",
  "duplicates",
] as const;
export type DiagnosisRelationKind = (typeof RELATION_KINDS)[number];

export const CASE_STATUSES = [
  "OPEN",
  "TRIAGED",
  "DIAGNOSING",
  "MITIGATING",
  "MONITORING",
  "RESOLVED",
  "CLOSED",
] as const;
export type DiagnosticCaseStatus = (typeof CASE_STATUSES)[number];

export const COST_LEVELS = ["low", "medium", "high"] as const;
export type DiagnosisCostLevel = (typeof COST_LEVELS)[number];

/** Frozen Evidence Source ids. Kebab-case aliases are rejected. */
export const EVIDENCE_SOURCE_IDS = [
  "session_store",
  "agent_runner",
  "skill_invocation",
  "tool_runtime",
  "route_resolution",
  "plugin_hook",
  "diagnostic_events",
  "agent_runtime_health",
  "channel_health",
  "doctor_check",
  "otel_reference",
  "evolution_governance",
] as const;
export type EvidenceSourceId = (typeof EVIDENCE_SOURCE_IDS)[number];

export const ATTRIBUTION_RESOLUTIONS = [
  "identity_tool_name",
  "selectedSkillId",
  "tool_args",
  "unique_owner",
  "prompt_named_use",
  "none",
  "unknown",
  "not_applicable",
] as const;
export type AttributionResolution = (typeof ATTRIBUTION_RESOLUTIONS)[number];

/** Tenant from verified session/membership — never from untrusted client input. */
export type TrustedTenantContext = { tenantId: string | null };

export class DiagnosisContractError extends Error {
  readonly code: string;
  readonly path: string;
  constructor(code: string, message: string, path = "") {
    super(message);
    this.name = "DiagnosisContractError";
    this.code = code;
    this.path = path;
  }
}

export function isDiagnosisContractError(err: unknown): err is DiagnosisContractError {
  return err instanceof DiagnosisContractError;
}

export type ConfidenceVector = {
  evidence: number;
  assessment: number;
  rootCause: number;
  impact: number;
};

export type DiagnosticPrincipal = {
  schemaVersion: 1;
  principalId: string;
  kind: "user" | "service" | "system";
  tenantId: string | null;
};

export type DiagnosticTargetScope = {
  agentId?: string;
  sessionKeyHash?: string;
  timeRange?: { from: string; to: string };
};

export type DiagnosticTarget = {
  schemaVersion: 1;
  targetType: DiagnosticTargetType;
  targetId: string;
  tenantId: string | null;
  authority: string;
  version?: string;
  capability?: string;
  scope: DiagnosticTargetScope;
  parent?: { targetType: DiagnosticTargetType; targetId: string; authority: string };
};

export type DiagnosticBudget = {
  timeoutMs: number;
  maxDiagnosers: number;
  modelCalls: number;
};

export type DiagnosticBudgetSnapshot = DiagnosticBudget & {
  elapsedMs: number;
  diagnosersUsed: number;
  modelCallsUsed: number;
};

export type EvidenceRequirement = {
  schemaVersion: 1;
  evidenceType: string;
  source: EvidenceSourceId;
  targetType: DiagnosticTargetType;
  fields: string[];
  freshnessMs?: number;
  sensitivity: "internal" | "restricted";
  cost: DiagnosisCostLevel;
  required: boolean;
};

export type DiagnosticRun = {
  schemaVersion: 1;
  runId: string;
  /** Subject agent run; distinct from Diagnosis Run ID. Null when no run target. */
  diagnosedAgentRunId: string | null;
  caseId?: string;
  mode: DiagnosticRunMode;
  targets: DiagnosticTarget[];
  requestedBy: DiagnosticPrincipal;
  mutationPolicy: MutationPolicy;
  budget: DiagnosticBudget;
  status: DiagnosticRunStatus;
  completion?: DiagnosisCompletion;
  missingEvidence: EvidenceRequirement[];
  blockReason?: string;
  budgetSnapshot?: DiagnosticBudgetSnapshot;
  startedAt: string;
  completedAt?: string;
};

export type DiagnosticEvidenceCollection = {
  method: EvidenceCollectionMethod;
  completeness: EvidenceCompleteness;
  attributionResolution: AttributionResolution;
};

export type DiagnosticEvidencePrivacy = {
  classification: PrivacyClassification;
  redacted: boolean;
};

export type DiagnosticEvidence = {
  schemaVersion: 1;
  evidenceId: string;
  evidenceType: DiagnosticEvidenceType;
  source: EvidenceSourceId;
  authority: string;
  authorityRecordId: string;
  observedAt: string;
  target: DiagnosticTarget;
  trace?: { traceId?: string; spanId?: string; parentSpanId?: string };
  summary: Record<string, string | number | boolean | null>;
  payloadRef?: { store: string; recordId: string; expiresAt?: string };
  integrity?: { contentHash?: string; collectorVersion: string };
  collection: DiagnosticEvidenceCollection;
  privacy: DiagnosticEvidencePrivacy;
};

export type DiagnosticObservation = {
  schemaVersion: 1;
  observationId: string;
  target: DiagnosticTarget;
  predicate: string;
  value: string | number | boolean | null;
  evidenceIds: string[];
  observedAt: string;
};

export type DiagnosticAssessment = {
  schemaVersion: 1;
  assessmentId: string;
  observationIds: string[];
  code: string;
  verdict: "normal" | "anomalous" | "unknown";
  ruleId?: string;
  baselineRef?: string;
};

export type DiagnosticAttribution = {
  schemaVersion: 1;
  attributionId: string;
  assessmentId: string;
  suspectedTarget: DiagnosticTarget;
  responsibilityDomain: string;
  state: "suspected" | "supported" | "confirmed" | "rejected";
  basis: "runtime_identity" | "ownership_map" | "rule" | "model_suggestion" | "human_confirmed";
};

export type DiagnosticHypothesis = {
  schemaVersion: 1;
  hypothesisId: string;
  code: string;
  state: "candidate" | "supported" | "rejected" | "confirmed" | "unknown";
  confidence: ConfidenceVector;
  supportingEvidenceIds: string[];
  contradictingEvidenceIds: string[];
  missingEvidence: string[];
  scoringMethod: "rule_v1" | "model_assisted_v1" | "human_confirmed";
  scoreReasonCode?: string;
  scorerVersion?: string;
};

export type DiagnosticFinding = {
  schemaVersion: 1;
  findingId: string;
  code: string;
  title: string;
  target: DiagnosticTarget;
  status: "open" | "acknowledged" | "resolved" | "false_positive";
  severity: "P0" | "P1" | "P2" | "P3" | "P4";
  primaryDomain: DiagnosticFindingDomain;
  observationIds: string[];
  assessmentIds: string[];
  attributionIds: string[];
  hypothesisIds: string[];
  evidenceIds: string[];
  confidence: ConfidenceVector;
  fingerprint: string;
  firstSeenAt: string;
  lastSeenAt: string;
  completion?: DiagnosisCompletion;
  missingEvidence?: EvidenceRequirement[];
};

export type DiagnosisRelation = {
  schemaVersion: 1;
  relationId: string;
  fromId: string;
  toId: string;
  relation: DiagnosisRelationKind;
  derivation: RelationDerivation;
  state: RelationState;
  confidence: number;
  evidenceIds: string[];
  ruleId?: string;
  ruleVersion?: string;
  confirmationRef?: string;
  auditRef?: string;
};

export type DiagnosticCase = {
  schemaVersion: 1;
  caseId: string;
  tenantId: string | null;
  status: DiagnosticCaseStatus;
  targets: DiagnosticTarget[];
  diagnosticRunIds: string[];
  findingIds: string[];
  relationIds: string[];
  impact?: { affectedCount?: number; code?: string };
  timeline: Array<{ at: string; code: string }>;
};

export type DiagnosticRecommendation = {
  schemaVersion: 1;
  recommendationId: string;
  findingId: string;
  code: string;
  executorCapability: string;
  mutationPolicy: MutationPolicy;
};

export type DiagnosticVerification = {
  schemaVersion: 1;
  verificationId: string;
  caseId: string;
  baselineWindow: { from: string; to: string };
  observationWindow: { from: string; to: string };
  expectedOutcome: Record<string, string | number | boolean | null>;
  measuredOutcome?: Record<string, string | number | boolean | null>;
  verdict?: "improved" | "unchanged" | "regressed" | "inconclusive";
};

export type DiagnoserManifest = {
  schemaVersion: 1;
  id: string;
  version: string;
  targets: DiagnosticTargetType[];
  modes: DiagnosticRunMode[];
  evidenceRequirements: EvidenceRequirement[];
  produces: string[];
  cost: { cpu: DiagnosisCostLevel; io: DiagnosisCostLevel; modelCalls: number };
  permissions: string[];
  mutation: "none" | "suggest_only";
};

export type DiagnoserContext = {
  schemaVersion: 1;
  run: DiagnosticRun;
  targets: readonly DiagnosticTarget[];
  evidence: readonly DiagnosticEvidence[];
  trusted: TrustedTenantContext;
};

export type Diagnoser = {
  readonly manifest: DiagnoserManifest;
  diagnose(context: DiagnoserContext): Promise<DiagnoserResult>;
};

/** Diagnoser output only — never config mutation or remediation execute. */
export type DiagnoserResult = {
  schemaVersion: 1;
  observations: DiagnosticObservation[];
  assessments: DiagnosticAssessment[];
  attributions: DiagnosticAttribution[];
  hypotheses: DiagnosticHypothesis[];
  findingDrafts: DiagnosticFinding[];
  relationCandidates: DiagnosisRelation[];
  nextEvidenceRequests: EvidenceRequirement[];
};

export type EvidenceSourceManifest = {
  schemaVersion: 1;
  id: EvidenceSourceId;
  authority: string;
  evidenceTypes: string[];
  targetTypes: DiagnosticTargetType[];
  cost: DiagnosisCostLevel;
  sensitivity: "internal" | "restricted";
  phase1Safe: boolean;
};

export type DiagnosisPlanStep = {
  schemaVersion: 1;
  stepId: string;
  hypothesisIds: string[];
  diagnoserId?: string;
  evidenceSourceId?: EvidenceSourceId;
  evidenceRequests: EvidenceRequirement[];
  expectedInformationGain: DiagnosisCostLevel;
  stopWhen: string[];
};

export type DiagnosisPlan = {
  schemaVersion: 1;
  planId: string;
  runId: string;
  mode: DiagnosticRunMode;
  steps: DiagnosisPlanStep[];
};

export type FindingP0Support = {
  relations?: readonly DiagnosisRelation[];
  attributions?: readonly DiagnosticAttribution[];
};

function requireFindingP0Support(
  finding: DiagnosticFinding,
  support: FindingP0Support,
  path: string,
): { relations: readonly DiagnosisRelation[]; attributions: readonly DiagnosticAttribution[] } {
  if (finding.severity !== "P0") {
    return {
      relations: support.relations ?? [],
      attributions: support.attributions ?? [],
    };
  }
  if (support.relations === undefined || support.attributions === undefined) {
    fail(
      "p0_support_required",
      "P0 Finding validation requires explicit relations and attributions context",
      path,
    );
  }
  return { relations: support.relations, attributions: support.attributions };
}

export type EvidenceValidateOptions = { now?: Date };

function fail(code: string, message: string, path: string): never {
  throw new DiagnosisContractError(code, message, path);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function joinPath(base: string, key: string): string {
  return base ? `${base}.${key}` : key;
}

function asRecord(raw: unknown, path: string): Record<string, unknown> {
  if (!isRecord(raw)) {
    fail("invalid_type", `expected object at ${path || "<root>"}`, path);
  }
  for (const key of FORBIDDEN_UI_FIELD_KEYS) {
    if (key in raw) {
      fail("ui_field_forbidden", `protocol objects must not include ${key}`, joinPath(path, key));
    }
  }
  return raw;
}

function requireSchemaVersion(obj: Record<string, unknown>, path: string): 1 {
  if (!("schemaVersion" in obj)) {
    fail("schema_version_required", "schemaVersion is required", joinPath(path, "schemaVersion"));
  }
  if (obj.schemaVersion !== DIAGNOSIS_SCHEMA_VERSION) {
    fail("schema_version_invalid", "schemaVersion must be 1", joinPath(path, "schemaVersion"));
  }
  return DIAGNOSIS_SCHEMA_VERSION;
}

function requireString(obj: Record<string, unknown>, key: string, path: string): string {
  const value = obj[key];
  if (typeof value !== "string" || value.length === 0) {
    fail("missing_field", `${joinPath(path, key)} must be a non-empty string`, joinPath(path, key));
  }
  return value;
}

function optionalString(
  obj: Record<string, unknown>,
  key: string,
  path: string,
): string | undefined {
  if (!(key in obj) || obj[key] === undefined) {
    return undefined;
  }
  return requireString(obj, key, path);
}

function requireTenantId(obj: Record<string, unknown>, path: string): string | null {
  if (!("tenantId" in obj)) {
    fail("missing_field", "tenantId is required", joinPath(path, "tenantId"));
  }
  const value = obj.tenantId;
  if (value !== null && (typeof value !== "string" || value.length === 0)) {
    fail("invalid_type", "tenantId must be string | null", joinPath(path, "tenantId"));
  }
  return value;
}

function requireLiteral<T extends string>(
  obj: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  path: string,
): T {
  if (!(key in obj) || obj[key] === undefined) {
    fail("missing_field", `${joinPath(path, key)} is required`, joinPath(path, key));
  }
  const value = obj[key];
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    fail("invalid_literal", `${joinPath(path, key)} is invalid`, joinPath(path, key));
  }
  return value as T;
}

function optionalLiteral<T extends string>(
  obj: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  path: string,
): T | undefined {
  if (!(key in obj) || obj[key] === undefined) {
    return undefined;
  }
  return requireLiteral(obj, key, allowed, path);
}

function requireBoolean(obj: Record<string, unknown>, key: string, path: string): boolean {
  const value = obj[key];
  if (typeof value !== "boolean") {
    fail("invalid_type", `${joinPath(path, key)} must be boolean`, joinPath(path, key));
  }
  return value;
}

function requireFiniteNumber(obj: Record<string, unknown>, key: string, path: string): number {
  const value = obj[key];
  if (value === undefined) {
    fail("missing_field", `${joinPath(path, key)} is required`, joinPath(path, key));
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail("invalid_type", `${joinPath(path, key)} must be a finite number`, joinPath(path, key));
  }
  return value;
}

function requireUnitInterval(obj: Record<string, unknown>, key: string, path: string): number {
  const value = requireFiniteNumber(obj, key, path);
  if (value < 0 || value > 1) {
    fail("invalid_range", `${joinPath(path, key)} must be between 0 and 1`, joinPath(path, key));
  }
  return value;
}

function requireArray(obj: Record<string, unknown>, key: string, path: string): unknown[] {
  const value = obj[key];
  if (!Array.isArray(value)) {
    fail("invalid_type", `${joinPath(path, key)} must be an array`, joinPath(path, key));
  }
  return value;
}

function requireStringArray(obj: Record<string, unknown>, key: string, path: string): string[] {
  const value = requireArray(obj, key, path);
  if (value.some((item) => typeof item !== "string" || item.length === 0)) {
    fail("invalid_type", `${joinPath(path, key)} must be a string[]`, joinPath(path, key));
  }
  return value as string[];
}

function requireNullableString(
  obj: Record<string, unknown>,
  key: string,
  path: string,
): string | null {
  if (!(key in obj)) {
    fail("missing_field", `${joinPath(path, key)} is required`, joinPath(path, key));
  }
  const value = obj[key];
  if (value !== null && (typeof value !== "string" || value.length === 0)) {
    fail("invalid_type", `${joinPath(path, key)} must be string | null`, joinPath(path, key));
  }
  return value;
}

function requireSummary(
  raw: unknown,
  path: string,
): Record<string, string | number | boolean | null> {
  const obj = asRecord(raw, path);
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (
      value !== null &&
      typeof value !== "string" &&
      typeof value !== "number" &&
      typeof value !== "boolean"
    ) {
      fail("invalid_type", `${joinPath(path, key)} is not a summary value`, joinPath(path, key));
    }
    out[key] = value;
  }
  return out;
}

function assertTenant(actual: string | null, trusted: TrustedTenantContext, path: string): void {
  if (actual !== trusted.tenantId) {
    fail(
      "tenant_mismatch",
      "tenantId must match trusted tenant context",
      joinPath(path, "tenantId"),
    );
  }
}

function mapList<T>(
  obj: Record<string, unknown>,
  key: string,
  path: string,
  map: (item: unknown, itemPath: string) => T,
): T[] {
  return requireArray(obj, key, path).map((item, i) => map(item, joinPath(path, `${key}[${i}]`)));
}

function typedList<T extends string>(
  obj: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  path: string,
): T[] {
  return requireArray(obj, key, path).map((item, i) => {
    if (typeof item !== "string" || !allowed.includes(item as T)) {
      fail("invalid_literal", `${key}[${i}] is invalid`, joinPath(path, `${key}[${i}]`));
    }
    return item as T;
  });
}

function windowOf(raw: unknown, path: string): { from: string; to: string } {
  const obj = asRecord(raw, path);
  return { from: requireString(obj, "from", path), to: requireString(obj, "to", path) };
}

function budgetOf(raw: unknown, path: string): DiagnosticBudget {
  const obj = asRecord(raw, path);
  return {
    timeoutMs: requireFiniteNumber(obj, "timeoutMs", path),
    maxDiagnosers: requireFiniteNumber(obj, "maxDiagnosers", path),
    modelCalls: requireFiniteNumber(obj, "modelCalls", path),
  };
}

function optAssign<T extends object>(target: T, key: keyof T, value: T[keyof T] | undefined): void {
  if (value !== undefined) {
    target[key] = value;
  }
}

export function canonicalTargetIdentity(
  target: Pick<DiagnosticTarget, "targetId" | "targetType" | "authority" | "tenantId">,
): string {
  return `${target.targetType}\0${target.authority}\0${target.tenantId ?? ""}\0${target.targetId}`;
}

export function validateDiagnosisCompletion(
  raw: unknown,
  path = "completion",
): DiagnosisCompletion {
  if (typeof raw !== "string" || !DIAGNOSIS_COMPLETIONS.includes(raw as DiagnosisCompletion)) {
    fail("invalid_literal", `${path} is not a DiagnosisCompletion`, path);
  }
  return raw as DiagnosisCompletion;
}

export function validateConfidenceVector(raw: unknown, path = "confidence"): ConfidenceVector {
  const obj = asRecord(raw, path);
  return {
    evidence: requireUnitInterval(obj, "evidence", path),
    assessment: requireUnitInterval(obj, "assessment", path),
    rootCause: requireUnitInterval(obj, "rootCause", path),
    impact: requireUnitInterval(obj, "impact", path),
  };
}

export function validateDiagnosticPrincipal(
  raw: unknown,
  trusted: TrustedTenantContext,
  path = "requestedBy",
): DiagnosticPrincipal {
  const obj = asRecord(raw, path);
  const principal: DiagnosticPrincipal = {
    schemaVersion: requireSchemaVersion(obj, path),
    principalId: requireString(obj, "principalId", path),
    kind: requireLiteral(obj, "kind", ["user", "service", "system"], path),
    tenantId: requireTenantId(obj, path),
  };
  // Platform/system principals use null tenantId; tenant binding is enforced separately
  // in delegation (assertTrustedActor) and for non-null principals here.
  if (principal.tenantId !== null) {
    assertTenant(principal.tenantId, trusted, path);
  }
  return principal;
}

function validateTargetScope(raw: unknown, path: string): DiagnosticTargetScope {
  const obj = asRecord(raw, path);
  const scope: DiagnosticTargetScope = {};
  optAssign(scope, "agentId", optionalString(obj, "agentId", path));
  optAssign(scope, "sessionKeyHash", optionalString(obj, "sessionKeyHash", path));
  if (obj.timeRange !== undefined) {
    scope.timeRange = windowOf(obj.timeRange, joinPath(path, "timeRange"));
  }
  return scope;
}

export function validateDiagnosticTarget(
  raw: unknown,
  trusted: TrustedTenantContext,
  path = "",
): DiagnosticTarget {
  const obj = asRecord(raw, path);
  const target: DiagnosticTarget = {
    schemaVersion: requireSchemaVersion(obj, path),
    targetType: requireLiteral(obj, "targetType", DIAGNOSTIC_TARGET_TYPES, path),
    targetId: requireString(obj, "targetId", path),
    tenantId: requireTenantId(obj, path),
    authority: requireString(obj, "authority", path),
    scope: validateTargetScope(obj.scope, joinPath(path, "scope")),
  };
  assertTenant(target.tenantId, trusted, path);
  const version = optionalString(obj, "version", path);
  if (version === "latest") {
    fail("invalid_version", 'version must not be the string "latest"', joinPath(path, "version"));
  }
  optAssign(target, "version", version);
  optAssign(target, "capability", optionalString(obj, "capability", path));
  if (obj.parent !== undefined) {
    const parent = asRecord(obj.parent, joinPath(path, "parent"));
    const parentPath = joinPath(path, "parent");
    target.parent = {
      targetType: requireLiteral(parent, "targetType", DIAGNOSTIC_TARGET_TYPES, parentPath),
      targetId: requireString(parent, "targetId", parentPath),
      authority: requireString(parent, "authority", parentPath),
    };
  }
  return target;
}

export function validateEvidenceRequirement(
  raw: unknown,
  path = "evidenceRequirement",
): EvidenceRequirement {
  const obj = asRecord(raw, path);
  const req: EvidenceRequirement = {
    schemaVersion: requireSchemaVersion(obj, path),
    evidenceType: requireString(obj, "evidenceType", path),
    source: requireLiteral(obj, "source", EVIDENCE_SOURCE_IDS, path),
    targetType: requireLiteral(obj, "targetType", DIAGNOSTIC_TARGET_TYPES, path),
    fields: requireStringArray(obj, "fields", path),
    sensitivity: requireLiteral(obj, "sensitivity", ["internal", "restricted"], path),
    cost: requireLiteral(obj, "cost", COST_LEVELS, path),
    required: requireBoolean(obj, "required", path),
  };
  if (obj.freshnessMs !== undefined) {
    req.freshnessMs = requireFiniteNumber(obj, "freshnessMs", path);
  }
  return req;
}

export function validateDiagnosticRun(
  raw: unknown,
  trusted: TrustedTenantContext,
  path = "",
): DiagnosticRun {
  const obj = asRecord(raw, path);
  const targets = mapList(obj, "targets", path, (item, itemPath) =>
    validateDiagnosticTarget(item, trusted, itemPath),
  );
  const run: DiagnosticRun = {
    schemaVersion: requireSchemaVersion(obj, path),
    runId: requireString(obj, "runId", path),
    diagnosedAgentRunId: requireNullableString(obj, "diagnosedAgentRunId", path),
    mode: requireLiteral(obj, "mode", DIAGNOSTIC_RUN_MODES, path),
    targets,
    requestedBy: validateDiagnosticPrincipal(
      obj.requestedBy,
      trusted,
      joinPath(path, "requestedBy"),
    ),
    mutationPolicy: requireLiteral(obj, "mutationPolicy", MUTATION_POLICIES, path),
    budget: budgetOf(obj.budget, joinPath(path, "budget")),
    status: requireLiteral(obj, "status", DIAGNOSTIC_RUN_STATUSES, path),
    missingEvidence: mapList(obj, "missingEvidence", path, validateEvidenceRequirement),
    startedAt: requireString(obj, "startedAt", path),
  };
  optAssign(run, "caseId", optionalString(obj, "caseId", path));
  optAssign(run, "completedAt", optionalString(obj, "completedAt", path));
  if (run.diagnosedAgentRunId !== null && run.runId === run.diagnosedAgentRunId) {
    fail(
      "run_id_collision",
      "runId must be distinct from diagnosedAgentRunId",
      joinPath(path, "runId"),
    );
  }
  if (targets.some((target) => target.targetType === "run") && run.diagnosedAgentRunId === null) {
    fail(
      "missing_field",
      "diagnosedAgentRunId is required when a target is a run",
      joinPath(path, "diagnosedAgentRunId"),
    );
  }
  if (obj.completion !== undefined) {
    run.completion = validateDiagnosisCompletion(obj.completion, joinPath(path, "completion"));
    if (run.completion === "INCONCLUSIVE" && run.missingEvidence.length === 0) {
      fail(
        "missing_evidence_required",
        "INCONCLUSIVE requires missingEvidence",
        joinPath(path, "missingEvidence"),
      );
    }
    if (run.completion === "BLOCKED") {
      run.blockReason = requireString(obj, "blockReason", path);
    }
    if (run.completion === "TIMED_OUT") {
      const snap = budgetOf(obj.budgetSnapshot, joinPath(path, "budgetSnapshot"));
      const snapObj = asRecord(obj.budgetSnapshot, joinPath(path, "budgetSnapshot"));
      run.budgetSnapshot = {
        ...snap,
        elapsedMs: requireFiniteNumber(snapObj, "elapsedMs", joinPath(path, "budgetSnapshot")),
        diagnosersUsed: requireFiniteNumber(
          snapObj,
          "diagnosersUsed",
          joinPath(path, "budgetSnapshot"),
        ),
        modelCallsUsed: requireFiniteNumber(
          snapObj,
          "modelCallsUsed",
          joinPath(path, "budgetSnapshot"),
        ),
      };
    }
  } else {
    optAssign(run, "blockReason", optionalString(obj, "blockReason", path));
  }
  return run;
}

export function validateDiagnosticEvidence(
  raw: unknown,
  trusted: TrustedTenantContext,
  options: EvidenceValidateOptions = {},
  path = "",
): DiagnosticEvidence {
  const obj = asRecord(raw, path);
  const source = requireLiteral(obj, "source", EVIDENCE_SOURCE_IDS, path);
  const colPath = joinPath(path, "collection");
  const col = asRecord(obj.collection, colPath);
  const attributionResolution = requireLiteral(
    col,
    "attributionResolution",
    ATTRIBUTION_RESOLUTIONS,
    colPath,
  );
  if (source === "skill_invocation" && attributionResolution === "not_applicable") {
    fail(
      "attribution_resolution_required",
      "skill_invocation evidence must declare a real attributionResolution, not not_applicable",
      joinPath(colPath, "attributionResolution"),
    );
  }
  if (source !== "skill_invocation" && attributionResolution !== "not_applicable") {
    fail(
      "attribution_resolution_invalid",
      "non-skill evidence must set attributionResolution to not_applicable",
      joinPath(colPath, "attributionResolution"),
    );
  }
  const collection: DiagnosticEvidenceCollection = {
    method: requireLiteral(col, "method", EVIDENCE_COLLECTION_METHODS, colPath),
    completeness: requireLiteral(col, "completeness", EVIDENCE_COMPLETENESS, colPath),
    attributionResolution,
  };
  const privPath = joinPath(path, "privacy");
  const priv = asRecord(obj.privacy, privPath);
  const evidence: DiagnosticEvidence = {
    schemaVersion: requireSchemaVersion(obj, path),
    evidenceId: requireString(obj, "evidenceId", path),
    evidenceType: requireLiteral(obj, "evidenceType", EVIDENCE_TYPES, path),
    source,
    authority: requireString(obj, "authority", path),
    authorityRecordId: requireString(obj, "authorityRecordId", path),
    observedAt: requireString(obj, "observedAt", path),
    target: validateDiagnosticTarget(obj.target, trusted, joinPath(path, "target")),
    summary: requireSummary(obj.summary, joinPath(path, "summary")),
    collection,
    privacy: {
      classification: requireLiteral(priv, "classification", PRIVACY_CLASSIFICATIONS, privPath),
      redacted: requireBoolean(priv, "redacted", privPath),
    },
  };
  if (obj.trace !== undefined) {
    const trace = asRecord(obj.trace, joinPath(path, "trace"));
    const tracePath = joinPath(path, "trace");
    evidence.trace = {};
    optAssign(evidence.trace, "traceId", optionalString(trace, "traceId", tracePath));
    optAssign(evidence.trace, "spanId", optionalString(trace, "spanId", tracePath));
    optAssign(evidence.trace, "parentSpanId", optionalString(trace, "parentSpanId", tracePath));
  }
  if (obj.payloadRef !== undefined) {
    const refPath = joinPath(path, "payloadRef");
    const ref = asRecord(obj.payloadRef, refPath);
    const expiresAt = optionalString(ref, "expiresAt", refPath);
    evidence.payloadRef = {
      store: requireString(ref, "store", refPath),
      recordId: requireString(ref, "recordId", refPath),
    };
    optAssign(evidence.payloadRef, "expiresAt", expiresAt);
    if (expiresAt) {
      const now = options.now ?? new Date();
      if (Date.parse(expiresAt) < now.getTime() && collection.completeness !== "source_expired") {
        fail(
          "source_expired",
          "expired payloadRef.expiresAt requires collection.completeness=source_expired",
          joinPath(path, "collection.completeness"),
        );
      }
    }
  }
  if (obj.integrity !== undefined) {
    const intPath = joinPath(path, "integrity");
    const integrity = asRecord(obj.integrity, intPath);
    evidence.integrity = {
      collectorVersion: requireString(integrity, "collectorVersion", intPath),
    };
    optAssign(evidence.integrity, "contentHash", optionalString(integrity, "contentHash", intPath));
  }
  return evidence;
}

export function validateDiagnosticObservation(
  raw: unknown,
  trusted: TrustedTenantContext,
  path = "",
): DiagnosticObservation {
  const obj = asRecord(raw, path);
  const value = obj.value;
  if (
    value !== null &&
    typeof value !== "string" &&
    typeof value !== "number" &&
    typeof value !== "boolean"
  ) {
    fail("invalid_type", "value must be string | number | boolean | null", joinPath(path, "value"));
  }
  const observation: DiagnosticObservation = {
    schemaVersion: requireSchemaVersion(obj, path),
    observationId: requireString(obj, "observationId", path),
    target: validateDiagnosticTarget(obj.target, trusted, joinPath(path, "target")),
    predicate: requireString(obj, "predicate", path),
    value,
    evidenceIds: requireStringArray(obj, "evidenceIds", path),
    observedAt: requireString(obj, "observedAt", path),
  };
  if (observation.evidenceIds.length < 1) {
    fail(
      "evidence_required",
      "Observation.evidenceIds must have length >= 1",
      joinPath(path, "evidenceIds"),
    );
  }
  return observation;
}

export function validateDiagnosticAssessment(raw: unknown, path = ""): DiagnosticAssessment {
  const obj = asRecord(raw, path);
  const assessment: DiagnosticAssessment = {
    schemaVersion: requireSchemaVersion(obj, path),
    assessmentId: requireString(obj, "assessmentId", path),
    observationIds: requireStringArray(obj, "observationIds", path),
    code: requireString(obj, "code", path),
    verdict: requireLiteral(obj, "verdict", ["normal", "anomalous", "unknown"], path),
  };
  optAssign(assessment, "ruleId", optionalString(obj, "ruleId", path));
  optAssign(assessment, "baselineRef", optionalString(obj, "baselineRef", path));
  return assessment;
}

export function validateDiagnosticAttribution(
  raw: unknown,
  trusted: TrustedTenantContext,
  path = "",
): DiagnosticAttribution {
  const obj = asRecord(raw, path);
  return {
    schemaVersion: requireSchemaVersion(obj, path),
    attributionId: requireString(obj, "attributionId", path),
    assessmentId: requireString(obj, "assessmentId", path),
    suspectedTarget: validateDiagnosticTarget(
      obj.suspectedTarget,
      trusted,
      joinPath(path, "suspectedTarget"),
    ),
    responsibilityDomain: requireString(obj, "responsibilityDomain", path),
    state: requireLiteral(obj, "state", ["suspected", "supported", "confirmed", "rejected"], path),
    basis: requireLiteral(
      obj,
      "basis",
      ["runtime_identity", "ownership_map", "rule", "model_suggestion", "human_confirmed"],
      path,
    ),
  };
}

export function validateDiagnosticHypothesis(raw: unknown, path = ""): DiagnosticHypothesis {
  const obj = asRecord(raw, path);
  const hypothesis: DiagnosticHypothesis = {
    schemaVersion: requireSchemaVersion(obj, path),
    hypothesisId: requireString(obj, "hypothesisId", path),
    code: requireString(obj, "code", path),
    state: requireLiteral(
      obj,
      "state",
      ["candidate", "supported", "rejected", "confirmed", "unknown"],
      path,
    ),
    confidence: validateConfidenceVector(obj.confidence, joinPath(path, "confidence")),
    supportingEvidenceIds: requireStringArray(obj, "supportingEvidenceIds", path),
    contradictingEvidenceIds: requireStringArray(obj, "contradictingEvidenceIds", path),
    missingEvidence: requireStringArray(obj, "missingEvidence", path),
    scoringMethod: requireLiteral(
      obj,
      "scoringMethod",
      ["rule_v1", "model_assisted_v1", "human_confirmed"],
      path,
    ),
  };
  optAssign(hypothesis, "scoreReasonCode", optionalString(obj, "scoreReasonCode", path));
  optAssign(hypothesis, "scorerVersion", optionalString(obj, "scorerVersion", path));
  return hypothesis;
}

function assertFindingEvidenceGate(finding: DiagnosticFinding, path: string): void {
  const completion = finding.completion;
  const missing = finding.missingEvidence ?? [];
  const allowEmpty =
    (completion === "INCONCLUSIVE" || completion === "BLOCKED" || completion === "TIMED_OUT") &&
    missing.length > 0;
  if (completion === "CONFIRMED" || completion === "PROBABLE" || completion === undefined) {
    if (finding.evidenceIds.length < 1) {
      fail(
        "evidence_required",
        "CONFIRMED/PROBABLE findings require evidenceIds",
        joinPath(path, "evidenceIds"),
      );
    }
  } else if (!allowEmpty && finding.evidenceIds.length < 1) {
    fail(
      "evidence_required",
      "Finding.evidenceIds must be non-empty unless missingEvidence is present",
      joinPath(path, "evidenceIds"),
    );
  }
  if (completion === "INCONCLUSIVE" && missing.length === 0) {
    fail(
      "missing_evidence_required",
      "INCONCLUSIVE requires missingEvidence",
      joinPath(path, "missingEvidence"),
    );
  }
}

function isAuditableAcceptedCause(relation: DiagnosisRelation): boolean {
  if (relation.derivation === "EVIDENCE_DERIVED") {
    return relation.evidenceIds.length >= 1;
  }
  if (relation.derivation === "RULE_DERIVED") {
    return relation.evidenceIds.length >= 1 || Boolean(relation.ruleId && relation.ruleVersion);
  }
  if (relation.derivation === "HUMAN_CONFIRMED") {
    return (
      relation.evidenceIds.length >= 1 || Boolean(relation.confirmationRef || relation.auditRef)
    );
  }
  return false;
}

function isNonModelAuditableRelation(relation: DiagnosisRelation): boolean {
  if (relation.derivation === "MODEL_INFERRED") {
    return false;
  }
  if (relation.relation === "causes" && relation.state === "accepted") {
    return isAuditableAcceptedCause(relation);
  }
  return true;
}

function assertAcceptedCausesAudit(relation: DiagnosisRelation, path: string): void {
  if (relation.relation !== "causes" || relation.state !== "accepted") {
    return;
  }
  if (relation.derivation === "EVIDENCE_DERIVED" && relation.evidenceIds.length < 1) {
    fail(
      "accepted_causes_evidence_required",
      "accepted EVIDENCE_DERIVED causes requires a non-empty evidenceIds",
      joinPath(path, "evidenceIds"),
    );
  }
  if (
    relation.derivation === "RULE_DERIVED" &&
    relation.evidenceIds.length < 1 &&
    !(relation.ruleId && relation.ruleVersion)
  ) {
    fail(
      "accepted_causes_rule_audit_required",
      "accepted RULE_DERIVED causes requires evidenceIds or ruleId+ruleVersion",
      joinPath(path, "ruleId"),
    );
  }
  if (
    relation.derivation === "HUMAN_CONFIRMED" &&
    relation.evidenceIds.length < 1 &&
    !relation.confirmationRef &&
    !relation.auditRef
  ) {
    fail(
      "accepted_causes_confirmation_required",
      "accepted HUMAN_CONFIRMED causes requires evidenceIds, confirmationRef, or auditRef",
      joinPath(path, "confirmationRef"),
    );
  }
}

export function assertFindingNotModelOnlyP0(input: {
  finding: DiagnosticFinding;
  relations: readonly DiagnosisRelation[];
  attributions: readonly DiagnosticAttribution[];
}): void {
  if (input.finding.severity !== "P0") {
    return;
  }
  if (!Array.isArray(input.relations) || !Array.isArray(input.attributions)) {
    fail(
      "p0_support_required",
      "P0 Finding validation requires explicit relations and attributions context",
      "severity",
    );
  }
  const attrs = input.attributions.filter((item) =>
    input.finding.attributionIds.includes(item.attributionId),
  );
  const rels = input.relations.filter(
    (item) => item.fromId === input.finding.findingId || item.toId === input.finding.findingId,
  );
  const hasNonModelAttribution = attrs.some((item) => item.basis !== "model_suggestion");
  const hasNonModelRelation = rels.some(isNonModelAuditableRelation);
  if (!hasNonModelAttribution && !hasNonModelRelation) {
    fail(
      "model_only_p0",
      "P0 cannot be produced solely by MODEL_INFERRED relations / model_suggestion attribution",
      "severity",
    );
  }
}

export function validateDiagnosticFinding(
  raw: unknown,
  trusted: TrustedTenantContext,
  support: FindingP0Support = {},
  path = "",
): DiagnosticFinding {
  const obj = asRecord(raw, path);
  const finding: DiagnosticFinding = {
    schemaVersion: requireSchemaVersion(obj, path),
    findingId: requireString(obj, "findingId", path),
    code: requireString(obj, "code", path),
    title: requireString(obj, "title", path),
    target: validateDiagnosticTarget(obj.target, trusted, joinPath(path, "target")),
    status: requireLiteral(
      obj,
      "status",
      ["open", "acknowledged", "resolved", "false_positive"],
      path,
    ),
    severity: requireLiteral(obj, "severity", ["P0", "P1", "P2", "P3", "P4"], path),
    primaryDomain: requireLiteral(obj, "primaryDomain", FINDING_DOMAINS, path),
    observationIds: requireStringArray(obj, "observationIds", path),
    assessmentIds: requireStringArray(obj, "assessmentIds", path),
    attributionIds: requireStringArray(obj, "attributionIds", path),
    hypothesisIds: requireStringArray(obj, "hypothesisIds", path),
    evidenceIds: requireStringArray(obj, "evidenceIds", path),
    confidence: validateConfidenceVector(obj.confidence, joinPath(path, "confidence")),
    fingerprint: requireString(obj, "fingerprint", path),
    firstSeenAt: requireString(obj, "firstSeenAt", path),
    lastSeenAt: requireString(obj, "lastSeenAt", path),
  };
  if (obj.completion !== undefined) {
    finding.completion = validateDiagnosisCompletion(obj.completion, joinPath(path, "completion"));
  }
  if (obj.missingEvidence !== undefined) {
    finding.missingEvidence = mapList(obj, "missingEvidence", path, validateEvidenceRequirement);
  }
  assertFindingEvidenceGate(finding, path);
  // Always run. Missing support is p0_support_required; model-only support is model_only_p0.
  assertFindingNotModelOnlyP0({
    finding,
    ...requireFindingP0Support(finding, support, path),
  });
  return finding;
}

export function validateDiagnosisRelation(raw: unknown, path = ""): DiagnosisRelation {
  const obj = asRecord(raw, path);
  const relation: DiagnosisRelation = {
    schemaVersion: requireSchemaVersion(obj, path),
    relationId: requireString(obj, "relationId", path),
    fromId: requireString(obj, "fromId", path),
    toId: requireString(obj, "toId", path),
    relation: requireLiteral(obj, "relation", RELATION_KINDS, path),
    derivation: requireLiteral(obj, "derivation", RELATION_DERIVATIONS, path),
    state: requireLiteral(obj, "state", RELATION_STATES, path),
    confidence: requireUnitInterval(obj, "confidence", path),
    evidenceIds: requireStringArray(obj, "evidenceIds", path),
  };
  optAssign(relation, "ruleId", optionalString(obj, "ruleId", path));
  optAssign(relation, "ruleVersion", optionalString(obj, "ruleVersion", path));
  optAssign(relation, "confirmationRef", optionalString(obj, "confirmationRef", path));
  optAssign(relation, "auditRef", optionalString(obj, "auditRef", path));
  if (relation.derivation === "MODEL_INFERRED" && relation.state !== "candidate") {
    fail(
      "model_inferred_not_candidate",
      "MODEL_INFERRED can only produce state=candidate",
      joinPath(path, "state"),
    );
  }
  if (
    relation.relation === "causes" &&
    relation.state === "accepted" &&
    !(CAUSES_ACCEPTABLE_DERIVATIONS as readonly string[]).includes(relation.derivation)
  ) {
    fail(
      "causes_accepted_derivation",
      "accepted causes requires EVIDENCE_DERIVED | RULE_DERIVED | HUMAN_CONFIRMED",
      joinPath(path, "derivation"),
    );
  }
  assertAcceptedCausesAudit(relation, path);
  return relation;
}

export function validateDiagnosticCase(
  raw: unknown,
  trusted: TrustedTenantContext,
  path = "",
): DiagnosticCase {
  const obj = asRecord(raw, path);
  const diagnosticCase: DiagnosticCase = {
    schemaVersion: requireSchemaVersion(obj, path),
    caseId: requireString(obj, "caseId", path),
    tenantId: requireTenantId(obj, path),
    status: requireLiteral(obj, "status", CASE_STATUSES, path),
    targets: mapList(obj, "targets", path, (item, itemPath) =>
      validateDiagnosticTarget(item, trusted, itemPath),
    ),
    diagnosticRunIds: requireStringArray(obj, "diagnosticRunIds", path),
    findingIds: requireStringArray(obj, "findingIds", path),
    relationIds: requireStringArray(obj, "relationIds", path),
    timeline: mapList(obj, "timeline", path, (item, itemPath) => {
      const row = asRecord(item, itemPath);
      return { at: requireString(row, "at", itemPath), code: requireString(row, "code", itemPath) };
    }),
  };
  assertTenant(diagnosticCase.tenantId, trusted, path);
  if (obj.impact !== undefined) {
    const impactPath = joinPath(path, "impact");
    const impact = asRecord(obj.impact, impactPath);
    diagnosticCase.impact = {};
    if (impact.affectedCount !== undefined) {
      diagnosticCase.impact.affectedCount = requireFiniteNumber(
        impact,
        "affectedCount",
        impactPath,
      );
    }
    optAssign(diagnosticCase.impact, "code", optionalString(impact, "code", impactPath));
  }
  return diagnosticCase;
}

export function validateDiagnosticRecommendation(
  raw: unknown,
  finding: DiagnosticFinding,
  support: FindingP0Support = {},
  path = "",
): DiagnosticRecommendation {
  const obj = asRecord(raw, path);
  const recommendation: DiagnosticRecommendation = {
    schemaVersion: requireSchemaVersion(obj, path),
    recommendationId: requireString(obj, "recommendationId", path),
    findingId: requireString(obj, "findingId", path),
    code: requireString(obj, "code", path),
    executorCapability: requireString(obj, "executorCapability", path),
    mutationPolicy: requireLiteral(obj, "mutationPolicy", MUTATION_POLICIES, path),
  };
  if (recommendation.findingId !== finding.findingId) {
    fail(
      "finding_mismatch",
      "DiagnosticRecommendation.findingId must match the supplied Finding",
      joinPath(path, "findingId"),
    );
  }
  if (recommendation.mutationPolicy !== "SUGGEST") {
    fail(
      "invalid_literal",
      "DiagnosticRecommendation.mutationPolicy must be SUGGEST",
      joinPath(path, "mutationPolicy"),
    );
  }
  assertFindingNotModelOnlyP0({
    finding,
    ...requireFindingP0Support(finding, support, path),
  });
  return recommendation;
}

export function validateDiagnosticVerification(raw: unknown, path = ""): DiagnosticVerification {
  const obj = asRecord(raw, path);
  const verification: DiagnosticVerification = {
    schemaVersion: requireSchemaVersion(obj, path),
    verificationId: requireString(obj, "verificationId", path),
    caseId: requireString(obj, "caseId", path),
    baselineWindow: windowOf(obj.baselineWindow, joinPath(path, "baselineWindow")),
    observationWindow: windowOf(obj.observationWindow, joinPath(path, "observationWindow")),
    expectedOutcome: requireSummary(obj.expectedOutcome, joinPath(path, "expectedOutcome")),
  };
  if (obj.measuredOutcome !== undefined) {
    verification.measuredOutcome = requireSummary(
      obj.measuredOutcome,
      joinPath(path, "measuredOutcome"),
    );
  }
  optAssign(
    verification,
    "verdict",
    optionalLiteral(obj, "verdict", ["improved", "unchanged", "regressed", "inconclusive"], path),
  );
  return verification;
}

export function validateDiagnoserManifest(raw: unknown, path = ""): DiagnoserManifest {
  const obj = asRecord(raw, path);
  const cost = asRecord(obj.cost, joinPath(path, "cost"));
  return {
    schemaVersion: requireSchemaVersion(obj, path),
    id: requireString(obj, "id", path),
    version: requireString(obj, "version", path),
    targets: typedList(obj, "targets", DIAGNOSTIC_TARGET_TYPES, path),
    modes: typedList(obj, "modes", DIAGNOSTIC_RUN_MODES, path),
    evidenceRequirements: mapList(obj, "evidenceRequirements", path, validateEvidenceRequirement),
    produces: requireStringArray(obj, "produces", path),
    cost: {
      cpu: requireLiteral(cost, "cpu", COST_LEVELS, joinPath(path, "cost")),
      io: requireLiteral(cost, "io", COST_LEVELS, joinPath(path, "cost")),
      modelCalls: requireFiniteNumber(cost, "modelCalls", joinPath(path, "cost")),
    },
    permissions: requireStringArray(obj, "permissions", path),
    mutation: requireLiteral(obj, "mutation", ["none", "suggest_only"], path),
  };
}

const FORBIDDEN_RESULT_KEYS = [
  "configMutation",
  "remediationExecute",
  "remediation",
  "mutations",
  "executeFix",
  "doctorFix",
] as const;

export function validateDiagnoserResult(
  raw: unknown,
  trusted: TrustedTenantContext,
  path = "",
): DiagnoserResult {
  const obj = asRecord(raw, path);
  for (const key of FORBIDDEN_RESULT_KEYS) {
    if (key in obj) {
      fail(
        "diagnoser_mutation_forbidden",
        `DiagnoserResult must not include ${key}`,
        joinPath(path, key),
      );
    }
  }
  const attributions = mapList(obj, "attributions", path, (item, itemPath) =>
    validateDiagnosticAttribution(item, trusted, itemPath),
  );
  const relationCandidates = mapList(obj, "relationCandidates", path, validateDiagnosisRelation);
  return {
    schemaVersion: requireSchemaVersion(obj, path),
    observations: mapList(obj, "observations", path, (item, itemPath) =>
      validateDiagnosticObservation(item, trusted, itemPath),
    ),
    assessments: mapList(obj, "assessments", path, validateDiagnosticAssessment),
    attributions,
    hypotheses: mapList(obj, "hypotheses", path, validateDiagnosticHypothesis),
    findingDrafts: mapList(obj, "findingDrafts", path, (item, itemPath) =>
      validateDiagnosticFinding(
        item,
        trusted,
        { relations: relationCandidates, attributions },
        itemPath,
      ),
    ),
    relationCandidates,
    nextEvidenceRequests: mapList(obj, "nextEvidenceRequests", path, validateEvidenceRequirement),
  };
}

export function validateEvidenceSourceManifest(raw: unknown, path = ""): EvidenceSourceManifest {
  const obj = asRecord(raw, path);
  return {
    schemaVersion: requireSchemaVersion(obj, path),
    id: requireLiteral(obj, "id", EVIDENCE_SOURCE_IDS, path),
    authority: requireString(obj, "authority", path),
    evidenceTypes: requireStringArray(obj, "evidenceTypes", path),
    targetTypes: typedList(obj, "targetTypes", DIAGNOSTIC_TARGET_TYPES, path),
    cost: requireLiteral(obj, "cost", COST_LEVELS, path),
    sensitivity: requireLiteral(obj, "sensitivity", ["internal", "restricted"], path),
    phase1Safe: requireBoolean(obj, "phase1Safe", path),
  };
}

export function validateDiagnosisPlanStep(raw: unknown, path = ""): DiagnosisPlanStep {
  const obj = asRecord(raw, path);
  const step: DiagnosisPlanStep = {
    schemaVersion: requireSchemaVersion(obj, path),
    stepId: requireString(obj, "stepId", path),
    hypothesisIds: requireStringArray(obj, "hypothesisIds", path),
    evidenceRequests: mapList(obj, "evidenceRequests", path, validateEvidenceRequirement),
    expectedInformationGain: requireLiteral(obj, "expectedInformationGain", COST_LEVELS, path),
    stopWhen: requireStringArray(obj, "stopWhen", path),
  };
  const diagnoserId = optionalString(obj, "diagnoserId", path);
  const evidenceSourceId =
    obj.evidenceSourceId === undefined
      ? undefined
      : requireLiteral(obj, "evidenceSourceId", EVIDENCE_SOURCE_IDS, path);
  if (!diagnoserId && !evidenceSourceId) {
    fail(
      "plan_step_request_required",
      "DiagnosisPlanStep must request a Diagnoser and/or Evidence Source",
      path,
    );
  }
  optAssign(step, "diagnoserId", diagnoserId);
  optAssign(step, "evidenceSourceId", evidenceSourceId);
  return step;
}

export function validateDiagnosisPlan(raw: unknown, path = ""): DiagnosisPlan {
  const obj = asRecord(raw, path);
  return {
    schemaVersion: requireSchemaVersion(obj, path),
    planId: requireString(obj, "planId", path),
    runId: requireString(obj, "runId", path),
    mode: requireLiteral(obj, "mode", DIAGNOSTIC_RUN_MODES, path),
    steps: mapList(obj, "steps", path, validateDiagnosisPlanStep),
  };
}

export function assertNoRuntimeFactMutation(op: string): asserts op is DiagnosisStoreCapability {
  if ((FORBIDDEN_RUNTIME_MUTATION_OPS as readonly string[]).includes(op)) {
    fail("runtime_fact_mutation", `Diagnosis must not write back runtime facts (${op})`, "op");
  }
  if (!(DIAGNOSIS_STORE_CAPABILITIES as readonly string[]).includes(op)) {
    fail("unknown_store_capability", `unsupported diagnosis store capability: ${op}`, "op");
  }
}
