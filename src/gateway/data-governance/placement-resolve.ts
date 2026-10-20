/**
 * P4-a placement / residency resolver (pure decision).
 * Does not write Catalog, invoke storage writers, consume grants, or read cognitive scores.
 */
import {
  isPlatformDeploymentRegionReceipt,
  isResourceConsentScope,
  isSubjectConsentProof,
  placementAuthTenantId,
  placementTrustedNowMs,
} from "./placement-platform-verify.js";
import type {
  PlatformDeploymentRegionReceipt,
  ResourceConsentScope,
  SubjectConsentProof,
} from "./placement-platform-verify.js";
import type { DataClassification } from "./types.js";

export type { PlatformDeploymentRegionReceipt, ResourceConsentScope, SubjectConsentProof };

export const PLACEMENT_DENY_REASONS = [
  "missing_auth_tenant",
  "missing_placement_policy",
  "missing_sync_classification",
  "missing_classification",
  "policy_conflict",
  "custodian_not_allowed",
  "residency_conflict",
  "offline_requires_local_canonical",
  "offline_conflicts_managed_cloud",
  "dedicated_key_unsupported",
  "dedicated_database_unsupported",
  "replication_unsupported",
  "sync_class_blocked",
  "sync_class_not_first_wave",
  "legal_hold_blocks_placement_change",
  "first_wave_adapter_unavailable",
  "missing_trusted_region",
  "consent_required",
] as const;

export type PlacementDenyReason = (typeof PLACEMENT_DENY_REASONS)[number];

export type SyncClassification =
  | "blocked"
  | "local-only"
  | "tenant-only"
  | "eligible-with-consent"
  | "encrypted-cloud"
  | "tenant-cloud"
  | "byos-only"
  | "archive-only";

export type PlacementCustodian = "device" | "openbot" | "tenant" | "byos";

export type PlacementPolicy = {
  allowedCustodians: readonly PlacementCustodian[];
  allowedRegions: readonly string[];
  requireDedicatedKey: boolean;
  requireDedicatedDatabase: boolean;
  offlineRequired: boolean;
  replicationClass: "none" | "local" | "regional" | "multi-region";
};

const TRUSTED_REGION_BRAND = Symbol("openbot.placement.trustedRegionDefault");

export type TrustedRegionDefault = {
  readonly [TRUSTED_REGION_BRAND]: true;
  readonly region: string;
  readonly tenantId: string;
  readonly receiptId: string;
};

export type UntrustedRegionSource = "client" | "envelope" | "cogniweave" | "tenant_contract";

export type PlacementResolverInput = {
  tenantId: string;
  ownerScope: "user_owned" | "position_owned" | "group_owned";
  controllerId: string;
  classification: DataClassification | null;
  retentionClass: string | null;
  legalHoldActive: boolean;
  residencyRequiredRegions: readonly string[] | null;
  deploymentProfile: "personal" | "managed_enterprise" | "dedicated";
  trustedRegionDefault: TrustedRegionDefault | null;
  tenantContract: PlacementPolicy | null;
  requestedOfflineRequired: boolean | null;
  costObjective: "standard" | "archive_preferred" | null;
  recoveryObjective: "local" | "regional" | null;
  syncClassification: SyncClassification | null;
  resourceConsentScope: ResourceConsentScope | null;
  subjectConsent: SubjectConsentProof | null;
};

export type PlacementResolverOutput =
  | {
      ok: true;
      mode:
        | "local-only"
        | "encrypted-cloud"
        | "tenant-cloud"
        | "dedicated"
        | "byos"
        | "cold-archive";
      canonicalHome:
        | "local"
        | "managed_encrypted_cloud"
        | "tenant_managed_cloud"
        | "dedicated_regional"
        | "byos"
        | "cold_archive";
      projection: "none" | "managed_encrypted_cloud";
      region: string | null;
      keyRef:
        | { kind: "platform_tenant"; keyRefId: string; tenantId: string }
        | { kind: "dedicated_tenant"; keyRefId: string; tenantId: string }
        | { kind: "byos_customer"; keyRefId: string; tenantId: string }
        | { kind: "archive_tenant"; keyRefId: string; tenantId: string }
        | null;
      replicationClass: "none" | "local" | "regional";
      reasonCode: "resolved";
    }
  | { ok: false; reasonCode: PlacementDenyReason };

