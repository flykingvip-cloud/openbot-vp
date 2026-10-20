/**
 * P2-a/d resumePurge + purge closure stages.
 *
 * Never opens a second lifecycle operationId / activeLifecycleOperation.
 * Destructive path always re-validates full marker binding before erase.
 *
 * P2-d: no success stub — missing adapter fails closed; successful erase then
 * cloud_tombstone stage + Catalog CAS → purged + clear active op + finalize receipt.
 */

import path from "node:path";
import {
  cleanupDeletionAuthMarker,
  validateDeletionAuthMarkerLogical,
  writeDeletionAuthMarker,
} from "./deletion-auth-marker.js";
import { isLegalHoldActive } from "./envelope.js";
import { authorizeLifecycleCommand } from "./lifecycle-adapter-matrix.js";
import { resolvePurgeAllowedRoots } from "./lifecycle-durable-fs.js";
import {
  resolvePurgeDestructiveAdapter,
  type PurgeDestructiveContext,
  type PurgeDestructiveOutcome,
} from "./lifecycle-purge-adapters.js";
import { validatePurgeStorageHandle, type PurgeStorageHandle } from "./lifecycle-purge-handle.js";
import {
  appendLifecycleReceiptStage,
  finalizeLifecycleReceipt,
  getLifecycleReceipt,
} from "./lifecycle-receipt-store.js";
import { writeGovernanceRecoveryReceipt } from "./recovery-receipt.js";
import { getSharedDataGovernanceCatalog } from "./runtime-catalog.js";
import type {
  ActorRef,
  CatalogRecord,
  GovernanceDeletionAuthMarker,
  GovernanceLifecycleReceipt,
  LifecycleTransitionConflict,
} from "./types.js";

export type ResumePurgeParams = {
  operationId: string;
  attemptId: string;
  executedBy: ActorRef;
  stateDir?: string;
  /**
   * Optional resolver-issued handle bound to this resource/tenant/binding/operation.
   * Roots inside the handle cannot expand past the server-derived tenant root.
   * Raw path arrays are not accepted.
   */
  storageHandle?: PurgeStorageHandle;
  /**
   * Optional override. When omitted, resolve from Catalog resource type/storage.
   * P2-d: omission no longer stubs success.
   */
  runDestructiveStage?: (
    ctx: PurgeDestructiveContext & {
      receipt: GovernanceLifecycleReceipt;
    },
  ) => Promise<PurgeDestructiveOutcome>;
  /**
   * After successful destructive + cloud stages, CAS Catalog → purged and finalize.
   * Default true (P2-d closure). Set false only for mid-flight foundation tests.
   */
  closeOnSuccess?: boolean;
};

export type ResumePurgeResult =
  | {
      ok: true;
      record: CatalogRecord;
      receipt: GovernanceLifecycleReceipt;
      marker?: GovernanceDeletionAuthMarker;
      closed?: boolean;
      healed?: boolean;
    }
  | {
      ok: false;
      conflict: LifecycleTransitionConflict | "marker_invalid" | "hold_blocks";
      message?: string;
      record?: CatalogRecord;
      receipt?: GovernanceLifecycleReceipt;
    };

export type RecoverPurgeAttemptResult =
  | { ok: true; canResume: true; record: CatalogRecord; receipt: GovernanceLifecycleReceipt }
  | {
      ok: true;
      canResume: false;
      healed: true;
      record: CatalogRecord;
      receipt: GovernanceLifecycleReceipt;
    }
  | {
      ok: true;
      canResume: false;
      recoveryRequired: true;
      reason: string;
      markerValid: boolean;
    };

function hasPurgeSuccessEvidence(receipt: GovernanceLifecycleReceipt): boolean {
  const execOk = receipt.stages.some(
    (s) => s.stage === "purge_execute" && s.status === "succeeded",
  );
  const cloudOk = receipt.stages.some(
    (s) =>
      s.stage === "cloud_tombstone" && (s.status === "succeeded" || s.status === "not_applicable"),
  );
  return execOk && cloudOk;
}

