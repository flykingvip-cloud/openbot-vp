// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  enqueueAgentKnowledgeGenerationInIndex,
  getAgentKnowledgeGenerationQueueRow,
  isAgentKnowledgeAutoGenerateEnabled,
  listPendingAgentKnowledgeGenerationInIndex,
  markAgentKnowledgeGenerationDoneInIndex,
  markAgentKnowledgeGenerationErrorInIndex,
  MAX_AGENT_KNOWLEDGE_GENERATION_ATTEMPTS,
} from "./agent-knowledge-generation-queue-store.js";
import { openKnowledgeIndex } from "./kb-index.js";

let dbDir: string;
let dbPath: string;

beforeEach(() => {
  dbDir = path.join(os.tmpdir(), `akgq-${randomUUID()}`);
  fs.mkdirSync(dbDir, { recursive: true });
  dbPath = path.join(dbDir, "index.db");
});

afterEach(() => {
  fs.rmSync(dbDir, { recursive: true, force: true });
  delete process.env.OPENBOT_KNOWLEDGE_AUTO_GENERATE;
  delete process.env.OPENCLAW_KNOWLEDGE_AUTO_GENERATE;
});

describe("agent-knowledge-generation-queue-store", () => {
  it("is disabled by default and reads the opt-in env flag", () => {
    expect(isAgentKnowledgeAutoGenerateEnabled()).toBe(false);
    process.env.OPENBOT_KNOWLEDGE_AUTO_GENERATE = "1";
    expect(isAgentKnowledgeAutoGenerateEnabled()).toBe(true);
    process.env.OPENBOT_KNOWLEDGE_AUTO_GENERATE = "off";
    expect(isAgentKnowledgeAutoGenerateEnabled()).toBe(false);
    process.env.OPENCLAW_KNOWLEDGE_AUTO_GENERATE = "true";
    expect(isAgentKnowledgeAutoGenerateEnabled()).toBe(true);
  });

  it("enqueues, lists pending, and marks done", async () => {
    const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
    try {
      enqueueAgentKnowledgeGenerationInIndex(index.db, {
        kbId: "kb-1",
        sessionKey: "sess-1",
        agentId: "agent-a",
        nowMs: 1000,
      });
      const row = getAgentKnowledgeGenerationQueueRow(index.db, "kb-1", "sess-1");
      expect(row?.status).toBe("pending");
      expect(row?.attempts).toBe(0);
      expect(row?.agentId).toBe("agent-a");

      expect(listPendingAgentKnowledgeGenerationInIndex(index.db)).toHaveLength(1);

      markAgentKnowledgeGenerationDoneInIndex(index.db, {
        kbId: "kb-1",
        sessionKey: "sess-1",
        nowMs: 2000,
      });
      const done = getAgentKnowledgeGenerationQueueRow(index.db, "kb-1", "sess-1");
      expect(done?.status).toBe("done");
      expect(done?.processedAtMs).toBe(2000);
      expect(listPendingAgentKnowledgeGenerationInIndex(index.db)).toHaveLength(0);

      // Re-enqueue resets a done job back to pending.
      enqueueAgentKnowledgeGenerationInIndex(index.db, {
        kbId: "kb-1",
        sessionKey: "sess-1",
        nowMs: 3000,
      });
      expect(getAgentKnowledgeGenerationQueueRow(index.db, "kb-1", "sess-1")?.status).toBe(
        "pending",
      );
    } finally {
      index.close();
    }
  });

  it("retries on error then flips to error after the attempt cap", async () => {
    const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
    try {
      enqueueAgentKnowledgeGenerationInIndex(index.db, {
        kbId: "kb-1",
        sessionKey: "sess-err",
        nowMs: 1000,
      });
      for (let attempt = 1; attempt < MAX_AGENT_KNOWLEDGE_GENERATION_ATTEMPTS; attempt += 1) {
        markAgentKnowledgeGenerationErrorInIndex(index.db, {
          kbId: "kb-1",
          sessionKey: "sess-err",
          error: "boom",
          nowMs: 1000 + attempt,
        });
        const row = getAgentKnowledgeGenerationQueueRow(index.db, "kb-1", "sess-err");
        expect(row?.status).toBe("pending");
        expect(row?.lastError).toBe("boom");
      }
      // Final attempt exhausts the budget → error, no longer pending.
      markAgentKnowledgeGenerationErrorInIndex(index.db, {
        kbId: "kb-1",
        sessionKey: "sess-err",
        error: "boom",
        nowMs: 5000,
      });
      const exhausted = getAgentKnowledgeGenerationQueueRow(index.db, "kb-1", "sess-err");
      expect(exhausted?.status).toBe("error");
      expect(exhausted?.attempts).toBe(MAX_AGENT_KNOWLEDGE_GENERATION_ATTEMPTS);
      expect(listPendingAgentKnowledgeGenerationInIndex(index.db)).toHaveLength(0);
    } finally {
      index.close();
    }
  });
});
