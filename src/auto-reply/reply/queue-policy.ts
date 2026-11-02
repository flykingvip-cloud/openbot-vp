import type { QueueSettings } from "./queue.js";

export type ActiveRunQueueAction = "run-now" | "enqueue-followup" | "drop";

export function resolveActiveRunQueueAction(params: {
  isActive: boolean;
  isHeartbeat: boolean;
  shouldFollowup: boolean;
  queueMode: QueueSettings["mode"];
}): ActiveRunQueueAction {
  if (!params.isActive) {
    return "run-now";
  }
  if (params.isHeartbeat) {
    return "drop";
  }
  if (params.shouldFollowup || params.queueMode === "steer") {
    return "enqueue-followup";
  }
  return "run-now";
}

/**
 * Under default collect/followup, optionally inject an amend constraint into the
 * active streaming run via steer. This is not an independent reply path and must
 * not skip enqueue-followup. new_work/aside are excluded (focus switch / reply-after).
 */
export function shouldAttemptCollectAmendSteer(params: {
  isActive: boolean;
  isStreaming: boolean;
  shouldSteer: boolean;
  shouldFollowup: boolean;
  queueMode: QueueSettings["mode"];
  turnRelation: "amend" | "aside" | "new_work" | null;
}): boolean {
  if (params.shouldSteer) {
    return false;
  }
  if (!params.isActive || !params.isStreaming) {
    return false;
  }
  if (!params.shouldFollowup) {
    return false;
  }
  if (params.queueMode !== "collect" && params.queueMode !== "followup") {
    return false;
  }
  return params.turnRelation === "amend";
}
