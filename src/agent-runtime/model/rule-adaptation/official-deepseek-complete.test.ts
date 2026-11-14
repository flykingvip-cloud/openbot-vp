import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createOfficialDeepSeekShadowCompletion,
  resolveOfficialDeepSeekCredential,
} from "./official-deepseek-complete.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

const cred = {
  apiKey: "sk-test",
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-v4-flash",
  provider: "deepseek",
};

describe("resolveOfficialDeepSeekCredential", () => {
  it("reads only the official DeepSeek env key and rejects a non-official base URL", () => {
    expect(
      resolveOfficialDeepSeekCredential({
        DEEPSEEK_API_KEY: "sk-official",
        OPENBOT_P4_LIVE_API_KEY: "sk-p4",
        DEEPSEEK_BASE_URL: "https://api.deepseek.com",
      }),
    ).toMatchObject({
      apiKey: "sk-official",
      baseUrl: "https://api.deepseek.com",
      provider: "deepseek",
      model: "deepseek-v4-flash",
    });
    expect(
      resolveOfficialDeepSeekCredential({
        DEEPSEEK_API_KEY: "sk-official",
        DEEPSEEK_BASE_URL: "https://example.invalid",
      }),
    ).toBeNull();
  });
});

describe("createOfficialDeepSeekShadowCompletion", () => {
  it("sends the governance-selected model, not the closed-over default, when the selected provider is official DeepSeek", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "{}" } }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const complete = createOfficialDeepSeekShadowCompletion(cred);
    const result = await complete({
      system: "sys",
      messages: [],
      tools: [],
      maxTokens: 16,
      timeoutMs: 1000,
      selectedProvider: "deepseek",
      selectedModel: "deepseek-v4-pro",
      governance: {} as never,
    });
    expect(result.kind).toBe("message");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0] as unknown as [string, { body?: string }];
    expect(JSON.parse(call[1].body ?? "{}")).toMatchObject({ model: "deepseek-v4-pro" });
    expect(JSON.parse(call[1].body ?? "{}").model).not.toBe("deepseek-v4-flash");
  });

  it("does not call DeepSeek HTTP when fallback selected a different provider", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const complete = createOfficialDeepSeekShadowCompletion(cred);
    const result = await complete({
      system: "sys",
      messages: [],
      tools: [],
      maxTokens: 16,
      timeoutMs: 1000,
      selectedProvider: "openai",
      selectedModel: "gpt-4.1",
      governance: {} as never,
    });
    expect(result).toMatchObject({
      kind: "protocol_failure",
      detail: "governance_selected_provider_mismatch:openai",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not invent a DeepSeek request when the selected model is missing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const complete = createOfficialDeepSeekShadowCompletion(cred);
    const result = await complete({
      system: "sys",
      messages: [],
      tools: [],
      maxTokens: 16,
      timeoutMs: 1000,
      governance: {} as never,
    } as never);
    expect(result).toMatchObject({
      kind: "protocol_failure",
      detail: "governance_selected_provider_or_model_missing",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