const CLASSIFICATIONS = new Set<DataClassification>([
  "public",
  "internal",
  "confidential",
  "restricted",
]);

const LATER_WAVE_SYNC = new Set<SyncClassification>(["tenant-only"]);

function deny(reasonCode: PlacementDenyReason): PlacementResolverOutput {
  return { ok: false, reasonCode };
}

export function isTrustedRegionDefault(value: unknown): value is TrustedRegionDefault {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as TrustedRegionDefault)[TRUSTED_REGION_BRAND] &&
    typeof (value as TrustedRegionDefault).region === "string" &&
    (value as TrustedRegionDefault).region.trim() !== ""
  );
}

/**
 * Production verifier. Accepts only a branded platform deployment-region receipt.
 * A structurally correct `{ issuer: "platform" }` object is not sufficient.
 */
export function trustedRegionDefaultFromReceipt(params: {
  receipt: unknown;
  call: unknown;
  claimedSource?: UntrustedRegionSource;
}):
  | { ok: true; value: TrustedRegionDefault }
  | { ok: false; reasonCode: "missing_trusted_region" } {
  const { receipt, claimedSource } = params;
  const extraKeys = Object.keys(params).some(
    (key) => key !== "receipt" && key !== "call" && key !== "claimedSource",
  );
  if (claimedSource || extraKeys) {
    return { ok: false, reasonCode: "missing_trusted_region" };
  }
  if (!isPlatformDeploymentRegionReceipt(receipt)) {
    return { ok: false, reasonCode: "missing_trusted_region" };
  }
  const region = receipt.region.trim();
  const receiptTenant = receipt.tenantId.trim();
  const authTenant = placementAuthTenantId(params.call);
  if (!region || !receiptTenant || !authTenant || receiptTenant !== authTenant) {
    return { ok: false, reasonCode: "missing_trusted_region" };
  }
  return {
    ok: true,
    value: {
      [TRUSTED_REGION_BRAND]: true,
      region,
      tenantId: receiptTenant,
      receiptId: receipt.receiptId.trim(),
    },
  };
}

function hasCustodian(policy: PlacementPolicy, custodian: PlacementCustodian): boolean {
  return policy.allowedCustodians.includes(custodian);
}

function effectiveOffline(input: PlacementResolverInput, policy: PlacementPolicy): boolean {
  return policy.offlineRequired || input.requestedOfflineRequired === true;
}

