// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openKnowledgeIndex, resolveKnowledgeIndexDbPath } from "../kb-index.js";
import { ingestKnowledgeDocument } from "../kb-ingest.js";
import { retrieveKnowledgeFromIndex } from "../kb-retrieve.js";
import { runGovernanceJobsForDatabase } from "./runtime/job-runner.js";

let indexRoot: string;

beforeEach(() => {
  indexRoot = path.join(os.tmpdir(), `kb-gov-${randomUUID()}`);
});

afterEach(() => {
  fs.rmSync(indexRoot, { recursive: true, force: true });
});

describe("knowledge governance MVP", () => {
  it("runs dedup jobs after ingest and keeps retrieval stable without governance rows", async () => {
    const ownerId = "user-gov";
    const kbId = "kb_gov";
    const duplicateText = "Refund policy: escalate within 24 hours for enterprise.";

    await ingestKnowledgeDocument({
      kbId,
      docId: "doc-a",
      title: "Policy A",
      fileName: "a.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(duplicateText, "utf8"),
      ownerId,
      tenantId: null,
      indexRoot,
      embeddingProvider: null,
    });
    await ingestKnowledgeDocument({
      kbId,
      docId: "doc-b",
      title: "Policy B",
      fileName: "b.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(duplicateText, "utf8"),
      ownerId,
      tenantId: null,
      indexRoot,
      embeddingProvider: null,
    });

    const dbPath = resolveKnowledgeIndexDbPath({ ownerId, tenantId: null, indexRoot });
    const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
    try {
      const before = await retrieveKnowledgeFromIndex({
        index,
        query: "refund escalate enterprise",
        kbIds: [kbId],
        embeddingProvider: null,
        maxResults: 4,
        governanceAware: false,
      });
      const after = await retrieveKnowledgeFromIndex({
        index,
        query: "refund escalate enterprise",
        kbIds: [kbId],
        embeddingProvider: null,
        maxResults: 4,
        governanceAware: true,
      });
      expect(before.length).toBeGreaterThan(0);
      expect(after.map((hit) => hit.chunkId)).toEqual(before.map((hit) => hit.chunkId));

      const jobResult = await runGovernanceJobsForDatabase({
        db: index.db,
        limits: {
          maxJobsPerRound: 20,
          maxLlmCallsPerRound: 0,
          maxEmbeddingCallsPerRound: 0,
          maxSimilarityQueriesPerRound: 48,
        },
      });
      expect(jobResult.processed).toBeGreaterThan(0);

      const dupTasks = index.db
        .prepare(`SELECT COUNT(*) AS count FROM governance_tasks WHERE task_type = 'duplicate'`)
        .get() as { count: number };
      expect(dupTasks.count).toBeGreaterThan(0);
    } finally {
      index.close();
    }
  });
});
