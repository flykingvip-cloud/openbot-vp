/**
 * Item 7 Stage D — persistent, cross-process fencing/completion + recovery store.
 *
 * Replaces the dark-slice-only in-memory `createInMemoryFencingStore` /
 * `inMemoryRecoverySink` (in item7-stage-d-memory-sync.ts) with a durable,
 * multi-process-safe implementation so idempotency, single-flight, and
 * recovery breadcrumbs survive process restarts and hold across workers.
 *
 * Storage: file-based atomic CAS under a CONTROLLED placement root
 * (`resolveStateDir()/data-governance/stage-d-sync`). It is NOT a caller wire
 * path — the caller never supplies a path; only tenant/resource/operation
 * identity, which is validated (safe tokens) and hashed into governed
 * filenames. Exclusive acquire uses `fs.openSync(path, "wx")` (O_EXCL), which
 * is atomic across processes at the OS level — no check-then-write race.
 * Durable state writes use `writeJsonDurable` (temp + fsync + rename).
 *
 * This module implements the existing `StageDFencingStore` interface (so it can
 * be injected into `syncMemoryAssets`) plus a richer state machine + recovery
 * API used by the local-only adapter and the operator resolve command. It does
 * NOT modify item7-stage-d-memory-sync.ts, manager-sync-ops.ts, the canonical
 * retirement scan, or any production switch. It performs NO cloud/BYOS I/O.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import {
  readJsonIfPresent,
  writeJsonDurable,
} from "../gateway/data-governance/cognitive-file-lock.js";
import {
  assertSafeRecoveryReceiptToken,
  type GovernanceRecoveryReceipt,
  writeGovernanceRecoveryReceipt,
} from "../gateway/data-governance/recovery-receipt.js";
import type {
  StageDCompletionRecord,
  StageDFencingStore,
  StageDRecoverySink,
} from "./item7-stage-d-memory-sync.js";

export const STAGE_D_PERSISTENT_STORE = "item7-stage-d-persistent-store/v1" as const;
const STORE_SUBDIR = "stage-d-sync";
const RECOVERY_STAGE = "memory_stage_d_sync";

/** Fence lifecycle. `recovery_required` and a live crash-held record both block;
 * only an explicit operator resolve clears them (never an auto stale takeover). */
export type StageDFenceState =
  | "acquired"
  | "copying"
  | "verified"
  | "completed"
  | "recovery_required"
  | "released"
  | "expired";

/** Held-fence record: full identity + state + timestamps (durable). */
export type StageDHeldRecord = {
  fenceKey: string;
  operationId: string;
  fencingToken: string;
  state: StageDFenceState;
  createdAt: string;
  updatedAt: string;
};

/** Completion record persisted for cross-restart replay. Superset of the base
 * StageDCompletionRecord; `completedRecord()` returns the 6-field subset. */
export type StageDStoredCompletion = StageDCompletionRecord & {
  fencingToken: string;
  state: "completed";
  createdAt: string;
  updatedAt: string;
};

/** Auditable, exportable recovery receipt. Richer than GovernanceRecoveryReceipt
 * (adds adapter result, expected/actual hash, residual staging ref, retry
 * eligibility, operator action, resolution). Never stores raw sensitive content. */
export type StageDRecoveryReceipt = {
  operationId: string;
  tenantId: string | null;
  resourceIds: string[];
  fenceKey: string;
  stage: string;
  reason: string;
  error?: string;
  adapterResult?: "clean-failure" | "partial-failure" | "hash-mismatch";
  expectedSha256?: string;
  actualSha256?: string;
  /** Governed staging reference (relative token only — never an absolute host path). */
  residualStagingRef?: string;
  haltCompensation: true;
  retryEligible: boolean;
  operatorAction: string;
  legalHold: boolean;
  createdAt: string;
  resolvedAt: string | null;
  resolution: string | null;
};

export type StageDRecordRecoveryInput = {
  operationId: string;
  tenantId: string | null;
  resourceIds: string[];
  fenceKey: string;
  reason: string;
  error?: string;
  adapterResult?: StageDRecoveryReceipt["adapterResult"];
  expectedSha256?: string;
  actualSha256?: string;
  residualStagingRef?: string;
  retryEligible?: boolean;
  operatorAction?: string;
  legalHold?: boolean;
};

