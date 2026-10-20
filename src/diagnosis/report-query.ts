/**
 * Phase 3 increment 3 — in-process read-only report query and authorization.
 * Injected reader only. No HTTP/RPC, UI, database, or production routes.
 * Production query entry is a separate approval.
 */
import { validateCompositeDiagnosisReport } from "./report-validate.js";
import type { CompositeDiagnosisReport } from "./report.js";
import {
  DiagnosisContractError,
  isDiagnosisContractError,
  validateDiagnosticPrincipal,
  type DiagnosticPrincipal,
  type TrustedTenantContext,
} from "./types.js";

export const REPORT_QUERY_MODES = ["case", "report", "session"] as const;
export type ReportQueryMode = (typeof REPORT_QUERY_MODES)[number];

export const REPORT_QUERY_SORT_KEYS = ["generatedAt", "reportId", "caseId"] as const;
export type ReportQuerySortKey = (typeof REPORT_QUERY_SORT_KEYS)[number];

export const REPORT_QUERY_SORT_DIRECTIONS = ["asc", "desc"] as const;
export type ReportQuerySortDirection = (typeof REPORT_QUERY_SORT_DIRECTIONS)[number];

/** Explicit capability required to read system/local reports (tenantId=null). */
export const REPORT_QUERY_LOCAL_READ_CAPABILITY = "diagnosis.local_read";

export const REPORT_QUERY_DEFAULT_LIMIT = 20;
export const REPORT_QUERY_MAX_LIMIT = 100;

const CURSOR_PREFIX = "rq1.";

export type ReportQuerySort = {
  key: ReportQuerySortKey;
  direction: ReportQuerySortDirection;
};

export type ReportQueryRequest = {
  tenantId: string | null;
  mode: ReportQueryMode;
  caseId?: string;
  reportId?: string;
  sessionKeyHash?: string;
  requestedBy: DiagnosticPrincipal;
  trusted: TrustedTenantContext;
  capabilities?: readonly string[];
  limit?: number;
  cursor?: string;
  sort?: ReportQuerySort;
};

export type ReportGetRequest = {
  tenantId: string | null;
  reportId: string;
  requestedBy: DiagnosticPrincipal;
  trusted: TrustedTenantContext;
  capabilities?: readonly string[];
};

export type ReportReaderFilter = {
  tenantId: string | null;
  mode: ReportQueryMode;
  caseId?: string;
  reportId?: string;
  sessionKeyHash?: string;
};

export type CompositeReportReader = {
  list(filter: ReportReaderFilter): Promise<readonly unknown[]>;
  get(reportId: string): Promise<unknown>;
};

export type ReportQueryPage = {
  items: CompositeDiagnosisReport[];
  nextCursor: string | null;
  sort: ReportQuerySort;
};

type CursorPayload = {
  tenantId: string | null;
  mode: ReportQueryMode;
  caseId: string | null;
  reportId: string | null;
  sessionKeyHash: string | null;
  sortKey: ReportQuerySortKey;
  sortDir: ReportQuerySortDirection;
  afterGeneratedAt: string;
  afterReportId: string;
  afterCaseId: string;
};

export function createInMemoryCompositeReportReader(
  reports: readonly unknown[],
): CompositeReportReader {
  const rows = [...reports];
  return {
    async list() {
      return rows;
    },
    async get(reportId) {
      return rows.find((item) => isRecord(item) && item.reportId === reportId);
    },
  };
}

export async function queryCompositeReports(
  request: ReportQueryRequest,
  reader: CompositeReportReader,
): Promise<ReportQueryPage> {
  const authorized = authorizeQuery(request);
  const sort = authorized.sort;
  const rows = await reader.list({
    tenantId: authorized.tenantId,
    mode: authorized.mode,
    ...(authorized.caseId ? { caseId: authorized.caseId } : {}),
    ...(authorized.reportId ? { reportId: authorized.reportId } : {}),
    ...(authorized.sessionKeyHash ? { sessionKeyHash: authorized.sessionKeyHash } : {}),
  });
  const matched: CompositeDiagnosisReport[] = [];
  for (const row of rows) {
    const report = acceptReaderReport(row, authorized);
    if (!report) {
      continue;
    }
    if (!matchesQuery(report, authorized)) {
      continue;
    }
    matched.push(report);
  }
  matched.sort((left, right) => compareReports(left, right, sort));
  const start = authorized.cursor ? indexAfterCursor(matched, authorized.cursor, sort) : 0;
  const items = matched.slice(start, start + authorized.limit);
  const last = items.at(-1);
  const nextCursor =
    last && start + items.length < matched.length ? encodeCursor(authorized, last) : null;
  return { items, nextCursor, sort };
}

