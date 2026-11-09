import type { Api, Model } from "@earendil-works/pi-ai/compat";
import { expect, it, vi } from "vitest";
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@earendil-works/pi-ai/compat", async (original) => ({
  ...(await original<typeof import("@earendil-works/pi-ai/compat")>()),
  complete: invoke,
}));
import { invokeMetadataCompletion } from "./index.js";
it("sends zero tools and preserves usage before JSON validation", async () => {
  const model = fixture;
  invoke.mockResolvedValue({
    stopReason: "stop",
    content: [{ type: "text", text: "invalid" }],
    usage: { input: 7, output: 3 },
  });
  const result = await invokeMetadataCompletion({
    model,
    metadata: { evidence: [] },
    modelRef: "anthropic/test",
    signal: new AbortController().signal,
    maxTokens: 64,
  });
  expect(invoke.mock.calls[0]?.[1].tools).toEqual([]);
  expect(result.response.usage.input).toBe(7);
  expect(() => result.readValue()).toThrow();
});
it("aborted input never invokes transport", async () => {
  invoke.mockClear();
  const controller = new AbortController();
  controller.abort();
  await expect(
    invokeMetadataCompletion({
      model: fixture,
      metadata: {},
      modelRef: "test",
      signal: controller.signal,
      maxTokens: 64,
    }),
  ).rejects.toThrow();
  expect(invoke).not.toHaveBeenCalled();
});

const fixture: Model<Api> = {
  id: "test",
  name: "Test",
  provider: "test",
  api: "openai-completions",
  baseUrl: "https://invalid.example",
  reasoning: false,
  input: ["text"],
  contextWindow: 4096,
  maxTokens: 256,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};
it("rejects illegal budget without invoking transport", async () => {
  invoke.mockClear();
  await expect(
    invokeMetadataCompletion({
      model: fixture,
      metadata: {},
      modelRef: "test/test",
      signal: new AbortController().signal,
      maxTokens: 0,
    }),
  ).rejects.toThrow();
  expect(invoke).not.toHaveBeenCalled();
});
