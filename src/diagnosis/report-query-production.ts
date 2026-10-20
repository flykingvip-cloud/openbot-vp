/**
 * Phase 3 increment 4 — production report query security contract.
 * Reference adapter over queryCompositeReports / getCompositeReport.
 * Trusted tenant comes from server auth only. No HTTP/RPC/UI, no audit store.
 * Real production API entry is a separate approval.
 */
import {
  PRODUCTION_REDACTION_PROFILES,
  type ProductionRedactionProfile,
} from "./report-query-redaction.js";
import {
  REPORT_QUERY_LOCAL_READ_CAPABILITY,
  getCompositeReport,
  queryCompositeReports,
  type CompositeReportReader,
  type ReportQueryMode,
  type ReportQuerySort,
} from "./report-query.js";
import { FORBIDDEN_REPORT_PAYLOAD_KEYS } from "./report-validate.js";
import type { CompositeDiagnosisReport, ReportConfidenceSummary } from "./report.js";
import {
  DiagnosisContractError,
  isDiagnosisContractError,
  validateDiagnosticPrincipal,
  type DiagnosisCompletion,
  type DiagnosticPrincipal,
  type DiagnosticTargetType,
  type TrustedTenantContext,
} from "./types.js";

export const PRODUCTION_QUERY_SCHEMA_VERSION = 1 as const;
export { PRODUCTION_REDACTION_PROFILES, type ProductionRedactionProfile };

export const PRODUCTION_QUERY_ADMIN_CAPABILITY = "diagnosis.report_admin";
export const PRODUCTION_QUERY_LOCAL_READ_CAPABILITY = REPORT_QUERY_LOCAL_READ_CAPABILITY;

export const PRODUCTION_QUERY_DEFAULT_LIMIT = 20;
export const PRODUCTION_QUERY_MAX_LIMIT = 50;
export const PRODUCTION_QUERY_TENANT_QUOTA = 64;
export const PRODUCTION_QUERY_PRINCIPAL_QUOTA = 16;
export const PRODUCTION_QUERY_CURSOR_TTL_MS = 15 * 60 * 1000;
export const PRODUCTION_QUERY_CURSOR_PREFIX = "pq1.";

export const PRODUCTION_QUERY_PUBLIC_DENY_REASON = "forbidden" as const;

export type ProductionAuthContext = {
  trusted: TrustedTenantContext;
  principal: DiagnosticPrincipal;
  capabilities?: readonly string[];
};

export type ProductionQueryClaim = {
  /** Client-supplied tenant hint. Never authoritative. */
  claimedTenantId?: string | null;
  mode: ReportQueryMode;
  caseId?: string;
  reportId?: string;
  sessionKeyHash?: string;
  limit?: number;
  cursor?: string;
  sort?: ReportQuerySort;
  redactionProfile?: ProductionRedactionProfile;
};

export type ProductionQueryRequest = {
  auth: ProductionAuthContext;
  claim: ProductionQueryClaim;
};

export type ProductionGetRequest = {
  auth: ProductionAuthContext;
  reportId: string;
  claimedTenantId?: string | null;
  redactionProfile?: ProductionRedactionProfile;
};

export type ProductionAuthorizationDecision = {
  outcome: "allow" | "deny";
  reason:
    | "authorized"
    | "forbidden"
    | "rate_limited"
    | "invalid_cursor"
    | "cursor_expired"
    | "unavailable";
};

export type ProductionQueryTargetDigest = {
  reportId?: string;
  caseId?: string;
  sessionKeyHash?: string;
};

export type ProductionQueryAuditRecord = {
  principalId: string;
  principalKind: DiagnosticPrincipal["kind"];
  tenantId: string | null;
  mode: ReportQueryMode;
  targetDigest: ProductionQueryTargetDigest;
  resultCount: number;
  decision: "allow" | "deny";
  denyReason?: string;
  redactionProfile: ProductionRedactionProfile;
};

export type ProductionQueryAuditSink = {
  record(entry: ProductionQueryAuditRecord): void | Promise<void>;
};

export type ProductionQueryQuotaCounter = {
  consume(
    tenantId: string | null,
    principalId: string,
  ): { tenantUsed: number; principalUsed: number } | "rate_limited";
};

export type ProductionQueryQuotaLease = {
  release(): Promise<void>;
};

