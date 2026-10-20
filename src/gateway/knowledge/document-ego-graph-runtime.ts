/**
 * Runtime helpers that open the KB index and build a document ego graph.
 * Kept separate from the pure graph builder so unit tests can exercise the
 * builder against an in-memory/temp index without going through store lookups.
 */
import fs from "node:fs";
import {
  buildDocumentEgoGraph,
  buildDocumentKnowledgeObject,
  buildKnowledgeBaseLibraryGraph,
  parseDocumentObjectId,
} from "./document-ego-graph.js";
import { openKnowledgeIndex, resolveKnowledgeIndexDbPath } from "./kb-index.js";
import { getKnowledgeBase } from "./knowledge-base-store.js";
import type { KnowledgeObject, RelationshipGraph } from "./types.js";

export async function buildDocumentEgoGraphForKnowledgeBase(params: {
  knowledgeBaseId: string;
  docId: string;
  documentTitle?: string | null;
  indexRoot?: string;
}): Promise<RelationshipGraph | null> {
  const knowledgeBase = getKnowledgeBase(params.knowledgeBaseId);
  if (!knowledgeBase) {
    return null;
  }
  const dbPath = resolveKnowledgeIndexDbPath({
    ownerId: knowledgeBase.ownerId,
    tenantId: knowledgeBase.tenantId,
    indexRoot: params.indexRoot,
  });
  if (!fs.existsSync(dbPath)) {
    // Still return a single-node graph so the cockpit does not keep the previous KB map.
    const { documentNodeId, documentNodeObjectId } = await import("./document-ego-graph.js");
    const title = params.documentTitle?.trim() || params.docId;
    return {
      nodes: [
        {
          id: documentNodeId(params.docId),
          kind: "knowledge-object",
          title,
          objectId: documentNodeObjectId(params.docId),
          summary: "暂无跨文档关系",
          governance: { status: "healthy", conflictCount: 0 },
        },
      ],
      edges: [],
    };
  }
  const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
  try {
    return buildDocumentEgoGraph({
      db: index.db,
      kbId: params.knowledgeBaseId,
      docId: params.docId,
      documentTitle: params.documentTitle,
    });
  } finally {
    index.close();
  }
}

export async function buildKnowledgeBaseLibraryGraphForKnowledgeBase(params: {
  knowledgeBaseId: string;
  indexRoot?: string;
}): Promise<RelationshipGraph | null> {
  const knowledgeBase = getKnowledgeBase(params.knowledgeBaseId);
  if (!knowledgeBase) {
    return null;
  }
  const fallbackDocumentIds = [
    ...knowledgeBase.documentIds,
    ...(knowledgeBase.recycledDocumentIds ?? []),
  ];
  const dbPath = resolveKnowledgeIndexDbPath({
    ownerId: knowledgeBase.ownerId,
    tenantId: knowledgeBase.tenantId,
    indexRoot: params.indexRoot,
  });
  if (!fs.existsSync(dbPath)) {
    // No index yet — still project registered document ids so folder select
    // switches away from the previous global / document ego map.
    const { documentNodeId, documentNodeObjectId } = await import("./document-ego-graph.js");
    return {
      nodes: fallbackDocumentIds
        .map((docId) => docId.trim())
        .filter(Boolean)
        .map((docId) => ({
          id: documentNodeId(docId),
          kind: "knowledge-object" as const,
          title: docId,
          objectId: documentNodeObjectId(docId),
          summary: "尚未索引",
          governance: { status: "healthy" as const, conflictCount: 0 },
        })),
      edges: [],
    };
  }
  const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
  try {
    return buildKnowledgeBaseLibraryGraph({
      db: index.db,
      kbId: params.knowledgeBaseId,
      fallbackDocumentIds,
    });
  } finally {
    index.close();
  }
}

export async function loadDocumentKnowledgeObject(params: {
  knowledgeBaseId: string;
  docId: string;
  documentTitle?: string | null;
  indexRoot?: string;
}): Promise<KnowledgeObject | null> {
  const knowledgeBase = getKnowledgeBase(params.knowledgeBaseId);
  if (!knowledgeBase) {
    return null;
  }
  const dbPath = resolveKnowledgeIndexDbPath({
    ownerId: knowledgeBase.ownerId,
    tenantId: knowledgeBase.tenantId,
    indexRoot: params.indexRoot,
  });
  if (!fs.existsSync(dbPath)) {
    return {
      id: `obj:doc:${params.docId}`,
      title: params.documentTitle?.trim() || params.docId,
      source: "personal",
      kind: "document",
      summary: "暂无跨文档关系",
      tags: ["文档"],
      updatedAt: Date.now(),
      scopeLabel: "知识库文档",
      relationshipSummary: { relatedCount: 0, conflictCount: 0, supportingCount: 0 },
    };
  }
  const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
  try {
    return buildDocumentKnowledgeObject({
      db: index.db,
      kbId: params.knowledgeBaseId,
      docId: params.docId,
      documentTitle: params.documentTitle,
    });
  } finally {
    index.close();
  }
}

export async function loadDocumentKnowledgeObjectByObjectId(params: {
  objectId: string;
  knowledgeBaseId?: string | null;
  indexRoot?: string;
}): Promise<KnowledgeObject | null> {
  const docId = parseDocumentObjectId(params.objectId);
  if (!docId) {
    return null;
  }
  const kbId = params.knowledgeBaseId?.trim();
  if (kbId) {
    return loadDocumentKnowledgeObject({
      knowledgeBaseId: kbId,
      docId,
      indexRoot: params.indexRoot,
    });
  }
  // Without kbId, scan known bases for a matching documentId ownership.
  const { listKnowledgeBases } = await import("./knowledge-base-store.js");
  for (const base of listKnowledgeBases()) {
    if (base.documentIds.includes(docId) || (base.recycledDocumentIds ?? []).includes(docId)) {
      return loadDocumentKnowledgeObject({
        knowledgeBaseId: base.id,
        docId,
        indexRoot: params.indexRoot,
      });
    }
  }
  return null;
}
