/**
 * P4-d placement export / restore. Reapplies binding image only.
 * Never rewrites resourceId / agentAssetId. Not a promotion grant. Not P5.
 */
import { createHash } from "node:crypto";
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
import { canonicalizeCognitiveJson } from "./cognitive-mutation-store.js";
import {
  countWritableCanonicals,
  hashCanonicalBytes,
  readLocalCanonicalBytes,
} from "./cognitive-promotion-adapters.js";
import {
  isGovernanceAuthenticatedCall,
  type GovernanceAuthenticatedCall,
} from "./cognitive-recommendation-auth.js";
import { resolveDataGovernanceCatalogPath } from "./paths.js";
import {
  finalizePlacementExportReceipt,
  getPlacementExportImage,
  getPlacementExportReceipt,
  parsePlacementExportReceipt,
  uniqueCreatePlacementExportReceipt,
} from "./placement-export-store.js";
import type { CatalogRecord, PlacementExportReceipt, StorageBinding } from "./types.js";
import { assertOwnershipProofMatches } from "./write-gate.js";

const FORBIDDEN_BUNDLE_MEMBERS = new Set(["credentials", "outbox", "cursors", "locks", "caches"]);
const ALLOWED_BUNDLE_KEYS = new Set(["kind", "receipt", "bindings"]);
const ALLOWED_PLACEMENT_STORAGE = new Set(["filesystem", "sqlite", "object-store", "byos"]);
const BINDING_KEYS = new Set([
  "bindingId",
  "resourceId",
  "role",
  "storageKind",
  "locator",
  "state",
  "contentVersion",
  "objectKey",
]);
const STORAGE_ROLES = new Set([
  "canonical",
  "replica",
  "derived",
  "archive",
  "cache",
  "compatibility",
]);
const STORAGE_KINDS = new Set(["filesystem", "sqlite", "postgres", "object-store", "byos"]);
const BINDING_STATES = new Set(["active", "read_only", "retired"]);

export type PlacementExportDenyCode =
  | "governance_approval_auth_required"
  | "actor_mismatch"
  | "grant_kind_mismatch"
  | "grant_scope_mismatch"
  | "grant_tenant_mismatch"
  | "grant_revoked"
  | "grant_expired"
  | "grant_mismatch"
  | "envelope_tenant_mismatch"
  | "ownership_mismatch"
  | "catalog_not_found"
  | "catalog_corrupt"
  | "canonical_bytes_missing"
  | "first_wave_adapter_unavailable"
  | "identity_rewrite_rejected"
  | "bundle_member_excluded"
  | "catalog_cas_conflict"
  | "receipt_not_found"
  | "receipt_not_applied"
  | "projection_as_canonical"
  | "bindings_integrity_mismatch"
  | "recovery_required";

export type PlacementExportBundle = {
  kind: "p4_placement_export_bundle";
  receipt: PlacementExportReceipt;
  bindings: StorageBinding[];
};

export type ExportPlacementParams = {
  call: GovernanceAuthenticatedCall;
  auth: GovernanceApprovalAuth;
  resourceId: string;
};

export type RestorePlacementParams = {
  call: GovernanceAuthenticatedCall;
  auth: GovernanceApprovalAuth;
  bundle: PlacementExportBundle;
};

export type PlacementExportResult =
  | { ok: true; receipt: PlacementExportReceipt; bundle: PlacementExportBundle; replay: boolean }
  | { ok: false; error: PlacementExportDenyCode };

export type PlacementRestoreResult =
  | { ok: true; receipt: PlacementExportReceipt; replay: boolean }
  | { ok: false; error: PlacementExportDenyCode };

function deny(error: PlacementExportDenyCode): PlacementExportResult {
  return { ok: false, error };
}

