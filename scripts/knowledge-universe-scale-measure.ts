/**
 * t324 isolated scale measurement for knowledge-universe loading.
 *
 * Reports timings and counts only. Does not print knowledge text, titles,
 * account, or tenant identifiers from a real corpus (the fixture is synthetic).
 *
 * Usage:
 *   OPENBOT_T324_FIXTURE_DIR=/tmp/openbot-t324-scale \
 *     node --import tsx scripts/knowledge-universe-scale-measure.ts
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

const fixtureRoot =
  process.env.OPENBOT_T324_FIXTURE_DIR?.trim() ||
  process.env.OPENBOT_STATE_DIR?.trim() ||
  path.join(os.tmpdir(), "openbot-t324-scale");
process.env.OPENBOT_STATE_DIR = fixtureRoot;

type SampleStats = { count: number; minMs: number; maxMs: number; p50Ms: number; p95Ms: number };

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].toSorted((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return sorted[index] ?? 0;
}

function summarize(values: number[]): SampleStats {
  if (values.length === 0) {
    return { count: 0, minMs: 0, maxMs: 0, p50Ms: 0, p95Ms: 0 };
  }
  return {
    count: values.length,
    minMs: Math.min(...values),
    maxMs: Math.max(...values),
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
  };
}

function roundMs(value: number): number {
  return Math.round(value * 10) / 10;
}

type HealthzCapture = {
  fetchMs: number[];
  gapMs: number[];
};

async function withHealthzProbe<T>(
  work: () => Promise<T>,
  intervalMs = 40,
): Promise<{ result: T; healthz: HealthzCapture; wallMs: number }> {
  const server = http.createServer((req, res) => {
    if (req.url === "/healthz" || req.url === "/health") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.end(JSON.stringify({ ok: true, status: "live" }));
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("healthz probe server failed to bind");
  }
  const url = `http://127.0.0.1:${address.port}/healthz`;
  const fetchMs: number[] = [];
  const gapMs: number[] = [];
  let probing = true;
  let lastAttemptAt = performance.now();
  const loop = (async () => {
    while (probing) {
      const attemptedAt = performance.now();
      gapMs.push(attemptedAt - lastAttemptAt);
      lastAttemptAt = attemptedAt;
      const started = performance.now();
      try {
        const response = await fetch(url);
        await response.text();
      } catch {
        // Count failed or delayed probes by wall time too.
      }
      fetchMs.push(performance.now() - started);
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  })();
  // Give the probe a couple of idle samples before the work starts.
  await new Promise((resolve) => setTimeout(resolve, intervalMs * 2));
  const wallStarted = performance.now();
  try {
    const result = await work();
    return { result, healthz: { fetchMs, gapMs }, wallMs: performance.now() - wallStarted };
  } finally {
    probing = false;
    await loop;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function main() {
  const { ensureKnowledgeUniverseScaleFixture, SCALE_OWNER_ID, SCALE_TENANT_ID, SCALE_SEAT_ID } =
    await import("../src/gateway/knowledge/testing/knowledge-universe-scale-fixture.js");
  const fixture = await ensureKnowledgeUniverseScaleFixture({ root: fixtureRoot });
  const {
    listKnowledgeBases,
  } = await import("../src/gateway/knowledge/knowledge-base-store.js");
  const { loadKnowledgeSourceBundleFromContext } = await import(
    "../src/gateway/knowledge/source-bundle.js"
  );
  const { resetKnowledgeSourceBundleCacheForTests, getKnowledgeSourceBundleCacheStats } =
    await import("../src/gateway/knowledge/source-bundle-cache.js");
  const { clearRelationshipRuntimeCache } = await import(
    "../src/gateway/knowledge/runtime/relationship-runtime.js"
  );
  const { invalidateRelationshipGraphCache } = await import(
    "../src/gateway/knowledge/runtime/relationship-runtime-cache.js"
  );
  const { resetKnowledgeIndexReadPoolForTests, getKnowledgeIndexReadPoolStats } = await import(
    "../src/gateway/knowledge/kb-index-read-pool.js"
  );

  const context = {
    userId: SCALE_OWNER_ID,
    tenantId: SCALE_TENANT_ID,
    seatId: SCALE_SEAT_ID,
    hasEnterpriseScope: true,
    agentType: "employee-agent" as const,
  };

  function resetReadCaches() {
    resetKnowledgeSourceBundleCacheForTests();
    clearRelationshipRuntimeCache();
    invalidateRelationshipGraphCache();
    resetKnowledgeIndexReadPoolForTests();
  }

  const homePaths = ["search", "relationships", "recommendations", "actions.list"] as const;

  async function timeHomeOpen(): Promise<{
    pathMs: Record<(typeof homePaths)[number], number>;
    slowestPath: (typeof homePaths)[number];
    slowestMs: number;
    cache: ReturnType<typeof getKnowledgeSourceBundleCacheStats>;
    listMs: number;
    listFinishedFirst: boolean;
  }> {
    const listStarted = performance.now();
    let listMs = 0;
    const listPromise = Promise.resolve().then(() => {
      const bases = listKnowledgeBases({
        ownerId: SCALE_OWNER_ID,
        tenantId: SCALE_TENANT_ID,
      });
      listMs = performance.now() - listStarted;
      return bases.length;
    });
    const pathStarted = performance.now();
    const pathMs = {} as Record<(typeof homePaths)[number], number>;
    const pathPromises = homePaths.map(async (label) => {
      await loadKnowledgeSourceBundleFromContext(context);
      pathMs[label] = performance.now() - pathStarted;
    });
    const [spaceCount] = await Promise.all([listPromise, ...pathPromises]);
    if (spaceCount < 1) {
      throw new Error("scale fixture produced no visible spaces");
    }
    let slowestPath: (typeof homePaths)[number] = homePaths[0];
    let slowestMs = 0;
    for (const label of homePaths) {
      if ((pathMs[label] ?? 0) > slowestMs) {
        slowestPath = label;
        slowestMs = pathMs[label] ?? 0;
      }
    }
    return {
      pathMs,
      slowestPath,
      slowestMs,
      cache: { ...getKnowledgeSourceBundleCacheStats() },
      listMs,
      listFinishedFirst: listMs < slowestMs,
    };
  }

  const idle = await withHealthzProbe(async () => {
    await new Promise((resolve) => setTimeout(resolve, 400));
  }, 20);

  // First in-process open (empty sqlite page cache / first schema touch in this process).
  resetReadCaches();
  const firstProcess = await withHealthzProbe(() => timeHomeOpen());

  // Official cache-miss "cold start": gateway already running, memory caches cleared,
  // OS page cache warm — the t316 analogue for a live process.
  resetReadCaches();
  const cold = await withHealthzProbe(() => timeHomeOpen());

  const cached = await withHealthzProbe(() => timeHomeOpen());

  resetReadCaches();
  const overlap = await withHealthzProbe(async () => {
    const started = performance.now();
    const waves = await Promise.all([timeHomeOpen(), timeHomeOpen(), timeHomeOpen()]);
    return {
      waves: waves.map((wave) => ({
        slowestPath: wave.slowestPath,
        slowestMs: wave.slowestMs,
        listMs: wave.listMs,
        listFinishedFirst: wave.listFinishedFirst,
        pathMs: wave.pathMs,
      })),
      wallMs: performance.now() - started,
      cache: { ...getKnowledgeSourceBundleCacheStats() },
    };
  });

  const report = {
    fixture: {
      indexMiB: Math.round((fixture.indexBytes / (1024 * 1024)) * 10) / 10,
      indexBytes: fixture.indexBytes,
      spaceCount: fixture.spaceCount,
      documentCount: fixture.documentCount,
      chunkCount: fixture.chunkCount,
      generated: fixture.generated,
    },
    idleHealthzMs: summarize(idle.healthz.fetchMs),
    firstProcessOpen: {
      slowestPath: firstProcess.result.slowestPath,
      slowestMs: roundMs(firstProcess.result.slowestMs),
      listMs: roundMs(firstProcess.result.listMs),
      listFinishedFirst: firstProcess.result.listFinishedFirst,
      cache: firstProcess.result.cache,
      healthzFetchMs: summarize(firstProcess.healthz.fetchMs),
      healthzGapMs: summarize(firstProcess.healthz.gapMs),
      wallMs: roundMs(firstProcess.wallMs),
    },
    cold: {
      pathMs: Object.fromEntries(
        Object.entries(cold.result.pathMs).map(([key, value]) => [key, roundMs(value)]),
      ),
      slowestPath: cold.result.slowestPath,
      slowestMs: roundMs(cold.result.slowestMs),
      listMs: roundMs(cold.result.listMs),
      listFinishedFirst: cold.result.listFinishedFirst,
      cache: cold.result.cache,
      healthzFetchMs: summarize(cold.healthz.fetchMs),
      healthzGapMs: summarize(cold.healthz.gapMs),
      wallMs: roundMs(cold.wallMs),
    },
    ttlSecondOpen: {
      pathMs: Object.fromEntries(
        Object.entries(cached.result.pathMs).map(([key, value]) => [key, roundMs(value)]),
      ),
      slowestPath: cached.result.slowestPath,
      slowestMs: roundMs(cached.result.slowestMs),
      listMs: roundMs(cached.result.listMs),
      listFinishedFirst: cached.result.listFinishedFirst,
      cache: cached.result.cache,
      healthzFetchMs: summarize(cached.healthz.fetchMs),
      healthzGapMs: summarize(cached.healthz.gapMs),
      wallMs: roundMs(cached.wallMs),
    },
    threeOverlap: {
      waveSlowestMs: overlap.result.waves.map((wave) => roundMs(wave.slowestMs)),
      wallMs: roundMs(overlap.result.wallMs),
      stackedToOneMinute: overlap.result.wallMs >= 60_000,
      cache: overlap.result.cache,
      healthzFetchMs: summarize(overlap.healthz.fetchMs),
      healthzGapMs: summarize(overlap.healthz.gapMs),
      listFinishedFirst: overlap.result.waves.every((wave) => wave.listFinishedFirst),
    },
    readPool: getKnowledgeIndexReadPoolStats(),
    t316Reference: {
      slowestPathWindowSec: "15-68",
      fourPathsEachBuiltFullGraph: true,
      threeOverlapBlockedEachOther: true,
    },
  };

  const outDir = path.join(fixtureRoot, "reports");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "t324-scale-measure.json");
  fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  const fmt = (stats: SampleStats) =>
    `n=${stats.count} min=${roundMs(stats.minMs)} p50=${roundMs(stats.p50Ms)} p95=${roundMs(stats.p95Ms)} max=${roundMs(stats.maxMs)}`;
  const lines = [
    `# t324 knowledge-universe scale measurement`,
    ``,
    `- index: ${report.fixture.indexMiB} MiB, spaces: ${report.fixture.spaceCount}, chunks: ${report.fixture.chunkCount || "(reused fixture)"}`,
    `- idle /healthz fetch (ms): ${fmt(report.idleHealthzMs)}`,
    `- first in-process open slowest: ${report.firstProcessOpen.slowestPath} ${report.firstProcessOpen.slowestMs} ms (list ${report.firstProcessOpen.listMs} ms, list-first=${report.firstProcessOpen.listFinishedFirst})`,
    `- first in-process /healthz gap (ms, includes event-loop stall): ${fmt(report.firstProcessOpen.healthzGapMs)}`,
    `- first in-process /healthz fetch (ms): ${fmt(report.firstProcessOpen.healthzFetchMs)}`,
    `- cold cache-miss (warm process) slowest path: ${report.cold.slowestPath} ${report.cold.slowestMs} ms (list ${report.cold.listMs} ms, list-first=${report.cold.listFinishedFirst})`,
    `- cold path ms: ${JSON.stringify(report.cold.pathMs)}`,
    `- cold cache: loads=${report.cold.cache.loads} joins=${report.cold.cache.joins} hits=${report.cold.cache.hits} misses=${report.cold.cache.misses}`,
    `- cold /healthz gap (ms): ${fmt(report.cold.healthzGapMs)}`,
    `- cold /healthz fetch (ms): ${fmt(report.cold.healthzFetchMs)}`,
    `- TTL second open slowest: ${report.ttlSecondOpen.slowestMs} ms (hits=${report.ttlSecondOpen.cache.hits})`,
    `- TTL second /healthz gap (ms): ${fmt(report.ttlSecondOpen.healthzGapMs)}`,
    `- three overlap wall: ${report.threeOverlap.wallMs} ms, wave slowest=${JSON.stringify(report.threeOverlap.waveSlowestMs)}, stackedToOneMinute=${report.threeOverlap.stackedToOneMinute}, loads=${report.threeOverlap.cache.loads}`,
    `- overlap /healthz gap (ms): ${fmt(report.threeOverlap.healthzGapMs)}`,
    `- t316 reference: 15-68s, four paths each built a full graph, three overlaps blocked each other`,
    `- report: ${outPath}`,
  ];
  console.log(lines.join("\n"));
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
