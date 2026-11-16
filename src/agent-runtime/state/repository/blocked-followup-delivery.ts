import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  FollowupReauthorizationGrant,
  FollowupWorkspaceClassification,
  FollowupWorkspaceDestination,
  FollowupWorkspaceSnapshot,
} from "../../../auto-reply/reply/followup-workspace-change.js";
import { FOLLOWUP_WORKSPACE_RETRY_CAP } from "../../../auto-reply/reply/followup-workspace-change.js";
import { withDirectoryLock, writeJsonDurable } from "./durable-json.js";

export const BLOCKED_FOLLOWUP_DELIVERY_DIRNAME = "blocked-followup-deliveries";
export const DEFAULT_FOLLOWUP_RECOVERY_RETRY_CAP = FOLLOWUP_WORKSPACE_RETRY_CAP;

export type BlockedFollowupDeliveryReason =
  | "missing_delivery_identity"
  | "failure_receipt_write_failed"
  | "missing_evidence"
  | "unverified_binding_change"
  | "unplaced_or_ambiguous"
  | "reauthorization_required"
  | "revoked"
  | "cross_tenant"
  | "cross_resource"
  | "privilege_escalation"
  | "path_normalized"
  | "content_version_changed"
  | "authorized_migration"
  | "unchanged";

export type FollowupRecoveryStatus =
  | "recoverable_wait"
  | "reauthorization_required"
  | "denied"
  | "continued"
  | "blocked_manual";

export type BlockedFollowupWorkspaceSnapshot = FollowupWorkspaceSnapshot;

export type FollowupDeliveryResumePayload = {
  text?: string;
  mediaUrl?: string;
  mediaUrls?: string[];
  replyToId?: string;
  audioAsVoice?: boolean;
  isError?: boolean;
  channelData?: Record<string, unknown>;
};

export type FollowupDeliveryResumeSnapshot = {
  deliveryOnly: boolean;
  payloads: FollowupDeliveryResumePayload[];
  agentId?: string;
  agentDir?: string;
  sessionId?: string;
  sessionKey?: string;
  sessionFile?: string;
  workspaceDir?: string;
  prompt?: string;
  messageId?: string;
  followupItemId?: string;
  originatingChannel?: string;
  originatingTo?: string;
  originatingAccountId?: string;
  originatingThreadId?: string | number;
  provider?: string;
  model?: string;
  deliverableVersion?: string;
  asyncWaitRecoveryBind?: {
    jobId: string;
    claimToken: string;
    boundRunId?: string;
    boundDeliveryId?: string;
  };
};

export type FollowupRecoveryClaimStage = "claimed" | "enqueued" | "released";

export type FollowupRecoveryClaim = {
  token: string;
  stage: FollowupRecoveryClaimStage;
  claimedAtMs: number;
  holderPid?: number;
  /** Stable across retries and restarts; never includes retryCount. */
  deliveryIdempotencyKey: string;
  deliverySentAtMs?: number;
  deliveryStartedAtMs?: number;
};

/**
 * Durable recoverable / denied / continuation record for a followup workspace
 * decision. This store is disk-only: a later process finds records by
 * re-reading the same persist root, not module state.
 */
export type BlockedFollowupDeliveryRecord = {
  kind: "blocked_followup_delivery";
  id: string;
  recordedAtMs: number;
  updatedAtMs: number;
  status: FollowupRecoveryStatus;
  destination: FollowupWorkspaceDestination | "continue";
  reason: string;
  error: string;
  missingItems?: string[];
  retryCount: number;
  retryCap: number;
  retryExhausted?: boolean;
  pendingDestination?: FollowupWorkspaceDestination;
  contentVersionChange?: { from: string; to: string };
  pathNormalization?: { from: string; to: string };
  reauthorization?: { kind: "tenant" | "owner" | "permission"; detail: string };
  reauthorizationGrant?: FollowupReauthorizationGrant;
  resume?: FollowupDeliveryResumeSnapshot;
  sessionKey?: string;
  sessionFile?: string;
  jobId?: string;
  runId?: string;
  deliveryId?: string;
  taskId?: string;
  workspaceBinding?: BlockedFollowupWorkspaceSnapshot;
  claim?: FollowupRecoveryClaim;
  deliveryIdempotencyKey?: string;
};

