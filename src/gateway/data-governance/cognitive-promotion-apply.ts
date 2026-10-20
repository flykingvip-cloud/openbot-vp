import { createHash } from "node:crypto";
import fs from "node:fs";
/**
 * P4-c apply: adapter writes (speculative), one Catalog CAS (commit), then
 * receipt applied. Tombstone is durable before Catalog CAS. P4-d export is not here.
 */
import { resolveStateDir } from "../../config/paths.js";
import {
  getOrCreateFileDataGovernanceCatalogStore,
  loadValidatedCatalogRecordSync,
} from "./catalog-store.js";
import {
  isGovernanceApprovalAuth,
  type GovernanceApprovalAuth,
} from "./cognitive-approval-auth.js";
import { readGovernanceApprovalGrant } from "./cognitive-approval-grant-store.js";
import {
  catalogProjectionFields,
  countWritableCanonicals,
  encryptColdArchiveObject,
  encryptByosObject,
  encryptDedicatedRegionalObject,
  encryptManagedCloudObject,
  encryptTenantManagedCloudObject,
  hashCanonicalBytes,
  laterWaveAdapterAvailability,
  laterWaveAdapterUnavailable,
  markProjectionBodyUnreadable,
  parseCloudProjectionEnvelope,
  readCloudProjectionEnvelope,
  readLocalCanonicalBytes,
  readProjectionTombstone,
  unlinkByosObject,
  unlinkColdArchiveObject,
  unlinkDedicatedRegionalObject,
  unlinkManagedEncryptedCloudObject,
  unlinkTenantManagedCloudObject,
  writeColdArchiveObject,
  writeByosObject,
  writeCloudProjection,
  writeDedicatedRegionalObject,
  writeLocalCanonicalBytes,
  writeManagedEncryptedCloudObject,
  writeTenantManagedCloudObject,
  writeProjectionTombstone,
} from "./cognitive-promotion-adapters.js";
import {
  assertKeyRefTenant,
  resolveArchiveTenantKeyRef,
  resolveByosCustomerKeyRef,
  resolveDedicatedTenantKeyRef,
  resolvePlatformTenantKeyRef,
  type PromotionKeyRef,
} from "./cognitive-promotion-key.js";
import {
  finalizePromotionReceipt,
  finalizeTombstoneReceipt,
  getCognitivePromotionReceiptByReplayId,
  getCognitiveProjectionTombstoneReceipt,
  readApplyTxnJournal,
  uniqueCreateTombstoneReceipt,
  unlinkApplyTxnJournal,
  writeApplyTxnJournal,
} from "./cognitive-promotion-store.js";
import {
  isGovernanceAuthenticatedCall,
  type GovernanceAuthenticatedCall,
} from "./cognitive-recommendation-auth.js";
import { resolveDataGovernanceCatalogPath } from "./paths.js";
import { reverifySubjectConsent, verifyResourceConsentScope } from "./placement-platform-verify.js";
import type {
  CatalogRecord,
  CloudProjectionEnvelope,
  CognitiveProjectionTombstoneReceipt,
  CognitivePromotionReceipt,
  StorageBinding,
} from "./types.js";
import { assertOwnershipProofMatches } from "./write-gate.js";

export type PromotionApplyDenyCode =
  | "governance_approval_auth_required"
  | "actor_mismatch"
  | "receipt_not_found"
  | "receipt_not_prepared"
  | "catalog_not_found"
  | "catalog_corrupt"
  | "canonical_bytes_missing"
  | "key_ref_required"
  | "key_tenant_mismatch"
  | "dedicated_key_unsupported"
  | "first_wave_adapter_unavailable"
  | "archive_recall_denied"
  | "projection_envelope_invalid"
  | "catalog_cas_conflict"
  | "recovery_required"
  | "grant_mismatch"
  | "grant_kind_mismatch"
  | "grant_scope_mismatch"
  | "grant_tenant_mismatch"
  | "grant_revoked"
  | "grant_expired"
  | "envelope_tenant_mismatch"
  | "ownership_mismatch"
  | "consent_required";

