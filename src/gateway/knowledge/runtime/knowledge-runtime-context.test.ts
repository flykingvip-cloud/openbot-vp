// @vitest-environment node
import { describe, expect, it } from "vitest";
import { resolveKnowledgeRuntimeContext } from "./knowledge-runtime-context.js";

describe("resolveKnowledgeRuntimeContext", () => {
  it("returns a unified governance-aware context contract", async () => {
    const result = await resolveKnowledgeRuntimeContext(null, {
      taskContext: { taskType: "general", agentId: "employee-agent" },
      query: "refund policy",
    });
    // Object-level context + governance-aware chunk evidence are unified in one contract.
    expect(result.context).toBeDefined();
    expect(Array.isArray(result.context.evidence)).toBe(true);
    expect(result.context.graph).toBeDefined();
    expect(typeof result.context.promptBlock).toBe("string");
    // Resolve result + memory hints are surfaced on the same canonical contract.
    expect(result.resolve).toBeDefined();
    expect(Array.isArray(result.resolve.objects)).toBe(true);
    expect(Array.isArray(result.memoryHints)).toBe(true);
    expect(Array.isArray(result.receipts)).toBe(true);
    // Without a resolvable user there is no per-user governance summary.
    expect(result.governance).toBeNull();
  });
});
