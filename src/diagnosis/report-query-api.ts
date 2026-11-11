/**
 * Phase 3.5 — governed diagnosis report API boundary.
 * Route adapter over executeProductionReportQuery / executeProductionReportGet.
 * Trusted tenant is injected by the server auth resolver only.
 * Live pack registration is gated by DIAGNOSIS_REPORT_API_DEPLOYED.
 * Not production deployed.
 */
import { DIAGNOSIS_REPORT_API_DEPLOYED } from "./report-query-deploy.js";
import {
  PRODUCTION_QUERY_SCHEMA_VERSION,
  PRODUCTION_REDACTION_PROFILES,
  executeProductionReportGet,
  executeProductionReportQuery,
  type ProductionAuthContext,
  type ProductionQueryAdapterDeps,
  type ProductionQueryAuditRecord,
  type ProductionQueryClaim,
  type ProductionQueryResponse,
  type ProductionRedactionProfile,
} from "./report-query-production.js";
import {
  REPORT_QUERY_MODES,
  REPORT_QUERY_SORT_DIRECTIONS,
  REPORT_QUERY_SORT_KEYS,
  type ReportQueryMode,
  type ReportQuerySort,
} from "./report-query.js";
import { DiagnosisContractError, isDiagnosisContractError } from "./types.js";

export const DIAGNOSIS_REPORT_API_SCHEMA_VERSION = 1 as const;
export const DIAGNOSIS_REPORT_API_METHODS = [
  "diagnosis.reports.query",
  "diagnosis.reports.get",
] as const;
export const DIAGNOSIS_DIAGNOSE_METHOD = "diagnosis.diagnose" as const;
export const DIAGNOSIS_SCHEDULE_APPLY_METHOD = "diagnosis.schedule.apply" as const;
export const DIAGNOSIS_SELF_EVOLUTION_CONFIRM_METHOD = "diagnosis.self-evolution.confirm" as const;
export { DIAGNOSIS_ACTION_DISPATCH_METHOD } from "./diagnose-action-dispatch.js";
export {
  DIAGNOSIS_INTERVENTION_LIST_METHOD,
  DIAGNOSIS_INTERVENTION_GET_METHOD,
  DIAGNOSIS_INTERVENTION_DISPATCH_METHOD,
  DIAGNOSIS_INTERVENTION_EXPAND_METHOD,
  DIAGNOSIS_INTERVENTION_MATERIALIZE_METHOD,
  DIAGNOSIS_INTERVENTION_METHODS,
} from "./intervention-methods.js";
export {
  DIAGNOSIS_HANDLING_PREVIEW_METHOD,
  DIAGNOSIS_HANDLING_SUBMIT_METHOD,
  DIAGNOSIS_HANDLING_APPROVE_METHOD,
  DIAGNOSIS_HANDLING_REJECT_METHOD,
  DIAGNOSIS_HANDLING_CANCEL_METHOD,
  DIAGNOSIS_HANDLING_EXECUTE_METHOD,
  DIAGNOSIS_HANDLING_RECHECK_METHOD,
  DIAGNOSIS_HANDLING_GET_METHOD,
  DIAGNOSIS_HANDLING_LIST_METHOD,
  DIAGNOSIS_HANDLING_METHODS,
  DIAGNOSIS_HANDLING_READ_METHODS,
  DIAGNOSIS_HANDLING_WRITE_METHODS,
  DIAGNOSIS_HANDLING_APPROVAL_METHODS,
} from "./handling-loop-methods.js";
export type DiagnosisReportApiMethod = (typeof DIAGNOSIS_REPORT_API_METHODS)[number];

/** Deployment gate: live pack table / core handler registration. */
export { DIAGNOSIS_REPORT_API_DEPLOYED };

export type DiagnosisReportApiStatus = 200 | 400 | 401 | 403 | 404 | 429 | 503;

export type DiagnosisReportApiClientHints = {
  headerTenantId?: string | null;
  queryTenantId?: string | null;
  urlTenantId?: string | null;
};

export type DiagnosisReportApiRequest = {
  method: string;
  params: unknown;
  /** Server-resolved auth. Never derived from URL/query/body/header tenantId. */
  auth: ProductionAuthContext | null;
  clientTenantHints?: DiagnosisReportApiClientHints;
};

export type DiagnosisReportApiError = {
  error: { code: string; message: string };
};

export type DiagnosisReportApiResult = {
  status: DiagnosisReportApiStatus;
  body: ProductionQueryResponse | DiagnosisReportApiError;
};

export type DiagnosisReportApiRespond = (
  ok: boolean,
  payload?: unknown,
  error?: { code: string; message: string },
) => void;

