import { describe, expect, test } from "vitest";
import {
  canCloseGroupRuntimeContext,
  degradeContextScopePlanToMandatory,
  mayRetrieveOptionalKnowledge,
  resolveContextScopePlan,
} from "./controller.js";
import { DEFAULT_CONTEXT_POLICY } from "./types.js";

describe("context scope controller", () => {
  test("ordinary chat is minimal and does not prefetch knowledge", () => {
    const plan = resolveContextScopePlan({
      inboundDepth: "chat",
      sessionKey: "agent:main:main",
    });
    expect(plan.mode).toBe("minimal");
    expect(plan.retrievalStrategy.allowKnowledgePrefetch).toBe(false);
    expect(plan.retrievalStrategy.recursiveFolderScan).toBe(false);
    expect(plan.fullContextDumpAllowed).toBe(false);
    expect(mayRetrieveOptionalKnowledge(plan)).toBe(false);
    expect(plan.budget.maxFiles).toBe(0);
  });

  test("auto is the default for retrieve and forbids full folder dump", () => {
    const plan = resolveContextScopePlan({
      inboundDepth: "retrieve",
      sessionKey: "agent:main:main",
    });
    expect(plan.mode).toBe("auto");
    expect(plan.retrievalStrategy.allowKnowledgePrefetch).toBe(true);
    expect(plan.retrievalStrategy.recursiveFolderScan).toBe(false);
    expect(plan.fullContextDumpAllowed).toBe(false);
    expect(plan.sources.some((source) => source.type === "knowledge")).toBe(true);
  });

  test("focused keeps only requested optional sources plus conversation", () => {
    const plan = resolveContextScopePlan({
      inboundDepth: "retrieve",
      sessionKey: "agent:main:main",
      request: {
        mode: "focused",
        sources: [{ type: "file", fileId: "doc-roadmap" }],
      },
    });
    expect(plan.mode).toBe("focused");
    expect(plan.sources).toEqual([
      { type: "conversation", id: "agent:main:main" },
      { type: "file", fileId: "doc-roadmap" },
    ]);
    expect(plan.sources.some((source) => source.type === "knowledge")).toBe(false);
  });

  test("group mandatory context cannot be turned off by current-conversation-only", () => {
    const plan = resolveContextScopePlan({
      inboundDepth: "chat",
      sessionKey: "space:alpha",
      groupId: "alpha",
      request: { mode: "minimal" },
      contextPolicy: DEFAULT_CONTEXT_POLICY,
    });
    expect(plan.mode).toBe("minimal");
    expect(plan.mandatorySources.some((source) => source.type === "group")).toBe(true);
    expect(canCloseGroupRuntimeContext(plan)).toBe(false);
    expect(mayRetrieveOptionalKnowledge(plan)).toBe(false);
  });

  test("deep may index-scan but still forbids dumping all files into context", () => {
    const plan = resolveContextScopePlan({
      inboundDepth: "act",
      sessionKey: "agent:main:main",
      request: { mode: "deep" },
    });
    expect(plan.mode).toBe("deep");
    expect(plan.retrievalStrategy.recursiveFolderScan).toBe(true);
    expect(plan.fullContextDumpAllowed).toBe(false);
    expect(plan.budget.maxTokens).toBeLessThanOrEqual(64_000);
  });

  test("group confidentiality sets the plan ceiling", () => {
    const restricted = resolveContextScopePlan({
      inboundDepth: "retrieve",
      sessionKey: "space:legal",
      groupId: "legal",
      groupConfidentiality: "secret",
    });
    expect(restricted.confidentiality.maxLevel).toBe("restricted");
    const open = resolveContextScopePlan({
      inboundDepth: "retrieve",
      sessionKey: "space:town",
      groupId: "town",
      groupConfidentiality: "public",
    });
    expect(open.confidentiality.maxLevel).toBe("public");
  });

  test("authorize failure degrades to mandatory context and skips optional retrieve", () => {
    const plan = resolveContextScopePlan({
      inboundDepth: "retrieve",
      sessionKey: "agent:main:main",
      request: { mode: "focused", sources: [{ type: "file", fileId: "notes.md" }] },
    });
    expect(mayRetrieveOptionalKnowledge(plan)).toBe(true);
    const degraded = degradeContextScopePlanToMandatory(plan, "denied:authorize_failed");
    expect(degraded.sources).toEqual([{ type: "conversation", id: "agent:main:main" }]);
    expect(degraded.retrievalStrategy.allowKnowledgePrefetch).toBe(false);
    expect(mayRetrieveOptionalKnowledge(degraded)).toBe(false);
    expect(degraded.reasons).toContain("denied:authorize_failed");
    expect(degraded.deniedSources).toEqual([
      { type: "file", id: "notes.md", reason: "authorize_failed" },
    ]);
  });

  test("group without inboundDepth defaults to chat/minimal (no auto knowledge)", () => {
    const plan = resolveContextScopePlan({
      sessionKey: "space:alpha",
      groupId: "alpha",
      contextPolicy: DEFAULT_CONTEXT_POLICY,
    });
    expect(plan.mode).toBe("minimal");
    expect(plan.reasons).toContain("inbound:chat_group_default");
    expect(plan.mandatorySources).toEqual(
      expect.arrayContaining([
        { type: "conversation", id: "space:alpha" },
        { type: "group", groupId: "alpha" },
      ]),
    );
    expect(plan.sources.some((source) => source.type === "knowledge")).toBe(false);
    expect(mayRetrieveOptionalKnowledge(plan)).toBe(false);
  });

  test("group retrieve/act may expand knowledge; UI focused sources stay explicit", () => {
    const retrieve = resolveContextScopePlan({
      inboundDepth: "retrieve",
      sessionKey: "space:alpha",
      groupId: "alpha",
      contextPolicy: DEFAULT_CONTEXT_POLICY,
    });
    expect(retrieve.mode).toBe("auto");
    expect(retrieve.sources.some((source) => source.type === "knowledge")).toBe(true);
    expect(retrieve.mandatorySources.some((source) => source.type === "group")).toBe(true);

    const focused = resolveContextScopePlan({
      sessionKey: "space:alpha",
      groupId: "alpha",
      request: {
        mode: "focused",
        sources: [{ type: "knowledge", knowledgeBaseId: "kb-product" }],
      },
      contextPolicy: DEFAULT_CONTEXT_POLICY,
    });
    expect(focused.mode).toBe("focused");
    expect(focused.sources).toEqual(
      expect.arrayContaining([
        { type: "conversation", id: "space:alpha" },
        { type: "group", groupId: "alpha" },
        { type: "knowledge", knowledgeBaseId: "kb-product" },
      ]),
    );
  });

  test("direct session without depth keeps auto default (unchanged 1:1)", () => {
    const plan = resolveContextScopePlan({
      sessionKey: "agent:main:main",
    });
    expect(plan.mode).toBe("auto");
    expect(plan.sources.some((source) => source.type === "knowledge")).toBe(true);
  });
});
