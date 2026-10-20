/**
 * Account Worker dual-flag parsing (P6b).
 *
 * Production default (unset / empty): **ON**.
 * Explicit rollback: `0` | `false` | `no` | `off`.
 * Explicit on: `1` | `true` | `yes` | `on`.
 * Unrecognized tokens stay off (safe).
 *
 * Product enablement still requires managed_enterprise + shared tenant
 * addressing via `isAccountWorkerPrototypeEnabled`. personal_local is never
 * forced onto the worker path.
 */

const TRUTHY = new Set(["1", "true", "yes", "on"]);
const FALSY = new Set(["0", "false", "no", "off"]);

/**
 * P6b dual-flag helper: unset defaults ON; explicit falsy is rollback OFF.
 */
export function isAccountWorkerEnvFlagOn(raw: string | undefined): boolean {
  const token = raw?.trim().toLowerCase() ?? "";
  if (!token) {
    return true;
  }
  if (FALSY.has(token)) {
    return false;
  }
  return TRUTHY.has(token);
}

export function isAccountWorkerEnvFlagExplicitlyOff(raw: string | undefined): boolean {
  const token = raw?.trim().toLowerCase() ?? "";
  return FALSY.has(token);
}
