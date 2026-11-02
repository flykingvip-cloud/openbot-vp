/**
 * After plan confirm succeeds, ensure the bound board item is active
 * (`applied`|`in_progress`) with a claimantId so triggerPostPlanConfirmAdvance
 * does not early-return confirm_board_not_active / confirm_board_no_claimant.
 *
 * Responsibility binding (who authorized / who executes / who is responsible):
 * - authorizingActorId = confirmer / peer coordinator who authorized confirm (audit)
 * - planOwnerMemberId  = confirmed plan executor (ownerMemberId)
 * - claimantId         = board responsibility, resolved from plan owner ∩ intended
 *
 * Claim/apply only when a non-empty authorizing actor IS the plan owner (self-claim path).
 * Missing authorizingActorId → `authorizing_actor_required` (no claimantId backfill).
 * Coordinator/human confirmer must NOT proxy-claim for the executor — return
 * `awaiting_executor_self_claim` so post-confirm can schedule controlled claim wake.
 * Never blindly takes intendedClaimantIds[0] or fakes auth subject as target executor.
 * Best-effort only: never throws to roll back a committed confirm.
 * Uses existing claim → apply entry points (no new orchestrator).
 */
import type { OpenBotConfig } from "../../config/types.js";
import type { GroupBoardClaimItem } from "../collaboration-dispatch/claim-contract.js";
import { SELF_ADVANCE_ACTIVE_BOARD_STATUSES } from "../collaboration-dispatch/self-advance.js";
import {
  applyCollaborationBoardClaim,
  claimCollaborationBoardItem,
} from "./claim-contract-entry.js";
import { deliveryActorIdsEqual } from "./delivery-actor-binding.js";
import type { TeamResourceAuthOk, TrustedGroupStores } from "./team-resource-auth.js";
import type { CollaborationTenantResolution } from "./trusted-tenant.js";

