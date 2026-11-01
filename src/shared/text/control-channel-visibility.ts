/**
 * Strip gateway/control-channel markers from user-visible chat text.
 *
 * Turn-completion markers, internal continue injectors, tool-digest units, and
 * raw <<DELIVERABLE>> tags belong in structured contracts / model context — not
 * in end-user bubbles. Gateway paths should stop emitting them into visibleText;
 * these helpers are defense-in-depth for history, streaming, and older sessions.
 *
 * Wire deltas must sanitize complete AND incomplete control tokens while leaving
 * the raw/model buffer intact for structured settle / formal submit.
 *
 * Tool digests produced by context-compiler are wrapped in OPENBOT_TOOL_DIGEST
 * sentinels so blank lines inside the preview cannot be mistaken for a reply
 * boundary. Legacy unwrapped `[tool-digest]…` units are consumed to end-of-text
 * (whole-message provenance); mixed real replies must use the sentinel wrap.
 */

/** Structural wrap written by formatToolDigest — trusted digest unit boundary. */
export const TOOL_DIGEST_OPEN_SENTINEL = "<<OPENBOT_TOOL_DIGEST>>";
export const TOOL_DIGEST_CLOSE_SENTINEL = "<</OPENBOT_TOOL_DIGEST>>";

/** Bracket turn_completion control lines (delivered / permanent_block / true_fork). */
const TURN_COMPLETION_LINE_RE = /^\s*\[turn_completion\b[^\]]*\]\s*$/gim;
const TURN_COMPLETION_INLINE_RE = /\[turn_completion\s+state=[^\]]*\]/gi;
/** Incomplete trailing turn_completion (streaming char-split / truncated). */
const TURN_COMPLETION_INCOMPLETE_RE = /\[turn_completion\b[^\]]*$/i;

/** Internal auto-continue injectors (task-board + execution-stall). */
const INTERNAL_CONTINUE_PREFIX_RE = /^\s*Internal (?:task-board|execution) continue:\s*$/im;

/**
 * Sentinel-wrapped tool-digest units (header + preview, may contain blank lines).
 */
const TOOL_DIGEST_WRAPPED_RE =
  /<<\s*OPENBOT_TOOL_DIGEST\s*>>\s*[\s\S]*?<<\s*\/\s*OPENBOT_TOOL_DIGEST\s*>>/gi;
/** Open sentinel present but close missing — consume through end of text. */
const TOOL_DIGEST_WRAPPED_INCOMPLETE_RE = /<<\s*OPENBOT_TOOL_DIGEST\b[^>]*>[\s\S]*$/i;

/**
 * Legacy unwrapped `[tool-digest]` units: consume from header through end of
 * string. Blank lines are NOT a reply boundary (preview may contain them).
 * Mixed “digest then real answer” must use TOOL_DIGEST_*_SENTINEL wrappers.
 */
const TOOL_DIGEST_LEGACY_TO_END_RE = /[ \t]*\[tool-digest\][\s\S]*$/gi;
/** Incomplete trailing tool-digest open (streaming). */
const TOOL_DIGEST_INCOMPLETE_RE = /\[tool-digest\b[^\]]*$/i;

/** Complete <<DELIVERABLE>>…<</DELIVERABLE>> blocks — keep body, drop tags. */
const TAGGED_DELIVERABLE_RE = /<<\s*DELIVERABLE\b[^>]*>+([\s\S]*?)<<\s*\/\s*DELIVERABLE\s*>>/gi;

/** Orphan open/close tags that reached a `>` but are not a complete envelope. */
const ORPHAN_DELIVERABLE_TAG_RE = /<<\s*\/?\s*DELIVERABLE\b[^>]*>>?/gi;

/** Unclosed <<DELIVERABLE … fragment (no `>` yet) — common mid-stream. */
const UNCLOSED_DELIVERABLE_OPEN_RE = /<<\s*\/?\s*DELIVERABLE\b[^<]*$/i;

/** Absolute tenant locators that must not appear in user-facing copy. */
const ABSOLUTE_TENANT_PATH_RE = /\/(?:root|var)\/[^\s，。；;、]*openbot-tenants\/[^\s，。；;、]*/gi;

