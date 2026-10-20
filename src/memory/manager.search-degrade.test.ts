import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFastShortTimeouts } from "../../test/helpers/fast-short-timeouts.js";
import type { OpenBotConfig } from "../config/config.js";
import type { MemoryIndexManager } from "./index.js";
import { MemoryIndexManager as MemoryIndexManagerClass } from "./manager.js";
import { createOpenAIEmbeddingProviderMock } from "./test-embeddings-mock.js";
import { createMemoryManagerOrThrow } from "./test-manager.js";

const embedBatch = vi.fn(
  async (input: string[]): Promise<number[][]> => input.map(() => [0.2, 0.2, 0.2]),
);
const embedQuery = vi.fn(async (_input: string): Promise<number[]> => [0.2, 0.2, 0.2]);

vi.mock("./embeddings.js", () => ({
  createEmbeddingProvider: async (_options: unknown) =>
    createOpenAIEmbeddingProviderMock({
      embedQuery: embedQuery as unknown as (input: string) => Promise<number[]>,
      embedBatch: embedBatch as unknown as (input: string[]) => Promise<number[][]>,
    }),
}));

describe("memory search embedding degrade", () => {
  let workspaceDir: string;
  let indexPath: string;
  let manager: MemoryIndexManager | null = null;
  let keywordSpy: { mockRestore: () => void } | null = null;

  const buildConfig = (opts?: { hybrid?: boolean }): OpenBotConfig =>
    ({
      agents: {
        defaults: {
          workspace: workspaceDir,
          memorySearch: {
            provider: "openai",
            model: "text-embedding-3-small",
            store: { path: indexPath, vector: { enabled: false } },
            sync: { watch: false, onSessionStart: false, onSearch: false },
            query: {
              minScore: 0.01,
              hybrid: {
                enabled: opts?.hybrid ?? true,
                vectorWeight: 0.7,
                textWeight: 0.3,
              },
            },
            remote: { batch: { enabled: false, wait: false } },
          },
        },
        list: [{ id: "main", default: true }],
      },
    }) as OpenBotConfig;

  beforeEach(async () => {
    embedBatch.mockReset();
    embedQuery.mockReset();
    embedBatch.mockImplementation(async (input: string[]) => input.map(() => [0.2, 0.2, 0.2]));
    embedQuery.mockImplementation(async () => [0.2, 0.2, 0.2]);
    keywordSpy?.mockRestore();
    keywordSpy = null;
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-mem-degrade-"));
    indexPath = path.join(workspaceDir, "index.sqlite");
    await fs.mkdir(path.join(workspaceDir, "memory"));
    await fs.writeFile(
      path.join(workspaceDir, "memory", "2026-01-09.md"),
      "alpha project notes about launch readiness\n",
    );
  });

  afterEach(async () => {
    keywordSpy?.mockRestore();
    keywordSpy = null;
    if (manager) {
      await manager.close();
      manager = null;
    }
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  it("retries query 429 then returns vector/hybrid results", async () => {
    manager = await createMemoryManagerOrThrow(buildConfig());
    await manager.sync({ reason: "test" });

    let calls = 0;
    embedQuery.mockImplementation(async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error("429 Too Many Requests");
      }
      return [0.2, 0.2, 0.2];
    });

    const restore = useFastShortTimeouts();
    try {
      const results = await manager.search("launch readiness");
      expect(calls).toBe(2);
      expect(results.length).toBeGreaterThan(0);
      const status = manager.status();
      expect(status.custom?.degraded).toBe(false);
      expect(status.custom?.searchMode).toBe("hybrid");
    } finally {
      restore();
    }
  });

  it("returns keyword-only degraded results when query retries exhaust and FTS is available", async () => {
    manager = await createMemoryManagerOrThrow(buildConfig({ hybrid: true }));
    await manager.sync({ reason: "test" });
    expect(manager.status().fts?.available).toBe(true);

    keywordSpy = vi
      .spyOn(
        MemoryIndexManagerClass.prototype as unknown as {
          searchKeyword: (...args: unknown[]) => Promise<unknown>;
        },
        "searchKeyword",
      )
      .mockResolvedValue([
        {
          id: "kw-1",
          path: "memory/2026-01-09.md",
          startLine: 1,
          endLine: 1,
          score: 0.4,
          textScore: 0.4,
          snippet: "alpha project notes about launch readiness",
          source: "memory",
        },
      ]);

    embedQuery.mockImplementation(async () => {
      throw new Error("429 Too Many Requests api_key=sk-abcdefghijklmnopqrst");
    });

    const restore = useFastShortTimeouts();
    try {
      const results = await manager.search("launch");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.path).toContain("2026-01-09.md");
      const status = manager.status();
      expect(status.custom).toMatchObject({
        searchMode: "fts-only",
        degraded: true,
        degradeReason: "rate_limit",
        degradeRetryable: true,
      });
      const degradeError =
        typeof status.custom?.degradeError === "string" ? status.custom.degradeError : "";
      expect(degradeError).not.toMatch(/sk-abcdefghijklmnopqrst/);
    } finally {
      restore();
    }
  });

  it("throws structured failure when query embedding fails and FTS is unavailable", async () => {
    manager = await createMemoryManagerOrThrow(buildConfig({ hybrid: false }));
    await manager.sync({ reason: "test" });

    embedQuery.mockImplementation(async () => {
      throw new Error("429 Too Many Requests");
    });

    const restore = useFastShortTimeouts();
    try {
      await expect(manager.search("launch readiness")).rejects.toThrow(/429 Too Many Requests/);
      const status = manager.status();
      expect(status.custom?.degraded).toBe(false);
      expect(status.custom?.searchMode).toBe("vector");
    } finally {
      restore();
    }
  });

  it("does not retry billing failures on query embedding", async () => {
    manager = await createMemoryManagerOrThrow(buildConfig({ hybrid: false }));
    await manager.sync({ reason: "test" });

    let calls = 0;
    embedQuery.mockImplementation(async () => {
      calls += 1;
      throw new Error("openai embeddings failed: 429 insufficient_quota");
    });

    await expect(manager.search("launch")).rejects.toThrow(/insufficient_quota/);
    expect(calls).toBe(1);
  });
});
