/**
 * P2-c memory forget domain adapter — markdown_root / filesystem only.
 *
 * Durable order: staging payload+meta (fsync/rename) → unlinkFileDurable
 * (unlink + parent dir fsync) → Catalog CAS to purged → cleanup staging
 * (rm + staging-root fsync). Dir fsync failure fails closed.
 * CogniWeave sqlite / object-store / other canonical kinds fail closed;
 * they need a dedicated adapter and must not report generic Memory Forget done.
 *
 * Subsequent writer at the locator: compensate does not overwrite.
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import {
  cleanupMemoryForgetStaging,
  fingerprintBytes,
  loadMemoryForgetStaging,
  unlinkFileDurable,
  writeFileDurableSync,
  writeMemoryForgetStaging,
  type MemoryForgetStagingRecord,
} from "./lifecycle-memory-staging.js";
import {
  abortMemoryForget,
  runMemoryForgetTwoPhase,
  type MemoryDomainCompensateHandle,
  type MemoryForgetResult,
} from "./lifecycle-memory.js";
import { writeGovernanceRecoveryReceipt } from "./recovery-receipt.js";
import { getSharedDataGovernanceCatalog } from "./runtime-catalog.js";
import type { ActorRef, CatalogRecord, StorageBinding } from "./types.js";

export type MemoryForgetDomainPlan = {
  resourceId: string;
  operationId: string;
  stateDir?: string;
};

export type MemoryForgetDomainResult = {
  locator: string;
  deleted: boolean;
  contentFingerprint: string | null;
  snapshotBytes: Buffer | null;
  mode?: number;
  staging?: MemoryForgetStagingRecord;
};

function canonicalBindingOf(record: CatalogRecord): StorageBinding | undefined {
  return (
    record.bindings.find((b) => b.bindingId === record.envelope.canonicalBindingId) ??
    record.bindings.find((b) => b.role === "canonical")
  );
}

/**
 * This adapter implements markdown_root + filesystem files only.
 * sqlite / object-store / cogniweave must fail closed to a dedicated adapter.
 */
export function assertMarkdownRootFilesystemForgetTarget(record: CatalogRecord): StorageBinding {
  const canonical = canonicalBindingOf(record);
  if (!canonical?.locator) {
    throw new Error("domain_canonical_binding_missing");
  }
  const kind = record.envelope.projection?.canonicalKind;
  if (kind && kind !== "markdown_root") {
    throw new Error(`domain_memory_adapter_unsupported_canonical_kind:${kind}`);
  }
  if (canonical.storageKind !== "filesystem") {
    throw new Error(`domain_memory_adapter_unsupported_storage_kind:${canonical.storageKind}`);
  }
  return canonical;
}

async function assertActiveForgetOp(params: MemoryForgetDomainPlan): Promise<{
  record: CatalogRecord;
  canonical: StorageBinding;
  locator: string;
}> {
  const catalog = getSharedDataGovernanceCatalog({ stateDir: params.stateDir });
  const record = await catalog.get(params.resourceId);
  if (!record) {
    throw new Error("domain_catalog_missing");
  }
  if (record.envelope.resourceType !== "memory") {
    throw new Error("domain_wrong_resource_type");
  }
  const active = record.envelope.activeLifecycleOperation;
  if (!active || active.operationId !== params.operationId || active.command !== "forget") {
    throw new Error("domain_active_operation_mismatch");
  }
  const canonical = assertMarkdownRootFilesystemForgetTarget(record);
  return { record, canonical, locator: path.resolve(canonical.locator) };
}

function resultFromStaging(
  staging: MemoryForgetStagingRecord,
  deleted: boolean,
): MemoryForgetDomainResult {
  return {
    locator: staging.meta.locator,
    deleted,
    contentFingerprint: staging.meta.contentSha256,
    snapshotBytes: staging.payload,
    mode: staging.meta.mode,
    staging,
  };
}

/**
 * Delete canonical memory file after durable staging. Does not touch Catalog.
 * Idempotent: valid staging + missing canonical still fsyncs the canonical
 * parent before reporting deletion succeeded (crash may have unlinked without
 * a durable directory confirmation).
 */
export async function materializeMemoryForgetDomain(
  params: MemoryForgetDomainPlan,
): Promise<MemoryForgetDomainResult> {
  const { canonical, locator } = await assertActiveForgetOp(params);
  const existingStaging = loadMemoryForgetStaging(params);
  const canonicalExists = fs.existsSync(locator);

  if (existingStaging) {
    if (path.resolve(existingStaging.meta.locator) !== locator) {
      throw new Error("domain_staging_locator_mismatch");
    }
    if (existingStaging.meta.bindingId !== canonical.bindingId) {
      throw new Error("domain_staging_binding_mismatch");
    }
    if (!canonicalExists) {
      unlinkFileDurable(locator);
      return resultFromStaging(existingStaging, true);
    }
    const current = await fsp.readFile(locator);
    if (fingerprintBytes(current) !== existingStaging.meta.contentSha256) {
      throw new Error("domain_canonical_diverged_from_staging");
    }
    unlinkFileDurable(locator);
    return resultFromStaging(existingStaging, true);
  }

  if (!canonicalExists) {
    throw new Error("domain_canonical_missing_without_staging");
  }
  const st = fs.statSync(locator);
  if (!st.isFile()) {
    throw new Error("domain_canonical_locator_not_file");
  }
  const snapshotBytes = await fsp.readFile(locator);
  const staging = writeMemoryForgetStaging({
    operationId: params.operationId,
    resourceId: params.resourceId,
    bindingId: canonical.bindingId,
    locator,
    payload: snapshotBytes,
    mode: st.mode & 0o777,
    uid: st.uid,
    gid: st.gid,
    mtimeMs: st.mtimeMs,
    stateDir: params.stateDir,
  });
  unlinkFileDurable(locator);
  return resultFromStaging(staging, true);
}

