/**
 * Platform Mode B — continue / re-wake after ROUND_COMPLETE (inventory-first).
 *
 * Problem (universal): when L2 humanStartsNewRound=true, proactiveBots=false;
 * a single ROUND_COMPLETE leaves the group silent until a human @mentions again,
 * even if published|claimed|applied|in_progress board work remains.
 *
 * Fix (group-agnostic): optional hook after ROUND_COMPLETE that:
 *   1. Scans board inventory (no Floor live / no second orchestrator)
 *   2. If active items exist → wake Mode B lead (wake contract) + trySelfAdvance tick
 *   3. If none → ledger-only note (needs publish / human confirm) — no auto-materialize
 *
 * Default OFF. Gray enable via continueAfterRoundComplete.groupAllowlist
 * (prefer tenantId/groupId). Global enabled=true is discouraged.
 * Does not flip claim/wake/challenge/LIVE/Floor defaults.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import { boardClaimsDir, type GroupBoardClaimItem } from "./claim-contract.js";
import { matchGrayGroupAllowlist } from "./gray-group-allowlist.js";
import { loadBoardClaimItemsFromDir } from "./member-progress-export.js";
import { selectModeBLead } from "./mode-b-member-selection.js";
import { appendJsonlDurable } from "./round-store-io.js";
import type { RuntimeAuthority } from "./runtime-authority.js";
import {
  isModeBInventoryActiveBoardItem,
  rankModeBInventoryActiveBoardItems,
  resolveSelfAdvanceWriteMode,
  tryClaimPublishedInventoryLead,
  trySelfAdvance,
  type SelfAdvanceResult,
} from "./self-advance.js";
import { isCollabTaskWakeContractEnabled, type WakeEvent } from "./wake-contract.js";
import { consumeWakeForRoundDispatch } from "./wake-round-dispatch.js";

export type ContinueAfterRoundDecision = Readonly<{
  at: number;
  groupId: string;
  tenantId: string | null;
  roundId: string;
  enabled: boolean;
  reason: string;
  activeBoardCount: number;
  primaryBoardItemId: string | null;
  leadAgentId: string | null;
  wakeRecorded: boolean;
  selfAdvanceTriggered: boolean;
  selfAdvanceReason?: string;
  /** True when continue claimed an unclaimed published inventory primary. */
  claimRecorded?: boolean;
  claimedByAgentId?: string | null;
}>;

function compact(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

export function resolveContinueAfterRoundGroupAllowlist(cfg?: OpenBotConfig): string[] {
  const raw = cfg?.collaboration?.task?.continueAfterRoundComplete?.groupAllowlist;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.map((e) => String(e).trim()).filter(Boolean);
}

/**
 * Default false. Prefer scoped groupAllowlist over global enabled=true.
 */
export function isContinueAfterRoundCompleteEnabled(
  cfg: OpenBotConfig | undefined,
  groupId: string,
  tenantId?: string | null,
): boolean {
  try {
    const resolved = cfg ?? loadConfig();
    const block = resolved.collaboration?.task?.continueAfterRoundComplete;
    if (block?.enabled === true) {
      return true;
    }
    const gid = groupId.trim();
    if (!gid) {
      return false;
    }
    return matchGrayGroupAllowlist({
      groupId: gid,
      tenantId,
      entries: resolveContinueAfterRoundGroupAllowlist(resolved),
    });
  } catch {
    return false;
  }
}

function continueDecisionsDir(authority: RuntimeAuthority): string {
  return path.join(authority.namespace.root, "continue-after-round");
}

function continueCooldownPath(authority: RuntimeAuthority): string {
  return path.join(continueDecisionsDir(authority), "last-continue.json");
}

/** Default 120s cooldown per group to avoid ROUND_COMPLETE → wake → … loops. */
export const CONTINUE_AFTER_ROUND_COOLDOWN_MS = 120_000;

async function readCooldownAt(authority: RuntimeAuthority): Promise<number> {
  try {
    const raw = await fs.readFile(continueCooldownPath(authority), "utf8");
    const parsed = JSON.parse(raw) as { at?: number };
    return typeof parsed.at === "number" ? parsed.at : 0;
  } catch {
    return 0;
  }
}

async function writeCooldownAt(authority: RuntimeAuthority, at: number): Promise<void> {
  const dir = continueDecisionsDir(authority);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    continueCooldownPath(authority),
    `${JSON.stringify({ at }, null, 2)}\n`,
    "utf8",
  );
}

