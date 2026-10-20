/**
 * Phase 10 — read-only diagnosis visualization projections.
 * Consumes existing Diagnosis objects / in-process refs only.
 * Does not create a second Signal, Case, Finding, health, or audit store.
 * Does not call live chat, RPC, Doctor, Channel, or remediation executor.
 * Does not write the message main chain. appliedToRuntime stays out of scope.
 */
import {
  AUTHORIZATION_GRANT_STATUSES,
  type AuthorizationGrantStatus,
} from "./authorization-grant-status.js";
import {
  PRODUCTION_REDACTION_PROFILES,
  type ProductionRedactionProfile,
} from "./report-query-redaction.js";
import { FORBIDDEN_REPORT_PAYLOAD_KEYS } from "./report-validate.js";
import { DIAGNOSTIC_SIGNAL_STATUSES } from "./signal.js";
import type { DiagnosticSignalStatus } from "./signal.js";
import {
  DIAGNOSIS_COMPLETIONS,
  DiagnosisContractError,
  validateDiagnosticPrincipal,
  type DiagnosisCompletion,
  type DiagnosticPrincipal,
  type TrustedTenantContext,
} from "./types.js";

export const DIAGNOSIS_VISUALIZATION_SCHEMA_VERSION = 1 as const;

export const DIAGNOSIS_VIEW_ROLES = ["platform", "enterprise", "employee"] as const;
export type DiagnosisViewRole = (typeof DIAGNOSIS_VIEW_ROLES)[number];

export const DIAGNOSIS_PERMISSION_STATES = [
  "allowed",
  "redacted",
  "hidden",
  "forbidden",
  "expired",
  "unavailable",
  "empty",
] as const;
export type DiagnosisPermissionState = (typeof DIAGNOSIS_PERMISSION_STATES)[number];

export const DIAGNOSIS_HEALTH_TONES = [
  "ok",
  "watch",
  "degraded",
  "inconclusive",
  "empty",
  "error",
  "expired",
] as const;
export type DiagnosisHealthTone = (typeof DIAGNOSIS_HEALTH_TONES)[number];

export const DIAGNOSIS_TIMELINE_KINDS = [
  "signal",
  "evidence_ref",
  "finding",
  "case",
  "mission",
  "grant",
  "proposal",
  "remediation",
  "verification",
] as const;
export type DiagnosisTimelineKind = (typeof DIAGNOSIS_TIMELINE_KINDS)[number];

export const HIDDEN_GRANT_STATUSES = [
  "EXPIRED",
  "REVOKED",
  "SUSPENDED",
  "CONSUMED",
  "DENIED",
] as const;

export const LIVE_GRANT_STATUSES = ["APPROVED"] as const;

const DEFAULT_TREND_BUCKET_MS = 60 * 60 * 1000;

export type DiagnosisTargetRef = {
  targetType: string;
  targetId: string;
  tenantId: string | null;
  agentId?: string;
  skillId?: string;
  toolId?: string;
};

export type VisualizationSignalRef = {
  signalId: string;
  tenantId: string | null;
  status: DiagnosticSignalStatus;
  target: DiagnosisTargetRef;
  evidenceIds: string[];
  findingIds: string[];
  caseId?: string;
  completion: DiagnosisCompletion;
  observedAt: string;
  lastSeenAt: string;
  expiresAt: string;
  targetPrincipal?: string;
};

export type VisualizationCaseRef = {
  caseId: string;
  tenantId: string | null;
  status: string;
  findingIds: string[];
  signalId?: string;
  observedAt: string;
  target?: DiagnosisTargetRef;
  targetPrincipal?: string;
  severity?: "P0" | "P1" | "P2" | "P3" | "P4";
};

export type VisualizationFindingRef = {
  findingId: string;
  tenantId: string | null;
  title?: string;
  status: string;
  severity: "P0" | "P1" | "P2" | "P3" | "P4";
  evidenceIds: string[];
  caseId?: string;
  observedAt: string;
  targetPrincipal?: string;
};

export type VisualizationEvidenceRef = {
  evidenceId: string;
  tenantId: string | null;
  observedAt: string;
  targetPrincipal?: string;
};

export type VisualizationMissionRef = {
  missionId: string;
  status: AuthorizationGrantStatus;
  targetTenant: string | null;
  grantId: string;
  parentCaseId?: string;
  targetPrincipal?: string;
  observedAt: string;
};

export type VisualizationGrantRef = {
  grantId: string;
  kind?: string;
  status: AuthorizationGrantStatus;
  targetTenant: string | null;
  targetPrincipal?: string;
  dataScope: string[];
  actions: string[];
  expiresAt: string;
  risk?: string;
  missionId?: string;
  observedAt: string;
  approverRole?: DiagnosisViewRole;
  evidenceIds?: string[];
};

export type VisualizationProposalRef = {
  proposalId: string;
  status: string;
  tenantScope: string | null;
  grantId: string;
  sourceCaseId?: string;
  observedAt: string;
};

export type VisualizationRemediationRef = {
  remediationId: string;
  status: string;
  targetTenant: string | null;
  sourceProposalId?: string;
  grantId?: string;
  observedAt: string;
};

