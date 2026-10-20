import { describe, expect, test } from "vitest";
import { collectMentionTokens, hasBroadcastMention } from "./mention-utils.js";

describe("collaboration mention utils", () => {
  test("strips trailing Chinese glue phrases from mention tokens", () => {
    expect(collectMentionTokens("@Skill孵化你在吗").has("skill孵化")).toBe(true);
  });

  test("preserves glued body text when no glue phrase matches", () => {
    expect(collectMentionTokens("@Skill孵化我同意你的建议").has("skill孵化我同意你的建议")).toBe(
      true,
    );
  });

  test("merges explicit mentions with inline tokens", () => {
    const tokens = collectMentionTokens("请协助", ["@市场助手"]);
    expect(tokens.has("市场助手")).toBe(true);
  });

  test("detects @everyone / @所有人 without inventing a speaker", () => {
    expect(hasBroadcastMention(collectMentionTokens("@所有人看一下"))).toBe(true);
    expect(hasBroadcastMention(collectMentionTokens("hi @everyone"))).toBe(true);
    expect(hasBroadcastMention(collectMentionTokens("请 @市场助手"))).toBe(false);
  });

  test("ignores @ tokens inside composer quote blocks (quoted history)", () => {
    const quoted = "【引用】\n> @bot-a 请先检查\n\n@bot-b 为什么？";
    expect(collectMentionTokens(quoted)).toEqual(new Set(["bot-b"]));
  });

  test("ignores multiple stacked quote blocks before the user body", () => {
    const quoted = "【引用】\n> @bot-a 旧结论\n\n【引用】\n> @所有人 旧广播\n\n请 @bot-c 继续";
    expect(collectMentionTokens(quoted)).toEqual(new Set(["bot-c"]));
  });

  test("does not treat email @ as a mention start (CN punct after domain)", () => {
    const text = "elledecke204@gmail.com），所以在我这儿你显示为 bot-2";
    expect(collectMentionTokens(text)).toEqual(new Set());
  });

  test("pure email yields no mention tokens", () => {
    expect(collectMentionTokens("联系 elledecke204@gmail.com 即可")).toEqual(new Set());
    expect(collectMentionTokens("a@b.com")).toEqual(new Set());
  });

  test("email then real @mention keeps only the mention", () => {
    const text = "user@gmail.com，请 @市场助手 继续";
    expect(collectMentionTokens(text)).toEqual(new Set(["市场助手"]));
  });

  test("multi-@ mentions still collect each token", () => {
    expect(collectMentionTokens("请 @bot-a 和 @bot-b 一起看")).toEqual(new Set(["bot-a", "bot-b"]));
  });

  test("Chinese paren/comma after email does not leak domain tokens", () => {
    const samples = [
      "标签是 elledecke204@gmail.com)，不是真人",
      "见 elledecke204@gmail.com）。完",
      "邮箱（elledecke204@gmail.com）后面还有字",
    ];
    for (const text of samples) {
      const tokens = [...collectMentionTokens(text)];
      expect(tokens.some((t) => t.includes("gmail.com"))).toBe(false);
      expect(tokens).toEqual([]);
    }
  });

  test("glued Chinese @成员名 without space still works", () => {
    expect(collectMentionTokens("请@市场助手帮忙").has("市场助手")).toBe(true);
  });

  test("strips Chinese enumeration comma (顿号) after @token", () => {
    // Live wake bug: assistant wrote "@市场助手、@熊猫学习" and toAgentIds kept "市场助手、".
    expect(collectMentionTokens("@市场助手、@熊猫学习")).toEqual(new Set(["市场助手", "熊猫学习"]));
    expect(collectMentionTokens("@Skill孵化、@高级秘书")).toEqual(
      new Set(["skill孵化", "高级秘书"]),
    );
  });
});
