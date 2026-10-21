/**
 * P3/S4 — Group task heartbeat (cron-shaped tick + observe-first writes).
 *
 * FINAL v3 §S4 / §1.5: every ~30min scan board → nudge on unclaimed / overdue /
 * stalled progress; after 2 consecutive no-response nudges → escalate to
 * coordinatorBotId or group owner. Defaults are **configurable** (not platform
 * hard constants). Heartbeat **reads task surface**; wake writes only in emit
 * mode for gray-authorized groups. Never fakes transcript completion / never
 * invents a second orchestrator.
 *
 * S4 observe-first: default `mode=observe` plans + persists decisions/scan log
 * without wake writes. Real nudge/escalate requires Wake Contract for the group
 * AND (`mode=emit` or `emitGroupAllowlist`). Scheduler wiring lives in
 * `group-task-heartbeat-scheduler.ts` (`schedulerEnabled` default false).
 *
 * Unclaimed claim bridge: after emit nudge/escalate for `unclaimed` published
 * items, when the group has selfAdvance execute (mode+allowlist), the same tick
 * calls trySelfAdvance (Mode B claim-first, same semantics as RPC). Default OFF
 * when selfAdvance is dry_run / not allowlisted — nudge-only legacy behavior.
 *
 * P0-2: emit nudge|escalate goes through wake→Mode B round consumer. When wake
 * + selfAdvance execute + dispatcher bound → outcome `dispatched`; otherwise
 * `recorded`. Reuses executeCollaborationRound; no second orchestrator.
 * Inventory-first; no LIVE / Floor flips.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import {
  boardClaimsDir,
  type BoardClaimStatus,
  type GroupBoardClaimItem,
} from "./claim-contract.js";
import { matchGrayGroupAllowlist } from "./gray-group-allowlist.js";
import { loadBoardClaimItemsFromDir } from "./member-progress-export.js";
import { appendJsonlDurable, withRoundLock } from "./round-store-io.js";
import type { RuntimeAuthority } from "./runtime-authority.js";
import { assertCollaborationRuntimeWritable } from "./runtime-namespace.js";
import {
  resolveSelfAdvanceWriteMode,
  trySelfAdvance,
  type SelfAdvanceResult,
} from "./self-advance.js";
import {
  isSingleGroupUnattendedTarget,
  runSingleGroupUnattendedTick,
  type UnattendedTickResult,
} from "./single-group-unattended.js";
import {
  isCollabTaskWakeContractEnabled,
  listWakeEvents,
  whoWokeWhom,
  type WakeEvent,
} from "./wake-contract.js";
import { consumeWakeForRoundDispatch, type WakeRoundDispatcher } from "./wake-round-dispatch.js";

/** FINAL default: 30 minutes. */
export const DEFAULT_GROUP_TASK_HEARTBEAT_SCAN_INTERVAL_MS = 30 * 60 * 1000;

/** FINAL default: escalate after 2 consecutive no-response nudges. */
export const DEFAULT_GROUP_TASK_HEARTBEAT_ESCALATE_AFTER = 2;

/** Heartbeat never marks chat / transcript as completed work. */
export function heartbeatFakesTranscriptCompletion(): false {
  return false;
}

/** Contract: heartbeat reads board / progress surface and writes wake only. */
export function heartbeatReadsTaskSurfaceWritesWake(): true {
  return true;
}

export type GroupTaskHeartbeatWriteMode = "observe" | "emit";

export type GroupTaskHeartbeatOptions = {
  cfg?: OpenBotConfig;
  nowMs?: number;
  /** Skip scan-interval gate (tests / manual ops). */
  force?: boolean;
  /** Escalate target when coordinator missing. */
  groupOwnerId?: string | null;
  coordinatorBotId?: string | null;
  /** Actor recorded as fromAgentId for wake rows (default `system:group_task_heartbeat`). */
  actorId?: string;
  /**
   * S4: when true, plan + persist state/scan only — never write wake.
   * Scheduler sets this from resolveGroupTaskHeartbeatWriteMode === "observe".
   * When false/undefined, emit path still requires Wake Contract for the group.
   */
  dryRun?: boolean;
  /** Trusted tenant for allowlist matching (P0 scoped keys). */
  tenantId?: string | null;
  /**
   * When true, skip the unclaimed→Mode B claim-first bridge even if selfAdvance
   * execute is on (tests / ops). Default false.
   */
  skipClaimBridge?: boolean;
  /**
   * Batch 5: optional Mode B dispatcher for the single-target unattended tick.
   * Ignored unless the group is the one allowlisted target.
   */
  roundDispatcher?: WakeRoundDispatcher | null;
};