export type VisualizationVerificationRef = {
  verificationId: string;
  verdict: string;
  remediationId: string;
  observedAt: string;
  missingEvidence?: boolean;
};

export type DiagnosisVisualizationCatalog = {
  signals?: readonly VisualizationSignalRef[];
  cases?: readonly VisualizationCaseRef[];
  findings?: readonly VisualizationFindingRef[];
  evidenceRefs?: readonly VisualizationEvidenceRef[];
  missions?: readonly VisualizationMissionRef[];
  grants?: readonly VisualizationGrantRef[];
  shareGrants?: readonly VisualizationGrantRef[];
  proposals?: readonly VisualizationProposalRef[];
  remediations?: readonly VisualizationRemediationRef[];
  verifications?: readonly VisualizationVerificationRef[];
  graphEdges?: readonly { fromId: string; toId: string; relation: string }[];
  now?: number;
  loadError?: string;
  trendWindow?: { from: string; to: string; bucketMs?: number };
};

export type DiagnosisVisualizationAudience = {
  role: DiagnosisViewRole;
  trusted: TrustedTenantContext;
  principal: DiagnosticPrincipal;
  redactionProfile: ProductionRedactionProfile;
  claimedTenantId?: string | null;
  authorizedEmployeeIds?: readonly string[];
  sessionTenantId?: never;
};

export type DiagnosisTimelineEvent = {
  eventId: string;
  kind: DiagnosisTimelineKind;
  timestamp: string;
  tenantId: string | null;
  ref: { id: string; type: DiagnosisTimelineKind };
  parentRefs: Array<{ id: string; type: DiagnosisTimelineKind }>;
  status?: string;
  permissionState: DiagnosisPermissionState;
};

export type DiagnosisTimelineProjection = {
  schemaVersion: 1;
  tenantScope: string | null;
  redactionProfile: ProductionRedactionProfile;
  permissionState: DiagnosisPermissionState;
  events: DiagnosisTimelineEvent[];
};

export type DiagnosisTrendBucket = {
  at: string;
  sampleCount: number;
  present: boolean;
};

export type DiagnosisTrendProjection = {
  schemaVersion: 1;
  tenantScope: string | null;
  redactionProfile: ProductionRedactionProfile;
  permissionState: DiagnosisPermissionState;
  window: { from: string; to: string };
  sampleRange: { from: string; to: string } | null;
  completeness: "complete" | "partial" | "empty" | "unavailable";
  buckets: DiagnosisTrendBucket[];
  missingBuckets: string[];
};

export type DiagnosisGraphNodeProjection = {
  id: string;
  kind: DiagnosisTimelineKind | "enterprise" | "agent" | "skill" | "tool";
  tenantId: string | null;
  label: string;
  permissionState: DiagnosisPermissionState;
};

export type DiagnosisGraphProjection = {
  schemaVersion: 1;
  tenantScope: string | null;
  redactionProfile: ProductionRedactionProfile;
  permissionState: DiagnosisPermissionState;
  nodes: DiagnosisGraphNodeProjection[];
  edges: Array<{ fromId: string; toId: string; relation: string }>;
};

export type DiagnosisAuthorizationRow = {
  grantId: string;
  status: AuthorizationGrantStatus;
  targetTenant: string | null;
  targetPrincipal?: string;
  dataScope: string[];
  actions: string[];
  expiresAt: string;
  risk?: string;
  missionId?: string;
  permissionState: DiagnosisPermissionState;
};

export type DiagnosisAuthorizationProjection = {
  schemaVersion: 1;
  tenantScope: string | null;
  redactionProfile: ProductionRedactionProfile;
  permissionState: DiagnosisPermissionState;
  rows: DiagnosisAuthorizationRow[];
  pendingApprovals: DiagnosisAuthorizationRow[];
};

export type DiagnosisRemediationRow = {
  remediationId: string;
  status: string;
  verdict?: string;
  sourceProposalId?: string;
  grantId?: string;
  permissionState: DiagnosisPermissionState;
};

export type DiagnosisRemediationProjection = {
  schemaVersion: 1;
  tenantScope: string | null;
  redactionProfile: ProductionRedactionProfile;
  permissionState: DiagnosisPermissionState;
  rows: DiagnosisRemediationRow[];
};

export type DiagnosisConversationEntry = {
  signalId?: string;
  caseId?: string;
  targetRef?: DiagnosisTargetRef;
  tenantId: string | null;
};

export type DiagnosisAuthorizationDecisionRefresh = {
  grantId: string;
  decision: "approve" | "deny";
  refresh: "p6_p7";
};

export type DiagnosisCaseRow = {
  caseId: string;
  severity: "P0" | "P1" | "P2" | "P3" | "P4" | null;
  status: string;
  tenantId: string | null;
};

export type DiagnosisDrilldownRow = {
  layer: "enterprise" | "agent" | "skill" | "tool";
  id: string;
  status: string;
  tenantId: string | null;
};

