/**
 * P4 / FINAL v3 S2 + S5 — Limited self_advance production caller.
 *
 * Wires Governance Gate action `self_advance` onto a real non-zero call path.
 * Conditions (ALL required for any advance tick):
 *   1. group L2 `botMaySelfAdvanceWithoutHuman=true` (platform L1 default still false)
 *   2. exists applied|in_progress board item not yet accepted
 *   3. mission not onboarding
 *   4. Governance Gate allows `self_advance`
 *   5. outbound/final still `human_required`
 *
 * S2 delivery-type gate (expert):
 *   - applied without confirmed Todolist → **plan_nudge only** (remind / ask to complete plan);
 *     never start delivery exec / never treat as delivery opportunity bypassing markInProgress
 *   - delivery_exec requires: confirmed Todolist + valid claimant + non-terminal board +
 *     complete 三件套 (board summary + group context pointer + confirmed current step)
 *
 * S5 authorization boundary (expert):
 *   - Default write mode **dry_run**: per-tick reauth + decision ledger only; no wake/side effects
 *   - Real execute requires mode=execute AND executeGroupAllowlist match (gray explicit)
 *   - Every tick re-checks policy + task state (no long-lived cached auth)
 *   - Cancel / block / return / claimant change invalidates prior pending fingerprint
 *   - Ledger records taskId, boardItemId, claimant, policy judgment, trigger source, result
 *   - self_advance ≠ auto-complete: never submit/accept/finalize; only nudge or wake for next step
 *
 * Active-set ranking: in_progress before applied; then newest activity (stale smoke cannot pin lead).
 * On delivery_exec allow (execute mode): Mode B lead + wake (`source=self_advance`) +
 *   P0-2 wake→round consumer (dispatched when wake+selfAdvance execute + dispatcher bound;
 *   otherwise recorded). Reuses executeCollaborationRound — no second orchestrator.
 * On plan_nudge: optional wake asking to complete plan; does NOT count as delivery advanced
 *   and does NOT open an execution round.
 * Does NOT finalize / outbound / flip LIVE / gray-open claim|wake allowlists /
 * invent a second orchestrator. Platform default stays false.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import { isOnboardingIntroductionMission } from "../collaboration-learning/mission-phase.js";
import { boardClaimsDir, claimBoardItem, type GroupBoardClaimItem } from "./claim-contract.js";
import type { EffectiveCollaborationPolicy } from "./effective-policy.js";
import type { ExecutionTaskBag } from "./executor-private-todolist.js";
import {
  classifyGovernanceActor,
  evaluateGovernanceGate,
  type GovernanceActor,
  type GovernanceMemberRoleLike,
} from "./governance-gate.js";
import { matchGrayGroupAllowlist } from "./gray-group-allowlist.js";
import { loadBoardClaimItemsFromDir } from "./member-progress-export.js";
import {
  selectModeBLead,
  type ModeBLeadSelection,
  type ModeBMemberProgressLike,
} from "./mode-b-member-selection.js";
import {
  evaluateDeliveryExecGateForBoardItem,
  type DeliveryExecGate,
  type DeliveryExecMode,
} from "./plan-gate-exec.js";
import { appendJsonlDurable } from "./round-store-io.js";
import type { RuntimeAuthority } from "./runtime-authority.js";
import { assertCollaborationRuntimeWritable } from "./runtime-namespace.js";
import type { CollaborationBotTarget } from "./types.js";
import {
  isCollabTaskWakeContractEnabled,
  recordWakeEvent,
  type WakeEvent,
} from "./wake-contract.js";
import { consumeWakeForRoundDispatch, type WakeRoundDispatcher } from "./wake-round-dispatch.js";

/** Statuses that satisfy §1.5 delivery self-advance "applied|in_progress … 未过验收". */
export const SELF_ADVANCE_ACTIVE_BOARD_STATUSES = ["applied", "in_progress"] as const;

/**
 * Mode B / continue-after-round inventory: truly active board work still needing
 * attention. Includes unclaimed `published` so ROUND_COMPLETE continue does not
 * report no_active_board_inventory. Terminal / parked states stay excluded.
 * Delivery eligibility remains SELF_ADVANCE_ACTIVE_BOARD_STATUSES only.
 */
export const MODE_B_INVENTORY_ACTIVE_BOARD_STATUSES = [
  "published",
  "claimed",
  "applied",
  "in_progress",
  "returned",
] as const;

/** Statuses that must invalidate any prior pending self-advance fingerprint. */
export const SELF_ADVANCE_INVALIDATING_BOARD_STATUSES = [
  "cancelled",
  "blocked",
  "returned",
  "accepted",
  "submitted_for_review",
] as const;

export type SelfAdvanceWriteMode = "dry_run" | "execute";

export type SelfAdvanceConditionKey =
  | "l2_bot_may_self_advance"
  | "active_unaccepted_board"
  | "mission_not_onboarding"
  | "governance_gate_allows"
  | "outbound_final_human_required";

export type SelfAdvanceCondition = Readonly<{
  key: SelfAdvanceConditionKey;
  ok: boolean;
  detail: string;
}>;

