import { describe, expect, test } from "vitest";
import type { ContextScopeCatalogItem } from "./catalog.js";
import { resolveContextScopePlan } from "./controller.js";
import {
  detectContextInsufficient,
  proposeContextExpansion,
  resolveContextExpansionSuggestion,
} from "./expansion.js";

const CATALOG: ContextScopeCatalogItem[] = [
  { type: "knowledge", id: "kb-product", label: "产品资料库" },
  { type: "file", id: "doc-roadmap", label: "roadmap.md", parentId: "kb-product" },
  { type: "folder", id: "lfb-design", label: "设计稿", parentId: "kb-product" },
  { type: "api", id: "src-crm", label: "CRM" },
  { type: "knowledge", id: "kb-hr", label: "人事制度" },
];

describe("detectContextInsufficient", () => {
  test("does not suggest when the user chose the current conversation only", () => {
    expect(
      detectContextInsufficient({
        mode: "minimal",
        knowledgeRetrieved: false,
        evidenceCount: 0,
        degraded: false,
      }),
    ).toBeNull();
  });

  test("does not suggest when materials were found", () => {
    expect(
      detectContextInsufficient({
        mode: "auto",
        knowledgeRetrieved: true,
        evidenceCount: 3,
        degraded: true,
      }),
    ).toBeNull();
  });

  test("marks empty and degraded retrieval as insufficient", () => {
    expect(
      detectContextInsufficient({
        mode: "auto",
        knowledgeRetrieved: true,
        evidenceCount: 0,
        degraded: false,
      }),
    ).toBe("empty");
    expect(
      detectContextInsufficient({
        mode: "focused",
        knowledgeRetrieved: true,
        evidenceCount: 0,
        degraded: true,
      }),
    ).toBe("degraded");
  });
});

describe("proposeContextExpansion", () => {
  test("never offers sources that are not in the authorized catalog", () => {
    const suggestion = proposeContextExpansion({
      reason: "empty",
      currentSources: [{ type: "conversation", id: "main" }],
      catalog: CATALOG,
    });
    expect(suggestion?.proposedSources.map((item) => item.id)).not.toContain("kb-secret-finance");
    expect(
      suggestion?.proposedSources.every((item) => CATALOG.some((row) => row.id === item.id)),
    ).toBe(true);
  });

  test("prefers the parent knowledge base after a focused file miss", () => {
    const suggestion = proposeContextExpansion({
      reason: "empty",
      currentSources: [
        { type: "conversation", id: "main" },
        { type: "file", fileId: "doc-roadmap" },
      ],
      catalog: CATALOG,
    });
    expect(suggestion?.reason).toBe("narrow_focus");
    expect(suggestion?.proposedSources[0]).toEqual({
      type: "knowledge",
      id: "kb-product",
      label: "产品资料库",
    });
    expect(suggestion?.proposedSources.some((item) => item.id === "doc-roadmap")).toBe(false);
  });

  test("returns nothing when every authorized source is already in scope", () => {
    expect(
      proposeContextExpansion({
        reason: "empty",
        currentSources: CATALOG.map((item) => {
          if (item.type === "knowledge") {
            return { type: "knowledge" as const, knowledgeBaseId: item.id };
          }
          if (item.type === "file") {
            return { type: "file" as const, fileId: item.id };
          }
          if (item.type === "folder") {
            return { type: "folder" as const, path: item.id };
          }
          return { type: "api" as const, connectorId: item.id };
        }),
        catalog: CATALOG,
      }),
    ).toBeNull();
  });
});

describe("resolveContextExpansionSuggestion", () => {
  test("auto empty retrieval suggests named authorized sources without expanding by itself", () => {
    const plan = resolveContextScopePlan({
      inboundDepth: "retrieve",
      sessionKey: "main",
    });
    const suggestion = resolveContextExpansionSuggestion({
      plan,
      knowledgeRetrieved: true,
      evidenceCount: 0,
      degraded: false,
      catalog: CATALOG,
    });
    expect(suggestion?.reason).toBe("empty");
    expect(suggestion?.proposedSources.length).toBeGreaterThan(0);
    expect(suggestion?.proposedSources.length).toBeLessThanOrEqual(3);
    expect(
      plan.sources.some(
        (source) => source.type === "knowledge" && source.knowledgeBaseId === "authorized",
      ),
    ).toBe(true);
  });

  test("group confidentiality keeps restricted libraries out of expansion proposals", () => {
    const plan = resolveContextScopePlan({
      inboundDepth: "retrieve",
      sessionKey: "space:ops",
      groupId: "ops",
      groupConfidentiality: "internal",
    });
    const suggestion = resolveContextExpansionSuggestion({
      plan,
      knowledgeRetrieved: true,
      evidenceCount: 0,
      degraded: false,
      catalog: [...CATALOG, { type: "knowledge", id: "kb-finance", label: "财务知识库" }],
      enforceConfidentiality: true,
      visibilityByKnowledgeBase: {
        "kb-product": "team",
        "kb-hr": "team",
        "kb-finance": "private",
      },
    });
    expect(suggestion?.proposedSources.some((item) => item.id === "kb-finance")).toBe(false);
  });

  test("sufficient evidence does not produce a suggestion", () => {
    const plan = resolveContextScopePlan({
      inboundDepth: "retrieve",
      sessionKey: "main",
    });
    expect(
      resolveContextExpansionSuggestion({
        plan,
        knowledgeRetrieved: true,
        evidenceCount: 2,
        degraded: false,
        catalog: CATALOG,
      }),
    ).toBeNull();
  });
});
