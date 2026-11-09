import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
/**
 * C3 — Peer review gate before accept (2026-10-13).
 *
 * Inventory-first gap for upgrade plan §4 C3:
 *   Accept final submission only after ≥1 non-author peer review when
 *   `collaboration.task.requirePeerReview` is ON (default OFF).
 *
 * Review events append under `<ns>/peer-reviews/`. RCIS may observe
 * accepted/review via quality ledger best-effort; `drivesAdmission` stays false.
 *
 * Non-goals: Floor live, ui.* RPC, default-on flag, second orchestrator,
 * inventing a multi-beat controller, bypassing Steward / Exec Approvals.
 */
import {
  peerReviewAcceptAllowed,
  peerReviewMustNotDriveAdmission,
} from "../../agent-runtime/policy/index.js";
import { appendPeerReviewLog } from "../../agent-runtime/state/index.js";
import { loadConfig } from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import { recordCollaborationQualityBestEffort } from "../collaboration-ledger/writer.js";
import { isCollabTaskClaimContractEnabled } from "./claim-contract.js";
import type { RuntimeAuthority } from "./runtime-authority.js";
import { assertCollaborationRuntimeWritable } from "./runtime-namespace.js";

export const PEER_REVIEW_VERDICTS = ["approve", "revise"] as const;
export type PeerReviewVerdict = (typeof PEER_REVIEW_VERDICTS)[number];

export type PeerReviewEvent = Readonly<{
  reviewId: string;
  groupId: string;
  taskId: string;
  itemId: string;
  /** Submission under review (must match item.submissionId). */
  submissionId: string;
  /** Non-author reviewer. */
  reviewerId: string;
  /** Author / claimant of the board item. */
  authorId: string;
  verdict: PeerReviewVerdict;
  comment?: string;
  at: number;
  /** Observe-only: never feeds Admission. */
  drivesAdmission: false;
}>;

export type PeerReviewResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string; message: string };

export type PeerReviewGateOptions = {
  cfg?: OpenBotConfig;
  nowMs?: number;
};

/** Minimal board item shape needed by the gate (avoids claim-contract import cycle). */
export type PeerReviewBoardItem = Readonly<{
  itemId: string;
  groupId: string;
  taskId: string;
  status: string;
  claimantId?: string;
  submissionId?: string;
}>;

export type PeerReviewClaimResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string; message: string };

type PeerReviewLogLine = {
  kind: "peer_review";
  at: number;
  event: PeerReviewEvent;
};

/** Plan flag `collab.task.requirePeerReview` → default false. */
export function isCollabTaskRequirePeerReviewEnabled(cfg?: OpenBotConfig): boolean {
  try {
    return (cfg ?? loadConfig()).collaboration?.task?.requirePeerReview === true;
  } catch {
    return false;
  }
}

export { peerReviewMustNotDriveAdmission };

function fail(reason: string, message: string): PeerReviewResult<never> {
  return { ok: false, reason, message };
}

function claimFlagOff<T>(): PeerReviewResult<T> {
  return fail("flag_off", "collaboration.task.claimContract is off; peer review does not write");
}

function nowOf(options?: PeerReviewGateOptions): number {
  return options?.nowMs ?? Date.now();
}

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

/** Peer reviews live under `<ns>/peer-reviews` (alongside board-claims). */
export function peerReviewsDir(authority: RuntimeAuthority): string {
  return path.join(authority.namespace.root, "peer-reviews");
}

export function peerReviewLogPath(reviewsDir: string, taskId: string): string {
  const stem = safeStem(taskId);
  if (!stem) {
    throw new Error("peer review taskId is not a safe id");
  }
  return path.join(reviewsDir, `${stem}.jsonl`);
}

function isPeerReviewEvent(value: unknown): value is PeerReviewEvent {
  if (!value || typeof value !== "object") {
    return false;
  }
  const event = value as PeerReviewEvent;
  return (
    typeof event.reviewId === "string" &&
    typeof event.groupId === "string" &&
    typeof event.taskId === "string" &&
    typeof event.itemId === "string" &&
    typeof event.submissionId === "string" &&
    typeof event.reviewerId === "string" &&
    typeof event.authorId === "string" &&
    typeof event.verdict === "string" &&
    (PEER_REVIEW_VERDICTS as readonly string[]).includes(event.verdict) &&
    typeof event.at === "number" &&
    !event.drivesAdmission
  );
}

