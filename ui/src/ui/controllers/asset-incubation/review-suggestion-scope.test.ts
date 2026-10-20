import { describe, expect, it } from "vitest";
import {
  MAX_VISIBLE_ASSET_REVIEW_SUGGESTIONS,
  isKnowledgeAssetReviewSuggestion,
  selectVisibleAssetReviewSuggestions,
} from "./review-suggestion-scope.ts";

describe("review-suggestion-scope", () => {
  it("treats knowledge fingerprints, types, and labels as out of scope", () => {
    expect(
      isKnowledgeAssetReviewSuggestion({
        suggestedAssetType: "knowledge",
        label: "可复用流程",
      }),
    ).toBe(true);
    expect(
      isKnowledgeAssetReviewSuggestion({
        fingerprint: "knowledge-article:weekly",
        label: "周报生成",
      }),
    ).toBe(true);
    expect(
      isKnowledgeAssetReviewSuggestion({
        fingerprint: "structured-output",
        label: "知识/报告产出",
      }),
    ).toBe(true);
    expect(
      isKnowledgeAssetReviewSuggestion({
        fingerprint: "structured-output",
        label: "结构化任务",
        suggestedAssetType: "capability",
      }),
    ).toBe(false);
  });

  it("filters knowledge first so it cannot consume the visible limit", () => {
    expect(MAX_VISIBLE_ASSET_REVIEW_SUGGESTIONS).toBe(3);
    const selected = selectVisibleAssetReviewSuggestions([
      { fingerprint: "knowledge-article", label: "知识/报告产出" },
      { fingerprint: "knowledge-article:doc", label: "知识收录" },
      { fingerprint: "knowledge-article:pdf", label: "上传文档" },
      { fingerprint: "structured-output", label: "结构化任务" },
      { fingerprint: "competitive-analysis", label: "竞品分析" },
      { fingerprint: "customer-interview", label: "客户访谈整理" },
      { fingerprint: "prd", label: "产品需求文档" },
    ]);
    expect(selected.map((entry) => entry.label)).toEqual([
      "结构化任务",
      "竞品分析",
      "客户访谈整理",
    ]);
  });
});