function denyRestore(error: PlacementExportDenyCode): PlacementRestoreResult {
  return { ok: false, error };
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

function ownershipMatches(record: CatalogRecord, auth: GovernanceApprovalAuth): boolean {
  try {
    assertOwnershipProofMatches(record, auth.ownershipProof);
    return true;
  } catch {
    const proof = auth.ownershipProof;
    const envelope = record.envelope;
    return (
      proof.owner.kind === "user" &&
      envelope.owner.kind === "user" &&
      proof.owner.userId === envelope.owner.userId &&
      proof.scope.kind === "tenant" &&
      envelope.tenantId === proof.scope.tenantId &&
      envelope.scope.kind === "user" &&
      envelope.scope.userId === proof.owner.userId
    );
  }
}

function inspectExportGrant(params: {
  grantId: string;
  tenantId: string;
  resourceId: string;
  stateDir: string;
}): PlacementExportDenyCode | null {
  const stored = readGovernanceApprovalGrant({
    grantId: params.grantId,
    tenantId: params.tenantId,
    stateDir: params.stateDir,
  });
  if (!stored) {
    return "governance_approval_auth_required";
  }
  if (stored.grantKind !== "placement_export_restore") {
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

function authorize(params: {
  call: GovernanceAuthenticatedCall;
  auth: GovernanceApprovalAuth;
  resourceId: string;
  stateDir: string;
}):
  | { ok: true; tenantId: string; record: CatalogRecord }
  | { ok: false; error: PlacementExportDenyCode } {
  if (!sameActor(params)) {
    return { ok: false, error: "actor_mismatch" };
  }
  const tenantId = params.call.callerTenantId;
  const grant = params.auth.approvalGrant;
  if (!tenantId || params.auth.callerTenantId !== tenantId || grant.tenantId !== tenantId) {
    return { ok: false, error: "governance_approval_auth_required" };
  }
  if (grant.grantKind !== "placement_export_restore") {
    return { ok: false, error: "grant_kind_mismatch" };
  }
  if (grant.scope.kind !== "resource" || grant.scope.resourceId !== params.resourceId) {
    return { ok: false, error: "grant_scope_mismatch" };
  }
  const storedDeny = inspectExportGrant({
    grantId: grant.grantId,
    tenantId,
    resourceId: params.resourceId,
    stateDir: params.stateDir,
  });
  if (storedDeny) {
    return { ok: false, error: storedDeny };
  }
  const record = loadCatalog(params.stateDir, params.resourceId);
  if (!record) {
    return { ok: false, error: "catalog_not_found" };
  }
  if (record.envelope.tenantId !== tenantId) {
    return { ok: false, error: "envelope_tenant_mismatch" };
  }
  if (!ownershipMatches(record, params.auth)) {
    return { ok: false, error: "ownership_mismatch" };
  }
  return { ok: true, tenantId, record };
}

function agentAssetIdOf(record: CatalogRecord): string {
  return record.envelope.projection?.agentAssetId ?? record.envelope.resourceId;
}

function parseStorageBinding(value: unknown): StorageBinding | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const raw = value as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (!BINDING_KEYS.has(key)) {
      return null;
    }
  }
  if (
    typeof raw.bindingId !== "string" ||
    raw.bindingId.trim() === "" ||
    typeof raw.resourceId !== "string" ||
    raw.resourceId.trim() === "" ||
    typeof raw.locator !== "string" ||
    raw.locator.trim() === "" ||
    typeof raw.contentVersion !== "string" ||
    raw.contentVersion.trim() === "" ||
    typeof raw.role !== "string" ||
    !STORAGE_ROLES.has(raw.role) ||
    typeof raw.storageKind !== "string" ||
    !STORAGE_KINDS.has(raw.storageKind) ||
    typeof raw.state !== "string" ||
    !BINDING_STATES.has(raw.state)
  ) {
    return null;
  }
  if (raw.objectKey !== undefined && raw.objectKey !== null && typeof raw.objectKey !== "string") {
    return null;
  }
  if (typeof raw.objectKey === "string" && raw.objectKey.trim() === "") {
    return null;
  }
  return {
    bindingId: raw.bindingId,
    resourceId: raw.resourceId,
    role: raw.role as StorageBinding["role"],
    storageKind: raw.storageKind as StorageBinding["storageKind"],
    locator: raw.locator,
    state: raw.state as StorageBinding["state"],
    contentVersion: raw.contentVersion,
    ...(raw.objectKey === undefined ? {} : { objectKey: raw.objectKey }),
  };
}

function canonicalBinding(binding: StorageBinding) {
  return {
    bindingId: binding.bindingId,
    resourceId: binding.resourceId,
    role: binding.role,
    storageKind: binding.storageKind,
    locator: binding.locator,
    state: binding.state,
    contentVersion: binding.contentVersion,
    objectKey: binding.objectKey ?? null,
  };
}

function parseBindingImage(value: unknown): StorageBinding[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }
  const bindings: StorageBinding[] = [];
  for (const entry of value) {
    const parsed = parseStorageBinding(entry);
    if (!parsed) {
      return null;
    }
    bindings.push(parsed);
  }
  return bindings;
}

