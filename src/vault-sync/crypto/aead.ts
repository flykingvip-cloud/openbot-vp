import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { VAULT_SYNC_ENCRYPTION_VERSION } from "../types.js";

const NONCE_LEN = 12;
const TAG_LEN = 16;

export type AeadPayload = {
  /** nonce || ciphertext || tag */
  ciphertext: Buffer;
  nonce: Buffer;
};

function buildAad(params: {
  vaultId: string;
  opaquePathId: string;
  revisionId: string;
  encryptionVersion?: number;
}): Buffer {
  const version = params.encryptionVersion ?? VAULT_SYNC_ENCRYPTION_VERSION;
  return Buffer.from(
    `${params.vaultId}|${params.opaquePathId}|${params.revisionId}|${version}`,
    "utf8",
  );
}

/** Content-body AAD: binds vault/path/device/sequence without revisionId (avoids hash fixed-point loop). */
export function buildContentAad(params: {
  vaultId: string;
  opaquePathId: string;
  deviceId: string;
  deviceSequence: number;
  encryptionVersion?: number;
}): Buffer {
  const version = params.encryptionVersion ?? VAULT_SYNC_ENCRYPTION_VERSION;
  return Buffer.from(
    `${params.vaultId}|${params.opaquePathId}|${params.deviceId}|${params.deviceSequence}|${version}`,
    "utf8",
  );
}

/**
 * AES-256-GCM with random nonce. Fail closed on auth failure.
 * Does not leak crypto internals in thrown messages.
 */
export function encryptAead(params: {
  key: Buffer;
  plaintext: Buffer;
  vaultId: string;
  opaquePathId: string;
  revisionId: string;
  encryptionVersion?: number;
  /** Test-only: inject nonce (must be unique per key). */
  nonce?: Buffer;
  /** Override AAD (e.g. content body uses buildContentAad). */
  aad?: Buffer;
}): AeadPayload {
  if (params.key.length !== 32) {
    throw new Error("encryption failed");
  }
  const nonce = params.nonce ?? randomBytes(NONCE_LEN);
  if (nonce.length !== NONCE_LEN) {
    throw new Error("encryption failed");
  }
  const aad = params.aad ?? buildAad(params);
  const cipher = createCipheriv("aes-256-gcm", params.key, nonce);
  cipher.setAAD(aad);
  const encrypted = Buffer.concat([cipher.update(params.plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    nonce,
    ciphertext: Buffer.concat([nonce, encrypted, tag]),
  };
}

export function decryptAead(params: {
  key: Buffer;
  ciphertext: Buffer;
  vaultId: string;
  opaquePathId: string;
  revisionId: string;
  encryptionVersion?: number;
  aad?: Buffer;
}): Buffer {
  try {
    if (params.key.length !== 32) {
      throw new Error("bad key");
    }
    if (params.ciphertext.length < NONCE_LEN + TAG_LEN) {
      throw new Error("short");
    }
    const nonce = params.ciphertext.subarray(0, NONCE_LEN);
    const tag = params.ciphertext.subarray(params.ciphertext.length - TAG_LEN);
    const data = params.ciphertext.subarray(NONCE_LEN, params.ciphertext.length - TAG_LEN);
    const aad = params.aad ?? buildAad(params);
    const decipher = createDecipheriv("aes-256-gcm", params.key, nonce);
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]);
  } catch {
    // Fail closed — do not surface crypto internals / paths.
    throw new Error("decryption failed");
  }
}

export function hashCiphertext(ciphertext: Buffer): string {
  return createHash("sha256").update(ciphertext).digest("hex");
}

export function encryptJsonMetadata(params: {
  metadataKey: Buffer;
  metadata: unknown;
  vaultId: string;
  opaquePathId: string;
  revisionId: string;
}): { encryptedMetadataB64: string; ciphertextHash: string } {
  const plaintext = Buffer.from(JSON.stringify(params.metadata), "utf8");
  const { ciphertext } = encryptAead({
    key: params.metadataKey,
    plaintext,
    vaultId: params.vaultId,
    opaquePathId: params.opaquePathId,
    revisionId: params.revisionId,
  });
  return {
    encryptedMetadataB64: ciphertext.toString("base64"),
    ciphertextHash: hashCiphertext(ciphertext),
  };
}

export function decryptJsonMetadata<T>(params: {
  metadataKey: Buffer;
  encryptedMetadataB64: string;
  vaultId: string;
  opaquePathId: string;
  revisionId: string;
}): T {
  const ciphertext = Buffer.from(params.encryptedMetadataB64, "base64");
  const plaintext = decryptAead({
    key: params.metadataKey,
    ciphertext,
    vaultId: params.vaultId,
    opaquePathId: params.opaquePathId,
    revisionId: params.revisionId,
  });
  return JSON.parse(plaintext.toString("utf8")) as T;
}
