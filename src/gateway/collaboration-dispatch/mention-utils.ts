const MENTION_TRAILING_PUNCTUATION = /[，。、！？!?,.:;；：)）\]】]+$/g;
const MENTION_TRAILING_GLUE_PHRASES =
  /(你在吗|在吗|在不在|好吗|行吗|可以吗|帮忙|请回复|请回答|请问)$/u;

export function normalizeMentionIdentity(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  return normalized.replace(/\s+/g, "");
}

export function normalizeAgentIdentifier(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase();
  return normalized || null;
}

function normalizeMentionToken(raw: string) {
  const stripped = raw
    .replace(MENTION_TRAILING_PUNCTUATION, "")
    .replace(MENTION_TRAILING_GLUE_PHRASES, "");
  return normalizeMentionIdentity(stripped);
}

const BROADCAST_MENTION_TOKENS = new Set(["所有人", "everyone", "all", "__all__"]);

/** @everyone / @所有人 / @all — resolved as broadcast, not as an unmatched name. */
export function isBroadcastMentionToken(token: string | null | undefined): boolean {
  const normalized = normalizeMentionIdentity(token);
  if (!normalized) {
    return false;
  }
  if (BROADCAST_MENTION_TOKENS.has(normalized)) {
    return true;
  }
  // @所有人看一下 / @everyoneplease — do not prefix-match short "all".
  return normalized.startsWith("所有人") || normalized.startsWith("everyone");
}

export function hasBroadcastMention(tokens: Iterable<string>): boolean {
  for (const token of tokens) {
    if (isBroadcastMentionToken(token)) {
      return true;
    }
  }
  return false;
}

export function hasNonBroadcastMention(tokens: Iterable<string>): boolean {
  for (const token of tokens) {
    if (!isBroadcastMentionToken(token)) {
      return true;
    }
  }
  return false;
}

/** Matches UI `composeQuotedUserMessage()` prefix — history replay, not user intent. */
const COMPOSER_QUOTE_BLOCK_PREFIX = "【引用】";

/**
 * Strip quoted-turn blocks before mention scanning so assistant history cannot
 * re-trigger dispatch. UI also neutralizes `@` in excerpts; this is fail-closed
 * at the gateway for older clients or manual paste of quote blocks.
 */
export function stripComposerQuoteBlocksForMentionScan(text: string): string {
  let remaining = text;
  let stripped = "";
  while (remaining.startsWith(COMPOSER_QUOTE_BLOCK_PREFIX)) {
    const splitIndex = remaining.indexOf("\n\n");
    if (splitIndex === -1) {
      return stripped;
    }
    stripped += remaining.slice(0, splitIndex + 2);
    remaining = remaining.slice(splitIndex + 2);
  }
  return remaining;
}

/**
 * Inline @mention scanner.
 * Skip `@` that is part of an email local-part (e.g. user@gmail.com) so CN
 * punctuation after the domain cannot become a garbage toAgentId token.
 * Legitimate `@成员名` / `@bot` still match when `@` is not email-mid.
 */
const INLINE_MENTION_RE = /(?<![A-Za-z0-9._%+-])@([^\s@]+)/gu;

export function collectMentionTokens(text: string, explicitMentions: string[] = []) {
  const tokens = new Set<string>();
  const mentionScanText = stripComposerQuoteBlocksForMentionScan(text);
  for (const match of mentionScanText.matchAll(INLINE_MENTION_RE)) {
    const normalized = normalizeMentionToken(match[1] ?? "");
    if (normalized) {
      tokens.add(normalized);
    }
  }
  for (const mention of explicitMentions) {
    const normalized = normalizeMentionToken(mention.replace(/^@+/, ""));
    if (normalized) {
      tokens.add(normalized);
    }
  }
  return tokens;
}

export function isLowSignalOpenDiscussionMessage(text: string) {
  const normalized = text.replace(/\s+/g, "").trim().toLowerCase();
  if (!normalized || normalized.includes("@") || /[?？]/.test(text)) {
    return false;
  }
  if (normalized.length > 48) {
    return false;
  }
  const actionSignals = [
    "请",
    "需要",
    "帮",
    "分析",
    "制定",
    "讨论",
    "输出",
    "总结",
    "决策",
    "下一步",
    "怎么办",
  ];
  if (actionSignals.some((signal) => normalized.includes(signal))) {
    return false;
  }
  const acknowledgementSignals = [
    "ok",
    "okay",
    "好的",
    "收到",
    "明白",
    "谢谢",
    "感谢",
    "非常好",
    "很好",
    "太好了",
    "辛苦了",
    "先这样",
    "就这样",
    "彼此算是认识",
    "彼此认识",
  ];
  return acknowledgementSignals.some((signal) => normalized.includes(signal));
}
