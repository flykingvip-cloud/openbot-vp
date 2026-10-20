import { DIAGNOSIS_REPORT_API_METHODS } from "./report-query-api.js";
/**
 * Phase 3.7 — production integration review contracts.
 * Freezes auth, reader, audit, quota, and release-candidate gates.
 * Does not build, publish, restart, switch traffic, or flip the deploy flag.
 */
import { DIAGNOSIS_REPORT_API_DEPLOYED } from "./report-query-deploy.js";
import type {
  DiagnosisGatewayAuthClient,
  DiagnosisGatewayMembership,
} from "./report-query-gateway.js";
import {
  PRODUCTION_QUERY_ADMIN_CAPABILITY,
  PRODUCTION_QUERY_LOCAL_READ_CAPABILITY,
  PRODUCTION_QUERY_PRINCIPAL_QUOTA,
  PRODUCTION_QUERY_TENANT_QUOTA,
  createInMemoryProductionQueryAuditSink,
  createInMemoryProductionQueryQuota,
  executeProductionReportGet,
  executeProductionReportQuery,
  type ProductionAuthContext,
  type ProductionQueryAdapterDeps,
  type ProductionQueryAuditRecord,
  type ProductionQueryAuditSink,
  type ProductionQueryQuotaCounter,
  type ProductionQueryRequest,
  type ProductionGetRequest,
  type ProductionQueryResponse,
} from "./report-query-production.js";
import type { CompositeReportReader, ReportReaderFilter } from "./report-query.js";
import { FORBIDDEN_REPORT_PAYLOAD_KEYS } from "./report-validate.js";
import { DiagnosisContractError, isDiagnosisContractError } from "./types.js";

export const PRODUCTION_INTEGRATION_SCHEMA_VERSION = 1 as const;

/** Client fields that must never become trusted tenant. */
export const NON_AUTHORITATIVE_TENANT_SOURCES = [
  "url",
  "query",
  "body",
  "header",
  "sessionTenantId",
  "connect.tenantId",
  "claimedTenantId",
] as const;

export const PRODUCTION_QUOTA_WINDOW_MS = 60_000;
export const PRODUCTION_QUOTA_MAX_CONCURRENCY = 4;

export const FORBIDDEN_AUDIT_PAYLOAD_KEYS = [
  ...FORBIDDEN_REPORT_PAYLOAD_KEYS,
  "evidence",
  "evidences",
  "toolOutput",
  "modelSummary",
] as const;

export type DiagnosisProductionAuthInput = {
  client: DiagnosisGatewayAuthClient | null;
  membership: DiagnosisGatewayMembership | "unavailable";
};

export type DiagnosisProductionAuthRow = {
  id: string;
  sessionDomain: DiagnosisGatewayAuthClient["sessionDomain"] | undefined;
  sessionKind: string | undefined;
  membershipTenantId: string | null;
  membershipStatus: "resolved" | "unavailable";
  expected: "unauthenticated" | "tenant" | "local_read" | "platform_admin";
};

export const DIAGNOSIS_PRODUCTION_AUTH_MATRIX: readonly DiagnosisProductionAuthRow[] = [
  {
    id: "no-client",
    sessionDomain: undefined,
    sessionKind: undefined,
    membershipTenantId: null,
    membershipStatus: "resolved",
    expected: "unauthenticated",
  },
  {
    id: "missing-identity",
    sessionDomain: "enterprise",
    sessionKind: "member",
    membershipTenantId: "tenant-fixture-a",
    membershipStatus: "resolved",
    expected: "unauthenticated",
  },
  {
    id: "enterprise-member",
    sessionDomain: "enterprise",
    sessionKind: "member",
    membershipTenantId: "tenant-fixture-a",
    membershipStatus: "resolved",
    expected: "tenant",
  },
  {
    id: "employee-member",
    sessionDomain: "employee",
    sessionKind: "member",
    membershipTenantId: "tenant-fixture-a",
    membershipStatus: "resolved",
    expected: "tenant",
  },
  {
    id: "missing-domain-null-membership",
    sessionDomain: undefined,
    sessionKind: "member",
    membershipTenantId: null,
    membershipStatus: "resolved",
    expected: "unauthenticated",
  },
  {
    id: "employee-null-membership",
    sessionDomain: "employee",
    sessionKind: "member",
    membershipTenantId: null,
    membershipStatus: "resolved",
    expected: "tenant",
  },
  {
    id: "platform-domain-null-membership",
    sessionDomain: "platform",
    sessionKind: "operator",
    membershipTenantId: null,
    membershipStatus: "resolved",
    expected: "local_read",
  },
  {
    id: "platform-admin-no-domain",
    sessionDomain: undefined,
    sessionKind: "platform-admin",
    membershipTenantId: null,
    membershipStatus: "resolved",
    expected: "platform_admin",
  },
  {
    id: "platform-super-admin-no-domain",
    sessionDomain: undefined,
    sessionKind: "platform-super-admin",
    membershipTenantId: null,
    membershipStatus: "resolved",
    expected: "platform_admin",
  },
  {
    id: "auth-store-unavailable",
    sessionDomain: "platform",
    sessionKind: "platform-super-admin",
    membershipTenantId: null,
    membershipStatus: "unavailable",
    expected: "unauthenticated",
  },
];

