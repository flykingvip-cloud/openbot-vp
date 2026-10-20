// Connector credential vault — pluggable key-encryption-key (KEK) source.
// Spec: .kiro/specs/vault-key-externalization/{requirements,design,tasks}.md
//
// The vault (connector-credential-vault.ts) encrypts each secret with AES-256-GCM; this
// module ONLY decides where the 32-byte AES key comes from. It extends the existing
// env-key seam with a secretref source so the KEK can live in an external secret manager
// (Hashicorp Vault / AWS Secrets Manager / KMS / any exec provider) resolved via the
// shared src/secrets contract — no new provider type, no duplicated resolution logic.
// Mirrors the secrets.encryptedLocal.masterKeyRef pattern. The AES envelope is unchanged.

import { createHash } from "node:crypto";
import type { OpenBotConfig } from "../../config/config.js";
import { loadConfig } from "../../config/config.js";
import { coerceSecretRef, type SecretRef } from "../../config/types.secrets.js";
import { resolveSecretRefString } from "../../secrets/resolve.js";

/**
 * Inline KEK material (any string; hashed to 32 bytes). When set, no key file is
 * read/written. `OPENCLAW_*` kept as a back-compat alias per repo env conventions.
 */
export const VAULT_KEY_ENV_VARS = [
  "OPENBOT_ENTERPRISE_DATA_VAULT_KEY",
  "OPENCLAW_ENTERPRISE_DATA_VAULT_KEY",
] as const;

/**
 * SecretRef pointing at the KEK in an external secret manager. Value is a JSON SecretRef
 * object (e.g. {"source":"exec","provider":"vault","id":"enterprise/kek"}) or a ${VAR}
 * env template. Resolved via the shared secretref contract against config.secrets.providers.
 */
export const VAULT_KEY_REF_ENV_VARS = [
  "OPENBOT_ENTERPRISE_DATA_VAULT_KEY_REF",
  "OPENCLAW_ENTERPRISE_DATA_VAULT_KEY_REF",
] as const;

export type VaultKeyMaterialSource = "inline-env" | "secret-ref";

export type ResolvedVaultKeyMaterial = {
  /** Raw key material (never logged); hashed by deriveVaultKey. */
  material: string;
  source: VaultKeyMaterialSource;
};

/** Injectable resolver shape (defaults to the shared src/secrets resolver). */
export type VaultKeyRefResolver = (
  ref: SecretRef,
  options: { config: OpenBotConfig; env: NodeJS.ProcessEnv },
) => Promise<string>;

/** Derive the 32-byte AES key from key material — identical for every source (D3). */
export function deriveVaultKey(material: string): Buffer {
  return createHash("sha256").update(material).digest();
}

function readFirstEnv(names: readonly string[], env: NodeJS.ProcessEnv): string | undefined {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

// Resolved secretref material is cached by the raw ref-env string so repeated load/save
// cycles do not re-invoke an external resolver (e.g. exec). Process-lifetime, like the
// local key-file cache; rotation is picked up on restart.
const secretRefMaterialCache = new Map<string, ResolvedVaultKeyMaterial>();

export function resetVaultKeyMaterialCacheForTest(): void {
  secretRefMaterialCache.clear();
}

function parseRefEnvValue(raw: string): SecretRef {
  const trimmed = raw.trim();
  let candidate: unknown = trimmed;
  if (trimmed.startsWith("{")) {
    try {
      candidate = JSON.parse(trimmed);
    } catch {
      throw new Error(
        "OPENBOT_ENTERPRISE_DATA_VAULT_KEY_REF is not valid JSON. Provide a SecretRef object or a ${VAR} env template.",
      );
    }
  }
  const ref = coerceSecretRef(candidate);
  if (!ref) {
    throw new Error(
      'OPENBOT_ENTERPRISE_DATA_VAULT_KEY_REF must be a SecretRef (e.g. {"source":"exec","provider":"vault","id":"enterprise/kek"}) or a ${VAR} env template.',
    );
  }
  return ref;
}

/**
 * Resolve KEK material from the environment. Precedence: inline env → secretref env →
 * null (caller then uses the local key file). Inline short-circuits without loading config
 * or resolving a ref. A secretref env that is set but invalid/unresolvable throws (fail
 * closed — never silently fall back to the local file). Never logs the resolved material.
 */
export async function resolveVaultKeyMaterialFromEnv(params?: {
  env?: NodeJS.ProcessEnv;
  loadConfig?: () => OpenBotConfig | Promise<OpenBotConfig>;
  resolveRefString?: VaultKeyRefResolver;
}): Promise<ResolvedVaultKeyMaterial | null> {
  const env = params?.env ?? process.env;
  const inline = readFirstEnv(VAULT_KEY_ENV_VARS, env);
  if (inline) {
    return { material: inline, source: "inline-env" };
  }
  const refRaw = readFirstEnv(VAULT_KEY_REF_ENV_VARS, env);
  if (!refRaw) {
    return null;
  }
  const cached = secretRefMaterialCache.get(refRaw);
  if (cached) {
    return cached;
  }
  const ref = parseRefEnvValue(refRaw);
  const loadCfg = params?.loadConfig ?? loadConfig;
  const resolveRef = params?.resolveRefString ?? resolveSecretRefString;
  const config = await loadCfg();
  const material = await resolveRef(ref, { config, env });
  if (!material?.trim()) {
    throw new Error("Vault key SecretRef resolved to an empty value.");
  }
  const resolved: ResolvedVaultKeyMaterial = { material, source: "secret-ref" };
  secretRefMaterialCache.set(refRaw, resolved);
  return resolved;
}
