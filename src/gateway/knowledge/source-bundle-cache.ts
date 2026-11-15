import type { KnowledgeSourceBundle } from "./sources/types.js";

/**
 * Short in-process TTL for a principal-scoped knowledge source bundle.
 *
 * Home RPCs (search / relationships / recommendations / actions, and later
 * related) used to each call `loadKnowledgeSourceBundle` and rebuild the same
 * graph. This cache:
 * - merges in-flight loads for one cache key onto a single Promise
 * - returns the built bundle for a short TTL (default 15s, within the 5–30s
 *   guidance) so a second home open in that window is a memory hit
 * - isolates entries by userId / tenantId / seatId / agentType (fail-closed:
 *   only the caller's visible objects should have been loaded into the bundle)
 *
 * Process restart leaves the cache empty, which is expected. Writers must call
 * `invalidateKnowledgeSourceBundleCache` so a stale bundle is never reused
 * after an index, space, document, or governance write.
 */
export const KNOWLEDGE_SOURCE_BUNDLE_CACHE_TTL_MS = 15_000;

export type KnowledgeSourceBundleCacheKeyParts = {
  userId: string | null | undefined;
  tenantId: string | null | undefined;
  seatId: string | null | undefined;
  agentType?: string | null | undefined;
};

export type KnowledgeSourceBundleCacheStats = {
  hits: number;
  misses: number;
  joins: number;
  loads: number;
  invalidations: number;
};

type CacheEntry = {
  bundle: KnowledgeSourceBundle;
  expiresAt: number;
  generation: number;
};

type InFlightEntry = {
  promise: Promise<KnowledgeSourceBundle>;
  generation: number;
};

const invalidationHooks: Array<() => void> = [];

/**
 * Side-effect hook for invalidation (e.g. close pooled read connections).
 * Hooks must be cheap and must not re-enter the cache.
 */
export function registerKnowledgeSourceBundleCacheInvalidationHook(hook: () => void): void {
  invalidationHooks.push(hook);
}

function runInvalidationHooks(): void {
  for (const hook of invalidationHooks) {
    hook();
  }
}

function normalizeKeyPart(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

export function formatKnowledgeSourceBundleCacheKey(
  parts: KnowledgeSourceBundleCacheKeyParts,
): string {
  return [
    normalizeKeyPart(parts.userId),
    normalizeKeyPart(parts.tenantId),
    normalizeKeyPart(parts.seatId),
    normalizeKeyPart(parts.agentType),
  ].join("\u0001");
}

function keyMatchesScope(key: string, scope: KnowledgeSourceBundleCacheKeyParts): boolean {
  const [userId, tenantId, seatId, agentType] = key.split("\u0001");
  const checks: Array<[string | null | undefined, string]> = [
    [scope.userId, userId ?? ""],
    [scope.tenantId, tenantId ?? ""],
    [scope.seatId, seatId ?? ""],
    [scope.agentType, agentType ?? ""],
  ];
  for (const [provided, actual] of checks) {
    if (provided === undefined) {
      continue;
    }
    if (normalizeKeyPart(provided) !== actual) {
      return false;
    }
  }
  return true;
}

export type KnowledgeSourceBundleCache = {
  readonly ttlMs: number;
  readonly stats: KnowledgeSourceBundleCacheStats;
  get(key: string, now?: number): KnowledgeSourceBundle | null;
  getOrLoad(
    key: string,
    loader: () => Promise<KnowledgeSourceBundle>,
  ): Promise<KnowledgeSourceBundle>;
  invalidate(scope?: KnowledgeSourceBundleCacheKeyParts): void;
  clear(): void;
  readonly size: number;
  readonly inFlightSize: number;
};

export function createKnowledgeSourceBundleCache(options?: {
  ttlMs?: number;
  now?: () => number;
}): KnowledgeSourceBundleCache {
  const ttlMs = Math.max(1, options?.ttlMs ?? KNOWLEDGE_SOURCE_BUNDLE_CACHE_TTL_MS);
  const nowFn = options?.now ?? Date.now;
  const entries = new Map<string, CacheEntry>();
  const inFlight = new Map<string, InFlightEntry>();
  let generation = 0;
  const stats: KnowledgeSourceBundleCacheStats = {
    hits: 0,
    misses: 0,
    joins: 0,
    loads: 0,
    invalidations: 0,
  };

  function get(key: string, now: number = nowFn()): KnowledgeSourceBundle | null {
    const entry = entries.get(key);
    if (!entry) {
      return null;
    }
    if (entry.expiresAt <= now) {
      entries.delete(key);
      return null;
    }
    return entry.bundle;
  }

  function invalidate(scope?: KnowledgeSourceBundleCacheKeyParts): void {
    generation += 1;
    stats.invalidations += 1;
    if (!scope) {
      entries.clear();
      inFlight.clear();
      runInvalidationHooks();
      return;
    }
    const hasConstraint =
      scope.userId !== undefined ||
      scope.tenantId !== undefined ||
      scope.seatId !== undefined ||
      scope.agentType !== undefined;
    if (!hasConstraint) {
      entries.clear();
      inFlight.clear();
      return;
    }
    for (const key of Array.from(entries.keys())) {
      if (keyMatchesScope(key, scope)) {
        entries.delete(key);
      }
    }
    for (const key of Array.from(inFlight.keys())) {
      if (keyMatchesScope(key, scope)) {
        inFlight.delete(key);
      }
    }
    runInvalidationHooks();
  }

  async function getOrLoad(
    key: string,
    loader: () => Promise<KnowledgeSourceBundle>,
  ): Promise<KnowledgeSourceBundle> {
    const cached = get(key);
    if (cached) {
      stats.hits += 1;
      return cached;
    }
    const existing = inFlight.get(key);
    if (existing) {
      stats.joins += 1;
      return existing.promise;
    }
    stats.misses += 1;
    stats.loads += 1;
    const loadGeneration = generation;
    const promise = (async () => {
      try {
        const bundle = await loader();
        if (loadGeneration === generation) {
          entries.set(key, {
            bundle,
            expiresAt: nowFn() + ttlMs,
            generation: loadGeneration,
          });
        }
        return bundle;
      } finally {
        const current = inFlight.get(key);
        if (current?.promise === promise) {
          inFlight.delete(key);
        }
      }
    })();
    inFlight.set(key, { promise, generation: loadGeneration });
    return promise;
  }

  return {
    ttlMs,
    get stats() {
      return stats;
    },
    get,
    getOrLoad,
    invalidate,
    clear() {
      invalidate();
      stats.hits = 0;
      stats.misses = 0;
      stats.joins = 0;
      stats.loads = 0;
      stats.invalidations = 0;
    },
    get size() {
      return entries.size;
    },
    get inFlightSize() {
      return inFlight.size;
    },
  };
}

const defaultCache = createKnowledgeSourceBundleCache();

export function getKnowledgeSourceBundleCache(): KnowledgeSourceBundleCache {
  return defaultCache;
}

export function invalidateKnowledgeSourceBundleCache(
  scope?: KnowledgeSourceBundleCacheKeyParts,
): void {
  defaultCache.invalidate(scope);
}

export function getKnowledgeSourceBundleCacheStats(): KnowledgeSourceBundleCacheStats {
  return defaultCache.stats;
}

export function resetKnowledgeSourceBundleCacheForTests(): void {
  defaultCache.clear();
}