const BRACKET_CONTROL_KEYWORDS = ["turn_completion", "tool-digest"] as const;
const ANGLE_CONTROL_TAGS = ["DELIVERABLE", "OPENBOT_TOOL_DIGEST"] as const;
const INTERNAL_CONTINUE_OPENERS = [
  "Internal task-board continue:",
  "Internal execution continue:",
] as const;

export function stripTurnCompletionMarkers(text: string): string {
  if (!text || !/\[turn_completion\b/i.test(text)) {
    return text;
  }
  return text
    .replace(TURN_COMPLETION_LINE_RE, "")
    .replace(TURN_COMPLETION_INLINE_RE, "")
    .replace(TURN_COMPLETION_INCOMPLETE_RE, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Remove tool-digest units (sentinel-wrapped or legacy header→EOF).
 * Does not use blank lines as a preview/reply boundary.
 */
export function stripToolDigestLines(text: string): string {
  if (!text) {
    return text;
  }
  const hasDigest = /\[tool-digest\]/i.test(text) || /OPENBOT_TOOL_DIGEST/i.test(text);
  if (!hasDigest) {
    return text;
  }
  return text
    .replace(TOOL_DIGEST_WRAPPED_RE, "")
    .replace(TOOL_DIGEST_WRAPPED_INCOMPLETE_RE, "")
    .replace(TOOL_DIGEST_LEGACY_TO_END_RE, "")
    .replace(TOOL_DIGEST_INCOMPLETE_RE, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Replace tagged deliverable envelopes with their body text; drop orphan tags
 * and unclosed open fragments. Does not touch ordinary 「…」 prose quotes.
 */
export function stripDeliverableEnvelopeTags(text: string): string {
  if (!text || !/<<\s*\/?\s*DELIVERABLE\b/i.test(text)) {
    return text;
  }
  const withBodies = text.replace(TAGGED_DELIVERABLE_RE, (_full, body: string) => {
    const normalized = (body ?? "").replace(/^\s+|\s+$/g, "");
    return normalized;
  });
  return withBodies
    .replace(ORPHAN_DELIVERABLE_TAG_RE, "")
    .replace(UNCLOSED_DELIVERABLE_OPEN_RE, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** True when text is (or starts with) an internal continue injector prompt. */
export function isInternalContinuePromptText(text: string): boolean {
  const trimmed = text.trimStart();
  if (!trimmed) {
    return false;
  }
  return (
    trimmed.startsWith("Internal task-board continue:") ||
    trimmed.startsWith("Internal execution continue:") ||
    INTERNAL_CONTINUE_PREFIX_RE.test(trimmed.split("\n", 1)[0] ?? "")
  );
}

/**
 * Redact internal tenant locator leaks only.
 * Do NOT rewrite ordinary /tmp, /Users, or user-authorized file/attachment links.
 */
export function stripAbsoluteWorkspacePaths(text: string): string {
  if (!text) {
    return text;
  }
  return text.replace(ABSOLUTE_TENANT_PATH_RE, "workspace");
}

function isIncompleteBracketControl(suffix: string): boolean {
  if (!suffix.startsWith("[")) {
    return false;
  }
  // A completed bracket token belongs to strip*, not hold-back.
  if (suffix.includes("]")) {
    return false;
  }
  const inner = suffix.slice(1);
  for (const keyword of BRACKET_CONTROL_KEYWORDS) {
    const lowerInner = inner.toLowerCase();
    const lowerKw = keyword.toLowerCase();
    // Proper prefix of the keyword (including bare "[").
    if (lowerKw.startsWith(lowerInner) && lowerInner.length < lowerKw.length) {
      return true;
    }
    // Full keyword + optional attrs, still missing "]".
    if (lowerInner.startsWith(lowerKw)) {
      const afterKw = inner.slice(keyword.length);
      if (afterKw.length === 0) {
        return true;
      }
      // Reject lookalikes like [turn_completionX…
      if (/^[a-zA-Z0-9_]/.test(afterKw)) {
        continue;
      }
      return true;
    }
  }
  return false;
}

function isIncompleteAngleControl(suffix: string): boolean {
  if (!suffix.startsWith("<<")) {
    return false;
  }
  let i = 2;
  while (i < suffix.length && /[ \t]/.test(suffix[i])) {
    i += 1;
  }
  if (i < suffix.length && suffix[i] === "/") {
    i += 1;
  }
  while (i < suffix.length && /[ \t]/.test(suffix[i])) {
    i += 1;
  }
  const rest = suffix.slice(i);
  // `<<` / `<< ` / `<</` / `<</ ` — still a proper prefix of a control tag.
  if (rest.length === 0) {
    return true;
  }
  for (const tag of ANGLE_CONTROL_TAGS) {
    const lowerRest = rest.toLowerCase();
    const lowerTag = tag.toLowerCase();
    if (lowerTag.startsWith(lowerRest) && lowerRest.length < lowerTag.length) {
      return true;
    }
    if (lowerRest.startsWith(lowerTag)) {
      const after = rest.slice(tag.length);
      if (after.length > 0 && /^[a-zA-Z0-9_]/.test(after)) {
        continue;
      }
      // Full tag keyword matched; hold until `>` so strip/orphan can take over.
      return !after.includes(">");
    }
  }
  return false;
}

function isIncompleteInternalContinueLine(line: string): boolean {
  if (!line) {
    return false;
  }
  const lower = line.toLowerCase();
  for (const opener of INTERNAL_CONTINUE_OPENERS) {
    const lowerOpener = opener.toLowerCase();
    if (lowerOpener.startsWith(lower) && lower.length > 0 && lower.length < lowerOpener.length) {
      return true;
    }
    if (lower.startsWith(lowerOpener)) {
      // Complete opener — whole-message path hides via isInternalContinuePromptText.
      return false;
    }
  }
  // Shared proper prefix of both openers ("I" … "Internal ").
  if ("internal ".startsWith(lower) && lower.length > 0) {
    return true;
  }
  return false;
}

/**
 * Hold back a trailing suffix that looks like the start of a control token but
 * is not yet a complete marker (char-split streaming). Holds ANY proper prefix
 * of known control tokens (line-start or mid-line). Safe no-op when the suffix
 * is ordinary prose (Markdown links, HTML, comparisons).
 */
export function holdBackIncompleteControlSuffix(text: string): string {
  if (!text) {
    return text;
  }
  let holdFrom = -1;
  for (let i = 0; i < text.length; i++) {
    const suffix = text.slice(i);
    if (isIncompleteBracketControl(suffix) || isIncompleteAngleControl(suffix)) {
      holdFrom = i;
      continue;
    }
    // Internal continue injectors are line-oriented in production.
    if (i === 0 || text[i - 1] === "\n") {
      const firstLine = suffix.split("\n", 1)[0] ?? "";
      if (isIncompleteInternalContinueLine(firstLine)) {
        holdFrom = i;
      }
    }
  }
  const kept = holdFrom < 0 ? text : text.slice(0, holdFrom);
  return kept.replace(/\n{3,}/g, "\n\n").replace(/[ \t]+$/g, "");
}

/**
 * Defense strip for end-user chat bubbles: control markers, digests, raw
 * deliverable tags, and internal tenant paths. Does not remove PLAN_SPEAK CTA.
 *
 * When `streaming` is true, also hold back incomplete trailing control prefixes
 * so char-split tokens never leak on the wire.
 */
export function stripControlChannelForDisplay(
  text: string,
  opts?: { streaming?: boolean },
): string {
  if (!text) {
    return text;
  }
  // Whole-message internal continue injectors are never user-visible speech.
  if (isInternalContinuePromptText(text)) {
    return "";
  }
  let next = stripTurnCompletionMarkers(text);
  next = stripToolDigestLines(next);
  next = stripDeliverableEnvelopeTags(next);
  next = stripAbsoluteWorkspacePaths(next);
  if (opts?.streaming) {
    next = holdBackIncompleteControlSuffix(next);
  }
  return next.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * True when an entire message is only control-channel noise (hide the bubble).
 * Uses structural strip (including full digest units) rather than startsWith, so
 * a sentinel-wrapped digest followed by a real answer keeps the answer.
 */
export function isControlChannelOnlyText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }
  if (isInternalContinuePromptText(trimmed)) {
    return true;
  }
  const stripped = stripControlChannelForDisplay(trimmed);
  return !stripped;
}
