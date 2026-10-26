/**
 * U1 — production entry for task-level stop on the existing task authority.
 *
 * Persists stopControl on objectStorage "task" (GovernedTask). Authorization
 * reuses operating-state membership / owner / admin / coordinator — no new
 * role library. Shared guard: assertTaskNotStopped / assertPersistedTaskNotStopped.
 */
import type { Task } from "@openbot/collaboration-core";
import { loadConfig } from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import { asGovernedTask, type GovernedTask } from "../collaboration-dispatch/task-runtime.js";
import {
  assertTaskNotStopped,
  buildAcceptedTaskStopControl,
  isTaskStopAccepted,
  readTaskStopControl,
  TaskStoppedError,
  type TaskStopControl,
  type TaskStopExternalEffect,
  type TaskStopInFlightAbort,
} from "../collaboration-dispatch/task-stop-control.js";
import { isMappedDeliveryIdentity } from "./delivery-actor-binding.js";
import { createWorkspaceCollaborationStores, readGroupOperatingState } from "./shared.js";
import type { CollaborationTenantResolution } from "./trusted-tenant.js";

export { assertTaskNotStopped, isTaskStopAccepted, readTaskStopControl, TaskStoppedError };
export type { TaskStopControl };

export class TaskStopEntryError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "TaskStopEntryError";
    this.code = code;
  }
}

type StopAuthState = {
  governance?: {
    ownerUserId?: string | null;
    adminUserIds?: string[] | null;
    coordinatorBotId?: string | null;
  } | null;
  memberRoleMap?: ReadonlyArray<{
    memberId?: string | null;
    governanceRole?: string | null;
    status?: string | null;
  }> | null;
} | null;

function compact(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

/** Who may request stop: mapped member who is owner, admin, or coordinator. */
export function canRequestTaskStop(params: {
  actorId: string;
  operatingState: StopAuthState;
}): boolean {
  const actorId = compact(params.actorId);
  if (!actorId) {
    return false;
  }
  const state = params.operatingState;
  if (!isMappedDeliveryIdentity(state, actorId)) {
    return false;
  }
  const owner = compact(state?.governance?.ownerUserId);
  if (owner && owner === actorId) {
    return true;
  }
  const admins = state?.governance?.adminUserIds ?? [];
  if (admins.some((id) => compact(id) === actorId)) {
    return true;
  }
  const coordinator = compact(state?.governance?.coordinatorBotId);
  if (coordinator && coordinator === actorId) {
    return true;
  }
  return (state?.memberRoleMap ?? []).some((row) => {
    if (compact(row.memberId) !== actorId) {
      return false;
    }
    const role = compact(row.governanceRole).toLowerCase();
    return role === "owner" || role === "admin";
  });
}

export async function assertPersistedTaskNotStopped(params: {
  groupId: string;
  taskId: string;
  cfg?: OpenBotConfig;
}): Promise<GovernedTask | null> {
  const cfg = params.cfg ?? loadConfig();
  const { objectStorage } = createWorkspaceCollaborationStores(cfg);
  const current = await objectStorage.readObject<Task>(params.groupId, "task", params.taskId);
  if (!current) {
    return null;
  }
  const governed = asGovernedTask(current);
  assertTaskNotStopped(governed);
  return governed;
}

export type RequestCollaborationTaskStopParams = {
  groupId: string;
  taskId: string;
  actor?: string;
  reason?: string;
  inFlightAbort?: TaskStopInFlightAbort;
  externalEffect?: TaskStopExternalEffect;
  tenant?: CollaborationTenantResolution | null;
  cfg?: OpenBotConfig;
  nowMs?: number;
};

export type RequestCollaborationTaskStopResult = {
  task: GovernedTask;
  stopControl: TaskStopControl;
  alreadyStopped: boolean;
};

/**
 * Accept (or reaffirm) task stop on the existing task record.
 * Does not invent a second stop store. Wake / write paths must call the guard.
 */
export async function requestCollaborationTaskStop(
  params: RequestCollaborationTaskStopParams,
): Promise<RequestCollaborationTaskStopResult> {
  const actorId = compact(params.actor);
  if (!actorId) {
    throw new TaskStopEntryError("actor_required", "actor is required to request task stop");
  }
  const cfg = params.cfg ?? loadConfig();
  const { objectStorage, fileStore } = createWorkspaceCollaborationStores(cfg);
  const operatingState = await readGroupOperatingState({
    fileStore,
    groupId: params.groupId,
  });
  if (!canRequestTaskStop({ actorId, operatingState })) {
    throw new TaskStopEntryError(
      "stop_forbidden",
      "actor is not authorized to stop this task (need mapped owner/admin/coordinator)",
    );
  }
  const current = await objectStorage.readObject<Task>(params.groupId, "task", params.taskId);
  if (!current) {
    throw new TaskStopEntryError("task_not_found", `task not found: ${params.taskId}`);
  }
  const governed = asGovernedTask(current);
  const existing = readTaskStopControl(governed);
  if (existing) {
    return { task: governed, stopControl: existing, alreadyStopped: true };
  }
  const stopControl = buildAcceptedTaskStopControl({
    requestedBy: actorId,
    requestedAtMs: params.nowMs ?? Date.now(),
    reason: params.reason,
    inFlightAbort: params.inFlightAbort ?? "best_effort",
    // Default unknown: in-flight external effects may already have escaped.
    externalEffect: params.externalEffect ?? "unknown",
  });
  const updated: GovernedTask = {
    ...governed,
    stopControl,
    updatedAtMs: params.nowMs ?? Date.now(),
    updatedBy: actorId,
  };
  await objectStorage.writeObject(params.groupId, "task", params.taskId, updated);
  return { task: updated, stopControl, alreadyStopped: false };
}
