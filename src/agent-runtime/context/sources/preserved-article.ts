/**
 * After a focus-switch contextCut, optionally reinject the last successful
 * article extract so rewrite /「这篇文章」turns still see the body.
 *
 * Gated by messages.preserveArticleAcrossContextCut (default OFF).
 */

import { appendUntrustedContext } from "../untrusted.js";
const DEFAULT_MAX_PRESERVE_CHARS = 12_000;

const REWRITE_OR_ARTICLE_CUE =
  /改写|这篇文章|该文章|上文|刚才那篇|公众号稿|公众号文章|openbot\s*公众号|继续改|按原文|基于原文|原文改/iu;

const URL_RE = /https?:\/\/[^\s<>"')\]]+/gi;

export type PreservedArticleExtract = {
  url?: string;
  title?: string;
  text: string;
  source: "web_fetch" | "exec" | "assistant";
};

export type PreserveArticleOptions = {
  /** When false/undefined, behave like a plain slice (flag default OFF). */
  enabled?: boolean;
  maxChars?: number;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function collectTextParts(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  const parts: string[] = [];
  for (const block of content) {
    const row = asRecord(block);
    if (!row) {
      continue;
    }
    if (typeof row.text === "string") {
      parts.push(row.text);
    } else if (typeof row.content === "string") {
      parts.push(row.content);
    }
  }
  return parts.join("\n");
}

function messageRole(message: unknown): string {
  const row = asRecord(message);
  return typeof row?.role === "string" ? row.role : "";
}

function messageToolName(message: unknown): string {
  const row = asRecord(message);
  return typeof row?.toolName === "string" ? row.toolName : "";
}

function urlsInText(text: string): string[] {
  const found = text.match(URL_RE) ?? [];
  return found.map((u) => u.replace(/[.,;:!?)]+$/, ""));
}

function normalizeUrlKey(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.toString();
  } catch {
    return url.trim();
  }
}

function looksLikeArticleBody(text: string): boolean {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length < 400) {
    return false;
  }
  // Reject obvious shell / error crumbs.
  if (
    trimmed.length < 900 &&
    /页面框架|rawLength|SECURITY NOTICE|抓取失败|extraction failed/i.test(trimmed)
  ) {
    return false;
  }
  return true;
}

function stripExternalWrapper(text: string): string {
  // Keep inner body when present; otherwise return as-is.
  const start = text.indexOf(">>>");
  const end = text.lastIndexOf("<<<");
  if (start >= 0 && end > start) {
    const inner = text.slice(start + 3, end).trim();
    if (inner.length > 80) {
      return inner;
    }
  }
  return text;
}

function titleFromText(text: string): string | undefined {
  const m =
    text.match(/标题[是为：:]\s*[「"']?([^\n「」"']{4,80})/) ||
    text.match(/^#\s+(.+)$/m) ||
    text.match(/og:title|activity-name/i);
  const t = m?.[1]?.trim();
  return t || undefined;
}

/**
 * Scan messages before a contextCut for the last usable article body.
 */
export function findLastPreservableArticleExtract(
  messages: readonly unknown[],
): PreservedArticleExtract | null {
  let lastUrlFromToolCall: string | undefined;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const role = messageRole(msg);
    const row = asRecord(msg);
    if (!row) {
      continue;
    }

    if (role === "assistant") {
      const content = row.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          const b = asRecord(block);
          if (!b) {
            continue;
          }
          if (b.type === "toolCall" && b.name === "web_fetch") {
            const args = asRecord(b.arguments) ?? asRecord(b.input);
            const url = typeof args?.url === "string" ? args.url : undefined;
            if (url) {
              lastUrlFromToolCall = url;
            }
          }
        }
      }
    }

    if (role === "toolResult" || role === "tool") {
      const toolName = messageToolName(msg);
      const raw = collectTextParts(row.content);
      const text = stripExternalWrapper(raw);
      if (!looksLikeArticleBody(text)) {
        continue;
      }
      if (toolName === "web_fetch" || /web_fetch|EXTERNAL_UNTRUSTED_CONTENT/i.test(raw)) {
        const urls = urlsInText(raw);
        return {
          url: lastUrlFromToolCall ?? urls.find((u) => /mp\.weixin\.qq\.com/i.test(u)) ?? urls[0],
          title: titleFromText(text),
          text,
          source: "web_fetch",
        };
      }
      if (
        toolName === "exec" ||
        toolName === "bash" ||
        /js_content|activity-name|rich_media_content/i.test(text)
      ) {
        const urls = urlsInText(text);
        return {
          url: lastUrlFromToolCall ?? urls.find((u) => /mp\.weixin\.qq\.com/i.test(u)) ?? urls[0],
          title: titleFromText(text),
          text,
          source: "exec",
        };
      }
    }

    if (role === "assistant") {
      const text = collectTextParts(row.content);
      // Prefer explicit "已读完" analyses with substantial body.
      if (/文章已读完|已读完|正文如下|原文内容/u.test(text) && looksLikeArticleBody(text)) {
        const urls = urlsInText(text);
        return {
          url: lastUrlFromToolCall ?? urls[0],
          title: titleFromText(text),
          text,
          source: "assistant",
        };
      }
    }
  }

  // Second pass reverse: last long toolResult wins even without markers.
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (messageRole(msg) !== "toolResult" && messageRole(msg) !== "tool") {
      continue;
    }
    const row = asRecord(msg);
    if (!row) {
      continue;
    }
    const text = stripExternalWrapper(collectTextParts(row.content));
    if (!looksLikeArticleBody(text)) {
      continue;
    }
    const toolName = messageToolName(msg);
    const source: PreservedArticleExtract["source"] =
      toolName === "web_fetch"
        ? "web_fetch"
        : toolName === "exec" || toolName === "bash"
          ? "exec"
          : "exec";
    const urls = urlsInText(text);
    return {
      url: urls.find((u) => /mp\.weixin\.qq\.com/i.test(u)) ?? urls[0],
      title: titleFromText(text),
      text,
      source,
    };
  }

  return null;
}