export type ApplyCognitivePromotionParams = {
  call: GovernanceAuthenticatedCall;
  auth: GovernanceApprovalAuth;
  replayId: string;
  faultAfter?: "adapter" | "catalog_cas";
};

export type ApplyCognitivePromotionResult =
  | { ok: true; receipt: CognitivePromotionReceipt; replay: boolean }
  | { ok: false; error: PromotionApplyDenyCode };

export type TombstoneCognitiveProjectionParams = {
  call: GovernanceAuthenticatedCall;
  auth: GovernanceApprovalAuth;
  resourceId: string;
  faultAfter?: "tombstone" | "tombstone_checksum" | "catalog_cas";
};

export type TombstoneCognitiveProjectionResult =
  | { ok: true; receipt: CognitiveProjectionTombstoneReceipt; replay: boolean }
  | { ok: false; error: PromotionApplyDenyCode };

function deny(error: PromotionApplyDenyCode): ApplyCognitivePromotionResult {
  return { ok: false, error };
}

function denyTombstone(error: PromotionApplyDenyCode): TombstoneCognitiveProjectionResult {
  return { ok: false, error };
}

function catalogStore(stateDir: string) {
  return getOrCreateFileDataGovernanceCatalogStore({
    storePath: resolveDataGovernanceCatalogPath(stateDir),
  });
}

function loadCatalog(stateDir: string, resourceId: string): CatalogRecord | null {
  return (
    loadValidatedCatalogRecordSync({
      storePath: resolveDataGovernanceCatalogPath(stateDir),
      resourceId,
    })?.record ?? null
  );
}

function sameActor(params: {
  call: GovernanceAuthenticatedCall;
  auth: GovernanceApprovalAuth;
}): boolean {
  return (
    isGovernanceAuthenticatedCall(params.call) &&
    isGovernanceApprovalAuth(params.auth) &&
    params.call.actor.kind === params.auth.actor.kind &&
    JSON.stringify(params.call.actor) === JSON.stringify(params.auth.actor)
  );
}

function envelopeTenantMatches(record: CatalogRecord, tenantId: string): boolean {
  return record.envelope.tenantId === tenantId;
}

function ownershipMatches(record: CatalogRecord, auth: GovernanceApprovalAuth): boolean {
  try {
    assertOwnershipProofMatches(record, auth.ownershipProof);
    return true;
  } catch {
    const proof = auth.ownershipProof;
    const envelope = record.envelope;
    if (
      proof.owner.kind === "user" &&
      envelope.owner.kind === "user" &&
      proof.owner.userId === envelope.owner.userId &&
      proof.scope.kind === "tenant" &&
      envelope.tenantId === proof.scope.tenantId &&
      envelope.scope.kind === "user" &&
      envelope.scope.userId === proof.owner.userId
    ) {
      return true;
    }
    return false;
  }
}

function inspectStoredGrant(params: {
  grantId: string;
  tenantId: string;
  requiredKind: "cognitive_promotion_apply" | "cognitive_projection_tombstone";
  resourceId: string;
  stateDir: string;
}): PromotionApplyDenyCode | null {
  const stored = readGovernanceApprovalGrant({
    grantId: params.grantId,
    tenantId: params.tenantId,
    stateDir: params.stateDir,
  });
  if (!stored) {
    return "governance_approval_auth_required";
  }
  if (stored.grantKind !== params.requiredKind) {
    return "grant_kind_mismatch";
  }
  if (stored.scope.kind !== "resource" || stored.scope.resourceId !== params.resourceId) {
    return "grant_scope_mismatch";
  }
  if ((stored.tenantId ?? null) !== params.tenantId) {
    return "grant_tenant_mismatch";
  }
  if (stored.revokedAt) {
    return "grant_revoked";
  }
  if (Date.parse(stored.expiresAt) <= Date.now()) {
    return "grant_expired";
  }
  return null;
}

function computeTombstoneReplayId(params: { grantId: string; resourceId: string }): string {
  return createHash("sha256")
    .update(`${params.grantId}\0${params.resourceId}\0projection_tombstone`, "utf8")
    .digest("hex");
}

