// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  buildAgentCognitiveKnowledgeBundle,
  formatAgentKnowledgeSystemPrompt,
} from "./cognitive-runtime-adapter.js";

describe("agent cognitive runtime adapter", () => {
  it("builds resolve + context + memory bundle for employee agent tasks", async () => {
    const bundle = await buildAgentCognitiveKnowledgeBundle(null, {
      taskContext: {
        taskType: "analysis",
        agentId: "employee-agent",
      },
      query: "客户成交率",
    });
    expect(bundle.resolve.intent.intentType).toBe("analysis");
    expect(bundle.context.promptBlock).toContain("Knowledge Universe context");
    expect(bundle.memoryHints).toBeInstanceOf(Array);
    expect(bundle.receipts).toBeInstanceOf(Array);
    expect(formatAgentKnowledgeSystemPrompt(bundle)).toBe(bundle.context.promptBlock);
  });
});
