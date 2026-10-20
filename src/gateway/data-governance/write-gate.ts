/**
 * P1-2-d/g second-wave content-write fail-closed gate.
 * Managed writes require Catalog availability, active envelope, tenant match,
 * ownership/authorization proof, and a single active canonical binding.
 */

import { assertWritableEnvelope } from "./envelope.js";
import { getSharedDataGovernanceCatalog } from "./runtime-catalog.js";
import type {
  CatalogRecord,
  OwnershipPrincipal,
  ResourceScope,
  SecondWaveResourceType,
} from "./types.js";

export type GovernanceWriteProfile = "managed_enterprise" | "personal_local";

/** Trusted caller ownership/authorization proof — never inferred from path. */
export type GovernanceOwnershipProof = {
  owner: OwnershipPrincipal;
  scope: ResourceScope;
  /** Optional AgentAsset continuity for operational_identity. */
  agentAssetId?: string | null;
};

export type RequireGovernedContentWriteParams = {
  resourceId: string;
  resourceType: SecondWaveResourceType;
  /** Trusted caller tenant — never take from untrusted request body alone. */
  callerTenantId: string | null;
  profile: GovernanceWriteProfile;
  /** Required for managed; personal may omit only when allowMissingCatalog. */
  ownershipProof?: GovernanceOwnershipProof;
  /**
   * When true (personal pre-migration only), missing Catalog allows the write.
   * Managed must never set this.
   */
  allowMissingCatalog?: boolean;
  stateDir?: string;
};

function activeCanonicalCount(record: CatalogRecord): number {
  return record.bindings.filter((b) => b.role === "canonical" && b.state === "active").length;
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

/** Compare trusted call-entry proof against Catalog envelope (and optional OI AgentAsset). */
export function assertOwnershipProofMatches(
  record: CatalogRecord,
  proof: GovernanceOwnershipProof | undefined,
  profile?: GovernanceWriteProfile,
): void {
  if (!proof) {
    throw new Error("governance_write_denied:missing_ownership_proof");
  }
  if (ownerKey(proof.owner) !== ownerKey(record.envelope.owner)) {
    throw new Error("governance_write_denied:owner_mismatch");
  }
  if (scopeKey(proof.scope) !== scopeKey(record.envelope.scope)) {
    throw new Error("governance_write_denied:scope_mismatch");
  }
  if (record.envelope.resourceType === "operational_identity" && proof.agentAssetId !== undefined) {
    const projected = record.envelope.projection?.agentAssetId ?? null;
    if ((proof.agentAssetId ?? null) !== projected) {
      throw new Error("governance_write_denied:agent_asset_mismatch");
    }
  }
  void profile;
}

/**
 * Fail-closed gate for Knowledge / Memory / Operational Identity content writes.
 * Does not authorize Catalog metadata transitions (use assertCatalogMutableEnvelope).
 */
export async function requireGovernedContentWrite(
  params: RequireGovernedContentWriteParams,
): Promise<CatalogRecord | null> {
  if (params.profile === "managed_enterprise") {
    if (!params.callerTenantId || !params.callerTenantId.trim()) {
      throw new Error("governance_write_denied:managed_requires_tenant");
    }
    if (params.allowMissingCatalog) {
      throw new Error("governance_write_denied:managed_requires_catalog");
    }
  }

  let record: CatalogRecord | null;
  try {
    record = await getSharedDataGovernanceCatalog({ stateDir: params.stateDir }).get(
      params.resourceId,
    );
  } catch (err) {
    const message = String((err as Error)?.message ?? err);
    throw new Error(`governance_write_denied:catalog_unavailable:${message}`, { cause: err });
  }

  if (!record) {
    if (params.profile === "personal_local" && params.allowMissingCatalog) {
      return null;
    }
    throw new Error("governance_write_denied:missing_catalog");
  }
  if (record.envelope.resourceType !== params.resourceType) {
    throw new Error(`governance_write_denied:type_mismatch:${record.envelope.resourceType}`);
  }

  try {
    assertWritableEnvelope(record.envelope);
  } catch (err) {
    const message = String((err as Error)?.message ?? err);
    throw new Error(`governance_write_denied:${message}`, { cause: err });
  }

  if (params.profile === "managed_enterprise") {
    if (record.envelope.tenantId !== params.callerTenantId) {
      throw new Error("governance_write_denied:cross_tenant");
    }
  } else if (
    params.callerTenantId != null &&
    record.envelope.tenantId != null &&
    record.envelope.tenantId !== params.callerTenantId
  ) {
    throw new Error("governance_write_denied:cross_tenant");
  }

  assertOwnershipProofMatches(record, params.ownershipProof, params.profile);

  const canonicals = activeCanonicalCount(record);
  if (canonicals !== 1) {
    throw new Error(`governance_write_denied:canonical_count:${canonicals}`);
  }
  if (record.envelope.canonicalBindingId) {
    const canonical = record.bindings.find(
      (b) =>
        b.bindingId === record.envelope.canonicalBindingId &&
        b.role === "canonical" &&
        b.state === "active",
    );
    if (!canonical) {
      throw new Error("governance_write_denied:canonical_missing");
    }
  }

  return record;
}

/** Managed create/register: tenant scope must carry a non-null tenantId. */
export function assertManagedCreateTenant(params: {
  profile?: GovernanceWriteProfile;
  tenantId: string | null;
  scopeKind: ResourceScope["kind"];
}): void {
  const managed =
    params.profile === "managed_enterprise" ||
    (params.profile === undefined && params.scopeKind === "tenant");
  if (managed && (!params.tenantId || !params.tenantId.trim())) {
    throw new Error("governance_write_denied:managed_requires_tenant");
  }
}