export type SelfAdvanceEligibility = Readonly<{
  allowed: boolean;
  reason: string;
  message: string;
  conditions: readonly SelfAdvanceCondition[];
  activeBoardItems: readonly GroupBoardClaimItem[];
}>;

export type SelfAdvanceBoardFingerprint = Readonly<{
  taskId: string;
  boardItemId: string;
  status: string;
  claimantId: string;
}>;

export type SelfAdvanceDecisionRecord = Readonly<{
  at: number;
  tickId: string;
  groupId: string;
  tenantId: string | null;
  taskId: string | null;
  boardItemId: string | null;
  claimantId: string | null;
  triggerSource: string;
  writeMode: SelfAdvanceWriteMode;
  policyJudgment: {
    allowed: boolean;
    reason: string;
    l2BotMaySelfAdvance: boolean;
    conditionKeysOk: readonly SelfAdvanceConditionKey[];
  };
  execMode: DeliveryExecMode;
  advanced: boolean;
  /** True only when writeMode=execute and side effects (wake) were attempted. */
  executed: boolean;
  result: string;
  fingerprint: string | null;
  invalidatedPrior: boolean;
  invalidationReason: string | null;
}>;

export type SelfAdvanceOptions = {
  cfg?: OpenBotConfig;
  nowMs?: number;
  /** Bot (or human) requesting the self-advance tick. */
  actorId: string;
  memberRoleMap?: readonly GovernanceMemberRoleLike[] | null;
  /** Optional preloaded board items (tests). */
  boardItems?: readonly GroupBoardClaimItem[] | null;
  /** Optional mission override (else authority.facts). */
  currentMission?: string | null;
  /** Optional Mode B bot pool for lead resolve. */
  bots?: readonly CollaborationBotTarget[] | null;
  /** Optional getMemberProgress rows for claim inquiry fallback. */
  memberProgress?: readonly ModeBMemberProgressLike[] | null;
  /**
   * When true, force dry-run (ledger only). When false/omitted, effective mode
   * still follows resolveSelfAdvanceWriteMode (default dry_run).
   */
  dryRun?: boolean;
  /** Actor recorded as fromAgentId (default system:self_advance). */
  fromAgentId?: string;
  /**
   * S2: when true (default), evaluate delivery plan gate + 三件套 on the primary
   * active board item. Tests that only assert §1.5 L2/onboarding may pass
   * `enforcePlanGate: false` — production callers keep the default.
   */
  enforcePlanGate?: boolean;
  /**
   * S5: auditable trigger source (e.g. rpc:trySelfAdvance, scheduler:tick).
   * Recorded on every decision ledger line.
   */
  triggerSource?: string;
  /** S5: optional skip ledger write (unit tests of pure eligibility). */
  skipDecisionLedger?: boolean;
  /**
   * P0-2: optional Mode B round dispatcher for wake→真回合. When omitted, uses
   * process registry (setWakeRoundDispatcher). Pass null to force 无消费 → recorded.
   */
  roundDispatcher?: WakeRoundDispatcher | null;
  /** P0-2: skip round dispatch even when execute+allowlist (tests / ops). */
  skipRoundDispatch?: boolean;
};

export type SelfAdvanceResult =
  | {
      ok: true;
      advanced: true;
      /** S2: delivery_exec vs plan_nudge (nudge never bypasses markInProgress). */
      execMode: DeliveryExecMode;
      eligibility: SelfAdvanceEligibility;
      lead: ModeBLeadSelection;
      deliveryGate?: DeliveryExecGate;
      taskBag?: ExecutionTaskBag | null;
      wakeEvent?: WakeEvent;
      writeMode: SelfAdvanceWriteMode;
      executed: boolean;
      decision?: SelfAdvanceDecisionRecord;
      fingerprint?: string;
      invalidatedPrior?: boolean;
      /** P0-2: wake ledger outcome was dispatched (Mode B round opened). */
      roundDispatched?: boolean;
      roundId?: string;
    }
  | {
      ok: true;
      advanced: false;
      execMode: DeliveryExecMode;
      eligibility: SelfAdvanceEligibility;
      lead: ModeBLeadSelection | null;
      deliveryGate?: DeliveryExecGate;
      taskBag?: ExecutionTaskBag | null;
      reason: string;
      message: string;
      wakeEvent?: WakeEvent;
      writeMode: SelfAdvanceWriteMode;
      executed: boolean;
      decision?: SelfAdvanceDecisionRecord;
      fingerprint?: string;
      invalidatedPrior?: boolean;
    }
  | {
      ok: false;
      reason: string;
      message: string;
    };

