/**
 * Document ego subgraph for the home relations cockpit.
 *
 * The main relationship bundle aggregates by knowledge-base space (one node per KB).
 * When the user focuses a library document leaf, we instead project chunk-level
 * governance relations (reference / duplicate / conflict) up to document↔document
 * edges so the right cockpit topology actually changes per document.
 */
import type { DatabaseSync } from "node:sqlite";
import { nodeIdForObject } from "./runtime/relationship-runtime.js";
import type {
  RelationshipEdge,
  RelationshipEdgeType,
  RelationshipGraph,
  RelationshipNode,
  RelationshipNodeGovernance,
} from "./types.js";

/** Stable object id for a library document node in the ego subgraph. */
export function documentNodeObjectId(docId: string): string {
  return `obj:doc:${docId.trim()}`;
}

export function documentNodeId(docId: string): string {
  return nodeIdForObject(documentNodeObjectId(docId));
}

export function parseDocumentObjectId(objectId: string): string | null {
  const trimmed = objectId.trim();
  if (!trimmed.startsWith("obj:doc:")) {
    return null;
  }
  const docId = trimmed.slice("obj:doc:".length).trim();
  return docId || null;
}

/**
 * Union a knowledge-base panorama graph with a document ego subgraph.
 * Ego nodes/edges win on id collision so document focus titles stay authoritative.
 */
export function mergeRelationshipGraphs(
  base: RelationshipGraph,
  overlay: RelationshipGraph,
): RelationshipGraph {
  const nodesById = new Map<string, RelationshipNode>();
  for (const node of base.nodes) {
    nodesById.set(node.id, node);
  }
  for (const node of overlay.nodes) {
    nodesById.set(node.id, node);
  }
  const edgeKey = (edge: RelationshipEdge) =>
    `${edge.sourceId}\0${edge.targetId}\0${edge.relationType}`;
  const edgesByKey = new Map<string, RelationshipEdge>();
  for (const edge of base.edges) {
    edgesByKey.set(edgeKey(edge), edge);
  }
  for (const edge of overlay.edges) {
    edgesByKey.set(edgeKey(edge), edge);
  }
  return {
    nodes: [...nodesById.values()],
    edges: [...edgesByKey.values()],
  };
}

type DocRow = { doc_id: string; title: string; updated_at: number | null };
type ChunkDocRow = { chunk_id: string; doc_id: string };
type RelationRow = {
  from_chunk: string;
  to_chunk: string;
  relation_type: string;
  weight: number | null;
};
type GroupRow = {
  chunk_id: string;
  doc_id: string;
  duplicate_group_id: string | null;
  conflict_group_id: string | null;
  governance_status: string | null;
};

function mapRelationType(relationType: string): RelationshipEdgeType {
  if (relationType === "conflict") {
    return "conflicts";
  }
  if (relationType === "reference") {
    return "supports";
  }
  // duplicate and unknown → related
  return "related";
}

function governanceForDoc(
  conflictCount: number,
  relatedCount: number,
): RelationshipNodeGovernance | undefined {
  if (conflictCount > 0) {
    return { status: "conflict", conflictCount };
  }
  if (relatedCount > 0) {
    return { status: "attention", conflictCount: 0 };
  }
  return { status: "healthy", conflictCount: 0 };
}

function loadDocumentTitle(db: DatabaseSync, kbId: string, docId: string): string {
  const row = db
    .prepare(`SELECT title FROM documents WHERE kb_id = ? AND doc_id = ? LIMIT 1`)
    .get(kbId, docId) as { title: string } | undefined;
  const title = row?.title?.trim();
  return title || docId;
}

function loadDocTitles(db: DatabaseSync, kbId: string, docIds: string[]): Map<string, string> {
  const map = new Map<string, string>();
  if (docIds.length === 0) {
    return map;
  }
  const placeholders = docIds.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `SELECT doc_id, title, updated_at FROM documents
        WHERE kb_id = ? AND doc_id IN (${placeholders})`,
    )
    .all(kbId, ...docIds) as DocRow[];
  for (const row of rows) {
    map.set(row.doc_id, row.title?.trim() || row.doc_id);
  }
  return map;
}

/**
 * Build an ego RelationshipGraph centered on `docId` inside `kbId`.
 * Always includes the center document node even when it has no neighbors.
 */
