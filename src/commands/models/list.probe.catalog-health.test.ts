import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthProfileStore } from "../../agents/auth-profiles.js";
import { resolveProductionSandboxAccount } from "../../agents/sandbox/account-scope.js";
import type { OpenBotConfig } from "../../config/config.js";

const runCatalogHealthCompletion = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => {}));

vi.mock("./catalog-health-completion.js", () => ({
  runCatalogHealthCompletion: (...args: unknown[]) => runCatalogHealthCompletion(...args),
}));

vi.mock("../../agents/model-catalog.js", () => ({
  loadModelCatalog: vi.fn(async () => []),
}));

let mockStore: AuthProfileStore;

vi.mock("../../agents/auth-profiles.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../agents/auth-profiles.js")>();
  return {
    ...actual,
    ensureAuthProfileStore: () => mockStore,
    listProfilesForProvider: () => [],
    resolveAuthProfileDisplayLabel: ({ profileId }: { profileId: string }) => profileId,
    resolveAuthProfileOrder: () => [],
  };
});

const { runAuthProbes } = await import("./list.probe.js");

const managedCfg = {
  data: { mode: "managed" },
  models: {
    providers: {
      "api-proxy-deepseek": {
        baseUrl: "https://api.deepseek.com",
        api: "openai-completions",
        apiKey: "sk-deepseek-test",
        models: [{ id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" }],
      },
    },
  },
} as unknown as OpenBotConfig;

describe("models.probe catalog health", () => {
  const prevMode = process.env.OPENBOT_DATA_MODE;
  const prevMulti = process.env.OPENBOT_MULTITENANT;

  beforeEach(() => {
    mockStore = { version: 1, profiles: {} };
    runCatalogHealthCompletion.mockReset();
    runCatalogHealthCompletion.mockResolvedValue(undefined);
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

  it("marks a reachable provider connected without an account sandbox", async () => {
    expect(() =>
      resolveProductionSandboxAccount({
        config: managedCfg,
        agentId: "main",
      }),
    ).toThrow(/Managed multitenant sandbox requires a server-derived account/);

    const summary = await runAuthProbes({
      cfg: managedCfg,
      providers: ["api-proxy-deepseek"],
      modelCandidates: ["api-proxy-deepseek/deepseek-v4-flash"],
      options: {
        provider: "api-proxy-deepseek",
        modelRef: "api-proxy-deepseek/deepseek-v4-flash",
        timeoutMs: 8000,
        concurrency: 1,
        maxTokens: 8,
      },
    });

    expect(runCatalogHealthCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "api-proxy-deepseek",
        modelId: "deepseek-v4-flash",
        timeoutMs: 8000,
        maxTokens: 8,
      }),
    );
    expect(summary.results).toEqual([
      expect.objectContaining({
        provider: "api-proxy-deepseek",
        model: "api-proxy-deepseek/deepseek-v4-flash",
        status: "ok",
      }),
    ]);
    expect(summary.results[0]?.error ?? "").not.toMatch(/server-derived account/);
  });

  it("keeps a provider auth failure as a failed probe", async () => {
    runCatalogHealthCompletion.mockRejectedValueOnce(new Error("invalid api key"));
    const summary = await runAuthProbes({
      cfg: managedCfg,
      providers: ["api-proxy-deepseek"],
      modelCandidates: ["api-proxy-deepseek/deepseek-v4-flash"],
      options: {
        provider: "api-proxy-deepseek",
        timeoutMs: 8000,
        concurrency: 1,
        maxTokens: 8,
      },
    });
    expect(summary.results[0]).toMatchObject({
      status: "auth",
      error: expect.stringMatching(/invalid api key/),
    });
  });
});
