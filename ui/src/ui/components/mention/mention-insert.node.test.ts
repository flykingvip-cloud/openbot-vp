import { describe, expect, it } from "vitest";
import { buildMentionInsertion } from "./mention-insert.ts";

describe("buildMentionInsertion", () => {
  it("adds a trailing space when the mention is inserted at the end", () => {
    expect(
      buildMentionInsertion({
        value: "@",
        triggerOffset: 0,
        cursor: 1,
        displayName: "所有人",
      }),
    ).toEqual({ next: "@所有人 ", nextCursor: 5 });
  });

  it("adds a space before existing body text so the name does not glue", () => {
    expect(
      buildMentionInsertion({
        value: "@请看这篇",
        triggerOffset: 0,
        cursor: 1,
        displayName: "市场助手",
      }),
    ).toEqual({ next: "@市场助手 请看这篇", nextCursor: 6 });
  });

  it("does not double the space when the suffix already starts with whitespace", () => {
    expect(
      buildMentionInsertion({
        value: "@ 你好",
        triggerOffset: 0,
        cursor: 1,
        displayName: "所有人",
      }),
    ).toEqual({ next: "@所有人 你好", nextCursor: 5 });
  });

  it("places the caret after the separator for any selected member name", () => {
    const inserted = buildMentionInsertion({
      value: "先说 @",
      triggerOffset: 3,
      cursor: 4,
      displayName: "高密度分析",
    });
    expect(inserted.next).toBe("先说 @高密度分析 ");
    expect(inserted.next.slice(inserted.nextCursor)).toBe("");
    expect(inserted.next[inserted.nextCursor - 1]).toBe(" ");
  });
});
