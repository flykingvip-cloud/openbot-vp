import type { ChatItem, MessageGroup } from "../types/chat-types.ts";

export type ChatThreadItem = ChatItem | MessageGroup;

function isMessageGroup(item: ChatThreadItem): item is MessageGroup {
  return "kind" in item && item.kind === "group";
}

function readThreadItemTimestamp(item: ChatThreadItem): number | null {
  if (isMessageGroup(item)) {
    return item.timestamp;
  }
  if (item.kind === "stream") {
    return item.startedAt;
  }
  if (item.kind === "divider") {
    return item.timestamp;
  }
  return null;
}

function dayKey(timestampMs: number): string {
  const date = new Date(timestampMs);
  return [date.getFullYear(), date.getMonth(), date.getDate()].join("-");
}

/** GPT-style centered session label, e.g. "6月15日周一 9:13". */
export function formatChatSessionDividerLabel(
  timestampMs: number,
  locale = typeof document !== "undefined" ? document.documentElement.lang || "zh-CN" : "zh-CN",
): string {
  const date = new Date(timestampMs);
  const datePart = date.toLocaleDateString(locale, {
    month: "long",
    day: "numeric",
    weekday: "short",
  });
  const timePart = date.toLocaleTimeString(locale, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${datePart} ${timePart}`;
}

/**
 * Insert a session/day divider before the first visible message group and whenever
 * the calendar day changes. Per-message footers stay hidden; time is shown here only.
 */
export function insertChatSessionDividers(items: ChatThreadItem[]): ChatThreadItem[] {
  const result: ChatThreadItem[] = [];
  let lastDayKey: string | null = null;
  let started = false;

  for (const item of items) {
    if (item.kind === "checkpoint") {
      result.push(item);
      lastDayKey = null;
      continue;
    }

    const timestamp = readThreadItemTimestamp(item);
    const isRenderableMessage =
      isMessageGroup(item) ||
      item.kind === "stream" ||
      item.kind === "reading-indicator" ||
      item.kind === "thinking-progress";

    if (!isRenderableMessage || timestamp == null) {
      result.push(item);
      continue;
    }

    const currentDayKey = dayKey(timestamp);
    if (!started || currentDayKey !== lastDayKey) {
      result.push({
        kind: "divider",
        key: `divider:session:${timestamp}:${result.length}`,
        label: formatChatSessionDividerLabel(timestamp),
        timestamp,
        variant: "session",
      });
      lastDayKey = currentDayKey;
      started = true;
    }

    result.push(item);
  }

  return result;
}
