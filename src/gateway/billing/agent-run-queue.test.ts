// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  __resetAgentRunQueueForTest,
  acquireAgentRunSlotWithQueuePolicy,
  enqueueAgentRun,
  listQueuedAgentRuns,
} from "./agent-run-queue.js";
import {
  __resetAgentRunRegistryForTest,
  finishAgentRun,
  tryAcquireAgentRunSlot,
} from "./agent-run-registry.js";

async function tempPaths(): Promise<{ registry: string; queue: string; dir: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-arq-"));
  return {
    dir,
    registry: path.join(dir, "registry.json"),
    queue: path.join(dir, "queue.json"),
  };
}

describe("agent-run-queue", () => {
  it("block mode does not enqueue when concurrency is full", async () => {
    const paths = await tempPaths();
    await __resetAgentRunRegistryForTest(paths.registry);
    await __resetAgentRunQueueForTest(paths.queue);

    const base = {
      enterpriseId: "ent-q",
      maxConcurrentRuns: 1,
      allowBurstConcurrency: false,
      concurrencyMode: "block" as const,
    };
    const first = await acquireAgentRunSlotWithQueuePolicy(
      { ...base, runId: "r1" },
      { registryStorePath: paths.registry, queueStorePath: paths.queue },
    );
    expect(first.ok).toBe(true);

    const second = await acquireAgentRunSlotWithQueuePolicy(
      { ...base, runId: "r2" },
      { registryStorePath: paths.registry, queueStorePath: paths.queue },
    );
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.reason).toBe("CONCURRENCY_LIMIT_EXCEEDED");
    }
    expect(await listQueuedAgentRuns("ent-q", paths.queue)).toHaveLength(0);

    await fs.rm(paths.dir, { recursive: true, force: true });
  });

  it("queue mode waits until a slot is released", async () => {
    const paths = await tempPaths();
    await __resetAgentRunRegistryForTest(paths.registry);
    await __resetAgentRunQueueForTest(paths.queue);

    const base = {
      enterpriseId: "ent-q2",
      maxConcurrentRuns: 1,
      maxBurstRuns: 1,
      allowBurstConcurrency: true,
      concurrencyMode: "queue" as const,
    };

    const first = await tryAcquireAgentRunSlot({ ...base, runId: "run-a" }, paths.registry);
    expect(first.ok).toBe(true);

    const waitPromise = acquireAgentRunSlotWithQueuePolicy(
      { ...base, runId: "run-b" },
      {
        maxWaitMs: 5_000,
        pollIntervalMs: 25,
        registryStorePath: paths.registry,
        queueStorePath: paths.queue,
      },
    );

    await new Promise((r) => setTimeout(r, 30));
    const queued = await listQueuedAgentRuns("ent-q2", paths.queue);
    expect(queued).toHaveLength(1);
    expect(queued[0]?.runId).toBe("run-b");

    await finishAgentRun("run-a", paths.registry);

    const second = await waitPromise;
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.record.runId).toBe("run-b");
    }
    expect(await listQueuedAgentRuns("ent-q2", paths.queue)).toHaveLength(0);

    await fs.rm(paths.dir, { recursive: true, force: true });
  });

  it("returns CONCURRENCY_QUEUE_TIMEOUT when wait exceeds maxWaitMs", async () => {
    const paths = await tempPaths();
    await __resetAgentRunRegistryForTest(paths.registry);
    await __resetAgentRunQueueForTest(paths.queue);

    const base = {
      enterpriseId: "ent-q3",
      maxConcurrentRuns: 1,
      allowBurstConcurrency: false,
      concurrencyMode: "queue" as const,
    };
    await tryAcquireAgentRunSlot({ ...base, runId: "holder" }, paths.registry);

    const result = await acquireAgentRunSlotWithQueuePolicy(
      { ...base, runId: "waiter" },
      {
        maxWaitMs: 80,
        pollIntervalMs: 20,
        registryStorePath: paths.registry,
        queueStorePath: paths.queue,
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("CONCURRENCY_QUEUE_TIMEOUT");
    }
    expect(await listQueuedAgentRuns("ent-q3", paths.queue)).toHaveLength(0);

    await fs.rm(paths.dir, { recursive: true, force: true });
  });

  it("enqueue is idempotent per runId", async () => {
    const paths = await tempPaths();
    await __resetAgentRunQueueForTest(paths.queue);
    const a = await enqueueAgentRun({ runId: "x1", enterpriseId: "ent" }, paths.queue);
    const b = await enqueueAgentRun({ runId: "x1", enterpriseId: "ent" }, paths.queue);
    expect(a.position).toBe(1);
    expect(b.position).toBe(1);
    expect(await listQueuedAgentRuns("ent", paths.queue)).toHaveLength(1);
    await fs.rm(paths.dir, { recursive: true, force: true });
  });
});
