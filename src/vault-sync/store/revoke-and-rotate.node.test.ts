import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generateRotatedBaseKey } from "../crypto/keys.js";
import { generateMemberKeyPair, wrapBaseKeyForMember } from "../crypto/member-wrap.js";
import { VaultSyncControlPlane } from "./control-plane.js";

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("revokeMemberAndRotateEpoch (Wave M atomic)", () => {
  function setupTeam() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "vault-atomic-revoke-"));
    tmpDirs.push(root);
    const plane = new VaultSyncControlPlane(root);
    const vault = plane.createVault({
      ownerAccountId: "owner-1",
      saltB64: Buffer.from("0123456789abcdef").toString("base64"),
    });
    const ownerKeys = generateMemberKeyPair();
    const memberKeys = generateMemberKeyPair();
    const baseKey = generateRotatedBaseKey();
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
      keyEpoch: vault.encryptionVersion,
    });
    const invite = plane.createInvite({
      vaultId: vault.vaultId,
      invitedByAccountId: "owner-1",
      inviteSaltB64: Buffer.from("inv-salt").toString("base64"),
      wrappedBaseKeyB64: Buffer.from("wrap-invite").toString("base64"),
    });
    const memberWrap = wrapBaseKeyForMember({
      baseKey,
      recipientPublicKeyB64: memberKeys.publicKeyB64,
      vaultId: vault.vaultId,
      memberAccountId: "member-2",
      keyEpoch: vault.encryptionVersion,
    });
    plane.acceptInvite({
      vaultId: vault.vaultId,
      inviteId: invite.inviteId,
      memberAccountId: "member-2",
      publicKeyB64: memberKeys.publicKeyB64,
      ephemeralPublicKeyB64: memberWrap.ephemeralPublicKeyB64,
      wrappedBaseKeyB64: memberWrap.wrappedBaseKeyB64,
    });
    return { plane, vault, ownerKeys };
  }

  it("atomically revokes, bumps epoch, and applies wraps", () => {
    const { plane, vault, ownerKeys } = setupTeam();
    const epochBefore = plane.getVault(vault.vaultId)!.encryptionVersion;
    const freshBase = generateRotatedBaseKey();
    const nextEpoch = epochBefore + 1;
    const ownerWrap = wrapBaseKeyForMember({
      baseKey: freshBase,
      recipientPublicKeyB64: ownerKeys.publicKeyB64,
      vaultId: vault.vaultId,
      memberAccountId: "owner-1",
      keyEpoch: nextEpoch,
    });
    const result = plane.revokeMemberAndRotateEpoch({
      vaultId: vault.vaultId,
      memberAccountId: "member-2",
      actorAccountId: "owner-1",
      expectedCurrentEncryptionVersion: epochBefore,
      wraps: [
        {
          memberAccountId: "owner-1",
          ephemeralPublicKeyB64: ownerWrap.ephemeralPublicKeyB64,
          wrappedBaseKeyB64: ownerWrap.wrappedBaseKeyB64,
        },
      ],
    });
    expect(result.encryptionVersion).toBe(nextEpoch);
    expect(result.revoked.status).toBe("revoked");
    expect(plane.getVault(vault.vaultId)!.encryptionVersion).toBe(nextEpoch);
    expect(plane.getMember(vault.vaultId, "member-2")?.status).toBe("revoked");
    expect(plane.getMember(vault.vaultId, "owner-1")?.keyEpoch).toBe(nextEpoch);
    expect(
      plane
        .listAuditEvents(vault.vaultId)
        .some((e) => e.eventType === "member_revoked_and_rotated"),
    ).toBe(true);
  });

  it("CAS failure leaves member and epoch unchanged", () => {
    const { plane, vault, ownerKeys } = setupTeam();
    const epochBefore = plane.getVault(vault.vaultId)!.encryptionVersion;
    const freshBase = generateRotatedBaseKey();
    const ownerWrap = wrapBaseKeyForMember({
      baseKey: freshBase,
      recipientPublicKeyB64: ownerKeys.publicKeyB64,
      vaultId: vault.vaultId,
      memberAccountId: "owner-1",
      keyEpoch: epochBefore + 1,
    });
    expect(() =>
      plane.revokeMemberAndRotateEpoch({
        vaultId: vault.vaultId,
        memberAccountId: "member-2",
        actorAccountId: "owner-1",
        expectedCurrentEncryptionVersion: epochBefore + 9,
        wraps: [
          {
            memberAccountId: "owner-1",
            ephemeralPublicKeyB64: ownerWrap.ephemeralPublicKeyB64,
            wrappedBaseKeyB64: ownerWrap.wrappedBaseKeyB64,
          },
        ],
      }),
    ).toThrow(/encryption version conflict/);
    expect(plane.getVault(vault.vaultId)!.encryptionVersion).toBe(epochBefore);
    expect(plane.getMember(vault.vaultId, "member-2")?.status).toBe("active");
  });
});
