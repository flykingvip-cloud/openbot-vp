/**
 * `[[reply_to_current]]` / `[[reply_to:<id>]]` is the boundary between
 * model scratchpad and the user-visible reply. The prompt says the tag is
 * the first token; models still write chain-of-thought before it. When a
 * visible answer follows the last tag, drop everything before that tag.
 * The tag itself stays so reply routing can still read it.
 */

const REPLY_TAG_RE = /\[\[\s*(?:reply_to_current|reply_to\s*:\s*[^\]\n]+)\s*\]\]/gi;
const NON_VISIBLE_TAG_RE =
  /\[\[\s*(?:audio_as_voice|audio|reply_to\s*:[^\]\n]+|capability_gap\s*:[^\]]+)\]\]/gi;

function hasVisibleReplyAfterTag(after: string): boolean {
  NON_VISIBLE_TAG_RE.lastIndex = 0;
  return after.replace(NON_VISIBLE_TAG_RE, " ").trim().length > 0;
}

export function splitReplyTagPreamble(text: string): { text: string; dropped: boolean } {
  if (!text) {
    return { text, dropped: false };
  }
  REPLY_TAG_RE.lastIndex = 0;
  let lastIndex = -1;
  let lastLength = 0;
  for (const match of text.matchAll(REPLY_TAG_RE)) {
    lastIndex = match.index ?? 0;
    lastLength = match[0].length;
  }
  if (lastIndex <= 0) {
    return { text, dropped: false };
  }
  if (!text.slice(0, lastIndex).trim()) {
    return { text, dropped: false };
  }
  if (!hasVisibleReplyAfterTag(text.slice(lastIndex + lastLength))) {
    return { text, dropped: false };
  }
  return { text: text.slice(lastIndex), dropped: true };
}
