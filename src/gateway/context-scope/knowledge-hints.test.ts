import { describe, expect, test } from "vitest";
import { resolveContextScopePlan } from "./controller.js";
import {
  knowledgeConsumeRefsFromScopePlan,
  knowledgeTaskHintsFromScopePlan,
} from "./knowledge-hints.js";

describe("knowledgeTaskHintsFromScopePlan", () => {
  test("does not lower focused typed sources into bare object ids", () => {
    const plan = resolveContextScopePlan({
      inboundDepth: "retrieve",
      sessionKey: "main",
      request: {
        mode: "focused",
        sources: [
          { type: "file", fileId: "doc-roadmap", parentId: "kb-product" },
          { type: "folder", path: "lfb-design", parentId: "kb-product" },
        ],
      },
    });
    expect(knowledgeTaskHintsFromScopePlan(plan)).toEqual({});
    expect(knowledgeConsumeRefsFromScopePlan(plan)).toEqual([
      { type: "knowledge-file", id: "doc-roadmap", parentId: "kb-product" },
      { type: "folder", id: "lfb-design", parentId: "kb-product" },
    ]);
  });

  test("maps selected knowledge bases and API connectors to typed consume refs", () => {
    const plan = resolveContextScopePlan({
      inboundDepth: "retrieve",
      sessionKey: "main",
      request: {
        mode: "focused",
        sources: [
          { type: "knowledge", knowledgeBaseId: "kb-product" },
          { type: "api", connectorId: "src-crm", parentId: "kb-product" },
        ],
      },
    });
    expect(knowledgeTaskHintsFromScopePlan(plan)).toEqual({
      knowledgeBaseId: "kb-product",
    });
    expect(knowledgeConsumeRefsFromScopePlan(plan)).toEqual([
      { type: "knowledge-base", id: "kb-product" },
      { type: "api", id: "src-crm", parentId: "kb-product" },
    ]);
  });

  test("keeps a selected file without parent as a consume ref", () => {
    const plan = resolveContextScopePlan({
      inboundDepth: "retrieve",
      sessionKey: "main",
      request: {
        mode: "focused",
        sources: [{ type: "file", fileId: "skill_c0550e28c46b" }],
      },
    });
    expect(knowledgeConsumeRefsFromScopePlan(plan)).toEqual([
      {
        type: "knowledge-file",
        id: "skill_c0550e28c46b",
        parentId: "skill_c0550e28c46b",
      },
    ]);
  });

  test("does not constrain auto authorized knowledge", () => {
    const plan = resolveContextScopePlan({
      inboundDepth: "retrieve",
      sessionKey: "main",
    });
    expect(knowledgeTaskHintsFromScopePlan(plan)).toEqual({});
  });

  test("passes every authorized knowledge base id when confidentiality narrowed auto", () => {
    const plan = resolveContextScopePlan({
      inboundDepth: "retrieve",
      sessionKey: "space:ops",
      groupId: "ops",
      request: {
        mode: "focused",
        sources: [
          { type: "knowledge", knowledgeBaseId: "kb-product" },
          { type: "knowledge", knowledgeBaseId: "kb-ops" },
        ],
      },
    });
    expect(knowledgeTaskHintsFromScopePlan(plan)).toEqual({
      knowledgeBaseIds: ["kb-product", "kb-ops"],
    });
  });
});
