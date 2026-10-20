/**
 * S4 — Reliable background scheduler for group-task-heartbeat ticks.
 *
 * Inventory-first: does **not** invent a second orchestrator. Arms a timer that
 * periodically calls `runGroupTaskHeartbeat` for allowlisted groups. Default
 * `schedulerEnabled=false` (timer dormant). Default write mode is observe
 * (plan + persist; no wake). Real nudge/escalate only when Wake Contract +
 * emit authorization (see resolveGroupTaskHeartbeatWriteMode).
 *
 * Scheduling reliability:
 * - Restart recovery: per-group lastScanAt lives on disk; new process respects it.
 * - Dedup: overlapping ticks are skipped (in-flight lock).
 * - Scan interval: per-group gate inside runGroupTaskHeartbeat.
 * - Exception retry: failures increment consecutiveFailures; next interval retries.
 *
 * No LIVE / Floor flips. No production gray writes by default.
 */
import { loadConfig } from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import {
  parseGrayGroupAllowlistEntry,
  type GrayGroupAllowlistEntry,
} from "./gray-group-allowlist.js";
import {
  resolveGroupTaskHeartbeatEmitGroupAllowlist,
  resolveGroupTaskHeartbeatScanIntervalMs,
  resolveGroupTaskHeartbeatSchedulerEnabled,
  resolveGroupTaskHeartbeatWriteMode,
  runGroupTaskHeartbeat,
  type GroupTaskHeartbeatOptions,
  type GroupTaskHeartbeatResult,
} from "./group-task-heartbeat.js";
import type { RuntimeAuthority } from "./runtime-authority.js";
import { resolveWakeContractGroupAllowlist } from "./wake-contract.js";

const log = createSubsystemLogger("gateway/group-task-heartbeat-scheduler");

export type GroupTaskHeartbeatSchedulerTarget = {
  groupId: string;
  tenantId: string | null;
};

export type GroupTaskHeartbeatSchedulerStatus = {
  schedulerEnabled: boolean;
  timerArmed: boolean;
  inFlight: boolean;
  lastTickAt: number | null;
  lastTickOk: boolean | null;
  consecutiveFailures: number;
  lastError: string | null;
  tickCount: number;
  dedupSkipCount: number;
  lastTargets: readonly GroupTaskHeartbeatSchedulerTarget[];
};

export type GroupTaskHeartbeatSchedulerTickResult = {
  at: number;
  dedupSkipped: boolean;
  schedulerEnabled: boolean;
  targets: GroupTaskHeartbeatSchedulerTarget[];
  results: Array<{
    groupId: string;
    tenantId: string | null;
    writeMode: "observe" | "emit";
    result: GroupTaskHeartbeatResult;
  }>;
  error?: string;
};

export type GroupTaskHeartbeatScheduler = {
  stop: () => void;
  updateConfig: (cfg: OpenBotConfig) => void;
  /** Run one scheduler tick immediately (tests / ops). */
  runTickNow: (opts?: {
    force?: boolean;
    nowMs?: number;
  }) => Promise<GroupTaskHeartbeatSchedulerTickResult>;
  isRunning: () => boolean;
  getStatus: () => GroupTaskHeartbeatSchedulerStatus;
};

export type StartGroupTaskHeartbeatSchedulerOpts = {
  cfg?: OpenBotConfig;
  nowMs?: () => number;
  /**
   * Injected runner for tests. Default builds authority externally via
   * `runGroup` below — production passes a callback that uses
   * runCollaborationGroupTaskHeartbeat.
   */
  runGroup?: (
    target: GroupTaskHeartbeatSchedulerTarget,
    options: GroupTaskHeartbeatOptions & { dryRun: boolean },
  ) => Promise<GroupTaskHeartbeatResult>;
  listTargets?: (cfg: OpenBotConfig) => GroupTaskHeartbeatSchedulerTarget[];
  /** Override poll interval (defaults to scanIntervalMs, min 1s in tests). */
  pollIntervalMs?: number;
};