const STATUSES = new Set<FollowupRecoveryStatus>([
  "recoverable_wait",
  "reauthorization_required",
  "denied",
  "continued",
  "blocked_manual",
]);

export function blockedFollowupDeliveryDir(persistRoot: string): string {
  const root = persistRoot.trim();
  if (!root) {
    throw new Error("blocked_followup_delivery: persist root is required");
  }
  return path.join(path.resolve(root), BLOCKED_FOLLOWUP_DELIVERY_DIRNAME);
}

export function resolveBlockedFollowupDeliveryPersistRoot(sessionFile?: string): string {
  const value = sessionFile?.trim();
  if (!value) {
    throw new Error("blocked_followup_delivery: session file is required");
  }
  return path.dirname(path.resolve(value));
}

function isRecord(value: unknown): value is BlockedFollowupDeliveryRecord {
  if (!value || typeof value !== "object") {
    return false;
  }
  const row = value as Partial<BlockedFollowupDeliveryRecord>;
  return (
    row.kind === "blocked_followup_delivery" &&
    typeof row.status === "string" &&
    STATUSES.has(row.status) &&
    typeof row.id === "string" &&
    row.id.trim().length > 0 &&
    typeof row.recordedAtMs === "number" &&
    typeof row.reason === "string" &&
    typeof row.error === "string"
  );
}

function normalizeRecord(row: BlockedFollowupDeliveryRecord): BlockedFollowupDeliveryRecord {
  const retryCount = typeof row.retryCount === "number" ? row.retryCount : 0;
  const retryCap =
    typeof row.retryCap === "number" ? row.retryCap : DEFAULT_FOLLOWUP_RECOVERY_RETRY_CAP;
  const status: FollowupRecoveryStatus =
    row.status === "blocked_manual" ? "recoverable_wait" : row.status;
  const destination: BlockedFollowupDeliveryRecord["destination"] =
    row.destination ??
    (status === "continued"
      ? "continue"
      : status === "denied"
        ? "denied"
        : status === "reauthorization_required"
          ? "reauthorization_required"
          : "recoverable_wait");
  return {
    ...row,
    status,
    destination,
    retryCount,
    retryCap,
    updatedAtMs: row.updatedAtMs ?? row.recordedAtMs,
    retryExhausted: row.retryExhausted ?? retryCount >= retryCap,
    ...(row.claim ? { claim: row.claim } : {}),
    ...(row.deliveryIdempotencyKey
      ? { deliveryIdempotencyKey: row.deliveryIdempotencyKey }
      : row.claim?.deliveryIdempotencyKey
        ? { deliveryIdempotencyKey: row.claim.deliveryIdempotencyKey }
        : {}),
  };
}

function reasonFromClassification(classification: FollowupWorkspaceClassification): string {
  return classification.reason;
}

export function recoveryStatusForDestination(
  destination: FollowupWorkspaceDestination,
): FollowupRecoveryStatus {
  switch (destination) {
    case "continue":
      return "continued";
    case "denied":
      return "denied";
    case "reauthorization_required":
      return "reauthorization_required";
    default:
      return "recoverable_wait";
  }
}

async function writeRecord(
  persistRoot: string,
  record: BlockedFollowupDeliveryRecord,
): Promise<BlockedFollowupDeliveryRecord> {
  const dest = path.join(
    blockedFollowupDeliveryDir(persistRoot),
    `${encodeURIComponent(record.id)}.json`,
  );
  await writeJsonDurable(dest, record);
  return record;
}

