import { extractTextCached } from "./message-extract.ts";

export const PARKED_TASK_REMINDER_SENTINEL = "[PARKED_TASK_REMINDER]";

const TASK_ID_RE = /任务 ID：\s*`([^`]+)`/;
const TITLE_RE = /前任务：「([^」]+)」/;
const STOP_RE = /停在：([^\n]+)/;
const WAKE_KEY_RE = /唤醒[：:]\s*`([^`]+)`/;

export type ParkedTaskReminderInfo = {
  taskId: string;
  title?: string;
  stopSummary?: string;
};

export function isParkedTaskReminderMessage(message: unknown): boolean {
  const text = extractTextCached(message) ?? "";
  return text.includes(PARKED_TASK_REMINDER_SENTINEL);
}

export function parseParkedTaskReminder(message: unknown): ParkedTaskReminderInfo | null {
  const text = extractTextCached(message) ?? "";
  if (!text.includes(PARKED_TASK_REMINDER_SENTINEL)) {
    return null;
  }
  const taskId = TASK_ID_RE.exec(text)?.[1]?.trim() ?? "";
  if (!taskId) {
    return null;
  }
  const title = TITLE_RE.exec(text)?.[1]?.trim();
  const stopSummary = STOP_RE.exec(text)?.[1]?.trim();
  return {
    taskId,
    ...(title ? { title } : {}),
    ...(stopSummary ? { stopSummary } : {}),
  };
}

/** Heartbeat / cron wake key used as the automatic-park task id when present. */
export function parseParkedWakeTaskId(message: unknown): string | undefined {
  const text = extractTextCached(message) ?? "";
  const wake = WAKE_KEY_RE.exec(text)?.[1]?.trim();
  if (wake) {
    return wake;
  }
  const cronId = /任务 ID：\s*`([^`]+)`/.exec(text)?.[1]?.trim();
  return cronId || undefined;
}

/** Local dismiss state so 「暂停前任务」 hides the card without a chat turn. */
const dismissedReminderKeys = new Set<string>();

export function isParkedReminderDismissed(key: string): boolean {
  return dismissedReminderKeys.has(key);
}

export function dismissParkedReminder(key: string): void {
  if (key.trim()) {
    dismissedReminderKeys.add(key);
  }
}

/** Test helper. */
export function clearParkedReminderDismissState(): void {
  dismissedReminderKeys.clear();
}
