/**
 * P4b — Group task board ClaimContract (collab groups only).
 *
 * Separate from 1:1 SessionTaskBoard and SupervisorTaskBoard.
 * Oral “已派工” / collab_edge alone is never a board fact.
 *
 * Status (P4b): published → claimed → applied (| cancelled).
 * Progress (C1): applied|claimed → in_progress → submitted_for_review → accepted | returned
 *              returned → in_progress; in_progress|submitted_for_review → blocked.
 *              blocked → prior status only via explicit unblockBoardItem (actor ≠ claimant, audited).
 *              Heartbeat and self-advance never auto-unblock. Accepted stay terminal.
 *              Cancel (terminal, ≠ block): published|claimed|applied|in_progress|submitted_for_review → cancelled.
 *              Refuse cancel from accepted|cancelled|returned|blocked (block remains the recoverable path).
 * applyClaim remains the only mutator of assigned members / responsibility seed inputs.
 * submitForReview requires submission_id (UUID) + artifactVersion; draft chat ≠ submitted.
 * P4/S3: empty / no-increment / duplicate summary MUST NOT count as submit success.
 * P4/S3: returnCount + configurable acceptanceLoopMaxReturns; over cap escalates human.
 * FINAL v3 S3: accept/return bind expectedSubmissionId to pending submission; late accept
 * of a prior version after return is refused; accept must check objective Acceptance criteria
 * (主答权威 ≠ skip criteria) and leave audit (reason, criteria, version, verdict, proxy).
 * Flag `collaboration.task.claimContract` defaults OFF (fail-closed, no writes).
 * P2: markInProgress requires confirmed ExecutorPrivateTodolist (plan gate).
 * C3: `collaboration.task.requirePeerReview` (default OFF) gates accept until
 * ≥1 non-author peer review exists on the current submission.
 * Mode B post-claim fan-out: when `postClaimFanoutWake` (or its group allowlist)
 * is on, claimBoardItem also wakes `intendedClaimantIds \ {claimantId}` via
 * Wake Contract (default OFF). No digital-team hardcodes / LIVE / Floor.
 * Mode B board-tied kickoff: when `boardKickoffMultiParticipant` (or allowlist)
 * is on, executeCollaborationRound expands single named @mention primary to
 * explicit_multi over (mention ∪ intended) ∩ group — so @主答 kickoff does not
 * lock Mode B to mentionOverridesPrimary solo (default OFF).
 *
 * Does not invent a second task system, Floor live, multi-beat, RCIS→Admission,
 * ui.* RPC, or tip rules. Does not grant bots L3 task.assign.
 *
 * Field evidence (2026-10-13): tip groups stuck at applied with no交卷态; no listBoard/getProgress.
 *
 * Phase 0 (v3.1) / 0.2: board status transitions use atomic RMW under withRoundLock via
 * mutateBoardClaimItem and bump revision (publish writes 1; each successful mutate +1).
 * Wake / fan-out / insight side effects run outside the lock, only after success.
 * In-process races covered by C1–C3; not a cross-process / stale-lock recovery claim.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Task } from "@openbot/collaboration-core";
import { loadConfig } from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import { assertChallengeWindowForPublish } from "./challenge-window.js";
import type { EffectiveCollaborationPolicy, TaskResponsibility } from "./effective-policy.js";
import type { GovernanceMemberRoleLike } from "./governance-gate.js";
import { matchGrayGroupAllowlist } from "./gray-group-allowlist.js";
import { loadBoardClaimItemsFromDir } from "./member-progress-export.js";
import { normalizeAgentIdentifier } from "./mention-utils.js";
import { modeBActiveBoardItems } from "./mode-b-member-selection.js";
import { assertPeerReviewGateForAccept } from "./peer-review-gate.js";
import { buildCollaborationRoundPlan } from "./round-plan.js";
import { appendJsonlDurable, withRoundLock } from "./round-store-io.js";
import type { RuntimeAuthority } from "./runtime-authority.js";
import { assertCollaborationRuntimeWritable } from "./runtime-namespace.js";
import { guardUnattendedAccept } from "./single-group-unattended.js";
import {
  acceptanceCriteriaFullyChecked,
  assertAcceptanceProxyFields,
  isValidArtifactVersion,
  normalizeArtifactVersion,
  pendingSubmissionMatches,
} from "./submit-review-versioning.js";
import { seedTaskResponsibility, type GovernedTask } from "./task-runtime.js";
import type { CollaborationBotTarget, ParticipationDecision } from "./types.js";
import { COLLABORATION_ABSOLUTE_VISIBLE_TURN_LIMIT } from "./types.js";
import { recordWakeEventBestEffort } from "./wake-contract.js";

export type BoardClaimStatus =
  | "published"
  | "claimed"
  | "applied"
  | "in_progress"
  | "submitted_for_review"
  | "accepted"
  | "returned"
  | "blocked"
  | "cancelled";

/** Progress statuses added in C1 (beyond P4b publish→claim→apply). */
export const BOARD_CLAIM_PROGRESS_STATUSES = [
  "in_progress",
  "submitted_for_review",
  "accepted",
  "returned",
  "blocked",
] as const satisfies readonly BoardClaimStatus[];

export type GroupBoardClaimItem = Readonly<{
  itemId: string;
  groupId: string;
  taskId: string;
  title: string;
  remainingWork: string;
  acceptanceCriteria: readonly string[];
  /**
   * P1 board template Goal. When unset, remainingWork is the Goal for readers.
   */
  goal?: string;
  /** P1 board template Constraints (red lines / format / sources). */
  constraints?: readonly string[];
  /** P1 board template Due (ms since epoch); heartbeat / overdue basis. */
  dueAtMs?: number;
  /** Optional role hint (e.g. analyst); ids stay on intendedClaimantIds. */
  suggestedRole?: string;
  /** Optional allow-list; empty = any group member may claim once. */
  intendedClaimantIds: readonly string[];
  publishedBy: string;
  publishedAt: number;
  status: BoardClaimStatus;
  /**
   * Monotonic state revision (Phase 0 / 0.2).
   * publishBoardItem writes 1; every successful mutateBoardClaimItem path
   * (claim, apply, markInProgress, submit, accept, return, block, unblock,
   * cancel) increments by 1 via nextBoardClaimRevision.
   * Idempotent submit (same open submissionId) does not append and does not bump.
   * Missing on legacy log lines → treat as 0 when comparing / incrementing.
   * Optional expectedRevision CAS remains claim-only unless callers add it later.
   */
  revision?: number;
  claimantId?: string;
  claimedAt?: number;
  appliedAt?: number;
  /**
   * T48: task.handoffs length at the moment this item became applied.
   * Recovery treats only subsequent history (slice from this index) as
   * "this claim was handed off away" — not arbitrary older from===claimant hits.
   * Local ordering for this board apply; not a full responsibility revision ledger.
   */
  applyBaseHistoryLen?: number;
  /** C1: work started (after claim/apply). */
  inProgressAt?: number;
  /** C1: idempotent交卷 id; required on submitted_for_review. */
  submissionId?: string;
  submittedAt?: number;
  /** Optional human-readable summary of the submission (not draft chat). */
  submissionSummary?: string;
  /**
   * FINAL v3 S3: product/artifact version bound to the pending submission.
   * Required on submit; accept/return audit records which version was decided.
   */
  artifactVersion?: string;
  acceptedAt?: number;
  acceptedBy?: string;
  /** S3: frozen submission id that was accepted (audit). */
  acceptedSubmissionId?: string;
  /** S3: frozen artifact version that was accepted (audit). */
  acceptedArtifactVersion?: string;
  /** S3: human/主答 acceptance rationale (required on accept). */
  acceptanceReason?: string;
  /** S3: objective criteria the acceptor checked (must cover board Acceptance). */
  checkedAcceptanceCriteria?: readonly string[];
  /** S3: accept verdict; currently always "pass" on successful accept. */
  acceptanceVerdict?: "pass";
  /** S3: when coordinator/owner accepts on behalf of another authority. */
  acceptanceProxyForActorId?: string;
  /** S3: basis/身份依据 for proxy acceptance (required if proxyFor set). */
  acceptanceProxyBasis?: string;
  returnedAt?: number;
  returnedBy?: string;
  returnReason?: string;
  /**
   * P4: how many times this item was returned for revision.
   * Escalates to human when >= acceptanceLoopMaxReturns.
   */
  returnCount?: number;
  /** P4: last returned submission summary (duplicate/no-increment detect). */
  lastReturnedSubmissionSummary?: string;
  /** S3: last returned submission id (stale accept of this id must fail). */
  lastReturnedSubmissionId?: string;
  /** S3: last returned artifact version. */
  lastReturnedArtifactVersion?: string;
  blockedAt?: number;
  blockedReason?: string;
  /** Actor who set blocked (audit). */
  blockedBy?: string;
  /** Status immediately before blocked; unblock restores this when it is still executable. */
  blockedFromStatus?: BoardClaimStatus;
  /** Explicit human/coordinator unblock. Not written by heartbeat or self-advance. */
  unblockedAt?: number;
  unblockedBy?: string;
  unblockReason?: string;
  /** Platform: when cancelled (exits self-advance / heartbeat active sets). */
  cancelledAt?: number;
  cancelledBy?: string;
  cancelledReason?: string;
}>;

