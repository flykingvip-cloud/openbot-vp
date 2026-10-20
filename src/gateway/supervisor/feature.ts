/**
 * feature.ts — Development Supervisor feature gate (M1, R9.1 / Property 7).
 *
 * OFF by default. When off, the engine is a no-op and existing paths are
 * unchanged byte-for-byte. Two enable sources (either wins):
 *  1. `OPENBOT_SUPERVISOR_ENABLED` env flag
 *  2. `gateway.supervisor.enabled` config flag
 */

import { loadConfig } from "../../config/config.js";
import { DEFAULT_RUNNER_CONFIG, type SupervisorRunnerConfig } from "./runner.js";

export const SUPERVISOR_ENABLED_ENV = "OPENBOT_SUPERVISOR_ENABLED";
export const SUPERVISOR_RUNNER_ENABLED_ENV = "OPENBOT_SUPERVISOR_RUNNER_ENABLED";

function envEnabled(env: NodeJS.ProcessEnv): boolean {
  const raw = env[SUPERVISOR_ENABLED_ENV]?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function configEnabled(): boolean {
  try {
    return loadConfig().gateway?.supervisor?.enabled === true;
  } catch {
    return false;
  }
}

export function isSupervisorEnabled(
  env: NodeJS.ProcessEnv = process.env,
  readConfig: () => boolean = configEnabled,
): boolean {
  return envEnabled(env) || readConfig();
}

function runnerEnvEnabled(env: NodeJS.ProcessEnv): boolean {
  const raw = env[SUPERVISOR_RUNNER_ENABLED_ENV]?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function runnerConfigEnabled(): boolean {
  try {
    return loadConfig().gateway?.supervisor?.runner?.enabled === true;
  } catch {
    return false;
  }
}

export function isSupervisorRunnerEnabled(
  env: NodeJS.ProcessEnv = process.env,
  readRunnerConfig: () => boolean = runnerConfigEnabled,
): boolean {
  return isSupervisorEnabled(env) && (runnerEnvEnabled(env) || readRunnerConfig());
}

export function resolveSupervisorRunnerConfig(cfg = loadConfig()): SupervisorRunnerConfig {
  const runner = cfg.gateway?.supervisor?.runner;
  return {
    maxConcurrency:
      typeof runner?.maxConcurrency === "number" && runner.maxConcurrency > 0
        ? Math.floor(runner.maxConcurrency)
        : DEFAULT_RUNNER_CONFIG.maxConcurrency,
    leaseTtlMs:
      typeof runner?.leaseTtlMs === "number" && runner.leaseTtlMs > 0
        ? Math.floor(runner.leaseTtlMs)
        : DEFAULT_RUNNER_CONFIG.leaseTtlMs,
    tickIntervalMs:
      typeof runner?.tickIntervalMs === "number" && runner.tickIntervalMs > 0
        ? Math.floor(runner.tickIntervalMs)
        : DEFAULT_RUNNER_CONFIG.tickIntervalMs,
  };
}
