import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { CONFIG_DIR } from "../../utils.js";
import { openKnowledgeIndex } from "./kb-index.js";
import { fetchWebPageForKnowledge } from "./personal-knowledge-ingest.js";
import {
  runDueWebSourceRefreshesInIndex,
  type WebRefreshFetcher,
} from "./web-source-refresh-store.js";

function listKbIdsWithDueRefreshes(db: DatabaseSync, nowMs: number): string[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT kb_id FROM web_source_refresh
        WHERE enabled = 1 AND next_due_at IS NOT NULL AND next_due_at <= ?`,
    )
    .all(nowMs) as Array<{ kb_id: string }>;
  return rows.map((row) => row.kb_id).filter(Boolean);
}

export type WebRefreshTickResult = {
  databases: number;
  refreshed: number;
  changed: number;
  errors: number;
};

/**
 * The periodic driver for web auto-refresh: scan every owner/tenant knowledge index for
 * web sources whose refresh interval has elapsed, re-fetch + snapshot + reschedule them.
 * Mirrors the governance tick's index enumeration. Best-effort + bounded per round; only
 * acts on sources the user explicitly enabled (so it is opt-in by nature). The fetcher is
 * injectable for tests.
 */
export async function tickDueWebSourceRefreshes(params?: {
  indexRoot?: string;
  nowMs?: number;
  maxDatabasesPerRound?: number;
  limitPerKb?: number;
  fetcher?: WebRefreshFetcher;
}): Promise<WebRefreshTickResult> {
  const root = params?.indexRoot ?? path.join(CONFIG_DIR, "knowledge", "index");
  const empty: WebRefreshTickResult = { databases: 0, refreshed: 0, changed: 0, errors: 0 };
  if (!fs.existsSync(root)) {
    return empty;
  }
  const dbPaths: string[] = [];
  for (const scope of ["personal", "tenant"] as const) {
    const dir = path.join(root, scope);
    if (!fs.existsSync(dir)) {
      continue;
    }
    for (const entry of fs.readdirSync(dir)) {
      if (entry.endsWith(".db")) {
        dbPaths.push(path.join(dir, entry));
      }
    }
  }
  const dbLimit = params?.maxDatabasesPerRound ?? 8;
  const limitPerKb = params?.limitPerKb ?? 10;
  const now = params?.nowMs ?? Date.now();
  const fetcher: WebRefreshFetcher =
    params?.fetcher ?? ((url) => fetchWebPageForKnowledge({ url }));

  const result: WebRefreshTickResult = { databases: 0, refreshed: 0, changed: 0, errors: 0 };
  for (const dbPath of dbPaths.slice(0, dbLimit)) {
    const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
    try {
      const kbIds = listKbIdsWithDueRefreshes(index.db, now);
      if (kbIds.length === 0) {
        continue;
      }
      result.databases += 1;
      for (const kbId of kbIds) {
        const runResults = await runDueWebSourceRefreshesInIndex(index.db, {
          kbId,
          nowMs: now,
          fetcher,
          limit: limitPerKb,
        });
        result.refreshed += runResults.length;
        result.changed += runResults.filter((entry) => entry.status === "changed").length;
        result.errors += runResults.filter((entry) => entry.status === "error").length;
      }
    } finally {
      index.close();
    }
  }
  return result;
}
