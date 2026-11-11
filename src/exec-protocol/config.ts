import {
  PRODUCTION_EXECUTION_MODE_ENV,
  PRODUCTION_EXECUTION_MODE_VALUE,
  isProductionExecutionModeEnabled,
} from "../agents/sandbox/production-execution-mode.js";
import { ExecConfigError } from "./errors.js";
import { EXEC_API_VERSION, ISOLATION_PROFILE_NAME } from "./types.js";

export const EXEC_PROTOCOL_ENV = {
  bind: "OPENBOT_EXEC_PROTOCOL_BIND",
  port: "OPENBOT_EXEC_PROTOCOL_PORT",
  connectTimeoutMs: "OPENBOT_EXEC_PROTOCOL_CONNECT_TIMEOUT_MS",
  requestTimeoutMs: "OPENBOT_EXEC_PROTOCOL_REQUEST_TIMEOUT_MS",
  executionTimeoutMs: "OPENBOT_EXEC_PROTOCOL_EXECUTION_TIMEOUT_MS",
  maxTransportRetries: "OPENBOT_EXEC_PROTOCOL_MAX_TRANSPORT_RETRIES",
  transportBackoffMs: "OPENBOT_EXEC_PROTOCOL_TRANSPORT_BACKOFF_MS",
  idempotencyTtlMs: "OPENBOT_EXEC_PROTOCOL_IDEMPOTENCY_TTL_MS",
  cancelDeadlineMs: "OPENBOT_EXEC_PROTOCOL_CANCEL_DEADLINE_MS",
  leaseTtlMs: "OPENBOT_EXEC_PROTOCOL_LEASE_TTL_MS",
  maxClockSkewMs: "OPENBOT_EXEC_PROTOCOL_MAX_CLOCK_SKEW_MS",
} as const;

/**
 * This protocol implementation is isolation-only until a separately frozen
 * production profile exists (it does not exist in this change). Requesting
 * production execution mode must refuse enablement and must not fall back to
 * isolation or test signed values. NODE_ENV or other undocumented values are
 * not sufficient to request production mode.
 */
export function assertExecProtocolIsolationOnly(env: NodeJS.ProcessEnv): void {
  if (!isProductionExecutionModeEnabled({ env })) {
    return;
  }
  throw new ExecConfigError(
    "exec protocol enablement refused: this implementation is isolation-only " +
      `(${ISOLATION_PROFILE_NAME}); a production profile is not frozen. ` +
      `${PRODUCTION_EXECUTION_MODE_ENV}=${PRODUCTION_EXECUTION_MODE_VALUE} ` +
      "must not enable or start the protocol, and isolation or test signed " +
      "values must not be applied as a fallback.",
    [PRODUCTION_EXECUTION_MODE_ENV],
  );
}

export type ExecProtocolConfig = {
  profileName: typeof ISOLATION_PROFILE_NAME;
  bind: string;
  port: number;
  connectTimeoutMs: number;
  requestTimeoutMs: number;
  executionTimeoutMs: number;
  maxTransportRetries: number;
  transportBackoffMs: readonly number[];
  idempotencyKeyMinLength: number;
  idempotencyKeyMaxLength: number;
  idempotencyKeyPattern: string;
  idempotencyTtlMs: number;
  cancelDeadlineMs: number;
  leaseTtlMs: number;
  maxClockSkewMs: number;
  execApiVersion: typeof EXEC_API_VERSION;
};

/** Signed isolation-profile values. Not loaded unless a caller passes them explicitly. */
export const ISOLATION_SIGNED_VALUES: ExecProtocolConfig = {
  profileName: ISOLATION_PROFILE_NAME,
  bind: "127.0.0.1",
  port: 18790,
  connectTimeoutMs: 3000,
  requestTimeoutMs: 5000,
  executionTimeoutMs: 60000,
  maxTransportRetries: 3,
  transportBackoffMs: [200, 400],
  idempotencyKeyMinLength: 16,
  idempotencyKeyMaxLength: 128,
  idempotencyKeyPattern: "^[A-Za-z0-9._:-]+$",
  idempotencyTtlMs: 86400000,
  cancelDeadlineMs: 10000,
  leaseTtlMs: 3600000,
  maxClockSkewMs: 30000,
  execApiVersion: EXEC_API_VERSION,
};

const REQUIRED_CONFIG_KEYS: Array<keyof ExecProtocolConfig> = [
  "profileName",
  "bind",
  "port",
  "connectTimeoutMs",
  "requestTimeoutMs",
  "executionTimeoutMs",
  "maxTransportRetries",
  "transportBackoffMs",
  "idempotencyKeyMinLength",
  "idempotencyKeyMaxLength",
  "idempotencyKeyPattern",
  "idempotencyTtlMs",
  "cancelDeadlineMs",
  "leaseTtlMs",
  "maxClockSkewMs",
  "execApiVersion",
];

