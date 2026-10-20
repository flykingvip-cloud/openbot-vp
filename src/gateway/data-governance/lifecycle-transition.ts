/**
 * P2-a controlled Catalog lifecycle command transitions
 * (resource-version compareAndPut + active-op + hold carve-out + prepared receipts).
 */

import { isLegalHoldActive } from "./envelope.js";
import {
  commitLifecycleReceiptAfterCas,
  computeLifecycleRequestFingerprint,
  createLifecycleReceiptUnique,
  finalizeLifecycleReceipt,
  getLifecycleReceipt,
  isLifecycleReceiptCommitted,
  reconcileFailPreparedAfterVersionConflict,
} from "./lifecycle-receipt-store.js";
import { getSharedDataGovernanceCatalog } from "./runtime-catalog.js";
import type {
  ActorRef,
  CatalogRecord,
  GovernanceLifecycleReceipt,
  LifecycleCommand,
  LifecycleState,
  LifecycleTransitionConflict,
  LongRunningLifecycleCommand,
} from "./types.js";

export type TransitionCatalogLifecycleCommandParams = {
  resourceId: string;
  command: LifecycleCommand;
  expectedStates: LifecycleState[];
  expectedGovernanceVersion: number;
  operationId: string;
  requestedBy: ActorRef;
  stateDir?: string;
  /** applyLegalHold */
  hold?: { holdId: string; reason: string };
  /** Optional deletion scope fingerprint input for purge/forget. */
  deletionScope?: string;
  targetBindingIds?: string[];
  /**
   * @internal Test hook: after successful Catalog CAS, before receipt commit.
   * Used to simulate cross-process scheduling gaps.
   */
  afterCatalogCasSuccess?: () => Promise<void>;
};

export type TransitionCatalogLifecycleResult =
  | {
      ok: true;
      record: CatalogRecord;
      receipt: GovernanceLifecycleReceipt;
      replay: boolean;
      governanceVersion: number;
    }
  | { ok: false; conflict: LifecycleTransitionConflict; message?: string };

const LONG_OPEN = new Set<LifecycleCommand>([
  "archive",
  "restore",
  "retire",
  "requestPurge",
  "forget",
]);

async function compareAndPutRecord(params: {
  resourceId: string;
  expectedGovernanceVersion: number;
  next: CatalogRecord;
  stateDir?: string;
}): Promise<TransitionCatalogLifecycleResult | { ok: true; record: CatalogRecord }> {
  const catalog = getSharedDataGovernanceCatalog({ stateDir: params.stateDir });
  const result = await catalog.compareAndPut({
    resourceId: params.resourceId,
    expectedGovernanceVersion: params.expectedGovernanceVersion,
    next: params.next,
  });
  if (!result.ok) {
    if (result.conflict === "not_found") {
      return { ok: false, conflict: "not_found" };
    }
    return { ok: false, conflict: "version_conflict" };
  }
  return { ok: true, record: result.record };
}

async function isCatalogBoundToOperation(params: {
  resourceId: string;
  operationId: string;
  stateDir?: string;
}): Promise<boolean> {
  const record = await getSharedDataGovernanceCatalog({ stateDir: params.stateDir }).get(
    params.resourceId,
  );
  return record?.envelope.activeLifecycleOperation?.operationId === params.operationId;
}

async function failPreparedReceipt(params: {
  resourceId: string;
  operationId: string;
  stateDir: string | undefined;
  conflict: LifecycleTransitionConflict;
}): Promise<TransitionCatalogLifecycleResult> {
  try {
    await reconcileFailPreparedAfterVersionConflict({
      operationId: params.operationId,
      stateDir: params.stateDir,
      isCatalogBoundToOperation: () =>
        isCatalogBoundToOperation({
          resourceId: params.resourceId,
          operationId: params.operationId,
          stateDir: params.stateDir,
        }),
    });
  } catch {
    // best-effort terminalization
  }
  return { ok: false, conflict: params.conflict };
}

function replayIfCommitted(
  receipt: GovernanceLifecycleReceipt,
  record: CatalogRecord,
): TransitionCatalogLifecycleResult | null {
  if (!isLifecycleReceiptCommitted(receipt)) {
    return null;
  }
  return {
    ok: true,
    record,
    receipt,
    replay: true,
    governanceVersion: record.envelope.governanceVersion,
  };
}

