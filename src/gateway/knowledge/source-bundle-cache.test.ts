import { afterEach, describe, expect, it, vi } from "vitest";
import * as knowledgeContext from "./context.js";
import * as emptyBundle from "./empty-bundle.js";
import { createKnowledgeBase, restoreKnowledgeBaseStoreSnapshot } from "./knowledge-base-store.js";
import {
  KNOWLEDGE_SOURCE_BUNDLE_CACHE_TTL_MS,
  createKnowledgeSourceBundleCache,
  formatKnowledgeSourceBundleCacheKey,
  invalidateKnowledgeSourceBundleCache,
  resetKnowledgeSourceBundleCacheForTests,
} from "./source-bundle-cache.js";
import { loadKnowledgeSourceBundle } from "./source-bundle.js";
import type { KnowledgeSourceBundle } from "./sources/types.js";

function emptyBundleFixture(label: string): KnowledgeSourceBundle {
  return {
    objects: [],
    dataCapabilities: [],
    sourceSummary: {
      personal: { documentCount: 0, recentUpdates: 0 },
      enterprise: { libraryCount: 0, accessibleCount: 0 },
      data: { grantedCount: 0, requestableCount: 0, externalSourceCount: 0 },
    },
    sourceBrowse: { personal: [], enterprise: [], enterpriseRestricted: [] },
    externalDataSources: [],
    feedItems: [],
    graph: { nodes: [{ id: label, kind: "knowledge-base", title: label }], edges: [] },
  };
}

