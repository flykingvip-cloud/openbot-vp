/**
 * U1 — production entry for task-level stop on the existing task authority.
 *
 * Persists stopControl on objectStorage "task" (GovernedTask). Authorization
 * reuses operating-state membership / owner / admin / coordinator — no new
 * role library. Shared guard: assertTaskNotStopped / assertPersistedTaskNotStopped.
 */
import type { Task } from "@openbot/collaboration-core";
import {
  abortEmbeddedPiRunIfCurrent,
  getActiveEmbeddedRunId,
  waitForEmbeddedPiRunEnd,
} from "../../agent-runtime/execution/runner/run-registry.js";
import {
  clearAsyncWaitJobIntent,
  listAsyncWaitJobRefsForTask,
} from "../../agent-runtime/state/index.js";
import {
  listOwnedChildExecutions,
  listOwnedRemoteJobs,
  unregisterOwnedChildExecution,
  unregisterOwnedRemoteJob,
} from "../../agent-runtime/state/owned-stop-affiliation.js";
import {
  clearFollowupQueueItemsForTask,
  clearSessionQueueItemsForTask,
  listFollowupQueueItemsForTask,
} from "../../auto-reply/reply/queue.js";
import { loadConfig } from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import { applyTaskStopUnderControlLock } from "../collaboration-dispatch/task-control-cas.js";
import { asGovernedTask, type GovernedTask } from "../collaboration-dispatch/task-runtime.js";
import {
  assertTaskNotStopped,
  buildAcceptedTaskStopControl,
  cancelOwnedWorkAfterAcceptedStop,
  isTaskStopAccepted,
  readTaskStopControl,
  TaskStoppedError,
  type OwnedStopPorts,
  type OwnedStopTarget,
  type OwnedStopTargetFact,
  type TaskStopControl,
  type TaskStopExternalEffect,
  type TaskStopInFlightAbort,
} from "../collaboration-dispatch/task-stop-control.js";
import { resolveSecurityProfile } from "../security-profile.js";
import { hasSupervisorRun, cancelSupervisorRun } from "../supervisor/run-registry.js";
import { isMappedDeliveryIdentity } from "./delivery-actor-binding.js";
import { createWorkspaceCollaborationStores, readGroupOperatingState } from "./shared.js";
import {
  resolveTeamDeliverableStores,
  type TeamResourceAuthOk,
  type TrustedGroupStores,
  TRUSTED_GROUP_LOCATOR_REQUIRED,
} from "./team-resource-auth.js";
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
  /** Trusted object storage — avoid host dual-root re-resolve when provided. */
  objectStorage?: {
    readObject: <T>(groupId: string, kind: string, id: string) => Promise<T | null>;
  };
}): Promise<GovernedTask | null> {
  const cfg = params.cfg ?? loadConfig();
  const objectStorage =
    params.objectStorage ?? createWorkspaceCollaborationStores(cfg).objectStorage;
  const current = await objectStorage.readObject<Task>(params.groupId, "task", params.taskId);
  if (!current) {
    return null;
  }
  const governed = asGovernedTask(current);
  assertTaskNotStopped(governed);
  return governed;
}

