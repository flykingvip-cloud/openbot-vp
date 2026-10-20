/**
 * Phase 3.9 — diagnosis production adapter config schema.
 * Rehearsal only. Defaults stay off. No credentials, hosts, or production URLs.
 */
import {
  resolveProductionAdapterDeps,
  type ProductionAdapterBackends,
} from "./report-query-production-adapters.js";
import {
  PRODUCTION_QUOTA_MAX_CONCURRENCY,
  PRODUCTION_QUOTA_WINDOW_MS,
  type ProductionCompositeReportReaderPolicy,
  type ProductionQuotaWindow,
} from "./report-query-production-integration.js";
import {
  PRODUCTION_QUERY_PRINCIPAL_QUOTA,
  PRODUCTION_QUERY_TENANT_QUOTA,
  type ProductionQueryAdapterDeps,
} from "./report-query-production.js";
import { DiagnosisContractError } from "./types.js";

export const DIAGNOSIS_PRODUCTION_REPORT_SOURCE_KIND =
  "composite_diagnosis_projection_snapshot" as const;
export const DIAGNOSIS_PRODUCTION_AUDIT_BACKEND_KIND = "append_only_audit_sink" as const;
export const DIAGNOSIS_PRODUCTION_QUOTA_BACKEND_KIND = "windowed_counter" as const;
export const DIAGNOSIS_PRODUCTION_AUDIT_LOCATOR = "$CONFIG_DIR/diagnosis-audit/" as const;

const FORBIDDEN_BACKEND_KEYS = [
  "url",
  "uri",
  "host",
  "hostname",
  "password",
  "secret",
  "token",
  "apiKey",
  "api_key",
  "credential",
  "credentials",
  "connectionString",
  "connection_string",
  "endpoint",
  "dsn",
  "accessKey",
  "privateKey",
] as const;

const FORBIDDEN_VALUE_PATTERN =
  /https?:\/\/|[a-z0-9.-]+\.(love|com|io|internal|local)\b|:\d{2,5}\b|process\.env/i;

export type DiagnosisProductionBackendRef = {
  kind: string;
  locator?: string;
};

export type DiagnosisProductionAdapterConfig = {
  enabled: boolean;
  reportSourceBackend: DiagnosisProductionBackendRef | null;
  auditPersistBackend: DiagnosisProductionBackendRef | null;
  quotaBackend: DiagnosisProductionBackendRef | null;
  readerMaxAgeMs: number | null;
  quotaWindow: ProductionQuotaWindow;
};

export const DIAGNOSIS_PRODUCTION_ADAPTER_CONFIG_DEFAULTS: DiagnosisProductionAdapterConfig = {
  enabled: false,
  reportSourceBackend: null,
  auditPersistBackend: null,
  quotaBackend: null,
  readerMaxAgeMs: null,
  quotaWindow: {
    windowMs: PRODUCTION_QUOTA_WINDOW_MS,
    tenantLimit: PRODUCTION_QUERY_TENANT_QUOTA,
    principalLimit: PRODUCTION_QUERY_PRINCIPAL_QUOTA,
    maxConcurrency: PRODUCTION_QUOTA_MAX_CONCURRENCY,
  },
};

export function parseDiagnosisProductionAdapterConfig(
  input?: unknown,
): DiagnosisProductionAdapterConfig {
  if (input === undefined || input === null) {
    return { ...DIAGNOSIS_PRODUCTION_ADAPTER_CONFIG_DEFAULTS };
  }
  if (!isRecord(input)) {
    throw configError("production_config_invalid", "production adapter config must be an object");
  }
  rejectForbiddenShape(input, "config");
  const enabled = parseEnabled(input.enabled);
  const reportSourceBackend = parseBackendRef(
    input.reportSourceBackend,
    "reportSourceBackend",
    DIAGNOSIS_PRODUCTION_REPORT_SOURCE_KIND,
    enabled,
  );
  const auditPersistBackend = parseBackendRef(
    input.auditPersistBackend,
    "auditPersistBackend",
    DIAGNOSIS_PRODUCTION_AUDIT_BACKEND_KIND,
    enabled,
    DIAGNOSIS_PRODUCTION_AUDIT_LOCATOR,
  );
  const quotaBackend = parseBackendRef(
    input.quotaBackend,
    "quotaBackend",
    DIAGNOSIS_PRODUCTION_QUOTA_BACKEND_KIND,
    enabled,
  );
  const readerMaxAgeMs = parseOptionalPositiveInt(input.readerMaxAgeMs, "readerMaxAgeMs");
  const quotaWindow = parseQuotaWindow(input.quotaWindow);
  if (enabled) {
    if (!reportSourceBackend || !auditPersistBackend || !quotaBackend) {
      throw configError(
        "production_adapters_required",
        "enabled production config requires report, audit, and quota backends",
        "backends",
      );
    }
  }
  return {
    enabled,
    reportSourceBackend,
    auditPersistBackend,
    quotaBackend,
    readerMaxAgeMs,
    quotaWindow,
  };
}

/**
 * Maps a parsed config onto resolveProductionAdapterDeps.
 * Enabled rehearsal still requires host-injected backends; missing any fail-closes.
 */