export type MemoryForgetCompensateResult = {
  compensated: boolean;
  partial?: boolean;
  restored?: boolean;
  recoveryReceiptPath?: string;
};

function resolveCompensateBytes(params: {
  plan: MemoryForgetDomainPlan;
  material?: MemoryForgetDomainResult | null;
}): { bytes: Buffer; locator: string; mode: number } | null {
  const staging = loadMemoryForgetStaging(params.plan);
  if (staging) {
    return {
      bytes: staging.payload,
      locator: path.resolve(staging.meta.locator),
      mode: staging.meta.mode,
    };
  }
  if (params.material?.deleted && params.material.snapshotBytes) {
    return {
      bytes: params.material.snapshotBytes,
      locator: path.resolve(params.material.locator),
      mode: params.material.mode ?? 0o600,
    };
  }
  return null;
}

/**
 * Restore create-owned memory bytes from durable staging (preferred) unless a
 * subsequent writer already recreated the locator.
 */
export async function compensateMemoryForgetDomain(params: {
  plan: MemoryForgetDomainPlan;
  material?: MemoryForgetDomainResult | null;
  reason: string;
}): Promise<MemoryForgetCompensateResult> {
  const source = resolveCompensateBytes(params);
  if (!source) {
    return { compensated: true, restored: false };
  }
  const locator = source.locator;
  try {
    if (fs.existsSync(locator)) {
      const recoveryReceiptPath = writeGovernanceRecoveryReceipt({
        operationId: params.plan.operationId,
        stage: "memory_forget_domain_compensate_skip",
        reason: params.reason,
        resourceIds: [params.plan.resourceId],
        haltCompensation: false,
        stateDir: params.plan.stateDir,
      });
      return {
        compensated: false,
        partial: true,
        restored: false,
        recoveryReceiptPath,
      };
    }
    await fsp.mkdir(path.dirname(locator), { recursive: true });
    writeFileDurableSync(locator, source.bytes, source.mode);
    return { compensated: true, restored: true };
  } catch (err) {
    const recoveryReceiptPath = writeGovernanceRecoveryReceipt({
      operationId: params.plan.operationId,
      stage: "memory_forget_domain_compensate",
      reason: params.reason,
      error: String((err as Error)?.message ?? err).slice(0, 400),
      resourceIds: [params.plan.resourceId],
      haltCompensation: true,
      stateDir: params.plan.stateDir,
    });
    return { compensated: false, recoveryReceiptPath };
  }
}

export function createMemoryForgetDomainVerifier(
  plan: MemoryForgetDomainPlan,
): () => Promise<MemoryDomainCompensateHandle> {
  return async () => {
    const material = await materializeMemoryForgetDomain(plan);
    return {
      compensate: async (reason: string) => {
        await compensateMemoryForgetDomain({
          plan,
          material,
          reason,
        });
      },
      commit: async () => {
        cleanupMemoryForgetStaging({
          operationId: plan.operationId,
          stateDir: plan.stateDir,
        });
      },
    };
  };
}

export async function forgetMemoryWithGovernance(params: {
  plan: MemoryForgetDomainPlan;
  expectedGovernanceVersion: number;
  requestedBy: ActorRef;
  executedBy?: ActorRef;
  onDomainFailure?: "recovery_required" | "keep_prior";
  deletionScope?: string;
}): Promise<MemoryForgetResult> {
  return runMemoryForgetTwoPhase({
    resourceId: params.plan.resourceId,
    operationId: params.plan.operationId,
    expectedGovernanceVersion: params.expectedGovernanceVersion,
    requestedBy: params.requestedBy,
    executedBy: params.executedBy,
    stateDir: params.plan.stateDir,
    onDomainFailure: params.onDomainFailure,
    deletionScope: params.deletionScope,
    runDomainForget: createMemoryForgetDomainVerifier(params.plan),
  });
}

export type RecoverMemoryForgetAfterRestartResult =
  | {
      action: "resume";
      record: CatalogRecord;
      staging: MemoryForgetStagingRecord | null;
      canonicalExists: boolean;
    }
  | {
      action: "recovery_required";
      reason: "canonical_and_staging_missing";
      record: CatalogRecord;
    }
  | {
      action: "cleanup_staging";
      reason: "catalog_purged_staging_leftover";
      record: CatalogRecord;
    }
  | { action: "not_found" }
  | { action: "not_forget"; record: CatalogRecord };

