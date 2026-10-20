/**
 * Browser client-side member wrap rotation after team revoke (R2 / P4 forward secrecy).
 */
import { generateRotatedBaseKey } from "./client-crypto.ts";
import { sealAndStoreBaseKey } from "./client-key-store.ts";
import type { VaultSyncClientGateway } from "./client-sync-types.ts";
import { deriveBaseKeyFromPassword, wrapBaseKeyForMember } from "./client-team.ts";

export type ActiveMemberForWrap = {
  memberAccountId: string;
  publicKeyB64: string;
};

export function listActiveMembersForWrap(
  members: Array<{ memberAccountId: string; status?: string; publicKeyB64?: string }>,
): ActiveMemberForWrap[] {
  return members
    .filter((member) => member.status === "active" && Boolean(member.publicKeyB64?.trim()))
    .map((member) => ({
      memberAccountId: member.memberAccountId,
      publicKeyB64: member.publicKeyB64!.trim(),
    }));
}

export async function rotateMemberWrapsOnClient(params: {
  gateway: VaultSyncClientGateway;
  vaultId: string;
  actorAccountId: string;
  password: string;
  members?: ActiveMemberForWrap[];
  baseKey?: Uint8Array;
  keyEpoch?: number;
}): Promise<{ keyEpoch: number; rotatedCount: number; baseKey: Uint8Array }> {
  if (!params.gateway.rotateVaultSyncMemberWraps) {
    throw new Error("rotate wraps RPC unavailable");
  }
  const status = await params.gateway.vaultSyncStatus({ vaultId: params.vaultId });
  if (!status.saltB64) {
    throw new Error("vault salt unavailable");
  }
  const keyEpoch = params.keyEpoch ?? status.encryptionVersion ?? 1;
  const baseKey =
    params.baseKey ??
    (await deriveBaseKeyFromPassword({
      password: params.password,
      saltB64: status.saltB64,
      kdf: status.kdfParams,
    }));
  let activeMembers = params.members;
  if (!activeMembers) {
    if (!params.gateway.listVaultSyncMembers) {
      throw new Error("list members RPC unavailable");
    }
    const listed = await params.gateway.listVaultSyncMembers({ vaultId: params.vaultId });
    activeMembers = listActiveMembersForWrap(listed.members ?? []);
  }
  if (activeMembers.length === 0) {
    throw new Error("no active members to rotate");
  }
  const wraps = await Promise.all(
    activeMembers.map(async (member) => {
      const wrapped = await wrapBaseKeyForMember({
        baseKey,
        recipientPublicKeyB64: member.publicKeyB64,
        vaultId: params.vaultId,
        memberAccountId: member.memberAccountId,
        keyEpoch,
      });
      return {
        memberAccountId: member.memberAccountId,
        ephemeralPublicKeyB64: wrapped.ephemeralPublicKeyB64,
        wrappedBaseKeyB64: wrapped.wrappedBaseKeyB64,
      };
    }),
  );
  await params.gateway.rotateVaultSyncMemberWraps({
    vaultId: params.vaultId,
    actorAccountId: params.actorAccountId,
    keyEpoch,
    wraps,
  });
  return { keyEpoch, rotatedCount: wraps.length, baseKey };
}

/**
 * @deprecated Prefer rotateMemberWrapsWithEpochBumpOnClient — same-BaseKey bump is not forward-secret.
 * Kept for tests that explicitly pass baseKey.
 */
export async function bumpEpochAndRotateWrapsOnClient(params: {
  gateway: VaultSyncClientGateway;
  vaultId: string;
  actorAccountId: string;
  password: string;
  members?: ActiveMemberForWrap[];
}): Promise<{ keyEpoch: number; rotatedCount: number }> {
  return rotateMemberWrapsWithEpochBumpOnClient(params);
}

