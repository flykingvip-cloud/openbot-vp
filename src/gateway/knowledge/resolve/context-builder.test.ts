import { describe, expect, it } from "vitest";
import type { KnowledgeObject } from "../types.js";
import {
  formatKnowledgeContextPromptBlock,
  KNOWLEDGE_PROMPT_CHAR_BUDGET,
} from "./context-builder.js";

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

it("bounds model input while declaring incomplete excerpts and keeping the source reference", () => {
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
    primaryObjects: [{ ...object, summary: "large-evidence ".repeat(100000) }],
    relatedObjects: Array.from({ length: 30 }, (_, i) => ({
      ...object,
      id: `source-${i}`,
      summary: "related ".repeat(1000),
    })),
    recommendedCapabilities: [],
    recommendedAgents: [],
    recommendedOwners: [],
  });
  expect(prompt.length).toBeLessThanOrEqual(KNOWLEDGE_PROMPT_CHAR_BUDGET);
  expect(prompt).toContain(object.id);
  expect(prompt).toContain("partial, budgeted view");
  expect(prompt).toContain("not proof of absence or authorization");
  expect(prompt).toContain("knowledge_get");
});