/**
 * Restart recovery for filesystem memory forget.
 *
 * - active forget + staging: resume (restore or continue)
 * - active forget + canonical missing + staging missing: recovery_required (do not guess purged)
 * - Catalog purged + leftover staging: safe cleanup only
 */
export async function recoverMemoryForgetAfterRestart(params: {
  resourceId: string;
  operationId?: string;
  stateDir?: string;
  executedBy?: ActorRef;
}): Promise<RecoverMemoryForgetAfterRestartResult> {
  const catalog = getSharedDataGovernanceCatalog({ stateDir: params.stateDir });
  const record = await catalog.get(params.resourceId);
  if (!record) {
    return { action: "not_found" };
  }

  const active = record.envelope.activeLifecycleOperation;
  const operationId = params.operationId ?? active?.operationId;
  if (record.envelope.lifecycleState === "purged") {
    if (!operationId) {
      return { action: "cleanup_staging", reason: "catalog_purged_staging_leftover", record };
    }
    cleanupMemoryForgetStaging({ operationId, stateDir: params.stateDir });
    return { action: "cleanup_staging", reason: "catalog_purged_staging_leftover", record };
  }

  if (!active || active.command !== "forget") {
    return { action: "not_forget", record };
  }
  if (operationId && active.operationId !== operationId) {
    return { action: "not_forget", record };
  }

  let canonicalExists = false;
  try {
    const canonical = assertMarkdownRootFilesystemForgetTarget(record);
    canonicalExists = fs.existsSync(path.resolve(canonical.locator));
  } catch {
    canonicalExists = false;
  }

  const staging = loadMemoryForgetStaging({
    operationId: active.operationId,
    resourceId: params.resourceId,
    stateDir: params.stateDir,
  });

  if (staging || canonicalExists) {
    return { action: "resume", record, staging, canonicalExists };
  }

  const aborted = await abortMemoryForget({
    resourceId: params.resourceId,
    operationId: active.operationId,
    expectedGovernanceVersion: record.envelope.governanceVersion,
    reason: "canonical_and_staging_missing",
    executedBy: params.executedBy,
    stateDir: params.stateDir,
    outcome: "recovery_required",
  });
  const latest =
    aborted.ok || aborted.record
      ? (aborted.record ?? (await catalog.get(params.resourceId)) ?? record)
      : record;
  return {
    action: "recovery_required",
    reason: "canonical_and_staging_missing",
    record: latest,
  };
}

/** Restore canonical from staging and abort forget (keep prior lifecycle). */
export async function restoreMemoryForgetAfterRestart(params: {
  plan: MemoryForgetDomainPlan;
  executedBy?: ActorRef;
}): Promise<MemoryForgetResult> {
  const recovered = await recoverMemoryForgetAfterRestart({
    resourceId: params.plan.resourceId,
    operationId: params.plan.operationId,
    stateDir: params.plan.stateDir,
    executedBy: params.executedBy,
  });
  if (recovered.action !== "resume" || !recovered.staging) {
    return {
      ok: false,
      conflict: "command_not_allowed",
      message: recovered.action === "recovery_required" ? recovered.reason : recovered.action,
      record: "record" in recovered ? recovered.record : undefined,
    };
  }
  const compensated = await compensateMemoryForgetDomain({
    plan: params.plan,
    reason: "restart_restore",
  });
  if (compensated.compensated && compensated.restored === true) {
    return abortMemoryForget({
      resourceId: params.plan.resourceId,
      operationId: params.plan.operationId,
      expectedGovernanceVersion: recovered.record.envelope.governanceVersion,
      reason: "restart_restore",
      executedBy: params.executedBy,
      stateDir: params.plan.stateDir,
      outcome: "keep_prior",
    });
  }

  const failureKind = compensated.partial ? "subsequent_writer" : "restore_write_failed";
  const recoveryReceiptPath = writeGovernanceRecoveryReceipt({
    operationId: params.plan.operationId,
    stage: "memory_forget_restart_restore",
    reason: failureKind,
    error: compensated.recoveryReceiptPath,
    resourceIds: [params.plan.resourceId],
    haltCompensation: true,
    stateDir: params.plan.stateDir,
  });
  const aborted = await abortMemoryForget({
    resourceId: params.plan.resourceId,
    operationId: params.plan.operationId,
    expectedGovernanceVersion: recovered.record.envelope.governanceVersion,
    reason: `restart_restore_compensate_failed:${failureKind}`,
    executedBy: params.executedBy,
    stateDir: params.plan.stateDir,
    outcome: "recovery_required",
  });
  if (aborted.ok) {
    return {
      ok: false,
      conflict: "domain_failed",
      message: `restart_restore_compensate_failed:${failureKind}`,
      record: aborted.record,
      receipt: aborted.receipt,
    };
  }
  return {
    ok: false,
    conflict: aborted.conflict === "domain_failed" ? "command_not_allowed" : aborted.conflict,
    message:
      aborted.message ?? `restart_restore_compensate_failed:${failureKind}:${recoveryReceiptPath}`,
    record: aborted.record ?? recovered.record,
    receipt: aborted.receipt,
  };
}
