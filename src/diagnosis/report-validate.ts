/**
 * Phase 3 increment 2 — Composite Diagnosis Report validation and export.
 * Read-only JSON boundary. No HTTP/RPC, Markdown, model summary, or stores.
 */
import { isSessionlessTargetType, type EvidenceRef } from "./cross-target.js";
import { assertGraphRelation } from "./graph.js";
import {
  COMPOSITE_DIAGNOSIS_REPORT_SCHEMA_VERSION,
  serializeCompositeDiagnosisReport,
  type CompositeDiagnosisReport,
  type ReportCaseSummary,
  type ReportConfidenceSummary,
  type ReportFinding,
  type ReportTarget,
} from "./report.js";
import {
  CASE_STATUSES,
  DIAGNOSTIC_TARGET_TYPES,
  DiagnosisContractError,
  EVIDENCE_SOURCE_IDS,
  FORBIDDEN_UI_FIELD_KEYS,
  validateConfidenceVector,
  validateDiagnosisCompletion,
  validateDiagnosticTarget,
  validateEvidenceRequirement,
  type DiagnosisRelation,
  type DiagnosticTargetType,
  type TrustedTenantContext,
} from "./types.js";

export const FORBIDDEN_REPORT_PAYLOAD_KEYS = [
  "summary",
  "prompt",
  "params",
  "result",
  "message",
  "body",
  "messageBody",
  "toolParams",
  "toolResult",
  "payload",
  ...FORBIDDEN_UI_FIELD_KEYS,
] as const;

export function validateCompositeDiagnosisReport(
  raw: unknown,
  trusted: TrustedTenantContext,
): CompositeDiagnosisReport {
  if (!isRecord(raw)) {
    throw new DiagnosisContractError(
      "invalid_type",
      "CompositeDiagnosisReport must be an object",
      "",
    );
  }
  if (!Object.hasOwn(raw, "schemaVersion")) {
    throw new DiagnosisContractError("missing_field", "schemaVersion is required", "schemaVersion");
  }
  if (raw.schemaVersion !== COMPOSITE_DIAGNOSIS_REPORT_SCHEMA_VERSION) {
    throw new DiagnosisContractError(
      "unknown_schema_version",
      "CompositeDiagnosisReport only supports schemaVersion=1",
      "schemaVersion",
    );
  }
  assertNoForbiddenPayloadKeys(raw, "");

  const reportId = requireString(raw, "reportId");
  const generatedAt = requireString(raw, "generatedAt");
  if (!isIsoTimestamp(generatedAt)) {
    throw new DiagnosisContractError(
      "invalid_type",
      "generatedAt must be an ISO-8601 timestamp",
      "generatedAt",
    );
  }
  if (!reportId.startsWith("cdr-") || !reportId.includes(generatedAt)) {
    throw new DiagnosisContractError(
      "invalid_report_id",
      "reportId must be a deterministic cdr- fingerprint bound to generatedAt",
      "reportId",
    );
  }

  const tenantId = requireTenantId(raw);
  if (tenantId !== trusted.tenantId) {
    throw new DiagnosisContractError(
      "tenant_mismatch",
      "report tenantId must match trusted tenant context",
      "tenantId",
    );
  }

  const cases = mapItems(raw, "cases", validateReportCase);
  const findings = mapItems(raw, "findings", validateReportFinding);
  const evidenceRefs = mapItems(raw, "evidenceRefs", validateReportEvidenceRef);
  const targets = mapItems(raw, "targets", validateReportTarget);
  const graphEdges = mapItems(raw, "graphEdges", (item, path) => assertGraphRelationAt(item, path));
  const acceptedRootCauses = mapItems(raw, "acceptedRootCauses", (item, path) =>
    assertGraphRelationAt(item, path),
  );
  const candidateRootCauses = mapItems(raw, "candidateRootCauses", (item, path) =>
    assertGraphRelationAt(item, path),
  );
  const missingEvidence = mapItems(raw, "missingEvidence", (item, path) =>
    validateEvidenceRequirement(item, path),
  );
  const completion = validateDiagnosisCompletion(raw.completion, "completion");
  const impactScope = mapItems(raw, "impactScope", (item, path) => requireTargetType(item, path));
  const confidence = validateReportConfidence(raw.confidence);

  assertSingleTenant(tenantId, cases, findings, evidenceRefs, targets);
  assertReferences(
    cases,
    findings,
    evidenceRefs,
    graphEdges,
    acceptedRootCauses,
    candidateRootCauses,
  );
  assertGraphNodeEndpoints(
    findings,
    evidenceRefs,
    graphEdges,
    acceptedRootCauses,
    candidateRootCauses,
  );
  assertRootCausesMatchGraph(graphEdges, acceptedRootCauses, candidateRootCauses);
  if (completion === "INCONCLUSIVE" && missingEvidence.length === 0) {
    throw new DiagnosisContractError(
      "missing_evidence_required",
      "INCONCLUSIVE report must retain missingEvidence",
      "missingEvidence",
    );
  }
  if (acceptedRootCauses.some((relation) => relation.derivation === "MODEL_INFERRED")) {
    throw new DiagnosisContractError(
      "model_inferred_not_candidate",
      "MODEL_INFERRED can only appear in candidate root causes",
      "acceptedRootCauses",
    );
  }

  return {
    schemaVersion: COMPOSITE_DIAGNOSIS_REPORT_SCHEMA_VERSION,
    reportId,
    generatedAt,
    tenantId,
    cases,
    targets,
    findings,
    evidenceRefs,
    graphEdges,
    acceptedRootCauses,
    candidateRootCauses,
    impactScope: [...impactScope],
    completion,
    missingEvidence,
    confidence,
  };
}

