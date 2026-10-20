/**
 * Phase 2 increment 4.4 — Cross-target Case Aggregator.
 * Groups Finding/Evidence/Relation refs by tenantId + sessionKeyHash + mergeKey.
 * Stores references only. Does not copy runtime facts, write stores, or repair.
 */
import {
  acceptedRootCauseRelations,
  assertGraphRelation,
  assertNoParallelRca,
  buildDiagnosisGraph,
  type DiagnosisGraph,
} from "./graph.js";
import {
  assertSingleOpenPrimaryFinding,
  computeMergeKey,
  hasScene4MergePredicates,
  mergeCaseRefs,
} from "./merge.js";
import {
  DiagnosisContractError,
  type DiagnosisCompletion,
  type DiagnosisRelation,
  type DiagnosticCase,
  type DiagnosticEvidence,
  type DiagnosticFinding,
  type DiagnosticTarget,
  type DiagnosticTargetType,
  type EvidenceRequirement,
  type EvidenceSourceId,
} from "./types.js";

export const SESSIONLESS_TARGET_TYPES = ["gateway", "host"] as const;

export type SessionlessTargetType = (typeof SESSIONLESS_TARGET_TYPES)[number];

export type EvidenceRef = {
  evidenceId: string;
  source: EvidenceSourceId;
  authority: string;
  authorityRecordId: string;
  targetType: DiagnosticTargetType;
  targetId: string;
  observedAt: string;
  tenantId: string | null;
  /** Session-scoped refs must carry the hash; only gateway/host may set null. */
  sessionKeyHash: string | null;
};

export type CrossTargetSlice = {
  runId: string;
  tenantId: string | null;
  sessionKeyHash: string;
  targets: readonly DiagnosticTarget[];
  findings?: readonly DiagnosticFinding[];
  evidences?: readonly DiagnosticEvidence[];
  evidenceRefs?: readonly EvidenceRef[];
  relations?: readonly DiagnosisRelation[];
  missingEvidence?: readonly EvidenceRequirement[];
  completion?: DiagnosisCompletion;
};

export type AggregatedCase = {
  caseId: string;
  mergeKey: string;
  tenantId: string | null;
  sessionKeyHash: string;
  completion: DiagnosisCompletion;
  status: DiagnosticCase["status"];
  targets: DiagnosticTarget[];
  findings: DiagnosticFinding[];
  evidenceRefs: EvidenceRef[];
  relations: DiagnosisRelation[];
  missingEvidence: EvidenceRequirement[];
  diagnosticRunIds: string[];
  rootCauseCandidates: DiagnosisRelation[];
  impactScope: DiagnosticTargetType[];
};

export type CompositeDiagnosis = {
  cases: AggregatedCase[];
  graph: DiagnosisGraph;
  findings: DiagnosticFinding[];
  evidenceRefs: EvidenceRef[];
  relations: DiagnosisRelation[];
  rootCauseCandidates: DiagnosisRelation[];
  impactScope: DiagnosticTargetType[];
  missingEvidence: EvidenceRequirement[];
};

export function isSessionlessTargetType(type: DiagnosticTargetType): type is SessionlessTargetType {
  return (SESSIONLESS_TARGET_TYPES as readonly string[]).includes(type);
}

export function toEvidenceRef(evidence: DiagnosticEvidence): EvidenceRef {
  return {
    evidenceId: evidence.evidenceId,
    source: evidence.source,
    authority: evidence.authority,
    authorityRecordId: evidence.authorityRecordId,
    targetType: evidence.target.targetType,
    targetId: evidence.target.targetId,
    observedAt: evidence.observedAt,
    tenantId: evidence.target.tenantId,
    sessionKeyHash: evidence.target.scope.sessionKeyHash ?? null,
  };
}