function writableCanonical(record: CatalogRecord): StorageBinding | null {
  const found = record.bindings.find((b) => b.role === "canonical" && b.state === "active");
  return found ?? null;
}

function catalogMatchesIntent(params: {
  record: CatalogRecord;
  receipt: CognitivePromotionReceipt;
  checksum: string;
}): boolean {
  if (countWritableCanonicals(params.record.bindings) !== 1) {
    return false;
  }
  const canonical = writableCanonical(params.record);
  if (!canonical || canonical.bindingId !== params.receipt.toCanonicalBindingId) {
    return false;
  }
  if (params.record.envelope.projection?.checksum !== params.checksum) {
    return false;
  }
  if (params.receipt.projectionBindingId) {
    const projection = params.record.bindings.find(
      (b) => b.bindingId === params.receipt.projectionBindingId && b.role === "derived",
    );
    if (!projection) {
      return false;
    }
  }
  return true;
}

function buildProjectionEnvelope(params: {
  resourceId: string;
  contentVersion: string;
  checksum: string;
  consentVersion: string;
  policyVersion: string;
  tombstoneVersion: number;
}): CloudProjectionEnvelope {
  return {
    resourceId: params.resourceId,
    permittedClaims: ["placement"],
    scope: "cloud_intelligence",
    privacyLevel: "internal",
    contentVersion: params.contentVersion,
    checksum: params.checksum,
    provenanceRefs: [],
    consentVersion: params.consentVersion,
    policyVersion: params.policyVersion,
    tombstoneVersion: params.tombstoneVersion,
  };
}

function intendedBindings(params: {
  record: CatalogRecord;
  receipt: CognitivePromotionReceipt;
  localLocator: string;
  cloudLocator: string | null;
  checksum: string;
}): StorageBinding[] {
  const from = params.record.bindings.find((b) => b.bindingId === params.receipt.fromBindingId);
  if (!from) {
    return params.record.bindings;
  }
  if (params.receipt.canonicalHome === "local") {
    const next: StorageBinding[] = params.record.bindings.map((binding) =>
      binding.bindingId === from.bindingId
        ? {
            ...binding,
            role: "canonical",
            state: "active" as const,
            contentVersion: params.receipt.contentVersion,
          }
        : binding,
    );
    if (params.receipt.projectionBindingId && params.cloudLocator) {
      const existing = next.find((b) => b.bindingId === params.receipt.projectionBindingId);
      const derived: StorageBinding = {
        bindingId: params.receipt.projectionBindingId,
        resourceId: params.receipt.resourceId,
        role: "derived",
        storageKind: "object-store",
        locator: params.cloudLocator,
        state: "read_only",
        contentVersion: params.receipt.contentVersion,
        objectKey: params.receipt.resourceId,
      };
      if (existing) {
        return next.map((b) => (b.bindingId === derived.bindingId ? derived : b));
      }
      return [...next, derived];
    }
    return next;
  }
  const managed: StorageBinding = {
    bindingId: params.receipt.toCanonicalBindingId,
    resourceId: params.receipt.resourceId,
    role: "canonical",
    storageKind: params.receipt.canonicalHome === "byos" ? "byos" : "object-store",
    locator: params.cloudLocator ?? params.localLocator,
    state: "active",
    contentVersion: params.receipt.contentVersion,
    objectKey: params.receipt.resourceId,
  };
  const demoted: StorageBinding = {
    ...from,
    role: "replica",
    state: "read_only",
    locator: params.localLocator,
  };
  const withoutFrom = params.record.bindings.filter((b) => b.bindingId !== from.bindingId);
  const withManaged = [
    ...withoutFrom.filter((b) => b.bindingId !== managed.bindingId),
    demoted,
    managed,
  ];
  if (params.receipt.projectionBindingId && params.cloudLocator) {
    const derived: StorageBinding = {
      bindingId: params.receipt.projectionBindingId,
      resourceId: params.receipt.resourceId,
      role: "derived",
      storageKind: "object-store",
      locator: params.cloudLocator,
      state: "read_only",
      contentVersion: params.receipt.contentVersion,
      objectKey: `${params.receipt.resourceId}:projection`,
    };
    return [...withManaged.filter((b) => b.bindingId !== derived.bindingId), derived];
  }
  return withManaged;
}

