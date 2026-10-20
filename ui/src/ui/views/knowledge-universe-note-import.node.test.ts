// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  addNoteTag,
  extractNoteTitleFromContent,
  suggestNoteMetadataFromContent,
  suggestNoteTagsFromContent,
} from "./knowledge-universe-note-import.ts";

describe("knowledge-universe-note-import", () => {
  it("extracts a concise title from the first line", () => {
    expect(extractNoteTitleFromContent("会议纪要：知识库导入优化\n第二段内容")).toBe(
      "会议纪要：知识库导入优化",
    );
  });

  it("suggests contextual tags from content", () => {
    const tags = suggestNoteTagsFromContent("今天的产品需求评审会议，讨论了知识库标签交互。");
    expect(tags).toContain("会议纪要");
    expect(tags.length).toBeLessThanOrEqual(3);
  });

  it("adds tags without duplicates", () => {
    expect(addNoteTag(["效率提升"], "效率提升")).toEqual(["效率提升"]);
    expect(addNoteTag(["效率提升"], "知识管理")).toEqual(["效率提升", "知识管理"]);
  });

  it("returns title and tags together for AI distill", () => {
    const result = suggestNoteMetadataFromContent(
      "灵感片段：把摘录内容放第一位，再用 AI 自动补标题和标签。",
    );
    expect(result.title.length).toBeGreaterThan(0);
    expect(result.tags.length).toBeGreaterThan(0);
  });
});
