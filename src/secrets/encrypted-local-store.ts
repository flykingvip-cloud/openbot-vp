/**
 * secrets/encrypted-local-store.ts — encrypted-at-rest secret values backing the
 * "encrypted-local" SecretRef source (employee / enterprise self-service keys).
 *
 * SECURITY MODEL:
 * - Plaintext secret values are NEVER persisted. Each value is stored as
 *   AES-256-GCM ciphertext (random 12-byte IV per value + auth tag) at
 *   CONFIG_DIR/openbot-encrypted-secrets.json (file mode 0600).
 * - The AES key is derived (scrypt) from a MASTER KEY that is itself resolved
 *   from a SecretRef (env/file/exec → KMS); see resolveEncryptedLocalMasterKeyRef.
 *   The master key is never written to disk by this module.
 * - Decrypted plaintext is returned ONLY at runtime injection time and must
 *   never be logged or echoed.
 *
 * This module is intentionally PURE with respect to secret resolution: it takes
 * the already-resolved master key as input and never imports the secret resolver
 * (`src/secrets/resolve.ts`), so there is no import cycle (resolve.ts depends on
 * this module, not vice versa).
 */

import crypto from "node:crypto";
import path from "node:path";
import type { OpenBotConfig } from "../config/config.js";
import { coerceSecretRef, type SecretRef } from "../config/types.secrets.js";
import { createAsyncLock, readJsonFile, writeJsonAtomic } from "../infra/json-files.js";
import { CONFIG_DIR, resolveUserPath } from "../utils.js";

export const ENCRYPTED_LOCAL_SOURCE = "encrypted-local" as const;

const STORE_VERSION = 1;
const DEFAULT_MASTER_KEY_ENV = "OPENBOT_SECRET_MASTER_KEY"; // pragma: allowlist secret
const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_MAXMEM = 64 * 1024 * 1024;
const DERIVED_KEY_LEN = 32; // AES-256
const IV_LEN = 12; // AES-GCM standard nonce length

type EncryptedSecretEntry = {
  /** base64-encoded random IV (nonce). */
  iv: string;
  /** base64-encoded ciphertext. */
  ciphertext: string;
  /** base64-encoded GCM auth tag. */
  authTag: string;
  updatedAt: string;
};

type ScryptKdf = { algo: "scrypt"; salt: string; N: number; r: number; p: number };

type EncryptedLocalStore = {
  version: number;
  kdf: ScryptKdf;
  /** key = secret id → encrypted entry. */
  secrets: Record<string, EncryptedSecretEntry>;
};

function defaultStorePath(): string {
  return path.join(CONFIG_DIR, "openbot-encrypted-secrets.json");
}

function resolveStorePath(storePath?: string): string {
  return resolveUserPath(storePath?.trim() || defaultStorePath());
}

const withLock = createAsyncLock();

function createKdf(): ScryptKdf {
  return {
    algo: "scrypt",
    salt: crypto.randomBytes(16).toString("base64"),
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  };
}

function createEmptyStore(): EncryptedLocalStore {
  return { version: STORE_VERSION, kdf: createKdf(), secrets: {} };
}

async function loadStore(storePath?: string): Promise<EncryptedLocalStore> {
  const parsed = await readJsonFile<Partial<EncryptedLocalStore>>(resolveStorePath(storePath));
  if (
    !parsed ||
    typeof parsed.secrets !== "object" ||
    parsed.secrets === null ||
    !parsed.kdf ||
    typeof parsed.kdf.salt !== "string"
  ) {
    return createEmptyStore();
  }
  return {
    version: STORE_VERSION,
    kdf: {
      algo: "scrypt",
      salt: parsed.kdf.salt,
      N: typeof parsed.kdf.N === "number" ? parsed.kdf.N : SCRYPT_N,
      r: typeof parsed.kdf.r === "number" ? parsed.kdf.r : SCRYPT_R,
      p: typeof parsed.kdf.p === "number" ? parsed.kdf.p : SCRYPT_P,
    },
    secrets: parsed.secrets,
  };
}

async function saveStore(store: EncryptedLocalStore, storePath?: string): Promise<void> {
  await writeJsonAtomic(resolveStorePath(storePath), store, { mode: 0o600 });
}

// scrypt is intentionally expensive; cache derived keys per (masterKey, kdf) so
// repeated decrypts during a gateway run do not re-run the KDF. Keyed by a hash
// of the master key (never the raw key) plus the kdf parameters.
const derivedKeyCache = new Map<string, Buffer>();

