// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { ensureKnowledgeGovernanceSchema } from "../../kb-index-schema.js";
import {
  getGovernanceLlmUsageStats,
  incrementGovernanceLlmUsageLocal,
} from "./governance-llm-usage-store.js";

function createDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  ensureKnowledgeGovernanceSchema(db);
  return db;
}

describe("governance-llm-usage-store", () => {
  let db: DatabaseSync;

  afterEach(() => {
    db?.close();
  });

  it("accumulates per-kb usage stats", () => {
    db = createDb();
    incrementGovernanceLlmUsageLocal({
      db,
      kbId: "kb_a",
      inputTokens: 100,
      outputTokens: 20,
      creditsCharged: 1.5,
      now: 1_000,
    });
    incrementGovernanceLlmUsageLocal({
      db,
      kbId: "kb_a",
      inputTokens: 50,
      outputTokens: 10,
      creditsCharged: 0.5,
      now: 2_000,
    });
    expect(getGovernanceLlmUsageStats(db, "kb_a")).toEqual({
      llmCallCount: 2,
      inputTokens: 150,
      outputTokens: 30,
      totalTokens: 180,
      creditsCharged: 2,
      lastCallAt: 2_000,
    });
  });

  it("aggregates across knowledge bases when kbId omitted", () => {
    db = createDb();
    incrementGovernanceLlmUsageLocal({
      db,
      kbId: "kb_a",
      inputTokens: 10,
      outputTokens: 5,
      creditsCharged: 1,
      now: 1_000,
    });
    incrementGovernanceLlmUsageLocal({
      db,
      kbId: "kb_b",
      inputTokens: 20,
      outputTokens: 8,
      creditsCharged: 2,
      now: 3_000,
    });
    expect(getGovernanceLlmUsageStats(db)).toEqual({
      llmCallCount: 2,
      inputTokens: 30,
      outputTokens: 13,
      totalTokens: 43,
      creditsCharged: 3,
      lastCallAt: 3_000,
    });
  });
});
