// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openKnowledgeIndex, resolveKnowledgeIndexDbPath } from "../kb-index.js";
import { ingestKnowledgeDocument } from "../kb-ingest.js";
import { retrieveKnowledgeFromIndex } from "../kb-retrieve.js";
import { formatKnowledgeEvidencePromptLines } from "../resolve/evidence-format.js";
import { listGovernanceTasks } from "./chunk-governance-store.js";
import { loadChunkClaimConflictFlags } from "./claims/claim-retrieval.js";
import { buildGovernanceTaskIssueGraph } from "./graph/task-issue-graph.js";
import { applyGovernanceMultiplier } from "./retrieval-scoring.js";
import { runGovernanceJobsForDatabase } from "./runtime/job-runner.js";

let indexRoot: string;

beforeEach(() => {
  indexRoot = path.join(os.tmpdir(), `kb-gov-p5-${randomUUID()}`);
});

afterEach(() => {
  fs.rmSync(indexRoot, { recursive: true, force: true });
});

describe("knowledge governance phase 5", () => {
  it("applies claim conflict multiplier during governance-aware retrieval scoring", () => {
    const base = applyGovernanceMultiplier(1, null);
    const penalized = applyGovernanceMultiplier(1, null, { claimConflict: true });
    expect(base).toBe(1);
    expect(penalized).toBeCloseTo(0.85, 5);
  });

  it("builds task issue graphs with chunk and claim nodes", async () => {
    const ownerId = "user-gov-p5";
    const kbId = "kb_p5";

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

      const task = listGovernanceTasks({ db: index.db, kbId, status: "open" }).find(
        (entry) => entry.taskType === "claim_conflict",
      );
      expect(task).toBeDefined();

      const issueGraph = buildGovernanceTaskIssueGraph({ db: index.db, task: task! });
      expect(issueGraph.graph.nodes.length).toBeGreaterThanOrEqual(2);
      expect(issueGraph.graph.edges.length).toBeGreaterThanOrEqual(1);
      expect(issueGraph.claims.length).toBeGreaterThanOrEqual(2);
      expect(issueGraph.focusNodeId).toMatch(/^gov:claim:/);

      const flags = loadChunkClaimConflictFlags(index.db, task!.relatedChunkIds);
      expect([...flags.values()].some(Boolean)).toBe(true);

      const hits = await retrieveKnowledgeFromIndex({
        index,
        query: "销售返点",
        kbIds: [kbId],
        embeddingProvider: null,
        maxResults: 4,
        governanceAware: true,
      });
      expect(hits.some((hit) => hit.governanceClaimConflict)).toBe(true);

      const evidenceLines = formatKnowledgeEvidencePromptLines(
        hits.map((hit) => ({
          sourceKind: "knowledge",
          docId: hit.docId,
          docTitle: hit.docTitle,
          kbId: hit.kbId,
          versionId: hit.versionId,
          versionLabel: hit.versionLabel,
          publishedAt: hit.publishedAt,
          score: hit.score,
          chunkText: hit.chunkText,
          sourceUri: `ku://kb/${hit.kbId}/doc/${hit.docId}@${hit.versionId}`,
          governanceClaimConflict: hit.governanceClaimConflict,
        })),
        4,
      );
      expect(evidenceLines.join("\n")).toContain("unresolved claim conflict");
    } finally {
      index.close();
    }
  });
});
