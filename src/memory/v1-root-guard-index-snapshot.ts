import type { DatabaseSync } from "node:sqlite";

export type IndexDataSnapshot = {
  files: Array<{ path: string }>;
  chunks: Array<{ id: string }>;
  cache: Array<{ hash: string }>;
  vec: Array<{ id: string }>;
  fts: Array<{ id: string }>;
  meta: Array<{ key: string; value: string }>;
};

export function seedIndexRows(db: DatabaseSync): void {
  db.prepare(
    `INSERT OR REPLACE INTO files (path, source, hash, mtime, size) VALUES (?, ?, ?, ?, ?)`,
  ).run("keep.md", "memory", "hash-keep", Date.now(), 12);
  db.prepare(
    `INSERT OR REPLACE INTO files (path, source, hash, mtime, size) VALUES (?, ?, ?, ?, ?)`,
  ).run("stale.md", "memory", "hash-stale", Date.now(), 8);
  db.prepare(
    `INSERT OR REPLACE INTO chunks (id, path, source, start_line, end_line, hash, model, text, embedding, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "chunk-keep",
    "keep.md",
    "memory",
    1,
    1,
    "hash-keep",
    "mock-embed",
    "keep unique zebra",
    "[]",
    Date.now(),
  );
  db.prepare(
    `INSERT OR REPLACE INTO embedding_cache (provider, model, provider_key, hash, embedding, dims, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run("openai", "mock-embed", "k", "old-1", "[]", 3, 1);
  db.prepare(
    `INSERT OR REPLACE INTO embedding_cache (provider, model, provider_key, hash, embedding, dims, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run("openai", "mock-embed", "k", "old-2", "[]", 3, 2);
  db.exec(`CREATE TABLE IF NOT EXISTS chunks_vec (id TEXT PRIMARY KEY)`);
  db.prepare(`INSERT OR REPLACE INTO chunks_vec (id) VALUES (?)`).run("vec-keep");
  db.exec(
    `CREATE TABLE IF NOT EXISTS chunks_fts (text TEXT, id TEXT, path TEXT, source TEXT, model TEXT)`,
  );
  db.prepare(`INSERT INTO chunks_fts (text, id, path, source, model) VALUES (?, ?, ?, ?, ?)`).run(
    "keep unique zebra",
    "chunk-keep",
    "keep.md",
    "memory",
    "mock-embed",
  );
  db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`).run(
    "memory_index_meta_v1",
    JSON.stringify({ model: "mock-embed", provider: "openai" }),
  );
}

export function snapshotIndexData(db: DatabaseSync): IndexDataSnapshot {
  const files = db.prepare(`SELECT path FROM files ORDER BY path`).all() as Array<{ path: string }>;
  const chunks = db.prepare(`SELECT id FROM chunks ORDER BY id`).all() as Array<{ id: string }>;
  const cache = db.prepare(`SELECT hash FROM embedding_cache ORDER BY hash`).all() as Array<{
    hash: string;
  }>;
  const vec = db.prepare(`SELECT id FROM chunks_vec ORDER BY id`).all() as Array<{ id: string }>;
  const fts = db.prepare(`SELECT id FROM chunks_fts ORDER BY id`).all() as Array<{ id: string }>;
  const meta = db.prepare(`SELECT key, value FROM meta ORDER BY key`).all() as Array<{
    key: string;
    value: string;
  }>;
  return { files, chunks, cache, vec, fts, meta };
}
