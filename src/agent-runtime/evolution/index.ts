/**
 * Evolution flag helpers for optional future staged-rollout keys.
 *
 * `unified-lifecycle` is retired. `createUnifiedExecutionLifecycle` is the
 * only remaining execution lifecycle on trunk. Phase 4 retired the old
 * factories into throw-on-call tombstones; there is no legacy lifecycle to
 * fall back to. Setting `OPENBOT_EVOLUTION_UNIFIED_LIFECYCLE` or the legacy
 * `OPENCLAW_EVOLUTION_UNIFIED_LIFECYCLE` has no effect on runtime or on
 * these helpers. It is not a kill switch.
 *
 * Adding a new live flag:
 *   1. Add a row to `EVOLUTION_DEFAULTS` with its default value.
 *   2. Set `OPENBOT_EVOLUTION_<FLAG_UPPER_SNAKE>` to "0" or "1" to override.
 * Retired keys must be listed in `RETIRED_EVOLUTION_FLAGS` so env cannot
 * revive them as a switch.
 */

const RETIRED_EVOLUTION_FLAGS: ReadonlySet<string> = new Set(["unified-lifecycle"]);

/** Compile-time defaults for live evolution flags. Retired keys are not listed. */
const EVOLUTION_DEFAULTS: Record<string, boolean> = {};

/**
 * Returns whether the given evolution flag is currently enabled.
 *
 * Retired flags are not gates: `unified-lifecycle` always reports the
 * remaining trunk path as present, and its env overrides are ignored.
 *
 * Resolution order for live flags:
 *  1. `OPENBOT_EVOLUTION_<FLAG>` env var ("1" = enabled, "0" = disabled)
 *  2. `OPENCLAW_EVOLUTION_<FLAG>` env var (legacy compat)
 *  3. Compile-time default from `EVOLUTION_DEFAULTS`
 *  4. `false` if the flag is unknown
 */
export function isEvolutionEnabled(flag: string): boolean {
  if (RETIRED_EVOLUTION_FLAGS.has(flag)) {
    return true;
  }

  const envKey = `OPENBOT_EVOLUTION_${flag.replace(/-/g, "_").toUpperCase()}`;
  const legacyKey = `OPENCLAW_EVOLUTION_${flag.replace(/-/g, "_").toUpperCase()}`;

  const envValue = process.env[envKey] ?? process.env[legacyKey];
  if (envValue === "1") {
    return true;
  }
  if (envValue === "0") {
    return false;
  }

  return EVOLUTION_DEFAULTS[flag] ?? false;
}

/**
 * Returns the full set of known *live* evolution flags and their current
 * resolved values. Retired keys such as `unified-lifecycle` are omitted so
 * diagnostics cannot advertise them as a working kill switch.
 */
export function listEvolutionFlags(): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  for (const flag of Object.keys(EVOLUTION_DEFAULTS)) {
    result[flag] = isEvolutionEnabled(flag);
  }
  return result;
}
