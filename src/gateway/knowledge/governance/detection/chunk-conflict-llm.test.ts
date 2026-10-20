// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseChunkConflictLlmVerdict, recallScoreEligibleForLlm } from "./chunk-conflict-llm.js";

describe("chunk-conflict-llm", () => {
  it("parses fenced JSON verdicts", () => {
    const parsed = parseChunkConflictLlmVerdict(
      'Here is the result:\n```json\n{"contradicts":true,"reason":"opposite growth","confidence":0.9}\n```',
    );
    expect(parsed?.contradicts).toBe(true);
    expect(parsed?.reason).toBe("opposite growth");
    expect(parsed?.confidence).toBe(0.9);
  });

  it("rejects low-confidence contradictions", () => {
    const parsed = parseChunkConflictLlmVerdict(
      '{"contradicts":true,"reason":"maybe","confidence":0.2}',
    );
    expect(parsed?.contradicts).toBe(true);
    expect(parsed?.confidence).toBe(0.2);
  });

  it("gates LLM calls by recall source thresholds", () => {
    expect(recallScoreEligibleForLlm({ recallScore: 0.81, recallSource: "vector" })).toBe(true);
    expect(recallScoreEligibleForLlm({ recallScore: 0.79, recallSource: "vector" })).toBe(false);
    expect(recallScoreEligibleForLlm({ recallScore: 0.4, recallSource: "fts" })).toBe(true);
    expect(recallScoreEligibleForLlm({ recallScore: 0.2, recallSource: "fts" })).toBe(false);
  });
});
