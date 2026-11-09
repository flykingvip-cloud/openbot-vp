import { beforeEach, expect, it, vi } from "vitest";
import { resolveModel } from "../../agents/pi-embedded-runner/model.js";
import { prepareEmbeddedModel } from "./prepare-embedded-model.js";
vi.mock("../../agents/pi-embedded-runner/model.js", () => ({ resolveModel: vi.fn() }));
beforeEach(() => vi.resetAllMocks());
const base = {
  provider: "custom",
  modelId: "m",
  agentDir: "/tmp/test-model",
  log: { warn: vi.fn(), error: vi.fn() },
};
it("synthesizes BYOK models and applies the effective context cap", async () => {
  vi.mocked(resolveModel).mockResolvedValue({
    model: undefined,
    error: "missing",
    authStorage: {},
    modelRegistry: {},
  } as Awaited<ReturnType<typeof resolveModel>>);
  const result = await prepareEmbeddedModel({
    ...base,
    config: { agents: { defaults: { contextTokens: 32_000 } } },
    providerAuthOverride: {
      apiKey: "test-only",
      baseUrl: " https://example.invalid/api ",
      protocol: "anthropic",
    },
  });
  expect(result.effectiveModel).toMatchObject({
    id: "m",
    api: "anthropic-messages",
    contextWindow: 32_000,
    baseUrl: "https://example.invalid/api",
  });
  expect(result.ctxInfo.source).toBe("agentContextTokens");
});
it("rejects missing models without credentials", async () => {
  vi.mocked(resolveModel).mockResolvedValue({
    model: undefined,
    error: "missing model",
    authStorage: {},
    modelRegistry: {},
  } as Awaited<ReturnType<typeof resolveModel>>);
  await expect(prepareEmbeddedModel(base)).rejects.toMatchObject({ reason: "model_not_found" });
});
