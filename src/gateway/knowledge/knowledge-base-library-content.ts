import fs from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { getPersonalSkillAssetDetail } from "../skill-lifecycle-store.js";
import { getDatasetSchemasForKb } from "./dataset-schema-store.js";
import {
  firstHumanDocumentTitle,
  isSkillAssetDocumentId,
  resolveSkillAssetIdForDocument,
} from "./document-display-title.js";
import { KB_CHUNKS_TABLE, KB_CHUNK_META_TABLE } from "./kb-index-schema.js";
import {
  getKnowledgeDocument,
  openKnowledgeIndex,
  resolveKnowledgeIndexDbPath,
} from "./kb-index.js";
import type { KnowledgeBase } from "./knowledge-base-store.js";
import { resolveKnowledgeIndexRootForBase } from "./knowledge-directory.js";
import {
  defaultSourceDocumentLinkStorePath,
  listSourceDocumentLinks,
} from "./sources/source-document-link-store.js";
import {
  getWebSourceRefreshByUrl,
  type WebSourceRefreshPolicy,
} from "./web-source-refresh-store.js";
import {
  summarizeWebSourceSnapshotsByUrl,
  type WebSourceSnapshotSummary,
} from "./web-source-snapshot-store.js";

export type KnowledgeBaseDocumentSummary = {
  docId: string;
  title: string;
  contentType: string | null;
  sourceName?: string | null;
  updatedAtMs: number;
  indexed: boolean;
  /** Number of indexed chunks belonging to this document (关联片段). */
  chunkCount?: number;
  /** Average governance trust_score (0..1) across the document's chunks (可信度); null when unscored. */
  trustScore?: number;
};

export type KnowledgeBaseSnippetSummary = {
  chunkId: string;
  docId: string;
  docTitle: string;
  heading?: string;
  section?: string;
  excerpt: string;
  updatedAtMs: number;
  /** Governance trust_score (0..1) of the chunk; omitted when unscored. */
  trustScore?: number;
  /** Governance status (pending/confirmed/merged/archived/suppressed). */
  governanceStatus?: string;
  /** Times the chunk has been retrieved/cited by agents (reference_count). */
  referenceCount?: number;
  /** Relation edges touching the chunk (duplicate/conflict/reference). */
  relationCount?: number;
};

export type KnowledgeBaseEvictedReason = "conflict" | "duplicate" | "suppressed";

export type KnowledgeBaseEvictedChunkSummary = {
  chunkId: string;
  docId: string;
  docTitle: string;
  excerpt: string;
  /** Why governance evicted the chunk: conflict group / duplicate group / suppressed. */
  reason: KnowledgeBaseEvictedReason;
  updatedAtMs: number;
};

export type KnowledgeBaseWebPageSummary = {
  docId: string;
  title: string;
  url: string;
  updatedAtMs: number;
  indexed: boolean;
  /** Number of indexed versions (change history across re-ingests). */
  versionCount?: number;
  /** Average governance freshness_score (0..1) of the page's chunks; omitted when unscored. */
  freshnessScore?: number;
  /** Latest snapshot's content-change ratio (0..1) — 内容变化率; omitted on the initial capture. */
  changeRatio?: number;
  /** Last time the page content actually changed (ms) — 最近变化. */
  lastChangedAtMs?: number;
  /** How many web snapshots were captured for this url (re-fetch count). */
  snapshotCount?: number;
  /** Auto-refresh enabled for this url (自动刷新). */
  refreshEnabled?: boolean;
  /** Auto-refresh cadence in ms. */
  refreshIntervalMs?: number;
  /** Next scheduled refresh time (ms). */
  refreshNextDueAtMs?: number;
  /** Last auto-refresh run time (ms). */
  refreshLastRefreshedAtMs?: number;
  /** Last auto-refresh outcome (initial/unchanged/changed/error). */
  refreshStatus?: string;
};

export type KnowledgeBaseDatasetSummary = {
  docId: string;
  title: string;
  contentType: string | null;
  format: string;
  updatedAtMs: number;
  indexed: boolean;
  /** Source records grouped into this dataset (记录数); set for grouped dataset imports. */
  recordCount?: number;
  /** Total indexed chunks across the dataset's records (关联片段). */
  chunkCount?: number;
  /** Average governance trust_score (0..1) across the dataset's chunks (可信度); omitted when unscored. */
  trustScore?: number;
  /** Total agent retrieval references across the dataset's chunks (引用次数). */
  referenceCount?: number;
  /** Most recent agent consumption (max chunk_governance.last_hit_at) — 最近消费; omitted when never hit. */
  lastConsumedAtMs?: number;
  /** Parsed column count from the structural schema (字段); set for tabular uploads. */
  columnCount?: number;
  /** Parsed data-row count from the structural schema (行数); set for tabular uploads. */
  rowCount?: number;
  /** Parsed column names + inferred types; set for tabular uploads. */
  columns?: Array<{ name: string; type: string }>;
};

