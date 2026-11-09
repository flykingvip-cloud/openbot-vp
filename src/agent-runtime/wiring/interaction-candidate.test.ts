import type { Api, Model } from "@earendil-works/pi-ai/compat";
import { beforeEach, expect, it, vi } from "vitest";
import { bindInteractionCandidate } from "./interaction-candidate.js";
const mocks = vi.hoisted(() => ({
  account: vi.fn(),
  transport: vi.fn(),
  ensure: vi.fn(),
  resolve: vi.fn(),
  auth: vi.fn(),
  copilot: vi.fn(),
}));
vi.mock("../../agents/sandbox/account-scope.js", () => ({
  resolveProductionSandboxAccount: mocks.account,
}));
vi.mock("../../gateway/enterprise-model/embedded-transport.js", () => ({
  resolveEnterpriseEmbeddedTransport: mocks.transport,
}));
vi.mock("../../agents/models-config.js", () => ({ ensureOpenClawModelsJson: mocks.ensure }));
vi.mock("../../agents/pi-embedded-runner/model.js", () => ({ resolveModel: mocks.resolve }));
vi.mock("../../agents/model-auth.js", () => ({ getApiKeyForModel: mocks.auth }));
vi.mock("../../providers/github-copilot-token.js", () => ({
  resolveCopilotApiToken: mocks.copilot,
}));
const model = {
  id: "model",
  provider: "provider",
  api: "openai-completions",
  baseUrl: "https://example.invalid/v1",
} as Model<Api>;
const params = {
  config: {},
  agentDir: "/tmp/test-agent",
  agentId: "bot",
  identity: { gatewayClientPlatformUserId: "user", gatewayClientSessionEnterpriseId: "tenant" },
  primaryProvider: "provider",
  authProfileId: "primary-profile",
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.transport.mockImplementation(async (p) => ({ provider: p.provider, model: p.model }));
  mocks.resolve.mockResolvedValue({ model });
  mocks.auth.mockResolvedValue({ apiKey: "fake-key", mode: "api-key" });
});
it("rejects missing managed identity before credential or model access", () => {
  mocks.account.mockImplementation(() => {
    throw new Error("missing account");
  });
  expect(() => bindInteractionCandidate(params)).toThrow(/account/);
  expect(mocks.auth).not.toHaveBeenCalled();
  expect(mocks.resolve).not.toHaveBeenCalled();
});
it("keeps the trusted tenant and primary profile without copying it to a fallback", async () => {
  const resolve = bindInteractionCandidate(params);
  expect(await resolve("provider", "model")).toEqual({ model, apiKey: "fake-key" });
  expect(mocks.transport).toHaveBeenCalledWith({
    provider: "provider",
    model: "model",
    tenantId: "tenant",
  });
  expect(mocks.auth.mock.calls[0]?.[0].profileId).toBe("primary-profile");
  await resolve("fallback", "model");
  expect(mocks.auth.mock.calls[1]?.[0].profileId).toBeUndefined();
});
it("resolves tenant BYOK credentials without falling back to host defaults", async () => {
  mocks.transport.mockResolvedValue({
    provider: "custom",
    model: "upstream",
    providerAuthOverride: {
      apiKey: "tenant-key",
      source: "enterprise-byok",
      protocol: "openai",
      baseUrl: "https://tenant.invalid/v1",
    },
  });
  mocks.resolve.mockResolvedValue({});
  const result = await bindInteractionCandidate(params)("ent", "connection/model");
  expect(result.model).toMatchObject({
    id: "upstream",
    provider: "custom",
    baseUrl: "https://tenant.invalid/v1",
  });
  expect(mocks.auth).toHaveBeenCalledWith(
    expect.objectContaining({ authOverride: { apiKey: "tenant-key", source: "enterprise-byok" } }),
  );
});
it("refuses missing credentials and unknown models", async () => {
  mocks.auth.mockResolvedValue({ mode: "api-key" });
  await expect(bindInteractionCandidate(params)("provider", "model")).rejects.toThrow(/credential/);
  mocks.resolve.mockResolvedValue({ error: "Unknown model" });
  await expect(bindInteractionCandidate(params)("provider", "model")).rejects.toThrow(/Unknown/);
});
it("honors cancellation before model discovery", async () => {
  await expect(
    bindInteractionCandidate({ ...params, signal: AbortSignal.abort() })("provider", "model"),
  ).rejects.toThrow();
  expect(mocks.resolve).not.toHaveBeenCalled();
  expect(mocks.auth).not.toHaveBeenCalled();
});
it("converts Copilot tokens and permits keyless AWS credentials", async () => {
  mocks.resolve.mockResolvedValue({ model: { ...model, provider: "github-copilot" } });
  mocks.copilot.mockResolvedValue({ token: "fake-copilot-token" });
  expect((await bindInteractionCandidate(params)("provider", "model")).apiKey).toBe(
    "fake-copilot-token",
  );
  mocks.resolve.mockResolvedValue({ model });
  mocks.auth.mockResolvedValue({ mode: "aws-sdk" });
  expect((await bindInteractionCandidate(params)("provider", "model")).apiKey).toBeUndefined();
});