export type ProductionReaderFault =
  | "missing"
  | "stale"
  | "tenant_mismatch"
  | "schema_incompatible"
  | "unavailable";

export type ProductionCompositeReportReaderPolicy = {
  maxAgeMs?: number;
  now?: () => number;
  trustedTenantId?: string | null;
};

export type ProductionAuditPersistResult = "recorded" | "unavailable";

export type ProductionAuditPersistSink = {
  persist(entry: ProductionQueryAuditRecord): Promise<ProductionAuditPersistResult>;
};

export type ProductionQuotaWindow = {
  windowMs: number;
  tenantLimit: number;
  principalLimit: number;
  maxConcurrency: number;
};

export type ProductionQuotaConsumeResult =
  | { ok: true; tenantUsed: number; principalUsed: number; inflight: number }
  | { ok: false; reason: "rate_limited" | "unavailable" };

export type ProductionQuotaStore = ProductionQueryQuotaCounter & {
  consumeWindow(
    tenantId: string | null,
    principalId: string,
  ): Promise<ProductionQuotaConsumeResult>;
  releaseWindow(tenantId: string | null, principalId: string): Promise<void>;
};

export const DIAGNOSIS_REPORT_RELEASE_CANDIDATE = {
  schemaVersion: PRODUCTION_INTEGRATION_SCHEMA_VERSION,
  packId: "diagnosis-reports",
  methods: DIAGNOSIS_REPORT_API_METHODS,
  operatorScope: "operator.read",
  deployFlagName: "DIAGNOSIS_REPORT_API_DEPLOYED",
  deployFlagValue: DIAGNOSIS_REPORT_API_DEPLOYED,
  livePackRegistration: false,
  productionBuild: false,
  trafficSwitch: false,
  canary: "not_authorized",
  rollback: {
    keepFlagFalse: true,
    doNotPublish: true,
    doNotRestart: true,
    doNotSwitchTraffic: true,
  },
  compatibility: [
    "schemaVersion=1",
    "cursor prefix pq1.",
    "trusted tenant from membership only",
    "empty in-memory reader is not a production database",
  ],
} as const;

export const COMPOSITE_REPORT_AUTHORITY_SOURCES = [
  {
    id: "composite_diagnosis_projection",
    role: "derived report",
    status: "PARTIAL",
    may: "inject already-built CompositeDiagnosisReport rows through CompositeReportReader",
    mustNot: "create a parallel Report DB or treat the projection as a fact store",
  },
  {
    id: "session_store",
    role: "session facts",
    status: "PARTIAL",
    may: "read session JSONL metadata already accepted by Phase 1 readers",
    mustNot: "copy message bodies into the report query path",
  },
  {
    id: "skill_invocation_event_store",
    role: "skill facts",
    status: "PARTIAL",
    may: "read skill-invocation events.jsonl",
    mustNot: "create a Skill Health DB or append invocations",
  },
  {
    id: "agent_tool_observations",
    role: "agent/tool facts",
    status: "PARTIAL",
    may: "read injected hook/diagnostic-event observations",
    mustNot: "invent type=agent_runner rows",
  },
] as const;

