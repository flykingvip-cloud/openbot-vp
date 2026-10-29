/**
 * After plan confirm succeeds, ensure the bound board item is active
 * (`applied`|`in_progress`) with a claimantId so triggerPostPlanConfirmAdvance
 * does not early-return confirm_board_not_active / confirm_board_no_claimant.
 *
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
};

function resolveClaimantCandidate(item: GroupBoardClaimItem): string {
  const existing = compact(item.claimantId);
  if (existing) {
    return existing;
  }
  const intended = Array.isArray(item.intendedClaimantIds) ? item.intendedClaimantIds : [];
  for (const raw of intended) {
    const id = compact(raw);
    if (id) {
      return id;
    }
  }
  return "";
}

export async function ensureBoardActiveAfterConfirm(params: {
  groupId: string;
  taskId: string;
  item: GroupBoardClaimItem;
  auth?: TeamResourceAuthOk | null;
  trusted?: { groupsRoot: string; groupLocator: string } | null;
  stores?: TrustedGroupStores | null;
  tenant?: CollaborationTenantResolution | null;
  cfg?: OpenBotConfig;
}): Promise<EnsureBoardActiveAfterConfirmResult> {
  const status = compact(params.item.status);
  const claimantExisting = compact(params.item.claimantId);
  if (ACTIVE.has(status) && claimantExisting) {
    return { item: params.item, activated: false, reason: "already_active" };
  }

  const claimantId = resolveClaimantCandidate(params.item);
  if (!claimantId) {
    return { item: params.item, activated: false, reason: "no_claimant_candidate" };
  }

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
    return { item: params.item, activated: false, reason: "board_item_id_missing" };
  }

  try {
    let current = params.item;
    if (status === "published") {
      current = await claimCollaborationBoardItem({
        ...shared,
        claimantId,
        actor: claimantId,
      });
    } else if (status === "claimed") {
      // already claimed — apply below
      if (!compact(current.claimantId)) {
        // claimed without claimant is corrupt; refuse silently
        return { item: params.item, activated: false, reason: "claimed_without_claimant" };
      }
    } else if (!ACTIVE.has(status)) {
      return { item: params.item, activated: false, reason: `not_activatable:${status || "unknown"}` };
    }

    const afterStatus = compact(current.status);
    if (ACTIVE.has(afterStatus) && compact(current.claimantId)) {
      return {
        item: current,
        activated: afterStatus !== status || compact(current.claimantId) !== claimantExisting,
        reason: afterStatus === "applied" || afterStatus === "in_progress" ? "already_active" : "claimed_only",
      };
    }

    if (afterStatus === "claimed" || status === "published" || status === "claimed") {
      const applied = await applyCollaborationBoardClaim({
        ...shared,
        actor: compact(current.claimantId) || claimantId,
      });
      return { item: applied.item, activated: true, reason: "claimed_and_applied" };
    }

    return { item: current, activated: false, reason: `unexpected_status:${afterStatus || "unknown"}` };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      item: params.item,
      activated: false,
      reason: `activate_failed:${detail}`.slice(0, 240),
    };
  }
}
