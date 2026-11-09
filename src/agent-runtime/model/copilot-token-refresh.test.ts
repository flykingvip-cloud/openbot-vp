import { afterEach, expect, it, vi } from "vitest";
import { createCopilotTokenRefresh } from "./copilot-token-refresh.js";
const resolve = vi.hoisted(() => vi.fn());
vi.mock("../../providers/github-copilot-token.js", () => ({ resolveCopilotApiToken: resolve }));
afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});
it("does not schedule or refresh an unrelated provider", async () => {
  vi.useFakeTimers();
  const setRuntimeApiKey = vi.fn();
  const lifecycle = createCopilotTokenRefresh({
    enabled: false,
    setRuntimeApiKey,
    describeError: String,
    log: { debug: vi.fn(), warn: vi.fn() },
  });
  lifecycle.remember("test-token", Date.now());
  lifecycle.schedule();
  await lifecycle.refresh("unused");
  expect(vi.getTimerCount()).toBe(0);
  expect(resolve).not.toHaveBeenCalled();
  expect(setRuntimeApiKey).not.toHaveBeenCalled();
});
it("refreshes at the original margin and cancels the next timer on cleanup", async () => {
  vi.useFakeTimers();
  const setRuntimeApiKey = vi.fn();
  resolve.mockImplementation(async () => ({
    token: "refreshed-test-token",
    expiresAt: Date.now() + 600_000,
  }));
  const lifecycle = createCopilotTokenRefresh({
    enabled: true,
    setRuntimeApiKey,
    describeError: String,
    log: { debug: vi.fn(), warn: vi.fn() },
  });
  lifecycle.remember("test-github-token", Date.now() + 600_000);
  lifecycle.schedule();
  await vi.advanceTimersByTimeAsync(300_000);
  await vi.dynamicImportSettled();
  expect(resolve).toHaveBeenCalledExactlyOnceWith({ githubToken: "test-github-token" });
  expect(setRuntimeApiKey).toHaveBeenCalledWith("refreshed-test-token");
  lifecycle.stop();
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(600_000);
  expect(resolve).toHaveBeenCalledTimes(1);
});
