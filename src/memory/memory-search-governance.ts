/**
 * Call-entry governance for CogniWeave / memory search managers.
 * Cache identity must include tenant/owner/scope/AgentAsset + epoch so seat
 * transfer or proof change cannot reuse a stale manager.
 */

import {
  ownershipProofFromGroup,
  ownershipProofFromSeat,
  ownershipProofFromTenantUser,
} from "../gateway/data-governance/ownership-proof.js";
import type { GovernanceOwnershipProof } from "../gateway/data-governance/write-gate.js";

export type MemorySearchGovernance = {
  tenantId: string | null;
  ownershipProof: GovernanceOwnershipProof;
  stateDir?: string;
};

/** Bumped on seat transfer / governance identity change to invalidate cache keys. */
let memoryGovernanceEpoch = 0;

export function getMemoryGovernanceEpoch(): number {
  return memoryGovernanceEpoch;
}

/** Invalidate CogniWeave manager cache identity after seat transfer or proof rotation. */
export function bumpMemoryGovernanceEpoch(): number {
  memoryGovernanceEpoch += 1;
  return memoryGovernanceEpoch;
}

export function resetMemoryGovernanceEpochForTests(): void {
  memoryGovernanceEpoch = 0;
}

export function fingerprintMemoryGovernance(
  governance: MemorySearchGovernance | undefined | null,
): string {
  if (!governance?.ownershipProof) {
    return "gov:none";
  }
  const proof = governance.ownershipProof;
  const owner =
    proof.owner.kind === "user"
      ? `user:${proof.owner.userId}`
      : proof.owner.kind === "position"
        ? `seat:${proof.owner.seatId}`
        : proof.owner.kind === "group"
          ? `group:${proof.owner.groupId}`
          : proof.owner.kind === "system"
            ? `system:${proof.owner.systemId}`
            : "owner:unknown";
  const scope =
    proof.scope.kind === "tenant"
      ? `tenant:${proof.scope.tenantId}`
      : proof.scope.kind === "user"
        ? `user:${proof.scope.userId}`
        : proof.scope.kind === "group"
          ? `group:${proof.scope.groupId}`
          : "scope:unknown";
  const asset = proof.agentAssetId?.trim() || "-";
  const tenant = governance.tenantId?.trim() || "-";
  return `gov:${tenant}|${owner}|${scope}|asset:${asset}`;
}

/** Build trusted proof from authenticated seat / user / group call entry. */
export function buildMemorySearchGovernanceFromCallEntry(params: {
  tenantId?: string | null;
  userId?: string | null;
  seatId?: string | null;
  groupId?: string | null;
  agentAssetId?: string | null;
  stateDir?: string;
}): MemorySearchGovernance | undefined {
  const tenantId = params.tenantId?.trim() || null;
  if (!tenantId || tenantId === "__local__") {
    return undefined;
  }
  const seatId = params.seatId?.trim();
  const groupId = params.groupId?.trim();
  const userId = params.userId?.trim();
  const agentAssetId = params.agentAssetId;
  let ownershipProof: GovernanceOwnershipProof;
  if (seatId) {
    ownershipProof = ownershipProofFromSeat({ tenantId, seatId, agentAssetId });
  } else if (groupId) {
    ownershipProof = ownershipProofFromGroup({ tenantId, groupId, agentAssetId });
  } else if (userId) {
    ownershipProof = ownershipProofFromTenantUser({ tenantId, userId, agentAssetId });
  } else {
    return undefined;
  }
  return { tenantId, ownershipProof, stateDir: params.stateDir };
}

export function isManagedCogniWeaveTenant(tenantId: string | null | undefined): boolean {
  const trimmed = tenantId?.trim();
  return Boolean(trimmed && trimmed !== "__local__");
}
