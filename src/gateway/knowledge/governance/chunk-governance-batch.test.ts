import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openKnowledgeIndex } from "../kb-index.js";
import {
  getChunkRelationBreakdown,
  getChunkRelationBreakdownByKnowledgeBase,
  sumChunkReferenceCounts,
  sumChunkReferenceCountsByKnowledgeBase,
} from "./chunk-governance-store.js";

describe("batched governance projection queries", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("matches per-base breakdown and citation totals", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gov-batch-"));
    dirs.push(dir);
    const dbPath = path.join(dir, "index.db");
    const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false, ftsEnabled: false });
    try {
      const now = Date.now();
      index.db.exec(`
        INSERT INTO chunk_relations (id, kb_id, from_chunk, to_chunk, relation_type, weight, created_at)
        VALUES
          ('r1', 'kb-a', 'c1', 'c2', 'reference', 1, ${now}),
          ('r2', 'kb-a', 'c3', 'c4', 'conflict', 1, ${now}),
          ('r3', 'kb-b', 'c5', 'c6', 'duplicate', 1, ${now});
        INSERT INTO chunk_governance (chunk_id, kb_id, reference_count)
        VALUES
          ('c1', 'kb-a', 3),
          ('c2', 'kb-a', 4),
          ('c5', 'kb-b', 9);
      `);
      const kbIds = ["kb-a", "kb-b", "kb-empty"];
      const batched = getChunkRelationBreakdownByKnowledgeBase(index.db, kbIds);
      for (const id of kbIds) {
        expect(batched.get(id)).toEqual(getChunkRelationBreakdown(index.db, id));
      }
      const sums = sumChunkReferenceCountsByKnowledgeBase(index.db, kbIds);
      for (const id of kbIds) {
        expect(sums.get(id)).toBe(sumChunkReferenceCounts(index.db, id));
      }
    } finally {
      index.close();
    }
  });
});
