// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openKnowledgeIndex } from "../../kb-index.js";
import { ensureChunkGovernanceRows } from "../chunk-governance-store.js";
import {
  createGovernanceResourceBudget,
  applyGovernanceResourceUsage,
} from "../runtime/job-resource-budget.js";
import type { ChunkConflictLlmClient } from "./chunk-conflict-llm.js";
import { runConflictDetection } from "./conflict-detector.js";

const recallChunkPeersMock = vi.fn();

vi.mock("./chunk-peer-recall.js", () => ({
  recallChunkPeers: (...args: unknown[]) => recallChunkPeersMock(...args),
}));

let dbPath: string;

function seedChunks(db: DatabaseSync, kbId: string, entries: Array<{ id: string; text: string }>) {
  for (const entry of entries) {
    db.prepare(`INSERT INTO chunks (id, text, model) VALUES (?, ?, ?)`).run(
      entry.id,
      entry.text,
      "test",
    );
    db.prepare(
      `INSERT INTO chunk_meta (
         chunk_id, kb_id, doc_id, version_id, heading, section, start_line, end_line, visibility, source
       ) VALUES (?, ?, 'doc', 'v1', NULL, NULL, 0, 1, NULL, NULL)`,
    ).run(entry.id, kbId);
  }
  ensureChunkGovernanceRows({
    db,
    kbId,
    chunkIds: entries.map((entry) => entry.id),
  });
}

beforeEach(() => {
  recallChunkPeersMock.mockReset();
  dbPath = path.join(os.tmpdir(), `kb-conflict-llm-${randomUUID()}.db`);
});

afterEach(() => {
  if (fs.existsSync(dbPath)) {
    fs.rmSync(dbPath, { force: true });
  }
});

describe("conflict-detector LLM path", () => {
  it("creates conflict tasks from LLM verdicts when markers are absent", async () => {
    const index = await openKnowledgeIndex({
      dbPath,
      vectorEnabled: false,
    });
    try {
      const kbId = "kb_llm";
      seedChunks(index.db, kbId, [
        { id: "c1", text: "Q1 revenue increased twenty percent year over year." },
        { id: "c2", text: "Q1 revenue declined sharply compared with last year." },
      ]);

      recallChunkPeersMock.mockImplementation(({ chunkId }: { chunkId: string }) => {
        if (chunkId === "c1") {
          return [
            {
              chunkId: "c2",
              text: "Q1 revenue declined sharply compared with last year.",
              recallScore: 0.88,
              recallSource: "vector",
            },
          ];
        }
        return [];
      });

      const mockLlm: ChunkConflictLlmClient = {
        judgePair: async () => ({
          contradicts: true,
          reason: "opposite revenue direction",
          confidence: 0.92,
        }),
      };

      const budget = createGovernanceResourceBudget({
        maxJobsPerRound: 5,
        maxLlmCallsPerRound: 4,
        maxEmbeddingCallsPerRound: 0,
        maxSimilarityQueriesPerRound: 24,
      });

      const result = await runConflictDetection({
        db: index.db,
        kbId,
        chunkIds: ["c1", "c2"],
        resourceBudget: budget,
        llmClient: mockLlm,
      });

      expect(result.llmCalls).toBe(1);
      expect(result.tasksCreated).toBe(1);

      const task = index.db
        .prepare(
          `SELECT proposed_resolution FROM governance_tasks WHERE task_type = 'conflict' LIMIT 1`,
        )
        .get() as { proposed_resolution: string };
      const resolution = JSON.parse(task.proposed_resolution) as {
        reason?: string;
        detectionMethod?: string;
      };
      expect(resolution.detectionMethod).toBe("llm");
      expect(resolution.reason).toContain("revenue");
    } finally {
      index.close();
    }
  });

  it("respects maxLlmCallsPerRound and reports deferred pairs", async () => {
    const index = await openKnowledgeIndex({
      dbPath,
      vectorEnabled: false,
    });
    try {
      const kbId = "kb_budget";
      seedChunks(index.db, kbId, [
        { id: "c1", text: "Topic alpha statement one." },
        { id: "c2", text: "Topic alpha statement two." },
        { id: "c3", text: "Topic alpha statement three." },
      ]);

      recallChunkPeersMock.mockImplementation(({ chunkId }: { chunkId: string }) => {
        const peers = [
          { id: "c1", score: 0.9 },
          { id: "c2", score: 0.85 },
          { id: "c3", score: 0.82 },
        ].filter((peer) => peer.id !== chunkId);
        return peers.map((peer) => ({
          chunkId: peer.id,
          text: `Topic alpha statement ${peer.id}.`,
          recallScore: peer.score,
          recallSource: "vector" as const,
        }));
      });

      let calls = 0;
      const mockLlm: ChunkConflictLlmClient = {
        judgePair: async () => {
          calls += 1;
          return { contradicts: false, reason: "llm_clear", confidence: 0.2 };
        },
      };

      const budget = createGovernanceResourceBudget({
        maxJobsPerRound: 5,
        maxLlmCallsPerRound: 1,
        maxEmbeddingCallsPerRound: 0,
        maxSimilarityQueriesPerRound: 48,
      });

      const result = await runConflictDetection({
        db: index.db,
        kbId,
        chunkIds: ["c1", "c2", "c3"],
        resourceBudget: budget,
        llmClient: mockLlm,
      });

      expect(calls).toBe(1);
      expect(result.llmCalls).toBe(1);
      expect(result.llmPairsDeferred).toBeGreaterThan(0);
      applyGovernanceResourceUsage(budget, {
        llmCalls: result.llmCalls,
        embeddingCalls: 0,
        similarityQueries: result.similarityQueries,
      });
      expect(budget.llmCallsRemaining).toBe(0);
    } finally {
      index.close();
    }
  });
});