async function appendContinueDecision(
  authority: RuntimeAuthority,
  decision: ContinueAfterRoundDecision,
): Promise<void> {
  const dir = continueDecisionsDir(authority);
  await fs.mkdir(dir, { recursive: true });
  await appendJsonlDurable(path.join(dir, "decisions.jsonl"), `${JSON.stringify(decision)}\n`);
}

export type ContinueAfterRoundPlan = Readonly<{
  enabled: boolean;
  reason: string;
  activeItems: readonly GroupBoardClaimItem[];
  primary: GroupBoardClaimItem | null;
  leadAgentId: string | null;
}>;

/** Pure inventory plan — no I/O side effects. */
export function planContinueAfterRound(params: {
  enabled: boolean;
  boardItems: readonly GroupBoardClaimItem[];
}): ContinueAfterRoundPlan {
  if (!params.enabled) {
    return {
      enabled: false,
      reason: "continue_after_round_disabled",
      activeItems: [],
      primary: null,
      leadAgentId: null,
    };
  }
  const activeItems = rankModeBInventoryActiveBoardItems(params.boardItems);
  if (activeItems.length === 0) {
    return {
      enabled: true,
      reason: "no_active_board_inventory",
      activeItems: [],
      primary: null,
      leadAgentId: null,
    };
  }
  const primary = activeItems[0] ?? null;
  const lead = selectModeBLead({
    boardItems: activeItems,
    hasBroadcastMention: false,
  });
  return {
    enabled: true,
    reason: "active_board_inventory",
    activeItems,
    primary,
    leadAgentId: lead.leadAgentId,
  };
}

export type MaybeContinueAfterRoundResult = Readonly<{
  skipped: boolean;
  decision: ContinueAfterRoundDecision;
  wakeEvent?: WakeEvent;
  selfAdvance?: SelfAdvanceResult;
}>;

/**
 * Best-effort hook for ROUND_COMPLETE. Never throws into round hot path.
 * Inventory-first; no Floor live; no auto-publish of board drafts.
 */