function excerptChunkText(text: string, maxLen = 240): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLen) {
    return normalized;
  }
  return `${normalized.slice(0, maxLen - 1)}…`;
}

function looksLikeHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

function resolveWebPageUrl(params: {
  docId: string;
  title: string;
  source?: string | null;
}): string | null {
  if (params.source && looksLikeHttpUrl(params.source)) {
    return params.source.trim();
  }
  if (looksLikeHttpUrl(params.title)) {
    return params.title.trim();
  }
  if (looksLikeHttpUrl(params.docId)) {
    return params.docId.trim();
  }
  return null;
}

function isWebContentType(contentType: string | null): boolean {
  const normalized = contentType?.toLowerCase() ?? "";
  return normalized.includes("html") || normalized === "text/uri-list";
}

function looksLikeDatasetFileName(name: string): boolean {
  const lower = name.toLowerCase();
  return /\.(csv|tsv|json|ndjson|parquet|xlsx|xls)(\b|$)/.test(lower);
}

function isDatasetContentType(
  contentType: string | null,
  title?: string,
  docId?: string,
  source?: string | null,
): boolean {
  const normalized = contentType?.toLowerCase() ?? "";
  if (
    normalized &&
    /csv|json|spreadsheet|excel|parquet|tsv|xlsx|sheet|tabular|ndjson/.test(normalized)
  ) {
    return true;
  }
  const nameHint = `${title ?? ""} ${docId ?? ""} ${source ?? ""}`;
  return looksLikeDatasetFileName(nameHint);
}

function resolveDatasetFormat(
  contentType: string | null,
  title?: string,
  source?: string | null,
): string {
  const hint = `${contentType ?? ""} ${title ?? ""} ${source ?? ""}`.toLowerCase();
  if (hint.includes("csv") || hint.endsWith(".csv")) {
    return "CSV";
  }
  if (hint.includes("tsv") || hint.endsWith(".tsv")) {
    return "TSV";
  }
  if (hint.includes("json") || hint.endsWith(".json") || hint.endsWith(".ndjson")) {
    return "JSON";
  }
  if (hint.includes("parquet")) {
    return "Parquet";
  }
  if (/xlsx|spreadsheet|excel|sheet|\.xls/.test(hint)) {
    return "Spreadsheet";
  }
  const normalized = contentType?.toLowerCase() ?? "";
  if (normalized.includes("csv")) {
    return "CSV";
  }
  if (normalized.includes("json")) {
    return "JSON";
  }
  if (normalized.includes("parquet")) {
    return "Parquet";
  }
  if (/xlsx|spreadsheet|excel|sheet/.test(normalized)) {
    return "Spreadsheet";
  }
  return contentType ?? "Dataset";
}

const DATASET_RECORD_ID_RE = /^(dataset:[0-9a-f]+):\d+$/;

/** A doc is a dataset-import record/group when its id carries the `dataset:` prefix. */
function isDatasetDocId(docId: string): boolean {
  return docId.startsWith("dataset:");
}

/**
 * Map a doc id to its logical dataset group. Imported dataset records share a
 * `dataset:<hash>:<index>` id, so they collapse into a single `dataset:<hash>`
 * group; any other doc is its own single-record dataset.
 */
function resolveDatasetGroupKey(docId: string): { key: string; grouped: boolean } {
  const match = DATASET_RECORD_ID_RE.exec(docId);
  if (match?.[1]) {
    return { key: match[1], grouped: true };
  }
  return { key: docId, grouped: false };
}

