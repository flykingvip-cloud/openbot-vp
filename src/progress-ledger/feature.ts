/**
 * Progress Ledger feature gate. OFF by default.
 *
 * Either source enables:
 *  1. `OPENBOT_PROGRESS_LEDGER_ENABLED`
 *  2. `gateway.progressLedger.enabled`
 *
 * When off, callers must not build a ledger or project progress.
 * Long-horizon cron does not use this gate. createCronLedgerSession binds
 * those jobs even when both sources are unset. Do not flip this default.
 */

import { loadConfig } from "../config/config.js";

export const PROGRESS_LEDGER_ENABLED_ENV = "OPENBOT_PROGRESS_LEDGER_ENABLED";

function envEnabled(env: NodeJS.ProcessEnv): boolean {
  const raw = env[PROGRESS_LEDGER_ENABLED_ENV]?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function configEnabled(): boolean {
  try {
    return loadConfig().gateway?.progressLedger?.enabled === true;
  } catch {
    return false;
  }
}

export function isProgressLedgerEnabled(
  env: NodeJS.ProcessEnv = process.env,
  readConfig: () => boolean = configEnabled,
): boolean {
  return envEnabled(env) || readConfig();
}
