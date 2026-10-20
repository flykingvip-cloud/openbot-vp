// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveContextScopePlan } from "../../gateway/context-scope/controller.js";

const buildAgentCognitiveKnowledgeBundle = vi.fn();

vi.mock("../../gateway/knowledge/adapter/cognitive-runtime-adapter.js", () => ({
  buildAgentCognitiveKnowledgeBundle,
  formatAgentKnowledgeSystemPrompt: () => "typed knowledge context",
}));

vi.mock("../../gateway/knowledge/context.js", () => ({
  resolveKnowledgeSourceContext: vi.fn(async () => ({
    userId: "user-a",
    tenantId: "tenant-a",
    seatId: null,
    hasEnterpriseScope: false,
  })),
}));

const { buildKnowledgeUniversePromptContext } = await import("./knowledge-universe-context.js");

describe("knowledge universe typed selection", () => {
  beforeEach(() => {
    buildAgentCognitiveKnowledgeBundle.mockReset();
    buildAgentCognitiveKnowledgeBundle.mockResolvedValue({
      resolve: {
        objects: [],
        relations: [],
        recommendations: [],
        selectedSources: ["personal"],
      },
      context: {
        primaryObjects: [],
        relatedGroups: [],
        recommendedCapabilities: [],
        evidence: [
          {
            sourceKind: "knowledge",
            docId: "doc-roadmap",
            kbId: "kb-product",
            score: 1,
            chunkText: "Exact roadmap",
            sourceUri: "ku://kb/kb-product/doc/doc-roadmap@index_text",
          },
        ],
        promptBlock: "typed knowledge context",
      },
      memoryHints: [],
      receipts: [
        {
          ref: { type: "knowledge-file", id: "doc-roadmap", parentId: "kb-product" },
          status: "consumed",
          evidenceKind: "index-chunk",
          chars: 13,
        },
      ],
      diagnostics: {
        selectedSourceCount: 1,
        excludedReasons: [],
        liveSkipped: false,
        liveInvoked: false,
        degraded: false,
      },
    });
  });

  it("passes an authorized parent-scoped file to the single runtime engine adapter", async () => {
    const scopePlan = resolveContextScopePlan({
      inboundDepth: "retrieve",
      sessionKey: "agent:main:main",
      request: {
        mode: "focused",
        sources: [{ type: "file", fileId: "doc-roadmap", parentId: "kb-product" }],
      },
    });

    const context = await buildKnowledgeUniversePromptContext({
      message: "只看路线图",
      scopePlan,
      gatewayClient: { connect: {} as never } as never,
    });

    expect(buildAgentCognitiveKnowledgeBundle).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        selection: {
          refs: [{ type: "knowledge-file", id: "doc-roadmap", parentId: "kb-product" }],
        },
      }),
    );
    expect(context?.receipts).toEqual([
      expect.objectContaining({
        ref: { type: "knowledge-file", id: "doc-roadmap", parentId: "kb-product" },
        status: "consumed",
      }),
    ]);
    expect(buildAgentCognitiveKnowledgeBundle).toHaveBeenCalledTimes(1);
  });

  it("does not inject a parallel file prompt when the single runtime pass fails", async () => {
    buildAgentCognitiveKnowledgeBundle.mockRejectedValue(new Error("runtime composition failed"));
    const scopePlan = resolveContextScopePlan({
      inboundDepth: "retrieve",
      sessionKey: "agent:main:main",
      request: {
        mode: "focused",
        sources: [{ type: "file", fileId: "doc-roadmap", parentId: "kb-product" }],
      },
    });

    const context = await buildKnowledgeUniversePromptContext({
      message: "只看路线图",
      scopePlan,
      gatewayClient: { connect: {} as never } as never,
    });

    expect(context).toBeUndefined();
    expect(buildAgentCognitiveKnowledgeBundle).toHaveBeenCalledTimes(1);
  });

  it("minimal scope plan skips optional knowledge without calling the runtime adapter", async () => {
    const scopePlan = resolveContextScopePlan({
      inboundDepth: "chat",
      sessionKey: "agent:main:main",
    });
    expect(scopePlan.mode).toBe("minimal");

    const context = await buildKnowledgeUniversePromptContext({
      message: "晚上好",
      scopePlan,
      gatewayClient: { connect: {} as never } as never,
    });

    expect(context).toBeUndefined();
    expect(buildAgentCognitiveKnowledgeBundle).not.toHaveBeenCalled();
  });
});