export function exportCompositeDiagnosisReportJson(
  raw: unknown,
  trusted: TrustedTenantContext,
): string {
  return serializeCompositeDiagnosisReport(validateCompositeDiagnosisReport(raw, trusted));
}

const FINDING_STATUSES = ["open", "acknowledged", "resolved", "false_positive"] as const;
const FINDING_SEVERITIES = ["P0", "P1", "P2", "P3", "P4"] as const;

function mapItems<T>(
  obj: Record<string, unknown>,
  key: string,
  map: (item: unknown, path: string) => T,
): T[] {
  const value = obj[key];
  if (!Array.isArray(value)) {
    throw new DiagnosisContractError("invalid_type", `${key} must be an array`, key);
  }
  return value.map((item, index) => map(item, `${key}[${index}]`));
}

function validateReportCase(raw: unknown, path: string): ReportCaseSummary {
  if (!isRecord(raw)) {
    throw new DiagnosisContractError("invalid_type", `${path} must be an object`, path);
  }
  assertNoForbiddenPayloadKeys(raw, path);
  return {
    caseId: requirePathString(raw, "caseId", path),
    mergeKey: requirePathString(raw, "mergeKey", path),
    tenantId: requirePathTenantId(raw, path),
    sessionKeyHash: requirePathString(raw, "sessionKeyHash", path),
    completion: validateDiagnosisCompletion(raw.completion, joinPath(path, "completion")),
    status: requirePathLiteral(raw, "status", CASE_STATUSES, path),
    findingIds: requirePathStringArray(raw, "findingIds", path),
    evidenceRefIds: requirePathStringArray(raw, "evidenceRefIds", path),
    relationIds: requirePathStringArray(raw, "relationIds", path),
  };
}

