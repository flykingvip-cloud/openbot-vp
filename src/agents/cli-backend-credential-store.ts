/**
 * cli-backend-credential-store.ts — SecretRef-First credentials for CLI backends
 * (cli-backend-onboarding Phase 2, Task 5 + 12).
 *
 * SECURITY MODEL — "SecretRef-First": this store NEVER persists plaintext API
 * keys. Each credential maps an env var name to an EXISTING `SecretRef`
 * (`{ source: env|file|exec, provider, id }`, see `src/config/types.secrets.ts`).
 * The actual secret value lives in the configured secret source (env var, mounted
 * file, or an exec provider that fetches from Vault / AWS Secrets Manager / Azure
 * Key Vault / GCP Secret Manager). Because no secret value is stored here, there
 * is no plaintext-at-rest to encrypt — the strongest posture for the credential
 * store, and future KMS backends plug in via the exec secret provider with no
 * schema change.
 *
 * Scope governance (Task 12): a `CredentialBinding` constrains which backends /
 * models / roles may consume a credential, so an enterprise or personal key
 * cannot be silently used by an unintended backend.
 *
 * Resolution priority (Task 6 consumes this): personal/seat → enterprise →
 * host default (`CliBackendConfig.env`). This module owns the pure store +
 * binding-check + priority selection; env injection lives in cli-runner.
 *
 * Persisted at `CONFIG_DIR/openbot-cli-backend-credentials.json`.
 */

import path from "node:path";
import { type SecretRef, isSecretRef } from "../config/types.secrets.js";
import { createAsyncLock, readJsonFile, writeJsonAtomic } from "../infra/json-files.js";
import { CONFIG_DIR, resolveUserPath } from "../utils.js";

const STORE_VERSION = 1;

export type CliBackendCredentialScope = "enterprise" | "personal";

/** A credential maps env var names → SecretRef (no plaintext at rest). */
export interface CliBackendCredential {
  /** Stable id (used by CredentialBinding + audit/attribution). */
  credentialId: string;
  tenantId: string;
  scope: CliBackendCredentialScope;
  /** Required for scope="personal": the seat/employee subject id. */
  subjectId?: string;
  /** The CLI backend this credential is for (e.g. "claude-cli"). */
  backendId: string;
  /** env var name → SecretRef. */
  envVars: Record<string, SecretRef>;
  updatedAt: string;
}

/** Governs which backends / models / roles may consume a credential (Task 12). */
export interface CredentialBinding {
  credentialId: string;
  /** When set, only these backends may use it (default: the credential's own backend). */
  allowedBackends?: string[];
  /** When set, only these `<backendId>/<model>` refs may use it. */
  allowedModels?: string[];
  /** When set, only these roles may use it. */
  allowedRoles?: string[];
}

interface Store {
  version: number;
  /** key = credentialId */
  credentials: Record<string, CliBackendCredential>;
  /** key = credentialId */
  bindings: Record<string, CredentialBinding>;
}

function createEmptyStore(): Store {
  return { version: STORE_VERSION, credentials: {}, bindings: {} };
}

export function resolveDefaultCliBackendCredentialStorePath(): string {
  return path.join(CONFIG_DIR, "openbot-cli-backend-credentials.json");
}

const withLock = createAsyncLock();

async function loadStore(storePath?: string): Promise<Store> {
  const resolvedPath = resolveUserPath(
    storePath?.trim() || resolveDefaultCliBackendCredentialStorePath(),
  );
  const parsed = await readJsonFile<Partial<Store>>(resolvedPath);
  if (!parsed || typeof parsed.credentials !== "object" || parsed.credentials === null) {
    return createEmptyStore();
  }
  return {
    version: STORE_VERSION,
    credentials: parsed.credentials,
    bindings: typeof parsed.bindings === "object" && parsed.bindings ? parsed.bindings : {},
  };
}

async function saveStore(store: Store, storePath?: string): Promise<void> {
  const resolvedPath = resolveUserPath(
    storePath?.trim() || resolveDefaultCliBackendCredentialStorePath(),
  );
  await writeJsonAtomic(resolvedPath, store);
}

// ── Pure validation/selection helpers (no IO) ──────────────────────────────

/** Validate that every envVars value is a real SecretRef (no plaintext). */
export function validateCredentialEnvVars(raw: unknown): Record<string, SecretRef> {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("envVars must be an object of { ENV_NAME: SecretRef }");
  }
  const out: Record<string, SecretRef> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isSecretRef(value)) {
      throw new Error(
        `envVars["${key}"] must be a SecretRef { source, provider, id } — plaintext keys are not allowed (SecretRef-First)`,
      );
    }
    out[key] = value;
  }
  return out;
}

