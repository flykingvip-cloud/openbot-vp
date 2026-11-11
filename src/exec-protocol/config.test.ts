import { describe, expect, it } from "vitest";
import {
  EXEC_PROTOCOL_ENV,
  ISOLATION_SIGNED_VALUES,
  isolationConfigToEnv,
  isolationProfile,
  loadExecProtocolConfigFromEnv,
  validateExecProtocolConfig,
} from "./config.js";
import { ExecConfigError } from "./errors.js";
import { runExecProtocolProcess } from "./process-main.js";

describe("exec protocol isolation config", () => {
  it("returns the signed isolation profile when the caller passes it explicitly", () => {
    const config = isolationProfile();
    expect(config).toEqual(ISOLATION_SIGNED_VALUES);
    expect(config.port).toBe(18790);
    expect(config.bind).toBe("127.0.0.1");
    expect(config.maxTransportRetries).toBe(3);
    expect(config.transportBackoffMs).toEqual([200, 400]);
  });

  it("allows an explicit complete override for a non-public test port", () => {
    const config = isolationProfile({ port: 19001 });
    expect(config.port).toBe(19001);
    expect(config.connectTimeoutMs).toBe(3000);
  });

  it("refuses a partial config object with no implicit fill", () => {
    expect(() => validateExecProtocolConfig({ bind: "127.0.0.1", port: 18790 })).toThrow(
      ExecConfigError,
    );
    try {
      validateExecProtocolConfig({ bind: "127.0.0.1", port: 18790 });
    } catch (error) {
      expect(error).toBeInstanceOf(ExecConfigError);
      expect((error as ExecConfigError).missing.length).toBeGreaterThan(0);
      expect((error as ExecConfigError).message).toContain("missing required fields");
    }
  });

  it("refuses a public bind address", () => {
    expect(() => isolationProfile({ bind: "0.0.0.0" as "127.0.0.1" })).toThrow(/loopback/);
  });

  it("refuses env loading when any required variable is missing and does not use signed numbers as defaults", () => {
    expect(() => loadExecProtocolConfigFromEnv({})).toThrow(ExecConfigError);
    expect(() =>
      loadExecProtocolConfigFromEnv({
        [EXEC_PROTOCOL_ENV.bind]: "127.0.0.1",
        [EXEC_PROTOCOL_ENV.port]: "18790",
      }),
    ).toThrow(/missing or invalid env/);
    expect(() => loadExecProtocolConfigFromEnv({ NODE_ENV: "production" })).toThrow(
      ExecConfigError,
    );
  });

  it("loads a complete config only when every required env var is present", () => {
    const env = isolationConfigToEnv(isolationProfile({ port: 19111 }));
    const loaded = loadExecProtocolConfigFromEnv(env);
    expect(loaded.port).toBe(19111);
    expect(loaded.executionTimeoutMs).toBe(60000);
    expect(loaded.leaseTtlMs).toBe(3600000);
  });

  it("refuses a backoff array that does not equal maxTransportRetries-1", () => {
    expect(() => isolationProfile({ transportBackoffMs: [200, 400, 800] })).toThrow(
      /maxTransportRetries-1/,
    );
    expect(() =>
      loadExecProtocolConfigFromEnv({
        ...isolationConfigToEnv(isolationProfile()),
        [EXEC_PROTOCOL_ENV.transportBackoffMs]: "200,400,800",
      }),
    ).toThrow(/maxTransportRetries-1/);
  });

  it("refuses to start a process when required process env is missing", async () => {
    await expect(
      runExecProtocolProcess({ ...isolationConfigToEnv(isolationProfile()) }),
    ).rejects.toThrow(/refused to start/);
  });
});