function validateReportFinding(raw: unknown, path: string): ReportFinding {
  if (!isRecord(raw)) {
    throw new DiagnosisContractError("invalid_type", `${path} must be an object`, path);
  }
  assertNoForbiddenPayloadKeys(raw, path);
  const targetType = requirePathLiteral(raw, "targetType", DIAGNOSTIC_TARGET_TYPES, path);
  const targetId = requirePathString(raw, "targetId", path);
  const tenantId = requirePathTenantId(raw, path);
  const finding: ReportFinding = {
    findingId: requirePathString(raw, "findingId", path),
    code: requirePathString(raw, "code", path),
    title: requirePathString(raw, "title", path),
    severity: requirePathLiteral(raw, "severity", FINDING_SEVERITIES, path),
    status: requirePathLiteral(raw, "status", FINDING_STATUSES, path),
    fingerprint: requirePathString(raw, "fingerprint", path),
    targetType,
    targetId,
    tenantId,
    evidenceIds: requirePathStringArray(raw, "evidenceIds", path),
    confidence: validateConfidenceVector(raw.confidence, joinPath(path, "confidence")),
  };
  if (raw.completion !== undefined) {
    finding.completion = validateDiagnosisCompletion(raw.completion, joinPath(path, "completion"));
  }
  return finding;
}

function validateReportEvidenceRef(raw: unknown, path: string): EvidenceRef {
  if (!isRecord(raw)) {
    throw new DiagnosisContractError("invalid_type", `${path} must be an object`, path);
  }
  assertNoForbiddenPayloadKeys(raw, path);
  const targetType = requirePathLiteral(raw, "targetType", DIAGNOSTIC_TARGET_TYPES, path);
  if (!Object.hasOwn(raw, "sessionKeyHash")) {
    throw new DiagnosisContractError(
      "missing_field",
      "evidenceRef.sessionKeyHash must be explicit (hash or null)",
      joinPath(path, "sessionKeyHash"),
    );
  }
  const sessionKeyHash = raw.sessionKeyHash;
  if (
    sessionKeyHash !== null &&
    (typeof sessionKeyHash !== "string" || sessionKeyHash.length === 0)
  ) {
    throw new DiagnosisContractError(
      "invalid_type",
      "sessionKeyHash must be string | null",
      joinPath(path, "sessionKeyHash"),
    );
  }
  if (sessionKeyHash == null && !isSessionlessTargetType(targetType)) {
    throw new DiagnosisContractError(
      "evidence_ref_session_identity_required",
      "only gateway/host evidenceRef may use sessionKeyHash null",
      joinPath(path, "sessionKeyHash"),
    );
  }
  const observedAt = requirePathString(raw, "observedAt", path);
  if (!isIsoTimestamp(observedAt)) {
    throw new DiagnosisContractError(
      "invalid_type",
      "observedAt must be an ISO-8601 timestamp",
      joinPath(path, "observedAt"),
    );
  }
  return {
    evidenceId: requirePathString(raw, "evidenceId", path),
    source: requirePathLiteral(raw, "source", EVIDENCE_SOURCE_IDS, path),
    authority: requirePathString(raw, "authority", path),
    authorityRecordId: requirePathString(raw, "authorityRecordId", path),
    targetType,
    targetId: requirePathString(raw, "targetId", path),
    observedAt,
    tenantId: requirePathTenantId(raw, path),
    sessionKeyHash,
  };
}

function validateReportTarget(raw: unknown, path: string): ReportTarget {
  if (!isRecord(raw)) {
    throw new DiagnosisContractError("invalid_type", `${path} must be an object`, path);
  }
  assertNoForbiddenPayloadKeys(raw, path);
  if (!Object.hasOwn(raw, "sessionKeyHash")) {
    throw new DiagnosisContractError(
      "missing_field",
      "sessionKeyHash must be explicit (hash or null)",
      joinPath(path, "sessionKeyHash"),
    );
  }
  const sessionKeyHash = raw.sessionKeyHash;
  if (
    sessionKeyHash !== null &&
    (typeof sessionKeyHash !== "string" || sessionKeyHash.length === 0)
  ) {
    throw new DiagnosisContractError(
      "invalid_type",
      "sessionKeyHash must be string | null",
      joinPath(path, "sessionKeyHash"),
    );
  }
  const targetType = requirePathLiteral(raw, "targetType", DIAGNOSTIC_TARGET_TYPES, path);
  const targetId = requirePathString(raw, "targetId", path);
  const tenantId = requirePathTenantId(raw, path);
  const authority = requirePathString(raw, "authority", path);
  validateDiagnosticTarget(
    {
      schemaVersion: 1,
      targetType,
      targetId,
      tenantId,
      authority,
      scope: sessionKeyHash == null ? {} : { sessionKeyHash },
    },
    { tenantId },
    path,
  );
  return { targetType, targetId, tenantId, authority, sessionKeyHash };
}