export type DiagnosisVisualizationBundle = {
  schemaVersion: 1;
  role: DiagnosisViewRole;
  tenantScope: string | null;
  redactionProfile: ProductionRedactionProfile;
  permissionState: DiagnosisPermissionState;
  health: {
    tone: DiagnosisHealthTone;
    label: string;
    openP0: number;
    openP1: number;
    inconclusive: number;
    expired: number;
  };
  cases: DiagnosisCaseRow[];
  drilldown: DiagnosisDrilldownRow[];
  timeline: DiagnosisTimelineProjection;
  trend: DiagnosisTrendProjection;
  graph: DiagnosisGraphProjection;
  authorizations: DiagnosisAuthorizationProjection;
  remediations: DiagnosisRemediationProjection;
  conversationEntries: DiagnosisConversationEntry[];
  reportExport: {
    action: "export_existing_report";
    exporter: "exportCompositeDiagnosisReportJson";
    reportId?: string;
  };
  loadError?: string;
};

type VisibleScope = {
  role: DiagnosisViewRole;
  trusted: TrustedTenantContext;
  principal: DiagnosticPrincipal;
  redactionProfile: ProductionRedactionProfile;
  authorizedEmployees: ReadonlySet<string>;
  liveGrantIds: ReadonlySet<string>;
  sharedEvidenceIds: ReadonlySet<string>;
};

function fail(code: string, message: string, path = ""): never {
  throw new DiagnosisContractError(code, message, path);
}

function isHiddenGrantStatus(status: string): boolean {
  return (HIDDEN_GRANT_STATUSES as readonly string[]).includes(status);
}

function isLiveGrantStatus(status: string): boolean {
  return (LIVE_GRANT_STATUSES as readonly string[]).includes(status);
}

function assertAudience(audience: DiagnosisVisualizationAudience): void {
  if (!DIAGNOSIS_VIEW_ROLES.includes(audience.role)) {
    fail("role_mismatch", "unknown visualization role", "role");
  }
  if (!PRODUCTION_REDACTION_PROFILES.includes(audience.redactionProfile)) {
    fail("redaction_profile_invalid", "unknown redaction profile", "redactionProfile");
  }
  if (Object.hasOwn(audience, "sessionTenantId")) {
    fail("session_tenant_untrusted", "sessionTenantId is never authoritative", "sessionTenantId");
  }
  validateDiagnosticPrincipal(audience.principal, audience.trusted, "principal");
  if (
    audience.claimedTenantId !== undefined &&
    audience.claimedTenantId !== audience.trusted.tenantId
  ) {
    fail("tenant_mismatch", "claimed tenant must match trusted tenant", "claimedTenantId");
  }
  if (audience.role === "platform") {
    if (audience.trusted.tenantId !== null || audience.principal.tenantId !== null) {
      fail("role_mismatch", "platform view requires platform trusted tenant", "role");
    }
  } else if (audience.trusted.tenantId === null || audience.principal.tenantId === null) {
    fail("role_mismatch", "enterprise/employee view requires a tenant", "role");
  }
}

function tenantAllowed(scope: VisibleScope, tenantId: string | null): boolean {
  if (scope.role === "platform") {
    return true;
  }
  return tenantId === scope.trusted.tenantId;
}

function employeeAllowed(scope: VisibleScope, targetPrincipal: string | undefined): boolean {
  if (!targetPrincipal) {
    return true;
  }
  if (scope.role === "employee") {
    return targetPrincipal === scope.principal.principalId;
  }
  if (scope.role === "enterprise") {
    return (
      targetPrincipal === scope.principal.principalId ||
      scope.authorizedEmployees.has(targetPrincipal)
    );
  }
  return true;
}

function canShowEvidenceId(
  scope: VisibleScope,
  evidenceId: string,
  tenantId: string | null,
): boolean {
  if (!tenantAllowed(scope, tenantId)) {
    return false;
  }
  if (scope.role === "platform") {
    return scope.sharedEvidenceIds.has(evidenceId);
  }
  return scope.sharedEvidenceIds.has(evidenceId) || scope.role === "employee";
}

function scopeMeta(
  audience: DiagnosisVisualizationAudience,
  permissionState: DiagnosisPermissionState,
): Pick<
  DiagnosisTimelineProjection,
  "schemaVersion" | "tenantScope" | "redactionProfile" | "permissionState"
> {
  return {
    schemaVersion: 1,
    tenantScope: audience.trusted.tenantId,
    redactionProfile: audience.redactionProfile,
    permissionState,
  };
}

function compareTimestamp(left: string, right: string): number {
  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);
  if (Number.isNaN(leftMs) || Number.isNaN(rightMs)) {
    return left < right ? -1 : left > right ? 1 : 0;
  }
  if (leftMs !== rightMs) {
    return leftMs - rightMs;
  }
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortEvents(events: DiagnosisTimelineEvent[]): DiagnosisTimelineEvent[] {
  return [...events].toSorted((left, right) => {
    const byTime = compareTimestamp(left.timestamp, right.timestamp);
    if (byTime !== 0) {
      return byTime;
    }
    const byKind =
      DIAGNOSIS_TIMELINE_KINDS.indexOf(left.kind) - DIAGNOSIS_TIMELINE_KINDS.indexOf(right.kind);
    if (byKind !== 0) {
      return byKind;
    }
    return left.eventId < right.eventId ? -1 : left.eventId > right.eventId ? 1 : 0;
  });
}