function resolveHealActor(receipt: GovernanceLifecycleReceipt): ActorRef {
  for (let i = receipt.stages.length - 1; i >= 0; i -= 1) {
    const actor = receipt.stages[i]?.actor;
    if (actor) {
      return actor;
    }
  }
  if (receipt.executedBy[0]) {
    return receipt.executedBy[0];
  }
  return receipt.requestedBy;
}

/**
 * Catalog already `purged` with a same-resource open receipt: if destructive/cloud
 * success evidence exists, idempotently append catalog_close and complete the receipt.
 * Insufficient evidence stays recovery_required — never guess success.
 */
async function healPurgedOpenReceipt(params: {
  operationId: string;
  attemptId: string;
  record: CatalogRecord;
  receipt: GovernanceLifecycleReceipt;
  stateDir?: string;
}): Promise<
  | { ok: true; record: CatalogRecord; receipt: GovernanceLifecycleReceipt }
  | { ok: false; reason: string }
> {
  if (params.record.envelope.lifecycleState !== "purged") {
    return { ok: false, reason: "catalog_not_purged" };
  }
  if (params.receipt.status !== "open") {
    return { ok: false, reason: `receipt_${params.receipt.status}` };
  }
  if (params.receipt.resourceId !== params.record.envelope.resourceId) {
    return { ok: false, reason: "resource_mismatch" };
  }
  if (params.receipt.command !== "requestPurge") {
    return { ok: false, reason: "not_purge_receipt" };
  }
  if (params.record.envelope.activeLifecycleOperation) {
    return { ok: false, reason: "active_op_still_bound" };
  }
  if (!hasPurgeSuccessEvidence(params.receipt)) {
    return { ok: false, reason: "purged_open_receipt_insufficient_evidence" };
  }

  const actor = resolveHealActor(params.receipt);
  const hasClose = params.receipt.stages.some(
    (s) => s.stage === "catalog_close" && s.status === "succeeded",
  );
  if (!hasClose) {
    const attemptNumber =
      params.receipt.stages.filter((s) => s.stage === "catalog_close").length + 1;
    await appendLifecycleReceiptStage({
      operationId: params.operationId,
      executedBy: actor,
      stateDir: params.stateDir,
      stage: {
        stage: "catalog_close",
        status: "succeeded",
        attemptId: params.attemptId,
        attempt: attemptNumber,
        actor,
        targetBindingIds: [params.record.envelope.canonicalBindingId],
        completedAt: new Date().toISOString(),
      },
    });
  }

  const finalized = await finalizeLifecycleReceipt({
    operationId: params.operationId,
    status: "completed",
    stateDir: params.stateDir,
  });
  return { ok: true, record: params.record, receipt: finalized };
}

async function revalidateForDestructive(params: {
  operationId: string;
  attemptId: string;
  marker: GovernanceDeletionAuthMarker;
  stateDir?: string;
}): Promise<
  | { ok: true; record: CatalogRecord; receipt: GovernanceLifecycleReceipt }
  | {
      ok: false;
      conflict: LifecycleTransitionConflict | "marker_invalid" | "hold_blocks";
      message?: string;
    }
> {
  const catalog = getSharedDataGovernanceCatalog({ stateDir: params.stateDir });
  const receipt = getLifecycleReceipt({
    operationId: params.operationId,
    stateDir: params.stateDir,
  });
  if (!receipt || receipt.status !== "open") {
    return { ok: false, conflict: "command_not_allowed", message: "receipt_not_open" };
  }
  const record = await catalog.get(receipt.resourceId);
  if (!record) {
    return { ok: false, conflict: "not_found" };
  }
  if (isLegalHoldActive(record.envelope)) {
    return { ok: false, conflict: "hold_blocks" };
  }
  const check = validateDeletionAuthMarkerLogical({
    marker: params.marker,
    record,
    receipt,
  });
  if (!check.ok) {
    return { ok: false, conflict: "marker_invalid", message: check.reason };
  }
  return { ok: true, record, receipt };
}

/**
 * Cloud tombstone stage (Gate): no objectKey/cloud target → evidenced not_applicable;
 * cloud target without adapter → fail closed.
 */
