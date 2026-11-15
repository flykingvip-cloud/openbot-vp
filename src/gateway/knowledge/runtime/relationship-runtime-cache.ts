import { createHash } from "node:crypto";
import type { EventLoopYielder } from "../event-loop-yield.js";
import {
  buildIntelligentRelationshipGraph,
  buildIntelligentRelationshipGraphAsync,
} from "./relationship-runtime.js";
import type { RelationshipRuntimeInput, RelationshipRuntimeResult } from "./types.js";

/**
 * Content-addressed memoization for the relationship graph builder.
 *
 * `buildIntelligentRelationshipGraph` is O(n²) (pairwise candidate building +
 * conflict detection + scoring) and is invoked many times per page interaction
 * (search / recommendations / actions / context-engine each load a bundle),
 * even though the underlying object set rarely changes between those calls.
 *
 * Instead of persisting a separate edge table (a much larger refactor: the graph
 * is built over knowledge *objects*, not chunks, and no edge store exists), we
 * fingerprint the input and reuse the last result when nothing changed. The
 * fingerprint captures every field that influences nodes/edges/conflicts, so a
 * stale graph is impossible: any object/capability mutation changes the
 * fingerprint and forces a rebuild.
 */

const DEFAULT_CACHE_LIMIT = 16;

export type RelationshipGraphCacheStats = {
  hits: number;
  misses: number;
};

export type RelationshipGraphCache = {
  build(input: RelationshipRuntimeInput): RelationshipRuntimeResult;
  buildAsync(
    input: RelationshipRuntimeInput,
    options?: { yieldFn?: EventLoopYielder; yieldEvery?: number },
  ): Promise<RelationshipRuntimeResult>;
  invalidate(): void;
  readonly stats: RelationshipGraphCacheStats;
  readonly size: number;
};

function fingerprintInput(input: RelationshipRuntimeInput): string {
  const objectParts = input.objects
    .map((object) =>
      [
        object.id,
        object.updatedAt ?? 0,
        object.source,
        object.kind,
        object.scopeLabel ?? "",
        object.accessState ?? "",
        object.freshnessStatus ?? "",
        (object.tags ?? []).join(","),
        (object.relatedObjectIds ?? []).join(","),
        // conflictCount feeds suppressResolvedConflictEdges downstream.
        object.relationshipSummary?.conflictCount ?? "",
        // title/summary participate in conflict detection.
        object.title,
        object.summary,
      ].join("\u0001"),
    )
    .toSorted();
  const capabilityParts = (input.dataCapabilities ?? [])
    .map((capability) =>
      [
        capability.id,
        capability.title,
        capability.accessState,
        (capability.visibleAgents ?? []).join(","),
        (capability.scenarios ?? []).join(","),
      ].join("\u0001"),
    )
    .toSorted();
  const usageParts = Object.entries(input.usageCountByObjectId ?? {})
    .map(([objectId, count]) => `${objectId}\u0001${count}`)
    .toSorted();
  const payload = JSON.stringify([objectParts, capabilityParts, usageParts]);
  return createHash("sha1").update(payload).digest("hex");
}

export function createRelationshipGraphCache(options?: {
  limit?: number;
  builder?: (input: RelationshipRuntimeInput) => RelationshipRuntimeResult;
}): RelationshipGraphCache {
  const limit = Math.max(1, options?.limit ?? DEFAULT_CACHE_LIMIT);
  const builder = options?.builder ?? buildIntelligentRelationshipGraph;
  const entries = new Map<string, RelationshipRuntimeResult>();
  const stats: RelationshipGraphCacheStats = { hits: 0, misses: 0 };

  function remember(key: string, result: RelationshipRuntimeResult): RelationshipRuntimeResult {
    entries.set(key, result);
    if (entries.size > limit) {
      const oldest = entries.keys().next().value;
      if (oldest !== undefined) {
        entries.delete(oldest);
      }
    }
    return result;
  }

  function takeCached(key: string): RelationshipRuntimeResult | null {
    const cached = entries.get(key);
    if (!cached) {
      return null;
    }
    stats.hits += 1;
    entries.delete(key);
    entries.set(key, cached);
    return cached;
  }

  return {
    build(input: RelationshipRuntimeInput): RelationshipRuntimeResult {
      const key = fingerprintInput(input);
      const cached = takeCached(key);
      if (cached) {
        return cached;
      }
      stats.misses += 1;
      return remember(key, builder(input));
    },
    async buildAsync(
      input: RelationshipRuntimeInput,
      options?: { yieldFn?: EventLoopYielder; yieldEvery?: number },
    ): Promise<RelationshipRuntimeResult> {
      const key = fingerprintInput(input);
      const cached = takeCached(key);
      if (cached) {
        return cached;
      }
      stats.misses += 1;
      const result =
        builder === buildIntelligentRelationshipGraph
          ? await buildIntelligentRelationshipGraphAsync(input, options)
          : builder(input);
      return remember(key, result);
    },
    invalidate() {
      entries.clear();
    },
    get stats() {
      return stats;
    },
    get size() {
      return entries.size;
    },
  };
}

const defaultCache = createRelationshipGraphCache();

/**
 * Cached entrypoint that callers should prefer over the raw O(n²) builder on
 * read hot paths. Behaviour is identical to `buildIntelligentRelationshipGraph`
 * but redundant rebuilds for an unchanged object set are elided.
 */
export function buildRelationshipGraphCached(
  input: RelationshipRuntimeInput,
): RelationshipRuntimeResult {
  return defaultCache.build(input);
}

export function buildRelationshipGraphCachedAsync(
  input: RelationshipRuntimeInput,
  options?: { yieldFn?: EventLoopYielder; yieldEvery?: number },
): Promise<RelationshipRuntimeResult> {
  return defaultCache.buildAsync(input, options);
}

export function invalidateRelationshipGraphCache(): void {
  defaultCache.invalidate();
}

export function getRelationshipGraphCacheStats(): RelationshipGraphCacheStats {
  return defaultCache.stats;
}
