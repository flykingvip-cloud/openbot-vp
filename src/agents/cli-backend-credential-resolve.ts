/**
 * cli-backend-credential-resolve.ts — resolve a CLI backend credential's
 * SecretRefs to concrete env values (cli-backend-onboarding Task 6/7).
 *
 * Reuses the existing secret resolver (`src/secrets/resolve.ts`), so values come
 * from the configured source (env / file / exec→Vault/AWS/Azure/GCP). Fail-safe:
 * if ANY ref fails to resolve, the credential is reported unusable (callers fall
 * back to the next priority) rather than injecting a partial/blank key. Resolved
 * values are returned only for in-process env injection and are NEVER logged.
 */

import type { OpenBotConfig } from "../config/config.js";
import { resolveSecretRefString } from "../secrets/resolve.js";
import {
  getCliBackendCredentialBindings,
  listCliBackendCredentials,
  selectCredentialForRun,
  type CliBackendCredential,
} from "./cli-backend-credential-store.js";

export interface ResolvedCredentialEnv {
  ok: boolean;
  /** env var name → resolved value (present only when ok). */
  env?: Record<string, string>;
  /** env var names whose SecretRef failed to resolve (no values, just names). */
  failedKeys?: string[];
}

/**
 * Resolve every envVar SecretRef of a credential. All-or-nothing: a single
 * failed ref yields `{ ok:false, failedKeys }` so the caller skips this
 * credential entirely.
 */
export async function resolveCliBackendCredentialEnv(
  credential: CliBackendCredential,
  opts: { config: OpenBotConfig; env?: NodeJS.ProcessEnv },
): Promise<ResolvedCredentialEnv> {
  const env: Record<string, string> = {};
  const failedKeys: string[] = [];
  for (const [name, ref] of Object.entries(credential.envVars)) {
    try {
      const value = await resolveSecretRefString(ref, {
        config: opts.config,
        ...(opts.env ? { env: opts.env } : {}),
      });
      env[name] = value;
    } catch {
      failedKeys.push(name);
    }
  }
  if (failedKeys.length > 0) {
    return { ok: false, failedKeys };
  }
  return { ok: true, env };
}

/** Verify a credential resolves (structural + source resolution) without exposing values. */
export async function verifyCliBackendCredential(
  credential: CliBackendCredential,
  opts: { config: OpenBotConfig; env?: NodeJS.ProcessEnv },
): Promise<{ valid: boolean; resolvedKeys: string[]; failedKeys: string[] }> {
  const resolved = await resolveCliBackendCredentialEnv(credential, opts);
  if (resolved.ok) {
    return { valid: true, resolvedKeys: Object.keys(credential.envVars), failedKeys: [] };
  }
  const failed = new Set(resolved.failedKeys ?? []);
  return {
    valid: false,
    resolvedKeys: Object.keys(credential.envVars).filter((k) => !failed.has(k)),
    failedKeys: resolved.failedKeys ?? [],
  };
}

/**
 * Compose store selection + SecretRef resolution into the per-run env to inject
 * plus the selected credential id (Task 6). Returns `undefined` when there is no
 * scope, no matching/governed credential, or any ref fails to resolve — i.e. the
 * run falls back to the host default (`CliBackendConfig.env`) with byte-for-byte
 * unchanged behavior when no credential is configured. The `credentialId` lets
 * callers write a `UsageAttribution` record (Task 9, R9.1) without re-selecting.
 */
export async function resolveCredentialForRun(params: {
  /** The CLI backend id (== model-ref provider segment). */
  backendId: string;
  model?: string;
  role?: string;
  /** Bot-owning enterprise scope (from resolveAgentRunEntitlementScope); null ⇒ host default. */
  scope: { tenantId: string; subjectId?: string } | null;
  config: OpenBotConfig;
  env?: NodeJS.ProcessEnv;
  storePath?: string;
}): Promise<{ env: Record<string, string>; credentialId: string } | undefined> {
  const tenantId = params.scope?.tenantId?.trim();
  if (!tenantId) {
    return undefined;
  }
  const [credentials, bindings] = await Promise.all([
    listCliBackendCredentials(tenantId, params.storePath),
    getCliBackendCredentialBindings(params.storePath),
  ]);
  const credential = selectCredentialForRun({
    credentials,
    bindings,
    tenantId,
    backendId: params.backendId,
    ...(params.scope?.subjectId ? { subjectId: params.scope.subjectId } : {}),
    ...(params.model ? { model: params.model } : {}),
    ...(params.role ? { role: params.role } : {}),
  });
  if (!credential) {
    return undefined;
  }
  const resolved = await resolveCliBackendCredentialEnv(credential, {
    config: params.config,
    ...(params.env ? { env: params.env } : {}),
  });
  return resolved.ok
    ? { env: resolved.env ?? {}, credentialId: credential.credentialId }
    : undefined;
}

/**
 * Env-only convenience over {@link resolveCredentialForRun}: returns just the
 * per-run env to inject (back-compat for callers that don't need attribution).
 * Callers pass this to `runCliAgent({ credentialEnv })`.
 */
export async function resolveCredentialEnvForRun(params: {
  /** The CLI backend id (== model-ref provider segment). */
  backendId: string;
  model?: string;
  role?: string;
  /** Bot-owning enterprise scope (from resolveAgentRunEntitlementScope); null ⇒ host default. */
  scope: { tenantId: string; subjectId?: string } | null;
  config: OpenBotConfig;
  env?: NodeJS.ProcessEnv;
  storePath?: string;
}): Promise<Record<string, string> | undefined> {
  return (await resolveCredentialForRun(params))?.env;
}