export type ProductionQueryWindowedQuota = ProductionQueryQuotaCounter & {
  consumeWindow(
    tenantId: string | null,
    principalId: string,
  ): Promise<
    | { ok: true; tenantUsed: number; principalUsed: number; inflight: number }
    | { ok: false; reason: "rate_limited" | "unavailable" }
  >;
  releaseWindow(tenantId: string | null, principalId: string): Promise<void>;
};

export function isWindowedProductionQuota(
  quota: ProductionQueryQuotaCounter,
): quota is ProductionQueryWindowedQuota {
  return (
    typeof (quota as Partial<ProductionQueryWindowedQuota>).consumeWindow === "function" &&
    typeof (quota as Partial<ProductionQueryWindowedQuota>).releaseWindow === "function"
  );
}

export type ProductionFindingRef = {
  findingId: string;
  severity: CompositeDiagnosisReport["findings"][number]["severity"];
  status: CompositeDiagnosisReport["findings"][number]["status"];
  code?: string;
};

export type ProductionCaseRef = {
  caseId: string;
  status: CompositeDiagnosisReport["cases"][number]["status"];
  completion: DiagnosisCompletion;
  sessionKeyHash?: string;
};

export type ProductionConfidenceRef =
  | Pick<ReportConfidenceSummary, "findingCount" | "acceptedCauseCount" | "candidateCauseCount">
  | ReportConfidenceSummary;

export type ProductionReportProjection = {
  reportId: string;
  generatedAt: string;
  tenantId: string | null;
  completion: DiagnosisCompletion;
  cases: ProductionCaseRef[];
  findings: ProductionFindingRef[];
  impactScope: DiagnosticTargetType[];
  confidence: ProductionConfidenceRef;
  evidenceRefIds?: string[];
};

export type ProductionQueryResponse = {
  schemaVersion: typeof PRODUCTION_QUERY_SCHEMA_VERSION;
  authorization: ProductionAuthorizationDecision;
  items: ProductionReportProjection[];
  nextCursor: string | null;
  redactionProfile: ProductionRedactionProfile;
  audit: ProductionQueryAuditRecord;
};

export type ProductionQueryAdapterDeps = {
  reader: CompositeReportReader;
  audit: ProductionQueryAuditSink;
  quota?: ProductionQueryQuotaCounter;
  now?: () => number;
};

type ProductionCursorPayload = {
  tenantId: string | null;
  principalId: string;
  mode: ReportQueryMode;
  caseId: string | null;
  reportId: string | null;
  sessionKeyHash: string | null;
  sortKey: string;
  sortDir: string;
  issuedAt: string;
  innerCursor: string | null;
};

const EXISTENCE_HIDE_CODES = new Set([
  "tenant_mismatch",
  "report_tenant_mismatch",
  "report_not_found",
  "local_capability_required",
]);

const INFRA_UNAVAILABLE_CODES = new Set([
  "reader_unavailable",
  "audit_unavailable",
  "quota_unavailable",
]);

export function createInMemoryProductionQueryAuditSink(): ProductionQueryAuditSink & {
  entries: ProductionQueryAuditRecord[];
} {
  const entries: ProductionQueryAuditRecord[] = [];
  return {
    entries,
    record(entry) {
      entries.push(entry);
    },
  };
}

export function createInMemoryProductionQueryQuota(limits?: {
  tenantLimit?: number;
  principalLimit?: number;
}): ProductionQueryQuotaCounter {
  const tenantLimit = limits?.tenantLimit ?? PRODUCTION_QUERY_TENANT_QUOTA;
  const principalLimit = limits?.principalLimit ?? PRODUCTION_QUERY_PRINCIPAL_QUOTA;
  const tenantUsed = new Map<string, number>();
  const principalUsed = new Map<string, number>();
  return {
    consume(tenantId, principalId) {
      const tenantKey = tenantId ?? "local";
      const nextTenant = (tenantUsed.get(tenantKey) ?? 0) + 1;
      const nextPrincipal = (principalUsed.get(principalId) ?? 0) + 1;
      if (nextTenant > tenantLimit || nextPrincipal > principalLimit) {
        return "rate_limited";
      }
      tenantUsed.set(tenantKey, nextTenant);
      principalUsed.set(principalId, nextPrincipal);
      return { tenantUsed: nextTenant, principalUsed: nextPrincipal };
    },
  };
}

