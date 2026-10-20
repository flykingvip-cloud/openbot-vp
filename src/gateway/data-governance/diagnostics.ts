import type {
  CatalogRecord,
  GovernedResourceType,
  OwnershipPrincipal,
  ResourceScope,
  StorageBinding,
  StorageRole,
} from "./types.js";

const DERIVED_ROLES = new Set<StorageRole>([
  "replica",
  "derived",
  "archive",
  "cache",
  "compatibility",
]);

export type BindingRoleIssue = {
  resourceId: string;
  code:
    | "missing_active_canonical"
    | "multiple_active_canonicals"
    | "canonical_id_mismatch"
    | "binding_resource_mismatch"
    | "invalid_derived_role_state";
  message: string;
};

export type OrphanCandidate = {
  locator: string;
  reason: "no_catalog_binding" | "binding_retired_only";
  /** Optional resource type hint from observer (Knowledge/Memory/OI inventory). */
  resourceTypeHint?: GovernedResourceType;
};

/** Authoritative ownership proof from seat/membership/AgentAsset — never inferred from path. */
export type AuthoritativeOwnershipProof = {
  resourceId: string;
  tenantId: string | null;
  owner: OwnershipPrincipal;
  scope: ResourceScope;
  /** Optional AgentAsset continuity for operational_identity. */
  agentAssetId?: string | null;
};

export type WrongOwnerScopeIssue = {
  resourceId: string;
  code:
    | "tenant_mismatch"
    | "owner_mismatch"
    | "scope_mismatch"
    | "missing_proof"
    | "agent_asset_mismatch"
    | "envelope_scope_inconsistent";
  message: string;
};

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

/** Exactly one active canonical; optional derived roles must reference same resourceId. */
export function diagnoseBindingRoles(record: CatalogRecord): BindingRoleIssue[] {
  const issues: BindingRoleIssue[] = [];
  const { envelope, bindings } = record;
  const activeCanonicals = bindings.filter((b) => b.role === "canonical" && b.state === "active");

  if (activeCanonicals.length === 0) {
    issues.push({
      resourceId: envelope.resourceId,
      code: "missing_active_canonical",
      message: "resource has no active canonical binding",
    });
  } else if (activeCanonicals.length > 1) {
    issues.push({
      resourceId: envelope.resourceId,
      code: "multiple_active_canonicals",
      message: `resource has ${activeCanonicals.length} active canonical bindings`,
    });
  } else if (activeCanonicals[0].bindingId !== envelope.canonicalBindingId) {
    issues.push({
      resourceId: envelope.resourceId,
      code: "canonical_id_mismatch",
      message: "envelope.canonicalBindingId does not match active canonical binding",
    });
  }

  for (const binding of bindings) {
    if (binding.resourceId !== envelope.resourceId) {
      issues.push({
        resourceId: envelope.resourceId,
        code: "binding_resource_mismatch",
        message: `binding ${binding.bindingId} resourceId mismatch`,
      });
    }
    if (
      DERIVED_ROLES.has(binding.role) &&
      binding.state === "active" &&
      activeCanonicals.length === 0
    ) {
      issues.push({
        resourceId: envelope.resourceId,
        code: "invalid_derived_role_state",
        message: `derived role ${binding.role} active without canonical`,
      });
    }
  }

  return issues;
}

/**
 * Canonical uniqueness key: exclusive physical uses locator alone;
 * shared aggregates use locator + objectKey.
 */
export function canonicalBindingUniquenessKey(binding: {
  locator: string;
  objectKey?: string | null;
}): string {
  const objectKey = binding.objectKey?.trim();
  return objectKey ? `${binding.locator}#${objectKey}` : binding.locator;
}

export function diagnoseDuplicateCanonicals(records: CatalogRecord[]): string[] {
  const byKey = new Map<string, string[]>();
  for (const record of records) {
    for (const binding of record.bindings) {
      if (binding.role !== "canonical" || binding.state !== "active") {
        continue;
      }
      const key = canonicalBindingUniquenessKey(binding);
      const list = byKey.get(key) ?? [];
      list.push(record.envelope.resourceId);
      byKey.set(key, list);
    }
  }
  const dupes: string[] = [];
  for (const [key, ids] of byKey) {
    if (ids.length > 1) {
      dupes.push(`duplicate_canonical:${key}:${ids.toSorted().join(",")}`);
    }
  }
  return dupes.toSorted((a, b) => a.localeCompare(b));
}

/**
 * Locators observed on disk/inventory that have no active catalog binding.
 * Does not invent ownership — only reports missing catalog coverage.
 */
