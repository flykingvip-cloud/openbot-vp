/**
 * Browser-side Vault Sync crypto (R1). Matches Node `src/vault-sync/crypto/*` wire format.
 */
import { scrypt } from "@noble/hashes/scrypt.js";
import {
  asBufferSource,
  base64ToBytes,
  bytesToBase64,
  bytesToBase64Url,
  concatBytes,
  encodeUint64Be,
  hexToBytes,
  sha256Hex,
  utf8Encode,
} from "./bytes.ts";

export const VAULT_SYNC_PROTOCOL_VERSION = 1;
const NONCE_LEN = 12;
const TAG_LEN = 16;
const DIRECT_PUT_MAX_BYTES = 1024 * 1024;

const HKDF_INFO_BASE = {
  content: "openbot-vault-sync/content/v1",
  metadata: "openbot-vault-sync/metadata/v1",
  pathLookup: "openbot-vault-sync/path-lookup/v1",
  manifest: "openbot-vault-sync/manifest-auth/v1",
} as const;

export type ScryptKdfParams = {
  alg: "scrypt";
  N: number;
  r: number;
  p: number;
  dkLen: number;
};

export const DEFAULT_SCRYPT_PARAMS: ScryptKdfParams = {
  alg: "scrypt",
  N: 16384,
  r: 8,
  p: 1,
  dkLen: 32,
};

export type VaultKeySet = {
  contentKey: Uint8Array;
  metadataKey: Uint8Array;
  pathLookupKey: Uint8Array;
  manifestAuthKey: Uint8Array;
};

function hkdfInfoLabel(base: string, encryptionVersion: number): Uint8Array {
  if (encryptionVersion <= 1) {
    return utf8Encode(base);
  }
  return utf8Encode(`${base}/epoch/${encryptionVersion}`);
}

async function hmacSha256(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    asBufferSource(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, asBufferSource(data));
  return new Uint8Array(sig);
}

async function hkdfSha256(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  const prk = await hmacSha256(salt, ikm);
  const blocks: Uint8Array[] = [];
  let prev = new Uint8Array(0);
  let counter = 1;
  while (concatBytes(...blocks).length < length) {
    const block = await hmacSha256(prk, concatBytes(prev, info, new Uint8Array([counter])));
    blocks.push(asBufferSource(block));
    prev = asBufferSource(block);
    counter += 1;
  }
  return asBufferSource(concatBytes(...blocks).subarray(0, length));
}

export function generateVaultSalt(bytes = 16): Uint8Array {
  const salt = new Uint8Array(bytes);
  crypto.getRandomValues(salt);
  return salt;
}

/** Forward-secret epoch rotation: new random BaseKey unrelated to password KDF. */
export function generateRotatedBaseKey(): Uint8Array {
  return generateVaultSalt(32);
}

export function deriveBaseKey(params: {
  password: string;
  salt: Uint8Array;
  kdf?: ScryptKdfParams;
}): Uint8Array {
  const kdf = params.kdf ?? DEFAULT_SCRYPT_PARAMS;
  if (!params.password) {
    throw new Error("password required");
  }
  return scrypt(utf8Encode(params.password), params.salt, {
    N: kdf.N,
    r: kdf.r,
    p: kdf.p,
    dkLen: kdf.dkLen,
    maxmem: 64 * 1024 * 1024,
  });
}

export async function deriveVaultKeySet(
  baseKey: Uint8Array,
  encryptionVersion = 1,
): Promise<VaultKeySet> {
  const salt = new Uint8Array(32);
  return {
    contentKey: await hkdfSha256(
      baseKey,
      salt,
      hkdfInfoLabel(HKDF_INFO_BASE.content, encryptionVersion),
      32,
    ),
    metadataKey: await hkdfSha256(
      baseKey,
      salt,
      hkdfInfoLabel(HKDF_INFO_BASE.metadata, encryptionVersion),
      32,
    ),
    pathLookupKey: await hkdfSha256(
      baseKey,
      salt,
      hkdfInfoLabel(HKDF_INFO_BASE.pathLookup, encryptionVersion),
      32,
    ),
    manifestAuthKey: await hkdfSha256(
      baseKey,
      salt,
      hkdfInfoLabel(HKDF_INFO_BASE.manifest, encryptionVersion),
      32,
    ),
  };
}

export async function unlockVaultKeys(params: {
  password: string;
  saltB64: string;
  kdf?: ScryptKdfParams;
  encryptionVersion?: number;
  /** When set (e.g. post-rotation sealed BaseKey), skip password KDF. */
  baseKey?: Uint8Array;
}): Promise<VaultKeySet> {
  const baseKey =
    params.baseKey ??
    deriveBaseKey({
      password: params.password,
      salt: base64ToBytes(params.saltB64),
      kdf: params.kdf,
    });
  return deriveVaultKeySet(baseKey, params.encryptionVersion ?? 1);
}

