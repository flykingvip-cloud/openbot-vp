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
 */

/** Bracket turn_completion control lines (delivered / permanent_block / true_fork). */
const TURN_COMPLETION_LINE_RE = /^\s*\[turn_completion\b[^\]]*\]\s*$/gim;
const TURN_COMPLETION_INLINE_RE = /\[turn_completion\s+state=[^\]]*\]/gi;
/** Incomplete trailing turn_completion (streaming char-split / truncated). */
const TURN_COMPLETION_INCOMPLETE_RE = /\[turn_completion\b[^\]]*$/i;

/** Internal auto-continue injectors (task-board + execution-stall). */
const INTERNAL_CONTINUE_PREFIX_RE = /^\s*Internal (?:task-board|execution) continue:\s*$/im;

/**
 * Tool-digest units from context-compiler shrink (formatToolDigest = head + \n + preview).
 * Header line plus contiguous preview lines; a blank-line paragraph break ends the unit
 * so a following real reply is preserved.
 */
const TOOL_DIGEST_UNIT_RE = /^[ \t]*\[tool-digest\][^\n]*(?:\n(?![ \t]*\n)[^\n]*)*/gim;
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
 * Remove tool-digest units (header + preview body). Stops at a blank-line
 * paragraph so mixed “digest then real answer” keeps the answer.
 */
export function stripToolDigestLines(text: string): string {
  if (!text || !/\[tool-digest\]/i.test(text)) {
    return text;
  }
  return text
    .replace(TOOL_DIGEST_UNIT_RE, "")
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

/**
 * Hold back a trailing suffix that looks like the start of a control token but
 * is not yet a complete marker (char-split streaming). Safe no-op when the
 * suffix is ordinary prose.
 */
export function holdBackIncompleteControlSuffix(text: string): string {
  if (!text) {
    return text;
  }
  let next = text;
  // Trailing incomplete bracket control open: [turn_completion… / [tool-digest…
  next = next.replace(/(?:\n|^)\[(?:turn_completion|tool-digest)\b[^\]]*$/i, (m) =>
    m.startsWith("\n") ? "\n" : "",
  );
  // Trailing incomplete DELIVERABLE open (no closing >> / body yet).
  next = next.replace(/(?:\n|^)<<\s*\/?\s*DELIVERABLE\b[^<]*$/i, (m) =>
    m.startsWith("\n") ? "\n" : "",
  );
  // Trailing incomplete Internal continue line.
  next = next.replace(/(?:\n|^)Internal (?:task-board|execution) continue:[^\n]*$/i, (m) =>
    m.startsWith("\n") ? "\n" : "",
  );
  // Bare "[" / "<<" that may be the first char of a control token — only when
  // the whole remainder after the last newline is exactly that opener.
  next = next.replace(/(?:\n|^)(?:\[|<<)$/u, (m) => (m.startsWith("\n") ? "\n" : ""));
  return next.replace(/\n{3,}/g, "\n\n").replace(/[ \t]+$/g, "");
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
 * a digest header followed by a real answer after a paragraph break is kept.
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
