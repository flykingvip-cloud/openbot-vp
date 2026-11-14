/**
 * Boot + runtime drain for TaskOutcome growth-evolution consumers, plus
 * awaiting-delivery memory hydrate so restart does not rely only on peek lazy-read.
 */
import fs from "node:fs";
import path from "node:path";
import { listAgentIds, resolveAgentDir } from "../agents/agent-scope.js";
import type { OpenBotConfig } from "../config/config.js";
import {
  hydrateAwaitingDeliveriesFromDisk,
  listStaleAwaitingDeliveries,
  peekAwaitingDelivery,
  registerAwaitingDelivery,
} from "./pending-delivery.js";
import { drainPendingGrowthEvolution, TASK_OUTCOME_STORE_DIRNAME } from "./runtime-from-runner.js";
import { DurableTaskOutcomeStore } from "./store.js";

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
 * Reconstruct awaiting-delivery identity from persisted pending outcomes when
 * the process crashed after result commit and before registerAwaitingDelivery.
 * Does not invent checkedTask or a delivered receipt.
 */
export function rehydrateAwaitingDeliveriesFromPendingOutcomes(params: {
  persistRoot: string;
  agentId: string;
}): number {
  const persistRoot = params.persistRoot.trim();
  const agentId = params.agentId.trim();
  if (!persistRoot || !agentId || !fs.existsSync(persistRoot)) {
    return 0;
  }
  const tipsDir = path.join(persistRoot, "tips");
  if (!fs.existsSync(tipsDir)) {
    return 0;
  }
  const store = new DurableTaskOutcomeStore(persistRoot);
  let n = 0;
  for (const taskId of store.listTaskIds()) {
    const record = store.loadTask(taskId);
    if (!record || record.delivery.status !== "pending") {
      continue;
    }
    const deliveryId = record.deliveryId?.trim();
    const runId = record.decisiveRunId?.trim();
    if (!deliveryId || !runId) {
      continue;
    }
    if (peekAwaitingDelivery({ runId, deliveryId, taskId: record.taskId, persistRoot })) {
      continue;
    }
    registerAwaitingDelivery({
      taskId: record.taskId,
      deliveryId,
      agentId,
      runId,
      persistRoot,
    });
    n += 1;
  }
  return n;
}

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
      hydrated += rehydrateAwaitingDeliveriesFromPendingOutcomes({ persistRoot, agentId });
    } catch {
      // never block boot on one bad agent store
    }
  }
  return { agentsScanned: agents.length, hydrated };
}

export async function drainAllAgentsPendingGrowth(
  cfg: OpenBotConfig,
): Promise<Omit<TaskOutcomeConsumerBootResult, "hydrated">> {
  let processed = 0;
  let deferred = 0;
  let written = 0;
  const agents = listAgentIds(cfg);
  for (const agentId of agents) {
    try {
      const out = await drainPendingGrowthEvolution(cfg, agentId);
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
export async function recoverTaskOutcomeConsumersAtGatewayBoot(params: {
  cfg: OpenBotConfig;
  log?: TaskOutcomeConsumerBootLog;
  /** When true, also start the independent runtime drain interval. */
  startRuntimeDrain?: boolean;
  intervalMs?: number;
}): Promise<TaskOutcomeConsumerBootResult> {
  const hydrate = hydrateAllAgentsAwaitingDeliveries(params.cfg);
  params.log?.info?.(
    `task-outcome awaiting-delivery hydrate: agents=${hydrate.agentsScanned} hydrated=${hydrate.hydrated}`,
  );
  const stale = listStaleAwaitingDeliveries();
  if (stale.length > 0) {
    params.log?.warn?.(
      `task-outcome awaiting-delivery still pending: count=${stale.length} oldestTaskId=${stale[0]?.taskId ?? ""}`,
    );
  }

  const drain = await drainAllAgentsPendingGrowth(params.cfg);
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
    void drainAllAgentsPendingGrowth(active)
      .then((out) => {
        if (out.processed > 0 || out.deferred > 0) {
          opts?.log?.info?.(
            `task-outcome runtime drain: processed=${out.processed} deferred=${out.deferred}`,
          );
        }
        hydrateAllAgentsAwaitingDeliveries(active);
        const stale = listStaleAwaitingDeliveries();
        if (stale.length > 0) {
          opts?.log?.warn?.(`task-outcome awaiting-delivery still pending: count=${stale.length}`);
        }
      })
      .catch((err) => {
        opts?.log?.warn?.(
          `task-outcome runtime drain failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
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
