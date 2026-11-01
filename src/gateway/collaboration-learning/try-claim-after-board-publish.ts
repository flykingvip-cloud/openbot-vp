/**
 * After a legal board publish, advance through the existing claim entry when a
 * rightful actor is present. Does not invent claimants, bypass policy confirm,
 * or mint humanConfirmed. activate success stays dispatched:false.
 */
import type { OpenBotConfig } from "../../config/types.js";
import {
  isIntendedClaimantId,
  type GroupBoardClaimItem,
} from "../collaboration-dispatch/claim-contract.js";
import {
  claimCollaborationBoardItem,
  ClaimContractEntryError,
  ClaimContractFlagOffError,
} from "./claim-contract-entry.js";
import type { TeamResourceAuthOk, TrustedGroupStores } from "./team-resource-auth.js";
import type { CollaborationTenantResolution } from "./trusted-tenant.js";

export const POST_PUBLISH_CLAIM_ENTRY = "claimCollaborationBoardItem" as const;

const ALREADY_CLAIMED = new Set([
  "claimed",
  "applied",
  "in_progress",
  "submitted_for_review",
  "returned",
  "accepted",
]);

export type TryClaimAfterBoardPublishResult =
  | {
      outcome: "claimed";
      item: GroupBoardClaimItem;
      claimantId: string;
      nextEntryPoint: null;
      reason: "claimed_via_entry";
    }
  | {
      outcome: "blocked";
      item: GroupBoardClaimItem;
      claimantId: null;
      nextEntryPoint: typeof POST_PUBLISH_CLAIM_ENTRY;
      reason: string;
    }
  | {
      outcome: "unchanged";
      item: GroupBoardClaimItem;
      claimantId: string | null;
      nextEntryPoint: typeof POST_PUBLISH_CLAIM_ENTRY | null;
      reason: string;
    };

function compact(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

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
 * Invoke claimCollaborationBoardItem only when the present actor is rightful.
 * Never auto-picks intendedClaimantIds[0] for an absent claimant.
 */
export async function tryClaimAfterBoardPublish(params: {
  groupId: string;
  taskId: string;
  item: GroupBoardClaimItem;
  /** Present actor at the publish site. Required to attempt a real claim. */
  actorId: string | null | undefined;
  auth?: TeamResourceAuthOk | null;
  trusted?: { groupsRoot: string; groupLocator: string } | null;
  stores?: TrustedGroupStores | null;
  tenant?: CollaborationTenantResolution | null;
  cfg?: OpenBotConfig;
}): Promise<TryClaimAfterBoardPublishResult> {
  const item = params.item;
  const status = compact(item.status);
  const existingClaimant = compact(item.claimantId);
  if (ALREADY_CLAIMED.has(status) && existingClaimant) {
    return {
      outcome: "unchanged",
      item,
      claimantId: existingClaimant,
      nextEntryPoint: null,
      reason: "already_claimed",
    };
  }
  if (status !== "published") {
    return {
      outcome: "unchanged",
      item,
      claimantId: existingClaimant || null,
      nextEntryPoint: status ? POST_PUBLISH_CLAIM_ENTRY : null,
      reason: `board_not_published:${status || "missing"}`,
    };
  }

  const actorId = compact(params.actorId);
  if (!actorId) {
    return {
      outcome: "blocked",
      item,
      claimantId: null,
      nextEntryPoint: POST_PUBLISH_CLAIM_ENTRY,
      reason: "claimant_actor_required",
    };
  }

  const intended = intendedIds(item);
  if (intended.length > 0 && !isIntendedClaimantId(intended, actorId)) {
    return {
      outcome: "blocked",
      item,
      claimantId: null,
      nextEntryPoint: POST_PUBLISH_CLAIM_ENTRY,
      reason: `awaiting_intended_claimant:actor=${actorId}:intended=${intended.join(",")}`,
    };
  }

  const itemId = compact(item.itemId);
  if (!itemId) {
    return {
      outcome: "blocked",
      item,
      claimantId: null,
      nextEntryPoint: POST_PUBLISH_CLAIM_ENTRY,
      reason: "board_item_id_missing",
    };
  }

  try {
    const claimed = await claimCollaborationBoardItem({
      groupId: params.groupId,
      taskId: params.taskId,
      itemId,
      claimantId: actorId,
      actor: actorId,
      auth: params.auth,
      trusted: params.trusted,
      stores: params.stores,
      tenant: params.tenant,
      cfg: params.cfg,
    });
    return {
      outcome: "claimed",
      item: claimed,
      claimantId: compact(claimed.claimantId) || actorId,
      nextEntryPoint: null,
      reason: "claimed_via_entry",
    };
  } catch (error) {
    if (error instanceof ClaimContractFlagOffError) {
      return {
        outcome: "blocked",
        item,
        claimantId: null,
        nextEntryPoint: POST_PUBLISH_CLAIM_ENTRY,
        reason: "claim_contract_flag_off",
      };
    }
    if (error instanceof ClaimContractEntryError) {
      return {
        outcome: "blocked",
        item,
        claimantId: null,
        nextEntryPoint: POST_PUBLISH_CLAIM_ENTRY,
        reason: error.code || "claim_entry_failed",
      };
    }
    return {
      outcome: "blocked",
      item,
      claimantId: null,
      nextEntryPoint: POST_PUBLISH_CLAIM_ENTRY,
      reason: error instanceof Error ? error.message : "claim_entry_failed",
    };
  }
}
