/**
 * P2-b conversation_archive two-phase bridge (Gate A5).
 *
 * Forbidden: Catalog → archived/active before domain verified.
 * Phase 1: open long-running command (receipt + active op; business lifecycle unchanged).
 * Phase 2: domain verify (caller-supplied; may return compensate handle).
 * Phase 3: CAS to target lifecycle; clear active op; finalize receipt.
 * Fail: prior lifecycle or recovery_required + reconcile.
 *
 * Hold race (P2-b CR): if applyLegalHold bumps governanceVersion while the same
 * archive/restore active op remains, retry CAS on latest version (preserve hold)
 * or abort to recovery_required — never leave failed receipt + stuck active op.
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
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
  LongRunningLifecycleCommand,
} from "./types.js";

export type TwoPhaseCommand = Extract<LongRunningLifecycleCommand, "archive" | "restore">;

/** Returned by domain verify after successful materialize — coordinator calls on Catalog CAS loss. */
export type ConversationDomainCompensateHandle = {
  compensate: (reason: string) => Promise<void>;
};

export type BeginConversationTwoPhaseParams = {
  resourceId: string;
  command: TwoPhaseCommand;
  operationId: string;
  expectedGovernanceVersion: number;
  requestedBy: ActorRef;
  stateDir?: string;
};

export type CompleteConversationTwoPhaseParams = {
  resourceId: string;
  operationId: string;
  expectedGovernanceVersion: number;
  /**
   * Must succeed before any Catalog target-state CAS.
   * May return a compensate handle for automatic FS rollback if Catalog CAS later fails.
   */
  verifyDomain: () => Promise<void | ConversationDomainCompensateHandle>;
  executedBy?: ActorRef;
  stateDir?: string;
  /**
   * On domain failure: CAS to recovery_required (default) or restore previousLifecycleState.
   */
  onDomainFailure?: "recovery_required" | "keep_prior";
};

export type AbortConversationTwoPhaseParams = {
  resourceId: string;
  operationId: string;
  expectedGovernanceVersion: number;
  reason: string;
  executedBy?: ActorRef;
  stateDir?: string;
  outcome?: "recovery_required" | "keep_prior";
};

export type ConversationTwoPhaseResult =
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

const TARGET_BY_COMMAND: Record<TwoPhaseCommand, LifecycleState> = {
  archive: "archived",
  restore: "active",
};

const OPEN_FROM: Record<TwoPhaseCommand, LifecycleState[]> = {
  archive: ["active"],
  restore: ["archived"],
};

const CAS_RETRY_LIMIT = 3;

/**
 * Only these envelope fields may change between domain verify and CAS retry.
 * Everything else (lifecycleState, projection, createdAt, schemaVersion, …) is frozen.
 */
const DOMAIN_RETRY_ENVELOPE_WHITELIST = new Set(["legalHold", "governanceVersion", "updatedAt"]);

/** Frozen identity of the Catalog record domain verified against (Gate A5 TOCTOU). */
export type DomainVerificationSnapshot = {
  /** Envelope fingerprint with whitelist fields stripped. */
  envelopeFingerprint: string;
  /** Full bindings set as verified (order-insensitive by bindingId). */
  bindingsFingerprint: string;
  active: {
    operationId: string;
    command: string;
    receiptId: string;
  };
};

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

function fingerprintBindings(bindings: CatalogRecord["bindings"]): string {
  const rows = bindings
    .map((b) => ({
      bindingId: b.bindingId,
      resourceId: b.resourceId,
      role: b.role,
      storageKind: b.storageKind,
      locator: path.resolve(b.locator),
      objectKey: b.objectKey ?? null,
      state: b.state,
      contentVersion: b.contentVersion,
    }))
    .toSorted((a, b) => a.bindingId.localeCompare(b.bindingId));
  return stableJson(rows);
}

/** Strip retry-whitelist keys; fingerprint the remainder (incl. lifecycleState/projection/createdAt). */
export function fingerprintEnvelopeExcludingRetryWhitelist(
  envelope: CatalogRecord["envelope"],
): string {
  const frozen: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(envelope)) {
    if (DOMAIN_RETRY_ENVELOPE_WHITELIST.has(key)) {
      continue;
    }
    if (key === "activeLifecycleOperation" && value && typeof value === "object") {
      const active = value as CatalogRecord["envelope"]["activeLifecycleOperation"];
      // Freeze active identity + previousLifecycleState/startedAt (non-whitelist).
      frozen[key] = active
        ? {
            operationId: active.operationId,
            command: active.command,
            receiptId: active.receiptId,
            previousLifecycleState: active.previousLifecycleState,
            startedAt: active.startedAt,
          }
        : null;
      continue;
    }
    frozen[key] = value;
  }
  return stableJson(
    Object.keys(frozen)
      .toSorted()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = frozen[key];
        return acc;
      }, {}),
  );
}

