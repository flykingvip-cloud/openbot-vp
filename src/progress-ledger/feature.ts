/**
 * Progress Ledger feature gate. OFF by default at the process-global switch.
 *
 * Enablement is process-global. Either enablement source turns the process
 * on for every tenant unless a tenant allowlist is also set:
 *  1. `OPENBOT_PROGRESS_LEDGER_ENABLED` in {1,true,yes,on}
 *  2. `gateway.progressLedger.enabled === true`
 *
 * Combination is OR, not "env wins". `OPENBOT_PROGRESS_LEDGER_ENABLED=0`
 * (or unset) does NOT disable the process if config.enabled is true.
 * Defaults do not enable this process-global switch.
 *
 * Shutdown wins over every enablement source:
 *  1. `OPENBOT_PROGRESS_LEDGER_SHUTDOWN` in {1,true,yes,on}
 *  2. `gateway.progressLedger.shutdown === true`
 * Rollback must set a shutdown source or clear ALL enablement sources.
 * Setting only env=0 is not a complete shutdown path.
 *
 * Tenant admission (optional; empty means unrestricted):
 *  1. `OPENBOT_PROGRESS_LEDGER_TENANT_ALLOWLIST` (comma-separated)
 *  2. `gateway.progressLedger.tenantAllowlist`
 * Combined as a union. When non-empty, only listed tenants receive
 * projections and new conversation-task ledger seeds. A shared instance
 * with the global switch on and an empty allowlist is process-wide, not
 * a single-tenant canary. Clearing the allowlist is not a safe rollback:
 * it widens admission to every tenant.
 *
 * Conversation-task progress projections are a distinct enablement source.
 * `OPENBOT_CONVERSATION_TASK_CLOSE_REQUIRES_EVIDENCE` defaults ON, so the
 * conversation-task evidence ledger can project even when both process-
 * global sources are unset. Shutdown and tenant admission still apply.
 * Long-horizon cron `createCronLedgerSession` binds even when this gate
 * is unset; it is a separate path. Do not flip those defaults here.
 *
 * `loadConfig()` is cached. A config-file change requires a process
 * restart (or cache invalidation) to take effect. Env flags are read
 * on each call and apply to the next request in the same process.
 */

import { loadConfig } from "../config/config.js";

export const PROGRESS_LEDGER_ENABLED_ENV = "OPENBOT_PROGRESS_LEDGER_ENABLED";
export const PROGRESS_LEDGER_SHUTDOWN_ENV = "OPENBOT_PROGRESS_LEDGER_SHUTDOWN";
export const PROGRESS_LEDGER_TENANT_ALLOWLIST_ENV = "OPENBOT_PROGRESS_LEDGER_TENANT_ALLOWLIST";

export type ProgressLedgerConfigSlice = {
  enabled?: boolean;
  shutdown?: boolean;
  tenantAllowlist?: string[];
};

export type ProgressLedgerConfigReader = () => boolean | ProgressLedgerConfigSlice;

export type ProgressLedgerGate = {
  envEnabled: boolean;
  configEnabled: boolean;
  shutdownEnv: boolean;
  shutdownConfig: boolean;
  shutdown: boolean;
  /** True when an enablement source is on and shutdown is off. */
  processEnabled: boolean;
  tenantAllowlist: string[];
  /** True when a non-empty allowlist restricts admission. */
  scoped: boolean;
  enablementSources: Array<"env" | "config">;
  shutdownSources: Array<"shutdown_env" | "shutdown_config">;
};