function compact(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function nowOf(options?: SelfAdvanceOptions): number {
  return typeof options?.nowMs === "number" && Number.isFinite(options.nowMs)
    ? Math.floor(options.nowMs)
    : Date.now();
}

/** Platform / L1 default must stay false — compile-time contract for docs/tests. */
export function platformDefaultBotMaySelfAdvanceWithoutHuman(): false {
  return false;
}

/** self_advance never substitutes finalize / outbound authority. */
export function selfAdvanceDoesNotBypassHumanRequiredOutbound(): true {
  return true;
}

/** S2: self_advance must not bypass plan gate / markInProgress for delivery. */
export function selfAdvanceDeliveryRequiresConfirmedPlan(): true {
  return true;
}

/** S5: self_advance never auto-completes / submits / accepts a task. */
export function selfAdvanceDoesNotAutoCompleteTask(): true {
  return true;
}

/** S5: every tick must re-check policy + board (no cached long-lived auth). */
export function selfAdvanceRequiresPerTickReauth(): true {
  return true;
}

/** S5 platform write-mode default is dry_run (not execute). */
export function platformDefaultSelfAdvanceWriteMode(): "dry_run" {
  return "dry_run";
}

export function isSelfAdvanceActiveBoardItem(item: Pick<GroupBoardClaimItem, "status">): boolean {
  const status = compact(item.status);
  return (SELF_ADVANCE_ACTIVE_BOARD_STATUSES as readonly string[]).includes(status);
}

/** Continue / Mode B inventory predicate (includes unclaimed published). */
export function isModeBInventoryActiveBoardItem(
  item: Pick<GroupBoardClaimItem, "status">,
): boolean {
  const status = compact(item.status);
  return (MODE_B_INVENTORY_ACTIVE_BOARD_STATUSES as readonly string[]).includes(status);
}

function inventoryStatusRank(status: string): number {
  switch (compact(status)) {
    case "in_progress":
      return 0;
    case "returned":
      return 1;
    case "applied":
      return 2;
    case "claimed":
      return 3;
    case "published":
      return 4;
    default:
      return 9;
  }
}

/**
 * Rank Mode B inventory for continue-after-round / claim-first.
 * Prefer in_progress → returned → applied → claimed → published; then newest activity.
 * Excludes accepted|cancelled|blocked|submitted_for_review (and unknown).
 */
export function rankModeBInventoryActiveBoardItems(
  items: readonly GroupBoardClaimItem[],
): GroupBoardClaimItem[] {
  const active = items.filter(isModeBInventoryActiveBoardItem);
  return [...active].toSorted((a, b) => {
    const byStatus = inventoryStatusRank(a.status) - inventoryStatusRank(b.status);
    if (byStatus !== 0) {
      return byStatus;
    }
    return boardItemSelfAdvanceActivityAt(b) - boardItemSelfAdvanceActivityAt(a);
  });
}

export type ClaimPublishedInventoryLeadResult = Readonly<{
  claimed: boolean;
  reason: string;
  leadAgentId: string | null;
  item: GroupBoardClaimItem | null;
  boardItems: readonly GroupBoardClaimItem[];
}>;

/**
 * Mode B claim-first: when inventory primary is still `published`, claim it as the
 * resolved Mode B lead (claimant → intendedClaimantIds → publisher). Platform-wide;
 * does not hard-code agent ids. No-op when primary is not published or lead missing.
 * claimBoardItem still enforces claimContract flag + intended list.
 */
export async function tryClaimPublishedInventoryLead(
  authority: RuntimeAuthority,
  params: {
    boardItems: readonly GroupBoardClaimItem[];
    cfg?: OpenBotConfig;
    nowMs?: number;
    bots?: readonly CollaborationBotTarget[] | null;
    memberProgress?: readonly ModeBMemberProgressLike[] | null;
  },
): Promise<ClaimPublishedInventoryLeadResult> {
  const inventory = rankModeBInventoryActiveBoardItems(params.boardItems);
  const primary = inventory[0] ?? null;
  if (!primary || compact(primary.status) !== "published") {
    return {
      claimed: false,
      reason: "no_published_inventory_primary",
      leadAgentId: null,
      item: primary,
      boardItems: params.boardItems,
    };
  }
  const lead = selectModeBLead({
    boardItems: inventory,
    bots: params.bots,
    memberProgress: params.memberProgress,
    hasBroadcastMention: false,
  });
  const leadAgentId = compact(lead.leadAgentId);
  if (!leadAgentId) {
    return {
      claimed: false,
      reason: "no_mode_b_lead_for_published",
      leadAgentId: null,
      item: primary,
      boardItems: params.boardItems,
    };
  }
  const claimed = await claimBoardItem(
    authority,
    {
      taskId: primary.taskId,
      itemId: primary.itemId,
      claimantId: leadAgentId,
    },
    { cfg: params.cfg, nowMs: params.nowMs },
  );
  if (!claimed.ok) {
    return {
      claimed: false,
      reason: claimed.reason,
      leadAgentId,
      item: primary,
      boardItems: params.boardItems,
    };
  }
  const next = params.boardItems.map((item) =>
    compact(item.itemId) === compact(claimed.value.itemId) ? claimed.value : item,
  );
  if (!next.some((item) => compact(item.itemId) === compact(claimed.value.itemId))) {
    next.push(claimed.value);
  }
  return {
    claimed: true,
    reason: "claimed_published_lead",
    leadAgentId,
    item: claimed.value,
    boardItems: next,
  };
}

/** Latest meaningful activity timestamp for ranking (platform-wide, group-agnostic). */
export function boardItemSelfAdvanceActivityAt(
  item: Pick<
    GroupBoardClaimItem,
    "inProgressAt" | "appliedAt" | "claimedAt" | "publishedAt" | "returnedAt"
  >,
): number {
  return (
    item.inProgressAt ??
    item.returnedAt ??
    item.appliedAt ??
    item.claimedAt ??
    item.publishedAt ??
    0
  );
}

/**
 * Rank **delivery** self-advance active items (applied|in_progress only).
 * Prefer in_progress over applied; then most recently active.
 * For continue-after-round inventory (incl. published), use rankModeBInventoryActiveBoardItems.
 */
export function rankSelfAdvanceActiveBoardItems(
  items: readonly GroupBoardClaimItem[],
): GroupBoardClaimItem[] {
  const active = items.filter(isSelfAdvanceActiveBoardItem);
  return [...active].toSorted((a, b) => {
    const statusRank = (status: string): number => (compact(status) === "in_progress" ? 0 : 1);
    const byStatus = statusRank(a.status) - statusRank(b.status);
    if (byStatus !== 0) {
      return byStatus;
    }
    return boardItemSelfAdvanceActivityAt(b) - boardItemSelfAdvanceActivityAt(a);
  });
}

export function isSelfAdvanceInvalidatingBoardStatus(status: string): boolean {
  return (SELF_ADVANCE_INVALIDATING_BOARD_STATUSES as readonly string[]).includes(compact(status));
}

export function buildSelfAdvanceBoardFingerprint(
  item: Pick<GroupBoardClaimItem, "taskId" | "itemId" | "status" | "claimantId">,
): SelfAdvanceBoardFingerprint {
  return {
    taskId: compact(item.taskId),
    boardItemId: compact(item.itemId),
    status: compact(item.status),
    claimantId: compact(item.claimantId),
  };
}

export function serializeSelfAdvanceBoardFingerprint(fp: SelfAdvanceBoardFingerprint): string {
  return `${fp.taskId}|${fp.boardItemId}|${fp.status}|${fp.claimantId}`;
}

/**
 * True when a prior pending request must be invalidated / re-evaluated.
 * Claimant change, status change, or transition into invalidating statuses.
 */
export function shouldInvalidatePriorSelfAdvanceRequest(params: {
  priorFingerprint: string | null | undefined;
  current: SelfAdvanceBoardFingerprint;
}): { invalidate: boolean; reason: string | null } {
  const prior = compact(params.priorFingerprint);
  const current = serializeSelfAdvanceBoardFingerprint(params.current);
  if (!prior) {
    return { invalidate: false, reason: null };
  }
  if (prior === current) {
    return { invalidate: false, reason: null };
  }
  if (isSelfAdvanceInvalidatingBoardStatus(params.current.status)) {
    return {
      invalidate: true,
      reason: `board_status_${params.current.status}`,
    };
  }
  const [pTask, pItem, pStatus, pClaimant] = prior.split("|");
  if (pItem && pItem === params.current.boardItemId && pClaimant !== params.current.claimantId) {
    return { invalidate: true, reason: "claimant_changed" };
  }
  if (pItem && pItem === params.current.boardItemId && pStatus !== params.current.status) {
    return { invalidate: true, reason: "status_changed" };
  }
  if (pTask && pTask !== params.current.taskId) {
    return { invalidate: true, reason: "task_changed" };
  }
  return { invalidate: true, reason: "fingerprint_mismatch" };
}

export function resolveSelfAdvanceExecuteGroupAllowlist(cfg?: OpenBotConfig): string[] {
  const raw = cfg?.collaboration?.task?.selfAdvance?.executeGroupAllowlist;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter((e): e is string => typeof e === "string" && e.trim().length > 0);
}

/**
 * S5 write mode. Default dry_run. execute only when cfg mode=execute AND group
 * matches executeGroupAllowlist (P0 scoped keys preferred).
 */
export function resolveSelfAdvanceWriteMode(
  cfg: OpenBotConfig | undefined,
  groupId: string,
  tenantId?: string | null,
): SelfAdvanceWriteMode {
  const modeRaw = cfg?.collaboration?.task?.selfAdvance?.mode;
  const mode: SelfAdvanceWriteMode = modeRaw === "execute" ? "execute" : "dry_run";
  if (mode !== "execute") {
    return "dry_run";
  }
  const onList = matchGrayGroupAllowlist({
    groupId,
    tenantId,
    entries: resolveSelfAdvanceExecuteGroupAllowlist(cfg),
  });
  return onList ? "execute" : "dry_run";
}

export function selfAdvanceDecisionsDir(authority: RuntimeAuthority): string {
  return path.join(authority.namespace.root, "self-advance-decisions");
}

function selfAdvancePendingPath(authority: RuntimeAuthority, boardItemId: string): string {
  const safe = boardItemId.replace(/[^a-zA-Z0-9._-]+/g, "_");
  return path.join(selfAdvanceDecisionsDir(authority), `pending-${safe}.json`);
}

export async function readSelfAdvancePendingFingerprint(
  authority: RuntimeAuthority,
  boardItemId: string,
): Promise<string | null> {
  const file = selfAdvancePendingPath(authority, boardItemId);
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw) as { fingerprint?: string };
    return compact(parsed.fingerprint) || null;
  } catch {
    return null;
  }
}

