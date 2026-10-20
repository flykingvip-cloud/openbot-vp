// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { OpenBotConfig } from "../../config/types.js";
import {
  listVisionCapableModelRefs,
  planBindingIncludesVisionModel,
} from "./plan-binding-vision.js";

vi.mock("../../agents/model-catalog.js", () => ({
  loadModelCatalog: vi.fn(async () => [
    { id: "deepseek-chat", name: "DeepSeek Chat", provider: "api-proxy-deepseek", input: ["text"] },
    { id: "gpt-4o", name: "GPT-4o", provider: "openai", input: ["text", "image"] },
    { id: "llama3.2", name: "Llama 3.2", provider: "ollama", input: ["text"] },
  ]),
  findModelInCatalog: vi.fn(
    (catalog: Array<{ provider: string; id: string }>, provider: string, modelId: string) =>
      catalog.find(
        (entry) =>
          entry.provider.toLowerCase() === provider.toLowerCase() &&
          entry.id.toLowerCase() === modelId.toLowerCase(),
      ),
  ),
  modelSupportsVision: vi.fn((entry: { input?: string[] } | undefined) =>
    Boolean(entry?.input?.includes("image")),
  ),
}));

describe("plan-binding-vision", () => {
  const cfg = {} as OpenBotConfig;

  it("lists vision-capable refs from allowedModelIds", async () => {
    const refs = await listVisionCapableModelRefs(cfg, [
      "api-proxy-deepseek/deepseek-chat",
      "openai/gpt-4o",
    ]);
    expect(refs).toEqual(["openai/gpt-4o"]);
  });

  it("returns false when no vision model is present", async () => {
    const includes = await planBindingIncludesVisionModel(cfg, [
      "api-proxy-deepseek/deepseek-chat",
      "ollama/llama3.2",
    ]);
    expect(includes).toBe(false);
  });

  it("returns true when at least one vision model is present", async () => {
    const includes = await planBindingIncludesVisionModel(cfg, [
      "api-proxy-deepseek/deepseek-chat",
      "openai/gpt-4o",
    ]);
    expect(includes).toBe(true);
  });
});
