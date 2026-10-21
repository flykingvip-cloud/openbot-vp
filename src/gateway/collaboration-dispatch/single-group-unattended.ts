/**
 * Batch 5 — single-target-group unattended lane on the existing heartbeat /
 * self_advance / wake path.
 *
 * This module does not grant submit, submitForReview, self_advance, accept, or
 * finalize. It does not flip wake, claim, heartbeat scheduler, selfAdvance
 * execute, or L2 `botMaySelfAdvanceWithoutHuman`. Default allowlist is empty.
 * More than one allowlist entry authorizes nobody (not "any group").
 *
 * Effective progress is a confirmed-plan step or a verifiable output.
 * Wake outcome `recorded` is not effective progress.
 *
 * Hard stop (unauthorized accept/finalize, stale confirmation, duplicate
 * external side effect) cancels queued work and holds in-progress work. It
 * does not only clear a scheduler flag.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { OpenBotConfig } from "../../config/types.js";
import type { CollaborationTenantTrustLevel } from "../collaboration-learning/trusted-tenant.js";
import { resolveSecurityProfile } from "../security-profile.js";
import { resolveTrustedGroupLocator } from "../workspace/group-locator.js";
import { matchGrayGroupAllowlist, parseGrayGroupAllowlistEntry } from "./gray-group-allowlist.js";
import { withRoundLock } from "./round-store-io.js";
import type { RuntimeAuthority } from "./runtime-authority.js";
import {
  buildRuntimeNamespace,
  isCollabRuntimeNamespaceEnabled,
  resolveRuntimeNamespace,
  type RuntimeNamespaceProfile,
} from "./runtime-namespace.js";
import type { WakeEvent } from "./wake-contract.js";
import {
  consumeWakeForRoundDispatch,
  getWakeRoundDispatcher,
  type ConsumeWakeRoundDispatchResult,
  type WakeRoundDispatcher,
  type WakeRoundDispatchSource,
} from "./wake-round-dispatch.js";

const DEFAULT_SCAN_INTERVAL_MS = 30 * 60 * 1000;

export const UNATTENDED_PROGRESS_KINDS = ["confirmed_step", "verifiable_output"] as const;

export type UnattendedProgressKind = (typeof UNATTENDED_PROGRESS_KINDS)[number];

export type UnattendedActionKind = "draft" | "create_calendar" | "send_invite" | "other_external";

export type UnattendedHardStopReason =
  | "unauthorized_accept"
  | "unauthorized_finalize"
  | "stale_confirmation"
  | "duplicate_external_side_effect";

export type UnattendedWorkPhase = "queued" | "in_progress" | "done" | "cancelled" | "held";

export type UnattendedWorkItem = {
  id: string;
  tickId: string;
  taskId: string;
  itemId: string;
  stepId: string;
  planVersion: number;
  actionKind: UnattendedActionKind;
  phase: UnattendedWorkPhase;
  enqueuedAt: number;
  startedAt?: number;
  finishedAt?: number;
  holdReason?: string;
};

export type UnattendedProgressEvent = {
  kind: UnattendedProgressKind;
  taskId: string;
  itemId: string;
  stepId: string;
  planVersion: number;
  at: number;
  idempotencyKey: string;
};

export type UnattendedHardStop = {
  active: boolean;
  reason: UnattendedHardStopReason;
  at: number;
  detail: string;
};

export type UnattendedHumanGate = {
  at: number;
  taskId: string;
  itemId: string;
  stepId: string;
  actionKind: UnattendedActionKind;
  reason: string;
};

export type UnattendedEffect = {
  key: string;
  actionKind: UnattendedActionKind;
  external: boolean;
  at: number;
  taskId: string;
  stepId: string;
};

export type UnattendedLaneState = {
  groupId: string;
  hardStop: UnattendedHardStop | null;
  work: UnattendedWorkItem[];
  progress: UnattendedProgressEvent[];
  effects: UnattendedEffect[];
  humanGates: UnattendedHumanGate[];
  externalSeen: Record<string, number>;
  lastProgressAt: number;
};

export type UnattendedTickResult = {
  handled: boolean;
  reason: string;
  message: string;
  effectiveProgress: readonly UnattendedProgressEvent[];
  /** Dispatcher invocations that were committed (wake outcome dispatched). */
  committedDispatchCount: number;
  /** Live dispatcher entries this tick, including an in-flight call that was not committed. */
  inflightDispatchCount: number;
  /** External tool emissions (calendar / invite). The lane never commits these. */
  externalSideEffectCount: number;
  humanGate: boolean;
  hardStop: UnattendedHardStop | null;
  queued: number;
  inProgress: number;
  cancelled: number;
  held: number;
  wakeEvent?: WakeEvent;
  consume?: ConsumeWakeRoundDispatchResult;
  committedDispatch: boolean;
};