/** @internal test helper — write prior pending fingerprint for invalidation cases. */
export async function writeSelfAdvancePendingFingerprintForTest(
  authority: RuntimeAuthority,
  cfg: OpenBotConfig | undefined,
  params: { boardItemId: string; fingerprint: string; at: number },
): Promise<void> {
  return writeSelfAdvancePendingFingerprint(authority, cfg, params);
}

async function writeSelfAdvancePendingFingerprint(
  authority: RuntimeAuthority,
  cfg: OpenBotConfig | undefined,
  params: { boardItemId: string; fingerprint: string; at: number },
): Promise<void> {
  const dir = selfAdvanceDecisionsDir(authority);
  assertCollaborationRuntimeWritable(dir, cfg);
  await fs.mkdir(dir, { recursive: true });
  const file = selfAdvancePendingPath(authority, params.boardItemId);
  await fs.writeFile(
    file,
    `${JSON.stringify({ fingerprint: params.fingerprint, at: params.at }, null, 2)}\n`,
    "utf8",
  );
}

async function clearSelfAdvancePendingFingerprint(
  authority: RuntimeAuthority,
  boardItemId: string,
): Promise<void> {
  try {
    await fs.unlink(selfAdvancePendingPath(authority, boardItemId));
  } catch {
    // ignore missing
  }
}