export function aggregateCrossTargetCases(slices: readonly CrossTargetSlice[]): CompositeDiagnosis {
  if (slices.length === 0) {
    return emptyComposite();
  }
  const buckets = new Map<string, Bucket>();
  const sessionAttachments: SessionAttachment[] = [];

  for (const slice of slices) {
    if (!slice.sessionKeyHash) {
      throw new DiagnosisContractError(
        "session_key_required",
        "cross-target aggregation requires sessionKeyHash",
        "sessionKeyHash",
      );
    }
    assertSliceIdentity(slice);
    const refs = collectEvidenceRefs(slice);
    const relations = (slice.relations ?? []).map((relation) => assertGraphRelation(relation));
    const findings = slice.findings ?? [];
    if (findings.length === 0) {
      sessionAttachments.push({
        tenantId: slice.tenantId,
        sessionKeyHash: slice.sessionKeyHash,
        runId: slice.runId,
        targets: [...slice.targets],
        evidenceRefs: refs,
        relations,
        missingEvidence: [...(slice.missingEvidence ?? [])],
        completion: slice.completion,
      });
      continue;
    }
    for (const finding of findings) {
      const mergeKey = computeMergeKey({
        tenantId: slice.tenantId,
        sessionKeyHash: slice.sessionKeyHash,
        fingerprint: finding.fingerprint,
      });
      const bucket = buckets.get(mergeKey) ?? emptyBucket(mergeKey, slice);
      bucket.findings.push(finding);
      bucket.targets.push(...slice.targets);
      bucket.evidenceRefs.push(...refs);
      bucket.relations.push(...relations);
      bucket.missingEvidence.push(...(slice.missingEvidence ?? []));
      bucket.diagnosticRunIds.push(slice.runId);
      if (slice.completion) {
        bucket.completions.push(slice.completion);
      }
      if (finding.completion) {
        bucket.completions.push(finding.completion);
      }
      if (finding.missingEvidence) {
        bucket.missingEvidence.push(...finding.missingEvidence);
      }
      buckets.set(mergeKey, bucket);
    }
  }

  attachSessionEvidence(buckets, sessionAttachments);

  const cases = [...buckets.values()].map((bucket) => finalizeBucket(bucket));
  const findings = cases.flatMap((item) => item.findings);
  const evidenceRefs = uniqueRefs(cases.flatMap((item) => item.evidenceRefs));
  const relations = uniqueRelations(cases.flatMap((item) => item.relations));
  const graph = buildDiagnosisGraph({
    findings,
    evidenceIds: evidenceRefs.map((ref) => ref.evidenceId),
    relations,
  });
  return {
    cases,
    graph,
    findings,
    evidenceRefs,
    relations,
    rootCauseCandidates: [
      ...acceptedRootCauseRelations(relations),
      ...relations.filter(
        (relation) => relation.relation === "causes" && relation.state === "candidate",
      ),
    ],
    impactScope: uniqueTargetTypes(cases.flatMap((item) => item.impactScope)),
    missingEvidence: uniqueMissing(cases.flatMap((item) => item.missingEvidence)),
  };
}

type Bucket = {
  mergeKey: string;
  tenantId: string | null;
  sessionKeyHash: string;
  findings: DiagnosticFinding[];
  targets: DiagnosticTarget[];
  evidenceRefs: EvidenceRef[];
  relations: DiagnosisRelation[];
  missingEvidence: EvidenceRequirement[];
  diagnosticRunIds: string[];
  completions: DiagnosisCompletion[];
};

type SessionAttachment = {
  tenantId: string | null;
  sessionKeyHash: string;
  runId: string;
  targets: DiagnosticTarget[];
  evidenceRefs: EvidenceRef[];
  relations: DiagnosisRelation[];
  missingEvidence: EvidenceRequirement[];
  completion?: DiagnosisCompletion;
};

function assertSliceIdentity(slice: CrossTargetSlice): void {
  for (const item of slice.targets) {
    if (item.tenantId !== slice.tenantId) {
      throw new DiagnosisContractError(
        "tenant_mismatch",
        "target.tenantId must match slice.tenantId",
        "targets.tenantId",
      );
    }
    if (item.targetType === "session") {
      assertDeclaredSessionKey(item, slice.sessionKeyHash, "targets.scope.sessionKeyHash");
    }
  }
  for (const item of slice.findings ?? []) {
    if (item.target.tenantId !== slice.tenantId) {
      throw new DiagnosisContractError(
        "finding_tenant_mismatch",
        "finding.target.tenantId must match slice.tenantId",
        "findings.target.tenantId",
      );
    }
    assertDeclaredSessionKey(
      item.target,
      slice.sessionKeyHash,
      "findings.target.scope.sessionKeyHash",
    );
  }
  for (const item of slice.evidences ?? []) {
    if (item.target.tenantId !== slice.tenantId) {
      throw new DiagnosisContractError(
        "evidence_tenant_mismatch",
        "evidence.target.tenantId must match slice.tenantId",
        "evidences.target.tenantId",
      );
    }
    assertDeclaredSessionKey(
      item.target,
      slice.sessionKeyHash,
      "evidences.target.scope.sessionKeyHash",
    );
  }
  for (const ref of slice.evidenceRefs ?? []) {
    assertEvidenceRefIdentity(ref, slice);
  }
}