export function buildDocumentEgoGraph(params: {
  db: DatabaseSync;
  kbId: string;
  docId: string;
  documentTitle?: string | null;
}): RelationshipGraph {
  const kbId = params.kbId.trim();
  const docId = params.docId.trim();
  const centerTitle = params.documentTitle?.trim() || loadDocumentTitle(params.db, kbId, docId);

  const focusChunks = params.db
    .prepare(`SELECT chunk_id FROM chunk_meta WHERE kb_id = ? AND doc_id = ?`)
    .all(kbId, docId) as Array<{ chunk_id: string }>;
  const focusChunkIds = new Set(focusChunks.map((row) => row.chunk_id));

  const neighborDocIds = new Set<string>();
  const edgeKeyScores = new Map<string, { relationType: RelationshipEdgeType; score: number }>();

  const addEdge = (otherDocId: string, relationType: RelationshipEdgeType, score: number) => {
    if (!otherDocId || otherDocId === docId) {
      return;
    }
    neighborDocIds.add(otherDocId);
    const a = documentNodeId(docId);
    const b = documentNodeId(otherDocId);
    const [sourceId, targetId] = a < b ? [a, b] : [b, a];
    const key = `${sourceId}|${targetId}|${relationType}`;
    const prev = edgeKeyScores.get(key);
    if (!prev || score > prev.score) {
      edgeKeyScores.set(key, { relationType, score });
    }
  };

  if (focusChunkIds.size > 0) {
    const chunkToDoc = new Map<string, string>();
    const allChunkDocs = params.db
      .prepare(`SELECT chunk_id, doc_id FROM chunk_meta WHERE kb_id = ?`)
      .all(kbId) as ChunkDocRow[];
    for (const row of allChunkDocs) {
      chunkToDoc.set(row.chunk_id, row.doc_id);
    }

    // Explicit chunk_relations → document edges
    const relations = params.db
      .prepare(
        `SELECT from_chunk, to_chunk, relation_type, weight
           FROM chunk_relations WHERE kb_id = ?`,
      )
      .all(kbId) as RelationRow[];
    for (const rel of relations) {
      const fromDoc = chunkToDoc.get(rel.from_chunk);
      const toDoc = chunkToDoc.get(rel.to_chunk);
      if (!fromDoc || !toDoc) {
        continue;
      }
      if (fromDoc === docId && toDoc !== docId) {
        addEdge(toDoc, mapRelationType(rel.relation_type), Number(rel.weight ?? 1));
      } else if (toDoc === docId && fromDoc !== docId) {
        addEdge(fromDoc, mapRelationType(rel.relation_type), Number(rel.weight ?? 1));
      }
    }

    // Shared duplicate / conflict groups across documents
    const groupRows = params.db
      .prepare(
        `SELECT m.chunk_id AS chunk_id, m.doc_id AS doc_id,
                g.duplicate_group_id AS duplicate_group_id,
                g.conflict_group_id AS conflict_group_id,
                g.governance_status AS governance_status
           FROM chunk_meta m
           JOIN chunk_governance g ON g.chunk_id = m.chunk_id
          WHERE m.kb_id = ?`,
      )
      .all(kbId) as GroupRow[];

    const dupGroups = new Map<string, Set<string>>();
    const conflictGroups = new Map<string, Set<string>>();
    let focusConflictChunks = 0;
    for (const row of groupRows) {
      if (focusChunkIds.has(row.chunk_id) && row.conflict_group_id) {
        focusConflictChunks += 1;
      }
      if (row.duplicate_group_id) {
        const set = dupGroups.get(row.duplicate_group_id) ?? new Set<string>();
        set.add(row.doc_id);
        dupGroups.set(row.duplicate_group_id, set);
      }
      if (row.conflict_group_id) {
        const set = conflictGroups.get(row.conflict_group_id) ?? new Set<string>();
        set.add(row.doc_id);
        conflictGroups.set(row.conflict_group_id, set);
      }
    }

    for (const docs of dupGroups.values()) {
      if (!docs.has(docId)) {
        continue;
      }
      for (const other of docs) {
        addEdge(other, "related", 0.8);
      }
    }
    for (const docs of conflictGroups.values()) {
      if (!docs.has(docId)) {
        continue;
      }
      for (const other of docs) {
        addEdge(other, "conflicts", 1);
      }
    }

    void focusConflictChunks;
  }

  const allDocIds = [docId, ...neighborDocIds];
  const titles = loadDocTitles(params.db, kbId, allDocIds);
  titles.set(docId, centerTitle);

  const conflictNeighborCount = [...edgeKeyScores.values()].filter(
    (edge) => edge.relationType === "conflicts",
  ).length;

  const nodes: RelationshipNode[] = allDocIds.map((id) => {
    const isCenter = id === docId;
    const objectId = documentNodeObjectId(id);
    const relatedCount = isCenter
      ? neighborDocIds.size
      : [...edgeKeyScores.keys()].filter((key) => key.includes(documentNodeId(id))).length;
    const conflictCount = isCenter
      ? conflictNeighborCount
      : [...edgeKeyScores.entries()].filter(
          ([key, edge]) => key.includes(documentNodeId(id)) && edge.relationType === "conflicts",
        ).length;
    return {
      id: documentNodeId(id),
      kind: "knowledge-object",
      title: titles.get(id) ?? id,
      objectId,
      summary: isCenter
        ? neighborDocIds.size > 0
          ? `与 ${neighborDocIds.size} 篇文档存在关系`
          : "暂无跨文档关系"
        : undefined,
      governance: governanceForDoc(conflictCount, relatedCount),
    };
  });

  const edges: RelationshipEdge[] = [];
  for (const [key, edge] of edgeKeyScores) {
    const [sourceId, targetId] = key.split("|");
    if (!sourceId || !targetId) {
      continue;
    }
    edges.push({
      sourceId,
      targetId,
      relationType: edge.relationType,
      score: edge.score,
      reasons: [`document-ego:${edge.relationType}`],
    });
  }

  return { nodes, edges };
}

