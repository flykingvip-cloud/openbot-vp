import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import path from "node:path";
import { createAsyncLock, readJsonFile, writeJsonAtomic } from "../../infra/json-files.js";
import { CONFIG_DIR } from "../../utils.js";
import {
  deriveVaultKey,
  resolveVaultKeyMaterialFromEnv,
} from "./connector-credential-vault-key.js";
import type { DataConnectorCredentialSecret } from "./types.js";

const VAULT_FILENAME = "openbot-enterprise-data-secrets.json";

/**
 * AES-256-GCM envelope written for every stored secret. Plaintext entries
 * (objects without `alg`) may still exist from older builds and are read back
 * transparently, then re-encrypted on the next save.
 */
type EncryptedSecretEnvelope = {
  v: 1;
  alg: "aes-256-gcm";
  iv: string;
  tag: string;
  ct: string;
};

type StoredSecret = EncryptedSecretEnvelope | DataConnectorCredentialSecret;

type CredentialVaultFile = {
  credentials: Record<string, StoredSecret>;
};

const keyLock = createAsyncLock();
const keyCache = new Map<string, Buffer>();

function resolveVaultPath(customPath?: string): string {
  return customPath ?? path.join(CONFIG_DIR, VAULT_FILENAME);
}

/** Key file lives next to its vault file so tests with a custom path stay hermetic. */
function resolveKeyPath(vaultPath: string): string {
  return `${vaultPath}.key`;
}

/**
 * Resolve the 32-byte AES key. Precedence: inline env key → secretref env (resolved
 * from an external secret manager via src/secrets) → local key file (32 random bytes,
 * created with 0600 on first use). Env-sourced material is hashed to 32 bytes by
 * deriveVaultKey. The file path is cached and guarded by an async lock so concurrent
 * first-use saves can't race two keys. See connector-credential-vault-key.ts.
 */
async function resolveVaultKey(vaultPath: string): Promise<Buffer> {
  const envMaterial = await resolveVaultKeyMaterialFromEnv();
  if (envMaterial) {
    return deriveVaultKey(envMaterial.material);
  }
  const keyPath = resolveKeyPath(vaultPath);
  const cached = keyCache.get(keyPath);
  if (cached) {
    return cached;
  }
  return keyLock(async () => {
    const cachedInLock = keyCache.get(keyPath);
    if (cachedInLock) {
      return cachedInLock;
    }
    const existing = await readJsonFile<{ key: string }>(keyPath);
    if (existing?.key) {
      const decoded = Buffer.from(existing.key, "base64");
      if (decoded.length === 32) {
        keyCache.set(keyPath, decoded);
        return decoded;
      }
    }
    const generated = randomBytes(32);
    await writeJsonAtomic(keyPath, { key: generated.toString("base64") }, { mode: 0o600 });
    keyCache.set(keyPath, generated);
    return generated;
  });
}

function encryptSecret(
  secret: DataConnectorCredentialSecret,
  key: Buffer,
): EncryptedSecretEnvelope {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(secret), "utf8"), cipher.final()]);
  return {
    v: 1,
    alg: "aes-256-gcm",
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ct: ciphertext.toString("base64"),
  };
}

function isEncryptedEnvelope(value: StoredSecret): value is EncryptedSecretEnvelope {
  return (
    typeof value === "object" &&
    value != null &&
    (value as EncryptedSecretEnvelope).alg === "aes-256-gcm"
  );
}

function decryptSecret(
  envelope: EncryptedSecretEnvelope,
  key: Buffer,
): DataConnectorCredentialSecret {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ct, "base64")),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8")) as DataConnectorCredentialSecret;
}

export async function loadCredentialSecret(
  credentialId: string,
  vaultPath?: string,
): Promise<DataConnectorCredentialSecret | null> {
  const resolved = resolveVaultPath(vaultPath);
  const file = await readJsonFile<CredentialVaultFile>(resolved);
  const stored = file?.credentials?.[credentialId];
  if (!stored) {
    return null;
  }
  if (!isEncryptedEnvelope(stored)) {
    // Legacy plaintext entry written before vault encryption — read it back as-is.
    return stored;
  }
  try {
    const key = await resolveVaultKey(resolved);
    return decryptSecret(stored, key);
  } catch {
    // Wrong/rotated key or tampered envelope — fail closed rather than leak/crash.
    return null;
  }
}

export async function saveCredentialSecret(
  credentialId: string,
  secret: DataConnectorCredentialSecret,
  vaultPath?: string,
): Promise<void> {
  const resolved = resolveVaultPath(vaultPath);
  const key = await resolveVaultKey(resolved);
  const file = (await readJsonFile<CredentialVaultFile>(resolved)) ?? { credentials: {} };
  file.credentials[credentialId] = encryptSecret(secret, key);
  await writeJsonAtomic(resolved, file, { mode: 0o600 });
}

export async function deleteCredentialSecret(
  credentialId: string,
  vaultPath?: string,
): Promise<void> {
  const resolved = resolveVaultPath(vaultPath);
  const file = await readJsonFile<CredentialVaultFile>(resolved);
  if (!file?.credentials?.[credentialId]) {
    return;
  }
  delete file.credentials[credentialId];
  await writeJsonAtomic(resolved, file, { mode: 0o600 });
}

export function buildSecretHint(apiKey: string): string {
  const trimmed = apiKey.trim();
  if (trimmed.length <= 4) {
    return "****";
  }
  return `…${trimmed.slice(-4)}`;
}