function hashBindings(bindings: readonly StorageBinding[]): string {
  const canonical = [...bindings]
    .map(canonicalBinding)
    .toSorted((left, right) => left.bindingId.localeCompare(right.bindingId));
  return createHash("sha256").update(canonicalizeCognitiveJson(canonical), "utf8").digest("hex");
}

function receiptFieldsMatch(left: PlacementExportReceipt, right: PlacementExportReceipt): boolean {
  return (
    left.receiptId === right.receiptId &&
    left.replayId === right.replayId &&
    left.grantId === right.grantId &&
    left.resourceId === right.resourceId &&
    left.agentAssetId === right.agentAssetId &&
    left.tenantId === right.tenantId &&
    left.fromBindingId === right.fromBindingId &&
    left.toCanonicalBindingId === right.toCanonicalBindingId &&
    left.projectionBindingId === right.projectionBindingId &&
    left.canonicalHome === right.canonicalHome &&
    left.mode === right.mode &&
    left.contentVersion === right.contentVersion &&
    left.checksum === right.checksum &&
    left.bindingsChecksum === right.bindingsChecksum &&
    left.state === right.state
  );
}

function isTenantManagedCloudLocator(locator: string): boolean {
  return locator.includes("/tenant-managed-cloud/") || locator.includes("\\tenant-managed-cloud\\");
}

function isDedicatedRegionalLocator(locator: string): boolean {
  return locator.includes("/dedicated-regional/") || locator.includes("\\dedicated-regional\\");
}

function isByosLocator(locator: string): boolean {
  return (
    locator.includes("/data-governance/byos/") || locator.includes("\\data-governance\\byos\\")
  );
}

function isColdArchiveLocator(locator: string): boolean {
  return (
    locator.includes("/data-governance/cold-archive/") ||
    locator.includes("\\data-governance\\cold-archive\\")
  );
}

function placementFromBindings(bindings: readonly StorageBinding[]): {
  canonicalHome: PlacementExportReceipt["canonicalHome"];
  mode: PlacementExportReceipt["mode"];
  canonical: StorageBinding;
  fromBindingId: string;
  projectionBindingId: string | null;
} | null {
  const canonicals = bindings.filter((b) => b.role === "canonical" && b.state === "active");
  if (canonicals.length !== 1) {
    return null;
  }
  const canonical = canonicals[0];
  if (!ALLOWED_PLACEMENT_STORAGE.has(canonical.storageKind)) {
    return null;
  }
  const replica = bindings.find((b) => b.role === "replica");
  const projection = bindings.find((b) => b.role === "derived") ?? null;
  const byosCanonical = canonical.storageKind === "byos" || isByosLocator(canonical.locator);
  const cloudCanonical = canonical.storageKind === "object-store";
  const tenantCloudCanonical = cloudCanonical && isTenantManagedCloudLocator(canonical.locator);
  const dedicatedCanonical = cloudCanonical && isDedicatedRegionalLocator(canonical.locator);
  const archiveCanonical = cloudCanonical && isColdArchiveLocator(canonical.locator);
  return {
    canonicalHome: byosCanonical
      ? "byos"
      : archiveCanonical
        ? "cold_archive"
        : dedicatedCanonical
          ? "dedicated_regional"
          : tenantCloudCanonical
            ? "tenant_managed_cloud"
            : cloudCanonical
              ? "managed_encrypted_cloud"
              : "local",
    mode: byosCanonical
      ? "byos"
      : archiveCanonical
        ? "cold-archive"
        : dedicatedCanonical
          ? "dedicated"
          : tenantCloudCanonical
            ? "tenant-cloud"
            : cloudCanonical || projection
              ? "encrypted-cloud"
              : "local-only",
    canonical,
    fromBindingId: replica?.bindingId ?? canonical.bindingId,
    projectionBindingId: projection?.bindingId ?? null,
  };
}

function computeReplayId(params: {
  grantId: string;
  resourceId: string;
  fromBindingId: string;
  toCanonicalBindingId: string;
  checksum: string;
  bindingsChecksum: string;
}): string {
  return createHash("sha256")
    .update(
      `${params.grantId}\0${params.resourceId}\0${params.fromBindingId}\0${params.toCanonicalBindingId}\0${params.checksum}\0${params.bindingsChecksum}`,
      "utf8",
    )
    .digest("hex");
}

