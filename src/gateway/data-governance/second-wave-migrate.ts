/**
 * P1-2-f second-wave Catalog migration orchestrator.
 * inventory → pending Catalog + canonical → dual-read → single-writer cutover.
 * Secrets stores (OI2/OI6) are never migrated into Catalog.
 */

import path from "node:path";
import { diagnoseDuplicateCanonicals } from "./diagnostics.js";
import {
  activateKnowledgeGovernanceRegistration,
  beginKnowledgeGovernanceRegistration,
  abortKnowledgeGovernanceRegistration,
  buildKnowledgeResourceId,
} from "./knowledge-register.js";
import {
  activateMemoryGovernanceRegistration,
  beginMemoryGovernanceRegistration,
  abortMemoryGovernanceRegistration,
  buildMemoryResourceId,
} from "./memory-register.js";
import {
  activateOperationalIdentityGovernanceRegistration,
  beginOperationalIdentityGovernanceRegistration,
  abortOperationalIdentityGovernanceRegistration,
  buildOperationalIdentityResourceId,
} from "./operational-identity-register.js";
import { writeGovernanceRecoveryReceipt } from "./recovery-receipt.js";
import { getSharedDataGovernanceCatalog } from "./runtime-catalog.js";
import type {
  CatalogRecord,
  DataClassification,
  KnowledgeContentClass,
  MemoryCanonicalKind,
  OwnershipPrincipal,
  ResourceScope,
  SecondWaveResourceType,
} from "./types.js";
import { assertManagedCreateTenant } from "./write-gate.js";

/** Inventory classes that must never enter Catalog (secrets / ephemeral). */
export const SECOND_WAVE_MIGRATION_EXCLUDED = new Set([
  "OI2",
  "OI6",
  "OI7",
  "OI8",
  "M2",
  "M3",
  "M4",
  "M5",
  "K14",
  "K15",
]);

export type SecondWaveMigrationCandidate = {
  classId: string;
  resourceType: SecondWaveResourceType;
  tenantId: string | null;
  owner: OwnershipPrincipal;
  scope: ResourceScope;
  classification?: DataClassification;
  canonicalLocator: string;
  /** Knowledge */
  contentClass?: KnowledgeContentClass;
  docId?: string;
  versionId?: string;
  projectionId?: string;
  kbId?: string | null;
  indexLocator?: string | null;
  /** Memory */
  profile?: "personal_local" | "managed_enterprise";
  canonicalKind?: MemoryCanonicalKind;
  sourceId?: string;
  atomId?: string;
  /** OI */
  identityId?: string;
  provider?: string | null;
  credentialHandleId?: string | null;
  agentAssetId?: string | null;
};

export type MigrationFaultAfter = "register_pending" | "dual_read" | "cutover";

export type SecondWaveMigrationItemResult = {
  classId: string;
  resourceId: string;
  status:
    | "skipped_excluded"
    | "skipped_already_active"
    | "conflict_existing"
    | "planned"
    | "pending"
    | "dual_read_ok"
    | "cutover_active"
    | "rolled_back"
    | "recovery_required"
    | "failed";
  error?: string;
};

export type SecondWaveMigrationReport = {
  operationId: string;
  dryRun: boolean;
  items: SecondWaveMigrationItemResult[];
  dualWriteDetected: boolean;
  duplicateCanonicals: string[];
};

function resolveResourceId(candidate: SecondWaveMigrationCandidate): string {
  if (candidate.resourceType === "knowledge") {
    return buildKnowledgeResourceId({
      tenantId: candidate.tenantId,
      contentClass: candidate.contentClass ?? "document_version",
      docId: candidate.docId,
      versionId: candidate.versionId,
      projectionId: candidate.projectionId,
    });
  }
  if (candidate.resourceType === "memory") {
    if (!candidate.atomId && !candidate.sourceId?.trim()) {
      throw new Error("memory migration candidate requires sourceId or atomId");
    }
    return buildMemoryResourceId({
      tenantId: candidate.tenantId,
      atomId: candidate.atomId,
      // atom-scoped ids ignore sourceId; still required by the builder signature.
      sourceId: candidate.sourceId?.trim() || String(candidate.atomId),
    });
  }
  return buildOperationalIdentityResourceId({
    tenantId: candidate.tenantId,
    identityId: candidate.identityId ?? "",
  });
}

