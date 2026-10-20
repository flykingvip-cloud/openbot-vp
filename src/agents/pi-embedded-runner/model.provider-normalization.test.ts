import type { Model } from "@earendil-works/pi-ai/compat";
import { describe, expect, it } from "vitest";
import { normalizeResolvedProviderModel } from "./model.provider-normalization.js";

describe("normalizeResolvedProviderModel deepseek legacy ids", () => {
  it("maps deepseek-chat to deepseek-v4-flash for official DeepSeek API providers", () => {
    const model = normalizeResolvedProviderModel({
      provider: "api-proxy-deepseek",
      model: {
        id: "deepseek-chat",
        name: "DeepSeek Chat",
        api: "openai-completions",
        provider: "api-proxy-deepseek",
        baseUrl: "https://api.deepseek.com",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 131072,
        maxTokens: 8192,
      } as Model<"openai-completions">,
    });

    expect(model.id).toBe("deepseek-v4-flash");
    expect(model.input).toEqual(["text", "image"]);
  });

  it("maps deepseek-reasoner to deepseek-v4-flash with reasoning enabled", () => {
    const model = normalizeResolvedProviderModel({
      provider: "api-proxy-deepseek",
      model: {
        id: "deepseek-reasoner",
        name: "DeepSeek Reasoner",
        api: "openai-completions",
        provider: "api-proxy-deepseek",
        baseUrl: "https://api.deepseek.com",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 131072,
        maxTokens: 8192,
      } as Model<"openai-completions">,
    });

    expect(model.id).toBe("deepseek-v4-flash");
    expect(model.reasoning).toBe(true);
    expect(model.input).toEqual(["text", "image"]);
  });

  it("leaves non-legacy model ids unchanged", () => {
    const model = normalizeResolvedProviderModel({
      provider: "api-proxy-deepseek",
      model: {
        id: "deepseek-v4-pro",
        name: "DeepSeek V4 Pro",
        api: "openai-completions",
        provider: "api-proxy-deepseek",
        baseUrl: "https://api.deepseek.com",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 131072,
        maxTokens: 8192,
      } as Model<"openai-completions">,
    });

    expect(model.id).toBe("deepseek-v4-pro");
    expect(model.input).toEqual(["text", "image"]);
  });

  it("does not rewrite deepseek-chat on non-DeepSeek OpenAI-compatible proxies", () => {
    const model = normalizeResolvedProviderModel({
      provider: "openrouter",
      model: {
        id: "deepseek-chat",
        name: "DeepSeek Chat",
        api: "openai-completions",
        provider: "openrouter",
        baseUrl: "https://openrouter.ai/api/v1",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 131072,
        maxTokens: 8192,
      } as Model<"openai-completions">,
    });

    expect(model.id).toBe("deepseek-chat");
    expect(model.input).toEqual(["text"]);
  });

  it("marks official DeepSeek V4 Flash as vision even when config omitted input", () => {
    const model = normalizeResolvedProviderModel({
      provider: "api-proxy-deepseek",
      model: {
        id: "deepseek-v4-flash",
        name: "DeepSeek V4 Flash",
        api: "openai-completions",
        provider: "api-proxy-deepseek",
        baseUrl: "https://api.deepseek.com",
        reasoning: false,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 131072,
        maxTokens: 8192,
      } as Model<"openai-completions">,
    });

    expect(model.input).toEqual(["text", "image"]);
  });

  it("does not infer vision for DeepSeek IDs on a third-party OpenAI-compatible host", () => {
    const model = normalizeResolvedProviderModel({
      provider: "api-proxy-deepseek",
      model: {
        id: "deepseek-v4-flash",
        name: "DeepSeek V4 Flash",
        api: "openai-completions",
        provider: "api-proxy-deepseek",
        baseUrl: "https://proxy.example.com/v1",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 131072,
        maxTokens: 8192,
      } as Model<"openai-completions">,
    });

    expect(model.input).toEqual(["text"]);
  });

  it("keeps an explicit vision input on a custom OpenAI-compatible endpoint", () => {
    const model = normalizeResolvedProviderModel({
      provider: "custom-vlm",
      model: {
        id: "my-vlm",
        name: "Custom VLM",
        api: "openai-completions",
        provider: "custom-vlm",
        baseUrl: "https://proxy.example.com/v1",
        reasoning: false,
        input: ["text", "image"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 32000,
        maxTokens: 4096,
      } as Model<"openai-completions">,
    });

    expect(model.input).toEqual(["text", "image"]);
  });
});
