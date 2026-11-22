import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  acquireKnowledgeIndexRead,
  getKnowledgeIndexReadPoolStats,
  resetKnowledgeIndexReadPoolForTests,
} from "./kb-index-read-pool.js";
import { openKnowledgeIndex } from "./kb-index.js";
import { invalidateKnowledgeSourceBundleCache } from "./source-bundle-cache.js";

describe("knowledge index read pool", () => {
  const dirs: string[] = [];

  afterEach(() => {
    resetKnowledgeIndexReadPoolForTests();
    for (const dir of dirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  async function makeIndex() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kb-index-pool-"));
    dirs.push(dir);
    const dbPath = path.join(dir, "index.db");
    const created = await openKnowledgeIndex({ dbPath, vectorEnabled: false, ftsEnabled: false });
    created.close();
    return dbPath;
  }

  it("reuses one connection for the same path until invalidation", async () => {
    const dbPath = await makeIndex();
    const first = await acquireKnowledgeIndexRead({
      dbPath,
      vectorEnabled: false,
      ftsEnabled: false,
    });
    const second = await acquireKnowledgeIndexRead({
      dbPath,
      vectorEnabled: false,
      ftsEnabled: false,
    });
    expect(first.db).toBe(second.db);
    expect(getKnowledgeIndexReadPoolStats()).toEqual({ size: 1, refs: 2 });
    first.close();
    second.close();
    expect(getKnowledgeIndexReadPoolStats()).toEqual({ size: 1, refs: 0 });
    invalidateKnowledgeSourceBundleCache();
    expect(getKnowledgeIndexReadPoolStats()).toEqual({ size: 0, refs: 0 });
    const third = await acquireKnowledgeIndexRead({
      dbPath,
      vectorEnabled: false,
      ftsEnabled: false,
    });
    const row = third.db.prepare("SELECT COUNT(*) AS count FROM documents").get() as {
      count: number;
    };
    expect(row.count).toBe(0);
    expect(getKnowledgeIndexReadPoolStats().size).toBe(1);
    third.close();
  });
});
