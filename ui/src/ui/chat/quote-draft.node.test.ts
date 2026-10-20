import { describe, expect, it } from "vitest";
import { collectMentionTokens } from "../../../../src/gateway/collaboration-dispatch/mention-utils.js";
import {
  QUOTE_EXCERPT_MAX_CHARS,
  buildQuoteDraft,
  composeQuotedUserMessage,
  excerptForQuote,
  neutralizeMentionTriggersInQuoteText,
} from "./quote-draft.ts";

describe("quote-draft", () => {
  it("collapses whitespace and truncates excerpts", () => {
    expect(excerptForQuote("  hello\n\nworld  ")).toBe("hello world");
    const long = "测".repeat(QUOTE_EXCERPT_MAX_CHARS + 8);
    const excerpt = excerptForQuote(long);
    expect(Array.from(excerpt).length).toBe(QUOTE_EXCERPT_MAX_CHARS + 1);
    expect(excerpt.endsWith("…")).toBe(true);
  });

  it("rejects empty quotes", () => {
    expect(buildQuoteDraft({ text: "   " })).toBeNull();
    expect(buildQuoteDraft({ messageId: "m-1", text: "下一步怎么做？" })).toEqual({
      messageId: "m-1",
      excerpt: "下一步怎么做？",
    });
  });

  it("prefixes a short quote block without duplicating the original turn", () => {
    const quote = { messageId: "m-1", excerpt: "先改邀请门槛" };
    expect(composeQuotedUserMessage(quote, "")).toBe("【引用】\n> 先改邀请门槛");
    expect(composeQuotedUserMessage(quote, "那员工怎么邀请？")).toBe(
      "【引用】\n> 先改邀请门槛\n\n那员工怎么邀请？",
    );
    expect(composeQuotedUserMessage(quote, "【引用】\n> 先改邀请门槛\n\n已写过")).toBe(
      "【引用】\n> 先改邀请门槛\n\n已写过",
    );
  });

  it("neutralizes @ in quoted excerpts so gateway mention parsing ignores history", () => {
    expect(neutralizeMentionTriggersInQuoteText("@市场助手 请检查")).toBe("＠市场助手 请检查");

    const quote = { messageId: "m-1", excerpt: "@bot-a 请先检查数据" };
    const composed = composeQuotedUserMessage(quote, "为什么？");
    expect(composed).toContain("＠bot-a 请先检查数据");
    expect(collectMentionTokens(composed)).toEqual(new Set());

    const withExplicitMention = composeQuotedUserMessage(quote, "@bot-b 为什么？");
    expect(collectMentionTokens(withExplicitMention)).toEqual(new Set(["bot-b"]));
  });
});
