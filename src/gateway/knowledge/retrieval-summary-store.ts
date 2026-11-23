import type { DatabaseSync } from "node:sqlite";
import { knowledgeDocumentGeneration } from "./kb-index.js";
import type { RetrievalSummary } from "./retrieval-summary.js";

export function ensureRetrievalSummarySchema(db: DatabaseSync): void {
  db.exec("CREATE TABLE IF NOT EXISTS retrieval_summary_deleted_bases(kb_id TEXT PRIMARY KEY)");
  db.exec(`CREATE TABLE IF NOT EXISTS retrieval_summaries (
    doc_id TEXT PRIMARY KEY, kb_id TEXT NOT NULL, version_id TEXT NOT NULL,
    content_hash TEXT NOT NULL, state TEXT NOT NULL, method TEXT,
    payload TEXT NOT NULL, claim TEXT, updated_at INTEGER NOT NULL)`);
  const columns = new Set(
    db
      .prepare("PRAGMA table_info(retrieval_summaries)")
      .all()
      .map((row) => String(row.name)),
  );
  if (!columns.has("attempts")) {
    db.exec("ALTER TABLE retrieval_summaries ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0");
  }
  if (!columns.has("next_retry_at")) {
    db.exec("ALTER TABLE retrieval_summaries ADD COLUMN next_retry_at INTEGER NOT NULL DEFAULT 0");
  }
  db.exec(
    `CREATE INDEX IF NOT EXISTS retrieval_summary_kb_state ON retrieval_summaries(kb_id,state,version_id)`,
  );
  try {
    db.exec(
      `CREATE VIRTUAL TABLE IF NOT EXISTS retrieval_summary_fts USING fts5(doc_id UNINDEXED,kb_id UNINDEXED,text,tokenize='trigram')`,
    );
    db.exec(
      `CREATE TRIGGER IF NOT EXISTS retrieval_summary_fts_insert AFTER INSERT ON retrieval_summaries BEGIN INSERT INTO retrieval_summary_fts(doc_id,kb_id,text) VALUES(new.doc_id,new.kb_id,new.payload); END`,
    );
    db.exec(
      `CREATE TRIGGER IF NOT EXISTS retrieval_summary_fts_update AFTER UPDATE OF payload ON retrieval_summaries BEGIN DELETE FROM retrieval_summary_fts WHERE doc_id=old.doc_id; INSERT INTO retrieval_summary_fts(doc_id,kb_id,text) VALUES(new.doc_id,new.kb_id,new.payload); END`,
    );
    db.exec(
      `CREATE TRIGGER IF NOT EXISTS retrieval_summary_fts_delete AFTER DELETE ON retrieval_summaries BEGIN DELETE FROM retrieval_summary_fts WHERE doc_id=old.doc_id; END`,
    );
    db.exec(
      "CREATE TABLE IF NOT EXISTS retrieval_summary_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)",
    );
    if (!db.prepare("SELECT value FROM retrieval_summary_meta WHERE key='fts_backfill_v1'").get()) {
      db.exec(
        `INSERT INTO retrieval_summary_fts(doc_id,kb_id,text) SELECT doc_id,kb_id,payload FROM retrieval_summaries r WHERE NOT EXISTS(SELECT 1 FROM retrieval_summary_fts f WHERE f.doc_id=r.doc_id)`,
      );
      db.prepare(
        "INSERT OR IGNORE INTO retrieval_summary_meta VALUES('fts_backfill_v1','done')",
      ).run();
    }
  } catch {
    // SQLite distributions without trigram retain the bounded-memory fallback.
  }
}
export function queueRetrievalSummary(
  db: DatabaseSync,
  input: { docId: string; kbId: string; versionId: string; contentHash: string },
): void {
  ensureRetrievalSummarySchema(db);
  if (db.prepare("SELECT 1 FROM retrieval_summary_deleted_bases WHERE kb_id=?").get(input.kbId)) {
    return;
  }
  const old = db
    .prepare("SELECT version_id, content_hash, method FROM retrieval_summaries WHERE doc_id=?")
    .get(input.docId);
  if (old?.version_id === input.versionId && old.content_hash === input.contentHash) {
    return;
  }
  const state = old ? "stale" : "pending";
  const payload: RetrievalSummary = {
    schemaVersion: 1,
    state,
    documentType: "other",
    sourceVersionId: input.versionId,
    sourceContentHash: input.contentHash,
    templateVersion: "1",
  };
  // Preserve human-authored payload for explicit review on source changes.
  if (old?.method === "human") {
    db.prepare(
      "UPDATE retrieval_summaries SET version_id=?,content_hash=?,state='stale', claim=NULL, updated_at=? WHERE doc_id=?",
    ).run(input.versionId, input.contentHash, Date.now(), input.docId);
    return;
  }
  db.prepare(
    `INSERT INTO retrieval_summaries(doc_id,kb_id,version_id,content_hash,state,method,payload,claim,updated_at) VALUES (?,?,?,?,?,NULL,?,NULL,?) ON CONFLICT(doc_id) DO UPDATE SET kb_id=excluded.kb_id,version_id=excluded.version_id,content_hash=excluded.content_hash,state=excluded.state,payload=excluded.payload,claim=NULL,attempts=0,next_retry_at=0,updated_at=excluded.updated_at`,
  ).run(
    input.docId,
    input.kbId,
    input.versionId,
    input.contentHash,
    state,
    JSON.stringify(payload),
    Date.now(),
  );
}
/** Caller must supply its authorized KB set; no diagnostic metadata is returned before ACL. */
export function readRetrievalSummary(
  db: DatabaseSync,
  docId: string,
  allowedKbIds: ReadonlySet<string>,
):
  | (RetrievalSummary & { currentSourceVersionId: string; currentSourceContentHash: string })
  | undefined {
  ensureRetrievalSummarySchema(db);
  const row = db.prepare("SELECT * FROM retrieval_summaries WHERE doc_id=?").get(docId);
  if (!row || !allowedKbIds.has(String(row.kb_id))) {
    return undefined;
  }
  return {
    ...(JSON.parse(String(row.payload)) as RetrievalSummary),
    state: row.state as RetrievalSummary["state"],
    currentSourceVersionId: String(row.version_id),
    currentSourceContentHash: String(row.content_hash),
  };
}
/** Explicit maintenance write; callers must resolve current source and write permission server-side. */
export async function editRetrievalSummary(
  db: DatabaseSync,
  docId: string,
  fields: NonNullable<RetrievalSummary["fields"]>,
  authorize: () => Promise<{ kbId: string; versionId: string; contentHash: string } | undefined>,
): Promise<boolean> {
  const generation = knowledgeDocumentGeneration(db, docId);
  const source = await authorize();
  if (!source || knowledgeDocumentGeneration(db, docId) !== generation) {
    return false;
  }
  // The authorization callback may await: deletion or a version update must win.
  if (
    db.prepare("SELECT 1 FROM sqlite_master WHERE name='documents'").get() &&
    !db
      .prepare(
        "SELECT 1 FROM documents d JOIN document_versions v ON v.version_id=d.current_version_id WHERE d.doc_id=? AND d.kb_id=? AND v.version_id=? AND v.semantic_hash=?",
      )
      .get(docId, source.kbId, source.versionId, source.contentHash)
  ) {
    return false;
  }
  ensureRetrievalSummarySchema(db);
  if (db.prepare("SELECT 1 FROM retrieval_summary_deleted_bases WHERE kb_id=?").get(source.kbId)) {
    return false;
  }
  queueRetrievalSummary(db, { docId, ...source });
  const payload: RetrievalSummary = {
    schemaVersion: 1,
    state: "ready",
    documentType: "other",
    sourceVersionId: source.versionId,
    sourceContentHash: source.contentHash,
    templateVersion: "human-1",
    generatedAt: Date.now(),
    method: "human",
    fields,
  };
  const result = db
    .prepare(
      "UPDATE retrieval_summaries SET state='ready',method='human',payload=?,claim=NULL,updated_at=? WHERE doc_id=? AND kb_id=? AND version_id=? AND content_hash=?",
    )
    .run(
      JSON.stringify(payload),
      Date.now(),
      docId,
      source.kbId,
      source.versionId,
      source.contentHash,
    );
  return Boolean(result.changes);
}
