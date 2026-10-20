import { describe, expect, test } from "vitest";
import { authorizeContextScopePlan } from "./authorize.js";
import type { ContextScopeCatalogItem } from "./catalog.js";
import { resolveContextScopePlan } from "./controller.js";

const CATALOG: ContextScopeCatalogItem[] = [
  { type: "knowledge", id: "kb-product", label: "产品资料库" },
  { type: "knowledge", id: "kb-finance", label: "财务知识库" },
  { type: "file", id: "doc-roadmap", label: "roadmap.md", parentId: "kb-product" },
  { type: "file", id: "doc-ledger", label: "ledger.xlsx", parentId: "kb-finance" },
];

const VISIBILITY = {
  "kb-product": "team" as const,
  "kb-finance": "private" as const,
};

describe("authorizeContextScopePlan", () => {
  test("drops focused sources the member cannot see", () => {
    const plan = resolveContextScopePlan({
      inboundDepth: "retrieve",
      sessionKey: "agent:main:main",
      request: {
        mode: "focused",
        sources: [
          { type: "knowledge", knowledgeBaseId: "kb-product" },
          { type: "knowledge", knowledgeBaseId: "kb-secret-other" },
        ],
      },
    });
    const authorized = authorizeContextScopePlan({
      plan,
      catalog: CATALOG,
      visibilityByKnowledgeBase: VISIBILITY,
      enforceConfidentiality: false,
    });
    expect(authorized.plan.sources).toEqual([
      { type: "conversation", id: "agent:main:main" },
      { type: "knowledge", knowledgeBaseId: "kb-product" },
    ]);
    expect(authorized.denied).toEqual([
      { type: "knowledge", id: "kb-secret-other", reason: "unauthorized" },
    ]);
  });

  test("keeps explicit ACL-visible selections in a group turn", () => {
    const plan = resolveContextScopePlan({
      inboundDepth: "retrieve",
      sessionKey: "space:ops",
      groupId: "ops",
      groupConfidentiality: "internal",
      request: {
        mode: "focused",
        sources: [
          { type: "knowledge", knowledgeBaseId: "kb-product" },
          { type: "knowledge", knowledgeBaseId: "kb-finance" },
          { type: "file", fileId: "doc-ledger" },
        ],
      },
    });
    expect(plan.confidentiality.maxLevel).toBe("internal");
    const authorized = authorizeContextScopePlan({
      plan,
      catalog: CATALOG,
      visibilityByKnowledgeBase: VISIBILITY,
      enforceConfidentiality: true,
    });
    expect(authorized.plan.mandatorySources.some((source) => source.type === "group")).toBe(true);
    expect(authorized.plan.sources).toEqual([
      { type: "conversation", id: "space:ops" },
      { type: "group", groupId: "ops" },
      { type: "knowledge", knowledgeBaseId: "kb-product" },
      { type: "knowledge", knowledgeBaseId: "kb-finance" },
      { type: "file", fileId: "doc-ledger", parentId: "kb-finance" },
    ]);
    expect(authorized.denied).toEqual([]);
  });

  test("still narrows authorized-wildcard expansion by group confidentiality", () => {
    const plan = resolveContextScopePlan({
      inboundDepth: "retrieve",
      sessionKey: "space:ops",
      groupId: "ops",
      groupConfidentiality: "internal",
      request: {
        mode: "auto",
        sources: [{ type: "knowledge", knowledgeBaseId: "authorized" }],
      },
    });
    const authorized = authorizeContextScopePlan({
      plan,
      catalog: CATALOG,
      visibilityByKnowledgeBase: VISIBILITY,
      enforceConfidentiality: true,
    });
    expect(authorized.plan.sources).toEqual(
      expect.arrayContaining([
        { type: "conversation", id: "space:ops" },
        { type: "group", groupId: "ops" },
        { type: "knowledge", knowledgeBaseId: "kb-product" },
      ]),
    );
    expect(authorized.plan.sources).not.toEqual(
      expect.arrayContaining([{ type: "knowledge", knowledgeBaseId: "kb-finance" }]),
    );
    expect(authorized.denied).toEqual([
      { type: "knowledge", id: "kb-finance", reason: "confidentiality" },
    ]);
  });

  test("resolves a unique legacy file parent and rejects ambiguous bare ids", () => {
    const uniquePlan = resolveContextScopePlan({
      inboundDepth: "retrieve",
      sessionKey: "agent:main:main",
      request: {
        mode: "focused",
        sources: [{ type: "file", fileId: "doc-roadmap" }],
      },
    });
    const unique = authorizeContextScopePlan({
      plan: uniquePlan,
      catalog: CATALOG,
      enforceConfidentiality: false,
    });
    expect(unique.plan.sources).toContainEqual({
      type: "file",
      fileId: "doc-roadmap",
      parentId: "kb-product",
    });

    const ambiguous = authorizeContextScopePlan({
      plan: uniquePlan,
      catalog: [
        ...CATALOG,
        { type: "file", id: "doc-roadmap", label: "other.md", parentId: "kb-finance" },
      ],
      enforceConfidentiality: false,
    });
    expect(ambiguous.plan.sources.some((source) => source.type === "file")).toBe(false);
    expect(ambiguous.denied).toContainEqual({
      type: "file",
      id: "doc-roadmap",
      reason: "ambiguous_identity",
    });
  });

  test("keeps the member personal private library on a direct session", () => {
    const plan = resolveContextScopePlan({
      inboundDepth: "retrieve",
      sessionKey: "agent:main:main",
      request: {
        mode: "focused",
        sources: [{ type: "knowledge", knowledgeBaseId: "kb-finance" }],
      },
    });
    const authorized = authorizeContextScopePlan({
      plan,
      catalog: CATALOG,
      visibilityByKnowledgeBase: VISIBILITY,
      enforceConfidentiality: false,
    });
    expect(authorized.denied).toEqual([]);
    expect(authorized.plan.sources.some((source) => source.type === "knowledge")).toBe(true);
  });

  test("replaces auto authorized wildcard with only in-ceiling knowledge bases in a group", () => {
    const plan = resolveContextScopePlan({
      inboundDepth: "retrieve",
      sessionKey: "space:ops",
      groupId: "ops",
      groupConfidentiality: "internal",
    });
    const authorized = authorizeContextScopePlan({
      plan,
      catalog: CATALOG,
      visibilityByKnowledgeBase: VISIBILITY,
      enforceConfidentiality: true,
    });
    expect(
      authorized.plan.sources.some(
        (source) => source.type === "knowledge" && source.knowledgeBaseId === "authorized",
      ),
    ).toBe(false);
    expect(
      authorized.plan.sources.some(
        (source) => source.type === "knowledge" && source.knowledgeBaseId === "kb-product",
      ),
    ).toBe(true);
    expect(
      authorized.plan.sources.some(
        (source) => source.type === "knowledge" && source.knowledgeBaseId === "kb-finance",
      ),
    ).toBe(false);
    expect(authorized.denied.some((item) => item.id === "kb-finance")).toBe(true);
  });
});
