import type { DatabaseSync } from "node:sqlite";
import { openKnowledgeIndex, resolveKnowledgeIndexDbPath } from "./kb-index.js";
import type { KnowledgeBase } from "./knowledge-base-store.js";
import {
  recordWebSourceSnapshotInIndex,
  type WebSnapshotChangeKind,
} from "./web-source-snapshot-store.js";

/** Default re-check cadence for an enabled web source (24h) and a hard 5-minute floor. */
export const DEFAULT_WEB_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const MIN_WEB_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

export type WebSourceRefreshStatus = "initial" | "unchanged" | "changed" | "error";

export type WebSourceRefreshPolicy = {
  url: string;
  docId: string | null;
  enabled: boolean;
  intervalMs: number;
  lastRefreshedAtMs: number | null;
  nextDueAtMs: number | null;
  lastStatus: WebSourceRefreshStatus | null;
  lastError: string | null;
};

function clampInterval(intervalMs: number | undefined): number {
  if (!intervalMs || !Number.isFinite(intervalMs)) {
    return DEFAULT_WEB_REFRESH_INTERVAL_MS;
  }
  return Math.max(MIN_WEB_REFRESH_INTERVAL_MS, Math.floor(intervalMs));
}

type RefreshRow = {
  url: string;
  doc_id: string | null;
  enabled: number;
  interval_ms: number;
  last_refreshed_at: number | null;
  next_due_at: number | null;
  last_status: string | null;
  last_error: string | null;
};

function rowToPolicy(row: RefreshRow): WebSourceRefreshPolicy {
  return {
    url: row.url,
    docId: row.doc_id,
    enabled: row.enabled === 1,
    intervalMs: row.interval_ms,
    lastRefreshedAtMs: row.last_refreshed_at,
    nextDueAtMs: row.next_due_at,
    lastStatus: (row.last_status as WebSourceRefreshStatus | null) ?? null,
    lastError: row.last_error,
  };
}

/**
 * Create or update a web source's refresh policy. Enabling (re)computes nextDueAt from
 * now + interval; disabling clears nextDueAt. The url is the stable schedule key.
 */
export function upsertWebSourceRefreshPolicyInIndex(
  db: DatabaseSync,
  params: {
    kbId: string;
    url: string;
    docId?: string | null;
    enabled: boolean;
    intervalMs?: number;
    nowMs?: number;
  },
): WebSourceRefreshPolicy {
  const now = params.nowMs ?? Date.now();
  const intervalMs = clampInterval(params.intervalMs);
  const nextDueAt = params.enabled ? now + intervalMs : null;
  db.prepare(
    `INSERT INTO web_source_refresh
       (kb_id, url, doc_id, enabled, interval_ms, last_refreshed_at, next_due_at, last_status, last_error, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, NULL, ?, ?)
     ON CONFLICT(kb_id, url) DO UPDATE SET
       doc_id = COALESCE(excluded.doc_id, web_source_refresh.doc_id),
       enabled = excluded.enabled,
       interval_ms = excluded.interval_ms,
       next_due_at = excluded.next_due_at,
       updated_at = excluded.updated_at`,
  ).run(
    params.kbId,
    params.url,
    params.docId ?? null,
    params.enabled ? 1 : 0,
    intervalMs,
    nextDueAt,
    now,
    now,
  );
  return getWebSourceRefreshPolicyInIndex(db, params.kbId, params.url)!;
}

export function getWebSourceRefreshPolicyInIndex(
  db: DatabaseSync,
  kbId: string,
  url: string,
): WebSourceRefreshPolicy | null {
  const row = db
    .prepare(
      `SELECT url, doc_id, enabled, interval_ms, last_refreshed_at, next_due_at, last_status, last_error
         FROM web_source_refresh WHERE kb_id = ? AND url = ?`,
    )
    .get(kbId, url) as RefreshRow | undefined;
  return row ? rowToPolicy(row) : null;
}

/** Per-url refresh policy map for the 网页 tab. */
export function getWebSourceRefreshByUrl(
  db: DatabaseSync,
  kbId: string,
): Map<string, WebSourceRefreshPolicy> {
  const rows = db
    .prepare(
      `SELECT url, doc_id, enabled, interval_ms, last_refreshed_at, next_due_at, last_status, last_error
         FROM web_source_refresh WHERE kb_id = ?`,
    )
    .all(kbId) as RefreshRow[];
  const map = new Map<string, WebSourceRefreshPolicy>();
  for (const row of rows) {
    map.set(row.url, rowToPolicy(row));
  }
  return map;
}

export type WebSourceRefreshDueItem = { url: string; docId: string | null };

/** Enabled sources whose next_due_at has elapsed — the scheduler work queue. */
export function listDueWebSourceRefreshInIndex(
  db: DatabaseSync,
  params: { kbId: string; nowMs: number; limit?: number },
): WebSourceRefreshDueItem[] {
  const limit = Math.max(1, Math.min(params.limit ?? 25, 100));
  const rows = db
    .prepare(
      `SELECT url, doc_id
         FROM web_source_refresh
        WHERE kb_id = ? AND enabled = 1 AND next_due_at IS NOT NULL AND next_due_at <= ?
        ORDER BY next_due_at ASC
        LIMIT ?`,
    )
    .all(params.kbId, params.nowMs, limit) as Array<{ url: string; doc_id: string | null }>;
  return rows.map((row) => ({ url: row.url, docId: row.doc_id }));
}