export type ClaimResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string; message: string };

export type PublishBoardItemInput = {
  groupId: string;
  taskId: string;
  title?: string;
  remainingWork: string;
  acceptanceCriteria: readonly string[];
  goal?: string;
  constraints?: readonly string[];
  dueAtMs?: number;
  suggestedRole?: string;
  intendedClaimantIds?: readonly string[];
  publishedBy: string;
  itemId?: string;
  /**
   * P5: resolved|skipped challenge window id when `collaboration.task.challengeWindow` is ON.
   */
  challengeWindowId?: string;
  /** P5: per-item 可关 — skip L-Deploy short window for this publish when flag ON. */
  skipChallengeWindow?: boolean;
};

export type ClaimBoardItemInput = {
  taskId: string;
  itemId: string;
  claimantId: string;
  /**
   * Optional CAS for claimBoardItem only: must match lock-time current revision
   * (missing → skip compare; legacy rows treated as 0). Concurrent claim without
   * this still serializes via lock-internal re-read. Other mutate paths bump
   * revision but do not currently expose expectedRevision CAS.
   */
  expectedRevision?: number;
};

export type ApplyClaimInput = {
  taskId: string;
  itemId: string;
};

export type ApplyClaimValue = {
  item: GroupBoardClaimItem;
  assignedMemberIds: string[];
  responsibility: TaskResponsibility;
};

export type ClaimContractOptions = {
  cfg?: OpenBotConfig;
  nowMs?: number;
  /** P4: escalate target when acceptance loop exceeds max returns. */
  coordinatorBotId?: string | null;
};

type BoardClaimLogLine = {
  kind: "board_claim";
  at: number;
  item: GroupBoardClaimItem;
};