/** Forward-secret rotation: bump epoch + new random BaseKey + re-wrap + local seal. */
export async function rotateMemberWrapsWithEpochBumpOnClient(params: {
  gateway: VaultSyncClientGateway;
  vaultId: string;
  actorAccountId: string;
  password: string;
  members?: ActiveMemberForWrap[];
}): Promise<{ keyEpoch: number; rotatedCount: number }> {
  if (!params.gateway.bumpVaultSyncEncryptionVersion) {
    throw new Error("bump encryption version RPC unavailable");
  }
  if (!params.password) {
    throw new Error("password required to seal rotated base key");
  }
  const status = await params.gateway.vaultSyncStatus({ vaultId: params.vaultId });
  const expectedCurrent = status.encryptionVersion ?? 1;
  const bumped = await params.gateway.bumpVaultSyncEncryptionVersion({
    vaultId: params.vaultId,
    expectedCurrent,
  });
  const keyEpoch = bumped.encryptionVersion ?? expectedCurrent + 1;
  const newBaseKey = generateRotatedBaseKey();
  const rotated = await rotateMemberWrapsOnClient({
    gateway: params.gateway,
    vaultId: params.vaultId,
    actorAccountId: params.actorAccountId,
    password: params.password,
    members: params.members,
    baseKey: newBaseKey,
    keyEpoch,
  });
  await sealAndStoreBaseKey({
    vaultId: params.vaultId,
    password: params.password,
    baseKey: newBaseKey,
    keyEpoch,
  });
  return { keyEpoch: rotated.keyEpoch, rotatedCount: rotated.rotatedCount };
}

/**
 * Wave M: revoke one member + bump epoch + re-wrap remaining members in one Gateway CAS commit.
 * Prefer this over revoke-then-rotateMemberWrapsWithEpochBumpOnClient.
 */
export async function revokeMemberAndRotateOnClient(params: {
  gateway: VaultSyncClientGateway;
  vaultId: string;
  actorAccountId: string;
  memberAccountId: string;
  password: string;
  members?: ActiveMemberForWrap[];
}): Promise<{ keyEpoch: number; rotatedCount: number }> {
  if (!params.gateway.revokeVaultSyncMemberAndRotate) {
    throw new Error("revoke-and-rotate RPC unavailable");
  }
  if (!params.password) {
    throw new Error("password required to seal rotated base key");
  }
  const status = await params.gateway.vaultSyncStatus({ vaultId: params.vaultId });
  if (!status.saltB64) {
    throw new Error("vault salt unavailable");
  }
  const expectedCurrent = status.encryptionVersion ?? 1;
  const keyEpoch = expectedCurrent + 1;
  const newBaseKey = generateRotatedBaseKey();

  let activeMembers = params.members;
  if (!activeMembers) {
    if (!params.gateway.listVaultSyncMembers) {
      throw new Error("list members RPC unavailable");
    }
    const listed = await params.gateway.listVaultSyncMembers({ vaultId: params.vaultId });
    activeMembers = listActiveMembersForWrap(listed.members ?? []);
  }
  const remaining = activeMembers.filter(
    (member) => member.memberAccountId !== params.memberAccountId,
  );
  if (remaining.length === 0) {
    throw new Error("no remaining active members after revoke");
  }

  const wraps = await Promise.all(
    remaining.map(async (member) => {
      const wrapped = await wrapBaseKeyForMember({
        baseKey: newBaseKey,
        recipientPublicKeyB64: member.publicKeyB64,
        vaultId: params.vaultId,
        memberAccountId: member.memberAccountId,
        keyEpoch,
      });
      return {
        memberAccountId: member.memberAccountId,
        ephemeralPublicKeyB64: wrapped.ephemeralPublicKeyB64,
        wrappedBaseKeyB64: wrapped.wrappedBaseKeyB64,
      };
    }),
  );

  const result = await params.gateway.revokeVaultSyncMemberAndRotate({
    vaultId: params.vaultId,
    memberAccountId: params.memberAccountId,
    actorAccountId: params.actorAccountId,
    expectedCurrentEncryptionVersion: expectedCurrent,
    wraps,
  });
  const committedEpoch = result.encryptionVersion ?? keyEpoch;
  await sealAndStoreBaseKey({
    vaultId: params.vaultId,
    password: params.password,
    baseKey: newBaseKey,
    keyEpoch: committedEpoch,
  });
  return { keyEpoch: committedEpoch, rotatedCount: wraps.length };
}
