import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { deriveBaseKey, generateVaultSalt } from "./crypto/keys.js";
import {
  generateInviteSalt,
  generateInviteSecret,
  generateMemberKeyPair,
  unwrapBaseKeyForMember,
  unwrapBaseKeyWithInviteSecret,
  wrapBaseKeyForMember,
  wrapBaseKeyWithInviteSecret,
} from "./crypto/member-wrap.js";
import { VaultSyncControlPlane } from "./store/control-plane.js";

const tmpDirs: string[] = [];

function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-sync-team-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("vault-sync team members (P4.1)", () => {
  it("enables team, invites, accepts, revokes, and rotates wraps", () => {
    const root = tmp();
    const plane = new VaultSyncControlPlane(path.join(root, "plane"));
    const ownerKeys = generateMemberKeyPair();
    const memberKeys = generateMemberKeyPair();
    const salt = generateVaultSalt();
    const baseKey = deriveBaseKey({ password: "owner-team-password", salt });

    const vault = plane.createVault({
      ownerAccountId: "owner-1",
      saltB64: salt.toString("base64"),
      teamEnabled: true,
    });
    const ownerWrap = wrapBaseKeyForMember({
      baseKey,
      recipientPublicKeyB64: ownerKeys.publicKeyB64,
      vaultId: vault.vaultId,
      memberAccountId: "owner-1",
      keyEpoch: vault.encryptionVersion,
    });
    plane.enableTeamWithOwner({
      vaultId: vault.vaultId,
      ownerAccountId: "owner-1",
      publicKeyB64: ownerKeys.publicKeyB64,
      ephemeralPublicKeyB64: ownerWrap.ephemeralPublicKeyB64,
      wrappedBaseKeyB64: ownerWrap.wrappedBaseKeyB64,
    });

    const inviteId = randomUUID();
    const inviteSecret = generateInviteSecret();
    const inviteSalt = generateInviteSalt();
    const inviteWrap = wrapBaseKeyWithInviteSecret({
      baseKey,
      inviteSecret,
      inviteSalt,
      vaultId: vault.vaultId,
      inviteId,
      keyEpoch: vault.encryptionVersion,
    });
    const invite = plane.createInvite({
      vaultId: vault.vaultId,
      invitedByAccountId: "owner-1",
      inviteId,
      inviteSaltB64: inviteSalt.toString("base64"),
      wrappedBaseKeyB64: inviteWrap.wrappedBaseKeyB64,
      role: "member",
    });
    expect(invite.status).toBe("pending");

    // Invitee unwraps with out-of-band secret, then re-wraps to their public key.
    const opened = unwrapBaseKeyWithInviteSecret({
      wrappedBaseKeyB64: invite.wrappedBaseKeyB64,
      inviteSecret,
      inviteSalt: Buffer.from(invite.inviteSaltB64, "base64"),
      vaultId: vault.vaultId,
      inviteId: invite.inviteId,
      keyEpoch: invite.keyEpoch,
    });
    expect(opened.equals(baseKey)).toBe(true);

    const memberWrap = wrapBaseKeyForMember({
      baseKey: opened,
      recipientPublicKeyB64: memberKeys.publicKeyB64,
      vaultId: vault.vaultId,
      memberAccountId: "member-2",
      keyEpoch: invite.keyEpoch,
    });
    const joined = plane.acceptInvite({
      vaultId: vault.vaultId,
      inviteId: invite.inviteId,
      memberAccountId: "member-2",
      publicKeyB64: memberKeys.publicKeyB64,
      ephemeralPublicKeyB64: memberWrap.ephemeralPublicKeyB64,
      wrappedBaseKeyB64: memberWrap.wrappedBaseKeyB64,
    });
    expect(joined.status).toBe("active");
    expect(plane.listMembers(vault.vaultId).filter((m) => m.status === "active")).toHaveLength(2);

    const memberPackage = plane.getMember(vault.vaultId, "member-2")!;
    const memberBase = unwrapBaseKeyForMember({
      package: {
        ephemeralPublicKeyB64: memberPackage.ephemeralPublicKeyB64!,
        wrappedBaseKeyB64: memberPackage.wrappedBaseKeyB64!,
        keyEpoch: memberPackage.keyEpoch,
      },
      recipientPrivateKeyB64: memberKeys.privateKeyB64,
      vaultId: vault.vaultId,
      memberAccountId: "member-2",
    });
    expect(memberBase.equals(baseKey)).toBe(true);

    plane.revokeMember({
      vaultId: vault.vaultId,
      memberAccountId: "member-2",
      actorAccountId: "owner-1",
    });
    expect(plane.getMember(vault.vaultId, "member-2")?.status).toBe("revoked");
    expect(() => plane.assertActiveMember(vault.vaultId, "member-2")).toThrow(/not a vault member/);

    // Rotate wraps for remaining active members (owner only after revoke).
    const freshOwnerWrap = wrapBaseKeyForMember({
      baseKey,
      recipientPublicKeyB64: ownerKeys.publicKeyB64,
      vaultId: vault.vaultId,
      memberAccountId: "owner-1",
      keyEpoch: vault.encryptionVersion,
    });
    const rotated = plane.rotateMemberWraps({
      vaultId: vault.vaultId,
      actorAccountId: "owner-1",
      keyEpoch: vault.encryptionVersion,
      wraps: [
        {
          memberAccountId: "owner-1",
          ephemeralPublicKeyB64: freshOwnerWrap.ephemeralPublicKeyB64,
          wrappedBaseKeyB64: freshOwnerWrap.wrappedBaseKeyB64,
        },
      ],
    });
    expect(rotated).toHaveLength(1);
    expect(
      plane.listAuditEvents(vault.vaultId).some((e) => e.eventType === "member_wraps_rotated"),
    ).toBe(true);
  });
});
