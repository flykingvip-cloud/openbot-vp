/**
 * P5 — Deploy quality gate: single-challenger (蓝) red/blue short window (2026-10-15).
 *
 * FINAL §1.3 动作1 + §1.4 L-Deploy + §3.6:
 *   Before publishBoardItem, optionally designate **exactly 1 challenger**.
 *   Challenger critiques acceptance gaps / scope drift / role mismatch;
 *   lead (红/主答) absorb or reject with reason. Opinions + resolution append
 *   under `<ns>/challenge-windows/` (auditable). Not full-group debate.
 *
 * Flag `collaboration.task.challengeWindow` defaults OFF (switchable off).
 * Gray path: `challengeWindowGroupAllowlist` (scoped `tenantId/groupId`, P0) —
 * prefer allowlist over flipping global true for tip gray groups.
 * When ON (global or allowlist), publishBoardItem requires a resolved window
 * for the task **or** explicit `skipChallengeWindow: true` (per-item 可关).
 *
 * Non-goals: Floor live, second orchestrator, claim/wake allowlist flips,
 * LIVE writes, Episode multi-beat, full-group红蓝, P6 handoff.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import { recordCollaborationQualityBestEffort } from "../collaboration-ledger/writer.js";
import { matchGrayGroupAllowlist } from "./gray-group-allowlist.js";
import { appendJsonlDurable, withRoundLock } from "./round-store-io.js";
import type { RuntimeAuthority } from "./runtime-authority.js";
import { assertCollaborationRuntimeWritable } from "./runtime-namespace.js";

export const CHALLENGE_ISSUE_KINDS = ["acceptance_gap", "scope_drift", "role_mismatch"] as const;
export type ChallengeIssueKind = (typeof CHALLENGE_ISSUE_KINDS)[number];

export const CHALLENGE_RESOLUTIONS = ["absorb", "reject"] as const;
export type ChallengeResolutionDecision = (typeof CHALLENGE_RESOLUTIONS)[number];

export const CHALLENGE_WINDOW_STATUSES = ["open", "challenged", "resolved", "skipped"] as const;
export type ChallengeWindowStatus = (typeof CHALLENGE_WINDOW_STATUSES)[number];

export type ChallengeDraftSnapshot = Readonly<{
  goal: string;
  remainingWork: string;
  acceptanceCriteria: readonly string[];
  constraints?: readonly string[];
  suggestedRole?: string;
  title?: string;
}>;

export type ChallengeCritique = Readonly<{
  critiqueId: string;
  challengerId: string;
  issues: readonly ChallengeIssueKind[];
  comment: string;
  at: number;
}>;

export type ChallengeResolution = Readonly<{
  decision: ChallengeResolutionDecision;
  reason: string;
  by: string;
  at: number;
  /** When absorb revises the board contract before publish. */
  revisedDraft?: ChallengeDraftSnapshot;
}>;

export type ChallengeWindowRecord = Readonly<{
  windowId: string;
  groupId: string;
  taskId: string;
  /** 主答 (红). */
  leadId: string;
  /** Exactly one 蓝 challenger. */
  challengerId: string;
  status: ChallengeWindowStatus;
  draftSnapshot: ChallengeDraftSnapshot;
  critiques: readonly ChallengeCritique[];
  resolution?: ChallengeResolution;
  skipReason?: string;
  openedAt: number;
  challengedAt?: number;
  resolvedAt?: number;
  /** Observe-only: never feeds Admission. */
  drivesAdmission: false;
}>;

export type ChallengeWindowResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string; message: string };

export type ChallengeWindowOptions = {
  cfg?: OpenBotConfig;
  nowMs?: number;
};

type ChallengeWindowLogLine = {
  kind: "challenge_window";
  at: number;
  window: ChallengeWindowRecord;
};