function uniqueTargets(
  entries: readonly GrayGroupAllowlistEntry[],
): GroupTaskHeartbeatSchedulerTarget[] {
  const seen = new Set<string>();
  const out: GroupTaskHeartbeatSchedulerTarget[] = [];
  for (const entry of entries) {
    const tenantId = entry.kind === "scoped" ? entry.tenantId : null;
    const key = `${tenantId ?? ""}/${entry.groupId}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push({ groupId: entry.groupId, tenantId });
  }
  return out;
}

/**
 * Discover groups to scan: union of wake allowlist + emit allowlist.
 * Empty → scheduler ticks with zero work (proves timer without gray writes).
 */
export function listGroupTaskHeartbeatSchedulerTargets(
  cfg?: OpenBotConfig,
): GroupTaskHeartbeatSchedulerTarget[] {
  const resolved = cfg ?? loadConfig();
  const raw = [
    ...resolveWakeContractGroupAllowlist(resolved),
    ...resolveGroupTaskHeartbeatEmitGroupAllowlist(resolved),
  ];
  const parsed: GrayGroupAllowlistEntry[] = [];
  for (const entry of raw) {
    const p = parseGrayGroupAllowlistEntry(entry);
    if (p) {
      parsed.push(p);
    }
  }
  return uniqueTargets(parsed);
}

/**
 * Start the S4 group-task-heartbeat scheduler.
 * When `schedulerEnabled` is false (default), the handle exists but the timer
 * stays dormant until updateConfig enables it (or runTickNow is called with
 * an enabled cfg).
 */
export function startGroupTaskHeartbeatScheduler(
  opts: StartGroupTaskHeartbeatSchedulerOpts = {},
): GroupTaskHeartbeatScheduler {
  const nowFn = opts.nowMs ?? Date.now;
  let cfg =
    opts.cfg ??
    (() => {
      try {
        return loadConfig();
      } catch {
        return {} as OpenBotConfig;
      }
    })();

  const listTargets = opts.listTargets ?? listGroupTaskHeartbeatSchedulerTargets;
  const runGroup =
    opts.runGroup ??
    (async () => {
      throw new Error(
        "group-task-heartbeat-scheduler: runGroup not wired; pass runGroup or use gateway bootstrap",
      );
    });

  let timer: NodeJS.Timeout | null = null;
  let stopped = false;
  let inFlight = false;
  let lastTickAt: number | null = null;
  let lastTickOk: boolean | null = null;
  let consecutiveFailures = 0;
  let lastError: string | null = null;
  let tickCount = 0;
  let dedupSkipCount = 0;
  let lastTargets: GroupTaskHeartbeatSchedulerTarget[] = [];

  const clearTimer = () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  };

  const armTimer = () => {
    clearTimer();
    if (stopped) {
      return;
    }
    if (!resolveGroupTaskHeartbeatSchedulerEnabled(cfg)) {
      return;
    }
    const interval = Math.max(
      1_000,
      opts.pollIntervalMs ?? resolveGroupTaskHeartbeatScanIntervalMs(cfg),
    );
    timer = setInterval(() => {
      void runTick({ force: false }).catch((err) => {
        log.error(`group-task-heartbeat tick failed: ${String(err)}`);
      });
    }, interval);
    timer.unref?.();
  };

  const runTick = async (tickOpts?: {
    force?: boolean;
    nowMs?: number;
  }): Promise<GroupTaskHeartbeatSchedulerTickResult> => {
    const at = tickOpts?.nowMs ?? nowFn();
    // Re-read config each tick so policy changes apply without long-lived auth.
    try {
      cfg = opts.cfg ?? loadConfig();
    } catch {
      // keep prior cfg
    }

    const enabled = resolveGroupTaskHeartbeatSchedulerEnabled(cfg);
    if (!enabled) {
      return {
        at,
        dedupSkipped: false,
        schedulerEnabled: false,
        targets: [],
        results: [],
      };
    }

    if (inFlight) {
      dedupSkipCount += 1;
      return {
        at,
        dedupSkipped: true,
        schedulerEnabled: true,
        targets: lastTargets,
        results: [],
      };
    }

    inFlight = true;
    const targets = listTargets(cfg);
    lastTargets = targets;
    const results: GroupTaskHeartbeatSchedulerTickResult["results"] = [];

    try {
      for (const target of targets) {
        const writeMode = resolveGroupTaskHeartbeatWriteMode(cfg, target.groupId, target.tenantId);
        const dryRun = writeMode === "observe";
        const result = await runGroup(target, {
          cfg,
          dryRun,
          force: tickOpts?.force,
          nowMs: at,
          tenantId: target.tenantId,
        });
        results.push({
          groupId: target.groupId,
          tenantId: target.tenantId,
          writeMode,
          result,
        });
      }
      lastTickAt = at;
      lastTickOk = true;
      consecutiveFailures = 0;
      lastError = null;
      tickCount += 1;
      return {
        at,
        dedupSkipped: false,
        schedulerEnabled: true,
        targets,
        results,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lastTickAt = at;
      lastTickOk = false;
      consecutiveFailures += 1;
      lastError = message;
      tickCount += 1;
      log.error(`group-task-heartbeat scheduler tick error: ${message}`);
      return {
        at,
        dedupSkipped: false,
        schedulerEnabled: true,
        targets,
        results,
        error: message,
      };
    } finally {
      inFlight = false;
    }
  };

  armTimer();

  return {
    stop: () => {
      stopped = true;
      clearTimer();
    },
    updateConfig: (nextCfg: OpenBotConfig) => {
      if (stopped) {
        return;
      }
      cfg = nextCfg;
      armTimer();
    },
    runTickNow: (tickOpts) => runTick(tickOpts),
    isRunning: () => !stopped && timer !== null,
    getStatus: () => ({
      schedulerEnabled: resolveGroupTaskHeartbeatSchedulerEnabled(cfg),
      timerArmed: timer !== null,
      inFlight,
      lastTickAt,
      lastTickOk,
      consecutiveFailures,
      lastError,
      tickCount,
      dedupSkipCount,
      lastTargets: [...lastTargets],
    }),
  };
}

/**
 * Production helper: run one group tick by building authority via injected
 * factory (keeps scheduler free of collaboration-learning import cycles).
 */
export async function runGroupTaskHeartbeatWithAuthority(
  authority: RuntimeAuthority,
  target: GroupTaskHeartbeatSchedulerTarget,
  options: GroupTaskHeartbeatOptions & { dryRun: boolean },
): Promise<GroupTaskHeartbeatResult> {
  return runGroupTaskHeartbeat(
    authority,
    { groupId: target.groupId },
    {
      ...options,
      tenantId: options.tenantId ?? target.tenantId,
    },
  );
}