export function resolveProductionAdapterDepsFromConfig(
  config: DiagnosisProductionAdapterConfig,
  backends?: Partial<ProductionAdapterBackends>,
  extras?: {
    now?: () => number;
    readerPolicy?: ProductionCompositeReportReaderPolicy;
  },
): ProductionQueryAdapterDeps {
  if (!config.enabled) {
    return resolveProductionAdapterDeps({ enabled: false });
  }
  if (!backends?.reportSource || !backends.auditAppend || !backends.quota) {
    throw configError(
      "production_adapters_required",
      "production adapters are enabled but report/audit/quota backends are missing",
      "adapters",
    );
  }
  const readerPolicy: ProductionCompositeReportReaderPolicy = {
    ...extras?.readerPolicy,
    ...(config.readerMaxAgeMs != null ? { maxAgeMs: config.readerMaxAgeMs } : {}),
    ...(extras?.now ? { now: extras.now } : {}),
  };
  return resolveProductionAdapterDeps({
    enabled: true,
    backends: {
      reportSource: backends.reportSource,
      auditAppend: backends.auditAppend,
      quota: backends.quota,
    },
    readerPolicy,
    quotaWindow: config.quotaWindow,
    ...(extras?.now ? { now: extras.now } : {}),
  });
}

export function assertDiagnosisProductionConfigClosed(
  config: DiagnosisProductionAdapterConfig = parseDiagnosisProductionAdapterConfig(),
): void {
  if (config.enabled) {
    throw configError(
      "adapter_gate_forbidden",
      "P3.9 rehearsal must keep production adapter config disabled",
      "enabled",
    );
  }
}

function parseEnabled(raw: unknown): boolean {
  if (raw === undefined) {
    return false;
  }
  if (typeof raw !== "boolean") {
    throw configError("production_config_invalid", "enabled must be a boolean", "enabled");
  }
  return raw;
}

function parseBackendRef(
  raw: unknown,
  path: string,
  expectedKind: string,
  required: boolean,
  expectedLocator?: string,
): DiagnosisProductionBackendRef | null {
  if (raw === undefined || raw === null) {
    if (required) {
      throw configError(
        "production_adapters_required",
        `${path} is required when production adapters are enabled`,
        path,
      );
    }
    return null;
  }
  if (!isRecord(raw)) {
    throw configError("production_config_invalid", `${path} must be an object`, path);
  }
  rejectForbiddenShape(raw, path);
  if (typeof raw.kind !== "string" || raw.kind.length === 0) {
    throw configError("production_config_invalid", `${path}.kind must be a non-empty string`, path);
  }
  if (raw.kind !== expectedKind) {
    throw configError(
      "production_config_invalid",
      `${path}.kind must be ${expectedKind}`,
      `${path}.kind`,
    );
  }
  if (raw.locator !== undefined) {
    if (typeof raw.locator !== "string" || raw.locator.length === 0) {
      throw configError(
        "production_config_invalid",
        `${path}.locator must be a non-empty string`,
        `${path}.locator`,
      );
    }
    rejectForbiddenValue(raw.locator, `${path}.locator`);
    if (expectedLocator && raw.locator !== expectedLocator) {
      throw configError(
        "production_config_invalid",
        `${path}.locator must stay a placeholder`,
        `${path}.locator`,
      );
    }
  }
  const ref: DiagnosisProductionBackendRef = { kind: raw.kind };
  if (typeof raw.locator === "string") {
    ref.locator = raw.locator;
  } else if (expectedLocator && required) {
    ref.locator = expectedLocator;
  }
  return ref;
}

function parseQuotaWindow(raw: unknown): ProductionQuotaWindow {
  const defaults = DIAGNOSIS_PRODUCTION_ADAPTER_CONFIG_DEFAULTS.quotaWindow;
  if (raw === undefined || raw === null) {
    return { ...defaults };
  }
  if (!isRecord(raw)) {
    throw configError("production_config_invalid", "quotaWindow must be an object", "quotaWindow");
  }
  rejectForbiddenShape(raw, "quotaWindow");
  return {
    windowMs: parseRequiredPositiveInt(raw.windowMs, "quotaWindow.windowMs", defaults.windowMs),
    tenantLimit: parseRequiredPositiveInt(
      raw.tenantLimit,
      "quotaWindow.tenantLimit",
      defaults.tenantLimit,
    ),
    principalLimit: parseRequiredPositiveInt(
      raw.principalLimit,
      "quotaWindow.principalLimit",
      defaults.principalLimit,
    ),
    maxConcurrency: parseRequiredPositiveInt(
      raw.maxConcurrency,
      "quotaWindow.maxConcurrency",
      defaults.maxConcurrency,
    ),
  };
}

function parseOptionalPositiveInt(raw: unknown, path: string): number | null {
  if (raw === undefined || raw === null) {
    return null;
  }
  return parseRequiredPositiveInt(raw, path);
}

function parseRequiredPositiveInt(raw: unknown, path: string, fallback?: number): number {
  if (raw === undefined && fallback !== undefined) {
    return fallback;
  }
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1) {
    throw configError("production_config_invalid", `${path} must be a positive integer`, path);
  }
  return raw;
}

function rejectForbiddenShape(value: Record<string, unknown>, path: string): void {
  for (const key of Object.keys(value)) {
    if ((FORBIDDEN_BACKEND_KEYS as readonly string[]).includes(key)) {
      throw configError(
        "production_config_forbidden",
        `${path} must not include ${key}`,
        `${path}.${key}`,
      );
    }
    rejectForbiddenValue(value[key], `${path}.${key}`);
  }
}

function rejectForbiddenValue(value: unknown, path: string): void {
  if (typeof value === "string" && FORBIDDEN_VALUE_PATTERN.test(value)) {
    throw configError(
      "production_config_forbidden",
      `${path} must not include credentials, hosts, or production URLs`,
      path,
    );
  }
}

function configError(code: string, message: string, path = "config"): DiagnosisContractError {
  return new DiagnosisContractError(code, message, path);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
