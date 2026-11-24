import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { hashText } from "../../memory/internal.js";
import { loadSqliteVecExtension } from "../../memory/sqlite-vec.js";
import { requireNodeSqlite } from "../../memory/sqlite.js";
import { CONFIG_DIR } from "../../utils.js";
import {
  ensureKnowledgeIndexSchema,
  ensureKnowledgeVectorTable,
  KB_CHUNKS_TABLE,
  KB_CHUNK_META_TABLE,
  KB_FTS_TABLE,
  KB_VECTOR_TABLE,
} from "./kb-index-schema.js";
import { invalidateKnowledgeSourceBundleCache } from "./source-bundle-cache.js";

function noteKnowledgeIndexMutation(): void {
  invalidateKnowledgeSourceBundleCache();
}

export type KnowledgeDocumentRecord = {
  docId: string;
  kbId: string;
  title: string;
  currentVersionId: string | null;
  contentType: string | null;
  createdAt: number;
  updatedAt: number;
};

export type KnowledgeDocumentVersionRecord = {
  versionId: string;
  docId: string;
  versionLabel: string;
  rawHash: string;
  semanticHash: string;
  publishedAt: number;
  createdAt: number;
};

export type KnowledgeChunkInsert = {
  id: string;
  text: string;
  model: string;
  kbId: string;
  docId: string;
  versionId: string;
  heading: string | null;
  section: string | null;
  startLine: number;
  endLine: number;
  visibility: string | null;
  source: string | null;
  embedding?: number[];
};

export type KnowledgeIndex = {
  db: DatabaseSync;
  dbPath: string;
  ftsAvailable: boolean;
  vectorAvailable: boolean;
  vectorLoadError?: string;
  close: () => void;
};

const DEFAULT_INDEX_ROOT = path.join(CONFIG_DIR, "knowledge", "index");

function sanitizeIndexKey(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "unknown";
  }
  return trimmed.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

export function resolveKnowledgeIndexDbPath(params: {
  ownerId: string;
  tenantId: string | null;
  indexRoot?: string;
}): string {
  const root = params.indexRoot ?? DEFAULT_INDEX_ROOT;
  if (params.tenantId) {
    return path.join(root, "tenant", `${sanitizeIndexKey(params.tenantId)}.db`);
  }
  return path.join(root, "personal", `${sanitizeIndexKey(params.ownerId)}.db`);
}

export async function openKnowledgeIndex(params: {
  dbPath: string;
  ftsEnabled?: boolean;
  vectorEnabled?: boolean;
  vectorExtensionPath?: string;
}): Promise<KnowledgeIndex> {
  fs.mkdirSync(path.dirname(params.dbPath), { recursive: true });
  const vectorEnabled = params.vectorEnabled !== false;
  const { DatabaseSync } = requireNodeSqlite();
  const db = new DatabaseSync(params.dbPath, { allowExtension: vectorEnabled });
  db.exec("PRAGMA busy_timeout = 5000");

  const schema = ensureKnowledgeIndexSchema({ db, ftsEnabled: params.ftsEnabled });
  let vectorAvailable = false;
  let vectorLoadError: string | undefined;
  if (vectorEnabled) {
    const loaded = await loadSqliteVecExtension({
      db,
      extensionPath: params.vectorExtensionPath,
    });
    vectorAvailable = loaded.ok;
    vectorLoadError = loaded.error;
  }

  return {
    db,
    dbPath: params.dbPath,
    ftsAvailable: schema.ftsAvailable,
    vectorAvailable,
    ...(vectorLoadError ? { vectorLoadError } : undefined),
    close: () => {
      db.close();
    },
  };
}