function validateReportConfidence(raw: unknown): ReportConfidenceSummary {
  if (!isRecord(raw)) {
    throw new DiagnosisContractError("invalid_type", "confidence must be an object", "confidence");
  }
  assertNoForbiddenPayloadKeys(raw, "confidence");
  return {
    findingCount: requireNonNegativeCount(raw, "findingCount"),
    meanEvidence: requireUnitInterval(raw, "meanEvidence", "confidence"),
    meanAssessment: requireUnitInterval(raw, "meanAssessment", "confidence"),
    meanRootCause: requireUnitInterval(raw, "meanRootCause", "confidence"),
    meanImpact: requireUnitInterval(raw, "meanImpact", "confidence"),
    acceptedCauseCount: requireNonNegativeCount(raw, "acceptedCauseCount"),
    candidateCauseCount: requireNonNegativeCount(raw, "candidateCauseCount"),
  };
}

function requireTargetType(raw: unknown, path: string): DiagnosticTargetType {
  if (typeof raw !== "string" || !(DIAGNOSTIC_TARGET_TYPES as readonly string[]).includes(raw)) {
    throw new DiagnosisContractError(
      "invalid_literal",
      `${path} is not a DiagnosticTargetType`,
      path,
    );
  }
  return raw as DiagnosticTargetType;
}

function assertGraphRelationAt(raw: unknown, path: string): DiagnosisRelation {
  try {
    return assertGraphRelation(raw);
  } catch (err) {
    if (err instanceof DiagnosisContractError && err.path === "") {
      throw new DiagnosisContractError(err.code, err.message, path);
    }
    throw err;
  }
}

function assertSingleTenant(
  tenantId: string | null,
  cases: readonly ReportCaseSummary[],
  findings: readonly ReportFinding[],
  evidenceRefs: readonly EvidenceRef[],
  targets: readonly ReportTarget[],
): void {
  const tenants = new Set<string | null>([
    tenantId,
    ...cases.map((item) => item.tenantId),
    ...findings.map((item) => item.tenantId),
    ...evidenceRefs.map((item) => item.tenantId),
    ...targets.map((item) => item.tenantId),
  ]);
  if (tenants.size > 1) {
    throw new DiagnosisContractError(
      "report_tenant_mismatch",
      "Composite Diagnosis Report allows exactly one tenant; cross-tenant reports are not implemented",
      "tenantId",
    );
  }
}

