/**
 * C2 — Wake Contract ledger (2026-10-13).
 *
 * Inventory-first gap for upgrade plan §3 C2:
 *   Log wakes so tip can answer「谁唤醒了谁」.
 *
 * Sources (plan): structured @mention / handoff / claim|return / nudge /
 * stitch_only (no peer wake between assign → submit) / insight (P2 signalInsight).
 *
 * Evidence (tip 数字人战队): assistant inline `@` in reply text does **not**
 * open a new collaboration round today. Freeze that with
 * `assistantInlineAtCreatesRound()===false`. Optional flag
 * `collaboration.task.assistantMentionDispatch` (default OFF) opens the gate
 * so an assistant `@` may become `dispatch_eligible`. C3 consumer
 * (`assistant-mention-dispatch.ts`) turns eligible → same-round `peer_ask`
 * CollabEdges + outcome `dispatched` when targets resolve (still not Floor
 * live / not a second orchestrator).
 *
 * Flag `collaboration.task.wakeContract` (default OFF): when false, writers
 * are no-ops unless the group is on `wakeContractGroupAllowlist` (P3 gray path).
 * Reads observe AS-IS files when present.
 *
 * Non-goals: Floor live, ui.* RPC, default-on flags, RCIS→Admission,
 * inventing a multi-beat controller.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import { matchGrayGroupAllowlist } from "./gray-group-allowlist.js";
import { collectMentionTokens } from "./mention-utils.js";
import { appendJsonlDurable, withRoundLock } from "./round-store-io.js";
import type { RuntimeAuthority } from "./runtime-authority.js";
import { assertCollaborationRuntimeWritable } from "./runtime-namespace.js";

export const WAKE_SOURCES = [
  "structured_mention",
  "handoff",
  "claim",
  "return",
  "nudge",
  /** P3: group task heartbeat escalated after consecutive no-response nudges. */
  "escalate",
  "stitch_only",
  "assistant_inline_at",
  /** P2: executor signalInsight → wake 主答 (whoWokeWhom auditable). */
  "insight",
  /** P4: limited self_advance tick woke board 责任人 (whoWokeWhom auditable). */
  "self_advance",
] as const;

export type WakeSource = (typeof WAKE_SOURCES)[number];

export const WAKE_OUTCOMES = [
  "recorded",
  "dispatched",
  "not_dispatched",
  "dispatch_eligible",
  "observe_only",
] as const;

export type WakeOutcome = (typeof WAKE_OUTCOMES)[number];

export type WakeEvent = Readonly<{
  wakeId: string;
  groupId: string;
  taskId?: string;
  itemId?: string;
  fromAgentId: string;
  toAgentIds: readonly string[];
  source: WakeSource;
  outcome: WakeOutcome;
  at: number;
  reason?: string;
  relatedId?: string;
  /** True when this marker says assign→submit had no peer wake. */
  stitchOnly?: boolean;
}>;

export type WakeResult<T> = { ok: true; value: T } | { ok: false; reason: string; message: string };

export type WakeContractOptions = {
  cfg?: OpenBotConfig;
  nowMs?: number;
};

type WakeLogLine = {
  kind: "wake_event";
  at: number;
  event: WakeEvent;
};

/** Plan flag `collab.task.wakeContractGroupAllowlist` (default empty). */
export function resolveWakeContractGroupAllowlist(cfg?: OpenBotConfig): string[] {
  try {
    const raw = (cfg ?? loadConfig()).collaboration?.task?.wakeContractGroupAllowlist;
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter((entry) => entry.length > 0);
  } catch {
    return [];
  }
}

/**
 * True when groupId is on the P3 wake gray allowlist.
 * FINAL v3 P0: managed callers (non-empty tenantId) require `tenantId/groupId`
 * (or wildcard-tenant scoped `TENANT/groupId` with TENANT=`*`); bare `groupId` never authorizes across tenants.
 * Bare entries remain valid only for personal_local (no tenantId).
 */
export function isGroupOnWakeContractAllowlist(params: {
  groupId: string;
  tenantId?: string | null;
  cfg?: OpenBotConfig;
}): boolean {
  return matchGrayGroupAllowlist({
    groupId: params.groupId,
    tenantId: params.tenantId,
    entries: resolveWakeContractGroupAllowlist(params.cfg),
  });
}

/**
 * Wake Contract writes enabled when global `wakeContract===true` **or**
 * `groupId` is on `wakeContractGroupAllowlist`. Platform default: both off.
 * Pass `groupId` for the gray-group path; without it only the global flag applies.
 */