/** Plan flag `collab.task.challengeWindowGroupAllowlist` (default empty). */
export function resolveChallengeWindowGroupAllowlist(cfg?: OpenBotConfig): string[] {
  try {
    const raw = (cfg ?? loadConfig()).collaboration?.task?.challengeWindowGroupAllowlist;
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
 * True when groupId is on the P5/S1 challenge gray allowlist.
 * FINAL v3 P0: managed callers (non-empty tenantId) require `tenantId/groupId`
 * (or wildcard-tenant scoped `TENANT/groupId` with TENANT=`*`); bare `groupId` never authorizes across tenants.
 * Bare entries remain valid only for personal_local (no tenantId).
 */
export function isGroupOnChallengeWindowAllowlist(params: {
  groupId: string;
  tenantId?: string | null;
  cfg?: OpenBotConfig;
}): boolean {
  return matchGrayGroupAllowlist({
    groupId: params.groupId,
    tenantId: params.tenantId,
    entries: resolveChallengeWindowGroupAllowlist(params.cfg),
  });
}

/**
 * Challenge Window writes enabled when global `challengeWindow===true` **or**
 * `groupId` is on `challengeWindowGroupAllowlist`. Platform default: both off.
 * Pass `groupId` (+ tenantId for P0) for the gray-group path; without it only
 * the global flag applies. Prefer allowlist for tip gray over global true.
 */
export function isCollabTaskChallengeWindowEnabled(
  cfg?: OpenBotConfig,
  groupId?: string | null,
  tenantId?: string | null,
): boolean {
  try {
    const resolved = cfg ?? loadConfig();
    if (resolved.collaboration?.task?.challengeWindow === true) {
      return true;
    }
    const gid = groupId?.trim();
    if (!gid) {
      return false;
    }
    return isGroupOnChallengeWindowAllowlist({
      groupId: gid,
      tenantId,
      cfg: resolved,
    });
  } catch {
    return false;
  }
}

/** Hard invariant: challenge-window observation must never drive Admission. */
export function challengeWindowMustNotDriveAdmission(): true {
  return true;
}

function fail(reason: string, message: string): ChallengeWindowResult<never> {
  return { ok: false, reason, message };
}

function flagOff<T>(): ChallengeWindowResult<T> {
  return fail(
    "flag_off",
    "collaboration.task.challengeWindow off for group (global false and not on challengeWindowGroupAllowlist); challenge window does not write",
  );
}

function nowOf(options?: ChallengeWindowOptions): number {
  return options?.nowMs ?? Date.now();
}

function compact(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function uniqueKinds(values: readonly string[] | undefined): ChallengeIssueKind[] {
  const seen = new Set<ChallengeIssueKind>();
  const out: ChallengeIssueKind[] = [];
  for (const value of values ?? []) {
    const kind = compact(value) as ChallengeIssueKind;
    if (!(CHALLENGE_ISSUE_KINDS as readonly string[]).includes(kind) || seen.has(kind)) {
      continue;
    }
    seen.add(kind);
    out.push(kind);
  }
  return out;
}

function snapshotOf(input: ChallengeDraftSnapshot): ChallengeDraftSnapshot {
  const goal = compact(input.goal);
  const remainingWork = compact(input.remainingWork) || goal;
  const acceptanceCriteria = (input.acceptanceCriteria ?? [])
    .map((v) => compact(v))
    .filter(Boolean);
  const constraints = (input.constraints ?? []).map((v) => compact(v)).filter(Boolean);
  const suggestedRole = compact(input.suggestedRole) || undefined;
  const title = compact(input.title) || undefined;
  return {
    goal,
    remainingWork,
    acceptanceCriteria,
    ...(constraints.length > 0 ? { constraints } : {}),
    ...(suggestedRole ? { suggestedRole } : {}),
    ...(title ? { title } : {}),
  };
}

function safeStem(id: string): string | null {
  const trimmed = id.trim();
  if (!trimmed || trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("..")) {
    return null;
  }
  return encodeURIComponent(trimmed);
}

/** Challenge windows live under `<ns>/challenge-windows` (alongside board-claims). */
export function challengeWindowsDir(authority: RuntimeAuthority): string {
  return path.join(authority.namespace.root, "challenge-windows");
}

export function challengeWindowLogPath(windowsDir: string, taskId: string): string {
  const stem = safeStem(taskId);
  if (!stem) {
    throw new Error("challenge window taskId is not a safe id");
  }
  return path.join(windowsDir, `${stem}.jsonl`);
}

function isChallengeWindowRecord(value: unknown): value is ChallengeWindowRecord {
  if (!value || typeof value !== "object") {
    return false;
  }
  const w = value as ChallengeWindowRecord;
  return (
    typeof w.windowId === "string" &&
    typeof w.groupId === "string" &&
    typeof w.taskId === "string" &&
    typeof w.leadId === "string" &&
    typeof w.challengerId === "string" &&
    typeof w.status === "string" &&
    (CHALLENGE_WINDOW_STATUSES as readonly string[]).includes(w.status) &&
    !!w.draftSnapshot &&
    typeof w.draftSnapshot === "object" &&
    Array.isArray(w.critiques) &&
    typeof w.openedAt === "number" &&
    !w.drivesAdmission
  );
}

async function readLog(logPath: string): Promise<ChallengeWindowLogLine[]> {
  let raw: string;
  try {
    raw = await fs.readFile(logPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const lines: ChallengeWindowLogLine[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    try {
      const parsed = JSON.parse(line) as ChallengeWindowLogLine;
      if (parsed?.kind === "challenge_window" && isChallengeWindowRecord(parsed.window)) {
        lines.push(parsed);
      }
    } catch {
      // skip corrupt line
    }
  }
  return lines;
}

async function appendWindow(
  authority: RuntimeAuthority,
  window: ChallengeWindowRecord,
  options?: ChallengeWindowOptions,
): Promise<void> {
  const cfg = options?.cfg;
  assertCollaborationRuntimeWritable(challengeWindowsDir(authority), cfg);
  const windowsDir = challengeWindowsDir(authority);
  const stem = safeStem(window.taskId);
  if (!stem) {
    throw new Error("challenge window taskId is not a safe id");
  }
  const logPath = challengeWindowLogPath(windowsDir, window.taskId);
  const at = nowOf(options);
  await withRoundLock(windowsDir, stem, async () => {
    await fs.mkdir(windowsDir, { recursive: true });
    await appendJsonlDurable(logPath, {
      kind: "challenge_window",
      at,
      window,
    } satisfies ChallengeWindowLogLine);
  });
}

/** Latest record per windowId (JSONL append-only). */
export async function listChallengeWindows(
  authority: RuntimeAuthority,
  params: { taskId: string; windowId?: string; status?: ChallengeWindowStatus },
): Promise<ChallengeWindowRecord[]> {
  const taskId = compact(params.taskId);
  if (!safeStem(taskId)) {
    return [];
  }
  const lines = await readLog(challengeWindowLogPath(challengeWindowsDir(authority), taskId));
  const latest = new Map<string, ChallengeWindowRecord>();
  for (const line of lines) {
    latest.set(line.window.windowId, line.window);
  }
  let out = [...latest.values()];
  const windowId = compact(params.windowId);
  if (windowId) {
    out = out.filter((w) => w.windowId === windowId);
  }
  if (params.status) {
    out = out.filter((w) => w.status === params.status);
  }
  return out.toSorted((a, b) => a.openedAt - b.openedAt);
}

export async function loadChallengeWindow(
  authority: RuntimeAuthority,
  params: { taskId: string; windowId: string },
): Promise<ChallengeWindowRecord | null> {
  const found = await listChallengeWindows(authority, {
    taskId: params.taskId,
    windowId: params.windowId,
  });
  return found[0] ?? null;
}

export type OpenChallengeWindowInput = {
  groupId?: string;
  taskId: string;
  leadId: string;
  /** Exactly one 蓝 challenger (required). */
  challengerId: string;
  draft: ChallengeDraftSnapshot;
  windowId?: string;
};

/**
 * Open a short challenge window with exactly one challenger.
 * Requires challengeWindow flag ON. Refuses if challenger === lead.
 */
export async function openChallengeWindow(
  authority: RuntimeAuthority,
  input: OpenChallengeWindowInput,
  options?: ChallengeWindowOptions,
): Promise<ChallengeWindowResult<ChallengeWindowRecord>> {
  const cfg = options?.cfg;
  const groupId = compact(input.groupId) || compact(authority.groupId);
  if (!isCollabTaskChallengeWindowEnabled(cfg, groupId, authority.tenantId)) {
    return flagOff();
  }
  const taskId = compact(input.taskId);
  const leadId = compact(input.leadId);
  const challengerId = compact(input.challengerId);
  const draft = snapshotOf(input.draft);
  if (!groupId || !taskId || !leadId || !challengerId) {
    return fail(
      "invalid_input",
      "openChallengeWindow requires groupId, taskId, leadId, challengerId",
    );
  }
  if (!safeStem(taskId)) {
    return fail("invalid_input", "taskId is not a safe id");
  }
  if (challengerId === leadId) {
    return fail("challenger_is_lead", "challenger (蓝) must differ from lead (红/主答)");
  }
  if (!draft.goal || draft.acceptanceCriteria.length === 0) {
    return fail(
      "invalid_draft",
      "challenge draft requires goal and at least one acceptanceCriteria",
    );
  }
  // Exactly one challenger is enforced by the singular challengerId field.
  const at = nowOf(options);
  const window: ChallengeWindowRecord = {
    windowId: compact(input.windowId) || randomUUID(),
    groupId,
    taskId,
    leadId,
    challengerId,
    status: "open",
    draftSnapshot: draft,
    critiques: [],
    openedAt: at,
    drivesAdmission: false,
  };
  await appendWindow(authority, window, options);
  return { ok: true, value: window };
}

export type RecordChallengeCritiqueInput = {
  taskId: string;
  windowId: string;
  challengerId: string;
  issues: readonly ChallengeIssueKind[];
  comment: string;
  critiqueId?: string;
};

/**
 * Challenger (蓝) records critique: acceptance gaps / scope drift / role mismatch.
 * Only the designated challenger may write; not a full-group debate.
 */
export async function recordChallengeCritique(
  authority: RuntimeAuthority,
  input: RecordChallengeCritiqueInput,
  options?: ChallengeWindowOptions,
): Promise<ChallengeWindowResult<ChallengeWindowRecord>> {
  const cfg = options?.cfg;
  if (!isCollabTaskChallengeWindowEnabled(cfg, authority.groupId, authority.tenantId)) {
    return flagOff();
  }
  const taskId = compact(input.taskId);
  const windowId = compact(input.windowId);
  const challengerId = compact(input.challengerId);
  const comment = compact(input.comment);
  const issues = uniqueKinds(input.issues);
  if (!taskId || !windowId || !challengerId) {
    return fail("invalid_input", "recordChallengeCritique requires taskId, windowId, challengerId");
  }
  if (issues.length === 0) {
    return fail(
      "invalid_issues",
      "issues must include acceptance_gap | scope_drift | role_mismatch",
    );
  }
  if (!comment) {
    return fail("invalid_input", "recordChallengeCritique requires comment");
  }
  const current = await loadChallengeWindow(authority, { taskId, windowId });
  if (!current) {
    return fail("not_found", `challenge window not found: ${windowId}`);
  }
  if (current.status !== "open" && current.status !== "challenged") {
    return fail(
      "invalid_status",
      `challenge window status is ${current.status}; expected open|challenged`,
    );
  }
  if (challengerId !== current.challengerId) {
    return fail(
      "challenger_mismatch",
      `only designated challenger ${current.challengerId} may critique (single-蓝; not full-group)`,
    );
  }
  const at = nowOf(options);
  const critique: ChallengeCritique = {
    critiqueId: compact(input.critiqueId) || randomUUID(),
    challengerId,
    issues,
    comment,
    at,
  };
  const next: ChallengeWindowRecord = {
    ...current,
    status: "challenged",
    critiques: [...current.critiques, critique],
    challengedAt: current.challengedAt ?? at,
  };
  await appendWindow(authority, next, options);
  return { ok: true, value: next };
}

export type ResolveChallengeWindowInput = {
  taskId: string;
  windowId: string;
  leadId: string;
  decision: ChallengeResolutionDecision;
  reason: string;
  revisedDraft?: ChallengeDraftSnapshot;
};

/**
 * Lead (红/主答) absorb or reject with reason. Writes auditable resolution.
 */
export async function resolveChallengeWindow(
  authority: RuntimeAuthority,
  input: ResolveChallengeWindowInput,
  options?: ChallengeWindowOptions,
): Promise<ChallengeWindowResult<ChallengeWindowRecord>> {
  const cfg = options?.cfg;
  if (!isCollabTaskChallengeWindowEnabled(cfg, authority.groupId, authority.tenantId)) {
    return flagOff();
  }
  const taskId = compact(input.taskId);
  const windowId = compact(input.windowId);
  const leadId = compact(input.leadId);
  const reason = compact(input.reason);
  const decision = input.decision;
  if (!taskId || !windowId || !leadId || !reason) {
    return fail(
      "invalid_input",
      "resolveChallengeWindow requires taskId, windowId, leadId, reason",
    );
  }
  if (!(CHALLENGE_RESOLUTIONS as readonly string[]).includes(decision)) {
    return fail("invalid_decision", "decision must be absorb|reject");
  }
  const current = await loadChallengeWindow(authority, { taskId, windowId });
  if (!current) {
    return fail("not_found", `challenge window not found: ${windowId}`);
  }
  if (current.status !== "open" && current.status !== "challenged") {
    return fail(
      "invalid_status",
      `challenge window status is ${current.status}; expected open|challenged`,
    );
  }
  if (leadId !== current.leadId) {
    return fail("lead_mismatch", `only lead ${current.leadId} may resolve (主答/红)`);
  }
  if (current.critiques.length === 0) {
    return fail(
      "critique_required",
      "resolve requires at least one challenger critique before 主答决议",
    );
  }
  const at = nowOf(options);
  const resolution: ChallengeResolution = {
    decision,
    reason,
    by: leadId,
    at,
    ...(input.revisedDraft ? { revisedDraft: snapshotOf(input.revisedDraft) } : {}),
  };
  const next: ChallengeWindowRecord = {
    ...current,
    status: "resolved",
    resolution,
    resolvedAt: at,
  };
  await appendWindow(authority, next, options);
  recordCollaborationQualityBestEffort({
    groupId: next.groupId,
    event: "review",
    outcome: decision === "absorb" ? "accepted" : "rejected",
    agentId: leadId,
    taskId,
    reviewId: next.windowId,
    reviewVerdict: decision,
  });
  return { ok: true, value: next };
}

export type SkipChallengeWindowInput = {
  groupId?: string;
  taskId: string;
  leadId: string;
  draft: ChallengeDraftSnapshot;
  skipReason: string;
  windowId?: string;
};

/**
 * Per-item 可关: record an explicit skip (still auditable) when flag is ON.
 * ChallengerId is empty sentinel — skip is not a debate.
 */
export async function skipChallengeWindow(
  authority: RuntimeAuthority,
  input: SkipChallengeWindowInput,
  options?: ChallengeWindowOptions,
): Promise<ChallengeWindowResult<ChallengeWindowRecord>> {
  const cfg = options?.cfg;
  const groupId = compact(input.groupId) || compact(authority.groupId);
  if (!isCollabTaskChallengeWindowEnabled(cfg, groupId, authority.tenantId)) {
    return flagOff();
  }
  const taskId = compact(input.taskId);
  const leadId = compact(input.leadId);
  const skipReason = compact(input.skipReason);
  const draft = snapshotOf(input.draft);
  if (!groupId || !taskId || !leadId || !skipReason) {
    return fail(
      "invalid_input",
      "skipChallengeWindow requires groupId, taskId, leadId, skipReason",
    );
  }
  if (!safeStem(taskId)) {
    return fail("invalid_input", "taskId is not a safe id");
  }
  const at = nowOf(options);
  const window: ChallengeWindowRecord = {
    windowId: compact(input.windowId) || randomUUID(),
    groupId,
    taskId,
    leadId,
    challengerId: "",
    status: "skipped",
    draftSnapshot: draft,
    critiques: [],
    skipReason,
    openedAt: at,
    resolvedAt: at,
    drivesAdmission: false,
  };
  await appendWindow(authority, window, options);
  return { ok: true, value: window };
}

export type PublishChallengeGateInput = {
  taskId: string;
  groupId?: string;
  /** Resolved or skipped window id; required when flag ON unless skipChallengeWindow. */
  challengeWindowId?: string;
  /** Per-item close without prior skip record — still allowed when flag ON. */
  skipChallengeWindow?: boolean;
};

/**
 * Gate for publishBoardItem when challengeWindow is ON.
 * Flag-off → allow. Flag-on → resolved|skipped window, or explicit skipChallengeWindow.
 * Unresolved open/challenged windows for the task block publish.
 */
export async function assertChallengeWindowForPublish(
  authority: RuntimeAuthority,
  input: PublishChallengeGateInput,
  options?: ChallengeWindowOptions,
): Promise<ChallengeWindowResult<true>> {
  const cfg = options?.cfg;
  const groupId = compact(input.groupId) || compact(authority.groupId);
  if (!isCollabTaskChallengeWindowEnabled(cfg, groupId, authority.tenantId)) {
    return { ok: true, value: true };
  }
  const taskId = compact(input.taskId);
  if (!taskId) {
    return fail("invalid_input", "assertChallengeWindowForPublish requires taskId");
  }
  const windows = await listChallengeWindows(authority, { taskId });
  const blocking = windows.filter((w) => w.status === "open" || w.status === "challenged");
  if (blocking.length > 0 && !input.skipChallengeWindow) {
    return fail(
      "challenge_window_open",
      `task ${taskId} has unresolved challenge window ${blocking[0]?.windowId}; resolve or skip before publish`,
    );
  }
  if (input.skipChallengeWindow === true) {
    return { ok: true, value: true };
  }
  const windowId = compact(input.challengeWindowId);
  if (!windowId) {
    return fail(
      "challenge_window_required",
      "collaboration.task.challengeWindow is on for group; publish requires challengeWindowId (resolved|skipped) or skipChallengeWindow=true",
    );
  }
  const window = windows.find((w) => w.windowId === windowId);
  if (!window) {
    return fail("not_found", `challenge window not found: ${windowId}`);
  }
  if (window.status !== "resolved" && window.status !== "skipped") {
    return fail(
      "challenge_window_unresolved",
      `challenge window ${windowId} status is ${window.status}; expected resolved|skipped`,
    );
  }
  return { ok: true, value: true };
}