export function createProductionReportQueryAdapter(deps: ProductionQueryAdapterDeps) {
  const bound: ProductionQueryAdapterDeps = {
    ...deps,
    quota: deps.quota ?? createInMemoryProductionQueryQuota(),
  };
  return {
    query(request: ProductionQueryRequest): Promise<ProductionQueryResponse> {
      return executeProductionReportQuery(request, bound);
    },
    get(request: ProductionGetRequest): Promise<ProductionQueryResponse> {
      return executeProductionReportGet(request, bound);
    },
  };
}

export async function executeProductionReportQuery(
  request: ProductionQueryRequest,
  deps: ProductionQueryAdapterDeps,
): Promise<ProductionQueryResponse> {
  const prepared = await prepareProductionQuery(request, "query", deps);
  if (prepared.kind === "deny") {
    return prepared.response;
  }
  try {
    try {
      const page = await queryCompositeReports(
        {
          tenantId: prepared.trusted.tenantId,
          mode: prepared.mode,
          requestedBy: prepared.principal,
          trusted: prepared.trusted,
          capabilities: prepared.capabilities,
          limit: prepared.limit,
          sort: prepared.sort,
          ...(prepared.caseId ? { caseId: prepared.caseId } : {}),
          ...(prepared.reportId ? { reportId: prepared.reportId } : {}),
          ...(prepared.sessionKeyHash ? { sessionKeyHash: prepared.sessionKeyHash } : {}),
          ...(prepared.innerCursor ? { cursor: prepared.innerCursor } : {}),
        },
        deps.reader,
      );
      const items = page.items.map((item) => projectReport(item, prepared.profile));
      if ((prepared.reportId || prepared.caseId || prepared.sessionKeyHash) && items.length === 0) {
        return await denyResponse(
          request,
          prepared.digest,
          prepared.profile,
          "report_not_found",
          deps.audit,
          prepared,
        );
      }
      return await emitAllow(prepared, items, page.nextCursor, deps);
    } catch (err) {
      return await hideOrThrow(err, prepared, deps);
    }
  } finally {
    await releaseQuotaLease(prepared.quotaLease);
  }
}

export async function executeProductionReportGet(
  request: ProductionGetRequest,
  deps: ProductionQueryAdapterDeps,
): Promise<ProductionQueryResponse> {
  const prepared = await prepareProductionQuery(
    {
      auth: request.auth,
      claim: {
        mode: "report",
        reportId: request.reportId,
        ...(request.claimedTenantId !== undefined
          ? { claimedTenantId: request.claimedTenantId }
          : {}),
        ...(request.redactionProfile ? { redactionProfile: request.redactionProfile } : {}),
      },
    },
    "get",
    deps,
  );
  if (prepared.kind === "deny") {
    return prepared.response;
  }
  try {
    try {
      const report = await getCompositeReport(
        {
          tenantId: prepared.trusted.tenantId,
          reportId: request.reportId,
          requestedBy: prepared.principal,
          trusted: prepared.trusted,
          capabilities: prepared.capabilities,
        },
        deps.reader,
      );
      return await emitAllow(prepared, [projectReport(report, prepared.profile)], null, deps);
    } catch (err) {
      return await hideOrThrow(err, prepared, deps);
    }
  } finally {
    await releaseQuotaLease(prepared.quotaLease);
  }
}

async function prepareProductionQuery(
  request: ProductionQueryRequest,
  modeHint: "query" | "get",
  deps: ProductionQueryAdapterDeps,
): Promise<
  | { kind: "deny"; response: ProductionQueryResponse }
  | {
      kind: "allow";
      trusted: TrustedTenantContext;
      principal: DiagnosticPrincipal;
      capabilities: readonly string[];
      mode: ReportQueryMode;
      caseId?: string;
      reportId?: string;
      sessionKeyHash?: string;
      limit: number;
      sort: ReportQuerySort;
      profile: ProductionRedactionProfile;
      innerCursor?: string;
      digest: ProductionQueryTargetDigest;
      quotaLease?: ProductionQueryQuotaLease;
    }