function isTestRuntime(): boolean {
  return Boolean(
    process.env.VITEST || process.env.VITEST_WORKER_ID || process.env.OPENBOT_TEST_PROFILE,
  );
}

function reclaimOrphans(paths: readonly string[]): void {
  for (const dest of paths) {
    try {
      if (dest && fs.existsSync(dest)) {
        fs.unlinkSync(dest);
      }
    } catch {
      // best-effort reclaim
    }
  }
}

export function recoverPromotionApplyIfNeeded(params: {
  replayId: string;
  stateDir?: string;
}): void {
  const stateDir = params.stateDir ?? resolveStateDir();
  const journal = readApplyTxnJournal(stateDir);
  if (!journal || journal.replayId !== params.replayId) {
    return;
  }
  const record = loadCatalog(stateDir, journal.resourceId);
  const receipt = getCognitivePromotionReceiptByReplayId({
    replayId: journal.replayId,
    stateDir,
  });
  if (!receipt) {
    reclaimOrphans(journal.orphanPaths);
    unlinkApplyTxnJournal(stateDir);
    return;
  }
  if (!record) {
    reclaimOrphans(journal.orphanPaths);
    return;
  }
  if (countWritableCanonicals(record.bindings) !== 1) {
    return;
  }
  if (
    catalogMatchesIntent({
      record,
      receipt: { ...receipt, toCanonicalBindingId: journal.intendedCanonicalBindingId },
      checksum: journal.checksum,
    })
  ) {
    finalizePromotionReceipt({
      replayId: receipt.replayId,
      state: "applied",
      checksum: journal.checksum,
      stateDir,
    });
    unlinkApplyTxnJournal(stateDir);
    return;
  }
  reclaimOrphans(journal.orphanPaths);
  unlinkApplyTxnJournal(stateDir);
}