export type HeartbeatActionKind = "nudge" | "escalate" | "skip";

export type HeartbeatItemDecision = Readonly<{
  itemId: string;
  taskId: string;
  groupId: string;
  status: string;
  action: HeartbeatActionKind;
  toAgentIds: readonly string[];
  reason: string;
  consecutiveNoResponse: number;
}>;

export type GroupTaskHeartbeatItemState = {
  consecutiveNoResponse: number;
  lastNudgeAt?: number;
  lastEscalateAt?: number;
  lastFingerprint?: string;
  lastStatus?: string;
};

export type GroupTaskHeartbeatState = {
  groupId: string;
  lastScanAt: number;
  items: Record<string, GroupTaskHeartbeatItemState>;
};

export type HeartbeatClaimBridgeResult = Readonly<{
  attempted: boolean;
  claimed: boolean;
  reason: string;
  leadAgentId: string | null;
  boardItemId: string | null;
  selfAdvanceReason?: string;
  selfAdvance?: SelfAdvanceResult;
}>;

export type GroupTaskHeartbeatResult =
  | {
      ok: true;
      skipped?: false;
      groupId: string;
      scannedAt: number;
      itemCount: number;
      decisions: HeartbeatItemDecision[];
      wakeEvents: WakeEvent[];
      state: GroupTaskHeartbeatState;
      /** S4: observe = no wake writes; emit = wake writes attempted. */
      writeMode: GroupTaskHeartbeatWriteMode;
      /** Present when emit tick considered Mode B claim-first after unclaimed nudge. */
      claimBridge?: HeartbeatClaimBridgeResult;
      /** Present when this group is the single unattended target. */
      unattended?: UnattendedTickResult;
    }
  | {
      ok: true;
      skipped: true;
      reason: string;
      groupId: string;
      nextEligibleAt?: number;
    }
  | {
      ok: false;
      reason: string;
      message: string;
    };

function compact(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function uniqueIds(values: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values ?? []) {
    const id = compact(value);
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    out.push(id);
  }
  return out;
}

function safeStem(id: string): string | null {
  const trimmed = id.trim();
  if (!trimmed || trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("..")) {
    return null;
  }
  return encodeURIComponent(trimmed);
}

export function resolveGroupTaskHeartbeatScanIntervalMs(cfg?: OpenBotConfig): number {
  try {
    const raw = (cfg ?? loadConfig()).collaboration?.task?.groupTaskHeartbeat?.scanIntervalMs;
    if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
      return Math.floor(raw);
    }
  } catch {
    // fall through
  }
  return DEFAULT_GROUP_TASK_HEARTBEAT_SCAN_INTERVAL_MS;
}

export function resolveGroupTaskHeartbeatEscalateAfter(cfg?: OpenBotConfig): number {
  try {
    const raw = (cfg ?? loadConfig()).collaboration?.task?.groupTaskHeartbeat
      ?.escalateAfterConsecutiveNoResponse;
    if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
      return Math.floor(raw);
    }
  } catch {
    // fall through
  }
  return DEFAULT_GROUP_TASK_HEARTBEAT_ESCALATE_AFTER;
}

/** Heartbeat write path enabled iff Wake Contract is enabled for the group. */
export function isGroupTaskHeartbeatEnabled(
  cfg?: OpenBotConfig,
  groupId?: string | null,
  tenantId?: string | null,
): boolean {
  return isCollabTaskWakeContractEnabled(cfg, groupId, tenantId);
}

export function groupTaskHeartbeatDir(authority: RuntimeAuthority): string {
  return path.join(authority.namespace.root, "group-task-heartbeat");
}

export function groupTaskHeartbeatStatePath(dir: string, groupId: string): string {
  const stem = safeStem(groupId);
  if (!stem) {
    throw new Error("group task heartbeat groupId is not a safe id");
  }
  return path.join(dir, `${stem}.json`);
}

/**
 * Board/交卷 progress fingerprint. Chat-only messages (e.g. "正在处理") are
 * intentionally absent — they must NOT reset stall / consecutiveNoResponse.
 * submissionId + artifactVersion (S3) DO reset stall when 交卷事实变化.
 */
export function progressFingerprint(item: {
  status: string;
  claimantId?: string;
  claimedAt?: number;
  appliedAt?: number;
  inProgressAt?: number;
  submittedAt?: number;
  returnedAt?: number;
  blockedAt?: number;
  submissionId?: string;
  artifactVersion?: string;
}): string {
  return [
    item.status,
    compact(item.claimantId),
    item.claimedAt ?? "",
    item.appliedAt ?? "",
    item.inProgressAt ?? "",
    item.submittedAt ?? "",
    item.returnedAt ?? "",
    item.blockedAt ?? "",
    compact(item.submissionId),
    compact(item.artifactVersion),
  ].join("|");
}

