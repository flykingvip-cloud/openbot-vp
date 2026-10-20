/**
 * Desktop / local-gateway helpers for team vault ops (P4.1 UI).
 * Password and invite secrets are used only in-process on the gateway host to
 * derive/wrap BaseKey — never persisted by the control plane.
 */
import { randomUUID } from "node:crypto";
import { deriveBaseKey } from "../crypto/keys.js";
import {
  generateInviteSalt,
  generateInviteSecret,
  generateMemberKeyPair,
  unwrapBaseKeyWithInviteSecret,
  wrapBaseKeyForMember,
  wrapBaseKeyWithInviteSecret,
} from "../crypto/member-wrap.js";
import type { VaultSyncControlPlane } from "../store/control-plane.js";
import type { VaultInviteRecord, VaultMemberRecord } from "../types.js";

function loadBaseKey(plane: VaultSyncControlPlane, vaultId: string, password: string): Buffer {
  const vault = plane.getVault(vaultId);
  if (!vault) {
    throw new Error("vault not found");
  }
  if (!password) {
    throw new Error("password required");
  }
  return deriveBaseKey({
    password,
    salt: Buffer.from(vault.saltB64, "base64"),
    kdf: vault.kdfParams,
  });
}

export function enableTeamWithPassword(params: {
  controlPlane: VaultSyncControlPlane;
  vaultId: string;
  ownerAccountId: string;
  password: string;
}): VaultMemberRecord {
  const baseKey = loadBaseKey(params.controlPlane, params.vaultId, params.password);
  const keyPair = generateMemberKeyPair();
  const vault = params.controlPlane.getVault(params.vaultId);
  if (!vault) {
    throw new Error("vault not found");
  }
  const wrapped = wrapBaseKeyForMember({
    baseKey,
    recipientPublicKeyB64: keyPair.publicKeyB64,
    vaultId: params.vaultId,
    memberAccountId: params.ownerAccountId,
    keyEpoch: vault.encryptionVersion,
  });
  return params.controlPlane.enableTeamWithOwner({
    vaultId: params.vaultId,
    ownerAccountId: params.ownerAccountId,
    publicKeyB64: keyPair.publicKeyB64,
    ephemeralPublicKeyB64: wrapped.ephemeralPublicKeyB64,
    wrappedBaseKeyB64: wrapped.wrappedBaseKeyB64,
    keyEpoch: wrapped.keyEpoch,
  });
}

export function createInviteWithPassword(params: {
  controlPlane: VaultSyncControlPlane;
  vaultId: string;
  invitedByAccountId: string;
  password: string;
  inviteeAccountId?: string | null;
  role?: "admin" | "member";
  ttlMs?: number;
}): { invite: VaultInviteRecord; inviteSecret: string } {
  const baseKey = loadBaseKey(params.controlPlane, params.vaultId, params.password);
  const vault = params.controlPlane.getVault(params.vaultId);
  if (!vault) {
    throw new Error("vault not found");
  }
  const inviteSecret = generateInviteSecret();
  const inviteSalt = generateInviteSalt();
  const inviteId = randomUUID();
  const { wrappedBaseKeyB64 } = wrapBaseKeyWithInviteSecret({
    baseKey,
    inviteSecret,
    inviteSalt,
    vaultId: params.vaultId,
    inviteId,
    keyEpoch: vault.encryptionVersion,
  });
  const invite = params.controlPlane.createInvite({
    vaultId: params.vaultId,
    invitedByAccountId: params.invitedByAccountId,
    inviteSaltB64: inviteSalt.toString("base64"),
    wrappedBaseKeyB64,
    inviteId,
    inviteeAccountId: params.inviteeAccountId ?? null,
    role: params.role ?? "member",
    ttlMs: params.ttlMs,
  });
  return { invite, inviteSecret };
}

export function acceptInviteWithSecret(params: {
  controlPlane: VaultSyncControlPlane;
  vaultId: string;
  inviteId: string;
  memberAccountId: string;
  inviteSecret: string;
}): VaultMemberRecord {
  const invite = params.controlPlane.getInvite(params.vaultId, params.inviteId);
  if (!invite) {
    throw new Error("invite not found");
  }
  if (invite.status !== "pending") {
    throw new Error("invite not pending");
  }
  const baseKey = unwrapBaseKeyWithInviteSecret({
    wrappedBaseKeyB64: invite.wrappedBaseKeyB64,
    inviteSecret: params.inviteSecret,
    inviteSalt: Buffer.from(invite.inviteSaltB64, "base64"),
    vaultId: params.vaultId,
    inviteId: invite.inviteId,
    keyEpoch: invite.keyEpoch,
  });
  const keyPair = generateMemberKeyPair();
  const wrapped = wrapBaseKeyForMember({
    baseKey,
    recipientPublicKeyB64: keyPair.publicKeyB64,
    vaultId: params.vaultId,
    memberAccountId: params.memberAccountId,
    keyEpoch: invite.keyEpoch,
  });
  return params.controlPlane.acceptInvite({
    vaultId: params.vaultId,
    inviteId: invite.inviteId,
    memberAccountId: params.memberAccountId,
    publicKeyB64: keyPair.publicKeyB64,
    ephemeralPublicKeyB64: wrapped.ephemeralPublicKeyB64,
    wrappedBaseKeyB64: wrapped.wrappedBaseKeyB64,
  });
}
