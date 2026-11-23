import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { SummaryGenerationDeferred } from "./retrieval-summary-hierarchy.js";
import type { RetrievalSummary } from "./retrieval-summary.js";

export function ensureRetrievalSummarySchema(db: DatabaseSync): void {
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
/** Injected generator must use the host's model/budget gateway. No model is called by default. */
export async function generateRetrievalSummary(
  db: DatabaseSync,
  docId: string,
  allowedKbIds: ReadonlySet<string>,
  generate: (source: {
    versionId: string;
    contentHash: string;
    body: string;
  }) => Promise<RetrievalSummary>,
  controls: {
    readAuthorizedSource: () => Promise<
      { versionId: string; contentHash: string; body: string } | undefined
    >;
    now?: () => number;
    leaseMs?: number;
  },
): Promise<boolean> {
  const now = controls.now ?? Date.now;
  const leaseMs = controls.leaseMs ?? 300_000;
  ensureRetrievalSummarySchema(db);
  const authorized = readRetrievalSummary(db, docId, allowedKbIds);
  if (!authorized || !(await controls.readAuthorizedSource())) {
    return false;
  }
  db.prepare(
    "UPDATE retrieval_summaries SET state='pending',claim=NULL WHERE doc_id=? AND state='processing' AND updated_at < ?",
  ).run(docId, now() - leaseMs);
  const old = readRetrievalSummary(db, docId, allowedKbIds);
  if (!old || old.method === "human" || !["pending", "stale", "failed"].includes(old.state)) {
    return false;
  }
  const claim = randomUUID();
  const won = db
    .prepare(
      "UPDATE retrieval_summaries SET state='processing',claim=?,updated_at=? WHERE doc_id=? AND version_id=? AND content_hash=? AND state IN ('pending','stale','failed') AND (method IS NULL OR method!='human')",
    )
    .run(claim, now(), docId, old.sourceVersionId, old.sourceContentHash);
  if (!won.changes) {
    return false;
  }
  try {
    const source = await controls.readAuthorizedSource();
    if (
      !source ||
      source.versionId !== old.sourceVersionId ||
      source.contentHash !== old.sourceContentHash
    ) {
      throw new Error("source_unavailable");
    }
    const result = await generate(source);
    const currentSource = await controls.readAuthorizedSource();
    if (
      !currentSource ||
      currentSource.versionId !== source.versionId ||
      currentSource.contentHash !== source.contentHash
    ) {
      throw new Error("source_changed_or_revoked");
    }
    if (
      result.sourceVersionId !== old.sourceVersionId ||
      result.sourceContentHash !== old.sourceContentHash ||
      result.state !== "ready" ||
      !result.fields
    ) {
      throw new Error("invalid_generation");
    }
    const saved = db
      .prepare(
        "UPDATE retrieval_summaries SET state='ready',method='model',payload=?,claim=NULL,updated_at=? WHERE doc_id=? AND claim=? AND version_id=? AND content_hash=? AND state='processing'",
      )
      .run(
        JSON.stringify({ ...result, method: "model" }),
        Date.now(),
        docId,
        claim,
        old.sourceVersionId,
        old.sourceContentHash,
      );
    return Boolean(saved.changes);
  } catch (error) {
    if (error instanceof SummaryGenerationDeferred) {
      db.prepare(
        "UPDATE retrieval_summaries SET state='pending',claim=NULL,updated_at=? WHERE doc_id=? AND claim=?",
      ).run(now(), docId, claim);
      return false;
    }
    const failedPayload = {
      ...old,
      state: "failed",
      failureCode: "generation_failed_or_source_unavailable",
    };
    db.prepare(
      "UPDATE retrieval_summaries SET state='failed',payload=?,claim=NULL,attempts=attempts+1,next_retry_at=?+MIN(3600000,60000*(1 << MIN(attempts,6))),updated_at=? WHERE doc_id=? AND claim=?",
    ).run(JSON.stringify(failedPayload), now(), now(), docId, claim);
    return false;
  }
}

/** Explicit maintenance write; callers must resolve current source and write permission server-side. */
export async function editRetrievalSummary(
  db: DatabaseSync,
  docId: string,
  fields: NonNullable<RetrievalSummary["fields"]>,
  authorize: () => Promise<{ kbId: string; versionId: string; contentHash: string } | undefined>,
): Promise<boolean> {
  const source = await authorize();
  if (!source) {
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