export async function recordBlockedFollowupDelivery(input: {
  persistRoot: string;
  id?: string;
  reason: string;
  error: string;
  status?: FollowupRecoveryStatus;
  destination?: FollowupWorkspaceDestination | "continue";
  missingItems?: string[];
  retryCount?: number;
  retryCap?: number;
  pendingDestination?: FollowupWorkspaceDestination;
  contentVersionChange?: { from: string; to: string };
  pathNormalization?: { from: string; to: string };
  reauthorization?: { kind: "tenant" | "owner" | "permission"; detail: string };
  reauthorizationGrant?: FollowupReauthorizationGrant;
  resume?: FollowupDeliveryResumeSnapshot;
  sessionKey?: string;
  sessionFile?: string;
  jobId?: string;
  runId?: string;
  deliveryId?: string;
  taskId?: string;
  workspaceBinding?: BlockedFollowupWorkspaceSnapshot;
  claim?: FollowupRecoveryClaim;
  deliveryIdempotencyKey?: string;
}): Promise<BlockedFollowupDeliveryRecord> {
  const requestedStatus = input.status ?? "recoverable_wait";
  const retryCap = input.retryCap ?? DEFAULT_FOLLOWUP_RECOVERY_RETRY_CAP;
  const retryCount = input.retryCount ?? 0;
  const recordId = input.id?.trim() || randomUUID();
  // Persist under the same directory lock as claim/enqueue/sent mutations so a
  // concurrent mark-enqueued cannot overwrite a just-written `continued` row.
  const assembled = await mutateFollowupRecordUnderLock(input.persistRoot, recordId, (existing) => {
    if (
      existing &&
      (existing.status === "continued" || Boolean(existing.claim?.deliverySentAtMs)) &&
      requestedStatus !== "continued"
    ) {
      return existing;
    }
    const now = Date.now();
    const status = requestedStatus;
    const record: BlockedFollowupDeliveryRecord = {
      kind: "blocked_followup_delivery",
      id: existing?.id ?? recordId,
      recordedAtMs: existing?.recordedAtMs ?? now,
      updatedAtMs: now,
      status,
      destination:
        input.destination ??
        (status === "continued"
          ? "continue"
          : status === "denied"
            ? "denied"
            : status === "reauthorization_required"
              ? "reauthorization_required"
              : "recoverable_wait"),
      reason: input.reason,
      error: input.error,
      retryCount,
      retryCap,
      retryExhausted: retryCount >= retryCap,
      ...(input.missingItems && input.missingItems.length > 0
        ? { missingItems: input.missingItems }
        : {}),
      ...(input.pendingDestination ? { pendingDestination: input.pendingDestination } : {}),
      ...(input.contentVersionChange ? { contentVersionChange: input.contentVersionChange } : {}),
      ...(input.pathNormalization ? { pathNormalization: input.pathNormalization } : {}),
      ...(input.reauthorization
        ? { reauthorization: input.reauthorization }
        : existing?.reauthorization
          ? { reauthorization: existing.reauthorization }
          : {}),
      ...(input.reauthorizationGrant
        ? { reauthorizationGrant: input.reauthorizationGrant }
        : existing?.reauthorizationGrant
          ? { reauthorizationGrant: existing.reauthorizationGrant }
          : {}),
      ...(input.resume
        ? { resume: input.resume }
        : existing?.resume
          ? { resume: existing.resume }
          : {}),
      ...(input.sessionKey
        ? { sessionKey: input.sessionKey }
        : existing?.sessionKey
          ? { sessionKey: existing.sessionKey }
          : {}),
      ...(input.sessionFile
        ? { sessionFile: input.sessionFile }
        : existing?.sessionFile
          ? { sessionFile: existing.sessionFile }
          : {}),
      ...(input.jobId ? { jobId: input.jobId } : existing?.jobId ? { jobId: existing.jobId } : {}),
      ...(input.runId ? { runId: input.runId } : existing?.runId ? { runId: existing.runId } : {}),
      ...(input.deliveryId
        ? { deliveryId: input.deliveryId }
        : existing?.deliveryId
          ? { deliveryId: existing.deliveryId }
          : {}),
      ...(input.taskId
        ? { taskId: input.taskId }
        : existing?.taskId
          ? { taskId: existing.taskId }
          : {}),
      ...(input.workspaceBinding
        ? { workspaceBinding: input.workspaceBinding }
        : existing?.workspaceBinding
          ? { workspaceBinding: existing.workspaceBinding }
          : {}),
      ...(input.claim ? { claim: input.claim } : existing?.claim ? { claim: existing.claim } : {}),
      ...(input.deliveryIdempotencyKey
        ? { deliveryIdempotencyKey: input.deliveryIdempotencyKey }
        : input.claim?.deliveryIdempotencyKey
          ? { deliveryIdempotencyKey: input.claim.deliveryIdempotencyKey }
          : existing?.deliveryIdempotencyKey
            ? { deliveryIdempotencyKey: existing.deliveryIdempotencyKey }
            : existing?.claim?.deliveryIdempotencyKey
              ? { deliveryIdempotencyKey: existing.claim.deliveryIdempotencyKey }
              : {}),
    };
    return record;
  });
  if (!assembled) {
    throw new Error("blocked_followup_delivery: record write failed");
  }
  return assembled;
}

