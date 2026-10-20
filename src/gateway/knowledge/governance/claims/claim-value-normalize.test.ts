// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  canRunGovernanceJobWithBudget,
  createGovernanceResourceBudget,
  estimateGovernanceJobResourceCost,
} from "../runtime/job-resource-budget.js";
import { claimValuesConflict, normalizeClaimObjectValue } from "./claim-value-normalize.js";

describe("claim-value-normalize", () => {
  it("treats percent spellings as equivalent", () => {
    expect(normalizeClaimObjectValue("15%")).toBe("pct:15");
    expect(normalizeClaimObjectValue("15 percent")).toBe("pct:15");
    expect(claimValuesConflict("15%", "15 percent")).toBe(false);
    expect(claimValuesConflict("15%", "18%")).toBe(true);
  });
});

describe("job-resource-budget", () => {
  it("defers similarity-heavy jobs when query budget is exhausted", () => {
    const budget = createGovernanceResourceBudget({
      maxJobsPerRound: 5,
      maxLlmCallsPerRound: 0,
      maxEmbeddingCallsPerRound: 0,
      maxSimilarityQueriesPerRound: 1,
    });
    const job = {
      id: "job-1",
      kbId: "kb",
      jobType: "dedup" as const,
      status: "pending" as const,
      attempts: 0,
      maxAttempts: 3,
      payload: { chunkIds: ["c1", "c2"] },
    };
    expect(estimateGovernanceJobResourceCost(job).similarityQueries).toBe(2);
    expect(
      canRunGovernanceJobWithBudget({
        job,
        budget,
        limits: {
          maxJobsPerRound: 5,
          maxLlmCallsPerRound: 0,
          maxEmbeddingCallsPerRound: 0,
          maxSimilarityQueriesPerRound: 1,
        },
      }),
    ).toBe(false);
    budget.similarityQueriesUsed = 0;
    const smallJob = { ...job, payload: { chunkIds: ["c1"] } };
    expect(
      canRunGovernanceJobWithBudget({
        job: smallJob,
        budget,
        limits: {
          maxJobsPerRound: 5,
          maxLlmCallsPerRound: 0,
          maxEmbeddingCallsPerRound: 0,
          maxSimilarityQueriesPerRound: 1,
        },
      }),
    ).toBe(true);
  });

  it("estimates LLM budget for conflict-analysis jobs", () => {
    const job = {
      id: "job-conflict",
      kbId: "kb",
      jobType: "conflict-analysis" as const,
      status: "pending" as const,
      attempts: 0,
      maxAttempts: 3,
      payload: { chunkIds: ["c1", "c2", "c3"] },
    };
    const limits = {
      maxJobsPerRound: 5,
      maxLlmCallsPerRound: 8,
      maxEmbeddingCallsPerRound: 0,
      maxSimilarityQueriesPerRound: 24,
    };
    expect(estimateGovernanceJobResourceCost(job, limits).llmCalls).toBe(8);
    expect(
      estimateGovernanceJobResourceCost(job, { ...limits, maxLlmCallsPerRound: 0 }).llmCalls,
    ).toBe(0);
  });
});
