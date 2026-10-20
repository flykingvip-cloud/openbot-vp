import { describe, expect, it } from "vitest";
import { decryptAead, encryptAead, hashCiphertext } from "./aead.js";
import { computeOpaquePathId, deriveBaseKey, generateVaultSalt, unlockVaultKeys } from "./keys.js";

/** Fixed test vector for scrypt + AEAD round-trip (P1). */
const VECTOR = {
  password: "correct horse battery staple",
  saltHex: "00112233445566778899aabbccddeeff",
  plaintext: "hello vault sync",
  vaultId: "11111111-1111-1111-1111-111111111111",
  relativePath: "notes/welcome.md",
  revisionId: "rev-fixed-for-aad",
};

describe("vault-sync crypto", () => {
  it("derives stable keys for fixed password+salt", () => {
    const salt = Buffer.from(VECTOR.saltHex, "hex");
    const a = unlockVaultKeys({ password: VECTOR.password, salt });
    const b = unlockVaultKeys({ password: VECTOR.password, salt });
    expect(a.contentKey.equals(b.contentKey)).toBe(true);
    expect(a.metadataKey.equals(b.metadataKey)).toBe(true);
    expect(a.pathLookupKey.equals(b.pathLookupKey)).toBe(true);
  });

  it("opaquePathId hides plaintext path and is keyed", () => {
    const salt = Buffer.from(VECTOR.saltHex, "hex");
    const keys = unlockVaultKeys({ password: VECTOR.password, salt });
    const id = computeOpaquePathId(keys.pathLookupKey, VECTOR.relativePath);
    expect(id.includes("welcome")).toBe(false);
    expect(id.includes("notes")).toBe(false);
    const other = unlockVaultKeys({ password: "wrong password !!", salt });
    expect(computeOpaquePathId(other.pathLookupKey, VECTOR.relativePath)).not.toBe(id);
  });

  it("encrypt/decrypt round-trip with AAD binding", () => {
    const salt = Buffer.from(VECTOR.saltHex, "hex");
    const keys = unlockVaultKeys({ password: VECTOR.password, salt });
    const opaquePathId = computeOpaquePathId(keys.pathLookupKey, VECTOR.relativePath);
    const { ciphertext } = encryptAead({
      key: keys.contentKey,
      plaintext: Buffer.from(VECTOR.plaintext, "utf8"),
      vaultId: VECTOR.vaultId,
      opaquePathId,
      revisionId: VECTOR.revisionId,
      nonce: Buffer.alloc(12, 7),
    });
    const plain = decryptAead({
      key: keys.contentKey,
      ciphertext,
      vaultId: VECTOR.vaultId,
      opaquePathId,
      revisionId: VECTOR.revisionId,
    });
    expect(plain.toString("utf8")).toBe(VECTOR.plaintext);
    expect(hashCiphertext(ciphertext)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("fail closed on wrong password (cannot decrypt)", () => {
    const salt = generateVaultSalt();
    const good = unlockVaultKeys({ password: VECTOR.password, salt });
    const opaquePathId = computeOpaquePathId(good.pathLookupKey, VECTOR.relativePath);
    const { ciphertext } = encryptAead({
      key: good.contentKey,
      plaintext: Buffer.from(VECTOR.plaintext, "utf8"),
      vaultId: VECTOR.vaultId,
      opaquePathId,
      revisionId: VECTOR.revisionId,
    });
    const bad = unlockVaultKeys({ password: "not the password", salt });
    expect(() =>
      decryptAead({
        key: bad.contentKey,
        ciphertext,
        vaultId: VECTOR.vaultId,
        opaquePathId,
        revisionId: VECTOR.revisionId,
      }),
    ).toThrow(/decryption failed/);
  });

  it("fail closed on tampered ciphertext", () => {
    const salt = Buffer.from(VECTOR.saltHex, "hex");
    const keys = unlockVaultKeys({ password: VECTOR.password, salt });
    const opaquePathId = computeOpaquePathId(keys.pathLookupKey, VECTOR.relativePath);
    const { ciphertext } = encryptAead({
      key: keys.contentKey,
      plaintext: Buffer.from(VECTOR.plaintext, "utf8"),
      vaultId: VECTOR.vaultId,
      opaquePathId,
      revisionId: VECTOR.revisionId,
    });
    const tampered = Buffer.from(ciphertext);
    tampered[tampered.length - 1] ^= 0xff;
    expect(() =>
      decryptAead({
        key: keys.contentKey,
        ciphertext: tampered,
        vaultId: VECTOR.vaultId,
        opaquePathId,
        revisionId: VECTOR.revisionId,
      }),
    ).toThrow(/decryption failed/);
  });

  it("fail closed on AAD mismatch (wrong revisionId)", () => {
    const salt = Buffer.from(VECTOR.saltHex, "hex");
    const keys = unlockVaultKeys({ password: VECTOR.password, salt });
    const opaquePathId = computeOpaquePathId(keys.pathLookupKey, VECTOR.relativePath);
    const { ciphertext } = encryptAead({
      key: keys.contentKey,
      plaintext: Buffer.from(VECTOR.plaintext, "utf8"),
      vaultId: VECTOR.vaultId,
      opaquePathId,
      revisionId: VECTOR.revisionId,
    });
    expect(() =>
      decryptAead({
        key: keys.contentKey,
        ciphertext,
        vaultId: VECTOR.vaultId,
        opaquePathId,
        revisionId: "other-revision",
      }),
    ).toThrow(/decryption failed/);
  });

  it("uses unique nonces by default", () => {
    const salt = Buffer.from(VECTOR.saltHex, "hex");
    const keys = unlockVaultKeys({ password: VECTOR.password, salt });
    const opaquePathId = computeOpaquePathId(keys.pathLookupKey, VECTOR.relativePath);
    const nonces = new Set<string>();
    for (let i = 0; i < 32; i += 1) {
      const { nonce } = encryptAead({
        key: keys.contentKey,
        plaintext: Buffer.from(`msg-${i}`, "utf8"),
        vaultId: VECTOR.vaultId,
        opaquePathId,
        revisionId: `rev-${i}`,
      });
      nonces.add(nonce.toString("hex"));
    }
    expect(nonces.size).toBe(32);
  });

  it("deriveBaseKey rejects empty password", () => {
    expect(() => deriveBaseKey({ password: "", salt: Buffer.alloc(16) })).toThrow(
      /password required/,
    );
  });
});
