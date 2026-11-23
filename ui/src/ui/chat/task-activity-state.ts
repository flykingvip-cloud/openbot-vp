import type { TaskActivitySnapshot } from "../../../../src/shared/task-activity.ts";

export type TaskActivityLine = { text: string; animate: boolean; phase: string };
export const TASK_ACTIVITY_FRESH_MS = 15_000;

/** A live task is not a live run. Old observations cannot authorize an animation. */
export function resolveTaskActivityLine(input: {
  sessionKey: string;
  snapshot: TaskActivitySnapshot | null;
  connected: boolean;
  readFailed?: boolean;
  nowMs: number;
}): TaskActivityLine | null {
  const snapshot = input.snapshot;
  if (!snapshot || snapshot.sessionKey !== input.sessionKey || !snapshot.task) {
    return null;
  }
  const task = snapshot.task;
  if (task.lifecycle !== "active") {
    return null;
  }
  if (
    !input.connected ||
    input.readFailed ||
    snapshot.observedAtMs > input.nowMs ||
    input.nowMs - snapshot.observedAtMs > TASK_ACTIVITY_FRESH_MS
  ) {
    return { text: "连接或任务状态待确认", animate: false, phase: "uncertain" };
  }
  switch (task.health) {
    case "running":
      return { text: "任务正在执行", animate: true, phase: "running" };
    case "waiting_dependency":
      return { text: "正在等待任务回件", animate: false, phase: "waiting" };
    case "recovering":
      return { text: "已安排自动恢复，等待执行", animate: false, phase: "recovering" };
    case "needs_user":
      return { text: "任务需要你处理，请查看对话中的请求", animate: false, phase: "needs-user" };
    default:
      return { text: "任务未结束，执行状态待确认", animate: false, phase: "unknown" };
  }
}

export function parseTaskActivitySnapshot(
  raw: unknown,
  sessionKey: string,
): TaskActivitySnapshot | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const row = raw as Record<string, unknown>;
  if (
    row.sessionKey !== sessionKey ||
    typeof row.observedAtMs !== "number" ||
    !Number.isFinite(row.observedAtMs)
  ) {
    return null;
  }
  if (row.task === null) {
    return { sessionKey, observedAtMs: row.observedAtMs, task: null };
  }
  if (!row.task || typeof row.task !== "object") {
    return null;
  }
  const task = row.task as Record<string, unknown>;
  if (
    typeof task.taskId !== "string" ||
    !task.taskId.trim() ||
    !["active", "paused", "terminal"].includes(String(task.lifecycle)) ||
    !["running", "waiting_dependency", "recovering", "needs_user", "unknown"].includes(
      String(task.health),
    )
  ) {
    return null;
  }
  return {
    sessionKey,
    observedAtMs: row.observedAtMs,
    task: {
      taskId: task.taskId,
      lifecycle: task.lifecycle as NonNullable<TaskActivitySnapshot["task"]>["lifecycle"],
      health: task.health as NonNullable<TaskActivitySnapshot["task"]>["health"],
      ...(typeof task.waitingCount === "number" &&
      Number.isInteger(task.waitingCount) &&
      task.waitingCount >= 0
        ? { waitingCount: task.waitingCount }
        : {}),
      ...(typeof task.nextWakeAtMs === "number" &&
      Number.isFinite(task.nextWakeAtMs) &&
      task.nextWakeAtMs > 0
        ? { nextWakeAtMs: task.nextWakeAtMs }
        : {}),
    },
  };
}