export async function applyCognitivePromotion(
  params: ApplyCognitivePromotionParams,
): Promise<ApplyCognitivePromotionResult> {
  if (!sameActor(params)) {
    return deny("actor_mismatch");
  }
  const tenantId = params.call.callerTenantId;
  const grant = params.auth.approvalGrant;
  if (!tenantId || params.auth.callerTenantId !== tenantId || grant.tenantId !== tenantId) {
    return deny("governance_approval_auth_required");
  }
  if (grant.grantKind !== "cognitive_promotion_apply") {
    return deny("grant_kind_mismatch");
  }
  const stateDir = resolveStateDir();
  recoverPromotionApplyIfNeeded({ replayId: params.replayId, stateDir });
  const receipt = getCognitivePromotionReceiptByReplayId({
    replayId: params.replayId,
    stateDir,
  });
  if (!receipt) {
    return deny("receipt_not_found");
  }
  if (receipt.tenantId !== tenantId) {
    return deny("governance_approval_auth_required");
  }
  if (grant.grantId !== receipt.grantId) {
    return deny("grant_mismatch");
  }
  if (grant.scope.kind !== "resource" || grant.scope.resourceId !== receipt.resourceId) {
    return deny("grant_scope_mismatch");
  }
  const storedDeny = inspectStoredGrant({
    grantId: grant.grantId,
    tenantId,
    requiredKind: "cognitive_promotion_apply",
    resourceId: receipt.resourceId,
    stateDir,
  });
  if (storedDeny) {
    return deny(storedDeny);
  }
  const record = loadCatalog(stateDir, receipt.resourceId);
  if (!record) {
    return deny("catalog_not_found");
  }
  if (!envelopeTenantMatches(record, tenantId)) {
    return deny("envelope_tenant_mismatch");
  }
  if (!ownershipMatches(record, params.auth)) {
    return deny("ownership_mismatch");
  }
  if (receipt.state === "applied") {
    return { ok: true, receipt, replay: true };
  }
  if (receipt.state !== "prepared") {
    return deny("receipt_not_prepared");
  }
  if (countWritableCanonicals(record.bindings) !== 1) {
    return deny("catalog_corrupt");
  }
  const canonical = writableCanonical(record);
  if (!canonical) {
    return deny("catalog_corrupt");
  }
  const bytes = readLocalCanonicalBytes(canonical.locator);
  if (!bytes) {
    return deny("canonical_bytes_missing");
  }
  const checksum = hashCanonicalBytes(bytes);
  if (catalogMatchesIntent({ record, receipt, checksum })) {
    const healed = finalizePromotionReceipt({
      replayId: receipt.replayId,
      state: "applied",
      checksum,
      stateDir,
    });
    return healed ? { ok: true, receipt: healed, replay: true } : deny("recovery_required");
  }

  const cloudWrite = Boolean(
    receipt.projectionBindingId ||
    receipt.canonicalHome === "managed_encrypted_cloud" ||
    receipt.canonicalHome === "tenant_managed_cloud" ||
    receipt.canonicalHome === "dedicated_regional" ||
    receipt.canonicalHome === "byos" ||
    receipt.canonicalHome === "cold_archive",
  );
  let keyRef: PromotionKeyRef | null = null;
  if (cloudWrite) {
    if (!receipt.region || !receipt.keyRefId) {
      return deny("key_ref_required");
    }
    const issued =
      receipt.canonicalHome === "dedicated_regional"
        ? resolveDedicatedTenantKeyRef({ call: params.call, tenantId })
        : receipt.canonicalHome === "byos"
          ? resolveByosCustomerKeyRef({ call: params.call, tenantId })
          : receipt.canonicalHome === "cold_archive"
            ? resolveArchiveTenantKeyRef({ call: params.call, tenantId })
            : resolvePlatformTenantKeyRef({ call: params.call, tenantId });
    if (!issued.ok) {
      return deny("key_ref_required");
    }
    const tenantCheck = assertKeyRefTenant({ keyRef: issued.keyRef, tenantId });
    if (!tenantCheck.ok) {
      return deny(tenantCheck.reasonCode);
    }
    if (issued.keyRef.keyRefId !== receipt.keyRefId) {
      return deny("key_ref_required");
    }
    keyRef = issued.keyRef;
  }

  if (receipt.consentVersion) {
    const scope = verifyResourceConsentScope({
      call: params.call,
      resourceId: receipt.resourceId,
    });
    if (!scope.ok) {
      return deny("consent_required");
    }
    const reverified = reverifySubjectConsent({
      call: params.call,
      resourceId: receipt.resourceId,
      consentVersion: receipt.consentVersion,
      scope: scope.scope,
    });
    if (!reverified.ok) {
      return deny("consent_required");
    }
  }

  const orphanPaths: string[] = [];
  let cloudLocator: string | null = null;
  const consentVersion =
    receipt.consentVersion ?? record.envelope.projection?.consentVersion ?? receipt.policyVersion;
  const policyVersion = receipt.policyVersion ?? record.envelope.projection?.policyVersion;
  if (!consentVersion || !policyVersion) {
    return deny("projection_envelope_invalid");
  }
  const currentTombstone = Number(record.envelope.projection?.tombstoneVersion ?? "0");

  if (cloudWrite && keyRef && receipt.region) {
    const objectKey = receipt.resourceId;
    if (receipt.canonicalHome === "cold_archive") {
      if (keyRef.kind !== "archive_tenant") {
        return deny("dedicated_key_unsupported");
      }
      const encrypted = encryptColdArchiveObject({
        bytes,
        tenantId,
        region: receipt.region,
        keyRef,
      });
      cloudLocator = writeColdArchiveObject({
        stateDir,
        objectKey,
        object: encrypted,
      });
      orphanPaths.push(cloudLocator);
    } else if (receipt.canonicalHome === "byos") {
      if (keyRef.kind !== "byos_customer") {
        return deny("dedicated_key_unsupported");
      }
      const encrypted = encryptByosObject({
        bytes,
        tenantId,
        region: receipt.region,
        keyRef,
      });
      cloudLocator = writeByosObject({
        stateDir,
        objectKey,
        object: encrypted,
      });
      orphanPaths.push(cloudLocator);
    } else if (receipt.canonicalHome === "dedicated_regional") {
      if (keyRef.kind !== "dedicated_tenant") {
        return deny("dedicated_key_unsupported");
      }
      const encrypted = encryptDedicatedRegionalObject({
        bytes,
        tenantId,
        region: receipt.region,
        keyRef,
      });
      cloudLocator = writeDedicatedRegionalObject({
        stateDir,
        objectKey,
        object: encrypted,
      });
      orphanPaths.push(cloudLocator);
    } else if (receipt.canonicalHome === "tenant_managed_cloud") {
      if (keyRef.kind !== "platform_tenant") {
        return deny("dedicated_key_unsupported");
      }
      const encrypted = encryptTenantManagedCloudObject({
        bytes,
        tenantId,
        region: receipt.region,
        keyRef,
      });
      cloudLocator = writeTenantManagedCloudObject({
        stateDir,
        objectKey,
        object: encrypted,
      });
      orphanPaths.push(cloudLocator);
    } else {
      if (keyRef.kind !== "platform_tenant") {
        return deny("dedicated_key_unsupported");
      }
      const encrypted = encryptManagedCloudObject({
        bytes,
        tenantId,
        region: receipt.region,
        keyRef,
      });
      cloudLocator = writeManagedEncryptedCloudObject({
        stateDir,
        objectKey,
        object: encrypted,
      });
      orphanPaths.push(cloudLocator);
      if (receipt.projectionBindingId) {
        const envelope = buildProjectionEnvelope({
          resourceId: receipt.resourceId,
          contentVersion: receipt.contentVersion,
          checksum,
          consentVersion,
          policyVersion,
          tombstoneVersion: currentTombstone,
        });
        if (!parseCloudProjectionEnvelope(envelope)) {
          return deny("projection_envelope_invalid");
        }
        const written = writeCloudProjection({
          stateDir,
          tenantId,
          envelope,
          encryptedBody: encrypted,
        });
        orphanPaths.push(written.envelopePath, written.bodyPath);
        cloudLocator = written.envelopePath;
      }
    }
  } else {
    writeLocalCanonicalBytes({ locator: canonical.locator, bytes });
  }

  writeApplyTxnJournal(stateDir, {
    schemaVersion: 1,
    kind: "cognitive_promotion_apply_txn",
    replayId: receipt.replayId,
    resourceId: receipt.resourceId,
    tenantId,
    checksum,
    intendedCanonicalBindingId: receipt.toCanonicalBindingId,
    orphanPaths,
  });
  if (isTestRuntime() && params.faultAfter === "adapter") {
    throw new Error("fault_inject:adapter");
  }

  const nextBindings = intendedBindings({
    record,
    receipt,
    localLocator: canonical.locator,
    cloudLocator,
    checksum,
  });
  if (countWritableCanonicals(nextBindings) !== 1) {
    reclaimOrphans(orphanPaths);
    unlinkApplyTxnJournal(stateDir);
    return deny("catalog_corrupt");
  }
  const now = new Date().toISOString();
  const projectionEnvelope = buildProjectionEnvelope({
    resourceId: receipt.resourceId,
    contentVersion: receipt.contentVersion,
    checksum,
    consentVersion,
    policyVersion,
    tombstoneVersion: currentTombstone,
  });
  const cas = await catalogStore(stateDir).compareAndPut({
    resourceId: receipt.resourceId,
    expectedGovernanceVersion: record.envelope.governanceVersion,
    next: {
      envelope: {
        ...record.envelope,
        canonicalBindingId: receipt.toCanonicalBindingId,
        governanceVersion: record.envelope.governanceVersion + 1,
        updatedAt: now,
        ...(projectionEnvelope ? { projection: catalogProjectionFields(projectionEnvelope) } : {}),
      },
      bindings: nextBindings,
    },
  });
  if (!cas.ok) {
    reclaimOrphans(orphanPaths);
    unlinkApplyTxnJournal(stateDir);
    return deny("catalog_cas_conflict");
  }
  if (isTestRuntime() && params.faultAfter === "catalog_cas") {
    throw new Error("fault_inject:catalog_cas");
  }
  const applied = finalizePromotionReceipt({
    replayId: receipt.replayId,
    state: "applied",
    checksum,
    stateDir,
  });
  unlinkApplyTxnJournal(stateDir);
  if (!applied || applied.state !== "applied") {
    return deny("recovery_required");
  }
  return { ok: true, receipt: applied, replay: false };
}

