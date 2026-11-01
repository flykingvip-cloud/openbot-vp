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
import type { Task } from "@openbot/collaboration-core";
import { loadConfig } from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import { createWorkspaceCollaborationStores } from "../collaboration-learning/shared.js";
import {
  TRUSTED_GROUP_LOCATOR_REQUIRED,
  resolveStoresFromGroupLocator,
} from "../collaboration-learning/team-resource-auth.js";
import { resolveSecurityProfile } from "../security-profile.js";
import {
  boardClaimsDir,
  resolveAcceptanceLoopMaxReturns,
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
import { recheckCurrentDispatchAuthorization } from "./task-dispatch-auth-recheck.js";
import { asGovernedTask } from "./task-runtime.js";
import { isTaskStopAccepted } from "./task-stop-control.js";
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
  /** Set only after a successful emit escalate for the matching fingerprint. */
  lastEscalateAt?: number;
  /** Fingerprint that lastEscalateAt applies to (stage-bound anti-spam). */
  lastEscalateFingerprint?: string;
  /** Bounded escalate dispatch failures on the current fingerprint. */
  escalateFailCount?: number;
  lastEscalateAttemptAt?: number;
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

function uniqueIds(values: readonly (string | null | undefined)[] | undefined): string[] {
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

function clearEscalateFieldsWhenFingerprintChanges(
  prior: GroupTaskHeartbeatItemState | null | undefined,
  fingerprint: string,
): Pick<
  GroupTaskHeartbeatItemState,
  "lastEscalateAt" | "lastEscalateFingerprint" | "escalateFailCount" | "lastEscalateAttemptAt"
> {
  const priorFp = compact(prior?.lastFingerprint);
  if (priorFp && priorFp !== fingerprint) {
    // New progress stage: old escalate must not suppress supervision.
    return {};
  }
  const escalateFp = compact(prior?.lastEscalateFingerprint);
  if (escalateFp && escalateFp !== fingerprint) {
    return {};
  }
  return {
    lastEscalateAt: prior?.lastEscalateAt,
    lastEscalateFingerprint: prior?.lastEscalateFingerprint,
    escalateFailCount: prior?.escalateFailCount,
    lastEscalateAttemptAt: prior?.lastEscalateAttemptAt,
  };
}

function nudgeTargets(item: GroupBoardClaimItem | HeartbeatBoardItemLike): string[] {
  // submitted_for_review: wake reviewer chain (align with claim-contract submit wake),
  // never the executor claimant alone.
  if (item.status === "submitted_for_review") {
    const reviewTargets = uniqueIds([
      (item as HeartbeatBoardItemLike).reviewerId,
      (item as HeartbeatBoardItemLike).approverId,
      (item as HeartbeatBoardItemLike).coordinatorId,
      (item as HeartbeatBoardItemLike).decisionAuthorityId,
      (item as HeartbeatBoardItemLike).ownerId,
      item.publishedBy,
    ]);
    if (reviewTargets.length > 0) {
      return reviewTargets;
    }
  }
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
  /** S3: return cycles; used to stop post-cap revise nudges (O4). */
  returnCount?: number;
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
  /** Task responsibility projections for review-stage routing (optional). */
  reviewerId?: string;
  approverId?: string;
  coordinatorId?: string;
  ownerId?: string;
  decisionAuthorityId?: string;
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
  /** When set, returned items at/over this cap never revise-nudge the claimant (O4). */
  acceptanceLoopMaxReturns?: number;
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

  // P4/O4: after acceptance-loop cap, do not revise-nudge the original executor.
  // Upgrade/escalation handling only (coordinator); skip if already escalated on same fingerprint.
  if (item.status === "returned") {
    const maxReturns =
      typeof params.acceptanceLoopMaxReturns === "number" &&
      Number.isFinite(params.acceptanceLoopMaxReturns) &&
      params.acceptanceLoopMaxReturns > 0
        ? Math.floor(params.acceptanceLoopMaxReturns)
        : undefined;
    const returnCount = typeof item.returnCount === "number" ? item.returnCount : 0;
    if (maxReturns !== undefined && returnCount >= maxReturns) {
      const accEscalateFp = compact(prior?.lastEscalateFingerprint);
      const accEscalated =
        Boolean(prior?.lastEscalateAt) && Boolean(accEscalateFp) && accEscalateFp === fingerprint;
      if (sameAsPrior && accEscalated) {
        return {
          itemId: item.itemId,
          taskId: item.taskId,
          groupId: item.groupId,
          status: item.status,
          action: "skip",
          toAgentIds: [],
          reason: "acceptance_loop_exceeded_awaiting_upgrade",
          consecutiveNoResponse: consecutive,
        };
      }
      if (params.escalateTo.length > 0) {
        return {
          itemId: item.itemId,
          taskId: item.taskId,
          groupId: item.groupId,
          status: item.status,
          action: "escalate",
          toAgentIds: uniqueIds(params.escalateTo),
          reason: `acceptance_loop_exceeded_escalate_only:${returnCount}/${maxReturns}`,
          consecutiveNoResponse: consecutive,
        };
      }
      return {
        itemId: item.itemId,
        taskId: item.taskId,
        groupId: item.groupId,
        status: item.status,
        action: "skip",
        toAgentIds: [],
        reason: `acceptance_loop_exceeded_no_revise:${returnCount}/${maxReturns}`,
        consecutiveNoResponse: consecutive,
      };
    }
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

  // Same progress fingerprint after a *successful emit* escalate: anti-spam.
  // Observe-mode stamps and failed dispatches must not suppress later emit.
  const escalateFp = compact(prior?.lastEscalateFingerprint);
  const successfulEscalateOnFingerprint =
    Boolean(prior?.lastEscalateAt) && Boolean(escalateFp) && escalateFp === fingerprint;
  if (sameAsPrior && successfulEscalateOnFingerprint) {
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
  // Bounded recovery after escalate dispatch failures on this fingerprint.
  const failCount = sameAsPrior ? (prior?.escalateFailCount ?? 0) : 0;
  if (sameAsPrior && failCount >= 3) {
    return {
      itemId: item.itemId,
      taskId: item.taskId,
      groupId: item.groupId,
      status: item.status,
      action: "skip",
      toAgentIds: [],
      reason: `escalate_failures_exhausted:${reasonBase}`,
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
  returnCount?: number;
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
  reviewerId?: string;
  approverId?: string;
  coordinatorId?: string;
  ownerId?: string;
  decisionAuthorityId?: string;
}): HeartbeatBoardItemLike {
  return {
    itemId: raw.itemId,
    groupId: raw.groupId,
    taskId: raw.taskId,
    title: raw.title,
    status: raw.status,
    returnCount: raw.returnCount,
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
    reviewerId: raw.reviewerId,
    approverId: raw.approverId,
    coordinatorId: raw.coordinatorId,
    ownerId: raw.ownerId,
    decisionAuthorityId: raw.decisionAuthorityId,
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
        returnCount: (row as { returnCount?: number }).returnCount,
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

function resolveHeartbeatStores(params: { authority?: RuntimeAuthority; cfg?: OpenBotConfig }): {
  objectStorage: ReturnType<typeof createWorkspaceCollaborationStores>["objectStorage"];
  fileStore: ReturnType<typeof createWorkspaceCollaborationStores>["fileStore"];
} {
  const locator =
    typeof params.authority?.namespace?.groupLocator === "string"
      ? params.authority.namespace.groupLocator.trim()
      : "";
  if (locator) {
    const resolved = resolveStoresFromGroupLocator({ groupLocator: locator, cfg: params.cfg });
    if (resolved.ok) {
      return { objectStorage: resolved.objectStorage, fileStore: resolved.fileStore };
    }
  }
  const profile = resolveSecurityProfile(params.cfg).profile;
  if (profile === "managed_enterprise") {
    throw new Error(
      `${TRUSTED_GROUP_LOCATOR_REQUIRED}: heartbeat refused without authority.namespace.groupLocator`,
    );
  }
  const legacy = createWorkspaceCollaborationStores(params.cfg);
  return { objectStorage: legacy.objectStorage, fileStore: legacy.fileStore };
}

async function isPersistedTaskStopped(params: {
  groupId: string;
  taskId: string;
  cfg?: OpenBotConfig;
  authority?: RuntimeAuthority;
  objectStorage?: ReturnType<typeof createWorkspaceCollaborationStores>["objectStorage"];
}): Promise<boolean> {
  const taskId = params.taskId.trim();
  if (!taskId) {
    return false;
  }
  try {
    const objectStorage =
      params.objectStorage ??
      resolveHeartbeatStores({ authority: params.authority, cfg: params.cfg }).objectStorage;
    const current = await objectStorage.readObject<Task>(params.groupId, "task", taskId);
    return Boolean(current && isTaskStopAccepted(asGovernedTask(current)));
  } catch {
    return false;
  }
}

/** U2 sibling of stop preflight: refuse HB wake emit when targets/duty revoked. */
async function isPersistedDispatchAuthRevoked(params: {
  groupId: string;
  taskId: string;
  targetActorIds: readonly string[];
  cfg?: OpenBotConfig;
  authority?: RuntimeAuthority;
  fileStore?: ReturnType<typeof createWorkspaceCollaborationStores>["fileStore"];
  objectStorage?: ReturnType<typeof createWorkspaceCollaborationStores>["objectStorage"];
}): Promise<boolean> {
  const stores =
    params.fileStore && params.objectStorage
      ? { fileStore: params.fileStore, objectStorage: params.objectStorage }
      : resolveHeartbeatStores({ authority: params.authority, cfg: params.cfg });
  const auth = await recheckCurrentDispatchAuthorization({
    groupId: params.groupId,
    taskId: params.taskId,
    targetActorIds: params.targetActorIds,
    cfg: params.cfg,
    fileStore: stores.fileStore,
    objectStorage: stores.objectStorage,
  });
  return !auth.ok;
}

async function enrichHeartbeatItemsWithTaskResponsibility(
  authority: RuntimeAuthority,
  items: readonly HeartbeatBoardItemLike[],
  cfg?: OpenBotConfig,
): Promise<HeartbeatBoardItemLike[]> {
  if (items.length === 0) {
    return [];
  }
  const stores = resolveHeartbeatStores({ authority, cfg });
  const cache = new Map<
    string,
    {
      reviewerId?: string;
      approverId?: string;
      coordinatorId?: string;
      ownerId?: string;
      decisionAuthorityId?: string;
    }
  >();
  const out: HeartbeatBoardItemLike[] = [];
  for (const item of items) {
    const taskId = compact(item.taskId);
    if (!taskId) {
      out.push(item);
      continue;
    }
    let resp = cache.get(taskId);
    if (!resp) {
      try {
        const current = await stores.objectStorage.readObject<Task>(
          item.groupId || authority.groupId,
          "task",
          taskId,
        );
        const responsibility = (
          current as {
            responsibility?: {
              reviewer?: string;
              approver?: string;
              coordinator?: string;
              owner?: string;
              decisionAuthority?: string;
            };
          } | null
        )?.responsibility;
        resp = {
          reviewerId: compact(responsibility?.reviewer) || undefined,
          approverId: compact(responsibility?.approver) || undefined,
          coordinatorId: compact(responsibility?.coordinator) || undefined,
          ownerId: compact(responsibility?.owner) || undefined,
          decisionAuthorityId: compact(responsibility?.decisionAuthority) || undefined,
        };
      } catch {
        resp = {};
      }
      cache.set(taskId, resp);
    }
    out.push({
      ...item,
      ...resp,
    });
  }
  return out;
}

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

  const loadedItems = await loadGroupBoardItemsForHeartbeatRich(authority, groupId);
  const items = await enrichHeartbeatItemsWithTaskResponsibility(authority, loadedItems, cfg);
  const escalateTo = resolveEscalateTargets(options);
  const actorId = compact(options?.actorId) || "system:group_task_heartbeat";
  const decisions: HeartbeatItemDecision[] = [];
  const wakeEvents: WakeEvent[] = [];
  const nextItems: Record<string, GroupTaskHeartbeatItemState> = { ...priorState.items };

  // P2: durable pendingEventRelay recovery via existing heartbeat path (same opKey; no new queue).
  // Reload FULL board claim rows (not HeartbeatBoardItemLike) so pendingEventRelay is visible.
  // P4/O14: items with pendingEventRelay (or recovered/dispatched this tick) must not also
  // get heartbeat nudge/escalate execute — same work-item side-effect count, not opKey-only.
  const relayGuardedItemIds = new Set<string>();
  if (!dryRun && !unattendedTarget) {
    try {
      const { recoverPendingBoardEventRelays } =
        await import("../collaboration-learning/post-submission-event-advance.js");
      const { loadBoardClaimItem } = await import("./claim-contract.js");
      const groupLocator = compact(authority.namespace?.groupLocator);
      const trusted =
        groupLocator.length > 0
          ? {
              groupLocator,
              groupsRoot: path.dirname(groupLocator),
            }
          : null;
      const tenantId = compact(options?.tenantId) || compact(authority.tenantId) || null;
      const byTask = new Map<string, string[]>();
      for (const item of items) {
        const list = byTask.get(item.taskId) ?? [];
        list.push(item.itemId);
        byTask.set(item.taskId, list);
      }
      for (const [taskId, itemIds] of byTask) {
        const fullItems = [];
        for (const itemId of itemIds) {
          const full = await loadBoardClaimItem(authority, { taskId, itemId });
          if (full) {
            fullItems.push(full);
            if (full.pendingEventRelay) {
              relayGuardedItemIds.add(full.itemId);
            }
          }
        }
        if (fullItems.length === 0) {
          continue;
        }
        // Same tenant + store root as this heartbeat's verified authority — never null/legacy.
        const recovered = await recoverPendingBoardEventRelays({
          groupId,
          taskId,
          actorId,
          items: fullItems,
          tenant: tenantId ? { tenantId, trust: "none" } : null,
          trusted,
          cfg,
          roundDispatcher: options?.roundDispatcher,
          requireTrustedScope: true,
          authority,
        });
        for (const row of recovered) {
          if (row.dispatched || row.wakeConsumed || row.wakeRecorded) {
            for (const full of fullItems) {
              if (full.pendingEventRelay?.opKey && row.opKey === full.pendingEventRelay.opKey) {
                relayGuardedItemIds.add(full.itemId);
              }
            }
            // Also guard by matching any recovered item that still maps to this task's set.
            for (const itemId of itemIds) {
              // Prefer explicit: if this recover batch ran for these items, keep prior guards.
              void itemId;
            }
          }
        }
        // After recover, re-check live pending and keep guard for any still-pending or just-cleared.
        for (const itemId of itemIds) {
          if (relayGuardedItemIds.has(itemId)) {
            continue;
          }
          const live = await loadBoardClaimItem(authority, { taskId, itemId });
          if (live?.pendingEventRelay) {
            relayGuardedItemIds.add(itemId);
          }
        }
      }
    } catch {
      // Recovery is best-effort; pending markers remain durable for the next scan.
    }
  }

  for (const item of items) {
    if (relayGuardedItemIds.has(item.itemId)) {
      decisions.push({
        itemId: item.itemId,
        taskId: item.taskId,
        groupId: item.groupId,
        status: item.status,
        action: "skip",
        toAgentIds: [],
        reason: "pending_event_relay_guard",
        consecutiveNoResponse: priorState.items[item.itemId]?.consecutiveNoResponse ?? 0,
      });
      const fingerprint = progressFingerprint(item);
      const priorRelay = priorState.items[item.itemId];
      nextItems[item.itemId] = {
        consecutiveNoResponse: priorRelay?.consecutiveNoResponse ?? 0,
        lastFingerprint: fingerprint,
        lastStatus: item.status,
        lastNudgeAt: priorRelay?.lastNudgeAt,
        ...clearEscalateFieldsWhenFingerprintChanges(priorRelay, fingerprint),
      };
      continue;
    }
    const prior = priorState.items[item.itemId];
    const decision = planHeartbeatActionForItem({
      item,
      prior,
      nowMs,
      escalateAfter,
      escalateTo,
      acceptanceLoopMaxReturns: resolveAcceptanceLoopMaxReturns(cfg),
    });
    decisions.push(decision);

    if (decision.action === "skip") {
      if (TERMINAL.has(item.status)) {
        delete nextItems[item.itemId];
      } else {
        const fingerprint = progressFingerprint(item);
        nextItems[item.itemId] = {
          consecutiveNoResponse: 0,
          lastFingerprint: fingerprint,
          lastStatus: item.status,
          lastNudgeAt: prior?.lastNudgeAt,
          ...clearEscalateFieldsWhenFingerprintChanges(prior, fingerprint),
        };
      }
      continue;
    }

    if (decision.action === "nudge") {
      const fingerprint = progressFingerprint(item);
      const escalateCarry = clearEscalateFieldsWhenFingerprintChanges(prior, fingerprint);
      if (!dryRun && !unattendedTarget) {
        if (await isPersistedTaskStopped({ groupId, taskId: item.taskId, cfg, authority })) {
          nextItems[item.itemId] = {
            consecutiveNoResponse: prior?.consecutiveNoResponse ?? 0,
            lastNudgeAt: prior?.lastNudgeAt,
            lastFingerprint: fingerprint,
            lastStatus: item.status,
            ...escalateCarry,
          };
          continue;
        }
        // U2: auth recheck at same position as U1 stop (does not replace stop).
        if (
          await isPersistedDispatchAuthRevoked({
            groupId,
            taskId: item.taskId,
            targetActorIds: decision.toAgentIds,
            cfg,
            authority,
          })
        ) {
          nextItems[item.itemId] = {
            consecutiveNoResponse: prior?.consecutiveNoResponse ?? 0,
            lastNudgeAt: prior?.lastNudgeAt,
            lastFingerprint: fingerprint,
            lastStatus: item.status,
            ...escalateCarry,
          };
          continue;
        }
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
        // Emit path: only credit a nudge when dispatch was accepted with receipt.
        // Failed/recorded must not advance anti-spam counters as if delivered.
        if (!consume.dispatched) {
          nextItems[item.itemId] = {
            consecutiveNoResponse: prior?.consecutiveNoResponse ?? 0,
            lastNudgeAt: prior?.lastNudgeAt,
            lastFingerprint: fingerprint,
            lastStatus: item.status,
            ...escalateCarry,
          };
          continue;
        }
      } else {
        // Observe / dry-run: record planned fingerprint without emitting escalate stamps.
        const same = prior?.lastFingerprint === fingerprint;
        nextItems[item.itemId] = {
          consecutiveNoResponse: same ? (prior?.consecutiveNoResponse ?? 0) + 1 : 1,
          lastNudgeAt: nowMs,
          lastFingerprint: fingerprint,
          lastStatus: item.status,
          ...escalateCarry,
        };
        continue;
      }
      const same = prior?.lastFingerprint === fingerprint;
      nextItems[item.itemId] = {
        consecutiveNoResponse: same ? (prior?.consecutiveNoResponse ?? 0) + 1 : 1,
        lastNudgeAt: nowMs,
        lastFingerprint: fingerprint,
        lastStatus: item.status,
        ...escalateCarry,
      };
      continue;
    }

    if (decision.action === "escalate") {
      const fingerprint = progressFingerprint(item);
      const escalateCarry = clearEscalateFieldsWhenFingerprintChanges(prior, fingerprint);
      if (!dryRun && !unattendedTarget) {
        if (await isPersistedTaskStopped({ groupId, taskId: item.taskId, cfg, authority })) {
          nextItems[item.itemId] = {
            consecutiveNoResponse: prior?.consecutiveNoResponse ?? 0,
            lastNudgeAt: prior?.lastNudgeAt,
            lastFingerprint: fingerprint,
            lastStatus: item.status,
            ...escalateCarry,
          };
          continue;
        }
        // U2: auth recheck at same position as U1 stop (does not replace stop).
        if (
          await isPersistedDispatchAuthRevoked({
            groupId,
            taskId: item.taskId,
            targetActorIds: decision.toAgentIds,
            cfg,
            authority,
          })
        ) {
          nextItems[item.itemId] = {
            consecutiveNoResponse: prior?.consecutiveNoResponse ?? 0,
            lastNudgeAt: prior?.lastNudgeAt,
            lastFingerprint: fingerprint,
            lastStatus: item.status,
            ...escalateCarry,
          };
          continue;
        }
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
        if (consume.dispatched) {
          nextItems[item.itemId] = {
            consecutiveNoResponse: 0,
            lastNudgeAt: prior?.lastNudgeAt,
            lastEscalateAt: nowMs,
            lastEscalateFingerprint: fingerprint,
            escalateFailCount: 0,
            lastEscalateAttemptAt: nowMs,
            lastFingerprint: fingerprint,
            lastStatus: item.status,
          };
        } else {
          const priorFails =
            compact(prior?.lastFingerprint) === fingerprint ? (prior?.escalateFailCount ?? 0) : 0;
          nextItems[item.itemId] = {
            consecutiveNoResponse: prior?.consecutiveNoResponse ?? 0,
            lastNudgeAt: prior?.lastNudgeAt,
            lastFingerprint: fingerprint,
            lastStatus: item.status,
            escalateFailCount: priorFails + 1,
            lastEscalateAttemptAt: nowMs,
            // Keep a prior successful escalate on this fingerprint if any; else none.
            ...(escalateCarry.lastEscalateAt
              ? {
                  lastEscalateAt: escalateCarry.lastEscalateAt,
                  lastEscalateFingerprint: escalateCarry.lastEscalateFingerprint,
                }
              : {}),
          };
        }
        continue;
      }
      // Observe / dry-run: never stamp lastEscalateAt (would suppress later emit).
      nextItems[item.itemId] = {
        consecutiveNoResponse: 0,
        lastNudgeAt: prior?.lastNudgeAt,
        lastFingerprint: fingerprint,
        lastStatus: item.status,
        ...escalateCarry,
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
