import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildDocumentEgoGraph,
  buildKnowledgeBaseLibraryGraph,
  documentNodeId,
  documentNodeObjectId,
  mergeRelationshipGraphs,
} from "./document-ego-graph.js";
import {
  assignConflictGroup,
  assignDuplicateGroup,
  ensureChunkGovernanceRows,
  insertChunkRelation,
} from "./governance/chunk-governance-store.js";
import { openKnowledgeIndex, resolveKnowledgeIndexDbPath } from "./kb-index.js";

type KnowledgeIndex = Awaited<ReturnType<typeof openKnowledgeIndex>>;

let indexRoot: string;
let index: KnowledgeIndex;

function insertDocument(params: {
  docId: string;
  kbId: string;
  title: string;
  chunkIds: string[];
}) {
  const now = Date.now();
  index.db
    .prepare(
      `INSERT INTO documents (doc_id, kb_id, title, current_version_id, content_type, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(params.docId, params.kbId, params.title, "v1", "text/plain", now, now);
  for (const chunkId of params.chunkIds) {
    index.db
      .prepare(`INSERT INTO chunks (id, text, model) VALUES (?, ?, ?)`)
      .run(chunkId, `text-${chunkId}`, "test");
    index.db
      .prepare(
        `INSERT INTO chunk_meta (chunk_id, kb_id, doc_id, version_id, heading, section, start_line, end_line, visibility, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(chunkId, params.kbId, params.docId, "v1", null, null, 1, 1, "private", "upload");
  }
  ensureChunkGovernanceRows({
    db: index.db,
    kbId: params.kbId,
    chunkIds: params.chunkIds,
  });
}

beforeEach(async () => {
  indexRoot = path.join(os.tmpdir(), `doc-ego-${randomUUID()}`);
  const dbPath = resolveKnowledgeIndexDbPath({ ownerId: "user-1", tenantId: null, indexRoot });
  index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
});

afterEach(() => {
  index.close();
  fs.rmSync(indexRoot, { recursive: true, force: true });
});

describe("buildDocumentEgoGraph", () => {
  it("returns a single center node when the document has no cross-doc relations", () => {
    insertDocument({ docId: "doc-a", kbId: "kb-1", title: "文档 A", chunkIds: ["c-a1"] });

    const graph = buildDocumentEgoGraph({
      db: index.db,
      kbId: "kb-1",
      docId: "doc-a",
    });

    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0]?.id).toBe(documentNodeId("doc-a"));
    expect(graph.nodes[0]?.objectId).toBe(documentNodeObjectId("doc-a"));
    expect(graph.nodes[0]?.title).toBe("文档 A");
    expect(graph.edges).toHaveLength(0);
  });

  it("links documents that share a duplicate group", () => {
    insertDocument({ docId: "doc-a", kbId: "kb-1", title: "文档 A", chunkIds: ["c-a1"] });
    insertDocument({ docId: "doc-b", kbId: "kb-1", title: "文档 B", chunkIds: ["c-b1"] });
    assignDuplicateGroup({
      db: index.db,
      kbId: "kb-1",
      chunkIds: ["c-a1", "c-b1"],
      duplicateGroupId: "dup-1",
    });

    const graph = buildDocumentEgoGraph({
      db: index.db,
      kbId: "kb-1",
      docId: "doc-a",
    });

    expect(
      graph.nodes
        .map((node) => node.objectId)
        .filter((id): id is string => typeof id === "string")
        .toSorted((a, b) => a.localeCompare(b)),
    ).toEqual(["obj:doc:doc-a", "obj:doc:doc-b"]);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]?.relationType).toBe("related");
  });

  it("links documents that share a conflict group and marks conflicts", () => {
    insertDocument({ docId: "doc-a", kbId: "kb-1", title: "文档 A", chunkIds: ["c-a1"] });
    insertDocument({ docId: "doc-b", kbId: "kb-1", title: "文档 B", chunkIds: ["c-b1"] });
    assignConflictGroup({
      db: index.db,
      kbId: "kb-1",
      chunkIds: ["c-a1", "c-b1"],
      conflictGroupId: "cf-1",
    });

    const graph = buildDocumentEgoGraph({
      db: index.db,
      kbId: "kb-1",
      docId: "doc-a",
    });

    expect(graph.edges.some((edge) => edge.relationType === "conflicts")).toBe(true);
    expect(graph.nodes.find((node) => node.objectId === "obj:doc:doc-a")?.governance?.status).toBe(
      "conflict",
    );
  });

  it("projects chunk_relations reference edges to supports between documents", () => {
    insertDocument({ docId: "doc-a", kbId: "kb-1", title: "文档 A", chunkIds: ["c-a1"] });
    insertDocument({ docId: "doc-b", kbId: "kb-1", title: "文档 B", chunkIds: ["c-b1"] });
    insertChunkRelation({
      db: index.db,
      kbId: "kb-1",
      fromChunk: "c-a1",
      toChunk: "c-b1",
      relationType: "reference",
    });

    const graph = buildDocumentEgoGraph({
      db: index.db,
      kbId: "kb-1",
      docId: "doc-a",
    });

    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]?.relationType).toBe("supports");
  });
});

