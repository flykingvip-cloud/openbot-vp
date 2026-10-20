/**
 * cli-backend.ts — platform admin API for managing CLI backends (the third-party
 * coding-agent CLIs bots can use as a model backend).
 *
 *  - cliBackend.list   → built-ins + configured backends + presets (read)
 *  - cliBackend.capabilities → declared model catalog + feature flags (read)
 *  - cliBackend.upsert → validate + persist agents.defaults.cliBackends.<id> (admin)
 *  - cliBackend.remove → delete a config-defined backend (admin)
 *  - cliBackend.test   → bounded executable probe (admin)
 *  - cliBackend.credential.list/set/remove/bind → SecretRef-First credentials (admin)
 *  - cliBackend.verifyCredential → resolve a credential's SecretRefs (admin)
 *
 * SECURITY: upsert/remove/test ultimately influence (or perform) local process
 * execution on the gateway host. They are ADMIN-scoped (registered in
 * method-scopes.ts) and every change is written to the control-plane audit log.
 * `cliBackend.test` runs the configured `command` with a short, fixed probe
 * (default `--version`) under a hard timeout — it does NOT run an LLM round-trip.
 */

import {
  BUILTIN_CLI_BACKEND_IDS,
  CLI_BACKEND_PRESETS,
  describeCliBackendCapabilities,
  describeCliBackends,
  hasConfiguredCliBackend,
  removeCliBackendConfig,
  setCliBackendConfig,
  validateCliBackendConfig,
  validateCliBackendId,
} from "../../agents/cli-backend-admin.js";
import { verifyCliBackendCredential } from "../../agents/cli-backend-credential-resolve.js";
import {
  getCliBackendCredentialBindings,
  listCliBackendCredentials,
  removeCliBackendCredential,
  setCliBackendCredentialBinding,
  upsertCliBackendCredential,
  type CliBackendCredential,
  type CliBackendCredentialScope,
} from "../../agents/cli-backend-credential-store.js";
import { probeCliBackendCommand } from "../../agents/cli-backend-probe.js";
import { loadConfig, writeConfigFile } from "../../config/config.js";
import type { CliBackendConfig } from "../../config/types.js";
import { isValidEnvSecretRefId } from "../../config/types.secrets.js";
import {
  buildEncryptedLocalSecretRef,
  deleteEncryptedLocalSecret,
  ENCRYPTED_LOCAL_SOURCE,
  putEncryptedLocalSecret,
  resolveEncryptedLocalMasterKeyRef,
} from "../../secrets/encrypted-local-store.js";
import { resolveSecretRefString } from "../../secrets/resolve.js";
import { resolveBillingScope } from "../billing/scope.js";
import { formatControlPlaneActor, resolveControlPlaneActor } from "../control-plane-audit.js";
import {
  requireResolvedEnterpriseAdminTenantId,
  resolveTrustedSessionEmployeeId,
} from "../enterprise-data/enterprise-data-seat-context.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { isRecord } from "../records.js";
import type { GatewayClient, GatewayRequestHandlers, RespondFn } from "./types.js";

/**
 * Delegated credential authorization, derived ENTIRELY from the trusted session
 * (`client.sessionDomain` is server-set from the signed platform session; it is
 * never client-supplied). Client-provided tenantId/subjectId/scope are ignored.
 * - enterprise session → enterprise-admin of own tenant, scope "enterprise".
 * - employee session   → own seat (subjectId = platform user id), scope "personal".
 * - any other session  → rejected (platform admins use cliBackend.credential.*).
 */
type ResolvedScopedAuth =
  | { ok: true; scope: "enterprise"; tenantId: string; subjectId?: undefined }
  | { ok: true; scope: "personal"; tenantId: string; subjectId: string }
  | { ok: false };

async function resolveScopedCredentialAuth(args: {
  client: GatewayClient | null;
  params: Record<string, unknown>;
  respond: RespondFn;
}): Promise<ResolvedScopedAuth> {
  const domain = args.client?.sessionDomain;
  if (domain === "enterprise") {
    const tenantId = await requireResolvedEnterpriseAdminTenantId({
      client: args.client,
      params: args.params,
      respond: args.respond,
    });
    if (!tenantId) {
      return { ok: false };
    }
    return { ok: true, scope: "enterprise", tenantId };
  }
  if (domain === "employee") {
    try {
      const subjectId = await resolveTrustedSessionEmployeeId(args.client);
      const billing = await resolveBillingScope(args.client);
      if (!billing.enterpriseId) {
        args.respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "active enterprise membership is required"),
        );
        return { ok: false };
      }
      return { ok: true, scope: "personal", tenantId: billing.enterpriseId, subjectId };
    } catch (err) {
      args.respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, err instanceof Error ? err.message : String(err)),
      );
      return { ok: false };
    }
  }
  args.respond(
    false,
    undefined,
    errorShape(
      ErrorCodes.INVALID_REQUEST,
      "scoped credential methods require an enterprise or employee session",
    ),
  );
  return { ok: false };
}

