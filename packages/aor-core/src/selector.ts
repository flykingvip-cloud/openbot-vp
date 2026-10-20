import type { CostProfile } from "./capabilities.js";
import type { ModelProfile, ModelRef, TaskConstraints, TaskTypeId } from "./types.js";

export type SelectionStrategy = "cheapest" | "best_quality" | "balanced" | "bandit";

export interface SelectionInput {
  taskType: TaskTypeId;
  strategy: SelectionStrategy;
  candidates: ModelProfile[];
  /** Token expectation used to estimate USD cost. */
  costProfile: CostProfile;
  constraints?: TaskConstraints;
}

export interface SelectionResult {
  model: ModelRef;
  estimatedCostUsd: number;
  /** 0..1 expected quality for the task type. */
  qualityScore: number;
  /** Combined strategy score used to pick the winner. */
  score: number;
  reason: string;
}

/** Estimate USD cost for a model given expected token usage. */
export function estimateCostUsd(model: ModelProfile, costProfile: CostProfile): number {
  const input = (costProfile.expectedInputTokens / 1_000_000) * model.cost.inputPerMtok;
  const output = (costProfile.expectedOutputTokens / 1_000_000) * model.cost.outputPerMtok;
  return input + output;
}

function latencyEstimateMs(model: ModelProfile): number {
  return model.p95LatencyMs ?? model.p50LatencyMs ?? 0;
}

function sameRef(a: ModelRef, b: ModelRef): boolean {
  return (
    a.provider.toLowerCase() === b.provider.toLowerCase() &&
    a.id.toLowerCase() === b.id.toLowerCase()
  );
}

function qualityFor(model: ModelProfile, taskType: TaskTypeId): number {
  const score = model.taskTypeScores[taskType];
  return typeof score === "number" ? score : 0.5;
}

class NoCandidateError extends Error {}

/**
 * Rank all eligible models for a task, best first. The top entry is the
 * preferred model; the rest form the fallback chain handed to the backend
 * (OpenBot's native `runWithModelFallback`), so we never duplicate retry logic.
 */
export function rankModels(input: SelectionInput): SelectionResult[] {
  const { constraints } = input;

  const eligible = input.candidates.filter((model) => {
    if (model.available === false) {
      return false;
    }
    if (constraints?.allowedModels && constraints.allowedModels.length > 0) {
      if (!constraints.allowedModels.some((ref) => sameRef(ref, model.ref))) {
        return false;
      }
    }
    if (typeof constraints?.budgetUsd === "number") {
      if (estimateCostUsd(model, input.costProfile) > constraints.budgetUsd) {
        return false;
      }
    }
    return true;
  });

  if (eligible.length === 0) {
    throw new NoCandidateError(
      `No eligible model for task type "${input.taskType}" under the given constraints`,
    );
  }

  const costs = eligible.map((m) => estimateCostUsd(m, input.costProfile));
  const maxCost = Math.max(...costs, Number.EPSILON);
  const latencies = eligible.map(latencyEstimateMs);
  const maxLatency = Math.max(...latencies, Number.EPSILON);

  const reason =
    input.strategy === "cheapest"
      ? "lowest estimated cost"
      : input.strategy === "best_quality"
        ? "highest task-type quality"
        : input.strategy === "bandit"
          ? "bandit learned quality + cost tie-break"
          : "balanced cost/quality/latency";

  const scored = eligible.map((model) => {
    const estimatedCostUsd = estimateCostUsd(model, input.costProfile);
    const qualityScore = qualityFor(model, input.taskType);
    // Normalize cost/latency to 0..1 "goodness" (1 = cheapest/fastest).
    const costGoodness = 1 - estimatedCostUsd / maxCost;
    const latencyGoodness = 1 - latencyEstimateMs(model) / maxLatency;
    // Reported strategy score (for observability).
    const score =
      input.strategy === "cheapest"
        ? costGoodness * 0.9 + qualityScore * 0.1
        : input.strategy === "best_quality"
          ? qualityScore * 0.9 + costGoodness * 0.1
          : input.strategy === "bandit"
            ? qualityScore * 0.9 + costGoodness * 0.1
            : qualityScore * 0.5 + costGoodness * 0.35 + latencyGoodness * 0.15;
    return { model, estimatedCostUsd, qualityScore, score, reason, costGoodness, latencyGoodness };
  });

  // Extreme strategies are lexicographic so the primary dimension always wins,
  // regardless of token magnitude; the secondary dimension only breaks ties.
  // `balanced` uses the weighted score directly.
  scored.sort((a, b) => {
    if (input.strategy === "cheapest") {
      if (a.estimatedCostUsd !== b.estimatedCostUsd) {
        return a.estimatedCostUsd - b.estimatedCostUsd;
      }
      return b.qualityScore - a.qualityScore;
    }
    if (input.strategy === "best_quality") {
      if (b.qualityScore !== a.qualityScore) {
        return b.qualityScore - a.qualityScore;
      }
      return a.estimatedCostUsd - b.estimatedCostUsd;
    }
    if (input.strategy === "bandit") {
      if (b.qualityScore !== a.qualityScore) {
        return b.qualityScore - a.qualityScore;
      }
      return a.estimatedCostUsd - b.estimatedCostUsd;
    }
    return b.score - a.score;
  });

  return scored.map((entry) => ({
    model: entry.model.ref,
    estimatedCostUsd: entry.estimatedCostUsd,
    qualityScore: entry.qualityScore,
    score: entry.score,
    reason: entry.reason,
  }));
}

/** Select the single preferred model for a task (the top of {@link rankModels}). */
export function selectModel(input: SelectionInput): SelectionResult {
  return rankModels(input)[0];
}

export { NoCandidateError };
