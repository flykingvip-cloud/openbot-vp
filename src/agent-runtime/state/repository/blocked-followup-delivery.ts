import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  FollowupWorkspaceClassification,
  FollowupWorkspaceDestination,
  FollowupWorkspaceSnapshot,
} from "../../../auto-reply/reply/followup-workspace-change.js";
import { FOLLOWUP_WORKSPACE_RETRY_CAP } from "../../../auto-reply/reply/followup-workspace-change.js";
import { writeJsonDurable } from "./durable-json.js";

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
  sessionKey?: string;
  sessionFile?: string;
  jobId?: string;
  runId?: string;
  deliveryId?: string;
  taskId?: string;
  workspaceBinding?: BlockedFollowupWorkspaceSnapshot;
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
  sessionKey?: string;
  sessionFile?: string;
  jobId?: string;
  runId?: string;
  deliveryId?: string;
  taskId?: string;
  workspaceBinding?: BlockedFollowupWorkspaceSnapshot;
}): Promise<BlockedFollowupDeliveryRecord> {
  const now = Date.now();
  const status = input.status ?? "recoverable_wait";
  const retryCap = input.retryCap ?? DEFAULT_FOLLOWUP_RECOVERY_RETRY_CAP;
  const retryCount = input.retryCount ?? 0;
  const existing = input.id
    ? listBlockedFollowupDeliveries(input.persistRoot).find((row) => row.id === input.id)
    : undefined;
  const record: BlockedFollowupDeliveryRecord = {
    kind: "blocked_followup_delivery",
    id: existing?.id ?? input.id ?? randomUUID(),
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
    ...(input.reauthorization ? { reauthorization: input.reauthorization } : {}),
    ...(input.sessionKey ? { sessionKey: input.sessionKey } : {}),
    ...(input.sessionFile ? { sessionFile: input.sessionFile } : {}),
    ...(input.jobId ? { jobId: input.jobId } : {}),
    ...(input.runId ? { runId: input.runId } : {}),
    ...(input.deliveryId ? { deliveryId: input.deliveryId } : {}),
    ...(input.taskId ? { taskId: input.taskId } : {}),
    ...(input.workspaceBinding ? { workspaceBinding: input.workspaceBinding } : {}),
  };
  return writeRecord(input.persistRoot, record);
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
  pendingDestination?: FollowupWorkspaceDestination;
  reasonOverride?: string;
  statusOverride?: FollowupRecoveryStatus;
  retryCount?: number;
  retryCap?: number;
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
    sessionKey: input.sessionKey,
    sessionFile: input.sessionFile,
    jobId: input.jobId,
    runId: input.runId,
    deliveryId: input.deliveryId,
    taskId: input.taskId,
    workspaceBinding: input.workspaceBinding,
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
  const updated: BlockedFollowupDeliveryRecord = {
    ...input.record,
    retryCount,
    retryCap,
    retryExhausted: retryCount >= retryCap,
    updatedAtMs: Date.now(),
  };
  return writeRecord(input.persistRoot, updated);
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