export async function recordFollowupWorkspaceDecision(input: {
  persistRoot: string;
  id?: string;
  classification: FollowupWorkspaceClassification;
  error?: string;
  sessionKey?: string;
  sessionFile?: string;
  jobId?: string;
  runId?: string;
  deliveryId?: string;
  taskId?: string;
  workspaceBinding?: BlockedFollowupWorkspaceSnapshot;
  resume?: FollowupDeliveryResumeSnapshot;
  reauthorizationGrant?: FollowupReauthorizationGrant;
  pendingDestination?: FollowupWorkspaceDestination;
  reasonOverride?: string;
  statusOverride?: FollowupRecoveryStatus;
  retryCount?: number;
  retryCap?: number;
  claim?: FollowupRecoveryClaim;
  deliveryIdempotencyKey?: string;
}): Promise<BlockedFollowupDeliveryRecord> {
  const classification = input.classification;
  return recordBlockedFollowupDelivery({
    persistRoot: input.persistRoot,
    id: input.id,
    reason: input.reasonOverride ?? reasonFromClassification(classification),
    error: input.error ?? classification.reason,
    status: input.statusOverride ?? recoveryStatusForDestination(classification.destination),
    destination:
      input.statusOverride === "recoverable_wait"
        ? "recoverable_wait"
        : input.statusOverride === "denied"
          ? "denied"
          : input.statusOverride === "reauthorization_required"
            ? "reauthorization_required"
            : input.statusOverride === "continued"
              ? "continue"
              : classification.destination,
    missingItems: classification.missingItems,
    pendingDestination: input.pendingDestination,
    retryCount: input.retryCount,
    retryCap: input.retryCap,
    contentVersionChange: classification.contentVersionChange,
    pathNormalization: classification.pathNormalization,
    reauthorization: classification.reauthorization,
    reauthorizationGrant: input.reauthorizationGrant,
    resume: input.resume,
    sessionKey: input.sessionKey,
    sessionFile: input.sessionFile,
    jobId: input.jobId,
    runId: input.runId,
    deliveryId: input.deliveryId,
    taskId: input.taskId,
    workspaceBinding: input.workspaceBinding,
    claim: input.claim,
    deliveryIdempotencyKey: input.deliveryIdempotencyKey,
  });
}

export function listBlockedFollowupDeliveries(
  persistRoot: string,
): BlockedFollowupDeliveryRecord[] {
  const dir = blockedFollowupDeliveryDir(persistRoot);
  if (!fs.existsSync(dir)) {
    return [];
  }
  const records: BlockedFollowupDeliveryRecord[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json")) {
      continue;
    }
    const filePath = path.join(dir, name);
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (isRecord(parsed)) {
        records.push(normalizeRecord(parsed));
      }
    } catch {
      // Skip unreadable or invalid rows; callers re-open from disk after restart.
    }
  }
  return records.toSorted((left, right) => left.recordedAtMs - right.recordedAtMs);
}

export function listRecoverableFollowupDeliveries(
  persistRoot: string,
): BlockedFollowupDeliveryRecord[] {
  return listBlockedFollowupDeliveries(persistRoot).filter(
    (row) => row.status === "recoverable_wait",
  );
}

export function findBlockedFollowupDelivery(
  persistRoot: string,
  lookup: {
    id?: string;
    runId?: string;
    deliveryId?: string;
    jobId?: string;
    sessionKey?: string;
  },
): BlockedFollowupDeliveryRecord | undefined {
  const id = lookup.id?.trim();
  const runId = lookup.runId?.trim();
  const deliveryId = lookup.deliveryId?.trim();
  const jobId = lookup.jobId?.trim();
  const sessionKey = lookup.sessionKey?.trim();
  return listBlockedFollowupDeliveries(persistRoot).find((row) => {
    if (id && row.id !== id) {
      return false;
    }
    if (runId && row.runId !== runId) {
      return false;
    }
    if (deliveryId && row.deliveryId !== deliveryId) {
      return false;
    }
    if (jobId && row.jobId !== jobId) {
      return false;
    }
    if (sessionKey && row.sessionKey !== sessionKey) {
      return false;
    }
    return Boolean(id || runId || deliveryId || jobId || sessionKey);
  });
}