export async function appendSelfAdvanceDecision(
  authority: RuntimeAuthority,
  record: SelfAdvanceDecisionRecord,
  cfg?: OpenBotConfig,
): Promise<void> {
  const dir = selfAdvanceDecisionsDir(authority);
  assertCollaborationRuntimeWritable(dir, cfg);
  await fs.mkdir(dir, { recursive: true });
  const day = new Date(record.at).toISOString().slice(0, 10);
  await appendJsonlDurable(path.join(dir, `${day}.decisions.jsonl`), record);
}

export async function listSelfAdvanceDecisions(
  authority: RuntimeAuthority,
  opts?: { limit?: number },
): Promise<SelfAdvanceDecisionRecord[]> {
  const dir = selfAdvanceDecisionsDir(authority);
  let names: string[] = [];
  try {
    names = (await fs.readdir(dir)).filter((n) => n.endsWith(".decisions.jsonl")).toSorted();
  } catch {
    return [];
  }
  const out: SelfAdvanceDecisionRecord[] = [];
  const limit = opts?.limit ?? 100;
  for (const name of names.toReversed()) {
    const raw = await fs.readFile(path.join(dir, name), "utf8");
    for (const line of raw.split("\n").toReversed()) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      try {
        out.push(JSON.parse(trimmed) as SelfAdvanceDecisionRecord);
      } catch {
        // skip bad line
      }
      if (out.length >= limit) {
        return out;
      }
    }
  }
  return out;
}

export async function loadSelfAdvanceBoardItems(
  authority: RuntimeAuthority,
): Promise<GroupBoardClaimItem[]> {
  const exported = await loadBoardClaimItemsFromDir(boardClaimsDir(authority));
  return exported as GroupBoardClaimItem[];
}

/**
 * Evaluate FINAL §1.5 conditions. Pure w.r.t. gate + policy; board list supplied.
 * S5: callers must invoke this fresh every tick — do not cache across ticks.
 */
export function evaluateSelfAdvanceEligibility(params: {
  effective: EffectiveCollaborationPolicy;
  actor: GovernanceActor;
  boardItems: readonly GroupBoardClaimItem[];
  currentMission?: string | null;
}): SelfAdvanceEligibility {
  const activeBoardItems = rankSelfAdvanceActiveBoardItems(params.boardItems);
  const l2 = Boolean(params.effective.governance.botMaySelfAdvanceWithoutHuman);
  const missionOnboarding = isOnboardingIntroductionMission(params.currentMission);
  const gate = evaluateGovernanceGate({
    action: "self_advance",
    actor: params.actor,
    effective: params.effective,
  });
  const humanRequired = params.effective.governance.decisionMode === "human_required";

  const conditions: SelfAdvanceCondition[] = [
    {
      key: "l2_bot_may_self_advance",
      ok: l2,
      detail: l2
        ? "group L2 botMaySelfAdvanceWithoutHuman=true"
        : "group L2 botMaySelfAdvanceWithoutHuman is false (platform default)",
    },
    {
      key: "active_unaccepted_board",
      ok: activeBoardItems.length > 0,
      detail:
        activeBoardItems.length > 0
          ? `${activeBoardItems.length} applied|in_progress item(s)`
          : "no applied|in_progress board item",
    },
    {
      key: "mission_not_onboarding",
      ok: !missionOnboarding,
      detail: missionOnboarding
        ? "mission still looks like onboarding/introduction"
        : "mission is not onboarding",
    },
    {
      key: "governance_gate_allows",
      ok: gate.allowed,
      detail: `${gate.reason}: ${gate.message}`,
    },
    {
      key: "outbound_final_human_required",
      ok: humanRequired,
      detail: humanRequired
        ? "decisionMode=human_required (outbound/final still human)"
        : `decisionMode=${params.effective.governance.decisionMode}; self_advance requires human_required`,
    },
  ];

  const allowed = conditions.every((c) => c.ok);
  const failed = conditions.find((c) => !c.ok);
  return {
    allowed,
    reason: allowed ? "self_advance_eligible" : (failed?.key ?? "self_advance_blocked"),
    message: allowed
      ? "all §1.5 self_advance conditions met"
      : (failed?.detail ?? "self_advance blocked"),
    conditions,
    activeBoardItems,
  };
}

