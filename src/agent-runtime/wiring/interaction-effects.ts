import { clearSessionQueueItemsForTask, clearSessionQueues } from "../../auto-reply/reply/queue.js";
import { abortEmbeddedPiRun, queueEmbeddedPiMessage } from "../execution/index.js";
import { cancelAdmittedRuntime } from "./runtime-cancellation.js";

/** Fixed cancellation and steering effects; no semantic classification or task mutation. */
export async function interruptInteractionTask(
  sessionId: string,
  sessionKey?: string,
  taskId?: string,
) {
  if (taskId?.trim()) {
    await cancelAdmittedRuntime(sessionId, taskId.trim());
  }
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