export function captureDomainVerificationSnapshot(
  record: CatalogRecord,
): DomainVerificationSnapshot {
  const env = record.envelope;
  const active = env.activeLifecycleOperation;
  if (!active) {
    throw new Error("domain_snapshot_missing_active_op");
  }
  const canonical =
    record.bindings.find((b) => b.bindingId === env.canonicalBindingId) ??
    record.bindings.find((b) => b.role === "canonical");
  if (!canonical) {
    throw new Error("domain_snapshot_missing_canonical");
  }
  return {
    envelopeFingerprint: fingerprintEnvelopeExcludingRetryWhitelist(env),
    bindingsFingerprint: fingerprintBindings(record.bindings),
    active: {
      operationId: active.operationId,
      command: active.command,
      receiptId: active.receiptId,
    },
  };
}

/**
 * Latest may only differ in legalHold / governanceVersion / updatedAt.
 * All other envelope fields (lifecycleState, projection, createdAt, …) + bindings
 * + active op identity must match the domain verification snapshot.
 */
export function isDomainSnapshotCompatibleWithLatest(params: {
  snapshot: DomainVerificationSnapshot;
  latest: CatalogRecord;
}): { ok: true } | { ok: false; reason: string } {
  const { snapshot, latest } = params;
  const env = latest.envelope;
  const active = env.activeLifecycleOperation;
  if (!active) {
    return { ok: false, reason: "active_missing" };
  }
  if (active.operationId !== snapshot.active.operationId) {
    return { ok: false, reason: "active.operationId" };
  }
  if (active.command !== snapshot.active.command) {
    return { ok: false, reason: "active.command" };
  }
  if (active.receiptId !== snapshot.active.receiptId) {
    return { ok: false, reason: "active.receiptId" };
  }
  if (fingerprintEnvelopeExcludingRetryWhitelist(env) !== snapshot.envelopeFingerprint) {
    return { ok: false, reason: "envelope_non_whitelist" };
  }
  if (fingerprintBindings(latest.bindings) !== snapshot.bindingsFingerprint) {
    return { ok: false, reason: "bindings" };
  }
  return { ok: true };
}

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

function isCompensateHandle(
  value: void | ConversationDomainCompensateHandle,
): value is ConversationDomainCompensateHandle {
  return Boolean(value && typeof value === "object" && typeof value.compensate === "function");
}

/**
 * Abort using latest Catalog version while the same active op remains (hold race safe).
 */