function hasValidSubjectConsent(input: PlacementResolverInput): boolean {
  const scope = input.resourceConsentScope;
  const proof = input.subjectConsent;
  if (!isResourceConsentScope(scope) || !isSubjectConsentProof(proof)) {
    return false;
  }
  const tenantId = input.tenantId.trim();
  if (scope.tenantId !== tenantId || proof.tenantId !== tenantId) {
    return false;
  }
  if (proof.resourceId !== scope.resourceId) {
    return false;
  }
  if (proof.purpose !== "eligible_cloud_projection" || proof.consentVersion.trim() === "") {
    return false;
  }
  if (proof.revoked) {
    return false;
  }
  if (scope.dataSubjectIds.length === 0) {
    return false;
  }
  const covered = new Set(proof.subjectIds);
  if (scope.dataSubjectIds.some((subjectId) => !covered.has(subjectId))) {
    return false;
  }
  const expiresAt = Date.parse(proof.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt > placementTrustedNowMs();
}

type Preview = {
  mode: "local-only" | "encrypted-cloud" | "tenant-cloud" | "dedicated" | "byos" | "cold-archive";
  canonicalHome:
    | "local"
    | "managed_encrypted_cloud"
    | "tenant_managed_cloud"
    | "dedicated_regional"
    | "byos"
    | "cold_archive";
  projection: "none" | "managed_encrypted_cloud";
};

function previewPlacement(
  sync: SyncClassification,
  offline: boolean,
  openbotAllowed: boolean,
): Preview | null {
  if (sync === "local-only") {
    return { mode: "local-only", canonicalHome: "local", projection: "none" };
  }
  if (sync === "eligible-with-consent") {
    if (openbotAllowed) {
      return {
        mode: "encrypted-cloud",
        canonicalHome: "local",
        projection: "managed_encrypted_cloud",
      };
    }
    return { mode: "local-only", canonicalHome: "local", projection: "none" };
  }
  if (sync === "encrypted-cloud") {
    return {
      mode: "encrypted-cloud",
      canonicalHome: offline ? "local" : "managed_encrypted_cloud",
      projection: "managed_encrypted_cloud",
    };
  }
  if (sync === "tenant-cloud") {
    return {
      mode: "tenant-cloud",
      canonicalHome: "tenant_managed_cloud",
      projection: "none",
    };
  }
  if (sync === "byos-only") {
    return {
      mode: "byos",
      canonicalHome: "byos",
      projection: "none",
    };
  }
  if (sync === "archive-only") {
    return {
      mode: "cold-archive",
      canonicalHome: "cold_archive",
      projection: "none",
    };
  }
  return null;
}

function impliedCloudWrite(preview: Preview): boolean {
  return (
    preview.projection === "managed_encrypted_cloud" ||
    preview.canonicalHome === "managed_encrypted_cloud" ||
    preview.canonicalHome === "tenant_managed_cloud" ||
    preview.canonicalHome === "dedicated_regional" ||
    preview.canonicalHome === "byos" ||
    preview.canonicalHome === "cold_archive"
  );
}

function requiresTenantCustodian(preview: Preview): boolean {
  return preview.canonicalHome === "tenant_managed_cloud";
}

function requiresByosCustodian(preview: Preview): boolean {
  return preview.canonicalHome === "byos";
}

function requiresOpenbotCustodian(preview: Preview): boolean {
  return (
    preview.projection === "managed_encrypted_cloud" ||
    preview.canonicalHome === "managed_encrypted_cloud" ||
    preview.canonicalHome === "dedicated_regional" ||
    preview.canonicalHome === "cold_archive"
  );
}

function applyDedicatedOverlay(
  preview: Preview,
  policy: PlacementPolicy,
  offline: boolean,
): Preview {
  if (preview.canonicalHome === "local" && offline) {
    return preview;
  }
  const isolated =
    preview.canonicalHome === "managed_encrypted_cloud" ||
    preview.canonicalHome === "tenant_managed_cloud" ||
    policy.requireDedicatedKey ||
    policy.requireDedicatedDatabase ||
    policy.replicationClass === "regional";
  if (!isolated) {
    return preview;
  }
  return {
    mode: "dedicated",
    canonicalHome: "dedicated_regional",
    projection: "none",
  };
}

function trustedRegionOrNull(value: unknown): string | null {
  if (value == null || typeof value === "string") {
    return null;
  }
  if (!isTrustedRegionDefault(value)) {
    return null;
  }
  return value.region;
}

export function resolvePlacement(input: PlacementResolverInput): PlacementResolverOutput {
  if (typeof input.tenantId !== "string" || input.tenantId.trim() === "") {
    return deny("missing_auth_tenant");
  }
  if (input.tenantContract == null) {
    return deny("missing_placement_policy");
  }
  if (input.syncClassification == null) {
    return deny("missing_sync_classification");
  }
  if (input.classification == null || !CLASSIFICATIONS.has(input.classification)) {
    return deny("missing_classification");
  }
  if (input.syncClassification === "blocked") {
    return deny("sync_class_blocked");
  }

  const policy = input.tenantContract;
  const sync = input.syncClassification;
  const offline = effectiveOffline(input, policy);
  const openbotAllowed = hasCustodian(policy, "openbot");
  const deviceAllowed = hasCustodian(policy, "device");
  const tenantAllowed = hasCustodian(policy, "tenant");
  const dedicatedProfile = input.deploymentProfile === "dedicated";
  let preview = previewPlacement(sync, offline, openbotAllowed);
  if (
    preview &&
    dedicatedProfile &&
    sync !== "tenant-cloud" &&
    sync !== "byos-only" &&
    sync !== "archive-only"
  ) {
    preview = applyDedicatedOverlay(preview, policy, offline);
  }

  if (
    input.legalHoldActive &&
    (preview?.canonicalHome === "managed_encrypted_cloud" ||
      preview?.canonicalHome === "tenant_managed_cloud" ||
      preview?.canonicalHome === "dedicated_regional" ||
      preview?.canonicalHome === "byos" ||
      preview?.canonicalHome === "cold_archive")
  ) {
    return deny("legal_hold_blocks_placement_change");
  }
  if (policy.requireDedicatedKey && !dedicatedProfile) {
    return deny("dedicated_key_unsupported");
  }
  if (policy.requireDedicatedDatabase && !dedicatedProfile) {
    return deny("dedicated_database_unsupported");
  }
  if (policy.replicationClass === "multi-region") {
    return deny("replication_unsupported");
  }
  if (policy.replicationClass === "regional" && !dedicatedProfile) {
    return deny("replication_unsupported");
  }

  const cloudImplied = preview != null && impliedCloudWrite(preview);
  if (
    policy.allowedCustodians.length === 0 ||
    (cloudImplied && policy.allowedRegions.length === 0) ||
    (offline && !deviceAllowed && sync !== "encrypted-cloud")
  ) {
    return deny("policy_conflict");
  }

  if (LATER_WAVE_SYNC.has(sync)) {
    return deny("sync_class_not_first_wave");
  }

  if (sync === "eligible-with-consent" && openbotAllowed && !hasValidSubjectConsent(input)) {
    return deny("consent_required");
  }

  // Step 12: offline would still leave cloud as the writable canonical
  // (encrypted-cloud cannot be rewritten to local+projection without openbot).
  if (offline && sync === "encrypted-cloud" && !openbotAllowed) {
    return deny("offline_requires_local_canonical");
  }
  // Step 13: cloud required, no remaining local canonical, no legal projection-only.
  if (offline && sync === "encrypted-cloud" && openbotAllowed && !deviceAllowed) {
    return deny("offline_conflicts_managed_cloud");
  }
  if (offline && sync === "archive-only") {
    return deny("offline_requires_local_canonical");
  }

  if (preview == null) {
    return deny("sync_class_not_first_wave");
  }

  if (preview.canonicalHome === "local" && !deviceAllowed) {
    return deny("custodian_not_allowed");
  }
  if (requiresTenantCustodian(preview) && !tenantAllowed) {
    return deny("custodian_not_allowed");
  }
  if (requiresByosCustodian(preview) && !hasCustodian(policy, "byos")) {
    return deny("custodian_not_allowed");
  }
  if (requiresOpenbotCustodian(preview) && !openbotAllowed) {
    return deny("custodian_not_allowed");
  }

  const trustedRegion = trustedRegionOrNull(input.trustedRegionDefault);
  if (trustedRegion != null && input.trustedRegionDefault?.tenantId !== input.tenantId.trim()) {
    return deny("missing_trusted_region");
  }
  if (impliedCloudWrite(preview)) {
    if (trustedRegion == null) {
      return deny("missing_trusted_region");
    }
    const residency = input.residencyRequiredRegions;
    const allowed = new Set(policy.allowedRegions);
    const inAllowed = allowed.has(trustedRegion);
    const inResidency = residency == null || residency.includes(trustedRegion);
    if (!inAllowed || !inResidency) {
      return deny("residency_conflict");
    }
  }

  if (
    dedicatedProfile &&
    (sync === "tenant-cloud" || sync === "byos-only" || sync === "archive-only")
  ) {
    return deny("first_wave_adapter_unavailable");
  }

  const replicationClass =
    dedicatedProfile && policy.replicationClass === "regional"
      ? "regional"
      : policy.replicationClass === "local"
        ? "local"
        : "none";
  return {
    ok: true,
    mode: preview.mode,
    canonicalHome: preview.canonicalHome,
    projection: preview.projection,
    region: impliedCloudWrite(preview) ? trustedRegion : null,
    keyRef: null,
    replicationClass,
    reasonCode: "resolved",
  };
}