async function registerPending(
  candidate: SecondWaveMigrationCandidate,
  stateDir?: string,
): Promise<string> {
  assertManagedCreateTenant({
    profile: candidate.profile,
    tenantId: candidate.tenantId,
    scopeKind: candidate.scope.kind,
  });

  if (candidate.resourceType === "knowledge") {
    const { resourceId } = await beginKnowledgeGovernanceRegistration({
      stateDir,
      tenantId: candidate.tenantId,
      owner: candidate.owner,
      scope: candidate.scope,
      contentClass: candidate.contentClass ?? "document_version",
      docId: candidate.docId,
      versionId: candidate.versionId,
      projectionId: candidate.projectionId,
      kbId: candidate.kbId,
      canonicalLocator: candidate.canonicalLocator,
      indexLocator: candidate.indexLocator,
    });
    return resourceId;
  }

  if (candidate.resourceType === "memory") {
    const sourceId = candidate.sourceId ?? candidate.atomId;
    if (!sourceId) {
      throw new Error("governance_migration_invalid:memory_sourceId");
    }
    const { resourceId } = await beginMemoryGovernanceRegistration({
      stateDir,
      tenantId: candidate.tenantId,
      owner: candidate.owner,
      scope: candidate.scope,
      profile: candidate.profile ?? "personal_local",
      canonicalKind: candidate.canonicalKind ?? "markdown_root",
      sourceId,
      atomId: candidate.atomId,
      canonicalLocator: candidate.canonicalLocator,
    });
    return resourceId;
  }

  const { resourceId } = await beginOperationalIdentityGovernanceRegistration({
    stateDir,
    tenantId: candidate.tenantId,
    owner: candidate.owner,
    scope: candidate.scope,
    identityId: candidate.identityId ?? "",
    canonicalLocator: candidate.canonicalLocator,
    provider: candidate.provider,
    credentialHandleId: candidate.credentialHandleId,
    agentAssetId: candidate.agentAssetId,
  });
  return resourceId;
}

async function activateResource(
  resourceType: SecondWaveResourceType,
  resourceId: string,
  stateDir?: string,
): Promise<void> {
  if (resourceType === "knowledge") {
    await activateKnowledgeGovernanceRegistration({ resourceId, stateDir });
    return;
  }
  if (resourceType === "memory") {
    await activateMemoryGovernanceRegistration({ resourceId, stateDir });
    return;
  }
  await activateOperationalIdentityGovernanceRegistration({ resourceId, stateDir });
}

async function abortResource(params: {
  resourceType: SecondWaveResourceType;
  resourceId: string;
  operationId: string;
  reason: string;
  stateDir?: string;
  allowedRoots: string[];
}): Promise<void> {
  if (params.resourceType === "knowledge") {
    await abortKnowledgeGovernanceRegistration({
      resourceId: params.resourceId,
      reason: params.reason,
      operationId: params.operationId,
      allowedRoots: params.allowedRoots,
      stateDir: params.stateDir,
      finalizeLifecycle: "recovery_required",
    });
    return;
  }
  if (params.resourceType === "memory") {
    await abortMemoryGovernanceRegistration({
      resourceId: params.resourceId,
      reason: params.reason,
      operationId: params.operationId,
      allowedRoots: params.allowedRoots,
      stateDir: params.stateDir,
      finalizeLifecycle: "recovery_required",
    });
    return;
  }
  await abortOperationalIdentityGovernanceRegistration({
    resourceId: params.resourceId,
    reason: params.reason,
    operationId: params.operationId,
    allowedRoots: params.allowedRoots,
    stateDir: params.stateDir,
    finalizeLifecycle: "recovery_required",
  });
}

/**
 * Dual-read / active-skip equivalence: locator, owner, scope, tenant, classification, projection.
 */