function parseBundle(value: unknown): PlacementExportBundle | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const raw = value as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (FORBIDDEN_BUNDLE_MEMBERS.has(key) || !ALLOWED_BUNDLE_KEYS.has(key)) {
      return null;
    }
  }
  if (raw.kind !== "p4_placement_export_bundle") {
    return null;
  }
  const receipt = parsePlacementExportReceipt(raw.receipt);
  if (!receipt) {
    return null;
  }
  if (!Array.isArray(raw.bindings) || raw.bindings.length === 0) {
    return null;
  }
  const bindings = parseBindingImage(raw.bindings);
  if (!bindings) {
    return null;
  }
  return { kind: "p4_placement_export_bundle", receipt, bindings };
}

function bindingsMatchImage(record: CatalogRecord, image: readonly StorageBinding[]): boolean {
  return hashBindings(record.bindings) === hashBindings(image);
}

export function exportPlacement(params: ExportPlacementParams): PlacementExportResult {
  const stateDir = resolveStateDir();
  const authorized = authorize({ ...params, stateDir });
  if (!authorized.ok) {
    return deny(authorized.error);
  }
  const { tenantId, record } = authorized;
  if (countWritableCanonicals(record.bindings) !== 1) {
    return deny("catalog_corrupt");
  }
  const placement = placementFromBindings(record.bindings);
  if (!placement) {
    return deny("first_wave_adapter_unavailable");
  }
  const bytes = readLocalCanonicalBytes(
    record.bindings.find((b) => b.role === "replica" && b.storageKind === "filesystem")?.locator ??
      placement.canonical.locator,
  );
  if (!bytes && placement.canonical.storageKind !== "object-store") {
    return deny("canonical_bytes_missing");
  }
  const checksum = bytes ? hashCanonicalBytes(bytes) : (record.envelope.projection?.checksum ?? "");
  if (!checksum) {
    return deny("canonical_bytes_missing");
  }
  const image = parseBindingImage(record.bindings);
  if (!image) {
    return deny("catalog_corrupt");
  }
  const bindingsChecksum = hashBindings(image);
  const now = new Date().toISOString();
  const replayId = computeReplayId({
    grantId: params.auth.approvalGrant.grantId,
    resourceId: params.resourceId,
    fromBindingId: placement.fromBindingId,
    toCanonicalBindingId: placement.canonical.bindingId,
    checksum,
    bindingsChecksum,
  });
  const existing = getPlacementExportReceipt({ replayId, stateDir });
  if (existing?.state === "applied") {
    const stored = getPlacementExportImage({ replayId, stateDir });
    if (!stored || hashBindings(stored) !== existing.bindingsChecksum) {
      return deny("recovery_required");
    }
    return {
      ok: true,
      receipt: existing,
      bundle: { kind: "p4_placement_export_bundle", receipt: existing, bindings: stored },
      replay: true,
    };
  }
  const prepared: PlacementExportReceipt = {
    kind: "p4_placement_export_receipt",
    receiptId: `per_${replayId}`,
    replayId,
    grantId: params.auth.approvalGrant.grantId,
    resourceId: record.envelope.resourceId,
    agentAssetId: agentAssetIdOf(record),
    tenantId,
    fromBindingId: placement.fromBindingId,
    toCanonicalBindingId: placement.canonical.bindingId,
    projectionBindingId: placement.projectionBindingId,
    canonicalHome: placement.canonicalHome,
    mode: placement.mode,
    contentVersion: placement.canonical.contentVersion,
    checksum,
    bindingsChecksum,
    state: "prepared",
    createdAt: now,
    updatedAt: now,
  };
  const created = uniqueCreatePlacementExportReceipt({
    receipt: prepared,
    bindings: image,
    stateDir,
  });
  if (!created.ok) {
    return deny("receipt_not_found");
  }
  if (created.receipt.state === "applied") {
    const stored = getPlacementExportImage({ replayId, stateDir });
    if (!stored || hashBindings(stored) !== created.receipt.bindingsChecksum) {
      return deny("recovery_required");
    }
    return {
      ok: true,
      receipt: created.receipt,
      bundle: {
        kind: "p4_placement_export_bundle",
        receipt: created.receipt,
        bindings: stored,
      },
      replay: true,
    };
  }
  const applied = finalizePlacementExportReceipt({
    replayId,
    state: "applied",
    stateDir,
  });
  if (!applied || applied.state !== "applied") {
    return deny("recovery_required");
  }
  return {
    ok: true,
    receipt: applied,
    bundle: { kind: "p4_placement_export_bundle", receipt: applied, bindings: image },
    replay: false,
  };
}

