// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveIndexedDeliverableGovernanceStatus } from "./deliverables/governance-runtime.js";
import { mapSkillLifecycleToDeliverableStatus } from "./deliverables/lifecycle-map.js";
import { createGovernanceTask } from "./governance/chunk-governance-store.js";
import { openKnowledgeIndex, resolveKnowledgeIndexDbPath } from "./kb-index.js";
import { ingestKnowledgeDocument } from "./kb-ingest.js";

let indexRoot: string;

beforeEach(() => {
  indexRoot = path.join(os.tmpdir(), `kb-runtime-p2-${randomUUID()}`);
});

afterEach(() => {
  fs.rmSync(indexRoot, { recursive: true, force: true });
});

describe("knowledge runtime p2", () => {
  it("maps skill lifecycle states to deliverable status", () => {
    expect(mapSkillLifecycleToDeliverableStatus("draft")).toBe("draft");
    expect(mapSkillLifecycleToDeliverableStatus("reviewing")).toBe("in_review");
    expect(mapSkillLifecycleToDeliverableStatus("published")).toBe("published");
    expect(mapSkillLifecycleToDeliverableStatus("retired")).toBe("archived");
  });

  it("resolves deliverable governance status from indexed chunk runtime", async () => {
    const kbId = "kb-governance";
    const docId = "deliverable-doc";
    const ownerId = "user-governance";
    await ingestKnowledgeDocument({
      kbId,
      docId,
      title: "Deliverable doc",
      fileName: "deliverable.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("Deliverable insight", "utf8"),
      ownerId,
      tenantId: null,
      indexRoot,
      embeddingProvider: null,
    });

    const dbPath = resolveKnowledgeIndexDbPath({ ownerId, tenantId: null, indexRoot });
    const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
    try {
      const chunkRow = index.db
        .prepare(`SELECT chunk_id FROM chunk_meta WHERE kb_id = ? AND doc_id = ? LIMIT 1`)
        .get(kbId, docId) as { chunk_id: string };

      expect(resolveIndexedDeliverableGovernanceStatus(index.db, { kbId, docId })).toBe("verified");

      index.db
        .prepare(
          `INSERT INTO chunk_governance (chunk_id, kb_id, governance_status, reference_count)
           VALUES (?, ?, 'pending', 0)
           ON CONFLICT(chunk_id) DO UPDATE SET governance_status = 'pending'`,
        )
        .run(chunkRow.chunk_id, kbId);
      expect(resolveIndexedDeliverableGovernanceStatus(index.db, { kbId, docId })).toBe("pending");

      index.db
        .prepare(`UPDATE chunk_governance SET governance_status = 'confirmed' WHERE chunk_id = ?`)
        .run(chunkRow.chunk_id);
      expect(resolveIndexedDeliverableGovernanceStatus(index.db, { kbId, docId })).toBe("verified");

      createGovernanceTask({
        db: index.db,
        kbId,
        taskType: "conflict",
        relatedChunkIds: [chunkRow.chunk_id],
        priority: 8,
      });
      expect(resolveIndexedDeliverableGovernanceStatus(index.db, { kbId, docId })).toBe("conflict");
    } finally {
      index.close();
    }
  });
});