export function createDefaultOwnedStopPorts(): OwnedStopPorts {
  return {
    listOwnedTargets: (taskId) => {
      const targets: OwnedStopTarget[] = [];
      if (hasSupervisorRun(taskId)) {
        targets.push({ kind: "supervisor_run", id: taskId, taskId });
      }
      for (const { item, queueKey } of listFollowupQueueItemsForTask(taskId)) {
        targets.push({
          kind: "queue_item",
          id: item.followupItemId?.trim() || `${queueKey}:${item.enqueuedAt}`,
          taskId,
        });
      }
      for (const child of listOwnedChildExecutions(taskId)) {
        targets.push({ kind: "child_execution", id: child.id, taskId });
      }
      for (const job of listAsyncWaitJobRefsForTask(taskId)) {
        targets.push({ kind: "async_wait_job", id: job.jobId, taskId });
      }
      for (const remote of listOwnedRemoteJobs(taskId)) {
        targets.push({
          kind: "remote_job",
          id: remote.jobId,
          taskId,
          remote: {
            jobId: remote.jobId,
            leaseId: remote.leaseId ?? "",
            authorized: remote.authorized === true,
          },
        });
      }
      return targets;
    },
    cancelTarget: async (target) => {
      if (target.kind === "supervisor_run") {
        const requested = await cancelSupervisorRun(target.taskId);
        const gone = !hasSupervisorRun(target.taskId);
        return {
          kind: target.kind,
          id: target.id,
          taskId: target.taskId,
          status: gone ? "confirmed_stopped" : "pending",
          detail: gone
            ? undefined
            : requested
              ? "supervisor cancel was requested but exit was not confirmed"
              : "no in-process supervisor run to confirm",
        };
      }
      if (target.kind === "queue_item") {
        const removed = clearFollowupQueueItemsForTask(target.taskId);
        return {
          kind: target.kind,
          id: target.id,
          taskId: target.taskId,
          status: removed > 0 ? "confirmed_stopped" : "pending",
          detail:
            removed > 0
              ? `removed ${removed} owned queue item(s)`
              : "owned queue item already gone",
        };
      }
      if (target.kind === "child_execution") {
        const child = listOwnedChildExecutions(target.taskId).find((row) => row.id === target.id);
        const sessionId = child?.sessionId?.trim() ?? "";
        const ownedRunId = child?.id.trim() ?? "";
        const currentRunId = sessionId ? (getActiveEmbeddedRunId(sessionId)?.trim() ?? "") : "";
        if (!sessionId || !ownedRunId || currentRunId !== ownedRunId) {
          if (child) {
            unregisterOwnedChildExecution(target.taskId, target.id);
          }
          return {
            kind: target.kind,
            id: target.id,
            taskId: target.taskId,
            status: "unsupported",
            detail: "stale or session-only affiliation; current run not cancelled",
          };
        }
        abortEmbeddedPiRunIfCurrent(sessionId, ownedRunId);
        clearSessionQueueItemsForTask([sessionId, child?.sessionKey], target.taskId);
        const exited = await waitForEmbeddedPiRunEnd(sessionId, 50);
        const stillCurrent = getActiveEmbeddedRunId(sessionId)?.trim() === ownedRunId;
        unregisterOwnedChildExecution(target.taskId, target.id);
        return {
          kind: target.kind,
          id: target.id,
          taskId: target.taskId,
          status: exited && !stillCurrent ? "confirmed_stopped" : "pending",
          detail:
            exited && !stillCurrent
              ? undefined
              : "child cancel was requested but exit was not confirmed",
        };
      }
      if (target.kind === "async_wait_job") {
        const refs = listAsyncWaitJobRefsForTask(target.taskId).filter(
          (row) => row.jobId === target.id,
        );
        let cleared = 0;
        for (const ref of refs) {
          if (clearAsyncWaitJobIntent(ref.sessionFile, ref.jobId)) {
            cleared += 1;
          }
        }
        return {
          kind: target.kind,
          id: target.id,
          taskId: target.taskId,
          status: cleared > 0 ? "confirmed_stopped" : "pending",
          detail:
            cleared > 0
              ? `cleared ${cleared} owned async-wait job(s)`
              : "owned async-wait job already gone",
        };
      }
      if (target.kind === "remote_job") {
        const listed = listOwnedRemoteJobs(target.taskId).find((row) => row.jobId === target.id);
        const listedLease = target.remote?.leaseId?.trim() ?? "";
        const currentLease = listed?.leaseId?.trim() ?? "";
        const currentBindingCancelable = Boolean(
          listed?.jobId?.trim() &&
          listedLease &&
          currentLease &&
          currentLease === listedLease &&
          listed?.authorized === true &&
          typeof listed.cancel === "function",
        );
        if (!currentBindingCancelable || !listed?.cancel) {
          return {
            kind: target.kind,
            id: target.id,
            taskId: target.taskId,
            status: "unsupported",
            detail:
              "remote job missing current job, lease, authorization, or cancel consumer; not cancelled",
          };
        }
        try {
          const stopped = await listed.cancel();
          if (stopped) {
            unregisterOwnedRemoteJob(target.taskId, target.id);
          }
          return {
            kind: target.kind,
            id: target.id,
            taskId: target.taskId,
            status: stopped ? "confirmed_stopped" : "pending",
            detail: stopped ? undefined : "remote cancel was not confirmed",
          };
        } catch (error) {
          return {
            kind: target.kind,
            id: target.id,
            taskId: target.taskId,
            status: "failed",
            detail: error instanceof Error ? error.message : String(error),
          };
        }
      }
      return {
        kind: target.kind,
        id: target.id,
        taskId: target.taskId,
        status: "unsupported",
        detail: "no cancel port wired for this target kind",
      };
    },
  };
}