export async function getCompositeReport(
  request: ReportGetRequest,
  reader: CompositeReportReader,
): Promise<CompositeDiagnosisReport> {
  const authorized = authorizeGet(request);
  const row = await reader.get(authorized.reportId);
  if (row == null) {
    throw new DiagnosisContractError(
      "report_not_found",
      "Composite Diagnosis Report was not found",
      "reportId",
    );
  }
  const report = validateCompositeDiagnosisReport(row, authorized.trusted);
  if (report.reportId !== authorized.reportId) {
    throw new DiagnosisContractError(
      "report_not_found",
      "reader returned a different reportId",
      "reportId",
    );
  }
  return report;
}

function authorizeQuery(request: ReportQueryRequest): {
  tenantId: string | null;
  mode: ReportQueryMode;
  caseId?: string;
  reportId?: string;
  sessionKeyHash?: string;
  trusted: TrustedTenantContext;
  limit: number;
  cursor?: CursorPayload;
  sort: ReportQuerySort;
} {
  const trusted = requireTrusted(request.trusted);
  requireRequestTenant(request.tenantId, trusted);
  requireLocalCapability(trusted, request.capabilities);
  validateDiagnosticPrincipal(request.requestedBy, trusted, "requestedBy");
  const mode = requireLiteral(request.mode, REPORT_QUERY_MODES, "mode");
  const sort = normalizeSort(request.sort);
  const limit = normalizeLimit(request.limit);
  const caseId = optionalId(request.caseId, "caseId");
  const reportId = optionalId(request.reportId, "reportId");
  const sessionKeyHash = optionalId(request.sessionKeyHash, "sessionKeyHash");
  const cursor = request.cursor
    ? decodeCursor(request.cursor, {
        tenantId: request.tenantId,
        mode,
        caseId: caseId ?? null,
        reportId: reportId ?? null,
        sessionKeyHash: sessionKeyHash ?? null,
        sort,
      })
    : undefined;
  return {
    tenantId: request.tenantId,
    mode,
    ...(caseId ? { caseId } : {}),
    ...(reportId ? { reportId } : {}),
    ...(sessionKeyHash ? { sessionKeyHash } : {}),
    trusted,
    limit,
    ...(cursor ? { cursor } : {}),
    sort,
  };
}

function authorizeGet(request: ReportGetRequest): {
  tenantId: string | null;
  reportId: string;
  trusted: TrustedTenantContext;
} {
  const trusted = requireTrusted(request.trusted);
  requireRequestTenant(request.tenantId, trusted);
  requireLocalCapability(trusted, request.capabilities);
  validateDiagnosticPrincipal(request.requestedBy, trusted, "requestedBy");
  const reportId = optionalId(request.reportId, "reportId");
  if (!reportId) {
    throw new DiagnosisContractError("missing_field", "reportId is required", "reportId");
  }
  return { tenantId: request.tenantId, reportId, trusted };
}

function requireTrusted(raw: unknown): TrustedTenantContext {
  if (!isRecord(raw) || !Object.hasOwn(raw, "tenantId")) {
    throw new DiagnosisContractError(
      "trusted_context_required",
      "TrustedTenantContext is required",
      "trusted",
    );
  }
  const tenantId = raw.tenantId;
  if (tenantId !== null && (typeof tenantId !== "string" || tenantId.length === 0)) {
    throw new DiagnosisContractError(
      "invalid_type",
      "trusted.tenantId must be string | null",
      "trusted.tenantId",
    );
  }
  return { tenantId };
}

function requireRequestTenant(
  tenantId: string | null | undefined,
  trusted: TrustedTenantContext,
): void {
  if (tenantId === undefined) {
    throw new DiagnosisContractError("missing_field", "tenantId is required", "tenantId");
  }
  if (tenantId !== null && (typeof tenantId !== "string" || tenantId.length === 0)) {
    throw new DiagnosisContractError("invalid_type", "tenantId must be string | null", "tenantId");
  }
  if (tenantId !== trusted.tenantId) {
    throw new DiagnosisContractError(
      "tenant_mismatch",
      "query tenantId must match trusted tenant context",
      "tenantId",
    );
  }
}

function requireLocalCapability(
  trusted: TrustedTenantContext,
  capabilities: readonly string[] | undefined,
): void {
  if (trusted.tenantId !== null) {
    return;
  }
  if (!capabilities?.includes(REPORT_QUERY_LOCAL_READ_CAPABILITY)) {
    throw new DiagnosisContractError(
      "local_capability_required",
      "system/local tenantId=null requires diagnosis.local_read",
      "capabilities",
    );
  }
}