export function assertSecondWaveCandidateMatchesRecord(params: {
  candidate: SecondWaveMigrationCandidate;
  record: CatalogRecord;
}): { ok: true } | { ok: false; error: string } {
  const { candidate, record } = params;
  if (record.envelope.resourceType !== candidate.resourceType) {
    return { ok: false, error: "equiv_type_mismatch" };
  }
  if (record.envelope.tenantId !== candidate.tenantId) {
    return { ok: false, error: "equiv_tenant_mismatch" };
  }
  if (ownerKey(record.envelope.owner) !== ownerKey(candidate.owner)) {
    return { ok: false, error: "equiv_owner_mismatch" };
  }
  if (scopeKey(record.envelope.scope) !== scopeKey(candidate.scope)) {
    return { ok: false, error: "equiv_scope_mismatch" };
  }
  if (
    candidate.classification !== undefined &&
    record.envelope.classification !== candidate.classification
  ) {
    return { ok: false, error: "equiv_classification_mismatch" };
  }
  const canonical = record.bindings.find((b) => b.role === "canonical" && b.state === "active");
  if (!canonical) {
    return { ok: false, error: "equiv_missing_canonical" };
  }
  if (path.resolve(canonical.locator) !== path.resolve(candidate.canonicalLocator)) {
    return { ok: false, error: "equiv_locator_mismatch" };
  }

  const expectedProjection = expectedProjectionFromCandidate(candidate);
  for (const [key, expected] of Object.entries(expectedProjection)) {
    const actual = record.envelope.projection?.[key] ?? null;
    if (actual !== expected) {
      return { ok: false, error: `equiv_projection_mismatch:${key}` };
    }
  }
  return { ok: true };
}

function ownerKey(owner: OwnershipPrincipal): string {
  switch (owner.kind) {
    case "user":
      return `user:${owner.userId}`;
    case "position":
      return `position:${owner.seatId}`;
    case "group":
      return `group:${owner.groupId}`;
    case "system":
      return `system:${owner.systemId}`;
  }
}

function scopeKey(scope: ResourceScope): string {
  switch (scope.kind) {
    case "user":
      return `user:${scope.userId}`;
    case "tenant":
      return `tenant:${scope.tenantId}`;
    case "group":
      return `group:${scope.groupId}`;
    case "system":
      return "system";
  }
}

function expectedProjectionFromCandidate(
  candidate: SecondWaveMigrationCandidate,
): Record<string, string | null> {
  if (candidate.resourceType === "knowledge") {
    return {
      contentClass: candidate.contentClass ?? "document_version",
      kbId: candidate.kbId ?? null,
      docId: candidate.docId ?? null,
      versionId: candidate.versionId ?? null,
      projectionId: candidate.projectionId ?? null,
    };
  }
  if (candidate.resourceType === "memory") {
    return {
      canonicalKind: candidate.canonicalKind ?? "markdown_root",
      atomId: candidate.atomId ?? null,
      sourceId: candidate.sourceId ?? candidate.atomId ?? null,
    };
  }
  return {
    identityId: candidate.identityId ?? null,
    provider: candidate.provider ?? null,
    credentialHandleId: candidate.credentialHandleId ?? null,
    agentAssetId: candidate.agentAssetId ?? null,
  };
}

/**
 * Dual-read: Catalog row must exist, locator/owner/scope/tenant/projection match, no duplicate canonicals.
 */