function assertEvidenceRefIdentity(ref: EvidenceRef, slice: CrossTargetSlice): void {
  if (!Object.hasOwn(ref, "tenantId") || ref.tenantId === undefined) {
    throw new DiagnosisContractError(
      "evidence_ref_identity_required",
      "evidenceRef.tenantId is required and must not be implicit",
      "evidenceRefs.tenantId",
    );
  }
  if (!Object.hasOwn(ref, "sessionKeyHash")) {
    throw new DiagnosisContractError(
      "evidence_ref_identity_required",
      "evidenceRef.sessionKeyHash must be explicit (hash or null)",
      "evidenceRefs.sessionKeyHash",
    );
  }
  if (ref.tenantId !== slice.tenantId) {
    throw new DiagnosisContractError(
      "evidence_ref_tenant_mismatch",
      "evidenceRef.tenantId must match slice.tenantId",
      "evidenceRefs.tenantId",
    );
  }
  if (ref.sessionKeyHash == null) {
    if (!isSessionlessTargetType(ref.targetType)) {
      throw new DiagnosisContractError(
        "evidence_ref_session_identity_required",
        "only gateway/host evidenceRef may use sessionKeyHash null",
        "evidenceRefs.sessionKeyHash",
      );
    }
    return;
  }
  if (ref.sessionKeyHash !== slice.sessionKeyHash) {
    throw new DiagnosisContractError(
      "evidence_ref_session_mismatch",
      "evidenceRef.sessionKeyHash must match slice.sessionKeyHash when present",
      "evidenceRefs.sessionKeyHash",
    );
  }
}

function assertDeclaredSessionKey(
  item: Pick<DiagnosticTarget, "targetType" | "scope">,
  expected: string,
  path: string,
): void {
  const actual = item.scope.sessionKeyHash;
  if (item.targetType !== "session" && actual === undefined) {
    return;
  }
  if (actual !== expected) {
    throw new DiagnosisContractError(
      "session_key_mismatch",
      "sessionKeyHash must match slice.sessionKeyHash",
      path,
    );
  }
}

function emptyComposite(): CompositeDiagnosis {
  return {
    cases: [],
    graph: { nodes: [], edges: [] },
    findings: [],
    evidenceRefs: [],
    relations: [],
    rootCauseCandidates: [],
    impactScope: [],
    missingEvidence: [],
  };
}

function emptyBucket(mergeKey: string, slice: CrossTargetSlice): Bucket {
  return {
    mergeKey,
    tenantId: slice.tenantId,
    sessionKeyHash: slice.sessionKeyHash,
    findings: [],
    targets: [],
    evidenceRefs: [],
    relations: [],
    missingEvidence: [],
    diagnosticRunIds: [],
    completions: [],
  };
}

function collectEvidenceRefs(slice: CrossTargetSlice): EvidenceRef[] {
  const fromEvidence = (slice.evidences ?? []).map(toEvidenceRef);
  return uniqueRefs([...(slice.evidenceRefs ?? []), ...fromEvidence]);
}

function attachSessionEvidence(
  buckets: Map<string, Bucket>,
  attachments: readonly SessionAttachment[],
): void {
  for (const attachment of attachments) {
    const matches = [...buckets.values()].filter(
      (bucket) =>
        bucket.tenantId === attachment.tenantId &&
        bucket.sessionKeyHash === attachment.sessionKeyHash,
    );
    const targets = matches.length > 0 ? matches : [ensureSatelliteBucket(buckets, attachment)];
    for (const bucket of targets) {
      bucket.targets.push(...attachment.targets);
      bucket.evidenceRefs.push(...attachment.evidenceRefs);
      bucket.relations.push(...attachment.relations);
      bucket.missingEvidence.push(...attachment.missingEvidence);
      bucket.diagnosticRunIds.push(attachment.runId);
      if (attachment.completion) {
        bucket.completions.push(attachment.completion);
      }
    }
  }
}

function ensureSatelliteBucket(
  buckets: Map<string, Bucket>,
  attachment: SessionAttachment,
): Bucket {
  const fingerprint = satelliteFingerprint(attachment);
  const mergeKey = computeMergeKey({
    tenantId: attachment.tenantId,
    sessionKeyHash: attachment.sessionKeyHash,
    fingerprint,
  });
  const existing = buckets.get(mergeKey);
  if (existing) {
    return existing;
  }
  const created: Bucket = {
    mergeKey,
    tenantId: attachment.tenantId,
    sessionKeyHash: attachment.sessionKeyHash,
    findings: [],
    targets: [],
    evidenceRefs: [],
    relations: [],
    missingEvidence: [],
    diagnosticRunIds: [],
    completions: [],
  };
  buckets.set(mergeKey, created);
  return created;
}

