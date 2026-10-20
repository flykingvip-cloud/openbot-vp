// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildGovernanceActionSuggestions } from "./actions/action-engine.js";
import {
  projectGovernanceDiscoveryEvents,
  projectLineageDiscoveryEvents,
  projectUsageDiscoveryEvents,
} from "./discovery/event-projector.js";
import {
  createGovernanceTask,
  ensureChunkGovernanceRows,
  getChunkRelationBreakdown,
  getChunkScoreAverages,
  listRecentChunkRelations,
  recordChunkRetrievalHits,
  sumChunkReferenceCounts,
} from "./governance/chunk-governance-store.js";
import { openKnowledgeIndex, resolveKnowledgeIndexDbPath } from "./kb-index.js";
import {
  countActiveAgentsForKnowledgeBase,
  listRecentKnowledgeLineageCommits,
  upsertKnowledgeLineage,
} from "./knowledge-lineage-store.js";

let indexRoot: string;

beforeEach(() => {
  indexRoot = path.join(os.tmpdir(), `kb-runtime-p1-${randomUUID()}`);
});

afterEach(() => {
  fs.rmSync(indexRoot, { recursive: true, force: true });
});

describe("knowledge runtime p1", () => {
  it("projects governance and lineage discovery events with event semantics", async () => {
    const kbId = "kb-discovery";
    const dbPath = resolveKnowledgeIndexDbPath({
      ownerId: "user-discovery",
      tenantId: null,
      indexRoot,
    });
    const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
    try {
      createGovernanceTask({
        db: index.db,
        kbId,
        taskType: "duplicate",
        relatedChunkIds: ["chunk-a", "chunk-b"],
        priority: 5,
      });
      upsertKnowledgeLineage({
        db: index.db,
        lineageId: "lin-commit-1",
        kind: "commit",
        deliverableId: "skill:asset-1",
        sourceKnowledgeBaseIds: [kbId],
      });

      const sinceMs = Date.now() - 60_000;
      const events = [
        ...projectGovernanceDiscoveryEvents(index.db, sinceMs),
        ...projectLineageDiscoveryEvents(index.db, sinceMs),
      ];

      expect(events.some((event) => event.eventType === "new_duplicate")).toBe(true);
      expect(events.some((event) => event.eventType === "knowledge_committed")).toBe(true);
      expect(events.every((event) => event.eventSource && event.timestamp > 0)).toBe(true);
      expect(
        listRecentKnowledgeLineageCommits(index.db, { limit: 5, sinceMs: sinceMs }).length,
      ).toBe(1);
    } finally {
      index.close();
    }
  });

  it("builds governance action suggestions from open tasks", async () => {
    const kbId = "kb-actions";
    const dbPath = resolveKnowledgeIndexDbPath({
      ownerId: "user-actions",
      tenantId: null,
      indexRoot,
    });
    const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
    try {
      const taskId = createGovernanceTask({
        db: index.db,
        kbId,
        taskType: "conflict",
        relatedChunkIds: ["chunk-1"],
        priority: 8,
      });

      const actions = buildGovernanceActionSuggestions({
        db: index.db,
        knowledgeBaseId: kbId,
        limit: 4,
      });

      expect(actions[0]?.actionType).toBe("review_conflict");
      expect(actions[0]?.context.governanceTaskId).toBe(taskId);
      expect(actions[0]?.executable).toBe(true);
      expect(actions[0]?.evidence?.length).toBeGreaterThan(0);
      expect(actions[0]?.trustLabel).toBeTruthy();
      expect(listRecentChunkRelations(index.db, { kbId, limit: 5, sinceMs: 0 })).toEqual([]);
    } finally {
      index.close();
    }
  });

  it("projects frequently_cited discovery events once a chunk crosses the citation threshold", async () => {
    const kbId = "kb-usage";
    const dbPath = resolveKnowledgeIndexDbPath({
      ownerId: "user-usage",
      tenantId: null,
      indexRoot,
    });
    const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
    try {
      ensureChunkGovernanceRows({ db: index.db, kbId, chunkIds: ["hot-chunk", "cold-chunk"] });
      // Simulate 6 retrieval hits on one chunk (>= threshold 5) and 1 on the other.
      for (let i = 0; i < 6; i += 1) {
        recordChunkRetrievalHits({ db: index.db, chunkIds: ["hot-chunk"] });
      }
      recordChunkRetrievalHits({ db: index.db, chunkIds: ["cold-chunk"] });

      const events = projectUsageDiscoveryEvents(index.db, Date.now() - 60_000);
      expect(events).toHaveLength(1);
      const hot = events[0];
      expect(hot.eventType).toBe("frequently_cited");
      expect(hot.eventSource).toBe("usage");
      expect(hot.relatedKnowledge.kbId).toBe(kbId);
      expect(hot.relatedKnowledge.chunkIds).toEqual(["hot-chunk"]);
      expect(hot.relatedKnowledge.referenceCount).toBe(6);
    } finally {
      index.close();
    }
  });

  it("sums chunk reference counts across a knowledge base for the citation metric", async () => {
    const kbId = "kb-citations";
    const dbPath = resolveKnowledgeIndexDbPath({
      ownerId: "user-citations",
      tenantId: null,
      indexRoot,
    });
    const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
    try {
      ensureChunkGovernanceRows({ db: index.db, kbId, chunkIds: ["c1", "c2"] });
      for (let i = 0; i < 3; i += 1) {
        recordChunkRetrievalHits({ db: index.db, chunkIds: ["c1"] });
      }
      recordChunkRetrievalHits({ db: index.db, chunkIds: ["c2"] });

      expect(sumChunkReferenceCounts(index.db, kbId)).toBe(4);
      expect(sumChunkReferenceCounts(index.db, "kb-empty")).toBe(0);
    } finally {
      index.close();
    }
  });

  it("counts distinct active agents that consumed a knowledge base from lineage", async () => {
    const kbId = "kb-active-agents";
    const dbPath = resolveKnowledgeIndexDbPath({
      ownerId: "user-active-agents",
      tenantId: null,
      indexRoot,
    });
    const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
    try {
      upsertKnowledgeLineage({
        db: index.db,
        lineageId: "lin-a",
        kind: "generation",
        agentId: "agent-sales",
        sourceKnowledgeBaseIds: [kbId],
      });
      upsertKnowledgeLineage({
        db: index.db,
        lineageId: "lin-b",
        kind: "commit",
        deliverableId: "skill:x",
        sourceKnowledgeBaseIds: [kbId],
        sourceAgentIds: ["agent-market"],
      });
      // Different KB — must not count.
      upsertKnowledgeLineage({
        db: index.db,
        lineageId: "lin-c",
        kind: "generation",
        agentId: "agent-other",
        sourceKnowledgeBaseIds: ["kb-unrelated"],
      });
      // Same agent on the same KB again — must be deduped.
      upsertKnowledgeLineage({
        db: index.db,
        lineageId: "lin-d",
        kind: "generation",
        agentId: "agent-sales",
        sourceKnowledgeBaseIds: [kbId],
      });

      expect(countActiveAgentsForKnowledgeBase(index.db, kbId)).toBe(2);
      expect(countActiveAgentsForKnowledgeBase(index.db, "kb-none")).toBe(0);
    } finally {
      index.close();
    }
  });

  it("breaks down chunk relations by type per knowledge base", async () => {
    const kbId = "kb-relations";
    const dbPath = resolveKnowledgeIndexDbPath({
      ownerId: "user-relations",
      tenantId: null,
      indexRoot,
    });
    const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
    try {
      const insert = index.db.prepare(
        `INSERT INTO chunk_relations (id, kb_id, from_chunk, to_chunk, relation_type, weight, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      const now = Date.now();
      insert.run("r1", kbId, "a", "b", "reference", 1, now);
      insert.run("r2", kbId, "a", "c", "reference", 1, now);
      insert.run("r3", kbId, "b", "c", "duplicate", 1, now);
      insert.run("r4", kbId, "c", "d", "conflict", 1, now);
      // Different KB — must be excluded from the breakdown.
      insert.run("r5", "kb-other", "x", "y", "reference", 1, now);

      expect(getChunkRelationBreakdown(index.db, kbId)).toEqual({
        reference: 2,
        duplicate: 1,
        conflict: 1,
      });
      expect(getChunkRelationBreakdown(index.db, "kb-empty")).toEqual({
        reference: 0,
        duplicate: 0,
        conflict: 0,
      });
    } finally {
      index.close();
    }
  });

  it("averages governance scores per knowledge base", async () => {
    const kbId = "kb-scores";
    const dbPath = resolveKnowledgeIndexDbPath({
      ownerId: "user-scores",
      tenantId: null,
      indexRoot,
    });
    const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
    try {
      ensureChunkGovernanceRows({ db: index.db, kbId, chunkIds: ["s1", "s2"] });
      const update = index.db.prepare(
        `UPDATE chunk_governance
            SET quality_score = ?, trust_score = ?, freshness_score = ?
          WHERE chunk_id = ?`,
      );
      update.run(0.8, 0.9, 0.7, "s1");
      update.run(0.6, 0.7, 0.5, "s2");

      const avg = getChunkScoreAverages(index.db, kbId);
      expect(avg.quality).toBeCloseTo(0.7, 5);
      expect(avg.trust).toBeCloseTo(0.8, 5);
      expect(avg.freshness).toBeCloseTo(0.6, 5);

      expect(getChunkScoreAverages(index.db, "kb-empty")).toEqual({
        quality: null,
        trust: null,
        freshness: null,
      });
    } finally {
      index.close();
    }
  });

  it("suggests an update_knowledge action for stale governance tasks", async () => {
    const kbId = "kb-stale";
    const dbPath = resolveKnowledgeIndexDbPath({
      ownerId: "user-stale",
      tenantId: null,
      indexRoot,
    });
    const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
    try {
      const taskId = createGovernanceTask({
        db: index.db,
        kbId,
        taskType: "stale",
        relatedChunkIds: ["stale-chunk"],
        priority: 3,
      });

      const actions = buildGovernanceActionSuggestions({
        db: index.db,
        knowledgeBaseId: kbId,
        limit: 4,
      });

      const staleAction = actions.find((action) => action.context.governanceTaskId === taskId);
      expect(staleAction?.actionType).toBe("update_knowledge");
      expect(staleAction?.executable).toBe(true);
    } finally {
      index.close();
    }
  });
});
