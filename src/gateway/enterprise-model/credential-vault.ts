/**
 * Enterprise model connection credential vault (AES-256-GCM).
 * Reuses the same envelope pattern as connector-credential-vault; does NOT invent crypto.
 * Plaintext must never be logged or returned via list/get APIs.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import path from "node:path";
import { createAsyncLock, readJsonFile, writeJsonAtomic } from "../../infra/json-files.js";
import { CONFIG_DIR, resolveUserPath } from "../../utils.js";
import {
  deriveVaultKey,
  resolveVaultKeyMaterialFromEnv,
} from "../enterprise-data/connector-credential-vault-key.js";
import type { EnterpriseModelCredentialSecret } from "./types.js";

const VAULT_FILENAME = "openbot-enterprise-model-secrets.json";

type EncryptedSecretEnvelope = {
  v: 1;
  alg: "aes-256-gcm";
  iv: string;
  tag: string;
  ct: string;
};

type VaultFile = {
  credentials: Record<string, EncryptedSecretEnvelope>;
};

const keyLock = createAsyncLock();
/** Serializes full-file RMW on the vault JSON (save/delete must not race). */
const vaultFileLock = createAsyncLock();
const keyCache = new Map<string, Buffer>();

export function resolveDefaultEnterpriseModelVaultPath(): string {
  return path.join(CONFIG_DIR, VAULT_FILENAME);
}

function resolveVaultPath(customPath?: string): string {
  return resolveUserPath(customPath?.trim() || resolveDefaultEnterpriseModelVaultPath());
}

function resolveKeyPath(vaultPath: string): string {
  return `${vaultPath}.key`;
}

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
  secret: EnterpriseModelCredentialSecret,
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

function decryptSecret(
  envelope: EncryptedSecretEnvelope,
  key: Buffer,
): EnterpriseModelCredentialSecret {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ct, "base64")),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8")) as EnterpriseModelCredentialSecret;
}

export async function loadEnterpriseModelSecret(
  credentialRef: string,
  vaultPath?: string,
): Promise<EnterpriseModelCredentialSecret | null> {
  const resolved = resolveVaultPath(vaultPath);
  const file = await readJsonFile<VaultFile>(resolved);
  const stored = file?.credentials?.[credentialRef];
  if (!stored || stored.alg !== "aes-256-gcm") {
    return null;
  }
  try {
    const key = await resolveVaultKey(resolved);
    return decryptSecret(stored, key);
  } catch {
    return null;
  }
}

export async function saveEnterpriseModelSecret(
  credentialRef: string,
  secret: EnterpriseModelCredentialSecret,
  vaultPath?: string,
): Promise<void> {
  const resolved = resolveVaultPath(vaultPath);
  return vaultFileLock(async () => {
    const key = await resolveVaultKey(resolved);
    const file = (await readJsonFile<VaultFile>(resolved)) ?? { credentials: {} };
    file.credentials[credentialRef] = encryptSecret(secret, key);
    await writeJsonAtomic(resolved, file, { mode: 0o600 });
  });
}

export async function deleteEnterpriseModelSecret(
  credentialRef: string,
  vaultPath?: string,
): Promise<void> {
  const resolved = resolveVaultPath(vaultPath);
  return vaultFileLock(async () => {
    const file = await readJsonFile<VaultFile>(resolved);
    if (!file?.credentials?.[credentialRef]) {
      return;
    }
    delete file.credentials[credentialRef];
    await writeJsonAtomic(resolved, file, { mode: 0o600 });
  });
}

export async function hasEnterpriseModelSecret(
  credentialRef: string,
  vaultPath?: string,
): Promise<boolean> {
  const resolved = resolveVaultPath(vaultPath);
  const file = await readJsonFile<VaultFile>(resolved);
  return Boolean(file?.credentials?.[credentialRef]);
}

export function buildSecretHint(apiKey: string): string {
  const trimmed = apiKey.trim();
  if (trimmed.length <= 4) {
    return "****";
  }
  return `…${trimmed.slice(-4)}`;
}

/** Test helper: clear in-memory key cache between vault path switches. */
export function __resetEnterpriseModelVaultKeyCacheForTest(): void {
  keyCache.clear();
}
