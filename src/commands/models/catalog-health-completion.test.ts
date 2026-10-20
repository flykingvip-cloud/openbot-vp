import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveProductionSandboxAccount } from "../../agents/sandbox/account-scope.js";
import type { OpenBotConfig } from "../../config/config.js";

type CatalogCompletion = {
  stopReason: string;
  content: Array<{ type: string; text: string }>;
  errorMessage?: string;
};

const completeMock = vi.hoisted(() =>
  vi.fn(
    async (..._args: unknown[]): Promise<CatalogCompletion> => ({
      stopReason: "stop",
      content: [{ type: "text", text: "OK" }],
    }),
  ),
);

vi.mock("@earendil-works/pi-ai/compat", () => ({
  complete: (...args: unknown[]) => completeMock(...args),
}));

vi.mock("../../agents/models-config.js", () => ({
  ensureOpenClawModelsJson: vi.fn(async () => ({ agentDir: "/tmp/agent", wrote: false })),
}));

const deepseekModel = {
  id: "deepseek-v4-flash",
  name: "DeepSeek V4 Flash",
  api: "openai-completions",
  provider: "api-proxy-deepseek",
  baseUrl: "https://api.deepseek.com",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128000,
  maxTokens: 8192,
};

vi.mock("../../agents/pi-embedded-runner/model.js", () => ({
  resolveModel: vi.fn(async () => ({
    model: deepseekModel,
    authStorage: {},
    modelRegistry: {},
  })),
}));

const getApiKeyForModel = vi.hoisted(() =>
  vi.fn(
    async (..._args: unknown[]): Promise<{ apiKey?: string; source: string; mode: "api-key" }> => ({
      apiKey: "sk-test",
      source: "models.json",
      mode: "api-key",
    }),
  ),
);

vi.mock("../../agents/model-auth.js", () => ({
  getApiKeyForModel: (...args: unknown[]) => getApiKeyForModel(...args),
  requireApiKey: (auth: { apiKey?: string }, provider: string) => {
    if (!auth.apiKey) {
      throw new Error(`No API key resolved for provider "${provider}"`);
    }
    return auth.apiKey;
  },
}));

const { runCatalogHealthCompletion } = await import("./catalog-health-completion.js");

const managedCfg = { data: { mode: "managed" } } as OpenBotConfig;

describe("runCatalogHealthCompletion", () => {
  const prevMode = process.env.OPENBOT_DATA_MODE;
  const prevMulti = process.env.OPENBOT_MULTITENANT;

  beforeEach(() => {
    completeMock.mockReset();
    completeMock.mockResolvedValue({ stopReason: "stop", content: [{ type: "text", text: "OK" }] });
    getApiKeyForModel.mockReset();
    getApiKeyForModel.mockResolvedValue({
      apiKey: "sk-test",
      source: "models.json",
      mode: "api-key",
    });
    process.env.OPENBOT_DATA_MODE = "managed";
    process.env.OPENBOT_MULTITENANT = "1";
  });

  afterEach(() => {
    if (prevMode === undefined) {
      delete process.env.OPENBOT_DATA_MODE;
    } else {
      process.env.OPENBOT_DATA_MODE = prevMode;
    }
    if (prevMulti === undefined) {
      delete process.env.OPENBOT_MULTITENANT;
    } else {
      process.env.OPENBOT_MULTITENANT = prevMulti;
    }
  });

  it("completes against the provider when managed sandbox has no account", async () => {
    expect(() =>
      resolveProductionSandboxAccount({
        config: managedCfg,
        agentId: "main",
      }),
    ).toThrow(/server-derived account/);

    await runCatalogHealthCompletion({
      cfg: managedCfg,
      agentDir: "/tmp/agent",
      provider: "api-proxy-deepseek",
      modelId: "deepseek-v4-flash",
      authProfileId: "deepseek:default",
      timeoutMs: 8000,
      maxTokens: 8,
    });

    expect(getApiKeyForModel).toHaveBeenCalledWith(
      expect.objectContaining({
        profileId: "deepseek:default",
        agentDir: "/tmp/agent",
      }),
    );
    expect(completeMock).toHaveBeenCalledTimes(1);
    const [model, context, options] = completeMock.mock.calls[0] ?? [];
    expect(model).toMatchObject({
      provider: "api-proxy-deepseek",
      id: "deepseek-v4-flash",
      baseUrl: "https://api.deepseek.com",
      api: "openai-completions",
    });
    expect(context).toMatchObject({
      messages: [{ role: "user", content: "Reply with OK. Do not use tools." }],
    });
    expect(options).toMatchObject({ apiKey: "sk-test", maxTokens: 8, temperature: 0 });
  });

  it("does not call the provider when no API key can be resolved", async () => {
    getApiKeyForModel.mockResolvedValueOnce({
      apiKey: undefined,
      source: "none",
      mode: "api-key",
    });
    await expect(
      runCatalogHealthCompletion({
        cfg: managedCfg,
        agentDir: "/tmp/agent",
        provider: "api-proxy-deepseek",
        modelId: "deepseek-v4-flash",
        timeoutMs: 1000,
        maxTokens: 8,
      }),
    ).rejects.toThrow(/No API key resolved/);
    expect(completeMock).not.toHaveBeenCalled();
  });

  it("surfaces a provider error payload instead of treating it as connected", async () => {
    completeMock.mockResolvedValueOnce({
      stopReason: "error",
      errorMessage: "invalid api key",
      content: [],
    });
    await expect(
      runCatalogHealthCompletion({
        cfg: managedCfg,
        agentDir: "/tmp/agent",
        provider: "api-proxy-deepseek",
        modelId: "deepseek-v4-flash",
        timeoutMs: 1000,
        maxTokens: 8,
      }),
    ).rejects.toThrow(/invalid api key/);
  });

  it("stays off the embedded agent and account sandbox", () => {
    const completion = fs.readFileSync(
      new URL("./catalog-health-completion.ts", import.meta.url),
      "utf8",
    );
    const probe = fs.readFileSync(new URL("./list.probe.ts", import.meta.url), "utf8");
    expect(completion).not.toContain("runEmbeddedPiAgent");
    expect(completion).not.toContain("resolveSandboxContext");
    expect(completion).not.toContain("resolveProductionSandboxAccount");
    expect(completion).not.toContain("personalFallback");
    expect(probe).not.toContain("runEmbeddedPiAgent");
    expect(probe).toContain("runCatalogHealthCompletion");
  });
});