function deriveKey(masterKey: string, kdf: ScryptKdf): Buffer {
  const masterKeyHash = crypto.createHash("sha256").update(masterKey, "utf8").digest("base64");
  const cacheKey = `${masterKeyHash}:${kdf.salt}:${kdf.N}:${kdf.r}:${kdf.p}`;
  const cached = derivedKeyCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const key = crypto.scryptSync(masterKey, Buffer.from(kdf.salt, "base64"), DERIVED_KEY_LEN, {
    N: kdf.N,
    r: kdf.r,
    p: kdf.p,
    maxmem: SCRYPT_MAXMEM,
  });
  derivedKeyCache.set(cacheKey, key);
  return key;
}

function encryptValue(value: string, key: Buffer): EncryptedSecretEntry {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    iv: iv.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    updatedAt: new Date().toISOString(),
  };
}

function decryptValue(entry: EncryptedSecretEntry, key: Buffer): string {
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(entry.iv, "base64"));
  decipher.setAuthTag(Buffer.from(entry.authTag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(entry.ciphertext, "base64")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}

/**
 * Resolve the SecretRef used to obtain the master key. A configured
 * `secrets.encryptedLocal.masterKeyRef` wins; otherwise the default is the env
 * var OPENBOT_SECRET_MASTER_KEY. Returns null when the configured ref is invalid
 * or (to prevent resolution recursion) is itself an encrypted-local ref.
 */
export function resolveEncryptedLocalMasterKeyRef(config: OpenBotConfig): SecretRef | null {
  const configured = config.secrets?.encryptedLocal?.masterKeyRef;
  if (configured) {
    const ref = coerceSecretRef(configured);
    if (!ref || ref.source === ENCRYPTED_LOCAL_SOURCE) {
      return null;
    }
    return ref;
  }
  return { source: "env", provider: "default", id: DEFAULT_MASTER_KEY_ENV };
}

/** Build the SecretRef stored in a credential's envVars for an encrypted-local value. */
export function buildEncryptedLocalSecretRef(id: string): SecretRef {
  return { source: ENCRYPTED_LOCAL_SOURCE, provider: "default", id: id.trim() };
}

export async function hasEncryptedLocalSecret(id: string, storePath?: string): Promise<boolean> {
  const store = await loadStore(storePath);
  return Boolean(store.secrets[id.trim()]);
}

/** Decrypt and return the plaintext value. Throws (without leaking detail) when missing/undecryptable. */
export async function getEncryptedLocalSecret(params: {
  id: string;
  masterKey: string;
  storePath?: string;
}): Promise<string> {
  const id = params.id.trim();
  if (!params.masterKey) {
    throw new Error("encrypted-local master key is unavailable");
  }
  const store = await loadStore(params.storePath);
  const entry = store.secrets[id];
  if (!entry) {
    throw new Error(`encrypted-local secret "${id}" not found`);
  }
  const key = deriveKey(params.masterKey, store.kdf);
  try {
    return decryptValue(entry, key);
  } catch {
    // Wrong master key or tampered ciphertext — never surface crypto detail.
    throw new Error(`encrypted-local secret "${id}" could not be decrypted`);
  }
}

/** Encrypt and persist a plaintext value under `id`. Overwrites any existing entry. */
export async function putEncryptedLocalSecret(params: {
  id: string;
  value: string;
  masterKey: string;
  storePath?: string;
}): Promise<void> {
  const id = params.id.trim();
  if (!id) {
    throw new Error("encrypted-local secret id is required");
  }
  if (!params.value) {
    throw new Error("encrypted-local secret value is required");
  }
  if (!params.masterKey) {
    throw new Error("encrypted-local master key is unavailable");
  }
  await withLock(async () => {
    const store = await loadStore(params.storePath);
    const key = deriveKey(params.masterKey, store.kdf);
    store.secrets[id] = encryptValue(params.value, key);
    await saveStore(store, params.storePath);
  });
}

/** Remove an encrypted-local value. Returns true when an entry was deleted. */
export async function deleteEncryptedLocalSecret(id: string, storePath?: string): Promise<boolean> {
  const trimmed = id.trim();
  return withLock(async () => {
    const store = await loadStore(storePath);
    if (!store.secrets[trimmed]) {
      return false;
    }
    delete store.secrets[trimmed];
    await saveStore(store, storePath);
    return true;
  });
}
