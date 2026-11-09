/** Resource occupancy only. User semantics have already been resolved by interaction. */
export function resolveExecutionQueueAction(params: {
  isActive: boolean;
  isHeartbeat: boolean;
  shouldFollowup: boolean;
  queueMode: "steer" | "followup" | "collect" | "steer-backlog" | "interrupt" | "queue";
}): "run-now" | "enqueue-followup" | "drop" {
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