export function canAutoRevalidateFollowupRecovery(record: BlockedFollowupDeliveryRecord): boolean {
  if (record.status === "reauthorization_required" || record.status === "denied") {
    return false;
  }
  if (record.status !== "recoverable_wait") {
    return false;
  }
  if ((record.retryCount ?? 0) >= (record.retryCap ?? DEFAULT_FOLLOWUP_RECOVERY_RETRY_CAP)) {
    return false;
  }
  return true;
}

export async function incrementFollowupRecoveryRetry(input: {
  persistRoot: string;
  record: BlockedFollowupDeliveryRecord;
}): Promise<BlockedFollowupDeliveryRecord> {
  const retryCap = input.record.retryCap ?? DEFAULT_FOLLOWUP_RECOVERY_RETRY_CAP;
  const retryCount = (input.record.retryCount ?? 0) + 1;
  const updated = await mutateFollowupRecordUnderLock(
    input.persistRoot,
    input.record.id,
    (current) => {
      if (
        !current ||
        current.status === "continued" ||
        current.status === "denied" ||
        current.claim?.deliverySentAtMs
      ) {
        return undefined;
      }
      return {
        ...current,
        retryCount,
        retryCap,
        retryExhausted: retryCount >= retryCap,
        updatedAtMs: Date.now(),
      };
    },
  );
  return updated ?? input.record;
}

export type FollowupRecoveryRetryPlan =
  | { action: "revalidate"; record: BlockedFollowupDeliveryRecord }
  | { action: "hold"; record: BlockedFollowupDeliveryRecord; reason: "retry_exhausted" }
  | { action: "await_reauthorization"; record: BlockedFollowupDeliveryRecord }
  | { action: "closed"; record: BlockedFollowupDeliveryRecord };

export function planFollowupRecoveryRetry(
  record: BlockedFollowupDeliveryRecord,
): FollowupRecoveryRetryPlan {
  if (record.status === "denied" || record.status === "continued") {
    return { action: "closed", record };
  }
  if (record.status === "reauthorization_required") {
    return { action: "await_reauthorization", record };
  }
  if (!canAutoRevalidateFollowupRecovery(record)) {
    return { action: "hold", record, reason: "retry_exhausted" };
  }
  return { action: "revalidate", record };
}

export function followupDeliveryIdempotencyKey(record: BlockedFollowupDeliveryRecord): string {
  if (record.deliveryIdempotencyKey?.trim()) {
    return record.deliveryIdempotencyKey.trim();
  }
  if (record.claim?.deliveryIdempotencyKey?.trim()) {
    return record.claim.deliveryIdempotencyKey.trim();
  }
  const original =
    record.deliveryId?.trim() || record.jobId?.trim() || record.taskId?.trim() || "original";
  return `followup-delivery:${record.id}:${original}`;
}

const CLAIM_HOLDER_STALE_MS = 30_000;

function isClaimHolderAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function followupRecoveryClaimBlocksEnqueue(
  record: BlockedFollowupDeliveryRecord,
  nowMs = Date.now(),
): boolean {
  if (
    record.status === "continued" ||
    record.claim?.deliverySentAtMs ||
    record.claim?.deliveryStartedAtMs
  ) {
    return true;
  }
  const claim = record.claim;
  if (!claim || (claim.stage !== "claimed" && claim.stage !== "enqueued")) {
    return false;
  }
  return claimIsHeld(claim, nowMs);
}