export function isCollabTaskWakeContractEnabled(
  cfg?: OpenBotConfig,
  groupId?: string | null,
  tenantId?: string | null,
): boolean {
  try {
    const resolved = cfg ?? loadConfig();
    if (resolved.collaboration?.task?.wakeContract === true) {
      return true;
    }
    const gid = groupId?.trim();
    if (!gid) {
      return false;
    }
    return isGroupOnWakeContractAllowlist({
      groupId: gid,
      tenantId,
      cfg: resolved,
    });
  } catch {
    return false;
  }
}

/**
 * Plan flag `collab.task.assistantMentionDispatch`
 * → `collaboration.task.assistantMentionDispatch` (default false).
 */
export function isCollabTaskAssistantMentionDispatchEnabled(cfg?: OpenBotConfig): boolean {
  try {
    return (cfg ?? loadConfig()).collaboration?.task?.assistantMentionDispatch === true;
  } catch {
    return false;
  }
}

/**
 * AS-IS freeze (tip evidence): assistant reply text that contains `@peer`
 * does **not** open a collaboration round / wake peers via chat.send.
 * Only human `chat.send` with structured `mentions` drives decideParticipants.
 */
export function assistantInlineAtCreatesRound(): false {
  return false;
}

/** Gate: assistant inline `@` may become dispatch-eligible only when flag ON. */
export function shouldDispatchAssistantMention(cfg?: OpenBotConfig): boolean {
  return isCollabTaskAssistantMentionDispatchEnabled(cfg);
}

function fail(reason: string, message: string): WakeResult<never> {
  return { ok: false, reason, message };
}

function flagOff<T>(): WakeResult<T> {
  return fail("flag_off", "collaboration.task.wakeContract is off; Wake Contract does not write");
}

function nowOf(options?: WakeContractOptions): number {
  return options?.nowMs ?? Date.now();
}

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

