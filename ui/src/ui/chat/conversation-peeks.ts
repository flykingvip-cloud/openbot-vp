import { PREVIEW_MAX_CHARS, PREVIEW_MAX_LINES } from "./constants.ts";
import { resolveMessageDomId } from "./focus-message.ts";
import { extractText } from "./message-extract.ts";
import { normalizeRoleForGrouping } from "./message-normalizer.ts";

/**
 * Hard cap for prior user turns on the string rail.
 * Latest user turn is never shown. Extra older turns drop off the top.
 */
export const CONVERSATION_PEEK_LIMIT = 35;

/** Rail starts at the reader top and may grow through the lower half. */
export const CONVERSATION_PEEK_TOP_INSET_PX = 12;
export const CONVERSATION_PEEK_PAD_Y_PX = 28;
export const CONVERSATION_PEEK_ITEM_MIN_PX = 10;

export const CONVERSATION_PEEK_WAVE_MIN = 8;
export const CONVERSATION_PEEK_WAVE_MAX = 28;
export const CONVERSATION_PEEK_WAVE_SIGMA = 26;

export type ConversationPeek = {
  key: string;
  messageId: string;
  title: string;
  preview: string;
};

const SENTENCE_END = /[。！？.!?]/;

function collapseWhitespace(value: string): string {
  return value.replace(/[ \t]+/g, " ").trim();
}

function truncatePreview(text: string): string {
  const lines = text.split("\n").slice(0, PREVIEW_MAX_LINES);
  const preview = lines.join("\n").trimEnd();
  if (preview.length > PREVIEW_MAX_CHARS) {
    return `${preview.slice(0, PREVIEW_MAX_CHARS)}…`;
  }
  const totalLines = text.split("\n").length;
  return totalLines > PREVIEW_MAX_LINES ? `${preview}…` : preview;
}

function firstSentenceEnd(text: string): number {
  const match = SENTENCE_END.exec(text);
  return match && match.index !== undefined ? match.index + match[0].length : -1;
}

/** Split user copy into a one-line title and a two-line preview. */
export function splitUserPeekCopy(text: string): { title: string; preview: string } {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return { title: "", preview: "" };
  }

  const lineBreak = normalized.indexOf("\n");
  if (lineBreak >= 0) {
    return {
      title: collapseWhitespace(normalized.slice(0, lineBreak)),
      preview: truncatePreview(normalized.slice(lineBreak + 1).trim()),
    };
  }

  const sentenceEnd = firstSentenceEnd(normalized);
  if (sentenceEnd > 0 && sentenceEnd < normalized.length) {
    return {
      title: collapseWhitespace(normalized.slice(0, sentenceEnd)),
      preview: truncatePreview(normalized.slice(sentenceEnd).trim()),
    };
  }

  return { title: collapseWhitespace(normalized), preview: "" };
}

function isUserMessage(message: unknown): boolean {
  if (!message || typeof message !== "object") {
    return false;
  }
  const role = (message as { role?: unknown }).role;
  if (typeof role !== "string") {
    return false;
  }
  return normalizeRoleForGrouping(role).toLowerCase() === "user";
}

/**
 * Map already-visible transcript rows to left-rail peeks.
 * Caller must pass the same rendered window as the thread
 * (`CHAT_HISTORY_RENDER_LIMIT`).
 */
export function buildConversationPeeks(
  messages: unknown[],
  peekLimit = CONVERSATION_PEEK_LIMIT,
): ConversationPeek[] {
  if (!Array.isArray(messages) || peekLimit <= 0) {
    return [];
  }

  const userTurns: ConversationPeek[] = [];
  for (const message of messages) {
    if (!isUserMessage(message)) {
      continue;
    }
    const messageId = resolveMessageDomId(message);
    if (!messageId) {
      continue;
    }
    const text = extractText(message)?.trim() ?? "";
    if (!text) {
      continue;
    }
    const { title, preview } = splitUserPeekCopy(text);
    if (!title) {
      continue;
    }
    userTurns.push({
      key: `peek:${messageId}`,
      messageId,
      title,
      preview,
    });
  }

  if (userTurns.length < 2) {
    return [];
  }

  return userTurns.slice(0, -1).slice(-peekLimit);
}

/**
 * Visible-count SoT. 35 is only a hard cap.
 * Unknown/zero height must return 0 so the first paint does not flash the cap.
 */
export function conversationPeekFitLimit(
  threadHeightPx: number,
  hardCap = CONVERSATION_PEEK_LIMIT,
): number {
  if (!Number.isFinite(threadHeightPx) || threadHeightPx <= 0) {
    return 0;
  }
  const usable = threadHeightPx - CONVERSATION_PEEK_TOP_INSET_PX - CONVERSATION_PEEK_PAD_Y_PX;
  const fit = Math.floor(usable / CONVERSATION_PEEK_ITEM_MIN_PX);
  return Math.max(0, Math.min(hardCap, fit));
}

/**
 * Rail rows or test doubles. DOM `HTMLElement.hidden` is `boolean | string`
 * in this tsconfig, so the setter must accept both or `applyPeekRailFit`
 * fails the diagnostic-delta gate.
 */
export type ConversationPeekVisibilityItem = {
  hidden: boolean | string;
};

/** Hide oldest rows so growth stays downward inside the fitted count. */
export function applyConversationPeekVisibility(
  items: ConversationPeekVisibilityItem[],
  fit: number,
): void {
  const hideCount = Math.max(0, items.length - Math.max(0, fit));
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (!item) {
      continue;
    }
    item.hidden = i < hideCount;
  }
}

/** Horizontal tick length: longest at the pointer, falling off as a wave. */
export function conversationPeekWaveLength(distancePx: number): number {
  const t = Math.exp(-0.5 * (distancePx / CONVERSATION_PEEK_WAVE_SIGMA) ** 2);
  return CONVERSATION_PEEK_WAVE_MIN + (CONVERSATION_PEEK_WAVE_MAX - CONVERSATION_PEEK_WAVE_MIN) * t;
}