function envFlagOn(raw: string | undefined): boolean {
  const value = raw?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

function parseCsv(raw: string | undefined): string[] {
  if (!raw?.trim()) {
    return [];
  }
  return [
    ...new Set(
      raw
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

function normalizeId(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function normalizeSlice(value: boolean | ProgressLedgerConfigSlice): ProgressLedgerConfigSlice {
  return typeof value === "boolean" ? { enabled: value } : value;
}

function readConfigSlice(readConfig?: ProgressLedgerConfigReader): ProgressLedgerConfigSlice {
  if (readConfig) {
    try {
      return normalizeSlice(readConfig());
    } catch {
      return {};
    }
  }
  try {
    return loadConfig().gateway?.progressLedger ?? {};
  } catch {
    return {};
  }
}

export function resolveProgressLedgerGate(
  env: NodeJS.ProcessEnv = process.env,
  readConfig?: ProgressLedgerConfigReader,
): ProgressLedgerGate {
  const slice = readConfigSlice(readConfig);
  const envEnabled = envFlagOn(env[PROGRESS_LEDGER_ENABLED_ENV]);
  const configEnabled = slice.enabled === true;
  const shutdownEnv = envFlagOn(env[PROGRESS_LEDGER_SHUTDOWN_ENV]);
  const shutdownConfig = slice.shutdown === true;
  const shutdown = shutdownEnv || shutdownConfig;
  const enablementSources: Array<"env" | "config"> = [];
  if (envEnabled) {
    enablementSources.push("env");
  }
  if (configEnabled) {
    enablementSources.push("config");
  }
  const shutdownSources: Array<"shutdown_env" | "shutdown_config"> = [];
  if (shutdownEnv) {
    shutdownSources.push("shutdown_env");
  }
  if (shutdownConfig) {
    shutdownSources.push("shutdown_config");
  }
  const tenantAllowlist = [
    ...new Set([
      ...parseCsv(env[PROGRESS_LEDGER_TENANT_ALLOWLIST_ENV]),
      ...(slice.tenantAllowlist ?? []).map((item) => normalizeId(item)).filter(Boolean),
    ]),
  ];
  return {
    envEnabled,
    configEnabled,
    shutdownEnv,
    shutdownConfig,
    shutdown,
    processEnabled: !shutdown && (envEnabled || configEnabled),
    tenantAllowlist,
    scoped: tenantAllowlist.length > 0,
    enablementSources,
    shutdownSources,
  };
}

/**
 * Process-global switch after shutdown. Does not encode tenant admission.
 * A true result on a shared instance with an empty allowlist is not a
 * single-tenant canary.
 */
export function isProgressLedgerEnabled(
  env: NodeJS.ProcessEnv = process.env,
  readConfig?: ProgressLedgerConfigReader,
): boolean {
  return resolveProgressLedgerGate(env, readConfig).processEnabled;
}

export function isProgressLedgerShutdown(
  env: NodeJS.ProcessEnv = process.env,
  readConfig?: ProgressLedgerConfigReader,
): boolean {
  return resolveProgressLedgerGate(env, readConfig).shutdown;
}

/**
 * Tenant admission. Empty allowlist admits every tenant (including a
 * missing tenant id). A non-empty allowlist fail-closes when tenantId
 * is missing or not listed.
 */
export function isProgressLedgerTenantAdmitted(
  tenantId: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
  readConfig?: ProgressLedgerConfigReader,
): boolean {
  const gate = resolveProgressLedgerGate(env, readConfig);
  if (!gate.scoped) {
    return true;
  }
  const normalized = normalizeId(tenantId);
  return Boolean(normalized) && gate.tenantAllowlist.includes(normalized);
}

/**
 * Process-global projections (cron attach, admin list, workbench gates).
 * Requires the process switch and tenant admission. Shutdown wins.
 */
export function isProgressLedgerProjected(params: {
  tenantId?: string | null;
  env?: NodeJS.ProcessEnv;
  readConfig?: ProgressLedgerConfigReader;
}): boolean {
  const env = params.env ?? process.env;
  const gate = resolveProgressLedgerGate(env, params.readConfig);
  return (
    gate.processEnabled && isProgressLedgerTenantAdmitted(params.tenantId, env, params.readConfig)
  );
}

/**
 * Honest canary-scope label. A shared instance may only be called a
 * single-tenant canary when the process is on, shutdown is off, and a
 * non-empty allowlist is set.
 */
export function describeProgressLedgerCanaryScope(
  env: NodeJS.ProcessEnv = process.env,
  readConfig?: ProgressLedgerConfigReader,
): "off" | "shutdown" | "process_wide" | "tenant_allowlist" {
  const gate = resolveProgressLedgerGate(env, readConfig);
  if (gate.shutdown) {
    return "shutdown";
  }
  if (!gate.processEnabled) {
    return "off";
  }
  return gate.scoped ? "tenant_allowlist" : "process_wide";
}
