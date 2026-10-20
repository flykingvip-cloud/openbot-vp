// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  computeKnowledgeHealthScore,
  listGovernanceTasks,
} from "./governance/chunk-governance-store.js";
import { runStaleScan } from "./governance/detection/stale-detector.js";
import { openKnowledgeIndex, resolveKnowledgeIndexDbPath } from "./kb-index.js";
import { ingestKnowledgeDocument } from "./kb-ingest.js";
import {
  listKnowledgeLineageByDeliverable,
  listKnowledgeLineageByLineageId,
  upsertKnowledgeLineage,
} from "./knowledge-lineage-store.js";

let indexRoot: string;

beforeEach(() => {
  indexRoot = path.join(os.tmpdir(), `kb-runtime-p0-${randomUUID()}`);
});

afterEach(() => {
  fs.rmSync(indexRoot, { recursive: true, force: true });
});

describe("knowledge runtime p0", () => {
  it("persists generation and commit lineage records", async () => {
    const dbPath = resolveKnowledgeIndexDbPath({
      ownerId: "user-lineage",
      tenantId: null,
      indexRoot,
    });
    const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
    try {
      upsertKnowledgeLineage({
        db: index.db,
        lineageId: "lin-1",
        kind: "generation",
        sourceChunkIds: ["chunk-1"],
        sourceKnowledgeBaseIds: ["kb-a"],
        sourceAgentIds: ["agent-a"],
      });
      upsertKnowledgeLineage({
        db: index.db,
        lineageId: "lin-1",
        kind: "commit",
        deliverableId: "skill:asset-1",
        sourceChunkIds: ["chunk-1"],
        sourceKnowledgeBaseIds: ["kb-a", "kb-archive"],
      });

      expect(listKnowledgeLineageByLineageId(index.db, "lin-1")).toHaveLength(2);
      expect(listKnowledgeLineageByDeliverable(index.db, "skill:asset-1")[0]?.kind).toBe("commit");
    } finally {
      index.close();
    }
  });

  it("computes health penalties from governance summary", () => {
    expect(
      computeKnowledgeHealthScore({
        openConflictCount: 1,
        openClaimConflictCount: 1,
        openDuplicateCount: 1,
        openStaleCount: 1,
        openOrphanCount: 1,
      }),
    ).toBe(77);
  });

  it("creates stale tasks for old indexed chunks", async () => {
    const ownerId = "user-stale";
    const kbId = "kb-stale";
    await ingestKnowledgeDocument({
      kbId,
      docId: "doc-old",
      title: "Old policy",
      fileName: "old.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("Old policy content", "utf8"),
      ownerId,
      tenantId: null,
      indexRoot,
      embeddingProvider: null,
      publishedAt: 1,
    });

    const dbPath = resolveKnowledgeIndexDbPath({ ownerId, tenantId: null, indexRoot });
    const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
    try {
      const result = runStaleScan({ db: index.db, kbId, now: Date.now() });
      expect(result.tasksCreated).toBeGreaterThan(0);
      expect(
        listGovernanceTasks({ db: index.db, kbId, status: "open" }).some(
          (task) => task.taskType === "stale",
        ),
      ).toBe(true);
    } finally {
      index.close();
    }
  });
});
