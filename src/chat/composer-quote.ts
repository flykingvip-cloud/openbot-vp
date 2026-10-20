export const QUOTE_EXCERPT_MAX_CHARS = 240;

/** Visually similar to `@`, but not matched by gateway `/@…/` mention scanning. */
const MENTION_NEUTRAL_AT = "\uFF20";

export type ChatComposerQuote = {
  messageId: string | null;
  excerpt: string;
};

export function neutralizeMentionTriggersInQuoteText(text: string): string {
  return text.replace(/@/g, MENTION_NEUTRAL_AT);
}

export function excerptForQuote(text: string, max = QUOTE_EXCERPT_MAX_CHARS): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  const chars = Array.from(normalized);
  if (chars.length <= max) {
    return normalized;
  }
  return `${chars.slice(0, max).join("")}…`;
}

export function buildQuoteDraft(input: {
  messageId?: string | null;
  text: string;
}): ChatComposerQuote | null {
  const excerpt = excerptForQuote(input.text);
  if (!excerpt) {
    return null;
  }
  const messageId = input.messageId?.trim() || null;
  return { messageId, excerpt };
}

export function composeQuotedUserMessage(quote: ChatComposerQuote, draft: string): string {
  const excerpt = neutralizeMentionTriggersInQuoteText(quote.excerpt.trim());
  const body = draft.trim();
  if (!excerpt) {
    return body;
  }
  const quoteBlock = `【引用】\n> ${excerpt}`;
  if (!body) {
    return quoteBlock;
  }
  if (body.startsWith("【引用】")) {
    return body;
  }
  return `${quoteBlock}\n\n${body}`;
}

export function normalizeComposerQuote(input: unknown): ChatComposerQuote | null {
  if (!input || typeof input !== "object") {
    return null;
  }
  const record = input as Record<string, unknown>;
  const excerptRaw = typeof record.excerpt === "string" ? record.excerpt : "";
  const excerpt = excerptForQuote(excerptRaw);
  if (!excerpt) {
    return null;
  }
  const messageIdRaw = record.messageId;
  let messageId: string | null = null;
  if (messageIdRaw != null && typeof messageIdRaw === "string") {
    messageId = messageIdRaw.trim() || null;
  }
  return { messageId, excerpt };
}