function emptyBundle(
  audience: DiagnosisVisualizationAudience,
  permissionState: DiagnosisPermissionState,
  health: DiagnosisVisualizationBundle["health"],
  loadError?: string,
): DiagnosisVisualizationBundle {
  const meta = scopeMeta(audience, permissionState);
  const window = { from: new Date(0).toISOString(), to: new Date(0).toISOString() };
  return {
    schemaVersion: 1,
    role: audience.role,
    tenantScope: audience.trusted.tenantId,
    redactionProfile: audience.redactionProfile,
    permissionState,
    health,
    cases: [],
    drilldown: [],
    timeline: { ...meta, events: [] },
    trend: {
      ...meta,
      window,
      sampleRange: null,
      completeness: loadError ? "unavailable" : "empty",
      buckets: [],
      missingBuckets: [],
    },
    graph: { ...meta, nodes: [], edges: [] },
    authorizations: { ...meta, rows: [], pendingApprovals: [] },
    remediations: { ...meta, rows: [] },
    conversationEntries: [],
    reportExport: {
      action: "export_existing_report",
      exporter: "exportCompositeDiagnosisReportJson",
    },
    ...(loadError ? { loadError } : {}),
  };
}

function buildScope(
  audience: DiagnosisVisualizationAudience,
  catalog: DiagnosisVisualizationCatalog,
): VisibleScope {
  const grants = [...(catalog.grants ?? []), ...(catalog.shareGrants ?? [])];
  const liveGrantIds = new Set(
    grants.filter((grant) => isLiveGrantStatus(grant.status)).map((grant) => grant.grantId),
  );
  const sharedEvidenceIds = new Set<string>();
  for (const grant of catalog.shareGrants ?? []) {
    if (!isLiveGrantStatus(grant.status)) {
      continue;
    }
    for (const evidenceId of grant.evidenceIds ?? []) {
      sharedEvidenceIds.add(evidenceId);
    }
  }
  const authorizedEmployees = new Set(audience.authorizedEmployeeIds ?? []);
  for (const grant of catalog.grants ?? []) {
    if (isLiveGrantStatus(grant.status) && grant.targetPrincipal) {
      authorizedEmployees.add(grant.targetPrincipal);
    }
  }
  return {
    role: audience.role,
    trusted: audience.trusted,
    principal: audience.principal,
    redactionProfile: audience.redactionProfile,
    authorizedEmployees,
    liveGrantIds,
    sharedEvidenceIds,
  };
}

function visibleSignals(
  catalog: DiagnosisVisualizationCatalog,
  scope: VisibleScope,
): VisualizationSignalRef[] {
  return (catalog.signals ?? []).filter(
    (signal) =>
      tenantAllowed(scope, signal.tenantId) && employeeAllowed(scope, signal.targetPrincipal),
  );
}

function visibleCases(
  catalog: DiagnosisVisualizationCatalog,
  scope: VisibleScope,
): VisualizationCaseRef[] {
  return (catalog.cases ?? []).filter(
    (item) => tenantAllowed(scope, item.tenantId) && employeeAllowed(scope, item.targetPrincipal),
  );
}

function visibleFindings(
  catalog: DiagnosisVisualizationCatalog,
  scope: VisibleScope,
): VisualizationFindingRef[] {
  return (catalog.findings ?? []).filter(
    (item) => tenantAllowed(scope, item.tenantId) && employeeAllowed(scope, item.targetPrincipal),
  );
}

function liveGrant(scope: VisibleScope, grantId: string | undefined): boolean {
  return Boolean(grantId && scope.liveGrantIds.has(grantId));
}

