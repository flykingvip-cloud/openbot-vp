import { abortMidTaskAsideLanes } from "../../auto-reply/reply/mid-task-aside-reply-lane.js";
import { clearSessionQueues } from "../../auto-reply/reply/queue.js";
import { abortEmbeddedPiRun, queueEmbeddedPiMessage } from "../execution/index.js";

/** Fixed cancellation and steering effects; no semantic classification or task mutation. */
export function interruptInteractionTask(sessionId: string, sessionKey?: string) {
  abortEmbeddedPiRun(sessionId);
  abortMidTaskAsideLanes(sessionId);
  clearSessionQueues([sessionId, sessionKey]);
}
export const steerInteractionTask = queueEmbeddedPiMessage;
