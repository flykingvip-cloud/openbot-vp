/**
 * Knowledge-index projection source.
 *
 * Projects the *real* knowledge base index (documents, governance relations, and
 * archived deliverables) into relationship-graph objects/edges so the 关系网络 shows
 * the actual knowledge base instead of only heuristic skill-asset/feed nodes.
 *
 * Design (per product decision):
 *  - Aggregate by KB space: one node per knowledge base (not per document), keeping
 *    the graph readable regardless of how many documents a base holds.
 *  - Cross-KB edges come from shared content: knowledge bases holding a chunk with the
 *    same `semantic_hash` contain overlapping/duplicate knowledge and are linked (related).
 *    semantic_hash is content-derived (KB-independent), unlike duplicate/conflict group ids
 *    which are assigned per-KB and never span bases. Intra-KB relations stay collapsed
 *    inside the space and are surfaced in the node summary rather than as self-loops.
 *  - Archived deliverables (成果) become nodes linked to the KB they were archived into
 *    via `relatedObjectIds` (the runtime turns that into an `archived-into` edge), so the
 *    成果 → 知识库 sedimentation is visible in the network.
 */
import type { DatabaseSync } from "node:sqlite";
import { getChunkRelationBreakdown } from "../governance/chunk-governance-store.js";
import type { KnowledgeBase } from "../knowledge-base-store.js";
import { nodeIdForObject } from "../runtime/relationship-runtime.js";
import type { KnowledgeObject, KnowledgeSource, RelationshipEdge } from "../types.js";

/** Newest archived deliverables kept as graph nodes; protects graph readability. */
const MAX_DELIVERABLE_NODES = 80;
/** Upper bound on synthesized cross-KB edges; a hash shared across many KBs is rare. */
const MAX_CROSS_KB_EDGES = 200;

/** Stable object id for a knowledge-base-space node. */
export function knowledgeBaseNodeObjectId(kbId: string): string {
  return `obj:kb:${kbId}`;
}

/** Stable object id for an archived-deliverable node. */
export function deliverableNodeObjectId(deliverableId: string): string {
  return `obj:deliverable:${deliverableId}`;
}

function sourceForVisibility(visibility: KnowledgeBase["visibility"]): KnowledgeSource {
  return visibility === "private" ? "personal" : "enterprise";
}

function scopeLabelForVisibility(visibility: KnowledgeBase["visibility"]): string {
  if (visibility === "private") {
    return "个人知识库";
  }
  return visibility === "team" ? "团队知识库" : "企业知识库";
}

/**
 * One relationship object per knowledge base (KB-space aggregation). The real
 * 引用/重复/冲突 counts are embedded in the summary so the detail panel shows a
 * base's internal relation density even though intra-KB edges stay collapsed.
 */
export function loadKnowledgeBaseSpaceObjects(params: {
  db: DatabaseSync;
  knowledgeBases: KnowledgeBase[];
}): KnowledgeObject[] {
  return params.knowledgeBases.map((base) => {
    const breakdown = getChunkRelationBreakdown(params.db, base.id);
    const scopeLabel = scopeLabelForVisibility(base.visibility);
    const description = base.description?.trim();
    const summary =
      description ||
      `${base.documentCount} 篇文档 · 引用 ${breakdown.reference} / 重复 ${breakdown.duplicate} / 冲突 ${breakdown.conflict}`;
    return {
      id: knowledgeBaseNodeObjectId(base.id),
      title: base.title,
      source: sourceForVisibility(base.visibility),
      kind: "document",
      summary,
      tags: [...new Set(["知识库", scopeLabel, ...base.tags])].slice(0, 8),
      updatedAt: base.updatedAtMs,
      sourceSystem: "知识库",
      scopeLabel,
    } satisfies KnowledgeObject;
  });
}

type SemanticHashRow = { hash: string | null; kb_id: string };

/**
 * Cross-KB edges from shared content. Two knowledge bases that each hold a chunk with the
 * same `semantic_hash` contain overlapping/duplicate knowledge and are linked with a
 * `related` edge. `semantic_hash` is content-derived (KB-independent) and written for every
 * governed chunk, so — unlike per-KB `duplicate_group_id`/`conflict_group_id`, which are
 * assigned within a single base and never span KBs — this signal genuinely fires across
 * knowledge bases. Edges are deduped by unordered KB pair and bounded.
 */