function acceptReaderReport(
  raw: unknown,
  query: {
    trusted: TrustedTenantContext;
    caseId?: string;
    reportId?: string;
    sessionKeyHash?: string;
  },
): CompositeDiagnosisReport | null {
  try {
    return validateCompositeDiagnosisReport(raw, query.trusted);
  } catch (err) {
    if (
      isDiagnosisContractError(err) &&
      (err.code === "tenant_mismatch" || err.code === "report_tenant_mismatch")
    ) {
      if (isTargetedQuery(query) && rawMatchesRequestedId(raw, query)) {
        throw err;
      }
      return null;
    }
    throw err;
  }
}

function rawMatchesRequestedId(
  raw: unknown,
  query: { caseId?: string; reportId?: string; sessionKeyHash?: string },
): boolean {
  if (!isRecord(raw)) {
    return false;
  }
  if (query.reportId && raw.reportId === query.reportId) {
    return true;
  }
  const cases = Array.isArray(raw.cases) ? raw.cases : [];
  const targets = Array.isArray(raw.targets) ? raw.targets : [];
  const evidenceRefs = Array.isArray(raw.evidenceRefs) ? raw.evidenceRefs : [];
  if (query.caseId && cases.some((item) => isRecord(item) && item.caseId === query.caseId)) {
    return true;
  }
  if (
    query.sessionKeyHash &&
    (cases.some((item) => isRecord(item) && item.sessionKeyHash === query.sessionKeyHash) ||
      targets.some((item) => isRecord(item) && item.sessionKeyHash === query.sessionKeyHash) ||
      evidenceRefs.some((item) => isRecord(item) && item.sessionKeyHash === query.sessionKeyHash))
  ) {
    return true;
  }
  return false;
}

function matchesQuery(
  report: CompositeDiagnosisReport,
  query: {
    mode: ReportQueryMode;
    caseId?: string;
    reportId?: string;
    sessionKeyHash?: string;
  },
): boolean {
  if (query.reportId && report.reportId !== query.reportId) {
    return false;
  }
  if (query.caseId && !report.cases.some((item) => item.caseId === query.caseId)) {
    return false;
  }
  if (
    query.sessionKeyHash &&
    !report.cases.some((item) => item.sessionKeyHash === query.sessionKeyHash) &&
    !report.targets.some((item) => item.sessionKeyHash === query.sessionKeyHash) &&
    !report.evidenceRefs.some((item) => item.sessionKeyHash === query.sessionKeyHash)
  ) {
    return false;
  }
  if (query.mode === "case" && query.caseId && report.cases.length === 0) {
    return false;
  }
  if (query.mode === "session" && query.sessionKeyHash && report.cases.length === 0) {
    return false;
  }
  return true;
}

function isTargetedQuery(query: {
  caseId?: string;
  reportId?: string;
  sessionKeyHash?: string;
}): boolean {
  return Boolean(query.caseId || query.reportId || query.sessionKeyHash);
}

function normalizeSort(raw: ReportQuerySort | undefined): ReportQuerySort {
  if (raw === undefined) {
    return { key: "generatedAt", direction: "desc" };
  }
  return {
    key: requireLiteral(raw.key, REPORT_QUERY_SORT_KEYS, "sort.key"),
    direction: requireLiteral(raw.direction, REPORT_QUERY_SORT_DIRECTIONS, "sort.direction"),
  };
}

function normalizeLimit(raw: number | undefined): number {
  if (raw === undefined) {
    return REPORT_QUERY_DEFAULT_LIMIT;
  }
  if (!Number.isInteger(raw) || raw < 1 || raw > REPORT_QUERY_MAX_LIMIT) {
    throw new DiagnosisContractError(
      "invalid_type",
      `limit must be an integer between 1 and ${REPORT_QUERY_MAX_LIMIT}`,
      "limit",
    );
  }
  return raw;
}

function optionalId(value: string | undefined, path: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.length === 0) {
    throw new DiagnosisContractError("invalid_type", `${path} must be a non-empty string`, path);
  }
  return value;
}

function requireLiteral<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new DiagnosisContractError("invalid_literal", `${path} is invalid`, path);
  }
  return value as T;
}

function compareReports(
  left: CompositeDiagnosisReport,
  right: CompositeDiagnosisReport,
  sort: ReportQuerySort,
): number {
  const leftKey = sortValue(left, sort.key);
  const rightKey = sortValue(right, sort.key);
  const primary = leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  const signed = sort.direction === "desc" ? -primary : primary;
  if (signed !== 0) {
    return signed;
  }
  return left.reportId < right.reportId ? -1 : left.reportId > right.reportId ? 1 : 0;
}

function sortValue(report: CompositeDiagnosisReport, key: ReportQuerySortKey): string {
  if (key === "generatedAt") {
    return report.generatedAt;
  }
  if (key === "reportId") {
    return report.reportId;
  }
  return report.cases.map((item) => item.caseId).toSorted()[0] ?? "";
}

