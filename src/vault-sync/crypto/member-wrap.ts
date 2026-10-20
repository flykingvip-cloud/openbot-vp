/**
 * Team vault member key wrapping (P4.1).
 * BaseKey is wrapped to a member's X25519 public key via ephemeral ECDH + AES-256-GCM.
 * Server stores only ciphertext packages — never BaseKey or private keys.
 */
import {
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  randomBytes,
  createHmac,
  type KeyObject,
} from "node:crypto";

const NONCE_LEN = 12;
const TAG_LEN = 16;
const WRAP_INFO = Buffer.from("openbot-vault-sync/member-wrap/v1", "utf8");

export type MemberKeyPair = {
  publicKeyB64: string;
  privateKeyB64: string;
};

export type WrappedBaseKeyPackage = {
  ephemeralPublicKeyB64: string;
  /** nonce || ciphertext || tag (base64) */
  wrappedBaseKeyB64: string;
  keyEpoch: number;
};

function hkdfSha256(ikm: Buffer, salt: Buffer, info: Buffer, length: number): Buffer {
  const prk = createHmac("sha256", salt).update(ikm).digest();
  const blocks: Buffer[] = [];
  let prev = Buffer.alloc(0);
  let counter = 1;
  while (Buffer.concat(blocks).length < length) {
    const block = createHmac("sha256", prk)
      .update(prev)
      .update(info)
      .update(Buffer.from([counter]))
      .digest();
    blocks.push(block);
    prev = block;
    counter += 1;
  }
  return Buffer.concat(blocks).subarray(0, length);
}

function exportPublicB64(key: KeyObject): string {
  return key.export({ type: "spki", format: "der" }).toString("base64");
}

function exportPrivateB64(key: KeyObject): string {
  return key.export({ type: "pkcs8", format: "der" }).toString("base64");
}

function importPublic(publicKeyB64: string): KeyObject {
  return createPublicKey({
    key: Buffer.from(publicKeyB64, "base64"),
    format: "der",
    type: "spki",
  });
}

function importPrivate(privateKeyB64: string): KeyObject {
  return createPrivateKey({
    key: Buffer.from(privateKeyB64, "base64"),
    format: "der",
    type: "pkcs8",
  });
}

export function generateMemberKeyPair(): MemberKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync("x25519");
  return {
    publicKeyB64: exportPublicB64(publicKey),
    privateKeyB64: exportPrivateB64(privateKey),
  };
}

function buildWrapAad(params: {
  vaultId: string;
  memberAccountId: string;
  keyEpoch: number;
}): Buffer {
  return Buffer.from(
    `${params.vaultId}|${params.memberAccountId}|${params.keyEpoch}|member-wrap-v1`,
    "utf8",
  );
}

function deriveWrapKey(sharedSecret: Buffer, vaultId: string): Buffer {
  return hkdfSha256(sharedSecret, Buffer.from(vaultId, "utf8"), WRAP_INFO, 32);
}

