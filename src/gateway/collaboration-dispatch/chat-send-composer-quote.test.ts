import { describe, expect, it } from "vitest";
import { resolveComposerQuoteSendLayers } from "./chat-send-composer-quote.js";
import { collectMentionTokens } from "./mention-utils.js";

describe("resolveComposerQuoteSendLayers", () => {
  it("passes body-only text to mention parsing when composerQuote is structured", () => {
    const layers = resolveComposerQuoteSendLayers({
      bodyMessage: "@bot-b 继续",
      composerQuote: { messageId: "m-1", excerpt: "@bot-a 历史回复" },
    });
    expect(layers.composerQuote?.messageId).toBe("m-1");
    expect(layers.mentionMessage).toBe("@bot-b 继续");
    expect(layers.transcriptMessage).toContain("＠bot-a 历史回复");
    expect(collectMentionTokens(layers.transcriptMessage)).toEqual(new Set(["bot-b"]));
  });

  it("falls back to legacy single-field message when composerQuote is absent", () => {
    const legacy = "【引用】\n> ＠bot-a\n\n@bot-b 为什么";
    const layers = resolveComposerQuoteSendLayers({ bodyMessage: legacy });
    expect(layers.composerQuote).toBeNull();
    expect(layers.mentionMessage).toBe(legacy);
    expect(layers.transcriptMessage).toBe(legacy);
    expect(collectMentionTokens(layers.transcriptMessage)).toEqual(new Set(["bot-b"]));
  });
});
