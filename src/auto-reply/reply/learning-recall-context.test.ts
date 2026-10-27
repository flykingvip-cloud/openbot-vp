import { describe, expect, it } from "vitest";
import { renderLearningRecallPrompt } from "./learning-recall-context.js";

describe("renderLearningRecallPrompt", () => {
  it("returns undefined when there are no lessons", () => {
    expect(renderLearningRecallPrompt({ capabilities: [], lessons: [] })).toBeUndefined();
  });

  it("renders approved lessons and labels exposure (not verified reuse)", () => {
    const prompt = renderLearningRecallPrompt({
      capabilities: ["search"],
      lessons: [
        {
          assetId: "a1",
          assetType: "lesson",
          lesson: "先核对工具是否在白名单，再决定是否改提示词。",
          confidence: "high",
          reuseCount: 2,
          injectedCount: 2,
          outcomeVerifiedCount: 1,
          isAntiPattern: false,
        },
        {
          assetId: "a2",
          assetType: "pattern",
          lesson: "不要把一次现场事件写成硬编码特例。",
          confidence: "medium",
          reuseCount: 0,
          injectedCount: 0,
          outcomeVerifiedCount: 0,
          isAntiPattern: true,
        },
      ],
    });
    expect(prompt).toContain("已沉淀的经验");
    expect(prompt).toContain("先核对工具是否在白名单");
    expect(prompt).toContain("负面模式");
    expect(prompt).toContain("已曝光 2 次");
    expect(prompt).toContain("已验证有效 1 次");
    expect(prompt).toContain("只表示曝光");
    expect(prompt).not.toContain("已复用 2 次");
  });
});