export async function maybeContinueAfterRoundComplete(params: {
  authority: RuntimeAuthority;
  roundId: string;
  roundState: string;
  cfg?: OpenBotConfig;
  nowMs?: number;
  /** Injected for tests. */
  loadBoardItems?: () => Promise<readonly GroupBoardClaimItem[]>;
  skipSelfAdvance?: boolean;
  skipWake?: boolean;
  /**
   * After formal DELIVERABLE settle (ok or binding miss): keep multi-milestone
   * auto-dispatch alive even when continueAfterRoundComplete is default OFF.
   * Cooldown still applies. Chat task_board_continue skips group sessions.
   */
  forceForDeliverableSettlement?: boolean;
}): Promise<MaybeContinueAfterRoundResult> {
  const at = params.nowMs ?? Date.now();
  const authority = params.authority;
  const cfg = params.cfg ?? loadConfig();
  const baseDecision = (over: Partial<ContinueAfterRoundDecision>): ContinueAfterRoundDecision => ({
    at,
    groupId: authority.groupId,
    tenantId: authority.tenantId,
    roundId: params.roundId,
    enabled: false,
    reason: "not_evaluated",
    activeBoardCount: 0,
    primaryBoardItemId: null,
    leadAgentId: null,
    wakeRecorded: false,
    selfAdvanceTriggered: false,
    ...over,
  });

  try {
    if (params.roundState !== "ROUND_COMPLETE") {
      const decision = baseDecision({ reason: `round_state_${params.roundState}` });
      return { skipped: true, decision };
    }

    const enabled =
      params.forceForDeliverableSettlement === true ||
      isContinueAfterRoundCompleteEnabled(cfg, authority.groupId, authority.tenantId);
    if (!enabled) {
      const decision = baseDecision({ reason: "continue_after_round_disabled" });
      return { skipped: true, decision };
    }

    const lastAt = await readCooldownAt(authority);
    if (lastAt > 0 && at - lastAt < CONTINUE_AFTER_ROUND_COOLDOWN_MS) {
      const decision = baseDecision({
        enabled: true,
        reason: "cooldown_active",
      });
      await appendContinueDecision(authority, decision);
      return { skipped: true, decision };
    }

    const loaded =
      (await params.loadBoardItems?.()) ??
      ((await loadBoardClaimItemsFromDir(boardClaimsDir(authority))) as GroupBoardClaimItem[]);

    let workingItems: GroupBoardClaimItem[] = [...loaded];
    let plan = planContinueAfterRound({
      enabled: true,
      boardItems: workingItems,
    });

    if (plan.reason === "no_active_board_inventory") {
      const decision = baseDecision({
        enabled: true,
        reason: "no_active_board_inventory",
      });
      await appendContinueDecision(authority, decision);
      await writeCooldownAt(authority, at);
      return { skipped: false, decision };
    }

    let claimRecorded = false;
    let claimedByAgentId: string | null = null;
    // Claim-first for unclaimed published inventory (Mode B self-run).
    if (plan.primary && compact(plan.primary.status) === "published") {
      const claimAttempt = await tryClaimPublishedInventoryLead(authority, {
        boardItems: workingItems,
        cfg,
        nowMs: at,
      });
      if (claimAttempt.claimed) {
        claimRecorded = true;
        claimedByAgentId = claimAttempt.leadAgentId;
        workingItems = [...claimAttempt.boardItems];
        plan = planContinueAfterRound({
          enabled: true,
          boardItems: workingItems,
        });
      }
    }

    let wakeEvent: WakeEvent | undefined;
    let wakeRecorded = false;
    const leadAgentId = compact(plan.leadAgentId) || compact(claimedByAgentId);
    const wakeEnabled =
      !params.skipWake &&
      isCollabTaskWakeContractEnabled(cfg, authority.groupId, authority.tenantId);

    if (wakeEnabled && leadAgentId && plan.primary) {
      const selfAdvanceWriteMode = resolveSelfAdvanceWriteMode(
        cfg,
        authority.groupId,
        authority.tenantId,
      );
      const consume = await consumeWakeForRoundDispatch({
        authority,
        cfg,
        writeMode: selfAdvanceWriteMode,
        nowMs: at,
        request: {
          groupId: authority.groupId,
          tenantId: authority.tenantId,
          fromAgentId: "system:continue_after_round",
          toAgentIds: [leadAgentId],
          source: "nudge",
          taskId: plan.primary.taskId,
          itemId: plan.primary.itemId,
          reason: claimRecorded
            ? `continue_after_round:claimed_published:${plan.primary.itemId}`
            : `continue_after_round:active_board:${plan.primary.itemId}`,
        },
      });
      if (consume.wakeEvent) {
        wakeEvent = consume.wakeEvent;
        wakeRecorded = true;
      }
    }

    let selfAdvance: SelfAdvanceResult | undefined;
    let selfAdvanceTriggered = false;
    let selfAdvanceReason: string | undefined;
    if (!params.skipSelfAdvance) {
      selfAdvance = await trySelfAdvance(authority, {
        actorId: "system:continue_after_round",
        cfg,
        nowMs: at,
        triggerSource: "round:ROUND_COMPLETED",
        fromAgentId: "system:continue_after_round",
        boardItems: plan.activeItems.length > 0 ? plan.activeItems : workingItems,
      });
      selfAdvanceTriggered = true;
      if (!selfAdvance.ok) {
        selfAdvanceReason = selfAdvance.reason;
      } else if (selfAdvance.advanced) {
        selfAdvanceReason = `advanced:${selfAdvance.execMode}`;
      } else {
        selfAdvanceReason = selfAdvance.reason;
      }
    }

    const decision = baseDecision({
      enabled: true,
      reason: plan.reason,
      activeBoardCount: plan.activeItems.length,
      primaryBoardItemId: plan.primary?.itemId ?? null,
      leadAgentId: leadAgentId || null,
      wakeRecorded,
      selfAdvanceTriggered,
      selfAdvanceReason,
      claimRecorded,
      claimedByAgentId,
    });
    await appendContinueDecision(authority, decision);
    await writeCooldownAt(authority, at);
    return { skipped: false, decision, wakeEvent, selfAdvance };
  } catch {
    const decision = baseDecision({ reason: "continue_after_round_error" });
    return { skipped: true, decision };
  }
}

/** Test helper: inventory active-set predicate (includes published). */
export function continueAfterRoundUsesActiveBoardFilter(
  item: Pick<GroupBoardClaimItem, "status">,
): boolean {
  return isModeBInventoryActiveBoardItem(item);
}
