/**
 * Phase 3.8 — production reader / audit / quota adapters.
 * Designed-safe default / rollback is off (`DIAGNOSIS_PRODUCTION_GATES.adapters.default`).
 * Current compile-time value is true (O1.1 step 3: read-only query/get after signed enablement).
 * Does not flip DIAGNOSIS_REPORT_API_DEPLOYED or register live packs.
 * Reads existing Composite Diagnosis projections only. No Report DB.
 */
import { DIAGNOSIS_REPORT_API_DEPLOYED } from "./report-query-deploy.js";
import {
  FORBIDDEN_AUDIT_PAYLOAD_KEYS,
  PRODUCTION_QUOTA_MAX_CONCURRENCY,
  PRODUCTION_QUOTA_WINDOW_MS,
  assertProductionAuditRecordSafe,
  createFailClosedAuditSink,
  wrapProductionCompositeReportReader,
  type ProductionAuditPersistSink,
  type ProductionCompositeReportReaderPolicy,
  type ProductionQuotaStore,
  type ProductionQuotaWindow,
  type ProductionReaderFault,
} from "./report-query-production-integration.js";
import {
  PRODUCTION_QUERY_PRINCIPAL_QUOTA,
  PRODUCTION_QUERY_TENANT_QUOTA,
  createInMemoryProductionQueryAuditSink,
  createInMemoryProductionQueryQuota,
  type ProductionQueryAdapterDeps,
  type ProductionQueryAuditRecord,
} from "./report-query-production.js";
import {
  createInMemoryCompositeReportReader,
  type CompositeReportReader,
  type ReportReaderFilter,
} from "./report-query.js";
import { FORBIDDEN_REPORT_PAYLOAD_KEYS } from "./report-validate.js";
import { DiagnosisContractError } from "./types.js";

/** Adapter wiring gate. Independent of live pack registration. */
/** O1.1 step 3: production adapters for read-only query/get after signed enablement. */
export const DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED = true;

export const PRODUCTION_AUDIT_ALLOWED_KEYS = [
  "principalId",
  "principalKind",
  "tenantId",
  "mode",
  "targetDigest",
  "resultCount",
  "decision",
  "denyReason",
  "redactionProfile",
] as const;

export const PRODUCTION_ADAPTER_STORAGE = {
  reader: {
    kind: "composite_diagnosis_projection_snapshot",
    authority: "existing CompositeDiagnosis projection",
    not: "Report DB / Skill Health DB / new diagnosis fact store",
  },
  audit: {
    kind: "append_only_audit_sink",
    locator: "$CONFIG_DIR/diagnosis-audit/",
    retention: "platform-audit-retention",
    secretSource: "host-injected-backend-only",
  },
  quota: {
    kind: "windowed_counter",
    locator: "injected quota backend or process-local window maps",
    secretSource: "host-injected-backend-only",
  },
  rollback: {
    disableAdapters: true,
    keepDeployFlagFalse: true,
    doNotRestartOrSwitchTraffic: true,
  },
} as const;

export type ProductionReportAuthoritySource = {
  list(filter: ReportReaderFilter): Promise<readonly unknown[]>;
  get(reportId: string): Promise<unknown>;
};

export type ProductionAuditAppendBackend = {
  append(record: ProductionQueryAuditRecord): Promise<"appended" | "unavailable">;
};

export type ProductionQuotaCounterBackend = {
  increment(bucket: string): Promise<number | "unavailable">;
  acquireLease(slotKey: string): Promise<boolean | "unavailable">;
  releaseLease(slotKey: string): Promise<void>;
};

export type ProductionAdapterBackends = {
  reportSource: ProductionReportAuthoritySource;
  auditAppend: ProductionAuditAppendBackend;
  quota?: ProductionQuotaCounterBackend;
};

export type ProductionQuotaStoreAdapter = ProductionQuotaStore & {
  releaseWindow(tenantId: string | null, principalId: string): Promise<void>;
};

export function createProjectionAuthoritySource(
  reports: readonly unknown[],
): ProductionReportAuthoritySource {
  return {
    async list() {
      return reports;
    },
    async get(reportId) {
      return reports.find((item) => isRecord(item) && item.reportId === reportId);
    },
  };
}

export function createUnavailableReportSource(): ProductionReportAuthoritySource {
  return {
    async list() {
      throw new Error("projection store unavailable");
    },
    async get() {
      throw new Error("projection store unavailable");
    },
  };
}

export function classifyProductionReaderRow(
  row: unknown,
  policy: ProductionCompositeReportReaderPolicy = {},
): ProductionReaderFault | null {
  if (row == null) {
    return "missing";
  }
  if (!isRecord(row) || row.schemaVersion !== 1) {
    return "schema_incompatible";
  }
  if (hasForbiddenPayload(row)) {
    return "schema_incompatible";
  }
  if (policy.trustedTenantId !== undefined && row.tenantId !== policy.trustedTenantId) {
    return "tenant_mismatch";
  }
  if (typeof row.generatedAt === "string" && policy.maxAgeMs !== undefined) {
    const generatedAt = Date.parse(row.generatedAt);
    const now = policy.now?.() ?? Date.now();
    if (Number.isNaN(generatedAt) || generatedAt + policy.maxAgeMs < now) {
      return "stale";
    }
  }
  return null;
}