function assertReferences(
  cases: readonly ReportCaseSummary[],
  findings: readonly ReportFinding[],
  evidenceRefs: readonly EvidenceRef[],
  graphEdges: readonly DiagnosisRelation[],
  accepted: readonly DiagnosisRelation[],
  candidates: readonly DiagnosisRelation[],
): void {
  const findingIds = new Set(findings.map((item) => item.findingId));
  const evidenceIds = new Set(evidenceRefs.map((item) => item.evidenceId));
  const relationIds = new Set(graphEdges.map((item) => item.relationId));
  for (const item of cases) {
    for (const findingId of item.findingIds) {
      if (!findingIds.has(findingId)) {
        throw new DiagnosisContractError(
          "dangling_finding_ref",
          `case ${item.caseId} references missing finding ${findingId}`,
          "cases.findingIds",
        );
      }
    }
    for (const evidenceId of item.evidenceRefIds) {
      if (!evidenceIds.has(evidenceId)) {
        throw new DiagnosisContractError(
          "dangling_evidence_ref",
          `case ${item.caseId} references missing evidence ${evidenceId}`,
          "cases.evidenceRefIds",
        );
      }
    }
    for (const relationId of item.relationIds) {
      if (!relationIds.has(relationId)) {
        throw new DiagnosisContractError(
          "dangling_relation_ref",
          `case ${item.caseId} references missing relation ${relationId}`,
          "cases.relationIds",
        );
      }
    }
  }
  for (const finding of findings) {
    for (const evidenceId of finding.evidenceIds) {
      if (!evidenceIds.has(evidenceId)) {
        throw new DiagnosisContractError(
          "dangling_evidence_ref",
          `finding ${finding.findingId} references missing evidence ${evidenceId}`,
          "findings.evidenceIds",
        );
      }
    }
  }
  for (const edge of [...graphEdges, ...accepted, ...candidates]) {
    for (const evidenceId of edge.evidenceIds) {
      if (!evidenceIds.has(evidenceId)) {
        throw new DiagnosisContractError(
          "dangling_evidence_ref",
          `relation ${edge.relationId} references missing evidence ${evidenceId}`,
          "relations.evidenceIds",
        );
      }
    }
  }
  for (const edge of [...accepted, ...candidates]) {
    if (!relationIds.has(edge.relationId)) {
      throw new DiagnosisContractError(
        "dangling_relation_ref",
        `root cause ${edge.relationId} is not present in graphEdges`,
        "rootCauses",
      );
    }
  }
}

function assertGraphNodeEndpoints(
  findings: readonly ReportFinding[],
  evidenceRefs: readonly EvidenceRef[],
  graphEdges: readonly DiagnosisRelation[],
  accepted: readonly DiagnosisRelation[],
  candidates: readonly DiagnosisRelation[],
): void {
  const findingIds = new Set(findings.map((item) => item.findingId));
  const evidenceIds = new Set(evidenceRefs.map((item) => item.evidenceId));
  const nodes = new Set<string>([...findingIds, ...evidenceIds]);
  for (const edge of graphEdges) {
    if (!nodes.has(edge.fromId)) {
      nodes.add(edge.fromId);
    }
    if (!nodes.has(edge.toId)) {
      nodes.add(edge.toId);
    }
  }
  for (const edge of [...graphEdges, ...accepted, ...candidates]) {
    if (!nodes.has(edge.fromId) || !nodes.has(edge.toId)) {
      throw new DiagnosisContractError(
        "dangling_graph_node",
        `relation ${edge.relationId} endpoints must exist in finding/evidence/observation nodes`,
        "graphEdges",
      );
    }
  }
}

function assertRootCausesMatchGraph(
  graphEdges: readonly DiagnosisRelation[],
  accepted: readonly DiagnosisRelation[],
  candidates: readonly DiagnosisRelation[],
): void {
  const byId = new Map(graphEdges.map((edge) => [edge.relationId, edge]));
  for (const edge of [...accepted, ...candidates]) {
    const graphEdge = byId.get(edge.relationId);
    if (!graphEdge || relationContentKey(graphEdge) !== relationContentKey(edge)) {
      throw new DiagnosisContractError(
        "root_cause_graph_mismatch",
        `root cause ${edge.relationId} must match the graphEdges entry with the same relationId`,
        "rootCauses",
      );
    }
  }
}

function relationContentKey(relation: DiagnosisRelation): string {
  return JSON.stringify({
    schemaVersion: relation.schemaVersion,
    relationId: relation.relationId,
    fromId: relation.fromId,
    toId: relation.toId,
    relation: relation.relation,
    derivation: relation.derivation,
    state: relation.state,
    confidence: relation.confidence,
    evidenceIds: relation.evidenceIds,
    ruleId: relation.ruleId ?? null,
    ruleVersion: relation.ruleVersion ?? null,
    confirmationRef: relation.confirmationRef ?? null,
    auditRef: relation.auditRef ?? null,
  });
}