function buildDecisionBase(params: {
  at: number;
  tickId: string;
  authority: RuntimeAuthority;
  triggerSource: string;
  writeMode: SelfAdvanceWriteMode;
  eligibility: SelfAdvanceEligibility;
  execMode: DeliveryExecMode;
  advanced: boolean;
  executed: boolean;
  result: string;
  primary?: GroupBoardClaimItem | null;
  fingerprint?: string | null;
  invalidatedPrior: boolean;
  invalidationReason: string | null;
}): SelfAdvanceDecisionRecord {
  const primary = params.primary;
  return {
    at: params.at,
    tickId: params.tickId,
    groupId: params.authority.groupId,
    tenantId: params.authority.tenantId,
    taskId: primary ? compact(primary.taskId) || null : null,
    boardItemId: primary ? compact(primary.itemId) || null : null,
    claimantId: primary ? compact(primary.claimantId) || null : null,
    triggerSource: params.triggerSource,
    writeMode: params.writeMode,
    policyJudgment: {
      allowed: params.eligibility.allowed,
      reason: params.eligibility.reason,
      l2BotMaySelfAdvance: Boolean(
        params.eligibility.conditions.find((c) => c.key === "l2_bot_may_self_advance")?.ok,
      ),
      conditionKeysOk: params.eligibility.conditions.filter((c) => c.ok).map((c) => c.key),
    },
    execMode: params.execMode,
    advanced: params.advanced,
    executed: params.executed,
    result: params.result,
    fingerprint: params.fingerprint ?? null,
    invalidatedPrior: params.invalidatedPrior,
    invalidationReason: params.invalidationReason,
  };
}

/**
 * Production caller: evaluate §1.5 → Mode B lead → S2 delivery plan gate →
 * S5 write-mode gate → optional wake. Non-zero call path for Governance Gate
 * `self_advance`. Every invocation re-checks policy + board (per-tick reauth).
 */
