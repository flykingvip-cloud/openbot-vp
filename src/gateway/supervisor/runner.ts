/**
 * supervisor/runner.ts — bounded-concurrency task queue with leases (M4.3).
 *
 * Replaces the naive cron sweep when runner mode is enabled: active tasks are
 * dequeued, claimed with a TTL lease, and driven by a worker pool capped at
 * `maxConcurrency`. Leases prevent duplicate ticks across overlapping sweeps.
 */

import crypto from "node:crypto";
import { tickSupervisedTask } from "./driver.js";
import type { SuperviseTickOptions } from "./engine.js";
import type { SupervisorPorts } from "./engine.js";
import { isInFlightTaskState } from "./engine.js";
import { isSupervisorEnabled } from "./feature.js";
import { hasSupervisorRun } from "./run-registry.js";
import { listActiveTasks } from "./store.js";
import type { SupervisedTask } from "./types.js";

export type SupervisorLease = {
  taskId: string;
  ownerId: string;
  acquiredAtMs: number;
  expiresAtMs: number;
};

export type SupervisorRunnerConfig = {
  maxConcurrency: number;
  leaseTtlMs: number;
  tickIntervalMs: number;
};

export type SupervisorRunnerStatus = {
  enabled: boolean;
  ownerId: string;
  maxConcurrency: number;
  activeTicks: number;
  activeLeases: number;
  queuedCandidates: number;
  lastSweepAtMs: number | null;
  lastSweepDriven: number;
};

export const DEFAULT_RUNNER_CONFIG: SupervisorRunnerConfig = {
  maxConcurrency: 4,
  leaseTtlMs: 120_000,
  tickIntervalMs: 15_000,
};

const leases = new Map<string, SupervisorLease>();
let runnerOwnerId = `runner-${crypto.randomUUID()}`;
let activeTicks = 0;
let lastSweepAtMs: number | null = null;
let lastSweepDriven = 0;

export function resetSupervisorRunnerStateForTests(): void {
  leases.clear();
  runnerOwnerId = `runner-${crypto.randomUUID()}`;
  activeTicks = 0;
  lastSweepAtMs = null;
  lastSweepDriven = 0;
}

export function getSupervisorRunnerOwnerId(): string {
  return runnerOwnerId;
}

export function pruneExpiredSupervisorLeases(nowMs = Date.now()): number {
  let pruned = 0;
  for (const [taskId, lease] of leases) {
    if (lease.expiresAtMs <= nowMs) {
      leases.delete(taskId);
      pruned += 1;
    }
  }
  return pruned;
}

export function tryAcquireSupervisorLease(
  taskId: string,
  ownerId: string,
  leaseTtlMs: number,
  nowMs = Date.now(),
): boolean {
  const id = taskId.trim();
  if (!id) {
    return false;
  }
  const existing = leases.get(id);
  if (existing && existing.expiresAtMs > nowMs && existing.ownerId !== ownerId) {
    return false;
  }
  leases.set(id, {
    taskId: id,
    ownerId,
    acquiredAtMs: nowMs,
    expiresAtMs: nowMs + Math.max(5_000, leaseTtlMs),
  });
  return true;
}

export function releaseSupervisorLease(taskId: string, ownerId: string): void {
  const id = taskId.trim();
  const existing = leases.get(id);
  if (existing?.ownerId === ownerId) {
    leases.delete(id);
  }
}

export function listSupervisorLeases(): SupervisorLease[] {
  return [...leases.values()];
}

function shouldSkipTask(task: SupervisedTask): boolean {
  if (isInFlightTaskState(task.state) && hasSupervisorRun(task.taskId)) {
    return true;
  }
  return false;
}

export async function runSupervisorQueueSweep(
  ports: SupervisorPorts,
  opts?: SuperviseTickOptions & {
    storeDir?: string;
    config?: SupervisorRunnerConfig;
    ownerId?: string;
  },
): Promise<number> {
  if (!isSupervisorEnabled(opts?.env, opts?.readConfig)) {
    return 0;
  }
  const config = opts?.config ?? DEFAULT_RUNNER_CONFIG;
  const ownerId = opts?.ownerId ?? runnerOwnerId;
  pruneExpiredSupervisorLeases();
  lastSweepAtMs = Date.now();

  const active = await listActiveTasks(opts?.storeDir);
  const candidates = active
    .filter((task) => !shouldSkipTask(task))
    .toSorted((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt));

  let driven = 0;
  const slots = Math.max(0, config.maxConcurrency - activeTicks);

  for (const task of candidates) {
    if (driven >= slots) {
      break;
    }
    if (!tryAcquireSupervisorLease(task.taskId, ownerId, config.leaseTtlMs)) {
      continue;
    }
    driven += 1;
    activeTicks += 1;
    void tickSupervisedTask(task.taskId, ports, opts)
      .catch(() => undefined)
      .finally(() => {
        activeTicks = Math.max(0, activeTicks - 1);
        releaseSupervisorLease(task.taskId, ownerId);
      });
  }

  lastSweepDriven = driven;
  return driven;
}

export function getSupervisorRunnerStatus(
  config: SupervisorRunnerConfig = DEFAULT_RUNNER_CONFIG,
  enabled = true,
): SupervisorRunnerStatus {
  pruneExpiredSupervisorLeases();
  return {
    enabled,
    ownerId: runnerOwnerId,
    maxConcurrency: config.maxConcurrency,
    activeTicks,
    activeLeases: leases.size,
    queuedCandidates: 0,
    lastSweepAtMs,
    lastSweepDriven,
  };
}

export function startSupervisorRunner(params: {
  ports: SupervisorPorts;
  storeDir?: string;
  config?: Partial<SupervisorRunnerConfig>;
  tickOptions?: SuperviseTickOptions;
}): { stop: () => void } {
  const config: SupervisorRunnerConfig = {
    ...DEFAULT_RUNNER_CONFIG,
    ...params.config,
  };
  const sweep = () => {
    void runSupervisorQueueSweep(params.ports, {
      ...params.tickOptions,
      storeDir: params.storeDir,
      config,
      ownerId: runnerOwnerId,
    });
  };
  if (!isSupervisorEnabled(params.tickOptions?.env, params.tickOptions?.readConfig)) {
    return { stop: () => undefined };
  }
  const handle = setInterval(sweep, config.tickIntervalMs);
  return {
    stop: () => {
      clearInterval(handle);
      for (const lease of leases.values()) {
        if (lease.ownerId === runnerOwnerId) {
          leases.delete(lease.taskId);
        }
      }
    },
  };
}
