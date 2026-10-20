// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  captureAgentGeneratedKnowledgeFromDeliverables,
  captureAgentGeneratedKnowledgeFromLineage,
  listAgentGeneratedKnowledgeInIndex,
  summarizeAgentGeneratedKnowledgeByType,
} from "./agent-generated-knowledge-store.js";
import { openKnowledgeIndex } from "./kb-index.js";
import { upsertKnowledgeLineage } from "./knowledge-lineage-store.js";

let dbDir: string;
let dbPath: string;

beforeEach(() => {
  dbDir = path.join(os.tmpdir(), `agk-${randomUUID()}`);
  fs.mkdirSync(dbDir, { recursive: true });
  dbPath = path.join(dbDir, "index.db");
});

afterEach(() => {
  fs.rmSync(dbDir, { recursive: true, force: true });
});

describe("agent-generated-knowledge-store", () => {
  it("derives distinct types from generation lineage", async () => {
    const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
    try {
      const kbId = "kb-agk";
      upsertKnowledgeLineage({
        db: index.db,
        lineageId: "lin-rel",
        kind: "generation",
        agentId: "agent-sales",
        sourceKnowledgeBaseIds: [kbId],
        sourceRelationIds: ["rel-1"],
      });
      upsertKnowledgeLineage({
        db: index.db,
        lineageId: "lin-task",
        kind: "generation",
        agentId: "agent-sales",
        sourceKnowledgeBaseIds: [kbId],
        taskId: "task-7",
      });
      upsertKnowledgeLineage({
        db: index.db,
        lineageId: "lin-chat",
        kind: "generation",
        agentId: "agent-support",
        sourceKnowledgeBaseIds: [kbId],
        sessionKey: "sess-1",
        messageId: "msg-1",
      });
      upsertKnowledgeLineage({
        db: index.db,
        lineageId: "lin-plain",
        kind: "generation",
        agentId: "agent-sales",
        sourceKnowledgeBaseIds: [kbId],
      });

      const captured = captureAgentGeneratedKnowledgeFromLineage(index.db, kbId, 1000);
      expect(captured).toBe(4);

      const items = listAgentGeneratedKnowledgeInIndex(index.db, kbId);
      const byLineage = Object.fromEntries(items.map((i) => [i.sourceLineageId, i.type]));
      expect(byLineage["lin-rel"]).toBe("auto_relation");
      expect(byLineage["lin-task"]).toBe("auto_sop");
      expect(byLineage["lin-chat"]).toBe("conversation_summary");
      expect(byLineage["lin-plain"]).toBe("auto_analysis");

      // Idempotent: re-capture does not duplicate (keyed by lineage id).
      captureAgentGeneratedKnowledgeFromLineage(index.db, kbId, 2000);
      expect(listAgentGeneratedKnowledgeInIndex(index.db, kbId)).toHaveLength(4);
    } finally {
      index.close();
    }
  });

  it("materializes typed rows from agent deliverables and ignores non-agent sources", async () => {
    const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
    try {
      const kbId = "kb-agk-dlv";
      const captured = captureAgentGeneratedKnowledgeFromDeliverables(
        index.db,
        kbId,
        [
          {
            deliverableId: "d-sop",
            title: "Onboarding SOP",
            sourceType: "agent",
            artifactKind: "workflow_output",
            governanceStatus: "verified",
          },
          {
            deliverableId: "d-mem",
            title: "Long term note",
            sourceType: "agent",
            artifactKind: "note",
          },
          {
            deliverableId: "d-chat",
            title: "Call summary",
            sourceType: "agent",
            source: "chat",
            artifactKind: "document",
          },
          {
            deliverableId: "d-collab",
            title: "Team doc",
            sourceType: "collaboration",
            artifactKind: "document",
          },
        ],
        1000,
      );
      expect(captured).toBe(3);

      const items = listAgentGeneratedKnowledgeInIndex(index.db, kbId);
      const byId = Object.fromEntries(items.map((i) => [i.sourceDeliverableId, i]));
      expect(byId["d-sop"]?.type).toBe("auto_sop");
      expect(byId["d-sop"]?.status).toBe("confirmed");
      expect(byId["d-mem"]?.type).toBe("long_term_memory");
      expect(byId["d-chat"]?.type).toBe("conversation_summary");
      expect(byId["d-collab"]).toBeUndefined();

      const summary = summarizeAgentGeneratedKnowledgeByType(index.db, kbId);
      const total = summary.reduce((sum, entry) => sum + entry.count, 0);
      expect(total).toBe(3);
    } finally {
      index.close();
    }
  });
});
