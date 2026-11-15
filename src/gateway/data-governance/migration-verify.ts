/**
 * M3 batch verify / receipted repair / same-tenant restore.
 * Restore commits by Catalog CAS: one active canonical, old locator replica/read_only.
 * Failure marks recovery_required only via versioned compareAndPut; CAS miss leaves Catalog untouched.
 * In-place restore re-reads Catalog and refuses restored unless the start snapshot still matches.
 * No raw JSON or path edits. Deleted objects stay deleted. Cross-tenant reads fail closed.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { DataGovernanceCatalogStore } from "./catalog-store.js";
import { diagnoseBindingRoles } from "./diagnostics.js";
import type { MigrationApplyItem } from "./migration-apply.js";
import type { RetentionEvidence } from "./migration-inventory.js";
import type { CatalogRecord, LegalHold, StorageBinding } from "./types.js";
import type { GovernanceOwnershipProof } from "./write-gate.js";

export const M3_VERIFY_RECEIPT_KIND = "m3_verify_receipt" as const;
export const M3_REPAIR_RECEIPT_KIND = "m3_repair_receipt" as const;
export const M3_RESTORE_RECEIPT_KIND = "m3_restore_receipt" as const;

export type MigrationVerifyCheck =
  | "catalog_binding"
  | "checksum"
  | "ownership_tenant"
  | "tombstone_hold_retention"
  | "index_rebuild"
  | "same_tenant_restore"
  | "no_resurrect"
  | "cross_tenant_deny";

export type MigrationVerifyOutcome = "passed" | "failed" | "blocked";

export type MigrationVerifyDeny =
  | "tenant_not_authorized"
  | "batch_required"
  | "proof_required"
  | "proof_owner_mismatch"
  | "cross_tenant"
  | "catalog_missing"
  | "binding_mismatch"
  | "checksum_mismatch"
  | "physical_missing"
  | "resurrect_forbidden"
  | "repair_command_invalid"
  | "index_rebuild_failed"
  | "cas_conflict"
  | "recovery_conflict";

const DELETED_STATES = new Set(["purged", "deletion_pending", "retired"]);

export type PhysicalCanonicalReader = {
  read(params: {
    tenantId: string;
    resourceId: string;
    locator: string;
  }): Promise<{ checksum: string } | null>;
};

export type CanonicalIndexRebuilder = {
  rebuild(params: {
    tenantId: string;
    resourceId: string;
    canonicalLocator: string;
    contentVersion: string;
  }): Promise<{ ok: true; indexChecksum: string } | { ok: false }>;
};

export type ConstrainedRestoreHandle = {
  restore(params: {
    tenantId: string;
    resourceId: string;
    canonicalLocator: string;
    expectedChecksum: string;
  }): Promise<{ checksum: string; restoredLocator: string }>;
};

export type MigrationVerifyFinding = {
  check: MigrationVerifyCheck;
  outcome: MigrationVerifyOutcome;
  detail: string;
};

export type MigrationVerifiedArtifact = {
  artifactId: string;
  checksum: string;
};

/**
 * From/to snapshot for one migration being verified. Callers that know the
 * saved and current workspace binding must thread these fields through rather
 * than leaving the official receipt incomplete.
 */
export type MigrationVerifyChangeSnapshot = {
  fromBindingId: string;
  toBindingId: string;
  fromContentVersion: string;
  toContentVersion: string;
  fromDirectory: string;
  toDirectory: string;
  authorizationIdentity: string;
  operationIdentity: string;
  artifactSet?: MigrationVerifiedArtifact[];
};

export type MigrationVerifyReceipt = {
  kind: typeof M3_VERIFY_RECEIPT_KIND;
  receiptId: string;
  batchId: string;
  tenantId: string;
  resourceId: string;
  candidateId: string;
  findings: MigrationVerifyFinding[];
  legalHold: LegalHold | null;
  retention: RetentionEvidence | null;
  passed: boolean;
  fromBindingId?: string;
  toBindingId?: string;
  fromContentVersion?: string;
  toContentVersion?: string;
  fromDirectoryRealpath?: string;
  toDirectoryRealpath?: string;
  fromLocator?: string;
  toLocator?: string;
  authorizationIdentity?: string;
  operationIdentity?: string;
  artifactSet?: MigrationVerifiedArtifact[];
};

