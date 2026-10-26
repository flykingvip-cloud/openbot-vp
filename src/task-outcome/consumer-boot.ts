/**
 * Boot + runtime drain for TaskOutcome growth-evolution consumers, plus
 * awaiting-delivery memory hydrate so restart does not rely only on peek lazy-read.
 */
import path from "node:path";
import { listAgentIds, resolveAgentDir } from "../agents/agent-scope.js";
import type { OpenBotConfig } from "../config/config.js";
import { hydrateAwaitingDeliveriesFromDisk } from "./pending-delivery.js";
import { drainPendingGrowthEvolution, TASK_OUTCOME_STORE_DIRNAME } from "./runtime-from-runner.js";

export type TaskOutcomeConsumerBootLog = {
  info?: (message: string) => void;
  warn?: (message: string) => void;
};

export type TaskOutcomeConsumerBootResult = {
  agentsScanned: number;
  /** Durable awaiting-delivery rows loaded into memory at boot. */
  hydrated: number;
  processed: number;
  deferred: number;
  written: number;
};

const RUNTIME_DRAIN_INTERVAL_MS = 15_000;
let runtimeDrainTimer: ReturnType<typeof setInterval> | undefined;
let runtimeDrainCfg: OpenBotConfig | undefined;

/**
 * Preload awaiting-delivery registrations from each agent TaskOutcome store.
 * One bad agent root must never block boot.
 */
export function hydrateAllAgentsAwaitingDeliveries(cfg: OpenBotConfig): {
  agentsScanned: number;
  hydrated: number;
} {
  let hydrated = 0;
  const agents = listAgentIds(cfg);
  for (const agentId of agents) {
    try {
      const persistRoot = path.join(resolveAgentDir(cfg, agentId), TASK_OUTCOME_STORE_DIRNAME);
      hydrated += hydrateAwaitingDeliveriesFromDisk(persistRoot);
    } catch {
      // never block boot on one bad agent store
    }
  }
  return { agentsScanned: agents.length, hydrated };
}

export function drainAllAgentsPendingGrowth(
  cfg: OpenBotConfig,
): Omit<TaskOutcomeConsumerBootResult, "hydrated"> {
  let processed = 0;
  let deferred = 0;
  let written = 0;
  const agents = listAgentIds(cfg);
  for (const agentId of agents) {
    try {
      const out = drainPendingGrowthEvolution(cfg, agentId);
      processed += out.processed;
      deferred += out.deferred;
      if (out.written) {
        written += 1;
      }
    } catch {
      // never block boot / timer on one bad agent store
    }
  }
  return { agentsScanned: agents.length, processed, deferred, written };
}

/**
 * Gateway boot: hydrate awaiting deliveries from disk, drain growth consumers
 * once, then keep a lightweight runtime timer so failed handler acks can retry
 * without a subsequent user message.
 */
export function recoverTaskOutcomeConsumersAtGatewayBoot(params: {
  cfg: OpenBotConfig;
  log?: TaskOutcomeConsumerBootLog;
  /** When true, also start the independent runtime drain interval. */
  startRuntimeDrain?: boolean;
  intervalMs?: number;
}): TaskOutcomeConsumerBootResult {
  const hydrate = hydrateAllAgentsAwaitingDeliveries(params.cfg);
  params.log?.info?.(
    `task-outcome awaiting-delivery hydrate: agents=${hydrate.agentsScanned} hydrated=${hydrate.hydrated}`,
  );

  const drain = drainAllAgentsPendingGrowth(params.cfg);
  params.log?.info?.(
    `task-outcome consumer boot: agents=${drain.agentsScanned} processed=${drain.processed} deferred=${drain.deferred} written=${drain.written}`,
  );
  if (params.startRuntimeDrain !== false) {
    startTaskOutcomeRuntimeDrain(params.cfg, {
      intervalMs: params.intervalMs,
      log: params.log,
    });
  }
  return {
    agentsScanned: Math.max(hydrate.agentsScanned, drain.agentsScanned),
    hydrated: hydrate.hydrated,
    processed: drain.processed,
    deferred: drain.deferred,
    written: drain.written,
  };
}

export function startTaskOutcomeRuntimeDrain(
  cfg: OpenBotConfig,
  opts?: { intervalMs?: number; log?: TaskOutcomeConsumerBootLog },
): void {
  runtimeDrainCfg = cfg;
  if (runtimeDrainTimer) {
    return;
  }
  const intervalMs = opts?.intervalMs ?? RUNTIME_DRAIN_INTERVAL_MS;
  runtimeDrainTimer = setInterval(() => {
    const active = runtimeDrainCfg;
    if (!active) {
      return;
    }
    try {
      const out = drainAllAgentsPendingGrowth(active);
      if (out.processed > 0 || out.deferred > 0) {
        opts?.log?.info?.(
          `task-outcome runtime drain: processed=${out.processed} deferred=${out.deferred}`,
        );
      }
    } catch (err) {
      opts?.log?.warn?.(
        `task-outcome runtime drain failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }, intervalMs);
  // Allow process to exit in tests without lingering handles when unref is available.
  if (typeof runtimeDrainTimer === "object" && runtimeDrainTimer && "unref" in runtimeDrainTimer) {
    runtimeDrainTimer.unref();
  }
}

/** Test helper */
export function stopTaskOutcomeRuntimeDrainForTests(): void {
  if (runtimeDrainTimer) {
    clearInterval(runtimeDrainTimer);
    runtimeDrainTimer = undefined;
  }
  runtimeDrainCfg = undefined;
}
