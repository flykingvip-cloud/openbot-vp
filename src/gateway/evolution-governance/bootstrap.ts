import {
  defaultEvolutionGovernanceTick,
  startEvolutionGovernanceScheduler,
  stopEvolutionGovernanceScheduler,
} from "./scheduler.js";

let started = false;

/** Idempotent production registration for the evolution governance interval job. */
export function ensureEvolutionGovernanceSchedulerStarted(): void {
  if (started) {
    return;
  }
  started = true;
  startEvolutionGovernanceScheduler(async () => {
    await defaultEvolutionGovernanceTick();
  });
}

export function stopEvolutionGovernanceSchedulerForShutdown(): void {
  stopEvolutionGovernanceScheduler();
  started = false;
}
