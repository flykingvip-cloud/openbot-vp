/**
 * supervisor/node-progress.ts — forward Mac/Node worker progress into active runs (M5).
 */

import type { WorkerLogEvent } from "../../fabric/worker/types.js";
import { getSupervisorRun } from "./run-registry.js";

const PROGRESS_TYPES = new Set<WorkerLogEvent["type"]>(["stdout", "stderr", "status", "progress"]);

export function forwardSupervisorWorkerProgress(payload: Record<string, unknown>): boolean {
  const taskId = typeof payload.taskId === "string" ? payload.taskId.trim() : "";
  if (!taskId) {
    return false;
  }
  const entry = getSupervisorRun(taskId);
  if (!entry?.onProgress) {
    return false;
  }
  const rawType = payload.type;
  if (typeof rawType !== "string" || !PROGRESS_TYPES.has(rawType as WorkerLogEvent["type"])) {
    return false;
  }
  const event: WorkerLogEvent = { type: rawType as WorkerLogEvent["type"] };
  if (typeof payload.phase === "string" && payload.phase.trim()) {
    event.phase = payload.phase.trim();
  }
  if (typeof payload.data === "string" && payload.data.length > 0) {
    event.data = payload.data;
  }
  entry.onProgress(event);
  return true;
}
