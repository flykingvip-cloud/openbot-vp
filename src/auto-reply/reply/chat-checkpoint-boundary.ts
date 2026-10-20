/**
 * Transcript boundary for the first user turn (no prior message to keep).
 * Restore treats this as "keep nothing" and removes the whole transcript tail.
 */
export const TRANSCRIPT_START_BOUNDARY_ID = "__openbot_transcript_start__";

export function isTranscriptStartBoundary(id?: string | null): boolean {
  return id === TRANSCRIPT_START_BOUNDARY_ID;
}

/**
 * Legacy captures stored an empty boundary or the tip message (restore no-op).
 * Re-derive "the message before the latest user turn" when the stored id
 * cannot actually truncate.
 */
export function resolveEffectiveRestoreBoundaryMessageId(
  storedBoundaryId: string | undefined,
  messages: Array<{ id?: string; role: string }>,
): string | undefined {
  const lastId = messages.at(-1)?.id;
  const storedExists =
    isTranscriptStartBoundary(storedBoundaryId) ||
    Boolean(storedBoundaryId && messages.some((message) => message.id === storedBoundaryId));
  const storedIsTip = Boolean(storedBoundaryId && lastId && storedBoundaryId === lastId);
  if (storedBoundaryId && storedExists && !storedIsTip) {
    return storedBoundaryId;
  }
  let lastUser = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === "user") {
      lastUser = i;
      break;
    }
  }
  if (lastUser < 0) {
    return lastId;
  }
  if (lastUser === 0) {
    return TRANSCRIPT_START_BOUNDARY_ID;
  }
  return messages[lastUser - 1]?.id;
}
