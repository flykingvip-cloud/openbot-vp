import { describe, expect, it, vi } from "vitest";
import { resolveStreamApiKey, wrapStreamFnWithResolvedApiKey } from "./stream-api-key.js";

describe("wrapStreamFnWithResolvedApiKey", () => {
  it("injects the resolved key when stream options omit apiKey", () => {
    const baseFn = vi.fn();
    const wrapped = wrapStreamFnWithResolvedApiKey(baseFn, "sk-resolved");
    void wrapped({ id: "m" } as never, { messages: [] } as never, { maxTokens: 8 });
    expect(baseFn).toHaveBeenCalledWith(
      { id: "m" },
      { messages: [] },
      expect.objectContaining({ maxTokens: 8, apiKey: "sk-resolved" }),
    );
  });

  it("does not overwrite an explicit stream apiKey", () => {
    const baseFn = vi.fn();
    const wrapped = wrapStreamFnWithResolvedApiKey(baseFn, "sk-resolved");
    void wrapped({ id: "m" } as never, { messages: [] } as never, { apiKey: "sk-explicit" });
    expect(baseFn).toHaveBeenCalledWith(
      { id: "m" },
      { messages: [] },
      expect.objectContaining({ apiKey: "sk-explicit" }),
    );
  });

  it("returns the original function when no key was resolved", () => {
    const baseFn = vi.fn();
    expect(wrapStreamFnWithResolvedApiKey(baseFn, "  ")).toBe(baseFn);
    expect(wrapStreamFnWithResolvedApiKey(baseFn, undefined)).toBe(baseFn);
  });
});

describe("resolveStreamApiKey", () => {
  it("prefers the model provider, then falls back to the run provider", async () => {
    const getApiKey = vi.fn(async (provider: string) =>
      provider === "api-proxy-deepseek" ? "sk-ds" : undefined,
    );
    await expect(
      resolveStreamApiKey({
        getApiKey,
        modelProvider: "api-proxy-deepseek",
        provider: "openai",
      }),
    ).resolves.toBe("sk-ds");
    expect(getApiKey).toHaveBeenCalledWith("api-proxy-deepseek");
    expect(getApiKey).not.toHaveBeenCalledWith("openai");
  });
});