/** Strip the trailing " #<n>" record suffix so the group shows the dataset title. */
function stripDatasetRecordSuffix(title: string): string {
  const stripped = title.replace(/\s*#\d+\s*$/u, "").trim();
  return stripped || title;
}

type DocumentRowWithSource = {
  doc_id: string;
  title: string;
  content_type: string | null;
  updated_at: number;
  source: string | null;
};

function loadLinkTitleByDocId(storePath?: string): Map<string, string> {
  const titles = new Map<string, string>();
  for (const link of listSourceDocumentLinks(
    {},
    storePath ?? defaultSourceDocumentLinkStorePath(),
  )) {
    const title = firstHumanDocumentTitle(link.relativePath);
    if (title) {
      titles.set(link.docId, title);
    }
  }
  return titles;
}

function resolveDocumentDisplayTitle(
  docId: string,
  fallbackTitle?: string | null,
  sourceName?: string | null,
  linkTitle?: string | null,
): string {
  const human = firstHumanDocumentTitle(fallbackTitle, sourceName, linkTitle);
  if (human) {
    return human;
  }
  const skillId = resolveSkillAssetIdForDocument(docId);
  if (!skillId) {
    return docId;
  }
  try {
    const title = getPersonalSkillAssetDetail(skillId).profile.name.trim();
    return firstHumanDocumentTitle(title) || docId;
  } catch {
    return docId;
  }
}

function listDocumentRowsWithSource(db: DatabaseSync, kbId: string): DocumentRowWithSource[] {
  return db
    .prepare(
      `SELECT d.doc_id, d.title, d.content_type, d.updated_at,
              (SELECT m.source FROM ${KB_CHUNK_META_TABLE} m
                WHERE m.doc_id = d.doc_id AND m.kb_id = d.kb_id
                LIMIT 1) AS source
         FROM documents d
        WHERE d.kb_id = ?
        ORDER BY d.updated_at DESC`,
    )
    .all(kbId) as DocumentRowWithSource[];
}

type WebRuntimeStat = { versionCount: number; freshnessScore: number | null };

/**
 * Per-web-page runtime stats: version count (document_versions = how many times the
 * page content changed across re-ingests, a real change signal) + average governance
 * freshness_score (staleness). Powers the 网页 tab's 变化 / 新鲜度 columns.
 */
function loadWebRuntimeStats(db: DatabaseSync, kbId: string): Map<string, WebRuntimeStat> {
  const map = new Map<string, WebRuntimeStat>();
  const versionRows = db
    .prepare(
      `SELECT dv.doc_id AS doc_id, COUNT(*) AS version_count
         FROM document_versions dv
         JOIN documents d ON d.doc_id = dv.doc_id
        WHERE d.kb_id = ?
        GROUP BY dv.doc_id`,
    )
    .all(kbId) as Array<{ doc_id: string; version_count: number }>;
  for (const row of versionRows) {
    map.set(row.doc_id, { versionCount: row.version_count, freshnessScore: null });
  }
  const freshRows = db
    .prepare(
      `SELECT m.doc_id AS doc_id, AVG(g.freshness_score) AS fresh
         FROM ${KB_CHUNK_META_TABLE} m
         JOIN chunk_governance g ON g.chunk_id = m.chunk_id
        WHERE m.kb_id = ? AND g.freshness_score IS NOT NULL
        GROUP BY m.doc_id`,
    )
    .all(kbId) as Array<{ doc_id: string; fresh: number | null }>;
  for (const row of freshRows) {
    const existing = map.get(row.doc_id) ?? { versionCount: 0, freshnessScore: null };
    existing.freshnessScore = typeof row.fresh === "number" ? row.fresh : null;
    map.set(row.doc_id, existing);
  }
  return map;
}

function attachWebRuntimeStats(
  page: KnowledgeBaseWebPageSummary,
  stats: Map<string, WebRuntimeStat>,
): KnowledgeBaseWebPageSummary {
  const stat = stats.get(page.docId);
  return {
    ...page,
    versionCount: stat?.versionCount ?? (page.indexed ? 1 : 0),
    ...(stat?.freshnessScore != null ? { freshnessScore: stat.freshnessScore } : {}),
  };
}

function attachWebSnapshotStats(
  page: KnowledgeBaseWebPageSummary,
  snapshots: Map<string, WebSourceSnapshotSummary>,
): KnowledgeBaseWebPageSummary {
  const snap = snapshots.get(page.url);
  if (!snap) {
    return page;
  }
  return {
    ...page,
    snapshotCount: snap.snapshotCount,
    ...(snap.changeRatio != null ? { changeRatio: snap.changeRatio } : {}),
    ...(snap.lastChangedAtMs != null ? { lastChangedAtMs: snap.lastChangedAtMs } : {}),
  };
}

function attachWebRefreshPolicy(
  page: KnowledgeBaseWebPageSummary,
  policies: Map<string, WebSourceRefreshPolicy>,
): KnowledgeBaseWebPageSummary {
  const policy = policies.get(page.url);
  if (!policy) {
    return page;
  }
  return {
    ...page,
    refreshEnabled: policy.enabled,
    refreshIntervalMs: policy.intervalMs,
    ...(policy.nextDueAtMs != null ? { refreshNextDueAtMs: policy.nextDueAtMs } : {}),
    ...(policy.lastRefreshedAtMs != null
      ? { refreshLastRefreshedAtMs: policy.lastRefreshedAtMs }
      : {}),
    ...(policy.lastStatus ? { refreshStatus: policy.lastStatus } : {}),
  };
}

export function listKnowledgeBaseWebPagesInIndex(
  db: DatabaseSync,
  knowledgeBase: KnowledgeBase,
): KnowledgeBaseWebPageSummary[] {
  const indexedRows = listDocumentRowsWithSource(db, knowledgeBase.id);
  const pages: KnowledgeBaseWebPageSummary[] = [];
  const seen = new Set<string>();

  for (const row of indexedRows) {
    if (isSkillAssetDocumentId(row.doc_id)) {
      continue;
    }
    const url = resolveWebPageUrl({
      docId: row.doc_id,
      title: row.title,
      source: row.source,
    });
    if (!url && !isWebContentType(row.content_type)) {
      continue;
    }
    seen.add(row.doc_id);
    pages.push({
      docId: row.doc_id,
      title: row.title,
      url: url ?? row.title,
      updatedAtMs: row.updated_at,
      indexed: true,
    });
  }

  for (const docId of knowledgeBase.documentIds) {
    if (isSkillAssetDocumentId(docId) || seen.has(docId)) {
      continue;
    }
    const url = resolveWebPageUrl({ docId, title: docId });
    if (!url) {
      continue;
    }
    pages.push({
      docId,
      title: resolveDocumentDisplayTitle(docId),
      url,
      updatedAtMs: 0,
      indexed: false,
    });
  }

  const stats = loadWebRuntimeStats(db, knowledgeBase.id);
  const snapshots = summarizeWebSourceSnapshotsByUrl(db, knowledgeBase.id);
  const refreshPolicies = getWebSourceRefreshByUrl(db, knowledgeBase.id);
  return pages.map((page) =>
    attachWebRefreshPolicy(
      attachWebSnapshotStats(attachWebRuntimeStats(page, stats), snapshots),
      refreshPolicies,
    ),
  );
}

type DatasetDocRuntimeStat = {
  chunkCount: number;
  trustSum: number;
  trustCount: number;
  referenceCount: number;
  lastHitAtMs: number | null;
};

/**
 * Per-document dataset runtime telemetry: chunk footprint (关联片段), governance
 * trust kept as sum+count so a multi-record dataset can be averaged correctly,
 * agent reference count (引用次数), and the most recent retrieval hit (最近消费).
 * All real index signals — chunk_meta + chunk_governance, no fabrication.
 */
function loadDatasetDocRuntimeStats(
  db: DatabaseSync,
  kbId: string,
): Map<string, DatasetDocRuntimeStat> {
  const map = new Map<string, DatasetDocRuntimeStat>();
  const countRows = db
    .prepare(
      `SELECT doc_id, COUNT(*) AS chunk_count
         FROM ${KB_CHUNK_META_TABLE}
        WHERE kb_id = ?
        GROUP BY doc_id`,
    )
    .all(kbId) as Array<{ doc_id: string; chunk_count: number }>;
  for (const row of countRows) {
    map.set(row.doc_id, {
      chunkCount: row.chunk_count,
      trustSum: 0,
      trustCount: 0,
      referenceCount: 0,
      lastHitAtMs: null,
    });
  }
  const govRows = db
    .prepare(
      `SELECT m.doc_id AS doc_id,
              SUM(g.trust_score) AS trust_sum,
              SUM(CASE WHEN g.trust_score IS NOT NULL THEN 1 ELSE 0 END) AS trust_count,
              SUM(COALESCE(g.reference_count, 0)) AS ref_count,
              MAX(g.last_hit_at) AS last_hit
         FROM ${KB_CHUNK_META_TABLE} m
         JOIN chunk_governance g ON g.chunk_id = m.chunk_id
        WHERE m.kb_id = ?
        GROUP BY m.doc_id`,
    )
    .all(kbId) as Array<{
    doc_id: string;
    trust_sum: number | null;
    trust_count: number | null;
    ref_count: number | null;
    last_hit: number | null;
  }>;
  for (const row of govRows) {
    const existing = map.get(row.doc_id) ?? {
      chunkCount: 0,
      trustSum: 0,
      trustCount: 0,
      referenceCount: 0,
      lastHitAtMs: null,
    };
    existing.trustSum = typeof row.trust_sum === "number" ? row.trust_sum : 0;
    existing.trustCount = typeof row.trust_count === "number" ? row.trust_count : 0;
    existing.referenceCount = typeof row.ref_count === "number" ? row.ref_count : 0;
    existing.lastHitAtMs = typeof row.last_hit === "number" ? row.last_hit : null;
    map.set(row.doc_id, existing);
  }
  return map;
}

type DatasetCandidate = {
  docId: string;
  title: string;
  contentType: string | null;
  updatedAtMs: number;
  source: string | null;
};

type DatasetGroupAccumulator = {
  grouped: boolean;
  representativeDocId: string;
  title: string;
  contentType: string | null;
  format: string;
  updatedAtMs: number;
  recordDocIds: string[];
};

/**
 * List structured datasets in a knowledge base as Dataset Runtime Objects. A dataset
 * is either a tabular/structured file (detected by content-type/filename) OR an
 * imported dataset whose records share a `dataset:<hash>:<index>` id — those records
 * collapse into one logical dataset carrying a real 记录数. Every dataset is enriched
 * with real runtime telemetry (关联片段 / 可信度 / 引用次数 / 最近消费) aggregated across
 * its records from chunk_meta + chunk_governance.
 */
export function listKnowledgeBaseDatasetsInIndex(
  db: DatabaseSync,
  knowledgeBase: KnowledgeBase,
): KnowledgeBaseDatasetSummary[] {
  const candidates: DatasetCandidate[] = [];
  const seen = new Set<string>();

  for (const row of listDocumentRowsWithSource(db, knowledgeBase.id)) {
    if (isSkillAssetDocumentId(row.doc_id)) {
      continue;
    }
    if (
      !isDatasetDocId(row.doc_id) &&
      !isDatasetContentType(row.content_type, row.title, row.doc_id, row.source)
    ) {
      continue;
    }
    seen.add(row.doc_id);
    candidates.push({
      docId: row.doc_id,
      title: row.title,
      contentType: row.content_type,
      updatedAtMs: row.updated_at,
      source: row.source,
    });
  }

  for (const docId of knowledgeBase.documentIds) {
    if (isSkillAssetDocumentId(docId) || seen.has(docId)) {
      continue;
    }
    const record = getKnowledgeDocument(db, docId);
    if (!record || record.kbId !== knowledgeBase.id) {
      continue;
    }
    const recordSource = db
      .prepare(
        `SELECT m.source FROM ${KB_CHUNK_META_TABLE} m
          WHERE m.doc_id = ? AND m.kb_id = ?
          LIMIT 1`,
      )
      .get(docId, knowledgeBase.id) as { source: string | null } | undefined;
    if (
      !isDatasetDocId(record.docId) &&
      !isDatasetContentType(
        record.contentType,
        record.title,
        record.docId,
        recordSource?.source ?? null,
      )
    ) {
      continue;
    }
    seen.add(docId);
    candidates.push({
      docId: record.docId,
      title: record.title,
      contentType: record.contentType,
      updatedAtMs: record.updatedAt,
      source: recordSource?.source ?? null,
    });
  }

  // Collapse dataset:<hash>:<index> records into one logical dataset; everything else
  // stays a single-record dataset. Candidates arrive newest-first, so the first one
  // seen for a group is its representative.
  const groups = new Map<string, DatasetGroupAccumulator>();
  const order: string[] = [];
  for (const candidate of candidates) {
    const { key, grouped } = resolveDatasetGroupKey(candidate.docId);
    let acc = groups.get(key);
    if (!acc) {
      acc = {
        grouped,
        representativeDocId: candidate.docId,
        title: grouped ? stripDatasetRecordSuffix(candidate.title) : candidate.title,
        contentType: candidate.contentType,
        format: grouped
          ? "Dataset"
          : resolveDatasetFormat(candidate.contentType, candidate.title, candidate.source),
        updatedAtMs: candidate.updatedAtMs,
        recordDocIds: [],
      };
      groups.set(key, acc);
      order.push(key);
    }
    acc.recordDocIds.push(candidate.docId);
    if (candidate.updatedAtMs > acc.updatedAtMs) {
      acc.updatedAtMs = candidate.updatedAtMs;
    }
  }

  const stats = loadDatasetDocRuntimeStats(db, knowledgeBase.id);
  const schemas = getDatasetSchemasForKb(db, knowledgeBase.id);
  return order.map((key) => {
    const acc = groups.get(key) as DatasetGroupAccumulator;
    let chunkCount = 0;
    let trustSum = 0;
    let trustCount = 0;
    let referenceCount = 0;
    let lastConsumedAtMs = 0;
    for (const docId of acc.recordDocIds) {
      const stat = stats.get(docId);
      if (!stat) {
        continue;
      }
      chunkCount += stat.chunkCount;
      trustSum += stat.trustSum;
      trustCount += stat.trustCount;
      referenceCount += stat.referenceCount;
      if (stat.lastHitAtMs != null && stat.lastHitAtMs > lastConsumedAtMs) {
        lastConsumedAtMs = stat.lastHitAtMs;
      }
    }
    const summary: KnowledgeBaseDatasetSummary = {
      docId: acc.representativeDocId,
      title: acc.title,
      contentType: acc.contentType,
      format: acc.format,
      updatedAtMs: acc.updatedAtMs,
      indexed: true,
      chunkCount,
      referenceCount,
    };
    if (acc.grouped) {
      summary.recordCount = acc.recordDocIds.length;
    }
    if (trustCount > 0) {
      summary.trustScore = trustSum / trustCount;
    }
    if (lastConsumedAtMs > 0) {
      summary.lastConsumedAtMs = lastConsumedAtMs;
    }
    // Attach the parsed structural schema (字段/行数) when one was extracted for any of
    // the dataset's record docs at ingest time. Prefer the representative doc's schema.
    const schema =
      schemas.get(acc.representativeDocId) ??
      acc.recordDocIds.map((docId) => schemas.get(docId)).find((entry) => entry != null);
    if (schema) {
      summary.columnCount = schema.columnCount;
      summary.rowCount = schema.rowCount;
      summary.columns = schema.columns.map((column) => ({ name: column.name, type: column.type }));
    }
    return summary;
  });
}

type DocumentRuntimeStat = { chunkCount: number; trustScore: number | null };

/**
 * Per-document runtime stats for the 来源 table: chunk count (关联片段) and the
 * average governance trust_score (可信度). Both are real index telemetry —
 * chunk_meta rows per doc, and chunk_governance.trust_score averaged per doc.
 */
function loadDocumentRuntimeStats(
  db: DatabaseSync,
  kbId: string,
): Map<string, DocumentRuntimeStat> {
  const map = new Map<string, DocumentRuntimeStat>();
  const countRows = db
    .prepare(
      `SELECT doc_id, COUNT(*) AS chunk_count
         FROM ${KB_CHUNK_META_TABLE}
        WHERE kb_id = ?
        GROUP BY doc_id`,
    )
    .all(kbId) as Array<{ doc_id: string; chunk_count: number }>;
  for (const row of countRows) {
    map.set(row.doc_id, { chunkCount: row.chunk_count, trustScore: null });
  }
  const trustRows = db
    .prepare(
      `SELECT m.doc_id AS doc_id, AVG(g.trust_score) AS trust
         FROM ${KB_CHUNK_META_TABLE} m
         JOIN chunk_governance g ON g.chunk_id = m.chunk_id
        WHERE m.kb_id = ? AND g.trust_score IS NOT NULL
        GROUP BY m.doc_id`,
    )
    .all(kbId) as Array<{ doc_id: string; trust: number | null }>;
  for (const row of trustRows) {
    const existing = map.get(row.doc_id) ?? { chunkCount: 0, trustScore: null };
    existing.trustScore = typeof row.trust === "number" ? row.trust : null;
    map.set(row.doc_id, existing);
  }
  return map;
}

function attachDocumentRuntimeStats(
  doc: KnowledgeBaseDocumentSummary,
  stats: Map<string, DocumentRuntimeStat>,
): KnowledgeBaseDocumentSummary {
  const stat = stats.get(doc.docId);
  return {
    ...doc,
    chunkCount: stat?.chunkCount ?? 0,
    ...(stat?.trustScore != null ? { trustScore: stat.trustScore } : {}),
  };
}

export function listKnowledgeBaseDocumentsInIndex(
  db: DatabaseSync,
  knowledgeBase: KnowledgeBase,
  options?: { sourceDocumentLinkStorePath?: string },
): KnowledgeBaseDocumentSummary[] {
  const linkTitles = loadLinkTitleByDocId(options?.sourceDocumentLinkStorePath);
  const indexedRows = db
    .prepare(
      `SELECT d.doc_id, d.title, d.content_type, d.updated_at,
              (SELECT m.source FROM ${KB_CHUNK_META_TABLE} m
                WHERE m.doc_id = d.doc_id AND m.kb_id = d.kb_id
                LIMIT 1) AS source
       FROM documents
       d
       WHERE d.kb_id = ?
       ORDER BY d.updated_at DESC`,
    )
    .all(knowledgeBase.id) as Array<{
    doc_id: string;
    title: string;
    content_type: string | null;
    updated_at: number;
    source: string | null;
  }>;

  const indexedById = new Map(
    indexedRows.map((row) => [
      row.doc_id,
      {
        docId: row.doc_id,
        title: resolveDocumentDisplayTitle(
          row.doc_id,
          row.title,
          row.source,
          linkTitles.get(row.doc_id),
        ),
        contentType: row.content_type,
        sourceName: row.source,
        updatedAtMs: row.updated_at,
        indexed: true,
      } satisfies KnowledgeBaseDocumentSummary,
    ]),
  );

  const ordered: KnowledgeBaseDocumentSummary[] = [];
  const seen = new Set<string>();
  for (const docId of knowledgeBase.documentIds) {
    if (isSkillAssetDocumentId(docId) || seen.has(docId)) {
      continue;
    }
    seen.add(docId);
    const indexed = indexedById.get(docId);
    if (indexed) {
      ordered.push(indexed);
      continue;
    }
    const record = getKnowledgeDocument(db, docId);
    if (record && record.kbId === knowledgeBase.id) {
      const recordSource = db
        .prepare(
          `SELECT m.source FROM ${KB_CHUNK_META_TABLE} m
            WHERE m.doc_id = ? AND m.kb_id = ?
            LIMIT 1`,
        )
        .get(docId, knowledgeBase.id) as { source: string | null } | undefined;
      ordered.push({
        docId: record.docId,
        title: resolveDocumentDisplayTitle(
          record.docId,
          record.title,
          recordSource?.source,
          linkTitles.get(record.docId),
        ),
        contentType: record.contentType,
        sourceName: recordSource?.source ?? null,
        updatedAtMs: record.updatedAt,
        indexed: true,
      });
      continue;
    }
    ordered.push({
      docId,
      title: resolveDocumentDisplayTitle(docId, null, null, linkTitles.get(docId)),
      contentType: null,
      sourceName: null,
      updatedAtMs: 0,
      indexed: false,
    });
  }

  for (const row of indexedRows) {
    if (!isSkillAssetDocumentId(row.doc_id) && !seen.has(row.doc_id)) {
      ordered.push({
        docId: row.doc_id,
        title: resolveDocumentDisplayTitle(
          row.doc_id,
          row.title,
          row.source,
          linkTitles.get(row.doc_id),
        ),
        contentType: row.content_type,
        sourceName: row.source,
        updatedAtMs: row.updated_at,
        indexed: true,
      });
    }
  }

  const stats = loadDocumentRuntimeStats(db, knowledgeBase.id);
  return ordered.map((doc) => attachDocumentRuntimeStats(doc, stats));
}

export function listKnowledgeBaseSnippetsInIndex(
  db: DatabaseSync,
  kbId: string,
  limit: number,
): KnowledgeBaseSnippetSummary[] {
  const capped = Math.min(Math.max(limit, 1), 100);
  const rows = db
    .prepare(
      `SELECT c.id AS chunk_id, c.text, m.doc_id, d.title AS doc_title,
              m.heading, m.section, COALESCE(dv.published_at, d.updated_at) AS sort_at,
              g.trust_score AS trust_score,
              g.governance_status AS governance_status,
              g.reference_count AS reference_count,
              (SELECT COUNT(*) FROM chunk_relations r
                WHERE r.kb_id = m.kb_id AND (r.from_chunk = c.id OR r.to_chunk = c.id)) AS relation_count
         FROM ${KB_CHUNK_META_TABLE} m
         JOIN ${KB_CHUNKS_TABLE} c ON c.id = m.chunk_id
         JOIN documents d ON d.doc_id = m.doc_id
         LEFT JOIN document_versions dv ON dv.version_id = m.version_id AND dv.doc_id = m.doc_id
         LEFT JOIN chunk_governance g ON g.chunk_id = c.id
        WHERE m.kb_id = ?
        ORDER BY sort_at DESC, m.chunk_id
        LIMIT ?`,
    )
    .all(kbId, capped) as Array<{
    chunk_id: string;
    text: string;
    doc_id: string;
    doc_title: string;
    heading: string | null;
    section: string | null;
    sort_at: number;
    trust_score: number | null;
    governance_status: string | null;
    reference_count: number | null;
    relation_count: number | null;
  }>;

  return rows.map((row) => ({
    chunkId: row.chunk_id,
    docId: row.doc_id,
    docTitle: row.doc_title,
    ...(row.heading ? { heading: row.heading } : {}),
    ...(row.section ? { section: row.section } : {}),
    excerpt: excerptChunkText(row.text),
    updatedAtMs: row.sort_at,
    ...(typeof row.trust_score === "number" ? { trustScore: row.trust_score } : {}),
    ...(row.governance_status ? { governanceStatus: row.governance_status } : {}),
    referenceCount: row.reference_count ?? 0,
    relationCount: row.relation_count ?? 0,
  }));
}

/**
 * Governance-evicted chunks for the 已移除 tab: chunks the governance system has
 * suppressed (filtered from retrieval), with the real eviction reason derived from
 * the conflict/duplicate group membership. Backed by chunk_governance +
 * chunks.text — the per-chunk detail behind the eviction reason summary.
 */
export function listGovernanceEvictedChunksInIndex(
  db: DatabaseSync,
  kbId: string,
  limit = 50,
): KnowledgeBaseEvictedChunkSummary[] {
  const capped = Math.min(Math.max(limit, 1), 100);
  const rows = db
    .prepare(
      `SELECT g.chunk_id AS chunk_id, c.text AS text, m.doc_id AS doc_id,
              d.title AS doc_title, g.conflict_group_id AS conflict_group_id,
              g.duplicate_group_id AS duplicate_group_id, g.last_analyzed_at AS last_analyzed_at
         FROM chunk_governance g
         JOIN ${KB_CHUNKS_TABLE} c ON c.id = g.chunk_id
         LEFT JOIN ${KB_CHUNK_META_TABLE} m ON m.chunk_id = g.chunk_id AND m.kb_id = g.kb_id
         LEFT JOIN documents d ON d.doc_id = m.doc_id
        WHERE g.kb_id = ? AND g.governance_status = 'suppressed'
        ORDER BY COALESCE(g.last_analyzed_at, 0) DESC
        LIMIT ?`,
    )
    .all(kbId, capped) as Array<{
    chunk_id: string;
    text: string | null;
    doc_id: string | null;
    doc_title: string | null;
    conflict_group_id: string | null;
    duplicate_group_id: string | null;
    last_analyzed_at: number | null;
  }>;
  return rows.map((row) => ({
    chunkId: row.chunk_id,
    docId: row.doc_id ?? "",
    docTitle: row.doc_title ?? row.doc_id ?? row.chunk_id,
    excerpt: excerptChunkText(row.text ?? ""),
    reason: row.conflict_group_id
      ? "conflict"
      : row.duplicate_group_id
        ? "duplicate"
        : "suppressed",
    updatedAtMs: row.last_analyzed_at ?? 0,
  }));
}

export async function listKnowledgeBaseEvictedChunksFromIndex(params: {
  knowledgeBase: KnowledgeBase;
  limit?: number;
  indexRoot?: string;
}): Promise<KnowledgeBaseEvictedChunkSummary[]> {
  const opened = await openKbIndexDb(params);
  if (!opened) {
    return [];
  }
  try {
    return listGovernanceEvictedChunksInIndex(
      opened.db,
      params.knowledgeBase.id,
      params.limit ?? 50,
    );
  } finally {
    opened.close();
  }
}

export async function listKnowledgeBaseDocumentsFromIndex(params: {
  knowledgeBase: KnowledgeBase;
  indexRoot?: string;
  sourceDocumentLinkStorePath?: string;
}): Promise<KnowledgeBaseDocumentSummary[]> {
  const linkTitles = loadLinkTitleByDocId(params.sourceDocumentLinkStorePath);
  const indexRoot = resolveKnowledgeIndexRootForBase(params.knowledgeBase, {
    indexRoot: params.indexRoot,
  });
  const dbPath = resolveKnowledgeIndexDbPath({
    ownerId: params.knowledgeBase.ownerId,
    tenantId: params.knowledgeBase.tenantId,
    indexRoot,
  });
  if (!fs.existsSync(dbPath)) {
    return params.knowledgeBase.documentIds
      .filter((docId) => !isSkillAssetDocumentId(docId))
      .map((docId) => ({
        docId,
        title: resolveDocumentDisplayTitle(docId, null, null, linkTitles.get(docId)),
        contentType: null,
        updatedAtMs: 0,
        indexed: false,
      }));
  }
  const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
  try {
    return listKnowledgeBaseDocumentsInIndex(index.db, params.knowledgeBase, {
      sourceDocumentLinkStorePath: params.sourceDocumentLinkStorePath,
    });
  } finally {
    index.close();
  }
}

export async function listKnowledgeBaseSnippetsFromIndex(params: {
  knowledgeBase: KnowledgeBase;
  limit?: number;
  indexRoot?: string;
}): Promise<KnowledgeBaseSnippetSummary[]> {
  const indexRoot = resolveKnowledgeIndexRootForBase(params.knowledgeBase, {
    indexRoot: params.indexRoot,
  });
  const dbPath = resolveKnowledgeIndexDbPath({
    ownerId: params.knowledgeBase.ownerId,
    tenantId: params.knowledgeBase.tenantId,
    indexRoot,
  });
  if (!fs.existsSync(dbPath)) {
    return [];
  }
  const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
  try {
    return listKnowledgeBaseSnippetsInIndex(index.db, params.knowledgeBase.id, params.limit ?? 24);
  } finally {
    index.close();
  }
}

export async function listKnowledgeBaseRecycledDocumentsFromIndex(params: {
  knowledgeBase: KnowledgeBase;
  indexRoot?: string;
}): Promise<KnowledgeBaseDocumentSummary[]> {
  const recycledBase = {
    ...params.knowledgeBase,
    documentIds: params.knowledgeBase.recycledDocumentIds ?? [],
  };
  return listKnowledgeBaseDocumentsFromIndex({
    knowledgeBase: recycledBase,
    indexRoot: params.indexRoot,
  });
}

async function openKbIndexDb(params: {
  knowledgeBase: KnowledgeBase;
  indexRoot?: string;
}): Promise<{ db: DatabaseSync; close: () => void } | null> {
  const indexRoot = resolveKnowledgeIndexRootForBase(params.knowledgeBase, {
    indexRoot: params.indexRoot,
  });
  const dbPath = resolveKnowledgeIndexDbPath({
    ownerId: params.knowledgeBase.ownerId,
    tenantId: params.knowledgeBase.tenantId,
    indexRoot,
  });
  if (!fs.existsSync(dbPath)) {
    return null;
  }
  const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
  return { db: index.db, close: () => index.close() };
}

export async function listKnowledgeBaseWebPagesFromIndex(params: {
  knowledgeBase: KnowledgeBase;
  indexRoot?: string;
}): Promise<KnowledgeBaseWebPageSummary[]> {
  const opened = await openKbIndexDb(params);
  if (!opened) {
    const pages: KnowledgeBaseWebPageSummary[] = [];
    for (const docId of params.knowledgeBase.documentIds) {
      if (isSkillAssetDocumentId(docId)) {
        continue;
      }
      const url = resolveWebPageUrl({ docId, title: docId });
      if (!url) {
        continue;
      }
      pages.push({
        docId,
        title: resolveDocumentDisplayTitle(docId),
        url,
        updatedAtMs: 0,
        indexed: false,
      });
    }
    return pages;
  }
  try {
    return listKnowledgeBaseWebPagesInIndex(opened.db, params.knowledgeBase);
  } finally {
    opened.close();
  }
}

export async function listKnowledgeBaseDatasetsFromIndex(params: {
  knowledgeBase: KnowledgeBase;
  indexRoot?: string;
}): Promise<KnowledgeBaseDatasetSummary[]> {
  const opened = await openKbIndexDb(params);
  if (!opened) {
    return [];
  }
  try {
    return listKnowledgeBaseDatasetsInIndex(opened.db, params.knowledgeBase);
  } finally {
    opened.close();
  }
}