export async function restorePlacement(
  params: RestorePlacementParams,
): Promise<PlacementRestoreResult> {
  const parsed = parseBundle(params.bundle);
  if (!parsed) {
    return denyRestore("bundle_member_excluded");
  }
  if (parsed.receipt.state !== "applied") {
    return denyRestore("receipt_not_applied");
  }
  const stateDir = resolveStateDir();
  const durable = getPlacementExportReceipt({
    replayId: parsed.receipt.replayId,
    stateDir,
  });
  if (!durable || durable.state !== "applied") {
    return denyRestore("receipt_not_found");
  }
  const durableImage = parseBindingImage(
    getPlacementExportImage({
      replayId: parsed.receipt.replayId,
      stateDir,
    }) ?? [],
  );
  if (!durableImage || hashBindings(durableImage) !== durable.bindingsChecksum) {
    return denyRestore("recovery_required");
  }
  if (!receiptFieldsMatch(parsed.receipt, durable)) {
    return denyRestore("identity_rewrite_rejected");
  }
  if (hashBindings(parsed.bindings) !== durable.bindingsChecksum) {
    return denyRestore("bindings_integrity_mismatch");
  }
  if (params.auth.approvalGrant.grantId !== durable.grantId) {
    return denyRestore("grant_mismatch");
  }
  const authorized = authorize({
    call: params.call,
    auth: params.auth,
    resourceId: durable.resourceId,
    stateDir,
  });
  if (!authorized.ok) {
    return denyRestore(authorized.error);
  }
  const { tenantId, record } = authorized;
  if (durable.resourceId !== record.envelope.resourceId) {
    return denyRestore("identity_rewrite_rejected");
  }
  if (durable.agentAssetId !== agentAssetIdOf(record)) {
    return denyRestore("identity_rewrite_rejected");
  }
  if (durable.tenantId !== tenantId) {
    return denyRestore("envelope_tenant_mismatch");
  }
  for (const binding of durableImage) {
    if (binding.resourceId !== record.envelope.resourceId) {
      return denyRestore("identity_rewrite_rejected");
    }
    if (!ALLOWED_PLACEMENT_STORAGE.has(binding.storageKind)) {
      return denyRestore("first_wave_adapter_unavailable");
    }
  }
  const canonicals = durableImage.filter((b) => b.role === "canonical" && b.state === "active");
  if (canonicals.length !== 1) {
    return denyRestore("catalog_corrupt");
  }
  const canonical = canonicals[0];
  if (canonical.bindingId === durable.projectionBindingId) {
    return denyRestore("projection_as_canonical");
  }
  const placement = placementFromBindings(durableImage);
  if (!placement) {
    return denyRestore("first_wave_adapter_unavailable");
  }
  if (
    placement.canonical.bindingId !== durable.toCanonicalBindingId ||
    placement.fromBindingId !== durable.fromBindingId ||
    placement.projectionBindingId !== durable.projectionBindingId ||
    placement.canonicalHome !== durable.canonicalHome ||
    placement.mode !== durable.mode ||
    placement.canonical.contentVersion !== durable.contentVersion
  ) {
    return denyRestore("identity_rewrite_rejected");
  }
  if (bindingsMatchImage(record, durableImage)) {
    return { ok: true, receipt: durable, replay: true };
  }
  const now = new Date().toISOString();
  const cas = await catalogStore(stateDir).compareAndPut({
    resourceId: record.envelope.resourceId,
    expectedGovernanceVersion: record.envelope.governanceVersion,
    next: {
      envelope: {
        ...record.envelope,
        canonicalBindingId: durable.toCanonicalBindingId,
        governanceVersion: record.envelope.governanceVersion + 1,
        updatedAt: now,
      },
      bindings: durableImage,
    },
  });
  if (!cas.ok) {
    return denyRestore("catalog_cas_conflict");
  }
  if (cas.record.envelope.resourceId !== record.envelope.resourceId) {
    return denyRestore("identity_rewrite_rejected");
  }
  if (agentAssetIdOf(cas.record) !== durable.agentAssetId) {
    return denyRestore("identity_rewrite_rejected");
  }
  if (hashBindings(cas.record.bindings) !== durable.bindingsChecksum) {
    return denyRestore("bindings_integrity_mismatch");
  }
  return { ok: true, receipt: durable, replay: false };
}
