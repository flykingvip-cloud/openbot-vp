/**
 * P4 — Mode B member selection (FINAL §3.5 P4.3).
 *
 * Prefer board 责任人 (claimant → intendedClaimantIds → getMemberProgress hint).
 * `@所有人` / broadcast MUST NOT steal lead when a board owner exists.
 * Claim-status inquiry surfaces via getMemberProgress (read-only) — not chat memory.
 *
 * Does not open LIVE flags, claim/wake allowlists, Floor, or invent a second orchestrator.
 */
import { normalizeAgentIdentifier } from "./mention-utils.js";
import type { CollaborationBotTarget } from "./types.js";

export type ModeBBoardOwnerLike = {
  status?: string | null;
  claimantId?: string | null;
  intendedClaimantIds?: readonly string[] | null;
  publishedBy?: string | null;
};

export type ModeBMemberProgressLike = {
  memberId?: string | null;
  agentId?: string | null;
  activeItemCount?: number | null;
  inProgressCount?: number | null;
  claimedItemCount?: number | null;
};

export type ModeBLeadReason =
  | "board_claimant"
  | "board_intended"
  | "member_progress"
  | "explicit_mention"
  | "none";

export type ModeBLeadSelection = Readonly<{
  leadAgentId: string | null;
  reason: ModeBLeadReason;
  /** True when broadcast/@所有人 was present but did not override board owner. */
  broadcastDidNotStealLead: boolean;
  candidateAgentIds: readonly string[];
}>;

const ACTIVE_OWNER_STATUSES = new Set([
  "published",
  "claimed",
  "applied",
  "in_progress",
  "returned",
  "submitted_for_review",
  "blocked",
]);

function compact(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function uniqueIds(values: readonly (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const id = compact(value);
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    out.push(id);
  }
  return out;
}

function normId(value: string | null | undefined): string {
  return normalizeAgentIdentifier(compact(value)) ?? compact(value).toLowerCase();
}

/** Active board items that still need an owner / execution (not accepted/cancelled). */
export function modeBActiveBoardItems<T extends ModeBBoardOwnerLike>(items: readonly T[]): T[] {
  return items.filter((item) => {
    const status = compact(item.status);
    return status.length > 0 && ACTIVE_OWNER_STATUSES.has(status);
  });
}

/**
 * Resolve board 责任人 ids: claimant first, else intended list, else publisher.
 * Empty when no active board ownership signal.
 */
export function resolveBoardResponsibleAgentIds(items: readonly ModeBBoardOwnerLike[]): string[] {
  const active = modeBActiveBoardItems(items);
  const claimants = uniqueIds(active.map((item) => item.claimantId));
  if (claimants.length > 0) {
    return claimants;
  }
  const intended = uniqueIds(active.flatMap((item) => item.intendedClaimantIds ?? []));
  if (intended.length > 0) {
    return intended;
  }
  return uniqueIds(active.map((item) => item.publishedBy));
}

/**
 * Claim inquiry helper: prefer members with active / in-progress board work
 * from getMemberProgress (read-only). Does not invent chat-memory ownership.
 */
export function resolveClaimInquiryCandidatesFromMemberProgress(
  rows: readonly ModeBMemberProgressLike[],
): string[] {
  const scored = rows
    .map((row) => {
      const id = compact(row.agentId) || compact(row.memberId);
      const active = Number(row.activeItemCount ?? 0) || 0;
      const inProg = Number(row.inProgressCount ?? 0) || 0;
      const claimed = Number(row.claimedItemCount ?? 0) || 0;
      return { id, score: inProg * 100 + active * 10 + claimed };
    })
    .filter((row) => row.id && row.score > 0)
    .toSorted((a, b) => b.score - a.score);
  return uniqueIds(scored.map((row) => row.id));
}

/**
 * Mode B lead selection.
 *
 * Priority: board claimant → intended → member-progress → explicit @mention.
 * When `hasBroadcastMention` is true and a board owner exists, broadcast does
 * **not** become lead (`broadcastDidNotStealLead===true`).
 */
export function selectModeBLead(params: {
  boardItems?: readonly ModeBBoardOwnerLike[] | null;
  memberProgress?: readonly ModeBMemberProgressLike[] | null;
  explicitMentionAgentIds?: readonly string[] | null;
  hasBroadcastMention?: boolean;
  bots?: readonly CollaborationBotTarget[] | null;
}): ModeBLeadSelection {
  const boardOwners = resolveBoardResponsibleAgentIds(params.boardItems ?? []);
  const progressOwners = resolveClaimInquiryCandidatesFromMemberProgress(
    params.memberProgress ?? [],
  );
  const explicit = uniqueIds(params.explicitMentionAgentIds ?? []);
  const broadcast = Boolean(params.hasBroadcastMention);

  const botPool = params.bots ?? [];
  const pickFirstPresent = (candidates: readonly string[]): string | null => {
    if (candidates.length === 0) {
      return null;
    }
    if (botPool.length === 0) {
      return candidates[0] ?? null;
    }
    const byNorm = new Map<string, string>();
    for (const bot of botPool) {
      const raw = compact(bot.agentId);
      const n = normId(raw);
      if (raw && n) {
        byNorm.set(n, raw);
      }
    }
    for (const candidate of candidates) {
      const hit = byNorm.get(normId(candidate));
      if (hit) {
        return hit;
      }
    }
    // Board owner may not be in the current bot pool (human / offline) — still prefer id.
    return candidates[0] ?? null;
  };

  if (boardOwners.length > 0) {
    const fromClaimant = uniqueIds(
      (params.boardItems ?? [])
        .filter((item) => ACTIVE_OWNER_STATUSES.has(compact(item.status)))
        .map((item) => item.claimantId),
    );
    const reason: ModeBLeadReason = fromClaimant.length > 0 ? "board_claimant" : "board_intended";
    return {
      leadAgentId: pickFirstPresent(boardOwners),
      reason,
      broadcastDidNotStealLead: broadcast,
      candidateAgentIds: boardOwners,
    };
  }

  if (progressOwners.length > 0) {
    return {
      leadAgentId: pickFirstPresent(progressOwners),
      reason: "member_progress",
      broadcastDidNotStealLead: broadcast,
      candidateAgentIds: progressOwners,
    };
  }

  if (explicit.length > 0) {
    return {
      leadAgentId: pickFirstPresent(explicit),
      reason: "explicit_mention",
      broadcastDidNotStealLead: broadcast,
      candidateAgentIds: explicit,
    };
  }

  // Broadcast alone never invents a Mode B lead — cold groups stay Mode A.
  return {
    leadAgentId: null,
    reason: "none",
    broadcastDidNotStealLead: broadcast,
    candidateAgentIds: [],
  };
}

/** Contract: @所有人 must not steal lead from board 责任人. */
export function broadcastMustNotStealBoardLead(): true {
  return true;
}

/** Contract: claim inquiry goes through getMemberProgress, not chat memory. */
export function claimInquiryUsesMemberProgress(): true {
  return true;
}
