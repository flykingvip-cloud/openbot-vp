/** Pure aside-history data and budget selection; no storage or runtime dependency. */
/** History-body budget for normal-reply untrusted aside context (chars of `role: text` lines only; wrapper/disclaimer overhead is separate). */
export const ASIDE_NORMAL_REPLY_CONTEXT_MAX_CHARS = 4_000;

/** Soft cap on turns considered before the char budget trims further. */
export const ASIDE_DIALOGUE_HISTORY_TURN_CAP = 24;

export type AsideDialogueTurn = {
  atMs: number;
  runId: string;
  role: "user" | "assistant";
  text: string;
  /** Stable inbound / transcript message id when known (cross-source dedupe). */
  messageId?: string;
};

/**
 * Newest-first selection that respects a character budget on `role: text` lines.
 * Only complete turns are retained; oversized newest turns are omitted, never rewritten.
 */
export function selectAsideTurnsWithinCharBudget(
  turns: readonly AsideDialogueTurn[],
  maxChars: number = ASIDE_NORMAL_REPLY_CONTEXT_MAX_CHARS,
): AsideDialogueTurn[] {
  if (turns.length === 0) {
    return [];
  }
  const budget = Math.max(64, maxChars);
  const selected: AsideDialogueTurn[] = [];
  let used = 0;
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const turn = turns[i];
    const line = `${turn.role}: ${turn.text}`;
    const cost = line.length + (selected.length > 0 ? 1 : 0);
    if (used + cost > budget) {
      break;
    }
    selected.unshift(turn);
    used += cost;
  }
  return selected;
}