export type UnattendedBoardItem = {
  itemId: string;
  taskId: string;
  status: string;
  claimantId?: string;
  inProgressAt?: number;
  appliedAt?: number;
};

const EMPTY_TICK: UnattendedTickResult = {
  handled: false,
  reason: "not_target",
  message: "group is not the single unattended target",
  effectiveProgress: [],
  committedDispatchCount: 0,
  inflightDispatchCount: 0,
  externalSideEffectCount: 0,
  humanGate: false,
  hardStop: null,
  queued: 0,
  inProgress: 0,
  cancelled: 0,
  held: 0,
  committedDispatch: false,
};

function compact(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function safeStem(id: string): string | null {
  const trimmed = id.trim();
  if (!trimmed || trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("..")) {
    return null;
  }
  return encodeURIComponent(trimmed);
}

/** Platform default: no group is an unattended target. */
export function singleGroupUnattendedDefaultsOff(): true {
  return true;
}

export function listSingleGroupUnattendedAllowlist(cfg?: OpenBotConfig): string[] {
  const raw = cfg?.collaboration?.task?.singleGroupUnattended?.groupAllowlist;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter(
    (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
  );
}

/**
 * True only when the allowlist parses to exactly one group and it matches.
 * Empty and multi-group lists authorize nobody.
 */
export function isSingleGroupUnattendedTarget(
  cfg: OpenBotConfig | undefined,
  groupId: string,
  tenantId?: string | null,
): boolean {
  const entries = listSingleGroupUnattendedAllowlist(cfg);
  const parsed = entries
    .map((entry) => parseGrayGroupAllowlistEntry(entry))
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  if (parsed.length !== 1) {
    return false;
  }
  return matchGrayGroupAllowlist({
    groupId,
    tenantId,
    entries,
  });
}

export function classifyMissionAction(text: string | null | undefined): UnattendedActionKind {
  const raw = compact(text);
  if (!raw) {
    return "draft";
  }
  const calendar = /创建日历|建日历|新建日历|create calendar|add calendar|calendar event/i.test(
    raw,
  );
  const invite = /发送邀请|发邀请|发送会议邀请|send invite|send invitation/i.test(raw);
  if (calendar) {
    return "create_calendar";
  }
  if (invite) {
    return "send_invite";
  }
  return "draft";
}

export function isExternalMissionAction(kind: UnattendedActionKind): boolean {
  return kind !== "draft";
}

export function isUnattendedStaleConfirmationReason(reason: string): boolean {
  return (
    reason === "stale_version" ||
    reason === "version_mismatch" ||
    reason === "card_invalid" ||
    reason === "expected_version_required"
  );
}

function scanIntervalMs(cfg?: OpenBotConfig): number {
  const raw = cfg?.collaboration?.task?.groupTaskHeartbeat?.scanIntervalMs;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return Math.floor(raw);
  }
  return DEFAULT_SCAN_INTERVAL_MS;
}

export function resolveUnattendedLaneRoot(params: {
  authority?: RuntimeAuthority | null;
  groupId: string;
  cfg: OpenBotConfig;
  tenantId?: string | null;
  tenantTrust?: CollaborationTenantTrustLevel;
  profile?: RuntimeNamespaceProfile;
}): string {
  if (params.authority) {
    return params.authority.namespace.root;
  }
  const groupId = compact(params.groupId);
  const profile = params.profile ?? resolveSecurityProfile(params.cfg).profile;
  const tenantId = compact(params.tenantId) || null;
  const tenantTrust = params.tenantTrust ?? (tenantId ? "actor_fallback" : "none");
  if (!isCollabRuntimeNamespaceEnabled(params.cfg)) {
    return buildRuntimeNamespace({
      profile: "personal_local",
      tenantId: null,
      groupId,
      groupLocator: resolveTrustedGroupLocator({
        groupId,
        tenantId: null,
        profile: "personal_local",
        cfg: params.cfg,
      }),
    }).root;
  }
  return resolveRuntimeNamespace({
    tenantId,
    tenantTrust,
    groupId,
    profile,
    cfg: params.cfg,
  }).root;
}

function laneDir(root: string): string {
  return path.join(root, "single-group-unattended");
}

function lanePath(root: string, groupId: string): string | null {
  const stem = safeStem(groupId);
  if (!stem) {
    return null;
  }
  return path.join(laneDir(root), `${stem}.json`);
}

function emptyState(groupId: string): UnattendedLaneState {
  return {
    groupId,
    hardStop: null,
    work: [],
    progress: [],
    effects: [],
    humanGates: [],
    externalSeen: {},
    lastProgressAt: 0,
  };
}

function countPhase(state: UnattendedLaneState, phase: UnattendedWorkPhase): number {
  return state.work.filter((item) => item.phase === phase).length;
}

function countsOf(
  state: UnattendedLaneState,
): Pick<UnattendedTickResult, "queued" | "inProgress" | "cancelled" | "held" | "hardStop"> {
  return {
    queued: countPhase(state, "queued"),
    inProgress: countPhase(state, "in_progress"),
    cancelled: countPhase(state, "cancelled"),
    held: countPhase(state, "held"),
    hardStop: state.hardStop,
  };
}

async function readStateFile(file: string, groupId: string): Promise<UnattendedLaneState> {
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw) as UnattendedLaneState;
    if (!parsed || typeof parsed !== "object") {
      return emptyState(groupId);
    }
    return {
      ...emptyState(groupId),
      ...parsed,
      groupId,
      work: Array.isArray(parsed.work) ? parsed.work : [],
      progress: Array.isArray(parsed.progress) ? parsed.progress : [],
      effects: Array.isArray(parsed.effects) ? parsed.effects : [],
      humanGates: Array.isArray(parsed.humanGates) ? parsed.humanGates : [],
      externalSeen:
        parsed.externalSeen && typeof parsed.externalSeen === "object" ? parsed.externalSeen : {},
      lastProgressAt:
        typeof parsed.lastProgressAt === "number" && Number.isFinite(parsed.lastProgressAt)
          ? parsed.lastProgressAt
          : 0,
      hardStop: parsed.hardStop?.active ? parsed.hardStop : (parsed.hardStop ?? null),
    };
  } catch {
    return emptyState(groupId);
  }
}

