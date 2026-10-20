/**
 * P2-c memory forget slice (Gate A8).
 *
 * Same dual-plane rule as conversation archive:
 * Forbidden: Catalog → purged before domain forget verified.
 * Phase 1: open `forget` (active op; business lifecycle unchanged; writes denied).
 * Phase 2: domain forget (CogniWeave / markdown / injectable adapter).
 * Phase 3: CAS to purged; clear active op; finalize receipt.
 * Fail: recovery_required (default) or keep prior lifecycle.
 *
 * Legal hold blocks forget open/complete (compliance carve-out).
 * Hold/version races after domain: abort on latest version (never stuck active op).
 * Non-whitelist Catalog drift after domain: compensate + recovery_required (no purged retry).
 */

import { randomUUID } from "node:crypto";
import { isLegalHoldActive } from "./envelope.js";
import {
  captureDomainVerificationSnapshot,
  isDomainSnapshotCompatibleWithLatest,
  type DomainVerificationSnapshot,
} from "./lifecycle-conversation.js";
import {
  appendLifecycleReceiptStage,
  finalizeLifecycleReceipt,
  getLifecycleReceipt,
} from "./lifecycle-receipt-store.js";
import {
  transitionCatalogLifecycleCommand,
  type TransitionCatalogLifecycleResult,
} from "./lifecycle-transition.js";
import { writeGovernanceRecoveryReceipt } from "./recovery-receipt.js";
import { getSharedDataGovernanceCatalog } from "./runtime-catalog.js";
import type {
  ActorRef,
  CatalogRecord,
  GovernanceLifecycleReceipt,
  LifecycleState,
  LifecycleTransitionConflict,
} from "./types.js";

export type MemoryDomainCompensateHandle = {
  compensate: (reason: string) => Promise<void>;
  /** After Catalog CAS to purged — drop durable staging. Best-effort. */
  commit?: () => Promise<void>;
};

export type BeginMemoryForgetParams = {
  resourceId: string;
  operationId: string;
  expectedGovernanceVersion: number;
  requestedBy: ActorRef;
  stateDir?: string;
  /** Optional scope fingerprint input for idempotent replay. */
  deletionScope?: string;
};

export type CompleteMemoryForgetParams = {
  resourceId: string;
  operationId: string;
  expectedGovernanceVersion: number;
  /** Must succeed before Catalog → purged CAS. May return a compensate handle. */
  runDomainForget: () => Promise<void | MemoryDomainCompensateHandle>;
  executedBy?: ActorRef;
  stateDir?: string;
  onDomainFailure?: "recovery_required" | "keep_prior";
};

export type AbortMemoryForgetParams = {
  resourceId: string;
  operationId: string;
  expectedGovernanceVersion: number;
  reason: string;
  executedBy?: ActorRef;
  stateDir?: string;
  outcome?: "recovery_required" | "keep_prior";
};

export type MemoryForgetResult =
  | {
      ok: true;
      record: CatalogRecord;
      receipt: GovernanceLifecycleReceipt;
      governanceVersion: number;
      replay?: boolean;
    }
  | {
      ok: false;
      conflict: LifecycleTransitionConflict | "domain_failed";
      message?: string;
      record?: CatalogRecord;
      receipt?: GovernanceLifecycleReceipt;
    };

const CAS_RETRY_LIMIT = 3;

async function compareAndPutRecord(params: {
  resourceId: string;
  expectedGovernanceVersion: number;
  next: CatalogRecord;
  stateDir?: string;
}): Promise<
  { ok: true; record: CatalogRecord } | { ok: false; conflict: LifecycleTransitionConflict }