export async function dispatchDiagnosisReportApi(
  request: DiagnosisReportApiRequest,
  deps: ProductionQueryAdapterDeps,
): Promise<DiagnosisReportApiResult> {
  if (!isDiagnosisReportApiMethod(request.method)) {
    return {
      status: 404,
      body: { error: { code: "method_not_found", message: "unknown diagnosis report method" } },
    };
  }
  if (!request.auth) {
    const body = unauthenticatedResponse();
    await deps.audit.record(body.audit);
    return { status: 401, body };
  }
  try {
    const params = asParams(request.params);
    if (
      params.schemaVersion !== undefined &&
      params.schemaVersion !== DIAGNOSIS_REPORT_API_SCHEMA_VERSION
    ) {
      return {
        status: 400,
        body: {
          error: {
            code: "unknown_schema_version",
            message: "diagnosis report API only supports schemaVersion=1",
          },
        },
      };
    }
    const claimedTenantId = resolveClaimedTenantId(params, request.clientTenantHints);
    const body =
      request.method === "diagnosis.reports.get"
        ? await executeProductionReportGet(
            {
              auth: request.auth,
              reportId: requireReportId(params),
              ...(claimedTenantId !== undefined ? { claimedTenantId } : {}),
              ...(optionalRedaction(params) ? { redactionProfile: optionalRedaction(params) } : {}),
            },
            deps,
          )
        : await executeProductionReportQuery(
            {
              auth: request.auth,
              claim: buildClaim(params, claimedTenantId),
            },
            deps,
          );
    return { status: mapProductionStatus(body), body };
  } catch (err) {
    if (isDiagnosisContractError(err) && isClientContractError(err.code)) {
      return {
        status: 400,
        body: { error: { code: err.code, message: err.message } },
      };
    }
    throw err;
  }
}

export function bindDiagnosisReportApiHandlers(
  deps: ProductionQueryAdapterDeps,
  resolveAuth: (input: {
    params: unknown;
    client?: unknown;
  }) => ProductionAuthContext | null | Promise<ProductionAuthContext | null>,
) {
  const handle = (method: DiagnosisReportApiMethod) => {
    return async (ctx: {
      params: unknown;
      client?: unknown;
      respond: DiagnosisReportApiRespond;
    }) => {
      const result = await dispatchDiagnosisReportApi(
        {
          method,
          params: ctx.params,
          auth: await resolveAuth({ params: ctx.params, client: ctx.client }),
          clientTenantHints: clientHintsFromUnknown(ctx.params, ctx.client),
        },
        deps,
      );
      if (result.status === 200 && isProductionResponse(result.body)) {
        ctx.respond(true, result.body);
        return;
      }
      if (isProductionResponse(result.body)) {
        ctx.respond(false, result.body, {
          code: String(result.status),
          message: result.body.authorization.reason,
        });
        return;
      }
      ctx.respond(false, undefined, result.body.error);
    };
  };
  return {
    "diagnosis.reports.query": handle("diagnosis.reports.query"),
    "diagnosis.reports.get": handle("diagnosis.reports.get"),
  };
}

function isDiagnosisReportApiMethod(method: string): method is DiagnosisReportApiMethod {
  return (DIAGNOSIS_REPORT_API_METHODS as readonly string[]).includes(method);
}

function mapProductionStatus(body: ProductionQueryResponse): DiagnosisReportApiStatus {
  if (body.authorization.outcome === "allow") {
    return 200;
  }
  if (body.authorization.reason === "rate_limited") {
    return 429;
  }
  if (body.authorization.reason === "unavailable") {
    return 503;
  }
  if (
    body.authorization.reason === "invalid_cursor" ||
    body.authorization.reason === "cursor_expired"
  ) {
    return 400;
  }
  if (body.audit.denyReason === "unauthenticated") {
    return 401;
  }
  return 403;
}

function buildClaim(
  params: Record<string, unknown>,
  claimedTenantId: string | null | undefined,
): ProductionQueryClaim {
  const claim: ProductionQueryClaim = {
    mode: requireMode(params.mode),
  };
  if (claimedTenantId !== undefined) {
    claim.claimedTenantId = claimedTenantId;
  }
  assignOptionalString(claim, "caseId", params.caseId);
  assignOptionalString(claim, "reportId", params.reportId);
  assignOptionalString(claim, "sessionKeyHash", params.sessionKeyHash);
  assignOptionalString(claim, "cursor", params.cursor);
  if (params.limit !== undefined) {
    if (typeof params.limit !== "number") {
      throw new DiagnosisContractError("invalid_type", "limit must be a number", "limit");
    }
    claim.limit = params.limit;
  }
  if (params.sort !== undefined) {
    claim.sort = requireSort(params.sort);
  }
  const profile = optionalRedaction(params);
  if (profile) {
    claim.redactionProfile = profile;
  }
  return claim;
}

function resolveClaimedTenantId(
  params: Record<string, unknown>,
  hints: DiagnosisReportApiClientHints | undefined,
): string | null | undefined {
  const collected = [
    optionalTenant(params.tenantId),
    optionalTenant(params.claimedTenantId),
    optionalTenant(hints?.headerTenantId),
    optionalTenant(hints?.queryTenantId),
    optionalTenant(hints?.urlTenantId),
  ].filter((item): item is { present: true; value: string | null } => item.present);
  if (collected.length === 0) {
    return undefined;
  }
  const first = collected[0].value;
  if (collected.some((item) => item.value !== first)) {
    throw new DiagnosisContractError(
      "invalid_type",
      "client tenant hints conflict and are not trusted",
      "tenantId",
    );
  }
  return first;
}

