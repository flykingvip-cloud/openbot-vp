import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recordAgentGeneratedKnowledgeInIndex } from "../agent-generated-knowledge-store.js";
import { buildKnowledgeSourceBundle } from "../empty-bundle.js";
import {
  insertChunkRelation,
  upsertChunkSemanticHash,
} from "../governance/chunk-governance-store.js";
import { openKnowledgeIndex, resolveKnowledgeIndexDbPath } from "../kb-index.js";
import type { KnowledgeBase } from "../knowledge-base-store.js";
import { nodeIdForObject } from "../runtime/relationship-runtime.js";
import {
  buildCrossKnowledgeBaseEdges,
  deliverableNodeObjectId,
  knowledgeBaseNodeObjectId,
  loadArchivedDeliverableObjects,
  loadKnowledgeBaseSpaceObjects,
} from "./knowledge-index-source.js";

type KnowledgeIndex = Awaited<ReturnType<typeof openKnowledgeIndex>>;

let indexRoot: string;
let index: KnowledgeIndex;

function makeBase(
  overrides: Partial<KnowledgeBase> & Pick<KnowledgeBase, "id" | "title">,
): KnowledgeBase {
  return {
    description: "",
    ownerId: "user-1",
    tenantId: null,
    visibility: "private",
    backendKind: "personal",
    robotIds: [],
    tags: [],
    documentIds: [],
    recycledDocumentIds: [],
    documentCount: 0,
    createdAtMs: 1,
    updatedAtMs: 1,
    ...overrides,
  };
}

beforeEach(async () => {
  indexRoot = path.join(os.tmpdir(), `kb-index-source-${randomUUID()}`);
  const dbPath = resolveKnowledgeIndexDbPath({ ownerId: "user-1", tenantId: null, indexRoot });
  index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
});

afterEach(() => {
  index.close();
  fs.rmSync(indexRoot, { recursive: true, force: true });
});

describe("loadKnowledgeBaseSpaceObjects", () => {
  it("emits one node per KB space with visibility-mapped source and real relation counts", () => {
    insertChunkRelation({
      db: index.db,
      kbId: "kb-a",
      fromChunk: "c1",
      toChunk: "c2",
      relationType: "reference",
    });
    const bases = [
      makeBase({ id: "kb-a", title: "个人库", visibility: "private", documentCount: 3 }),
      makeBase({ id: "kb-b", title: "团队库", visibility: "team", documentCount: 1 }),
    ];

    const objects = loadKnowledgeBaseSpaceObjects({ db: index.db, knowledgeBases: bases });

    expect(objects).toHaveLength(2);
    const personal = objects.find((obj) => obj.id === knowledgeBaseNodeObjectId("kb-a"));
    expect(personal?.source).toBe("personal");
    expect(personal?.summary).toContain("3 篇文档");
    expect(personal?.summary).toContain("引用 1");
    const team = objects.find((obj) => obj.id === knowledgeBaseNodeObjectId("kb-b"));
    expect(team?.source).toBe("enterprise");
    expect(team?.tags).toContain("知识库");
  });

  it("prefers the KB description for the summary when present", () => {
    const objects = loadKnowledgeBaseSpaceObjects({
      db: index.db,
      knowledgeBases: [makeBase({ id: "kb-a", title: "库", description: "客户资料汇总" })],
    });
    expect(objects[0]?.summary).toBe("客户资料汇总");
  });
});

describe("buildCrossKnowledgeBaseEdges", () => {
  it("links KB spaces that hold the same content (shared semantic hash)", () => {
    // Same content hash present in kb-a and kb-b → they share knowledge.
    upsertChunkSemanticHash({ db: index.db, kbId: "kb-a", chunkId: "a1", semanticHash: "hash-1" });
    upsertChunkSemanticHash({ db: index.db, kbId: "kb-b", chunkId: "b1", semanticHash: "hash-1" });
    // kb-c holds only unique content.
    upsertChunkSemanticHash({ db: index.db, kbId: "kb-c", chunkId: "c1", semanticHash: "hash-2" });

    const bases = ["kb-a", "kb-b", "kb-c"].map((id) => makeBase({ id, title: id }));
    const edges = buildCrossKnowledgeBaseEdges({ db: index.db, knowledgeBases: bases });

    const nodeA = nodeIdForObject(knowledgeBaseNodeObjectId("kb-a"));
    const nodeB = nodeIdForObject(knowledgeBaseNodeObjectId("kb-b"));
    const nodeC = nodeIdForObject(knowledgeBaseNodeObjectId("kb-c"));
    const connects = (edge: (typeof edges)[number], x: string, y: string) =>
      (edge.sourceId === x && edge.targetId === y) || (edge.sourceId === y && edge.targetId === x);

    expect(
      edges.some((edge) => edge.relationType === "related" && connects(edge, nodeA, nodeB)),
    ).toBe(true);
    // kb-c shares no content → no edges touch it.
    expect(edges.some((edge) => connects(edge, nodeA, nodeC) || connects(edge, nodeB, nodeC))).toBe(
      false,
    );
  });

  it("ignores content shared only within a single KB", () => {
    // Same hash on two chunks of kb-a must not create a self-edge or spurious cross edge.
    upsertChunkSemanticHash({ db: index.db, kbId: "kb-a", chunkId: "a1", semanticHash: "solo" });
    upsertChunkSemanticHash({ db: index.db, kbId: "kb-a", chunkId: "a2", semanticHash: "solo" });
    upsertChunkSemanticHash({ db: index.db, kbId: "kb-b", chunkId: "b1", semanticHash: "other" });
    const edges = buildCrossKnowledgeBaseEdges({
      db: index.db,
      knowledgeBases: [
        makeBase({ id: "kb-a", title: "kb-a" }),
        makeBase({ id: "kb-b", title: "kb-b" }),
      ],
    });
    expect(edges).toHaveLength(0);
  });
});