async function appendCloudTombstoneStage(params: {
  operationId: string;
  attemptId: string;
  attemptNumber: number;
  executedBy: ActorRef;
  record: CatalogRecord;
  stateDir?: string;
}): Promise<
  | { ok: true; receipt: GovernanceLifecycleReceipt }
  | {
      ok: false;
      conflict: LifecycleTransitionConflict;
      message: string;
      receipt: GovernanceLifecycleReceipt;
    }
> {
  const canonical =
    params.record.bindings.find(
      (b) => b.bindingId === params.record.envelope.canonicalBindingId && b.role === "canonical",
    ) ?? params.record.bindings.find((b) => b.role === "canonical");
  const needsCloud =
    Boolean(canonical?.objectKey) ||
    canonical?.storageKind === "object-store" ||
    canonical?.storageKind === "byos";

  if (!needsCloud) {
    const receipt = await appendLifecycleReceiptStage({
      operationId: params.operationId,
      executedBy: params.executedBy,
      stateDir: params.stateDir,
      stage: {
        stage: "cloud_tombstone",
        status: "not_applicable",
        attemptId: params.attemptId,
        attempt: params.attemptNumber,
        actor: params.executedBy,
        targetBindingIds: canonical ? [canonical.bindingId] : [],
        completedAt: new Date().toISOString(),
      },
    });
    return { ok: true, receipt };
  }

  // Cloud required but P2 has no adapter — fail closed, leave receipt open for retry/recovery.
  const receipt = await appendLifecycleReceiptStage({
    operationId: params.operationId,
    executedBy: params.executedBy,
    stateDir: params.stateDir,
    stage: {
      stage: "cloud_tombstone",
      status: "failed",
      attemptId: params.attemptId,
      attempt: params.attemptNumber,
      actor: params.executedBy,
      targetBindingIds: canonical ? [canonical.bindingId] : [],
      completedAt: new Date().toISOString(),
      errorCode: "cloud_purge_adapter_missing",
    },
  });
  return {
    ok: false,
    conflict: "command_not_allowed",
    message: "cloud_purge_adapter_missing",
    receipt,
  };
}

async function casCatalogPurged(params: {
  resourceId: string;
  expectedGovernanceVersion: number;
  stateDir?: string;
}): Promise<
  { ok: true; record: CatalogRecord } | { ok: false; conflict: LifecycleTransitionConflict }
> {
  const catalog = getSharedDataGovernanceCatalog({ stateDir: params.stateDir });
  const existing = await catalog.get(params.resourceId);
  if (!existing) {
    return { ok: false, conflict: "not_found" };
  }
  if (existing.envelope.governanceVersion !== params.expectedGovernanceVersion) {
    return { ok: false, conflict: "version_conflict" };
  }
  if (existing.envelope.lifecycleState !== "deletion_pending") {
    return { ok: false, conflict: "state_conflict" };
  }
  const now = new Date().toISOString();
  const next: CatalogRecord = {
    envelope: {
      ...existing.envelope,
      lifecycleState: "purged",
      activeLifecycleOperation: null,
      governanceVersion: params.expectedGovernanceVersion + 1,
      updatedAt: now,
    },
    bindings: existing.bindings,
  };
  const put = await catalog.compareAndPut({
    resourceId: params.resourceId,
    expectedGovernanceVersion: params.expectedGovernanceVersion,
    next,
  });
  if (!put.ok) {
    if (put.conflict === "not_found") {
      return { ok: false, conflict: "not_found" };
    }
    return { ok: false, conflict: "version_conflict" };
  }
  return { ok: true, record: put.record };
}

