import { describe, expect, it } from "vitest";
import { StubExecutionBackend } from "./stub-backend.js";

describe("StubExecutionBackend", () => {
  it("runs and returns responder output with usage", async () => {
    const backend = new StubExecutionBackend((step) => `echo: ${step.prompt.slice(0, 20)}`);
    const handle = await backend.run(
      {
        id: "s0",
        taskType: "summarization",
        skillId: "summarization",
        prompt: "summarize this article",
        model: { provider: "openai", id: "gpt-5.4-mini" },
      },
      {},
    );
    const result = await backend.wait(handle);
    expect(result.text).toContain("summarize");
    expect(result.usage.totalTokens).toBeGreaterThan(0);
  });

  it("implements the ExecutionBackend contract (id, capabilities, abort)", async () => {
    const backend = new StubExecutionBackend(() => "ok");
    expect(backend.id).toBe("stub");
    const caps = await backend.capabilities();
    expect(caps.models).toEqual([]);
    const handle = await backend.run(
      {
        id: "s1",
        taskType: "coding.review",
        skillId: "coding.review",
        prompt: "x",
        model: { provider: "openai", id: "gpt-5.4" },
      },
      {},
    );
    await backend.abort(handle);
  });
});
