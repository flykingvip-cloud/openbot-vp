import { describe, expect, it } from "vitest";
import type { KnowledgeObject } from "../types.js";
import { formatKnowledgeContextPromptBlock } from "./context-builder.js";

const object: KnowledgeObject = {
  id: "obj:doc:doc-resume",
  title: "王婧简历",
  source: "personal",
  kind: "document",
  summary: "优才计划信息表",
  tags: ["简历"],
  updatedAt: 0,
};

describe("formatKnowledgeContextPromptBlock", () => {
  it("names consume tools and prints followable object ids", () => {
    const prompt = formatKnowledgeContextPromptBlock({
      intent: {
        intentType: "research",
        confidence: 0.8,
        signals: [],
        suggestedSources: ["personal"],
      },
      profile: {
        agentId: "employee-agent",
        enabledSources: ["personal"],
        preferredKnowledgeKinds: ["document"],
        retrievalMode: "balanced",
        allowDataCapabilities: [],
        confidenceThreshold: 0.4,
      },
      primaryObjects: [object],
      relatedObjects: [],
      recommendedCapabilities: [],
      recommendedAgents: [],
      recommendedOwners: [],
    });

    expect(prompt).toContain("knowledge_search");
    expect(prompt).toContain("knowledge_get");
    expect(prompt).toContain("memory_search is workspace/session/runtime memory only");
    expect(prompt).toContain("obj:doc:doc-resume 王婧简历 (personal/document)");
  });
});
