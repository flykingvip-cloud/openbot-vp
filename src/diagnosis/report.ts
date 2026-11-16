/**
 * Phase 3 increment 1 — read-only Composite Diagnosis Report.
 * Projects CompositeDiagnosis into a stable reference report.
 * One trusted tenant per report. Does not copy runtime payloads, invent
 * causes, write stores, or repair. Cross-tenant reports are not implemented.
 */
import { createHash } from "node:crypto";
import { type AggregatedCase, type CompositeDiagnosis, type EvidenceRef } from "./cross-target.js";
import {
  acceptedRootCauseRelations,
  assertGraphRelation,
  assertNoParallelRca,
  candidateRootCauseRelations,
} from "./graph.js";
import {
  DiagnosisContractError,
  assertFindingNotModelOnlyP0,
  type ConfidenceVector,
  type DiagnosisCompletion,
  type DiagnosisRelation,
  type DiagnosticCase,
  type DiagnosticFinding,
  type DiagnosticTarget,
  type DiagnosticTargetType,
  type EvidenceRequirement,
  type FindingP0Support,
  type TrustedTenantContext,
} from "./types.js";

export const COMPOSITE_DIAGNOSIS_REPORT_SCHEMA_VERSION = 1 as const;

export type CompositeDiagnosisReportOptions = {
  generatedAt?: string;
  p0Support?: FindingP0Support;
};

export type ReportTarget = {
  targetType: DiagnosticTargetType;
  targetId: string;
  tenantId: string | null;
  authority: string;
  sessionKeyHash: string | null;
};

export type ReportFinding = {
  findingId: string;
  code: string;
  title: string;
  severity: DiagnosticFinding["severity"];
  status: DiagnosticFinding["status"];
  completion?: DiagnosisCompletion;
  fingerprint: string;
  targetType: DiagnosticTargetType;
  targetId: string;
  tenantId: string | null;
  evidenceIds: string[];
  confidence: ConfidenceVector;
};

export type ReportCaseSummary = {
  caseId: string;
  mergeKey: string;
  tenantId: string | null;
  sessionKeyHash: string;
  completion: DiagnosisCompletion;
  status: DiagnosticCase["status"];
  findingIds: string[];
  evidenceRefIds: string[];
  relationIds: string[];
};

export type ReportConfidenceSummary = {
  findingCount: number;
  meanEvidence: number;
  meanAssessment: number;
  meanRootCause: number;
  meanImpact: number;
  acceptedCauseCount: number;
  candidateCauseCount: number;
};

export type CompositeDiagnosisReport = {
  schemaVersion: typeof COMPOSITE_DIAGNOSIS_REPORT_SCHEMA_VERSION;
  reportId: string;
  generatedAt: string;
  tenantId: string | null;
  cases: ReportCaseSummary[];
  targets: ReportTarget[];
  findings: ReportFinding[];
  evidenceRefs: EvidenceRef[];
  graphEdges: DiagnosisRelation[];
  acceptedRootCauses: DiagnosisRelation[];
  candidateRootCauses: DiagnosisRelation[];
  impactScope: DiagnosticTargetType[];
  completion: DiagnosisCompletion;
  missingEvidence: EvidenceRequirement[];
  confidence: ReportConfidenceSummary;
  /**
   * Derived display meaning from collected evidence and missing sources.
   * Not a finding. Omitted when no observation clauses apply.
   */
  observationSummary?: DiagnoseObservationSummary;
};

