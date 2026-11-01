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

/**
 * How a model-call charge learned its USD.
 * - known: cost config produced a finite estimate (including explicit 0).
 * - unknown: a model call happened but usage or cost config could not price it.
 * - not_applicable: the charge is not a model call (collab claim iteration).
 * Unknown must not be stored as spentCostUsd 0.
 */
export type TipCostEvidence = "known" | "unknown" | "not_applicable";

/** Durable tip snapshot: limits + spend + clock (+ iteration count; tip has no iterations[]). */
export type TaskBudgetState = TaskBudgetLimits & {
  /** Own known positive USD. Does not include child-attributed or unknown calls. */
  spentCostUsd: number;
  /** Wall-clock start for duration check; set on first spend / ensureStarted. */
  startedAtMs?: number;
  /** Own recorded iterations (mirrors SupervisedTask.iterations.length). */
  iterationCount: number;
  /** Model calls whose USD could not be priced. Not added to spentCostUsd. */
  unknownCostCharges?: number;
  /** Model calls priced at exactly 0. Distinct from unknown. */
  knownZeroCostCharges?: number;
  /**
   * USD attributed from child tasks. Kept off spentCostUsd so a family rollup
   * uses parent.spentCostUsd + parent.childAttributedCostUsd and does not also
   * add the child's own spentCostUsd.
   */
  childAttributedCostUsd?: number;
  childAttributedIterations?: number;
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
    unknownCostCharges: 0,
    knownZeroCostCharges: 0,
    childAttributedCostUsd: 0,
    childAttributedIterations: 0,
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
  delta: {
    costUsd?: number;
    iterations?: number;
    costEvidence?: TipCostEvidence;
    /** child = roll into the parent tip without adding to the parent's own spend. */
    attribution?: "own" | "child";
  },
  nowMs: number = Date.now(),
): TaskBudgetState {
  const next = ensureTaskBudgetStarted(state, nowMs);
  const iters =
    typeof delta.iterations === "number" && delta.iterations > 0 ? Math.floor(delta.iterations) : 0;
  const evidence = delta.costEvidence;
  const knownCost =
    evidence === "known" &&
    typeof delta.costUsd === "number" &&
    Number.isFinite(delta.costUsd) &&
    delta.costUsd >= 0
      ? delta.costUsd
      : undefined;
  // Legacy callers omit evidence and only pass a positive estimate.
  const legacyPositive =
    evidence == null &&
    typeof delta.costUsd === "number" &&
    Number.isFinite(delta.costUsd) &&
    delta.costUsd > 0
      ? delta.costUsd
      : 0;
  const child = delta.attribution === "child";
  if (child) {
    return {
      ...next,
      childAttributedIterations: (next.childAttributedIterations ?? 0) + iters,
      childAttributedCostUsd:
        (next.childAttributedCostUsd ?? 0) +
        (knownCost != null && knownCost > 0 ? knownCost : legacyPositive),
      unknownCostCharges:
        (next.unknownCostCharges ?? 0) + (evidence === "unknown" && iters > 0 ? 1 : 0),
      knownZeroCostCharges:
        (next.knownZeroCostCharges ?? 0) +
        (evidence === "known" && knownCost === 0 && iters > 0 ? 1 : 0),
    };
  }
  const ownCost = knownCost != null && knownCost > 0 ? knownCost : legacyPositive;
  const unknownInc = evidence === "unknown" && iters > 0 ? 1 : 0;
  const zeroInc = evidence === "known" && knownCost === 0 && iters > 0 ? 1 : 0;
  if (ownCost === 0 && iters === 0 && unknownInc === 0 && zeroInc === 0) {
    return next;
  }
  return {
    ...next,
    spentCostUsd: next.spentCostUsd + ownCost,
    iterationCount: next.iterationCount + iters,
    unknownCostCharges: (next.unknownCostCharges ?? 0) + unknownInc,
    knownZeroCostCharges: (next.knownZeroCostCharges ?? 0) + zeroInc,
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
  const iterations = state.iterationCount + (state.childAttributedIterations ?? 0);
  const spent = state.spentCostUsd + (state.childAttributedCostUsd ?? 0);
  if (iterations >= state.maxIterations) {
    return {
      dimension: "iterations",
      detail: `iterations ${iterations} >= maxIterations ${state.maxIterations}`,
    };
  }
  if (spent >= state.maxCostUsd) {
    return {
      dimension: "cost",
      detail: `spentCostUsd ${spent} >= maxCostUsd ${state.maxCostUsd}`,
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
