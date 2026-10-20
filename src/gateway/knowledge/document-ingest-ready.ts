import { KB_CHUNK_META_TABLE, KB_VECTOR_TABLE } from "./kb-index-schema.js";
import { openKnowledgeIndex, resolveKnowledgeIndexDbPath } from "./kb-index.js";
/**
 * One live read of whether a knowledge document can be searched and fully
 * consumed: original bytes + FTS chunks + vectors must all exist.
 */
import { hasKnowledgeOriginal } from "./knowledge-original-store.js";

export type KnowledgeDocumentIngestReady = {
  docId: string;
  originalStored: boolean;
  chunkCount: number;
  vectorCount: number;
};

export function isKnowledgeDocumentIngestReady(row: KnowledgeDocumentIngestReady): boolean {
  return row.originalStored && row.chunkCount > 0 && row.vectorCount > 0;
}

/** Original bytes + FTS chunks landed. Vectors may still be deferred. */
export function isKnowledgeDocumentStored(row: KnowledgeDocumentIngestReady): boolean {
  return row.originalStored && row.chunkCount > 0;
}

export function isSqliteVecUnavailableError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return /no such module:\s*vec0/i.test(text);
}

export async function readKnowledgeDocumentIngestReady(params: {
  kbId: string;
  docId: string;
  ownerId: string;
  tenantId?: string | null;
  indexRoot?: string;
  originalsRoot?: string;
}): Promise<KnowledgeDocumentIngestReady> {
  const docId = params.docId.trim();
  const originalStored = hasKnowledgeOriginal({
    kbId: params.kbId,
    docId,
    ...(params.originalsRoot ? { originalsRoot: params.originalsRoot } : {}),
  });
  const dbPath = resolveKnowledgeIndexDbPath({
    ownerId: params.ownerId,
    tenantId: params.tenantId ?? null,
    indexRoot: params.indexRoot,
  });
  const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
  try {
    const chunkRow = index.db
      .prepare(`SELECT COUNT(*) AS n FROM ${KB_CHUNK_META_TABLE} WHERE kb_id = ? AND doc_id = ?`)
      .get(params.kbId, docId) as { n: number } | undefined;
    const chunkCount = Number(chunkRow?.n ?? 0);
    let vectorCount = 0;
    const vecTable = index.db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
      .get(KB_VECTOR_TABLE) as { name?: string } | undefined;
    if (vecTable?.name) {
      try {
        const vectorRow = index.db
          .prepare(
            `SELECT COUNT(*) AS n
             FROM ${KB_VECTOR_TABLE} v
             JOIN ${KB_CHUNK_META_TABLE} m ON m.chunk_id = v.id
            WHERE m.kb_id = ? AND m.doc_id = ?`,
          )
          .get(params.kbId, docId) as { n: number } | undefined;
        vectorCount = Number(vectorRow?.n ?? 0);
      } catch (error) {
        // Existing indexes may already have a vec0 table. Opening without the
        // extension must not fail the upload; vectors stay deferred.
        if (!isSqliteVecUnavailableError(error)) {
          throw error;
        }
      }
    }
    return { docId, originalStored, chunkCount, vectorCount };
  } finally {
    index.close();
  }
}
