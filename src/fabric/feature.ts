/**
 * feature.ts — Fabric feature gate (R13.1, D1).
 *
 * Fabric is OFF by default. When off, the public methods are inert (the service
 * resolver returns null → handlers report UNAVAILABLE) and nothing in the
 * existing tool-execution path changes — byte-for-byte (R13.1).
 *
 * The gate has TWO sources (either enables Fabric):
 *  1. the `OPENBOT_FABRIC_ENABLED` env flag (deployment-level), and
 *  2. the `gateway.fabric.enabled` config flag (platform-UI toggle).
 *
 * The config source is read LIVE via `loadConfig()` (runtime-snapshot + TTL
 * cached, so this is cheap), which lets the platform admin flip the toggle from
 * the UI (config.patch) and have it take effect for new requests without a
 * restart. An explicit injected provider (tests / real wiring) still takes
 * precedence over BOTH at the service-resolution layer.
 */

import { loadConfig } from "../config/config.js";

/** Env var that opts a deployment into the Fabric control plane. */
export const FABRIC_ENABLED_ENV = "OPENBOT_FABRIC_ENABLED";

function envEnabled(env: NodeJS.ProcessEnv): boolean {
  const raw = env[FABRIC_ENABLED_ENV]?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

/** Default config reader: live `gateway.fabric.enabled` (fail-safe false). */
function configEnabled(): boolean {
  try {
    return loadConfig().gateway?.fabric?.enabled === true;
  } catch {
    // Config not loadable (e.g. unit tests without a config) ⇒ fail-safe off.
    return false;
  }
}

/**
 * True when the deployment has enabled Fabric via env OR config.
 * `readConfig` is injectable so unit tests can exercise the gate without a
 * real config on disk.
 */
export function isFabricEnabled(
  env: NodeJS.ProcessEnv = process.env,
  readConfig: () => boolean = configEnabled,
): boolean {
  return envEnabled(env) || readConfig();
}