const LOOPBACK_BINDS = new Set(["127.0.0.1", "::1", "localhost"]);

function isPositiveInt(value: unknown): value is number {
  return (
    typeof value === "number" && Number.isInteger(value) && value > 0 && Number.isFinite(value)
  );
}

function isNonNegativeInt(value: unknown): value is number {
  return (
    typeof value === "number" && Number.isInteger(value) && value >= 0 && Number.isFinite(value)
  );
}

export function validateExecProtocolConfig(
  config: Partial<ExecProtocolConfig>,
): ExecProtocolConfig {
  const missing: string[] = [];
  for (const key of REQUIRED_CONFIG_KEYS) {
    const value = config[key];
    if (value === undefined || value === null || value === "") {
      missing.push(String(key));
    }
  }
  if (missing.length > 0) {
    throw new ExecConfigError(
      `exec protocol config refused: missing required fields: ${missing.join(", ")}`,
      missing,
    );
  }

  const complete = config as ExecProtocolConfig;
  if (complete.profileName !== "exec-protocol-v1-isolation") {
    throw new ExecConfigError(
      "exec protocol config refused: profileName must be exec-protocol-v1-isolation",
      ["profileName"],
    );
  }
  if (complete.execApiVersion !== EXEC_API_VERSION) {
    throw new ExecConfigError("exec protocol config refused: execApiVersion must be 1", [
      "execApiVersion",
    ]);
  }
  if (typeof complete.bind !== "string" || !LOOPBACK_BINDS.has(complete.bind)) {
    throw new ExecConfigError(
      "exec protocol config refused: bind must be a loopback address (127.0.0.1, ::1, or localhost)",
      ["bind"],
    );
  }
  if (!isPositiveInt(complete.port) || complete.port > 65535) {
    throw new ExecConfigError("exec protocol config refused: port must be an integer 1-65535", [
      "port",
    ]);
  }
  for (const key of [
    "connectTimeoutMs",
    "requestTimeoutMs",
    "executionTimeoutMs",
    "maxTransportRetries",
    "idempotencyTtlMs",
    "cancelDeadlineMs",
    "leaseTtlMs",
  ] as const) {
    if (!isPositiveInt(complete[key])) {
      throw new ExecConfigError(`exec protocol config refused: ${key} must be a positive integer`, [
        key,
      ]);
    }
  }
  if (!isNonNegativeInt(complete.maxClockSkewMs)) {
    throw new ExecConfigError(
      "exec protocol config refused: maxClockSkewMs must be a non-negative integer",
      ["maxClockSkewMs"],
    );
  }
  if (
    !isPositiveInt(complete.idempotencyKeyMinLength) ||
    !isPositiveInt(complete.idempotencyKeyMaxLength)
  ) {
    throw new ExecConfigError(
      "exec protocol config refused: idempotency key length bounds must be positive integers",
      ["idempotencyKeyMinLength", "idempotencyKeyMaxLength"],
    );
  }
  if (complete.idempotencyKeyMinLength !== 16 || complete.idempotencyKeyMaxLength !== 128) {
    throw new ExecConfigError(
      "exec protocol config refused: idempotency key length must be the signed 16-128 bounds",
      ["idempotencyKeyMinLength", "idempotencyKeyMaxLength"],
    );
  }
  if (complete.idempotencyKeyPattern !== "^[A-Za-z0-9._:-]+$") {
    throw new ExecConfigError(
      "exec protocol config refused: idempotencyKeyPattern must be the signed charset",
      ["idempotencyKeyPattern"],
    );
  }
  const backoff = complete.transportBackoffMs;
  const expectedBackoffLength = complete.maxTransportRetries - 1;
  if (
    !Array.isArray(backoff) ||
    backoff.length !== expectedBackoffLength ||
    !backoff.every((entry) => isPositiveInt(entry))
  ) {
    throw new ExecConfigError(
      "exec protocol config refused: transportBackoffMs must contain exactly maxTransportRetries-1 positive integers",
      ["transportBackoffMs"],
    );
  }
  return {
    ...complete,
    transportBackoffMs: [...backoff],
  };
}

/**
 * Returns a complete isolation profile. Callers must pass this object explicitly;
 * env loaders never auto-fill these numbers when variables are missing.
 */
export function isolationProfile(overrides: Partial<ExecProtocolConfig> = {}): ExecProtocolConfig {
  return validateExecProtocolConfig({ ...ISOLATION_SIGNED_VALUES, ...overrides });
}

function readRequiredEnv(
  env: NodeJS.ProcessEnv,
  key: string,
  missing: string[],
): string | undefined {
  const raw = env[key];
  if (raw === undefined || raw.trim() === "") {
    missing.push(key);
    return undefined;
  }
  return raw.trim();
}