/** Record a refresh outcome and reschedule next_due_at = now + interval. */
export function markWebSourceRefreshedInIndex(
  db: DatabaseSync,
  params: {
    kbId: string;
    url: string;
    nowMs: number;
    status: WebSourceRefreshStatus;
    error?: string | null;
  },
): void {
  const policy = getWebSourceRefreshPolicyInIndex(db, params.kbId, params.url);
  const intervalMs = policy?.intervalMs ?? DEFAULT_WEB_REFRESH_INTERVAL_MS;
  db.prepare(
    `UPDATE web_source_refresh
        SET last_refreshed_at = ?, next_due_at = ?, last_status = ?, last_error = ?, updated_at = ?
      WHERE kb_id = ? AND url = ?`,
  ).run(
    params.nowMs,
    params.nowMs + intervalMs,
    params.status,
    params.error ?? null,
    params.nowMs,
    params.kbId,
    params.url,
  );
}

export type WebRefreshFetcher = (url: string) => Promise<{ text: string; title?: string }>;

export type WebSourceRefreshRunResult = {
  url: string;
  status: WebSourceRefreshStatus;
  changeKind?: WebSnapshotChangeKind;
  error?: string;
};

/**
 * The scheduler runner: scan a knowledge base's due web sources, re-fetch each via the
 * injected fetcher, record a snapshot (change detection vs the prior capture), and
 * reschedule. Errors are captured per-source and still reschedule so a transient failure
 * retries next interval instead of wedging the queue.
 */
export async function runDueWebSourceRefreshesInIndex(
  db: DatabaseSync,
  params: { kbId: string; nowMs: number; fetcher: WebRefreshFetcher; limit?: number },
): Promise<WebSourceRefreshRunResult[]> {
  const due = listDueWebSourceRefreshInIndex(db, {
    kbId: params.kbId,
    nowMs: params.nowMs,
    ...(params.limit != null ? { limit: params.limit } : {}),
  });
  const results: WebSourceRefreshRunResult[] = [];
  for (const item of due) {
    try {
      const fetched = await params.fetcher(item.url);
      const text = (fetched.text ?? "").trim();
      if (!text) {
        markWebSourceRefreshedInIndex(db, {
          kbId: params.kbId,
          url: item.url,
          nowMs: params.nowMs,
          status: "error",
          error: "empty content",
        });
        results.push({ url: item.url, status: "error", error: "empty content" });
        continue;
      }
      const snapshot = recordWebSourceSnapshotInIndex(db, {
        kbId: params.kbId,
        docId: item.docId,
        url: item.url,
        text,
        fetchedAtMs: params.nowMs,
      });
      const status: WebSourceRefreshStatus = snapshot.changeKind;
      markWebSourceRefreshedInIndex(db, {
        kbId: params.kbId,
        url: item.url,
        nowMs: params.nowMs,
        status,
      });
      results.push({ url: item.url, status, changeKind: snapshot.changeKind });
    } catch (error) {
      const message = error instanceof Error ? error.message : "refresh failed";
      markWebSourceRefreshedInIndex(db, {
        kbId: params.kbId,
        url: item.url,
        nowMs: params.nowMs,
        status: "error",
        error: message,
      });
      results.push({ url: item.url, status: "error", error: message });
    }
  }
  return results;
}

async function openKbIndex(params: { knowledgeBase: KnowledgeBase; indexRoot?: string }) {
  const dbPath = resolveKnowledgeIndexDbPath({
    ownerId: params.knowledgeBase.ownerId,
    tenantId: params.knowledgeBase.tenantId,
    indexRoot: params.indexRoot,
  });
  return openKnowledgeIndex({ dbPath, vectorEnabled: false });
}

export async function setWebSourceRefreshPolicy(params: {
  knowledgeBase: KnowledgeBase;
  url: string;
  docId?: string | null;
  enabled: boolean;
  intervalMs?: number;
  nowMs?: number;
  indexRoot?: string;
}): Promise<WebSourceRefreshPolicy> {
  const index = await openKbIndex(params);
  try {
    return upsertWebSourceRefreshPolicyInIndex(index.db, {
      kbId: params.knowledgeBase.id,
      url: params.url,
      docId: params.docId ?? null,
      enabled: params.enabled,
      ...(params.intervalMs != null ? { intervalMs: params.intervalMs } : {}),
      ...(params.nowMs != null ? { nowMs: params.nowMs } : {}),
    });
  } finally {
    index.close();
  }
}

export async function runDueWebSourceRefreshes(params: {
  knowledgeBase: KnowledgeBase;
  fetcher: WebRefreshFetcher;
  nowMs?: number;
  limit?: number;
  indexRoot?: string;
}): Promise<WebSourceRefreshRunResult[]> {
  const index = await openKbIndex(params);
  try {
    return await runDueWebSourceRefreshesInIndex(index.db, {
      kbId: params.knowledgeBase.id,
      nowMs: params.nowMs ?? Date.now(),
      fetcher: params.fetcher,
      ...(params.limit != null ? { limit: params.limit } : {}),
    });
  } finally {
    index.close();
  }
}