function compact(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

const ACTIVE = new Set<string>(SELF_ADVANCE_ACTIVE_BOARD_STATUSES);

export type EnsureBoardActiveAfterConfirmResult = {
  item: GroupBoardClaimItem;
  activated: boolean;
  reason: string;
  /** Board responsibility assignee when resolved (may equal plan owner alias form). */
  executorId?: string;
  /** Who authorized the confirm→activate path. */
  authorizingActorId?: string;
};

function intendedIds(item: GroupBoardClaimItem): string[] {
  const raw = Array.isArray(item.intendedClaimantIds) ? item.intendedClaimantIds : [];
  const out: string[] = [];
  for (const entry of raw) {
    const id = compact(entry);
    if (id && !out.includes(id)) {
      out.push(id);
    }
  }
  return out;
}

/**
 * Bind board claimant to the confirmed plan executor.
 * Prefer an intended id form that matches planOwnerMemberId (bot ↔ bot:bot).
 * Refuse when multi-intended / owner≠intended / no plan owner — never intended[0].
 */
export function resolveExecutorClaimantId(params: {
  item: GroupBoardClaimItem;
  planOwnerMemberId: string | null | undefined;
}): { ok: true; claimantId: string } | { ok: false; reason: string } {
  const planOwner = compact(params.planOwnerMemberId);
  if (!planOwner) {
    return { ok: false, reason: "plan_owner_required" };
  }

  const existing = compact(params.item.claimantId);
  if (existing && deliveryActorIdsEqual(existing, planOwner)) {
    return { ok: true, claimantId: existing };
  }
  if (existing && !deliveryActorIdsEqual(existing, planOwner)) {
    // Already claimed by someone else — do not steal / rebind here.
    return { ok: false, reason: `claimant_plan_owner_mismatch:claimant=${existing}` };
  }

  const intended = intendedIds(params.item);
  if (intended.length === 0) {
    return { ok: false, reason: "plan_owner_not_in_intended" };
  }

  const matches = intended.filter((id) => deliveryActorIdsEqual(id, planOwner));
  if (matches.length === 0) {
    return {
      ok: false,
      reason: `plan_owner_not_in_intended:owner=${planOwner}:intended=${intended.join(",")}`,
    };
  }

  // Prefer exact string match to plan owner, else the matching intended form
  // (so claimBoardItem intended-list check passes, e.g. owner bot:bot → intended "bot").
  const exact = matches.find((id) => id === planOwner);
  if (exact) {
    return { ok: true, claimantId: exact };
  }
  if (matches.length > 1) {
    return {
      ok: false,
      reason: `ambiguous_intended_for_plan_owner:owner=${planOwner}:matches=${matches.join(",")}`,
    };
  }
  return { ok: true, claimantId: matches[0] };
}

export async function ensureBoardActiveAfterConfirm(params: {
  groupId: string;
  taskId: string;
  item: GroupBoardClaimItem;
  /** Confirmed plan executor (todolist.ownerMemberId). Required to activate. */
  planOwnerMemberId?: string | null;
  /** Confirmer / peer coordinator who authorized (audit). Must match plan owner to self-claim/apply; else awaiting_executor_self_claim. */
  authorizingActorId?: string | null;
  auth?: TeamResourceAuthOk | null;
  trusted?: { groupsRoot: string; groupLocator: string } | null;
  stores?: TrustedGroupStores | null;
  tenant?: CollaborationTenantResolution | null;
  cfg?: OpenBotConfig;
}): Promise<EnsureBoardActiveAfterConfirmResult> {
  const status = compact(params.item.status);
  const claimantExisting = compact(params.item.claimantId);
  const authorizingActorId = compact(params.authorizingActorId) || undefined;
  const planOwner = compact(params.planOwnerMemberId);

  if (ACTIVE.has(status) && claimantExisting) {
    if (planOwner && !deliveryActorIdsEqual(claimantExisting, planOwner)) {
      return {
        item: params.item,
        activated: false,
        reason: `claimant_plan_owner_mismatch:claimant=${claimantExisting}`,
        authorizingActorId,
      };
    }
    return {
      item: params.item,
      activated: false,
      reason: "already_active",
      executorId: claimantExisting,
      authorizingActorId,
    };
  }

  const resolved = resolveExecutorClaimantId({
    item: params.item,
    planOwnerMemberId: planOwner,
  });
  if (!resolved.ok) {
    return {
      item: params.item,
      activated: false,
      reason: resolved.reason,
      authorizingActorId,
    };
  }
  const claimantId = resolved.claimantId;
  // Production write path: require a non-empty trusted authorizing actor.
  // Missing subject → explicit reject. Never backfill actor from claimantId
  // (that would treat the target/plan-owner identity as the executing subject).
  if (!authorizingActorId) {
    return {
      item: params.item,
      activated: false,
      reason: "authorizing_actor_required",
      executorId: claimantId,
      authorizingActorId,
    };
  }
  // Self-claim only: authorizing actor must match the plan-owner claimant.
  // Distinct audit field authorizingActorId is preserved on the result; never claim as
  // authorizer while writing claimantId=executor (proxy claim / fake auth subject).
  if (!deliveryActorIdsEqual(authorizingActorId, claimantId)) {
    return {
      item: params.item,
      activated: false,
      reason: `awaiting_executor_self_claim:authorizer=${authorizingActorId}:executor=${claimantId}`,
      executorId: claimantId,
      authorizingActorId,
    };
  }
  // Trusted subject only — use authorizingActorId, never claimantId backfill.
  const actor = authorizingActorId;

  const shared = {
    groupId: params.groupId,
    taskId: params.taskId,
    itemId: compact(params.item.itemId),
    auth: params.auth,
    trusted: params.trusted,
    stores: params.stores,
    tenant: params.tenant,
    cfg: params.cfg,
  };
  if (!shared.itemId) {
    return {
      item: params.item,
      activated: false,
      reason: "board_item_id_missing",
      authorizingActorId,
    };
  }

  try {
    let current = params.item;
    if (status === "published") {
      current = await claimCollaborationBoardItem({
        ...shared,
        claimantId,
        actor,
      });
    } else if (status === "claimed") {
      if (!compact(current.claimantId)) {
        return {
          item: params.item,
          activated: false,
          reason: "claimed_without_claimant",
          authorizingActorId,
        };
      }
      if (!deliveryActorIdsEqual(compact(current.claimantId), planOwner || claimantId)) {
        return {
          item: params.item,
          activated: false,
          reason: `claimant_plan_owner_mismatch:claimant=${compact(current.claimantId)}`,
          authorizingActorId,
        };
      }
    } else if (!ACTIVE.has(status)) {
      return {
        item: params.item,
        activated: false,
        reason: `not_activatable:${status || "unknown"}`,
        authorizingActorId,
      };
    }

    const afterStatus = compact(current.status);
    if (ACTIVE.has(afterStatus) && compact(current.claimantId)) {
      return {
        item: current,
        activated: afterStatus !== status || compact(current.claimantId) !== claimantExisting,
        reason:
          afterStatus === "applied" || afterStatus === "in_progress"
            ? "already_active"
            : "claimed_only",
        executorId: compact(current.claimantId),
        authorizingActorId,
      };
    }

    if (afterStatus === "claimed" || status === "published" || status === "claimed") {
      const applied = await applyCollaborationBoardClaim({
        ...shared,
        actor,
      });
      return {
        item: applied.item,
        activated: true,
        reason: "claimed_and_applied",
        executorId: compact(applied.item.claimantId) || claimantId,
        authorizingActorId,
      };
    }

    return {
      item: current,
      activated: false,
      reason: `unexpected_status:${afterStatus || "unknown"}`,
      authorizingActorId,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      item: params.item,
      activated: false,
      reason: `activate_failed:${detail}`.slice(0, 240),
      authorizingActorId,
    };
  }
}