function buildTimeline(
  audience: DiagnosisVisualizationAudience,
  catalog: DiagnosisVisualizationCatalog,
  scope: VisibleScope,
  permissionState: DiagnosisPermissionState,
): DiagnosisTimelineProjection {
  const events: DiagnosisTimelineEvent[] = [];
  const add = (
    kind: DiagnosisTimelineKind,
    id: string,
    timestamp: string,
    tenantId: string | null,
    status: string | undefined,
    parentRefs: DiagnosisTimelineEvent["parentRefs"],
    state: DiagnosisPermissionState = "allowed",
  ) => {
    events.push({
      eventId: `${kind}:${id}`,
      kind,
      timestamp,
      tenantId: audience.role === "platform" ? tenantId : audience.trusted.tenantId,
      ref: { id, type: kind },
      parentRefs,
      status,
      permissionState: state,
    });
  };

  for (const signal of visibleSignals(catalog, scope)) {
    add("signal", signal.signalId, signal.observedAt, signal.tenantId, signal.status, []);
    if (audience.role !== "platform") {
      for (const evidenceId of signal.evidenceIds) {
        if (!canShowEvidenceId(scope, evidenceId, signal.tenantId)) {
          continue;
        }
        add("evidence_ref", evidenceId, signal.observedAt, signal.tenantId, undefined, [
          { id: signal.signalId, type: "signal" },
        ]);
      }
    }
  }

  for (const finding of visibleFindings(catalog, scope)) {
    add(
      "finding",
      finding.findingId,
      finding.observedAt,
      finding.tenantId,
      finding.status,
      finding.evidenceIds
        .filter((evidenceId) => canShowEvidenceId(scope, evidenceId, finding.tenantId))
        .map((evidenceId) => ({ id: evidenceId, type: "evidence_ref" as const })),
    );
  }

  for (const item of visibleCases(catalog, scope)) {
    add("case", item.caseId, item.observedAt, item.tenantId, item.status, [
      ...(item.signalId ? [{ id: item.signalId, type: "signal" as const }] : []),
      ...item.findingIds.map((findingId) => ({ id: findingId, type: "finding" as const })),
    ]);
  }

  for (const grant of catalog.grants ?? []) {
    if (!tenantAllowed(scope, grant.targetTenant)) {
      continue;
    }
    if (isHiddenGrantStatus(grant.status)) {
      continue;
    }
    if (!employeeAllowed(scope, grant.targetPrincipal)) {
      continue;
    }
    add(
      "grant",
      grant.grantId,
      grant.observedAt,
      grant.targetTenant,
      grant.status,
      [],
      grant.status === "REQUESTED" ? "redacted" : "allowed",
    );
  }

  for (const mission of catalog.missions ?? []) {
    if (!tenantAllowed(scope, mission.targetTenant) || !liveGrant(scope, mission.grantId)) {
      continue;
    }
    if (!employeeAllowed(scope, mission.targetPrincipal)) {
      continue;
    }
    add("mission", mission.missionId, mission.observedAt, mission.targetTenant, mission.status, [
      ...(mission.parentCaseId ? [{ id: mission.parentCaseId, type: "case" as const }] : []),
      { id: mission.grantId, type: "grant" },
    ]);
  }

  for (const proposal of catalog.proposals ?? []) {
    if (!tenantAllowed(scope, proposal.tenantScope) || !liveGrant(scope, proposal.grantId)) {
      continue;
    }
    add(
      "proposal",
      proposal.proposalId,
      proposal.observedAt,
      proposal.tenantScope,
      proposal.status,
      [
        ...(proposal.sourceCaseId ? [{ id: proposal.sourceCaseId, type: "case" as const }] : []),
        { id: proposal.grantId, type: "grant" },
      ],
    );
  }

  for (const remediation of catalog.remediations ?? []) {
    if (!tenantAllowed(scope, remediation.targetTenant)) {
      continue;
    }
    if (remediation.grantId && !liveGrant(scope, remediation.grantId)) {
      continue;
    }
    add(
      "remediation",
      remediation.remediationId,
      remediation.observedAt,
      remediation.targetTenant,
      remediation.status,
      remediation.sourceProposalId
        ? [{ id: remediation.sourceProposalId, type: "proposal" as const }]
        : [],
    );
  }

  for (const verification of catalog.verifications ?? []) {
    const remediation = (catalog.remediations ?? []).find(
      (row) => row.remediationId === verification.remediationId,
    );
    if (!remediation || !tenantAllowed(scope, remediation.targetTenant)) {
      continue;
    }
    if (remediation.grantId && !liveGrant(scope, remediation.grantId)) {
      continue;
    }
    add(
      "verification",
      verification.verificationId,
      verification.observedAt,
      remediation.targetTenant,
      verification.verdict,
      [{ id: verification.remediationId, type: "remediation" }],
    );
  }

  return { ...scopeMeta(audience, permissionState), events: sortEvents(events) };
}

function buildTrend(
  audience: DiagnosisVisualizationAudience,
  catalog: DiagnosisVisualizationCatalog,
  signals: readonly VisualizationSignalRef[],
  permissionState: DiagnosisPermissionState,
): DiagnosisTrendProjection {
  const now = catalog.now ?? Date.parse("2026-09-03T04:00:00.000Z");
  const rawWindow = catalog.trendWindow ?? {
    from: new Date(now - 4 * DEFAULT_TREND_BUCKET_MS).toISOString(),
    to: new Date(now).toISOString(),
  };
  const window = { from: rawWindow.from, to: rawWindow.to };
  const bucketMs = rawWindow.bucketMs ?? DEFAULT_TREND_BUCKET_MS;
  const fromMs = Date.parse(window.from);
  const toMs = Date.parse(window.to);
  if (Number.isNaN(fromMs) || Number.isNaN(toMs) || toMs < fromMs) {
    return {
      ...scopeMeta(audience, permissionState),
      window,
      sampleRange: null,
      completeness: "unavailable",
      buckets: [],
      missingBuckets: [],
    };
  }

  const counts = new Map<string, number>();
  let sampleFrom: string | null = null;
  let sampleTo: string | null = null;
  for (const signal of signals) {
    const at = signal.lastSeenAt;
    const ms = Date.parse(at);
    if (Number.isNaN(ms) || ms < fromMs || ms > toMs) {
      continue;
    }
    const bucketStart = fromMs + Math.floor((ms - fromMs) / bucketMs) * bucketMs;
    const key = new Date(bucketStart).toISOString();
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (!sampleFrom || compareTimestamp(at, sampleFrom) < 0) {
      sampleFrom = at;
    }
    if (!sampleTo || compareTimestamp(at, sampleTo) > 0) {
      sampleTo = at;
    }
  }

  const buckets: DiagnosisTrendBucket[] = [];
  const missingBuckets: string[] = [];
  for (let cursor = fromMs; cursor < toMs; cursor += bucketMs) {
    const at = new Date(cursor).toISOString();
    const sampleCount = counts.get(at) ?? 0;
    const present = counts.has(at);
    buckets.push({ at, sampleCount, present });
    if (!present) {
      missingBuckets.push(at);
    }
  }

  const completeness =
    buckets.length === 0
      ? "empty"
      : missingBuckets.length === buckets.length
        ? "empty"
        : missingBuckets.length > 0
          ? "partial"
          : "complete";

  return {
    ...scopeMeta(audience, permissionState),
    window,
    sampleRange: sampleFrom && sampleTo ? { from: sampleFrom, to: sampleTo } : null,
    completeness,
    buckets,
    missingBuckets,
  };
}

