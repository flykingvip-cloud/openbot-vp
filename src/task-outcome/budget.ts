/**
 * W3: TaskOutcome tip projection of existing supervisor D-BUDGET.
 *
 * Reuses `DEFAULT_SUPERVISOR_BUDGET` + `resolveEffectiveBudget` (tighten-only).
 * Not a new ledger, pre-allocation, or scheduler — tip stores a spend snapshot so
 * `fail_closed(budget_exceeded)` can attribute eligibility without inventing success.
 * Exhaustion dimensions mirror `gateway/supervisor/retry.ts` `nextStop`.
 */

import {
  DEFAULT_SUPERVISOR_BUDGET,
  resolveEffectiveBudget,
  type SupervisorBudget,
} from "../gateway/supervisor/types.js";

/** Tip limits ≡ supervisor budget shape. */
export type TaskBudgetLimits = SupervisorBudget;

/** Durable tip snapshot: limits + spend + clock (+ iteration count; tip has no iterations[]). */
export type TaskBudgetState = TaskBudgetLimits & {
  spentCostUsd: number;
  /** Wall-clock start for duration check; set on first spend / ensureStarted. */
  startedAtMs?: number;
  /** Count of recorded iterations charged against maxIterations (mirrors SupervisedTask.iterations.length). */
  iterationCount: number;
};

export const DEFAULT_TASK_BUDGET_LIMITS: TaskBudgetLimits = { ...DEFAULT_SUPERVISOR_BUDGET };

/** Tighten-only; delegates to supervisor `resolveEffectiveBudget`. */
export function resolveEffectiveTaskBudget(
  ceiling: TaskBudgetLimits,
  task?: Partial<TaskBudgetLimits>,
): TaskBudgetLimits {
  return resolveEffectiveBudget(ceiling, task);
}

export function buildTaskBudgetState(params: {
  ceiling?: TaskBudgetLimits;
  taskLimits?: Partial<TaskBudgetLimits>;
}): TaskBudgetState {
  const ceiling = params.ceiling ?? DEFAULT_TASK_BUDGET_LIMITS;
  const limits = resolveEffectiveTaskBudget(ceiling, params.taskLimits);
  return {
    ...limits,
    spentCostUsd: 0,
    iterationCount: 0,
  };
}

export function ensureTaskBudgetStarted(
  state: TaskBudgetState,
  nowMs: number = Date.now(),
): TaskBudgetState {
  if (state.startedAtMs != null) {
    return state;
  }
  return { ...state, startedAtMs: nowMs };
}

export function accumulateTaskBudgetSpend(
  state: TaskBudgetState,
  delta: { costUsd?: number; iterations?: number },
  nowMs: number = Date.now(),
): TaskBudgetState {
  const next = ensureTaskBudgetStarted(state, nowMs);
  const cost = typeof delta.costUsd === "number" && delta.costUsd > 0 ? delta.costUsd : 0;
  const iters =
    typeof delta.iterations === "number" && delta.iterations > 0 ? Math.floor(delta.iterations) : 0;
  if (cost === 0 && iters === 0) {
    return next;
  }
  return {
    ...next,
    spentCostUsd: next.spentCostUsd + cost,
    iterationCount: next.iterationCount + iters,
  };
}

export type TaskBudgetExhaustion = {
  dimension: "iterations" | "cost" | "duration";
  detail: string;
};

/**
 * Pure check aligned with supervisor `nextStop` budget arms (iterations / cost / duration).
 * Returns null when within budget.
 */
export function assessTaskBudgetExhaustion(
  state: TaskBudgetState,
  nowMs: number = Date.now(),
): TaskBudgetExhaustion | null {
  if (state.iterationCount >= state.maxIterations) {
    return {
      dimension: "iterations",
      detail: `iterations ${state.iterationCount} >= maxIterations ${state.maxIterations}`,
    };
  }
  if (state.spentCostUsd >= state.maxCostUsd) {
    return {
      dimension: "cost",
      detail: `spentCostUsd ${state.spentCostUsd} >= maxCostUsd ${state.maxCostUsd}`,
    };
  }
  if (state.startedAtMs != null) {
    const elapsedMin = (nowMs - state.startedAtMs) / 60_000;
    if (elapsedMin >= state.maxDurationMinutes) {
      return {
        dimension: "duration",
        detail: `elapsedMinutes ${elapsedMin.toFixed(2)} >= maxDurationMinutes ${state.maxDurationMinutes}`,
      };
    }
  }
  return null;
}

/** Apply spend then assess (caller persists via set_budget / fail_closed). */
export function applySpendAndAssess(
  state: TaskBudgetState,
  delta: { costUsd?: number; iterations?: number },
  nowMs: number = Date.now(),
): { state: TaskBudgetState; exhaustion: TaskBudgetExhaustion | null } {
  const next = accumulateTaskBudgetSpend(state, delta, nowMs);
  return { state: next, exhaustion: assessTaskBudgetExhaustion(next, nowMs) };
}

/** Project supervisor task budget snapshot onto tip shape (no SupervisedTask coupling). */
export function projectTipBudgetFromSupervisor(params: {
  limits: SupervisorBudget;
  spentCostUsd: number;
  startedAtMs?: number;
  iterationCount: number;
}): TaskBudgetState {
  return {
    maxIterations: params.limits.maxIterations,
    maxCostUsd: params.limits.maxCostUsd,
    maxDurationMinutes: params.limits.maxDurationMinutes,
    spentCostUsd: params.spentCostUsd,
    iterationCount: params.iterationCount,
    ...(params.startedAtMs != null ? { startedAtMs: params.startedAtMs } : {}),
  };
}
