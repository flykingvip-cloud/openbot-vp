import { describe, expect, it } from "vitest";
import { createDefaultGraphPipelines, createGraphExecutionBackend } from "./graph-backend.js";

describe("GraphExecutionBackend", () => {
  it("runs a multi-node pipeline and returns combined text", async () => {
    const backend = createGraphExecutionBackend();
    const handle = await backend.run(
      {
        id: "s0",
        taskType: "coding.review",
        skillId: "coding.review",
        prompt: "scan auth module",
        model: { provider: "anthropic", id: "claude-opus-4-6" },
      },
      {},
    );
    const result = await backend.wait(handle);
    expect(result.text).toContain("finding:");
    expect(result.usage.totalTokens).toBeGreaterThan(0);
  });

  it("uses summarization pipeline for summary task types", async () => {
    const backend = createGraphExecutionBackend();
    const handle = await backend.run(
      {
        id: "s1",
        taskType: "summarization",
        skillId: "summarization",
        prompt: "long article body",
        model: { provider: "openai", id: "gpt-5.4-mini" },
      },
      {},
    );
    const result = await backend.wait(handle);
    expect(result.text.startsWith("SUMMARY:")).toBe(true);
  });

  it("registers default pipelines for coding and summarization", () => {
    const pipelines = createDefaultGraphPipelines();
    expect(pipelines.has("coding.review")).toBe(true);
    expect(pipelines.has("summarization")).toBe(true);
  });
});
