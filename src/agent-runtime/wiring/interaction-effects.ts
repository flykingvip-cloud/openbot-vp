import { clearSessionQueueItemsForTask, clearSessionQueues } from "../../auto-reply/reply/queue.js";
import { abortEmbeddedPiRun, queueEmbeddedPiMessage } from "../execution/index.js";

/** Fixed cancellation and steering effects; no semantic classification or task mutation. */
export function interruptInteractionTask(sessionId: string, sessionKey?: string, taskId?: string) {
  abortEmbeddedPiRun(sessionId);
  const scoped = taskId?.trim();
  if (scoped) {
    // Scope queue drain to explicitly owned items so sibling work in the same
    // session is not cleared. The session run abort still targets this host.
    clearSessionQueueItemsForTask([sessionId, sessionKey], scoped);
    return;
  }
  clearSessionQueues([sessionId, sessionKey]);
}
export const steerInteractionTask = queueEmbeddedPiMessage;