function buildGraph(
  audience: DiagnosisVisualizationAudience,
  catalog: DiagnosisVisualizationCatalog,
  scope: VisibleScope,
  permissionState: DiagnosisPermissionState,
  timeline: DiagnosisTimelineProjection,
): DiagnosisGraphProjection {
  const allowedIds = new Set(timeline.events.map((event) => event.ref.id));
  const nodes: DiagnosisGraphNodeProjection[] = timeline.events.map((event) => ({
    id: event.ref.id,
    kind: event.kind,
    tenantId: event.tenantId,
    label: event.kind,
    permissionState: event.permissionState,
  }));

  for (const item of visibleCases(catalog, scope)) {
    const target = item.target;
    if (!target) {
      continue;
    }
    const layers: Array<{ layer: "enterprise" | "agent" | "skill" | "tool"; id?: string }> = [
      { layer: "enterprise", id: item.tenantId ?? undefined },
      { layer: "agent", id: target.agentId },
      { layer: "skill", id: target.skillId },
      { layer: "tool", id: target.toolId },
    ];
    for (const row of layers) {
      if (!row.id || allowedIds.has(row.id)) {
        continue;
      }
      allowedIds.add(row.id);
      nodes.push({
        id: row.id,
        kind: row.layer,
        tenantId: item.tenantId,
        label: row.layer,
        permissionState: "allowed",
      });
    }
  }

  const edges: DiagnosisGraphProjection["edges"] = [];
  for (const event of timeline.events) {
    for (const parent of event.parentRefs) {
      if (!allowedIds.has(parent.id) || !allowedIds.has(event.ref.id)) {
        continue;
      }
      edges.push({ fromId: parent.id, toId: event.ref.id, relation: "derived_from" });
    }
  }
  for (const edge of catalog.graphEdges ?? []) {
    if (!allowedIds.has(edge.fromId) || !allowedIds.has(edge.toId)) {
      continue;
    }
    edges.push({ fromId: edge.fromId, toId: edge.toId, relation: edge.relation });
  }

  return { ...scopeMeta(audience, permissionState), nodes, edges };
}

function buildAuthorizations(
  audience: DiagnosisVisualizationAudience,
  catalog: DiagnosisVisualizationCatalog,
  scope: VisibleScope,
  permissionState: DiagnosisPermissionState,
): DiagnosisAuthorizationProjection {
  const rows: DiagnosisAuthorizationRow[] = [];
  const pendingApprovals: DiagnosisAuthorizationRow[] = [];
  for (const grant of catalog.grants ?? []) {
    if (!tenantAllowed(scope, grant.targetTenant)) {
      continue;
    }
    if (isHiddenGrantStatus(grant.status)) {
      continue;
    }
    if (!employeeAllowed(scope, grant.targetPrincipal)) {
      continue;
    }
    const row: DiagnosisAuthorizationRow = {
      grantId: grant.grantId,
      status: grant.status,
      targetTenant: grant.targetTenant,
      ...(grant.targetPrincipal ? { targetPrincipal: grant.targetPrincipal } : {}),
      dataScope: grant.dataScope,
      actions: grant.actions,
      expiresAt: grant.expiresAt,
      ...(grant.risk ? { risk: grant.risk } : {}),
      ...(grant.missionId ? { missionId: grant.missionId } : {}),
      permissionState: grant.status === "REQUESTED" ? "redacted" : "allowed",
    };
    if (grant.status === "REQUESTED") {
      if (audience.role === "platform" && grant.approverRole === "platform") {
        pendingApprovals.push(row);
      }
      if (audience.role === "enterprise" && grant.approverRole === "enterprise") {
        pendingApprovals.push(row);
      }
    } else {
      rows.push(row);
    }
  }
  return { ...scopeMeta(audience, permissionState), rows, pendingApprovals };
}

