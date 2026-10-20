/**
 * supervisor/budget.ts — D-BUDGET resolution + spend accumulation (M2, Task 2.2).
 */

import type { OpenBotConfig } from "../../config/config.js";
import type { SupervisedTask, SupervisorBudget } from "./types.js";
import { DEFAULT_SUPERVISOR_BUDGET, resolveEffectiveBudget } from "./types.js";

/** Rough USD estimate from worker token usage (M2; refined when billing hooks land). */
const USD_PER_1K_TOKENS = 0.01;

export function estimateWorkerCostUsd(usage?: { input?: number; output?: number }): number {
  const tokens = (usage?.input ?? 0) + (usage?.output ?? 0);
  if (tokens <= 0) {
    return 0;
  }
  return (tokens / 1000) * USD_PER_1K_TOKENS;
}

/** Tenant ceiling from config (falls back to system default). */
export function resolveTenantSupervisorBudget(
  cfg?: OpenBotConfig,
  _tenantId?: string,
): SupervisorBudget {
  const fromCfg = cfg?.gateway?.supervisor?.budget;
  if (!fromCfg) {
    return { ...DEFAULT_SUPERVISOR_BUDGET };
  }
  return {
    maxIterations: fromCfg.maxIterations ?? DEFAULT_SUPERVISOR_BUDGET.maxIterations,
    maxCostUsd: fromCfg.maxCostUsd ?? DEFAULT_SUPERVISOR_BUDGET.maxCostUsd,
    maxDurationMinutes: fromCfg.maxDurationMinutes ?? DEFAULT_SUPERVISOR_BUDGET.maxDurationMinutes,
  };
}

/**
 * Apply tenant ceiling + optional per-task tightening when creating a task budget
 * snapshot (D-BUDGET: task can only tighten, never loosen).
 */
export function buildTaskBudget(params: {
  cfg?: OpenBotConfig;
  tenantId?: string;
  taskLimits?: Partial<SupervisorBudget>;
}): SupervisorBudget & { spentCostUsd: number; startedAtMs?: number } {
  const tenant = resolveTenantSupervisorBudget(params.cfg, params.tenantId);
  const effective = resolveEffectiveBudget(tenant, params.taskLimits);
  return { ...effective, spentCostUsd: 0 };
}

export function accumulateSpentCost(task: SupervisedTask, deltaUsd: number): SupervisedTask {
  if (deltaUsd <= 0) {
    return task;
  }
  return {
    ...task,
    budget: {
      ...task.budget,
      spentCostUsd: task.budget.spentCostUsd + deltaUsd,
    },
  };
}

export function ensureBudgetStarted(
  task: SupervisedTask,
  nowMs: number = Date.now(),
): SupervisedTask {
  if (task.budget.startedAtMs) {
    return task;
  }
  return {
    ...task,
    budget: { ...task.budget, startedAtMs: nowMs },
  };
}