function buildAad(params: {
  vaultId: string;
  opaquePathId: string;
  revisionId: string;
  encryptionVersion?: number;
}): Uint8Array {
  const version = params.encryptionVersion ?? 1;
  return utf8Encode(`${params.vaultId}|${params.opaquePathId}|${params.revisionId}|${version}`);
}

export function buildContentAad(params: {
  vaultId: string;
  opaquePathId: string;
  deviceId: string;
  deviceSequence: number;
  encryptionVersion?: number;
}): Uint8Array {
  const version = params.encryptionVersion ?? 1;
  return utf8Encode(
    `${params.vaultId}|${params.opaquePathId}|${params.deviceId}|${params.deviceSequence}|${version}`,
  );
}

async function importAesKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", asBufferSource(raw), "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encryptAead(params: {
  key: Uint8Array;
  plaintext: Uint8Array;
  vaultId: string;
  opaquePathId: string;
  revisionId: string;
  encryptionVersion?: number;
  nonce?: Uint8Array;
  aad?: Uint8Array;
}): Promise<Uint8Array> {
  if (params.key.length !== 32) {
    throw new Error("encryption failed");
  }
  const nonce = params.nonce ?? generateVaultSalt(NONCE_LEN);
  if (nonce.length !== NONCE_LEN) {
    throw new Error("encryption failed");
  }
  const aad = params.aad ?? buildAad(params);
  const cryptoKey = await importAesKey(params.key);
  const encrypted = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: asBufferSource(nonce),
      additionalData: asBufferSource(aad),
      tagLength: TAG_LEN * 8,
    },
    cryptoKey,
    asBufferSource(params.plaintext),
  );
  return concatBytes(nonce, new Uint8Array(encrypted));
}

export async function decryptAead(params: {
  key: Uint8Array;
  ciphertext: Uint8Array;
  vaultId: string;
  opaquePathId: string;
  revisionId: string;
  encryptionVersion?: number;
  aad?: Uint8Array;
}): Promise<Uint8Array> {
  try {
    if (params.key.length !== 32 || params.ciphertext.length < NONCE_LEN + TAG_LEN) {
      throw new Error("short");
    }
    const nonce = params.ciphertext.slice(0, NONCE_LEN);
    const payload = params.ciphertext.slice(NONCE_LEN);
    const aad = params.aad ?? buildAad(params);
    const cryptoKey = await importAesKey(params.key);
    const plain = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: asBufferSource(nonce),
        additionalData: asBufferSource(aad),
        tagLength: TAG_LEN * 8,
      },
      cryptoKey,
      asBufferSource(payload),
    );
    return new Uint8Array(plain);
  } catch {
    throw new Error("decryption failed");
  }
}

export async function hashCiphertext(ciphertext: Uint8Array): Promise<string> {
  return sha256Hex(ciphertext);
}

export async function computeOpaquePathId(
  pathLookupKey: Uint8Array,
  relativePath: string,
): Promise<string> {
  const normalized = relativePath
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "")
    .trim();
  if (!normalized || normalized.includes("..")) {
    throw new Error("invalid relative path");
  }
  const mac = await hmacSha256(pathLookupKey, utf8Encode(normalized));
  return bytesToBase64Url(mac);
}

export async function computeRevisionId(params: {
  vaultId: string;
  opaquePathId: string;
  deviceId: string;
  deviceSequence: number;
  ciphertextHash: string;
  parentRevisionIds: string[];
  protocolVersion?: number;
}): Promise<string> {
  const protocolVersion = params.protocolVersion ?? VAULT_SYNC_PROTOCOL_VERSION;
  const parents = [...params.parentRevisionIds]
    .map((p) => p.trim())
    .filter(Boolean)
    .toSorted();
  const parts = [
    utf8Encode(params.vaultId),
    new Uint8Array([0]),
    utf8Encode(params.opaquePathId),
    new Uint8Array([0]),
    utf8Encode(params.deviceId),
    new Uint8Array([0]),
    encodeUint64Be(params.deviceSequence),
    new Uint8Array([0]),
    utf8Encode(params.ciphertextHash),
    new Uint8Array([0]),
    utf8Encode(parents.join("\n")),
    new Uint8Array([0]),
    utf8Encode(String(protocolVersion)),
  ];
  const digest = await crypto.subtle.digest("SHA-256", asBufferSource(concatBytes(...parts)));
  return bytesToBase64Url(new Uint8Array(digest));
}

export function ciphertextToBase64(ciphertext: Uint8Array): string {
  return bytesToBase64(ciphertext);
}

export function ciphertextFromBase64(base64: string): Uint8Array {
  return base64ToBytes(base64);
}

export { DIRECT_PUT_MAX_BYTES, hexToBytes };