export function buildCompositeDiagnosisReport(
  diagnosis: CompositeDiagnosis,
  trusted: TrustedTenantContext,
  options: CompositeDiagnosisReportOptions = {},
): CompositeDiagnosisReport {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const tenantId = assertSingleReportTenant(diagnosis, trusted);
  const relations = sortRelations(
    diagnosis.relations.map((relation) => assertGraphRelation(relation)),
  );
  const graphEdges = sortRelations(
    diagnosis.graph.edges.map((relation) => assertGraphRelation(relation)),
  );
  for (const item of diagnosis.cases) {
    assertNoParallelRca({ findings: item.findings, relations: item.relations });
  }
  assertP0Support(diagnosis.findings, options.p0Support);

  const acceptedRootCauses = sortRelations(acceptedRootCauseRelations(relations));
  const candidateRootCauses = sortRelations(candidateRootCauseRelations(relations));
  if (acceptedRootCauses.some((relation) => relation.derivation === "MODEL_INFERRED")) {
    throw new DiagnosisContractError(
      "model_inferred_not_candidate",
      "MODEL_INFERRED can only appear in candidate root causes",
      "acceptedRootCauses",
    );
  }

  const cases = sortCases(diagnosis.cases).map(toCaseSummary);
  const findings = sortFindings(diagnosis.findings).map(toReportFinding);
  const evidenceRefs = sortEvidenceRefs(diagnosis.evidenceRefs);
  const targets = sortTargets(diagnosis.cases.flatMap((item) => item.targets).map(toReportTarget));
  const missingEvidence = sortMissing(diagnosis.missingEvidence);
  const completion = deriveReportCompletion(
    cases.map((item) => item.completion),
    missingEvidence,
  );
  if (completion === "INCONCLUSIVE" && missingEvidence.length === 0) {
    throw new DiagnosisContractError(
      "missing_evidence_required",
      "INCONCLUSIVE report must retain missingEvidence",
      "missingEvidence",
    );
  }

  const fingerprint = contentFingerprint([
    tenantId ?? "",
    ...cases.map((item) => item.caseId),
    ...findings.map((item) => item.findingId),
    ...evidenceRefs.map((item) => item.evidenceId),
    ...relations.map((item) => item.relationId),
  ]);
  return {
    schemaVersion: COMPOSITE_DIAGNOSIS_REPORT_SCHEMA_VERSION,
    reportId: `cdr-${fingerprint}-${generatedAt}`,
    generatedAt,
    tenantId,
    cases,
    targets,
    findings,
    evidenceRefs,
    graphEdges,
    acceptedRootCauses,
    candidateRootCauses,
    impactScope: [...new Set(diagnosis.impactScope)].toSorted(),
    completion,
    missingEvidence,
    confidence: summarizeConfidence(findings, acceptedRootCauses, candidateRootCauses),
  };
}

export function serializeCompositeDiagnosisReport(report: CompositeDiagnosisReport): string {
  return JSON.stringify(sortJson(report));
}

function assertSingleReportTenant(
  diagnosis: CompositeDiagnosis,
  trusted: TrustedTenantContext,
): string | null {
  const tenants = new Set<string | null>();
  for (const item of diagnosis.cases) {
    tenants.add(item.tenantId);
    for (const target of item.targets) {
      tenants.add(target.tenantId);
    }
    for (const finding of item.findings) {
      tenants.add(finding.target.tenantId);
    }
    for (const ref of item.evidenceRefs) {
      tenants.add(ref.tenantId);
    }
  }
  for (const finding of diagnosis.findings) {
    tenants.add(finding.target.tenantId);
  }
  for (const ref of diagnosis.evidenceRefs) {
    tenants.add(ref.tenantId);
  }
  if (tenants.size > 1) {
    throw new DiagnosisContractError(
      "report_tenant_mismatch",
      "Composite Diagnosis Report allows exactly one tenant; cross-tenant reports are not implemented",
      "tenantId",
    );
  }
  const [tenantId = trusted.tenantId] = tenants;
  if (tenantId !== trusted.tenantId) {
    throw new DiagnosisContractError(
      "tenant_mismatch",
      "report tenantId must match trusted tenant context",
      "tenantId",
    );
  }
  return tenantId;
}

function assertP0Support(
  findings: readonly DiagnosticFinding[],
  support: FindingP0Support | undefined,
): void {
  const p0 = findings.filter((finding) => finding.severity === "P0");
  if (p0.length === 0) {
    return;
  }
  if (support?.relations === undefined || support.attributions === undefined) {
    throw new DiagnosisContractError(
      "p0_support_required",
      "P0 Finding validation requires explicit relations and attributions context",
      "p0Support",
    );
  }
  for (const finding of p0) {
    assertFindingNotModelOnlyP0({
      finding,
      relations: support.relations,
      attributions: support.attributions,
    });
  }
}

function toCaseSummary(item: AggregatedCase): ReportCaseSummary {
  return {
    caseId: item.caseId,
    mergeKey: item.mergeKey,
    tenantId: item.tenantId,
    sessionKeyHash: item.sessionKeyHash,
    completion: item.completion,
    status: item.status,
    findingIds: item.findings.map((finding) => finding.findingId).toSorted(),
    evidenceRefIds: item.evidenceRefs.map((ref) => ref.evidenceId).toSorted(),
    relationIds: item.relations.map((relation) => relation.relationId).toSorted(),
  };
}