async function writeStateFile(file: string, state: UnattendedLaneState): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(state)}\n`, "utf8");
}

async function updateLane(
  authority: RuntimeAuthority,
  groupId: string,
  mutate: (state: UnattendedLaneState) => void,
): Promise<UnattendedLaneState> {
  const root = authority.namespace.root;
  const file = lanePath(root, groupId);
  if (!file) {
    return emptyState(groupId);
  }
  const dir = laneDir(root);
  const stem = safeStem(groupId);
  if (!stem) {
    return emptyState(groupId);
  }
  return withRoundLock(dir, stem, async () => {
    const state = await readStateFile(file, groupId);
    mutate(state);
    await writeStateFile(file, state);
    return state;
  });
}

export async function readUnattendedLaneState(
  authority: RuntimeAuthority,
): Promise<UnattendedLaneState> {
  const file = lanePath(authority.namespace.root, authority.groupId);
  if (!file) {
    return emptyState(authority.groupId);
  }
  return readStateFile(file, authority.groupId);
}

function drainWork(state: UnattendedLaneState, reason: UnattendedHardStopReason, nowMs: number) {
  for (const item of state.work) {
    if (item.phase === "queued") {
      item.phase = "cancelled";
      item.holdReason = reason;
      item.finishedAt = nowMs;
    } else if (item.phase === "in_progress") {
      item.phase = "held";
      item.holdReason = reason;
      item.finishedAt = nowMs;
    }
  }
}

function engage(
  state: UnattendedLaneState,
  reason: UnattendedHardStopReason,
  detail: string,
  nowMs: number,
) {
  drainWork(state, reason, nowMs);
  state.hardStop = { active: true, reason, at: nowMs, detail };
}

function effectKey(params: {
  groupId: string;
  taskId: string;
  itemId: string;
  planVersion: number;
  stepId: string;
  actionKind: UnattendedActionKind;
}): string {
  return [
    params.groupId,
    params.taskId,
    params.itemId,
    String(params.planVersion),
    params.stepId,
    params.actionKind,
  ].join("|");
}

function tickFromState(
  partial: Omit<
    UnattendedTickResult,
    "queued" | "inProgress" | "cancelled" | "held" | "hardStop" | "externalSideEffectCount"
  > & { externalSideEffectCount?: number },
  state: UnattendedLaneState,
): UnattendedTickResult {
  return {
    ...partial,
    externalSideEffectCount:
      partial.externalSideEffectCount ?? state.effects.filter((effect) => effect.external).length,
    ...countsOf(state),
  };
}

async function authorizeTarget(authority: RuntimeAuthority, cfg?: OpenBotConfig): Promise<boolean> {
  return isSingleGroupUnattendedTarget(cfg, authority.groupId, authority.tenantId);
}

export async function drainIfUnattendedHardStopped(
  authority: RuntimeAuthority,
  params: { cfg?: OpenBotConfig; nowMs: number },
): Promise<boolean> {
  if (!(await authorizeTarget(authority, params.cfg))) {
    return false;
  }
  const current = await readUnattendedLaneState(authority);
  if (!current.hardStop?.active) {
    return false;
  }
  await updateLane(authority, authority.groupId, (state) => {
    if (state.hardStop?.active) {
      drainWork(state, state.hardStop.reason, params.nowMs);
    }
  });
  return true;
}

export async function stageUnattendedWork(
  authority: RuntimeAuthority,
  params: {
    cfg?: OpenBotConfig;
    nowMs: number;
    taskId: string;
    itemId: string;
    planVersion: number;
    steps: readonly { stepId: string; actionKind: UnattendedActionKind }[];
  },
): Promise<UnattendedLaneState | null> {
  if (!(await authorizeTarget(authority, params.cfg))) {
    return null;
  }
  if (params.steps.length === 0) {
    return readUnattendedLaneState(authority);
  }
  const tickId = `stage:${params.nowMs}`;
  return updateLane(authority, authority.groupId, (state) => {
    if (state.hardStop?.active) {
      drainWork(state, state.hardStop.reason, params.nowMs);
      return;
    }
    params.steps.forEach((step, index) => {
      const already = state.work.some(
        (item) =>
          item.taskId === params.taskId && item.stepId === step.stepId && item.phase !== "done",
      );
      if (already) {
        return;
      }
      const phase: UnattendedWorkPhase = index === 0 ? "in_progress" : "queued";
      state.work.push({
        id: randomUUID(),
        tickId,
        taskId: params.taskId,
        itemId: params.itemId,
        stepId: step.stepId,
        planVersion: params.planVersion,
        actionKind: step.actionKind,
        phase,
        enqueuedAt: params.nowMs,
        ...(phase === "in_progress" ? { startedAt: params.nowMs } : {}),
      });
    });
  });
}

async function noteHardStop(
  authority: RuntimeAuthority,
  params: {
    cfg?: OpenBotConfig;
    reason: UnattendedHardStopReason;
    detail: string;
    nowMs: number;
  },
): Promise<boolean> {
  if (!(await authorizeTarget(authority, params.cfg))) {
    return false;
  }
  await updateLane(authority, authority.groupId, (state) => {
    engage(state, params.reason, params.detail, params.nowMs);
  });
  return true;
}

function actorIsLaneAuthority(params: {
  actorId: string;
  coordinatorBotId?: string | null;
  publishedBy?: string | null;
}): boolean {
  const actor = compact(params.actorId);
  if (!actor) {
    return false;
  }
  const coordinator = compact(params.coordinatorBotId);
  const publishedBy = compact(params.publishedBy);
  return actor === coordinator || actor === publishedBy;
}

/**
 * Lane-only. Other groups keep today's accept checks. Does not add an accept caller.
 * Unauthorized actors on the single target do not write, and the lane hard-stops.
 */
export async function guardUnattendedAccept(
  authority: RuntimeAuthority,
  params: {
    cfg?: OpenBotConfig;
    actorId: string;
    publishedBy?: string | null;
    coordinatorBotId?: string | null;
    taskId: string;
    itemId: string;
    nowMs?: number;
  },
): Promise<{ ok: false; reason: string; message: string } | null> {
  if (!(await authorizeTarget(authority, params.cfg))) {
    return null;
  }
  if (
    actorIsLaneAuthority({
      actorId: params.actorId,
      coordinatorBotId: params.coordinatorBotId,
      publishedBy: params.publishedBy,
    })
  ) {
    return null;
  }
  const nowMs = params.nowMs ?? Date.now();
  await noteHardStop(authority, {
    cfg: params.cfg,
    reason: "unauthorized_accept",
    detail: `actor ${compact(params.actorId) || "unknown"} cannot accept ${params.taskId}/${params.itemId}`,
    nowMs,
  });
  return {
    ok: false,
    reason: "unauthorized_accept",
    message:
      "single-group unattended lane: accept is limited to the coordinator or the board publisher; self_advance cannot accept",
  };
}

/**
 * Does not allow finalize. When the governance gate already refuses, or a bot
 * is not the coordinator/publisher, the single-target lane hard-stops.
 */
export async function guardUnattendedFinalize(params: {
  authority?: RuntimeAuthority | null;
  groupId: string;
  cfg?: OpenBotConfig;
  actorId: string;
  actorType: "human" | "bot";
  gateAllowed: boolean;
  coordinatorBotId?: string | null;
  publishedBy?: string | null;
  tenantId?: string | null;
  tenantTrust?: CollaborationTenantTrustLevel;
  profile?: RuntimeNamespaceProfile;
  nowMs?: number;
}): Promise<{ stopped: boolean }> {
  const cfg = params.cfg;
  const groupId = compact(params.groupId);
  if (
    !groupId ||
    !isSingleGroupUnattendedTarget(cfg, groupId, params.tenantId ?? params.authority?.tenantId)
  ) {
    return { stopped: false };
  }
  const authority = params.authority;
  if (!authority) {
    return { stopped: false };
  }
  const allowedActor = actorIsLaneAuthority({
    actorId: params.actorId,
    coordinatorBotId: params.coordinatorBotId,
    publishedBy: params.publishedBy,
  });
  const unauthorized = !params.gateAllowed || (params.actorType === "bot" && !allowedActor);
  if (!unauthorized) {
    return { stopped: false };
  }
  const nowMs = params.nowMs ?? Date.now();
  try {
    await noteHardStop(authority, {
      cfg,
      reason: "unauthorized_finalize",
      detail: `actor ${compact(params.actorId) || "unknown"} cannot finalize ${groupId}`,
      nowMs,
    });
  } catch {
    return { stopped: false };
  }
  return { stopped: true };
}

export async function noteUnattendedStaleConfirmation(
  authority: RuntimeAuthority,
  params: {
    cfg?: OpenBotConfig;
    reason: string;
    taskId: string;
    todolistId: string;
    nowMs?: number;
  },
): Promise<void> {
  if (!isUnattendedStaleConfirmationReason(params.reason)) {
    return;
  }
  try {
    await noteHardStop(authority, {
      cfg: params.cfg,
      reason: "stale_confirmation",
      detail: `${params.reason} on ${params.taskId}/${params.todolistId}`,
      nowMs: params.nowMs ?? Date.now(),
    });
  } catch {
    // The version gate refusal still stands when the latch cannot be written.
  }
}

/** Explicit human resume. Does not re-queue cancelled work and does not open execute. */
export async function releaseUnattendedHardStop(
  authority: RuntimeAuthority,
  params?: { cfg?: OpenBotConfig },
): Promise<boolean> {
  if (!(await authorizeTarget(authority, params?.cfg))) {
    return false;
  }
  let cleared = false;
  await updateLane(authority, authority.groupId, (state) => {
    if (state.hardStop?.active) {
      state.hardStop = null;
      cleared = true;
    }
  });
  return cleared;
}

function pickActiveItem(items: readonly UnattendedBoardItem[]): UnattendedBoardItem | null {
  const ranked = items.filter((item) => item.status === "in_progress" || item.status === "applied");
  ranked.sort((a, b) => {
    const rank = (item: UnattendedBoardItem) => (item.status === "in_progress" ? 0 : 1);
    const byStatus = rank(a) - rank(b);
    if (byStatus !== 0) {
      return byStatus;
    }
    return (b.inProgressAt ?? b.appliedAt ?? 0) - (a.inProgressAt ?? a.appliedAt ?? 0);
  });
  return ranked[0] ?? null;
}

function progressKindForDetail(
  detail: string | undefined,
  dispatched: boolean,
): UnattendedProgressKind | null {
  if (!dispatched) {
    return null;
  }
  if (compact(detail).startsWith("verifiable:")) {
    return "verifiable_output";
  }
  return "confirmed_step";
}

export async function advanceConfirmedStep(
  authority: RuntimeAuthority,
  params: {
    cfg?: OpenBotConfig;
    nowMs: number;
    executeAuthorized: boolean;
    taskId: string;
    itemId: string;
    ownerMemberId: string;
    roundDispatcher?: WakeRoundDispatcher | null;
    fromAgentId: string;
    toAgentId: string;
    source: WakeRoundDispatchSource;
    reason: string;
  },
): Promise<UnattendedTickResult> {
  if (!(await authorizeTarget(authority, params.cfg))) {
    return { ...EMPTY_TICK };
  }
  const groupId = authority.groupId;
  if (await drainIfUnattendedHardStopped(authority, { cfg: params.cfg, nowMs: params.nowMs })) {
    const state = await readUnattendedLaneState(authority);
    return tickFromState(
      {
        handled: true,
        reason: "hard_stop",
        message: state.hardStop?.detail ?? "unattended lane is hard-stopped",
        effectiveProgress: [],
        committedDispatchCount: 0,
        inflightDispatchCount: 0,
        humanGate: false,
        committedDispatch: false,
      },
      state,
    );
  }

  const taskId = compact(params.taskId);
  const itemId = compact(params.itemId);
  const owner = compact(params.ownerMemberId);
  if (!taskId || !itemId || !owner) {
    const state = await readUnattendedLaneState(authority);
    return tickFromState(
      {
        handled: true,
        reason: "no_active_task",
        message: "no active real task to advance",
        effectiveProgress: [],
        committedDispatchCount: 0,
        inflightDispatchCount: 0,
        humanGate: false,
        committedDispatch: false,
      },
      state,
    );
  }

  const todolistMod = await import("./executor-private-todolist.js");
  const todolist = await todolistMod.loadLatestOwnerTodolistForBoardItem(authority, {
    taskId,
    boardItemId: itemId,
    ownerMemberId: owner,
  });
  if (!todolistMod.isTodolistConfirmedForDelivery(todolist) || !todolist) {
    const state = await readUnattendedLaneState(authority);
    return tickFromState(
      {
        handled: true,
        reason: "plan_unconfirmed",
        message: "delivery advance requires a confirmed plan; recorded wake is not progress",
        effectiveProgress: [],
        committedDispatchCount: 0,
        inflightDispatchCount: 0,
        humanGate: false,
        committedDispatch: false,
      },
      state,
    );
  }

  const doneSteps = new Set(
    (await readUnattendedLaneState(authority)).progress
      .filter((event) => event.taskId === taskId && event.itemId === itemId)
      .map((event) => event.stepId),
  );
  const remaining = todolist.steps.filter(
    (step) =>
      (step.status === "pending" || step.status === "active") && !doneSteps.has(step.stepId),
  );
  const current = remaining[0];
  if (!current) {
    const state = await readUnattendedLaneState(authority);
    return tickFromState(
      {
        handled: true,
        reason: "plan_complete",
        message: "confirmed plan has no remaining step",
        effectiveProgress: [],
        committedDispatchCount: 0,
        inflightDispatchCount: 0,
        humanGate: false,
        committedDispatch: false,
      },
      state,
    );
  }

  const actionKind = classifyMissionAction(`${current.title}\n${current.detail ?? ""}`);
  const key = effectKey({
    groupId,
    taskId,
    itemId,
    planVersion: todolist.version,
    stepId: current.stepId,
    actionKind,
  });

  if (isExternalMissionAction(actionKind)) {
    let seen = 0;
    const state = await updateLane(authority, groupId, (draft) => {
      if (draft.hardStop?.active) {
        drainWork(draft, draft.hardStop.reason, params.nowMs);
        return;
      }
      seen = (draft.externalSeen[key] ?? 0) + 1;
      draft.externalSeen[key] = seen;
      if (seen >= 2) {
        engage(
          draft,
          "duplicate_external_side_effect",
          `${actionKind} repeated for ${key}`,
          params.nowMs,
        );
        return;
      }
      draft.humanGates.push({
        at: params.nowMs,
        taskId,
        itemId,
        stepId: current.stepId,
        actionKind,
        reason: "mission_fence_human_gate",
      });
    });
    const stopped = state.hardStop?.active === true;
    return tickFromState(
      {
        handled: true,
        reason: stopped ? "duplicate_external_side_effect" : "mission_fence_human_gate",
        message: stopped
          ? "repeated external side effect hard-stopped the lane"
          : `${actionKind} is outside the draft fence and was sent to a human gate`,
        effectiveProgress: [],
        committedDispatchCount: 0,
        inflightDispatchCount: 0,
        humanGate: !stopped,
        committedDispatch: false,
        externalSideEffectCount: 0,
      },
      state,
    );
  }

  const prior = await readUnattendedLaneState(authority);
  if (prior.effects.some((effect) => effect.key === key)) {
    return tickFromState(
      {
        handled: true,
        reason: "duplicate_side_effect",
        message: "repeated heartbeat/wake did not repeat the side effect",
        effectiveProgress: [],
        committedDispatchCount: 0,
        inflightDispatchCount: 0,
        humanGate: false,
        committedDispatch: false,
      },
      prior,
    );
  }
  if (
    prior.lastProgressAt > 0 &&
    params.nowMs - prior.lastProgressAt < scanIntervalMs(params.cfg)
  ) {
    return tickFromState(
      {
        handled: true,
        reason: "duplicate_side_effect",
        message: "repeated heartbeat inside the scan window did not start another side effect",
        effectiveProgress: [],
        committedDispatchCount: 0,
        inflightDispatchCount: 0,
        humanGate: false,
        committedDispatch: false,
      },
      prior,
    );
  }
  if (!params.executeAuthorized) {
    return tickFromState(
      {
        handled: true,
        reason: "dry_run",
        message: "dry_run or allowlist miss: no external side effect",
        effectiveProgress: [],
        committedDispatchCount: 0,
        inflightDispatchCount: 0,
        humanGate: false,
        committedDispatch: false,
        externalSideEffectCount: 0,
      },
      prior,
    );
  }

  const tickId = randomUUID();
  await updateLane(authority, groupId, (state) => {
    if (state.hardStop?.active) {
      drainWork(state, state.hardStop.reason, params.nowMs);
      return;
    }
    state.work.push({
      id: randomUUID(),
      tickId,
      taskId,
      itemId,
      stepId: current.stepId,
      planVersion: todolist.version,
      actionKind,
      phase: "in_progress",
      enqueuedAt: params.nowMs,
      startedAt: params.nowMs,
    });
    for (const next of remaining.slice(1)) {
      state.work.push({
        id: randomUUID(),
        tickId,
        taskId,
        itemId,
        stepId: next.stepId,
        planVersion: todolist.version,
        actionKind: classifyMissionAction(`${next.title}\n${next.detail ?? ""}`),
        phase: "queued",
        enqueuedAt: params.nowMs,
      });
    }
  });

  const dispatcher =
    params.roundDispatcher === undefined ? getWakeRoundDispatcher() : params.roundDispatcher;
  if (typeof dispatcher !== "function") {
    const state = await updateLane(authority, groupId, (draft) => {
      draft.work = draft.work.filter((item) => item.tickId !== tickId);
    });
    return tickFromState(
      {
        handled: true,
        reason: "recorded_not_progress",
        message: "no round consumer; recorded is not effective progress",
        effectiveProgress: [],
        committedDispatchCount: 0,
        inflightDispatchCount: 0,
        humanGate: false,
        committedDispatch: false,
      },
      state,
    );
  }

  const request = {
    groupId,
    tenantId: authority.tenantId,
    fromAgentId: compact(params.fromAgentId) || "system:group_task_heartbeat",
    toAgentIds: [compact(params.toAgentId) || owner],
    source: params.source,
    taskId,
    itemId,
    reason: params.reason,
  };
  let live: Awaited<ReturnType<WakeRoundDispatcher>>;
  try {
    live = await dispatcher(request);
  } catch (error) {
    const state = await updateLane(authority, groupId, (draft) => {
      if (draft.hardStop?.active) {
        drainWork(draft, draft.hardStop.reason, params.nowMs);
        return;
      }
      draft.work = draft.work.filter((item) => item.tickId !== tickId);
    });
    return tickFromState(
      {
        handled: true,
        reason: "dispatch_failed",
        message: error instanceof Error ? error.message : String(error),
        effectiveProgress: [],
        committedDispatchCount: 0,
        inflightDispatchCount: 1,
        humanGate: false,
        committedDispatch: false,
      },
      state,
    );
  }

  if (await drainIfUnattendedHardStopped(authority, { cfg: params.cfg, nowMs: params.nowMs })) {
    const state = await readUnattendedLaneState(authority);
    return tickFromState(
      {
        handled: true,
        reason: "hard_stop",
        message: "in-flight work was held and queued work was cancelled",
        effectiveProgress: [],
        committedDispatchCount: 0,
        inflightDispatchCount: 1,
        humanGate: false,
        committedDispatch: false,
        externalSideEffectCount: 0,
      },
      state,
    );
  }

  if (!live.ok || !compact(live.roundId)) {
    const state = await updateLane(authority, groupId, (draft) => {
      draft.work = draft.work.filter((item) => item.tickId !== tickId);
    });
    return tickFromState(
      {
        handled: true,
        reason: "recorded_not_progress",
        message: "round was not dispatched; recorded is not effective progress",
        effectiveProgress: [],
        committedDispatchCount: 0,
        inflightDispatchCount: 1,
        humanGate: false,
        committedDispatch: false,
      },
      state,
    );
  }

  const consume = await consumeWakeForRoundDispatch({
    authority,
    cfg: params.cfg,
    writeMode: "execute",
    nowMs: params.nowMs,
    roundDispatcher: async () => live,
    request,
  });
  const kind = progressKindForDetail(live.detail, consume.dispatched);
  let progress: UnattendedProgressEvent[] = [];
  const state = await updateLane(authority, groupId, (draft) => {
    if (draft.hardStop?.active || !kind) {
      if (draft.hardStop?.active) {
        drainWork(draft, draft.hardStop.reason, params.nowMs);
      } else {
        draft.work = draft.work.filter((item) => item.tickId !== tickId);
      }
      return;
    }
    const event: UnattendedProgressEvent = {
      kind,
      taskId,
      itemId,
      stepId: current.stepId,
      planVersion: todolist.version,
      at: params.nowMs,
      idempotencyKey: key,
    };
    draft.progress.push(event);
    draft.effects.push({
      key,
      actionKind,
      external: false,
      at: params.nowMs,
      taskId,
      stepId: current.stepId,
    });
    draft.lastProgressAt = params.nowMs;
    progress = [event];
    for (const item of draft.work) {
      if (
        item.tickId === tickId &&
        item.stepId === current.stepId &&
        item.phase === "in_progress"
      ) {
        item.phase = "done";
        item.finishedAt = params.nowMs;
      }
    }
  });
  return tickFromState(
    {
      handled: true,
      reason: progress.length > 0 ? "confirmed_step" : "recorded_not_progress",
      message:
        progress.length > 0
          ? "advanced one confirmed-plan step"
          : "wake was not a committed dispatch",
      effectiveProgress: progress,
      committedDispatchCount: progress.length > 0 ? 1 : 0,
      inflightDispatchCount: 1,
      humanGate: false,
      committedDispatch: progress.length > 0,
      wakeEvent: consume.wakeEvent,
      consume,
      externalSideEffectCount: 0,
    },
    state,
  );
}

export async function runSingleGroupUnattendedTick(
  authority: RuntimeAuthority,
  params: {
    cfg?: OpenBotConfig;
    nowMs: number;
    executeAuthorized: boolean;
    items: readonly UnattendedBoardItem[];
    roundDispatcher?: WakeRoundDispatcher | null;
    fromAgentId: string;
    source?: WakeRoundDispatchSource;
    reason?: string;
  },
): Promise<UnattendedTickResult> {
  if (!(await authorizeTarget(authority, params.cfg))) {
    return { ...EMPTY_TICK };
  }
  const item = pickActiveItem(params.items);
  return advanceConfirmedStep(authority, {
    cfg: params.cfg,
    nowMs: params.nowMs,
    executeAuthorized: params.executeAuthorized,
    taskId: item?.taskId ?? "",
    itemId: item?.itemId ?? "",
    ownerMemberId: item?.claimantId ?? "",
    roundDispatcher: params.roundDispatcher,
    fromAgentId: params.fromAgentId,
    toAgentId: item?.claimantId ?? "",
    source: params.source ?? "nudge",
    reason: params.reason ?? "single_group_unattended",
  });
}

/**
 * Denominator is confirmed-plan steps in the window, not heartbeat calls.
 * `recorded` wakes never increment the numerator. A positive call count is not acceptance.
 */
export function summarizeUnattendedEffectiveProgress(params: {
  windowStartMs: number;
  windowEndMs: number;
  confirmedStepsInWindow: number;
  progress: readonly { at: number; kind: UnattendedProgressKind }[];
  recordedWakeCount: number;
}): {
  denominator: number;
  numerator: number;
  recordedWakeCount: number;
  recordedCountsAsProgress: false;
  callCountIsSufficient: false;
  rate: number | null;
} {
  const denominator =
    Number.isFinite(params.confirmedStepsInWindow) && params.confirmedStepsInWindow > 0
      ? Math.floor(params.confirmedStepsInWindow)
      : 0;
  const numerator = params.progress.filter(
    (event) =>
      (event.kind === "confirmed_step" || event.kind === "verifiable_output") &&
      event.at >= params.windowStartMs &&
      event.at < params.windowEndMs,
  ).length;
  return {
    denominator,
    numerator,
    recordedWakeCount: params.recordedWakeCount,
    recordedCountsAsProgress: false,
    callCountIsSufficient: false,
    rate: denominator > 0 ? numerator / denominator : null,
  };
}
