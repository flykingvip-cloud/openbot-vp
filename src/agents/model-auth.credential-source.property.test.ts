// @vitest-environment node
// Feature: model-entitlement-chain, P4 任务 15.1 — Property 6（credential 解析唯一可追溯）
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../config/types.js";
import {
  resolveModelCredentialsMode,
  resolveProviderCredentialSource,
} from "./model-credential-source.js";

function cfgWithInlineKey(
  provider: string,
  apiKey: string,
  credentialsMode?: "legacy" | "catalog",
): OpenBotConfig {
  return {
    ...(credentialsMode
      ? { gateway: { platform: { models: { credentials: { mode: credentialsMode } } } } }
      : {}),
    models: {
      providers: {
        [provider]: {
          baseUrl: "https://api.example.com/v1",
          api: "openai-completions",
          apiKey,
          models: [{ id: "m1" }],
        },
      },
    },
  } as unknown as OpenBotConfig;
}

describe("resolveModelCredentialsMode", () => {
  it("默认 legacy（未配置）", () => {
    expect(resolveModelCredentialsMode(undefined)).toBe("legacy");
    expect(resolveModelCredentialsMode({} as OpenBotConfig)).toBe("legacy");
  });

  it("显式 catalog", () => {
    expect(resolveModelCredentialsMode(cfgWithInlineKey("p", "sk-x", "catalog"))).toBe("catalog");
  });
});

describe("resolveProviderCredentialSource — Property 6", () => {
  it("内联字面 key → 可追溯到 config credentialRef", () => {
    const res = resolveProviderCredentialSource({
      cfg: cfgWithInlineKey("api-proxy-deepseek", "sk-literal-123"),
      provider: "api-proxy-deepseek",
    });
    expect(res).not.toBeNull();
    expect(res!.apiKey).toBe("sk-literal-123");
    expect(res!.credentialRef).toBe("config:models.providers.api-proxy-deepseek.apiKey");
  });

  it("未配置目录凭证 → 返回 null（catalog 模式回退 legacy 的依据）", () => {
    const res = resolveProviderCredentialSource({
      cfg: { models: { providers: {} } } as unknown as OpenBotConfig,
      provider: "api-proxy-deepseek",
    });
    expect(res).toBeNull();
  });

  it("内联凭证不被 ambient env 遮蔽（env 注入不改变解析结果）", () => {
    const cfg = cfgWithInlineKey("api-proxy-deepseek", "sk-inline");
    const withEnv = resolveProviderCredentialSource({
      cfg,
      provider: "api-proxy-deepseek",
      env: { DEEPSEEK_API_KEY: "sk-ambient-env-shadow" } as NodeJS.ProcessEnv,
    });
    expect(withEnv!.apiKey).toBe("sk-inline");
  });

  it("Property：同一 provider + cfg 的解析结果唯一且确定（多次调用一致）", () => {
    const arbKey = fc.string({ minLength: 6, maxLength: 40 }).filter((s) => s.trim().length >= 6);
    const arbProvider = fc.constantFrom("api-proxy-deepseek", "api-proxy-gpt", "custom-x");
    fc.assert(
      fc.property(arbProvider, arbKey, (provider, apiKey) => {
        const cfg = cfgWithInlineKey(provider, apiKey);
        const a = resolveProviderCredentialSource({ cfg, provider });
        const b = resolveProviderCredentialSource({ cfg, provider });
        // 唯一确定：两次解析完全一致。
        expect(a).toEqual(b);
        if (a) {
          // 可追溯：credentialRef 唯一指向该 provider 的目录凭证。
          expect(a.credentialRef).toContain(provider);
          expect(a.apiKey).toBe(apiKey.trim());
        }
      }),
      { numRuns: 100 },
    );
  });
});
