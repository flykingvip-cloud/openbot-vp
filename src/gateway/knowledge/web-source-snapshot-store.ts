import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { openKnowledgeIndex, resolveKnowledgeIndexDbPath } from "./kb-index.js";
import type { KnowledgeBase } from "./knowledge-base-store.js";

export type WebSnapshotChangeKind = "initial" | "unchanged" | "changed";

export type WebSourceSnapshotRecord = {
  snapshotId: string;
  url: string;
  docId: string | null;
  contentHash: string;
  contentLength: number;
  changeKind: WebSnapshotChangeKind;
  /** Word-set Jaccard distance vs the prior snapshot (0..1); null on the initial capture. */
  changeRatio: number | null;
  fetchedAtMs: number;
};

export type WebSourceSnapshotSummary = {
  /** Total snapshots recorded for the url (how many times it was (re)fetched). */
  snapshotCount: number;
  /** Most recent fetch time across snapshots. */
  lastFetchedAtMs: number;
  /** Last time the content actually changed (initial capture counts); null when never. */
  lastChangedAtMs: number | null;
  /** The most recent snapshot's change ratio (0..1); null when initial/unscored. */
  changeRatio: number | null;
  /** The most recent snapshot's change classification. */
  changeKind: WebSnapshotChangeKind;
};

const MAX_SNAPSHOT_TEXT = 200_000;

function normalizeWebText(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase().slice(0, MAX_SNAPSHOT_TEXT);
}

/** Word tokens (length >= 2) used for the content-change ratio. */
function wordSet(normalized: string): Set<string> {
  const set = new Set<string>();
  for (const token of normalized.split(/[^\p{L}\p{N}]+/u)) {
    if (token.length >= 2) {
      set.add(token);
    }
  }
  return set;
}

/**
 * Real content-change rate between two web captures: the Jaccard distance over their
 * word sets (1 - |A∩B| / |A∪B|). Deterministic and explainable — a high ratio means
 * most of the page's vocabulary turned over. Returns 0 when both are effectively empty.
 */
export function computeWebContentChangeRatio(priorText: string, nextText: string): number {
  const a = wordSet(normalizeWebText(priorText));
  const b = wordSet(normalizeWebText(nextText));
  if (a.size === 0 && b.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) {
      intersection += 1;
    }
  }
  const union = a.size + b.size - intersection;
  if (union === 0) {
    return 0;
  }
  const ratio = 1 - intersection / union;
  return Math.max(0, Math.min(1, ratio));
}

type SnapshotRow = {
  content_hash: string;
  normalized_text: string | null;
};

/**
 * Record a web-source snapshot keyed by (kb_id, url): hash the normalized content,
 * diff it against the latest prior snapshot for the same url, and persist the
 * change classification + ratio. The url (not doc_id) is the stable identity of a
 * web source, so re-collecting the same page diffs against its history even if the
 * collect created a fresh document. Requires an already-open knowledge index db.
 */
