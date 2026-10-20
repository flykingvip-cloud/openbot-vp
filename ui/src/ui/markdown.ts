import DOMPurify from "dompurify";
import { marked } from "marked";
import { truncateText } from "./format.ts";

const allowedTags = [
  "a",
  "b",
  "blockquote",
  "br",
  "code",
  "del",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "i",
  "li",
  "ol",
  "p",
  "pre",
  "strong",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "ul",
  "img",
];

const allowedAttrs = ["class", "href", "rel", "target", "title", "start", "src", "alt"];
const sanitizeOptions = {
  ALLOWED_TAGS: allowedTags,
  ALLOWED_ATTR: allowedAttrs,
  ADD_DATA_URI_TAGS: ["img"],
};

let hooksInstalled = false;
const MARKDOWN_CHAR_LIMIT = 140_000;
const MARKDOWN_PARSE_LIMIT = 40_000;
const MARKDOWN_CACHE_LIMIT = 200;
const MARKDOWN_CACHE_MAX_CHARS = 50_000;
const INLINE_DATA_IMAGE_RE = /^data:image\/[a-z0-9.+-]+;base64,/i;
const markdownCache = new Map<string, string>();
type DOMPurifyLike = {
  addHook: (hook: string, callback: (node: Element) => void) => void;
  sanitize: (html: string, options?: typeof sanitizeOptions) => string;
};

let domPurifyInstance: DOMPurifyLike | null = null;

function getCachedMarkdown(key: string): string | null {
  const cached = markdownCache.get(key);
  if (cached === undefined) {
    return null;
  }
  markdownCache.delete(key);
  markdownCache.set(key, cached);
  return cached;
}

function setCachedMarkdown(key: string, value: string) {
  markdownCache.set(key, value);
  if (markdownCache.size <= MARKDOWN_CACHE_LIMIT) {
    return;
  }
  const oldest = markdownCache.keys().next().value;
  if (oldest) {
    markdownCache.delete(oldest);
  }
}

function getDomPurify(): DOMPurifyLike | null {
  if (domPurifyInstance) {
    return domPurifyInstance;
  }
  const candidate = DOMPurify as unknown as DOMPurifyLike | ((window: Window) => DOMPurifyLike);
  if (
    typeof candidate === "object" &&
    candidate !== null &&
    typeof candidate.sanitize === "function" &&
    typeof candidate.addHook === "function"
  ) {
    domPurifyInstance = candidate;
    return domPurifyInstance;
  }
  if (typeof candidate === "function" && typeof window !== "undefined") {
    domPurifyInstance = candidate(window);
    return domPurifyInstance;
  }
  return null;
}

function installHooks() {
  if (hooksInstalled) {
    return;
  }
  const purifier = getDomPurify();
  if (!purifier) {
    return;
  }
  hooksInstalled = true;

  purifier.addHook("afterSanitizeAttributes", (node) => {
    if (!(node instanceof HTMLAnchorElement)) {
      return;
    }
    const href = node.getAttribute("href");
    if (!href) {
      return;
    }
    if (/^(?:javascript|data|vbscript|file):/i.test(href.trim())) {
      node.removeAttribute("href");
      return;
    }
    node.setAttribute("rel", "noreferrer noopener");
    node.setAttribute("target", "_blank");
  });
}

function sanitizeRenderedHtml(rendered: string) {
  const purifier = getDomPurify();
  const sanitized = purifier ? purifier.sanitize(rendered, sanitizeOptions) : rendered;
  return sanitized.replace(/\shref=(['"])\s*(?:javascript|data|vbscript|file):.*?\1/gi, "");
}

/**
 * Sanitize already-rendered HTML (e.g. a server-rendered .docx via mammoth, or a published
 * article's HTML) for safe inline preview. Unlike toSanitizedMarkdownHtml this does NOT run the
 * markdown parser — the input is real HTML — but it applies the same DOMPurify allow-list + link
 * hardening (data-URI images are kept so embedded document images render inline).
 */
export function toSanitizedHtml(rawHtml: string): string {
  const input = rawHtml.trim();
  if (!input) {
    return "";
  }
  installHooks();
  return sanitizeRenderedHtml(input);
}

export function toSanitizedMarkdownHtml(markdown: string): string {
  const input = markdown.trim();
  if (!input) {
    return "";
  }
  installHooks();
  if (input.length <= MARKDOWN_CACHE_MAX_CHARS) {
    const cached = getCachedMarkdown(input);
    if (cached !== null) {
      return cached;
    }
  }
  const truncated = truncateText(input, MARKDOWN_CHAR_LIMIT);
  const suffix = truncated.truncated
    ? `\n\n… truncated (${truncated.total} chars, showing first ${truncated.text.length}).`
    : "";
  if (truncated.text.length > MARKDOWN_PARSE_LIMIT) {
    const escaped = escapeHtml(`${truncated.text}${suffix}`);
    const html = `<pre class="code-block">${escaped}</pre>`;
    const sanitized = sanitizeRenderedHtml(html);
    if (input.length <= MARKDOWN_CACHE_MAX_CHARS) {
      setCachedMarkdown(input, sanitized);
    }
    return sanitized;
  }
  let rendered: string;
  try {
    rendered = marked.parse(`${truncated.text}${suffix}`, {
      renderer: htmlEscapeRenderer,
      gfm: true,
      breaks: true,
    }) as string;
  } catch (err) {
    // Fall back to escaped plain text when marked.parse() throws (e.g.
    // infinite recursion on pathological markdown patterns — #36213).
    console.warn("[markdown] marked.parse failed, falling back to plain text:", err);
    const escaped = escapeHtml(`${truncated.text}${suffix}`);
    rendered = `<pre class="code-block">${escaped}</pre>`;
  }
  const sanitized = sanitizeRenderedHtml(rendered);
  if (input.length <= MARKDOWN_CACHE_MAX_CHARS) {
    setCachedMarkdown(input, sanitized);
  }
  return sanitized;
}

// Prevent raw HTML in chat messages from being rendered as formatted HTML.
// Display it as escaped text so users see the literal markup.
// Security is handled by DOMPurify, but rendering pasted HTML (e.g. error
// pages) as formatted output is confusing UX (#13937).
const htmlEscapeRenderer = new marked.Renderer();
htmlEscapeRenderer.html = ({ text }: { text: string }) => escapeHtml(text);
htmlEscapeRenderer.image = (token: { href?: string | null; text?: string | null }) => {
  const label = normalizeMarkdownImageLabel(token.text);
  const href = token.href?.trim() ?? "";
  if (!INLINE_DATA_IMAGE_RE.test(href)) {
    return escapeHtml(label);
  }
  return `<img src="${escapeHtml(href)}" alt="${escapeHtml(label)}">`;
};

function normalizeMarkdownImageLabel(text?: string | null): string {
  const trimmed = text?.trim();
  return trimmed ? trimmed : "image";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