export function buildCrossKnowledgeBaseEdges(params: {
  db: DatabaseSync;
  knowledgeBases: KnowledgeBase[];
}): RelationshipEdge[] {
  const kbIds = new Set(params.knowledgeBases.map((base) => base.id));
  if (kbIds.size < 2) {
    return [];
  }
  const rows = params.db
    .prepare(
      `SELECT semantic_hash AS hash, kb_id
         FROM chunk_governance
        WHERE semantic_hash IS NOT NULL AND semantic_hash <> ''
        GROUP BY semantic_hash, kb_id`,
    )
    .all() as SemanticHashRow[];
  const kbsByHash = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.hash || !kbIds.has(row.kb_id)) {
      continue;
    }
    const list = kbsByHash.get(row.hash) ?? [];
    if (!list.includes(row.kb_id)) {
      list.push(row.kb_id);
      kbsByHash.set(row.hash, list);
    }
  }

  const edges: RelationshipEdge[] = [];
  const seen = new Set<string>();
  for (const list of kbsByHash.values()) {
    if (list.length < 2) {
      continue;
    }
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        if (edges.length >= MAX_CROSS_KB_EDGES) {
          return edges;
        }
        const [a, b] = [list[i], list[j]].toSorted();
        const key = `${a}::${b}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        edges.push({
          sourceId: nodeIdForObject(knowledgeBaseNodeObjectId(a)),
          targetId: nodeIdForObject(knowledgeBaseNodeObjectId(b)),
          relationType: "related",
          score: 70,
        });
      }
    }
  }
  return edges;
}

type DeliverableKnowledgeRow = {
  source_deliverable_id: string | null;
  kb_id: string;
  title: string | null;
  updated_at: number;
};

/**
 * Archived deliverables (成果) as graph nodes, linked to the knowledge base they were
 * archived into. Titles are recovered from agent-generated-knowledge rows when present;
 * archive-store entries without a recovered title fall back to a generic label. Each node
 * carries `relatedObjectIds: [<kb object>]` so the runtime emits an `archived-into` edge.
 */
export function loadArchivedDeliverableObjects(params: {
  db: DatabaseSync;
  knowledgeBases: KnowledgeBase[];
  /** deliverableId -> knowledgeBaseId, from the deliverable archive store. */
  archiveMap: Record<string, string>;
  limit?: number;
}): KnowledgeObject[] {
  const visibilityByKb = new Map(params.knowledgeBases.map((base) => [base.id, base.visibility]));
  const titleByKb = new Map(params.knowledgeBases.map((base) => [base.id, base.title]));

  // deliverableId -> { kbId, title?, updatedAt } — prefer recovered agent-knowledge titles.
  const resolved = new Map<string, { kbId: string; title: string | null; updatedAt: number }>();

  const rows = params.db
    .prepare(
      `SELECT source_deliverable_id, kb_id, title, updated_at
         FROM agent_generated_knowledge
        WHERE source_deliverable_id IS NOT NULL AND source_deliverable_id <> ''
        ORDER BY updated_at DESC`,
    )
    .all() as DeliverableKnowledgeRow[];
  for (const row of rows) {
    const deliverableId = row.source_deliverable_id?.trim();
    if (!deliverableId || !visibilityByKb.has(row.kb_id) || resolved.has(deliverableId)) {
      continue;
    }
    resolved.set(deliverableId, {
      kbId: row.kb_id,
      title: row.title?.trim() || null,
      updatedAt: row.updated_at,
    });
  }

  // Merge archive-store entries not already recovered (title unknown → generic label).
  for (const [deliverableId, kbId] of Object.entries(params.archiveMap)) {
    const id = deliverableId.trim();
    if (!id || resolved.has(id) || !visibilityByKb.has(kbId)) {
      continue;
    }
    resolved.set(id, { kbId, title: null, updatedAt: 0 });
  }

  const limit = params.limit ?? MAX_DELIVERABLE_NODES;
  return [...resolved.entries()]
    .toSorted((left, right) => right[1].updatedAt - left[1].updatedAt)
    .slice(0, Math.max(0, limit))
    .map(([deliverableId, entry]) => {
      const visibility = visibilityByKb.get(entry.kbId) ?? "private";
      const kbTitle = titleByKb.get(entry.kbId);
      const shortId = deliverableId.replace(/^skill:/, "").slice(0, 8);
      return {
        id: deliverableNodeObjectId(deliverableId),
        title: entry.title || `成果 ${shortId}`,
        source: sourceForVisibility(visibility),
        kind: "insight",
        summary: kbTitle ? `已归档成果 · 沉淀入《${kbTitle}》` : "已归档成果",
        tags: ["成果", "已归档"],
        updatedAt: entry.updatedAt || Date.now(),
        sourceSystem: "成果中心",
        scopeLabel: "成果",
        relatedObjectIds: [knowledgeBaseNodeObjectId(entry.kbId)],
      } satisfies KnowledgeObject;
    });
}