export function evaluateDiagnosisProductionAuth(
  input: DiagnosisProductionAuthInput,
): ProductionAuthContext | null {
  const { client, membership } = input;
  if (!client) {
    return null;
  }
  const hasIdentity = Boolean(client.user?.trim() || client.platformUserId?.trim());
  if (!hasIdentity) {
    return null;
  }
  if (membership === "unavailable") {
    return null;
  }

  const trustedTenantId = membership.tenantId;
  const principalId =
    membership.userId?.trim() || client.platformUserId?.trim() || client.user?.trim();
  if (!principalId) {
    return null;
  }
  if (
    trustedTenantId === null &&
    client.sessionDomain === undefined &&
    !isPlatformAdmin(client.sessionKind)
  ) {
    return null;
  }

  const capabilities: string[] = [];
  if (trustedTenantId === null && isLocalOrPlatformOperator(client)) {
    capabilities.push(PRODUCTION_QUERY_LOCAL_READ_CAPABILITY);
  }
  if (isPlatformAdmin(client.sessionKind)) {
    capabilities.push(PRODUCTION_QUERY_ADMIN_CAPABILITY);
    if (!capabilities.includes(PRODUCTION_QUERY_LOCAL_READ_CAPABILITY)) {
      capabilities.push(PRODUCTION_QUERY_LOCAL_READ_CAPABILITY);
    }
  }

  return {
    trusted: { tenantId: trustedTenantId },
    principal: {
      schemaVersion: 1,
      principalId,
      kind: trustedTenantId === null ? "system" : "user",
      tenantId: trustedTenantId,
    },
    ...(capabilities.length > 0 ? { capabilities } : {}),
  };
}

export function classifyProductionAuth(
  auth: ProductionAuthContext | null,
): DiagnosisProductionAuthRow["expected"] {
  if (!auth) {
    return "unauthenticated";
  }
  if (auth.capabilities?.includes(PRODUCTION_QUERY_ADMIN_CAPABILITY)) {
    return "platform_admin";
  }
  if (auth.capabilities?.includes(PRODUCTION_QUERY_LOCAL_READ_CAPABILITY)) {
    return "local_read";
  }
  return "tenant";
}

export function trustedTenantFromAuth(
  auth: ProductionAuthContext | null,
): string | null | undefined {
  return auth?.trusted.tenantId;
}

export function assertProductionAuditRecordSafe(entry: ProductionQueryAuditRecord): void {
  const raw = entry as unknown as Record<string, unknown>;
  for (const key of FORBIDDEN_AUDIT_PAYLOAD_KEYS) {
    if (key in raw) {
      throw new DiagnosisContractError(
        "audit_payload_forbidden",
        `production audit must not include ${key}`,
        key,
      );
    }
  }
  const encoded = JSON.stringify(entry);
  for (const needle of ["prompt", "tool-output", "model summary", "message body"]) {
    if (encoded.includes(needle)) {
      throw new DiagnosisContractError(
        "audit_payload_forbidden",
        "production audit must not include evidence or model payload text",
        "audit",
      );
    }
  }
}

export function createFailClosedAuditSink(
  persist: ProductionAuditPersistSink,
): ProductionQueryAuditSink & { entries: ProductionQueryAuditRecord[] } {
  const memory = createInMemoryProductionQueryAuditSink();
  return {
    entries: memory.entries,
    async record(entry) {
      assertProductionAuditRecordSafe(entry);
      await memory.record(entry);
      let result: ProductionAuditPersistResult;
      try {
        result = await persist.persist(entry);
      } catch {
        throw new DiagnosisContractError(
          "audit_unavailable",
          "production audit persist is unavailable",
          "audit",
        );
      }
      if (result === "unavailable") {
        throw new DiagnosisContractError(
          "audit_unavailable",
          "production audit persist is unavailable",
          "audit",
        );
      }
    },
  };
}

export function createInMemoryProductionAuditPersist(): ProductionAuditPersistSink & {
  entries: ProductionQueryAuditRecord[];
} {
  const entries: ProductionQueryAuditRecord[] = [];
  return {
    entries,
    async persist(entry) {
      assertProductionAuditRecordSafe(entry);
      entries.push(entry);
      return "recorded";
    },
  };
}

export function createUnavailableAuditPersist(): ProductionAuditPersistSink {
  return {
    async persist() {
      return "unavailable";
    },
  };
}

export function createWindowedProductionQuotaStore(
  window: Partial<ProductionQuotaWindow> = {},
): ProductionQuotaStore {
  const tenantLimit = window.tenantLimit ?? PRODUCTION_QUERY_TENANT_QUOTA;
  const principalLimit = window.principalLimit ?? PRODUCTION_QUERY_PRINCIPAL_QUOTA;
  const maxConcurrency = window.maxConcurrency ?? PRODUCTION_QUOTA_MAX_CONCURRENCY;
  const inner = createInMemoryProductionQueryQuota({ tenantLimit, principalLimit });
  let inflight = 0;
  const consume = (tenantId: string | null, principalId: string) => {
    if (inflight >= maxConcurrency) {
      return "rate_limited" as const;
    }
    inflight += 1;
    try {
      return inner.consume(tenantId, principalId);
    } finally {
      inflight -= 1;
    }
  };
  return {
    consume,
    async consumeWindow(tenantId, principalId) {
      const result = consume(tenantId, principalId);
      if (result === "rate_limited") {
        return { ok: false, reason: "rate_limited" };
      }
      return {
        ok: true,
        tenantUsed: result.tenantUsed,
        principalUsed: result.principalUsed,
        inflight,
      };
    },
    async releaseWindow() {},
  };
}

