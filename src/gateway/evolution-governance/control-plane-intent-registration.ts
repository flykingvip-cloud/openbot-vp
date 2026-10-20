import type { ConsumptionIntent, ControlPlaneConsumptionBinding } from "@openbot/evolution-core";
import type { EvolutionGovernanceMode } from "./mode.js";

export type ControlPlaneIntentRegistrationInput = {
  commandId: string;
  intent: ConsumptionIntent;
  mode: EvolutionGovernanceMode;
  killSwitch: boolean;
  recordedAt: string;
};

export type ControlPlaneIntentRegistrar = (
  input: ControlPlaneIntentRegistrationInput,
) => ControlPlaneConsumptionBinding | null;

let registrar: ControlPlaneIntentRegistrar | undefined;

export function setControlPlaneIntentRegistrar(next?: ControlPlaneIntentRegistrar): void {
  registrar = next;
}

/** Missing composition-root wiring preserves orphan evidence fail-closed. */
export function registerControlPlaneIntent(
  input: ControlPlaneIntentRegistrationInput,
): ControlPlaneConsumptionBinding | null {
  try {
    return registrar?.(input) ?? null;
  } catch {
    return null;
  }
}