export function recordWebSourceSnapshotInIndex(
  db: DatabaseSync,
  params: { kbId: string; docId?: string | null; url: string; text: string; fetchedAtMs?: number },
): WebSourceSnapshotRecord {
  const normalized = normalizeWebText(params.text);
  const contentHash = createHash("sha256").update(normalized, "utf8").digest("hex");
  const contentLength = normalized.length;
  const fetchedAtMs = params.fetchedAtMs ?? Date.now();

  const prior = db
    .prepare(
      `SELECT content_hash, normalized_text
         FROM web_source_snapshots
        WHERE kb_id = ? AND url = ?
        ORDER BY fetched_at DESC
        LIMIT 1`,
    )
    .get(params.kbId, params.url) as SnapshotRow | undefined;

  let changeKind: WebSnapshotChangeKind;
  let changeRatio: number | null;
  if (!prior) {
    changeKind = "initial";
    changeRatio = null;
  } else if (prior.content_hash === contentHash) {
    changeKind = "unchanged";
    changeRatio = 0;
  } else {
    changeKind = "changed";
    changeRatio = computeWebContentChangeRatio(prior.normalized_text ?? "", normalized);
  }

  const snapshotId = randomUUID();
  db.prepare(
    `INSERT INTO web_source_snapshots
       (snapshot_id, kb_id, doc_id, url, content_hash, content_length, normalized_text, change_kind, change_ratio, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    snapshotId,
    params.kbId,
    params.docId ?? null,
    params.url,
    contentHash,
    contentLength,
    normalized,
    changeKind,
    changeRatio,
    fetchedAtMs,
  );

  return {
    snapshotId,
    url: params.url,
    docId: params.docId ?? null,
    contentHash,
    contentLength,
    changeKind,
    changeRatio,
    fetchedAtMs,
  };
}

/**
 * Per-url snapshot rollup for the 网页 tab: snapshot count, last fetch, last actual
 * change, and the most recent snapshot's change classification + ratio. All real
 * telemetry from web_source_snapshots.
 */
export function summarizeWebSourceSnapshotsByUrl(
  db: DatabaseSync,
  kbId: string,
): Map<string, WebSourceSnapshotSummary> {
  const map = new Map<string, WebSourceSnapshotSummary>();
  const countRows = db
    .prepare(
      `SELECT url, COUNT(*) AS snapshot_count, MAX(fetched_at) AS last_fetched
         FROM web_source_snapshots
        WHERE kb_id = ?
        GROUP BY url`,
    )
    .all(kbId) as Array<{ url: string; snapshot_count: number; last_fetched: number }>;
  for (const row of countRows) {
    map.set(row.url, {
      snapshotCount: row.snapshot_count,
      lastFetchedAtMs: row.last_fetched,
      lastChangedAtMs: null,
      changeRatio: null,
      changeKind: "initial",
    });
  }

  const changedRows = db
    .prepare(
      `SELECT url, MAX(fetched_at) AS last_changed
         FROM web_source_snapshots
        WHERE kb_id = ? AND change_kind IN ('changed','initial')
        GROUP BY url`,
    )
    .all(kbId) as Array<{ url: string; last_changed: number }>;
  for (const row of changedRows) {
    const existing = map.get(row.url);
    if (existing) {
      existing.lastChangedAtMs = row.last_changed;
    }
  }

  const latestRows = db
    .prepare(
      `SELECT w.url AS url, w.change_kind AS change_kind, w.change_ratio AS change_ratio
         FROM web_source_snapshots w
        WHERE w.kb_id = ?
          AND w.fetched_at = (
            SELECT MAX(w2.fetched_at) FROM web_source_snapshots w2
             WHERE w2.kb_id = w.kb_id AND w2.url = w.url
          )`,
    )
    .all(kbId) as Array<{
    url: string;
    change_kind: WebSnapshotChangeKind;
    change_ratio: number | null;
  }>;
  for (const row of latestRows) {
    const existing = map.get(row.url);
    if (existing) {
      existing.changeKind = row.change_kind;
      existing.changeRatio = typeof row.change_ratio === "number" ? row.change_ratio : null;
    }
  }

  return map;
}

/**
 * Open the knowledge index for the base and record a web-source snapshot. Best-effort:
 * returns null when the index db does not exist yet. Callers should wrap in try/catch
 * so snapshot bookkeeping never breaks the ingest path.
 */
export async function recordWebSourceSnapshot(params: {
  knowledgeBase: KnowledgeBase;
  docId?: string | null;
  url: string;
  text: string;
  fetchedAtMs?: number;
  indexRoot?: string;
}): Promise<WebSourceSnapshotRecord | null> {
  const dbPath = resolveKnowledgeIndexDbPath({
    ownerId: params.knowledgeBase.ownerId,
    tenantId: params.knowledgeBase.tenantId,
    indexRoot: params.indexRoot,
  });
  const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
  try {
    return recordWebSourceSnapshotInIndex(index.db, {
      kbId: params.knowledgeBase.id,
      docId: params.docId ?? null,
      url: params.url,
      text: params.text,
      ...(params.fetchedAtMs != null ? { fetchedAtMs: params.fetchedAtMs } : {}),
    });
  } finally {
    index.close();
  }
}