export function shouldPreserveArticleForIncoming(
  incomingText: string,
  extract: PreservedArticleExtract,
): boolean {
  const text = incomingText.trim();
  if (!text) {
    return false;
  }
  if (REWRITE_OR_ARTICLE_CUE.test(text)) {
    return true;
  }
  if (extract.url) {
    const key = normalizeUrlKey(extract.url);
    const incomingUrls = urlsInText(text).map(normalizeUrlKey);
    if (incomingUrls.some((u) => u === key || u.includes(key) || key.includes(u))) {
      return true;
    }
    // Same WeChat article path id (s/XXXX).
    const id = extract.url.match(/\/s\/([A-Za-z0-9_-]+)/)?.[1];
    if (id && text.includes(id)) {
      return true;
    }
  }
  return false;
}

export function buildPreservedArticleSystemMessage(
  extract: PreservedArticleExtract,
  maxChars = DEFAULT_MAX_PRESERVE_CHARS,
): Record<string, unknown> {
  const body =
    extract.text.length > maxChars
      ? "[Article body omitted: exceeds context budget. Retrieve the original source before rewriting, quoting, or drawing conclusions.]"
      : extract.text;
  const header = [
    "[Preserved article extract from prior turn — reinjected after contextCut]",
    extract.url ? `URL: ${extract.url}` : undefined,
    extract.title ? `Title: ${extract.title}` : undefined,
    `Source: ${extract.source}`,
    extract.text.length > maxChars
      ? "The source was previously extracted, but its body is unavailable in this view. Do not invent its contents."
      : "Use this body for rewrite / follow-up; do not claim the page was only a shell if this extract is present.",
    "---",
    body,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    role: "user",
    content: [{ type: "text", text: appendUntrustedContext("", [header]) }],
    preservedArticleExtract: true,
  };
}

/**
 * Apply contextCut slice, optionally reinjecting a prior article extract.
 */
export function applyContextCutWithOptionalArticlePreserve<T>(
  messages: readonly T[],
  cutAt: number,
  options?: PreserveArticleOptions,
): T[] {
  if (cutAt <= 0) {
    return [...messages];
  }
  const after = messages.slice(cutAt);
  if (!options?.enabled) {
    return after;
  }
  const prior = messages.slice(0, cutAt);
  const extract = findLastPreservableArticleExtract(prior);
  if (!extract) {
    return after;
  }
  const first = after[0];
  const incomingText = collectTextParts(asRecord(first)?.content ?? first);
  if (!shouldPreserveArticleForIncoming(incomingText, extract)) {
    return after;
  }
  const injection = buildPreservedArticleSystemMessage(
    extract,
    options.maxChars ?? DEFAULT_MAX_PRESERVE_CHARS,
  );
  return [after[0], injection as T, ...after.slice(1)];
}
