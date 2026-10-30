/**
 * Strip gateway/control-channel markers from user-visible chat text.
 *
 * Turn-completion markers, internal continue injectors, tool-digest lines, and
 * raw <<DELIVERABLE>> tags belong in structured contracts / model context — not
 * in end-user bubbles. Gateway paths should stop emitting them into visibleText;
 * these helpers are defense-in-depth for history, streaming, and older sessions.
 */

/** Bracket turn_completion control lines (delivered / permanent_block / true_fork). */
const TURN_COMPLETION_LINE_RE = /^\s*\[turn_completion\b[^\]]*\]\s*$/gim;
const TURN_COMPLETION_INLINE_RE = /\[turn_completion\s+state=[^\]]*\]/gi;

/** Internal auto-continue injectors (task-board + execution-stall). */
const INTERNAL_CONTINUE_PREFIX_RE =
  /^\s*Internal (?:task-board|execution) continue:\s*$/im;

/** Tool-digest lines produced by context-compiler shrink (model context only). */
const TOOL_DIGEST_LINE_RE = /^\s*\[tool-digest\][^\n]*$/gim;

/** Complete <<DELIVERABLE>>…<</DELIVERABLE>> blocks — keep body, drop tags. */
const TAGGED_DELIVERABLE_RE = /<<\s*DELIVERABLE\b[^>]*>+([\s\S]*?)<<\s*\/\s*DELIVERABLE\s*>>/gi;

/** Orphan open/close tags left after a partial model declaration. */
const ORPHAN_DELIVERABLE_TAG_RE = /<<\s*\/?\s*DELIVERABLE\b[^>]*>>?/gi;

/** Absolute tenant/workspace paths that must not appear in user-facing copy. */
const ABSOLUTE_TENANT_PATH_RE =
  /\/(?:root|var)\/[^\s，。；;、]*openbot-tenants\/[^\s，。；;、]*/gi;
const ABSOLUTE_WORKSPACE_PATH_RE =
  /(?:^|[\s「『（(])(\/(?:root|var|tmp|Users)\/[^\s，。；;、]+)/g;

export function stripTurnCompletionMarkers(text: string): string {
  if (!text || !/\[turn_completion\b/i.test(text)) {
    return text;
  }
  return text
    .replace(TURN_COMPLETION_LINE_RE, "")
    .replace(TURN_COMPLETION_INLINE_RE, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function stripToolDigestLines(text: string): string {
  if (!text || !/\[tool-digest\]/i.test(text)) {
    return text;
  }
  return text
    .replace(TOOL_DIGEST_LINE_RE, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Replace tagged deliverable envelopes with their body text; drop orphan tags.
 * Does not touch ordinary 「…」 prose quotes.
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

/** Redact absolute tenant/workspace paths from any copy that might reach the UI. */
export function stripAbsoluteWorkspacePaths(text: string): string {
  if (!text) {
    return text;
  }
  let next = text.replace(ABSOLUTE_TENANT_PATH_RE, "workspace");
  next = next.replace(ABSOLUTE_WORKSPACE_PATH_RE, (full, pathPart: string) => {
    const basename = pathPart.replace(/\/+$/, "").split("/").pop() || "workspace";
    return full.replace(pathPart, basename);
  });
  return next;
}

/**
 * Defense strip for end-user chat bubbles: control markers, digests, raw
 * deliverable tags, and absolute tenant paths. Does not remove PLAN_SPEAK CTA.
 */
export function stripControlChannelForDisplay(text: string): string {
  if (!text) {
    return text;
  }
  let next = stripTurnCompletionMarkers(text);
  next = stripToolDigestLines(next);
  next = stripDeliverableEnvelopeTags(next);
  next = stripAbsoluteWorkspacePaths(next);
  return next.replace(/\n{3,}/g, "\n\n").trim();
}

/** True when an entire message is only control-channel noise (hide the bubble). */
export function isControlChannelOnlyText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }
  if (isInternalContinuePromptText(trimmed)) {
    return true;
  }
  // Context-compiler digests are assistant-role model context, not end-user speech.
  if (/^\[tool-digest\]/i.test(trimmed)) {
    return true;
  }
  const stripped = stripControlChannelForDisplay(trimmed);
  return !stripped;
}