function buildRemediations(
  audience: DiagnosisVisualizationAudience,
  catalog: DiagnosisVisualizationCatalog,
  scope: VisibleScope,
  permissionState: DiagnosisPermissionState,
): DiagnosisRemediationProjection {
  const rows: DiagnosisRemediationRow[] = [];
  for (const remediation of catalog.remediations ?? []) {
    if (!tenantAllowed(scope, remediation.targetTenant)) {
      continue;
    }
    if (remediation.grantId && !liveGrant(scope, remediation.grantId)) {
      continue;
    }
    const verification = (catalog.verifications ?? []).find(
      (row) => row.remediationId === remediation.remediationId,
    );
    rows.push({
      remediationId: remediation.remediationId,
      status: remediation.status,
      ...(verification ? { verdict: verification.verdict } : {}),
      ...(remediation.sourceProposalId ? { sourceProposalId: remediation.sourceProposalId } : {}),
      ...(remediation.grantId ? { grantId: remediation.grantId } : {}),
      permissionState: verification?.verdict === "inconclusive" ? "redacted" : "allowed",
    });
  }
  return { ...scopeMeta(audience, permissionState), rows };
}

function buildHealth(
  cases: readonly VisualizationCaseRef[],
  findings: readonly VisualizationFindingRef[],
  signals: readonly VisualizationSignalRef[],
  verifications: readonly VisualizationVerificationRef[],
): DiagnosisVisualizationBundle["health"] {
  const openFindings = findings.filter((finding) => finding.status !== "resolved");
  const openP0 = openFindings.filter((finding) => finding.severity === "P0").length;
  const openP1 = openFindings.filter((finding) => finding.severity === "P1").length;
  const inconclusive =
    signals.filter(
      (signal) => signal.status === "inconclusive" || signal.completion === "INCONCLUSIVE",
    ).length +
    verifications.filter((row) => row.verdict === "inconclusive" || row.missingEvidence).length;
  const expired = signals.filter((signal) => signal.status === "expired").length;
  if (inconclusive > 0) {
    return { tone: "inconclusive", label: "证据不足", openP0, openP1, inconclusive, expired };
  }
  if (expired > 0 && cases.length === 0 && openFindings.length === 0) {
    return { tone: "expired", label: "数据已过期", openP0, openP1, inconclusive, expired };
  }
  if (openP0 > 0) {
    return { tone: "degraded", label: "存在 P0", openP0, openP1, inconclusive, expired };
  }
  if (openP1 > 0) {
    return { tone: "watch", label: "存在 P1", openP0, openP1, inconclusive, expired };
  }
  if (signals.length === 0 && cases.length === 0 && findings.length === 0) {
    return { tone: "empty", label: "暂无数据", openP0, openP1, inconclusive, expired };
  }
  return { tone: "ok", label: "观察中", openP0, openP1, inconclusive, expired };
}

function buildDrilldown(
  cases: readonly VisualizationCaseRef[],
  signals: readonly VisualizationSignalRef[],
): DiagnosisDrilldownRow[] {
  const rows = new Map<string, DiagnosisDrilldownRow>();
  const remember = (row: DiagnosisDrilldownRow) => {
    rows.set(`${row.layer}:${row.id}`, row);
  };
  for (const item of [
    ...cases,
    ...signals.map((signal) => ({ ...signal, target: signal.target })),
  ]) {
    if (item.tenantId) {
      remember({
        layer: "enterprise",
        id: item.tenantId,
        status: "status" in item ? String(item.status) : "open",
        tenantId: item.tenantId,
      });
    }
    const target = item.target;
    if (!target) {
      continue;
    }
    if (target.agentId) {
      remember({ layer: "agent", id: target.agentId, status: "observed", tenantId: item.tenantId });
    }
    if (target.skillId) {
      remember({ layer: "skill", id: target.skillId, status: "observed", tenantId: item.tenantId });
    }
    if (target.toolId) {
      remember({ layer: "tool", id: target.toolId, status: "observed", tenantId: item.tenantId });
    }
  }
  return [...rows.values()];
}

function buildConversationEntries(
  cases: readonly VisualizationCaseRef[],
  signals: readonly VisualizationSignalRef[],
): DiagnosisConversationEntry[] {
  const entries: DiagnosisConversationEntry[] = [];
  for (const signal of signals) {
    entries.push(
      createDiagnosisConversationEntry({
        signalId: signal.signalId,
        caseId: signal.caseId,
        targetRef: signal.target,
        tenantId: signal.tenantId,
      }),
    );
  }
  for (const item of cases) {
    if (signals.some((signal) => signal.caseId === item.caseId)) {
      continue;
    }
    entries.push(
      createDiagnosisConversationEntry({
        caseId: item.caseId,
        targetRef: item.target,
        tenantId: item.tenantId,
      }),
    );
  }
  return entries;
}

