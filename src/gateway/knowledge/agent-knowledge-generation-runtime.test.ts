// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listAgentGeneratedKnowledgeInIndex } from "./agent-generated-knowledge-store.js";
import {
  enqueueAgentKnowledgeGenerationInIndex,
  getAgentKnowledgeGenerationQueueRow,
} from "./agent-knowledge-generation-queue-store.js";
import { tickAgentKnowledgeGeneration } from "./agent-knowledge-generation-runtime.js";
import type { AgentKnowledgeLlmCaller } from "./agent-knowledge-generator.js";
import { openKnowledgeIndex, resolveKnowledgeIndexDbPath } from "./kb-index.js";

let indexRoot: string;

beforeEach(() => {
  indexRoot = path.join(os.tmpdir(), `akg-tick-${randomUUID()}`);
  process.env.OPENBOT_KNOWLEDGE_AUTO_GENERATE = "1";
});

afterEach(() => {
  fs.rmSync(indexRoot, { recursive: true, force: true });
  delete process.env.OPENBOT_KNOWLEDGE_AUTO_GENERATE;
});

const stubLlm: AgentKnowledgeLlmCaller = async ({ prompt }) => {
  if (prompt.includes("标准操作流程")) {
    return {
      text: '{"title":"上线流程","steps":["准备环境","执行部署"]}',
      inputTokens: 30,
      outputTokens: 10,
    };
  }
  return {
    text: '{"title":"会话要点","summary":"用户确认了上线步骤。"}',
    inputTokens: 25,
    outputTokens: 8,
  };
};

const transcript = [
  { role: "user", text: "怎么上线？" },
  { role: "assistant", text: "先准备环境，再部署。" },
];

async function enqueueIn(ownerId: string, kbId: string, sessionKey: string) {
  const dbPath = resolveKnowledgeIndexDbPath({ ownerId, tenantId: null, indexRoot });
  const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
  try {
    enqueueAgentKnowledgeGenerationInIndex(index.db, { kbId, sessionKey, nowMs: 1000 });
  } finally {
    index.close();
  }
  return dbPath;
}

describe("agent-knowledge-generation-runtime", () => {
  it("drains pending jobs: loads transcript, generates, marks done", async () => {
    const dbPath = await enqueueIn("user-tick", "kb-1", "sess-1");

    const result = await tickAgentKnowledgeGeneration({
      indexRoot,
      llm: stubLlm,
      loadTranscript: async () => transcript,
      nowMs: 5000,
    });
    expect(result.databases).toBe(1);
    expect(result.processed).toBe(1);
    expect(result.generated).toBe(2);
    expect(result.failed).toBe(0);

    const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
    try {
      expect(getAgentKnowledgeGenerationQueueRow(index.db, "kb-1", "sess-1")?.status).toBe("done");
      const items = listAgentGeneratedKnowledgeInIndex(index.db, "kb-1");
      expect(items.map((i) => i.type).toSorted()).toEqual(["auto_sop", "conversation_summary"]);
    } finally {
      index.close();
    }
  });

  it("marks done with no generation when the transcript is empty", async () => {
    const dbPath = await enqueueIn("user-empty", "kb-2", "sess-empty");
    const result = await tickAgentKnowledgeGeneration({
      indexRoot,
      llm: stubLlm,
      loadTranscript: async () => [],
      nowMs: 5000,
    });
    expect(result.processed).toBe(1);
    expect(result.generated).toBe(0);
    const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
    try {
      expect(getAgentKnowledgeGenerationQueueRow(index.db, "kb-2", "sess-empty")?.status).toBe(
        "done",
      );
    } finally {
      index.close();
    }
  });

  it("captures errors and keeps the job retryable", async () => {
    const dbPath = await enqueueIn("user-err", "kb-3", "sess-err");
    const result = await tickAgentKnowledgeGeneration({
      indexRoot,
      llm: stubLlm,
      loadTranscript: async () => {
        throw new Error("transcript boom");
      },
      nowMs: 5000,
    });
    expect(result.failed).toBe(1);
    const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
    try {
      const row = getAgentKnowledgeGenerationQueueRow(index.db, "kb-3", "sess-err");
      expect(row?.status).toBe("pending");
      expect(row?.attempts).toBe(1);
      expect(row?.lastError).toContain("transcript boom");
    } finally {
      index.close();
    }
  });

  it("is a no-op when auto-generation is disabled", async () => {
    await enqueueIn("user-off", "kb-4", "sess-off");
    delete process.env.OPENBOT_KNOWLEDGE_AUTO_GENERATE;
    const result = await tickAgentKnowledgeGeneration({
      indexRoot,
      llm: stubLlm,
      loadTranscript: async () => transcript,
    });
    expect(result).toEqual({ databases: 0, processed: 0, generated: 0, failed: 0 });
  });
});
