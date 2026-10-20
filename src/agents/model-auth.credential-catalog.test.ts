// @vitest-environment node
// Feature: model-entitlement-chain P4 任务 15 — catalog 模式凭证收敛（消除 env 遮蔽）。
import { afterEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../config/types.js";
import type { AuthProfileStore } from "./auth-profiles.js";
import { resolveApiKeyForProvider } from "./model-auth.js";

const EMPTY_STORE: AuthProfileStore = { version: 1, profiles: {} };

// openai 的规范 env 候选是 OPENAI_API_KEY（见 model-auth-env-vars）。
const ENV_VAR = "OPENAI_API_KEY";

function cfg(mode: "legacy" | "catalog" | undefined, withInline = true): OpenBotConfig {
  return {
    ...(mode ? { gateway: { platform: { models: { credentials: { mode } } } } } : {}),
    models: {
      providers: {
        openai: {
          baseUrl: "https://api.openai.com/v1",
          api: "openai-completions",
          ...(withInline ? { apiKey: "sk-inline-configured" } : {}),
          models: [{ id: "gpt-5.2" }],
        },
      },
    },
  } as unknown as OpenBotConfig;
}

let prevEnv: string | undefined;

afterEach(() => {
  if (prevEnv === undefined) {
    delete process.env[ENV_VAR];
  } else {
    process.env[ENV_VAR] = prevEnv;
  }
});

describe("resolveApiKeyForProvider — P4 credentials.mode", () => {
  it("legacy（默认）：ambient env 遮蔽内联 apiKey（现状行为不变）", async () => {
    prevEnv = process.env[ENV_VAR];
    process.env[ENV_VAR] = "sk-ambient-env";
    const resolved = await resolveApiKeyForProvider({
      provider: "openai",
      cfg: cfg("legacy"),
      store: EMPTY_STORE,
    });
    expect(resolved.apiKey).toBe("sk-ambient-env");
  });

  it("catalog：内联目录凭证为单一权威来源，不被 ambient env 遮蔽", async () => {
    prevEnv = process.env[ENV_VAR];
    process.env[ENV_VAR] = "sk-ambient-env";
    const resolved = await resolveApiKeyForProvider({
      provider: "openai",
      cfg: cfg("catalog"),
      store: EMPTY_STORE,
    });
    expect(resolved.apiKey).toBe("sk-inline-configured");
    expect(resolved.mode).toBe("api-key");
    // P4 可追溯：运行时主链显式带出 credentialRef（指向平台目录凭证槽）。
    expect(resolved.credentialRef).toBe("config:models.providers.openai.apiKey");
  });

  it("catalog + SecretRef 目录凭证：经 secrets runtime 解析为单一权威来源，可追溯到 SecretRef", async () => {
    prevEnv = process.env[ENV_VAR];
    // ambient 的常规 provider env 候选（legacy 链会取它）——用于证明 catalog SecretRef 胜出。
    process.env[ENV_VAR] = "sk-ambient-shadow";
    const SECRET_ENV = "CATALOG_DIRECTORY_SECRET_KEY";
    const prevSecretEnv = process.env[SECRET_ENV];
    process.env[SECRET_ENV] = "sk-from-secretref";
    try {
      const secretRefCfg = {
        gateway: { platform: { models: { credentials: { mode: "catalog" } } } },
        models: {
          providers: {
            openai: {
              baseUrl: "https://api.openai.com/v1",
              api: "openai-completions",
              // 目录凭证以 SecretRef 形态配置（而非内联字面 key）。
              apiKey: { source: "env", provider: "default", id: SECRET_ENV },
              models: [{ id: "gpt-5.2" }],
            },
          },
        },
      } as unknown as OpenBotConfig;
      const resolved = await resolveApiKeyForProvider({
        provider: "openai",
        cfg: secretRefCfg,
        store: EMPTY_STORE,
      });
      // 走平台目录 SecretRef 来源，而非回退 ambient env（legacy）。
      expect(resolved.apiKey).toBe("sk-from-secretref");
      expect(resolved.apiKey).not.toBe("sk-ambient-shadow");
      expect(resolved.credentialRef).toBe(`secret:env:default:${SECRET_ENV}`);
    } finally {
      if (prevSecretEnv === undefined) {
        delete process.env[SECRET_ENV];
      } else {
        process.env[SECRET_ENV] = prevSecretEnv;
      }
    }
  });

  it("catalog 但未配置目录凭证：回退到 legacy env 链（回退开关）", async () => {
    prevEnv = process.env[ENV_VAR];
    process.env[ENV_VAR] = "sk-ambient-env";
    const resolved = await resolveApiKeyForProvider({
      provider: "openai",
      cfg: cfg("catalog", false),
      store: EMPTY_STORE,
    });
    expect(resolved.apiKey).toBe("sk-ambient-env");
  });
});

// Plan 3（平台端「配 key 即生效」）：catalog 模式下平台目录凭证优先于残留 auth-profile。
// 运行时顺序：显式 profileId → aws-sdk → catalog → auth-profiles → env → inline。
function storeWithApiKeyProfile(profileId: string, key: string): AuthProfileStore {
  return {
    version: 1,
    profiles: { [profileId]: { type: "api_key", provider: "openai", key } },
  };
}

describe("resolveApiKeyForProvider — catalog vs auth-profile 优先级 (Plan 3)", () => {
  it("catalog：内联目录凭证优先于残留 auth-profile（消除 profile 遮蔽已配置 key）", async () => {
    const resolved = await resolveApiKeyForProvider({
      provider: "openai",
      cfg: cfg("catalog"),
      store: storeWithApiKeyProfile("openai:default", "sk-stale-profile"),
    });
    expect(resolved.apiKey).toBe("sk-inline-configured");
    expect(resolved.credentialRef).toBe("config:models.providers.openai.apiKey");
  });

  it("legacy（默认）：残留 auth-profile 仍优先于内联 key（现状行为不变，回归保护）", async () => {
    const resolved = await resolveApiKeyForProvider({
      provider: "openai",
      cfg: cfg("legacy"),
      store: storeWithApiKeyProfile("openai:default", "sk-stale-profile"),
    });
    expect(resolved.apiKey).toBe("sk-stale-profile");
  });

  it("catalog 但未配置目录凭证：回退到 auth-profile（回退开关，OAuth/profile 不受影响）", async () => {
    const resolved = await resolveApiKeyForProvider({
      provider: "openai",
      cfg: cfg("catalog", false),
      store: storeWithApiKeyProfile("openai:default", "sk-stale-profile"),
    });
    expect(resolved.apiKey).toBe("sk-stale-profile");
  });

  it("catalog：显式 profileId 请求仍优先于目录凭证（不被收敛）", async () => {
    const resolved = await resolveApiKeyForProvider({
      provider: "openai",
      cfg: cfg("catalog"),
      store: storeWithApiKeyProfile("openai:explicit", "sk-explicit-profile"),
      profileId: "openai:explicit",
    });
    expect(resolved.apiKey).toBe("sk-explicit-profile");
  });
});
