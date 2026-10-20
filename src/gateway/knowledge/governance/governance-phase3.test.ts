// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openKnowledgeIndex, resolveKnowledgeIndexDbPath } from "../kb-index.js";
import { ingestKnowledgeDocument } from "../kb-ingest.js";
import { upsertExpertAuthority } from "./expert-authority-store.js";
import {
  docIdFromKnowledgeObjectId,
  knowledgeObjectIdForIndexedDoc,
  objectLookupKeysForDocId,
} from "./identity-bridge.js";
import { resolveGovernanceTask } from "./resolution/task-resolver.js";
import { runGovernanceJobsForDatabase } from "./runtime/job-runner.js";
import { loadDocumentGovernanceOverlay } from "./runtime/object-writeback.js";
import { computeFreshnessScore, computeQualityScore } from "./scoring/quality-scorer.js";
import { runQualityRefresh } from "./scoring/run-quality-refresh.js";

let indexRoot: string;

beforeEach(() => {
  indexRoot = path.join(os.tmpdir(), `kb-gov-p3-${randomUUID()}`);
});

afterEach(() => {
  fs.rmSync(indexRoot, { recursive: true, force: true });
});

describe("knowledge governance phase 3", () => {
  it("maps doc ids only to their declared object domain", () => {
    expect(knowledgeObjectIdForIndexedDoc({ docId: "skill-1", source: "personal" })).toBe(
      "obj:personal:skill-1",
    );
    expect(knowledgeObjectIdForIndexedDoc({ docId: "skill-1", source: "enterprise" })).toBe(
      "obj:enterprise:skill-1",
    );
    expect(docIdFromKnowledgeObjectId("obj:personal:skill-1")).toBe("skill-1");
    expect(docIdFromKnowledgeObjectId("obj:enterprise:skill-1")).toBeNull();
    expect(docIdFromKnowledgeObjectId("obj:kb:skill-1")).toBeNull();
    expect(docIdFromKnowledgeObjectId("skill-1")).toBeNull();
    expect(objectLookupKeysForDocId({ docId: "skill-1", source: "personal" })).toEqual([
      "obj:personal:skill-1",
    ]);
  });

  it("computes freshness and quality scores from published age and usage", () => {
    const now = Date.now();
    expect(computeFreshnessScore(now - 5 * 24 * 60 * 60 * 1000, now)).toBe(1);
    const quality = computeQualityScore(
      {
        publishedAt: now - 5 * 24 * 60 * 60 * 1000,
        referenceCount: 3,
        lastHitAt: now - 60_000,
        governanceStatus: "pending",
        conflictGroupId: null,
        trustScore: null,
      },
      now,
    );
    expect(quality).toBeGreaterThan(1);
  });

  it("applies expert-weighted trust when resolving duplicate tasks", async () => {
    const ownerId = "user-gov-p3";
    const kbId = "kb_p3";
    const text = "Shared refund escalation policy for enterprise customers.";

    await ingestKnowledgeDocument({
      kbId,
      docId: "doc-a",
      title: "Policy A",
      fileName: "a.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(text, "utf8"),
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
      buffer: Buffer.from(text, "utf8"),
      ownerId,
      tenantId: null,
      indexRoot,
      embeddingProvider: null,
    });

    const dbPath = resolveKnowledgeIndexDbPath({ ownerId, tenantId: null, indexRoot });
    const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
    try {
      await runGovernanceJobsForDatabase({
        db: index.db,
        limits: {
          maxJobsPerRound: 10,
          maxLlmCallsPerRound: 0,
          maxEmbeddingCallsPerRound: 0,
          maxSimilarityQueriesPerRound: 48,
        },
      });

      upsertExpertAuthority({
        db: index.db,
        expertId: "expert-legal",
        domainScope: kbId,
        expertWeight: 1.2,
        verificationLevel: "admin",
        grantedBy: "system",
      });

      const task = index.db
        .prepare(
          `SELECT id, related_chunk_ids FROM governance_tasks WHERE task_type = 'duplicate' LIMIT 1`,
        )
        .get() as { id: string; related_chunk_ids: string };
      expect(task?.id).toBeTruthy();

      const resolved = resolveGovernanceTask({
        db: index.db,
        taskId: task.id,
        status: "resolved",
        expertId: "expert-legal",
        domainScope: kbId,
      });
      expect(resolved).toBe(true);

      runQualityRefresh({ db: index.db, kbId });
      const overlay = loadDocumentGovernanceOverlay(index.db);
      expect(overlay.get(`obj:kb:${kbId}`)?.openDuplicateCount ?? 0).toBe(0);

      const confirmed = index.db
        .prepare(
          `SELECT COUNT(*) AS count FROM chunk_governance WHERE governance_status = 'confirmed'`,
        )
        .get() as { count: number };
      expect(confirmed.count).toBeGreaterThan(0);
    } finally {
      index.close();
    }
  });
});