export function createUnavailableQuotaStore(): ProductionQuotaStore {
  return {
    consume() {
      throw new DiagnosisContractError(
        "quota_unavailable",
        "production quota store is unavailable",
        "quota",
      );
    },
    async consumeWindow() {
      return { ok: false, reason: "unavailable" };
    },
    async releaseWindow() {},
  };
}

export function wrapProductionCompositeReportReader(
  reader: CompositeReportReader,
  policy: ProductionCompositeReportReaderPolicy = {},
): CompositeReportReader {
  return {
    async list(filter: ReportReaderFilter) {
      let rows: readonly unknown[];
      try {
        rows = await reader.list(filter);
      } catch (err) {
        throw classifyReaderThrow(err);
      }
      return rows.filter(
        (row) =>
          acceptProductionReaderRow(row, filter.tenantId ?? policy.trustedTenantId, policy) !==
          "drop",
      );
    },
    async get(reportId: string) {
      let row: unknown;
      try {
        row = await reader.get(reportId);
      } catch (err) {
        throw classifyReaderThrow(err);
      }
      if (row == null) {
        return undefined;
      }
      return acceptProductionReaderRow(row, policy.trustedTenantId, policy) === "drop"
        ? undefined
        : row;
    },
  };
}

export function classifyProductionReaderFault(err: unknown): ProductionReaderFault | null {
  if (!isDiagnosisContractError(err)) {
    return null;
  }
  if (err.code === "reader_unavailable") {
    return "unavailable";
  }
  if (err.code === "unknown_schema_version") {
    return "schema_incompatible";
  }
  if (err.code === "tenant_mismatch" || err.code === "report_tenant_mismatch") {
    return "tenant_mismatch";
  }
  if (err.code === "report_not_found") {
    return "missing";
  }
  if (err.code === "source_expired") {
    return "stale";
  }
  return null;
}

export async function executeProductionIntegrationQuery(
  request: ProductionQueryRequest,
  deps: ProductionQueryAdapterDeps,
): Promise<ProductionQueryResponse> {
  return executeProductionReportQuery(request, deps);
}

export async function executeProductionIntegrationGet(
  request: ProductionGetRequest,
  deps: ProductionQueryAdapterDeps,
): Promise<ProductionQueryResponse> {
  return executeProductionReportGet(request, deps);
}

function acceptProductionReaderRow(
  row: unknown,
  trustedTenantId: string | null | undefined,
  policy: ProductionCompositeReportReaderPolicy,
): "keep" | "drop" {
  if (!row || typeof row !== "object") {
    return "drop";
  }
  const record = row as Record<string, unknown>;
  if (record.schemaVersion !== 1) {
    return "drop";
  }
  if (
    trustedTenantId !== undefined &&
    Object.hasOwn(record, "tenantId") &&
    record.tenantId !== trustedTenantId
  ) {
    return "drop";
  }
  if (typeof record.generatedAt === "string" && policy.maxAgeMs !== undefined) {
    const generatedAt = Date.parse(record.generatedAt);
    const now = policy.now?.() ?? Date.now();
    if (Number.isNaN(generatedAt) || generatedAt + policy.maxAgeMs < now) {
      return "drop";
    }
  }
  return "keep";
}

function classifyReaderThrow(err: unknown): DiagnosisContractError {
  const classified = classifyProductionReaderFault(err);
  if (classified === "unavailable" && isDiagnosisContractError(err)) {
    return err;
  }
  if (isDiagnosisContractError(err)) {
    return err;
  }
  return new DiagnosisContractError(
    "reader_unavailable",
    "production report reader is unavailable",
    "reader",
  );
}

function isPlatformAdmin(sessionKind: string | undefined): boolean {
  return sessionKind === "platform-super-admin" || sessionKind === "platform-admin";
}

function isLocalOrPlatformOperator(client: DiagnosisGatewayAuthClient): boolean {
  return client.sessionDomain === "platform" || isPlatformAdmin(client.sessionKind);
}
