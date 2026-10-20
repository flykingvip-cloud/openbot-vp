// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openKnowledgeIndex, resolveKnowledgeIndexDbPath } from "../kb-index.js";
import { ingestKnowledgeDocument } from "../kb-ingest.js";
import { listGovernanceTasks } from "./chunk-governance-store.js";
import { listClaimsByKb } from "./claims/claim-store.js";
import { resolveGovernanceTask } from "./resolution/task-resolver.js";
import { runGovernanceJobsForDatabase } from "./runtime/job-runner.js";

let indexRoot: string;

beforeEach(() => {
  indexRoot = path.join(os.tmpdir(), `kb-claim-truth-${randomUUID()}`);
});

afterEach(() => {
  fs.rmSync(indexRoot, { recursive: true, force: true });
});

async function seedClaimConflict(): Promise<{
  db: import("node:sqlite").DatabaseSync;
  index: Awaited<ReturnType<typeof openKnowledgeIndex>>;
  kbId: string;
  ownerId: string;
}> {
  const ownerId = "user-claim-truth";
  const kbId = "kb_claim_truth";

  await ingestKnowledgeDocument({
    kbId,
    docId: "doc-a",
    title: "Policy A",
    fileName: "a.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("销售返点: 15%\n渠道政策说明", "utf8"),
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
    buffer: Buffer.from("销售返点: 18%\n渠道政策说明", "utf8"),
    ownerId,
    tenantId: null,
    indexRoot,
    embeddingProvider: null,
  });

  const dbPath = resolveKnowledgeIndexDbPath({ ownerId, tenantId: null, indexRoot });
  const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
  await runGovernanceJobsForDatabase({
    db: index.db,
    limits: {
      maxJobsPerRound: 20,
      maxLlmCallsPerRound: 0,
      maxEmbeddingCallsPerRound: 0,
      maxSimilarityQueriesPerRound: 48,
    },
  });
  return { db: index.db, index, kbId, ownerId };
}

describe("claim truth resolution", () => {
  it("exposes aligned candidate truth options on the conflict task", async () => {
    const { index, kbId } = await seedClaimConflict();
    try {
      const task = listGovernanceTasks({ db: index.db, kbId, status: "open" }).find(
        (entry) => entry.taskType === "claim_conflict",
      );
      expect(task).toBeDefined();
      const resolution = task!.proposedResolution as {
        candidates?: Array<{ claimId: string; value: string; chunkId: string }>;
      };
      expect(Array.isArray(resolution.candidates)).toBe(true);
      expect(resolution.candidates!.length).toBeGreaterThanOrEqual(2);
      for (const candidate of resolution.candidates!) {
        expect(candidate.claimId).toMatch(/^claim:/);
        expect(candidate.value.length).toBeGreaterThan(0);
      }
    } finally {
      index.close();
    }
  });

  it("confirms the expert-selected claim and suppresses the rest", async () => {
    const { index, kbId, ownerId } = await seedClaimConflict();
    try {
      const task = listGovernanceTasks({ db: index.db, kbId, status: "open" }).find(
        (entry) => entry.taskType === "claim_conflict",
      );
      expect(task).toBeDefined();
      const resolution = task!.proposedResolution as {
        claimIds: string[];
        candidates: Array<{ claimId: string; value: string }>;
      };
      // Deliberately pick the LAST sorted claim so we prove it is not the default
      // first-sorted fallback that wins.
      const chosen = resolution.claimIds[resolution.claimIds.length - 1];

      const ok = resolveGovernanceTask({
        db: index.db,
        taskId: task!.id,
        status: "resolved",
        expertId: ownerId,
        canonicalClaimId: chosen,
      });
      expect(ok).toBe(true);

      const claims = listClaimsByKb({ db: index.db, kbId });
      const chosenClaim = claims.find((claim) => claim.id === chosen);
      expect(chosenClaim?.governanceStatus).toBe("confirmed");
      const others = claims.filter(
        (claim) => resolution.claimIds.includes(claim.id) && claim.id !== chosen,
      );
      expect(others.length).toBeGreaterThanOrEqual(1);
      for (const other of others) {
        expect(other.governanceStatus).toBe("suppressed");
      }
    } finally {
      index.close();
    }
  });

  it("falls back to the first sorted claim when no truth is selected", async () => {
    const { index, kbId, ownerId } = await seedClaimConflict();
    try {
      const task = listGovernanceTasks({ db: index.db, kbId, status: "open" }).find(
        (entry) => entry.taskType === "claim_conflict",
      );
      expect(task).toBeDefined();
      const resolution = task!.proposedResolution as { claimIds: string[] };
      const fallback = resolution.claimIds[0];

      const ok = resolveGovernanceTask({
        db: index.db,
        taskId: task!.id,
        status: "resolved",
        expertId: ownerId,
      });
      expect(ok).toBe(true);

      const claims = listClaimsByKb({ db: index.db, kbId });
      expect(claims.find((claim) => claim.id === fallback)?.governanceStatus).toBe("confirmed");
    } finally {
      index.close();
    }
  });
});
