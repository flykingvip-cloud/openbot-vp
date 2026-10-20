import type { PendingGovernanceJob } from "../chunk-governance-store.js";
import type { GovernanceJobType } from "../types.js";

export type GovernanceJobRunnerLimits = {
  maxJobsPerRound: number;
  maxLlmCallsPerRound: number;
  maxEmbeddingCallsPerRound: number;
  maxSimilarityQueriesPerRound: number;
};

export type GovernanceResourceBudget = {
  llmCallsRemaining: number;
  embeddingCallsRemaining: number;
  maxSimilarityQueries: number;
  similarityQueriesUsed: number;
};

export type GovernanceResourceUsage = {
  llmCalls: number;
  embeddingCalls: number;
  similarityQueries: number;
};

export function createGovernanceResourceBudget(
  limits: GovernanceJobRunnerLimits,
): GovernanceResourceBudget {
  return {
    llmCallsRemaining: limits.maxLlmCallsPerRound,
    embeddingCallsRemaining: limits.maxEmbeddingCallsPerRound,
    maxSimilarityQueries: limits.maxSimilarityQueriesPerRound,
    similarityQueriesUsed: 0,
  };
}

const CONFLICT_LLM_PAIRS_PER_CHUNK_ESTIMATE = 4;

export function estimateGovernanceJobResourceCost(
  job: PendingGovernanceJob,
  limits?: GovernanceJobRunnerLimits,
): GovernanceResourceUsage {
  const chunkCount = Array.isArray(job.payload.chunkIds) ? job.payload.chunkIds.length : 0;
  const maxLlm = limits?.maxLlmCallsPerRound ?? 0;
  switch (job.jobType) {
    case "dedup":
      return {
        llmCalls: 0,
        embeddingCalls: 0,
        similarityQueries: chunkCount,
      };
    case "conflict-analysis":
      return {
        llmCalls:
          maxLlm > 0 ? Math.min(chunkCount * CONFLICT_LLM_PAIRS_PER_CHUNK_ESTIMATE, maxLlm) : 0,
        embeddingCalls: 0,
        similarityQueries: chunkCount,
      };
    case "claim-extraction":
      return { llmCalls: 0, embeddingCalls: 0, similarityQueries: 0 };
    case "claim-conflict-analysis":
      return { llmCalls: 0, embeddingCalls: 0, similarityQueries: 0 };
    case "quality-refresh":
    case "orphan-scan":
      return { llmCalls: 0, embeddingCalls: 0, similarityQueries: 0 };
    default:
      return { llmCalls: 0, embeddingCalls: 0, similarityQueries: 0 };
  }
}

export function canRunGovernanceJobWithBudget(params: {
  job: PendingGovernanceJob;
  budget: GovernanceResourceBudget;
  limits?: GovernanceJobRunnerLimits;
}): boolean {
  const estimate = estimateGovernanceJobResourceCost(params.job, params.limits);
  if (estimate.llmCalls > params.budget.llmCallsRemaining) {
    return false;
  }
  if (estimate.embeddingCalls > params.budget.embeddingCallsRemaining) {
    return false;
  }
  if (
    estimate.similarityQueries > 0 &&
    params.budget.similarityQueriesUsed + estimate.similarityQueries >
      params.budget.maxSimilarityQueries
  ) {
    return false;
  }
  return true;
}

export function applyGovernanceResourceUsage(
  budget: GovernanceResourceBudget,
  usage: GovernanceResourceUsage,
): void {
  budget.llmCallsRemaining = Math.max(0, budget.llmCallsRemaining - usage.llmCalls);
  budget.embeddingCallsRemaining = Math.max(
    0,
    budget.embeddingCallsRemaining - usage.embeddingCalls,
  );
  budget.similarityQueriesUsed += usage.similarityQueries;
}

export function emptyGovernanceResourceUsage(): GovernanceResourceUsage {
  return { llmCalls: 0, embeddingCalls: 0, similarityQueries: 0 };
}

export function mergeGovernanceResourceUsage(
  left: GovernanceResourceUsage,
  right: GovernanceResourceUsage,
): GovernanceResourceUsage {
  return {
    llmCalls: left.llmCalls + right.llmCalls,
    embeddingCalls: left.embeddingCalls + right.embeddingCalls,
    similarityQueries: left.similarityQueries + right.similarityQueries,
  };
}

export function jobTypeUsesLlm(jobType: GovernanceJobType): boolean {
  return jobType === "conflict-analysis";
}
