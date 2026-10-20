import type { AgentLearningAsset } from "@openbot/collaboration-core";
import { describe, expect, it } from "vitest";
import { formatLearningAssetInstruction } from "./collaboration-learning-store.js";

describe("formatLearningAssetInstruction", () => {
  it("renders title and summary for prompt injection", () => {
    const asset: AgentLearningAsset = {
      assetId: "a1",
      botId: "main",
      sourceGroupId: "g1",
      sourceCapsuleId: "cap-1",
      assetType: "lesson",
      abstractedContent: {
        title: "Confirm before publish",
        summary: "Always verify release checklist with reviewer.",
      },
    };
    expect(formatLearningAssetInstruction(asset)).toBe(
      "[Lesson] Confirm before publish: Always verify release checklist with reviewer.",
    );
  });

  it("returns undefined when no renderable content", () => {
    expect(
      formatLearningAssetInstruction({
        assetId: "a1",
        botId: "main",
        sourceGroupId: "g1",
        sourceCapsuleId: "cap-1",
      }),
    ).toBeUndefined();
  });
});
