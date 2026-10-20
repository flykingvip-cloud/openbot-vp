import { stripInboundMetadata } from "../../../../src/auto-reply/reply/strip-inbound-meta.js";
import { stripEnvelope } from "../../../../src/shared/chat-envelope.js";
import type { VisibleReplyLanguage } from "../../../../src/shared/text/assistant-scratchpad.js";
import { readTextBlock } from "../../../../src/shared/text/visible-message-text.js";
import { stripInlineDirectiveTagsForDisplay } from "../../../../src/utils/directive-tags.ts";
import { stripThinkingTags } from "../format.ts";

function replyLanguageOf(message: Record<string, unknown>): VisibleReplyLanguage | null {
  const value = message.replyLanguage;
  return value === "zh" || value === "en" ? value : null;
}

const textCache = new WeakMap<object, string | null>();
const thinkingCache = new WeakMap<object, string | null>();

export function stripClientAttachmentManifest(text: string): string {
  return text.replace(/\n{0,2}<attachments>\s*[\s\S]*?<\/attachments>\s*/gi, "").trim();
}

function processMessageText(text: string, role: string): string {
  const shouldStripInboundMetadata = role.toLowerCase() === "user";
  if (role === "assistant") {
    return stripThinkingTags(text);
  }
  return shouldStripInboundMetadata
    ? stripClientAttachmentManifest(stripInboundMetadata(stripEnvelope(text)))
    : stripEnvelope(text);
}

export function extractText(message: unknown): string | null {
  if (!message || typeof message !== "object") {
    return null;
  }
  const m = message as Record<string, unknown>;
  const role = typeof m.role === "string" ? m.role : "";
  const raw = extractRawText(message);
  if (!raw) {
    return null;
  }
  if (m.openclawPeerOutbound === true) {
    return raw;
  }
  return processMessageText(raw, role);
}

export function extractTextCached(message: unknown): string | null {
  if (!message || typeof message !== "object") {
    return extractText(message);
  }
  const obj = message;
  if (textCache.has(obj)) {
    return textCache.get(obj) ?? null;
  }
  const value = extractText(message);
  textCache.set(obj, value);
  return value;
}

export function extractThinking(message: unknown): string | null {
  if (!message || typeof message !== "object") {
    return null;
  }
  const m = message as Record<string, unknown>;
  const content = m.content;
  const parts: string[] = [];
  if (Array.isArray(content)) {
    for (const p of content) {
      if (!p || typeof p !== "object") {
        continue;
      }
      const item = p as Record<string, unknown>;
      if (item.type === "thinking" && typeof item.thinking === "string") {
        const cleaned = item.thinking.trim();
        if (cleaned) {
          parts.push(cleaned);
        }
      }
    }
  }
  if (parts.length > 0) {
    return parts.join("\n");
  }

  // Back-compat: older logs may still have <think> tags inside text blocks.
  const rawText = extractRawText(message);
  if (!rawText) {
    return null;
  }
  const matches = [
    ...rawText.matchAll(/<\s*think(?:ing)?\s*>([\s\S]*?)<\s*\/\s*think(?:ing)?\s*>/gi),
  ];
  const extracted = matches.map((m) => (m[1] ?? "").trim()).filter(Boolean);
  return extracted.length > 0 ? extracted.join("\n") : null;
}

export function extractThinkingCached(message: unknown): string | null {
  if (!message || typeof message !== "object") {
    return extractThinking(message);
  }
  const obj = message;
  if (thinkingCache.has(obj)) {
    return thinkingCache.get(obj) ?? null;
  }
  const value = extractThinking(message);
  thinkingCache.set(obj, value);
  return value;
}

export function extractRawText(message: unknown): string | null {
  const m = message as Record<string, unknown>;
  const role = typeof m.role === "string" ? m.role : "";
  const language = replyLanguageOf(m);
  // Outbound 1:1 envelopes store the sent sentence. Scratchpad stripping would
  // drop a real message that happens to start with a process phrase.
  const keepOutboundBody = m.openclawPeerOutbound === true;
  const stripDelivery =
    role.toLowerCase() === "assistant" && !keepOutboundBody
      ? (value: string) => stripInlineDirectiveTagsForDisplay(value, language).text
      : (value: string) => value;
  const content = m.content;
  if (typeof content === "string") {
    const cleaned = stripDelivery(content);
    return cleaned ? cleaned : null;
  }
  if (Array.isArray(content)) {
    // Join type:text only. type:thinking stays out of the delivery join.
    const parts = content
      .map((p) => {
        const text = readTextBlock(p);
        if (text === undefined) {
          return null;
        }
        return stripDelivery(text);
      })
      .filter((v): v is string => typeof v === "string" && v.trim().length > 0);
    if (parts.length > 0) {
      return parts.join("\n");
    }
  }
  if (typeof m.text === "string") {
    const cleaned = stripDelivery(m.text);
    return cleaned ? cleaned : null;
  }
  return null;
}

export function formatReasoningMarkdown(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return "";
  }
  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `_${line}_`);
  return lines.length ? ["_Reasoning:_", ...lines].join("\n") : "";
}