export async function resumePurge(params: ResumePurgeParams): Promise<ResumePurgeResult> {
  const receipt = getLifecycleReceipt({
    operationId: params.operationId,
    stateDir: params.stateDir,
  });
  if (!receipt) {
    return { ok: false, conflict: "not_found", message: "receipt_missing" };
  }
  if (receipt.command !== "requestPurge") {
    return { ok: false, conflict: "command_not_allowed", message: "not_purge_receipt" };
  }
  if (receipt.status !== "open") {
    return { ok: false, conflict: "command_not_allowed", message: `receipt_${receipt.status}` };
  }

  const catalog = getSharedDataGovernanceCatalog({ stateDir: params.stateDir });
  let record = await catalog.get(receipt.resourceId);
  if (!record) {
    return { ok: false, conflict: "not_found" };
  }

  const typeAuth = authorizeLifecycleCommand({
    resourceType: record.envelope.resourceType,
    command: "resumePurge",
    actor: params.executedBy,
  });
  if (!typeAuth.ok) {
    return {
      ok: false,
      conflict: "command_not_allowed",
      message: typeAuth.reason,
      record,
      receipt,
    };
  }

  if (record.envelope.lifecycleState === "purged" && receipt.status === "open") {
    const healed = await healPurgedOpenReceipt({
      operationId: params.operationId,
      attemptId: params.attemptId,
      record,
      receipt,
      stateDir: params.stateDir,
    });
    if (healed.ok) {
      return {
        ok: true,
        record: healed.record,
        receipt: healed.receipt,
        closed: true,
        healed: true,
      };
    }
    return {
      ok: false,
      conflict: "command_not_allowed",
      message: healed.reason,
      record,
      receipt,
    };
  }

  const active = record.envelope.activeLifecycleOperation;
  if (!active || active.operationId !== params.operationId) {
    return { ok: false, conflict: "active_operation_mismatch" };
  }
  if (record.envelope.lifecycleState !== "deletion_pending") {
    return { ok: false, conflict: "state_conflict" };
  }
  if (isLegalHoldActive(record.envelope)) {
    return { ok: false, conflict: "hold_blocks" };
  }

  const attemptNumber = receipt.stages.filter((s) => s.stage === "purge_execute").length + 1;
  const now = new Date().toISOString();
  let nextReceipt = await appendLifecycleReceiptStage({
    operationId: params.operationId,
    executedBy: params.executedBy,
    stateDir: params.stateDir,
    stage: {
      stage: "purge_execute",
      status: "running",
      attemptId: params.attemptId,
      attempt: attemptNumber,
      actor: params.executedBy,
      targetBindingIds: [record.envelope.canonicalBindingId],
      startedAt: now,
    },
  });

  const canonical = record.bindings.find(
    (b) => b.bindingId === record!.envelope.canonicalBindingId && b.role === "canonical",
  );
  if (!canonical) {
    return { ok: false, conflict: "command_not_allowed", message: "missing_canonical" };
  }

  record = (await catalog.get(receipt.resourceId))!;
  if (isLegalHoldActive(record.envelope)) {
    return { ok: false, conflict: "hold_blocks" };
  }
  if (record.envelope.activeLifecycleOperation?.operationId !== params.operationId) {
    return { ok: false, conflict: "active_operation_mismatch" };
  }

  const marker = writeDeletionAuthMarker({
    operationId: params.operationId,
    attemptId: params.attemptId,
    resourceId: record.envelope.resourceId,
    bindingId: canonical.bindingId,
    locator: canonical.locator,
    objectKey: canonical.objectKey,
    governanceVersion: record.envelope.governanceVersion,
    actor: params.executedBy,
    tenantId: record.envelope.tenantId,
    receiptId: receipt.receiptId,
    stateDir: params.stateDir,
  });

  const logical = validateDeletionAuthMarkerLogical({
    marker,
    record,
    receipt: nextReceipt,
  });
  if (!logical.ok) {
    return { ok: false, conflict: "marker_invalid", message: logical.reason };
  }

  const preDestroy = await revalidateForDestructive({
    operationId: params.operationId,
    attemptId: params.attemptId,
    marker,
    stateDir: params.stateDir,
  });
  if (!preDestroy.ok) {
    return preDestroy;
  }
  record = preDestroy.record;
  nextReceipt = preDestroy.receipt;

  const destructive =
    params.runDestructiveStage ?? (async (ctx) => resolvePurgeDestructiveAdapter(ctx.record)(ctx));

  let stageStatus: "succeeded" | "failed" = "failed";
  let errorCode: string | undefined = "destructive_not_run";
  try {
    const again = await revalidateForDestructive({
      operationId: params.operationId,
      attemptId: params.attemptId,
      marker,
      stateDir: params.stateDir,
    });
    if (!again.ok) {
      return again;
    }
    const canon = again.record.bindings.find(
      (b) => b.bindingId === again.record.envelope.canonicalBindingId && b.role === "canonical",
    );
    if (!canon) {
      return { ok: false, conflict: "command_not_allowed", message: "missing_canonical" };
    }
    const trustedRoots = resolvePurgeAllowedRoots({
      tenantId: again.record.envelope.tenantId,
      stateDir: params.stateDir,
    });
    let allowedRoots = trustedRoots;
    if (params.storageHandle) {
      const bound = validatePurgeStorageHandle({
        handle: params.storageHandle,
        record: again.record,
        operationId: params.operationId,
        trustedRoots,
      });
      if (!bound.ok) {
        return {
          ok: false,
          conflict: "command_not_allowed",
          message: bound.reason,
          record: again.record,
          receipt: again.receipt,
        };
      }
      allowedRoots = bound.allowedRoots;
    }
    const eraseTarget = {
      bindingId: canon.bindingId,
      locator: path.resolve(canon.locator),
      objectKey: canon.objectKey ?? null,
    };
    const outcome = await destructive({
      record: again.record,
      receipt: again.receipt,
      marker,
      eraseTarget,
      allowedRoots,
    });
    stageStatus = outcome.status;
    errorCode = outcome.errorCode;
    record = again.record;
  } catch (err) {
    stageStatus = "failed";
    errorCode = `destructive_threw:${String((err as Error)?.message ?? err)}`;
    await appendLifecycleReceiptStage({
      operationId: params.operationId,
      executedBy: params.executedBy,
      stateDir: params.stateDir,
      stage: {
        stage: "purge_execute",
        status: "failed",
        attemptId: params.attemptId,
        attempt: attemptNumber,
        actor: params.executedBy,
        targetBindingIds: [record.envelope.canonicalBindingId],
        startedAt: now,
        completedAt: new Date().toISOString(),
        errorCode,
      },
    });
    return {
      ok: false,
      conflict: "command_not_allowed",
      message: errorCode,
    };
  }

  nextReceipt = await appendLifecycleReceiptStage({
    operationId: params.operationId,
    executedBy: params.executedBy,
    stateDir: params.stateDir,
    stage: {
      stage: "purge_execute",
      status: stageStatus,
      attemptId: params.attemptId,
      attempt: attemptNumber,
      actor: params.executedBy,
      targetBindingIds: [record.envelope.canonicalBindingId],
      startedAt: now,
      completedAt: new Date().toISOString(),
      errorCode,
    },
  });

  if (stageStatus !== "succeeded") {
    return {
      ok: false,
      conflict: "command_not_allowed",
      message: errorCode ?? "purge_execute_failed",
      record,
      receipt: nextReceipt,
    };
  }

  cleanupDeletionAuthMarker({
    operationId: params.operationId,
    attemptId: params.attemptId,
    stateDir: params.stateDir,
  });

  const cloud = await appendCloudTombstoneStage({
    operationId: params.operationId,
    attemptId: params.attemptId,
    attemptNumber,
    executedBy: params.executedBy,
    record,
    stateDir: params.stateDir,
  });
  if (!cloud.ok) {
    return {
      ok: false,
      conflict: cloud.conflict,
      message: cloud.message,
      record,
      receipt: cloud.receipt,
    };
  }
  nextReceipt = cloud.receipt;

  const closeOnSuccess = params.closeOnSuccess !== false;
  if (!closeOnSuccess) {
    return { ok: true, record, receipt: nextReceipt, marker, closed: false };
  }

  // Re-read before Catalog terminal write.
  const latest = await catalog.get(receipt.resourceId);
  if (!latest) {
    return { ok: false, conflict: "not_found" };
  }
  if (latest.envelope.activeLifecycleOperation?.operationId !== params.operationId) {
    return { ok: false, conflict: "active_operation_mismatch", record: latest };
  }
  if (isLegalHoldActive(latest.envelope)) {
    return { ok: false, conflict: "hold_blocks", record: latest };
  }

  const closed = await casCatalogPurged({
    resourceId: receipt.resourceId,
    expectedGovernanceVersion: latest.envelope.governanceVersion,
    stateDir: params.stateDir,
  });
  if (!closed.ok) {
    writeGovernanceRecoveryReceipt({
      operationId: params.operationId,
      stage: "purge_catalog_close",
      reason: `catalog_cas_${closed.conflict}_after_destructive`,
      resourceIds: [receipt.resourceId],
      haltCompensation: true,
      stateDir: params.stateDir,
    });
    return {
      ok: false,
      conflict: closed.conflict,
      message: "destructive_ok_catalog_cas_failed",
      record: latest,
      receipt: nextReceipt,
    };
  }

  await appendLifecycleReceiptStage({
    operationId: params.operationId,
    executedBy: params.executedBy,
    stateDir: params.stateDir,
    stage: {
      stage: "catalog_close",
      status: "succeeded",
      attemptId: params.attemptId,
      attempt: attemptNumber,
      actor: params.executedBy,
      targetBindingIds: [closed.record.envelope.canonicalBindingId],
      completedAt: new Date().toISOString(),
    },
  });

  const finalized = await finalizeLifecycleReceipt({
    operationId: params.operationId,
    status: "completed",
    stateDir: params.stateDir,
  });

  return {
    ok: true,
    record: closed.record,
    receipt: finalized,
    marker,
    closed: true,
  };
}

