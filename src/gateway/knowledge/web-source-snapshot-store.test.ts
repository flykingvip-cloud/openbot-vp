// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openKnowledgeIndex } from "./kb-index.js";
import {
  computeWebContentChangeRatio,
  recordWebSourceSnapshotInIndex,
  summarizeWebSourceSnapshotsByUrl,
} from "./web-source-snapshot-store.js";

let dbDir: string;
let dbPath: string;

beforeEach(() => {
  dbDir = path.join(os.tmpdir(), `web-snap-${randomUUID()}`);
  fs.mkdirSync(dbDir, { recursive: true });
  dbPath = path.join(dbDir, "index.db");
});

afterEach(() => {
  fs.rmSync(dbDir, { recursive: true, force: true });
});

describe("web-source-snapshot-store", () => {
  it("computes a word-set Jaccard change ratio", () => {
    expect(computeWebContentChangeRatio("alpha beta gamma", "alpha beta gamma")).toBe(0);
    expect(computeWebContentChangeRatio("alpha beta", "delta epsilon")).toBe(1);
    const partial = computeWebContentChangeRatio(
      "alpha beta gamma delta",
      "alpha beta gamma other",
    );
    expect(partial).toBeGreaterThan(0);
    expect(partial).toBeLessThan(1);
  });

  it("classifies initial / unchanged / changed snapshots keyed by url", async () => {
    const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
    try {
      const kbId = "kb-snap";
      const url = "https://example.com/pricing";
      const first = recordWebSourceSnapshotInIndex(index.db, {
        kbId,
        docId: "doc-a",
        url,
        text: "Enterprise plan includes priority support and single sign-on.",
        fetchedAtMs: 1000,
      });
      expect(first.changeKind).toBe("initial");
      expect(first.changeRatio).toBeNull();

      const second = recordWebSourceSnapshotInIndex(index.db, {
        kbId,
        docId: "doc-b",
        url,
        text: "Enterprise plan includes priority support and single sign-on.",
        fetchedAtMs: 2000,
      });
      expect(second.changeKind).toBe("unchanged");
      expect(second.changeRatio).toBe(0);

      const third = recordWebSourceSnapshotInIndex(index.db, {
        kbId,
        docId: "doc-c",
        url,
        text: "Enterprise plan now adds audit logs, SCIM provisioning, and a new uptime SLA.",
        fetchedAtMs: 3000,
      });
      expect(third.changeKind).toBe("changed");
      expect(third.changeRatio).toBeGreaterThan(0);

      const summary = summarizeWebSourceSnapshotsByUrl(index.db, kbId).get(url);
      expect(summary?.snapshotCount).toBe(3);
      expect(summary?.lastFetchedAtMs).toBe(3000);
      expect(summary?.changeKind).toBe("changed");
      expect(summary?.changeRatio).toBeGreaterThan(0);
      expect(summary?.lastChangedAtMs).toBe(3000);
    } finally {
      index.close();
    }
  });
});
