import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { writeJsonDurable } from "./durable-json.js";

export const BLOCKED_FOLLOWUP_DELIVERY_DIRNAME = "blocked-followup-deliveries";

export type BlockedFollowupDeliveryReason =
  | "missing_delivery_identity"
  | "failure_receipt_write_failed";

export type BlockedFollowupWorkspaceSnapshot = {
  resourceId?: string;
  bindingId?: string;
  contentVersion?: string;
  workspaceDir?: string;
};

/**
 * Durable blocked / manual-handling record for a followup delivery that must
 * not be resent against a new binding. This store is disk-only: a later
 * process finds records by re-reading the same persist root, not module state.
 */
export type BlockedFollowupDeliveryRecord = {
  kind: "blocked_followup_delivery";
  id: string;
  recordedAtMs: number;
  status: "blocked_manual";
  reason: BlockedFollowupDeliveryReason;
  error: string;
  sessionKey?: string;
  sessionFile?: string;
  jobId?: string;
  runId?: string;
  deliveryId?: string;
  taskId?: string;
  workspaceBinding?: BlockedFollowupWorkspaceSnapshot;
};

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
    row.status === "blocked_manual" &&
    typeof row.id === "string" &&
    row.id.trim().length > 0 &&
    typeof row.recordedAtMs === "number" &&
    (row.reason === "missing_delivery_identity" || row.reason === "failure_receipt_write_failed") &&
    typeof row.error === "string"
  );
}

export async function recordBlockedFollowupDelivery(input: {
  persistRoot: string;
  reason: BlockedFollowupDeliveryReason;
  error: string;
  sessionKey?: string;
  sessionFile?: string;
  jobId?: string;
  runId?: string;
  deliveryId?: string;
  taskId?: string;
  workspaceBinding?: BlockedFollowupWorkspaceSnapshot;
}): Promise<BlockedFollowupDeliveryRecord> {
  const record: BlockedFollowupDeliveryRecord = {
    kind: "blocked_followup_delivery",
    id: randomUUID(),
    recordedAtMs: Date.now(),
    status: "blocked_manual",
    reason: input.reason,
    error: input.error,
    ...(input.sessionKey ? { sessionKey: input.sessionKey } : {}),
    ...(input.sessionFile ? { sessionFile: input.sessionFile } : {}),
    ...(input.jobId ? { jobId: input.jobId } : {}),
    ...(input.runId ? { runId: input.runId } : {}),
    ...(input.deliveryId ? { deliveryId: input.deliveryId } : {}),
    ...(input.taskId ? { taskId: input.taskId } : {}),
    ...(input.workspaceBinding ? { workspaceBinding: input.workspaceBinding } : {}),
  };
  const dest = path.join(
    blockedFollowupDeliveryDir(input.persistRoot),
    `${encodeURIComponent(record.id)}.json`,
  );
  await writeJsonDurable(dest, record);
  return record;
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
        records.push(parsed);
      }
    } catch {
      // Skip unreadable or invalid rows; callers re-open from disk after restart.
    }
  }
  return records.toSorted((left, right) => left.recordedAtMs - right.recordedAtMs);
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
