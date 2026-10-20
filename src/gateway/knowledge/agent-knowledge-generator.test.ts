// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  listAgentGeneratedKnowledgeInIndex,
  type AgentGeneratedKnowledgeRecord,
} from "./agent-generated-knowledge-store.js";
import {
  type AgentKnowledgeLlmCaller,
  extractTranscriptMessages,
  generateAndRecordAgentKnowledge,
  parseSopResult,
  parseSummaryResult,
} from "./agent-knowledge-generator.js";
import { getGovernanceLlmUsageStats } from "./governance/usage/governance-llm-usage-store.js";
import { openKnowledgeIndex } from "./kb-index.js";

let dbDir: string;
let dbPath: string;

beforeEach(() => {
  dbDir = path.join(os.tmpdir(), `agk-gen-${randomUUID()}`);
  fs.mkdirSync(dbDir, { recursive: true });
  dbPath = path.join(dbDir, "index.db");
});

afterEach(() => {
  fs.rmSync(dbDir, { recursive: true, force: true });
});

const SUMMARY_JSON = '{"title":"会话要点","summary":"用户咨询了上线流程并确认了三个步骤。"}';
const SOP_JSON = '{"title":"上线流程","steps":["准备环境","执行部署","验证结果"]}';

const stubLlm: AgentKnowledgeLlmCaller = async ({ prompt }) => {
  if (prompt.includes("标准操作流程")) {
    return { text: SOP_JSON, inputTokens: 50, outputTokens: 20 };
  }
  return { text: SUMMARY_JSON, inputTokens: 40, outputTokens: 15 };
};

const transcript = [
  { role: "user", text: "我们要怎么上线这个服务？" },
  { role: "assistant", text: "先准备环境，再执行部署，最后验证结果。" },
];

function byType(items: AgentGeneratedKnowledgeRecord[]) {
  return Object.fromEntries(items.map((item) => [item.type, item]));
}

describe("agent-knowledge-generator", () => {
  it("extracts user/assistant turns from raw transcript entries", () => {
    const raw = [
      { role: "user", content: [{ type: "text", text: "hi" }] },
      { role: "assistant", content: "hello" },
      { role: "system", content: [{ type: "text", text: "ignored" }] },
      { role: "user", content: [{ type: "text", text: "/slash command" }] },
    ];
    const messages = extractTranscriptMessages(raw);
    expect(messages).toEqual([
      { role: "user", text: "hi" },
      { role: "assistant", text: "hello" },
    ]);
  });

  it("parses summary and SOP JSON results", () => {
    expect(parseSummaryResult(SUMMARY_JSON)).toEqual({
      title: "会话要点",
      summary: "用户咨询了上线流程并确认了三个步骤。",
    });
    const sop = parseSopResult(SOP_JSON);
    expect(sop?.steps).toHaveLength(3);
    expect(sop?.summary).toContain("1. 准备环境");
    expect(parseSopResult('{"title":"x","steps":[]}')).toBeNull();
  });

  it("generates + records conversation_summary and auto_sop with usage", async () => {
    const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
    try {
      const generated = await generateAndRecordAgentKnowledge({
        db: index.db,
        kbId: "kb-gen",
        sessionKey: "sess-1",
        agentId: "agent-ops",
        messages: transcript,
        llm: stubLlm,
        nowMs: 1000,
      });
      expect(generated.map((g) => g.type).toSorted()).toEqual(["auto_sop", "conversation_summary"]);

      const items = byType(listAgentGeneratedKnowledgeInIndex(index.db, "kb-gen"));
      expect(items.conversation_summary?.title).toBe("会话要点");
      expect(items.conversation_summary?.status).toBe("pending");
      expect(items.auto_sop?.title).toBe("上线流程");
      expect(items.auto_sop?.summary).toContain("1. 准备环境");
      expect(items.auto_sop?.sourceLineageId).toBe("session:sess-1");

      const usage = getGovernanceLlmUsageStats(index.db, "kb-gen");
      expect(usage.llmCallCount).toBe(2);
      expect(usage.inputTokens).toBe(90);
      expect(usage.outputTokens).toBe(35);

      // Idempotent: re-running keeps the same two rows (deterministic ids).
      await generateAndRecordAgentKnowledge({
        db: index.db,
        kbId: "kb-gen",
        sessionKey: "sess-1",
        messages: transcript,
        llm: stubLlm,
        nowMs: 2000,
      });
      expect(listAgentGeneratedKnowledgeInIndex(index.db, "kb-gen")).toHaveLength(2);
    } finally {
      index.close();
    }
  });

  it("generates nothing for an empty transcript or a null LLM result", async () => {
    const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
    try {
      const empty = await generateAndRecordAgentKnowledge({
        db: index.db,
        kbId: "kb-empty",
        sessionKey: "sess-empty",
        messages: [],
        llm: stubLlm,
      });
      expect(empty).toEqual([]);

      const nullLlm = await generateAndRecordAgentKnowledge({
        db: index.db,
        kbId: "kb-null",
        sessionKey: "sess-null",
        messages: transcript,
        llm: async () => null,
      });
      expect(nullLlm).toEqual([]);
      expect(listAgentGeneratedKnowledgeInIndex(index.db, "kb-null")).toHaveLength(0);
    } finally {
      index.close();
    }
  });

  it("only generates the requested modes", async () => {
    const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
    try {
      const generated = await generateAndRecordAgentKnowledge({
        db: index.db,
        kbId: "kb-modes",
        sessionKey: "sess-modes",
        messages: transcript,
        llm: stubLlm,
        modes: ["summary"],
      });
      expect(generated.map((g) => g.type)).toEqual(["conversation_summary"]);
      expect(listAgentGeneratedKnowledgeInIndex(index.db, "kb-modes")).toHaveLength(1);
    } finally {
      index.close();
    }
  });
});
