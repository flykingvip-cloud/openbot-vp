/**
 * After a legal board publish, distinguish publish from claim.
 *
 * Ordinary publish must NOT implicitly claim for the publisher. When exactly one
 * intended claimant is determined, keep handoff audit AND reuse the existing
 * consumable Wake Round path (`recordNudgeWake` + `consumeWakeForRoundDispatch`
 * with source=nudge — already in WAKE_ROUND_DISPATCH_SOURCES) so that bot can
 * enter claim → apply → propose plan as itself (no identity impersonation, no
 * policy/human-confirm bypass, no source-allowlist expansion, no new scheduler).
 * Multiple intended candidates → blocked (never pick first). Empty intended →
 * blocked (no single legal target). Activate success stays dispatched:false.
 */
import type { OpenBotConfig } from "../../config/types.js";
import {
  isIntendedClaimantId,
  type GroupBoardClaimItem,
} from "../collaboration-dispatch/claim-contract.js";
import type { RuntimeAuthority } from "../collaboration-dispatch/runtime-authority.js";
import { recordHandoffWake, recordNudgeWake } from "../collaboration-dispatch/wake-contract.js";
import {
  consumeWakeForRoundDispatch,
  getWakeRoundDispatcher,
  type WakeRoundDispatcher,
} from "../collaboration-dispatch/wake-round-dispatch.js";
import {
  claimCollaborationBoardItem,
  ClaimContractEntryError,
  ClaimContractFlagOffError,
} from "./claim-contract-entry.js";
import type { TeamResourceAuthOk, TrustedGroupStores } from "./team-resource-auth.js";
import type { CollaborationTenantResolution } from "./trusted-tenant.js";

export const POST_PUBLISH_CLAIM_ENTRY = "claimCollaborationBoardItem" as const;

/** Stable U3 op key so retries / concurrent publish do not double-wake. */
export function buildPostPublishHandoffOpKey(params: {
  groupId: string;
  taskId: string;
  itemId: string;
  intendedClaimantId: string;
}): string {
  return [
    "post_publish_intended_claim_handoff",
    params.groupId.trim(),
    params.taskId.trim(),
    params.itemId.trim(),
    params.intendedClaimantId.trim(),
  ].join("|");
}