function claimIsHeld(claim: FollowupRecoveryClaim, nowMs: number): boolean {
  if (claim.deliverySentAtMs || claim.deliveryStartedAtMs) {
    return true;
  }
  if (claim.stage !== "claimed" && claim.stage !== "enqueued") {
    return false;
  }
  if (typeof claim.holderPid === "number" && isClaimHolderAlive(claim.holderPid)) {
    return true;
  }
  // An enqueued claim without a live holder stays held briefly so a second
  // scan in the same window cannot enqueue again. After the stale window, a
  // dead holder with no send marker may retry the same idempotency key.
  return nowMs - claim.claimedAtMs < CLAIM_HOLDER_STALE_MS;
}

export type FollowupRecoveryClaimResult =
  | {
      ok: true;
      record: BlockedFollowupDeliveryRecord;
      claimToken: string;
      freshClaim: boolean;
    }
  | {
      ok: false;
      reason: "already_claimed" | "already_sent" | "not_claimable" | "missing";
      record?: BlockedFollowupDeliveryRecord;
    };

async function mutateFollowupRecordUnderLock(
  persistRoot: string,
  recordId: string,
  mutate: (
    current: BlockedFollowupDeliveryRecord | undefined,
  ) => BlockedFollowupDeliveryRecord | undefined,
): Promise<BlockedFollowupDeliveryRecord | undefined> {
  const dir = blockedFollowupDeliveryDir(persistRoot);
  return withDirectoryLock(dir, encodeURIComponent(recordId), async () => {
    const current = findBlockedFollowupDelivery(persistRoot, { id: recordId });
    const next = mutate(current);
    if (!next) {
      return current;
    }
    return writeRecord(persistRoot, next);
  });
}

/**
 * Durably claim a recoverable wait before enqueue. Failed or already-held
 * claims must not enqueue again. A released or stale claim may be retried
 * with the same delivery idempotency identity.
 */
export async function claimFollowupRecoveryForResume(input: {
  persistRoot: string;
  record: BlockedFollowupDeliveryRecord;
  nowMs?: number;
}): Promise<FollowupRecoveryClaimResult> {
  const nowMs = input.nowMs ?? Date.now();
  let result: FollowupRecoveryClaimResult = { ok: false, reason: "missing" };
  const updated = await mutateFollowupRecordUnderLock(
    input.persistRoot,
    input.record.id,
    (current) => {
      if (!current) {
        result = { ok: false, reason: "missing" };
        return undefined;
      }
      if (current.status === "continued" || current.claim?.deliverySentAtMs) {
        result = { ok: false, reason: "already_sent", record: current };
        return undefined;
      }
      if (current.status === "denied") {
        result = { ok: false, reason: "not_claimable", record: current };
        return undefined;
      }
      const key = followupDeliveryIdempotencyKey(current);
      const existing = current.claim;
      if (
        existing &&
        (existing.stage === "claimed" || existing.stage === "enqueued") &&
        claimIsHeld(existing, nowMs)
      ) {
        result = { ok: false, reason: "already_claimed", record: current };
        return undefined;
      }
      const token = existing?.token?.trim() || randomUUID();
      const claimed: BlockedFollowupDeliveryRecord = {
        ...current,
        updatedAtMs: nowMs,
        deliveryIdempotencyKey: key,
        claim: {
          token,
          stage: "claimed",
          claimedAtMs: existing && existing.stage !== "released" ? existing.claimedAtMs : nowMs,
          holderPid: process.pid,
          deliveryIdempotencyKey: key,
          ...(existing?.deliverySentAtMs ? { deliverySentAtMs: existing.deliverySentAtMs } : {}),
        },
      };
      result = {
        ok: true,
        record: claimed,
        claimToken: token,
        freshClaim: !existing || existing.stage === "released",
      };
      return claimed;
    },
  );
  const settled = result as FollowupRecoveryClaimResult;
  if (settled.ok) {
    return { ...settled, record: updated ?? settled.record };
  }
  return settled.record || !updated ? settled : { ...settled, record: updated };
}

