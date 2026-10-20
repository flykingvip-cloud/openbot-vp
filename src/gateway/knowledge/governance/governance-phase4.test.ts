// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openKnowledgeIndex, resolveKnowledgeIndexDbPath } from "../kb-index.js";
import { ingestKnowledgeDocument } from "../kb-ingest.js";
import { getGovernanceSummary, listGovernanceTasks } from "./chunk-governance-store.js";
import { extractClaimsFromText } from "./claims/claim-extractor.js";
import { listClaimsByKb } from "./claims/claim-store.js";
import { resolveGovernanceTask } from "./resolution/task-resolver.js";
import { runGovernanceJobsForDatabase } from "./runtime/job-runner.js";

let indexRoot: string;

beforeEach(() => {
  indexRoot = path.join(os.tmpdir(), `kb-gov-p4-${randomUUID()}`);
});

afterEach(() => {
  fs.rmSync(indexRoot, { recursive: true, force: true });
});

describe("knowledge governance phase 4", () => {
  it("extracts claims from structured lines", () => {
    const claims = extractClaimsFromText("销售返点: 15%\n备注说明");
    expect(claims).toHaveLength(1);
    expect(claims[0]?.subject).toBe("销售返点");
    expect(claims[0]?.objectValue).toBe("15%");
  });

  it("creates claim_conflict tasks when normalized keys share different values", async () => {
    const ownerId = "user-gov-p4";
    const kbId = "kb_p4";

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
    try {
      await runGovernanceJobsForDatabase({
        db: index.db,
        limits: {
          maxJobsPerRound: 20,
          maxLlmCallsPerRound: 0,
          maxEmbeddingCallsPerRound: 0,
          maxSimilarityQueriesPerRound: 48,
        },
      });

      const claims = listClaimsByKb({ db: index.db, kbId });
      expect(claims.length).toBeGreaterThanOrEqual(2);

      const summary = getGovernanceSummary(index.db, kbId);
      expect(summary.openClaimConflictCount).toBeGreaterThanOrEqual(1);

      const tasks = listGovernanceTasks({ db: index.db, kbId, status: "open" });
      const claimTask = tasks.find((task) => task.taskType === "claim_conflict");
      expect(claimTask).toBeDefined();

      const resolved = resolveGovernanceTask({
        db: index.db,
        taskId: claimTask!.id,
        status: "resolved",
        expertId: ownerId,
      });
      expect(resolved).toBe(true);

      const afterSummary = getGovernanceSummary(index.db, kbId);
      expect(afterSummary.openClaimConflictCount).toBe(0);

      const updatedClaims = listClaimsByKb({ db: index.db, kbId });
      const statuses = new Set(updatedClaims.map((claim) => claim.governanceStatus));
      expect(statuses.has("confirmed")).toBe(true);
      expect(statuses.has("suppressed")).toBe(true);
    } finally {
      index.close();
    }
  });
});
