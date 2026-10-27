/**
 * W3: task-level total budget (TaskOutcome tip projection).
 *
 * Semantics mirror supervisor D-BUDGET (tighten-only) without coupling to
 * SupervisedTask — this is the unified TaskOutcome budget projection.
 * Exhaustion → fail_closed(budget_exceeded); never invents not_required success.
 */

export type TaskBudgetLimits = {
  maxIterations: number;
  maxCostUsd: number;
  maxDurationMinutes: number;
};

/** Durable tip snapshot: limits + spend + clock. */
export type TaskBudgetState = TaskBudgetLimits & {
  spentCostUsd: number;
  /** Wall-clock start for duration check; set on first spend / ensureStarted. */
  startedAtMs?: number;
  /** Count of recorded iterations (attempts) charged against maxIterations. */
  iterationCount: number;
};

export const DEFAULT_TASK_BUDGET_LIMITS: TaskBudgetLimits = {
  maxIterations: 5,
  maxCostUsd: 5,
  maxDurationMinutes: 30,
};

/**
 * Effective budget: task may only TIGHTEN the ceiling, never loosen.
 * Missing task values fall back to ceiling.
 */
export function resolveEffectiveTaskBudget(
  ceiling: TaskBudgetLimits,
  task?: Partial<TaskBudgetLimits>,
): TaskBudgetLimits {
  const tighten = (cap: number, want?: number) =>
    typeof want === "number" && Number.isFinite(want) ? Math.min(cap, want) : cap;
  return {
    maxIterations: tighten(ceiling.maxIterations, task?.maxIterations),
    maxCostUsd: tighten(ceiling.maxCostUsd, task?.maxCostUsd),
    maxDurationMinutes: tighten(ceiling.maxDurationMinutes, task?.maxDurationMinutes),
  };
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
  let next = ensureTaskBudgetStarted(state, nowMs);
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

/** Pure check: null when within budget. */
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

/**
 * Apply spend then return exhaustion if any (after spend).
 * Does not mutate tip — caller persists via set_budget / fail_closed.
 */
export function applySpendAndAssess(
  state: TaskBudgetState,
  delta: { costUsd?: number; iterations?: number },
  nowMs: number = Date.now(),
): { state: TaskBudgetState; exhaustion: TaskBudgetExhaustion | null } {
  const next = accumulateTaskBudgetSpend(state, delta, nowMs);
  return { state: next, exhaustion: assessTaskBudgetExhaustion(next, nowMs) };
}
