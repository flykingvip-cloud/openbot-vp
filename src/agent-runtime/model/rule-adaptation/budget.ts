import {
  DEFAULT_SHADOW_BUDGET_LIMITS,
  POST_ACCOUNTED_BUDGET_DIMENSIONS,
  PRE_ENFORCED_BUDGET_DIMENSIONS,
  type ShadowBudgetDimension,
  type ShadowBudgetLimits,
  type ShadowUsage,
  type ModelUsage,
} from "../../contracts/rule-adaptation-shadow.js";

export type BudgetDecision = "ok" | "budget_exhausted" | "cancelled";

export type BudgetRemainder = {
  outputTokens: number;
  durationMs: number;
  inputTokens: number;
};

export type BudgetTracker = {
  limits: ShadowBudgetLimits;
  recordModelUsage(usage: ModelUsage): void;
  recordRevision(): void;
  markCancelled(reason?: string): void;
  canStartModelCall(): BudgetDecision;
  canRevise(): BudgetDecision;
  revisionsRemaining(): number;
  remaining(): BudgetRemainder;
  usage(): ShadowUsage;
  exhausted(): ShadowBudgetDimension[];
  preEnforcedExhausted(): ShadowBudgetDimension[];
  postAccountedExhausted(): ShadowBudgetDimension[];
};

function normalizeLimits(partial?: Partial<ShadowBudgetLimits>): ShadowBudgetLimits {
  const merged: ShadowBudgetLimits = { ...DEFAULT_SHADOW_BUDGET_LIMITS, ...partial };
  const entries = Object.entries(merged) as Array<[keyof ShadowBudgetLimits, number]>;
  for (const [key, value] of entries) {
    if (!Number.isFinite(value) || value < 0) {
      merged[key] = 0;
    }
  }
  if (merged.maxTotalCost < merged.maxCost) {
    merged.maxCost = merged.maxTotalCost;
  }
  return merged;
}

function nonNeg(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function createBudgetTracker(
  partial: Partial<ShadowBudgetLimits> | undefined,
  now: () => number,
  signal?: AbortSignal,
): BudgetTracker {
  const limits = normalizeLimits(partial);
  const startedAt = now();
  const state: ShadowUsage = {
    modelCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    revisions: 0,
    durationMs: 0,
    cost: 0,
    cancelled: false,
  };

  const refreshDuration = (): void => {
    state.durationMs = Math.max(0, now() - startedAt);
  };

  const remaining = (): BudgetRemainder => {
    refreshDuration();
    return {
      outputTokens: Math.max(0, limits.maxOutputTokens - state.outputTokens),
      durationMs: Math.max(0, limits.maxDurationMs - state.durationMs),
      inputTokens: Math.max(0, limits.maxInputTokens - state.inputTokens),
    };
  };

  const exhausted = (): ShadowBudgetDimension[] => {
    refreshDuration();
    const hit: ShadowBudgetDimension[] = [];
    if (state.modelCalls >= limits.maxModelCalls) {
      hit.push("modelCalls");
    }
    if (state.inputTokens >= limits.maxInputTokens) {
      hit.push("inputTokens");
    }
    if (state.outputTokens >= limits.maxOutputTokens) {
      hit.push("outputTokens");
    }
    if (state.durationMs >= limits.maxDurationMs) {
      hit.push("durationMs");
    }
    if (state.cost >= limits.maxCost) {
      hit.push("cost");
    }
    if (state.cost >= limits.maxTotalCost) {
      hit.push("totalCost");
    }
    return hit;
  };

  const preEnforcedExhausted = (): ShadowBudgetDimension[] => {
    const hit = exhausted().filter((dimension) =>
      (PRE_ENFORCED_BUDGET_DIMENSIONS as readonly string[]).includes(dimension),
    );
    if (state.revisions >= limits.maxRevisions && !hit.includes("revisions")) {
      hit.push("revisions");
    }
    return hit;
  };

  const postAccountedExhausted = (): ShadowBudgetDimension[] =>
    exhausted().filter((dimension) =>
      (POST_ACCOUNTED_BUDGET_DIMENSIONS as readonly string[]).includes(dimension),
    );

  const decision = (): BudgetDecision => {
    if (state.cancelled || signal?.aborted) {
      return "cancelled";
    }
    return exhausted().length > 0 ? "budget_exhausted" : "ok";
  };

  return {
    limits,
    recordModelUsage(usage) {
      state.modelCalls += 1;
      state.inputTokens += nonNeg(usage.inputTokens);
      state.outputTokens += nonNeg(usage.outputTokens);
      state.cost += nonNeg(usage.cost);
      refreshDuration();
    },
    recordRevision() {
      state.revisions += 1;
      refreshDuration();
    },
    markCancelled(reason) {
      state.cancelled = true;
      if (reason) {
        state.cancelReason = reason;
      }
      refreshDuration();
    },
    canStartModelCall: decision,
    canRevise() {
      const base = decision();
      if (base !== "ok") {
        return base;
      }
      return state.revisions >= limits.maxRevisions ? "budget_exhausted" : "ok";
    },
    revisionsRemaining() {
      return Math.max(0, limits.maxRevisions - state.revisions);
    },
    remaining,
    usage() {
      refreshDuration();
      return { ...state };
    },
    exhausted,
    preEnforcedExhausted,
    postAccountedExhausted,
  };
}

export function zeroUsage(): ModelUsage {
  return { inputTokens: 0, outputTokens: 0, cost: 0 };
}

export function asModelUsage(value: Partial<ModelUsage> | undefined): ModelUsage {
  return {
    inputTokens: nonNeg(value?.inputTokens ?? 0),
    outputTokens: nonNeg(value?.outputTokens ?? 0),
    cost: nonNeg(value?.cost ?? 0),
  };
}

export function addModelUsage(left: ModelUsage, right: ModelUsage): ModelUsage {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    cost: left.cost + right.cost,
  };
}