function satelliteFingerprint(attachment: SessionAttachment): string {
  const ref = attachment.evidenceRefs[0];
  if (!ref) {
    return "unscoped|empty|session:unknown";
  }
  return `unscoped|${ref.source}|${ref.targetType}:${ref.targetId}`;
}

function finalizeBucket(bucket: Bucket): AggregatedCase {
  const findings = uniqueFindings(bucket.findings);
  const relations = uniqueRelations(bucket.relations);
  assertNoParallelRca({ findings, relations });
  if (isScene4Case(findings, relations)) {
    assertSingleOpenPrimaryFinding(findings);
  }
  const missingEvidence = uniqueMissing(bucket.missingEvidence);
  const completion = deriveCaseCompletion(bucket.completions, missingEvidence);
  if (completion === "INCONCLUSIVE" && missingEvidence.length === 0) {
    throw new DiagnosisContractError(
      "missing_evidence_required",
      "INCONCLUSIVE Case must retain missingEvidence",
      "missingEvidence",
    );
  }
  const targets = uniqueTargets(bucket.targets);
  const protocolCase: DiagnosticCase = {
    schemaVersion: 1,
    caseId: `case-${hashKey(bucket.mergeKey)}`,
    tenantId: bucket.tenantId,
    status: "DIAGNOSING",
    targets,
    diagnosticRunIds: uniqueStrings(bucket.diagnosticRunIds),
    findingIds: findings.map((finding) => finding.findingId),
    relationIds: relations.map((relation) => relation.relationId),
    timeline: [],
  };
  mergeCaseRefs(protocolCase, protocolCase);
  return {
    caseId: protocolCase.caseId,
    mergeKey: bucket.mergeKey,
    tenantId: bucket.tenantId,
    sessionKeyHash: bucket.sessionKeyHash,
    completion,
    status: protocolCase.status,
    targets,
    findings,
    evidenceRefs: uniqueRefs(bucket.evidenceRefs),
    relations,
    missingEvidence,
    diagnosticRunIds: protocolCase.diagnosticRunIds,
    rootCauseCandidates: [
      ...acceptedRootCauseRelations(relations),
      ...relations.filter(
        (relation) => relation.relation === "causes" && relation.state === "candidate",
      ),
    ],
    impactScope: uniqueTargetTypes(targets.map((target) => target.targetType)),
  };
}

function isScene4Case(
  findings: readonly DiagnosticFinding[],
  relations: readonly DiagnosisRelation[],
): boolean {
  const predicates = [
    ...findings.map((finding) => finding.code),
    ...relations.flatMap((relation) => relation.ruleId ?? []),
  ];
  return (
    findings.some(
      (finding) =>
        finding.code.includes("tool_timeout") || finding.fingerprint.includes("|tool_timeout|"),
    ) || hasScene4MergePredicates(predicates)
  );
}

function deriveCaseCompletion(
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

function uniqueFindings(findings: readonly DiagnosticFinding[]): DiagnosticFinding[] {
  const seen = new Map<string, DiagnosticFinding>();
  for (const finding of findings) {
    seen.set(finding.findingId, finding);
  }
  return [...seen.values()];
}

function uniqueRelations(relations: readonly DiagnosisRelation[]): DiagnosisRelation[] {
  const seen = new Map<string, DiagnosisRelation>();
  for (const relation of relations) {
    seen.set(relation.relationId, relation);
  }
  return [...seen.values()];
}

function uniqueRefs(refs: readonly EvidenceRef[]): EvidenceRef[] {
  const seen = new Map<string, EvidenceRef>();
  for (const ref of refs) {
    seen.set(ref.evidenceId, ref);
  }
  return [...seen.values()];
}

function uniqueTargets(targets: readonly DiagnosticTarget[]): DiagnosticTarget[] {
  const seen = new Map<string, DiagnosticTarget>();
  for (const target of targets) {
    seen.set(`${target.targetType}:${target.targetId}:${target.authority}`, target);
  }
  return [...seen.values()];
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function uniqueTargetTypes(types: readonly DiagnosticTargetType[]): DiagnosticTargetType[] {
  return [...new Set(types)];
}

function uniqueMissing(missing: readonly EvidenceRequirement[]): EvidenceRequirement[] {
  const seen = new Map<string, EvidenceRequirement>();
  for (const req of missing) {
    seen.set(`${req.source}|${req.targetType}|${req.fields.join(",")}`, req);
  }
  return [...seen.values()];
}

function hashKey(mergeKey: string): string {
  return mergeKey.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "");
}
