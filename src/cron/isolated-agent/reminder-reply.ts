/**
 * Ordinary cron reminders are judged by the message body (#311).
 * A heartbeat/no-op body may still answer HEARTBEAT_OK. A reminder must not.
 */

import { HEARTBEAT_TOKEN } from "../../auto-reply/tokens.js";
import { qualifyOrdinaryCronTexts } from "../../progress-ledger/cron-qualify.js";

export function isCronHeartbeatNoOpBody(body: string): boolean {
  const text = body.replace(/\s+/g, " ").trim();
  if (!text) {
    return true;
  }
  const lower = text.toLowerCase();
  if (lower.startsWith("read heartbeat.md")) {
    return true;
  }
  if (lower.includes("heartbeat poll") || lower.includes("heartbeat wake")) {
    return true;
  }
  if (lower.startsWith("a real trigger woke this turn")) {
    return true;
  }
  if (/^heartbeat(?:_ok)?$/i.test(text)) {
    return true;
  }
  if (/^(?:noop|no-op|ok)$/i.test(text)) {
    return true;
  }
  return false;
}

const ORDINARY_REMINDER = /提醒|记得|别忘|不要忘记|remind\s+me|\bping\b|喝水|站会/i;

/** User-visible reminder text, or null when the body is not an ordinary reminder. */
export function visibleReminderReplyForOrdinaryCron(body: string): string | null {
  const text = body.replace(/\s+/g, " ").trim();
  if (!text || isCronHeartbeatNoOpBody(text)) {
    return null;
  }
  if (qualifyOrdinaryCronTexts([text])) {
    return null;
  }
  if (!ORDINARY_REMINDER.test(text)) {
    return null;
  }
  const subject = text
    .replace(
      /^(?:请)?(?:每天|每日|定时)?(?:记得|提醒我|提醒一下|提醒|别忘了|不要忘记|remind me to|remind me)\s*/i,
      "",
    )
    .replace(/[。.!！\s]+$/g, "")
    .trim();
  return `提醒：${subject || text}`;
}

type ReminderPayload = {
  text?: string;
  mediaUrl?: string;
  mediaUrls?: string[];
};

function isHeartbeatAckText(text: string): boolean {
  const trimmed = text.trim();
  return trimmed === HEARTBEAT_TOKEN || trimmed === `${HEARTBEAT_TOKEN}.`;
}

/**
 * When the model answers an ordinary reminder with only HEARTBEAT_OK, replace
 * that token with a user-visible reminder. Heartbeat/no-op bodies are unchanged.
 * Long-horizon bodies (goal + acceptance) are unchanged.
 */
export function replaceHeartbeatAckForOrdinaryReminder<T extends ReminderPayload>(
  payloads: readonly T[],
  message: string,
): T[] {
  const reminder = visibleReminderReplyForOrdinaryCron(message);
  if (!reminder || payloads.length === 0) {
    return [...payloads];
  }
  if (payloads.some((payload) => payload.mediaUrl || (payload.mediaUrls?.length ?? 0) > 0)) {
    return [...payloads];
  }
  const texts = payloads.map((payload) => payload.text?.trim() ?? "").filter(Boolean);
  if (texts.length === 0 || !texts.every(isHeartbeatAckText)) {
    return [...payloads];
  }
  return [{ text: reminder } as T];
}
