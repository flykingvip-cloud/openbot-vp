/**
 * Browser-local vault key persistence (member X25519 + password-sealed BaseKey cache).
 * Server never sees these materials.
 */
import { asBufferSource, base64ToBytes, bytesToBase64, concatBytes, utf8Encode } from "./bytes.ts";
import { deriveBaseKey, generateVaultSalt } from "./client-crypto.ts";

const MEMBER_KEY_PREFIX = "openbot.vault-sync.member-keys.v1:";
const BASE_KEY_PREFIX = "openbot.vault-sync.base-key.v1:";
const SEAL_INFO = utf8Encode("openbot-vault-sync/base-key-cache/v1");
const NONCE_LEN = 12;
const TAG_LEN = 16;

export type StoredMemberKeyPair = {
  publicKeyB64: string;
  privateKeyB64: string;
};

export type SealedBaseKeyRecord = {
  keyEpoch: number;
  sealedB64: string;
  saltB64: string;
};

function memberStorageKey(vaultId: string, accountId: string): string {
  return `${MEMBER_KEY_PREFIX}${vaultId}:${accountId}`;
}

function baseKeyStorageKey(vaultId: string): string {
  return `${BASE_KEY_PREFIX}${vaultId}`;
}

export function saveMemberKeyPair(
  vaultId: string,
  accountId: string,
  keyPair: StoredMemberKeyPair,
): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  localStorage.setItem(
    memberStorageKey(vaultId, accountId),
    JSON.stringify({
      publicKeyB64: keyPair.publicKeyB64,
      privateKeyB64: keyPair.privateKeyB64,
    }),
  );
}

export function loadMemberKeyPair(vaultId: string, accountId: string): StoredMemberKeyPair | null {
  if (typeof localStorage === "undefined") {
    return null;
  }
  try {
    const raw = localStorage.getItem(memberStorageKey(vaultId, accountId));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<StoredMemberKeyPair>;
    if (
      typeof parsed.publicKeyB64 !== "string" ||
      !parsed.publicKeyB64.trim() ||
      typeof parsed.privateKeyB64 !== "string" ||
      !parsed.privateKeyB64.trim()
    ) {
      return null;
    }
    return {
      publicKeyB64: parsed.publicKeyB64.trim(),
      privateKeyB64: parsed.privateKeyB64.trim(),
    };
  } catch {
    return null;
  }
}

async function deriveSealKey(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const passwordKey = deriveBaseKey({ password, salt });
  // Domain-separated seal key: HMAC(passwordKey, SEAL_INFO) truncated to 32.
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    asBufferSource(passwordKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, asBufferSource(SEAL_INFO));
  return asBufferSource(new Uint8Array(sig));
}

/** Seal BaseKey with password-derived key for local sync after random rotation. */
export async function sealAndStoreBaseKey(params: {
  vaultId: string;
  password: string;
  baseKey: Uint8Array;
  keyEpoch: number;
}): Promise<void> {
  if (typeof localStorage === "undefined") {
    return;
  }
  if (params.baseKey.length !== 32) {
    throw new Error("invalid base key");
  }
  if (!params.password) {
    throw new Error("password required to seal base key");
  }
  const salt = generateVaultSalt(16);
  const sealKey = await deriveSealKey(params.password, salt);
  const nonce = generateVaultSalt(NONCE_LEN);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    asBufferSource(sealKey),
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const aad = utf8Encode(`${params.vaultId}|${params.keyEpoch}|base-key-cache-v1`);
  const encrypted = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: asBufferSource(nonce),
      additionalData: asBufferSource(aad),
      tagLength: TAG_LEN * 8,
    },
    cryptoKey,
    asBufferSource(params.baseKey),
  );
  const record: SealedBaseKeyRecord = {
    keyEpoch: params.keyEpoch,
    saltB64: bytesToBase64(salt),
    sealedB64: bytesToBase64(concatBytes(nonce, new Uint8Array(encrypted))),
  };
  localStorage.setItem(baseKeyStorageKey(params.vaultId), JSON.stringify(record));
}

export async function loadSealedBaseKey(params: {
  vaultId: string;
  password: string;
  expectedEpoch?: number;
}): Promise<{ baseKey: Uint8Array; keyEpoch: number } | null> {
  if (typeof localStorage === "undefined") {
    return null;
  }
  try {
    const raw = localStorage.getItem(baseKeyStorageKey(params.vaultId));
    if (!raw) {
      return null;
    }
    const record = JSON.parse(raw) as Partial<SealedBaseKeyRecord>;
    if (
      typeof record.keyEpoch !== "number" ||
      typeof record.saltB64 !== "string" ||
      typeof record.sealedB64 !== "string"
    ) {
      return null;
    }
    if (
      params.expectedEpoch !== undefined &&
      Number.isFinite(params.expectedEpoch) &&
      record.keyEpoch !== params.expectedEpoch
    ) {
      return null;
    }
    const sealKey = await deriveSealKey(params.password, base64ToBytes(record.saltB64));
    const blob = base64ToBytes(record.sealedB64);
    if (blob.length < NONCE_LEN + TAG_LEN) {
      return null;
    }
    const nonce = blob.subarray(0, NONCE_LEN);
    const payload = blob.subarray(NONCE_LEN);
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      asBufferSource(sealKey),
      "AES-GCM",
      false,
      ["decrypt"],
    );
    const aad = utf8Encode(`${params.vaultId}|${record.keyEpoch}|base-key-cache-v1`);
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
    const baseKey = new Uint8Array(plain);
    if (baseKey.length !== 32) {
      return null;
    }
    return { baseKey, keyEpoch: record.keyEpoch };
  } catch {
    return null;
  }
}

export function clearSealedBaseKey(vaultId: string): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  localStorage.removeItem(baseKeyStorageKey(vaultId));
}