> {
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

function assertMemoryResource(record: CatalogRecord): LifecycleTransitionConflict | null {
  if (record.envelope.resourceType !== "memory") {
    return "command_not_allowed";
  }
  return null;
}

function isCompensateHandle(
  value: void | MemoryDomainCompensateHandle,
): value is MemoryDomainCompensateHandle {
  return Boolean(value && typeof value === "object" && typeof value.compensate === "function");
}

/**
 * Phase 1 — open forget: active op set, lifecycle stays active (unless hold blocks).
 */
export async function beginMemoryForget(
  params: BeginMemoryForgetParams,
): Promise<TransitionCatalogLifecycleResult> {
  const catalog = getSharedDataGovernanceCatalog({ stateDir: params.stateDir });
  const existing = await catalog.get(params.resourceId);
  if (!existing) {
    return { ok: false, conflict: "not_found" };
  }
  const wrongType = assertMemoryResource(existing);
  if (wrongType) {
    return { ok: false, conflict: wrongType, message: "not_memory_resource" };
  }
  if (isLegalHoldActive(existing.envelope)) {
    return { ok: false, conflict: "legal_hold_blocks" };
  }

  return transitionCatalogLifecycleCommand({
    resourceId: params.resourceId,
    command: "forget",
    expectedStates: ["active"],
    expectedGovernanceVersion: params.expectedGovernanceVersion,
    operationId: params.operationId,
    requestedBy: params.requestedBy,
    stateDir: params.stateDir,
    deletionScope: params.deletionScope,
  });
}

/**
 * Fail path — clear active forget op.
 */
export async function abortMemoryForget(
  params: AbortMemoryForgetParams,
): Promise<MemoryForgetResult> {
  const catalog = getSharedDataGovernanceCatalog({ stateDir: params.stateDir });
  const existing = await catalog.get(params.resourceId);
  if (!existing) {
    return { ok: false, conflict: "not_found" };
  }
  if (existing.envelope.governanceVersion !== params.expectedGovernanceVersion) {
    return { ok: false, conflict: "version_conflict" };
  }
  const wrongType = assertMemoryResource(existing);
  if (wrongType) {
    return { ok: false, conflict: wrongType, message: "not_memory_resource" };
  }

  const active = existing.envelope.activeLifecycleOperation;
  if (!active || active.operationId !== params.operationId || active.command !== "forget") {
    return { ok: false, conflict: "active_operation_mismatch" };
  }

  const outcome = params.outcome ?? "recovery_required";
  const nextState: LifecycleState =
    outcome === "keep_prior" ? active.previousLifecycleState : "recovery_required";

  const now = new Date().toISOString();
  const next: CatalogRecord = {
    envelope: {
      ...existing.envelope,
      lifecycleState: nextState,
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

  if (params.executedBy) {
    await appendLifecycleReceiptStage({
      operationId: params.operationId,
      executedBy: params.executedBy,
      stateDir: params.stateDir,
      stage: {
        stage: "abort",
        status: "failed",
        attemptId: randomUUID(),
        attempt: 1,
        actor: params.executedBy,
        targetBindingIds: [],
        completedAt: now,
        errorCode: params.reason.slice(0, 200),
      },
    });
  }

  const finalized = await finalizeLifecycleReceipt({
    operationId: params.operationId,
    status: "failed",
    stateDir: params.stateDir,
  });

  if (outcome === "recovery_required") {
    writeGovernanceRecoveryReceipt({
      operationId: params.operationId,
      stage: "memory_forget_two_phase_abort",
      reason: params.reason,
      resourceIds: [params.resourceId],
      haltCompensation: false,
      stateDir: params.stateDir,
    });
  }

  return {
    ok: true,
    record: put.record,
    receipt: finalized,
    governanceVersion: put.record.envelope.governanceVersion,
  };
}

async function abortMemoryForgetRefreshingVersion(
  params: AbortMemoryForgetParams,
): Promise<MemoryForgetResult> {
  const catalog = getSharedDataGovernanceCatalog({ stateDir: params.stateDir });
  let expected = params.expectedGovernanceVersion;
  for (let attempt = 0; attempt < CAS_RETRY_LIMIT; attempt += 1) {
    const aborted = await abortMemoryForget({
      ...params,
      expectedGovernanceVersion: expected,
    });
    if (aborted.ok || aborted.conflict !== "version_conflict") {
      return aborted;
    }
    const latest = await catalog.get(params.resourceId);
    if (!latest || latest.envelope.activeLifecycleOperation?.operationId !== params.operationId) {
      return aborted;
    }
    expected = latest.envelope.governanceVersion;
  }
  return {
    ok: false,
    conflict: "version_conflict",
    message: "abort_version_conflict_exhausted",
  };
}

/**
 * CAS to purged; retry only on whitelist-compatible latest without legal hold.
 */
async function casPurgedWithActiveOpRetry(params: {
  resourceId: string;
  operationId: string;
  base: CatalogRecord;
  expectedGovernanceVersion: number;
  domainSnapshot: DomainVerificationSnapshot;
  stateDir?: string;
}): Promise<
  | { ok: true; record: CatalogRecord }
  | { ok: false; conflict: LifecycleTransitionConflict; message?: string }
> {
  const catalog = getSharedDataGovernanceCatalog({ stateDir: params.stateDir });
  let expected = params.expectedGovernanceVersion;
  let base = params.base;

  for (let attempt = 0; attempt < CAS_RETRY_LIMIT; attempt += 1) {
    if (isLegalHoldActive(base.envelope)) {
      return { ok: false, conflict: "legal_hold_blocks", message: "hold_blocks_purged_cas" };
    }
    const now = new Date().toISOString();
    const next: CatalogRecord = {
      envelope: {
        ...params.base.envelope,
        legalHold: base.envelope.legalHold,
        lifecycleState: "purged",
        activeLifecycleOperation: null,
        governanceVersion: expected + 1,
        updatedAt: now,
      },
      bindings: params.base.bindings,
    };
    const put = await compareAndPutRecord({
      resourceId: params.resourceId,
      expectedGovernanceVersion: expected,
      next,
      stateDir: params.stateDir,
    });
    if (put.ok) {
      return put;
    }
    if (put.conflict !== "version_conflict") {
      return put;
    }
    const latest = await catalog.get(params.resourceId);
    if (!latest || latest.envelope.activeLifecycleOperation?.operationId !== params.operationId) {
      return put;
    }
    if (isLegalHoldActive(latest.envelope)) {
      return { ok: false, conflict: "legal_hold_blocks", message: "hold_after_domain" };
    }
    const compat = isDomainSnapshotCompatibleWithLatest({
      snapshot: params.domainSnapshot,
      latest,
    });
    if (!compat.ok) {
      return {
        ok: false,
        conflict: "command_not_allowed",
        message: `domain_snapshot_mismatch:${compat.reason}`,
      };
    }
    expected = latest.envelope.governanceVersion;
    base = latest;
  }
  return { ok: false, conflict: "version_conflict" };
}

async function compensateThenAbort(params: {
  compensateHandle: MemoryDomainCompensateHandle | null;
  resourceId: string;
  operationId: string;
  expectedGovernanceVersion: number;
  reason: string;
  conflict: LifecycleTransitionConflict;
  successMessage: string;
  executedBy?: ActorRef;
  stateDir?: string;
}): Promise<MemoryForgetResult> {
  try {
    await params.compensateHandle?.compensate(params.reason);
  } catch {
    // best-effort; abort still runs
  }
  const catalog = getSharedDataGovernanceCatalog({ stateDir: params.stateDir });
  const latest = await catalog.get(params.resourceId);
  if (latest && latest.envelope.activeLifecycleOperation?.operationId === params.operationId) {
    const forced = await abortMemoryForgetRefreshingVersion({
      resourceId: params.resourceId,
      operationId: params.operationId,
      expectedGovernanceVersion: latest.envelope.governanceVersion,
      reason: params.reason,
      executedBy: params.executedBy,
      stateDir: params.stateDir,
      outcome: "recovery_required",
    });
    if (forced.ok) {
      return {
        ok: false,
        conflict: params.conflict,
        message: params.successMessage,
        record: forced.record,
        receipt: forced.receipt,
      };
    }
    return {
      ok: false,
      conflict: forced.conflict === "domain_failed" ? params.conflict : forced.conflict,
      message: forced.message ?? "domain_ok_catalog_cas_failed_abort_failed",
      record: forced.record ?? latest,
      receipt: forced.receipt,
    };
  }
  try {
    await finalizeLifecycleReceipt({
      operationId: params.operationId,
      status: "failed",
      stateDir: params.stateDir,
    });
  } catch {
    // best-effort
  }
  return {
    ok: false,
    conflict: params.conflict,
    message: params.reason,
    record: latest ?? undefined,
  };
}

/**
 * Phase 2–3 — domain forget first, then CAS to purged.
 */
export async function completeMemoryForget(
  params: CompleteMemoryForgetParams,
): Promise<MemoryForgetResult> {
  const catalog = getSharedDataGovernanceCatalog({ stateDir: params.stateDir });
  const existing = await catalog.get(params.resourceId);
  if (!existing) {
    return { ok: false, conflict: "not_found" };
  }
  if (existing.envelope.governanceVersion !== params.expectedGovernanceVersion) {
    return { ok: false, conflict: "version_conflict" };
  }
  const wrongType = assertMemoryResource(existing);
  if (wrongType) {
    return { ok: false, conflict: wrongType, message: "not_memory_resource" };
  }
  if (isLegalHoldActive(existing.envelope)) {
    return { ok: false, conflict: "legal_hold_blocks" };
  }

  const active = existing.envelope.activeLifecycleOperation;
  if (!active || active.operationId !== params.operationId || active.command !== "forget") {
    return { ok: false, conflict: "active_operation_mismatch" };
  }

  const receipt = getLifecycleReceipt({
    operationId: params.operationId,
    stateDir: params.stateDir,
  });
  if (!receipt || receipt.status !== "open") {
    return { ok: false, conflict: "command_not_allowed", message: "receipt_not_open" };
  }
  if (receipt.resourceId !== params.resourceId || receipt.command !== "forget") {
    return { ok: false, conflict: "command_not_allowed", message: "receipt_mismatch" };
  }

  const attemptId = randomUUID();
  const stageStarted = new Date().toISOString();
  const canonicalIds = existing.bindings
    .filter((b) => b.role === "canonical")
    .map((b) => b.bindingId);

  await appendLifecycleReceiptStage({
    operationId: params.operationId,
    executedBy: params.executedBy,
    stateDir: params.stateDir,
    stage: {
      stage: "domain_forget",
      status: "running",
      attemptId,
      attempt: 1,
      actor: params.executedBy,
      targetBindingIds: canonicalIds,
      startedAt: stageStarted,
    },
  });

  let compensateHandle: MemoryDomainCompensateHandle | null = null;
  try {
    const domainResult = await params.runDomainForget();
    if (isCompensateHandle(domainResult)) {
      compensateHandle = domainResult;
    }
  } catch (err) {
    await appendLifecycleReceiptStage({
      operationId: params.operationId,
      executedBy: params.executedBy,
      stateDir: params.stateDir,
      stage: {
        stage: "domain_forget",
        status: "failed",
        attemptId,
        attempt: 1,
        actor: params.executedBy,
        targetBindingIds: [],
        startedAt: stageStarted,
        completedAt: new Date().toISOString(),
        errorCode: String((err as Error)?.message ?? err).slice(0, 200),
      },
    });
    const aborted = await abortMemoryForgetRefreshingVersion({
      resourceId: params.resourceId,
      operationId: params.operationId,
      expectedGovernanceVersion: params.expectedGovernanceVersion,
      reason: String((err as Error)?.message ?? err),
      executedBy: params.executedBy,
      stateDir: params.stateDir,
      outcome: params.onDomainFailure ?? "recovery_required",
    });
    if (aborted.ok) {
      return {
        ok: false,
        conflict: "domain_failed",
        message: String((err as Error)?.message ?? err),
        record: aborted.record,
        receipt: aborted.receipt,
      };
    }
    return {
      ok: false,
      conflict: aborted.conflict === "domain_failed" ? "command_not_allowed" : aborted.conflict,
      message: aborted.message ?? String((err as Error)?.message ?? err),
      record: aborted.record,
      receipt: aborted.receipt,
    };
  }

  await appendLifecycleReceiptStage({
    operationId: params.operationId,
    executedBy: params.executedBy,
    stateDir: params.stateDir,
    stage: {
      stage: "domain_forget",
      status: "succeeded",
      attemptId,
      attempt: 1,
      actor: params.executedBy,
      targetBindingIds: canonicalIds,
      startedAt: stageStarted,
      completedAt: new Date().toISOString(),
    },
  });

  const domainSnapshot = captureDomainVerificationSnapshot(existing);

  const put = await casPurgedWithActiveOpRetry({
    resourceId: params.resourceId,
    operationId: params.operationId,
    base: existing,
    expectedGovernanceVersion: params.expectedGovernanceVersion,
    domainSnapshot,
    stateDir: params.stateDir,
  });

  if (!put.ok) {
    const snapshotMismatch = put.message?.startsWith("domain_snapshot_mismatch") === true;
    const holdBlocked = put.conflict === "legal_hold_blocks";
    const reason = snapshotMismatch
      ? put.message!
      : holdBlocked
        ? "legal_hold_blocks_after_domain"
        : `catalog_cas_${put.conflict}_after_domain`;
    const successMessage = snapshotMismatch
      ? "domain_ok_snapshot_mismatch_recovery_required"
      : holdBlocked
        ? "hold_after_domain"
        : "domain_ok_catalog_cas_failed_recovery_required";
    return compensateThenAbort({
      compensateHandle,
      resourceId: params.resourceId,
      operationId: params.operationId,
      expectedGovernanceVersion: params.expectedGovernanceVersion,
      reason,
      conflict: put.conflict,
      successMessage,
      executedBy: params.executedBy,
      stateDir: params.stateDir,
    });
  }

  const finalized = await finalizeLifecycleReceipt({
    operationId: params.operationId,
    status: "completed",
    stateDir: params.stateDir,
  });
  try {
    await compensateHandle?.commit?.();
  } catch {
    // Leftover staging after purged is safe cleanup on restart.
  }
  return {
    ok: true,
    record: put.record,
    receipt: finalized,
    governanceVersion: put.record.envelope.governanceVersion,
  };
}

/** Convenience: begin + domain + CAS purged. */
export async function runMemoryForgetTwoPhase(params: {
  resourceId: string;
  operationId: string;
  expectedGovernanceVersion: number;
  requestedBy: ActorRef;
  runDomainForget: () => Promise<void | MemoryDomainCompensateHandle>;
  executedBy?: ActorRef;
  stateDir?: string;
  deletionScope?: string;
  onDomainFailure?: "recovery_required" | "keep_prior";
}): Promise<MemoryForgetResult> {
  const begun = await beginMemoryForget({
    resourceId: params.resourceId,
    operationId: params.operationId,
    expectedGovernanceVersion: params.expectedGovernanceVersion,
    requestedBy: params.requestedBy,
    stateDir: params.stateDir,
    deletionScope: params.deletionScope,
  });
  if (!begun.ok) {
    return begun;
  }
  return completeMemoryForget({
    resourceId: params.resourceId,
    operationId: params.operationId,
    expectedGovernanceVersion: begun.governanceVersion,
    runDomainForget: params.runDomainForget,
    executedBy: params.executedBy ?? params.requestedBy,
    stateDir: params.stateDir,
    onDomainFailure: params.onDomainFailure,
  });
}