export async function verifySecondWaveDualRead(params: {
  candidate: SecondWaveMigrationCandidate;
  resourceId: string;
  stateDir?: string;
}): Promise<{ ok: boolean; error?: string; duplicateCanonicals: string[] }> {
  const catalog = getSharedDataGovernanceCatalog({ stateDir: params.stateDir });
  const record = await catalog.get(params.resourceId);
  if (!record) {
    return { ok: false, error: "dual_read_missing_catalog", duplicateCanonicals: [] };
  }
  if (record.envelope.lifecycleState !== "pending" && record.envelope.lifecycleState !== "active") {
    return {
      ok: false,
      error: `dual_read_bad_lifecycle:${record.envelope.lifecycleState}`,
      duplicateCanonicals: [],
    };
  }
  const equiv = assertSecondWaveCandidateMatchesRecord({
    candidate: params.candidate,
    record,
  });
  if (!equiv.ok) {
    return { ok: false, error: `dual_read_${equiv.error}`, duplicateCanonicals: [] };
  }

  const all = await catalog.list();
  const duplicateCanonicals = diagnoseDuplicateCanonicals(all).filter((d) =>
    d.includes(path.resolve(params.candidate.canonicalLocator)),
  );
  if (duplicateCanonicals.length > 0) {
    return { ok: false, error: "dual_read_duplicate_canonical", duplicateCanonicals };
  }
  return { ok: true, duplicateCanonicals: [] };
}

/**
 * Migrate inventory candidates into Catalog. Idempotent on resourceId.
 * On fault: no second active canonical; pending rows abort to recovery_required + receipt.
 */