function assertProjectionSafe(value: unknown, path = "projection"): void {
  if (!value || typeof value !== "object") {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertProjectionSafe(item, `${path}[${index}]`));
    return;
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if ((FORBIDDEN_REPORT_PAYLOAD_KEYS as readonly string[]).includes(key)) {
      fail(
        "visualization_payload_forbidden",
        `projection must not contain ${key}`,
        `${path}.${key}`,
      );
    }
    assertProjectionSafe(record[key], `${path}.${key}`);
  }
}

export function createDiagnosisConversationEntry(input: {
  signalId?: string;
  caseId?: string;
  targetRef?: DiagnosisTargetRef;
  tenantId: string | null;
}): DiagnosisConversationEntry {
  if (
    Object.hasOwn(input, "evidenceIds") ||
    Object.hasOwn(input, "payload") ||
    Object.hasOwn(input, "prompt")
  ) {
    fail("conversation_ref_only", "conversation entry must not include evidence or payload");
  }
  if (!input.signalId && !input.caseId && !input.targetRef) {
    fail("conversation_ref_required", "conversation entry needs signalId, caseId, or targetRef");
  }
  return {
    ...(input.signalId ? { signalId: input.signalId } : {}),
    ...(input.caseId ? { caseId: input.caseId } : {}),
    ...(input.targetRef ? { targetRef: input.targetRef } : {}),
    tenantId: input.tenantId,
  };
}

export function createAuthorizationDecisionRefresh(input: {
  grantId: string;
  decision: "approve" | "deny";
}): DiagnosisAuthorizationDecisionRefresh {
  if (!input.grantId) {
    fail("grant_id_required", "authorization refresh needs grantId", "grantId");
  }
  if (input.decision !== "approve" && input.decision !== "deny") {
    fail("authorization_decision_invalid", "decision must be approve or deny", "decision");
  }
  return { grantId: input.grantId, decision: input.decision, refresh: "p6_p7" };
}

export function projectDiagnosisVisualization(
  audience: DiagnosisVisualizationAudience,
  catalog: DiagnosisVisualizationCatalog,
): DiagnosisVisualizationBundle {
  assertAudience(audience);
  if (catalog.loadError) {
    return emptyBundle(
      audience,
      "unavailable",
      {
        tone: "error",
        label: "加载失败",
        openP0: 0,
        openP1: 0,
        inconclusive: 0,
        expired: 0,
      },
      catalog.loadError,
    );
  }

  const scope = buildScope(audience, catalog);
  const signals = visibleSignals(catalog, scope);
  const cases = visibleCases(catalog, scope);
  const findings = visibleFindings(catalog, scope);
  const hasRows =
    signals.length +
      cases.length +
      findings.length +
      (catalog.grants ?? []).filter((grant) => !isHiddenGrantStatus(grant.status)).length >
    0;
  const permissionState: DiagnosisPermissionState = hasRows ? "allowed" : "empty";
  const health = hasRows
    ? buildHealth(cases, findings, signals, catalog.verifications ?? [])
    : {
        tone: "empty" as const,
        label: "暂无数据",
        openP0: 0,
        openP1: 0,
        inconclusive: 0,
        expired: 0,
      };
  const timeline = buildTimeline(audience, catalog, scope, permissionState);
  const bundle: DiagnosisVisualizationBundle = {
    schemaVersion: DIAGNOSIS_VISUALIZATION_SCHEMA_VERSION,
    role: audience.role,
    tenantScope: audience.trusted.tenantId,
    redactionProfile: audience.redactionProfile,
    permissionState,
    health,
    cases: cases.map((item) => ({
      caseId: item.caseId,
      severity: item.severity ?? null,
      status: item.status,
      tenantId: item.tenantId,
    })),
    drilldown: buildDrilldown(cases, signals),
    timeline,
    trend: buildTrend(audience, catalog, signals, permissionState),
    graph: buildGraph(audience, catalog, scope, permissionState, timeline),
    authorizations: buildAuthorizations(audience, catalog, scope, permissionState),
    remediations: buildRemediations(audience, catalog, scope, permissionState),
    conversationEntries: buildConversationEntries(cases, signals),
    reportExport: {
      action: "export_existing_report",
      exporter: "exportCompositeDiagnosisReportJson",
    },
  };
  assertProjectionSafe(bundle);
  return bundle;
}

export const DIAGNOSIS_VISUALIZATION_CONTRACT = {
  schemaVersion: DIAGNOSIS_VISUALIZATION_SCHEMA_VERSION,
  roles: DIAGNOSIS_VIEW_ROLES,
  permissionStates: DIAGNOSIS_PERMISSION_STATES,
  healthTones: DIAGNOSIS_HEALTH_TONES,
  timelineKinds: DIAGNOSIS_TIMELINE_KINDS,
  hiddenGrantStatuses: HIDDEN_GRANT_STATUSES,
  liveGrantStatuses: LIVE_GRANT_STATUSES,
  redactionProfiles: PRODUCTION_REDACTION_PROFILES,
  grantStatuses: AUTHORIZATION_GRANT_STATUSES,
  signalStatuses: DIAGNOSTIC_SIGNAL_STATUSES,
  completions: DIAGNOSIS_COMPLETIONS,
  reportExporter: "exportCompositeDiagnosisReportJson",
} as const;
