import type {
  CatalogCompareAndPutConflict,
  CatalogCompareAndPutParams,
  DataGovernanceCatalogStore,
} from "./catalog-store.js";
import type { CatalogRecord, DataGovernanceEnvelope, LifecycleState } from "./types.js";

/** Architecture §7.4 — contracts are machine-checkable; budgets may be tuned later. */
export const CATALOG_CACHE_BUDGETS = {
  /** Soft target for catalog refresh / invalidation apply. */
  refreshTargetMs: 500,
  /** Max age of a degraded snapshot before managed reads must fail closed. */
  degradedSnapshotMaxAgeMs: 60_000,
  /** Default positive-cache TTL for get/list. */
  defaultTtlMs: 5_000,
  /** Bounded backoff for refresh retries (ms). */
  refreshBackoffMs: [50, 100, 200, 400] as const,
} as const;

export type CatalogSnapshot = {
  capturedAt: string;
  capturedAtMs: number;
  records: CatalogRecord[];
  /** Monotonic epoch at capture — aligns with invalidation epoch. */
  epoch: number;
};

export type DegradedReadResult =
  | { mode: "live"; record: CatalogRecord | null }
  | { mode: "snapshot"; record: CatalogRecord | null; snapshotAgeMs: number; epoch: number }
  | { mode: "unavailable"; reason: "catalog_error" | "snapshot_stale" | "no_snapshot" };

export type CatalogCacheActor = {
  tenantId: string | null;
  principalId: string;
};

/** §7.4 composite cache key: tenantId + principalId + resourceId + governanceVersion. */
export function buildCatalogCacheKey(params: {
  tenantId: string | null;
  principalId: string;
  resourceId: string;
  governanceVersion: number;
}): string {
  return `${params.tenantId ?? "local"}:${params.principalId}:${params.resourceId}:${params.governanceVersion}`;
}

export type CachedDataGovernanceCatalog = {
  get(resourceId: string, actor?: CatalogCacheActor): Promise<CatalogRecord | null>;
  list(
    resourceType?: DataGovernanceEnvelope["resourceType"],
    filter?: { lifecycleState?: LifecycleState; tenantId?: string | null },
  ): Promise<CatalogRecord[]>;
  put(record: CatalogRecord): Promise<void>;
  compareAndPut(
    params: CatalogCompareAndPutParams,
  ): Promise<
    { ok: true; record: CatalogRecord } | { ok: false; conflict: CatalogCompareAndPutConflict }
  >;
  remove(resourceId: string): Promise<boolean>;
  invalidate(resourceId?: string): void;
  currentEpoch(): number;
  captureSnapshot(): Promise<CatalogSnapshot>;
  /**
   * Refresh durable list into snapshot with bounded backoff.
   * Returns elapsed ms and whether refresh met refreshTargetMs.
   */
  refreshWithBackoff(): Promise<{
    ok: boolean;
    attempts: number;
    elapsedMs: number;
    withinBudget: boolean;
    error?: string;
  }>;
  /** Fail-closed degraded read: live → fresh snapshot → unavailable. */
  getDegraded(resourceId: string, nowMs?: number): Promise<DegradedReadResult>;
  /** Last successful snapshot (for personal_local degraded resolver reads). */
  getLastSnapshot(): CatalogSnapshot | null;
  stats(): {
    hits: number;
    misses: number;
    invalidations: number;
    epoch: number;
    lastSnapshotAt: string | null;
    refreshAttempts: number;
  };
};

