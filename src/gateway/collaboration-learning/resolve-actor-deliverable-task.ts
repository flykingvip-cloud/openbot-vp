/**
 * Resolve the task a group bot may formally deliver against.
 *
 * Never uses OS activeContext.currentTaskId alone (unreliable group current).
 * Never scans the whole group for "unique active claimant" (ambiguous / wrong bind).
 * Requires explicit task+board from the execution bag / wake run binding, then
 * verifies claimant + active board status before accepting.
 */
import type { OpenBotConfig } from "../../config/types.js";
import { SELF_ADVANCE_ACTIVE_BOARD_STATUSES } from "../collaboration-dispatch/self-advance.js";
import { listCollaborationBoardItems } from "./claim-contract-entry.js";
import type { TeamResourceAuthOk, TrustedGroupStores } from "./team-resource-auth.js";
import type { CollaborationTenantResolution } from "./trusted-tenant.js";

function compact(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

export type ActorDeliverableTaskBinding =
  | {
      ok: true;
      taskId: string;
      boardItemId: string;
      source: "explicit";
      planVersion?: number | null;
      todolistId?: string | null;
      stepId?: string | null;
    }
  | { ok: false; reason: string };

export async function resolveActorDeliverableTaskBinding(params: {
  groupId: string;
  actorId: string;
  /** Explicit round / execution-bag task id (required). */
  explicitTaskId?: string | null;
  /** Explicit round / execution-bag board item id (required). */
  explicitBoardItemId?: string | null;
  /** Optional plan binding for diagnostics / future gates. */
  explicitTodolistId?: string | null;
  explicitPlanVersion?: number | null;
  explicitStepId?: string | null;
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
  void params.groupCurrentTaskId;

  if (!explicitTaskId || !explicitBoardItemId) {
    return {
      ok: false,
      reason: "execution_binding_required",
    };
  }

  const active = new Set<string>(SELF_ADVANCE_ACTIVE_BOARD_STATUSES);

  let items;
  try {
    items = await listCollaborationBoardItems({
      groupId,
      taskId: explicitTaskId,
      cfg: params.cfg,
      auth: params.auth,
      trusted: params.trusted,
      stores: params.stores,
      tenant: params.tenant,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `board_unreadable:${detail}` };
  }

  const item = items.find((row) => compact(row.itemId) === explicitBoardItemId);
  if (!item) {
    return { ok: false, reason: "explicit_board_item_missing" };
  }
  if (compact(item.taskId) && compact(item.taskId) !== explicitTaskId) {
    return { ok: false, reason: "explicit_board_task_mismatch" };
  }
  if (!active.has(compact(item.status))) {
    return {
      ok: false,
      reason: `explicit_board_not_active:${compact(item.status) || "unknown"}`,
    };
  }
  if (compact(item.claimantId) !== actorId) {
    return {
      ok: false,
      reason: `explicit_claimant_mismatch:have=${compact(item.claimantId) || "none"}:want=${actorId}`,
    };
  }

  return {
    ok: true,
    taskId: explicitTaskId,
    boardItemId: explicitBoardItemId,
    source: "explicit",
    todolistId: compact(params.explicitTodolistId) || null,
    planVersion:
      typeof params.explicitPlanVersion === "number" && Number.isFinite(params.explicitPlanVersion)
        ? params.explicitPlanVersion
        : null,
    stepId: compact(params.explicitStepId) || null,
  };
}