function toReportFinding(finding: DiagnosticFinding): ReportFinding {
  return {
    findingId: finding.findingId,
    code: finding.code,
    title: finding.title,
    severity: finding.severity,
    status: finding.status,
    ...(finding.completion ? { completion: finding.completion } : {}),
    fingerprint: finding.fingerprint,
    targetType: finding.target.targetType,
    targetId: finding.target.targetId,
    tenantId: finding.target.tenantId,
    evidenceIds: [...finding.evidenceIds].toSorted(),
    confidence: { ...finding.confidence },
  };
}

function toReportTarget(target: DiagnosticTarget): ReportTarget {
  return {
    targetType: target.targetType,
    targetId: target.targetId,
    tenantId: target.tenantId,
    authority: target.authority,
    sessionKeyHash: target.scope.sessionKeyHash ?? null,
  };
}

function deriveReportCompletion(
  completions: readonly DiagnosisCompletion[],
  missing: readonly EvidenceRequirement[],
): DiagnosisCompletion {
  if (missing.some((req) => req.source === "route_resolution")) {
    return "INCONCLUSIVE";
  }
  if (completions.includes("BLOCKED")) {
    return "BLOCKED";
  }
  if (completions.includes("INCONCLUSIVE")) {
    return "INCONCLUSIVE";
  }
  if (completions.length > 0 && completions.every((item) => item === "CONFIRMED")) {
    return "CONFIRMED";
  }
  if (completions.includes("PROBABLE") || completions.includes("CONFIRMED")) {
    return "PROBABLE";
  }
  if (missing.length > 0) {
    return "INCONCLUSIVE";
  }
  return "PROBABLE";
}

function summarizeConfidence(
  findings: readonly ReportFinding[],
  accepted: readonly DiagnosisRelation[],
  candidates: readonly DiagnosisRelation[],
): ReportConfidenceSummary {
  return {
    findingCount: findings.length,
    meanEvidence: mean(findings.map((item) => item.confidence.evidence)),
    meanAssessment: mean(findings.map((item) => item.confidence.assessment)),
    meanRootCause: mean(findings.map((item) => item.confidence.rootCause)),
    meanImpact: mean(findings.map((item) => item.confidence.impact)),
    acceptedCauseCount: accepted.length,
    candidateCauseCount: candidates.length,
  };
}

function mean(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function contentFingerprint(parts: readonly string[]): string {
  return createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 16);
}

function sortCases(cases: readonly AggregatedCase[]): AggregatedCase[] {
  return [...cases].toSorted((left, right) =>
    comparePair(left.mergeKey, right.mergeKey, left.caseId, right.caseId),
  );
}

function sortFindings(findings: readonly DiagnosticFinding[]): DiagnosticFinding[] {
  return [...findings].toSorted((left, right) => left.findingId.localeCompare(right.findingId));
}

function sortEvidenceRefs(refs: readonly EvidenceRef[]): EvidenceRef[] {
  return [...refs].toSorted((left, right) => left.evidenceId.localeCompare(right.evidenceId));
}

function sortRelations(relations: readonly DiagnosisRelation[]): DiagnosisRelation[] {
  return [...relations].toSorted((left, right) => left.relationId.localeCompare(right.relationId));
}

function sortTargets(targets: readonly ReportTarget[]): ReportTarget[] {
  const seen = new Map<string, ReportTarget>();
  for (const target of targets) {
    seen.set(
      `${target.targetType}:${target.targetId}:${target.authority}:${target.tenantId ?? ""}`,
      target,
    );
  }
  return [...seen.values()].toSorted((left, right) =>
    comparePair(
      `${left.targetType}:${left.targetId}`,
      `${right.targetType}:${right.targetId}`,
      left.authority,
      right.authority,
    ),
  );
}

function sortMissing(missing: readonly EvidenceRequirement[]): EvidenceRequirement[] {
  return [...missing].toSorted((left, right) =>
    `${left.source}|${left.targetType}|${left.fields.join(",")}`.localeCompare(
      `${right.source}|${right.targetType}|${right.fields.join(",")}`,
    ),
  );
}

function comparePair(a1: string, b1: string, a2: string, b2: string): number {
  return a1.localeCompare(b1) || a2.localeCompare(b2);
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).toSorted()) {
      const item = record[key];
      if (item !== undefined) {
        out[key] = sortJson(item);
      }
    }
    return out;
  }
  return value;
}
