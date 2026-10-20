/**
 * Opaque history cursor (CL-P1-02). Does not encode file paths or line numbers
 * that would leak tenant layout — uses stable message index + content fingerprint.
 */
import { createHash } from "node:crypto";

export type HistoryCursorPayload = {
  v: 1;
  /** Index into the full (pre-slice) message array: exclusive end of previous older page. */
  beforeIndex: number;
  /** Fingerprint of sessionId for mismatch detection. */
  sid: string;
};

export function fingerprintSessionId(sessionId: string): string {
  return createHash("sha256").update(sessionId).digest("hex").slice(0, 12);
}

export function encodeHistoryCursor(payload: HistoryCursorPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeHistoryCursor(cursor: string): HistoryCursorPayload | null {
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as Partial<HistoryCursorPayload>;
    if (
      parsed.v === 1 &&
      typeof parsed.beforeIndex === "number" &&
      Number.isFinite(parsed.beforeIndex) &&
      parsed.beforeIndex >= 0 &&
      typeof parsed.sid === "string"
    ) {
      return {
        v: 1,
        beforeIndex: Math.floor(parsed.beforeIndex),
        sid: parsed.sid,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Page messages newest-first window with optional before cursor.
 * Returns messages in chronological order (oldest → newest within the page).
 */
export function pageHistoryMessages<T>(params: {
  messages: T[];
  limit: number;
  sessionId: string;
  before?: string | null;
}): {
  messages: T[];
  nextBefore: string | null;
  hasMore: boolean;
} {
  const all = params.messages;
  const limit = Math.min(Math.max(params.limit, 1), 1000);
  const sid = fingerprintSessionId(params.sessionId);

  let endExclusive = all.length;
  if (params.before) {
    const decoded = decodeHistoryCursor(params.before);
    if (!decoded || decoded.sid !== sid) {
      throw new Error("invalid history cursor");
    }
    endExclusive = Math.min(decoded.beforeIndex, all.length);
  }

  const start = Math.max(0, endExclusive - limit);
  const page = all.slice(start, endExclusive);
  const hasMore = start > 0;
  const nextBefore = hasMore ? encodeHistoryCursor({ v: 1, beforeIndex: start, sid }) : null;

  return { messages: page, nextBefore, hasMore };
}
