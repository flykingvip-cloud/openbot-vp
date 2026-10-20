/**
 * Projection durable store, embedding provider resolution, retention cron helpers.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  FileProjectionStore,
  buildRuleProjection,
  embedConversationQuery,
  ensureConversationRetentionCronJob,
  isRetentionCronTickText,
  RETENTION_CRON_JOB_NAME,
  RETENTION_CRON_TICK_TEXT,
  resolveConversationEmbeddingProvider,
  resolveProjectionStoreDir,
  runConversationRetentionCronTick,
  resetProjectionStoreCache,
} from "./index.js";

describe("projection durable store", () => {
  const roots: string[] = [];
  afterEach(async () => {
    resetProjectionStoreCache();
    for (const r of roots.splice(0)) {
      await fs.rm(r, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("persists projection and dedup key under data root", async () => {
    const dataRoot = path.join(os.tmpdir(), `proj-store-${Date.now()}`);
    roots.push(dataRoot);
    const dir = resolveProjectionStoreDir({ dataRoot });
    const store = new FileProjectionStore(dir);
    const projection = buildRuleProjection({
      conversationId: "conv_persist_1",
      participants: ["u1"],
      userTexts: ["Ship durable projection"],
      sources: [
        {
          sourceIdentityId: "msrc_1",
          bindingId: "b1",
          sessionId: "s1",
          firstTurnId: "0",
          lastTurnId: "1",
          sourceChecksum: "abc",
        },
      ],
    });
    await store.save(projection, "dedup-key-1");
    const loaded = await store.get("conv_persist_1");
    expect(loaded?.shortSummary).toContain("Ship durable projection");
    expect(await store.getDedupKey("conv_persist_1")).toBe("dedup-key-1");
    // Survives new store instance
    const store2 = new FileProjectionStore(dir);
    expect((await store2.get("conv_persist_1"))?.revision).toBe(1);
  });
});

describe("conversation embeddings", () => {
  it("uses hash fallback when forced", async () => {
    const provider = await resolveConversationEmbeddingProvider({ forceHash: true });
    expect(provider.isRealModel).toBe(false);
    expect(provider.id).toBe("hash");
    const vec = await provider.embedQuery("hello world");
    expect(vec.length).toBe(64);
    const q = await embedConversationQuery({ text: "hello world", cfg: null });
    expect(q.isRealModel).toBe(false);
    expect(q.embedding.length).toBe(64);
  });
});

describe("retention cron", () => {
  it("recognizes tick text and ensures job idempotently", async () => {
    expect(isRetentionCronTickText(RETENTION_CRON_TICK_TEXT)).toBe(true);
    expect(isRetentionCronTickText("other")).toBe(false);

    const jobs: Array<{ id: string; name: string }> = [];
    const cron = {
      list: async () => jobs,
      add: async (input: { name: string }) => {
        const job = { id: `job-${jobs.length + 1}`, name: input.name };
        jobs.push(job);
        return job;
      },
    };
    const first = await ensureConversationRetentionCronJob({ cron, everyMs: 60_000 });
    expect(first.created).toBe(true);
    expect(jobs[0]?.name).toBe(RETENTION_CRON_JOB_NAME);
    const second = await ensureConversationRetentionCronJob({ cron, everyMs: 60_000 });
    expect(second.created).toBe(false);
    expect(second.existingId).toBe(jobs[0]?.id);
    expect(jobs).toHaveLength(1);
  });

  it("retention tick runs against local catalog without throw", async () => {
    const dataRoot = path.join(os.tmpdir(), `ret-cron-${Date.now()}`);
    const stateDir = path.join(os.tmpdir(), `ret-cron-state-${Date.now()}`);
    try {
      process.env.OPENCLAW_STATE_DIR = stateDir;
      const cfg = {
        data: { root: dataRoot, mode: "local" as const, schemaVersion: 1 },
      };
      const result = await runConversationRetentionCronTick({
        cfg,
        enforce: false,
        migrateCold: false,
        limit: 10,
      });
      expect(result.ok).toBe(true);
      expect(result.evaluated).toBeGreaterThanOrEqual(0);
    } finally {
      delete process.env.OPENCLAW_STATE_DIR;
      await fs.rm(dataRoot, { recursive: true, force: true }).catch(() => undefined);
      await fs.rm(stateDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});