function isLikelyBackendId(value: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(value);
}

/** Deterministic credential id so re-set overwrites and remove/verify can locate it. */
function scopedCredentialId(
  auth: Extract<ResolvedScopedAuth, { ok: true }>,
  backendId: string,
): string {
  return auth.scope === "enterprise"
    ? `ent:${auth.tenantId}:${backendId}`
    : `usr:${auth.tenantId}:${auth.subjectId}:${backendId}`;
}

/** Ownership guard: a credential must belong to the caller's tenant/scope/subject. */
function ownsScopedCredential(
  credential: CliBackendCredential,
  auth: Extract<ResolvedScopedAuth, { ok: true }>,
): boolean {
  if (credential.tenantId !== auth.tenantId) {
    return false;
  }
  if (auth.scope === "enterprise") {
    return credential.scope === "enterprise";
  }
  return credential.scope === "personal" && credential.subjectId === auth.subjectId;
}

export const cliBackendHandlers: GatewayRequestHandlers = {
  "cliBackend.list": ({ respond }) => {
    const cfg = loadConfig();
    respond(true, {
      backends: describeCliBackends(cfg),
      presets: CLI_BACKEND_PRESETS,
      builtinIds: [...BUILTIN_CLI_BACKEND_IDS],
    });
  },

  // Capability discovery (P0-2): aggregate a backend's declared model catalog
  // into feature flags so admins authorize what actually runs. Declared source
  // for now; runtime probing can enrich source="probe" later.
  "cliBackend.capabilities": ({ params, respond }) => {
    const id = typeof params.id === "string" ? params.id.trim() : "";
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "id is required"));
      return;
    }
    respond(true, describeCliBackendCapabilities(loadConfig(), id));
  },

  "cliBackend.upsert": async ({ params, respond, client, context }) => {
    let id: string;
    let config: CliBackendConfig;
    try {
      id = validateCliBackendId(params.id);
      config = validateCliBackendConfig(params.config);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, err instanceof Error ? err.message : String(err)),
      );
      return;
    }
    try {
      await writeConfigFile(setCliBackendConfig(loadConfig(), id, config));
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, err instanceof Error ? err.message : String(err)),
      );
      return;
    }
    const actor = resolveControlPlaneActor(client);
    context.logGateway?.info?.(
      `cliBackend.upsert id=${id} command=${config.command} ${formatControlPlaneActor(actor)}`,
    );
    respond(true, { id });
  },

  "cliBackend.remove": async ({ params, respond, client, context }) => {
    let id: string;
    try {
      id = validateCliBackendId(params.id);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, err instanceof Error ? err.message : String(err)),
      );
      return;
    }
    const cfg = loadConfig();
    if (!hasConfiguredCliBackend(cfg, id)) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `no configured CLI backend "${id}" to remove`),
      );
      return;
    }
    try {
      await writeConfigFile(removeCliBackendConfig(cfg, id));
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, err instanceof Error ? err.message : String(err)),
      );
      return;
    }
    const actor = resolveControlPlaneActor(client);
    context.logGateway?.info?.(`cliBackend.remove id=${id} ${formatControlPlaneActor(actor)}`);
    respond(true, { id });
  },

  "cliBackend.test": async ({ params, respond, client, context }) => {
    // Resolve the command to probe: explicit command, or an existing backend's id.
    let command = typeof params.command === "string" ? params.command.trim() : "";
    if (!command && typeof params.id === "string") {
      const desc = describeCliBackends(loadConfig()).find((b) => b.id === params.id);
      command = desc?.effective?.command ?? "";
    }
    if (!command) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "command or id is required"),
      );
      return;
    }
    const probeArgs = Array.isArray(params.probeArgs)
      ? (params.probeArgs as unknown[]).filter((a): a is string => typeof a === "string")
      : ["--version"];
    const result = await probeCliBackendCommand(command, probeArgs);
    const actor = resolveControlPlaneActor(client);
    context.logGateway?.info?.(
      `cliBackend.test command=${command} ok=${result.ok} resolved=${result.resolved} ${formatControlPlaneActor(actor)}`,
    );
    respond(true, result);
  },

  // ── Credentials (Phase 2): SecretRef-First, scope governance, verify ──────

  "cliBackend.credential.list": async ({ params, respond }) => {
    const tenantId = typeof params.tenantId === "string" ? params.tenantId.trim() : "";
    if (!tenantId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "tenantId is required"));
      return;
    }
    const [credentials, bindings] = await Promise.all([
      listCliBackendCredentials(tenantId),
      getCliBackendCredentialBindings(),
    ]);
    // Credentials hold only SecretRefs (no plaintext) — safe to return as-is.
    respond(true, { credentials, bindings });
  },

  "cliBackend.credential.set": async ({ params, respond, client, context }) => {
    const scope = params.scope === "personal" ? "personal" : "enterprise";
    const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
    try {
      const record = await upsertCliBackendCredential({
        credentialId: str(params.credentialId),
        tenantId: str(params.tenantId),
        scope: scope as CliBackendCredentialScope,
        subjectId: typeof params.subjectId === "string" ? params.subjectId : undefined,
        backendId: str(params.backendId),
        envVars: (params.envVars ?? {}) as Record<string, never>,
      });
      const actor = resolveControlPlaneActor(client);
      context.logGateway?.info?.(
        `cliBackend.credential.set id=${record.credentialId} scope=${record.scope} backend=${record.backendId} keys=${Object.keys(record.envVars).join(",")} ${formatControlPlaneActor(actor)}`,
      );
      respond(true, { credentialId: record.credentialId });
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, err instanceof Error ? err.message : String(err)),
      );
    }
  },

  "cliBackend.credential.remove": async ({ params, respond, client, context }) => {
    const credentialId = typeof params.credentialId === "string" ? params.credentialId.trim() : "";
    if (!credentialId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "credentialId is required"));
      return;
    }
    const removed = await removeCliBackendCredential(credentialId);
    const actor = resolveControlPlaneActor(client);
    context.logGateway?.info?.(
      `cliBackend.credential.remove id=${credentialId} removed=${removed} ${formatControlPlaneActor(actor)}`,
    );
    respond(true, { removed });
  },

  "cliBackend.credential.bind": async ({ params, respond, client, context }) => {
    const credentialId = typeof params.credentialId === "string" ? params.credentialId.trim() : "";
    if (!credentialId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "credentialId is required"));
      return;
    }
    const strArr = (v: unknown): string[] | undefined =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : undefined;
    const binding = await setCliBackendCredentialBinding({
      credentialId,
      allowedBackends: strArr(params.allowedBackends),
      allowedModels: strArr(params.allowedModels),
      allowedRoles: strArr(params.allowedRoles),
    });
    const actor = resolveControlPlaneActor(client);
    context.logGateway?.info?.(
      `cliBackend.credential.bind id=${credentialId} ${formatControlPlaneActor(actor)}`,
    );
    respond(true, { binding });
  },

  // Verify a stored credential resolves its SecretRefs (no values exposed).
  "cliBackend.verifyCredential": async ({ params, respond, client, context }) => {
    const tenantId = typeof params.tenantId === "string" ? params.tenantId.trim() : "";
    const credentialId = typeof params.credentialId === "string" ? params.credentialId.trim() : "";
    if (!tenantId || !credentialId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "tenantId and credentialId are required"),
      );
      return;
    }
    const creds = await listCliBackendCredentials(tenantId);
    const credential = creds.find((c) => c.credentialId === credentialId);
    if (!credential) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "credential not found"));
      return;
    }
    const result = await verifyCliBackendCredential(credential, { config: loadConfig() });
    const actor = resolveControlPlaneActor(client);
    context.logGateway?.info?.(
      `cliBackend.verifyCredential id=${credentialId} valid=${result.valid} failed=${result.failedKeys.join(",")} ${formatControlPlaneActor(actor)}`,
    );
    respond(true, result);
  },

  // ── Delegated (scoped) credential self-service ────────────────────────────
  // Enterprise-admin configures the tenant's shared key (scope "enterprise");
  // an employee configures their own personal key (scope "personal"). Identity
  // (tenantId / subjectId / scope) is ALWAYS derived from the trusted session —
  // client-supplied identity is ignored. Raw key values are encrypted at rest
  // via encrypted-local; the credential record only stores SecretRef pointers.

  "cliBackend.credential.scopedList": async ({ params, respond, client }) => {
    const auth = await resolveScopedCredentialAuth({ client, params, respond });
    if (!auth.ok) {
      return;
    }
    const mine = (await listCliBackendCredentials(auth.tenantId)).filter((c) =>
      ownsScopedCredential(c, auth),
    );
    respond(true, {
      scope: auth.scope,
      credentials: mine.map((c) => ({
        credentialId: c.credentialId,
        backendId: c.backendId,
        scope: c.scope,
        envVarNames: Object.keys(c.envVars),
        updatedAt: c.updatedAt,
      })),
    });
  },

  "cliBackend.credential.scopedSet": async ({ params, respond, client, context }) => {
    const auth = await resolveScopedCredentialAuth({ client, params, respond });
    if (!auth.ok) {
      return;
    }
    const backendId = typeof params.backendId === "string" ? params.backendId.trim() : "";
    if (!isLikelyBackendId(backendId)) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "invalid backendId"));
      return;
    }
    // envVars maps ENV_NAME → raw plaintext key value (encrypted at rest below).
    const rawEnv = isRecord(params.envVars) ? params.envVars : null;
    const entries = rawEnv ? Object.entries(rawEnv) : [];
    if (entries.length === 0) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "envVars (ENV_NAME → value) is required"),
      );
      return;
    }
    for (const [name, value] of entries) {
      if (!isValidEnvSecretRefId(name)) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `invalid env var name "${name}"`),
        );
        return;
      }
      if (typeof value !== "string" || !value.trim()) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `env var "${name}" requires a non-empty value`),
        );
        return;
      }
    }
    const cfg = loadConfig();
    const masterKeyRef = resolveEncryptedLocalMasterKeyRef(cfg);
    const masterKey = masterKeyRef
      ? await resolveSecretRefString(masterKeyRef, { config: cfg }).catch(() => null)
      : null;
    if (!masterKey) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.UNAVAILABLE,
          "encrypted-local master key is unavailable; ask the platform operator to configure OPENBOT_SECRET_MASTER_KEY (or secrets.encryptedLocal.masterKeyRef)",
        ),
      );
      return;
    }
    const credentialId = scopedCredentialId(auth, backendId);
    try {
      const envVars: Record<string, ReturnType<typeof buildEncryptedLocalSecretRef>> = {};
      for (const [name, value] of entries) {
        const secretId = `${credentialId}#${name}`;
        await putEncryptedLocalSecret({ id: secretId, value: (value as string).trim(), masterKey });
        envVars[name] = buildEncryptedLocalSecretRef(secretId);
      }
      const record = await upsertCliBackendCredential({
        credentialId,
        tenantId: auth.tenantId,
        scope: auth.scope,
        ...(auth.scope === "personal" ? { subjectId: auth.subjectId } : {}),
        backendId,
        envVars,
      });
      const actor = resolveControlPlaneActor(client);
      context.logGateway?.info?.(
        `cliBackend.credential.scopedSet id=${record.credentialId} scope=${record.scope} backend=${record.backendId} keys=${Object.keys(record.envVars).join(",")} ${formatControlPlaneActor(actor)}`,
      );
      respond(true, {
        credentialId: record.credentialId,
        scope: record.scope,
        backendId: record.backendId,
      });
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, err instanceof Error ? err.message : String(err)),
      );
    }
  },

  "cliBackend.credential.scopedRemove": async ({ params, respond, client, context }) => {
    const auth = await resolveScopedCredentialAuth({ client, params, respond });
    if (!auth.ok) {
      return;
    }
    const backendId = typeof params.backendId === "string" ? params.backendId.trim() : "";
    if (!isLikelyBackendId(backendId)) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "invalid backendId"));
      return;
    }
    const credentialId = scopedCredentialId(auth, backendId);
    const owned = (await listCliBackendCredentials(auth.tenantId)).find(
      (c) => c.credentialId === credentialId && ownsScopedCredential(c, auth),
    );
    if (!owned) {
      respond(true, { removed: false });
      return;
    }
    for (const ref of Object.values(owned.envVars)) {
      if (ref.source === ENCRYPTED_LOCAL_SOURCE) {
        await deleteEncryptedLocalSecret(ref.id).catch(() => undefined);
      }
    }
    const removed = await removeCliBackendCredential(credentialId);
    const actor = resolveControlPlaneActor(client);
    context.logGateway?.info?.(
      `cliBackend.credential.scopedRemove id=${credentialId} removed=${removed} ${formatControlPlaneActor(actor)}`,
    );
    respond(true, { removed });
  },

  "cliBackend.credential.scopedVerify": async ({ params, respond, client, context }) => {
    const auth = await resolveScopedCredentialAuth({ client, params, respond });
    if (!auth.ok) {
      return;
    }
    const backendId = typeof params.backendId === "string" ? params.backendId.trim() : "";
    if (!isLikelyBackendId(backendId)) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "invalid backendId"));
      return;
    }
    const credentialId = scopedCredentialId(auth, backendId);
    const owned = (await listCliBackendCredentials(auth.tenantId)).find(
      (c) => c.credentialId === credentialId && ownsScopedCredential(c, auth),
    );
    if (!owned) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "credential not found"));
      return;
    }
    const result = await verifyCliBackendCredential(owned, { config: loadConfig() });
    const actor = resolveControlPlaneActor(client);
    context.logGateway?.info?.(
      `cliBackend.credential.scopedVerify id=${credentialId} valid=${result.valid} ${formatControlPlaneActor(actor)}`,
    );
    respond(true, result);
  },
};
