import { applyQueueRuntimeSettings } from "../../../utils/queue-helpers.js";
import type { FollowupRun, QueueDropPolicy, QueueMode, QueueSettings } from "./types.js";

export type FollowupQueueState = {
  items: FollowupRun[];
  draining: boolean;
  lastEnqueuedAt: number;
  mode: QueueMode;
  debounceMs: number;
  cap: number;
  dropPolicy: QueueDropPolicy;
  droppedCount: number;
  summaryLines: string[];
  lastRun?: FollowupRun["run"];
};

export const DEFAULT_QUEUE_DEBOUNCE_MS = 1000;
export const DEFAULT_QUEUE_CAP = 20;
export const DEFAULT_QUEUE_DROP: QueueDropPolicy = "summarize";

export const FOLLOWUP_QUEUES = new Map<string, FollowupQueueState>();

export function getExistingFollowupQueue(key: string): FollowupQueueState | undefined {
  const cleaned = key.trim();
  if (!cleaned) {
    return undefined;
  }
  return FOLLOWUP_QUEUES.get(cleaned);
}

export function getFollowupQueue(key: string, settings: QueueSettings): FollowupQueueState {
  const existing = FOLLOWUP_QUEUES.get(key);
  if (existing) {
    applyQueueRuntimeSettings({
      target: existing,
      settings,
    });
    return existing;
  }

  const created: FollowupQueueState = {
    items: [],
    draining: false,
    lastEnqueuedAt: 0,
    mode: settings.mode,
    debounceMs:
      typeof settings.debounceMs === "number"
        ? Math.max(0, settings.debounceMs)
        : DEFAULT_QUEUE_DEBOUNCE_MS,
    cap:
      typeof settings.cap === "number" && settings.cap > 0
        ? Math.floor(settings.cap)
        : DEFAULT_QUEUE_CAP,
    dropPolicy: settings.dropPolicy ?? DEFAULT_QUEUE_DROP,
    droppedCount: 0,
    summaryLines: [],
  };
  applyQueueRuntimeSettings({
    target: created,
    settings,
  });
  FOLLOWUP_QUEUES.set(key, created);
  return created;
}

export function clearFollowupQueue(key: string): number {
  const cleaned = key.trim();
  const queue = getExistingFollowupQueue(cleaned);
  if (!queue) {
    return 0;
  }
  const cleared = queue.items.length + queue.droppedCount;
  queue.items.length = 0;
  queue.droppedCount = 0;
  queue.summaryLines = [];
  queue.lastRun = undefined;
  queue.lastEnqueuedAt = 0;
  FOLLOWUP_QUEUES.delete(cleaned);
  return cleared;
}

/** Explicit ownership only: ticket, completion binding, or parentTaskId. */
export function followupItemOwnedTaskIds(item: FollowupRun): string[] {
  const ids: string[] = [];
  const ticket = item.taskBoardContinueTicket?.taskId?.trim();
  if (ticket) {
    ids.push(ticket);
  }
  const parent = item.parentTaskId?.trim();
  if (parent) {
    ids.push(parent);
  }
  const binding = item.run?.taskCompletionBinding?.taskId?.trim();
  if (binding) {
    ids.push(binding);
  }
  return ids;
}

export function followupItemOwnedByTask(item: FollowupRun, taskId: string): boolean {
  const wanted = taskId.trim();
  return Boolean(wanted) && followupItemOwnedTaskIds(item).includes(wanted);
}

export function listFollowupQueueItemsForTask(taskId: string): Array<{
  queueKey: string;
  item: FollowupRun;
}> {
  const wanted = taskId.trim();
  if (!wanted) {
    return [];
  }
  const matches: Array<{ queueKey: string; item: FollowupRun }> = [];
  for (const [queueKey, queue] of FOLLOWUP_QUEUES) {
    for (const item of queue.items) {
      if (followupItemOwnedByTask(item, wanted)) {
        matches.push({ queueKey, item });
      }
    }
  }
  return matches;
}

/** Remove only queue items with an explicit binding to this task. Unbound items stay. */
export function clearFollowupQueueItemsForTask(taskId: string, keys?: readonly string[]): number {
  const wanted = taskId.trim();
  if (!wanted) {
    return 0;
  }
  let removed = 0;
  const selected =
    keys && keys.length > 0
      ? keys
          .map((key) => key.trim())
          .filter(Boolean)
          .map((key) => [key, getExistingFollowupQueue(key)] as const)
          .filter((entry): entry is readonly [string, FollowupQueueState] => entry[1] != null)
      : [...FOLLOWUP_QUEUES.entries()];
  for (const [key, queue] of selected) {
    const next = queue.items.filter((item) => !followupItemOwnedByTask(item, wanted));
    removed += queue.items.length - next.length;
    queue.items = next;
    void key;
  }
  return removed;
}
