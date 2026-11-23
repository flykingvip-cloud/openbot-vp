import type { SessionTaskBoard } from "../../agent-runtime/contracts/task.js";
import type { TaskActivitySnapshot } from "../../shared/task-activity.js";

/** Pure projection. Call only after the gateway's normal session read authorization. */
export function projectTaskActivity(params: {
  sessionKey: string;
  board: SessionTaskBoard;
  nowMs: number;
  /** A live, non-aborted, unexpired registry entry bound to current.executionAttempt. */
  activeExecutionAttempt?: string | null;
  /** Durable dependency/wake facts must be bound to this current task ID. */
  dependency?: {
    taskId: string;
    waitingCount: number;
    needsUser?: boolean;
    nextWakeAtMs?: number;
  } | null;
}): TaskActivitySnapshot {
  const current = params.board.current;
  const base = { sessionKey: params.sessionKey, observedAtMs: params.nowMs };
  if (!current || (params.board.tombstones ?? []).some((item) => item.taskId === current.taskId)) {
    return { ...base, task: null };
  }
  const lifecycle = !current.unfinished ? "terminal" : current.wakeSuppress ? "paused" : "active";
  const dependency = params.dependency?.taskId === current.taskId ? params.dependency : null;
  const running = Boolean(
    current.executionAttempt && current.executionAttempt === params.activeExecutionAttempt,
  );
  const health =
    lifecycle !== "active"
      ? "unknown"
      : running
        ? "running"
        : dependency?.needsUser
          ? "needs_user"
          : dependency && dependency.waitingCount > 0
            ? "waiting_dependency"
            : dependency?.nextWakeAtMs && dependency.nextWakeAtMs > params.nowMs
              ? "recovering"
              : "unknown";
  return {
    ...base,
    task: {
      taskId: current.taskId,
      lifecycle,
      health,
      ...(dependency && dependency.waitingCount > 0
        ? { waitingCount: dependency.waitingCount }
        : {}),
      ...(dependency?.nextWakeAtMs ? { nextWakeAtMs: dependency.nextWakeAtMs } : {}),
    },
  };
}