function assertNoForbiddenPayloadKeys(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenPayloadKeys(item, `${path}[${index}]`));
    return;
  }
  if (!isRecord(value)) {
    return;
  }
  for (const key of Object.keys(value)) {
    if ((FORBIDDEN_REPORT_PAYLOAD_KEYS as readonly string[]).includes(key)) {
      throw new DiagnosisContractError(
        "report_payload_forbidden",
        `report must not contain payload field ${key}`,
        joinPath(path, key),
      );
    }
    assertNoForbiddenPayloadKeys(value[key], joinPath(path, key));
  }
}

function requireString(obj: Record<string, unknown>, key: string): string {
  const value = obj[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new DiagnosisContractError("invalid_type", `${key} must be a non-empty string`, key);
  }
  return value;
}

function requireTenantId(obj: Record<string, unknown>): string | null {
  if (!Object.hasOwn(obj, "tenantId")) {
    throw new DiagnosisContractError("missing_field", "tenantId is required", "tenantId");
  }
  const value = obj.tenantId;
  if (value !== null && typeof value !== "string") {
    throw new DiagnosisContractError("invalid_type", "tenantId must be string | null", "tenantId");
  }
  return value;
}

function requirePathString(obj: Record<string, unknown>, key: string, path: string): string {
  const value = obj[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new DiagnosisContractError(
      value === undefined ? "missing_field" : "invalid_type",
      `${joinPath(path, key)} must be a non-empty string`,
      joinPath(path, key),
    );
  }
  return value;
}

function requirePathTenantId(obj: Record<string, unknown>, path: string): string | null {
  if (!Object.hasOwn(obj, "tenantId")) {
    throw new DiagnosisContractError(
      "missing_field",
      "tenantId is required",
      joinPath(path, "tenantId"),
    );
  }
  const value = obj.tenantId;
  if (value !== null && (typeof value !== "string" || value.length === 0)) {
    throw new DiagnosisContractError(
      "invalid_type",
      "tenantId must be string | null",
      joinPath(path, "tenantId"),
    );
  }
  return value;
}

function requirePathLiteral<T extends string>(
  obj: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  path: string,
): T {
  if (!(key in obj) || obj[key] === undefined) {
    throw new DiagnosisContractError(
      "missing_field",
      `${joinPath(path, key)} is required`,
      joinPath(path, key),
    );
  }
  const value = obj[key];
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new DiagnosisContractError(
      "invalid_literal",
      `${joinPath(path, key)} is invalid`,
      joinPath(path, key),
    );
  }
  return value as T;
}

function requirePathStringArray(obj: Record<string, unknown>, key: string, path: string): string[] {
  const value = obj[key];
  if (!Array.isArray(value)) {
    throw new DiagnosisContractError(
      value === undefined ? "missing_field" : "invalid_type",
      `${joinPath(path, key)} must be a string[]`,
      joinPath(path, key),
    );
  }
  if (value.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new DiagnosisContractError(
      "invalid_type",
      `${joinPath(path, key)} must be a string[]`,
      joinPath(path, key),
    );
  }
  return value;
}

function requireUnitInterval(obj: Record<string, unknown>, key: string, path: string): number {
  const value = obj[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new DiagnosisContractError(
      value === undefined ? "missing_field" : "invalid_type",
      `${joinPath(path, key)} must be a finite number`,
      joinPath(path, key),
    );
  }
  if (value < 0 || value > 1) {
    throw new DiagnosisContractError(
      "invalid_range",
      `${joinPath(path, key)} must be between 0 and 1`,
      joinPath(path, key),
    );
  }
  return value;
}

function requireNonNegativeCount(obj: Record<string, unknown>, key: string): number {
  const value = obj[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new DiagnosisContractError(
      value === undefined ? "missing_field" : "invalid_type",
      `${key} must be a non-negative integer`,
      joinPath("confidence", key),
    );
  }
  return value;
}

function isIsoTimestamp(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function joinPath(base: string, key: string): string {
  return base ? `${base}.${key}` : key;
}
