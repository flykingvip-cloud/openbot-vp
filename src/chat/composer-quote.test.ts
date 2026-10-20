import { describe, expect, it } from "vitest";
import { collectMentionTokens } from "../gateway/collaboration-dispatch/mention-utils.js";
import {
  composeQuotedUserMessage,
  excerptForQuote,
  normalizeComposerQuote,
  QUOTE_EXCERPT_MAX_CHARS,
} from "./composer-quote.js";

describe("composer-quote", () => {
  it("normalizes structured quote metadata", () => {
    expect(normalizeComposerQuote(null)).toBeNull();
    expect(normalizeComposerQuote({ excerpt: "   " })).toBeNull();
    expect(normalizeComposerQuote({ excerpt: "下一步", messageId: "m-1" })).toEqual({
      messageId: "m-1",
      excerpt: "下一步",
    });
    expect(normalizeComposerQuote({ excerpt: "x", messageId: null })).toEqual({
      messageId: null,
      excerpt: "x",
    });
  });

  it("truncates excerpt during normalization", () => {
    const long = "测".repeat(QUOTE_EXCERPT_MAX_CHARS + 8);
    const normalized = normalizeComposerQuote({ excerpt: long });
    expect(normalized?.excerpt.endsWith("…")).toBe(true);
    expect(excerptForQuote(long).endsWith("…")).toBe(true);
  });

  it("structured quote keeps mention parsing on composer body only", () => {
    const quote = { messageId: "m-1", excerpt: "@bot-a 请先检查数据" };
    const body = "@bot-b 为什么？";
    const layers = {
      mentionMessage: body,
      transcriptMessage: composeQuotedUserMessage(quote, body),
    };
    expect(collectMentionTokens(layers.transcriptMessage)).toEqual(new Set(["bot-b"]));
    expect(collectMentionTokens(layers.mentionMessage)).toEqual(new Set(["bot-b"]));
    expect(collectMentionTokens(layers.transcriptMessage)).not.toContain("bot-a");
  });
});