/** Wrap vault BaseKey to a member public key (owner/admin side). */
export function wrapBaseKeyForMember(params: {
  baseKey: Buffer;
  recipientPublicKeyB64: string;
  vaultId: string;
  memberAccountId: string;
  keyEpoch: number;
}): WrappedBaseKeyPackage {
  if (params.baseKey.length !== 32) {
    throw new Error("invalid base key");
  }
  const recipient = importPublic(params.recipientPublicKeyB64);
  const ephemeral = generateKeyPairSync("x25519");
  const shared = diffieHellman({
    privateKey: ephemeral.privateKey,
    publicKey: recipient,
  });
  const wrapKey = deriveWrapKey(shared, params.vaultId);
  const nonce = randomBytes(NONCE_LEN);
  const aad = buildWrapAad(params);
  const cipher = createCipheriv("aes-256-gcm", wrapKey, nonce);
  cipher.setAAD(aad);
  const encrypted = Buffer.concat([cipher.update(params.baseKey), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ephemeralPublicKeyB64: exportPublicB64(ephemeral.publicKey),
    wrappedBaseKeyB64: Buffer.concat([nonce, encrypted, tag]).toString("base64"),
    keyEpoch: params.keyEpoch,
  };
}

/** Unwrap BaseKey with member private key. Fail closed. */
export function unwrapBaseKeyForMember(params: {
  package: WrappedBaseKeyPackage;
  recipientPrivateKeyB64: string;
  vaultId: string;
  memberAccountId: string;
}): Buffer {
  try {
    const recipientPrivate = importPrivate(params.recipientPrivateKeyB64);
    const ephemeralPublic = importPublic(params.package.ephemeralPublicKeyB64);
    const shared = diffieHellman({
      privateKey: recipientPrivate,
      publicKey: ephemeralPublic,
    });
    const wrapKey = deriveWrapKey(shared, params.vaultId);
    const blob = Buffer.from(params.package.wrappedBaseKeyB64, "base64");
    if (blob.length < NONCE_LEN + TAG_LEN + 32) {
      throw new Error("short");
    }
    const nonce = blob.subarray(0, NONCE_LEN);
    const tag = blob.subarray(blob.length - TAG_LEN);
    const data = blob.subarray(NONCE_LEN, blob.length - TAG_LEN);
    const aad = buildWrapAad({
      vaultId: params.vaultId,
      memberAccountId: params.memberAccountId,
      keyEpoch: params.package.keyEpoch,
    });
    const decipher = createDecipheriv("aes-256-gcm", wrapKey, nonce);
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(data), decipher.final()]);
    if (plain.length !== 32) {
      throw new Error("bad length");
    }
    return plain;
  } catch {
    throw new Error("unwrap failed");
  }
}

/**
 * Symmetric wrap for invite codes (out-of-band secret).
 * Invite code never stored on server — only the wrapped package + salt.
 */
export function wrapBaseKeyWithInviteSecret(params: {
  baseKey: Buffer;
  inviteSecret: string;
  inviteSalt: Buffer;
  vaultId: string;
  inviteId: string;
  keyEpoch: number;
}): { wrappedBaseKeyB64: string } {
  if (params.baseKey.length !== 32) {
    throw new Error("invalid base key");
  }
  if (!params.inviteSecret) {
    throw new Error("invite secret required");
  }
  const wrapKey = createHmac("sha256", params.inviteSalt)
    .update(params.inviteSecret, "utf8")
    .update("|invite-wrap-v1", "utf8")
    .digest();
  const nonce = randomBytes(NONCE_LEN);
  const aad = Buffer.from(
    `${params.vaultId}|${params.inviteId}|${params.keyEpoch}|invite-wrap-v1`,
    "utf8",
  );
  const cipher = createCipheriv("aes-256-gcm", wrapKey, nonce);
  cipher.setAAD(aad);
  const encrypted = Buffer.concat([cipher.update(params.baseKey), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    wrappedBaseKeyB64: Buffer.concat([nonce, encrypted, tag]).toString("base64"),
  };
}

export function unwrapBaseKeyWithInviteSecret(params: {
  wrappedBaseKeyB64: string;
  inviteSecret: string;
  inviteSalt: Buffer;
  vaultId: string;
  inviteId: string;
  keyEpoch: number;
}): Buffer {
  try {
    const wrapKey = createHmac("sha256", params.inviteSalt)
      .update(params.inviteSecret, "utf8")
      .update("|invite-wrap-v1", "utf8")
      .digest();
    const blob = Buffer.from(params.wrappedBaseKeyB64, "base64");
    const nonce = blob.subarray(0, NONCE_LEN);
    const tag = blob.subarray(blob.length - TAG_LEN);
    const data = blob.subarray(NONCE_LEN, blob.length - TAG_LEN);
    const aad = Buffer.from(
      `${params.vaultId}|${params.inviteId}|${params.keyEpoch}|invite-wrap-v1`,
      "utf8",
    );
    const decipher = createDecipheriv("aes-256-gcm", wrapKey, nonce);
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(data), decipher.final()]);
    if (plain.length !== 32) {
      throw new Error("bad length");
    }
    return plain;
  } catch {
    throw new Error("unwrap failed");
  }
}

export function generateInviteSecret(): string {
  return randomBytes(24).toString("base64url");
}

export function generateInviteSalt(): Buffer {
  return randomBytes(16);
}