export async function markFollowupRecoveryClaimEnqueued(input: {
  persistRoot: string;
  record: BlockedFollowupDeliveryRecord;
  claimToken: string;
}): Promise<BlockedFollowupDeliveryRecord> {
  const nowMs = Date.now();
  const updated = await mutateFollowupRecordUnderLock(
    input.persistRoot,
    input.record.id,
    (current) => {
      if (!current || current.claim?.token !== input.claimToken) {
        return undefined;
      }
      const key = followupDeliveryIdempotencyKey(current);
      return {
        ...current,
        updatedAtMs: nowMs,
        // Never regress a completed delivery if the runner already persisted
        // `continued` or a send marker while this claim was being marked enqueued.
        status:
          current.status === "continued" || current.claim.deliverySentAtMs
            ? "continued"
            : current.status,
        destination:
          current.status === "continued" || current.claim.deliverySentAtMs
            ? "continue"
            : current.destination,
        deliveryIdempotencyKey: key,
        claim: {
          ...current.claim,
          stage: "enqueued",
          holderPid: process.pid,
          deliveryIdempotencyKey: key,
        },
      };
    },
  );
  return updated ?? input.record;
}

export async function releaseFollowupRecoveryClaim(input: {
  persistRoot: string;
  record: BlockedFollowupDeliveryRecord;
  claimToken?: string;
}): Promise<BlockedFollowupDeliveryRecord> {
  const nowMs = Date.now();
  const updated = await mutateFollowupRecordUnderLock(
    input.persistRoot,
    input.record.id,
    (current) => {
      if (!current?.claim) {
        return undefined;
      }
      if (input.claimToken && current.claim.token !== input.claimToken) {
        return undefined;
      }
      if (current.claim.deliverySentAtMs || current.status === "continued") {
        return undefined;
      }
      return {
        ...current,
        updatedAtMs: nowMs,
        status: "recoverable_wait",
        destination: "recoverable_wait",
        deliveryIdempotencyKey: followupDeliveryIdempotencyKey(current),
        claim: {
          ...current.claim,
          stage: "released",
          holderPid: undefined,
          deliveryIdempotencyKey: followupDeliveryIdempotencyKey(current),
        },
      };
    },
  );
  return updated ?? input.record;
}

export async function markFollowupRecoveryDeliverySent(input: {
  persistRoot: string;
  record: BlockedFollowupDeliveryRecord;
}): Promise<BlockedFollowupDeliveryRecord> {
  const nowMs = Date.now();
  const key = followupDeliveryIdempotencyKey(input.record);
  const updated = await mutateFollowupRecordUnderLock(
    input.persistRoot,
    input.record.id,
    (current) => {
      if (!current) {
        return undefined;
      }
      return {
        ...current,
        updatedAtMs: nowMs,
        status: "continued",
        destination: "continue",
        deliveryIdempotencyKey: key,
        claim: {
          token: current.claim?.token || randomUUID(),
          stage:
            current.claim?.stage === "released" ? "enqueued" : (current.claim?.stage ?? "enqueued"),
          claimedAtMs: current.claim?.claimedAtMs ?? nowMs,
          holderPid: current.claim?.holderPid,
          deliveryIdempotencyKey: key,
          deliverySentAtMs: current.claim?.deliverySentAtMs ?? nowMs,
        },
      };
    },
  );
  return updated ?? input.record;
}

/** A durable pre-send fence: loss of the process requires receipt reconciliation. */
export async function markFollowupRecoveryDeliveryStarted(input: {
  persistRoot: string;
  record: BlockedFollowupDeliveryRecord;
}): Promise<BlockedFollowupDeliveryRecord> {
  const updated = await mutateFollowupRecordUnderLock(
    input.persistRoot,
    input.record.id,
    (current) => {
      if (!current) {
        throw new Error("followup_delivery_record_missing");
      }
      if (current.claim?.deliveryStartedAtMs || current.status === "continued") {
        throw new Error("followup_delivery_requires_receipt_reconciliation");
      }
      const now = Date.now();
      return {
        ...current,
        reason: "delivery_receipt_pending",
        missingItems: ["authoritative_delivery_receipt"],
        updatedAtMs: now,
        claim: {
          token: current.claim?.token || randomUUID(),
          stage: current.claim?.stage ?? "enqueued",
          claimedAtMs: current.claim?.claimedAtMs ?? now,
          holderPid: process.pid,
          deliveryIdempotencyKey: followupDeliveryIdempotencyKey(current),
          deliveryStartedAtMs: now,
        },
      };
    },
  );
  if (!updated) {
    throw new Error("followup_delivery_record_missing");
  }
  return updated;
}