export function buildPostPublishHandoffDispatchPrompt(params: {
  taskId: string;
  itemId: string;
  intendedClaimantId: string;
  reason: string;
}): string {
  return [
    "【建板后受控接力】来源=nudge（handoff 审计已另行记账；不扩 source 清单）",
    `task=${params.taskId}`,
    `board=${params.itemId}`,
    `intended=${params.intendedClaimantId}`,
    "你是唯一合法 intended claimant。请以本人身份通过工具自行：claim_item → apply_claim → propose_todolist。",
    "禁止由他人代认领或冒充执行者；计划确认仍按策略执行（人闸不得绕过）。",
    params.reason,
  ].join("\n");
}

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
      wakeDispatched: false;
    }
  | {
      outcome: "scheduled";
      item: GroupBoardClaimItem;
      claimantId: null;
      nextEntryPoint: typeof POST_PUBLISH_CLAIM_ENTRY;
      reason: string;
      scheduledClaimantId: string;
      /** Handoff audit and/or consumable nudge wake row written. */
      wakeRecorded: boolean;
      /**
       * True only when consumeWakeForRoundDispatch accepted a dispatcher round
       * (or durable idempotent_reuse). Activate.dispatched stays false.
       */
      wakeDispatched: boolean;
    }
  | {
      outcome: "blocked";
      item: GroupBoardClaimItem;
      claimantId: null;
      nextEntryPoint: typeof POST_PUBLISH_CLAIM_ENTRY;
      reason: string;
      scheduledClaimantId: null;
      wakeRecorded: false;
      wakeDispatched: false;
    }
  | {
      outcome: "unchanged";
      item: GroupBoardClaimItem;
      claimantId: string | null;
      nextEntryPoint: typeof POST_PUBLISH_CLAIM_ENTRY | null;
      reason: string;
      scheduledClaimantId: null;
      wakeRecorded: false;
      wakeDispatched: false;
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
    wakeDispatched: false,
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
    wakeDispatched: false,
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
 * claimant. Otherwise schedule a controlled handoff (audit) + consumable nudge
 * wake for that intended bot (or block with a clear reason). Never auto-claims
 * for the publisher; never expands WAKE_ROUND_DISPATCH_SOURCES.
 */
export async function tryClaimAfterBoardPublish(params: {
  groupId: string;
  taskId: string;
  item: GroupBoardClaimItem;
  /** Present actor at the publish site. May claim only when they are the single intended. */
  actorId: string | null | undefined;
  /** Required to record Wake Contract events for an absent intended claimant. */
  authority?: RuntimeAuthority | null;
  auth?: TeamResourceAuthOk | null;
  trusted?: { groupsRoot: string; groupLocator: string } | null;
  stores?: TrustedGroupStores | null;
  tenant?: CollaborationTenantResolution | null;
  cfg?: OpenBotConfig;
  /**
   * Override process registry for consumeWake (tests). undefined → getWakeRoundDispatcher();
   * null → force recorded-not-dispatched (dispatcher unavailable).
   */
  roundDispatcher?: WakeRoundDispatcher | null;
  nowMs?: number;
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
        wakeDispatched: false,
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
  // as them. Keep handoff audit + reuse consumable nudge→consumeWake path.
  const authority = params.authority ?? null;
  if (!authority) {
    return blocked(
      item,
      `awaiting_intended_claimant:actor=${actorId || "none"}:intended=${intendedClaimantId}:wake_authority_required`,
    );
  }

  const fromAgentId = actorId || compact(item.publishedBy) || "system:board_publish";
  const handoffReason = `post_publish_intended_claim_handoff:intended=${intendedClaimantId}:item=${itemId}`;

  const handoff = await recordHandoffWake(
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
  if (!handoff.ok) {
    return blocked(
      item,
      `awaiting_intended_claimant:actor=${actorId || "none"}:intended=${intendedClaimantId}:handoff_audit_failed:${handoff.reason}`,
    );
  }

  // Consumable path: source=nudge is already accepted by consumeWakeForRoundDispatch.
  // Do NOT expand WAKE_ROUND_DISPATCH_SOURCES; do not impersonate the executor.
  const nudge = await recordNudgeWake(
    authority,
    {
      groupId: params.groupId,
      fromAgentId,
      toAgentIds: [intendedClaimantId],
      taskId: params.taskId,
      itemId,
      reason: handoffReason,
    },
    { cfg: params.cfg },
  );
  if (!nudge.ok) {
    return {
      outcome: "scheduled",
      item,
      claimantId: null,
      nextEntryPoint: POST_PUBLISH_CLAIM_ENTRY,
      reason: `scheduled_intended_claimant:intended=${intendedClaimantId}:recorded_not_dispatched:nudge_failed:${nudge.reason ?? "unknown"}`,
      scheduledClaimantId: intendedClaimantId,
      wakeRecorded: true,
      wakeDispatched: false,
    };
  }

  const roundDispatcher =
    params.roundDispatcher !== undefined ? params.roundDispatcher : getWakeRoundDispatcher();
  const opKey = buildPostPublishHandoffOpKey({
    groupId: params.groupId,
    taskId: params.taskId,
    itemId,
    intendedClaimantId,
  });
  const dispatchPrompt = buildPostPublishHandoffDispatchPrompt({
    taskId: params.taskId,
    itemId,
    intendedClaimantId,
    reason: handoffReason,
  });

  const consume = await consumeWakeForRoundDispatch({
    authority,
    cfg: params.cfg,
    roundDispatcher,
    nowMs: params.nowMs,
    request: {
      groupId: params.groupId,
      tenantId: params.tenant?.tenantId ?? params.auth?.tenantId ?? null,
      fromAgentId,
      toAgentIds: [intendedClaimantId],
      source: "nudge",
      taskId: params.taskId,
      itemId,
      reason: handoffReason,
      opKey,
      dispatchPrompt,
    },
  });

  // Durable wake receipt is `dispatched:true`. When the woken executor's own
  // claim/apply bumps task controlEpoch (or auth fingerprint) before receipt,
  // consume reports `external_sent_*` with dispatched:false — the Mode B round
  // still ran. Count that as wakeDispatched so handoff proof is not a false
  // negative of the executor's legitimate writes.
  const consumeReason = compact(consume.reason);
  const externalSent =
    !consume.dispatched &&
    (consumeReason.startsWith("external_sent_") ||
      consume.sideEffectClass === "completed_with_receipt" ||
      consume.sideEffectClass === "started_or_unknown");
  const wakeDispatched = Boolean(consume.dispatched) || externalSent;
  const consumeDetail = consumeReason || (wakeDispatched ? "dispatched" : "wake_recorded");
  return {
    outcome: "scheduled",
    item,
    claimantId: null,
    nextEntryPoint: POST_PUBLISH_CLAIM_ENTRY,
    reason: wakeDispatched
      ? `scheduled_intended_claimant:intended=${intendedClaimantId}:wake_dispatched:${consumeDetail}`
      : `scheduled_intended_claimant:intended=${intendedClaimantId}:recorded_not_dispatched:${consumeDetail}`,
    scheduledClaimantId: intendedClaimantId,
    wakeRecorded: true,
    wakeDispatched,
  };
}
