import { describe, expect, it } from "vitest";
import { deriveBaseKey, generateVaultSalt } from "./keys.js";
import {
  generateInviteSalt,
  generateInviteSecret,
  generateMemberKeyPair,
  unwrapBaseKeyForMember,
  unwrapBaseKeyWithInviteSecret,
  wrapBaseKeyForMember,
  wrapBaseKeyWithInviteSecret,
} from "./member-wrap.js";

describe("vault-sync member wrap (P4.1)", () => {
  it("wraps BaseKey to member X25519 key and unwraps", () => {
    const member = generateMemberKeyPair();
    const baseKey = deriveBaseKey({
      password: "team-owner-password",
      salt: generateVaultSalt(),
    });
    const wrapped = wrapBaseKeyForMember({
      baseKey,
      recipientPublicKeyB64: member.publicKeyB64,
      vaultId: "vault-1",
      memberAccountId: "alice",
      keyEpoch: 1,
    });
    const opened = unwrapBaseKeyForMember({
      package: wrapped,
      recipientPrivateKeyB64: member.privateKeyB64,
      vaultId: "vault-1",
      memberAccountId: "alice",
    });
    expect(opened.equals(baseKey)).toBe(true);
  });

  it("fails closed on wrong private key or AAD identity", () => {
    const alice = generateMemberKeyPair();
    const bob = generateMemberKeyPair();
    const baseKey = deriveBaseKey({ password: "pw", salt: generateVaultSalt() });
    const wrapped = wrapBaseKeyForMember({
      baseKey,
      recipientPublicKeyB64: alice.publicKeyB64,
      vaultId: "vault-1",
      memberAccountId: "alice",
      keyEpoch: 1,
    });
    expect(() =>
      unwrapBaseKeyForMember({
        package: wrapped,
        recipientPrivateKeyB64: bob.privateKeyB64,
        vaultId: "vault-1",
        memberAccountId: "alice",
      }),
    ).toThrow(/unwrap failed/);
    expect(() =>
      unwrapBaseKeyForMember({
        package: wrapped,
        recipientPrivateKeyB64: alice.privateKeyB64,
        vaultId: "vault-1",
        memberAccountId: "bob",
      }),
    ).toThrow(/unwrap failed/);
  });

  it("invite-secret wrap round-trips and rejects wrong secret", () => {
    const baseKey = deriveBaseKey({ password: "pw", salt: generateVaultSalt() });
    const secret = generateInviteSecret();
    const salt = generateInviteSalt();
    const { wrappedBaseKeyB64 } = wrapBaseKeyWithInviteSecret({
      baseKey,
      inviteSecret: secret,
      inviteSalt: salt,
      vaultId: "vault-1",
      inviteId: "invite-1",
      keyEpoch: 1,
    });
    const opened = unwrapBaseKeyWithInviteSecret({
      wrappedBaseKeyB64,
      inviteSecret: secret,
      inviteSalt: salt,
      vaultId: "vault-1",
      inviteId: "invite-1",
      keyEpoch: 1,
    });
    expect(opened.equals(baseKey)).toBe(true);
    expect(() =>
      unwrapBaseKeyWithInviteSecret({
        wrappedBaseKeyB64,
        inviteSecret: "wrong-secret",
        inviteSalt: salt,
        vaultId: "vault-1",
        inviteId: "invite-1",
        keyEpoch: 1,
      }),
    ).toThrow(/unwrap failed/);
  });
});
