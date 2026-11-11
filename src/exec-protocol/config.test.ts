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

  it("refuses production mode even when a complete isolation env is present and does not fall back to signed values", () => {
    const env = {
      ...isolationConfigToEnv(isolationProfile()),
      OPENBOT_PRODUCTION_EXECUTION_MODE: "production",
    };
    expect(() => loadExecProtocolConfigFromEnv(env)).toThrow(ExecConfigError);
    try {
      loadExecProtocolConfigFromEnv(env);
    } catch (error) {
      expect(error).toBeInstanceOf(ExecConfigError);
      expect((error as ExecConfigError).message).toMatch(/isolation-only/);
      expect((error as ExecConfigError).message).toMatch(/production profile is not frozen/);
      expect((error as ExecConfigError).message).not.toMatch(/missing or invalid env/);
      expect((error as ExecConfigError).missing).toEqual(["OPENBOT_PRODUCTION_EXECUTION_MODE"]);
    }
  });

  it("refuses production mode with partial or missing env and does not fill isolation signed values", () => {
    const partial = {
      OPENBOT_PRODUCTION_EXECUTION_MODE: "production",
      [EXEC_PROTOCOL_ENV.bind]: "127.0.0.1",
      [EXEC_PROTOCOL_ENV.port]: "18790",
    };
    expect(() => loadExecProtocolConfigFromEnv(partial)).toThrow(/isolation-only/);
    expect(() =>
      loadExecProtocolConfigFromEnv({ OPENBOT_PRODUCTION_EXECUTION_MODE: "production" }),
    ).toThrow(/must not be applied as a fallback/);
    expect(() => loadExecProtocolConfigFromEnv(partial)).toThrow(ExecConfigError);
    try {
      loadExecProtocolConfigFromEnv(partial);
    } catch (error) {
      expect((error as ExecConfigError).message).not.toMatch(/missing or invalid env/);
    }
  });

  it("refuses incomplete env without production mode and does not fill isolation signed values", () => {
    expect(() =>
      loadExecProtocolConfigFromEnv({
        [EXEC_PROTOCOL_ENV.bind]: "127.0.0.1",
        [EXEC_PROTOCOL_ENV.port]: "18790",
      }),
    ).toThrow(/missing or invalid env/);
    expect(() => loadExecProtocolConfigFromEnv({})).toThrow(ExecConfigError);
  });

  it("does not treat NODE_ENV or undocumented values as production enablement", () => {
    const complete = isolationConfigToEnv(isolationProfile({ port: 19112 }));
    const loaded = loadExecProtocolConfigFromEnv({ ...complete, NODE_ENV: "production" });
    expect(loaded.port).toBe(19112);
    expect(loaded.profileName).toBe("exec-protocol-v1-isolation");
    const synonym = loadExecProtocolConfigFromEnv({
      ...complete,
      OPENBOT_PRODUCTION_EXECUTION_MODE: "true",
    });
    expect(synonym.port).toBe(19112);
  });

  it("refuses to start the process in production mode even with complete isolation process env", async () => {
    const env = {
      ...isolationConfigToEnv(isolationProfile()),
      OPENBOT_PRODUCTION_EXECUTION_MODE: "production",
      OPENBOT_EXEC_PROTOCOL_ROLE: "b",
      OPENBOT_EXEC_PROTOCOL_STORE_DIR: "/tmp/exec-protocol-must-not-start",
      OPENBOT_EXEC_PROTOCOL_MAX_REQUEST_BODY_BYTES: "1000",
      OPENBOT_EXEC_PROTOCOL_SUBJECT: "a-prime",
    };
    await expect(runExecProtocolProcess(env)).rejects.toThrow(/isolation-only/);
    await expect(runExecProtocolProcess(env)).rejects.toThrow(/must not be applied as a fallback/);
  });
});