> {
  const digest = targetDigest(request.claim);
  const auth = requireAuthContext(request.auth);
  if (!auth) {
    return {
      kind: "deny",
      response: await denyResponse(request, digest, "user", "unauthenticated", deps.audit),
    };
  }
  if (claimTenantForges(request.claim.claimedTenantId, auth.trusted.tenantId)) {
    return {
      kind: "deny",
      response: await denyResponse(
        request,
        digest,
        "user",
        "client_tenant_forged",
        deps.audit,
        auth,
      ),
    };
  }
  try {
    validateDiagnosticPrincipal(auth.principal, auth.trusted, "auth.principal");
  } catch {
    return {
      kind: "deny",
      response: await denyResponse(request, digest, "user", "principal_mismatch", deps.audit, auth),
    };
  }
  if (
    auth.trusted.tenantId === null &&
    !auth.capabilities.includes(PRODUCTION_QUERY_LOCAL_READ_CAPABILITY)
  ) {
    return {
      kind: "deny",
      response: await denyResponse(
        request,
        digest,
        "system_local",
        "local_capability_required",
        deps.audit,
        auth,
      ),
    };
  }
  const profile = resolveRedactionProfile(request.claim.redactionProfile, auth);
  if (!profile.ok) {
    return {
      kind: "deny",
      response: await denyResponse(request, digest, "user", profile.reason, deps.audit, auth),
    };
  }
  const quota = deps.quota ?? createInMemoryProductionQueryQuota();
  const quotaOutcome = await consumeProductionQuota(
    quota,
    auth.trusted.tenantId,
    auth.principal.principalId,
  );
  if (quotaOutcome.kind === "deny") {
    return {
      kind: "deny",
      response: await denyResponse(
        request,
        digest,
        profile.value,
        quotaOutcome.reason === "unavailable" ? "quota_unavailable" : "rate_limited",
        deps.audit,
        auth,
        quotaOutcome.reason,
      ),
    };
  }
  try {
    const sort = request.claim.sort ?? { key: "generatedAt", direction: "desc" };
    const limit = normalizeProductionLimit(request.claim.limit);
    let innerCursor: string | undefined;
    if (request.claim.cursor) {
      const decoded = decodeProductionCursor(request.claim.cursor, {
        tenantId: auth.trusted.tenantId,
        principalId: auth.principal.principalId,
        mode: request.claim.mode,
        caseId: request.claim.caseId ?? null,
        reportId: request.claim.reportId ?? null,
        sessionKeyHash: request.claim.sessionKeyHash ?? null,
        sort,
        now: deps.now?.() ?? Date.now(),
      });
      if (decoded.kind === "deny") {
        await releaseQuotaLease(quotaOutcome.lease);
        return {
          kind: "deny",
          response: await denyResponse(
            request,
            digest,
            profile.value,
            decoded.internal,
            deps.audit,
            auth,
            decoded.public,
          ),
        };
      }
      innerCursor = decoded.innerCursor ?? undefined;
    }
    return {
      kind: "allow",
      trusted: auth.trusted,
      principal: auth.principal,
      capabilities: auth.capabilities,
      mode: request.claim.mode,
      ...(request.claim.caseId ? { caseId: request.claim.caseId } : {}),
      ...(request.claim.reportId ? { reportId: request.claim.reportId } : {}),
      ...(request.claim.sessionKeyHash ? { sessionKeyHash: request.claim.sessionKeyHash } : {}),
      limit,
      sort,
      profile: profile.value,
      ...(innerCursor ? { innerCursor } : {}),
      digest: modeHint === "get" ? { reportId: request.claim.reportId } : digest,
      ...(quotaOutcome.lease ? { quotaLease: quotaOutcome.lease } : {}),
    };
  } catch (err) {
    await releaseQuotaLease(quotaOutcome.lease);
    throw err;
  }
}

function requireAuthContext(raw: ProductionAuthContext | undefined): {
  trusted: TrustedTenantContext;
  principal: DiagnosticPrincipal;
  capabilities: readonly string[];
} | null {
  if (!raw || !raw.trusted || !Object.hasOwn(raw.trusted, "tenantId") || !raw.principal) {
    return null;
  }
  const tenantId = raw.trusted.tenantId;
  if (tenantId !== null && (typeof tenantId !== "string" || tenantId.length === 0)) {
    return null;
  }
  return {
    trusted: { tenantId },
    principal: raw.principal,
    capabilities: raw.capabilities ?? [],
  };
}

function claimTenantForges(claimed: string | null | undefined, trusted: string | null): boolean {
  return claimed !== undefined && claimed !== trusted;
}