/**
 * Library-level document panorama for one knowledge base (folder select).
 * Projects all indexed docs in the KB plus optional store fallbacks, and lifts
 * chunk relations / governance groups to document↔document edges.
 */
export function buildKnowledgeBaseLibraryGraph(params: {
  db: DatabaseSync;
  kbId: string;
  /** Docs registered on the KB store but not yet present in the index. */
  fallbackDocumentIds?: string[];
}): RelationshipGraph {
  const kbId = params.kbId.trim();
  const docRows = params.db
    .prepare(`SELECT doc_id, title FROM documents WHERE kb_id = ?`)
    .all(kbId) as Array<{ doc_id: string; title: string }>;
  const titles = new Map<string, string>();
  const docIds = new Set<string>();
  for (const row of docRows) {
    const id = row.doc_id.trim();
    if (!id) {
      continue;
    }
    docIds.add(id);
    titles.set(id, row.title?.trim() || id);
  }
  for (const raw of params.fallbackDocumentIds ?? []) {
    const id = raw.trim();
    if (!id || docIds.has(id)) {
      continue;
    }
    docIds.add(id);
    titles.set(id, id);
  }
  if (docIds.size === 0) {
    return { nodes: [], edges: [] };
  }

  const chunkToDoc = new Map<string, string>();
  const allChunkDocs = params.db
    .prepare(`SELECT chunk_id, doc_id FROM chunk_meta WHERE kb_id = ?`)
    .all(kbId) as ChunkDocRow[];
  for (const row of allChunkDocs) {
    chunkToDoc.set(row.chunk_id, row.doc_id);
  }

  const edgeKeyScores = new Map<string, { relationType: RelationshipEdgeType; score: number }>();
  const addEdge = (
    fromDoc: string,
    toDoc: string,
    relationType: RelationshipEdgeType,
    score: number,
  ) => {
    if (!fromDoc || !toDoc || fromDoc === toDoc) {
      return;
    }
    if (!docIds.has(fromDoc) || !docIds.has(toDoc)) {
      return;
    }
    const a = documentNodeId(fromDoc);
    const b = documentNodeId(toDoc);
    const [sourceId, targetId] = a < b ? [a, b] : [b, a];
    const key = `${sourceId}|${targetId}|${relationType}`;
    const prev = edgeKeyScores.get(key);
    if (!prev || score > prev.score) {
      edgeKeyScores.set(key, { relationType, score });
    }
  };

  const relations = params.db
    .prepare(
      `SELECT from_chunk, to_chunk, relation_type, weight
         FROM chunk_relations WHERE kb_id = ?`,
    )
    .all(kbId) as RelationRow[];
  for (const rel of relations) {
    const fromDoc = chunkToDoc.get(rel.from_chunk);
    const toDoc = chunkToDoc.get(rel.to_chunk);
    if (!fromDoc || !toDoc) {
      continue;
    }
    addEdge(fromDoc, toDoc, mapRelationType(rel.relation_type), Number(rel.weight ?? 1));
  }

  const groupRows = params.db
    .prepare(
      `SELECT m.chunk_id AS chunk_id, m.doc_id AS doc_id,
              g.duplicate_group_id AS duplicate_group_id,
              g.conflict_group_id AS conflict_group_id,
              g.governance_status AS governance_status
         FROM chunk_meta m
         JOIN chunk_governance g ON g.chunk_id = m.chunk_id
        WHERE m.kb_id = ?`,
    )
    .all(kbId) as GroupRow[];
  const dupGroups = new Map<string, Set<string>>();
  const conflictGroups = new Map<string, Set<string>>();
  for (const row of groupRows) {
    if (row.duplicate_group_id) {
      const set = dupGroups.get(row.duplicate_group_id) ?? new Set<string>();
      set.add(row.doc_id);
      dupGroups.set(row.duplicate_group_id, set);
    }
    if (row.conflict_group_id) {
      const set = conflictGroups.get(row.conflict_group_id) ?? new Set<string>();
      set.add(row.doc_id);
      conflictGroups.set(row.conflict_group_id, set);
    }
  }
  for (const docs of dupGroups.values()) {
    const list = [...docs];
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        addEdge(list[i], list[j], "related", 0.8);
      }
    }
  }
  for (const docs of conflictGroups.values()) {
    const list = [...docs];
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        addEdge(list[i], list[j], "conflicts", 1);
      }
    }
  }

  const conflictCountByDoc = new Map<string, number>();
  const relatedCountByDoc = new Map<string, number>();
  for (const [key, edge] of edgeKeyScores) {
    const [sourceId, targetId] = key.split("|");
    if (!sourceId || !targetId) {
      continue;
    }
    for (const nodeId of [sourceId, targetId]) {
      const docId = [...docIds].find((id) => documentNodeId(id) === nodeId);
      if (!docId) {
        continue;
      }
      relatedCountByDoc.set(docId, (relatedCountByDoc.get(docId) ?? 0) + 1);
      if (edge.relationType === "conflicts") {
        conflictCountByDoc.set(docId, (conflictCountByDoc.get(docId) ?? 0) + 1);
      }
    }
  }

  const nodes: RelationshipNode[] = [...docIds]
    .toSorted((a, b) => (titles.get(a) ?? a).localeCompare(titles.get(b) ?? b, "zh"))
    .map((id) => ({
      id: documentNodeId(id),
      kind: "knowledge-object" as const,
      title: titles.get(id) ?? id,
      objectId: documentNodeObjectId(id),
      summary:
        (relatedCountByDoc.get(id) ?? 0) > 0
          ? `与 ${relatedCountByDoc.get(id)} 篇文档存在关系`
          : "库内文档",
      governance: governanceForDoc(conflictCountByDoc.get(id) ?? 0, relatedCountByDoc.get(id) ?? 0),
    }));

  const edges: RelationshipEdge[] = [];
  for (const [key, edge] of edgeKeyScores) {
    const [sourceId, targetId] = key.split("|");
    if (!sourceId || !targetId) {
      continue;
    }
    edges.push({
      sourceId,
      targetId,
      relationType: edge.relationType,
      score: edge.score,
      reasons: [`library-panorama:${edge.relationType}`],
    });
  }

  return { nodes, edges };
}