async function readLog(logPath: string): Promise<PeerReviewLogLine[]> {
  let raw: string;
  try {
    raw = await fs.readFile(logPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const lines: PeerReviewLogLine[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    try {
      const parsed = JSON.parse(line) as PeerReviewLogLine;
      if (parsed?.kind === "peer_review" && isPeerReviewEvent(parsed.event)) {
        lines.push(parsed);
      }
    } catch {
      // skip corrupt line
    }
  }
  return lines;
}

export async function listPeerReviews(
  authority: RuntimeAuthority,
  params: { taskId: string; itemId?: string; submissionId?: string },
): Promise<PeerReviewEvent[]> {
  const taskId = compact(params.taskId);
  if (!safeStem(taskId)) {
    return [];
  }
  const lines = await readLog(peerReviewLogPath(peerReviewsDir(authority), taskId));
  const itemId = compact(params.itemId);
  const submissionId = compact(params.submissionId);
  return lines
    .map((line) => line.event)
    .filter((event) => {
      if (itemId && event.itemId !== itemId) {
        return false;
      }
      if (submissionId && event.submissionId !== submissionId) {
        return false;
      }
      return true;
    });
}

/**
 * Non-author reviews for the current submission (self-review never counts).
 */
export async function countNonAuthorPeerReviews(
  authority: RuntimeAuthority,
  params: { taskId: string; itemId: string; submissionId: string; authorId: string },
): Promise<number> {
  const authorId = compact(params.authorId);
  const reviews = await listPeerReviews(authority, {
    taskId: params.taskId,
    itemId: params.itemId,
    submissionId: params.submissionId,
  });
  return reviews.filter((event) => compact(event.reviewerId) !== authorId).length;
}

export type RecordPeerReviewInput = {
  taskId: string;
  itemId: string;
  reviewerId: string;
  verdict: PeerReviewVerdict;
  comment?: string;
  reviewId?: string;
  /** Caller-loaded board item (must be submitted_for_review). */
  item: PeerReviewBoardItem;
};

/**
 * Record a peer review on a submitted_for_review board item.
 * Requires claimContract ON. Reviewer must not be the claimant (author).
 * Writes are independent of requirePeerReview (gate only affects accept).
 */
export async function recordPeerReview(
  authority: RuntimeAuthority,
  input: RecordPeerReviewInput,
  options?: PeerReviewGateOptions,
): Promise<PeerReviewResult<PeerReviewEvent>> {
  const cfg = options?.cfg;
  // Writes still require claimContract ON (global or gray allowlist; same fail-closed surface).
  try {
    if (!isCollabTaskClaimContractEnabled(cfg, authority.groupId, authority.tenantId)) {
      return claimFlagOff();
    }
  } catch {
    return claimFlagOff();
  }
  const taskId = compact(input.taskId);
  const itemId = compact(input.itemId);
  const reviewerId = compact(input.reviewerId);
  const verdict = input.verdict;
  if (!taskId || !itemId || !reviewerId) {
    return fail("invalid_input", "recordPeerReview requires taskId, itemId, reviewerId");
  }
  if (!(PEER_REVIEW_VERDICTS as readonly string[]).includes(verdict)) {
    return fail("invalid_verdict", "verdict must be approve|revise");
  }
  const current = input.item;
  if (!current || compact(current.itemId) !== itemId || compact(current.taskId) !== taskId) {
    return fail("not_found", `board claim item not found: ${itemId}`);
  }
  if (current.status !== "submitted_for_review") {
    return fail(
      "invalid_status",
      `board claim item status is ${current.status}; expected submitted_for_review`,
    );
  }
  const submissionId = compact(current.submissionId);
  if (!submissionId) {
    return fail("submission_missing", "submitted item has no submissionId");
  }
  const authorId = compact(current.claimantId);
  if (!authorId) {
    return fail("claimant_missing", "item has no claimantId");
  }
  if (reviewerId === authorId) {
    return fail("self_review_forbidden", "author cannot peer-review their own submission");
  }
  const at = nowOf(options);
  const event: PeerReviewEvent = {
    reviewId: compact(input.reviewId) || randomUUID(),
    groupId: compact(current.groupId) || compact(authority.groupId),
    taskId,
    itemId,
    submissionId,
    reviewerId,
    authorId,
    verdict,
    comment: compact(input.comment) || undefined,
    at,
    drivesAdmission: false,
  };
  assertCollaborationRuntimeWritable(peerReviewsDir(authority), cfg);
  const reviewsDir = peerReviewsDir(authority);
  const stem = safeStem(taskId);
  if (!stem) {
    return fail("invalid_input", "taskId is not a safe id");
  }
  const logPath = peerReviewLogPath(reviewsDir, taskId);
  await appendPeerReviewLog({ reviewsDir, stem, logPath, at, event });
  // RCIS observe-only: quality ledger review event (never Admission).
  recordCollaborationQualityBestEffort({
    groupId: event.groupId,
    event: "review",
    outcome: verdict === "approve" ? "accepted" : "rejected",
    agentId: authorId,
    taskId,
    reviewId: event.reviewId,
    reviewVerdict: verdict,
  });
  return { ok: true, value: event };
}

/**
 * Gate for acceptBoardItemSubmission when requirePeerReview is ON.
 * Flag-off → allow (unchanged AS-IS). Flag-on → need ≥1 non-author review.
 */
export async function assertPeerReviewGateForAccept(
  authority: RuntimeAuthority,
  item: PeerReviewBoardItem,
  options?: PeerReviewGateOptions,
): Promise<PeerReviewClaimResult<true>> {
  const cfg = options?.cfg;
  if (!isCollabTaskRequirePeerReviewEnabled(cfg)) {
    return { ok: true, value: true };
  }
  const taskId = compact(item.taskId);
  const itemId = compact(item.itemId);
  const submissionId = compact(item.submissionId);
  const authorId = compact(item.claimantId);
  if (!taskId || !itemId || !submissionId || !authorId) {
    return {
      ok: false,
      reason: "peer_review_precondition",
      message: "requirePeerReview ON but item lacks taskId/itemId/submissionId/claimantId",
    };
  }
  const count = await countNonAuthorPeerReviews(authority, {
    taskId,
    itemId,
    submissionId,
    authorId,
  });
  const decision = peerReviewAcceptAllowed({
    requirePeerReview: true,
    nonAuthorReviewCount: count,
  });
  if (!decision.ok) {
    return decision;
  }
  return { ok: true, value: true };
}