describe("buildKnowledgeBaseLibraryGraph", () => {
  it("returns all library documents and lifts shared duplicate groups", () => {
    insertDocument({ docId: "doc-a", kbId: "kb-1", title: "文档 A", chunkIds: ["c-a1"] });
    insertDocument({ docId: "doc-b", kbId: "kb-1", title: "文档 B", chunkIds: ["c-b1"] });
    insertDocument({ docId: "doc-c", kbId: "kb-1", title: "文档 C", chunkIds: ["c-c1"] });
    assignDuplicateGroup({
      db: index.db,
      kbId: "kb-1",
      chunkIds: ["c-a1", "c-b1"],
      duplicateGroupId: "dup-lib-1",
    });

    const graph = buildKnowledgeBaseLibraryGraph({
      db: index.db,
      kbId: "kb-1",
    });

    expect(graph.nodes).toHaveLength(3);
    expect(graph.nodes.every((node) => node.kind === "knowledge-object")).toBe(true);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]?.relationType).toBe("related");
  });

  it("includes fallback document ids not yet indexed", () => {
    insertDocument({ docId: "doc-a", kbId: "kb-1", title: "文档 A", chunkIds: ["c-a1"] });
    const graph = buildKnowledgeBaseLibraryGraph({
      db: index.db,
      kbId: "kb-1",
      fallbackDocumentIds: ["doc-pending"],
    });
    const objectIds = graph.nodes
      .map((node) => node.objectId)
      .filter((id): id is string => typeof id === "string");
    expect(objectIds.toSorted((a, b) => a.localeCompare(b))).toEqual(
      ["obj:doc:doc-a", "obj:doc:doc-pending"].toSorted((a, b) => a.localeCompare(b)),
    );
  });
});

describe("mergeRelationshipGraphs", () => {
  it("keeps KB panorama nodes and overlays document ego neighbors", () => {
    const merged = mergeRelationshipGraphs(
      {
        nodes: [
          {
            id: "node:obj:kb:kb-1",
            kind: "knowledge-base",
            title: "库",
            objectId: "obj:kb:kb-1",
          },
          {
            id: "node:obj:kb:kb-2",
            kind: "knowledge-base",
            title: "库2",
            objectId: "obj:kb:kb-2",
          },
        ],
        edges: [
          {
            sourceId: "node:obj:kb:kb-1",
            targetId: "node:obj:kb:kb-2",
            relationType: "related",
            score: 0.5,
            reasons: ["kb"],
          },
        ],
      },
      {
        nodes: [
          {
            id: documentNodeId("doc-a"),
            kind: "knowledge-object",
            title: "文档 A",
            objectId: documentNodeObjectId("doc-a"),
          },
          {
            id: documentNodeId("doc-b"),
            kind: "knowledge-object",
            title: "文档 B",
            objectId: documentNodeObjectId("doc-b"),
          },
        ],
        edges: [
          {
            sourceId: documentNodeId("doc-a"),
            targetId: documentNodeId("doc-b"),
            relationType: "conflicts",
            score: 0.9,
            reasons: ["document-ego:conflicts"],
          },
        ],
      },
    );

    expect(merged.nodes.map((node) => node.id).toSorted((a, b) => a.localeCompare(b))).toEqual([
      documentNodeId("doc-a"),
      documentNodeId("doc-b"),
      "node:obj:kb:kb-1",
      "node:obj:kb:kb-2",
    ]);
    expect(merged.edges).toHaveLength(2);
    expect(merged.edges.some((edge) => edge.relationType === "conflicts")).toBe(true);
  });

  it("lets overlay node titles win on id collision", () => {
    const nodeId = documentNodeId("doc-a");
    const merged = mergeRelationshipGraphs(
      {
        nodes: [
          {
            id: nodeId,
            kind: "knowledge-object",
            title: "stale",
            objectId: documentNodeObjectId("doc-a"),
          },
        ],
        edges: [],
      },
      {
        nodes: [
          {
            id: nodeId,
            kind: "knowledge-object",
            title: "文档 A",
            objectId: documentNodeObjectId("doc-a"),
          },
        ],
        edges: [],
      },
    );
    expect(merged.nodes).toHaveLength(1);
    expect(merged.nodes[0]?.title).toBe("文档 A");
  });
});