export function createProductionCompositeReportReader(
  source: ProductionReportAuthoritySource,
  policy: ProductionCompositeReportReaderPolicy = {},
): CompositeReportReader {
  const wrapped = wrapProductionCompositeReportReader(
    {
      list: (filter) => source.list(filter),
      get: (reportId) => source.get(reportId),
    },
    policy,
  );
  return {
    async list(filter) {
      const rows = await wrapped.list(filter);
      return rows.filter(
        (row) => classifyProductionReaderRow(row, policyFor(filter, policy)) === null,
      );
    },
    async get(reportId) {
      const row = await wrapped.get(reportId);
      if (classifyProductionReaderRow(row, policy) !== null) {
        return undefined;
      }
      return row;
    },
  };
}

export function createProductionAuditPersistSink(
  backend: ProductionAuditAppendBackend,
): ProductionAuditPersistSink {
  return {
    async persist(entry) {
      assertProductionAuditRecordSafe(entry);
      const safe = pickAuditFields(entry);
      assertProductionAuditRecordSafe(safe);
      try {
        const result = await backend.append(safe);
        return result === "appended" ? "recorded" : "unavailable";
      } catch {
        return "unavailable";
      }
    },
  };
}

export function createMemoryAuditAppendBackend(): ProductionAuditAppendBackend & {
  entries: ProductionQueryAuditRecord[];
} {
  const entries: ProductionQueryAuditRecord[] = [];
  return {
    entries,
    async append(record) {
      assertProductionAuditRecordSafe(record);
      entries.push(record);
      return "appended";
    },
  };
}

export function createUnavailableAuditAppendBackend(): ProductionAuditAppendBackend {
  return {
    async append() {
      return "unavailable";
    },
  };
}

export function createRejectingAuditAppendBackend(): ProductionAuditAppendBackend {
  return {
    async append() {
      throw new Error("audit append rejected");
    },
  };
}

export function createProductionQuotaStore(options: {
  window?: Partial<ProductionQuotaWindow>;
  backend?: ProductionQuotaCounterBackend;
  now?: () => number;
}): ProductionQuotaStoreAdapter {
  const window: ProductionQuotaWindow = {
    windowMs: options.window?.windowMs ?? PRODUCTION_QUOTA_WINDOW_MS,
    tenantLimit: options.window?.tenantLimit ?? PRODUCTION_QUERY_TENANT_QUOTA,
    principalLimit: options.window?.principalLimit ?? PRODUCTION_QUERY_PRINCIPAL_QUOTA,
    maxConcurrency: options.window?.maxConcurrency ?? PRODUCTION_QUOTA_MAX_CONCURRENCY,
  };
  const backend = options.backend;
  const now = options.now ?? Date.now;
  const counts = new Map<string, number>();
  const held = new Set<string>();

  const consumeSync = (
    tenantId: string | null,
    principalId: string,
  ): { tenantUsed: number; principalUsed: number } | "rate_limited" => {
    if (isMarkedUnavailable(backend)) {
      throw quotaUnavailableError();
    }
    const windowId = quotaWindowId(now(), window.windowMs);
    const tenantKey = `tenant:${tenantId ?? "local"}:${windowId}`;
    const principalKey = `principal:${principalId}:${windowId}`;
    const tenantUsed = (counts.get(tenantKey) ?? 0) + 1;
    const principalUsed = (counts.get(principalKey) ?? 0) + 1;
    if (tenantUsed > window.tenantLimit || principalUsed > window.principalLimit) {
      return "rate_limited";
    }
    counts.set(tenantKey, tenantUsed);
    counts.set(principalKey, principalUsed);
    return { tenantUsed, principalUsed };
  };

  return {
    consume(tenantId, principalId) {
      return consumeSync(tenantId, principalId);
    },
    async consumeWindow(tenantId, principalId) {
      const slotKey = `${tenantId ?? "local"}:${principalId}`;
      if (isMarkedUnavailable(backend)) {
        return { ok: false, reason: "unavailable" };
      }
      if (held.has(slotKey) || held.size >= window.maxConcurrency) {
        return { ok: false, reason: "rate_limited" };
      }
      let acquired = false;
      try {
        if (backend) {
          const lease = await backend.acquireLease(slotKey);
          if (lease === "unavailable") {
            return { ok: false, reason: "unavailable" };
          }
          if (!lease) {
            return { ok: false, reason: "rate_limited" };
          }
        }
        held.add(slotKey);
        acquired = true;
        if (backend) {
          const windowId = quotaWindowId(now(), window.windowMs);
          let remoteTenant: number | "unavailable";
          try {
            remoteTenant = await backend.increment(`tenant:${tenantId ?? "local"}:${windowId}`);
          } catch {
            throw quotaUnavailableError();
          }
          if (remoteTenant === "unavailable") {
            throw quotaUnavailableError();
          }
        }
        const counted = consumeSync(tenantId, principalId);
        if (counted === "rate_limited") {
          await releaseSlot(held, backend, slotKey);
          return { ok: false, reason: "rate_limited" };
        }
        return { ok: true, ...counted, inflight: held.size };
      } catch (err) {
        if (acquired) {
          await releaseSlot(held, backend, slotKey);
        }
        if (isQuotaUnavailable(err)) {
          return { ok: false, reason: "unavailable" };
        }
        throw err;
      }
    },
    async releaseWindow(tenantId, principalId) {
      await releaseSlot(held, backend, `${tenantId ?? "local"}:${principalId}`);
    },
  };
}

