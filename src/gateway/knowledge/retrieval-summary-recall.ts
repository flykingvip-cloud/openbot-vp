import type { DatabaseSync } from "node:sqlite";
import { ensureRetrievalSummarySchema } from "./retrieval-summary-store.js";
import { retrievalSummaryText, type RetrievalSummary } from "./retrieval-summary.js";

/** KB ACL must be resolved before opening this index. No document-count truncation. */
export function recallSummaryDocuments(
  db: DatabaseSync,
  kbId: string,
  query: string,
  limit = 20,
): Array<{ docId: string; title: string; sourceUri: string; score: number }> {
  ensureRetrievalSummarySchema(db);
  const terms = query.trim().toLowerCase().split(/\s+/u).filter(Boolean);
  if (!terms.length) {
    return [];
  }
  const found: Array<{ docId: string; title: string; sourceUri: string; score: number }> = [];
  let candidateIds: string[] | undefined;
  if (terms.every((term) => term.length >= 3)) {
    try {
      candidateIds = db
        .prepare(
          "SELECT doc_id FROM retrieval_summary_fts WHERE retrieval_summary_fts MATCH ? AND kb_id=? ORDER BY rank LIMIT ?",
        )
        .all(
          terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(" OR "),
          kbId,
          Math.min(Math.max(limit * 8, 64), 400),
        )
        .map((row) => String(row.doc_id));
    } catch {
      /* tokenizer unavailable: use streaming fallback */
    }
  }
  if (candidateIds?.length === 0) {
    return [];
  }
  const statement = db.prepare(
    `SELECT d.title,r.doc_id,r.payload,r.version_id,r.content_hash FROM retrieval_summaries r JOIN documents d ON d.doc_id=r.doc_id AND d.kb_id=r.kb_id JOIN document_versions v ON v.version_id=d.current_version_id WHERE r.kb_id=? AND r.state='ready' AND r.version_id=d.current_version_id AND r.content_hash=v.semantic_hash${candidateIds ? ` AND r.doc_id IN (${candidateIds.map(() => "?").join(",")})` : ""}`,
  );
  for (const row of statement.iterate(kbId, ...(candidateIds ?? []))) {
    const text = retrievalSummaryText(JSON.parse(String(row.payload)) as RetrievalSummary, {
      versionId: String(row.version_id),
      contentHash: String(row.content_hash),
    }).toLowerCase();
    const score = terms.filter((term) => text.includes(term)).length / terms.length;
    if (score) {
      found.push({
        docId: String(row.doc_id),
        title: String(row.title || row.doc_id),
        sourceUri: `ku://kb/${encodeURIComponent(kbId)}/doc/${encodeURIComponent(String(row.doc_id))}@${encodeURIComponent(String(row.version_id))}`,
        score,
      });
      found.sort((a, b) => b.score - a.score || a.docId.localeCompare(b.docId));
      if (found.length > limit) {
        found.pop();
      }
    }
  }
  return found;
}
