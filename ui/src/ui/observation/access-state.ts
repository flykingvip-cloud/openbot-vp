/**
 * Display-boundary access helpers for the diagnosis/observation workbench.
 * Identity, tenant, and visible runs are confirmed by the server; URL params
 * and client role only express a request and never grant access.
 */
import type { ObservationRun } from "./model.ts";

export const PRECISE_QUERY_MISS_COPY = "当前授权范围内未找到匹配记录";
export const AUTH_INVALID_COPY = "当前授权已失效，不返回运行细节。";
export const AUTH_UNCONFIRMED_COPY = "当前授权尚未确认，不返回运行细节。";
export const NO_GRANT_COPY = "当前租户筛选无授权，不返回该租户运行细节。";
export const TENANT_GRANT_UNCONFIRMED_COPY = "当前租户授权尚未确认，不返回该租户运行细节。";
export const RUN_DENIED_COPY = "当前授权范围内不可打开该证据。";
export const VERIFICATION_INELIGIBLE_COPY = "收到验证回执，资格校验未通过";

export const OBSERVATION_READ_SCOPES = ["operator.read", "operator.admin"] as const;

export type ObservationAccessCode =
  | "ok"
  | "auth_invalid"
  | "auth_unconfirmed"
  | "no_grant"
  | "grant_unconfirmed"
  | "run_out_of_scope";

export type ObservationAccessDecision = {
  ok: boolean;
  code: ObservationAccessCode;
  message: string;
};

export type TenantGrant = "granted" | "none" | "unknown";

export type ObservationAccessInput = {
  /**
   * Server-confirmed display boundary.
   * `true` / `false` only after the server has returned a result.
   * `null` means omitted or not yet received — unconfirmed, not a grant.
   */
  authorized: boolean | null;
  role: "platform" | "enterprise";
  actorTenantId: string | null;
  tenantFilter: string;
  /**
   * Platform tenant-filter grant as confirmed by the server.
   * `unknown` only when the server has not yet returned a result.
   * It must not invent a denial and must not be treated as authorized.
   */
  tenantGrant: TenantGrant;
};

/** Only `granted` / `none` count as a server result. Anything else stays unknown. */
export function resolveTenantGrant(value: unknown): TenantGrant {
  return value === "granted" || value === "none" ? value : "unknown";
}

export type ObservationTenantGrantSource = {
  tenantId?: string | null;
  id?: string | null;
  tenantGrant?: unknown;
};

/**
 * Project server-confirmed tenant grants for the workbench display boundary.
 * Directory presence, billing status, sample fixtures, and role are ignored.
 * `null` / `undefined` means the server result has not arrived yet.
 * Missing or unrecognized values stay `unknown` and must not become `none`.
 */
export function projectObservationTenantGrants(
  sources:
    | readonly ObservationTenantGrantSource[]
    | Readonly<Record<string, unknown>>
    | null
    | undefined,
): Readonly<Record<string, TenantGrant>> | null {
  if (sources == null) {
    return null;
  }
  const grants: Record<string, TenantGrant> = {};
  if (Array.isArray(sources)) {
    for (const row of sources) {
      const tenantId = (row.tenantId ?? row.id)?.trim();
      if (!tenantId) {
        continue;
      }
      grants[tenantId] = resolveTenantGrant(row.tenantGrant);
    }
    return grants;
  }
  for (const [tenantId, value] of Object.entries(sources)) {
    const id = tenantId.trim();
    if (!id) {
      continue;
    }
    grants[id] = resolveTenantGrant(value);
  }
  return grants;
}

export function hasObservationReadScope(scopes: readonly string[] | null | undefined): boolean {
  return Boolean(
    scopes?.some((scope) => (OBSERVATION_READ_SCOPES as readonly string[]).includes(scope)),
  );
}

export function resolveObservationAuthorized(input: {
  authorized?: boolean | null;
  scopes?: readonly string[] | null;
}): boolean | null {
  if (input.authorized === false) {
    return false;
  }
  if (input.scopes !== undefined && input.scopes !== null) {
    return hasObservationReadScope(input.scopes);
  }
  if (input.authorized === true) {
    return true;
  }
  // Omitted, null, or not yet received: unconfirmed. Do not default to true.
  return null;
}

export function currentAuthorization(input: ObservationAccessInput): ObservationAccessDecision {
  if (input.authorized === false) {
    return { ok: false, code: "auth_invalid", message: AUTH_INVALID_COPY };
  }
  if (input.authorized !== true) {
    return { ok: false, code: "auth_unconfirmed", message: AUTH_UNCONFIRMED_COPY };
  }
  if (input.role === "enterprise" && !input.actorTenantId) {
    return { ok: false, code: "no_grant", message: NO_GRANT_COPY };
  }
  if (input.role === "platform" && input.tenantFilter !== "all") {
    if (input.tenantGrant === "none") {
      return { ok: false, code: "no_grant", message: NO_GRANT_COPY };
    }
    if (input.tenantGrant !== "granted") {
      return {
        ok: false,
        code: "grant_unconfirmed",
        message: TENANT_GRANT_UNCONFIRMED_COPY,
      };
    }
  }
  return { ok: true, code: "ok", message: "" };
}

export function canAccessRun(
  input: ObservationAccessInput & { run: ObservationRun | null | undefined },
): ObservationAccessDecision {
  const authorization = currentAuthorization(input);
  if (!authorization.ok) {
    return authorization;
  }
  if (!input.run) {
    return { ok: false, code: "run_out_of_scope", message: RUN_DENIED_COPY };
  }
  if (
    input.role === "enterprise" &&
    input.run.tenantId &&
    input.run.tenantId !== input.actorTenantId
  ) {
    return { ok: false, code: "run_out_of_scope", message: RUN_DENIED_COPY };
  }
  if (
    input.role === "platform" &&
    input.tenantFilter !== "all" &&
    input.run.tenantId !== input.tenantFilter
  ) {
    return { ok: false, code: "run_out_of_scope", message: RUN_DENIED_COPY };
  }
  return { ok: true, code: "ok", message: "" };
}

