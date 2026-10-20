/**
 * Production scheduler registration for evolution governance jobs.
 * Tick is driven by gateway maintenance; state survives in persistent job cursor.
 */

import { randomUUID } from "node:crypto";
import { runCapabilityGapConsumerTickSafely } from "../evolution-control/capability-gap-consumer.js";
import { runSoftObserveDhLoopTickSafely } from "../evolution-control/soft-observe-dh-loop.js";
import { isGovernanceKillSwitchActive, updateGovernanceJobCursor } from "./persistent-store.js";
import { runSkillAutoEvolutionPass } from "./skill-auto-evolution.js";
import { configureEffectVerifyMs, runEvolutionGovernancePipeline } from "./tick-pipeline.js";

export type EvolutionGovernanceSchedulerConfig = {
  enabled: boolean;
  intervalMs: number;
  /** Pause effect remeasure window (ms). Applied via configureEffectVerifyMs. */
  effectVerifyMs?: number;
};

type TickHandler = () => Promise<void> | void;

let config: EvolutionGovernanceSchedulerConfig = {
  enabled: true,
  intervalMs: 15 * 60 * 1000,
};
let timer: ReturnType<typeof setInterval> | null = null;
let running = false;
let tickHandler: TickHandler | null = null;

export function configureEvolutionGovernanceScheduler(
  patch: Partial<EvolutionGovernanceSchedulerConfig>,
): EvolutionGovernanceSchedulerConfig {
  config = { ...config, ...patch };
  if (patch.effectVerifyMs !== undefined) {
    configureEffectVerifyMs(typeof patch.effectVerifyMs === "number" ? patch.effectVerifyMs : null);
  }
  return { ...config };
}

export function getEvolutionGovernanceSchedulerConfig(): EvolutionGovernanceSchedulerConfig {
  return { ...config };
}

/**
 * Register the job body and start interval timer (no-op if already running).
 * Safe to call from gateway startup.
 */
export function startEvolutionGovernanceScheduler(handler: TickHandler): void {
  tickHandler = handler;
  if (timer || !config.enabled) {
    return;
  }
  timer = setInterval(() => {
    void runEvolutionGovernanceTick();
  }, config.intervalMs);
  // Unref so scheduler does not keep process alive in tests/CLI.
  if (typeof timer === "object" && timer && "unref" in timer) {
    (timer as { unref: () => void }).unref();
  }
}

export function stopEvolutionGovernanceScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

export async function runEvolutionGovernanceTick(): Promise<{
  ran: boolean;
  reason?: string;
  runId?: string;
}> {
  if (!config.enabled) {
    return { ran: false, reason: "disabled" };
  }
  if (isGovernanceKillSwitchActive()) {
    return { ran: false, reason: "kill-switch" };
  }
  if (running) {
    return { ran: false, reason: "already-running" };
  }
  if (!tickHandler) {
    return { ran: false, reason: "no-handler" };
  }
  running = true;
  const runId = randomUUID();
  try {
    await tickHandler();
    updateGovernanceJobCursor({
      lastAutoGovAt: new Date().toISOString(),
      lastRunId: runId,
    });
    return { ran: true, runId };
  } finally {
    running = false;
  }
}

/** Default tick: governance pipeline + optional skill auto-evolution pass. */
export async function defaultEvolutionGovernanceTick(): Promise<void> {
  runEvolutionGovernancePipeline();
  try {
    runSkillAutoEvolutionPass();
  } catch {
    // never break governance tick on skill auto errors
  }
  try {
    runCapabilityGapConsumerTickSafely();
  } catch {
    // never break governance tick on capability-gap consumer errors
  }
  try {
    await runSoftObserveDhLoopTickSafely();
  } catch {
    // never break governance tick on soft-observe DH loop errors
  }
  updateGovernanceJobCursor({
    lastAggregationAt: new Date().toISOString(),
  });
}
