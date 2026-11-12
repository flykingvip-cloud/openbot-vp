import { describe, expect, it } from "vitest";
import {
  ISOLATION_SIGNED_VALUES,
  assertExecProtocolIsolationOnly,
  isolationConfigToEnv,
  isolationProfile,
  loadExecProtocolConfigFromEnv,
} from "./config.js";
import { ExecConfigError } from "./errors.js";
import {
  SIGNED_PRODUCTION_EXEC_LISTEN,
  validateProductionExecProtocolConfig,
  type ProductionExecProtocolConfig,
} from "./production-config.js";
import { EXEC_API_VERSION, PRODUCTION_PROFILE_NAME } from "./types.js";

function explicitProductionConfig(
  overrides: Partial<ProductionExecProtocolConfig> = {},
): ProductionExecProtocolConfig {
  const base: ProductionExecProtocolConfig = {
    profileName: PRODUCTION_PROFILE_NAME,
    bind: SIGNED_PRODUCTION_EXEC_LISTEN.bind,
    port: SIGNED_PRODUCTION_EXEC_LISTEN.port,
    mutualAuth: {
      scheme: "mtls",
      caCertPath: "/tmp/t237-not-real/ca.pem",
      serverCertPath: "/tmp/t237-not-real/server.pem",
      serverKeyPath: "/tmp/t237-not-real/server-key.pem",
      clientCertPath: "/tmp/t237-not-real/client.pem",
      clientKeyPath: "/tmp/t237-not-real/client-key.pem",
    },
    connectTimeoutMs: 4000,
    requestTimeoutMs: 6000,
    executionTimeoutMs: 61000,
    maxTransportRetries: 4,
    transportBackoffMs: [250, 500, 1000],
    cancelDeadlineMs: 11000,
    idempotencyTtlMs: 86400001,
    maxClockSkewMs: 30001,
    tenantAuthSource: "explicit-unsigned-source-for-shape-tests",
    capacity: {
      globalMaxConcurrent: 9,
      tenantMaxConcurrent: 9,
      accountMaxConcurrent: 9,
    },
    execApiVersion: EXEC_API_VERSION,
  };
  return {
    ...base,
    ...overrides,
    mutualAuth: {
      ...base.mutualAuth,
      ...overrides.mutualAuth,
    },
    capacity: {
      ...base.capacity,
      ...overrides.capacity,
    },
  };
}

