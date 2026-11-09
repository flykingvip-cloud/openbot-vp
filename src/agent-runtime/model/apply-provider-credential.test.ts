import { afterEach, expect, it, vi } from "vitest";
import { applyProviderCredential } from "./apply-provider-credential.js";
const resolve = vi.hoisted(() => vi.fn());
vi.mock("../../providers/github-copilot-token.js", () => ({ resolveCopilotApiToken: resolve }));
afterEach(() => vi.resetAllMocks());
function ports() {
  return {
    setRuntimeApiKey: vi.fn(),
    copilotRefresh: { enabled: true, remember: vi.fn(), schedule: vi.fn() },
  };
}
it("applies ordinary provider credentials without scheduling refresh", async () => {
  const p = ports();
  expect(
    await applyProviderCredential({
      ...p,
      provider: "example",
      credential: {
        apiKey: "test-key",
        profileId: "profile-test",
        mode: "api-key",
        source: "test",
      },
    }),
  ).toBe("profile-test");
  expect(p.setRuntimeApiKey).toHaveBeenCalledExactlyOnceWith("example", "test-key");
  expect(p.copilotRefresh.schedule).not.toHaveBeenCalled();
});
it("retains AWS SDK candidate identity without requiring an API key", async () => {
  const p = ports();
  expect(
    await applyProviderCredential({
      ...p,
      provider: "amazon-bedrock",
      candidate: "aws-profile",
      credential: { mode: "aws-sdk", source: "test" },
    }),
  ).toBe("aws-profile");
  expect(p.setRuntimeApiKey).not.toHaveBeenCalled();
});
it("rejects missing non-SDK credentials before applying anything", async () => {
  const p = ports();
  await expect(
    applyProviderCredential({
      ...p,
      provider: "example",
      credential: { mode: "token", source: "test" },
    }),
  ).rejects.toThrow("No API key resolved");
  expect(p.setRuntimeApiKey).not.toHaveBeenCalled();
});
it("exchanges Copilot credentials before remembering and scheduling refresh", async () => {
  const p = ports();
  resolve.mockResolvedValue({ token: "test-runtime-token", expiresAt: 12345 });
  await applyProviderCredential({
    ...p,
    provider: "github-copilot",
    credential: { apiKey: "test-github-token", mode: "token", source: "test" },
  });
  expect(resolve).toHaveBeenCalledExactlyOnceWith({ githubToken: "test-github-token" });
  expect(p.setRuntimeApiKey).toHaveBeenCalledExactlyOnceWith(
    "github-copilot",
    "test-runtime-token",
  );
  expect(p.copilotRefresh.remember).toHaveBeenCalledExactlyOnceWith("test-github-token", 12345);
  expect(p.copilotRefresh.schedule).toHaveBeenCalledOnce();
});