async function applyHoldOrRelease(
  params: TransitionCatalogLifecycleCommandParams,
  existing: CatalogRecord,
): Promise<TransitionCatalogLifecycleResult> {
  const isApply = params.command === "applyLegalHold";
  if (isApply) {
    if (!params.hold?.holdId?.trim() || !params.hold.reason?.trim()) {
      return { ok: false, conflict: "command_not_allowed", message: "hold_required" };
    }
  } else if (!isLegalHoldActive(existing.envelope)) {
    return { ok: false, conflict: "command_not_allowed", message: "no_active_hold" };
  }

  const fingerprint = computeLifecycleRequestFingerprint({
    resourceId: params.resourceId,
    tenantId: existing.envelope.tenantId,
    command: params.command,
    expectedGovernanceVersion: params.expectedGovernanceVersion,
    holdReason: params.hold?.reason ?? existing.envelope.legalHold?.reason,
  });

  const created = await createLifecycleReceiptUnique({
    operationId: params.operationId,
    requestFingerprint: fingerprint,
    command: params.command,
    resourceId: existing.envelope.resourceId,
    resourceType: existing.envelope.resourceType,
    tenantId: existing.envelope.tenantId,
    requestedBy: params.requestedBy,
    previousLifecycleState: existing.envelope.lifecycleState,
    legalHoldSnapshot: existing.envelope.legalHold ?? null,
    stateDir: params.stateDir,
  });
  if (!created.ok) {
    return { ok: false, conflict: created.conflict };
  }
  if (created.replay) {
    const latest = await getSharedDataGovernanceCatalog({ stateDir: params.stateDir }).get(
      params.resourceId,
    );
    if (!latest) {
      return { ok: false, conflict: "not_found" };
    }
    const replay = replayIfCommitted(created.receipt, latest);
    if (replay) {
      return replay;
    }
    return { ok: false, conflict: "command_not_allowed", message: "receipt_not_committed" };
  }

  const now = new Date().toISOString();
  const nextLegalHold = isApply
    ? {
        holdId: params.hold!.holdId,
        reason: params.hold!.reason,
        appliedBy: params.requestedBy,
        appliedAt: now,
      }
    : existing.envelope.legalHold
      ? { ...existing.envelope.legalHold, releasedAt: now }
      : null;

  const next: CatalogRecord = {
    envelope: {
      ...existing.envelope,
      legalHold: nextLegalHold,
      activeLifecycleOperation: existing.envelope.activeLifecycleOperation ?? null,
      governanceVersion: params.expectedGovernanceVersion + 1,
      updatedAt: now,
    },
    bindings: existing.bindings,
  };

  const put = await compareAndPutRecord({
    resourceId: params.resourceId,
    expectedGovernanceVersion: params.expectedGovernanceVersion,
    next,
    stateDir: params.stateDir,
  });
  if (!put.ok) {
    return failPreparedReceipt({
      resourceId: params.resourceId,
      operationId: params.operationId,
      stateDir: params.stateDir,
      conflict: put.conflict,
    });
  }
  if (params.afterCatalogCasSuccess) {
    await params.afterCatalogCasSuccess();
  }
  const committed = await commitLifecycleReceiptAfterCas({
    operationId: params.operationId,
    command: params.command,
    stateDir: params.stateDir,
  });
  return {
    ok: true,
    record: put.record,
    receipt: committed,
    replay: false,
    governanceVersion: put.record.envelope.governanceVersion,
  };
}

async function openLongRunning(
  params: TransitionCatalogLifecycleCommandParams,
  existing: CatalogRecord,
): Promise<TransitionCatalogLifecycleResult> {
  const fingerprint = computeLifecycleRequestFingerprint({
    resourceId: params.resourceId,
    tenantId: existing.envelope.tenantId,
    command: params.command,
    expectedGovernanceVersion: params.expectedGovernanceVersion,
    deletionScope: params.deletionScope,
    targetBindingIds: params.targetBindingIds,
  });

  const active = existing.envelope.activeLifecycleOperation;
  if (active) {
    if (active.operationId !== params.operationId) {
      return {
        ok: false,
        conflict: "command_not_allowed",
        message: "active_operation_occupied",
      };
    }
    const created = await createLifecycleReceiptUnique({
      operationId: params.operationId,
      requestFingerprint: fingerprint,
      command: params.command,
      resourceId: existing.envelope.resourceId,
      resourceType: existing.envelope.resourceType,
      tenantId: existing.envelope.tenantId,
      requestedBy: params.requestedBy,
      previousLifecycleState: existing.envelope.lifecycleState,
      legalHoldSnapshot: existing.envelope.legalHold ?? null,
      stateDir: params.stateDir,
    });
    if (!created.ok) {
      return { ok: false, conflict: created.conflict };
    }
    if (created.replay) {
      const replay = replayIfCommitted(created.receipt, existing);
      if (replay) {
        return replay;
      }
    }
    return {
      ok: false,
      conflict: "command_not_allowed",
      message: "active_operation_occupied",
    };
  }

  if (params.command === "requestPurge" && isLegalHoldActive(existing.envelope)) {
    return { ok: false, conflict: "legal_hold_blocks" };
  }

  const created = await createLifecycleReceiptUnique({
    operationId: params.operationId,
    requestFingerprint: fingerprint,
    command: params.command,
    resourceId: existing.envelope.resourceId,
    resourceType: existing.envelope.resourceType,
    tenantId: existing.envelope.tenantId,
    requestedBy: params.requestedBy,
    previousLifecycleState: existing.envelope.lifecycleState,
    legalHoldSnapshot: existing.envelope.legalHold ?? null,
    stateDir: params.stateDir,
  });
  if (!created.ok) {
    return { ok: false, conflict: created.conflict };
  }
  if (created.replay) {
    const latest = await getSharedDataGovernanceCatalog({ stateDir: params.stateDir }).get(
      params.resourceId,
    );
    if (!latest) {
      return { ok: false, conflict: "not_found" };
    }
    const replay = replayIfCommitted(created.receipt, latest);
    if (replay) {
      return replay;
    }
    return { ok: false, conflict: "command_not_allowed", message: "receipt_not_committed" };
  }

  const now = new Date().toISOString();
  let nextLifecycle = existing.envelope.lifecycleState;
  if (params.command === "requestPurge") {
    nextLifecycle = "deletion_pending";
  }

  const next: CatalogRecord = {
    envelope: {
      ...existing.envelope,
      lifecycleState: nextLifecycle,
      activeLifecycleOperation: {
        operationId: params.operationId,
        command: params.command as LongRunningLifecycleCommand,
        receiptId: created.receipt.receiptId,
        previousLifecycleState: existing.envelope.lifecycleState,
        startedAt: now,
      },
      governanceVersion: params.expectedGovernanceVersion + 1,
      updatedAt: now,
    },
    bindings: existing.bindings,
  };

  const put = await compareAndPutRecord({
    resourceId: params.resourceId,
    expectedGovernanceVersion: params.expectedGovernanceVersion,
    next,
    stateDir: params.stateDir,
  });
  if (!put.ok) {
    return failPreparedReceipt({
      resourceId: params.resourceId,
      operationId: params.operationId,
      stateDir: params.stateDir,
      conflict: put.conflict,
    });
  }
  if (params.afterCatalogCasSuccess) {
    await params.afterCatalogCasSuccess();
  }
  const committed = await commitLifecycleReceiptAfterCas({
    operationId: params.operationId,
    command: params.command,
    stateDir: params.stateDir,
  });
  return {
    ok: true,
    record: put.record,
    receipt: committed,
    replay: false,
    governanceVersion: put.record.envelope.governanceVersion,
  };
}

