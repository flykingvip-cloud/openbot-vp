import { resolveEmbeddedSessionLane } from "../../../agents/pi-embedded.js";
import { clearCommandLane } from "../../../process/command-queue.js";
import { clearFollowupDrainCallback } from "./drain.js";
import { clearFollowupQueue, clearFollowupQueueItemsForTask } from "./state.js";

export type ClearSessionQueueResult = {
  followupCleared: number;
  laneCleared: number;
  keys: string[];
};

export function clearSessionQueues(keys: Array<string | undefined>): ClearSessionQueueResult {
  const seen = new Set<string>();
  let followupCleared = 0;
  let laneCleared = 0;
  const clearedKeys: string[] = [];

  for (const key of keys) {
    const cleaned = key?.trim();
    if (!cleaned || seen.has(cleaned)) {
      continue;
    }
    seen.add(cleaned);
    clearedKeys.push(cleaned);
    followupCleared += clearFollowupQueue(cleaned);
    clearFollowupDrainCallback(cleaned);
    laneCleared += clearCommandLane(resolveEmbeddedSessionLane(cleaned));
  }

  return { followupCleared, laneCleared, keys: clearedKeys };
}

/** Clear only followup items explicitly owned by taskId. Does not drain other work. */
export function clearSessionQueueItemsForTask(
  keys: Array<string | undefined>,
  taskId: string,
): { removed: number; keys: string[] } {
  const seen = new Set<string>();
  for (const key of keys) {
    const cleaned = key?.trim();
    if (cleaned) {
      seen.add(cleaned);
    }
  }
  const list = [...seen];
  const removed = clearFollowupQueueItemsForTask(taskId, list);
  return { removed, keys: list };
}