export type StageDResolveInput = {
  operationId: string;
  fenceKey: string;
  operator: string;
  resolution: string;
  /** Under legal hold, physical staging/held cleanup is forbidden; the block is
   * still lifted but residual artifacts are preserved for audit. */
  legalHold?: boolean;
};

export type StageDResolveResult = {
  resolved: true;
  operationId: string;
  fenceKey: string;
  operator: string;
  physicalCleanupPerformed: boolean;
  resolvedAt: string;
};

/** The persistent store: base fencing interface + richer state/recovery API. */
export type StageDPersistentStore = StageDFencingStore & {
  readonly root: string;
  /** Advance the holder's fence state (holder-only; single writer per fence). */
  transition(operationId: string, fenceKey: string, to: StageDFenceState): void;
  heldRecord(fenceKey: string): StageDHeldRecord | null;
  isRecoveryBlocked(fenceKey: string): boolean;
  recordRecoveryRequired(input: StageDRecordRecoveryInput): StageDRecoveryReceipt;
  getRecovery(operationId: string): StageDRecoveryReceipt | null;
  listRecoveries(): StageDRecoveryReceipt[];
  resolveRecovery(input: StageDResolveInput): StageDResolveResult;
  /** StageDRecoverySink bound to this store (writes durable receipt + blocks). */
  readonly recoverySink: StageDRecoverySink;
};

function nowIso(): string {
  return new Date().toISOString();
}

/** sha256 hex of a value — used to derive a safe, collision-resistant filename
 * from a fenceKey/resourceId that itself contains reserved characters (":"). */