/** Product semantic: a chat utterance alone never clears heartbeat stall. */
export function chatMessageDoesNotResetHeartbeatStall(): true {
  return true;
}

export function resolveGroupTaskHeartbeatSchedulerEnabled(cfg?: OpenBotConfig): boolean {
  try {
    return (cfg ?? loadConfig()).collaboration?.task?.groupTaskHeartbeat?.schedulerEnabled === true;
  } catch {
    return false;
  }
}

export function resolveGroupTaskHeartbeatConfiguredMode(
  cfg?: OpenBotConfig,
): GroupTaskHeartbeatWriteMode {
  try {
    const raw = (cfg ?? loadConfig()).collaboration?.task?.groupTaskHeartbeat?.mode;
    return raw === "emit" ? "emit" : "observe";
  } catch {
    return "observe";
  }
}

export function resolveGroupTaskHeartbeatEmitGroupAllowlist(cfg?: OpenBotConfig): string[] {
  try {
    const raw = (cfg ?? loadConfig()).collaboration?.task?.groupTaskHeartbeat?.emitGroupAllowlist;
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw.filter(
      (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
    );
  } catch {
    return [];
  }
}

/**
 * S4 write mode for one group.
 * emit only when Wake Contract is on AND (configured mode is emit OR group is
 * on emitGroupAllowlist). Otherwise observe (dry-run decisions, no wake writes).
 */
export function resolveGroupTaskHeartbeatWriteMode(
  cfg: OpenBotConfig | undefined,
  groupId: string | null | undefined,
  tenantId?: string | null,
): GroupTaskHeartbeatWriteMode {
  const wakeOn = isCollabTaskWakeContractEnabled(cfg, groupId, tenantId);
  if (!wakeOn) {
    return "observe";
  }
  const configured = resolveGroupTaskHeartbeatConfiguredMode(cfg);
  if (configured === "emit") {
    return "emit";
  }
  const gid = compact(groupId);
  if (!gid) {
    return "observe";
  }
  const onEmitList = matchGrayGroupAllowlist({
    groupId: gid,
    tenantId,
    entries: resolveGroupTaskHeartbeatEmitGroupAllowlist(cfg),
  });
  return onEmitList ? "emit" : "observe";
}

const TERMINAL = new Set(["accepted", "cancelled"]);
const NEEDS_ATTENTION = new Set([
  "published",
  "claimed",
  "applied",
  "in_progress",
  "returned",
  "blocked",
  "submitted_for_review",
]);

function isOverdue(item: { dueAtMs?: number }, nowMs: number): boolean {
  return typeof item.dueAtMs === "number" && Number.isFinite(item.dueAtMs) && item.dueAtMs < nowMs;
}

function nudgeTargets(item: GroupBoardClaimItem | HeartbeatBoardItemLike): string[] {
  const claimant = compact(item.claimantId);
  if (claimant) {
    return [claimant];
  }
  const intended = uniqueIds(item.intendedClaimantIds);
  if (intended.length > 0) {
    return intended;
  }
  const publishedBy = compact(item.publishedBy);
  return publishedBy ? [publishedBy] : [];
}

export type HeartbeatBoardItemLike = {
  itemId: string;
  groupId: string;
  taskId: string;
  title?: string;
  status: string;
  claimantId?: string;
  publishedBy?: string;
  intendedClaimantIds?: readonly string[];
  dueAtMs?: number;
  claimedAt?: number;
  appliedAt?: number;
  inProgressAt?: number;
  submittedAt?: number;
  returnedAt?: number;
  blockedAt?: number;
  /** S3/S4: 交卷身份 — fingerprint includes these so submit resets stall. */
  submissionId?: string;
  artifactVersion?: string;
};

/**
 * Pure planner: decide nudge / escalate / skip for one board item.
 * Escalate when consecutive no-response (same fingerprint after prior nudges)
 * reaches `escalateAfter`.
 */
export function planHeartbeatActionForItem(params: {
  item: HeartbeatBoardItemLike;
  prior?: GroupTaskHeartbeatItemState | null;
  nowMs: number;
  escalateAfter: number;
  escalateTo: readonly string[];
}): HeartbeatItemDecision {
  const item = params.item;
  const fingerprint = progressFingerprint(item);
  const prior = params.prior ?? null;
  const sameAsPrior = Boolean(prior?.lastFingerprint && prior.lastFingerprint === fingerprint);
  const consecutive = sameAsPrior ? (prior?.consecutiveNoResponse ?? 0) : 0;

  if (TERMINAL.has(item.status) || !NEEDS_ATTENTION.has(item.status)) {
    return {
      itemId: item.itemId,
      taskId: item.taskId,
      groupId: item.groupId,
      status: item.status,
      action: "skip",
      toAgentIds: [],
      reason: `status_${item.status}_not_actionable`,
      consecutiveNoResponse: 0,
    };
  }

  const targets = nudgeTargets(item);
  if (targets.length === 0) {
    return {
      itemId: item.itemId,
      taskId: item.taskId,
      groupId: item.groupId,
      status: item.status,
      action: "skip",
      reason: "no_nudge_targets",
      toAgentIds: [],
      consecutiveNoResponse: consecutive,
    };
  }

  const overdue = isOverdue(item, params.nowMs);
  const whyParts: string[] = [];
  if (item.status === "published") {
    whyParts.push("unclaimed");
  }
  if (overdue) {
    whyParts.push("overdue");
  }
  if (item.status === "blocked") {
    whyParts.push("blocked");
  }
  if (item.status === "returned") {
    whyParts.push("returned");
  }
  if (item.status === "applied" || item.status === "claimed" || item.status === "in_progress") {
    whyParts.push("stalled_or_active");
  }
  if (item.status === "submitted_for_review") {
    whyParts.push("awaiting_review");
  }
  const reasonBase = whyParts.join("+") || "needs_attention";

  // Same board fingerprint after an escalate: do not keep nudging/escalating
  // every scan (anti-spam). Wait for board/交卷 progress to change.
  if (sameAsPrior && prior?.lastEscalateAt) {
    return {
      itemId: item.itemId,
      taskId: item.taskId,
      groupId: item.groupId,
      status: item.status,
      action: "skip",
      toAgentIds: [],
      reason: `already_escalated_awaiting_progress:${reasonBase}`,
      consecutiveNoResponse: consecutive,
    };
  }

  // Escalate only after we already nudged at least once and fingerprint stuck.
  if (consecutive >= params.escalateAfter && params.escalateTo.length > 0) {
    return {
      itemId: item.itemId,
      taskId: item.taskId,
      groupId: item.groupId,
      status: item.status,
      action: "escalate",
      toAgentIds: uniqueIds(params.escalateTo),
      reason: `escalate_after_${consecutive}_no_response:${reasonBase}`,
      consecutiveNoResponse: consecutive,
    };
  }

  return {
    itemId: item.itemId,
    taskId: item.taskId,
    groupId: item.groupId,
    status: item.status,
    action: "nudge",
    toAgentIds: targets,
    reason: `heartbeat_nudge:${reasonBase}`,
    consecutiveNoResponse: consecutive,
  };
}

async function readState(statePath: string): Promise<GroupTaskHeartbeatState | null> {
  try {
    const raw = await fs.readFile(statePath, "utf8");
    const parsed = JSON.parse(raw) as GroupTaskHeartbeatState;
    if (!parsed || typeof parsed !== "object" || typeof parsed.groupId !== "string") {
      return null;
    }
    return {
      groupId: parsed.groupId,
      lastScanAt: typeof parsed.lastScanAt === "number" ? parsed.lastScanAt : 0,
      items: parsed.items && typeof parsed.items === "object" ? parsed.items : {},
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    return null;
  }
}

async function writeState(
  authority: RuntimeAuthority,
  state: GroupTaskHeartbeatState,
  cfg?: OpenBotConfig,
): Promise<void> {
  const dir = groupTaskHeartbeatDir(authority);
  assertCollaborationRuntimeWritable(dir, cfg);
  const stem = safeStem(state.groupId);
  if (!stem) {
    throw new Error("group task heartbeat groupId is not a safe id");
  }
  const statePath = groupTaskHeartbeatStatePath(dir, state.groupId);
  await withRoundLock(dir, stem, async () => {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  });
}

function toHeartbeatItem(raw: {
  itemId: string;
  groupId: string;
  taskId: string;
  title?: string;
  status: string;
  claimantId?: string;
  publishedBy?: string;
  intendedClaimantIds?: readonly string[];
  dueAtMs?: number;
  claimedAt?: number;
  appliedAt?: number;
  inProgressAt?: number;
  submittedAt?: number;
  returnedAt?: number;
  blockedAt?: number;
  submissionId?: string;
  artifactVersion?: string;
}): HeartbeatBoardItemLike {
  return {
    itemId: raw.itemId,
    groupId: raw.groupId,
    taskId: raw.taskId,
    title: raw.title,
    status: raw.status,
    claimantId: raw.claimantId,
    publishedBy: raw.publishedBy,
    intendedClaimantIds: raw.intendedClaimantIds,
    dueAtMs: raw.dueAtMs,
    claimedAt: raw.claimedAt,
    appliedAt: raw.appliedAt,
    inProgressAt: raw.inProgressAt,
    submittedAt: raw.submittedAt,
    returnedAt: raw.returnedAt,
    blockedAt: raw.blockedAt,
    submissionId: raw.submissionId,
    artifactVersion: raw.artifactVersion,
  };
}

/**
 * Load latest board items for a group from `<ns>/board-claims/*.jsonl`.
 * Filters by groupId when present on the row.
 */
export async function loadGroupBoardItemsForHeartbeat(
  authority: RuntimeAuthority,
  groupId: string,
): Promise<HeartbeatBoardItemLike[]> {
  const claimsDir = boardClaimsDir(authority);
  const exported = await loadBoardClaimItemsFromDir(claimsDir);
  const gid = compact(groupId);
  const items: HeartbeatBoardItemLike[] = [];
  for (const row of exported) {
    if (gid && compact(row.groupId) && compact(row.groupId) !== gid) {
      continue;
    }
    items.push(
      toHeartbeatItem({
        itemId: row.itemId,
        groupId: row.groupId || gid,
        taskId: row.taskId,
        title: row.title,
        status: row.status,
        claimantId: row.claimantId,
        publishedBy: row.publishedBy,
        // Exported type may omit intendedClaimantIds / dueAtMs — re-read not required for nudge
        // when claimant exists; unclaimed without intended list falls back to publishedBy.
        claimedAt: row.claimedAt,
        appliedAt: row.appliedAt,
        inProgressAt: row.inProgressAt,
        submittedAt: row.submittedAt,
        returnedAt: row.returnedAt,
        blockedAt: row.blockedAt,
        submissionId: (row as { submissionId?: string }).submissionId,
        artifactVersion: (row as { artifactVersion?: string }).artifactVersion,
      }),
    );
  }
  return items;
}

/**
 * Enrich exported items with intendedClaimantIds / dueAtMs by re-parsing jsonl
 * when available (exported C0 type is thinner). Best-effort.
 */
export async function loadGroupBoardItemsForHeartbeatRich(
  authority: RuntimeAuthority,
  groupId: string,
): Promise<HeartbeatBoardItemLike[]> {
  const claimsDir = boardClaimsDir(authority);
  let entries: string[];
  try {
    entries = await fs.readdir(claimsDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const byId = new Map<string, HeartbeatBoardItemLike>();
  const gid = compact(groupId);
  for (const name of entries) {
    if (!name.endsWith(".jsonl")) {
      continue;
    }
    const raw = await fs.readFile(path.join(claimsDir, name), "utf8");
    for (const line of raw.split("\n")) {
      if (!line.trim()) {
        continue;
      }
      try {
        const parsed = JSON.parse(line) as { kind?: string; item?: GroupBoardClaimItem };
        if (parsed?.kind !== "board_claim" || !parsed.item?.itemId) {
          continue;
        }
        const item = parsed.item;
        if (gid && compact(item.groupId) && compact(item.groupId) !== gid) {
          continue;
        }
        byId.set(item.itemId, toHeartbeatItem(item));
      } catch {
        // skip
      }
    }
  }
  return [...byId.values()];
}

/**
 * Gate for heartbeat unclaimed → Mode B claim-first bridge.
 * Requires emit (not dryRun), selfAdvance writeMode=execute, and at least one
 * nudge/escalate decision whose reason includes `unclaimed` (published path).
 * Platform-wide; no hard-coded agent/group ids. Default OFF when selfAdvance
 * is dry_run / not on executeGroupAllowlist.
 */
export function shouldAttemptUnclaimedClaimBridge(params: {
  dryRun: boolean;
  skipClaimBridge?: boolean;
  selfAdvanceWriteMode: "dry_run" | "execute";
  decisions: readonly HeartbeatItemDecision[];
}): boolean {
  if (params.dryRun || params.skipClaimBridge) {
    return false;
  }
  if (params.selfAdvanceWriteMode !== "execute") {
    return false;
  }
  return params.decisions.some(
    (d) => (d.action === "nudge" || d.action === "escalate") && d.reason.includes("unclaimed"),
  );
}

/**
 * After unclaimed nudge/escalate, run trySelfAdvance (claim-first) with the same
 * Mode B semantics as RPC trySelfAdvance / continue-after-round. Best-effort;
 * never throws into the heartbeat hot path.
 */
export async function maybeClaimBridgeAfterUnclaimedHeartbeat(
  authority: RuntimeAuthority,
  params: {
    cfg?: OpenBotConfig;
    nowMs: number;
    actorId: string;
    dryRun: boolean;
    skipClaimBridge?: boolean;
    decisions: readonly HeartbeatItemDecision[];
    tenantId?: string | null;
  },
): Promise<HeartbeatClaimBridgeResult | undefined> {
  const selfAdvanceWriteMode = resolveSelfAdvanceWriteMode(
    params.cfg,
    authority.groupId,
    params.tenantId ?? authority.tenantId,
  );
  if (
    !shouldAttemptUnclaimedClaimBridge({
      dryRun: params.dryRun,
      skipClaimBridge: params.skipClaimBridge,
      selfAdvanceWriteMode,
      decisions: params.decisions,
    })
  ) {
    return undefined;
  }

  try {
    const selfAdvance = await trySelfAdvance(authority, {
      actorId: params.actorId,
      cfg: params.cfg,
      nowMs: params.nowMs,
      triggerSource: "heartbeat:unclaimed_claim_bridge",
      fromAgentId: params.actorId,
    });
    if (!selfAdvance.ok) {
      return {
        attempted: true,
        claimed: false,
        reason: compact((selfAdvance as { reason?: string }).reason) || "self_advance_failed",
        leadAgentId: null,
        boardItemId: null,
      };
    }
    const resultReason = !selfAdvance.advanced
      ? selfAdvance.reason
      : (selfAdvance.decision?.result ?? "self_advance_advanced");
    const claimed =
      selfAdvance.executed ||
      resultReason === "claimed_published_awaiting_apply" ||
      resultReason.startsWith("claimed_published");
    const leadAgentId =
      compact(selfAdvance.lead?.leadAgentId) || compact(selfAdvance.decision?.claimantId) || null;
    const boardItemId = compact(selfAdvance.decision?.boardItemId) || null;
    return {
      attempted: true,
      claimed: Boolean(claimed),
      reason: resultReason,
      leadAgentId,
      boardItemId,
      selfAdvanceReason: resultReason,
      selfAdvance,
    };
  } catch {
    return {
      attempted: true,
      claimed: false,
      reason: "claim_bridge_error",
      leadAgentId: null,
      boardItemId: null,
    };
  }
}

function resolveEscalateTargets(options?: GroupTaskHeartbeatOptions): string[] {
  return uniqueIds([compact(options?.coordinatorBotId), compact(options?.groupOwnerId)]);
}

/**
 * Cron-shaped single tick: read board → write wake nudge/escalate → optional
 * Mode B claim-first bridge for unclaimed → persist state.
 * Does **not** append transcript / fake completion.
 */
export async function runGroupTaskHeartbeat(
  authority: RuntimeAuthority,
  input: { groupId: string },
  options?: GroupTaskHeartbeatOptions,
): Promise<GroupTaskHeartbeatResult> {
  const cfg = options?.cfg;
  const groupId = compact(input.groupId);
  if (!groupId) {
    return {
      ok: false,
      reason: "invalid_input",
      message: "runGroupTaskHeartbeat requires groupId",
    };
  }
  const tenantId = options?.tenantId ?? authority.tenantId ?? null;
  const resolvedMode = resolveGroupTaskHeartbeatWriteMode(cfg, groupId, tenantId);
  // Explicit dryRun wins; otherwise follow resolveGroupTaskHeartbeatWriteMode (default observe).
  const dryRun = options?.dryRun ?? resolvedMode === "observe";
  const writeMode: GroupTaskHeartbeatWriteMode = dryRun ? "observe" : "emit";
  const unattendedTarget = isSingleGroupUnattendedTarget(cfg, groupId, tenantId);
  const unattendedExecuteAuthorized =
    unattendedTarget &&
    !dryRun &&
    resolveSelfAdvanceWriteMode(cfg, groupId, tenantId) === "execute";

  // Emit path still requires Wake Contract. Observe/dry-run may scan without it.
  if (!dryRun && !isGroupTaskHeartbeatEnabled(cfg, groupId, tenantId)) {
    return {
      ok: false,
      reason: "flag_off",
      message:
        "collaboration.task.wakeContract is off for this group; group task heartbeat does not write",
    };
  }

  const nowMs = options?.nowMs ?? Date.now();
  const intervalMs = resolveGroupTaskHeartbeatScanIntervalMs(cfg);
  const escalateAfter = resolveGroupTaskHeartbeatEscalateAfter(cfg);
  const dir = groupTaskHeartbeatDir(authority);
  const statePath = groupTaskHeartbeatStatePath(dir, groupId);
  const priorState = (await readState(statePath)) ?? {
    groupId,
    lastScanAt: 0,
    items: {},
  };

  if (!options?.force && priorState.lastScanAt > 0 && nowMs - priorState.lastScanAt < intervalMs) {
    return {
      ok: true,
      skipped: true,
      reason: "scan_interval_not_elapsed",
      groupId,
      nextEligibleAt: priorState.lastScanAt + intervalMs,
    };
  }

  const items = await loadGroupBoardItemsForHeartbeatRich(authority, groupId);
  const escalateTo = resolveEscalateTargets(options);
  const actorId = compact(options?.actorId) || "system:group_task_heartbeat";
  const decisions: HeartbeatItemDecision[] = [];
  const wakeEvents: WakeEvent[] = [];
  const nextItems: Record<string, GroupTaskHeartbeatItemState> = { ...priorState.items };

  for (const item of items) {
    const prior = priorState.items[item.itemId];
    const decision = planHeartbeatActionForItem({
      item,
      prior,
      nowMs,
      escalateAfter,
      escalateTo,
    });
    decisions.push(decision);

    if (decision.action === "skip") {
      if (TERMINAL.has(item.status)) {
        delete nextItems[item.itemId];
      } else {
        nextItems[item.itemId] = {
          consecutiveNoResponse: 0,
          lastFingerprint: progressFingerprint(item),
          lastStatus: item.status,
          lastNudgeAt: prior?.lastNudgeAt,
          lastEscalateAt: prior?.lastEscalateAt,
        };
      }
      continue;
    }

    if (decision.action === "nudge") {
      if (!dryRun && !unattendedTarget) {
        const selfAdvanceWriteMode = resolveSelfAdvanceWriteMode(cfg, groupId, tenantId);
        const consume = await consumeWakeForRoundDispatch({
          authority,
          cfg,
          writeMode: selfAdvanceWriteMode,
          nowMs,
          request: {
            groupId,
            tenantId,
            fromAgentId: actorId,
            toAgentIds: decision.toAgentIds,
            source: "nudge",
            taskId: item.taskId,
            itemId: item.itemId,
            reason: decision.reason,
          },
        });
        if (consume.wakeEvent) {
          wakeEvents.push(consume.wakeEvent);
        }
      }
      const fingerprint = progressFingerprint(item);
      const same = prior?.lastFingerprint === fingerprint;
      nextItems[item.itemId] = {
        consecutiveNoResponse: same ? (prior?.consecutiveNoResponse ?? 0) + 1 : 1,
        lastNudgeAt: nowMs,
        lastEscalateAt: prior?.lastEscalateAt,
        lastFingerprint: fingerprint,
        lastStatus: item.status,
      };
      continue;
    }

    if (decision.action === "escalate") {
      if (!dryRun && !unattendedTarget) {
        const selfAdvanceWriteMode = resolveSelfAdvanceWriteMode(cfg, groupId, tenantId);
        const consume = await consumeWakeForRoundDispatch({
          authority,
          cfg,
          writeMode: selfAdvanceWriteMode,
          nowMs,
          request: {
            groupId,
            tenantId,
            fromAgentId: actorId,
            toAgentIds: decision.toAgentIds,
            source: "escalate",
            taskId: item.taskId,
            itemId: item.itemId,
            reason: decision.reason,
          },
        });
        if (consume.wakeEvent) {
          wakeEvents.push(consume.wakeEvent);
        }
      }
      nextItems[item.itemId] = {
        consecutiveNoResponse: 0,
        lastNudgeAt: prior?.lastNudgeAt,
        lastEscalateAt: nowMs,
        lastFingerprint: progressFingerprint(item),
        lastStatus: item.status,
      };
    }
  }

  const claimBridge = await maybeClaimBridgeAfterUnclaimedHeartbeat(authority, {
    cfg,
    nowMs,
    actorId,
    dryRun,
    skipClaimBridge: options?.skipClaimBridge || unattendedTarget,
    decisions,
    tenantId,
  });

  let unattended: UnattendedTickResult | undefined;
  if (unattendedTarget) {
    try {
      unattended = await runSingleGroupUnattendedTick(authority, {
        cfg,
        nowMs,
        executeAuthorized: unattendedExecuteAuthorized,
        items,
        roundDispatcher: options?.roundDispatcher,
        fromAgentId: actorId,
        source: "nudge",
        reason: "single_group_unattended",
      });
      if (unattended.wakeEvent) {
        wakeEvents.push(unattended.wakeEvent);
      }
    } catch {
      // Fence failures must not throw on the heartbeat hot path.
    }
  }

  const state: GroupTaskHeartbeatState = {
    groupId,
    lastScanAt: nowMs,
    items: nextItems,
  };
  await writeState(authority, state, cfg);

  // Optional audit line (observe-only jsonl; not transcript).
  try {
    assertCollaborationRuntimeWritable(dir, cfg);
    const stem = safeStem(groupId);
    if (stem) {
      await withRoundLock(dir, `${stem}.scans`, async () => {
        await fs.mkdir(dir, { recursive: true });
        await appendJsonlDurable(path.join(dir, `${stem}.scans.jsonl`), {
          kind: "group_task_heartbeat_scan",
          at: nowMs,
          groupId,
          writeMode,
          dryRun,
          itemCount: items.length,
          decisionCount: decisions.length,
          wakeCount: wakeEvents.length,
          actions: decisions
            .filter((d) => d.action !== "skip")
            .map((d) => ({ itemId: d.itemId, action: d.action, reason: d.reason })),
          claimBridge: claimBridge
            ? {
                attempted: claimBridge.attempted,
                claimed: claimBridge.claimed,
                reason: claimBridge.reason,
                leadAgentId: claimBridge.leadAgentId,
                boardItemId: claimBridge.boardItemId,
              }
            : undefined,
        });
      });
    }
  } catch {
    // scan log is best-effort
  }

  return {
    ok: true,
    groupId,
    scannedAt: nowMs,
    itemCount: items.length,
    decisions,
    wakeEvents,
    state,
    writeMode,
    ...(claimBridge ? { claimBridge } : {}),
    ...(unattended?.handled ? { unattended } : {}),
  };
}

/** Optional P3.4: one admin C0/C1 daily summary message (not spam). */
export function buildAdminDailySummaryMessage(params: {
  groupId: string;
  items: readonly HeartbeatBoardItemLike[];
  wakeEvents: readonly WakeEvent[];
  generatedAtMs?: number;
}): string {
  const at = params.generatedAtMs ?? Date.now();
  const iso = new Date(at).toISOString();
  const active = params.items.filter((i) => !TERMINAL.has(i.status));
  const unclaimed = active.filter((i) => i.status === "published");
  const blocked = active.filter((i) => i.status === "blocked" || i.status === "returned");
  const inFlight = active.filter((i) =>
    ["claimed", "applied", "in_progress", "submitted_for_review"].includes(i.status),
  );
  const timeline = whoWokeWhom(params.wakeEvents).slice(-12);
  const lines: string[] = [];
  lines.push(`【协作日摘要】${params.groupId} · ${iso}`);
  lines.push(
    `看板：活跃 ${active.length}（未认领 ${unclaimed.length} / 推进中 ${inFlight.length} / 阻塞或退回 ${blocked.length}）`,
  );
  if (unclaimed.length > 0) {
    lines.push(
      `未认领：${unclaimed
        .slice(0, 5)
        .map((i) => `${i.taskId}/${i.itemId}`)
        .join(", ")}`,
    );
  }
  if (blocked.length > 0) {
    lines.push(
      `阻塞/退回：${blocked
        .slice(0, 5)
        .map((i) => `${i.status}:${compact(i.claimantId) || "?"}@${i.itemId}`)
        .join(", ")}`,
    );
  }
  if (timeline.length > 0) {
    lines.push("最近唤醒（whoWokeWhom）：");
    for (const row of timeline) {
      lines.push(`- ${row.source}: ${row.from} → ${row.to || "(none)"} @${row.at}`);
    }
  } else {
    lines.push("最近唤醒：无（wake 账本空或旗关）");
  }
  lines.push("（单条管理摘要；非刷屏。心跳只写 wake，不冒充 transcript 完成。）");
  return lines.join("\n");
}

export async function buildAdminDailySummaryForGroup(
  authority: RuntimeAuthority,
  params: { groupId: string; cfg?: OpenBotConfig; nowMs?: number },
): Promise<{ message: string; items: HeartbeatBoardItemLike[]; wakeEvents: WakeEvent[] }> {
  const items = await loadGroupBoardItemsForHeartbeatRich(authority, params.groupId);
  const wakeEvents = await listWakeEvents(authority, { groupId: params.groupId });
  const message = buildAdminDailySummaryMessage({
    groupId: params.groupId,
    items,
    wakeEvents,
    generatedAtMs: params.nowMs,
  });
  return { message, items, wakeEvents };
}

/** Status helper for readers (no flag required). */
export type BoardClaimStatusForHeartbeat = BoardClaimStatus;
