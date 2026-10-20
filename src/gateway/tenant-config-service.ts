import {
  loadConfig,
  parseConfigJson5,
  resolveConfigSnapshotHash,
  validateConfigObjectWithPlugins,
} from "../config/config.js";
import { redactConfigObject, restoreRedactedValues } from "../config/redact-snapshot.js";
import type { ConfigValidationIssue, OpenBotConfig } from "../config/types.openbot.js";
import { loadSchemaWithPlugins } from "./server-methods/config-schema.js";
import {
  diffTenantOverride,
  loadTenantConfigStore,
  resolveConfigForTenant,
  saveTenantConfigStore,
  setTenantConfigOverride,
  getTenantConfigOverride,
} from "./tenant-config.js";

/**
 * Server-side tenant-scoped config read/write (Phase 2, decision "C").
 *
 * These operate on the tenant override store (`tenant-config.ts`) layered onto
 * the global platform-default config. They never write tenant data into the
 * global `openbot.json`, and they never trigger a gateway restart (tenant
 * credential edits are config-resolution only; per-tenant runtime activation is
 * the separate Runtime Phase). Trusted-tenant resolution happens in the handler
 * BEFORE calling these — `tenantId` here is already authoritative.
 */

export type TenantConfigReadResult = {
  config: unknown;
  hash: string;
};

export type TenantConfigWriteResult =
  | { ok: true; config: unknown; hash: string }
  | { ok: false; code: "BASE_HASH" | "INVALID"; message: string; issues?: unknown };

function hashConfigView(view: OpenBotConfig): string {
  return resolveConfigSnapshotHash({ raw: `${JSON.stringify(view, null, 2)}\n` }) ?? "";
}

function resolvePlatformDefault(platformDefault?: OpenBotConfig): OpenBotConfig {
  return platformDefault ?? loadConfig();
}

function validationIssueKey(issue: ConfigValidationIssue): string {
  return JSON.stringify([issue.path, issue.message]);
}

function hasOnlyExistingValidationIssues(params: {
  current: ConfigValidationIssue[];
  candidate: ConfigValidationIssue[];
}): boolean {
  const currentKeys = new Set(params.current.map(validationIssueKey));
  return params.candidate.every((issue) => currentKeys.has(validationIssueKey(issue)));
}

/**
 * Read a tenant's effective config view (redacted) plus a base hash for
 * optimistic concurrency on the next write.
 */
export async function readTenantConfig(params: {
  tenantId: string;
  platformDefault?: OpenBotConfig;
  storePath?: string;
}): Promise<TenantConfigReadResult> {
  const platformDefault = resolvePlatformDefault(params.platformDefault);
  const store = await loadTenantConfigStore(params.storePath);
  const override = getTenantConfigOverride(store, params.tenantId);
  const view = resolveConfigForTenant({ platformDefault, override });
  const schema = loadSchemaWithPlugins();
  return {
    config: redactConfigObject(view, schema.uiHints),
    hash: hashConfigView(view),
  };
}

/**
 * Validate a full tenant config (`raw`), reduce it to a minimal override against
 * the platform default, and persist it to the tenant store.
 *
 * `baseHash` (when provided) must match the current tenant view hash — this is
 * the same optimistic-concurrency contract as the global `config.set`.
 * Redaction sentinels in `raw` restore against the tenant's current view, so a
 * round-trip through the UI never clobbers stored tenant secrets.
 */
export async function writeTenantConfigFromRaw(params: {
  tenantId: string;
  raw: string;
  baseHash?: string;
  platformDefault?: OpenBotConfig;
  storePath?: string;
  now?: () => Date;
}): Promise<TenantConfigWriteResult> {
  const platformDefault = resolvePlatformDefault(params.platformDefault);
  const store = await loadTenantConfigStore(params.storePath);
  const currentOverride = getTenantConfigOverride(store, params.tenantId);
  const currentView = resolveConfigForTenant({ platformDefault, override: currentOverride });

  if (params.baseHash !== undefined && params.baseHash !== hashConfigView(currentView)) {
    return {
      ok: false,
      code: "BASE_HASH",
      message: "tenant config changed since last load; re-run config.get and retry",
    };
  }

  const parsedRes = parseConfigJson5(params.raw);
  if (!parsedRes.ok) {
    return { ok: false, code: "INVALID", message: parsedRes.error };
  }

  const schema = loadSchemaWithPlugins();
  const restored = restoreRedactedValues(parsedRes.parsed, currentView, schema.uiHints);
  if (!restored.ok) {
    return {
      ok: false,
      code: "INVALID",
      message: restored.humanReadableMessage ?? "invalid config",
    };
  }

  const validated = validateConfigObjectWithPlugins(restored.result);
  let configForWrite: OpenBotConfig;
  if (validated.ok) {
    configForWrite = validated.config;
  } else {
    const currentValidated = validateConfigObjectWithPlugins(currentView);
    if (
      currentValidated.ok ||
      !hasOnlyExistingValidationIssues({
        current: currentValidated.issues,
        candidate: validated.issues,
      })
    ) {
      return { ok: false, code: "INVALID", message: "invalid config", issues: validated.issues };
    }
    // Preserve a legacy-invalid platform baseline while allowing tenant edits
    // that do not introduce or alter any validation issue.
    configForWrite = restored.result as OpenBotConfig;
  }

  // Diff against a normalized platform baseline so applied schema defaults
  // cancel out and the stored override captures only the tenant's real changes.
  const platformBaseline = validateConfigObjectWithPlugins(platformDefault);
  const baselineForDiff = platformBaseline.ok ? platformBaseline.config : platformDefault;
  const override = diffTenantOverride(baselineForDiff, configForWrite);
  const nextStore = setTenantConfigOverride(store, params.tenantId, override, params.now);
  await saveTenantConfigStore(nextStore, params.storePath);

  const view = resolveConfigForTenant({ platformDefault, override });
  return {
    ok: true,
    config: redactConfigObject(view, schema.uiHints),
    hash: hashConfigView(view),
  };
}

/**
 * Persist an already-validated tenant config view (object form).
 * Used by tenant-scoped channel logout to clear secrets without going through
 * plugin `writeConfigFile` (which always targets the global openbot.json).
 */
export async function writeTenantConfigView(params: {
  tenantId: string;
  config: OpenBotConfig;
  platformDefault?: OpenBotConfig;
  storePath?: string;
  now?: () => Date;
}): Promise<TenantConfigWriteResult> {
  const platformDefault = resolvePlatformDefault(params.platformDefault);
  const store = await loadTenantConfigStore(params.storePath);
  const validated = validateConfigObjectWithPlugins(params.config);
  if (!validated.ok) {
    return { ok: false, code: "INVALID", message: "invalid config", issues: validated.issues };
  }
  const platformBaseline = validateConfigObjectWithPlugins(platformDefault);
  const baselineForDiff = platformBaseline.ok ? platformBaseline.config : platformDefault;
  const override = diffTenantOverride(baselineForDiff, validated.config);
  const nextStore = setTenantConfigOverride(store, params.tenantId, override, params.now);
  await saveTenantConfigStore(nextStore, params.storePath);
  const view = resolveConfigForTenant({ platformDefault, override });
  return {
    ok: true,
    config: redactConfigObject(view, loadSchemaWithPlugins().uiHints),
    hash: hashConfigView(view),
  };
}
