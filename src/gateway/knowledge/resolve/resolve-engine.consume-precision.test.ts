// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  knowledgeConsumeRefKey,
  normalizeKnowledgeConsumeRefs,
  resolveLegacyKnowledgeConsumeRef,
} from "../consume-ref.js";
import type { KnowledgeObject } from "../types.js";
import { filterObjectsByConsumeRefs } from "./resolve-engine.js";

const collidingObjects: KnowledgeObject[] = [
  {
    id: "obj:personal:shared",
    title: "Personal",
    source: "personal",
    kind: "document",
    summary: "personal",
    tags: [],
    updatedAt: 1,
  },
  {
    id: "obj:enterprise:shared",
    title: "Enterprise",
    source: "enterprise",
    kind: "document",
    summary: "enterprise",
    tags: [],
    updatedAt: 1,
  },
  {
    id: "obj:kb:shared",
    title: "Knowledge base",
    source: "personal",
    kind: "document",
    summary: "kb",
    tags: [],
    updatedAt: 1,
  },
  {
    id: "obj:deliverable:shared",
    title: "Deliverable",
    source: "personal",
    kind: "document",
    summary: "deliverable",
    tags: [],
    updatedAt: 1,
    relatedObjectIds: ["obj:kb:workspace-a"],
  },
];

describe("knowledge consume precision", () => {
  it("keeps type and parent scope in canonical consume keys", () => {
    const refs = normalizeKnowledgeConsumeRefs([
      { type: "knowledge-file", id: "shared", parentId: "kb-a" },
      { type: "knowledge-file", id: "shared", parentId: "kb-b" },
      { type: "deliverable", id: "shared", parentId: "workspace-a" },
      { type: "knowledge-file", id: " shared ", parentId: " kb-a " },
    ]);

    expect(refs).toHaveLength(3);
    expect(new Set(refs.map(knowledgeConsumeRefKey)).size).toBe(3);
  });

  it("does not select another object domain that shares the same bare id", () => {
    expect(
      filterObjectsByConsumeRefs(collidingObjects, [{ type: "knowledge-base", id: "shared" }]).map(
        (item) => item.id,
      ),
    ).toEqual(["obj:kb:shared"]);

    expect(
      filterObjectsByConsumeRefs(collidingObjects, [
        { type: "deliverable", id: "shared", parentId: "workspace-a" },
      ]).map((item) => item.id),
    ).toEqual(["obj:deliverable:shared"]);

    expect(
      filterObjectsByConsumeRefs(collidingObjects, [
        { type: "deliverable", id: "shared", parentId: "workspace-b" },
      ]),
    ).toEqual([]);
  });

  it("fails closed when a legacy bare id matches multiple parent domains", () => {
    expect(
      resolveLegacyKnowledgeConsumeRef({
        id: "shared",
        catalogRefs: [
          { type: "knowledge-file", id: "shared", parentId: "kb-a" },
          { type: "knowledge-file", id: "shared", parentId: "kb-b" },
        ],
      }),
    ).toEqual({ status: "ambiguous_identity" });
  });
});
