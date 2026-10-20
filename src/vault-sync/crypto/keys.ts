import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import {
  DEFAULT_SCRYPT_PARAMS,
  type ScryptKdfParams,
  type VaultKeySet,
  VAULT_SYNC_ENCRYPTION_VERSION,
} from "../types.js";

const HKDF_INFO_BASE = {
  content: "openbot-vault-sync/content/v1",
  metadata: "openbot-vault-sync/metadata/v1",
  pathLookup: "openbot-vault-sync/path-lookup/v1",
  manifest: "openbot-vault-sync/manifest-auth/v1",
} as const;

function hkdfInfoLabel(base: string, encryptionVersion: number): Buffer {
  if (encryptionVersion <= 1) {
    return Buffer.from(base, "utf8");
  }
  return Buffer.from(`${base}/epoch/${encryptionVersion}`, "utf8");
}

/** HKDF-SHA256 extract+expand (RFC 5869) via Node crypto primitives. */
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
    if (counter > 255) {
      throw new Error("hkdf counter overflow");
    }
  }
  return Buffer.concat(blocks).subarray(0, length);
}

export function generateVaultSalt(bytes = 16): Buffer {
  return randomBytes(bytes);
}

/**
 * Derive vault base key via scrypt (memory-hard, platform-audited).
 * P1 uses scrypt; encryptionVersion / kdf params allow future Argon2id migration.
 */
export function deriveBaseKey(params: {
  password: string;
  salt: Buffer;
  kdf?: ScryptKdfParams;
}): Buffer {
  const kdf = params.kdf ?? DEFAULT_SCRYPT_PARAMS;
  if (kdf.alg !== "scrypt") {
    throw new Error("unsupported kdf");
  }
  if (!params.password) {
    throw new Error("password required");
  }
  return scryptSync(params.password, params.salt, kdf.dkLen, {
    N: kdf.N,
    r: kdf.r,
    p: kdf.p,
    maxmem: 64 * 1024 * 1024,
  });
}

export function deriveVaultKeySet(baseKey: Buffer, encryptionVersion = 1): VaultKeySet {
  // salt for HKDF extract is zeros of hash len (common when salt already in KDF)
  const salt = Buffer.alloc(32, 0);
  return {
    contentKey: hkdfSha256(
      baseKey,
      salt,
      hkdfInfoLabel(HKDF_INFO_BASE.content, encryptionVersion),
      32,
    ),
    metadataKey: hkdfSha256(
      baseKey,
      salt,
      hkdfInfoLabel(HKDF_INFO_BASE.metadata, encryptionVersion),
      32,
    ),
    pathLookupKey: hkdfSha256(
      baseKey,
      salt,
      hkdfInfoLabel(HKDF_INFO_BASE.pathLookup, encryptionVersion),
      32,
    ),
    manifestAuthKey: hkdfSha256(
      baseKey,
      salt,
      hkdfInfoLabel(HKDF_INFO_BASE.manifest, encryptionVersion),
      32,
    ),
  };
}

/** Forward-secret epoch rotation: new random BaseKey unrelated to password KDF. */
export function generateRotatedBaseKey(): Buffer {
  return randomBytes(32);
}

export function unlockVaultKeys(params: {
  password: string;
  salt: Buffer;
  kdf?: ScryptKdfParams;
  encryptionVersion?: number;
}): VaultKeySet {
  return deriveVaultKeySet(deriveBaseKey(params), params.encryptionVersion ?? 1);
}

/** Opaque irreversible path id — never upload plaintext paths. */
export function computeOpaquePathId(pathLookupKey: Buffer, relativePath: string): string {
  const normalized = relativePath
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "")
    .trim();
  if (!normalized || normalized.includes("..")) {
    throw new Error("invalid relative path");
  }
  return createHmac("sha256", pathLookupKey).update(normalized, "utf8").digest("base64url");
}

export function assertKeysEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

export { VAULT_SYNC_ENCRYPTION_VERSION };