export async function migrateSecondWaveCandidates(params: {
  operationId: string;
  candidates: SecondWaveMigrationCandidate[];
  stateDir?: string;
  dryRun?: boolean;
  faultAfter?: MigrationFaultAfter;
  /** When true after a fault, attempt abort/rollback of this operation's pending rows. */
  rollbackOnFault?: boolean;
}): Promise<SecondWaveMigrationReport> {
  const dryRun = params.dryRun === true;
  const items: SecondWaveMigrationItemResult[] = [];
  const allowedRoots = params.stateDir ? [path.resolve(params.stateDir)] : [];
  let dualWriteDetected = false;
  const allDupes: string[] = [];
  const registered: Array<{
    resourceType: SecondWaveResourceType;
    resourceId: string;
    classId: string;
  }> = [];

  for (const candidate of params.candidates) {
    if (SECOND_WAVE_MIGRATION_EXCLUDED.has(candidate.classId)) {
      items.push({
        classId: candidate.classId,
        resourceId: "",
        status: "skipped_excluded",
        error: `excluded_class:${candidate.classId}`,
      });
      continue;
    }

    let resourceId: string;
    try {
      resourceId = resolveResourceId(candidate);
    } catch (err) {
      items.push({
        classId: candidate.classId,
        resourceId: "",
        status: "failed",
        error: String((err as Error)?.message ?? err),
      });
      continue;
    }

    if (dryRun) {
      items.push({ classId: candidate.classId, resourceId, status: "planned" });
      continue;
    }

    try {
      const catalog = getSharedDataGovernanceCatalog({ stateDir: params.stateDir });
      const existing = await catalog.get(resourceId);
      if (existing?.envelope.lifecycleState === "active") {
        const equiv = assertSecondWaveCandidateMatchesRecord({
          candidate,
          record: existing,
        });
        if (!equiv.ok) {
          items.push({
            classId: candidate.classId,
            resourceId,
            status: "conflict_existing",
            error: equiv.error,
          });
          return {
            operationId: params.operationId,
            dryRun,
            items,
            dualWriteDetected: true,
            duplicateCanonicals: allDupes,
          };
        }
        items.push({
          classId: candidate.classId,
          resourceId,
          status: "skipped_already_active",
        });
        continue;
      }
      // Active already handled above; pending may re-enter dual-read/cutover after equivalence check.
      if (existing?.envelope.lifecycleState === "pending") {
        const equiv = assertSecondWaveCandidateMatchesRecord({
          candidate,
          record: existing,
        });
        if (!equiv.ok) {
          items.push({
            classId: candidate.classId,
            resourceId,
            status: "conflict_existing",
            error: equiv.error,
          });
          return {
            operationId: params.operationId,
            dryRun,
            items,
            dualWriteDetected: true,
            duplicateCanonicals: allDupes,
          };
        }
      }

      await registerPending(candidate, params.stateDir);
      registered.push({
        resourceType: candidate.resourceType,
        resourceId,
        classId: candidate.classId,
      });
      items.push({ classId: candidate.classId, resourceId, status: "pending" });

      if (params.faultAfter === "register_pending") {
        throw new Error("fault_inject:register_pending");
      }

      const dual = await verifySecondWaveDualRead({
        candidate,
        resourceId,
        stateDir: params.stateDir,
      });
      if (!dual.ok) {
        if (dual.error === "dual_read_duplicate_canonical") {
          dualWriteDetected = true;
        }
        allDupes.push(...dual.duplicateCanonicals);
        throw new Error(dual.error ?? "dual_read_failed");
      }
      items[items.length - 1] = {
        classId: candidate.classId,
        resourceId,
        status: "dual_read_ok",
      };

      if (params.faultAfter === "dual_read") {
        throw new Error("fault_inject:dual_read");
      }

      await activateResource(candidate.resourceType, resourceId, params.stateDir);
      items[items.length - 1] = {
        classId: candidate.classId,
        resourceId,
        status: "cutover_active",
      };

      if (params.faultAfter === "cutover") {
        throw new Error("fault_inject:cutover");
      }
    } catch (err) {
      const message = String((err as Error)?.message ?? err);
      const last = items[items.length - 1];
      if (last && last.resourceId === resourceId) {
        last.status = "failed";
        last.error = message;
      } else {
        items.push({
          classId: candidate.classId,
          resourceId,
          status: "failed",
          error: message,
        });
      }

      if (params.rollbackOnFault !== false) {
        for (const row of registered) {
          try {
            await abortResource({
              resourceType: row.resourceType,
              resourceId: row.resourceId,
              operationId: params.operationId,
              reason: message,
              stateDir: params.stateDir,
              allowedRoots,
            });
            const item = items.find((i) => i.resourceId === row.resourceId);
            if (item) {
              item.status = "recovery_required";
              item.error = message;
            }
          } catch (abortErr) {
            dualWriteDetected = true;
            writeGovernanceRecoveryReceipt({
              operationId: params.operationId,
              stage: "migration_abort",
              reason: message,
              error: String((abortErr as Error)?.message ?? abortErr),
              resourceIds: [row.resourceId],
              haltCompensation: true,
              stateDir: params.stateDir,
            });
            const item = items.find((i) => i.resourceId === row.resourceId);
            if (item) {
              item.status = "recovery_required";
              item.error = `abort_failed:${String((abortErr as Error)?.message ?? abortErr)}`;
            }
          }
        }
      }

      writeGovernanceRecoveryReceipt({
        operationId: params.operationId,
        stage: "migration_fault",
        reason: message,
        resourceIds: registered.map((r) => r.resourceId),
        haltCompensation: true,
        stateDir: params.stateDir,
      });

      return {
        operationId: params.operationId,
        dryRun,
        items,
        dualWriteDetected,
        duplicateCanonicals: allDupes,
      };
    }
  }

  return {
    operationId: params.operationId,
    dryRun,
    items,
    dualWriteDetected,
    duplicateCanonicals: allDupes,
  };
}

/** Explicit rollback of pending/active-from-migration rows to recovery_required. */
export async function rollbackSecondWaveMigration(params: {
  operationId: string;
  items: Array<{ resourceType: SecondWaveResourceType; resourceId: string }>;
  reason: string;
  stateDir?: string;
}): Promise<{ rolledBack: string[]; failed: string[] }> {
  const allowedRoots = params.stateDir ? [path.resolve(params.stateDir)] : [];
  const rolledBack: string[] = [];
  const failed: string[] = [];
  for (const item of params.items) {
    try {
      await abortResource({
        resourceType: item.resourceType,
        resourceId: item.resourceId,
        operationId: params.operationId,
        reason: params.reason,
        stateDir: params.stateDir,
        allowedRoots,
      });
      rolledBack.push(item.resourceId);
    } catch {
      failed.push(item.resourceId);
    }
  }
  writeGovernanceRecoveryReceipt({
    operationId: params.operationId,
    stage: "migration_rollback",
    reason: params.reason,
    resourceIds: [...rolledBack, ...failed],
    haltCompensation: failed.length > 0,
    stateDir: params.stateDir,
  });
  return { rolledBack, failed };
}
