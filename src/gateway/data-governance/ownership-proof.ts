/**
 * Trusted ownership/authorization proofs built at authenticated call entry.
 * Never synthesize these from the write payload alone (ownerId/agentId/identity fields).
 */

import type { OwnershipPrincipal, ResourceScope } from "./types.js";
import type { GovernanceOwnershipProof } from "./write-gate.js";

/** User-owned resource under authenticated TenantContext membership. */
export function ownershipProofFromTenantUser(params: {
  tenantId: string;
  userId: string;
  agentAssetId?: string | null;
}): GovernanceOwnershipProof {
  const tenantId = params.tenantId.trim();
  const userId = params.userId.trim();
  if (!tenantId || !userId) {
    throw new Error("governance_ownership_proof_invalid:tenant_user");
  }
  return {
    owner: { kind: "user", userId },
    scope: { kind: "tenant", tenantId },
    agentAssetId: params.agentAssetId,
  };
}

/** Position/seat-owned AgentAsset under authenticated seat binding. */
export function ownershipProofFromSeat(params: {
  tenantId: string;
  seatId: string;
  agentAssetId?: string | null;
}): GovernanceOwnershipProof {
  const tenantId = params.tenantId.trim();
  const seatId = params.seatId.trim();
  if (!tenantId || !seatId) {
    throw new Error("governance_ownership_proof_invalid:seat");
  }
  return {
    owner: { kind: "position", seatId },
    scope: { kind: "tenant", tenantId },
    agentAssetId: params.agentAssetId,
  };
}

/** Group-owned AgentAsset under authenticated group binding. */
export function ownershipProofFromGroup(params: {
  tenantId: string;
  groupId: string;
  agentAssetId?: string | null;
}): GovernanceOwnershipProof {
  const tenantId = params.tenantId.trim();
  const groupId = params.groupId.trim();
  if (!tenantId || !groupId) {
    throw new Error("governance_ownership_proof_invalid:group");
  }
  return {
    owner: { kind: "group", groupId },
    scope: { kind: "group", groupId },
    agentAssetId: params.agentAssetId,
  };
}

/**
 * Tenant-owned enterprise Operational Identity aggregate.
 * Injected only after enterprise admin/membership auth — not from write body.
 */
export function ownershipProofForEnterpriseOperationalIdentity(params: {
  tenantId: string;
}): GovernanceOwnershipProof {
  const tenantId = params.tenantId.trim();
  if (!tenantId) {
    throw new Error("governance_ownership_proof_invalid:enterprise_oi");
  }
  return {
    owner: { kind: "system", systemId: "enterprise-oi" },
    scope: { kind: "tenant", tenantId },
  };
}

/** Personal-local (no tenant) user proof. */
export function ownershipProofFromLocalUser(params: { userId: string }): GovernanceOwnershipProof {
  const userId = params.userId.trim();
  if (!userId) {
    throw new Error("governance_ownership_proof_invalid:local_user");
  }
  return {
    owner: { kind: "user", userId },
    scope: { kind: "user", userId },
  };
}

export function ownershipProofFromPrincipal(params: {
  owner: OwnershipPrincipal;
  scope: ResourceScope;
  agentAssetId?: string | null;
}): GovernanceOwnershipProof {
  return {
    owner: params.owner,
    scope: params.scope,
    agentAssetId: params.agentAssetId,
  };
}