function resolveRedactionProfile(
  requested: ProductionRedactionProfile | undefined,
  auth: { trusted: TrustedTenantContext; capabilities: readonly string[] },
): { ok: true; value: ProductionRedactionProfile } | { ok: false; reason: string } {
  if (requested && !(PRODUCTION_REDACTION_PROFILES as readonly string[]).includes(requested)) {
    return { ok: false, reason: "invalid_redaction_profile" };
  }
  const fallback: ProductionRedactionProfile =
    auth.trusted.tenantId === null
      ? "system_local"
      : auth.capabilities.includes(PRODUCTION_QUERY_ADMIN_CAPABILITY)
        ? "administrator"
        : "user";
  const profile = requested ?? fallback;
  if (
    profile === "administrator" &&
    !auth.capabilities.includes(PRODUCTION_QUERY_ADMIN_CAPABILITY)
  ) {
    return { ok: false, reason: "redaction_forbidden" };
  }
  if (profile === "system_local" && auth.trusted.tenantId !== null) {
    return { ok: false, reason: "redaction_forbidden" };
  }
  if (profile === "user" && auth.trusted.tenantId === null) {
    return { ok: false, reason: "redaction_forbidden" };
  }
  return { ok: true, value: profile };
}

function normalizeProductionLimit(raw: number | undefined): number {
  if (raw === undefined) {
    return PRODUCTION_QUERY_DEFAULT_LIMIT;
  }
  if (!Number.isInteger(raw) || raw < 1 || raw > PRODUCTION_QUERY_MAX_LIMIT) {
    throw new DiagnosisContractError(
      "invalid_type",
      `limit must be an integer between 1 and ${PRODUCTION_QUERY_MAX_LIMIT}`,
      "limit",
    );
  }
  return raw;
}

function projectReport(
  report: CompositeDiagnosisReport,
  profile: ProductionRedactionProfile,
): ProductionReportProjection {
  const privileged = profile === "administrator" || profile === "system_local";
  const projection: ProductionReportProjection = {
    reportId: report.reportId,
    generatedAt: report.generatedAt,
    tenantId: report.tenantId,
    completion: report.completion,
    cases: report.cases.map((item) => ({
      caseId: item.caseId,
      status: item.status,
      completion: item.completion,
      ...(privileged ? { sessionKeyHash: item.sessionKeyHash } : {}),
    })),
    findings: report.findings.map((item) => ({
      findingId: item.findingId,
      severity: item.severity,
      status: item.status,
      ...(privileged ? { code: item.code } : {}),
    })),
    impactScope: [...report.impactScope],
    confidence: privileged
      ? { ...report.confidence }
      : {
          findingCount: report.confidence.findingCount,
          acceptedCauseCount: report.confidence.acceptedCauseCount,
          candidateCauseCount: report.confidence.candidateCauseCount,
        },
  };
  if (privileged) {
    projection.evidenceRefIds = report.evidenceRefs.map((item) => item.evidenceId);
  }
  assertProjectionSafe(projection);
  return projection;
}

function assertProjectionSafe(projection: ProductionReportProjection): void {
  const raw = projection as unknown as Record<string, unknown>;
  for (const key of FORBIDDEN_REPORT_PAYLOAD_KEYS) {
    if (key in raw) {
      throw new DiagnosisContractError(
        "report_payload_forbidden",
        `production projection must not include ${key}`,
        key,
      );
    }
  }
  for (const key of [
    "evidenceRefs",
    "graphEdges",
    "acceptedRootCauses",
    "candidateRootCauses",
    "missingEvidence",
    "targets",
  ]) {
    if (key in raw) {
      throw new DiagnosisContractError(
        "report_payload_forbidden",
        `production projection must not include ${key}`,
        key,
      );
    }
  }
}

function encodeProductionCursor(
  prepared: {
    trusted: TrustedTenantContext;
    principal: DiagnosticPrincipal;
    mode: ReportQueryMode;
    caseId?: string;
    reportId?: string;
    sessionKeyHash?: string;
    sort: ReportQuerySort;
  },
  innerCursor: string | null,
  now: () => number | undefined,
): string {
  const payload: ProductionCursorPayload = {
    tenantId: prepared.trusted.tenantId,
    principalId: prepared.principal.principalId,
    mode: prepared.mode,
    caseId: prepared.caseId ?? null,
    reportId: prepared.reportId ?? null,
    sessionKeyHash: prepared.sessionKeyHash ?? null,
    sortKey: prepared.sort.key,
    sortDir: prepared.sort.direction,
    issuedAt: new Date(now() ?? Date.now()).toISOString(),
    innerCursor,
  };
  return (
    PRODUCTION_QUERY_CURSOR_PREFIX +
    Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")
  );
}