function safeName(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** operationId must be a safe token (shared with recovery-receipt.ts). Fail-closed. */
function safeOperationId(operationId: string): string {
  return assertSafeRecoveryReceiptToken(operationId, "operationId");
}

function readJson<T>(dest: string): T | null {
  return readJsonIfPresent(dest) as T | null;
}

export function createPersistentStageDStore(
  opts: { stateDir?: string } = {},
): StageDPersistentStore {
  const root = path.join(
    path.resolve(opts.stateDir ?? resolveStateDir()),
    "data-governance",
    STORE_SUBDIR,
  );
  const heldDir = path.join(root, "held");
  const completedDir = path.join(root, "completed");
  const blockDir = path.join(root, "recovery-block");
  const recoveryDir = path.join(root, "recovery");
  const resolvedDir = path.join(root, "resolved");

  const heldPathFor = (fenceKey: string): string =>
    path.join(heldDir, `${safeName(fenceKey)}.json`);
  const blockPathFor = (fenceKey: string): string =>
    path.join(blockDir, `${safeName(fenceKey)}.json`);
  const completedPathFor = (operationId: string): string =>
    path.join(completedDir, `${safeOperationId(operationId)}.json`);
  const recoveryPathFor = (operationId: string): string =>
    path.join(recoveryDir, `${safeOperationId(operationId)}.json`);
  const resolvedPathFor = (operationId: string): string =>
    path.join(resolvedDir, `${safeOperationId(operationId)}.json`);

  function heldRecord(fenceKey: string): StageDHeldRecord | null {
    return readJson<StageDHeldRecord>(heldPathFor(fenceKey));
  }

  function isRecoveryBlocked(fenceKey: string): boolean {
    return fs.existsSync(blockPathFor(fenceKey));
  }

  const store: StageDPersistentStore = {
    root,

    tryAcquire(fenceKey, operationId, fencingToken) {
      safeOperationId(operationId); // fail-closed on unsafe operationId
      // (a) A durable recovery_required block on this resource halts all new syncs
      // until an operator explicitly resolves it — surfaced as "concurrent".
      if (isRecoveryBlocked(fenceKey)) {
        return { acquired: false, reason: "concurrent" };
      }
      const heldPath = heldPathFor(fenceKey);
      fs.mkdirSync(heldDir, { recursive: true });
      try {
        // (b) Atomic exclusive create — exactly one process across the system wins.
        const fd = fs.openSync(heldPath, "wx", 0o600);
        try {
          const rec: StageDHeldRecord = {
            fenceKey,
            operationId,
            fencingToken,
            state: "acquired",
            createdAt: nowIso(),
            updatedAt: nowIso(),
          };
          fs.writeFileSync(fd, `${JSON.stringify(rec, null, 2)}\n`, "utf8");
          fs.fsyncSync(fd);
        } finally {
          fs.closeSync(fd);
        }
        return { acquired: true };
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") {
          throw err;
        }
        // (c) Someone holds it. Classify — never auto-steal (crash-held stays).
        const existing = heldRecord(fenceKey);
        if (!existing) {
          // Raced release between openSync(EEXIST) and read: treat as contended.
          return { acquired: false, reason: "concurrent" };
        }
        if (existing.state === "recovery_required") {
          return { acquired: false, reason: "concurrent" };
        }
        if (existing.operationId === operationId) {
          // Same operation resuming (e.g. after its own crash): allow ONLY when
          // the fencing token still matches; a stale token is rejected.
          return existing.fencingToken === fencingToken
            ? { acquired: true }
            : { acquired: false, reason: "stale_token" };
        }
        return { acquired: false, reason: "concurrent" };
      }
    },

    transition(operationId, fenceKey, to) {
      const existing = heldRecord(fenceKey);
      if (!existing || existing.operationId !== operationId) {
        throw new Error("stage_d_fence_not_held_by_operation");
      }
      writeJsonDurable(heldPathFor(fenceKey), {
        ...existing,
        state: to,
        updatedAt: nowIso(),
      } satisfies StageDHeldRecord);
    },

    completedRecord(operationId) {
      const stored = readJson<StageDStoredCompletion>(completedPathFor(operationId));
      if (!stored) {
        return null;
      }
      // Return only the base identity subset the fencing interface promises.
      return {
        operationId: stored.operationId,
        tenantId: stored.tenantId,
        sourceResourceId: stored.sourceResourceId,
        destinationMode: stored.destinationMode,
        manifestSha256: stored.manifestSha256,
        classification: stored.classification,
      };
    },

    markCompleted(record) {
      const fenceKey = `memory-sync:${record.sourceResourceId}`;
      const held = heldRecord(fenceKey);
      const stored: StageDStoredCompletion = {
        ...record,
        fencingToken: held?.fencingToken ?? "",
        state: "completed",
        createdAt: held?.createdAt ?? nowIso(),
        updatedAt: nowIso(),
      };
      writeJsonDurable(completedPathFor(record.operationId), stored);
      // Reflect terminal state on the held record (best-effort; not the block).
      if (held) {
        writeJsonDurable(heldPathFor(fenceKey), {
          ...held,
          state: "completed",
          updatedAt: nowIso(),
        } satisfies StageDHeldRecord);
      }
    },

    release(fenceKey) {
      const held = heldRecord(fenceKey);
      // A recovery_required fence is NEVER released here — it stays blocking until
      // an operator resolves it. Any other terminal/in-flight state frees the fence.
      if (held?.state === "recovery_required" || isRecoveryBlocked(fenceKey)) {
        return;
      }
      try {
        fs.unlinkSync(heldPathFor(fenceKey));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
          throw err;
        }
      }
    },

    heldRecord,
    isRecoveryBlocked,

    recordRecoveryRequired(input) {
      const operationId = safeOperationId(input.operationId);
      const receipt: StageDRecoveryReceipt = {
        operationId,
        tenantId: input.tenantId,
        resourceIds: input.resourceIds,
        fenceKey: input.fenceKey,
        stage: RECOVERY_STAGE,
        reason: input.reason,
        error: input.error,
        adapterResult: input.adapterResult,
        expectedSha256: input.expectedSha256,
        actualSha256: input.actualSha256,
        residualStagingRef: input.residualStagingRef,
        haltCompensation: true,
        retryEligible: input.retryEligible ?? false,
        operatorAction:
          input.operatorAction ?? "operator must inspect staging and run resolveRecovery",
        legalHold: input.legalHold ?? false,
        createdAt: nowIso(),
        resolvedAt: null,
        resolution: null,
      };
      // Durable, auditable rich receipt. If this write fails we DO NOT swallow it:
      // the throw propagates so the caller halts (never retries a copy blind).
      writeJsonDurable(recoveryPathFor(operationId), receipt);
      // Canonical governance A3 breadcrumb (also fail-closed on write error).
      writeGovernanceRecoveryReceipt({
        operationId,
        stage: RECOVERY_STAGE,
        reason: input.reason,
        error: input.error,
        resourceIds: input.resourceIds,
        haltCompensation: true,
        stateDir: opts.stateDir,
      });
      // Durable resource block: halts all subsequent syncs on this fence until resolved.
      writeJsonDurable(blockPathFor(input.fenceKey), {
        fenceKey: input.fenceKey,
        operationId,
        reason: input.reason,
        createdAt: nowIso(),
      });
      // Mark the held record recovery_required so it is not freed by release().
      const held = heldRecord(input.fenceKey);
      if (held) {
        writeJsonDurable(heldPathFor(input.fenceKey), {
          ...held,
          state: "recovery_required",
          updatedAt: nowIso(),
        } satisfies StageDHeldRecord);
      }
      return receipt;
    },

    getRecovery(operationId) {
      return readJson<StageDRecoveryReceipt>(recoveryPathFor(operationId));
    },

    listRecoveries() {
      if (!fs.existsSync(recoveryDir)) {
        return [];
      }
      const out: StageDRecoveryReceipt[] = [];
      for (const fileName of fs.readdirSync(recoveryDir)) {
        if (!fileName.endsWith(".json")) {
          continue;
        }
        const parsed = readJson<StageDRecoveryReceipt>(path.join(recoveryDir, fileName));
        if (parsed) {
          out.push(parsed);
        }
      }
      out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return out;
    },

    resolveRecovery(input) {
      const operationId = safeOperationId(input.operationId);
      const receipt = readJson<StageDRecoveryReceipt>(recoveryPathFor(operationId));
      if (!receipt) {
        throw new Error("stage_d_recovery_not_found");
      }
      const resolvedAt = nowIso();
      const legalHold = input.legalHold ?? receipt.legalHold;
      // Legal hold: lift the block for audit closure but DO NOT physically delete
      // held/staging artifacts (preserved for legal review).
      const physicalCleanupPerformed = !legalHold;
      writeJsonDurable(recoveryPathFor(operationId), {
        ...receipt,
        resolvedAt,
        resolution: input.resolution,
      } satisfies StageDRecoveryReceipt);
      writeJsonDurable(resolvedPathFor(operationId), {
        operationId,
        fenceKey: input.fenceKey,
        operator: input.operator,
        resolution: input.resolution,
        legalHold,
        physicalCleanupPerformed,
        resolvedAt,
      });
      // Lifting the block is the ONLY sanctioned way to clear a recovery_required /
      // stale-held fence (never an automatic stale takeover).
      try {
        fs.unlinkSync(blockPathFor(input.fenceKey));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
          throw err;
        }
      }
      if (physicalCleanupPerformed) {
        try {
          fs.unlinkSync(heldPathFor(input.fenceKey));
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
            throw err;
          }
        }
      }
      return {
        resolved: true,
        operationId,
        fenceKey: input.fenceKey,
        operator: input.operator,
        physicalCleanupPerformed,
        resolvedAt,
      };
    },

    recoverySink(params): GovernanceRecoveryReceipt {
      const fenceKey = params.resourceIds?.[0]
        ? `memory-sync:${params.resourceIds[0]}`
        : "memory-sync:unknown";
      const rich = store.recordRecoveryRequired({
        operationId: params.operationId,
        tenantId: null,
        resourceIds: params.resourceIds ?? [],
        fenceKey,
        reason: params.reason,
        error: params.error,
      });
      return {
        operationId: rich.operationId,
        stage: rich.stage,
        reason: rich.reason,
        error: rich.error,
        resourceIds: rich.resourceIds,
        haltCompensation: true,
        createdAt: rich.createdAt,
      };
    },
  };

  return store;
}