export function createUnavailableQuotaBackend(): ProductionQuotaCounterBackend & {
  unavailable: true;
} {
  return {
    unavailable: true,
    async increment() {
      return "unavailable";
    },
    async acquireLease() {
      return "unavailable";
    },
    async releaseLease() {},
  };
}

export function resolveProductionAdapterDeps(
  input: {
    enabled?: boolean;
    backends?: ProductionAdapterBackends;
    readerPolicy?: ProductionCompositeReportReaderPolicy;
    quotaWindow?: Partial<ProductionQuotaWindow>;
    now?: () => number;
  } = {},
): ProductionQueryAdapterDeps {
  const enabled = input.enabled ?? DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED;
  if (!enabled) {
    return {
      reader: createInMemoryCompositeReportReader([]),
      audit: createInMemoryProductionQueryAuditSink(),
      quota: createInMemoryProductionQueryQuota(),
    };
  }
  const backends = input.backends;
  if (!backends?.reportSource || !backends.auditAppend) {
    throw new DiagnosisContractError(
      "production_adapters_required",
      "production adapters are enabled but report/audit backends are missing",
      "adapters",
    );
  }
  return {
    reader: createProductionCompositeReportReader(backends.reportSource, input.readerPolicy),
    audit: createFailClosedAuditSink(createProductionAuditPersistSink(backends.auditAppend)),
    quota: createProductionQuotaStore({
      window: input.quotaWindow,
      ...(backends.quota ? { backend: backends.quota } : {}),
      ...(input.now ? { now: input.now } : {}),
    }),
  };
}

export function assertProductionAdaptersUndeployed(): void {
  // P3.8 historical lock. Later enablement increments own the live flags.
  void DIAGNOSIS_REPORT_API_DEPLOYED;
  void DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED;
}

function pickAuditFields(entry: ProductionQueryAuditRecord): ProductionQueryAuditRecord {
  const safe: ProductionQueryAuditRecord = {
    principalId: entry.principalId,
    principalKind: entry.principalKind,
    tenantId: entry.tenantId,
    mode: entry.mode,
    targetDigest: { ...entry.targetDigest },
    resultCount: entry.resultCount,
    decision: entry.decision,
    redactionProfile: entry.redactionProfile,
  };
  if (entry.denyReason) {
    safe.denyReason = entry.denyReason;
  }
  for (const key of Object.keys(safe)) {
    if (!(PRODUCTION_AUDIT_ALLOWED_KEYS as readonly string[]).includes(key)) {
      throw new DiagnosisContractError(
        "audit_payload_forbidden",
        `production audit must not persist ${key}`,
        key,
      );
    }
  }
  for (const key of FORBIDDEN_AUDIT_PAYLOAD_KEYS) {
    if (key in (entry as unknown as Record<string, unknown>)) {
      throw new DiagnosisContractError(
        "audit_payload_forbidden",
        `production audit must not include ${key}`,
        key,
      );
    }
  }
  return safe;
}

function hasForbiddenPayload(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some(hasForbiddenPayload);
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if ((FORBIDDEN_REPORT_PAYLOAD_KEYS as readonly string[]).includes(key)) {
      return true;
    }
    if (hasForbiddenPayload(record[key])) {
      return true;
    }
  }
  return false;
}

function policyFor(
  filter: ReportReaderFilter,
  policy: ProductionCompositeReportReaderPolicy,
): ProductionCompositeReportReaderPolicy {
  return {
    ...policy,
    trustedTenantId: filter.tenantId ?? policy.trustedTenantId,
  };
}

function quotaWindowId(nowMs: number, windowMs: number): number {
  return Math.floor(nowMs / windowMs);
}

async function releaseSlot(
  held: Set<string>,
  backend: ProductionQuotaCounterBackend | undefined,
  slotKey: string,
): Promise<void> {
  held.delete(slotKey);
  if (backend) {
    await backend.releaseLease(slotKey);
  }
}

function isMarkedUnavailable(backend: ProductionQuotaCounterBackend | undefined): boolean {
  return Boolean(backend && "unavailable" in backend && backend.unavailable);
}

function quotaUnavailableError(): DiagnosisContractError {
  return new DiagnosisContractError(
    "quota_unavailable",
    "production quota store is unavailable",
    "quota",
  );
}

function isQuotaUnavailable(err: unknown): boolean {
  return err instanceof DiagnosisContractError && err.code === "quota_unavailable";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
