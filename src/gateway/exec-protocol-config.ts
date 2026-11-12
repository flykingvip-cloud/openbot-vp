import type { GatewayExecProtocolConfig } from "../config/types.gateway.js";
import {
  assertExecProtocolIsolationOnly,
  loadExecProtocolConfigFromEnv,
  validateExecProtocolConfig,
  type ExecProtocolConfig,
} from "../exec-protocol/config.js";
import { ExecConfigError } from "../exec-protocol/errors.js";
import { EXEC_API_VERSION, ISOLATION_PROFILE_NAME } from "../exec-protocol/types.js";

export const GATEWAY_EXEC_PROTOCOL_LEASE_TOKEN_ENV = "OPENBOT_EXEC_PROTOCOL_LEASE_TOKEN";
export const GATEWAY_EXEC_PROTOCOL_CONTROL_PLANE_URL_ENV =
  "OPENBOT_EXEC_PROTOCOL_CONTROL_PLANE_URL";

export const GATEWAY_EXEC_PROTOCOL_MAX_REQUEST_BODY_BYTES = 1_000_000;

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

const EXPLICIT_PROTOCOL_KEYS = [
  "profileName",
  "bind",
  "port",
  "connectTimeoutMs",
  "requestTimeoutMs",
  "executionTimeoutMs",
  "maxTransportRetries",
  "transportBackoffMs",
  "idempotencyTtlMs",
  "cancelDeadlineMs",
  "leaseTtlMs",
  "maxClockSkewMs",
] as const;

export type GatewayExecProtocolResolution =
  | { enabled: false }
  | {
      enabled: true;
      config: ExecProtocolConfig;
      controlPlaneUrl: string;
      leaseToken: string;
      maxRequestBodyBytes: number;
    };

function readLeaseToken(
  execProtocol: GatewayExecProtocolConfig | undefined,
  env: NodeJS.ProcessEnv,
): string | undefined {
  const fromConfig = execProtocol?.leaseToken;
  if (typeof fromConfig === "string" && fromConfig.length > 0) {
    return fromConfig;
  }
  const fromEnv = env[GATEWAY_EXEC_PROTOCOL_LEASE_TOKEN_ENV];
  if (typeof fromEnv === "string" && fromEnv.length > 0) {
    return fromEnv;
  }
  return undefined;
}

function hasAnyExplicitProtocolKey(execProtocol: GatewayExecProtocolConfig): boolean {
  return EXPLICIT_PROTOCOL_KEYS.some((key) => execProtocol[key] !== undefined);
}

function loadProtocolFromConfig(execProtocol: GatewayExecProtocolConfig): ExecProtocolConfig {
  const missing = EXPLICIT_PROTOCOL_KEYS.filter((key) => {
    const value = execProtocol[key];
    return value === undefined || value === null || value === "";
  });
  if (missing.length > 0) {
    throw new ExecConfigError(
      `exec protocol gateway facade refused: missing required fields: ${missing.join(", ")}`,
      missing,
    );
  }
  return validateExecProtocolConfig({
    profileName: execProtocol.profileName,
    bind: execProtocol.bind,
    port: execProtocol.port,
    connectTimeoutMs: execProtocol.connectTimeoutMs,
    requestTimeoutMs: execProtocol.requestTimeoutMs,
    executionTimeoutMs: execProtocol.executionTimeoutMs,
    maxTransportRetries: execProtocol.maxTransportRetries,
    transportBackoffMs: execProtocol.transportBackoffMs,
    idempotencyKeyMinLength: 16,
    idempotencyKeyMaxLength: 128,
    idempotencyKeyPattern: "^[A-Za-z0-9._:-]+$",
    idempotencyTtlMs: execProtocol.idempotencyTtlMs,
    cancelDeadlineMs: execProtocol.cancelDeadlineMs,
    leaseTtlMs: execProtocol.leaseTtlMs,
    maxClockSkewMs: execProtocol.maxClockSkewMs,
    execApiVersion: EXEC_API_VERSION,
  });
}

export function controlPlaneUrlFromBindPort(bind: string, port: number): string {
  const host = bind === "localhost" ? "127.0.0.1" : bind;
  const formatted = host.includes(":") ? `[${host}]` : host;
  return `http://${formatted}:${port}`;
}

export function assertLoopbackControlPlaneUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ExecConfigError(
      "exec protocol gateway facade refused: controlPlaneUrl must be a loopback http URL",
      ["controlPlaneUrl"],
    );
  }
  if (parsed.protocol !== "http:") {
    throw new ExecConfigError(
      "exec protocol gateway facade refused: controlPlaneUrl must use http on loopback",
      ["controlPlaneUrl"],
    );
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
  if (!LOOPBACK_HOSTS.has(hostname)) {
    throw new ExecConfigError(
      "exec protocol gateway facade refused: controlPlaneUrl must target a loopback address",
      ["controlPlaneUrl"],
    );
  }
  return parsed.origin;
}

/**
 * Resolve isolation-only gateway wiring to A'. Returns `{ enabled: false }`
 * when the facade is not opted in. When enabled, every isolation key must
 * be present (config object or env); signed isolation numbers are never
 * auto-filled. Production execution mode is refused.
 */
export function resolveGatewayExecProtocolIsolation(params: {
  execProtocol?: GatewayExecProtocolConfig;
  env?: NodeJS.ProcessEnv;
}): GatewayExecProtocolResolution {
  const execProtocol = params.execProtocol ?? {};
  const env = params.env ?? process.env;
  if (execProtocol.enabled !== true) {
    return { enabled: false };
  }

  assertExecProtocolIsolationOnly(env);

  const protocol = hasAnyExplicitProtocolKey(execProtocol)
    ? loadProtocolFromConfig(execProtocol)
    : loadExecProtocolConfigFromEnv(env);

  if (protocol.profileName !== ISOLATION_PROFILE_NAME) {
    throw new ExecConfigError(
      "exec protocol gateway facade refused: profileName must be exec-protocol-v1-isolation",
      ["profileName"],
    );
  }

  const leaseToken = readLeaseToken(execProtocol, env);
  if (!leaseToken) {
    throw new ExecConfigError(
      "exec protocol gateway facade refused: lease token is required " +
        `(set gateway.execProtocol.leaseToken or ${GATEWAY_EXEC_PROTOCOL_LEASE_TOKEN_ENV})`,
      ["leaseToken"],
    );
  }

  const rawUrl =
    (typeof execProtocol.controlPlaneUrl === "string" && execProtocol.controlPlaneUrl.trim()) ||
    env[GATEWAY_EXEC_PROTOCOL_CONTROL_PLANE_URL_ENV]?.trim() ||
    controlPlaneUrlFromBindPort(protocol.bind, protocol.port);
  const controlPlaneUrl = assertLoopbackControlPlaneUrl(rawUrl);

  return {
    enabled: true,
    config: protocol,
    controlPlaneUrl,
    leaseToken,
    maxRequestBodyBytes: GATEWAY_EXEC_PROTOCOL_MAX_REQUEST_BODY_BYTES,
  };
}

/** Explicit isolation config fields for tests and documented drill configs. */
export function explicitIsolationFacadeFields(
  config: ExecProtocolConfig,
): Required<
  Pick<
    GatewayExecProtocolConfig,
    | "profileName"
    | "bind"
    | "port"
    | "connectTimeoutMs"
    | "requestTimeoutMs"
    | "executionTimeoutMs"
    | "maxTransportRetries"
    | "transportBackoffMs"
    | "idempotencyTtlMs"
    | "cancelDeadlineMs"
    | "leaseTtlMs"
    | "maxClockSkewMs"
  >
> {
  return {
    profileName: config.profileName,
    bind: config.bind,
    port: config.port,
    connectTimeoutMs: config.connectTimeoutMs,
    requestTimeoutMs: config.requestTimeoutMs,
    executionTimeoutMs: config.executionTimeoutMs,
    maxTransportRetries: config.maxTransportRetries,
    transportBackoffMs: [...config.transportBackoffMs],
    idempotencyTtlMs: config.idempotencyTtlMs,
    cancelDeadlineMs: config.cancelDeadlineMs,
    leaseTtlMs: config.leaseTtlMs,
    maxClockSkewMs: config.maxClockSkewMs,
  };
}
