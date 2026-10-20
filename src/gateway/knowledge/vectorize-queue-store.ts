import type { DatabaseSync } from "node:sqlite";

export const MAX_KNOWLEDGE_VECTORIZE_ATTEMPTS = 5;

export type KnowledgeVectorizeStatus = "pending" | "done" | "error";

export type KnowledgeVectorizeJob = {
  kbId: string;
  docId: string;
  versionId: string | null;
};

function trimId(value: string | null | undefined): string {
  return value?.trim() || "";
}

/** Queue a background embedding job. Re-enqueue resets attempts so a new save retries. */
export function enqueueKnowledgeVectorizeInIndex(
  db: DatabaseSync,
  params: { kbId: string; docId: string; versionId?: string | null; nowMs?: number },
): boolean {
  const kbId = trimId(params.kbId);
  const docId = trimId(params.docId);
  if (!kbId || !docId) {
    return false;
  }
  const now = params.nowMs ?? Date.now();
  const versionId = trimId(params.versionId) || null;
  db.prepare(
    `INSERT INTO knowledge_vectorize_queue
       (kb_id, doc_id, version_id, status, attempts, last_error, enqueued_at, processed_at, updated_at)
     VALUES (?, ?, ?, 'pending', 0, NULL, ?, NULL, ?)
     ON CONFLICT(kb_id, doc_id) DO UPDATE SET
       version_id = COALESCE(excluded.version_id, knowledge_vectorize_queue.version_id),
       status = 'pending',
       attempts = 0,
       last_error = NULL,
       processed_at = NULL,
       updated_at = excluded.updated_at`,
  ).run(kbId, docId, versionId, now, now);
  return true;
}

export function listPendingKnowledgeVectorizeInIndex(
  db: DatabaseSync,
  params?: { limit?: number },
): KnowledgeVectorizeJob[] {
  const limit = Math.max(1, Math.min(params?.limit ?? 20, 100));
  const rows = db
    .prepare(
      `SELECT kb_id, doc_id, version_id
         FROM knowledge_vectorize_queue
        WHERE status = 'pending' AND attempts < ?
        ORDER BY updated_at ASC
        LIMIT ?`,
    )
    .all(MAX_KNOWLEDGE_VECTORIZE_ATTEMPTS, limit) as Array<{
    kb_id: string;
    doc_id: string;
    version_id: string | null;
  }>;
  return rows.map((row) => ({
    kbId: row.kb_id,
    docId: row.doc_id,
    versionId: row.version_id,
  }));
}

export function markKnowledgeVectorizeDoneInIndex(
  db: DatabaseSync,
  params: { kbId: string; docId: string; nowMs?: number },
): void {
  const now = params.nowMs ?? Date.now();
  db.prepare(
    `UPDATE knowledge_vectorize_queue
        SET status = 'done', attempts = attempts + 1, last_error = NULL,
            processed_at = ?, updated_at = ?
      WHERE kb_id = ? AND doc_id = ?`,
  ).run(now, now, params.kbId, params.docId);
}

export function markKnowledgeVectorizeErrorInIndex(
  db: DatabaseSync,
  params: { kbId: string; docId: string; error: string; nowMs?: number },
): void {
  const now = params.nowMs ?? Date.now();
  db.prepare(
    `UPDATE knowledge_vectorize_queue
        SET attempts = attempts + 1,
            last_error = ?,
            status = CASE WHEN attempts + 1 >= ? THEN 'error' ELSE 'pending' END,
            updated_at = ?
      WHERE kb_id = ? AND doc_id = ?`,
  ).run(
    params.error.slice(0, 500),
    MAX_KNOWLEDGE_VECTORIZE_ATTEMPTS,
    now,
    params.kbId,
    params.docId,
  );
}

export function getKnowledgeVectorizeQueueRow(
  db: DatabaseSync,
  kbId: string,
  docId: string,
): {
  status: KnowledgeVectorizeStatus;
  attempts: number;
  lastError: string | null;
  versionId: string | null;
} | null {
  const row = db
    .prepare(
      `SELECT status, attempts, last_error, version_id
         FROM knowledge_vectorize_queue WHERE kb_id = ? AND doc_id = ?`,
    )
    .get(kbId, docId) as
    | {
        status: KnowledgeVectorizeStatus;
        attempts: number;
        last_error: string | null;
        version_id: string | null;
      }
    | undefined;
  if (!row) {
    return null;
  }
  return {
    status: row.status,
    attempts: row.attempts,
    lastError: row.last_error,
    versionId: row.version_id,
  };
}
