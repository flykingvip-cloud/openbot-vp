import { extractTextCached } from "./message-extract.ts";

export const HEARTBEAT_PARKED_NOTICE_SENTINEL = "[HEARTBEAT_PARKED_NOTICE]";
export const HEARTBEAT_PARK_FULL_NOTICE_SENTINEL = "[HEARTBEAT_PARK_FULL_NOTICE]";

export function isHeartbeatParkedNoticeMessage(message: unknown): boolean {
  const text = extractTextCached(message) ?? "";
  return (
    text.includes(HEARTBEAT_PARKED_NOTICE_SENTINEL) ||
    text.includes(HEARTBEAT_PARK_FULL_NOTICE_SENTINEL)
  );
}

export function heartbeatParkReasonFromMessage(
  message: unknown,
): "park" | "reject_park_full" | undefined {
  const text = extractTextCached(message) ?? "";
  if (text.includes(HEARTBEAT_PARK_FULL_NOTICE_SENTINEL)) {
    return "reject_park_full";
  }
  if (text.includes(HEARTBEAT_PARKED_NOTICE_SENTINEL)) {
    return "park";
  }
  return undefined;
}