/**
 * After crash / interrupt: open receipt + active op can resume;
 * prepared without Catalog binding → recovery_required;
 * leftover marker without valid binding is not authorizing.
 */
export async function recoverPurgeAttempt(params: {
  operationId: string;
  attemptId: string;
  stateDir?: string;
}): Promise<RecoverPurgeAttemptResult> {
  const receipt = getLifecycleReceipt({
    operationId: params.operationId,
    stateDir: params.stateDir,
  });
  if (!receipt) {
    return {
      ok: true,
      canResume: false,
      recoveryRequired: true,
      reason: "receipt_missing",
      markerValid: false,
    };
  }
  if (receipt.status === "prepared" || receipt.status === "failed") {
    return {
      ok: true,
      canResume: false,
      recoveryRequired: true,
      reason: `receipt_${receipt.status}`,
      markerValid: false,
    };
  }
  const catalog = getSharedDataGovernanceCatalog({ stateDir: params.stateDir });
  const record = await catalog.get(receipt.resourceId);
  if (!record) {
    return {
      ok: true,
      canResume: false,
      recoveryRequired: true,
      reason: "catalog_missing",
      markerValid: false,
    };
  }
  const { readDeletionAuthMarker } = await import("./deletion-auth-marker.js");
  const marker = readDeletionAuthMarker({
    operationId: params.operationId,
    attemptId: params.attemptId,
    stateDir: params.stateDir,
  });
  const markerCheck = validateDeletionAuthMarkerLogical({ marker, record, receipt });
  if (
    record.envelope.activeLifecycleOperation?.operationId === params.operationId &&
    receipt.status === "open"
  ) {
    return { ok: true, canResume: true, record, receipt };
  }
  if (record.envelope.lifecycleState === "purged" && receipt.status === "open") {
    const healed = await healPurgedOpenReceipt({
      operationId: params.operationId,
      attemptId: params.attemptId,
      record,
      receipt,
      stateDir: params.stateDir,
    });
    if (healed.ok) {
      return {
        ok: true,
        canResume: false,
        healed: true,
        record: healed.record,
        receipt: healed.receipt,
      };
    }
    return {
      ok: true,
      canResume: false,
      recoveryRequired: true,
      reason: healed.reason,
      markerValid: markerCheck.ok,
    };
  }
  return {
    ok: true,
    canResume: false,
    recoveryRequired: true,
    reason: "active_op_or_receipt_inconsistent",
    markerValid: markerCheck.ok,
  };
}

/** Test/helper: force-fail a prepared receipt (simulates CAS abort terminalization). */
export async function markLifecycleReceiptFailedForTests(params: {
  operationId: string;
  stateDir?: string;
}): Promise<GovernanceLifecycleReceipt> {
  return finalizeLifecycleReceipt({
    operationId: params.operationId,
    status: "failed",
    stateDir: params.stateDir,
  });
}
