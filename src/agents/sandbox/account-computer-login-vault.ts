/**
 * Domain-bound site login vault for Account Computer autofill.
 *
 * Ciphertext uses the same AES-256-GCM envelope and KEK as the enterprise
 * connector vault (`OPENBOT_ENTERPRISE_DATA_VAULT_KEY` / `_REF`). Managed
 * profiles refuse to mint a local key file. Plaintext never leaves this module
 * except to the secure-form fill pipeline, which zeroizes it.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  deriveVaultKey,
  resolveVaultKeyMaterialFromEnv,
} from "../../gateway/enterprise-data/connector-credential-vault-key.js";
import { createAsyncLock, readJsonFile, writeJsonAtomic } from "../../infra/json-files.js";
import { CONFIG_DIR } from "../../utils.js";
import { normalizeLoginHost } from "./account-computer-login-classify.js";

export type SiteLoginSecret = {
  username: string;
  password: string;
};

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

type PendingSecret = {
  kind: "secret";
  tenantId: string;
  userId: string;
  host: string;
  formId: string;
  sessionKey: string;
  envelope: EncryptedSecretEnvelope;
  expiresAt: number;
};

type PendingBlocked = {
  kind: "blocked";
  tenantId: string;
  userId: string;
  host: string;
  formId: string;
  sessionKey: string;
  code: "managed_vault_required";
  expiresAt: number;
};

type PendingSiteLogin = PendingSecret | PendingBlocked;

const PENDING_TTL_MS = 10 * 60 * 1000;
const keyLock = createAsyncLock();
const keyCache = new Map<string, Buffer>();
const PENDING = new Map<string, PendingSiteLogin>();

let vaultPathOverride: string | null = null;

export class SiteLoginVaultError extends Error {
  readonly code = "managed_vault_required" as const;

  constructor() {
    super("managed profile requires the existing vault key");
    this.name = "SiteLoginVaultError";
  }
}

export function setAccountComputerLoginVaultPathForTests(next: string | null) {
  vaultPathOverride = next;
}

export function resetAccountComputerLoginVaultForTests() {
  PENDING.clear();
  keyCache.clear();
  vaultPathOverride = null;
}

export function resolveAccountComputerLoginVaultPath(): string {
  return vaultPathOverride ?? path.join(CONFIG_DIR, "account-computer-login-secrets.json");
}

function isManagedProfile(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env.OPENBOT_SECURITY_PROFILE || env.OPENCLAW_SECURITY_PROFILE || "")
    .trim()
    .toLowerCase();
  return raw === "managed_enterprise" || raw === "managed" || raw === "enterprise";
}

function resolveKeyPath(vaultPath: string): string {
  return `${vaultPath}.key`;
}

async function resolveSiteLoginKey(vaultPath: string): Promise<Buffer> {
  const material = await resolveVaultKeyMaterialFromEnv();
  if (material) {
    return deriveVaultKey(material.material);
  }
  if (isManagedProfile()) {
    throw new SiteLoginVaultError();
  }
  const keyPath = resolveKeyPath(vaultPath);
  const cached = keyCache.get(keyPath);
  if (cached) {
    return cached;
  }
  return keyLock(async () => {
    const again = keyCache.get(keyPath);
    if (again) {
      return again;
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

function encryptWithKey(secret: SiteLoginSecret, key: Buffer): EncryptedSecretEnvelope {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify({ username: secret.username, password: secret.password }), "utf8"),
    cipher.final(),
  ]);
  return {
    v: 1,
    alg: "aes-256-gcm",
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ct: ciphertext.toString("base64"),
  };
}

function decryptWithKey(envelope: EncryptedSecretEnvelope, key: Buffer): SiteLoginSecret {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ct, "base64")),
    decipher.final(),
  ]);
  const parsed = JSON.parse(plaintext.toString("utf8")) as {
    username?: unknown;
    password?: unknown;
  };
  return {
    username: typeof parsed.username === "string" ? parsed.username : "",
    password: typeof parsed.password === "string" ? parsed.password : "",
  };
}

function zeroize(secret: SiteLoginSecret) {
  secret.username = "";
  secret.password = "";
}

function pendingKey(tenantId: string, userId: string, host: string): string {
  return `${tenantId}\u0000${userId}\u0000${host}`;
}

function prunePending(now = Date.now()) {
  for (const [key, row] of PENDING) {
    if (row.expiresAt <= now) {
      PENDING.delete(key);
    }
  }
}

export async function saveSiteLoginSecret(
  credentialId: string,
  secret: SiteLoginSecret,
): Promise<void> {
  const id = credentialId.trim();
  if (!id) {
    throw new Error("credential id required");
  }
  const vaultPath = resolveAccountComputerLoginVaultPath();
  const key = await resolveSiteLoginKey(vaultPath);
  const envelope = encryptWithKey(secret, key);
  const file = (await readJsonFile<VaultFile>(vaultPath)) ?? { credentials: {} };
  file.credentials[id] = envelope;
  await writeJsonAtomic(vaultPath, file, { mode: 0o600 });
}

export async function loadSiteLoginSecret(credentialId: string): Promise<SiteLoginSecret | null> {
  const id = credentialId.trim();
  if (!id) {
    return null;
  }
  const vaultPath = resolveAccountComputerLoginVaultPath();
  const file = await readJsonFile<VaultFile>(vaultPath);
  const envelope = file?.credentials?.[id];
  if (!envelope) {
    return null;
  }
  try {
    const key = await resolveSiteLoginKey(vaultPath);
    return decryptWithKey(envelope, key);
  } catch {
    return null;
  }
}

export async function rememberPasswordFillForSave(params: {
  tenantId: string;
  userId: string;
  host: string;
  formId: string;
  sessionKey: string;
  fields: Array<{ fieldId: string; kind: string }>;
  values: Record<string, string>;
}): Promise<void> {
  const passwordField = params.fields.find((field) => field.kind === "password");
  if (!passwordField) {
    return;
  }
  const password = params.values[passwordField.fieldId] ?? "";
  if (!password) {
    return;
  }
  const usernameField = params.fields.find(
    (field) => field.kind === "username" || field.kind === "email",
  );
  const username = usernameField ? (params.values[usernameField.fieldId] ?? "") : "";
  const host = normalizeLoginHost(params.host);
  const tenantId = params.tenantId.trim();
  const userId = params.userId.trim();
  if (!host || !tenantId || !userId) {
    return;
  }
  const secret: SiteLoginSecret = { username, password };
  try {
    const vaultPath = resolveAccountComputerLoginVaultPath();
    const key = await resolveSiteLoginKey(vaultPath);
    const envelope = encryptWithKey(secret, key);
    prunePending();
    PENDING.set(pendingKey(tenantId, userId, host), {
      kind: "secret",
      tenantId,
      userId,
      host,
      formId: params.formId,
      sessionKey: params.sessionKey,
      envelope,
      expiresAt: Date.now() + PENDING_TTL_MS,
    });
  } catch (err) {
    if (err instanceof SiteLoginVaultError) {
      prunePending();
      PENDING.set(pendingKey(tenantId, userId, host), {
        kind: "blocked",
        tenantId,
        userId,
        host,
        formId: params.formId,
        sessionKey: params.sessionKey,
        code: "managed_vault_required",
        expiresAt: Date.now() + PENDING_TTL_MS,
      });
      return;
    }
    throw err;
  } finally {
    zeroize(secret);
  }
}

export function dropPendingSiteLoginForForm(formId: string) {
  const id = formId.trim();
  for (const [key, row] of PENDING) {
    if (row.formId === id) {
      PENDING.delete(key);
    }
  }
}

export function readPendingSiteLogin(params: {
  tenantId: string;
  userId: string;
  host: string;
}): PendingSiteLogin | null {
  prunePending();
  const host = normalizeLoginHost(params.host);
  if (!host) {
    return null;
  }
  return PENDING.get(pendingKey(params.tenantId.trim(), params.userId.trim(), host)) ?? null;
}

export async function promotePendingSiteLogin(params: {
  tenantId: string;
  userId: string;
  host: string;
}): Promise<{ credentialId: string } | { code: "managed_vault_required" | "nothing_to_save" }> {
  const pending = readPendingSiteLogin(params);
  if (!pending) {
    return { code: "nothing_to_save" };
  }
  if (pending.kind === "blocked") {
    dropPendingSiteLoginForForm(pending.formId);
    return { code: "managed_vault_required" };
  }
  const vaultPath = resolveAccountComputerLoginVaultPath();
  let secret: SiteLoginSecret | null = null;
  try {
    const key = await resolveSiteLoginKey(vaultPath);
    secret = decryptWithKey(pending.envelope, key);
    const credentialId = randomBytes(16).toString("hex");
    await saveSiteLoginSecret(credentialId, secret);
    dropPendingSiteLoginForForm(pending.formId);
    return { credentialId };
  } catch (err) {
    if (err instanceof SiteLoginVaultError) {
      dropPendingSiteLoginForForm(pending.formId);
      return { code: "managed_vault_required" };
    }
    throw err;
  } finally {
    if (secret) {
      zeroize(secret);
    }
  }
}

export async function vaultFileContainsPlaintext(needle: string): Promise<boolean> {
  if (!needle) {
    return false;
  }
  try {
    const raw = await fs.readFile(resolveAccountComputerLoginVaultPath(), "utf8");
    return raw.includes(needle);
  } catch {
    return false;
  }
}