type CacheEntry = {
  key: string;
  record: CatalogRecord | null;
  expiresAtMs: number;
  epoch: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * In-process cache + snapshot layer over a durable catalog store.
 * Managed writes still go to the store (fail closed); reads may degrade to snapshot.
 */
export function createCachedDataGovernanceCatalog(params: {
  store: DataGovernanceCatalogStore;
  ttlMs?: number;
  degradedSnapshotMaxAgeMs?: number;
  refreshBackoffMs?: readonly number[];
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}): CachedDataGovernanceCatalog {
  const ttlMs = params.ttlMs ?? CATALOG_CACHE_BUDGETS.defaultTtlMs;
  const maxAge = params.degradedSnapshotMaxAgeMs ?? CATALOG_CACHE_BUDGETS.degradedSnapshotMaxAgeMs;
  const backoff = params.refreshBackoffMs ?? CATALOG_CACHE_BUDGETS.refreshBackoffMs;
  const now = params.now ?? (() => Date.now());
  const doSleep = params.sleep ?? sleep;

  const byKey = new Map<string, CacheEntry>();
  let listCache:
    | {
        key: string;
        records: CatalogRecord[];
        expiresAtMs: number;
        epoch: number;
      }
    | undefined;
  let snapshot: CatalogSnapshot | null = null;
  let epoch = 1;
  let hits = 0;
  let misses = 0;
  let invalidations = 0;
  let refreshAttempts = 0;

  function bumpEpoch(): void {
    epoch += 1;
  }

  function invalidate(resourceId?: string): void {
    invalidations += 1;
    bumpEpoch();
    listCache = undefined;
    if (!resourceId) {
      byKey.clear();
      return;
    }
    for (const [key, entry] of byKey) {
      if (entry.record?.envelope.resourceId === resourceId || key.includes(`:${resourceId}:`)) {
        byKey.delete(key);
      }
    }
  }

  function cacheGetKey(resourceId: string, actor: CatalogCacheActor | undefined, gov: number) {
    return buildCatalogCacheKey({
      tenantId: actor?.tenantId ?? null,
      principalId: actor?.principalId ?? "*",
      resourceId,
      governanceVersion: gov,
    });
  }

  return {
    currentEpoch: () => epoch,

    async get(resourceId, actor) {
      const t = now();
      // Probe any non-expired entry for this resource under current epoch.
      for (const entry of byKey.values()) {
        if (
          entry.epoch === epoch &&
          entry.expiresAtMs > t &&
          entry.record?.envelope.resourceId === resourceId
        ) {
          if (
            !actor ||
            entry.key === cacheGetKey(resourceId, actor, entry.record.envelope.governanceVersion)
          ) {
            hits += 1;
            return entry.record;
          }
        }
      }
      misses += 1;
      const record = await params.store.get(resourceId);
      const gov = record?.envelope.governanceVersion ?? 0;
      const key = cacheGetKey(resourceId, actor, gov);
      byKey.set(key, { key, record, expiresAtMs: t + ttlMs, epoch });
      return record;
    },

    async list(resourceType, filter) {
      const t = now();
      const key = `${resourceType ?? "*"}:${filter?.lifecycleState ?? "*"}:${filter?.tenantId === undefined ? "*" : String(filter.tenantId)}`;
      if (
        listCache &&
        listCache.key === key &&
        listCache.expiresAtMs > t &&
        listCache.epoch === epoch
      ) {
        hits += 1;
        return listCache.records;
      }
      misses += 1;
      let records = await params.store.list(resourceType);
      if (filter?.lifecycleState) {
        records = records.filter((r) => r.envelope.lifecycleState === filter.lifecycleState);
      }
      if (filter?.tenantId !== undefined) {
        records = records.filter((r) => r.envelope.tenantId === filter.tenantId);
      }
      listCache = { key, records, expiresAtMs: t + ttlMs, epoch };
      return records;
    },

    async put(record) {
      await params.store.put(record);
      invalidate(record.envelope.resourceId);
      if (snapshot) {
        const others = snapshot.records.filter(
          (r) => r.envelope.resourceId !== record.envelope.resourceId,
        );
        const t = now();
        snapshot = {
          capturedAt: new Date(t).toISOString(),
          capturedAtMs: t,
          records: [...others, record],
          epoch,
        };
      }
    },

    async compareAndPut(args) {
      const result = await params.store.compareAndPut(args);
      if (result.ok) {
        invalidate(args.resourceId);
        if (snapshot) {
          const others = snapshot.records.filter((r) => r.envelope.resourceId !== args.resourceId);
          const t = now();
          snapshot = {
            capturedAt: new Date(t).toISOString(),
            capturedAtMs: t,
            records: [...others, result.record],
            epoch,
          };
        }
      } else {
        invalidate(args.resourceId);
      }
      return result;
    },

    async remove(resourceId) {
      const removed = await params.store.remove(resourceId);
      invalidate(resourceId);
      if (snapshot && removed) {
        snapshot = {
          ...snapshot,
          epoch,
          records: snapshot.records.filter((r) => r.envelope.resourceId !== resourceId),
        };
      }
      return removed;
    },

    invalidate,

    async captureSnapshot() {
      const t = now();
      const records = await params.store.list();
      snapshot = {
        capturedAt: new Date(t).toISOString(),
        capturedAtMs: t,
        records,
        epoch,
      };
      return snapshot;
    },

    async refreshWithBackoff() {
      const started = now();
      let lastError: string | undefined;
      let attempts = 0;
      for (let i = 0; i <= backoff.length; i += 1) {
        attempts += 1;
        refreshAttempts += 1;
        try {
          await this.captureSnapshot();
          const elapsedMs = now() - started;
          return {
            ok: true,
            attempts,
            elapsedMs,
            withinBudget: elapsedMs <= CATALOG_CACHE_BUDGETS.refreshTargetMs,
          };
        } catch (err) {
          lastError = String((err as Error)?.message ?? err);
          if (i < backoff.length) {
            await doSleep(backoff[i] ?? 50);
          }
        }
      }
      return {
        ok: false,
        attempts,
        elapsedMs: now() - started,
        withinBudget: false,
        error: lastError,
      };
    },

    async getDegraded(resourceId, nowMs = now()) {
      try {
        const record = await params.store.get(resourceId);
        const gov = record?.envelope.governanceVersion ?? 0;
        const key = cacheGetKey(resourceId, undefined, gov);
        byKey.set(key, { key, record, expiresAtMs: nowMs + ttlMs, epoch });
        return { mode: "live", record };
      } catch {
        if (!snapshot) {
          return { mode: "unavailable", reason: "no_snapshot" };
        }
        const age = nowMs - snapshot.capturedAtMs;
        if (age > maxAge) {
          return { mode: "unavailable", reason: "snapshot_stale" };
        }
        const record = snapshot.records.find((r) => r.envelope.resourceId === resourceId) ?? null;
        return { mode: "snapshot", record, snapshotAgeMs: age, epoch: snapshot.epoch };
      }
    },

    getLastSnapshot() {
      return snapshot;
    },

    stats() {
      return {
        hits,
        misses,
        invalidations,
        epoch,
        lastSnapshotAt: snapshot?.capturedAt ?? null,
        refreshAttempts,
      };
    },
  };
}
