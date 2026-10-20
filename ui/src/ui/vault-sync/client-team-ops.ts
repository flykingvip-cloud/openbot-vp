/**
 * Browser-side team vault operations (R1): wrap keys locally, ship ciphertext only.
 */
import { bytesToBase64 } from "./bytes.ts";
import { loadSealedBaseKey, sealAndStoreBaseKey, saveMemberKeyPair } from "./client-key-store.ts";
import type { VaultSyncClientGateway } from "./client-sync-types.ts";
import {
  deriveBaseKeyFromPassword,
  generateInviteSalt,
  generateInviteSecret,
  generateMemberKeyPair,
  unwrapBaseKeyWithInviteSecret,
  wrapBaseKeyForMember,
  wrapBaseKeyWithInviteSecret,
} from "./client-team.ts";

async function loadBaseKeyFromPassword(params: {
  gateway: VaultSyncClientGateway;
  vaultId: string;
  password: string;
}): Promise<Uint8Array> {
  const status = await params.gateway.vaultSyncStatus({ vaultId: params.vaultId });
  if (!status.saltB64) {
    throw new Error("vault salt unavailable");
  }
  return deriveBaseKeyFromPassword({
    password: params.password,
    saltB64: status.saltB64,
    kdf: status.kdfParams,
  });
}

export async function enableTeamOnClient(params: {
  gateway: VaultSyncClientGateway;
  vaultId: string;
  ownerAccountId: string;
  password: string;
}): Promise<void> {
  const status = await params.gateway.vaultSyncStatus({ vaultId: params.vaultId });
  const encryptionVersion = status.encryptionVersion ?? 1;
  const baseKey = await loadBaseKeyFromPassword(params);
  const keyPair = await generateMemberKeyPair();
  saveMemberKeyPair(params.vaultId, params.ownerAccountId, keyPair);
  const wrapped = await wrapBaseKeyForMember({
    baseKey,
    recipientPublicKeyB64: keyPair.publicKeyB64,
    vaultId: params.vaultId,
    memberAccountId: params.ownerAccountId,
    keyEpoch: encryptionVersion,
  });
  await params.gateway.enableVaultSyncTeam?.({
    vaultId: params.vaultId,
    ownerAccountId: params.ownerAccountId,
    publicKeyB64: keyPair.publicKeyB64,
    ephemeralPublicKeyB64: wrapped.ephemeralPublicKeyB64,
    wrappedBaseKeyB64: wrapped.wrappedBaseKeyB64,
    keyEpoch: wrapped.keyEpoch,
  });
  await sealAndStoreBaseKey({
    vaultId: params.vaultId,
    password: params.password,
    baseKey,
    keyEpoch: encryptionVersion,
  });
}

export async function createInviteOnClient(params: {
  gateway: VaultSyncClientGateway;
  vaultId: string;
  invitedByAccountId: string;
  password: string;
  inviteeAccountId?: string | null;
}): Promise<{ inviteSecret: string; inviteId: string }> {
  const status = await params.gateway.vaultSyncStatus({ vaultId: params.vaultId });
  const encryptionVersion = status.encryptionVersion ?? 1;
  const sealed = await loadSealedBaseKey({
    vaultId: params.vaultId,
    password: params.password,
    expectedEpoch: encryptionVersion,
  });
  const baseKey = sealed?.baseKey ?? (await loadBaseKeyFromPassword(params));
  const inviteSecret = generateInviteSecret();
  const inviteSalt = generateInviteSalt();
  const inviteId = crypto.randomUUID();
  const { wrappedBaseKeyB64 } = await wrapBaseKeyWithInviteSecret({
    baseKey,
    inviteSecret,
    inviteSalt,
    vaultId: params.vaultId,
    inviteId,
    keyEpoch: encryptionVersion,
  });
  const created = await params.gateway.createVaultSyncInvite?.({
    vaultId: params.vaultId,
    invitedByAccountId: params.invitedByAccountId,
    inviteSaltB64: bytesToBase64(inviteSalt),
    wrappedBaseKeyB64,
    inviteId,
    inviteeAccountId: params.inviteeAccountId ?? null,
  });
  if (!created) {
    throw new Error("create invite not supported");
  }
  return { inviteSecret, inviteId };
}

export async function acceptInviteOnClient(params: {
  gateway: VaultSyncClientGateway;
  vaultId: string;
  inviteId: string;
  memberAccountId: string;
  inviteSecret: string;
  inviteSaltB64: string;
  wrappedBaseKeyB64: string;
  keyEpoch: number;
  password?: string;
}): Promise<void> {
  const baseKey = await unwrapBaseKeyWithInviteSecret({
    wrappedBaseKeyB64: params.wrappedBaseKeyB64,
    inviteSecret: params.inviteSecret,
    inviteSaltB64: params.inviteSaltB64,
    vaultId: params.vaultId,
    inviteId: params.inviteId,
    keyEpoch: params.keyEpoch,
  });
  const keyPair = await generateMemberKeyPair();
  saveMemberKeyPair(params.vaultId, params.memberAccountId, keyPair);
  const wrapped = await wrapBaseKeyForMember({
    baseKey,
    recipientPublicKeyB64: keyPair.publicKeyB64,
    vaultId: params.vaultId,
    memberAccountId: params.memberAccountId,
    keyEpoch: params.keyEpoch,
  });
  await params.gateway.acceptVaultSyncInvite?.({
    vaultId: params.vaultId,
    inviteId: params.inviteId,
    memberAccountId: params.memberAccountId,
    publicKeyB64: keyPair.publicKeyB64,
    ephemeralPublicKeyB64: wrapped.ephemeralPublicKeyB64,
    wrappedBaseKeyB64: wrapped.wrappedBaseKeyB64,
  });
  if (params.password) {
    await sealAndStoreBaseKey({
      vaultId: params.vaultId,
      password: params.password,
      baseKey,
      keyEpoch: params.keyEpoch,
    });
  }
}
