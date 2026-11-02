/**
 * After a legal board publish, distinguish publish from claim.
 *
 * Ordinary publish must NOT implicitly claim for the publisher. When exactly one
 * intended claimant is determined, reuse Wake Contract handoff so that bot can
 * enter claim → apply → propose plan as itself (no identity impersonation, no
 * policy/human-confirm bypass). Multiple intended candidates → blocked (never
 * pick first). Empty intended → blocked (no single legal target). Activate
 * success stays dispatched:false.
 */
import type { OpenBotConfig } from "../../config/types.js";
import {
  isIntendedClaimantId,
  type GroupBoardClaimItem,
} from "../collaboration-dispatch/claim-contract.js";
import type { RuntimeAuthority } from "../collaboration-dispatch/runtime-authority.js";
import { recordHandoffWake } from "../collaboration-dispatch/wake-contract.js";
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
      scheduledClaimantId: null;
      wakeRecorded: false;
    }
  | {
      outcome: "scheduled";
      item: GroupBoardClaimItem;
      claimantId: null;
      nextEntryPoint: typeof POST_PUBLISH_CLAIM_ENTRY;
      reason: string;
      scheduledClaimantId: string;
      wakeRecorded: boolean;
    }
  | {
      outcome: "blocked";
      item: GroupBoardClaimItem;
      claimantId: null;
      nextEntryPoint: typeof POST_PUBLISH_CLAIM_ENTRY;
      reason: string;
      scheduledClaimantId: null;
      wakeRecorded: false;
    }
  | {
      outcome: "unchanged";
      item: GroupBoardClaimItem;
      claimantId: string | null;
      nextEntryPoint: typeof POST_PUBLISH_CLAIM_ENTRY | null;
      reason: string;
      scheduledClaimantId: null;
      wakeRecorded: false;
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

function unchanged(
  item: GroupBoardClaimItem,
  reason: string,
  nextEntryPoint: typeof POST_PUBLISH_CLAIM_ENTRY | null,
  claimantId: string | null,
): TryClaimAfterBoardPublishResult {
  return {
    outcome: "unchanged",
    item,
    claimantId,
    nextEntryPoint,
    reason,
    scheduledClaimantId: null,
    wakeRecorded: false,
  };
}

function blocked(item: GroupBoardClaimItem, reason: string): TryClaimAfterBoardPublishResult {
  return {
    outcome: "blocked",
    item,
    claimantId: null,
    nextEntryPoint: POST_PUBLISH_CLAIM_ENTRY,
    reason,
    scheduledClaimantId: null,
    wakeRecorded: false,
  };
}

/**
 * Resolve a single legal intended claimant, or a clear blocked reason.
 * Never picks intended[0] among many; never falls back to the publisher.
 */
export function resolvePostPublishClaimTarget(
  item: GroupBoardClaimItem,
): { ok: true; claimantId: string } | { ok: false; reason: string } {
  const intended = intendedIds(item);
  if (intended.length === 0) {
    return { ok: false, reason: "no_single_legal_claimant" };
  }
  if (intended.length > 1) {
    return {
      ok: false,
      reason: `ambiguous_intended_claimants:intended=${intended.join(",")}`,
    };
  }
  return { ok: true, claimantId: intended[0] };
}

/**
 * After publish: claim only when the present actor IS the single intended
 * claimant. Otherwise schedule a controlled handoff wake for that intended bot
 * (or block with a clear reason). Never auto-claims for the publisher.
 */
export async function tryClaimAfterBoardPublish(params: {
  groupId: string;
  taskId: string;
  item: GroupBoardClaimItem;
  /** Present actor at the publish site. May claim only when they are the single intended. */
  actorId: string | null | undefined;
  /** Required to record a Wake Contract handoff for an absent intended claimant. */
  authority?: RuntimeAuthority | null;
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
    return unchanged(item, "already_claimed", null, existingClaimant);
  }
  if (status !== "published") {
    return unchanged(
      item,
      `board_not_published:${status || "missing"}`,
      status ? POST_PUBLISH_CLAIM_ENTRY : null,
      existingClaimant || null,
    );
  }

  const target = resolvePostPublishClaimTarget(item);
  if (!target.ok) {
    return blocked(item, target.reason);
  }
  const intendedClaimantId = target.claimantId;

  const actorId = compact(params.actorId);
  const itemId = compact(item.itemId);
  if (!itemId) {
    return blocked(item, "board_item_id_missing");
  }

  // Present actor is the single intended → real self-claim via production entry.
  if (actorId && isIntendedClaimantId([intendedClaimantId], actorId)) {
    try {
      const claimed = await claimCollaborationBoardItem({
        groupId: params.groupId,
        taskId: params.taskId,
        itemId,
        claimantId: intendedClaimantId,
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
        claimantId: compact(claimed.claimantId) || intendedClaimantId,
        nextEntryPoint: null,
        reason: "claimed_via_entry",
        scheduledClaimantId: null,
        wakeRecorded: false,
      };
    } catch (error) {
      if (error instanceof ClaimContractFlagOffError) {
        return blocked(item, "claim_contract_flag_off");
      }
      if (error instanceof ClaimContractEntryError) {
        return blocked(item, error.code || "claim_entry_failed");
      }
      return blocked(item, error instanceof Error ? error.message : "claim_entry_failed");
    }
  }

  // Publisher / other present actor is NOT the intended claimant: do not claim
  // as them. Schedule a controlled handoff wake so the intended bot can claim.
  const authority = params.authority ?? null;
  if (!authority) {
    return blocked(
      item,
      `awaiting_intended_claimant:actor=${actorId || "none"}:intended=${intendedClaimantId}:wake_authority_required`,
    );
  }

  const fromAgentId = actorId || compact(item.publishedBy) || "system:board_publish";
  const wake = await recordHandoffWake(
    authority,
    {
      groupId: params.groupId,
      fromAgentId,
      toAgentId: intendedClaimantId,
      taskId: params.taskId,
      handoffId: itemId,
    },
    { cfg: params.cfg },
  );
  const wakeRecorded = wake.ok;
  if (!wakeRecorded) {
    return blocked(
      item,
      `awaiting_intended_claimant:actor=${actorId || "none"}:intended=${intendedClaimantId}:wake_failed:${!wake.ok ? wake.reason : "unknown"}`,
    );
  }

  return {
    outcome: "scheduled",
    item,
    claimantId: null,
    nextEntryPoint: POST_PUBLISH_CLAIM_ENTRY,
    reason: `scheduled_intended_claimant:intended=${intendedClaimantId}`,
    scheduledClaimantId: intendedClaimantId,
    wakeRecorded: true,
  };
}
