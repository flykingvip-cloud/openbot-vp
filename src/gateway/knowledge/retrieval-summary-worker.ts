import type { DatabaseSync } from "node:sqlite";
import {
  generateRetrievalSummary,
  ensureRetrievalSummarySchema,
} from "./retrieval-summary-store.js";
import type { RetrievalSummary } from "./retrieval-summary.js";

/** Bounded queue consumer. The gateway supplies live ACL/source and budgeted generation. */
export async function tickRetrievalSummaries(input: {
  db: DatabaseSync;
  allowedKbIds: ReadonlySet<string>;
  readAuthorizedSource: (
    docId: string,
  ) => Promise<{ versionId: string; contentHash: string; body: string } | undefined>;
  generate?: (source: {
    versionId: string;
    contentHash: string;
    body: string;
    documentId: string;
  }) => Promise<RetrievalSummary>;
  acquireBudget: (docId: string) => Promise<boolean>;
  limit?: number;
}) {
  const result = { processed: 0, generated: 0, failed: 0, pendingConfiguration: !input.generate };
  if (!input.generate) {
    return result;
  }
  ensureRetrievalSummarySchema(input.db);
  const kbIds = [...input.allowedKbIds];
  if (!kbIds.length) {
    return result;
  }
  const rows = input.db
    .prepare(
      `SELECT doc_id,kb_id FROM retrieval_summaries WHERE kb_id IN (${kbIds.map(() => "?").join(",")}) AND (method IS NULL OR method!='human') AND ((state IN ('pending','stale') OR (state='failed' AND attempts<3 AND next_retry_at<=?)) OR (state='processing' AND updated_at < ?)) ORDER BY updated_at,doc_id LIMIT ?`,
    )
    .all(...kbIds, Date.now(), Date.now() - 300000, Math.min(Math.max(input.limit ?? 4, 1), 20));
  for (const row of rows) {
    if (
      !input.allowedKbIds.has(String(row.kb_id)) ||
      !(await input.acquireBudget(String(row.doc_id)))
    ) {
      continue;
    }
    result.processed++;
    const ok = await generateRetrievalSummary(
      input.db,
      String(row.doc_id),
      input.allowedKbIds,
      (source) => input.generate!({ ...source, documentId: String(row.doc_id) }),
      { readAuthorizedSource: () => input.readAuthorizedSource(String(row.doc_id)) },
    );
    if (ok) {
      result.generated++;
    } else {
      result.failed++;
    }
  }
  return result;
}
