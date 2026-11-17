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

/**
 * R1 — after an accepted stop fence, cancel only explicitly owned work.
 * Facts are recorded per target; this is not a second stop state machine.
 * Session identity, bot identity, similar names, or close timestamps are not ownership.
 */
export type OwnedStopTargetKind =
  | "current_run"
  | "queue_item"
  | "child_execution"
  | "async_wait_job"
  | "supervisor_run"
  | "remote_job";

export type OwnedStopTargetFactStatus =
  | "accepted"
  | "confirmed_stopped"
  | "unsupported"
  | "pending"
  | "failed";

export type OwnedStopTargetFact = {
  kind: OwnedStopTargetKind;
  id: string;
  taskId: string;
  status: OwnedStopTargetFactStatus;
  detail?: string;
};

export type OwnedRemoteBinding = {
  jobId: string;
  leaseId: string;
  authorized: boolean;
};

export type OwnedStopTarget = {
  kind: OwnedStopTargetKind;
  id: string;
  taskId: string;
  remote?: OwnedRemoteBinding;
};

export type OwnedStopPorts = {
  /** Return only targets with explicit ownership evidence for this taskId. */
  listOwnedTargets: (taskId: string) => OwnedStopTarget[] | Promise<OwnedStopTarget[]>;
  cancelTarget: (target: OwnedStopTarget) => Promise<OwnedStopTargetFact>;
  /** Already-accepted fence should refuse admission of not-yet-started children. */
  refuseUnstartedAdmission?: (taskId: string) => Promise<void> | void;
};

export function remoteJobCancelable(remote: OwnedRemoteBinding | undefined): boolean {
  return Boolean(remote?.jobId?.trim() && remote?.leaseId?.trim() && remote.authorized);
}

/**
 * Cascade cancel after the stop fence is already accepted.
 * Does not write the fence, does not invent ownership, and never cancels
 * a target whose taskId does not match.
 */
export async function cancelOwnedWorkAfterAcceptedStop(params: {
  taskId: string;
  stopAccepted: boolean;
  ports: OwnedStopPorts;
}): Promise<OwnedStopTargetFact[]> {
  const taskId = params.taskId.trim();
  if (!taskId || !params.stopAccepted) {
    return [];
  }
  await params.ports.refuseUnstartedAdmission?.(taskId);
  const targets = await params.ports.listOwnedTargets(taskId);
  const facts: OwnedStopTargetFact[] = [];
  for (const target of targets) {
    if (target.taskId.trim() !== taskId) {
      continue;
    }
    if (target.kind === "remote_job" && !remoteJobCancelable(target.remote)) {
      facts.push({
        kind: "remote_job",
        id: target.id,
        taskId,
        status: "unsupported",
        detail: "unowned or unauthorized remote job remains unconfirmed; not cancelled",
      });
      continue;
    }
    facts.push(await params.ports.cancelTarget(target));
  }
  return facts;
}