async function abortConversationTwoPhaseRefreshingVersion(
  params: AbortConversationTwoPhaseParams,
): Promise<ConversationTwoPhaseResult> {
  const catalog = getSharedDataGovernanceCatalog({ stateDir: params.stateDir });
  let expected = params.expectedGovernanceVersion;
  for (let attempt = 0; attempt < CAS_RETRY_LIMIT; attempt += 1) {
    const aborted = await abortConversationTwoPhase({
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
 * CAS target lifecycle; on version_conflict with same active op, retry only when
 * latest matches the domain verification snapshot (hold-only whitelist).
 * Non-whitelist drift → fail closed (no archived/active retry).
 */
async function casTargetLifecycleWithActiveOpRetry(params: {
  resourceId: string;
  operationId: string;
  command: TwoPhaseCommand;
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
  const targetLifecycleState = TARGET_BY_COMMAND[params.command];

  for (let attempt = 0; attempt < CAS_RETRY_LIMIT; attempt += 1) {
    const now = new Date().toISOString();
    // Identity/bindings from domain snapshot base; legalHold from latest-compatible envelope.
    const next: CatalogRecord = {
      envelope: {
        ...params.base.envelope,
        legalHold: base.envelope.legalHold,
        lifecycleState: targetLifecycleState,
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
    // Hold-only (or other whitelist) version bump — retry with latest hold/version.
    expected = latest.envelope.governanceVersion;
    base = latest;
  }
  return { ok: false, conflict: "version_conflict" };
}

/**
 * Phase 1 — open archive/restore: active op set, business lifecycle unchanged.
 */
export async function beginConversationTwoPhase(
  params: BeginConversationTwoPhaseParams,
): Promise<TransitionCatalogLifecycleResult> {
  return transitionCatalogLifecycleCommand({
    resourceId: params.resourceId,
    command: params.command,
    expectedStates: OPEN_FROM[params.command],
    expectedGovernanceVersion: params.expectedGovernanceVersion,
    operationId: params.operationId,
    requestedBy: params.requestedBy,
    stateDir: params.stateDir,
  });
}

/**
 * Phase 2–3 — domain verify first, then CAS target lifecycle + clear active op.
 */
export async function completeConversationTwoPhase(
  params: CompleteConversationTwoPhaseParams,
): Promise<ConversationTwoPhaseResult> {
  const catalog = getSharedDataGovernanceCatalog({ stateDir: params.stateDir });
  const existing = await catalog.get(params.resourceId);
  if (!existing) {
    return { ok: false, conflict: "not_found" };
  }
  if (existing.envelope.governanceVersion !== params.expectedGovernanceVersion) {
    return { ok: false, conflict: "version_conflict" };
  }

  const active = existing.envelope.activeLifecycleOperation;
  if (!active || active.operationId !== params.operationId) {
    return { ok: false, conflict: "active_operation_mismatch" };
  }
  if (active.command !== "archive" && active.command !== "restore") {
    return { ok: false, conflict: "command_not_allowed", message: "not_archive_or_restore" };
  }

  const receipt = getLifecycleReceipt({
    operationId: params.operationId,
    stateDir: params.stateDir,
  });
  if (!receipt || receipt.status !== "open") {
    return { ok: false, conflict: "command_not_allowed", message: "receipt_not_open" };
  }
  if (receipt.resourceId !== params.resourceId) {
    return { ok: false, conflict: "command_not_allowed", message: "receipt_resource_mismatch" };
  }

  const attemptId = randomUUID();
  const stageStarted = new Date().toISOString();
  await appendLifecycleReceiptStage({
    operationId: params.operationId,
    executedBy: params.executedBy,
    stateDir: params.stateDir,
    stage: {
      stage: "domain_verify",
      status: "running",
      attemptId,
      attempt: 1,
      actor: params.executedBy,
      targetBindingIds: existing.bindings
        .filter((b) => b.role === "canonical")
        .map((b) => b.bindingId),
      startedAt: stageStarted,
    },
  });

  let compensateHandle: ConversationDomainCompensateHandle | null = null;
  try {
    const domainResult = await params.verifyDomain();
    if (isCompensateHandle(domainResult)) {
      compensateHandle = domainResult;
    }
  } catch (err) {
    await appendLifecycleReceiptStage({
      operationId: params.operationId,
      executedBy: params.executedBy,
      stateDir: params.stateDir,
      stage: {
        stage: "domain_verify",
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
    const aborted = await abortConversationTwoPhaseRefreshingVersion({
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
      stage: "domain_verify",
      status: "succeeded",
      attemptId,
      attempt: 1,
      actor: params.executedBy,
      targetBindingIds: existing.bindings
        .filter((b) => b.role === "canonical")
        .map((b) => b.bindingId),
      startedAt: stageStarted,
      completedAt: new Date().toISOString(),
    },
  });

  // Snapshot the Catalog identity domain verified against (pre-CAS). Hold may
  // race afterward; non-whitelist field drift must not retry to archived/active.
  const domainSnapshot = captureDomainVerificationSnapshot(existing);

  const put = await casTargetLifecycleWithActiveOpRetry({
    resourceId: params.resourceId,
    operationId: params.operationId,
    command: active.command,
    base: existing,
    expectedGovernanceVersion: params.expectedGovernanceVersion,
    domainSnapshot,
    stateDir: params.stateDir,
  });

  if (!put.ok) {
    const reason = put.message?.startsWith("domain_snapshot_mismatch")
      ? put.message
      : `catalog_cas_${put.conflict}_after_domain`;
    try {
      await compensateHandle?.compensate(reason);
    } catch {
      // best-effort; abort still runs
    }

    const latest = await catalog.get(params.resourceId);
    if (latest && latest.envelope.activeLifecycleOperation?.operationId === params.operationId) {
      const forced = await abortConversationTwoPhaseRefreshingVersion({
        resourceId: params.resourceId,
        operationId: params.operationId,
        expectedGovernanceVersion: latest.envelope.governanceVersion,
        reason,
        executedBy: params.executedBy,
        stateDir: params.stateDir,
        outcome: "recovery_required",
      });
      if (forced.ok) {
        return {
          ok: false,
          conflict: put.conflict,
          message: put.message?.startsWith("domain_snapshot_mismatch")
            ? "domain_ok_snapshot_mismatch_recovery_required"
            : "domain_ok_catalog_cas_failed_recovery_required",
          record: forced.record,
          receipt: forced.receipt,
        };
      }
      return {
        ok: false,
        conflict: forced.conflict === "domain_failed" ? put.conflict : forced.conflict,
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
      conflict: put.conflict,
      message: put.message ?? "domain_ok_catalog_cas_failed",
      record: latest ?? undefined,
    };
  }

  const finalized = await finalizeLifecycleReceipt({
    operationId: params.operationId,
    status: "completed",
    stateDir: params.stateDir,
  });
  return {
    ok: true,
    record: put.record,
    receipt: finalized,
    governanceVersion: put.record.envelope.governanceVersion,
  };
}

/**
 * Fail path — clear active op; set recovery_required or restore previousLifecycleState.
 */
export async function abortConversationTwoPhase(
  params: AbortConversationTwoPhaseParams,
): Promise<ConversationTwoPhaseResult> {
  const catalog = getSharedDataGovernanceCatalog({ stateDir: params.stateDir });
  const existing = await catalog.get(params.resourceId);
  if (!existing) {
    return { ok: false, conflict: "not_found" };
  }
  if (existing.envelope.governanceVersion !== params.expectedGovernanceVersion) {
    return { ok: false, conflict: "version_conflict" };
  }

  const active = existing.envelope.activeLifecycleOperation;
  if (!active || active.operationId !== params.operationId) {
    return { ok: false, conflict: "active_operation_mismatch" };
  }
  if (active.command !== "archive" && active.command !== "restore") {
    return { ok: false, conflict: "command_not_allowed", message: "not_archive_or_restore" };
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
      stage: "conversation_two_phase_abort",
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

/** Convenience: begin archive then complete with domain verify. */
export async function runConversationArchiveTwoPhase(params: {
  resourceId: string;
  operationId: string;
  expectedGovernanceVersion: number;
  requestedBy: ActorRef;
  verifyDomain: () => Promise<void | ConversationDomainCompensateHandle>;
  executedBy?: ActorRef;
  stateDir?: string;
  onDomainFailure?: "recovery_required" | "keep_prior";
}): Promise<ConversationTwoPhaseResult> {
  const begun = await beginConversationTwoPhase({
    resourceId: params.resourceId,
    command: "archive",
    operationId: params.operationId,
    expectedGovernanceVersion: params.expectedGovernanceVersion,
    requestedBy: params.requestedBy,
    stateDir: params.stateDir,
  });
  if (!begun.ok) {
    return begun;
  }
  return completeConversationTwoPhase({
    resourceId: params.resourceId,
    operationId: params.operationId,
    expectedGovernanceVersion: begun.governanceVersion,
    verifyDomain: params.verifyDomain,
    executedBy: params.executedBy ?? params.requestedBy,
    stateDir: params.stateDir,
    onDomainFailure: params.onDomainFailure,
  });
}

/** Convenience: begin restore then complete with domain verify. */
export async function runConversationRestoreTwoPhase(params: {
  resourceId: string;
  operationId: string;
  expectedGovernanceVersion: number;
  requestedBy: ActorRef;
  verifyDomain: () => Promise<void | ConversationDomainCompensateHandle>;
  executedBy?: ActorRef;
  stateDir?: string;
  onDomainFailure?: "recovery_required" | "keep_prior";
}): Promise<ConversationTwoPhaseResult> {
  const begun = await beginConversationTwoPhase({
    resourceId: params.resourceId,
    command: "restore",
    operationId: params.operationId,
    expectedGovernanceVersion: params.expectedGovernanceVersion,
    requestedBy: params.requestedBy,
    stateDir: params.stateDir,
  });
  if (!begun.ok) {
    return begun;
  }
  return completeConversationTwoPhase({
    resourceId: params.resourceId,
    operationId: params.operationId,
    expectedGovernanceVersion: begun.governanceVersion,
    verifyDomain: params.verifyDomain,
    executedBy: params.executedBy ?? params.requestedBy,
    stateDir: params.stateDir,
    onDomainFailure: params.onDomainFailure,
  });
}

/**
 * Default domain verify for conversation_archive: canonical locator must exist on disk.
 * Callers that copy/move should finish domain work first, then call this (or pass a custom verify).
 */
export async function verifyConversationCanonicalLocator(params: {
  resourceId: string;
  stateDir?: string;
}): Promise<void> {
  const catalog = getSharedDataGovernanceCatalog({ stateDir: params.stateDir });
  const record = await catalog.get(params.resourceId);
  if (!record) {
    throw new Error("domain_catalog_missing");
  }
  if (record.envelope.resourceType !== "conversation_archive") {
    throw new Error("domain_wrong_resource_type");
  }
  const canonical =
    record.bindings.find((b) => b.bindingId === record.envelope.canonicalBindingId) ??
    record.bindings.find((b) => b.role === "canonical");
  if (!canonical?.locator) {
    throw new Error("domain_canonical_binding_missing");
  }
  const locator = path.resolve(canonical.locator);
  if (!fs.existsSync(locator)) {
    throw new Error("domain_canonical_locator_missing");
  }
  const st = fs.statSync(locator);
  if (!st.isFile() && !st.isDirectory()) {
    throw new Error("domain_canonical_locator_not_file_or_dir");
  }
}
