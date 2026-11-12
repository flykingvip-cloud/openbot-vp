import { ISOLATION_SIGNED_VALUES } from "./config.js";
import { ExecConfigError } from "./errors.js";
import { EXEC_API_VERSION, PRODUCTION_PROFILE_NAME } from "./types.js";

/**
 * Owner-signed production exec-protocol listen target for planned execution
 * pool B (botser3, 22006, 10.21.88.6). This is an allowlist entry, not a
 * default: callers must provide the bind and port explicitly.
 *
 * A gateway HTTPS listen on 10.99.0.2:18789 is a gateway bind, not this
 * exec-protocol profile.
 */
export const SIGNED_PRODUCTION_EXEC_LISTEN = {
  bind: "10.21.88.6",
  port: 18791,
} as const;

export type ProductionMutualAuthConfig = {
  scheme: "mtls";
  caCertPath: string;
  serverCertPath: string;
  serverKeyPath: string;
  clientCertPath: string;
  clientKeyPath: string;
};

export type ProductionCapacityConfig = {
  globalMaxConcurrent: number;
  tenantMaxConcurrent: number;
  accountMaxConcurrent: number;
};

export type ProductionExecProtocolConfig = {
  profileName: typeof PRODUCTION_PROFILE_NAME;
  bind: string;
  port: number;
  mutualAuth: ProductionMutualAuthConfig;
  connectTimeoutMs: number;
  requestTimeoutMs: number;
  executionTimeoutMs: number;
  maxTransportRetries: number;
  transportBackoffMs: readonly number[];
  cancelDeadlineMs: number;
  idempotencyTtlMs: number;
  maxClockSkewMs: number;
  tenantAuthSource: string;
  capacity: ProductionCapacityConfig;
  execApiVersion: typeof EXEC_API_VERSION;
};

const REQUIRED_KEYS: Array<keyof ProductionExecProtocolConfig> = [
  "profileName",
  "bind",
  "port",
  "mutualAuth",
  "connectTimeoutMs",
  "requestTimeoutMs",
  "executionTimeoutMs",
  "maxTransportRetries",
  "transportBackoffMs",
  "cancelDeadlineMs",
  "idempotencyTtlMs",
  "maxClockSkewMs",
  "tenantAuthSource",
  "capacity",
  "execApiVersion",
];

const MUTUAL_AUTH_KEYS: Array<keyof ProductionMutualAuthConfig> = [
  "scheme",
  "caCertPath",
  "serverCertPath",
  "serverKeyPath",
  "clientCertPath",
  "clientKeyPath",
];

const CAPACITY_KEYS: Array<keyof ProductionCapacityConfig> = [
  "globalMaxConcurrent",
  "tenantMaxConcurrent",
  "accountMaxConcurrent",
];

const PROTOTYPE_MAX_CONCURRENT = 8;

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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * Shape-check a production profile. Successful validation does not enable or
 * start production mode; enablement remains refused until independent review.
 *
 * No isolation signed values are used as defaults. Isolation bind, port,
 * timeouts, retry, and clock-skew values are rejected if supplied here.
 */