describe("loadArchivedDeliverableObjects", () => {
  it("projects archived deliverables as nodes linked to their KB space", () => {
    recordAgentGeneratedKnowledgeInIndex(index.db, {
      knowledgeId: "lin:1",
      kbId: "kb-a",
      type: "auto_analysis",
      title: "客户画像",
      sourceDeliverableId: "d-1",
      status: "confirmed",
    });
    const bases = [makeBase({ id: "kb-a", title: "个人库" })];

    const objects = loadArchivedDeliverableObjects({
      db: index.db,
      knowledgeBases: bases,
      archiveMap: { "d-1": "kb-a", "d-2": "kb-a" },
    });

    const withTitle = objects.find((obj) => obj.id === deliverableNodeObjectId("d-1"));
    expect(withTitle?.title).toBe("客户画像");
    expect(withTitle?.relatedObjectIds).toContain(knowledgeBaseNodeObjectId("kb-a"));
    expect(withTitle?.scopeLabel).toBe("成果");
    // Archive-only entry with no recovered title falls back to a generic label.
    const fallback = objects.find((obj) => obj.id === deliverableNodeObjectId("d-2"));
    expect(fallback?.title).toMatch(/^成果 /);
  });

  it("excludes deliverables archived into a KB outside the provided set", () => {
    const objects = loadArchivedDeliverableObjects({
      db: index.db,
      knowledgeBases: [makeBase({ id: "kb-a", title: "个人库" })],
      archiveMap: { "d-9": "kb-other" },
    });
    expect(objects).toHaveLength(0);
  });
});

describe("knowledge-index projection composed into buildKnowledgeSourceBundle", () => {
  it("emits distinct KB-space and deliverable nodes, archived-into edges, and cross-KB edges", () => {
    // Shared content (semantic hash) across kb-a and kb-b → cross-KB related edge.
    upsertChunkSemanticHash({ db: index.db, kbId: "kb-a", chunkId: "a1", semanticHash: "shared" });
    upsertChunkSemanticHash({ db: index.db, kbId: "kb-b", chunkId: "b1", semanticHash: "shared" });
    // Archived deliverable d-1 → kb-a.
    recordAgentGeneratedKnowledgeInIndex(index.db, {
      knowledgeId: "lin:1",
      kbId: "kb-a",
      type: "auto_analysis",
      title: "客户画像",
      sourceDeliverableId: "d-1",
      status: "confirmed",
    });

    const knowledgeBases = [
      makeBase({ id: "kb-a", title: "个人库", visibility: "private" }),
      makeBase({ id: "kb-b", title: "团队库", visibility: "team" }),
    ];
    // Mirror the source-bundle wiring: projection objects + extra cross-KB edges.
    const bundle = buildKnowledgeSourceBundle({
      objects: [
        ...loadKnowledgeBaseSpaceObjects({ db: index.db, knowledgeBases }),
        ...loadArchivedDeliverableObjects({
          db: index.db,
          knowledgeBases,
          archiveMap: { "d-1": "kb-a" },
        }),
      ],
      extraEdges: buildCrossKnowledgeBaseEdges({ db: index.db, knowledgeBases }),
    });

    const kbNode = bundle.graph.nodes.find(
      (node) => node.objectId === knowledgeBaseNodeObjectId("kb-a"),
    );
    expect(kbNode?.kind).toBe("knowledge-base");
    const deliverableNode = bundle.graph.nodes.find(
      (node) => node.objectId === deliverableNodeObjectId("d-1"),
    );
    expect(deliverableNode?.kind).toBe("deliverable");

    // Deliverable sedimented into its KB → archived-into edge (from relatedObjectIds).
    const kbNodeId = nodeIdForObject(knowledgeBaseNodeObjectId("kb-a"));
    const deliverableNodeId = nodeIdForObject(deliverableNodeObjectId("d-1"));
    expect(
      bundle.graph.edges.some(
        (edge) =>
          edge.relationType === "archived-into" &&
          ((edge.sourceId === deliverableNodeId && edge.targetId === kbNodeId) ||
            (edge.sourceId === kbNodeId && edge.targetId === deliverableNodeId)),
      ),
    ).toBe(true);

    // Cross-KB edge from the shared duplicate group.
    const kbBNodeId = nodeIdForObject(knowledgeBaseNodeObjectId("kb-b"));
    expect(
      bundle.graph.edges.some(
        (edge) =>
          edge.relationType === "related" &&
          ((edge.sourceId === kbNodeId && edge.targetId === kbBNodeId) ||
            (edge.sourceId === kbBNodeId && edge.targetId === kbNodeId)),
      ),
    ).toBe(true);
  });
});