function encodeCursor(
  query: {
    tenantId: string | null;
    mode: ReportQueryMode;
    caseId?: string;
    reportId?: string;
    sessionKeyHash?: string;
    sort: ReportQuerySort;
  },
  last: CompositeDiagnosisReport,
): string {
  const payload: CursorPayload = {
    tenantId: query.tenantId,
    mode: query.mode,
    caseId: query.caseId ?? null,
    reportId: query.reportId ?? null,
    sessionKeyHash: query.sessionKeyHash ?? null,
    sortKey: query.sort.key,
    sortDir: query.sort.direction,
    afterGeneratedAt: last.generatedAt,
    afterReportId: last.reportId,
    afterCaseId: sortValue(last, "caseId"),
  };
  return CURSOR_PREFIX + Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeCursor(
  raw: string,
  expected: {
    tenantId: string | null;
    mode: ReportQueryMode;
    caseId: string | null;
    reportId: string | null;
    sessionKeyHash: string | null;
    sort: ReportQuerySort;
  },
): CursorPayload {
  if (!raw.startsWith(CURSOR_PREFIX)) {
    throw new DiagnosisContractError("invalid_cursor", "cursor must be an rq1 token", "cursor");
  }
  let payload: unknown;
  try {
    payload = JSON.parse(
      Buffer.from(raw.slice(CURSOR_PREFIX.length), "base64url").toString("utf8"),
    );
  } catch {
    throw new DiagnosisContractError("invalid_cursor", "cursor is not valid JSON", "cursor");
  }
  if (!isRecord(payload)) {
    throw new DiagnosisContractError(
      "invalid_cursor",
      "cursor payload must be an object",
      "cursor",
    );
  }
  const cursor: CursorPayload = {
    tenantId: requireCursorTenantId(payload.tenantId),
    mode: requireLiteral(payload.mode, REPORT_QUERY_MODES, "cursor.mode"),
    caseId: requireCursorString(payload.caseId, "cursor.caseId", true),
    reportId: requireCursorString(payload.reportId, "cursor.reportId", true),
    sessionKeyHash: requireCursorString(payload.sessionKeyHash, "cursor.sessionKeyHash", true),
    sortKey: requireLiteral(payload.sortKey, REPORT_QUERY_SORT_KEYS, "cursor.sortKey"),
    sortDir: requireLiteral(payload.sortDir, REPORT_QUERY_SORT_DIRECTIONS, "cursor.sortDir"),
    afterGeneratedAt: requireCursorString(
      payload.afterGeneratedAt,
      "cursor.afterGeneratedAt",
      false,
    ),
    afterReportId: requireCursorString(payload.afterReportId, "cursor.afterReportId", false),
    afterCaseId: requireCursorString(payload.afterCaseId, "cursor.afterCaseId", false),
  };
  if (
    cursor.tenantId !== expected.tenantId ||
    cursor.mode !== expected.mode ||
    cursor.caseId !== expected.caseId ||
    cursor.reportId !== expected.reportId ||
    cursor.sessionKeyHash !== expected.sessionKeyHash ||
    cursor.sortKey !== expected.sort.key ||
    cursor.sortDir !== expected.sort.direction
  ) {
    throw new DiagnosisContractError(
      "cursor_scope_mismatch",
      "cursor is bound to a different tenant or query",
      "cursor",
    );
  }
  return cursor;
}

function indexAfterCursor(
  items: readonly CompositeDiagnosisReport[],
  cursor: CursorPayload,
  sort: ReportQuerySort,
): number {
  const afterKey =
    sort.key === "generatedAt"
      ? cursor.afterGeneratedAt
      : sort.key === "reportId"
        ? cursor.afterReportId
        : cursor.afterCaseId;
  const index = items.findIndex((item) => {
    const itemKey = sortValue(item, sort.key);
    const primary = itemKey < afterKey ? -1 : itemKey > afterKey ? 1 : 0;
    const signed = sort.direction === "desc" ? -primary : primary;
    if (signed !== 0) {
      return signed > 0;
    }
    return item.reportId > cursor.afterReportId;
  });
  return index < 0 ? items.length : index;
}

function requireCursorTenantId(value: unknown): string | null {
  if (value === null) {
    return null;
  }
  return requireCursorString(value, "cursor.tenantId", false);
}

function requireCursorString(value: unknown, path: string, allowNull: true): string | null;
function requireCursorString(value: unknown, path: string, allowNull: false): string;
function requireCursorString(value: unknown, path: string, allowNull: boolean): string | null {
  if (allowNull && value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new DiagnosisContractError("invalid_cursor", `${path} must be a string`, "cursor");
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