export function validateProductionExecProtocolConfig(
  config: Partial<ProductionExecProtocolConfig>,
): ProductionExecProtocolConfig {
  const missing: string[] = [];
  for (const key of REQUIRED_KEYS) {
    const value = config[key];
    if (value === undefined || value === null || value === "") {
      missing.push(String(key));
    }
  }
  if (missing.length > 0) {
    throw new ExecConfigError(
      `production exec protocol config refused: missing required fields: ${missing.join(", ")}`,
      missing,
    );
  }

  if (config.profileName !== PRODUCTION_PROFILE_NAME) {
    throw new ExecConfigError(
      `production exec protocol config refused: profileName must be ${PRODUCTION_PROFILE_NAME}`,
      ["profileName"],
    );
  }
  if (config.execApiVersion !== EXEC_API_VERSION) {
    throw new ExecConfigError("production exec protocol config refused: execApiVersion must be 1", [
      "execApiVersion",
    ]);
  }
  const complete = config as ProductionExecProtocolConfig;

  if (
    complete.bind !== SIGNED_PRODUCTION_EXEC_LISTEN.bind ||
    complete.port !== SIGNED_PRODUCTION_EXEC_LISTEN.port
  ) {
    throw new ExecConfigError(
      "production exec protocol config refused: bind and port must be the signed " +
        `production exec listen ${SIGNED_PRODUCTION_EXEC_LISTEN.bind}:${SIGNED_PRODUCTION_EXEC_LISTEN.port}; ` +
        "isolation loopback, wildcard, and other addresses are not accepted, and this pair is not used as a default",
      ["bind", "port"],
    );
  }

  const auth = complete.mutualAuth;
  if (!auth || typeof auth !== "object") {
    throw new ExecConfigError(
      "production exec protocol config refused: mutualAuth must be provided explicitly",
      ["mutualAuth"],
    );
  }
  const authMissing: string[] = [];
  for (const key of MUTUAL_AUTH_KEYS) {
    if (!isNonEmptyString(auth[key])) {
      authMissing.push(`mutualAuth.${key}`);
    }
  }
  if (authMissing.length > 0) {
    throw new ExecConfigError(
      `production exec protocol config refused: missing required fields: ${authMissing.join(", ")}`,
      authMissing,
    );
  }
  if (auth.scheme !== "mtls") {
    throw new ExecConfigError(
      'production exec protocol config refused: mutualAuth.scheme must be explicitly "mtls"; this does not enable production mutual TLS',
      ["mutualAuth.scheme"],
    );
  }

  if (!isNonEmptyString(complete.tenantAuthSource)) {
    throw new ExecConfigError(
      "production exec protocol config refused: tenantAuthSource must be an explicit non-empty source",
      ["tenantAuthSource"],
    );
  }
  if (/\bexec1_[0-9a-fA-F]{64}\b/.test(complete.tenantAuthSource)) {
    throw new ExecConfigError(
      "production exec protocol config refused: tenantAuthSource must not use the isolation lease format",
      ["tenantAuthSource"],
    );
  }

  if (complete.connectTimeoutMs === ISOLATION_SIGNED_VALUES.connectTimeoutMs) {
    throw new ExecConfigError(
      "production exec protocol config refused: connectTimeoutMs must not reuse the isolation signed value",
      ["connectTimeoutMs"],
    );
  }
  if (complete.requestTimeoutMs === ISOLATION_SIGNED_VALUES.requestTimeoutMs) {
    throw new ExecConfigError(
      "production exec protocol config refused: requestTimeoutMs must not reuse the isolation signed value",
      ["requestTimeoutMs"],
    );
  }
  if (complete.executionTimeoutMs === ISOLATION_SIGNED_VALUES.executionTimeoutMs) {
    throw new ExecConfigError(
      "production exec protocol config refused: executionTimeoutMs must not reuse the isolation signed value",
      ["executionTimeoutMs"],
    );
  }
  if (complete.cancelDeadlineMs === ISOLATION_SIGNED_VALUES.cancelDeadlineMs) {
    throw new ExecConfigError(
      "production exec protocol config refused: cancelDeadlineMs must not reuse the isolation signed value",
      ["cancelDeadlineMs"],
    );
  }
  if (complete.idempotencyTtlMs === ISOLATION_SIGNED_VALUES.idempotencyTtlMs) {
    throw new ExecConfigError(
      "production exec protocol config refused: idempotencyTtlMs must not reuse the isolation signed value",
      ["idempotencyTtlMs"],
    );
  }
  if (complete.maxClockSkewMs === ISOLATION_SIGNED_VALUES.maxClockSkewMs) {
    throw new ExecConfigError(
      "production exec protocol config refused: maxClockSkewMs must not reuse the isolation signed value",
      ["maxClockSkewMs"],
    );
  }

  for (const key of [
    "connectTimeoutMs",
    "requestTimeoutMs",
    "executionTimeoutMs",
    "maxTransportRetries",
    "idempotencyTtlMs",
    "cancelDeadlineMs",
  ] as const) {
    if (!isPositiveInt(complete[key])) {
      throw new ExecConfigError(
        `production exec protocol config refused: ${key} must be a positive integer`,
        [key],
      );
    }
  }
  if (!isNonNegativeInt(complete.maxClockSkewMs)) {
    throw new ExecConfigError(
      "production exec protocol config refused: maxClockSkewMs must be a non-negative integer",
      ["maxClockSkewMs"],
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
      "production exec protocol config refused: transportBackoffMs must contain exactly maxTransportRetries-1 positive integers",
      ["transportBackoffMs"],
    );
  }
  const isolationBackoff = ISOLATION_SIGNED_VALUES.transportBackoffMs;
  if (
    complete.maxTransportRetries === ISOLATION_SIGNED_VALUES.maxTransportRetries &&
    backoff.length === isolationBackoff.length &&
    backoff.every((entry, index) => entry === isolationBackoff[index])
  ) {
    throw new ExecConfigError(
      "production exec protocol config refused: transport retries must not reuse the isolation signed values",
      ["maxTransportRetries", "transportBackoffMs"],
    );
  }

  const capacity = complete.capacity;
  if (!capacity || typeof capacity !== "object") {
    throw new ExecConfigError(
      "production exec protocol config refused: capacity must be provided explicitly",
      ["capacity"],
    );
  }
  const capacityMissing: string[] = [];
  for (const key of CAPACITY_KEYS) {
    if (!isPositiveInt(capacity[key])) {
      capacityMissing.push(`capacity.${key}`);
    }
  }
  if (capacityMissing.length > 0) {
    throw new ExecConfigError(
      `production exec protocol config refused: capacity layers must be positive integers: ${capacityMissing.join(", ")}`,
      capacityMissing,
    );
  }
  if (
    capacity.globalMaxConcurrent === PROTOTYPE_MAX_CONCURRENT ||
    capacity.tenantMaxConcurrent === PROTOTYPE_MAX_CONCURRENT ||
    capacity.accountMaxConcurrent === PROTOTYPE_MAX_CONCURRENT
  ) {
    throw new ExecConfigError(
      "production exec protocol config refused: capacity must not reuse PROTOTYPE_MAX_CONCURRENT=8",
      ["capacity"],
    );
  }

  return {
    ...complete,
    bind: complete.bind.trim(),
    tenantAuthSource: complete.tenantAuthSource.trim(),
    transportBackoffMs: [...backoff],
    mutualAuth: {
      scheme: "mtls",
      caCertPath: auth.caCertPath.trim(),
      serverCertPath: auth.serverCertPath.trim(),
      serverKeyPath: auth.serverKeyPath.trim(),
      clientCertPath: auth.clientCertPath.trim(),
      clientKeyPath: auth.clientKeyPath.trim(),
    },
    capacity: { ...capacity },
  };
}