/** Build a KnowledgeObject-shaped record for a library document (for object RPC / detail). */
export function buildDocumentKnowledgeObject(params: {
  db: DatabaseSync;
  kbId: string;
  docId: string;
  documentTitle?: string | null;
}): {
  id: string;
  title: string;
  source: "personal" | "enterprise";
  kind: "document";
  summary: string;
  tags: string[];
  updatedAt: number;
  scopeLabel: string;
  relationshipSummary: {
    relatedCount: number;
    conflictCount: number;
    supportingCount: number;
  };
} {
  const graph = buildDocumentEgoGraph(params);
  const center = graph.nodes.find((node) => node.objectId === documentNodeObjectId(params.docId));
  const conflictCount = graph.edges.filter((edge) => edge.relationType === "conflicts").length;
  const supportingCount = graph.edges.filter((edge) => edge.relationType === "supports").length;
  const relatedCount = graph.edges.length;
  const row = params.db
    .prepare(`SELECT title, updated_at FROM documents WHERE kb_id = ? AND doc_id = ? LIMIT 1`)
    .get(params.kbId, params.docId) as { title: string; updated_at: number | null } | undefined;
  // Prefer a content excerpt so library "open/view" surfaces show readable text
  // instead of only the relationship stub ("暂无跨文档关系").
  const excerptRow = params.db
    .prepare(
      `SELECT c.text AS text
         FROM chunk_meta m
         JOIN chunks c ON c.id = m.chunk_id
        WHERE m.kb_id = ? AND m.doc_id = ?
        ORDER BY m.start_line ASC
        LIMIT 1`,
    )
    .get(params.kbId, params.docId) as { text: string | null } | undefined;
  const excerpt = (excerptRow?.text ?? "").replace(/\s+/g, " ").trim();
  const summary =
    excerpt.length > 0
      ? excerpt.length > 280
        ? `${excerpt.slice(0, 279)}…`
        : excerpt
      : (center?.summary ?? "");
  return {
    id: documentNodeObjectId(params.docId),
    title: params.documentTitle?.trim() || row?.title?.trim() || center?.title || params.docId,
    source: "personal",
    kind: "document",
    summary,
    tags: ["文档"],
    updatedAt: row?.updated_at ?? Date.now(),
    scopeLabel: "知识库文档",
    relationshipSummary: {
      relatedCount,
      conflictCount,
      supportingCount,
    },
  };
}