function newWakeId(nowMs: number): string {
  return `wake_${nowMs}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Wake events live under `<ns>/wake-events` (alongside board-claims). */
export function wakeEventsDir(authority: RuntimeAuthority): string {
  return path.join(authority.namespace.root, "wake-events");
}

export function wakeEventLogPath(eventsDir: string, groupId: string): string {
  const stem = safeStem(groupId);
  if (!stem) {
    throw new Error("wake event groupId is not a safe id");
  }
  return path.join(eventsDir, `${stem}.jsonl`);
}

function isWakeEvent(value: unknown): value is WakeEvent {
  if (!value || typeof value !== "object") {
    return false;
  }
  const event = value as WakeEvent;
  return (
    typeof event.wakeId === "string" &&
    typeof event.groupId === "string" &&
    typeof event.fromAgentId === "string" &&
    Array.isArray(event.toAgentIds) &&
    typeof event.source === "string" &&
    (WAKE_SOURCES as readonly string[]).includes(event.source) &&
    typeof event.outcome === "string" &&
    (WAKE_OUTCOMES as readonly string[]).includes(event.outcome) &&
    typeof event.at === "number"
  );
}

async function readLog(logPath: string): Promise<WakeLogLine[]> {
  let raw: string;
  try {
    raw = await fs.readFile(logPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const lines: WakeLogLine[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    try {
      const parsed = JSON.parse(line) as WakeLogLine;
      if (parsed?.kind === "wake_event" && isWakeEvent(parsed.event)) {
        lines.push(parsed);
      }
    } catch {
      // skip corrupt line
    }
  }
  return lines;
}

async function appendEvent(
  authority: RuntimeAuthority,
  event: WakeEvent,
  options?: WakeContractOptions,
): Promise<void> {
  const cfg = options?.cfg;
  const dir = wakeEventsDir(authority);
  assertCollaborationRuntimeWritable(dir, cfg);
  const stem = safeStem(event.groupId);
  if (!stem) {
    throw new Error("wake event groupId is not a safe id");
  }
  const logPath = wakeEventLogPath(dir, event.groupId);
  await withRoundLock(dir, stem, async () => {
    await fs.mkdir(dir, { recursive: true });
    await appendJsonlDurable(logPath, {
      kind: "wake_event",
      at: event.at,
      event,
    } satisfies WakeLogLine);
  });
}

export type RecordWakeInput = {
  groupId: string;
  fromAgentId: string;
  toAgentIds: readonly string[];
  source: WakeSource;
  outcome?: WakeOutcome;
  taskId?: string;
  itemId?: string;
  reason?: string;
  relatedId?: string;
  stitchOnly?: boolean;
  wakeId?: string;
};

/** Flag-gated write. Returns flag_off without touching disk when OFF. */
export async function recordWakeEvent(
  authority: RuntimeAuthority,
  input: RecordWakeInput,
  options?: WakeContractOptions,
): Promise<WakeResult<WakeEvent>> {
  const cfg = options?.cfg;
  const groupId = compact(input.groupId);
  if (!isCollabTaskWakeContractEnabled(cfg, groupId, authority.tenantId)) {
    return flagOff();
  }
  const fromAgentId = compact(input.fromAgentId);
  const toAgentIds = uniqueIds(input.toAgentIds);
  if (!groupId || !fromAgentId) {
    return fail("invalid_input", "recordWakeEvent requires groupId and fromAgentId");
  }
  if (!(WAKE_SOURCES as readonly string[]).includes(input.source)) {
    return fail("invalid_input", `unknown wake source: ${String(input.source)}`);
  }
  const at = nowOf(options);
  const event: WakeEvent = {
    wakeId: compact(input.wakeId) || newWakeId(at),
    groupId,
    fromAgentId,
    toAgentIds,
    source: input.source,
    outcome: input.outcome ?? "recorded",
    at,
    ...(compact(input.taskId) ? { taskId: compact(input.taskId) } : {}),
    ...(compact(input.itemId) ? { itemId: compact(input.itemId) } : {}),
    ...(compact(input.reason) ? { reason: compact(input.reason) } : {}),
    ...(compact(input.relatedId) ? { relatedId: compact(input.relatedId) } : {}),
    ...(input.stitchOnly === true ? { stitchOnly: true } : {}),
  };
  await appendEvent(authority, event, options);
  return { ok: true, value: event };
}

/** Best-effort wrap: never throws into claim/handoff hot path. */
export async function recordWakeEventBestEffort(
  authority: RuntimeAuthority,
  input: RecordWakeInput,
  options?: WakeContractOptions,
): Promise<WakeEvent | null> {
  try {
    const result = await recordWakeEvent(authority, input, options);
    return result.ok ? result.value : null;
  } catch {
    return null;
  }
}

/** Human / coordinator structured composer @mention → wake ledger. */
export async function recordStructuredMentionWake(
  authority: RuntimeAuthority,
  input: {
    groupId: string;
    fromAgentId: string;
    toAgentIds: readonly string[];
    taskId?: string;
    relatedId?: string;
  },
  options?: WakeContractOptions,
): Promise<WakeResult<WakeEvent>> {
  const targets = uniqueIds(input.toAgentIds);
  if (targets.length === 0) {
    return fail("invalid_input", "structured mention wake requires at least one toAgentId");
  }
  return recordWakeEvent(
    authority,
    {
      groupId: input.groupId,
      fromAgentId: input.fromAgentId,
      toAgentIds: targets,
      source: "structured_mention",
      outcome: "dispatched",
      taskId: input.taskId,
      relatedId: input.relatedId,
    },
    options,
  );
}

export async function recordHandoffWake(
  authority: RuntimeAuthority,
  input: {
    groupId: string;
    fromAgentId: string;
    toAgentId: string;
    taskId: string;
    handoffId?: string;
  },
  options?: WakeContractOptions,
): Promise<WakeResult<WakeEvent>> {
  return recordWakeEvent(
    authority,
    {
      groupId: input.groupId,
      fromAgentId: input.fromAgentId,
      toAgentIds: [input.toAgentId],
      source: "handoff",
      outcome: "recorded",
      taskId: input.taskId,
      relatedId: input.handoffId,
    },
    options,
  );
}

export async function recordClaimWake(
  authority: RuntimeAuthority,
  input: {
    groupId: string;
    fromAgentId: string;
    toAgentId: string;
    taskId: string;
    itemId: string;
  },
  options?: WakeContractOptions,
): Promise<WakeResult<WakeEvent>> {
  return recordWakeEvent(
    authority,
    {
      groupId: input.groupId,
      fromAgentId: input.fromAgentId,
      toAgentIds: [input.toAgentId],
      source: "claim",
      outcome: "recorded",
      taskId: input.taskId,
      itemId: input.itemId,
    },
    options,
  );
}

/** Return submission → structured wake of original claimant. */
export async function recordReturnWake(
  authority: RuntimeAuthority,
  input: {
    groupId: string;
    fromAgentId: string;
    toAgentId: string;
    taskId: string;
    itemId: string;
    reason: string;
  },
  options?: WakeContractOptions,
): Promise<WakeResult<WakeEvent>> {
  return recordWakeEvent(
    authority,
    {
      groupId: input.groupId,
      fromAgentId: input.fromAgentId,
      toAgentIds: [input.toAgentId],
      source: "return",
      outcome: "recorded",
      taskId: input.taskId,
      itemId: input.itemId,
      reason: input.reason,
    },
    options,
  );
}

export async function recordNudgeWake(
  authority: RuntimeAuthority,
  input: {
    groupId: string;
    fromAgentId: string;
    toAgentIds: readonly string[];
    taskId?: string;
    itemId?: string;
    reason?: string;
  },
  options?: WakeContractOptions,
): Promise<WakeResult<WakeEvent>> {
  const targets = uniqueIds(input.toAgentIds);
  if (targets.length === 0) {
    return fail("invalid_input", "nudge requires at least one toAgentId");
  }
  return recordWakeEvent(
    authority,
    {
      groupId: input.groupId,
      fromAgentId: input.fromAgentId,
      toAgentIds: targets,
      source: "nudge",
      outcome: "recorded",
      taskId: input.taskId,
      itemId: input.itemId,
      reason: input.reason ?? "soft_nudge",
    },
    options,
  );
}

/** P3 heartbeat: escalate after consecutive no-response nudges. */
export async function recordEscalateWake(
  authority: RuntimeAuthority,
  input: {
    groupId: string;
    fromAgentId: string;
    toAgentIds: readonly string[];
    taskId?: string;
    itemId?: string;
    reason?: string;
  },
  options?: WakeContractOptions,
): Promise<WakeResult<WakeEvent>> {
  const targets = uniqueIds(input.toAgentIds);
  if (targets.length === 0) {
    return fail("invalid_input", "escalate requires at least one toAgentId");
  }
  return recordWakeEvent(
    authority,
    {
      groupId: input.groupId,
      fromAgentId: input.fromAgentId,
      toAgentIds: targets,
      source: "escalate",
      outcome: "recorded",
      taskId: input.taskId,
      itemId: input.itemId,
      reason: input.reason ?? "escalate_after_no_response",
    },
    options,
  );
}

/**
 * Observe assistant reply text `@` tokens.
 * Default (assistantMentionDispatch OFF): outcome `not_dispatched` — proves AS-IS.
 * Flag ON: outcome `dispatch_eligible` unless the C3 consumer already resolved
 * targets (`resolvedAgentIds`) — then outcome `dispatched` with agentIds.
 * Does not invent a second orchestrator or open Floor live / new rounds.
 */
export async function observeAssistantInlineAtMentions(
  authority: RuntimeAuthority,
  input: {
    groupId: string;
    fromAgentId: string;
    text: string;
    taskId?: string;
    relatedId?: string;
    /**
     * C3 consumer: when flag ON and these agentIds are non-empty, record
     * outcome `dispatched` (same-round peer_ask path attaches edges separately).
     */
    resolvedAgentIds?: readonly string[];
  },
  options?: WakeContractOptions,
): Promise<WakeResult<WakeEvent | null>> {
  const tokens = [...collectMentionTokens(input.text)];
  if (tokens.length === 0) {
    return { ok: true, value: null };
  }
  const eligible = shouldDispatchAssistantMention(options?.cfg);
  if (!eligible) {
    return recordWakeEvent(
      authority,
      {
        groupId: input.groupId,
        fromAgentId: input.fromAgentId,
        toAgentIds: tokens,
        source: "assistant_inline_at",
        outcome: "not_dispatched",
        taskId: input.taskId,
        relatedId: input.relatedId,
        reason: "assistant inline @ does not create rounds (flag off)",
      },
      options,
    );
  }

  const resolved = uniqueIds(input.resolvedAgentIds);
  if (resolved.length > 0) {
    return recordWakeEvent(
      authority,
      {
        groupId: input.groupId,
        fromAgentId: input.fromAgentId,
        toAgentIds: resolved,
        source: "assistant_inline_at",
        outcome: "dispatched",
        taskId: input.taskId,
        relatedId: input.relatedId,
        reason: "assistantMentionDispatch=on; consumer dispatched via same-round peer_ask",
      },
      options,
    );
  }

  return recordWakeEvent(
    authority,
    {
      groupId: input.groupId,
      fromAgentId: input.fromAgentId,
      toAgentIds: tokens,
      source: "assistant_inline_at",
      outcome: "dispatch_eligible",
      taskId: input.taskId,
      relatedId: input.relatedId,
      reason: "assistantMentionDispatch=on; eligible for consumer dispatch",
    },
    options,
  );
}

/** Pure plan helper for flag-ON consumers (no disk I/O). */
export function planAssistantMentionTargets(
  text: string,
  cfg?: OpenBotConfig,
): { allowed: boolean; targets: string[]; reason: string } {
  const targets = [...collectMentionTokens(text)];
  if (!shouldDispatchAssistantMention(cfg)) {
    return {
      allowed: false,
      targets,
      reason:
        "collaboration.task.assistantMentionDispatch is off; assistant inline @ does not dispatch",
    };
  }
  if (targets.length === 0) {
    return { allowed: false, targets, reason: "no @ tokens in assistant text" };
  }
  return {
    allowed: true,
    targets,
    reason: "assistantMentionDispatch=on; targets eligible for dispatch",
  };
}

/**
 * Peer wake = from ≠ member, to includes member, source not stitch_only,
 * timestamp in (assignAt, submitAt].
 */
export function hasPeerWakeBetween(
  events: readonly WakeEvent[],
  params: { memberId: string; assignAt: number; submitAt: number },
): boolean {
  const memberId = compact(params.memberId).toLowerCase();
  if (!memberId) {
    return false;
  }
  for (const event of events) {
    if (event.source === "stitch_only") {
      continue;
    }
    if (event.at <= params.assignAt || event.at > params.submitAt) {
      continue;
    }
    if (compact(event.fromAgentId).toLowerCase() === memberId) {
      continue;
    }
    if (event.toAgentIds.some((id) => compact(id).toLowerCase() === memberId)) {
      return true;
    }
  }
  return false;
}

export function detectStitchOnly(params: {
  events: readonly WakeEvent[];
  memberId: string;
  assignAt: number;
  submitAt: number;
}): boolean {
  return !hasPeerWakeBetween(params.events, params);
}

/** Write stitch_only marker when assign→submit had no peer wake. */
export async function markStitchOnlyIfNoPeerWake(
  authority: RuntimeAuthority,
  input: {
    groupId: string;
    memberId: string;
    assignAt: number;
    submitAt: number;
    taskId?: string;
    itemId?: string;
    actorId?: string;
  },
  options?: WakeContractOptions,
): Promise<WakeResult<WakeEvent | null>> {
  const cfg = options?.cfg;
  if (!isCollabTaskWakeContractEnabled(cfg, input.groupId, authority.tenantId)) {
    return flagOff();
  }
  const events = await listWakeEvents(authority, {
    groupId: input.groupId,
    taskId: input.taskId,
  });
  if (
    !detectStitchOnly({
      events,
      memberId: input.memberId,
      assignAt: input.assignAt,
      submitAt: input.submitAt,
    })
  ) {
    return { ok: true, value: null };
  }
  return recordWakeEvent(
    authority,
    {
      groupId: input.groupId,
      fromAgentId: compact(input.actorId) || "system",
      toAgentIds: [input.memberId],
      source: "stitch_only",
      outcome: "observe_only",
      taskId: input.taskId,
      itemId: input.itemId,
      reason: "no peer wake between assign and submit",
      stitchOnly: true,
    },
    options,
  );
}

/** Read-only list (no flag required). Filters optional taskId. */
export async function listWakeEvents(
  authority: RuntimeAuthority,
  params: { groupId: string; taskId?: string },
): Promise<WakeEvent[]> {
  const groupId = compact(params.groupId);
  if (!groupId || !safeStem(groupId)) {
    return [];
  }
  const dir = wakeEventsDir(authority);
  const logPath = wakeEventLogPath(dir, groupId);
  const lines = await readLog(logPath);
  const taskId = compact(params.taskId);
  const events = lines.map((line) => line.event);
  if (!taskId) {
    return events;
  }
  return events.filter((event) => compact(event.taskId) === taskId);
}

/** Timeline projection answering「谁唤醒了谁」. */
export function whoWokeWhom(events: readonly WakeEvent[]): Array<{
  from: string;
  to: string;
  source: WakeSource;
  outcome: WakeOutcome;
  at: number;
  wakeId: string;
}> {
  const rows: Array<{
    from: string;
    to: string;
    source: WakeSource;
    outcome: WakeOutcome;
    at: number;
    wakeId: string;
  }> = [];
  for (const event of events) {
    if (event.toAgentIds.length === 0) {
      rows.push({
        from: event.fromAgentId,
        to: "",
        source: event.source,
        outcome: event.outcome,
        at: event.at,
        wakeId: event.wakeId,
      });
      continue;
    }
    for (const to of event.toAgentIds) {
      rows.push({
        from: event.fromAgentId,
        to,
        source: event.source,
        outcome: event.outcome,
        at: event.at,
        wakeId: event.wakeId,
      });
    }
  }
  return rows.toSorted((a, b) => a.at - b.at);
}
