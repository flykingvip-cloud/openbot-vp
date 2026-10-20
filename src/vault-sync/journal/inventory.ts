import fs from "node:fs";
import path from "node:path";
import type { SelectiveSyncOptions } from "../types.js";
import { isAlwaysExcluded, shouldSyncPath } from "./excludes.js";

export type LocalInventoryEntry = {
  relativePath: string;
  sizeBytes: number;
  mtimeMs: number;
  rawHash?: string;
};

export type LocalInventoryPage = {
  entries: LocalInventoryEntry[];
  nextCursor: string | null;
  /** True when more files remain — callers MUST continue with nextCursor. */
  truncated: boolean;
  scannedTotal: number;
};

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 2000;

function shouldDescendDir(rel: string): boolean {
  // Skip known Runtime / VCS / OS trees early.
  return !isAlwaysExcluded(`${rel}/x`);
}

/**
 * Paginated local inventory. Never silently stops without truncated/nextCursor.
 * Unlike LOCAL_FOLDER_SCAN_MAX_FILES=500 silent truncate.
 */
export function walkLocalInventoryPage(params: {
  rootPath: string;
  cursor?: string | null;
  limit?: number;
  selectiveSync?: SelectiveSyncOptions;
  extraExcludeGlobs?: string[];
}): LocalInventoryPage {
  const limit = Math.min(Math.max(params.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const root = path.resolve(params.rootPath);
  const all: LocalInventoryEntry[] = [];

  const walk = (absDir: string, relDir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const rel = relDir ? `${relDir}/${ent.name}` : ent.name;
      const abs = path.join(absDir, ent.name);
      if (ent.isSymbolicLink()) {
        continue;
      }
      if (ent.isDirectory()) {
        if (!shouldDescendDir(rel)) {
          continue;
        }
        walk(abs, rel);
        continue;
      }
      if (!ent.isFile()) {
        continue;
      }
      if (!shouldSyncPath(rel, params.selectiveSync, params.extraExcludeGlobs)) {
        continue;
      }
      try {
        const st = fs.statSync(abs);
        all.push({
          relativePath: rel.replace(/\\/g, "/"),
          sizeBytes: st.size,
          mtimeMs: st.mtimeMs,
        });
      } catch {
        // skip unreadable
      }
    }
  };

  walk(root, "");
  all.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  let start = 0;
  if (params.cursor) {
    const exact = all.findIndex((e) => e.relativePath === params.cursor);
    if (exact >= 0) {
      start = exact + 1;
    } else {
      const idx = all.findIndex((e) => e.relativePath > params.cursor!);
      start = idx >= 0 ? idx : all.length;
    }
  }

  const slice = all.slice(start, start + limit);
  const hasMore = start + limit < all.length;
  return {
    entries: slice,
    nextCursor: hasMore ? (slice.at(-1)?.relativePath ?? null) : null,
    truncated: hasMore,
    scannedTotal: all.length,
  };
}

/** Drain all pages — for tests / small vaults. */
export function walkLocalInventoryAll(params: {
  rootPath: string;
  pageSize?: number;
  selectiveSync?: SelectiveSyncOptions;
  extraExcludeGlobs?: string[];
}): LocalInventoryEntry[] {
  const out: LocalInventoryEntry[] = [];
  let cursor: string | null = null;
  for (;;) {
    const page = walkLocalInventoryPage({
      ...params,
      cursor,
      limit: params.pageSize ?? DEFAULT_LIMIT,
    });
    out.push(...page.entries);
    if (!page.truncated || !page.nextCursor) {
      break;
    }
    cursor = page.nextCursor;
  }
  return out;
}
