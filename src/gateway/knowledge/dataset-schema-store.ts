import type { DatabaseSync } from "node:sqlite";
import { extractDatasetSchema, type DatasetColumn, type DatasetSchema } from "./dataset-schema.js";
import { openKnowledgeIndex, resolveKnowledgeIndexDbPath } from "./kb-index.js";
import type { KnowledgeBase } from "./knowledge-base-store.js";

export type DatasetSchemaSummary = {
  docId: string;
  format: string;
  columnCount: number;
  rowCount: number;
  columns: DatasetColumn[];
  detectedAtMs: number;
};

/** Upsert a parsed dataset schema for a document. */
export function recordDatasetSchemaInIndex(
  db: DatabaseSync,
  params: { kbId: string; docId: string; schema: DatasetSchema; detectedAtMs?: number },
): void {
  db.prepare(
    `INSERT INTO dataset_schemas
       (doc_id, kb_id, format, column_count, row_count, columns_json, detected_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(kb_id, doc_id) DO UPDATE SET
       format = excluded.format,
       column_count = excluded.column_count,
       row_count = excluded.row_count,
       columns_json = excluded.columns_json,
       detected_at = excluded.detected_at`,
  ).run(
    params.docId,
    params.kbId,
    params.schema.format,
    params.schema.columnCount,
    params.schema.rowCount,
    JSON.stringify(params.schema.columns),
    params.detectedAtMs ?? Date.now(),
  );
}

function parseColumns(json: string): DatasetColumn[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(
      (entry): entry is DatasetColumn =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as DatasetColumn).name === "string",
    );
  } catch {
    return [];
  }
}

/** Per-document dataset schema rollup for the 数据集 tab, keyed by doc_id. */
export function getDatasetSchemasForKb(
  db: DatabaseSync,
  kbId: string,
): Map<string, DatasetSchemaSummary> {
  const rows = db
    .prepare(
      `SELECT doc_id, format, column_count, row_count, columns_json, detected_at
         FROM dataset_schemas
        WHERE kb_id = ?`,
    )
    .all(kbId) as Array<{
    doc_id: string;
    format: string;
    column_count: number;
    row_count: number;
    columns_json: string;
    detected_at: number;
  }>;
  const map = new Map<string, DatasetSchemaSummary>();
  for (const row of rows) {
    map.set(row.doc_id, {
      docId: row.doc_id,
      format: row.format,
      columnCount: row.column_count,
      rowCount: row.row_count,
      columns: parseColumns(row.columns_json),
      detectedAtMs: row.detected_at,
    });
  }
  return map;
}

/**
 * Parse tabular content and persist its schema for a knowledge-base document. Best-effort:
 * returns null when the content is not a recognizable dataset or the index is unavailable,
 * so callers can wrap this without risking the ingest path.
 */
export async function recordDatasetSchemaForDocument(params: {
  knowledgeBase: KnowledgeBase;
  docId: string;
  text: string;
  fileName?: string | null;
  mimeType?: string | null;
  detectedAtMs?: number;
  indexRoot?: string;
}): Promise<DatasetSchema | null> {
  const schema = extractDatasetSchema({
    text: params.text,
    fileName: params.fileName,
    mimeType: params.mimeType,
  });
  if (!schema) {
    return null;
  }
  const dbPath = resolveKnowledgeIndexDbPath({
    ownerId: params.knowledgeBase.ownerId,
    tenantId: params.knowledgeBase.tenantId,
    indexRoot: params.indexRoot,
  });
  const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
  try {
    recordDatasetSchemaInIndex(index.db, {
      kbId: params.knowledgeBase.id,
      docId: params.docId,
      schema,
      ...(params.detectedAtMs != null ? { detectedAtMs: params.detectedAtMs } : {}),
    });
  } finally {
    index.close();
  }
  return schema;
}