/**
 * True when `binding` permits using the credential for `(backendId, model, role)`.
 * Absent allow-lists mean "no constraint on that dimension"; the default binding
 * (none) is treated by callers as "only the credential's own backend".
 */
export function bindingAllows(
  binding: CredentialBinding | undefined,
  ctx: { backendId: string; model?: string; role?: string },
): boolean {
  if (!binding) {
    return true;
  }
  if (
    binding.allowedBackends &&
    binding.allowedBackends.length > 0 &&
    !binding.allowedBackends.includes(ctx.backendId)
  ) {
    return false;
  }
  if (binding.allowedModels && binding.allowedModels.length > 0) {
    const ref = ctx.model ? `${ctx.backendId}/${ctx.model}` : "";
    if (!binding.allowedModels.includes(ref) && !binding.allowedModels.includes(ctx.model ?? "")) {
      return false;
    }
  }
  if (
    binding.allowedRoles &&
    binding.allowedRoles.length > 0 &&
    (!ctx.role || !binding.allowedRoles.includes(ctx.role))
  ) {
    return false;
  }
  return true;
}

/**
 * Pick the highest-priority credential for a run: personal/seat (matching
 * subjectId) → enterprise. Only credentials whose binding allows the
 * `(backendId, model, role)` context are eligible. Returns null when none apply.
 */
export function selectCredentialForRun(params: {
  credentials: readonly CliBackendCredential[];
  bindings: Readonly<Record<string, CredentialBinding>>;
  tenantId: string;
  backendId: string;
  subjectId?: string;
  model?: string;
  role?: string;
}): CliBackendCredential | null {
  const { credentials, bindings, tenantId, backendId, subjectId, model, role } = params;
  const eligible = credentials.filter((c) => {
    if (c.tenantId !== tenantId || c.backendId !== backendId) {
      return false;
    }
    // Default binding: a credential may always be used by its own backend.
    const binding = bindings[c.credentialId];
    return bindingAllows(binding, { backendId, model, role });
  });
  // Personal (matching subject) outranks enterprise.
  const personal = eligible.find(
    (c) => c.scope === "personal" && subjectId && c.subjectId === subjectId,
  );
  if (personal) {
    return personal;
  }
  return eligible.find((c) => c.scope === "enterprise") ?? null;
}

// ── Store operations ───────────────────────────────────────────────────────

export async function listCliBackendCredentials(
  tenantId: string,
  storePath?: string,
): Promise<CliBackendCredential[]> {
  const store = await loadStore(storePath);
  return Object.values(store.credentials).filter((c) => c.tenantId === tenantId);
}

export async function getCliBackendCredentialBindings(
  storePath?: string,
): Promise<Record<string, CredentialBinding>> {
  const store = await loadStore(storePath);
  return store.bindings;
}

export async function upsertCliBackendCredential(
  input: {
    credentialId: string;
    tenantId: string;
    scope: CliBackendCredentialScope;
    subjectId?: string;
    backendId: string;
    envVars: Record<string, SecretRef>;
  },
  storePath?: string,
): Promise<CliBackendCredential> {
  const credentialId = input.credentialId.trim();
  if (!credentialId) {
    throw new Error("credentialId is required");
  }
  if (input.scope === "personal" && !input.subjectId?.trim()) {
    throw new Error("subjectId is required for personal-scope credentials");
  }
  const envVars = validateCredentialEnvVars(input.envVars);
  return withLock(async () => {
    const store = await loadStore(storePath);
    const record: CliBackendCredential = {
      credentialId,
      tenantId: input.tenantId.trim(),
      scope: input.scope,
      ...(input.subjectId?.trim() ? { subjectId: input.subjectId.trim() } : {}),
      backendId: input.backendId.trim(),
      envVars,
      updatedAt: new Date().toISOString(),
    };
    store.credentials[credentialId] = record;
    await saveStore(store, storePath);
    return record;
  });
}

export async function removeCliBackendCredential(
  credentialId: string,
  storePath?: string,
): Promise<boolean> {
  const id = credentialId.trim();
  return withLock(async () => {
    const store = await loadStore(storePath);
    if (!store.credentials[id]) {
      return false;
    }
    delete store.credentials[id];
    delete store.bindings[id];
    await saveStore(store, storePath);
    return true;
  });
}

export async function setCliBackendCredentialBinding(
  binding: CredentialBinding,
  storePath?: string,
): Promise<CredentialBinding> {
  const credentialId = binding.credentialId.trim();
  if (!credentialId) {
    throw new Error("credentialId is required");
  }
  return withLock(async () => {
    const store = await loadStore(storePath);
    store.bindings[credentialId] = { ...binding, credentialId };
    await saveStore(store, storePath);
    return store.bindings[credentialId];
  });
}
