// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenBotConfig } from "../../config/config.js";
import type { SecretRef } from "../../config/types.secrets.js";
import {
  deriveVaultKey,
  resetVaultKeyMaterialCacheForTest,
  resolveVaultKeyMaterialFromEnv,
} from "./connector-credential-vault-key.js";

const emptyConfig = {} as OpenBotConfig;

beforeEach(() => {
  resetVaultKeyMaterialCacheForTest();
});

describe("deriveVaultKey", () => {
  it("is deterministic and produces a 32-byte key", () => {
    const first = deriveVaultKey("hunter2");
    expect(first).toHaveLength(32);
    expect(first.equals(deriveVaultKey("hunter2"))).toBe(true);
    expect(first.equals(deriveVaultKey("other"))).toBe(false);
  });
});

describe("resolveVaultKeyMaterialFromEnv", () => {
  it("prefers the inline env key and short-circuits without loading config", async () => {
    const loadConfig = vi.fn(async (): Promise<OpenBotConfig> => {
      throw new Error("config should not be loaded on the inline path");
    });
    const result = await resolveVaultKeyMaterialFromEnv({
      env: { OPENBOT_ENTERPRISE_DATA_VAULT_KEY: "inline-key" },
      loadConfig,
      resolveRefString: async () => "unused",
    });
    expect(result).toEqual({ material: "inline-key", source: "inline-env" });
    expect(loadConfig).not.toHaveBeenCalled();
  });

  it("resolves a JSON SecretRef env via the shared resolver and caches the result", async () => {
    let calls = 0;
    const resolveRefString = vi.fn(async (ref: SecretRef) => {
      calls += 1;
      return `resolved:${ref.id}`;
    });
    const env = {
      OPENBOT_ENTERPRISE_DATA_VAULT_KEY_REF: JSON.stringify({
        source: "exec",
        provider: "vault",
        id: "enterprise/kek",
      }),
    };
    const first = await resolveVaultKeyMaterialFromEnv({
      env,
      loadConfig: async () => emptyConfig,
      resolveRefString,
    });
    expect(first).toEqual({ material: "resolved:enterprise/kek", source: "secret-ref" });
    expect(resolveRefString.mock.calls[0]?.[0]).toEqual({
      source: "exec",
      provider: "vault",
      id: "enterprise/kek",
    });
    // Second call with the same ref env hits the cache — no re-resolution.
    const second = await resolveVaultKeyMaterialFromEnv({
      env,
      loadConfig: async () => emptyConfig,
      resolveRefString,
    });
    expect(second).toEqual(first);
    expect(calls).toBe(1);
  });

  it("resolves a ${VAR} env-template ref", async () => {
    const resolveRefString = vi.fn(async (ref: SecretRef) => `env:${ref.id}`);
    const result = await resolveVaultKeyMaterialFromEnv({
      env: { OPENBOT_ENTERPRISE_DATA_VAULT_KEY_REF: "${VAULT_KEK}" },
      loadConfig: async () => emptyConfig,
      resolveRefString,
    });
    expect(result?.source).toBe("secret-ref");
    expect(resolveRefString.mock.calls[0]?.[0]).toEqual({
      source: "env",
      provider: "default",
      id: "VAULT_KEK",
    });
  });

  it("fails closed when the ref env is not a valid SecretRef", async () => {
    await expect(
      resolveVaultKeyMaterialFromEnv({
        env: { OPENBOT_ENTERPRISE_DATA_VAULT_KEY_REF: "just-a-raw-string" },
        loadConfig: async () => emptyConfig,
        resolveRefString: async () => "x",
      }),
    ).rejects.toThrow(/SecretRef/);
  });

  it("returns null when neither env var is set (caller uses the local key file)", async () => {
    const result = await resolveVaultKeyMaterialFromEnv({
      env: {},
      loadConfig: async () => emptyConfig,
      resolveRefString: async () => "x",
    });
    expect(result).toBeNull();
  });
});
