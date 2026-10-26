/**
 * U1 — unified task-level stop control (shared guard + stop record shape).
 *
 * Stop state lives on the existing task authority object (GovernedTask /
 * objectStorage "task"), not a parallel store. Entrypoints call
 * {@link assertTaskNotStopped} before starting write / dispatch actions.
 *
 * Semantics recorded on accept:
 * - status `accepted` = stop *request* accepted only (not proof in-flight work ended)
 * - inFlightAbort: `best_effort` = abort *requested*; `none` = no abort requested.
 *   There is no "confirmed abort" value — confirmation requires a receipt; never invent one.
 * - externalEffect: `happened` | `unknown` | `none` must rest on facts.
 *   Missing receipt must not become `none`; uncertainty stays `unknown`.
 * - wake `dispatched=false` alone proves this wake did not dispatch; it does **not**
 *   by itself prove a previously running action has stopped.
 */

/** `best_effort` = abort requested (not confirmed). No confirmed-abort enum on purpose. */
export type TaskStopInFlightAbort = "none" | "best_effort";
/** Fact-backed only. Default builders use `unknown`; never infer `none` from silence. */
export type TaskStopExternalEffect = "none" | "happened" | "unknown";

export type TaskStopControl = {
  status: "accepted";
  requestedBy: string;
  requestedAtMs: number;
  reason?: string;
  inFlightAbort: TaskStopInFlightAbort;
  externalEffect: TaskStopExternalEffect;
};

export type TaskStopReadable = {
  taskId?: string;
  stopControl?: TaskStopControl | null;
};

export class TaskStoppedError extends Error {
  readonly code = "TASK_STOPPED";
  readonly taskId: string;

  constructor(taskId: string, message?: string) {
    super(message ?? `task ${taskId} is stopped; refusing start/write action`);
    this.name = "TaskStoppedError";
    this.taskId = taskId;
  }
}

export function readTaskStopControl(
  task: TaskStopReadable | null | undefined,
): TaskStopControl | null {
  const stop = task?.stopControl;
  if (!stop || stop.status !== "accepted") {
    return null;
  }
  return stop;
}

export function isTaskStopAccepted(task: TaskStopReadable | null | undefined): boolean {
  return readTaskStopControl(task) != null;
}

/** Shared preflight guard for RPC / board tool / queue / heartbeat / wake. */
export function assertTaskNotStopped(task: TaskStopReadable | null | undefined): void {
  const stop = readTaskStopControl(task);
  if (!stop) {
    return;
  }
  const taskId = (task?.taskId ?? "").trim() || "unknown";
  throw new TaskStoppedError(taskId);
}

export function buildAcceptedTaskStopControl(params: {
  requestedBy: string;
  requestedAtMs?: number;
  reason?: string;
  inFlightAbort?: TaskStopInFlightAbort;
  externalEffect?: TaskStopExternalEffect;
}): TaskStopControl {
  const requestedBy = params.requestedBy.trim();
  if (!requestedBy) {
    throw new Error("stop requires requestedBy");
  }
  const reason = params.reason?.trim();
  return {
    status: "accepted",
    requestedBy,
    requestedAtMs: params.requestedAtMs ?? Date.now(),
    ...(reason ? { reason } : {}),
    inFlightAbort: params.inFlightAbort ?? "best_effort",
    externalEffect: params.externalEffect ?? "unknown",
  };
}
