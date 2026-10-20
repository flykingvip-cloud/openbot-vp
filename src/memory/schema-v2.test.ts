import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ensureMemoryIndexSchema } from "./memory-schema.js";
import {
  CHUNKS_V2_DDL,
  FILES_V2_DDL,
  SCHEMA_V2_ENABLED,
  SCHEMA_V2_RELEASE_UNIT,
  ensureMemorySchemaV2,
} from "./schema-v2.js";

const MEMORY_DIR = path.dirname(fileURLToPath(import.meta.url));

describe("schema v2 dark prepare", () => {
  it("keeps files_v2 DDL ready and the write path closed", () => {
    expect(SCHEMA_V2_ENABLED).toBe(false);
    expect(SCHEMA_V2_RELEASE_UNIT).toBe("memory-schema-v2");
    expect(FILES_V2_DDL).toMatch(/CREATE TABLE files_v2\b/);
    expect(FILES_V2_DDL).toMatch(/\bworkspace_id TEXT NOT NULL\b/);
    expect(CHUNKS_V2_DDL).toMatch(/CREATE TABLE chunks_v2\b/);
    expect(CHUNKS_V2_DDL).toMatch(/\bworkspace_id TEXT NOT NULL\b/);
  });

  it("does not create v2 tables when ensureMemorySchemaV2 is called", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "schema-v2-"));
    const db = new DatabaseSync(path.join(dir, "memory.sqlite"));
    const result = ensureMemorySchemaV2({ db });
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>;
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
    expect(result).toEqual({ applied: false, reason: "schema_v2_write_path_closed" });
    expect(tables.map((row) => row.name)).not.toContain("files_v2");
    expect(tables.map((row) => row.name)).not.toContain("chunks_v2");
  });

  it("is not imported by the production v1 schema or sync ops", () => {
    const schema = fs.readFileSync(path.join(MEMORY_DIR, "memory-schema.ts"), "utf8");
    const syncOps = fs.readFileSync(path.join(MEMORY_DIR, "manager-sync-ops.ts"), "utf8");
    expect(schema).not.toMatch(/schema-v2/);
    expect(syncOps).not.toMatch(/schema-v2/);
    expect(syncOps).toMatch(/ensureMemoryIndexSchema/);
  });

  it("leaves v1 files table as the production schema", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "schema-v1-"));
    const db = new DatabaseSync(path.join(dir, "memory.sqlite"));
    ensureMemoryIndexSchema({
      db,
      embeddingCacheTable: "embedding_cache",
      ftsTable: "chunks_fts",
      ftsEnabled: false,
    });
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>;
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
    expect(tables.map((row) => row.name)).toContain("files");
    expect(tables.map((row) => row.name)).not.toContain("files_v2");
  });
});
