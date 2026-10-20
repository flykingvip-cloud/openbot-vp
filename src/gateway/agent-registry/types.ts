// Feature: shared-agent-identity-access-control-plane
// Terminology is frozen by docs/design/agent-registry-unified-acl-adr-2026-07-31.md.

/**
 * Canonical reference to an Agent. Both parts are always carried together so a
 * child record can never be interpreted outside its enterprise boundary.
 */
export type AgentRef = {
  enterpriseId: string;
  /** Server generated opaque UUID. Never order-significant. */
  agentAssetId: string;
};

export type AgentAssetStatus = "active" | "suspended" | "archived";

/**
 * Enterprise scoped business asset with a stable identity. This is the only
 * canonical subject for ownership and Growth.
 */
export type AgentAsset = {
  agentAssetId: string;
  enterpriseId: string;
  /** Human readable, unique per enterprise. Never an authorization input. */
  agentSlug: string;
  displayName: string;
  status: AgentAssetStatus;
  /** Definition this asset currently materializes, when one is pinned. */
  agentDefinitionId?: string;
  currentRevisionId?: string;
  /** Legacy local identifier this asset was reconciled from, when known. */
  legacyAgentId?: string;
  /** Governed provenance for a cross enterprise copy; never inherits Growth identity. */
  copiedFrom?: { enterpriseId: string; agentAssetId: string; copiedAt: string };
  createdAt: string;
  updatedAt: string;
};

export type AgentDeploymentStatus = "active" | "detached";

/**
 * Rebuildable runtime mount of an asset. `AgentInstance` is the deprecated alias
 * for this concept and must never denote an asset.
 */
export type AgentDeployment = {
  agentDeploymentId: string;
  enterpriseId: string;
  agentAssetId: string;
  target:
    | { kind: "seat"; seatId: string }
    | { kind: "space"; spaceId: string }
    | { kind: "runtime"; runtimeId: string };
  status: AgentDeploymentStatus;
  createdAt: string;
  detachedAt?: string;
};

export type AgentRevision = {
  agentRevisionId: string;
  enterpriseId: string;
  agentAssetId: string;
  /** Monotonic per asset; immutable once created. */
  revision: number;
  createdAt: string;
  createdByMembershipId?: string;
};

export type AgentOwnerType = "membership" | "seat";

/**
 * Ownership binding history. Exactly one binding per asset may be open
 * (`endedAt` unset) at a time; an owner change closes the previous row.
 */
export type AgentOwnerBinding = {
  bindingId: string;
  enterpriseId: string;
  agentAssetId: string;
  ownerType: AgentOwnerType;
  ownerId: string;
  isPrimary: true;
  effectiveAt: string;
  endedAt?: string;
  endedReason?: "transferred" | "owner_removed" | "asset_archived";
};

/** Why a legacy identifier could not be resolved to exactly one asset. */
export type AgentRegistryQuarantineReason = "ambiguous-legacy-id" | "ambiguous-slug";

export type AgentRegistryQuarantineEntry = {
  quarantineId: string;
  enterpriseId: string;
  /** The legacy identifier that could not be resolved. */
  legacyAgentId: string;
  reason: AgentRegistryQuarantineReason;
  candidateAgentAssetIds: string[];
  detectedAt: string;
  resolvedAt?: string;
};

export type AgentRegistryStore = {
  version: 1;
  assets: Record<string, AgentAsset>;
  deployments: Record<string, AgentDeployment>;
  revisions: Record<string, AgentRevision>;
  ownerBindings: Record<string, AgentOwnerBinding>;
  quarantine: Record<string, AgentRegistryQuarantineEntry>;
};

export function createEmptyAgentRegistryStore(): AgentRegistryStore {
  return {
    version: 1,
    assets: {},
    deployments: {},
    revisions: {},
    ownerBindings: {},
    quarantine: {},
  };
}

export class AgentRegistryError extends Error {
  constructor(
    readonly code:
      | "ENTERPRISE_REQUIRED"
      | "SLUG_CONFLICT"
      | "ASSET_NOT_FOUND"
      | "CROSS_ENTERPRISE_FORBIDDEN"
      | "OWNER_REQUIRED"
      | "OWNERSHIP_INVARIANT",
    message: string,
  ) {
    super(message);
    this.name = "AgentRegistryError";
  }
}

/** Narrow guard so callers cannot pass a half-built reference. */
export function isAgentRef(value: unknown): value is AgentRef {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as { enterpriseId?: unknown; agentAssetId?: unknown };
  return (
    typeof candidate.enterpriseId === "string" &&
    candidate.enterpriseId.trim().length > 0 &&
    typeof candidate.agentAssetId === "string" &&
    candidate.agentAssetId.trim().length > 0
  );
}

export function agentRefEquals(left: AgentRef, right: AgentRef): boolean {
  return left.enterpriseId === right.enterpriseId && left.agentAssetId === right.agentAssetId;
}
