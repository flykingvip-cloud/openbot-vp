/**
 * Boot + runtime drain for TaskOutcome growth-evolution consumers.
 * Ensures pending outbox events are consumed without waiting for another user turn.
 */
import { listAgentIds } from "../agents/agent-scope.js";
import type { OpenBotConfig } from "../config/config.js";
import { drainPendingGrowthEvolution } from "./runtime-from-runner.js";

export type TaskOutcomeConsumerBootLog = {
  info?: (message: string) => void;
  warn?: (message: string) => void;
};

export type TaskOutcomeConsumerBootResult = {
  agentsScanned: number;
  processed: number;
  deferred: number;
  written: number;
};

const RUNTIME_DRAIN_INTERVAL_MS = 15_000;
let runtimeDrainTimer: ReturnType<typeof setInterval> | undefined;
let runtimeDrainCfg: OpenBotConfig | undefined;

export function drainAllAgentsPendingGrowth(cfg: OpenBotConfig): TaskOutcomeConsumerBootResult {
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
 * Gateway boot: drain once, then keep a lightweight runtime timer so failed
 * handler acks can retry without a subsequent user message.
 */
export function recoverTaskOutcomeConsumersAtGatewayBoot(params: {
  cfg: OpenBotConfig;
  log?: TaskOutcomeConsumerBootLog;
  /** When true, also start the independent runtime drain interval. */
  startRuntimeDrain?: boolean;
  intervalMs?: number;
}): TaskOutcomeConsumerBootResult {
  const result = drainAllAgentsPendingGrowth(params.cfg);
  params.log?.info?.(
    `task-outcome consumer boot: agents=${result.agentsScanned} processed=${result.processed} deferred=${result.deferred} written=${result.written}`,
  );
  if (params.startRuntimeDrain !== false) {
    startTaskOutcomeRuntimeDrain(params.cfg, {
      intervalMs: params.intervalMs,
      log: params.log,
    });
  }
  return result;
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
