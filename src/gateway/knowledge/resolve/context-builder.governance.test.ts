// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { KnowledgeEvidence } from "../../../retrieval/types.js";
import type {
  KnowledgeFreshnessStatus,
  KnowledgeObject,
  KnowledgeResolveResult,
} from "../types.js";
import { buildKnowledgeAgentContext } from "./context-builder.js";

function knowledgeObject(id: string, freshnessStatus?: KnowledgeFreshnessStatus): KnowledgeObject {
  return {
    id,
    title: `Object ${id}`,
    source: "personal",
    kind: "document",
    summary: "summary",
    tags: [],
    updatedAt: 1,
    ...(freshnessStatus ? { freshnessStatus } : {}),
  };
}

function resolveResult(objects: KnowledgeObject[]): KnowledgeResolveResult {
  return {
    intent: { intentType: "general", confidence: 0.7, signals: [], suggestedSources: ["personal"] },
    selectedSources: ["personal"],
    objects,
    graph: { nodes: [], edges: [] },
    profile: {
      agentId: "agent-a",
      enabledSources: ["personal"],
      preferredKnowledgeKinds: ["document"],
      retrievalMode: "balanced",
      allowDataCapabilities: [],
      confidenceThreshold: 0.6,
    },
    recommendations: [],
  };
}

function evidence(overrides: Partial<KnowledgeEvidence>): KnowledgeEvidence {
  return {
    sourceKind: "knowledge",
    docId: "doc",
    docTitle: "Doc",
    kbId: "kb-1",
    versionId: "v1",
    score: 0.9,
    chunkText: "text",
    sourceUri: "ku://kb/kb-1/doc/doc@v1",
    ...overrides,
  };
}

describe("context-builder governance signals", () => {
  it("aggregates governance signals and surfaces a prompt summary line", () => {
    const context = buildKnowledgeAgentContext({
      resolveResult: resolveResult([knowledgeObject("o1", "stale"), knowledgeObject("o2")]),
      relatedGroups: null,
      recommendations: [],
      evidence: [
        evidence({ docId: "d1", governanceStatus: "confirmed" }),
        evidence({ docId: "d2", governanceConflict: true }),
        evidence({ docId: "d3", governanceStatus: "suppressed" }),
      ],
    });
    expect(context.governanceSignals).toEqual({
      confirmed: 1,
      conflicts: 1,
      suppressed: 1,
      stale: 1,
    });
    expect(context.promptBlock).toContain("Governance signals:");
    expect(context.promptBlock).toContain("1 verified");
    expect(context.promptBlock).toContain("1 unresolved conflict");
    expect(context.promptBlock).toContain("1 suppressed");
    expect(context.promptBlock).toContain("1 stale");
    // Conflict/stale evidence carries a low-confidence advisory.
    expect(context.promptBlock).toContain("low confidence");
  });

  it("omits the governance summary line when there are no governance signals", () => {
    const context = buildKnowledgeAgentContext({
      resolveResult: resolveResult([knowledgeObject("o1"), knowledgeObject("o2")]),
      relatedGroups: null,
      recommendations: [],
      evidence: [evidence({ docId: "d1" })],
    });
    expect(context.governanceSignals).toEqual({
      confirmed: 0,
      conflicts: 0,
      suppressed: 0,
      stale: 0,
    });
    expect(context.promptBlock).not.toContain("Governance signals:");
  });

  it("renders recommended data capabilities with auth + freshness and a boundary reminder", () => {
    const capabilityObject: KnowledgeObject = {
      id: "obj:data:cap-1",
      title: "CRM 客户画像",
      source: "data",
      kind: "metric",
      summary: "客户主数据画像能力",
      tags: ["客户"],
      updatedAt: 1,
      scopeLabel: "待申请",
      accessState: "restricted",
      freshnessStatus: "stale",
    };
    const context = buildKnowledgeAgentContext({
      resolveResult: resolveResult([]),
      relatedGroups: null,
      recommendations: [{ object: capabilityObject, score: 0.9, reason: "relevant" }],
    });
    expect(context.recommendedCapabilities.map((item) => item.id)).toContain("obj:data:cap-1");
    expect(context.promptBlock).toContain("Recommended data capabilities");
    expect(context.promptBlock).toContain("never call connectors directly");
    expect(context.promptBlock).toContain("CRM 客户画像");
    expect(context.promptBlock).toContain("待申请");
    expect(context.promptBlock).toContain("stale");
  });
});
