import type { DatabaseSync } from "node:sqlite";

export const KB_CHUNKS_TABLE = "chunks";
export const KB_CHUNK_META_TABLE = "chunk_meta";
export const KB_VECTOR_TABLE = "chunks_vec";
export const KB_FTS_TABLE = "chunks_fts";
export const KB_LINEAGE_TABLE = "knowledge_lineage";

export function ensureKnowledgeIndexSchema(params: { db: DatabaseSync; ftsEnabled?: boolean }): {
  ftsAvailable: boolean;
  ftsError?: string;
} {
  params.db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  params.db.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      doc_id TEXT PRIMARY KEY,
      kb_id TEXT NOT NULL,
      title TEXT NOT NULL,
      current_version_id TEXT,
      content_type TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  params.db.exec(`
    CREATE TABLE IF NOT EXISTS document_versions (
      version_id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL,
      version_label TEXT NOT NULL,
      raw_hash TEXT NOT NULL,
      semantic_hash TEXT NOT NULL,
      published_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
  params.db.exec(`
    CREATE INDEX IF NOT EXISTS idx_doc_versions_doc ON document_versions(doc_id, created_at);
  `);
  params.db.exec(`
    CREATE TABLE IF NOT EXISTS ${KB_CHUNKS_TABLE} (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      model TEXT NOT NULL
    );
  `);
  params.db.exec(`
    CREATE TABLE IF NOT EXISTS ${KB_CHUNK_META_TABLE} (
      chunk_id TEXT PRIMARY KEY,
      kb_id TEXT NOT NULL,
      doc_id TEXT NOT NULL,
      version_id TEXT NOT NULL,
      heading TEXT,
      section TEXT,
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      visibility TEXT,
      source TEXT
    );
  `);
  params.db.exec(`CREATE INDEX IF NOT EXISTS idx_meta_kb ON ${KB_CHUNK_META_TABLE}(kb_id);`);
  params.db.exec(
    `CREATE INDEX IF NOT EXISTS idx_meta_doc_ver ON ${KB_CHUNK_META_TABLE}(doc_id, version_id);`,
  );

  params.db.exec(`
    CREATE TABLE IF NOT EXISTS web_source_snapshots (
      snapshot_id TEXT PRIMARY KEY,
      kb_id TEXT NOT NULL,
      doc_id TEXT,
      url TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      content_length INTEGER NOT NULL,
      normalized_text TEXT,
      change_kind TEXT NOT NULL,
      change_ratio REAL,
      fetched_at INTEGER NOT NULL,
      CHECK (change_kind IN ('initial','unchanged','changed'))
    );
  `);
  params.db.exec(
    `CREATE INDEX IF NOT EXISTS idx_web_snap_url ON web_source_snapshots(kb_id, url, fetched_at);`,
  );
  params.db.exec(
    `CREATE INDEX IF NOT EXISTS idx_web_snap_doc ON web_source_snapshots(kb_id, doc_id);`,
  );

  params.db.exec(`
    CREATE TABLE IF NOT EXISTS dataset_schemas (
      doc_id TEXT NOT NULL,
      kb_id TEXT NOT NULL,
      format TEXT NOT NULL,
      column_count INTEGER NOT NULL,
      row_count INTEGER NOT NULL,
      columns_json TEXT NOT NULL,
      detected_at INTEGER NOT NULL,
      PRIMARY KEY (kb_id, doc_id)
    );
  `);
  params.db.exec(`CREATE INDEX IF NOT EXISTS idx_dataset_schema_kb ON dataset_schemas(kb_id);`);

  params.db.exec(`
    CREATE TABLE IF NOT EXISTS web_source_refresh (
      kb_id TEXT NOT NULL,
      url TEXT NOT NULL,
      doc_id TEXT,
      enabled INTEGER NOT NULL DEFAULT 0,
      interval_ms INTEGER NOT NULL,
      last_refreshed_at INTEGER,
      next_due_at INTEGER,
      last_status TEXT,
      last_error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (kb_id, url)
    );
  `);
  params.db.exec(
    `CREATE INDEX IF NOT EXISTS idx_web_refresh_due ON web_source_refresh(enabled, next_due_at);`,
  );

  params.db.exec(`
    CREATE TABLE IF NOT EXISTS agent_generated_knowledge (
      knowledge_id TEXT PRIMARY KEY,
      kb_id TEXT NOT NULL,
      agent_id TEXT,
      type TEXT NOT NULL,
      title TEXT,
      summary TEXT,
      source_lineage_id TEXT,
      source_deliverable_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      CHECK (type IN ('conversation_summary','long_term_memory','auto_sop','auto_relation','auto_analysis'))
    );
  `);
  params.db.exec(
    `CREATE INDEX IF NOT EXISTS idx_agk_kb ON agent_generated_knowledge(kb_id, type);`,
  );

  params.db.exec(`
    CREATE TABLE IF NOT EXISTS agent_knowledge_generation_queue (
      kb_id TEXT NOT NULL,
      session_key TEXT NOT NULL,
      agent_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      enqueued_at INTEGER NOT NULL,
      processed_at INTEGER,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (kb_id, session_key),
      CHECK (status IN ('pending','done','error'))
    );
  `);
  params.db.exec(
    `CREATE INDEX IF NOT EXISTS idx_akgq_pending ON agent_knowledge_generation_queue(status, updated_at);`,
  );

  params.db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_vectorize_queue (
      kb_id TEXT NOT NULL,
      doc_id TEXT NOT NULL,
      version_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      enqueued_at INTEGER NOT NULL,
      processed_at INTEGER,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (kb_id, doc_id),
      CHECK (status IN ('pending','done','error'))
    );
  `);
  params.db.exec(
    `CREATE INDEX IF NOT EXISTS idx_kvq_pending ON knowledge_vectorize_queue(status, updated_at);`,
  );

  let ftsAvailable = false;
  let ftsError: string | undefined;
  const ftsEnabled = params.ftsEnabled !== false;
  if (ftsEnabled) {
    try {
      params.db.exec(
        `CREATE VIRTUAL TABLE IF NOT EXISTS ${KB_FTS_TABLE} USING fts5(\n` +
          `  text,\n` +
          `  id UNINDEXED,\n` +
          `  model UNINDEXED\n` +
          `);`,
      );
      ftsAvailable = true;
    } catch (err) {
      ftsAvailable = false;
      ftsError = err instanceof Error ? err.message : String(err);
    }
  }

  ensureKnowledgeGovernanceSchema(params.db);

  return { ftsAvailable, ...(ftsError ? { ftsError } : undefined) };
}

export function ensureKnowledgeGovernanceSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chunk_governance (
      chunk_id TEXT PRIMARY KEY,
      kb_id TEXT NOT NULL,
      quality_score REAL,
      trust_score REAL,
      freshness_score REAL,
      semantic_hash TEXT,
      duplicate_group_id TEXT,
      conflict_group_id TEXT,
      governance_status TEXT,
      reference_count INTEGER DEFAULT 0,
      last_hit_at INTEGER,
      last_analyzed_at INTEGER
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_chunk_gov_kb ON chunk_governance(kb_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_chunk_gov_dup ON chunk_governance(duplicate_group_id);`);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_chunk_gov_conflict ON chunk_governance(conflict_group_id);`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_chunk_gov_semhash ON chunk_governance(kb_id, semantic_hash);`,
  );
  db.exec(`
    CREATE TABLE IF NOT EXISTS chunk_relations (
      id TEXT PRIMARY KEY,
      kb_id TEXT NOT NULL,
      from_chunk TEXT NOT NULL,
      to_chunk TEXT NOT NULL,
      relation_type TEXT NOT NULL,
      weight REAL,
      created_at INTEGER NOT NULL,
      CHECK (relation_type IN ('duplicate','conflict','reference'))
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_chunk_rel_kb ON chunk_relations(kb_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_chunk_rel_from ON chunk_relations(from_chunk);`);
  db.exec(`
    CREATE TABLE IF NOT EXISTS governance_tasks (
      id TEXT PRIMARY KEY,
      kb_id TEXT NOT NULL,
      task_type TEXT NOT NULL,
      status TEXT NOT NULL,
      priority INTEGER DEFAULT 0,
      related_chunk_ids TEXT,
      proposed_resolution TEXT,
      assigned_to TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_gov_task_kb_status ON governance_tasks(kb_id, status, priority);`,
  );
  db.exec(`
    CREATE TABLE IF NOT EXISTS governance_jobs (
      id TEXT PRIMARY KEY,
      kb_id TEXT NOT NULL,
      job_type TEXT NOT NULL,
      status TEXT NOT NULL,
      priority INTEGER DEFAULT 0,
      attempts INTEGER DEFAULT 0,
      max_attempts INTEGER DEFAULT 3,
      payload TEXT,
      last_error TEXT,
      scheduled_at INTEGER,
      started_at INTEGER,
      finished_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_gov_job_pick ON governance_jobs(status, priority, scheduled_at);`,
  );
  db.exec(`
    CREATE TABLE IF NOT EXISTS governance_annotations (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      expert_id TEXT NOT NULL,
      action TEXT NOT NULL,
      comment TEXT,
      expert_weight REAL DEFAULT 1.0,
      verification_level TEXT,
      created_at INTEGER NOT NULL
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_gov_anno_task ON governance_annotations(task_id);`);
  db.exec(`
    CREATE TABLE IF NOT EXISTS governance_expert_authority (
      expert_id TEXT PRIMARY KEY,
      domain_scope TEXT,
      expert_weight REAL DEFAULT 1.0,
      verification_level TEXT,
      granted_by TEXT,
      created_at INTEGER NOT NULL
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS claims (
      id TEXT PRIMARY KEY,
      kb_id TEXT NOT NULL,
      chunk_id TEXT NOT NULL,
      subject TEXT NOT NULL,
      predicate TEXT,
      object_value TEXT NOT NULL,
      normalized_key TEXT NOT NULL,
      claim_text TEXT NOT NULL,
      extraction_method TEXT NOT NULL DEFAULT 'heuristic',
      governance_status TEXT DEFAULT 'pending',
      conflict_group_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_claims_kb ON claims(kb_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_claims_chunk ON claims(chunk_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_claims_norm ON claims(kb_id, normalized_key);`);
  db.exec(`
    CREATE TABLE IF NOT EXISTS claim_relations (
      id TEXT PRIMARY KEY,
      kb_id TEXT NOT NULL,
      from_claim TEXT NOT NULL,
      to_claim TEXT NOT NULL,
      relation_type TEXT NOT NULL,
      weight REAL,
      created_at INTEGER NOT NULL,
      CHECK (relation_type IN ('duplicate','conflict','supports','reference'))
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_claim_rel_kb ON claim_relations(kb_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_claim_rel_from ON claim_relations(from_claim);`);
  db.exec(`
    CREATE TABLE IF NOT EXISTS governance_llm_usage (
      kb_id TEXT PRIMARY KEY,
      llm_call_count INTEGER NOT NULL DEFAULT 0,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      credits_charged REAL NOT NULL DEFAULT 0,
      last_call_at INTEGER,
      updated_at INTEGER NOT NULL
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${KB_LINEAGE_TABLE} (
      lineage_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      deliverable_id TEXT,
      session_key TEXT,
      message_id TEXT,
      agent_id TEXT,
      task_id TEXT,
      group_id TEXT,
      generation_prompt_hash TEXT,
      source_chunk_ids TEXT,
      source_kb_ids TEXT,
      source_agent_ids TEXT,
      source_task_ids TEXT,
      source_relation_ids TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY(lineage_id, kind),
      CHECK (kind IN ('generation','commit'))
    );
  `);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_knowledge_lineage_deliverable ON ${KB_LINEAGE_TABLE}(deliverable_id);`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_knowledge_lineage_session ON ${KB_LINEAGE_TABLE}(session_key, message_id);`,
  );
}

export function ensureKnowledgeVectorTable(db: DatabaseSync, dimensions: number): void {
  const row = db.prepare(`SELECT value FROM meta WHERE key = 'vector_dims'`).get() as
    | { value: string }
    | undefined;
  const existingDims = row ? Number.parseInt(row.value, 10) : null;
  if (existingDims === dimensions) {
    return;
  }
  if (existingDims && existingDims !== dimensions) {
    try {
      db.exec(`DROP TABLE IF EXISTS ${KB_VECTOR_TABLE}`);
    } catch {
      // best-effort reset when embedding dimensions change
    }
  }
  db.exec(
    `CREATE VIRTUAL TABLE IF NOT EXISTS ${KB_VECTOR_TABLE} USING vec0(\n` +
      `  id TEXT PRIMARY KEY,\n` +
      `  embedding FLOAT[${dimensions}]\n` +
      `)`,
  );
  db.prepare(
    `INSERT INTO meta (key, value) VALUES ('vector_dims', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(String(dimensions));
}
