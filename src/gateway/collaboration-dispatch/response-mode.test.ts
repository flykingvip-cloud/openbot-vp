import { describe, expect, test } from "vitest";
import {
  classifySimpleKnowledgeQuestion,
  resolveCollaborationResponseMode,
  resolveCoordinationWindowMs,
} from "./response-mode.js";

describe("collaboration response mode", () => {
  test("classifies basic knowledge questions as single_owner candidates", () => {
    expect(classifySimpleKnowledgeQuestion("谁知道端午节的由来？")).toBe(true);
    expect(classifySimpleKnowledgeQuestion("请分析中国出口结构变化的原因")).toBe(false);
  });

  test("resolves response modes from message shape", () => {
    expect(
      resolveCollaborationResponseMode({
        message: "谁知道端午节的由来？",
        visibleLimit: { mode: "open", limit: 2, policyCeiling: 3 },
      }),
    ).toBe("single_owner");
    expect(
      resolveCollaborationResponseMode({
        message: "请分析中国出口结构变化的原因",
        visibleLimit: { mode: "focused_task", limit: 3, policyCeiling: 3 },
      }),
    ).toBe("lead_plus_supplement");
    expect(
      resolveCollaborationResponseMode({
        message: '1. festival-knowledge 2.先只做"端午" 3.不需要',
        visibleLimit: { mode: "focused_task", limit: 2, policyCeiling: 3 },
      }),
    ).toBe("decision_to_executor");
  });

  test("uses zero coordination delay for sequential lead/supplement", () => {
    expect(resolveCoordinationWindowMs("single_owner")).toBe(0);
    expect(resolveCoordinationWindowMs("lead_plus_supplement")).toBe(0);
  });
});
