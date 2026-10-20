import { describe, expect, it } from "vitest";
import {
  validateDecisionReason,
  sortDecisionHistory,
  getDecisionResultDisplay,
  type PromotionDecisionRecord,
} from "../promotion-decision.ts";

describe("validateDecisionReason", () => {
  it("rejects reason with 9 chars (below minimum)", () => {
    const result = validateDecisionReason("a".repeat(9));
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("accepts reason with exactly 10 chars (minimum boundary)", () => {
    const result = validateDecisionReason("a".repeat(10));
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("accepts reason with exactly 500 chars (maximum boundary)", () => {
    const result = validateDecisionReason("a".repeat(500));
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("rejects reason with 501 chars (above maximum)", () => {
    const result = validateDecisionReason("a".repeat(501));
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("rejects empty string", () => {
    const result = validateDecisionReason("");
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });
});

describe("sortDecisionHistory", () => {
  it("sorts decisions by decidedAt descending (newest first)", () => {
    const decisions: PromotionDecisionRecord[] = [
      makeDecision({ decidedAt: 100 }),
      makeDecision({ decidedAt: 300 }),
      makeDecision({ decidedAt: 200 }),
    ];

    const sorted = sortDecisionHistory(decisions);

    expect(sorted[0].decidedAt).toBe(300);
    expect(sorted[1].decidedAt).toBe(200);
    expect(sorted[2].decidedAt).toBe(100);
  });

  it("does not mutate the original array", () => {
    const decisions: PromotionDecisionRecord[] = [
      makeDecision({ decidedAt: 100 }),
      makeDecision({ decidedAt: 300 }),
    ];

    const sorted = sortDecisionHistory(decisions);

    expect(sorted).not.toBe(decisions);
    expect(decisions[0].decidedAt).toBe(100);
  });
});

describe("getDecisionResultDisplay", () => {
  it("maps recommend_upload to correct label and styleClass", () => {
    const display = getDecisionResultDisplay("recommend_upload");
    expect(display.label).toBe("推荐上报平台");
    expect(display.styleClass).toBe("decision-recommend");
  });

  it("maps continue_incubation to correct label and styleClass", () => {
    const display = getDecisionResultDisplay("continue_incubation");
    expect(display.label).toBe("继续孵化");
    expect(display.styleClass).toBe("decision-continue");
  });

  it("maps not_suitable to correct label and styleClass", () => {
    const display = getDecisionResultDisplay("not_suitable");
    expect(display.label).toBe("不适合晋升");
    expect(display.styleClass).toBe("decision-not-suitable");
  });
});

// --- Helper ---

function makeDecision(overrides: Partial<PromotionDecisionRecord> = {}): PromotionDecisionRecord {
  return {
    decisionId: "d-1",
    capabilityId: "cap-1",
    decidedAt: Date.now(),
    decidedBy: "user-1",
    result: "continue_incubation",
    reason: "这是一个足够长的决策理由用于测试目的",
    scoreSnapshot: {
      reuseBreath: 0.8,
      effectStability: 0.7,
      businessCoverage: 0.6,
      employeeSatisfaction: 0.9,
      compositeScore: 0.75,
    },
    ...overrides,
  };
}