export function diagnoseOrphanLocators(params: {
  observedLocators: string[];
  records: CatalogRecord[];
  /** Optional map of locator → resource type hint from Knowledge/Memory/OI observers. */
  resourceTypeHints?: Record<string, GovernedResourceType>;
}): OrphanCandidate[] {
  const covered = new Set<string>();
  const retiredOnly = new Set<string>();

  for (const record of params.records) {
    for (const binding of record.bindings) {
      if (binding.state === "active") {
        covered.add(binding.locator);
      } else if (binding.state === "retired") {
        retiredOnly.add(binding.locator);
      }
    }
  }

  const orphans: OrphanCandidate[] = [];
  for (const locator of new Set(params.observedLocators)) {
    if (covered.has(locator)) {
      continue;
    }
    const hint = params.resourceTypeHints?.[locator];
    if (retiredOnly.has(locator)) {
      orphans.push({
        locator,
        reason: "binding_retired_only",
        ...(hint ? { resourceTypeHint: hint } : {}),
      });
    } else {
      orphans.push({
        locator,
        reason: "no_catalog_binding",
        ...(hint ? { resourceTypeHint: hint } : {}),
      });
    }
  }
  return orphans.toSorted((a, b) => a.locator.localeCompare(b.locator));
}

/**
 * Self-consistency of envelope.owner / scope / tenantId (no external SoT required).
 */
export function diagnoseEnvelopeOwnerScopeConsistency(
  record: CatalogRecord,
): WrongOwnerScopeIssue[] {
  const issues: WrongOwnerScopeIssue[] = [];
  const { resourceId, tenantId, owner, scope } = record.envelope;

  if (scope.kind === "tenant") {
    if (!tenantId || tenantId !== scope.tenantId) {
      issues.push({
        resourceId,
        code: "envelope_scope_inconsistent",
        message: "tenant scope.tenantId must equal envelope.tenantId",
      });
    }
  }

  if (owner.kind === "user" && scope.kind === "user" && owner.userId !== scope.userId) {
    issues.push({
      resourceId,
      code: "envelope_scope_inconsistent",
      message: "user owner.userId must equal scope.userId",
    });
  }

  if (owner.kind === "group" && scope.kind === "group" && owner.groupId !== scope.groupId) {
    issues.push({
      resourceId,
      code: "envelope_scope_inconsistent",
      message: "group owner.groupId must equal scope.groupId",
    });
  }

  return issues;
}

/**
 * Compare Catalog owner/scope/tenant against authoritative proofs
 * (seat / membership / AgentAsset). Missing proof is only an issue when required.
 */
export function diagnoseWrongOwnerScope(params: {
  records: CatalogRecord[];
  proofs: AuthoritativeOwnershipProof[];
  requireProofForTypes?: GovernedResourceType[];
}): WrongOwnerScopeIssue[] {
  const proofById = new Map(params.proofs.map((p) => [p.resourceId, p]));
  const require = new Set(params.requireProofForTypes ?? []);
  const issues: WrongOwnerScopeIssue[] = [];

  for (const record of params.records) {
    issues.push(...diagnoseEnvelopeOwnerScopeConsistency(record));

    const proof = proofById.get(record.envelope.resourceId);
    if (!proof) {
      if (require.has(record.envelope.resourceType)) {
        issues.push({
          resourceId: record.envelope.resourceId,
          code: "missing_proof",
          message: `no authoritative ownership proof for ${record.envelope.resourceType}`,
        });
      }
      continue;
    }

    if (proof.tenantId !== record.envelope.tenantId) {
      issues.push({
        resourceId: record.envelope.resourceId,
        code: "tenant_mismatch",
        message: "envelope.tenantId does not match authoritative proof",
      });
    }
    if (ownerKey(proof.owner) !== ownerKey(record.envelope.owner)) {
      issues.push({
        resourceId: record.envelope.resourceId,
        code: "owner_mismatch",
        message: "envelope.owner does not match authoritative proof",
      });
    }
    if (scopeKey(proof.scope) !== scopeKey(record.envelope.scope)) {
      issues.push({
        resourceId: record.envelope.resourceId,
        code: "scope_mismatch",
        message: "envelope.scope does not match authoritative proof",
      });
    }

    if (
      record.envelope.resourceType === "operational_identity" &&
      proof.agentAssetId !== undefined
    ) {
      const projected = record.envelope.projection?.agentAssetId ?? null;
      const expected = proof.agentAssetId ?? null;
      if (projected !== expected) {
        issues.push({
          resourceId: record.envelope.resourceId,
          code: "agent_asset_mismatch",
          message: "projection.agentAssetId does not match AgentAsset continuity proof",
        });
      }
    }
  }

  return issues.toSorted(
    (a, b) => a.resourceId.localeCompare(b.resourceId) || a.code.localeCompare(b.code),
  );
}

export function countBindingsByRole(bindings: StorageBinding[]): Record<StorageRole, number> {
  const counts: Record<StorageRole, number> = {
    canonical: 0,
    replica: 0,
    derived: 0,
    archive: 0,
    cache: 0,
    compatibility: 0,
  };
  for (const binding of bindings) {
    counts[binding.role] += 1;
  }
  return counts;
}
