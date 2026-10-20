/**
 * Phase 1B item 4: dark memory schema v2 DDL in the same release unit as
 * the accepted write switch. Production writes stay on v1. This module is
 * not imported by manager-sync-ops or memory-schema.
 *
 * Does not enable schema v2, Resolver write switch, or LIVE deploy.
 */

export const SCHEMA_V2_RELEASE_UNIT = "memory-schema-v2";
export const SCHEMA_V2_ENABLED = false;
export const SCHEMA_V2_VERSION = 2;

/**
 * workspace_id stores the Workspace Envelope resourceId.
 * Never use agentId as the partition identity.
 */
export const FILES_V2_DDL = `CREATE TABLE files_v2 (
  workspace_id TEXT NOT NULL,
  source TEXT NOT NULL,
  path TEXT NOT NULL,
  content_id TEXT NOT NULL,
  hash TEXT NOT NULL,
  mtime INTEGER NOT NULL,
  size INTEGER NOT NULL,
  index_state TEXT NOT NULL,
  PRIMARY KEY (workspace_id, source, path)
)`;

export const CHUNKS_V2_DDL = `CREATE TABLE chunks_v2 (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  source TEXT NOT NULL,
  path TEXT NOT NULL,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  hash TEXT NOT NULL,
  model TEXT NOT NULL,
  text TEXT NOT NULL,
  embedding TEXT NOT NULL,
  updated_at INTEGER NOT NULL
)`;

export const CHUNKS_V2_INDEX_DDL = `CREATE INDEX idx_chunks_v2_workspace_source_path
  ON chunks_v2(workspace_id, source, path)`;

export type SchemaV2Database = {
  exec(sql: string): unknown;
};

export type EnsureMemorySchemaV2Result =
  | { applied: false; reason: "schema_v2_write_path_closed" }
  | { applied: true };

export function ensureMemorySchemaV2(_params: {
  db: SchemaV2Database;
}): EnsureMemorySchemaV2Result {
  return { applied: false, reason: "schema_v2_write_path_closed" };
}
