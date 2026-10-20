// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openKnowledgeIndex } from "./kb-index.js";
import {
  getWebSourceRefreshPolicyInIndex,
  listDueWebSourceRefreshInIndex,
  runDueWebSourceRefreshesInIndex,
  upsertWebSourceRefreshPolicyInIndex,
} from "./web-source-refresh-store.js";

// Interval above the 5-minute MIN_WEB_REFRESH_INTERVAL_MS floor so it is not clamped.
const INTERVAL = 600_000;

let dbDir: string;
let dbPath: string;

beforeEach(() => {
  dbDir = path.join(os.tmpdir(), `web-refresh-${randomUUID()}`);
  fs.mkdirSync(dbDir, { recursive: true });
  dbPath = path.join(dbDir, "index.db");
});

afterEach(() => {
  fs.rmSync(dbDir, { recursive: true, force: true });
});

describe("web-source-refresh-store", () => {
  it("schedules, lists due, and clears on disable", async () => {
    const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
    try {
      const kbId = "kb-refresh";
      const url = "https://example.com/p";
      upsertWebSourceRefreshPolicyInIndex(index.db, {
        kbId,
        url,
        docId: "doc-1",
        enabled: true,
        intervalMs: INTERVAL,
        nowMs: 1000,
      });
      // Not due before the interval elapses, due after.
      expect(listDueWebSourceRefreshInIndex(index.db, { kbId, nowMs: 2000 })).toHaveLength(0);
      expect(
        listDueWebSourceRefreshInIndex(index.db, { kbId, nowMs: 1000 + INTERVAL + 1 }),
      ).toHaveLength(1);

      // Disabling clears the schedule.
      upsertWebSourceRefreshPolicyInIndex(index.db, {
        kbId,
        url,
        enabled: false,
        nowMs: 3000,
      });
      const disabled = getWebSourceRefreshPolicyInIndex(index.db, kbId, url);
      expect(disabled?.enabled).toBe(false);
      expect(disabled?.nextDueAtMs).toBeNull();
      expect(listDueWebSourceRefreshInIndex(index.db, { kbId, nowMs: 9_999_999 })).toHaveLength(0);
    } finally {
      index.close();
    }
  });

  it("runs due refreshes: fetch → snapshot → reschedule, with change detection", async () => {
    const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
    try {
      const kbId = "kb-run";
      const url = "https://example.com/changing";
      upsertWebSourceRefreshPolicyInIndex(index.db, {
        kbId,
        url,
        docId: "doc-1",
        enabled: true,
        intervalMs: INTERVAL,
        nowMs: 1000,
      });

      let call = 0;
      const fetcher = async (target: string) => {
        call += 1;
        return { text: `revision ${call} for ${target} with distinct words ${call}` };
      };

      const firstRunAt = 1000 + INTERVAL + 1;
      const first = await runDueWebSourceRefreshesInIndex(index.db, {
        kbId,
        nowMs: firstRunAt,
        fetcher,
      });
      expect(first).toHaveLength(1);
      expect(first[0]?.status).toBe("initial");
      const afterFirst = getWebSourceRefreshPolicyInIndex(index.db, kbId, url);
      expect(afterFirst?.lastRefreshedAtMs).toBe(firstRunAt);
      expect(afterFirst?.nextDueAtMs).toBe(firstRunAt + INTERVAL);
      expect(afterFirst?.lastStatus).toBe("initial");

      const second = await runDueWebSourceRefreshesInIndex(index.db, {
        kbId,
        nowMs: firstRunAt + INTERVAL + 1,
        fetcher,
      });
      expect(second[0]?.status).toBe("changed");
    } finally {
      index.close();
    }
  });

  it("records an error status but still reschedules on fetch failure", async () => {
    const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
    try {
      const kbId = "kb-err";
      const url = "https://example.com/broken";
      upsertWebSourceRefreshPolicyInIndex(index.db, {
        kbId,
        url,
        enabled: true,
        intervalMs: INTERVAL,
        nowMs: 1000,
      });
      const runAt = 1000 + INTERVAL + 1;
      const results = await runDueWebSourceRefreshesInIndex(index.db, {
        kbId,
        nowMs: runAt,
        fetcher: async () => {
          throw new Error("network down");
        },
      });
      expect(results[0]?.status).toBe("error");
      expect(results[0]?.error).toContain("network down");
      const policy = getWebSourceRefreshPolicyInIndex(index.db, kbId, url);
      expect(policy?.lastStatus).toBe("error");
      expect(policy?.nextDueAtMs).toBe(runAt + INTERVAL);
    } finally {
      index.close();
    }
  });
});
