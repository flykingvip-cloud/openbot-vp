/**
 * Resolve the task a group bot may formally deliver against.
 *
 * Never uses OS activeContext.currentTaskId alone (unreliable group current).
 * Prefers explicit round/execution binding; otherwise unique active board item
 * where this actor is the current claimant across group tasks.
 */
import type { Task } from "@openbot/collaboration-core";
import type { OpenBotConfig } from "../../config/types.js";
import { SELF_ADVANCE_ACTIVE_BOARD_STATUSES } from "../collaboration-dispatch/self-advance.js";
import { listCollaborationBoardItems } from "./claim-contract-entry.js";
import {
  createTrustedGroupStores,
  type TeamResourceAuthOk,
  type TrustedGroupStores,
} from "./team-resource-auth.js";
import type { CollaborationTenantResolution } from "./trusted-tenant.js";

function compact(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

export type ActorDeliverableTaskBinding =
  | {
      ok: true;
      taskId: string;
      boardItemId: string;
      source: "explicit" | "active_claimant";
    }
  | { ok: false; reason: string };

export async function resolveActorDeliverableTaskBinding(params: {
  groupId: string;
  actorId: string;
  /** Explicit round / execution-bag task id (trusted). */
  explicitTaskId?: string | null;
  explicitBoardItemId?: string | null;
  /** Recorded only for diagnostics — never used as sole submission target. */
  groupCurrentTaskId?: string | null;
  auth?: TeamResourceAuthOk | null;
  trusted?: { groupsRoot: string; groupLocator: string } | null;
  stores?: TrustedGroupStores | null;
  tenant?: CollaborationTenantResolution | null;
  cfg?: OpenBotConfig;
}): Promise<ActorDeliverableTaskBinding> {
  const groupId = compact(params.groupId);
  const actorId = compact(params.actorId);
  if (!groupId || !actorId) {
    return { ok: false, reason: "group_or_actor_required" };
  }

  const explicitTaskId = compact(params.explicitTaskId);
  const explicitBoardItemId = compact(params.explicitBoardItemId);
  if (explicitTaskId && explicitBoardItemId) {
    return {
      ok: true,
      taskId: explicitTaskId,
      boardItemId: explicitBoardItemId,
      source: "explicit",
    };
  }

  const active = new Set<string>(SELF_ADVANCE_ACTIVE_BOARD_STATUSES);

  const collectForTask = async (taskId: string) => {
    const items = await listCollaborationBoardItems({
      groupId,
      taskId,
      cfg: params.cfg,
      auth: params.auth,
      trusted: params.trusted,
      stores: params.stores,
      tenant: params.tenant,
    });
    return items.filter(
      (row) => active.has(compact(row.status)) && compact(row.claimantId) === actorId,
    );
  };

  if (explicitTaskId) {
    try {
      const mine = await collectForTask(explicitTaskId);
      if (mine.length === 1) {
        return {
          ok: true,
          taskId: explicitTaskId,
          boardItemId: compact(mine[0].itemId),
          source: "explicit",
        };
      }
      if (mine.length === 0) {
        return { ok: false, reason: "no_active_claim_for_actor_on_explicit_task" };
      }
      return { ok: false, reason: "ambiguous_active_claims_for_actor" };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return { ok: false, reason: `board_unreadable:${detail}` };
    }
  }

  // No explicit task: scan group tasks where actor is assigned, require unique active claim.
  let stores = params.stores ?? null;
  if (!stores) {
    const groupsRoot =
      compact(params.auth?.groupsRoot) || compact(params.trusted?.groupsRoot) || "";
    const groupLocator =
      compact(params.auth?.groupLocator) || compact(params.trusted?.groupLocator) || "";
    if (!groupsRoot || !groupLocator) {
      return { ok: false, reason: "trusted_locator_required_for_claim_scan" };
    }
    stores = createTrustedGroupStores({ groupsRoot, groupLocator });
  }
  if (!stores?.objectStorage) {
    return { ok: false, reason: "trusted_object_storage_required" };
  }

  let tasks: Task[] = [];
  try {
    tasks = await stores.objectStorage.listObjects<Task>(groupId, "task");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `tasks_unreadable:${detail}` };
  }

  const candidates: Array<{ taskId: string; boardItemId: string }> = [];
  for (const task of tasks) {
    const taskId = compact(task.taskId);
    if (!taskId) {
      continue;
    }
    const assigned = (task.assignedMemberIds ?? []).map((id) => compact(id)).filter(Boolean);
    if (!assigned.includes(actorId)) {
      continue;
    }
    try {
      const mine = await collectForTask(taskId);
      for (const row of mine) {
        const boardItemId = compact(row.itemId);
        if (boardItemId) {
          candidates.push({ taskId, boardItemId });
        }
      }
    } catch {
      // Skip unreadable task boards; ambiguity/absence handled below.
    }
  }

  if (candidates.length === 0) {
    return { ok: false, reason: "no_active_claim_for_actor" };
  }
  if (candidates.length > 1) {
    return { ok: false, reason: "ambiguous_active_claims_for_actor" };
  }
  void params.groupCurrentTaskId;
  return {
    ok: true,
    taskId: candidates[0].taskId,
    boardItemId: candidates[0].boardItemId,
    source: "active_claimant",
  };
}