afterEach(() => {
  resetKnowledgeSourceBundleCacheForTests();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("knowledge source bundle cache", () => {
  it("documents a 15s TTL in the 5–30s range", () => {
    expect(KNOWLEDGE_SOURCE_BUNDLE_CACHE_TTL_MS).toBe(15_000);
    expect(KNOWLEDGE_SOURCE_BUNDLE_CACHE_TTL_MS).toBeGreaterThanOrEqual(5_000);
    expect(KNOWLEDGE_SOURCE_BUNDLE_CACHE_TTL_MS).toBeLessThanOrEqual(30_000);
  });

  it("includes userId, tenantId, seatId, and agentType in the cache key", () => {
    const left = formatKnowledgeSourceBundleCacheKey({
      userId: "user-a",
      tenantId: "tenant-a",
      seatId: "seat-a",
      agentType: "employee-agent",
    });
    const otherUser = formatKnowledgeSourceBundleCacheKey({
      userId: "user-b",
      tenantId: "tenant-a",
      seatId: "seat-a",
      agentType: "employee-agent",
    });
    const otherTenant = formatKnowledgeSourceBundleCacheKey({
      userId: "user-a",
      tenantId: "tenant-b",
      seatId: "seat-a",
      agentType: "employee-agent",
    });
    const otherSeat = formatKnowledgeSourceBundleCacheKey({
      userId: "user-a",
      tenantId: "tenant-a",
      seatId: "seat-b",
      agentType: "employee-agent",
    });
    const otherAgent = formatKnowledgeSourceBundleCacheKey({
      userId: "user-a",
      tenantId: "tenant-a",
      seatId: "seat-a",
      agentType: "manager-agent",
    });
    expect(new Set([left, otherUser, otherTenant, otherSeat, otherAgent]).size).toBe(5);
  });

  it("merges in-flight loads for the same key onto one loader call", async () => {
    let releases: Array<() => void> = [];
    const loader = vi.fn(
      () =>
        new Promise<KnowledgeSourceBundle>((resolve) => {
          releases.push(() => resolve(emptyBundleFixture("shared")));
        }),
    );
    const cache = createKnowledgeSourceBundleCache();
    const key = formatKnowledgeSourceBundleCacheKey({
      userId: "user-a",
      tenantId: "tenant-a",
      seatId: "seat-a",
      agentType: "employee-agent",
    });
    const pending = [
      cache.getOrLoad(key, loader),
      cache.getOrLoad(key, loader),
      cache.getOrLoad(key, loader),
      cache.getOrLoad(key, loader),
    ];
    expect(loader).toHaveBeenCalledTimes(1);
    expect(cache.inFlightSize).toBe(1);
    for (const release of releases) {
      release();
    }
    const results = await Promise.all(pending);
    expect(results).toHaveLength(4);
    expect(new Set(results).size).toBe(1);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(cache.stats.loads).toBe(1);
    expect(cache.stats.joins).toBe(3);
  });

  it("returns the cached bundle within TTL and misses after expiry", async () => {
    let now = 1_000;
    const cache = createKnowledgeSourceBundleCache({ ttlMs: 15_000, now: () => now });
    const key = formatKnowledgeSourceBundleCacheKey({
      userId: "user-a",
      tenantId: "tenant-a",
      seatId: "seat-a",
      agentType: "employee-agent",
    });
    const first = emptyBundleFixture("first");
    const second = emptyBundleFixture("second");
    const loader = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    expect(await cache.getOrLoad(key, loader)).toBe(first);
    now += 14_999;
    expect(await cache.getOrLoad(key, loader)).toBe(first);
    now += 2;
    expect(await cache.getOrLoad(key, loader)).toBe(second);
    expect(loader).toHaveBeenCalledTimes(2);
    expect(cache.stats.hits).toBe(1);
  });

  it("does not reuse a bundle across userId, tenantId, or seatId", async () => {
    const cache = createKnowledgeSourceBundleCache();
    const loaderA = vi.fn(async () => emptyBundleFixture("a"));
    const loaderB = vi.fn(async () => emptyBundleFixture("b"));
    const base = { tenantId: "tenant-a", seatId: "seat-a", agentType: "employee-agent" };
    const bundleA = await cache.getOrLoad(
      formatKnowledgeSourceBundleCacheKey({ ...base, userId: "user-a" }),
      loaderA,
    );
    const bundleB = await cache.getOrLoad(
      formatKnowledgeSourceBundleCacheKey({ ...base, userId: "user-b" }),
      loaderB,
    );
    expect(bundleA).not.toBe(bundleB);
    expect(loaderA).toHaveBeenCalledTimes(1);
    expect(loaderB).toHaveBeenCalledTimes(1);

    const tenantB = await cache.getOrLoad(
      formatKnowledgeSourceBundleCacheKey({
        userId: "user-a",
        tenantId: "tenant-b",
        seatId: "seat-a",
        agentType: "employee-agent",
      }),
      vi.fn(async () => emptyBundleFixture("tenant-b")),
    );
    expect(tenantB).not.toBe(bundleA);

    const seatB = await cache.getOrLoad(
      formatKnowledgeSourceBundleCacheKey({
        userId: "user-a",
        tenantId: "tenant-a",
        seatId: "seat-b",
        agentType: "employee-agent",
      }),
      vi.fn(async () => emptyBundleFixture("seat-b")),
    );
    expect(seatB).not.toBe(bundleA);
  });

  it("does not return a stale bundle after invalidation, including in-flight completion", async () => {
    const cache = createKnowledgeSourceBundleCache();
    const key = formatKnowledgeSourceBundleCacheKey({
      userId: "user-a",
      tenantId: "tenant-a",
      seatId: "seat-a",
      agentType: "employee-agent",
    });
    let release!: (bundle: KnowledgeSourceBundle) => void;
    const firstLoader = vi.fn(
      () =>
        new Promise<KnowledgeSourceBundle>((resolve) => {
          release = resolve;
        }),
    );
    const pending = cache.getOrLoad(key, firstLoader);
    cache.invalidate({
      userId: "user-a",
      tenantId: "tenant-a",
      seatId: "seat-a",
      agentType: "employee-agent",
    });
    release(emptyBundleFixture("stale"));
    const stale = await pending;
    const freshLoader = vi.fn(async () => emptyBundleFixture("fresh"));
    const fresh = await cache.getOrLoad(key, freshLoader);
    expect(fresh).not.toBe(stale);
    expect(fresh.graph.nodes[0]?.id).toBe("fresh");
    expect(freshLoader).toHaveBeenCalledTimes(1);
  });

  it("retries after a synchronous loader throw and does not leave in-flight state", async () => {
    const cache = createKnowledgeSourceBundleCache();
    const key = formatKnowledgeSourceBundleCacheKey({
      userId: "user-a",
      tenantId: "tenant-a",
      seatId: "seat-a",
      agentType: "employee-agent",
    });
    const boom = vi.fn(() => {
      throw new Error("sync-boom");
    });
    await expect(cache.getOrLoad(key, boom)).rejects.toThrow("sync-boom");
    expect(cache.inFlightSize).toBe(0);
    expect(cache.get(key)).toBeNull();
    const ok = vi.fn(async () => emptyBundleFixture("after-sync"));
    const recovered = await cache.getOrLoad(key, ok);
    expect(recovered.graph.nodes[0]?.id).toBe("after-sync");
    expect(ok).toHaveBeenCalledTimes(1);
    expect(cache.stats.loads).toBe(2);
  });

  it("retries after an asynchronous loader rejection", async () => {
    const cache = createKnowledgeSourceBundleCache();
    const key = formatKnowledgeSourceBundleCacheKey({
      userId: "user-a",
      tenantId: "tenant-a",
      seatId: "seat-a",
      agentType: "employee-agent",
    });
    const boom = vi.fn(async () => {
      throw new Error("async-boom");
    });
    await expect(cache.getOrLoad(key, boom)).rejects.toThrow("async-boom");
    expect(cache.inFlightSize).toBe(0);
    const ok = vi.fn(async () => emptyBundleFixture("after-async"));
    const recovered = await cache.getOrLoad(key, ok);
    expect(recovered.graph.nodes[0]?.id).toBe("after-async");
    expect(ok).toHaveBeenCalledTimes(1);
  });

  it("does not let a stale in-flight finally drop a newer holder or refill the cache", async () => {
    const cache = createKnowledgeSourceBundleCache();
    const key = formatKnowledgeSourceBundleCacheKey({
      userId: "user-a",
      tenantId: "tenant-a",
      seatId: "seat-a",
      agentType: "employee-agent",
    });
    let releaseStale!: (bundle: KnowledgeSourceBundle) => void;
    let releaseFresh!: (bundle: KnowledgeSourceBundle) => void;
    const staleLoader = vi.fn(
      () =>
        new Promise<KnowledgeSourceBundle>((resolve) => {
          releaseStale = resolve;
        }),
    );
    const freshLoader = vi.fn(
      () =>
        new Promise<KnowledgeSourceBundle>((resolve) => {
          releaseFresh = resolve;
        }),
    );
    const stalePending = cache.getOrLoad(key, staleLoader);
    cache.invalidate({
      userId: "user-a",
      tenantId: "tenant-a",
      seatId: "seat-a",
      agentType: "employee-agent",
    });
    const freshPending = cache.getOrLoad(key, freshLoader);
    expect(staleLoader).toHaveBeenCalledTimes(1);
    expect(freshLoader).toHaveBeenCalledTimes(1);
    expect(cache.inFlightSize).toBe(1);
    releaseStale(emptyBundleFixture("stale"));
    const stale = await stalePending;
    expect(stale.graph.nodes[0]?.id).toBe("stale");
    expect(cache.get(key)).toBeNull();
    expect(cache.inFlightSize).toBe(1);
    releaseFresh(emptyBundleFixture("fresh"));
    const fresh = await freshPending;
    expect(fresh.graph.nodes[0]?.id).toBe("fresh");
    expect(cache.get(key)).toBe(fresh);
    expect(cache.inFlightSize).toBe(0);
  });
});

describe("loadKnowledgeSourceBundle principal cache", () => {
  it("builds the bundle once for concurrent same-principal loads", async () => {
    vi.spyOn(knowledgeContext, "resolveKnowledgeSourceContext").mockResolvedValue({
      userId: "user-cache-a",
      tenantId: "tenant-cache-a",
      seatId: "seat-cache-a",
      agentType: "employee-agent",
      hasEnterpriseScope: false,
    });
    const spy = vi.spyOn(emptyBundle, "buildKnowledgeSourceBundleAsync");
    const started = Date.now();
    const bundles = await Promise.all([
      loadKnowledgeSourceBundle(null),
      loadKnowledgeSourceBundle(null),
      loadKnowledgeSourceBundle(null),
      loadKnowledgeSourceBundle(null),
    ]);
    const firstWaveMs = Date.now() - started;
    expect(spy).toHaveBeenCalledTimes(1);
    expect(new Set(bundles).size).toBe(1);

    const cachedStarted = Date.now();
    const cached = await Promise.all([
      loadKnowledgeSourceBundle(null),
      loadKnowledgeSourceBundle(null),
    ]);
    const secondWaveMs = Date.now() - cachedStarted;
    expect(spy).toHaveBeenCalledTimes(1);
    expect(cached[0]).toBe(bundles[0]);
    // Timing is environment-dependent; only report counts and that the
    // second wave did not rebuild. Values are wall-clock, not content.
    expect(secondWaveMs).toBeLessThanOrEqual(firstWaveMs + 50);
  });

  it("does not let one principal hit another principal's cached bundle", async () => {
    const context = vi.spyOn(knowledgeContext, "resolveKnowledgeSourceContext");
    context.mockResolvedValue({
      userId: "user-cache-a",
      tenantId: "tenant-cache-a",
      seatId: "seat-cache-a",
      agentType: "employee-agent",
      hasEnterpriseScope: false,
    });
    const first = await loadKnowledgeSourceBundle(null);
    context.mockResolvedValue({
      userId: "user-cache-b",
      tenantId: "tenant-cache-a",
      seatId: "seat-cache-a",
      agentType: "employee-agent",
      hasEnterpriseScope: false,
    });
    const second = await loadKnowledgeSourceBundle(null);
    expect(second).not.toBe(first);
  });

  it("invalidates on knowledge-base writes so the next load rebuilds", async () => {
    vi.spyOn(knowledgeContext, "resolveKnowledgeSourceContext").mockResolvedValue({
      userId: "user-cache-write",
      tenantId: "tenant-cache-write",
      seatId: "seat-cache-write",
      agentType: "employee-agent",
      hasEnterpriseScope: false,
    });
    const spy = vi.spyOn(emptyBundle, "buildKnowledgeSourceBundleAsync");
    const storePath = `/tmp/openbot-t317-kb-store-${Date.now()}.json`;
    const first = await loadKnowledgeSourceBundle(null);
    expect(spy).toHaveBeenCalledTimes(1);
    try {
      createKnowledgeBase(
        {
          title: "kb-1",
          ownerId: "user-cache-write",
          tenantId: "tenant-cache-write",
        },
        storePath,
      );
      const second = await loadKnowledgeSourceBundle(null);
      expect(spy).toHaveBeenCalledTimes(2);
      expect(second).not.toBe(first);
    } finally {
      restoreKnowledgeBaseStoreSnapshot(null, storePath);
      invalidateKnowledgeSourceBundleCache();
    }
  });
});
