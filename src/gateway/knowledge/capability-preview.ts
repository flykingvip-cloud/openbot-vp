import fs from "node:fs";
import { truncateUtf16Safe } from "../../utils.js";
import { KNOWLEDGE_INDEX_CAPABILITY_ID } from "./feed/data-capability-feed-adapter.js";
import { countIndexedChunks } from "./governance/chunk-governance-store.js";
import { openKnowledgeIndex, resolveKnowledgeIndexDbPath } from "./kb-index.js";

const PREVIEW_SNIPPET_MAX_CHARS = 280;
const DEFAULT_PREVIEW_LIMIT = 5;

export type KnowledgeCapabilityPreviewItem = {
  docId: string;
  docTitle: string;
  kbId: string;
  section: string | null;
  snippet: string;
};

export type KnowledgeCapabilityPreview = {
  capabilityId: string;
  indexedChunkCount: number;
  items: KnowledgeCapabilityPreviewItem[];
};

/**
 * Real-data preview for the knowledge-index-backed capability: returns a small
 * sample of the employee's most recently indexed chunks straight from their KB
 * index. This is genuinely live data (not seed/demo) — the same chunks the
 * governance-aware retrieval consumes.
 */
export async function previewKnowledgeIndexCapability(params: {
  ownerId: string;
  tenantId: string | null;
  limit?: number;
  indexRoot?: string;
}): Promise<KnowledgeCapabilityPreview> {
  const limit = Math.min(Math.max(params.limit ?? DEFAULT_PREVIEW_LIMIT, 1), 20);
  const empty: KnowledgeCapabilityPreview = {
    capabilityId: KNOWLEDGE_INDEX_CAPABILITY_ID,
    indexedChunkCount: 0,
    items: [],
  };
  const dbPath = resolveKnowledgeIndexDbPath({
    ownerId: params.ownerId,
    tenantId: params.tenantId,
    indexRoot: params.indexRoot,
  });
  if (!fs.existsSync(dbPath)) {
    return empty;
  }
  const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
  try {
    const indexedChunkCount = countIndexedChunks(index.db);
    if (indexedChunkCount <= 0) {
      return empty;
    }
    const rows = index.db
      .prepare(
        `SELECT c.text AS text, d.title AS doc_title, m.kb_id AS kb_id, m.doc_id AS doc_id, m.section AS section
         FROM chunks c
         JOIN chunk_meta m ON m.chunk_id = c.id
         JOIN documents d ON d.doc_id = m.doc_id AND m.version_id = d.current_version_id
         ORDER BY d.updated_at DESC, m.start_line ASC
         LIMIT ?`,
      )
      .all(limit) as Array<{
      text: string;
      doc_title: string;
      kb_id: string;
      doc_id: string;
      section: string | null;
    }>;
    return {
      capabilityId: KNOWLEDGE_INDEX_CAPABILITY_ID,
      indexedChunkCount,
      items: rows.map((row) => ({
        docId: row.doc_id,
        docTitle: row.doc_title,
        kbId: row.kb_id,
        section: row.section,
        snippet: truncateUtf16Safe(row.text, PREVIEW_SNIPPET_MAX_CHARS),
      })),
    };
  } finally {
    index.close();
  }
}
