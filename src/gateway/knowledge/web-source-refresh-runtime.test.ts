// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openKnowledgeIndex, resolveKnowledgeIndexDbPath } from "./kb-index.js";
import { tickDueWebSourceRefreshes } from "./web-source-refresh-runtime.js";
import { upsertWebSourceRefreshPolicyInIndex } from "./web-source-refresh-store.js";

let indexRoot: string;

beforeEach(() => {
  indexRoot = path.join(os.tmpdir(), `web-refresh-tick-${randomUUID()}`);
});

afterEach(() => {
  fs.rmSync(indexRoot, { recursive: true, force: true });
});

describe("web-source-refresh-runtime", () => {
  it("scans every owner index and refreshes due web sources", async () => {
    const dbPath = resolveKnowledgeIndexDbPath({
      ownerId: "user-tick",
      tenantId: null,
      indexRoot,
    });
    const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
    try {
      upsertWebSourceRefreshPolicyInIndex(index.db, {
        kbId: "kb-1",
        url: "https://example.com/changing",
        docId: "doc-1",
        enabled: true,
        intervalMs: 600_000,
        nowMs: 1000,
      });
    } finally {
      index.close();
    }

    let calls = 0;
    const result = await tickDueWebSourceRefreshes({
      indexRoot,
      nowMs: 1000 + 600_000 + 1,
      fetcher: async () => {
        calls += 1;
        return { text: `revision ${calls} with distinct words` };
      },
    });
    expect(calls).toBe(1);
    expect(result.databases).toBe(1);
    expect(result.refreshed).toBe(1);
  });

  it("returns empty when the index root does not exist", async () => {
    const result = await tickDueWebSourceRefreshes({
      indexRoot: path.join(indexRoot, "missing"),
      fetcher: async () => ({ text: "x" }),
    });
    expect(result).toEqual({ databases: 0, refreshed: 0, changed: 0, errors: 0 });
  });
});