export function getKnowledgeDocument(
  db: DatabaseSync,
  docId: string,
): KnowledgeDocumentRecord | null {
  const row = db
    .prepare(
      `SELECT doc_id, kb_id, title, current_version_id, content_type, created_at, updated_at
       FROM documents WHERE doc_id = ?`,
    )
    .get(docId) as
    | {
        doc_id: string;
        kb_id: string;
        title: string;
        current_version_id: string | null;
        content_type: string | null;
        created_at: number;
        updated_at: number;
      }
    | undefined;
  if (!row) {
    return null;
  }
  return {
    docId: row.doc_id,
    kbId: row.kb_id,
    title: row.title,
    currentVersionId: row.current_version_id,
    contentType: row.content_type,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getKnowledgeDocumentVersion(
  db: DatabaseSync,
  versionId: string,
): KnowledgeDocumentVersionRecord | null {
  const row = db
    .prepare(
      `SELECT version_id, doc_id, version_label, raw_hash, semantic_hash, published_at, created_at
       FROM document_versions WHERE version_id = ?`,
    )
    .get(versionId) as
    | {
        version_id: string;
        doc_id: string;
        version_label: string;
        raw_hash: string;
        semantic_hash: string;
        published_at: number;
        created_at: number;
      }
    | undefined;
  if (!row) {
    return null;
  }
  return {
    versionId: row.version_id,
    docId: row.doc_id,
    versionLabel: row.version_label,
    rawHash: row.raw_hash,
    semanticHash: row.semantic_hash,
    publishedAt: row.published_at,
    createdAt: row.created_at,
  };
}

export function getLatestKnowledgeDocumentVersion(
  db: DatabaseSync,
  docId: string,
): KnowledgeDocumentVersionRecord | null {
  const row = db
    .prepare(
      `SELECT version_id, doc_id, version_label, raw_hash, semantic_hash, published_at, created_at
       FROM document_versions
       WHERE doc_id = ?
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .get(docId) as
    | {
        version_id: string;
        doc_id: string;
        version_label: string;
        raw_hash: string;
        semantic_hash: string;
        published_at: number;
        created_at: number;
      }
    | undefined;
  if (!row) {
    return null;
  }
  return {
    versionId: row.version_id,
    docId: row.doc_id,
    versionLabel: row.version_label,
    rawHash: row.raw_hash,
    semanticHash: row.semantic_hash,
    publishedAt: row.published_at,
    createdAt: row.created_at,
  };
}

export function listKnowledgeDocumentVersions(
  db: DatabaseSync,
  docId: string,
): KnowledgeDocumentVersionRecord[] {
  const rows = db
    .prepare(
      `SELECT version_id, doc_id, version_label, raw_hash, semantic_hash, published_at, created_at
       FROM document_versions
       WHERE doc_id = ?
       ORDER BY created_at ASC`,
    )
    .all(docId) as Array<{
    version_id: string;
    doc_id: string;
    version_label: string;
    raw_hash: string;
    semantic_hash: string;
    published_at: number;
    created_at: number;
  }>;
  return rows.map((row) => ({
    versionId: row.version_id,
    docId: row.doc_id,
    versionLabel: row.version_label,
    rawHash: row.raw_hash,
    semanticHash: row.semantic_hash,
    publishedAt: row.published_at,
    createdAt: row.created_at,
  }));
}

export function countKnowledgeDocumentVersions(db: DatabaseSync, docId: string): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS count FROM document_versions WHERE doc_id = ?`)
    .get(docId) as { count: number };
  return row.count;
}

/** Host-owned token for manual writes delayed across source deletion/reconstruction. */
export function knowledgeDocumentGeneration(db: DatabaseSync, docId: string): number {
  db.exec(
    "CREATE TABLE IF NOT EXISTS knowledge_document_generations(doc_id TEXT PRIMARY KEY,generation INTEGER NOT NULL)",
  );
  return Number(
    db.prepare("SELECT generation FROM knowledge_document_generations WHERE doc_id=?").get(docId)
      ?.generation ?? 0,
  );
}
function advanceKnowledgeDocumentGeneration(db: DatabaseSync, docId: string): void {
  knowledgeDocumentGeneration(db, docId);
  db.prepare(
    "INSERT INTO knowledge_document_generations VALUES(?,1) ON CONFLICT(doc_id) DO UPDATE SET generation=generation+1",
  ).run(docId);
}

export function upsertKnowledgeDocument(params: {
  db: DatabaseSync;
  docId: string;
  kbId: string;
  title: string;
  contentType: string | null;
  currentVersionId?: string | null;
  now?: number;
}): KnowledgeDocumentRecord {
  advanceKnowledgeDocumentGeneration(params.db, params.docId);
  const now = params.now ?? Date.now();
  const existing = getKnowledgeDocument(params.db, params.docId);
  params.db
    .prepare(
      `INSERT INTO documents (doc_id, kb_id, title, current_version_id, content_type, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(doc_id) DO UPDATE SET
         kb_id = excluded.kb_id,
         title = excluded.title,
         content_type = excluded.content_type,
         current_version_id = COALESCE(excluded.current_version_id, documents.current_version_id),
         updated_at = excluded.updated_at`,
    )
    .run(
      params.docId,
      params.kbId,
      params.title,
      params.currentVersionId ?? existing?.currentVersionId ?? null,
      params.contentType,
      existing?.createdAt ?? now,
      now,
    );
  noteKnowledgeIndexMutation();
  return getKnowledgeDocument(params.db, params.docId)!;
}

export function insertKnowledgeDocumentVersion(params: {
  db: DatabaseSync;
  versionId: string;
  docId: string;
  versionLabel: string;
  rawHash: string;
  semanticHash: string;
  publishedAt?: number;
  now?: number;
}): KnowledgeDocumentVersionRecord {
  const now = params.now ?? Date.now();
  const publishedAt = params.publishedAt ?? now;
  params.db
    .prepare(
      `INSERT INTO document_versions
       (version_id, doc_id, version_label, raw_hash, semantic_hash, published_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      params.versionId,
      params.docId,
      params.versionLabel,
      params.rawHash,
      params.semanticHash,
      publishedAt,
      now,
    );
  noteKnowledgeIndexMutation();
  return getKnowledgeDocumentVersion(params.db, params.versionId)!;
}

export function updateKnowledgeDocumentCurrentVersion(params: {
  db: DatabaseSync;
  docId: string;
  versionId: string;
  now?: number;
}): void {
  const now = params.now ?? Date.now();
  params.db
    .prepare(`UPDATE documents SET current_version_id = ?, updated_at = ? WHERE doc_id = ?`)
    .run(params.versionId, now, params.docId);
  noteKnowledgeIndexMutation();
}

export function updateKnowledgeDocumentVersionRawHash(params: {
  db: DatabaseSync;
  versionId: string;
  rawHash: string;
}): void {
  params.db
    .prepare(`UPDATE document_versions SET raw_hash = ? WHERE version_id = ?`)
    .run(params.rawHash, params.versionId);
  noteKnowledgeIndexMutation();
}

export function buildKnowledgeChunkId(params: {
  kbId: string;
  docId: string;
  versionId: string;
  startLine: number;
  endLine: number;
  textHash: string;
  model: string;
}): string {
  return hashText(
    `${params.kbId}\0${params.docId}\0${params.versionId}\0${params.startLine}\0${params.endLine}\0${params.textHash}\0${params.model}`,
  );
}

/**
 * P4: prefer stable anchor ids as chunk_id so partial rewrites can reuse rows.
 * Falls back to legacy versioned id when no anchor is supplied.
 */
export function resolveKnowledgeChunkId(params: {
  stableAnchorId?: string;
  kbId: string;
  docId: string;
  versionId: string;
  startLine: number;
  endLine: number;
  textHash: string;
  model: string;
}): string {
  if (params.stableAnchorId?.trim()) {
    return params.stableAnchorId.trim();
  }
  return buildKnowledgeChunkId(params);
}

const vectorToBlob = (embedding: number[]): Buffer =>
  Buffer.from(new Float32Array(embedding).buffer);

export function insertKnowledgeChunks(params: {
  index: KnowledgeIndex;
  chunks: KnowledgeChunkInsert[];
}): void {
  if (params.chunks.length === 0) {
    return;
  }

  const embeddedChunks = params.chunks.filter(
    (chunk) => chunk.embedding && chunk.embedding.length > 0,
  );
  if (embeddedChunks.length > 0 && params.index.vectorAvailable) {
    ensureKnowledgeVectorTable(params.index.db, embeddedChunks[0].embedding!.length);
  }

  const insertChunk = params.index.db.prepare(
    `INSERT INTO ${KB_CHUNKS_TABLE} (id, text, model) VALUES (?, ?, ?)`,
  );
  const insertMeta = params.index.db.prepare(
    `INSERT INTO ${KB_CHUNK_META_TABLE}
     (chunk_id, kb_id, doc_id, version_id, heading, section, start_line, end_line, visibility, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertFts = params.index.ftsAvailable
    ? params.index.db.prepare(`INSERT INTO ${KB_FTS_TABLE} (text, id, model) VALUES (?, ?, ?)`)
    : null;
  const insertVector =
    params.index.vectorAvailable && embeddedChunks.length > 0
      ? params.index.db.prepare(`INSERT INTO ${KB_VECTOR_TABLE} (id, embedding) VALUES (?, ?)`)
      : null;

  params.index.db.exec("BEGIN IMMEDIATE");
  try {
    for (const chunk of params.chunks) {
      insertChunk.run(chunk.id, chunk.text, chunk.model);
      insertMeta.run(
        chunk.id,
        chunk.kbId,
        chunk.docId,
        chunk.versionId,
        chunk.heading,
        chunk.section,
        chunk.startLine,
        chunk.endLine,
        chunk.visibility,
        chunk.source,
      );
      insertFts?.run(chunk.text, chunk.id, chunk.model);
      if (insertVector && chunk.embedding && chunk.embedding.length > 0) {
        insertVector.run(chunk.id, vectorToBlob(chunk.embedding));
      }
    }
    params.index.db.exec("COMMIT");
  } catch (err) {
    try {
      params.index.db.exec("ROLLBACK");
    } catch {
      // ignore rollback failure after primary error
    }
    throw err;
  }
  noteKnowledgeIndexMutation();
}

export function listKnowledgeChunkMetaForVersion(params: {
  db: DatabaseSync;
  docId: string;
  versionId: string;
  includeArchived?: boolean;
}): Array<{
  chunkId: string;
  heading: string | null;
  section: string | null;
  startLine: number;
  endLine: number;
}> {
  const rows = params.db
    .prepare(
      `SELECT chunk_id, heading, section, start_line, end_line
       FROM ${KB_CHUNK_META_TABLE}
       WHERE doc_id = ? AND version_id = ? AND (? = 1 OR chunk_id NOT LIKE 'history:%')
       ORDER BY start_line ASC`,
    )
    .all(params.docId, params.versionId, params.includeArchived === true ? 1 : 0) as Array<{
    chunk_id: string;
    heading: string | null;
    section: string | null;
    start_line: number;
    end_line: number;
  }>;
  return rows.map((row) => ({
    chunkId: row.chunk_id,
    heading: row.heading,
    section: row.section,
    startLine: row.start_line,
    endLine: row.end_line,
  }));
}

/** Full chunk rows for a document version (text + meta) — used by P4 chunk delta. */
export function listKnowledgeChunksForVersion(params: {
  db: DatabaseSync;
  docId: string;
  versionId: string;
  includeArchived?: boolean;
}): Array<{
  chunkId: string;
  text: string;
  model: string;
  heading: string | null;
  section: string | null;
  startLine: number;
  endLine: number;
}> {
  const rows = params.db
    .prepare(
      `SELECT m.chunk_id, c.text, c.model, m.heading, m.section, m.start_line, m.end_line
       FROM ${KB_CHUNK_META_TABLE} m
       JOIN ${KB_CHUNKS_TABLE} c ON c.id = m.chunk_id
       WHERE m.doc_id = ? AND m.version_id = ? AND (? = 1 OR m.chunk_id NOT LIKE 'history:%')
       ORDER BY m.start_line ASC`,
    )
    .all(params.docId, params.versionId, params.includeArchived === true ? 1 : 0) as Array<{
    chunk_id: string;
    text: string;
    model: string;
    heading: string | null;
    section: string | null;
    start_line: number;
    end_line: number;
  }>;
  return rows.map((row) => ({
    chunkId: row.chunk_id,
    text: row.text,
    model: row.model,
    heading: row.heading,
    section: row.section,
    startLine: row.start_line,
    endLine: row.end_line,
  }));
}

/** Delete selected chunks (and governance/vector/fts) without dropping the document. */
export function deleteKnowledgeChunksByIds(params: {
  db: DatabaseSync;
  index: KnowledgeIndex;
  chunkIds: string[];
}): void {
  if (params.chunkIds.length === 0) {
    return;
  }
  const deleteChunkMeta = params.db.prepare(
    `DELETE FROM ${KB_CHUNK_META_TABLE} WHERE chunk_id = ?`,
  );
  const deleteChunks = params.db.prepare(`DELETE FROM ${KB_CHUNKS_TABLE} WHERE id = ?`);
  const deleteFts = params.index.ftsAvailable
    ? params.db.prepare(`DELETE FROM ${KB_FTS_TABLE} WHERE id = ?`)
    : null;
  const deleteVec = params.index.vectorAvailable
    ? params.db.prepare(`DELETE FROM ${KB_VECTOR_TABLE} WHERE id = ?`)
    : null;
  const deleteChunkGov = params.db.prepare(`DELETE FROM chunk_governance WHERE chunk_id = ?`);
  const deleteClaims = params.db.prepare(`DELETE FROM claims WHERE chunk_id = ?`);
  const deleteChunkRelationsFrom = params.db.prepare(
    `DELETE FROM chunk_relations WHERE from_chunk = ? OR to_chunk = ?`,
  );

  params.db.exec("BEGIN IMMEDIATE");
  try {
    for (const chunkId of params.chunkIds) {
      deleteChunkMeta.run(chunkId);
      deleteChunks.run(chunkId);
      deleteFts?.run(chunkId);
      deleteVec?.run(chunkId);
      deleteChunkGov.run(chunkId);
      deleteClaims.run(chunkId);
      deleteChunkRelationsFrom.run(chunkId, chunkId);
    }
    params.db.exec("COMMIT");
  } catch (error) {
    try {
      params.db.exec("ROLLBACK");
    } catch {
      // ignore
    }
    throw error;
  }
  noteKnowledgeIndexMutation();
}

/**
 * Upsert chunk rows (replace text/meta/fts/vector) and retarget version_id.
 * Used for keep (meta-only retarget) and update (full rewrite) paths.
 */
export function upsertKnowledgeChunks(params: {
  index: KnowledgeIndex;
  chunks: KnowledgeChunkInsert[];
  /** Background embeddings may update existing current chunks, never recreate deleted identities. */
  existingOnly?: boolean;
}): number {
  if (params.chunks.length === 0) {
    return 0;
  }
  const embeddedChunks = params.chunks.filter(
    (chunk) => chunk.embedding && chunk.embedding.length > 0,
  );
  if (embeddedChunks.length > 0 && params.index.vectorAvailable) {
    ensureKnowledgeVectorTable(params.index.db, embeddedChunks[0].embedding!.length);
  }

  const upsertChunk = params.index.db.prepare(
    `INSERT INTO ${KB_CHUNKS_TABLE} (id, text, model) VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET text = excluded.text, model = excluded.model`,
  );
  const upsertMeta = params.index.db.prepare(
    `INSERT INTO ${KB_CHUNK_META_TABLE}
     (chunk_id, kb_id, doc_id, version_id, heading, section, start_line, end_line, visibility, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(chunk_id) DO UPDATE SET
       kb_id = excluded.kb_id,
       doc_id = excluded.doc_id,
       version_id = excluded.version_id,
       heading = excluded.heading,
       section = excluded.section,
       start_line = excluded.start_line,
       end_line = excluded.end_line,
       visibility = excluded.visibility,
       source = excluded.source`,
  );
  const deleteFts = params.index.ftsAvailable
    ? params.index.db.prepare(`DELETE FROM ${KB_FTS_TABLE} WHERE id = ?`)
    : null;
  const insertFts = params.index.ftsAvailable
    ? params.index.db.prepare(`INSERT INTO ${KB_FTS_TABLE} (text, id, model) VALUES (?, ?, ?)`)
    : null;
  // Do not prepare vec DELETE when no vectors will be written — sqlite prepare fails if
  // chunks_vec was never created (FTS-only / embedding-degraded ingest).
  const deleteVec =
    params.index.vectorAvailable && embeddedChunks.length > 0
      ? params.index.db.prepare(`DELETE FROM ${KB_VECTOR_TABLE} WHERE id = ?`)
      : null;
  const insertVector =
    params.index.vectorAvailable && embeddedChunks.length > 0
      ? params.index.db.prepare(`INSERT INTO ${KB_VECTOR_TABLE} (id, embedding) VALUES (?, ?)`)
      : null;

  const currentChunk = params.existingOnly
    ? params.index.db.prepare(
        `SELECT 1 FROM ${KB_CHUNK_META_TABLE} m JOIN documents d ON d.doc_id = m.doc_id
     WHERE m.chunk_id = ? AND m.doc_id = ? AND m.version_id = ? AND m.kb_id = ? AND d.current_version_id = m.version_id`,
      )
    : null;
  let written = 0;
  params.index.db.exec("BEGIN IMMEDIATE");
  try {
    for (const chunk of params.chunks) {
      if (currentChunk && !currentChunk.get(chunk.id, chunk.docId, chunk.versionId, chunk.kbId)) {
        continue;
      }
      written += 1;
      upsertChunk.run(chunk.id, chunk.text, chunk.model);
      upsertMeta.run(
        chunk.id,
        chunk.kbId,
        chunk.docId,
        chunk.versionId,
        chunk.heading,
        chunk.section,
        chunk.startLine,
        chunk.endLine,
        chunk.visibility,
        chunk.source,
      );
      if (insertFts) {
        deleteFts?.run(chunk.id);
        insertFts.run(chunk.text, chunk.id, chunk.model);
      }
      if (insertVector && chunk.embedding && chunk.embedding.length > 0) {
        deleteVec?.run(chunk.id);
        insertVector.run(chunk.id, vectorToBlob(chunk.embedding));
      } else if (deleteVec && !chunk.embedding) {
        // keep existing vector when embedding not provided (keep path)
      }
    }
    params.index.db.exec("COMMIT");
  } catch (error) {
    try {
      params.index.db.exec("ROLLBACK");
    } catch {
      // ignore
    }
    throw error;
  }
  noteKnowledgeIndexMutation();
  return written;
}

/** Remove only this KB's derivative manual metadata, keeping the shared tenant index. */
export function deleteKnowledgeBaseRetrievalSummaries(db: DatabaseSync, kbId: string): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec("CREATE TABLE IF NOT EXISTS retrieval_summary_deleted_bases(kb_id TEXT PRIMARY KEY)");
    db.prepare("INSERT OR IGNORE INTO retrieval_summary_deleted_bases(kb_id) VALUES(?)").run(kbId);

    if (db.prepare("SELECT 1 FROM sqlite_master WHERE name='documents'").get()) {
      for (const row of db.prepare("SELECT doc_id FROM documents WHERE kb_id=?").all(kbId)) {
        advanceKnowledgeDocumentGeneration(db, String(row.doc_id));
      }
    }
    // Remove legacy section caches if an earlier opt-in build created them.
    for (const table of ["retrieval_summary_sections"]) {
      if (db.prepare("SELECT 1 FROM sqlite_master WHERE name=?").get(table)) {
        db.prepare(
          `DELETE FROM ${table} WHERE doc_id IN (SELECT doc_id FROM documents WHERE kb_id=?)`,
        ).run(kbId);
      }
    }
    for (const table of ["retrieval_summaries", "retrieval_summary_fts"]) {
      if (db.prepare("SELECT 1 FROM sqlite_master WHERE name=?").get(table)) {
        db.prepare(`DELETE FROM ${table} WHERE kb_id=?`).run(kbId);
      }
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function deleteKnowledgeDocumentFromIndex(params: {
  db: DatabaseSync;
  index: KnowledgeIndex;
  docId: string;
}): { ok: true; removedChunkIds: string[] } {
  const chunkIds = params.db
    .prepare(`SELECT chunk_id FROM ${KB_CHUNK_META_TABLE} WHERE doc_id = ?`)
    .all(params.docId) as Array<{ chunk_id: string }>;
  const removedChunkIds = chunkIds.map((row) => row.chunk_id);

  params.db.exec("BEGIN IMMEDIATE");
  try {
    advanceKnowledgeDocumentGeneration(params.db, params.docId);

    for (const table of [
      "retrieval_summaries",
      "retrieval_summary_fts",
      "retrieval_summary_sections",
    ]) {
      if (params.db.prepare("SELECT 1 FROM sqlite_master WHERE name=?").get(table)) {
        params.db.prepare(`DELETE FROM ${table} WHERE doc_id=?`).run(params.docId);
      }
    }
    if (removedChunkIds.length > 0) {
      const deleteChunkMeta = params.db.prepare(
        `DELETE FROM ${KB_CHUNK_META_TABLE} WHERE chunk_id = ?`,
      );
      const deleteChunks = params.db.prepare(`DELETE FROM ${KB_CHUNKS_TABLE} WHERE id = ?`);
      const deleteFts = params.index.ftsAvailable
        ? params.db.prepare(`DELETE FROM ${KB_FTS_TABLE} WHERE id = ?`)
        : null;
      const deleteVec = params.index.vectorAvailable
        ? params.db.prepare(`DELETE FROM ${KB_VECTOR_TABLE} WHERE id = ?`)
        : null;
      const deleteChunkGov = params.db.prepare(`DELETE FROM chunk_governance WHERE chunk_id = ?`);
      const deleteClaims = params.db.prepare(`DELETE FROM claims WHERE chunk_id = ?`);
      const deleteChunkRelationsFrom = params.db.prepare(
        `DELETE FROM chunk_relations WHERE from_chunk = ? OR to_chunk = ?`,
      );

      for (const chunkId of removedChunkIds) {
        deleteChunkMeta.run(chunkId);
        deleteChunks.run(chunkId);
        deleteFts?.run(chunkId);
        deleteVec?.run(chunkId);
        deleteChunkGov.run(chunkId);
        deleteClaims.run(chunkId);
        deleteChunkRelationsFrom.run(chunkId, chunkId);
      }
    }

    params.db.prepare(`DELETE FROM document_versions WHERE doc_id = ?`).run(params.docId);
    params.db.prepare(`DELETE FROM documents WHERE doc_id = ?`).run(params.docId);
    params.db.prepare(`DELETE FROM dataset_schemas WHERE doc_id = ?`).run(params.docId);
    params.db.prepare(`DELETE FROM web_source_snapshots WHERE doc_id = ?`).run(params.docId);
    params.db.prepare(`DELETE FROM web_source_refresh WHERE doc_id = ?`).run(params.docId);

    params.db.exec("COMMIT");
    noteKnowledgeIndexMutation();
    return { ok: true, removedChunkIds };
  } catch (error) {
    try {
      params.db.exec("ROLLBACK");
    } catch {
      // ignore rollback failure after primary error
    }
    throw error;
  }
}

export function getKnowledgeChunkText(db: DatabaseSync, chunkId: string): string | null {
  const row = db.prepare(`SELECT text FROM ${KB_CHUNKS_TABLE} WHERE id = ?`).get(chunkId) as
    | { text: string }
    | undefined;
  return row?.text ?? null;
}

export function knowledgeBaseHasIndexedChunks(db: DatabaseSync, kbId: string): boolean {
  const row = db
    .prepare(`SELECT 1 AS ok FROM ${KB_CHUNK_META_TABLE} WHERE kb_id = ? LIMIT 1`)
    .get(kbId) as { ok: number } | undefined;
  return Boolean(row);
}

function knowledgeVectorTableExists(db: DatabaseSync): boolean {
  const row = db
    .prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`)
    .get(KB_VECTOR_TABLE) as { ok: number } | undefined;
  return Boolean(row);
}

/** Chunks that have FTS/text but no sqlite-vec row — background vectorize work. */
export function listKnowledgeChunksMissingVectors(params: {
  db: DatabaseSync;
  docId: string;
  versionId: string;
}): Array<{
  chunkId: string;
  text: string;
  model: string;
  kbId: string;
  heading: string | null;
  section: string | null;
  startLine: number;
  endLine: number;
  visibility: string | null;
  source: string | null;
}> {
  const rows = knowledgeVectorTableExists(params.db)
    ? (params.db
        .prepare(
          `SELECT m.chunk_id, c.text, c.model, m.kb_id, m.heading, m.section,
                  m.start_line, m.end_line, m.visibility, m.source
             FROM ${KB_CHUNK_META_TABLE} m
             JOIN ${KB_CHUNKS_TABLE} c ON c.id = m.chunk_id
             LEFT JOIN ${KB_VECTOR_TABLE} v ON v.id = m.chunk_id
            WHERE m.doc_id = ? AND m.version_id = ? AND v.id IS NULL
            ORDER BY m.start_line ASC`,
        )
        .all(params.docId, params.versionId) as Array<{
        chunk_id: string;
        text: string;
        model: string;
        kb_id: string;
        heading: string | null;
        section: string | null;
        start_line: number;
        end_line: number;
        visibility: string | null;
        source: string | null;
      }>)
    : (params.db
        .prepare(
          `SELECT m.chunk_id, c.text, c.model, m.kb_id, m.heading, m.section,
                  m.start_line, m.end_line, m.visibility, m.source
             FROM ${KB_CHUNK_META_TABLE} m
             JOIN ${KB_CHUNKS_TABLE} c ON c.id = m.chunk_id
            WHERE m.doc_id = ? AND m.version_id = ?
            ORDER BY m.start_line ASC`,
        )
        .all(params.docId, params.versionId) as Array<{
        chunk_id: string;
        text: string;
        model: string;
        kb_id: string;
        heading: string | null;
        section: string | null;
        start_line: number;
        end_line: number;
        visibility: string | null;
        source: string | null;
      }>);
  return rows.map((row) => ({
    chunkId: row.chunk_id,
    text: row.text,
    model: row.model,
    kbId: row.kb_id,
    heading: row.heading,
    section: row.section,
    startLine: row.start_line,
    endLine: row.end_line,
    visibility: row.visibility,
    source: row.source,
  }));
}