function decodeProductionCursor(
  raw: string,
  expected: {
    tenantId: string | null;
    principalId: string;
    mode: ReportQueryMode;
    caseId: string | null;
    reportId: string | null;
    sessionKeyHash: string | null;
    sort: ReportQuerySort;
    now: number;
  },
):
  | { kind: "ok"; innerCursor: string | null }
  | { kind: "deny"; internal: string; public: ProductionAuthorizationDecision["reason"] } {
  if (!raw.startsWith(PRODUCTION_QUERY_CURSOR_PREFIX)) {
    return { kind: "deny", internal: "invalid_cursor", public: "invalid_cursor" };
  }
  let payload: unknown;
  try {
    payload = JSON.parse(
      Buffer.from(raw.slice(PRODUCTION_QUERY_CURSOR_PREFIX.length), "base64url").toString("utf8"),
    );
  } catch {
    return { kind: "deny", internal: "invalid_cursor", public: "invalid_cursor" };
  }
  if (!isRecord(payload) || typeof payload.issuedAt !== "string") {
    return { kind: "deny", internal: "invalid_cursor", public: "invalid_cursor" };
  }
  const issuedAt = Date.parse(payload.issuedAt);
  if (Number.isNaN(issuedAt) || issuedAt + PRODUCTION_QUERY_CURSOR_TTL_MS < expected.now) {
    return { kind: "deny", internal: "cursor_expired", public: "cursor_expired" };
  }
  if (
    payload.tenantId !== expected.tenantId ||
    payload.principalId !== expected.principalId ||
    payload.mode !== expected.mode ||
    (payload.caseId ?? null) !== expected.caseId ||
    (payload.reportId ?? null) !== expected.reportId ||
    (payload.sessionKeyHash ?? null) !== expected.sessionKeyHash ||
    payload.sortKey !== expected.sort.key ||
    payload.sortDir !== expected.sort.direction
  ) {
    return { kind: "deny", internal: "cursor_scope_mismatch", public: "forbidden" };
  }
  if (payload.innerCursor !== null && typeof payload.innerCursor !== "string") {
    return { kind: "deny", internal: "invalid_cursor", public: "invalid_cursor" };
  }
  return { kind: "ok", innerCursor: payload.innerCursor };
}

function allowResponse(
  prepared: {
    trusted: TrustedTenantContext;
    principal: DiagnosticPrincipal;
    mode: ReportQueryMode;
    caseId?: string;
    reportId?: string;
    sessionKeyHash?: string;
    sort: ReportQuerySort;
    profile: ProductionRedactionProfile;
    digest: ProductionQueryTargetDigest;
  },
  items: ProductionReportProjection[],
  innerNext: string | null,
  now: (() => number) | undefined,
): ProductionQueryResponse {
  const audit: ProductionQueryAuditRecord = {
    principalId: prepared.principal.principalId,
    principalKind: prepared.principal.kind,
    tenantId: prepared.trusted.tenantId,
    mode: prepared.mode,
    targetDigest: prepared.digest,
    resultCount: items.length,
    decision: "allow",
    redactionProfile: prepared.profile,
  };
  return {
    schemaVersion: PRODUCTION_QUERY_SCHEMA_VERSION,
    authorization: { outcome: "allow", reason: "authorized" },
    items,
    nextCursor: innerNext ? encodeProductionCursor(prepared, innerNext, () => now?.()) : null,
    redactionProfile: prepared.profile,
    audit,
  };
}

async function emitAllow(
  prepared: Parameters<typeof allowResponse>[0],
  items: ProductionReportProjection[],
  innerNext: string | null,
  deps: ProductionQueryAdapterDeps,
): Promise<ProductionQueryResponse> {
  const response = allowResponse(prepared, items, innerNext, deps.now);
  try {
    await deps.audit.record(response.audit);
    return response;
  } catch {
    return denyResponse(
      {
        auth: {
          trusted: prepared.trusted,
          principal: prepared.principal,
        },
        claim: { mode: prepared.mode },
      },
      prepared.digest,
      prepared.profile,
      "audit_unavailable",
      { record() {} },
      prepared,
      "unavailable",
    );
  }
}