function parseRequiredInt(
  env: NodeJS.ProcessEnv,
  key: string,
  missing: string[],
): number | undefined {
  const raw = readRequiredEnv(env, key, missing);
  if (raw === undefined) {
    return undefined;
  }
  if (!/^-?\d+$/.test(raw)) {
    missing.push(`${key} (not an integer)`);
    return undefined;
  }
  return Number.parseInt(raw, 10);
}

/**
 * Load a complete config from required environment variables.
 * Does not substitute signed isolation numbers for missing values.
 */
export function loadExecProtocolConfigFromEnv(env: NodeJS.ProcessEnv): ExecProtocolConfig {
  assertExecProtocolIsolationOnly(env);
  const missing: string[] = [];
  const bind = readRequiredEnv(env, EXEC_PROTOCOL_ENV.bind, missing);
  const port = parseRequiredInt(env, EXEC_PROTOCOL_ENV.port, missing);
  const connectTimeoutMs = parseRequiredInt(env, EXEC_PROTOCOL_ENV.connectTimeoutMs, missing);
  const requestTimeoutMs = parseRequiredInt(env, EXEC_PROTOCOL_ENV.requestTimeoutMs, missing);
  const executionTimeoutMs = parseRequiredInt(env, EXEC_PROTOCOL_ENV.executionTimeoutMs, missing);
  const maxTransportRetries = parseRequiredInt(env, EXEC_PROTOCOL_ENV.maxTransportRetries, missing);
  const backoffRaw = readRequiredEnv(env, EXEC_PROTOCOL_ENV.transportBackoffMs, missing);
  const idempotencyTtlMs = parseRequiredInt(env, EXEC_PROTOCOL_ENV.idempotencyTtlMs, missing);
  const cancelDeadlineMs = parseRequiredInt(env, EXEC_PROTOCOL_ENV.cancelDeadlineMs, missing);
  const leaseTtlMs = parseRequiredInt(env, EXEC_PROTOCOL_ENV.leaseTtlMs, missing);
  const maxClockSkewMs = parseRequiredInt(env, EXEC_PROTOCOL_ENV.maxClockSkewMs, missing);

  let transportBackoffMs: number[] | undefined;
  if (backoffRaw !== undefined) {
    const parts = backoffRaw.split(",").map((part) => part.trim());
    if (parts.length === 0 || parts.some((part) => !/^\d+$/.test(part))) {
      missing.push(`${EXEC_PROTOCOL_ENV.transportBackoffMs} (expected comma-separated integers)`);
    } else {
      transportBackoffMs = parts.map((part) => Number.parseInt(part, 10));
    }
  }

  if (missing.length > 0) {
    throw new ExecConfigError(
      `exec protocol config refused: missing or invalid env: ${missing.join(", ")}`,
      missing,
    );
  }

  return validateExecProtocolConfig({
    profileName: ISOLATION_PROFILE_NAME,
    bind,
    port,
    connectTimeoutMs,
    requestTimeoutMs,
    executionTimeoutMs,
    maxTransportRetries,
    transportBackoffMs,
    idempotencyKeyMinLength: 16,
    idempotencyKeyMaxLength: 128,
    idempotencyKeyPattern: "^[A-Za-z0-9._:-]+$",
    idempotencyTtlMs,
    cancelDeadlineMs,
    leaseTtlMs,
    maxClockSkewMs,
    execApiVersion: EXEC_API_VERSION,
  });
}

export function isolationConfigToEnv(config: ExecProtocolConfig): Record<string, string> {
  return {
    [EXEC_PROTOCOL_ENV.bind]: config.bind,
    [EXEC_PROTOCOL_ENV.port]: String(config.port),
    [EXEC_PROTOCOL_ENV.connectTimeoutMs]: String(config.connectTimeoutMs),
    [EXEC_PROTOCOL_ENV.requestTimeoutMs]: String(config.requestTimeoutMs),
    [EXEC_PROTOCOL_ENV.executionTimeoutMs]: String(config.executionTimeoutMs),
    [EXEC_PROTOCOL_ENV.maxTransportRetries]: String(config.maxTransportRetries),
    [EXEC_PROTOCOL_ENV.transportBackoffMs]: config.transportBackoffMs.join(","),
    [EXEC_PROTOCOL_ENV.idempotencyTtlMs]: String(config.idempotencyTtlMs),
    [EXEC_PROTOCOL_ENV.cancelDeadlineMs]: String(config.cancelDeadlineMs),
    [EXEC_PROTOCOL_ENV.leaseTtlMs]: String(config.leaseTtlMs),
    [EXEC_PROTOCOL_ENV.maxClockSkewMs]: String(config.maxClockSkewMs),
  };
}
