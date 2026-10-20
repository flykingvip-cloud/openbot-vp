import { describe, expect, it } from "vitest";
import { hexToBytes, bytesToBase64, utf8Encode } from "./bytes.ts";
import {
  computeOpaquePathId,
  decryptAead,
  encryptAead,
  hashCiphertext,
  unlockVaultKeys,
} from "./client-crypto.ts";

const VECTOR = {
  password: "correct horse battery staple",
  saltHex: "00112233445566778899aabbccddeeff",
  plaintext: "hello vault sync",
  vaultId: "11111111-1111-1111-1111-111111111111",
  relativePath: "notes/welcome.md",
  revisionId: "rev-fixed-for-aad",
};

describe("browser vault-sync client crypto", () => {
  it("derives stable keys for fixed password+salt", async () => {
    const saltB64 = bytesToBase64(hexToBytes(VECTOR.saltHex));
    const a = await unlockVaultKeys({ password: VECTOR.password, saltB64 });
    const b = await unlockVaultKeys({ password: VECTOR.password, saltB64 });
    expect(Buffer.from(a.contentKey).equals(Buffer.from(b.contentKey))).toBe(true);
    expect(Buffer.from(a.metadataKey).equals(Buffer.from(b.metadataKey))).toBe(true);
    expect(Buffer.from(a.pathLookupKey).equals(Buffer.from(b.pathLookupKey))).toBe(true);
  });

  it("opaquePathId hides plaintext path", async () => {
    const saltB64 = bytesToBase64(hexToBytes(VECTOR.saltHex));
    const keys = await unlockVaultKeys({ password: VECTOR.password, saltB64 });
    const id = await computeOpaquePathId(keys.pathLookupKey, VECTOR.relativePath);
    expect(id.includes("welcome")).toBe(false);
    expect(id.includes("notes")).toBe(false);
  });

  it("encrypt/decrypt round-trip with AAD binding", async () => {
    const saltB64 = bytesToBase64(hexToBytes(VECTOR.saltHex));
    const keys = await unlockVaultKeys({ password: VECTOR.password, saltB64 });
    const opaquePathId = await computeOpaquePathId(keys.pathLookupKey, VECTOR.relativePath);
    const nonce = new Uint8Array(12).fill(7);
    const body = await encryptAead({
      key: keys.contentKey,
      plaintext: utf8Encode(VECTOR.plaintext),
      vaultId: VECTOR.vaultId,
      opaquePathId,
      revisionId: VECTOR.revisionId,
      encryptionVersion: 1,
      nonce,
    });
    const plain = await decryptAead({
      key: keys.contentKey,
      ciphertext: body,
      vaultId: VECTOR.vaultId,
      opaquePathId,
      revisionId: VECTOR.revisionId,
      encryptionVersion: 1,
    });
    expect(new TextDecoder().decode(plain)).toBe(VECTOR.plaintext);
    expect(await hashCiphertext(body)).toMatch(/^[a-f0-9]{64}$/);
  });
});
