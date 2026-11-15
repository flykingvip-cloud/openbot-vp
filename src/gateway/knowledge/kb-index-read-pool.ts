import fs from "node:fs";
import { openKnowledgeIndex, type KnowledgeIndex } from "./kb-index.js";
import { registerKnowledgeSourceBundleCacheInvalidationHook } from "./source-bundle-cache.js";

/**
 * Process-local reuse of a knowledge-index connection for read paths
 * (t317 P2 / t324). Home RPCs used to open and close the same sqlite file
 * on every bundle load. The pool keeps one connection per path until the
 * source-bundle cache is invalidated (index, space, document, or governance
 * write), then closes it so the next load observes the mutation.
 *
 * Isolation is unchanged: paths are still resolved per owner/tenant, and
 * the caller-visible projection stays fail-closed in source-bundle.ts.
 */

type PoolEntry = {
  dbPath: string;
  index: KnowledgeIndex;
  refs: number;
};

const pool = new Map<string, PoolEntry>();

function wrap(entry: PoolEntry): KnowledgeIndex {
  return {
    db: entry.index.db,
    dbPath: entry.index.dbPath,
    ftsAvailable: entry.index.ftsAvailable,
    vectorAvailable: entry.index.vectorAvailable,
    ...(entry.index.vectorLoadError ? { vectorLoadError: entry.index.vectorLoadError } : {}),
    close: () => {
      releaseKnowledgeIndexRead(entry.dbPath);
    },
  };
}

export async function acquireKnowledgeIndexRead(params: {
  dbPath: string;
  ftsEnabled?: boolean;
  vectorEnabled?: boolean;
}): Promise<KnowledgeIndex> {
  const existing = pool.get(params.dbPath);
  if (existing) {
    existing.refs += 1;
    return wrap(existing);
  }
  if (!fs.existsSync(params.dbPath)) {
    throw new Error("knowledge index does not exist");
  }
  const index = await openKnowledgeIndex({
    dbPath: params.dbPath,
    vectorEnabled: params.vectorEnabled ?? false,
    ...(params.ftsEnabled === undefined ? {} : { ftsEnabled: params.ftsEnabled }),
  });
  const entry: PoolEntry = { dbPath: params.dbPath, index, refs: 1 };
  pool.set(params.dbPath, entry);
  return wrap(entry);
}

export function releaseKnowledgeIndexRead(dbPath: string): void {
  const entry = pool.get(dbPath);
  if (!entry) {
    return;
  }
  entry.refs = Math.max(0, entry.refs - 1);
}

export function closeKnowledgeIndexReadPool(dbPath?: string): void {
  const entries = dbPath
    ? [pool.get(dbPath)].filter((entry): entry is PoolEntry => Boolean(entry))
    : [...pool.values()];
  for (const entry of entries) {
    try {
      entry.index.close();
    } catch {
      // The underlying connection may already be closed in tests.
    }
    pool.delete(entry.dbPath);
  }
}

export function getKnowledgeIndexReadPoolStats(): { size: number; refs: number } {
  let refs = 0;
  for (const entry of pool.values()) {
    refs += entry.refs;
  }
  return { size: pool.size, refs };
}

export function resetKnowledgeIndexReadPoolForTests(): void {
  closeKnowledgeIndexReadPool();
}

registerKnowledgeSourceBundleCacheInvalidationHook(() => {
  closeKnowledgeIndexReadPool();
});