/** Plan flag `collab.task.claimContract` → config (default false). */
export function resolveClaimContractGroupAllowlist(cfg?: OpenBotConfig): string[] {
  try {
    const raw = (cfg ?? loadConfig()).collaboration?.task?.claimContractGroupAllowlist;
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
 * True when groupId is on the P1 gray allowlist.
 * FINAL v3 P0: managed callers (non-empty tenantId) require `tenantId/groupId`
 * (or wildcard-tenant scoped `TENANT/groupId` with TENANT=`*`); bare `groupId` never authorizes across tenants.
 * Bare entries remain valid only for personal_local (no tenantId).
 */
export function isGroupOnClaimContractAllowlist(params: {
  groupId: string;
  tenantId?: string | null;
  cfg?: OpenBotConfig;
}): boolean {
  return matchGrayGroupAllowlist({
    groupId: params.groupId,
    tenantId: params.tenantId,
    entries: resolveClaimContractGroupAllowlist(params.cfg),
  });
}

/**
 * ClaimContract writes enabled when global `claimContract===true` **or**
 * `groupId` is on `claimContractGroupAllowlist`. Platform default: both off.
 * Pass `groupId` for the gray-group path; without it only the global flag applies.
 */
export function isCollabTaskClaimContractEnabled(
  cfg?: OpenBotConfig,
  groupId?: string | null,
  tenantId?: string | null,
): boolean {
  try {
    const resolved = cfg ?? loadConfig();
    if (resolved.collaboration?.task?.claimContract === true) {
      return true;
    }
    const gid = groupId?.trim();
    if (!gid) {
      return false;
    }
    return isGroupOnClaimContractAllowlist({
      groupId: gid,
      tenantId,
      cfg: resolved,
    });
  } catch {
    return false;
  }
}

/** Plan flag `collab.task.postClaimFanoutWakeGroupAllowlist` (default empty). */
export function resolvePostClaimFanoutWakeGroupAllowlist(cfg?: OpenBotConfig): string[] {
  try {
    const raw = (cfg ?? loadConfig()).collaboration?.task?.postClaimFanoutWakeGroupAllowlist;
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
 * True when groupId is on the post-claim fan-out gray allowlist.
 * FINAL v3 P0: managed callers (non-empty tenantId) require `tenantId/groupId`
 * (or wildcard-tenant scoped `TENANT/groupId` with TENANT=`*`); bare `groupId`
 * never authorizes across tenants. Bare entries remain personal_local only.
 */
export function isGroupOnPostClaimFanoutWakeAllowlist(params: {
  groupId: string;
  tenantId?: string | null;
  cfg?: OpenBotConfig;
}): boolean {
  return matchGrayGroupAllowlist({
    groupId: params.groupId,
    tenantId: params.tenantId,
    entries: resolvePostClaimFanoutWakeGroupAllowlist(params.cfg),
  });
}

/**
 * Post-claim intended fan-out enabled when global `postClaimFanoutWake===true`
 * **or** `groupId` is on `postClaimFanoutWakeGroupAllowlist`. Platform default:
 * both off. Wake ledger write still requires Wake Contract for the group.
 */
export function isPostClaimFanoutWakeEnabled(
  cfg?: OpenBotConfig,
  groupId?: string | null,
  tenantId?: string | null,
): boolean {
  try {
    const resolved = cfg ?? loadConfig();
    if (resolved.collaboration?.task?.postClaimFanoutWake === true) {
      return true;
    }
    const gid = groupId?.trim();
    if (!gid) {
      return false;
    }
    return isGroupOnPostClaimFanoutWakeAllowlist({
      groupId: gid,
      tenantId,
      cfg: resolved,
    });
  } catch {
    return false;
  }
}

/**
 * Intended claimants excluding the lead claimant (normalized, unique, stable).
 * Empty intended or claimant-only → []. Claimant is never a fan-out target.
 */
export function resolvePostClaimFanoutTargets(
  intendedClaimantIds: readonly string[],
  claimantId: string,
): string[] {
  const claimantNeedle = normalizeAgentIdentifier(claimantId);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of intendedClaimantIds) {
    const id = compact(raw);
    if (!id) {
      continue;
    }
    const needle = normalizeAgentIdentifier(id);
    if (!needle || (claimantNeedle && needle === claimantNeedle)) {
      continue;
    }
    if (seen.has(needle)) {
      continue;
    }
    seen.add(needle);
    out.push(id);
  }
  return out;
}

/** Goal field for readers: explicit goal, else remainingWork. */
export function boardItemGoal(item: Pick<GroupBoardClaimItem, "goal" | "remainingWork">): string {
  const goal = item.goal?.trim();
  return goal || item.remainingWork;
}

/**
 * Oral “已派工”, chat bubbles, and collab_edge never create a board claim fact.
 * Organizers must publishBoardItem → claimBoardItem → applyClaim.
 */
export function oralDispatchCreatesBoardFact(): false {
  return false;
}

export function isAppliedBoardClaim(item: GroupBoardClaimItem | null | undefined): boolean {
  return item?.status === "applied" && Boolean(item.claimantId?.trim());
}

function fail(reason: string, message: string): ClaimResult<never> {
  return { ok: false, reason, message };
}

function flagOff<T>(): ClaimResult<T> {
  return fail(
    "flag_off",
    "collaboration.task.claimContract is off; GroupBoardClaim does not write",
  );
}

function nowOf(options?: ClaimContractOptions): number {
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

/** Board-claims live under `<ns>/board-claims` (not SessionTaskBoard). */
export function boardClaimsDir(authority: RuntimeAuthority): string {
  return path.join(authority.namespace.root, "board-claims");
}

export function boardClaimLogPath(claimsDir: string, taskId: string): string {
  const stem = safeStem(taskId);
  if (!stem) {
    throw new Error("board claim taskId is not a safe id");
  }
  return path.join(claimsDir, `${stem}.jsonl`);
}

function isBoardClaimItem(value: unknown): value is GroupBoardClaimItem {
  if (!value || typeof value !== "object") {
    return false;
  }
  const item = value as GroupBoardClaimItem;
  return (
    typeof item.itemId === "string" &&
    item.itemId.trim().length > 0 &&
    typeof item.taskId === "string" &&
    typeof item.groupId === "string" &&
    (item.status === "published" ||
      item.status === "claimed" ||
      item.status === "applied" ||
      item.status === "in_progress" ||
      item.status === "submitted_for_review" ||
      item.status === "accepted" ||
      item.status === "returned" ||
      item.status === "blocked" ||
      item.status === "cancelled")
  );
}

async function readLog(logPath: string): Promise<BoardClaimLogLine[]> {
  let raw: string;
  try {
    raw = await fs.readFile(logPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const lines: BoardClaimLogLine[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    try {
      const parsed = JSON.parse(line) as BoardClaimLogLine;
      if (parsed?.kind === "board_claim" && isBoardClaimItem(parsed.item)) {
        lines.push(parsed);
      }
    } catch {
      // skip corrupt line
    }
  }
  return lines;
}

function latestItem(lines: BoardClaimLogLine[], itemId: string): GroupBoardClaimItem | null {
  let latest: GroupBoardClaimItem | null = null;
  for (const line of lines) {
    if (line.item.itemId === itemId) {
      latest = line.item;
    }
  }
  return latest;
}

export async function loadBoardClaimItem(
  authority: RuntimeAuthority,
  params: { taskId: string; itemId: string },
): Promise<GroupBoardClaimItem | null> {
  const taskId = compact(params.taskId);
  const itemId = compact(params.itemId);
  if (!safeStem(taskId) || !itemId) {
    return null;
  }
  const lines = await readLog(boardClaimLogPath(boardClaimsDir(authority), taskId));
  return latestItem(lines, itemId);
}

/** Latest full board items across every task log in this authority namespace. */
export async function listAllBoardClaimItems(
  authority: RuntimeAuthority,
): Promise<GroupBoardClaimItem[]> {
  const dir = boardClaimsDir(authority);
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const items: GroupBoardClaimItem[] = [];
  for (const name of entries) {
    if (!name.endsWith(".jsonl")) {
      continue;
    }
    const taskId = decodeURIComponent(name.slice(0, -".jsonl".length));
    items.push(...(await listBoardClaimItems(authority, { taskId })));
  }
  return items;
}

export async function listBoardClaimItems(
  authority: RuntimeAuthority,
  params: { taskId: string },
): Promise<GroupBoardClaimItem[]> {
  const taskId = compact(params.taskId);
  if (!safeStem(taskId)) {
    return [];
  }
  const lines = await readLog(boardClaimLogPath(boardClaimsDir(authority), taskId));
  const byId = new Map<string, GroupBoardClaimItem>();
  for (const line of lines) {
    byId.set(line.item.itemId, line.item);
  }
  return [...byId.values()];
}

/** Legacy rows without revision are treated as 0. */
export function boardClaimRevision(
  item: Pick<GroupBoardClaimItem, "revision"> | null | undefined,
): number {
  const rev = item?.revision;
  if (typeof rev === "number" && Number.isFinite(rev) && rev >= 0) {
    return Math.floor(rev);
  }
  return 0;
}

/**
 * Next revision for every successful mutateBoardClaimItem write (and publish=1).
 */
export function nextBoardClaimRevision(
  item: Pick<GroupBoardClaimItem, "revision"> | null | undefined,
): number {
  return boardClaimRevision(item) + 1;
}

/** Mutator result: ok + optional skipAppend for idempotent no-write success. */
type BoardMutateResult =
  | { ok: true; value: GroupBoardClaimItem; skipAppend?: boolean }
  | { ok: false; reason: string; message: string };

/**
 * Atomic RMW for board claim items: withRoundLock → re-read log → mutator → append.
 * Wake / fan-out / insight must run AFTER this returns successfully (outside the lock),
 * and only when ok (skipAppend idempotent success is ok but is not a new transition).
 * All status-changing board paths use this and bump revision on append.
 */
async function mutateBoardClaimItem(
  authority: RuntimeAuthority,
  params: { taskId: string; itemId: string },
  mutator: (current: GroupBoardClaimItem) => BoardMutateResult | Promise<BoardMutateResult>,
  options?: ClaimContractOptions,
): Promise<ClaimResult<GroupBoardClaimItem>> {
  const cfg = options?.cfg;
  const taskId = compact(params.taskId);
  const itemId = compact(params.itemId);
  const stem = safeStem(taskId);
  if (!taskId || !itemId || !stem) {
    return fail("invalid_input", "mutateBoardClaimItem requires safe taskId and itemId");
  }
  assertCollaborationRuntimeWritable(boardClaimsDir(authority), cfg);
  const claimsDir = boardClaimsDir(authority);
  const logPath = boardClaimLogPath(claimsDir, taskId);
  const at = nowOf(options);
  return withRoundLock(claimsDir, stem, async () => {
    const lines = await readLog(logPath);
    const current = latestItem(lines, itemId);
    if (!current) {
      return fail("not_found", `board claim item not found: ${itemId}`);
    }
    const mutated = await mutator(current);
    if (!mutated.ok) {
      return mutated;
    }
    if (mutated.skipAppend) {
      return { ok: true, value: mutated.value };
    }
    await fs.mkdir(claimsDir, { recursive: true });
    await appendJsonlDurable(logPath, {
      kind: "board_claim",
      at,
      item: mutated.value,
    } satisfies BoardClaimLogLine);
    return { ok: true, value: mutated.value };
  });
}

async function appendItem(
  authority: RuntimeAuthority,
  item: GroupBoardClaimItem,
  options?: ClaimContractOptions,
): Promise<void> {
  const cfg = options?.cfg;
  assertCollaborationRuntimeWritable(boardClaimsDir(authority), cfg);
  const claimsDir = boardClaimsDir(authority);
  const stem = safeStem(item.taskId);
  if (!stem) {
    throw new Error("board claim taskId is not a safe id");
  }
  const logPath = boardClaimLogPath(claimsDir, item.taskId);
  const at = nowOf(options);
  await withRoundLock(claimsDir, stem, async () => {
    await fs.mkdir(claimsDir, { recursive: true });
    await appendJsonlDurable(logPath, {
      kind: "board_claim",
      at,
      item,
    } satisfies BoardClaimLogLine);
  });
}

export async function publishBoardItem(
  authority: RuntimeAuthority,
  input: PublishBoardItemInput,
  options?: ClaimContractOptions,
): Promise<ClaimResult<GroupBoardClaimItem>> {
  const cfg = options?.cfg;
  const groupId = compact(input.groupId) || compact(authority.groupId);
  if (!isCollabTaskClaimContractEnabled(cfg, groupId, authority.tenantId)) {
    return flagOff();
  }
  const taskId = compact(input.taskId);
  const publishedBy = compact(input.publishedBy);
  const remainingWork = compact(input.remainingWork);
  const acceptanceCriteria = uniqueIds(input.acceptanceCriteria);
  const constraints = uniqueIds(input.constraints);
  const goal = compact(input.goal) || remainingWork;
  const suggestedRole = compact(input.suggestedRole) || undefined;
  const dueAtMs =
    typeof input.dueAtMs === "number" && Number.isFinite(input.dueAtMs) ? input.dueAtMs : undefined;
  if (!groupId || !taskId || !publishedBy) {
    return fail("invalid_input", "publishBoardItem requires groupId, taskId, publishedBy");
  }
  if (!remainingWork) {
    return fail("invalid_input", "publishBoardItem requires remainingWork");
  }
  if (acceptanceCriteria.length === 0) {
    return fail("invalid_input", "publishBoardItem requires acceptanceCriteria");
  }
  if (!safeStem(taskId)) {
    return fail("invalid_input", "taskId is not a safe id");
  }
  const challengeGate = await assertChallengeWindowForPublish(
    authority,
    {
      taskId,
      groupId,
      challengeWindowId: compact(input.challengeWindowId) || undefined,
      skipChallengeWindow: input.skipChallengeWindow === true,
    },
    options,
  );
  if (!challengeGate.ok) {
    return fail(challengeGate.reason, challengeGate.message);
  }
  const item: GroupBoardClaimItem = {
    itemId: compact(input.itemId) || randomUUID(),
    groupId,
    taskId,
    title: compact(input.title) || taskId,
    remainingWork,
    acceptanceCriteria,
    goal,
    constraints: constraints.length > 0 ? constraints : undefined,
    dueAtMs,
    suggestedRole,
    intendedClaimantIds: uniqueIds(input.intendedClaimantIds),
    publishedBy,
    publishedAt: nowOf(options),
    status: "published",
    revision: 1,
  };
  await appendItem(authority, item, options);
  return { ok: true, value: item };
}

/** Intended list match is case/whitespace-insensitive (platform agentId variants). */
export function isIntendedClaimantId(
  intendedClaimantIds: readonly string[],
  claimantId: string,
): boolean {
  const needle = normalizeAgentIdentifier(claimantId);
  if (!needle) {
    return false;
  }
  for (const raw of intendedClaimantIds) {
    const id = normalizeAgentIdentifier(raw);
    if (id && id === needle) {
      return true;
    }
  }
  return false;
}

export async function claimBoardItem(
  authority: RuntimeAuthority,
  input: ClaimBoardItemInput,
  options?: ClaimContractOptions,
): Promise<ClaimResult<GroupBoardClaimItem>> {
  const cfg = options?.cfg;
  const taskId = compact(input.taskId);
  const itemId = compact(input.itemId);
  const claimantId = compact(input.claimantId);
  if (!taskId || !itemId || !claimantId) {
    return fail("invalid_input", "claimBoardItem requires taskId, itemId, claimantId");
  }
  const expectedRevision =
    typeof input.expectedRevision === "number" && Number.isFinite(input.expectedRevision)
      ? Math.floor(input.expectedRevision)
      : undefined;

  // Read → validate → version check → append inside one withRoundLock (mutateBoardClaimItem).
  // Side effects (wake / fan-out) stay outside after a successful commit.
  const claimed = await mutateBoardClaimItem(
    authority,
    { taskId, itemId },
    (current) => {
      const groupId = compact(current.groupId) || compact(authority.groupId);
      if (!isCollabTaskClaimContractEnabled(cfg, groupId, authority.tenantId)) {
        return flagOff();
      }
      if (current.status !== "published") {
        return fail(
          "invalid_status",
          `board claim item status is ${current.status}; expected published`,
        );
      }
      if (
        current.intendedClaimantIds.length > 0 &&
        !isIntendedClaimantId(current.intendedClaimantIds, claimantId)
      ) {
        return fail("claimant_not_intended", `claimant ${claimantId} is not on the intended list`);
      }
      const currentRev = boardClaimRevision(current);
      if (expectedRevision !== undefined && expectedRevision !== currentRev) {
        return fail(
          "revision_conflict",
          `expected revision ${expectedRevision} but current is ${currentRev}`,
        );
      }
      const next: GroupBoardClaimItem = {
        ...current,
        status: "claimed",
        claimantId,
        claimedAt: nowOf(options),
        revision: nextBoardClaimRevision(current),
      };
      return { ok: true, value: next };
    },
    options,
  );
  if (!claimed.ok) {
    return claimed;
  }

  const wakeGroupId = claimed.value.groupId || authority.groupId;
  await recordWakeEventBestEffort(
    authority,
    {
      groupId: wakeGroupId,
      fromAgentId: claimantId,
      toAgentIds: [claimantId],
      source: "claim",
      outcome: "recorded",
      taskId,
      itemId,
    },
    options,
  );
  // Mode B: fan-out wake to intended \ {claimant} when gray-enabled (default OFF).
  // Idempotent with claim (published→claimed once); empty intended / claimant-only → no-op.
  if (isPostClaimFanoutWakeEnabled(cfg, wakeGroupId, authority.tenantId)) {
    const fanoutTargets = resolvePostClaimFanoutTargets(
      claimed.value.intendedClaimantIds,
      claimantId,
    );
    if (fanoutTargets.length > 0) {
      await recordWakeEventBestEffort(
        authority,
        {
          groupId: wakeGroupId,
          fromAgentId: claimantId,
          toAgentIds: fanoutTargets,
          source: "claim",
          outcome: "recorded",
          taskId,
          itemId,
          reason: "post_claim_intended_fanout",
        },
        options,
      );
    }
  }
  return claimed;
}

export async function applyClaim(
  authority: RuntimeAuthority,
  input: ApplyClaimInput,
  task: Task | GovernedTask,
  effective: EffectiveCollaborationPolicy,
  options?: ClaimContractOptions & {
    memberRoleMap?: readonly GovernanceMemberRoleLike[] | null;
  },
): Promise<ClaimResult<ApplyClaimValue>> {
  const cfg = options?.cfg;
  const taskId = compact(input.taskId);
  const itemId = compact(input.itemId);
  if (!taskId || !itemId) {
    return fail("invalid_input", "applyClaim requires taskId and itemId");
  }
  if (compact(task.taskId) !== taskId) {
    return fail("task_mismatch", "applyClaim taskId does not match task.taskId");
  }
  const applied = await mutateBoardClaimItem(
    authority,
    { taskId, itemId },
    (current) => {
      const groupId = compact(current.groupId) || compact(authority.groupId);
      if (!isCollabTaskClaimContractEnabled(cfg, groupId, authority.tenantId)) {
        return flagOff();
      }
      if (current.status !== "claimed") {
        return fail(
          "invalid_status",
          `board claim item status is ${current.status}; expected claimed`,
        );
      }
      const claimantId = compact(current.claimantId);
      if (!claimantId) {
        return fail("claimant_missing", "claimed item has no claimantId");
      }
      const governed = task as { handoffs?: readonly unknown[] | null };
      const applyBaseHistoryLen = Array.isArray(governed.handoffs) ? governed.handoffs.length : 0;
      const next: GroupBoardClaimItem = {
        ...current,
        status: "applied",
        appliedAt: nowOf(options),
        applyBaseHistoryLen,
        revision: nextBoardClaimRevision(current),
      };
      return { ok: true, value: next };
    },
    options,
  );
  if (!applied.ok) {
    return applied;
  }
  const claimantId = compact(applied.value.claimantId);
  if (!claimantId) {
    return fail("claimant_missing", "claimed item has no claimantId");
  }
  // Responsibility seed is pure derived state — compute after durable board write.
  const assignedMemberIds = uniqueIds([...(task.assignedMemberIds ?? []), claimantId]);
  const responsibility = seedTaskResponsibility({
    task: { ...task, assignedMemberIds },
    effective,
    actor: claimantId,
    nominatedOwnerId: compact(task.ownerMemberId) || undefined,
    memberRoleMap: options?.memberRoleMap ?? undefined,
  });
  return {
    ok: true,
    value: {
      item: applied.value,
      assignedMemberIds,
      responsibility,
    },
  };
}

// --- C1 progress transitions (flag-gated writes; draft chat never enters these) ---

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isBoardClaimSubmissionId(value: string | null | undefined): boolean {
  return Boolean(value && UUID_RE.test(value.trim()));
}

/** FINAL §1.3 / §3.5 P4.5 default: 3 return cycles then escalate human. */
export const DEFAULT_ACCEPTANCE_LOOP_MAX_RETURNS = 3;

export function resolveAcceptanceLoopMaxReturns(cfg?: OpenBotConfig): number {
  try {
    const raw = (cfg ?? loadConfig()).collaboration?.task?.acceptanceLoopMaxReturns;
    if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
      return Math.floor(raw);
    }
  } catch {
    // fall through
  }
  return DEFAULT_ACCEPTANCE_LOOP_MAX_RETURNS;
}

/** Normalize submission body for empty / duplicate checks. */
export function normalizeSubmissionBody(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

/** Empty / whitespace-only submission is never a successful交卷. */
export function isEmptySubmissionBody(value: string | null | undefined): boolean {
  return normalizeSubmissionBody(value).length === 0;
}

/** Pure duplicate of the last returned body (no increment). */
export function isDuplicateSubmissionBody(
  next: string | null | undefined,
  previous: string | null | undefined,
): boolean {
  const a = normalizeSubmissionBody(next);
  const b = normalizeSubmissionBody(previous);
  return a.length > 0 && b.length > 0 && a === b;
}

export function acceptanceLoopExceeded(
  item: Pick<GroupBoardClaimItem, "returnCount">,
  maxReturns: number = DEFAULT_ACCEPTANCE_LOOP_MAX_RETURNS,
): boolean {
  const count = typeof item.returnCount === "number" ? item.returnCount : 0;
  return count >= maxReturns;
}

export type MarkInProgressInput = {
  taskId: string;
  itemId: string;
  actorId: string;
};

export type SubmitForReviewInput = {
  taskId: string;
  itemId: string;
  actorId: string;
  /** Idempotency key; must be UUID. Same id while already submitted → ok. */
  submissionId: string;
  /**
   * FINAL v3 S3: product/artifact version bound to this submission.
   * Required; cannot judge "already submitted" by body summary alone.
   */
  artifactVersion: string;
  submissionSummary?: string;
};

export type AcceptSubmissionInput = {
  taskId: string;
  itemId: string;
  actorId: string;
  /** S3: must equal the current pending submissionId (refuse stale/wrong version). */
  expectedSubmissionId: string;
  /** S3: acceptance rationale — 主答权威 still leaves an audit trail. */
  reason: string;
  /**
   * S3: objective Acceptance clauses checked. Must cover board acceptanceCriteria;
   * authority does not permit skipping criteria.
   */
  checkedAcceptanceCriteria: readonly string[];
  /** S3: when accepting as proxy for another role (e.g. 群主代理). */
  proxyForActorId?: string;
  /** S3: proxy basis / 身份依据 (required when proxyForActorId set). */
  proxyBasis?: string;
};

export type ReturnSubmissionInput = {
  taskId: string;
  itemId: string;
  actorId: string;
  reason: string;
  /** S3: must equal the current pending submissionId (refuse stale/wrong version). */
  expectedSubmissionId: string;
};

export type BlockBoardItemInput = {
  taskId: string;
  itemId: string;
  actorId: string;
  reason?: string;
};

/**
 * blocked → prior in_progress|submitted_for_review (default in_progress).
 * Explicit actor only. The current claimant cannot clear their own block.
 */
export type UnblockBoardItemInput = {
  taskId: string;
  itemId: string;
  actorId: string;
  reason: string;
};

/**
 * published|claimed|applied|in_progress|submitted_for_review → cancelled (terminal).
 * Cancel ≠ block: block is recoverable; cancel exits Mode B / self-advance active sets.
 * Refused from accepted|cancelled|returned|blocked.
 */
export type CancelBoardItemInput = {
  taskId: string;
  itemId: string;
  actorId: string;
  reason?: string;
};

/**
 * Claimants are often stored as `bot:<agentId>` (intendedClaimantIds / claim RPC),
 * while in-process executor tools resolve the session agent as bare `<agentId>`.
 * Treat `bot-2` and `bot:bot-2` (also `agent:`) as the same actor.
 */
function sameClaimantActorId(left: string, right: string): boolean {
  const a = normalizeAgentIdentifier(left);
  const b = normalizeAgentIdentifier(right);
  if (!a || !b) {
    return false;
  }
  if (a === b) {
    return true;
  }
  const strip = (id: string): string => {
    if (id.startsWith("bot:") || id.startsWith("agent:")) {
      return id.slice(id.indexOf(":") + 1);
    }
    return id;
  };
  return strip(a) === strip(b);
}

function requireClaimantActor(item: GroupBoardClaimItem, actorId: string): ClaimResult<string> {
  const claimantId = compact(item.claimantId);
  const actor = compact(actorId);
  if (!claimantId) {
    return fail("claimant_missing", "item has no claimantId");
  }
  if (!actor) {
    return fail("invalid_input", "actorId is required");
  }
  if (!sameClaimantActorId(actor, claimantId)) {
    return fail("actor_not_claimant", `actor ${actor} is not claimant ${claimantId}`);
  }
  // Keep stored claimant form for downstream ownerMemberId / audit fields.
  return { ok: true, value: claimantId };
}

/**
 * claimed|applied|returned|blocked → in_progress.
 * Does not seed responsibility (applyClaim still does that).
 *
 * P2 plan gate: claimant must have a **confirmed** ExecutorPrivateTodolist
 * for this board item; otherwise delivery progress is refused (plan_gate_unconfirmed).
 */
export async function markBoardItemInProgress(
  authority: RuntimeAuthority,
  input: MarkInProgressInput,
  options?: ClaimContractOptions,
): Promise<ClaimResult<GroupBoardClaimItem>> {
  const cfg = options?.cfg;
  if (!isCollabTaskClaimContractEnabled(cfg, authority.groupId, authority.tenantId)) {
    return flagOff();
  }
  const taskId = compact(input.taskId);
  const itemId = compact(input.itemId);
  if (!taskId || !itemId) {
    return fail("invalid_input", "markBoardItemInProgress requires taskId, itemId");
  }
  // P2 plan gate import once (avoids circular module init with todolist → claim).
  const { assertPlanGateAllowsDeliveryProgress } = await import("./executor-private-todolist.js");
  return mutateBoardClaimItem(
    authority,
    { taskId, itemId },
    async (current) => {
      const allowed = new Set(["claimed", "applied", "returned", "blocked"]);
      if (!allowed.has(current.status)) {
        return fail(
          "invalid_status",
          `board claim item status is ${current.status}; expected claimed|applied|returned|blocked`,
        );
      }
      const actor = requireClaimantActor(current, input.actorId);
      if (!actor.ok) {
        return actor;
      }
      const gate = await assertPlanGateAllowsDeliveryProgress(authority, {
        taskId,
        boardItemId: itemId,
        ownerMemberId: actor.value,
      });
      if (!gate.ok) {
        return fail(gate.reason, gate.message);
      }
      const next: GroupBoardClaimItem = {
        ...current,
        status: "in_progress",
        inProgressAt: nowOf(options),
        // clear return/block markers on resume
        returnReason: undefined,
        blockedReason: undefined,
        revision: nextBoardClaimRevision(current),
      };
      return { ok: true, value: next };
    },
    options,
  );
}

/**
 * in_progress|returned → submitted_for_review with submission_id + artifactVersion.
 * Idempotent when already submitted_for_review with the same submissionId + version.
 * Draft chat cannot call this — only explicit submit with UUID + version.
 */
export async function submitBoardItemForReview(
  authority: RuntimeAuthority,
  input: SubmitForReviewInput,
  options?: ClaimContractOptions,
): Promise<ClaimResult<GroupBoardClaimItem>> {
  const cfg = options?.cfg;
  if (!isCollabTaskClaimContractEnabled(cfg, authority.groupId, authority.tenantId)) {
    return flagOff();
  }
  const taskId = compact(input.taskId);
  const itemId = compact(input.itemId);
  const submissionId = compact(input.submissionId);
  const artifactVersion = normalizeArtifactVersion(input.artifactVersion);
  if (!taskId || !itemId) {
    return fail("invalid_input", "submitBoardItemForReview requires taskId, itemId");
  }
  if (!isBoardClaimSubmissionId(submissionId)) {
    return fail("invalid_submission_id", "submissionId must be a UUID");
  }
  if (!isValidArtifactVersion(artifactVersion)) {
    return fail(
      "invalid_artifact_version",
      "artifactVersion is required; submit must bind a product version, not body summary alone",
    );
  }
  let wrote = false;
  const submitted = await mutateBoardClaimItem(
    authority,
    { taskId, itemId },
    (current) => {
      if (
        current.status === "submitted_for_review" &&
        compact(current.submissionId) === submissionId
      ) {
        // Idempotent same id: only ok when prior body non-empty and version matches.
        if (isEmptySubmissionBody(current.submissionSummary)) {
          return fail("empty_submission", "open submission has empty body; not counted as success");
        }
        const priorVersion = normalizeArtifactVersion(current.artifactVersion);
        if (priorVersion !== artifactVersion) {
          return fail(
            "submission_version_clash",
            "same submissionId already open with a different artifactVersion",
          );
        }
        return { ok: true, value: current, skipAppend: true };
      }
      if (current.status === "submitted_for_review") {
        return fail(
          "duplicate_open_submission",
          "item already submitted_for_review with a different submissionId",
        );
      }
      if (current.status !== "in_progress" && current.status !== "returned") {
        return fail(
          "invalid_status",
          `board claim item status is ${current.status}; expected in_progress|returned`,
        );
      }
      // P4/S3: empty / whitespace-only body is never a successful交卷 (new submits only).
      const summaryBody = normalizeSubmissionBody(input.submissionSummary);
      if (isEmptySubmissionBody(input.submissionSummary)) {
        return fail(
          "empty_submission",
          "submissionSummary is required and must be non-empty; empty/duplicate does not count as success",
        );
      }
      // P4/S3: pure restate of last returned body = no increment → not success.
      if (
        isDuplicateSubmissionBody(summaryBody, current.lastReturnedSubmissionSummary) ||
        (current.status === "returned" &&
          isDuplicateSubmissionBody(summaryBody, current.submissionSummary))
      ) {
        return fail(
          "duplicate_submission",
          "submissionSummary duplicates the previous returned body; no increment does not count as success",
        );
      }
      const actor = requireClaimantActor(current, input.actorId);
      if (!actor.ok) {
        return actor;
      }
      wrote = true;
      const next: GroupBoardClaimItem = {
        ...current,
        status: "submitted_for_review",
        submissionId,
        artifactVersion,
        submittedAt: nowOf(options),
        submissionSummary: summaryBody,
        revision: nextBoardClaimRevision(current),
      };
      return { ok: true, value: next };
    },
    options,
  );
  if (!submitted.ok) {
    return submitted;
  }
  // P1: best-effort wake 主答/coordinator after a real submit transition (outside lock).
  // Prefer options.coordinatorBotId (entry loads operating-state); fallback publishedBy.
  // Never intendedClaimant. Source "insight" = wake 主答 (no WAKE_SOURCES "submit").
  // Fail-open: wake miss must not flip the submit Result. Skip on idempotent no-write.
  if (wrote) {
    const reviewer = compact(options?.coordinatorBotId) || compact(submitted.value.publishedBy);
    const fromAgentId = compact(input.actorId) || compact(submitted.value.claimantId);
    if (reviewer && fromAgentId) {
      await recordWakeEventBestEffort(
        authority,
        {
          groupId: submitted.value.groupId || authority.groupId,
          fromAgentId,
          toAgentIds: [reviewer],
          source: "insight",
          outcome: "recorded",
          taskId,
          itemId,
          reason: "submit_for_review",
          relatedId: submissionId,
        },
        options,
      );
    }
  }
  return submitted;
}

/** submitted_for_review → accepted (coordinator/owner); version + criteria bound (S3). */
export async function acceptBoardItemSubmission(
  authority: RuntimeAuthority,
  input: AcceptSubmissionInput,
  options?: ClaimContractOptions,
): Promise<ClaimResult<GroupBoardClaimItem>> {
  const cfg = options?.cfg;
  if (!isCollabTaskClaimContractEnabled(cfg, authority.groupId, authority.tenantId)) {
    return flagOff();
  }
  const taskId = compact(input.taskId);
  const itemId = compact(input.itemId);
  const actorId = compact(input.actorId);
  const reason = compact(input.reason);
  if (!taskId || !itemId || !actorId) {
    return fail("invalid_input", "acceptBoardItemSubmission requires taskId, itemId, actorId");
  }
  if (!reason) {
    return fail(
      "acceptance_reason_required",
      "accept requires reason; 主答权威 still leaves an auditable rationale",
    );
  }
  // Batch 5: single-target lane only. Other groups keep the existing accept checks.
  // This does not add an accept caller and does not let self_advance accept.
  const existing = await loadBoardClaimItem(authority, { taskId, itemId });
  if (existing) {
    const laneRefusal = await guardUnattendedAccept(authority, {
      cfg,
      actorId,
      publishedBy: existing.publishedBy,
      coordinatorBotId: options?.coordinatorBotId,
      taskId,
      itemId,
      nowMs: options?.nowMs,
    });
    if (laneRefusal) {
      return laneRefusal;
    }
  }
  return mutateBoardClaimItem(
    authority,
    { taskId, itemId },
    async (current) => {
      if (current.status !== "submitted_for_review") {
        return fail(
          "invalid_status",
          `board claim item status is ${current.status}; expected submitted_for_review (late accept of prior version refused)`,
        );
      }
      const versionGate = pendingSubmissionMatches({
        currentSubmissionId: current.submissionId,
        expectedSubmissionId: input.expectedSubmissionId,
      });
      if (!versionGate.ok) {
        return fail(versionGate.reason, versionGate.message);
      }
      if (!compact(current.artifactVersion)) {
        return fail(
          "artifact_version_missing",
          "pending submission has no artifactVersion; cannot accept unbound version",
        );
      }
      const criteriaGate = acceptanceCriteriaFullyChecked({
        boardCriteria: current.acceptanceCriteria,
        checkedCriteria: input.checkedAcceptanceCriteria,
      });
      if (!criteriaGate.ok) {
        return fail(
          criteriaGate.reason,
          criteriaGate.reason === "acceptance_criteria_incomplete"
            ? `accept must check all board Acceptance criteria; missing: ${criteriaGate.missing.join("; ")}`
            : "accept must check objective Acceptance criteria; 主答权威 ≠ skip criteria",
        );
      }
      const proxyGate = assertAcceptanceProxyFields({
        proxyForActorId: input.proxyForActorId,
        proxyBasis: input.proxyBasis,
      });
      if (!proxyGate.ok) {
        return fail(proxyGate.reason, proxyGate.message);
      }
      const peerGate = await assertPeerReviewGateForAccept(authority, current, options);
      if (!peerGate.ok) {
        return peerGate;
      }
      const checked = (input.checkedAcceptanceCriteria ?? [])
        .map((c) => c.trim())
        .filter((c) => c.length > 0);
      const next: GroupBoardClaimItem = {
        ...current,
        status: "accepted",
        acceptedAt: nowOf(options),
        acceptedBy: actorId,
        acceptedSubmissionId: compact(current.submissionId),
        acceptedArtifactVersion: normalizeArtifactVersion(current.artifactVersion),
        acceptanceReason: reason,
        checkedAcceptanceCriteria: checked,
        acceptanceVerdict: "pass",
        acceptanceProxyForActorId: compact(input.proxyForActorId) || undefined,
        acceptanceProxyBasis: compact(input.proxyBasis) || undefined,
        revision: nextBoardClaimRevision(current),
      };
      return { ok: true, value: next };
    },
    options,
  );
}

/** submitted_for_review → returned (structured wake of claimant — Wake Contract C2). */
export async function returnBoardItemSubmission(
  authority: RuntimeAuthority,
  input: ReturnSubmissionInput,
  options?: ClaimContractOptions,
): Promise<ClaimResult<GroupBoardClaimItem>> {
  const cfg = options?.cfg;
  if (!isCollabTaskClaimContractEnabled(cfg, authority.groupId, authority.tenantId)) {
    return flagOff();
  }
  const taskId = compact(input.taskId);
  const itemId = compact(input.itemId);
  const actorId = compact(input.actorId);
  const reason = compact(input.reason);
  if (!taskId || !itemId || !actorId) {
    return fail("invalid_input", "returnBoardItemSubmission requires taskId, itemId, actorId");
  }
  if (!reason) {
    return fail("invalid_input", "returnBoardItemSubmission requires reason");
  }
  const maxReturns = resolveAcceptanceLoopMaxReturns(cfg);
  const returned = await mutateBoardClaimItem(
    authority,
    { taskId, itemId },
    (current) => {
      if (current.status !== "submitted_for_review") {
        return fail(
          "invalid_status",
          `board claim item status is ${current.status}; expected submitted_for_review (late return of prior version refused)`,
        );
      }
      const versionGate = pendingSubmissionMatches({
        currentSubmissionId: current.submissionId,
        expectedSubmissionId: input.expectedSubmissionId,
      });
      if (!versionGate.ok) {
        return fail(versionGate.reason, versionGate.message);
      }
      const priorCount = typeof current.returnCount === "number" ? current.returnCount : 0;
      const nextCount = priorCount + 1;
      const pendingSubmissionId = compact(current.submissionId);
      const pendingArtifactVersion = normalizeArtifactVersion(current.artifactVersion);
      const next: GroupBoardClaimItem = {
        ...current,
        status: "returned",
        returnedAt: nowOf(options),
        returnedBy: actorId,
        returnReason: reason,
        returnCount: nextCount,
        lastReturnedSubmissionSummary:
          normalizeSubmissionBody(current.submissionSummary) ||
          current.lastReturnedSubmissionSummary,
        lastReturnedSubmissionId: pendingSubmissionId || current.lastReturnedSubmissionId,
        lastReturnedArtifactVersion: pendingArtifactVersion || current.lastReturnedArtifactVersion,
        // S3: invalidate pending submission so late accept cannot target this version.
        submissionId: undefined,
        artifactVersion: undefined,
        submittedAt: undefined,
        revision: nextBoardClaimRevision(current),
      };
      return { ok: true, value: next };
    },
    options,
  );
  if (!returned.ok) {
    return returned;
  }
  const next = returned.value;
  const nextCount = typeof next.returnCount === "number" ? next.returnCount : 0;
  // Wake / escalate outside lock, only after durable success.
  const claimantId = compact(next.claimantId);
  if (claimantId) {
    await recordWakeEventBestEffort(
      authority,
      {
        groupId: next.groupId || authority.groupId,
        fromAgentId: actorId,
        toAgentIds: [claimantId],
        source: "return",
        outcome: "recorded",
        taskId,
        itemId,
        reason,
      },
      options,
    );
  }
  // P4.5: over acceptance-loop cap → escalate to human / coordinator (wake).
  if (nextCount >= maxReturns) {
    const escalateTo: string[] = [];
    const coordinator = compact(
      (options as ClaimContractOptions & { coordinatorBotId?: string | null })?.coordinatorBotId,
    );
    if (coordinator) {
      escalateTo.push(coordinator);
    }
    if (escalateTo.length === 0) {
      escalateTo.push(actorId);
    }
    await recordWakeEventBestEffort(
      authority,
      {
        groupId: next.groupId || authority.groupId,
        fromAgentId: actorId,
        toAgentIds: escalateTo,
        source: "escalate",
        outcome: "recorded",
        taskId,
        itemId,
        reason: `acceptance_loop_exceeded:${nextCount}/${maxReturns}:${reason}`,
      },
      options,
    );
  }
  return returned;
}

/** in_progress|submitted_for_review → blocked. */
export async function blockBoardItem(
  authority: RuntimeAuthority,
  input: BlockBoardItemInput,
  options?: ClaimContractOptions,
): Promise<ClaimResult<GroupBoardClaimItem>> {
  const cfg = options?.cfg;
  if (!isCollabTaskClaimContractEnabled(cfg, authority.groupId, authority.tenantId)) {
    return flagOff();
  }
  const taskId = compact(input.taskId);
  const itemId = compact(input.itemId);
  const actorId = compact(input.actorId);
  if (!taskId || !itemId || !actorId) {
    return fail("invalid_input", "blockBoardItem requires taskId, itemId, actorId");
  }
  return mutateBoardClaimItem(
    authority,
    { taskId, itemId },
    (current) => {
      if (current.status !== "in_progress" && current.status !== "submitted_for_review") {
        return fail(
          "invalid_status",
          `board claim item status is ${current.status}; expected in_progress|submitted_for_review`,
        );
      }
      const next: GroupBoardClaimItem = {
        ...current,
        status: "blocked",
        blockedAt: nowOf(options),
        blockedReason: compact(input.reason) || undefined,
        blockedBy: actorId,
        blockedFromStatus: current.status,
        revision: nextBoardClaimRevision(current),
      };
      return { ok: true, value: next };
    },
    options,
  );
}

const UNBLOCK_RESTORE_STATUSES = new Set(["in_progress", "submitted_for_review"]);

/**
 * Explicit recovery from blocked. Does not run from heartbeat or self-advance.
 * Restores blockedFromStatus when that status is still a board state self-advance
 * or review can see; otherwise in_progress. Cancelled/accepted are not inputs.
 */
export async function unblockBoardItem(
  authority: RuntimeAuthority,
  input: UnblockBoardItemInput,
  options?: ClaimContractOptions,
): Promise<ClaimResult<GroupBoardClaimItem>> {
  const cfg = options?.cfg;
  if (!isCollabTaskClaimContractEnabled(cfg, authority.groupId, authority.tenantId)) {
    return flagOff();
  }
  const taskId = compact(input.taskId);
  const itemId = compact(input.itemId);
  const actorId = compact(input.actorId);
  const reason = compact(input.reason);
  if (!taskId || !itemId || !actorId || !reason) {
    return fail("invalid_input", "unblockBoardItem requires taskId, itemId, actorId, reason");
  }
  return mutateBoardClaimItem(
    authority,
    { taskId, itemId },
    (current) => {
      if (current.status !== "blocked") {
        return fail(
          "invalid_status",
          `board claim item status is ${current.status}; unblock requires blocked (cancel/terminal stay stopped)`,
        );
      }
      const claimantId = compact(current.claimantId);
      if (claimantId && actorId === claimantId) {
        return fail(
          "self_unblock_forbidden",
          "current claimant cannot clear their own block; a different actor must unblock",
        );
      }
      const prior = compact(current.blockedFromStatus);
      const restored = UNBLOCK_RESTORE_STATUSES.has(prior) ? prior : "in_progress";
      const next: GroupBoardClaimItem = {
        ...current,
        status: restored as GroupBoardClaimItem["status"],
        unblockedAt: nowOf(options),
        unblockedBy: actorId,
        unblockReason: reason,
        revision: nextBoardClaimRevision(current),
      };
      return { ok: true, value: next };
    },
    options,
  );
}

/**
 * published|claimed|applied|in_progress|submitted_for_review → cancelled (terminal).
 * Platform Mode B: clears stale/smoke items that would otherwise occupy self-advance
 * active set. Cancel ≠ block (block is recoverable; cancel is terminal).
 * Group-agnostic — no hard-coded group ids.
 * Refused from accepted|cancelled|returned|blocked.
 */
export async function cancelBoardItem(
  authority: RuntimeAuthority,
  input: CancelBoardItemInput,
  options?: ClaimContractOptions,
): Promise<ClaimResult<GroupBoardClaimItem>> {
  const cfg = options?.cfg;
  if (!isCollabTaskClaimContractEnabled(cfg, authority.groupId, authority.tenantId)) {
    return flagOff();
  }
  const taskId = compact(input.taskId);
  const itemId = compact(input.itemId);
  const actorId = compact(input.actorId);
  if (!taskId || !itemId || !actorId) {
    return fail("invalid_input", "cancelBoardItem requires taskId, itemId, actorId");
  }
  return mutateBoardClaimItem(
    authority,
    { taskId, itemId },
    (current) => {
      const allowed = new Set([
        "published",
        "claimed",
        "applied",
        "in_progress",
        "submitted_for_review",
      ]);
      if (!allowed.has(current.status)) {
        return fail(
          "invalid_status",
          `board claim item status is ${current.status}; expected published|claimed|applied|in_progress|submitted_for_review (cancel is terminal; use unblock for blocked)`,
        );
      }
      const next: GroupBoardClaimItem = {
        ...current,
        status: "cancelled",
        cancelledAt: nowOf(options),
        cancelledBy: actorId,
        cancelledReason: compact(input.reason) || undefined,
        revision: nextBoardClaimRevision(current),
      };
      return { ok: true, value: next };
    },
    options,
  );
}

/**
 * List latest board items for a task (read-only; no flag required).
 * Enables tip progress visibility without ui.* RPC.
 */
export async function listBoardClaimItemsReadOnly(
  authority: RuntimeAuthority,
  params: { taskId: string },
): Promise<GroupBoardClaimItem[]> {
  return listBoardClaimItems(authority, params);
}

/** Plan flag `collab.task.boardKickoffMultiParticipantGroupAllowlist` (default empty). */
export function resolveBoardKickoffMultiParticipantGroupAllowlist(cfg?: OpenBotConfig): string[] {
  try {
    const raw = (cfg ?? loadConfig()).collaboration?.task
      ?.boardKickoffMultiParticipantGroupAllowlist;
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

export function isGroupOnBoardKickoffMultiParticipantAllowlist(params: {
  groupId: string;
  tenantId?: string | null;
  cfg?: OpenBotConfig;
}): boolean {
  return matchGrayGroupAllowlist({
    groupId: params.groupId,
    tenantId: params.tenantId,
    entries: resolveBoardKickoffMultiParticipantGroupAllowlist(params.cfg),
  });
}

/**
 * Enabled when global `boardKickoffMultiParticipant===true` **or** groupId is on
 * allowlist. Platform default: both off.
 */
export function isBoardKickoffMultiParticipantEnabled(
  cfg?: OpenBotConfig,
  groupId?: string | null,
  tenantId?: string | null,
): boolean {
  try {
    const resolved = cfg ?? loadConfig();
    if (resolved.collaboration?.task?.boardKickoffMultiParticipant === true) {
      return true;
    }
    const gid = groupId?.trim();
    if (!gid) {
      return false;
    }
    return isGroupOnBoardKickoffMultiParticipantAllowlist({
      groupId: gid,
      tenantId,
      cfg: resolved,
    });
  } catch {
    return false;
  }
}

function uniqueAgentIds(values: readonly (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const id = compact(value);
    if (!id) {
      continue;
    }
    const needle = normalizeAgentIdentifier(id) ?? id.toLowerCase();
    if (!needle || seen.has(needle)) {
      continue;
    }
    seen.add(needle);
    out.push(id);
  }
  return out;
}

/** Intended ids from active Mode B board items (published→blocked). */
export function collectActiveBoardIntendedClaimantIds(
  items: readonly Pick<GroupBoardClaimItem, "status" | "intendedClaimantIds">[],
): string[] {
  const active = modeBActiveBoardItems(items);
  return uniqueAgentIds(active.flatMap((item) => item.intendedClaimantIds ?? []));
}

/**
 * Mention lead(s) first, then remaining intended ∩ group. Empty / <2 → [].
 */
export function resolveBoardKickoffMultiParticipantBots(params: {
  groupBots: readonly CollaborationBotTarget[];
  mentionMatchedBots: readonly CollaborationBotTarget[];
  intendedClaimantIds: readonly string[];
}): CollaborationBotTarget[] {
  const intendedNeedles = new Set(
    uniqueAgentIds(params.intendedClaimantIds)
      .map((id) => normalizeAgentIdentifier(id) ?? id.toLowerCase())
      .filter(Boolean),
  );
  if (intendedNeedles.size === 0) {
    return [];
  }
  const byNeedle = new Map<string, CollaborationBotTarget>();
  for (const bot of params.groupBots) {
    const needle = normalizeAgentIdentifier(bot.agentId) ?? bot.agentId.trim().toLowerCase();
    if (needle && !byNeedle.has(needle)) {
      byNeedle.set(needle, bot);
    }
  }
  const out: CollaborationBotTarget[] = [];
  const seen = new Set<string>();
  const push = (bot: CollaborationBotTarget | undefined) => {
    if (!bot) {
      return;
    }
    const needle = normalizeAgentIdentifier(bot.agentId) ?? bot.agentId.trim().toLowerCase();
    if (!needle || seen.has(needle)) {
      return;
    }
    seen.add(needle);
    out.push(bot);
  };
  for (const bot of params.mentionMatchedBots) {
    push(bot);
  }
  for (const raw of params.intendedClaimantIds) {
    const needle = normalizeAgentIdentifier(raw) ?? compact(raw).toLowerCase();
    if (!needle || !intendedNeedles.has(needle)) {
      continue;
    }
    push(byNeedle.get(needle));
  }
  const capped = out.slice(0, COLLABORATION_ABSOLUTE_VISIBLE_TURN_LIMIT);
  return capped.length >= 2 ? capped : [];
}

/**
 * When gray-enabled + board intended present + decision is single named @mention,
 * rewrite to explicit_multi over mention∪intended ∩ group. Else unchanged.
 */
export function applyBoardKickoffMultiParticipant(params: {
  decision: ParticipationDecision;
  groupId: string;
  tenantId?: string | null;
  groupBots: readonly CollaborationBotTarget[];
  intendedClaimantIds?: readonly string[] | null;
  cfg?: OpenBotConfig;
}): ParticipationDecision {
  if (!isBoardKickoffMultiParticipantEnabled(params.cfg, params.groupId, params.tenantId)) {
    return params.decision;
  }
  const decision = params.decision;
  if (decision.mentionConfirm || decision.mentionUnmatched) {
    return decision;
  }
  if (decision.mentionMode !== "single_primary" || decision.primaryMode !== "single") {
    return decision;
  }
  const intended = uniqueAgentIds(params.intendedClaimantIds ?? []);
  if (intended.length === 0) {
    return decision;
  }
  const mentionOrdered: CollaborationBotTarget[] = [];
  for (const id of decision.primaryQueue) {
    const needle = normalizeAgentIdentifier(id) ?? id.trim().toLowerCase();
    const bot =
      decision.executionBots.find(
        (b) => (normalizeAgentIdentifier(b.agentId) ?? b.agentId) === needle,
      ) ??
      params.groupBots.find((b) => (normalizeAgentIdentifier(b.agentId) ?? b.agentId) === needle);
    if (bot) {
      mentionOrdered.push(bot);
    }
  }
  const tier0 = resolveBoardKickoffMultiParticipantBots({
    groupBots: params.groupBots,
    mentionMatchedBots: mentionOrdered,
    intendedClaimantIds: intended,
  });
  if (tier0.length < 2) {
    return decision;
  }
  return buildCollaborationRoundPlan({
    roundId: decision.roundId,
    sessionKey: decision.roundPlan.sessionKey,
    responseMode:
      decision.responseMode === "debate_or_brainstorm"
        ? "debate_or_brainstorm"
        : "lead_plus_supplement",
    tier0,
    tier1: [],
    tier1Meta: [],
    tier2: [],
    alerts: [
      ...(decision.roundPlan.alerts ?? []),
      {
        kind: "mode_b_board_lead",
        message: `看板挂板 kickoff：@提及未锁单主答，本轮请 ${tier0.length} 位 intended 成员依次参与`,
      },
    ],
    lowSignalLimited: false,
    mentionUnmatched: false,
    mentionConfirm: null,
    primaryMode: "explicit_multi",
    mentionMode: "explicit_multi",
    mentionAll: decision.roundPlan.mentionAll === true,
  });
}

/**
 * Composition-root / round-runtime helper: when gray-on, load active board
 * intendedClaimantIds and expand a single-@mention decision to multi-participant.
 * Best-effort: board IO errors leave the decision unchanged.
 */
export async function maybeExpandBoardKickoffDecision(params: {
  authority: RuntimeAuthority;
  decision: ParticipationDecision;
  groupBots: readonly CollaborationBotTarget[];
  cfg?: OpenBotConfig;
}): Promise<ParticipationDecision> {
  const cfg = params.cfg;
  const groupId = params.authority.groupId;
  const tenantId = params.authority.tenantId;
  if (!isBoardKickoffMultiParticipantEnabled(cfg, groupId, tenantId)) {
    return params.decision;
  }
  if (
    params.decision.mentionMode !== "single_primary" ||
    params.decision.primaryMode !== "single"
  ) {
    return params.decision;
  }
  try {
    const items = (await loadBoardClaimItemsFromDir(
      boardClaimsDir(params.authority),
    )) as GroupBoardClaimItem[];
    const intended = collectActiveBoardIntendedClaimantIds(items);
    if (intended.length === 0) {
      return params.decision;
    }
    return applyBoardKickoffMultiParticipant({
      decision: params.decision,
      groupId,
      tenantId,
      groupBots: params.groupBots,
      intendedClaimantIds: intended,
      cfg,
    });
  } catch {
    return params.decision;
  }
}
