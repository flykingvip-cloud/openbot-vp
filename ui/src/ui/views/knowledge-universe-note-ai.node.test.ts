// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseNoteMetadataJson } from "./knowledge-universe-note-ai.ts";

describe("knowledge-universe-note-ai", () => {
  it("parses plain JSON metadata", () => {
    const result = parseNoteMetadataJson(
      '{"title":"知识库笔记双模录入","tags":["知识管理","效率提升"]}',
    );
    expect(result).toEqual({
      title: "知识库笔记双模录入",
      tags: ["知识管理", "效率提升"],
    });
  });

  it("parses fenced JSON metadata", () => {
    const result = parseNoteMetadataJson(
      '说明如下：\n```json\n{"title":"会议纪要","tags":["会议纪要","产品设计"]}\n```',
    );
    expect(result?.title).toBe("会议纪要");
    expect(result?.tags).toEqual(["会议纪要", "产品设计"]);
  });

  it("returns null for invalid payloads", () => {
    expect(parseNoteMetadataJson("not json")).toBeNull();
    expect(parseNoteMetadataJson('{"tags":[]}')).toBeNull();
  });
});
