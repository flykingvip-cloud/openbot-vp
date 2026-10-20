import { describe, expect, it } from "vitest";
import {
  buildCommercialRunCreditUsageInput,
  normalizeRuntimeFallbackAttempts,
  resolveCommercialRunRetryCount,
} from "./agent-run-credit-usage.js";

describe("agent-run-credit-usage", () => {
  it("resolveCommercialRunRetryCount counts prior fallback attempts", () => {
    expect(resolveCommercialRunRetryCount([])).toBe(0);
    expect(resolveCommercialRunRetryCount([{ provider: "p", model: "m", error: "ok" }])).toBe(0);
    expect(
      resolveCommercialRunRetryCount([
        { provider: "p1", model: "m1", error: "fail" },
        { provider: "p2", model: "m2", error: "ok" },
      ]),
    ).toBe(1);
    expect(
      resolveCommercialRunRetryCount([
        { provider: "p1", model: "m1", error: "fail" },
        { provider: "p2", model: "m2", error: "fail" },
        { provider: "p3", model: "m3", error: "ok" },
      ]),
    ).toBe(2);
  });

  it("buildCommercialRunCreditUsageInput snapshots toolClasses and retryCount from attempts", () => {
    const mutableToolClasses = ["browser_click", "read"];
    const payload = buildCommercialRunCreditUsageInput({
      enterpriseId: "ent-1",
      policyId: "balanced",
      runId: "run-42",
      provider: "openai",
      model: "gpt-4o",
      durationMs: 45_000,
      toolCallCount: 2,
      toolClasses: mutableToolClasses,
      fallbackAttemptsRaw: [
        { provider: "openai", model: "gpt-4o-mini", error: "rate limit" },
        { provider: "openai", model: "gpt-4o", error: "" },
      ],
      tokenUsage: { input: 100, output: 50 },
    });

    mutableToolClasses.length = 0;

    expect(payload.retryCount).toBe(1);
    expect(payload.toolClasses).toEqual(["browser_click", "read"]);
    expect(payload.durationMs).toBe(45_000);
    expect(payload.toolCallCount).toBe(2);
    expect(payload.modelId).toBe("openai/gpt-4o");
    expect(payload.tokenUsage).toEqual({ inputTokens: 100, outputTokens: 50 });
  });

  it("normalizeRuntimeFallbackAttempts tolerates missing attempts", () => {
    expect(normalizeRuntimeFallbackAttempts(undefined)).toEqual([]);
    expect(normalizeRuntimeFallbackAttempts(null)).toEqual([]);
  });
});