function optionalTenant(value: unknown): { present: boolean; value: string | null } {
  if (value === undefined) {
    return { present: false, value: null };
  }
  if (value === null) {
    return { present: true, value: null };
  }
  if (typeof value !== "string" || value.length === 0) {
    throw new DiagnosisContractError(
      "invalid_type",
      "tenantId hint must be string | null",
      "tenantId",
    );
  }
  return { present: true, value };
}

function requireReportId(params: Record<string, unknown>): string {
  if (typeof params.reportId !== "string" || params.reportId.length === 0) {
    throw new DiagnosisContractError("missing_field", "reportId is required", "reportId");
  }
  return params.reportId;
}

function requireMode(value: unknown): ReportQueryMode {
  if (typeof value !== "string" || !(REPORT_QUERY_MODES as readonly string[]).includes(value)) {
    throw new DiagnosisContractError("invalid_literal", "mode is invalid", "mode");
  }
  return value as ReportQueryMode;
}

function requireSort(raw: unknown): ReportQuerySort {
  if (!isRecord(raw)) {
    throw new DiagnosisContractError("invalid_type", "sort must be an object", "sort");
  }
  if (
    typeof raw.key !== "string" ||
    !(REPORT_QUERY_SORT_KEYS as readonly string[]).includes(raw.key) ||
    typeof raw.direction !== "string" ||
    !(REPORT_QUERY_SORT_DIRECTIONS as readonly string[]).includes(raw.direction)
  ) {
    throw new DiagnosisContractError("invalid_literal", "sort is invalid", "sort");
  }
  return {
    key: raw.key as ReportQuerySort["key"],
    direction: raw.direction as ReportQuerySort["direction"],
  };
}

function optionalRedaction(
  params: Record<string, unknown>,
): ProductionRedactionProfile | undefined {
  if (params.redactionProfile === undefined) {
    return undefined;
  }
  if (
    typeof params.redactionProfile !== "string" ||
    !(PRODUCTION_REDACTION_PROFILES as readonly string[]).includes(params.redactionProfile)
  ) {
    throw new DiagnosisContractError(
      "invalid_literal",
      "redactionProfile is invalid",
      "redactionProfile",
    );
  }
  return params.redactionProfile as ProductionRedactionProfile;
}

function assignOptionalString<K extends "caseId" | "reportId" | "sessionKeyHash" | "cursor">(
  claim: ProductionQueryClaim,
  key: K,
  value: unknown,
): void {
  if (value === undefined) {
    return;
  }
  if (typeof value !== "string" || value.length === 0) {
    throw new DiagnosisContractError("invalid_type", `${key} must be a non-empty string`, key);
  }
  claim[key] = value;
}

function asParams(raw: unknown): Record<string, unknown> {
  if (raw === undefined) {
    return {};
  }
  if (!isRecord(raw)) {
    throw new DiagnosisContractError("invalid_type", "params must be an object", "params");
  }
  return raw;
}

function clientHintsFromUnknown(
  _params: unknown,
  client: unknown,
): DiagnosisReportApiClientHints | undefined {
  if (!isRecord(client)) {
    return undefined;
  }
  const hints: DiagnosisReportApiClientHints = {};
  if ("sessionTenantId" in client) {
    const hint = optionalTenant(client.sessionTenantId);
    if (hint.present) {
      hints.headerTenantId = hint.value;
    }
  }
  if (isRecord(client.connect) && "tenantId" in client.connect) {
    const hint = optionalTenant(client.connect.tenantId);
    if (hint.present) {
      hints.queryTenantId = hint.value;
    }
  }
  return Object.keys(hints).length > 0 ? hints : undefined;
}

function unauthenticatedResponse(): ProductionQueryResponse {
  const audit: ProductionQueryAuditRecord = {
    principalId: "unauthenticated",
    principalKind: "user",
    tenantId: null,
    mode: "report",
    targetDigest: {},
    resultCount: 0,
    decision: "deny",
    denyReason: "unauthenticated",
    redactionProfile: "user",
  };
  return {
    schemaVersion: PRODUCTION_QUERY_SCHEMA_VERSION,
    authorization: { outcome: "deny", reason: "forbidden" },
    items: [],
    nextCursor: null,
    redactionProfile: "user",
    audit,
  };
}

function isClientContractError(code: string): boolean {
  return (
    code === "invalid_type" ||
    code === "invalid_literal" ||
    code === "missing_field" ||
    code === "unknown_schema_version"
  );
}

function isProductionResponse(value: unknown): value is ProductionQueryResponse {
  return (
    isRecord(value) &&
    value.schemaVersion === PRODUCTION_QUERY_SCHEMA_VERSION &&
    isRecord(value.authorization)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
