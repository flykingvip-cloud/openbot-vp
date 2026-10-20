/**
 * P2-a lifecycle closure receipt store — unique create on operationId + immutable fingerprint.
 * Status: prepared → (CAS success) open|completed → cancelled|failed.
 * Replay-as-success is forbidden for prepared/failed.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../../config/paths.js";
import { resolveLifecycleReceiptRoot } from "./paths.js";
import { assertSafeRecoveryReceiptToken } from "./recovery-receipt.js";
import type {
  ActorRef,
  GovernanceLifecycleReceipt,
  LifecycleCommand,
  LifecycleReceiptStage,
  LifecycleReceiptStatus,
  LifecycleState,
} from "./types.js";

const LOCK_STALE_MS = 30_000;
const LOCK_RETRY_MS = 20;
const LOCK_MAX_ATTEMPTS = 250;

const COMMITTED_STATUSES = new Set<LifecycleReceiptStatus>(["open", "completed", "cancelled"]);

export type LifecycleRequestFingerprintInput = {
  resourceId: string;
  tenantId: string | null;
  command: LifecycleCommand;
  expectedGovernanceVersion: number;
  holdReason?: string;
  deletionScope?: string;
  targetBindingIds?: string[];
};

export type CreateLifecycleReceiptUniqueResult =
  | { ok: true; receipt: GovernanceLifecycleReceipt; replay: boolean }
  | { ok: false; conflict: "idempotent_mismatch" };

function sleepAsync(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function withExclusiveLockAsync(lockPath: string, fn: () => void): Promise<void> {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < LOCK_MAX_ATTEMPTS; attempt += 1) {
    try {
      const fd = fs.openSync(lockPath, "wx", 0o600);
      try {
        fs.writeFileSync(fd, `${process.pid}\n${Date.now()}\n`, "utf8");
        fn();
        return;
      } finally {
        fs.closeSync(fd);
        try {
          fs.unlinkSync(lockPath);
        } catch {
          // ignore
        }
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") {
        throw err;
      }
      try {
        const st = fs.statSync(lockPath);
        if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
          fs.unlinkSync(lockPath);
          continue;
        }
      } catch {
        // raced unlock
      }
      await sleepAsync(LOCK_RETRY_MS);
    }
  }
  throw new Error("lifecycle_receipt_lock_timeout");
}

function resolveReceiptPath(operationId: string, stateDir?: string): string {
  const safe = assertSafeRecoveryReceiptToken(operationId, "operationId");
  const root = path.resolve(resolveLifecycleReceiptRoot(stateDir ?? resolveStateDir()));
  const dest = path.resolve(root, `${safe}.json`);
  const rel = path.relative(root, dest);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("invalid_lifecycle_receipt_path");
  }
  return dest;
}

/** Stable SHA-256 over canonical request fields (excludes operationId / actors / timestamps). */
export function computeLifecycleRequestFingerprint(
  input: LifecycleRequestFingerprintInput,
): string {
  const canonical = {
    resourceId: input.resourceId,
    tenantId: input.tenantId,
    command: input.command,
    expectedGovernanceVersion: input.expectedGovernanceVersion,
    holdReason: input.holdReason ?? null,
    deletionScope: input.deletionScope ?? null,
    targetBindingIds: [...(input.targetBindingIds ?? [])].toSorted(),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function parseReceipt(raw: unknown): GovernanceLifecycleReceipt | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const r = raw as GovernanceLifecycleReceipt;
  if (
    typeof r.operationId !== "string" ||
    typeof r.requestFingerprint !== "string" ||
    typeof r.command !== "string" ||
    typeof r.resourceId !== "string" ||
    !Array.isArray(r.stages)
  ) {
    return null;
  }
  return r;
}

function buildPreparedReceipt(params: {
  operationId: string;
  requestFingerprint: string;
  command: LifecycleCommand;
  resourceId: string;
  resourceType: GovernanceLifecycleReceipt["resourceType"];
  tenantId: string | null;
  requestedBy: ActorRef;
  previousLifecycleState: LifecycleState;
  legalHoldSnapshot?: GovernanceLifecycleReceipt["legalHoldSnapshot"];
}): GovernanceLifecycleReceipt {
  const now = new Date().toISOString();
  return {
    receiptId: params.operationId,
    operationId: params.operationId,
    requestFingerprint: params.requestFingerprint,
    command: params.command,
    resourceId: params.resourceId,
    resourceType: params.resourceType,
    tenantId: params.tenantId,
    requestedBy: params.requestedBy,
    executedBy: [],
    previousLifecycleState: params.previousLifecycleState,
    legalHoldSnapshot: params.legalHoldSnapshot,
    stages: [],
    status: "prepared",
    createdAt: now,
    updatedAt: now,
  };
}

export function getLifecycleReceipt(params: {
  operationId: string;
  stateDir?: string;
}): GovernanceLifecycleReceipt | null {
  const dest = resolveReceiptPath(params.operationId, params.stateDir);
  if (!fs.existsSync(dest)) {
    return null;
  }
  try {
    return parseReceipt(JSON.parse(fs.readFileSync(dest, "utf8")));
  } catch {
    return null;
  }
}

/**
 * Atomic unique create on operationId (always starts as `prepared`).
 * Same fingerprint + committed status → replay:true.
 * Same fingerprint + prepared/failed → reclaim/rewrite prepared (replay:false) — never success-replay.
 * Fingerprint delta → idempotent_mismatch.
 */
export async function createLifecycleReceiptUnique(params: {
  operationId: string;
  requestFingerprint: string;
  command: LifecycleCommand;
  resourceId: string;
  resourceType: GovernanceLifecycleReceipt["resourceType"];
  tenantId: string | null;
  requestedBy: ActorRef;
  previousLifecycleState: LifecycleState;
  legalHoldSnapshot?: GovernanceLifecycleReceipt["legalHoldSnapshot"];
  stateDir?: string;
}): Promise<CreateLifecycleReceiptUniqueResult> {
  const dest = resolveReceiptPath(params.operationId, params.stateDir);
  const lockPath = `${dest}.lock`;
  fs.mkdirSync(path.dirname(dest), { recursive: true });

  let result: CreateLifecycleReceiptUniqueResult | null = null;
  await withExclusiveLockAsync(lockPath, () => {
    if (fs.existsSync(dest)) {
      const existing = parseReceipt(JSON.parse(fs.readFileSync(dest, "utf8")));
      if (!existing) {
        throw new Error("lifecycle_receipt_corrupt");
      }
      if (existing.requestFingerprint !== params.requestFingerprint) {
        result = { ok: false, conflict: "idempotent_mismatch" };
        return;
      }
      if (COMMITTED_STATUSES.has(existing.status)) {
        result = { ok: true, receipt: existing, replay: true };
        return;
      }
      // prepared or failed: rewrite as prepared for CAS retry — not a success replay.
      const receipt = buildPreparedReceipt(params);
      fs.writeFileSync(dest, `${JSON.stringify(receipt, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      result = { ok: true, receipt, replay: false };
      return;
    }
    const receipt = buildPreparedReceipt(params);
    fs.writeFileSync(dest, `${JSON.stringify(receipt, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    result = { ok: true, receipt, replay: false };
  });
  if (!result) {
    throw new Error("lifecycle_receipt_create_failed");
  }
  return result;
}

export async function updateLifecycleReceipt(params: {
  operationId: string;
  stateDir?: string;
  mutator: (receipt: GovernanceLifecycleReceipt) => GovernanceLifecycleReceipt;
}): Promise<GovernanceLifecycleReceipt> {
  const dest = resolveReceiptPath(params.operationId, params.stateDir);
  const lockPath = `${dest}.lock`;
  let updated: GovernanceLifecycleReceipt | null = null;
  await withExclusiveLockAsync(lockPath, () => {
    if (!fs.existsSync(dest)) {
      throw new Error("lifecycle_receipt_not_found");
    }
    const existing = parseReceipt(JSON.parse(fs.readFileSync(dest, "utf8")));
    if (!existing) {
      throw new Error("lifecycle_receipt_corrupt");
    }
    updated = {
      ...params.mutator(existing),
      operationId: existing.operationId,
      requestFingerprint: existing.requestFingerprint,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(dest, `${JSON.stringify(updated, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
  });
  if (!updated) {
    throw new Error("lifecycle_receipt_update_failed");
  }
  return updated;
}

export async function appendLifecycleReceiptStage(params: {
  operationId: string;
  stage: LifecycleReceiptStage;
  executedBy?: ActorRef;
  stateDir?: string;
}): Promise<GovernanceLifecycleReceipt> {
  return updateLifecycleReceipt({
    operationId: params.operationId,
    stateDir: params.stateDir,
    mutator: (receipt) => {
      const executedBy = [...receipt.executedBy];
      if (params.executedBy) {
        const key = JSON.stringify(params.executedBy);
        if (!executedBy.some((a) => JSON.stringify(a) === key)) {
          executedBy.push(params.executedBy);
        }
      }
      return {
        ...receipt,
        executedBy,
        stages: [...receipt.stages, params.stage],
      };
    },
  });
}

export async function finalizeLifecycleReceipt(params: {
  operationId: string;
  status: LifecycleReceiptStatus;
  stateDir?: string;
}): Promise<GovernanceLifecycleReceipt> {
  return updateLifecycleReceipt({
    operationId: params.operationId,
    stateDir: params.stateDir,
    mutator: (receipt) => ({ ...receipt, status: params.status }),
  });
}

/**
 * CAS-loser terminalization with Catalog reconciliation.
 * Only `prepared → failed` when Catalog is **not** bound to this operationId.
 * Cross-process: winner may have finished Catalog CAS but not yet committed receipt —
 * re-check Catalog under the receipt lock window before writing failed.
 */
export async function reconcileFailPreparedAfterVersionConflict(params: {
  operationId: string;
  stateDir?: string;
  /** True when Catalog.activeLifecycleOperation.operationId === this operationId. */
  isCatalogBoundToOperation: () => Promise<boolean>;
}): Promise<{
  action: "failed" | "skipped_catalog_bound" | "skipped_not_prepared";
  receipt: GovernanceLifecycleReceipt;
}> {
  const dest = resolveReceiptPath(params.operationId, params.stateDir);
  const lockPath = `${dest}.lock`;
  let outcome: {
    action: "failed" | "skipped_catalog_bound" | "skipped_not_prepared";
    receipt: GovernanceLifecycleReceipt;
  } | null = null;

  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < LOCK_MAX_ATTEMPTS; attempt += 1) {
    try {
      const fd = fs.openSync(lockPath, "wx", 0o600);
      try {
        fs.writeFileSync(fd, `${process.pid}\n${Date.now()}\n`, "utf8");
        // Catalog check while holding receipt lock (minimize TOCTOU with fail write).
        if (await params.isCatalogBoundToOperation()) {
          const receipt = getLifecycleReceipt({
            operationId: params.operationId,
            stateDir: params.stateDir,
          });
          if (!receipt) {
            throw new Error("lifecycle_receipt_not_found");
          }
          outcome = { action: "skipped_catalog_bound", receipt };
        } else {
          if (!fs.existsSync(dest)) {
            throw new Error("lifecycle_receipt_not_found");
          }
          const existing = parseReceipt(JSON.parse(fs.readFileSync(dest, "utf8")));
          if (!existing) {
            throw new Error("lifecycle_receipt_corrupt");
          }
          if (existing.status !== "prepared") {
            outcome = { action: "skipped_not_prepared", receipt: existing };
          } else if (await params.isCatalogBoundToOperation()) {
            outcome = { action: "skipped_catalog_bound", receipt: existing };
          } else {
            const updated: GovernanceLifecycleReceipt = {
              ...existing,
              status: "failed",
              updatedAt: new Date().toISOString(),
            };
            fs.writeFileSync(dest, `${JSON.stringify(updated, null, 2)}\n`, {
              encoding: "utf8",
              mode: 0o600,
            });
            outcome = { action: "failed", receipt: updated };
          }
        }
      } finally {
        fs.closeSync(fd);
        try {
          fs.unlinkSync(lockPath);
        } catch {
          // ignore
        }
      }
      break;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") {
        throw err;
      }
      try {
        const st = fs.statSync(lockPath);
        if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
          fs.unlinkSync(lockPath);
          continue;
        }
      } catch {
        // raced unlock
      }
      await sleepAsync(LOCK_RETRY_MS);
    }
  }
  if (!outcome) {
    throw new Error("lifecycle_receipt_lock_timeout");
  }
  return outcome;
}

/** @deprecated Prefer reconcileFailPreparedAfterVersionConflict */
export async function failPreparedLifecycleReceipt(params: {
  operationId: string;
  stateDir?: string;
}): Promise<GovernanceLifecycleReceipt> {
  return updateLifecycleReceipt({
    operationId: params.operationId,
    stateDir: params.stateDir,
    mutator: (receipt) => {
      if (receipt.status !== "prepared") {
        return receipt;
      }
      return { ...receipt, status: "failed" };
    },
  });
}

/**
 * After Catalog compareAndPut success: hold → completed; long-running → open.
 * Heals `failed → open/completed` when a CAS loser raced ahead and terminalized
 * the shared prepared receipt (caller already won Catalog CAS).
 */
export async function commitLifecycleReceiptAfterCas(params: {
  operationId: string;
  command: LifecycleCommand;
  stateDir?: string;
}): Promise<GovernanceLifecycleReceipt> {
  const status: LifecycleReceiptStatus =
    params.command === "applyLegalHold" || params.command === "releaseLegalHold"
      ? "completed"
      : "open";

  return updateLifecycleReceipt({
    operationId: params.operationId,
    stateDir: params.stateDir,
    mutator: (receipt) => {
      if (receipt.status === "prepared" || receipt.status === "failed") {
        return { ...receipt, status };
      }
      if (receipt.status === status) {
        return receipt;
      }
      throw new Error(`lifecycle_receipt_commit_invalid:${receipt.status}`);
    },
  });
}

export function getCurrentReceiptAttemptId(
  receipt: GovernanceLifecycleReceipt,
): string | undefined {
  for (let i = receipt.stages.length - 1; i >= 0; i -= 1) {
    const stage = receipt.stages[i];
    if (stage.status === "running" || stage.status === "succeeded") {
      return stage.attemptId;
    }
  }
  return receipt.stages.at(-1)?.attemptId;
}

export function isLifecycleReceiptCommitted(receipt: GovernanceLifecycleReceipt): boolean {
  return COMMITTED_STATUSES.has(receipt.status);
}