export function accessibleRuns(
  runs: readonly ObservationRun[],
  input: ObservationAccessInput,
): ObservationRun[] {
  if (!currentAuthorization(input).ok) {
    return [];
  }
  return runs.filter((run) => canAccessRun({ ...input, run }).ok);
}

const PRECISE_QUERY_MISS_TOKENS = [
  "unauthorized",
  "forbidden",
  "not_found",
  "not found",
  "401",
  "403",
  "404",
];

function errorText(err: unknown): string {
  if (typeof err === "string") {
    return err;
  }
  if (err && typeof err === "object") {
    const record = err as {
      message?: unknown;
      gatewayCode?: unknown;
      code?: unknown;
      reason?: unknown;
    };
    return [record.gatewayCode, record.code, record.reason, record.message]
      .filter((value) => value !== undefined && value !== null)
      .map(String)
      .join(" ");
  }
  return "";
}

/** Precise-query miss / denial share one user copy and must not hint at other tenants. */
export function isPreciseQueryMiss(err: unknown): boolean {
  const text = errorText(err).toLowerCase();
  return PRECISE_QUERY_MISS_TOKENS.some((token) => text.includes(token));
}

export function preciseQueryMissCopy(err: unknown): string | null {
  return isPreciseQueryMiss(err) ? PRECISE_QUERY_MISS_COPY : null;
}

export type VerificationReceiptView = {
  received: boolean;
  eligible: boolean | null;
  passed: boolean | null;
  label: string;
};

export function projectVerificationReceipt(
  verification:
    | {
        verificationId?: string | null;
        eligible?: boolean;
        passed?: boolean;
      }
    | null
    | undefined,
): VerificationReceiptView {
  if (!verification?.verificationId) {
    return { received: false, eligible: null, passed: null, label: "无验证回执" };
  }
  if (verification.eligible !== true || verification.passed !== true) {
    return {
      received: true,
      eligible: verification.eligible === true,
      passed: verification.passed === true,
      label: VERIFICATION_INELIGIBLE_COPY,
    };
  }
  return {
    received: true,
    eligible: true,
    passed: true,
    label: "收到验证回执，资格校验已记录",
  };
}

export type ObservationDrawerRequest = {
  runId: string | null;
  drawer: boolean;
};

export function readDrawerRequest(search: string): ObservationDrawerRequest {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const runId = params.get("run")?.trim() || null;
  const drawerRaw = params.get("drawer")?.trim();
  const drawer = drawerRaw === "1" || drawerRaw === "true";
  return { runId, drawer };
}

function writeSearch(params: URLSearchParams): string {
  const text = params.toString();
  return text ? `?${text}` : "";
}

export function applyDrawerParams(search: string, request: ObservationDrawerRequest): string {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  if (!request.drawer || !request.runId) {
    params.delete("drawer");
    params.delete("run");
  } else {
    params.set("drawer", "1");
    params.set("run", request.runId);
  }
  return writeSearch(params);
}

export function stripDrawerParams(search: string): string {
  return applyDrawerParams(search, { runId: null, drawer: false });
}

export function resolveDrawerSelection(input: {
  access: ObservationAccessInput;
  runs: readonly ObservationRun[];
  allRuns?: readonly ObservationRun[];
  selectedId?: string | null;
  requestedRunId?: string | null;
  expanded?: boolean;
  requestedDrawer?: boolean;
}): {
  run: ObservationRun | undefined;
  expanded: boolean;
  notice: string | null;
  deny: boolean;
  url: ObservationDrawerRequest;
} {
  const requestedId = input.selectedId ?? input.requestedRunId ?? null;
  const wantsDrawer = Boolean(input.expanded || input.requestedDrawer);
  if (!requestedId && !wantsDrawer) {
    return {
      run: undefined,
      expanded: false,
      notice: null,
      deny: false,
      url: { runId: null, drawer: false },
    };
  }
  const pool = input.allRuns ?? input.runs;
  const candidate =
    pool.find((row) => row.id === requestedId || row.clientRunId === requestedId) ?? null;
  const access = canAccessRun({ ...input.access, run: candidate });
  const allowed = candidate
    ? input.runs.find((row) => row.id === candidate.id && row.sample === candidate.sample)
    : undefined;
  if (!access.ok || !allowed) {
    return {
      run: undefined,
      expanded: false,
      notice: access.ok ? RUN_DENIED_COPY : access.message,
      deny: true,
      url: { runId: null, drawer: false },
    };
  }
  return {
    run: allowed,
    expanded: wantsDrawer,
    notice: null,
    deny: false,
    url: { runId: wantsDrawer ? allowed.id : null, drawer: wantsDrawer },
  };
}

export const METRIC_FILTER_LABELS: Record<string, string> = {
  active_runs: "活跃运行",
  event_receive_rate: "元数据事件",
  run_completion_rate: "生命周期完成",
  latency_p50: "已关联时延 P50",
  latency_p95: "已关联时延 P95",
  tool_calls: "工具调用",
  sequence_or_link_gaps: "证据缺口",
  business_acceptance: "业务验收",
  attributed_cost: "可归属成本",
};

export function metricScopeHint(metricKey: string, listCount: number): string | null {
  if (!metricKey || metricKey === "all") {
    return null;
  }
  const label = METRIC_FILTER_LABELS[metricKey] ?? metricKey;
  return `下方列表已按「${label}」筛选，共 ${listCount} 条。顶部指标仍按原筛选集合统计，分母未改变。`;
}