export type MigrationRepairReceipt = {
  kind: typeof M3_REPAIR_RECEIPT_KIND;
  receiptId: string;
  batchId: string;
  tenantId: string;
  resourceId: string;
  command: "mark_recovery_required" | "rebuild_derived_index";
  previousLifecycleState: string;
  nextLifecycleState: string;
};

export type MigrationRestoreStatus = "restored" | "recovery_required" | "recovery_conflict";

export type MigrationRestoreReceipt = {
  kind: typeof M3_RESTORE_RECEIPT_KIND;
  receiptId: string;
  batchId: string;
  tenantId: string;
  resourceId: string;
  status: MigrationRestoreStatus;
  previousLocator: string;
  restoredLocator: string | null;
  canonicalLocator: string | null;
  contentChecksum: string;
  reasonCode: MigrationVerifyDeny | null;
};

function writeReceipt(receiptDir: string, receiptId: string, payload: unknown): void {
  fs.mkdirSync(receiptDir, { recursive: true });
  fs.writeFileSync(
    path.join(receiptDir, `${receiptId}.json`),
    `${JSON.stringify(payload, null, 2)}\n`,
    {
      encoding: "utf8",
      mode: 0o600,
    },
  );
}

function ownerKey(proof: GovernanceOwnershipProof): string {
  const owner = proof.owner;
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

function catalogOwnerKey(record: CatalogRecord): string {
  const owner = record.envelope.owner;
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

function activeCanonical(record: CatalogRecord) {
  return record.bindings.find((b) => b.role === "canonical" && b.state === "active") ?? null;
}

function inPlaceRestoreSnapshotMatches(params: {
  observed: CatalogRecord;
  observedCanonical: StorageBinding;
  current: CatalogRecord;
  restoredLocator: string;
  restoredChecksum: string;
}): boolean {
  const live = activeCanonical(params.current);
  if (!live) {
    return false;
  }
  const observed = params.observed.envelope;
  const current = params.current.envelope;
  return (
    current.governanceVersion === observed.governanceVersion &&
    current.lifecycleState === observed.lifecycleState &&
    current.tenantId === observed.tenantId &&
    current.canonicalBindingId === observed.canonicalBindingId &&
    catalogOwnerKey(params.current) === catalogOwnerKey(params.observed) &&
    live.bindingId === params.observedCanonical.bindingId &&
    live.locator === params.observedCanonical.locator &&
    live.locator === params.restoredLocator &&
    live.contentVersion === params.observedCanonical.contentVersion &&
    live.contentVersion === params.restoredChecksum &&
    live.role === "canonical" &&
    live.state === "active"
  );
}

function countActiveCanonicals(bindings: StorageBinding[]): number {
  return bindings.filter((binding) => binding.role === "canonical" && binding.state === "active")
    .length;
}

function switchCanonicalBindings(params: {
  record: CatalogRecord;
  previous: StorageBinding;
  restoredLocator: string;
  checksum: string;
}): StorageBinding[] {
  const nextCanonical: StorageBinding = {
    ...params.previous,
    locator: params.restoredLocator,
    role: "canonical",
    state: "active",
    contentVersion: params.checksum,
  };
  const others = params.record.bindings.filter(
    (binding) => binding.bindingId !== params.previous.bindingId,
  );
  const demoted: StorageBinding[] = others.some(
    (binding) => binding.locator === params.previous.locator,
  )
    ? others.map((binding) =>
        binding.locator === params.previous.locator
          ? { ...binding, role: "replica", state: "read_only" as const }
          : binding,
      )
    : [
        {
          bindingId: `observe-restore:${params.record.envelope.resourceId}`,
          resourceId: params.record.envelope.resourceId,
          role: "replica",
          storageKind: params.previous.storageKind,
          locator: params.previous.locator,
          state: "read_only",
          contentVersion: params.previous.contentVersion,
        },
        ...others,
      ];
  return [nextCanonical, ...demoted];
}

async function markRestoreRecoveryRequired(params: {
  store: DataGovernanceCatalogStore;
  observed: CatalogRecord;
}): Promise<{ ok: true; record: CatalogRecord } | { ok: false; current: CatalogRecord | null }> {
  const { observed } = params;
  if (DELETED_STATES.has(observed.envelope.lifecycleState)) {
    return { ok: false, current: observed };
  }
  if (observed.envelope.lifecycleState === "recovery_required") {
    return { ok: true, record: observed };
  }
  try {
    const cas = await params.store.compareAndPut({
      resourceId: observed.envelope.resourceId,
      expectedGovernanceVersion: observed.envelope.governanceVersion,
      next: {
        envelope: {
          ...observed.envelope,
          lifecycleState: "recovery_required",
          governanceVersion: observed.envelope.governanceVersion + 1,
          updatedAt: new Date().toISOString(),
        },
        bindings: observed.bindings,
      },
    });
    if (!cas.ok) {
      return { ok: false, current: await params.store.get(observed.envelope.resourceId) };
    }
    return { ok: true, record: cas.record };
  } catch {
    return { ok: false, current: await params.store.get(observed.envelope.resourceId) };
  }
}

function isConcreteChecksum(value?: string | null): value is string {
  const text = value?.trim();
  if (!text) {
    return false;
  }
  const lowered = text.toLowerCase();
  if (lowered === "ok" || lowered === "passed" || lowered === "true") {
    return false;
  }
  return (
    text.startsWith("sha256:") ||
    text.startsWith("sha512:") ||
    text.startsWith("checksum:") ||
    /^[a-f0-9]{32,}$/i.test(text)
  );
}

/** Prefer a directory realpath; never invent a path that was not provided. */
export function normalizeMigrationDirectoryRealpath(value?: string | null): string | undefined {
  const text = value?.trim();
  if (!text) {
    return undefined;
  }
  try {
    const real = fs.realpathSync(text);
    if (fs.statSync(real).isDirectory()) {
      return real;
    }
  } catch {
    // Keep the provided path when it cannot be resolved as a directory.
  }
  return text;
}

function lookupVerifyChange(
  changes: Readonly<Record<string, MigrationVerifyChangeSnapshot | undefined>> | undefined,
  resourceId: string | null,
  candidateId: string,
): MigrationVerifyChangeSnapshot | undefined {
  if (!changes) {
    return undefined;
  }
  if (resourceId && changes[resourceId]) {
    return changes[resourceId];
  }
  return changes[candidateId];
}

function concreteArtifactSet(
  rows: Array<{ artifactId?: string; checksum?: string } | undefined>,
): MigrationVerifiedArtifact[] {
  const out: MigrationVerifiedArtifact[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const artifactId = row?.artifactId?.trim();
    const checksum = row?.checksum?.trim();
    if (!artifactId || !isConcreteChecksum(checksum)) {
      continue;
    }
    const key = `${artifactId}\0${checksum}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push({ artifactId, checksum });
  }
  return out;
}

function bindingAtLocator(
  record: CatalogRecord | null | undefined,
  locator: string | undefined,
  excludeBindingId?: string,
): StorageBinding | undefined {
  if (!record || !locator) {
    return undefined;
  }
  const matches = record.bindings.filter((binding) => binding.locator === locator);
  return matches.find((binding) => binding.bindingId !== excludeBindingId) ?? matches[0];
}

function proofTenantOk(proof: GovernanceOwnershipProof, callerTenantId: string): boolean {
  if (proof.owner.kind === "group") {
    return proof.scope.kind === "tenant" && proof.scope.tenantId === callerTenantId;
  }
  return proof.scope.kind === "tenant" && proof.scope.tenantId === callerTenantId;
}

export async function verifyMigrationBatch(params: {
  callerTenantId: string;
  authorizedTenantId: string;
  batchId: string;
  store: DataGovernanceCatalogStore;
  items: MigrationApplyItem[];
  proofs: Readonly<Record<string, GovernanceOwnershipProof | undefined>>;
  physical: PhysicalCanonicalReader;
  indexRebuilder?: CanonicalIndexRebuilder;
  receiptDir: string;
  /**
   * Per-resource or per-candidate from/to snapshot for this migration.
   * Thread these through when the official writer should emit a complete
   * receipt; do not invent missing start/end fields.
   */
  changes?: Readonly<Record<string, MigrationVerifyChangeSnapshot | undefined>>;
}): Promise<
  | { ok: true; receipts: MigrationVerifyReceipt[] }
  | {
      ok: false;
      reasonCode: Extract<MigrationVerifyDeny, "tenant_not_authorized" | "batch_required">;
    }
> {
  const callerTenantId = params.callerTenantId.trim();
  const batchId = params.batchId.trim();
  if (!batchId) {
    return { ok: false, reasonCode: "batch_required" };
  }
  if (!callerTenantId || callerTenantId !== params.authorizedTenantId.trim()) {
    return { ok: false, reasonCode: "tenant_not_authorized" };
  }

  const receipts: MigrationVerifyReceipt[] = [];
  for (const item of params.items) {
    if (!item.resourceId || item.status !== "migrated") {
      continue;
    }
    const findings: MigrationVerifyFinding[] = [];
    const record = await params.store.get(item.resourceId);
    const proof = params.proofs[item.candidateId];

    if (!record) {
      findings.push({ check: "catalog_binding", outcome: "failed", detail: "catalog_missing" });
    } else if (record.envelope.tenantId !== callerTenantId) {
      findings.push({ check: "cross_tenant_deny", outcome: "blocked", detail: "cross_tenant" });
    } else {
      const issues = diagnoseBindingRoles(record);
      const canonical = activeCanonical(record);
      if (issues.length > 0 || !canonical) {
        findings.push({
          check: "catalog_binding",
          outcome: "failed",
          detail: issues[0]?.code ?? "binding_mismatch",
        });
      } else {
        findings.push({ check: "catalog_binding", outcome: "passed", detail: canonical.locator });
        const physical = await params.physical.read({
          tenantId: callerTenantId,
          resourceId: item.resourceId,
          locator: canonical.locator,
        });
        if (!physical) {
          findings.push({ check: "checksum", outcome: "failed", detail: "physical_missing" });
        } else if (physical.checksum !== canonical.contentVersion) {
          findings.push({ check: "checksum", outcome: "failed", detail: "checksum_mismatch" });
        } else {
          findings.push({ check: "checksum", outcome: "passed", detail: physical.checksum });
        }
        if (params.indexRebuilder) {
          const rebuilt = await params.indexRebuilder.rebuild({
            tenantId: callerTenantId,
            resourceId: item.resourceId,
            canonicalLocator: canonical.locator,
            contentVersion: canonical.contentVersion,
          });
          findings.push({
            check: "index_rebuild",
            outcome: rebuilt.ok ? "passed" : "failed",
            detail: rebuilt.ok ? rebuilt.indexChecksum : "index_rebuild_failed",
          });
        }
      }

      if (!proof) {
        findings.push({ check: "ownership_tenant", outcome: "failed", detail: "proof_required" });
      } else if (
        !proofTenantOk(proof, callerTenantId) ||
        ownerKey(proof) !== catalogOwnerKey(record)
      ) {
        findings.push({
          check: "ownership_tenant",
          outcome: "failed",
          detail: "proof_owner_mismatch",
        });
      } else {
        findings.push({ check: "ownership_tenant", outcome: "passed", detail: ownerKey(proof) });
      }

      const deleted = DELETED_STATES.has(record.envelope.lifecycleState);
      findings.push({
        check: "tombstone_hold_retention",
        outcome: "passed",
        detail: deleted ? "tombstoned" : record.envelope.legalHold ? "legal_hold" : "clear",
      });
      findings.push({
        check: "no_resurrect",
        outcome: "passed",
        detail: deleted ? "must_not_restore" : "active",
      });
      findings.push({
        check: "same_tenant_restore",
        outcome: deleted ? "blocked" : "passed",
        detail: deleted ? "resurrect_forbidden" : "eligible",
      });
    }

    const canonical = record ? activeCanonical(record) : null;
    const change = lookupVerifyChange(params.changes, item.resourceId, item.candidateId);
    const previousLocator = item.receipt.previousLocator?.trim() || undefined;
    const fromBinding = bindingAtLocator(
      record,
      change?.fromDirectory || previousLocator,
      canonical?.bindingId,
    );
    const checksumDetail = findings.find(
      (finding) => finding.check === "checksum" && finding.outcome === "passed",
    )?.detail;
    const artifactSet = concreteArtifactSet([
      ...(change?.artifactSet ?? []),
      item.resourceId && isConcreteChecksum(checksumDetail)
        ? { artifactId: item.resourceId, checksum: checksumDetail }
        : undefined,
    ]);
    const fromBindingId = change?.fromBindingId.trim() || fromBinding?.bindingId;
    const toBindingId = change?.toBindingId.trim() || canonical?.bindingId;
    const fromContentVersion = change?.fromContentVersion.trim() || fromBinding?.contentVersion;
    const toContentVersion = change?.toContentVersion.trim() || canonical?.contentVersion;
    const fromDirectoryRealpath = normalizeMigrationDirectoryRealpath(
      change?.fromDirectory || previousLocator,
    );
    const toDirectoryRealpath = normalizeMigrationDirectoryRealpath(
      change?.toDirectory || canonical?.locator,
    );
    const authorizationIdentity =
      change?.authorizationIdentity.trim() ||
      (proof ? `tenant:${callerTenantId}:owner:${ownerKey(proof)}` : undefined);
    const operationIdentity =
      change?.operationIdentity.trim() ||
      item.receipt.operationId?.trim() ||
      `${batchId}:${item.candidateId}:verify`;
    const receipt: MigrationVerifyReceipt = {
      kind: M3_VERIFY_RECEIPT_KIND,
      receiptId: `m3v-${randomUUID()}`,
      batchId,
      tenantId: callerTenantId,
      resourceId: item.resourceId,
      candidateId: item.candidateId,
      findings,
      legalHold: record?.envelope.legalHold ?? null,
      retention: null,
      passed: findings.every((finding) => finding.outcome === "passed"),
      ...(fromBindingId ? { fromBindingId } : {}),
      ...(toBindingId ? { toBindingId } : {}),
      ...(fromContentVersion ? { fromContentVersion } : {}),
      ...(toContentVersion ? { toContentVersion } : {}),
      ...(fromDirectoryRealpath ? { fromDirectoryRealpath } : {}),
      ...(toDirectoryRealpath ? { toDirectoryRealpath } : {}),
      ...(previousLocator ? { fromLocator: previousLocator } : {}),
      ...(canonical?.locator ? { toLocator: canonical.locator } : {}),
      ...(authorizationIdentity ? { authorizationIdentity } : {}),
      ...(operationIdentity ? { operationIdentity } : {}),
      ...(artifactSet.length > 0 ? { artifactSet } : {}),
    };
    writeReceipt(params.receiptDir, receipt.receiptId, receipt);
    receipts.push(receipt);
  }
  return { ok: true, receipts };
}

export async function repairMigrationRecord(params: {
  callerTenantId: string;
  authorizedTenantId: string;
  batchId: string;
  resourceId: string;
  proof: GovernanceOwnershipProof;
  command: "mark_recovery_required" | "rebuild_derived_index";
  store: DataGovernanceCatalogStore;
  indexRebuilder?: CanonicalIndexRebuilder;
  receiptDir: string;
}): Promise<
  { ok: true; receipt: MigrationRepairReceipt } | { ok: false; reasonCode: MigrationVerifyDeny }
> {
  const callerTenantId = params.callerTenantId.trim();
  if (!params.batchId.trim()) {
    return { ok: false, reasonCode: "batch_required" };
  }
  if (!callerTenantId || callerTenantId !== params.authorizedTenantId.trim()) {
    return { ok: false, reasonCode: "tenant_not_authorized" };
  }
  if (params.command !== "mark_recovery_required" && params.command !== "rebuild_derived_index") {
    return { ok: false, reasonCode: "repair_command_invalid" };
  }
  const record = await params.store.get(params.resourceId);
  if (!record) {
    return { ok: false, reasonCode: "catalog_missing" };
  }
  if (record.envelope.tenantId !== callerTenantId) {
    return { ok: false, reasonCode: "cross_tenant" };
  }
  if (
    !proofTenantOk(params.proof, callerTenantId) ||
    ownerKey(params.proof) !== catalogOwnerKey(record)
  ) {
    return { ok: false, reasonCode: "proof_owner_mismatch" };
  }

  let nextLifecycle = record.envelope.lifecycleState;
  if (params.command === "mark_recovery_required") {
    const cas = await params.store.compareAndPut({
      resourceId: params.resourceId,
      expectedGovernanceVersion: record.envelope.governanceVersion,
      next: {
        envelope: {
          ...record.envelope,
          lifecycleState: "recovery_required",
          governanceVersion: record.envelope.governanceVersion + 1,
          updatedAt: new Date().toISOString(),
        },
        bindings: record.bindings,
      },
    });
    if (!cas.ok) {
      return { ok: false, reasonCode: "binding_mismatch" };
    }
    nextLifecycle = "recovery_required";
  } else {
    const canonical = activeCanonical(record);
    if (!canonical || !params.indexRebuilder) {
      return { ok: false, reasonCode: "index_rebuild_failed" };
    }
    const rebuilt = await params.indexRebuilder.rebuild({
      tenantId: callerTenantId,
      resourceId: params.resourceId,
      canonicalLocator: canonical.locator,
      contentVersion: canonical.contentVersion,
    });
    if (!rebuilt.ok) {
      return { ok: false, reasonCode: "index_rebuild_failed" };
    }
  }

  const receipt: MigrationRepairReceipt = {
    kind: M3_REPAIR_RECEIPT_KIND,
    receiptId: `m3p-${randomUUID()}`,
    batchId: params.batchId.trim(),
    tenantId: callerTenantId,
    resourceId: params.resourceId,
    command: params.command,
    previousLifecycleState: record.envelope.lifecycleState,
    nextLifecycleState: nextLifecycle,
  };
  writeReceipt(params.receiptDir, receipt.receiptId, receipt);
  return { ok: true, receipt };
}

export async function restoreMigrationCanonical(params: {
  callerTenantId: string;
  authorizedTenantId: string;
  batchId: string;
  resourceId: string;
  proof: GovernanceOwnershipProof;
  store: DataGovernanceCatalogStore;
  handle: ConstrainedRestoreHandle;
  receiptDir: string;
}): Promise<
  | { ok: true; receipt: MigrationRestoreReceipt }
  | { ok: false; reasonCode: MigrationVerifyDeny; receipt?: MigrationRestoreReceipt }
> {
  const callerTenantId = params.callerTenantId.trim();
  const batchId = params.batchId.trim();
  if (!batchId) {
    return { ok: false, reasonCode: "batch_required" };
  }
  if (!callerTenantId || callerTenantId !== params.authorizedTenantId.trim()) {
    return { ok: false, reasonCode: "tenant_not_authorized" };
  }
  const record = await params.store.get(params.resourceId);
  if (!record) {
    return { ok: false, reasonCode: "catalog_missing" };
  }
  if (record.envelope.tenantId !== callerTenantId) {
    return { ok: false, reasonCode: "cross_tenant" };
  }
  if (
    !proofTenantOk(params.proof, callerTenantId) ||
    ownerKey(params.proof) !== catalogOwnerKey(record)
  ) {
    return { ok: false, reasonCode: "proof_owner_mismatch" };
  }
  if (DELETED_STATES.has(record.envelope.lifecycleState)) {
    return { ok: false, reasonCode: "resurrect_forbidden" };
  }
  const canonical = activeCanonical(record);
  if (!canonical) {
    return { ok: false, reasonCode: "binding_mismatch" };
  }

  const failAfterAttempt = async (
    reasonCode: MigrationVerifyDeny,
    restoredLocator: string | null,
    contentChecksum: string,
  ): Promise<{
    ok: false;
    reasonCode: MigrationVerifyDeny;
    receipt: MigrationRestoreReceipt;
  }> => {
    const writeFailReceipt = (
      status: Extract<MigrationRestoreStatus, "recovery_required" | "recovery_conflict">,
      deny: MigrationVerifyDeny,
      catalog: CatalogRecord | null,
    ) => {
      const receipt: MigrationRestoreReceipt = {
        kind: M3_RESTORE_RECEIPT_KIND,
        receiptId: `m3s-${randomUUID()}`,
        batchId,
        tenantId: callerTenantId,
        resourceId: params.resourceId,
        status,
        previousLocator: canonical.locator,
        restoredLocator,
        canonicalLocator: catalog ? (activeCanonical(catalog)?.locator ?? null) : null,
        contentChecksum,
        reasonCode: deny,
      };
      writeReceipt(params.receiptDir, receipt.receiptId, receipt);
      return { ok: false as const, reasonCode: deny, receipt };
    };

    if (reasonCode === "cas_conflict" || reasonCode === "recovery_conflict") {
      const current = await params.store.get(params.resourceId);
      return writeFailReceipt("recovery_conflict", reasonCode, current);
    }

    const marked = await markRestoreRecoveryRequired({
      store: params.store,
      observed: record,
    });
    if (!marked.ok) {
      return writeFailReceipt("recovery_conflict", "recovery_conflict", marked.current);
    }
    return writeFailReceipt("recovery_required", reasonCode, marked.record);
  };

  let restored: { checksum: string; restoredLocator: string };
  try {
    restored = await params.handle.restore({
      tenantId: callerTenantId,
      resourceId: params.resourceId,
      canonicalLocator: canonical.locator,
      expectedChecksum: canonical.contentVersion,
    });
  } catch {
    return failAfterAttempt("physical_missing", null, canonical.contentVersion);
  }
  const dest = restored.restoredLocator.trim();
  if (!dest) {
    return failAfterAttempt("binding_mismatch", restored.restoredLocator, restored.checksum);
  }
  if (restored.checksum !== canonical.contentVersion) {
    return failAfterAttempt("checksum_mismatch", dest, restored.checksum);
  }

  if (dest === canonical.locator) {
    const current = await params.store.get(params.resourceId);
    if (
      !current ||
      !inPlaceRestoreSnapshotMatches({
        observed: record,
        observedCanonical: canonical,
        current,
        restoredLocator: dest,
        restoredChecksum: restored.checksum,
      })
    ) {
      return failAfterAttempt("recovery_conflict", dest, restored.checksum);
    }
    const live = activeCanonical(current);
    const receipt: MigrationRestoreReceipt = {
      kind: M3_RESTORE_RECEIPT_KIND,
      receiptId: `m3s-${randomUUID()}`,
      batchId,
      tenantId: callerTenantId,
      resourceId: params.resourceId,
      status: "restored",
      previousLocator: canonical.locator,
      restoredLocator: dest,
      canonicalLocator: live?.locator ?? dest,
      contentChecksum: restored.checksum,
      reasonCode: null,
    };
    writeReceipt(params.receiptDir, receipt.receiptId, receipt);
    return { ok: true, receipt };
  }

  const bindings = switchCanonicalBindings({
    record,
    previous: canonical,
    restoredLocator: dest,
    checksum: restored.checksum,
  });
  if (countActiveCanonicals(bindings) !== 1) {
    return failAfterAttempt("binding_mismatch", dest, restored.checksum);
  }
  const next: CatalogRecord = {
    envelope: {
      ...record.envelope,
      canonicalBindingId: canonical.bindingId,
      governanceVersion: record.envelope.governanceVersion + 1,
      updatedAt: new Date().toISOString(),
    },
    bindings,
  };
  if (diagnoseBindingRoles(next).length > 0) {
    return failAfterAttempt("binding_mismatch", dest, restored.checksum);
  }
  const cas = await params.store.compareAndPut({
    resourceId: params.resourceId,
    expectedGovernanceVersion: record.envelope.governanceVersion,
    next,
  });
  if (!cas.ok) {
    return failAfterAttempt("cas_conflict", dest, restored.checksum);
  }
  const committed = activeCanonical(cas.record);
  const receipt: MigrationRestoreReceipt = {
    kind: M3_RESTORE_RECEIPT_KIND,
    receiptId: `m3s-${randomUUID()}`,
    batchId,
    tenantId: callerTenantId,
    resourceId: params.resourceId,
    status: "restored",
    previousLocator: canonical.locator,
    restoredLocator: dest,
    canonicalLocator: committed?.locator ?? dest,
    contentChecksum: restored.checksum,
    reasonCode: null,
  };
  writeReceipt(params.receiptDir, receipt.receiptId, receipt);
  return { ok: true, receipt };
}