export async function tombstoneCognitiveProjection(
  params: TombstoneCognitiveProjectionParams,
): Promise<TombstoneCognitiveProjectionResult> {
  if (!sameActor(params)) {
    return denyTombstone("actor_mismatch");
  }
  const tenantId = params.call.callerTenantId;
  const grant = params.auth.approvalGrant;
  if (!tenantId || params.auth.callerTenantId !== tenantId || grant.tenantId !== tenantId) {
    return denyTombstone("governance_approval_auth_required");
  }
  if (grant.grantKind !== "cognitive_projection_tombstone") {
    return denyTombstone("grant_kind_mismatch");
  }
  if (grant.scope.kind !== "resource" || grant.scope.resourceId !== params.resourceId) {
    return denyTombstone("grant_scope_mismatch");
  }
  const stateDir = resolveStateDir();
  const storedDeny = inspectStoredGrant({
    grantId: grant.grantId,
    tenantId,
    requiredKind: "cognitive_projection_tombstone",
    resourceId: params.resourceId,
    stateDir,
  });
  if (storedDeny) {
    return denyTombstone(storedDeny);
  }
  const record = loadCatalog(stateDir, params.resourceId);
  if (!record) {
    return denyTombstone("catalog_not_found");
  }
  if (!envelopeTenantMatches(record, tenantId)) {
    return denyTombstone("envelope_tenant_mismatch");
  }
  if (!ownershipMatches(record, params.auth)) {
    return denyTombstone("ownership_mismatch");
  }
  if (countWritableCanonicals(record.bindings) !== 1) {
    return denyTombstone("catalog_corrupt");
  }
  const replayId = computeTombstoneReplayId({
    grantId: grant.grantId,
    resourceId: params.resourceId,
  });
  const existing = getCognitiveProjectionTombstoneReceipt({ replayId, stateDir });
  if (existing?.state === "applied") {
    return { ok: true, receipt: existing, replay: true };
  }
  const now = new Date().toISOString();
  const prepared = uniqueCreateTombstoneReceipt({
    receipt: {
      kind: "cognitive_projection_tombstone_receipt",
      receiptId: `cprt_${replayId}`,
      replayId,
      grantId: grant.grantId,
      resourceId: params.resourceId,
      tenantId,
      tombstoneVersion: 1,
      state: "prepared",
      createdAt: now,
      updatedAt: now,
    },
    stateDir,
  });
  if (!prepared.ok) {
    return denyTombstone("receipt_not_found");
  }
  if (prepared.receipt.state === "applied") {
    return { ok: true, receipt: prepared.receipt, replay: true };
  }
  if (prepared.receipt.state !== "prepared") {
    return denyTombstone("receipt_not_prepared");
  }
  const current = readCloudProjectionEnvelope({
    stateDir,
    tenantId,
    resourceId: params.resourceId,
  });
  const currentTombstone =
    current?.tombstoneVersion ?? Number(record.envelope.projection?.tombstoneVersion ?? "0");
  const checksum = current?.checksum ?? record.envelope.projection?.checksum;
  const consentVersion = current?.consentVersion ?? record.envelope.projection?.consentVersion;
  const policyVersion = current?.policyVersion ?? record.envelope.projection?.policyVersion;
  if (!checksum || !consentVersion || !policyVersion) {
    return denyTombstone("projection_envelope_invalid");
  }
  const envelope = buildProjectionEnvelope({
    resourceId: params.resourceId,
    contentVersion: current?.contentVersion ?? record.envelope.projection?.contentVersion ?? "v1",
    checksum,
    consentVersion,
    policyVersion,
    tombstoneVersion: currentTombstone + 1,
  });
  const tombstone = writeProjectionTombstone({ stateDir, tenantId, envelope });
  if (isTestRuntime() && params.faultAfter === "tombstone") {
    throw new Error("fault_inject:tombstone");
  }
  if (tombstone.checksum.length === 0) {
    return denyTombstone("projection_envelope_invalid");
  }
  if (isTestRuntime() && params.faultAfter === "tombstone_checksum") {
    throw new Error("fault_inject:tombstone_checksum");
  }
  const cas = await catalogStore(stateDir).compareAndPut({
    resourceId: params.resourceId,
    expectedGovernanceVersion: record.envelope.governanceVersion,
    next: {
      envelope: {
        ...record.envelope,
        governanceVersion: record.envelope.governanceVersion + 1,
        updatedAt: new Date().toISOString(),
        projection: catalogProjectionFields(envelope),
      },
      bindings: record.bindings,
    },
  });
  if (!cas.ok) {
    return denyTombstone("catalog_cas_conflict");
  }
  if (isTestRuntime() && params.faultAfter === "catalog_cas") {
    throw new Error("fault_inject:catalog_cas");
  }
  markProjectionBodyUnreadable({ stateDir, tenantId, resourceId: params.resourceId });
  const finalized = finalizeTombstoneReceipt({
    replayId,
    state: "applied",
    checksum,
    tombstoneVersion: envelope.tombstoneVersion,
    stateDir,
  });
  if (!finalized || finalized.state !== "applied") {
    return denyTombstone("recovery_required");
  }
  return { ok: true, receipt: finalized, replay: false };
}

