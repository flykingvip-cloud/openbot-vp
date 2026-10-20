/**
 * Client-side helpers for forward-secret team key rotation (R2).
 * After member revoke: generate a new random BaseKey, bump encryption epoch,
 * and re-wrap for all remaining active members.
 */
import { deriveVaultKeySet, generateRotatedBaseKey } from "../crypto/keys.js";
import { wrapBaseKeyForMember } from "../crypto/member-wrap.js";
import type { VaultSyncControlPlane } from "../store/control-plane.js";
import type { VaultMemberRecord } from "../types.js";

export type MemberWrapPackage = {
  memberAccountId: string;
  ephemeralPublicKeyB64: string;
  wrappedBaseKeyB64: string;
};

export function buildEpochRotationPackages(params: {
  newBaseKey?: Buffer;
  vaultId: string;
  keyEpoch: number;
  activeMembers: Array<Pick<VaultMemberRecord, "memberAccountId" | "publicKeyB64">>;
}): { newBaseKey: Buffer; wraps: MemberWrapPackage[] } {
  const newBaseKey = params.newBaseKey ?? generateRotatedBaseKey();
  // Ensure derived keys are valid for the epoch (caller uses these after rotation).
  deriveVaultKeySet(newBaseKey, params.keyEpoch);
  const wraps = params.activeMembers.map((member) => {
    const wrapped = wrapBaseKeyForMember({
      baseKey: newBaseKey,
      recipientPublicKeyB64: member.publicKeyB64,
      vaultId: params.vaultId,
      memberAccountId: member.memberAccountId,
      keyEpoch: params.keyEpoch,
    });
    return {
      memberAccountId: member.memberAccountId,
      ephemeralPublicKeyB64: wrapped.ephemeralPublicKeyB64,
      wrappedBaseKeyB64: wrapped.wrappedBaseKeyB64,
    };
  });
  return { newBaseKey, wraps };
}

export function listActiveMembersForRotation(
  plane: VaultSyncControlPlane,
  vaultId: string,
): VaultMemberRecord[] {
  return plane.listMembers(vaultId).filter((m) => m.status === "active");
}