export type RequestCollaborationTaskStopParams = {
  groupId: string;
  taskId: string;
  actor?: string;
  reason?: string;
  inFlightAbort?: TaskStopInFlightAbort;
  externalEffect?: TaskStopExternalEffect;
  tenant?: CollaborationTenantResolution | null;
  /** Handler-resolved trusted auth — required for managed_enterprise. */
  auth?: TeamResourceAuthOk | null;
  trusted?: { groupsRoot: string; groupLocator: string } | null;
  stores?: TrustedGroupStores | null;
  cfg?: OpenBotConfig;
  nowMs?: number;
  /** Test/production override; defaults cancel only explicitly owned in-process work. */
  ownedStopPorts?: OwnedStopPorts;
};

export type RequestCollaborationTaskStopResult = {
  task: GovernedTask;
  stopControl: TaskStopControl;
  alreadyStopped: boolean;
  cascadeFacts: OwnedStopTargetFact[];
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
  const profile = resolveSecurityProfile(cfg).profile;
  let objectStorage: TrustedGroupStores["objectStorage"];
  let fileStore: TrustedGroupStores["fileStore"];
  let groupRootDir: string | undefined;
  if (params.stores?.objectStorage && params.stores.fileStore) {
    objectStorage = params.stores.objectStorage;
    fileStore = params.stores.fileStore;
    groupRootDir = params.stores.groupsRoot;
  } else if (params.auth || params.trusted) {
    const resolved = resolveTeamDeliverableStores({
      auth: params.auth,
      trusted: params.trusted,
      groupId: params.groupId,
      cfg,
      tenantId: params.auth?.tenantId ?? params.tenant?.tenantId ?? null,
    });
    if (!resolved.ok) {
      throw new TaskStopEntryError(
        resolved.reason || TRUSTED_GROUP_LOCATOR_REQUIRED,
        resolved.detail || "trusted group locator required for task stop",
      );
    }
    objectStorage = resolved.objectStorage;
    fileStore = resolved.fileStore;
    groupRootDir = resolved.groupsRoot;
  } else if (profile === "managed_enterprise") {
    throw new TaskStopEntryError(
      TRUSTED_GROUP_LOCATOR_REQUIRED,
      "managed_enterprise task stop requires trusted group locator from handler auth",
    );
  } else {
    const legacy = createWorkspaceCollaborationStores(cfg);
    objectStorage = legacy.objectStorage;
    fileStore = legacy.fileStore;
    groupRootDir = legacy.groupRootDir;
  }
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
    const cascadeFacts = await cancelOwnedWorkAfterAcceptedStop({
      taskId: params.taskId,
      stopAccepted: true,
      ports: params.ownedStopPorts ?? createDefaultOwnedStopPorts(),
    });
    return { task: governed, stopControl: existing, alreadyStopped: true, cascadeFacts };
  }
  const stopControl = buildAcceptedTaskStopControl({
    requestedBy: actorId,
    requestedAtMs: params.nowMs ?? Date.now(),
    reason: params.reason,
    inFlightAbort: params.inFlightAbort ?? "best_effort",
    // Default unknown: in-flight external effects may already have escaped.
    externalEffect: params.externalEffect ?? "unknown",
  });
  // T41/T42: under shared task-control lock — bump controlEpoch, clear dispatchClaim,
  // persist stop patch onto the *live* task (no stale whole-object merge).
  const updated = await applyTaskStopUnderControlLock({
    groupId: params.groupId,
    taskId: params.taskId,
    stopControl,
    updatedBy: actorId,
    updatedAtMs: params.nowMs ?? Date.now(),
    cfg,
    groupRootDir,
    objectStorage,
  });
  const persistedStop = readTaskStopControl(updated);
  if (!persistedStop) {
    throw new TaskStopEntryError("stop_persist_failed", "stop did not persist under control lock");
  }
  const cascadeFacts = await cancelOwnedWorkAfterAcceptedStop({
    taskId: params.taskId,
    stopAccepted: true,
    ports: params.ownedStopPorts ?? createDefaultOwnedStopPorts(),
  });
  return { task: updated, stopControl: persistedStop, alreadyStopped: false, cascadeFacts };
}