export async function trySelfAdvance(
  authority: RuntimeAuthority,
  options: SelfAdvanceOptions,
): Promise<SelfAdvanceResult> {
  const actorId = compact(options.actorId);
  if (!actorId) {
    return { ok: false, reason: "invalid_input", message: "trySelfAdvance requires actorId" };
  }

  const cfg = options.cfg ?? loadConfig();
  const at = nowOf(options);
  const tickId = randomUUID();
  const triggerSource = compact(options.triggerSource) || "rpc:trySelfAdvance";
  const writeMode = resolveSelfAdvanceWriteMode(cfg, authority.groupId, authority.tenantId);
  // Explicit dryRun OR default/unauthorized dry_run mode → no side effects.
  const effectiveDryRun = options.dryRun === true || writeMode === "dry_run";
  const effectiveWriteMode: SelfAdvanceWriteMode = effectiveDryRun ? "dry_run" : "execute";

  const effective = authority.policy.effective;
  const actor = classifyGovernanceActor(actorId, options.memberRoleMap);

  // S5 per-tick reauth: always reload board + re-evaluate; never reuse prior tick auth.
  let boardItems =
    options.boardItems != null
      ? [...options.boardItems]
      : await loadSelfAdvanceBoardItems(authority);

  // Claim-first: unclaimed published inventory must enter claim before delivery
  // self-advance (§A "published: claim first"). Skip on dry_run.
  let claimedPublishedLead = false;
  let claimedPublishedReason: string | null = null;
  if (!effectiveDryRun && rankSelfAdvanceActiveBoardItems(boardItems).length === 0) {
    const claimAttempt = await tryClaimPublishedInventoryLead(authority, {
      boardItems,
      cfg,
      nowMs: at,
      bots: options.bots,
      memberProgress: options.memberProgress,
    });
    claimedPublishedReason = claimAttempt.reason;
    if (claimAttempt.claimed) {
      claimedPublishedLead = true;
      boardItems = [...claimAttempt.boardItems];
    }
  }

  const mission = options.currentMission ?? null;

  const eligibility = evaluateSelfAdvanceEligibility({
    effective,
    actor,
    boardItems,
    currentMission: mission,
  });

  const primaryCandidate =
    eligibility.activeBoardItems[0] ?? boardItems.find((i) => compact(i.itemId)) ?? null;

  let invalidatedPrior = false;
  let invalidationReason: string | null = null;
  let fingerprint: string | null = null;

  if (primaryCandidate) {
    const fpObj = buildSelfAdvanceBoardFingerprint(primaryCandidate);
    fingerprint = serializeSelfAdvanceBoardFingerprint(fpObj);
    const prior = await readSelfAdvancePendingFingerprint(authority, fpObj.boardItemId);
    const inv = shouldInvalidatePriorSelfAdvanceRequest({
      priorFingerprint: prior,
      current: fpObj,
    });
    invalidatedPrior = inv.invalidate;
    invalidationReason = inv.reason;
    if (isSelfAdvanceInvalidatingBoardStatus(fpObj.status)) {
      invalidatedPrior = true;
      invalidationReason = invalidationReason ?? `board_status_${fpObj.status}`;
      await clearSelfAdvancePendingFingerprint(authority, fpObj.boardItemId);
    }
  }

  const maybeLedger = async (decision: SelfAdvanceDecisionRecord) => {
    if (options.skipDecisionLedger) {
      return;
    }
    try {
      await appendSelfAdvanceDecision(authority, decision, cfg);
    } catch {
      // ledger best-effort; eligibility still returned
    }
  };

  if (!eligibility.allowed) {
    const resultReason = claimedPublishedLead
      ? "claimed_published_awaiting_apply"
      : eligibility.reason;
    const resultMessage = claimedPublishedLead
      ? "claimed published inventory lead; delivery self-advance still needs applied|in_progress"
      : eligibility.message;
    const decision = buildDecisionBase({
      at,
      tickId,
      authority,
      triggerSource,
      writeMode: effectiveWriteMode,
      eligibility,
      execMode: "blocked",
      advanced: false,
      executed: claimedPublishedLead,
      result: claimedPublishedLead
        ? `claimed_published_awaiting_apply:${claimedPublishedReason ?? "claimed"}`
        : eligibility.reason,
      primary: primaryCandidate,
      fingerprint,
      invalidatedPrior,
      invalidationReason,
    });
    await maybeLedger(decision);
    const leadAfterClaim = claimedPublishedLead
      ? selectModeBLead({
          boardItems: rankModeBInventoryActiveBoardItems(boardItems),
          memberProgress: options.memberProgress,
          bots: options.bots,
          hasBroadcastMention: false,
        })
      : null;
    return {
      ok: true,
      advanced: false,
      execMode: "blocked",
      eligibility,
      lead: leadAfterClaim,
      reason: resultReason,
      message: resultMessage,
      writeMode: effectiveWriteMode,
      executed: claimedPublishedLead,
      decision,
      fingerprint: fingerprint ?? undefined,
      invalidatedPrior,
    };
  }

  const lead = selectModeBLead({
    boardItems: eligibility.activeBoardItems,
    memberProgress: options.memberProgress,
    bots: options.bots,
    hasBroadcastMention: false,
  });

  if (!lead.leadAgentId) {
    const decision = buildDecisionBase({
      at,
      tickId,
      authority,
      triggerSource,
      writeMode: effectiveWriteMode,
      eligibility,
      execMode: "blocked",
      advanced: false,
      executed: false,
      result: "no_mode_b_lead",
      primary: primaryCandidate,
      fingerprint,
      invalidatedPrior,
      invalidationReason,
    });
    await maybeLedger(decision);
    return {
      ok: true,
      advanced: false,
      execMode: "blocked",
      eligibility,
      lead,
      reason: "no_mode_b_lead",
      message: "eligible but no board 责任人 / progress owner to advance",
      writeMode: effectiveWriteMode,
      executed: false,
      decision,
      fingerprint: fingerprint ?? undefined,
      invalidatedPrior,
    };
  }

  const enforcePlanGate = options.enforcePlanGate !== false;
  const primaryItem = eligibility.activeBoardItems[0];
  let deliveryGate: DeliveryExecGate | undefined;
  let execMode: DeliveryExecMode = "delivery_exec";
  let taskBag: ExecutionTaskBag | null | undefined;

  if (enforcePlanGate && primaryItem) {
    deliveryGate = await evaluateDeliveryExecGateForBoardItem(authority, {
      boardItem: primaryItem,
      ownerMemberId: lead.leadAgentId,
    });
    execMode = deliveryGate.mode;
    taskBag = deliveryGate.taskBag;

    if (deliveryGate.mode === "blocked") {
      const decision = buildDecisionBase({
        at,
        tickId,
        authority,
        triggerSource,
        writeMode: effectiveWriteMode,
        eligibility,
        execMode: "blocked",
        advanced: false,
        executed: false,
        result: deliveryGate.reason,
        primary: primaryItem,
        fingerprint,
        invalidatedPrior,
        invalidationReason,
      });
      await maybeLedger(decision);
      return {
        ok: true,
        advanced: false,
        execMode: "blocked",
        eligibility,
        lead,
        deliveryGate,
        taskBag: deliveryGate.taskBag,
        reason: deliveryGate.reason,
        message: deliveryGate.message,
        writeMode: effectiveWriteMode,
        executed: false,
        decision,
        fingerprint: fingerprint ?? undefined,
        invalidatedPrior,
      };
    }

    if (deliveryGate.mode === "plan_nudge") {
      // Remind only — may wake to complete plan when execute authorized; never delivery-advanced.
      if (effectiveDryRun) {
        const decision = buildDecisionBase({
          at,
          tickId,
          authority,
          triggerSource,
          writeMode: "dry_run",
          eligibility,
          execMode: "plan_nudge",
          advanced: false,
          executed: false,
          result: `dry_run:${deliveryGate.reason}`,
          primary: primaryItem,
          fingerprint,
          invalidatedPrior,
          invalidationReason,
        });
        await maybeLedger(decision);
        if (fingerprint && primaryItem) {
          await writeSelfAdvancePendingFingerprint(authority, cfg, {
            boardItemId: primaryItem.itemId,
            fingerprint,
            at,
          });
        }
        return {
          ok: true,
          advanced: false,
          execMode: "plan_nudge",
          eligibility,
          lead,
          deliveryGate,
          taskBag: deliveryGate.taskBag,
          reason: deliveryGate.reason,
          message: deliveryGate.message,
          writeMode: "dry_run",
          executed: false,
          decision,
          fingerprint: fingerprint ?? undefined,
          invalidatedPrior,
        };
      }

      let wakeEvent: WakeEvent | undefined;
      const wakeEnabled = isCollabTaskWakeContractEnabled(
        cfg,
        authority.groupId,
        authority.tenantId,
      );
      if (wakeEnabled) {
        const wake = await recordWakeEvent(
          authority,
          {
            groupId: authority.groupId,
            fromAgentId: compact(options.fromAgentId) || "system:self_advance",
            toAgentIds: [lead.leadAgentId],
            source: "self_advance",
            outcome: "recorded",
            taskId: primaryItem.taskId,
            itemId: primaryItem.itemId,
            reason: `self_advance:plan_nudge:${deliveryGate.reason}`,
          },
          { cfg, nowMs: at },
        );
        if (wake.ok) {
          wakeEvent = wake.value;
        }
      }

      const decision = buildDecisionBase({
        at,
        tickId,
        authority,
        triggerSource,
        writeMode: "execute",
        eligibility,
        execMode: "plan_nudge",
        advanced: false,
        executed: true,
        result: deliveryGate.reason,
        primary: primaryItem,
        fingerprint,
        invalidatedPrior,
        invalidationReason,
      });
      await maybeLedger(decision);
      if (fingerprint) {
        await writeSelfAdvancePendingFingerprint(authority, cfg, {
          boardItemId: primaryItem.itemId,
          fingerprint,
          at,
        });
      }

      return {
        ok: true,
        advanced: false,
        execMode: "plan_nudge",
        eligibility,
        lead,
        deliveryGate,
        taskBag: deliveryGate.taskBag,
        reason: deliveryGate.reason,
        message: deliveryGate.message,
        wakeEvent,
        writeMode: "execute",
        executed: true,
        decision,
        fingerprint: fingerprint ?? undefined,
        invalidatedPrior,
      };
    }
  }

  // delivery_exec (or plan gate explicitly skipped for §1.5-only unit checks)
  if (effectiveDryRun) {
    const decision = buildDecisionBase({
      at,
      tickId,
      authority,
      triggerSource,
      writeMode: "dry_run",
      eligibility,
      execMode,
      advanced: true,
      executed: false,
      result: "dry_run:delivery_exec_eligible",
      primary: primaryItem ?? primaryCandidate,
      fingerprint,
      invalidatedPrior,
      invalidationReason,
    });
    await maybeLedger(decision);
    if (fingerprint && (primaryItem ?? primaryCandidate)) {
      const item = primaryItem ?? primaryCandidate;
      await writeSelfAdvancePendingFingerprint(authority, cfg, {
        boardItemId: item.itemId,
        fingerprint,
        at,
      });
    }
    return {
      ok: true,
      advanced: true,
      execMode,
      eligibility,
      lead,
      deliveryGate,
      taskBag,
      writeMode: "dry_run",
      executed: false,
      decision,
      fingerprint: fingerprint ?? undefined,
      invalidatedPrior,
    };
  }

  // Execute path: P0-2 wake→Mode B round consumer (dispatched|recorded).
  const fromAgentId = compact(options.fromAgentId) || "system:self_advance";
  const consume = await consumeWakeForRoundDispatch({
    authority,
    cfg,
    writeMode: "execute",
    roundDispatcher: options.roundDispatcher,
    skipRoundDispatch: options.skipRoundDispatch,
    nowMs: at,
    request: {
      groupId: authority.groupId,
      tenantId: authority.tenantId,
      fromAgentId,
      toAgentIds: [lead.leadAgentId],
      source: "self_advance",
      taskId: primaryItem?.taskId,
      itemId: primaryItem?.itemId,
      reason: `self_advance:delivery_exec:${eligibility.reason}:${lead.reason}`,
    },
  });
  const wakeEvent = consume.wakeEvent;

  const decision = buildDecisionBase({
    at,
    tickId,
    authority,
    triggerSource,
    writeMode: "execute",
    eligibility,
    execMode: "delivery_exec",
    advanced: true,
    executed: true,
    result: consume.dispatched
      ? `delivery_exec:dispatched:${consume.roundId ?? ""}`
      : "delivery_exec",
    primary: primaryItem ?? primaryCandidate,
    fingerprint,
    invalidatedPrior,
    invalidationReason,
  });
  await maybeLedger(decision);
  if (fingerprint && (primaryItem ?? primaryCandidate)) {
    const item = primaryItem ?? primaryCandidate;
    await writeSelfAdvancePendingFingerprint(authority, cfg, {
      boardItemId: item.itemId,
      fingerprint,
      at,
    });
  }

  return {
    ok: true,
    advanced: true,
    execMode: "delivery_exec",
    eligibility,
    lead,
    deliveryGate,
    taskBag,
    wakeEvent,
    writeMode: "execute",
    executed: true,
    decision,
    fingerprint: fingerprint ?? undefined,
    invalidatedPrior,
    roundDispatched: consume.dispatched,
    roundId: consume.roundId,
  };
}