async function denyResponse(
  request: ProductionQueryRequest,
  digest: ProductionQueryTargetDigest,
  profile: ProductionRedactionProfile,
  internal: string,
  auditSink: ProductionQueryAuditSink,
  auth?: { principal: DiagnosticPrincipal; trusted: TrustedTenantContext },
  publicReason: ProductionAuthorizationDecision["reason"] = PRODUCTION_QUERY_PUBLIC_DENY_REASON,
): Promise<ProductionQueryResponse> {
  const audit: ProductionQueryAuditRecord = {
    principalId: auth?.principal.principalId ?? "unauthenticated",
    principalKind: auth?.principal.kind ?? "user",
    tenantId: auth?.trusted.tenantId ?? request.claim.claimedTenantId ?? null,
    mode: request.claim.mode,
    targetDigest: digest,
    resultCount: 0,
    decision: "deny",
    denyReason: internal,
    redactionProfile: profile,
  };
  try {
    await auditSink.record(audit);
  } catch {
    // Deny stays deny when the audit sink is down.
  }
  return {
    schemaVersion: PRODUCTION_QUERY_SCHEMA_VERSION,
    authorization: { outcome: "deny", reason: publicReason },
    items: [],
    nextCursor: null,
    redactionProfile: profile,
    audit,
  };
}

async function hideOrThrow(
  err: unknown,
  prepared: {
    trusted: TrustedTenantContext;
    principal: DiagnosticPrincipal;
    mode: ReportQueryMode;
    profile: ProductionRedactionProfile;
    digest: ProductionQueryTargetDigest;
  },
  deps: ProductionQueryAdapterDeps,
): Promise<ProductionQueryResponse> {
  if (isDiagnosisContractError(err) && EXISTENCE_HIDE_CODES.has(err.code)) {
    return denyResponse(
      {
        auth: {
          trusted: prepared.trusted,
          principal: prepared.principal,
          capabilities: [],
        },
        claim: { mode: prepared.mode },
      },
      prepared.digest,
      prepared.profile,
      err.code,
      deps.audit,
      prepared,
    );
  }
  if (isDiagnosisContractError(err) && INFRA_UNAVAILABLE_CODES.has(err.code)) {
    return denyResponse(
      {
        auth: {
          trusted: prepared.trusted,
          principal: prepared.principal,
          capabilities: [],
        },
        claim: { mode: prepared.mode },
      },
      prepared.digest,
      prepared.profile,
      err.code,
      { record() {} },
      prepared,
      "unavailable",
    );
  }
  throw err;
}

function targetDigest(claim: ProductionQueryClaim): ProductionQueryTargetDigest {
  const digest: ProductionQueryTargetDigest = {};
  if (claim.reportId) {
    digest.reportId = claim.reportId;
  }
  if (claim.caseId) {
    digest.caseId = claim.caseId;
  }
  if (claim.sessionKeyHash) {
    digest.sessionKeyHash = claim.sessionKeyHash;
  }
  return digest;
}

async function consumeProductionQuota(
  quota: ProductionQueryQuotaCounter,
  tenantId: string | null,
  principalId: string,
): Promise<
  | { kind: "ok"; lease?: ProductionQueryQuotaLease }
  | { kind: "deny"; reason: "rate_limited" | "unavailable" }
> {
  if (isWindowedProductionQuota(quota)) {
    let result: Awaited<ReturnType<ProductionQueryWindowedQuota["consumeWindow"]>>;
    try {
      result = await quota.consumeWindow(tenantId, principalId);
    } catch {
      return { kind: "deny", reason: "unavailable" };
    }
    if (!result.ok) {
      return { kind: "deny", reason: result.reason };
    }
    return {
      kind: "ok",
      lease: {
        async release() {
          await quota.releaseWindow(tenantId, principalId);
        },
      },
    };
  }
  try {
    const consumed = quota.consume(tenantId, principalId);
    if (consumed === "rate_limited") {
      return { kind: "deny", reason: "rate_limited" };
    }
    return { kind: "ok" };
  } catch {
    return { kind: "deny", reason: "unavailable" };
  }
}

async function releaseQuotaLease(lease?: ProductionQueryQuotaLease): Promise<void> {
  if (!lease) {
    return;
  }
  try {
    await lease.release();
  } catch {
    // Release failures must not mask the query outcome.
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