async function cancelDeletion(
  params: TransitionCatalogLifecycleCommandParams,
  existing: CatalogRecord,
): Promise<TransitionCatalogLifecycleResult> {
  const active = existing.envelope.activeLifecycleOperation;
  if (!active || active.command !== "requestPurge") {
    return { ok: false, conflict: "command_not_allowed", message: "no_purge_active_op" };
  }
  if (active.operationId !== params.operationId) {
    return { ok: false, conflict: "active_operation_mismatch" };
  }
  if (existing.envelope.lifecycleState !== "deletion_pending") {
    return { ok: false, conflict: "state_conflict" };
  }

  const receipt = getLifecycleReceipt({
    operationId: params.operationId,
    stateDir: params.stateDir,
  });
  if (!receipt || receipt.status !== "open") {
    return { ok: false, conflict: "not_found", message: "receipt_missing_or_not_open" };
  }

  const now = new Date().toISOString();
  const next: CatalogRecord = {
    envelope: {
      ...existing.envelope,
      lifecycleState: active.previousLifecycleState,
      legalHold: existing.envelope.legalHold ?? null,
      activeLifecycleOperation: null,
      governanceVersion: params.expectedGovernanceVersion + 1,
      updatedAt: now,
    },
    bindings: existing.bindings,
  };

  const put = await compareAndPutRecord({
    resourceId: params.resourceId,
    expectedGovernanceVersion: params.expectedGovernanceVersion,
    next,
    stateDir: params.stateDir,
  });
  if (!put.ok) {
    return { ok: false, conflict: put.conflict };
  }
  const finalized = await finalizeLifecycleReceipt({
    operationId: params.operationId,
    status: "cancelled",
    stateDir: params.stateDir,
  });
  return {
    ok: true,
    record: put.record,
    receipt: finalized,
    replay: false,
    governanceVersion: put.record.envelope.governanceVersion,
  };
}

/**
 * Controlled lifecycle command API — use for P2 commands.
 * Prefer this over unconstrained `transitionCatalogLifecycle` for lifecycle commands.
 */
export async function transitionCatalogLifecycleCommand(
  params: TransitionCatalogLifecycleCommandParams,
): Promise<TransitionCatalogLifecycleResult> {
  const catalog = getSharedDataGovernanceCatalog({ stateDir: params.stateDir });
  const existing = await catalog.get(params.resourceId);
  if (!existing) {
    return { ok: false, conflict: "not_found" };
  }
  if (!params.expectedStates.includes(existing.envelope.lifecycleState)) {
    return { ok: false, conflict: "state_conflict" };
  }
  // Soft preflight only — authoritative check is compareAndPut under lock.
  if (existing.envelope.governanceVersion !== params.expectedGovernanceVersion) {
    return { ok: false, conflict: "version_conflict" };
  }

  if (params.command === "applyLegalHold" || params.command === "releaseLegalHold") {
    return applyHoldOrRelease(params, existing);
  }
  if (params.command === "cancelDeletion") {
    return cancelDeletion(params, existing);
  }
  if (params.command === "resumePurge") {
    return {
      ok: false,
      conflict: "command_not_allowed",
      message: "use_resumePurge_api",
    };
  }
  if (LONG_OPEN.has(params.command)) {
    return openLongRunning(params, existing);
  }
  return { ok: false, conflict: "command_not_allowed" };
}