export function serveCloudProjection(params: {
  call: GovernanceAuthenticatedCall;
  resourceId: string;
  stateDir?: string;
}): { ok: true; envelope: CloudProjectionEnvelope } | { ok: false; error: PromotionApplyDenyCode } {
  if (!isGovernanceAuthenticatedCall(params.call)) {
    return { ok: false, error: "governance_approval_auth_required" };
  }
  const tenantId = params.call.callerTenantId;
  if (!tenantId) {
    return { ok: false, error: "governance_approval_auth_required" };
  }
  const stateDir = params.stateDir ?? resolveStateDir();
  const record = loadCatalog(stateDir, params.resourceId);
  if (!record) {
    return { ok: false, error: "catalog_not_found" };
  }
  if (!envelopeTenantMatches(record, tenantId)) {
    return { ok: false, error: "envelope_tenant_mismatch" };
  }
  const writableCanonical = record.bindings.find(
    (binding) => binding.role === "canonical" && binding.state === "active",
  );
  if (
    writableCanonical?.locator &&
    (writableCanonical.locator.includes("/data-governance/cold-archive/") ||
      writableCanonical.locator.includes("\\data-governance\\cold-archive\\"))
  ) {
    return { ok: false, error: "archive_recall_denied" };
  }
  const catalogTombstone = Number(record.envelope.projection?.tombstoneVersion ?? "0");
  const catalogChecksum = record.envelope.projection?.checksum;
  const tombstone = readProjectionTombstone({
    stateDir,
    tenantId,
    resourceId: params.resourceId,
  });
  if (tombstone && tombstone.tombstoneVersion >= catalogTombstone) {
    return { ok: false, error: "recovery_required" };
  }
  const envelope = readCloudProjectionEnvelope({
    stateDir,
    tenantId,
    resourceId: params.resourceId,
  });
  if (!envelope) {
    return { ok: false, error: "projection_envelope_invalid" };
  }
  if (
    envelope.tombstoneVersion !== catalogTombstone ||
    envelope.checksum !== catalogChecksum ||
    envelope.contentVersion !==
      (record.envelope.projection?.contentVersion ?? envelope.contentVersion)
  ) {
    return { ok: false, error: "recovery_required" };
  }
  if (!envelope.checksum || !envelope.consentVersion || envelope.tombstoneVersion < 0) {
    return { ok: false, error: "projection_envelope_invalid" };
  }
  return { ok: true, envelope };
}

export {
  laterWaveAdapterAvailability,
  laterWaveAdapterUnavailable,
  unlinkByosObject,
  unlinkColdArchiveObject,
  unlinkDedicatedRegionalObject,
  unlinkManagedEncryptedCloudObject,
  unlinkTenantManagedCloudObject,
};
