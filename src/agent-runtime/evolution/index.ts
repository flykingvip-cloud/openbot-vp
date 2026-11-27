/**
 * Evolution gating — staged rollout guards for new vs. legacy execution paths.
 *
 * The simplest kill-switch implementation: reads boolean flags from the
 * `OPENBOT_EVOLUTION_<FLAG>` environment variable (or legacy `OPENCLAW_EVOLUTION_<FLAG>`),
 * falling back to a compile-time default map.
 *
 * Usage:
 *   if (isEvolutionEnabled("unified-lifecycle")) { ... }
 *
 * Adding a new flag:
 *   1. Add a row to `EVOLUTION_DEFAULTS` with its default value.
 *   2. Set `OPENBOT_EVOLUTION_<FLAG_UPPER_SNAKE>` to "0" or "1" in production env to override.
 */

/** Compile-time defaults for evolution flags. */
const EVOLUTION_DEFAULTS: Record<string, boolean> = {
  "unified-lifecycle": true,
};

/**
 * Returns whether the given evolution flag is currently enabled.
 *
 * Resolution order:
 *  1. `OPENBOT_EVOLUTION_<FLAG>` env var ("1" = enabled, "0" = disabled)
 *  2. `OPENCLAW_EVOLUTION_<FLAG>` env var (legacy compat)
 *  3. Compile-time default from `EVOLUTION_DEFAULTS`
 *  4. `false` if the flag is unknown
 */
export function isEvolutionEnabled(flag: string): boolean {
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
 * Returns the full set of known evolution flags and their current resolved values.
 * Useful for diagnostics and health-check endpoints.
 */
export function listEvolutionFlags(): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  for (const flag of Object.keys(EVOLUTION_DEFAULTS)) {
    result[flag] = isEvolutionEnabled(flag);
  }
  return result;
}
