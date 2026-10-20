/**
 * Splice a selected @ mention into the composer draft.
 *
 * Always keep a single separating space after the mention token so the
 * display name and the following body never concatenate (`@所有人你好`).
 * Existing whitespace after the cursor is reused; the caret lands after
 * that separator so the next keystroke is body text.
 */
export function buildMentionInsertion(params: {
  value: string;
  triggerOffset: number;
  cursor: number;
  displayName: string;
}): { next: string; nextCursor: number } {
  const mentionText = `@${params.displayName.trim()}`;
  const triggerOffset = Math.max(0, Math.min(params.triggerOffset, params.value.length));
  const cursor = Math.max(triggerOffset, Math.min(params.cursor, params.value.length));
  const prefix = params.value.slice(0, triggerOffset);
  const suffix = params.value.slice(cursor);
  const separator = startsWithComposerWhitespace(suffix) ? "" : " ";
  const next = `${prefix}${mentionText}${separator}${suffix}`;
  const nextCursor = triggerOffset + mentionText.length + 1;
  return { next, nextCursor };
}

function startsWithComposerWhitespace(value: string) {
  return value.startsWith(" ") || value.startsWith("\n") || value.startsWith("\t");
}

const SINGLE_MENTION_TOKEN = /^[^\s@]+$/u;

export type ComposerMentionInsertTarget = {
  kind?: "agent" | "human" | "all" | "plugin" | null;
  displayName: string;
  userId?: string | null;
  agentId?: string | null;
};

/**
 * Token written after @. A unique display name stays readable. When two
 * people share a name, the platform user id or agent id is inserted so a
 * later send targets that one record.
 */
export function resolveComposerMentionInsertToken(
  target: ComposerMentionInsertTarget,
  peers: readonly ComposerMentionInsertTarget[],
): string {
  const name = target.displayName.trim();
  const stableId =
    (target.kind === "human" || target.userId ? target.userId : target.agentId)?.trim() ?? "";
  const sameName = peers.filter((peer) => peer.displayName.trim() === name);
  if (name && SINGLE_MENTION_TOKEN.test(name) && sameName.length === 1) {
    return name;
  }
  if (stableId && SINGLE_MENTION_TOKEN.test(stableId)) {
    return stableId;
  }
  return name;
}