describe("validateProductionExecProtocolConfig", () => {
  it("accepts the signed production exec listen only when it is provided explicitly", () => {
    const config = validateProductionExecProtocolConfig(explicitProductionConfig());
    expect(config.profileName).toBe("exec-protocol-v1-production");
    expect(config.bind).toBe("10.21.88.6");
    expect(config.port).toBe(18791);
    expect(config.execApiVersion).toBe(1);
  });

  it("does not fill missing fields from isolation signed values or invent defaults", () => {
    expect(() => validateProductionExecProtocolConfig({})).toThrow(ExecConfigError);
    try {
      validateProductionExecProtocolConfig({});
    } catch (error) {
      expect((error as ExecConfigError).message).toMatch(/missing required fields/);
      expect((error as ExecConfigError).missing).toEqual(
        expect.arrayContaining(["bind", "port", "mutualAuth", "tenantAuthSource", "capacity"]),
      );
    }
    expect(() =>
      validateProductionExecProtocolConfig({
        profileName: PRODUCTION_PROFILE_NAME,
        execApiVersion: EXEC_API_VERSION,
      }),
    ).toThrow(/missing required fields/);
  });

  it("rejects isolation loopback, wildcard, and unsigned bind/port pairs", () => {
    expect(() =>
      validateProductionExecProtocolConfig(
        explicitProductionConfig({ bind: "127.0.0.1", port: 18790 }),
      ),
    ).toThrow(/signed production exec listen/);
    expect(() =>
      validateProductionExecProtocolConfig(
        explicitProductionConfig({ bind: "0.0.0.0", port: 18791 }),
      ),
    ).toThrow(/wildcard|signed production exec listen/);
    expect(() =>
      validateProductionExecProtocolConfig(
        explicitProductionConfig({ bind: "10.21.88.5", port: 18791 }),
      ),
    ).toThrow(/signed production exec listen/);
    expect(() =>
      validateProductionExecProtocolConfig(
        explicitProductionConfig({ bind: "10.21.88.6", port: 18789 }),
      ),
    ).toThrow(/signed production exec listen/);
  });

  it("rejects isolation signed timeouts, retries, and clock skew when reused as production values", () => {
    expect(() =>
      validateProductionExecProtocolConfig(
        explicitProductionConfig({ connectTimeoutMs: ISOLATION_SIGNED_VALUES.connectTimeoutMs }),
      ),
    ).toThrow(/connectTimeoutMs must not reuse the isolation signed value/);
    expect(() =>
      validateProductionExecProtocolConfig(
        explicitProductionConfig({ requestTimeoutMs: ISOLATION_SIGNED_VALUES.requestTimeoutMs }),
      ),
    ).toThrow(/requestTimeoutMs must not reuse the isolation signed value/);
    expect(() =>
      validateProductionExecProtocolConfig(
        explicitProductionConfig({
          executionTimeoutMs: ISOLATION_SIGNED_VALUES.executionTimeoutMs,
        }),
      ),
    ).toThrow(/executionTimeoutMs must not reuse the isolation signed value/);
    expect(() =>
      validateProductionExecProtocolConfig(
        explicitProductionConfig({
          cancelDeadlineMs: ISOLATION_SIGNED_VALUES.cancelDeadlineMs,
        }),
      ),
    ).toThrow(/cancelDeadlineMs must not reuse the isolation signed value/);
    expect(() =>
      validateProductionExecProtocolConfig(
        explicitProductionConfig({
          idempotencyTtlMs: ISOLATION_SIGNED_VALUES.idempotencyTtlMs,
        }),
      ),
    ).toThrow(/idempotencyTtlMs must not reuse the isolation signed value/);
    expect(() =>
      validateProductionExecProtocolConfig(
        explicitProductionConfig({
          maxClockSkewMs: ISOLATION_SIGNED_VALUES.maxClockSkewMs,
        }),
      ),
    ).toThrow(/maxClockSkewMs must not reuse the isolation signed value/);
    expect(() =>
      validateProductionExecProtocolConfig(
        explicitProductionConfig({
          maxTransportRetries: ISOLATION_SIGNED_VALUES.maxTransportRetries,
          transportBackoffMs: [...ISOLATION_SIGNED_VALUES.transportBackoffMs],
        }),
      ),
    ).toThrow(/transport retries must not reuse the isolation signed values/);
  });

  it("rejects isolation lease format, prototype capacity, and incomplete mutual auth", () => {
    expect(() =>
      validateProductionExecProtocolConfig(
        explicitProductionConfig({
          tenantAuthSource: `lease:exec1_${"a".repeat(64)}`,
        }),
      ),
    ).toThrow(/isolation lease format/);
    expect(() =>
      validateProductionExecProtocolConfig(
        explicitProductionConfig({
          capacity: { globalMaxConcurrent: 8, tenantMaxConcurrent: 9, accountMaxConcurrent: 9 },
        }),
      ),
    ).toThrow(/PROTOTYPE_MAX_CONCURRENT/);
    expect(() =>
      validateProductionExecProtocolConfig(
        explicitProductionConfig({
          mutualAuth: {
            scheme: "mtls",
            caCertPath: "",
            serverCertPath: "/tmp/t237-not-real/server.pem",
            serverKeyPath: "/tmp/t237-not-real/server-key.pem",
            clientCertPath: "/tmp/t237-not-real/client.pem",
            clientKeyPath: "/tmp/t237-not-real/client-key.pem",
          },
        }),
      ),
    ).toThrow(/mutualAuth.caCertPath/);
  });
});

describe("production mode enablement remains refused", () => {
  it("still refuses OPENBOT_PRODUCTION_EXECUTION_MODE=production even when a complete production listen config is present", () => {
    const production = validateProductionExecProtocolConfig(explicitProductionConfig());
    expect(production.bind).toBe("10.21.88.6");
    const env = {
      ...isolationConfigToEnv(isolationProfile()),
      OPENBOT_PRODUCTION_EXECUTION_MODE: "production",
      OPENBOT_EXEC_PROTOCOL_BIND: production.bind,
      OPENBOT_EXEC_PROTOCOL_PORT: String(production.port),
    };
    expect(() => assertExecProtocolIsolationOnly(env)).toThrow(/independently reviewed/);
    expect(() => loadExecProtocolConfigFromEnv(env)).toThrow(ExecConfigError);
    try {
      loadExecProtocolConfigFromEnv(env);
    } catch (error) {
      expect((error as ExecConfigError).message).toMatch(/isolation-only/);
      expect((error as ExecConfigError).message).toMatch(/must not be applied as a fallback/);
      expect((error as ExecConfigError).missing).toEqual(["OPENBOT_PRODUCTION_EXECUTION_MODE"]);
    }
  });
});
