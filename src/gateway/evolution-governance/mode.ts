/**
 * Evolution governance operating mode.
 *
 * - off:    no detection, no actions
 * - assist: detect + anomalies/pending only — **does not mutate runtime** (default)
 * - auto:   may auto limit/pause/redirect/recover per policy.
 *   Auto is not a blanket mutation grant for the evolution control plane;
 *   each apply still needs an explicit Surface operation.
 *
 * Env: OPENBOT_EVOLUTION_GOVERNANCE_MODE=off|assist|auto
 * Skill auto-evolution is separate: OPENBOT_SKILL_AUTO_EVOLUTION=on|off
 */

export type EvolutionGovernanceMode = "off" | "assist" | "auto";

const DEFAULT_MODE: EvolutionGovernanceMode = "assist";

let modeOverride: EvolutionGovernanceMode | null = null;

export function setEvolutionGovernanceModeForTests(mode: EvolutionGovernanceMode | null): void {
  modeOverride = mode;
}

export function getEvolutionGovernanceMode(): EvolutionGovernanceMode {
  if (modeOverride) {
    return modeOverride;
  }
  const raw = (process.env.OPENBOT_EVOLUTION_GOVERNANCE_MODE ?? "").trim().toLowerCase();
  if (raw === "off" || raw === "assist" || raw === "auto") {
    return raw;
  }
  return DEFAULT_MODE;
}

/** Auto recovery (resume / clear_limit after verify window) only in auto mode. */
export function isEvolutionAutoRecoveryEnabled(): boolean {
  return getEvolutionGovernanceMode() === "auto";
}

/** Whether the tick may mutate runtime (limit/pause/redirect). Assist = false. */
export function isEvolutionAutoRuntimeMutationEnabled(): boolean {
  return getEvolutionGovernanceMode() === "auto";
}

/** Whether the tick pipeline should run at all. */
export function isEvolutionGovernancePipelineEnabled(): boolean {
  return getEvolutionGovernanceMode() !== "off";
}
