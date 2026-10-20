import type { DatabaseSync } from "node:sqlite";
import type { OpenBotConfig } from "../../../../config/config.js";
import {
  enqueueGovernanceJob,
  markGovernanceJobFailed,
  markGovernanceJobResolved,
  markGovernanceJobRunning,
  pickPendingGovernanceJobs,
  type PendingGovernanceJob,
} from "../chunk-governance-store.js";
import { createChunkConflictLlmClient } from "../detection/chunk-conflict-llm.js";
import { runClaimConflictDetection } from "../detection/claim-conflict-detector.js";
import { runClaimExtraction } from "../detection/claim-extractor-runner.js";
import { runConflictDetection } from "../detection/conflict-detector.js";
import { runDuplicateDetection } from "../detection/duplicate-detector.js";
import { runOrphanScan } from "../detection/orphan-detector.js";
import { runStaleScan } from "../detection/stale-detector.js";
import { runQualityRefresh } from "../scoring/run-quality-refresh.js";
import type { KnowledgeIndexDbScope } from "../usage/knowledge-index-scope.js";
import { parseKnowledgeIndexDbScope } from "../usage/knowledge-index-scope.js";
import { GOVERNANCE_JOB_PRIORITIES } from "./governance-job-priorities.js";
import {
  applyGovernanceResourceUsage,
  canRunGovernanceJobWithBudget,
  createGovernanceResourceBudget,
  emptyGovernanceResourceUsage,
  mergeGovernanceResourceUsage,
  type GovernanceJobRunnerLimits,
  type GovernanceResourceBudget,
  type GovernanceResourceUsage,
} from "./job-resource-budget.js";

export type { GovernanceJobRunnerLimits } from "./job-resource-budget.js";

export const DEFAULT_GOVERNANCE_JOB_LIMITS: GovernanceJobRunnerLimits = {
  maxJobsPerRound: 5,
  maxLlmCallsPerRound: 8,
  maxEmbeddingCallsPerRound: 0,
  maxSimilarityQueriesPerRound: 24,
};

async function processGovernanceJob(params: {
  db: DatabaseSync;
  job: PendingGovernanceJob;
  resourceBudget: GovernanceResourceBudget;
  indexScope: KnowledgeIndexDbScope;
  cfg?: OpenBotConfig;
}): Promise<GovernanceResourceUsage> {
  const { chunkIds } = params.job.payload;
  switch (params.job.jobType) {
    case "dedup":
      if (!Array.isArray(chunkIds) || chunkIds.length === 0) {
        return emptyGovernanceResourceUsage();
      }
      return mergeGovernanceResourceUsage(emptyGovernanceResourceUsage(), {
        llmCalls: 0,
        embeddingCalls: 0,
        similarityQueries: runDuplicateDetection({
          db: params.db,
          kbId: params.job.kbId,
          chunkIds,
          resourceBudget: params.resourceBudget,
        }).similarityQueries,
      });
    case "conflict-analysis":
      if (!Array.isArray(chunkIds) || chunkIds.length === 0) {
        return emptyGovernanceResourceUsage();
      }
      {
        const llmClient =
          params.resourceBudget.llmCallsRemaining > 0
            ? createChunkConflictLlmClient({
                cfg: params.cfg,
                usageContext: {
                  kbId: params.job.kbId,
                  enterpriseId: params.indexScope.enterpriseId,
                  userId: params.indexScope.userId,
                  jobId: params.job.id,
                  db: params.db,
                },
              })
            : null;
        const conflictResult = await runConflictDetection({
          db: params.db,
          kbId: params.job.kbId,
          chunkIds,
          resourceBudget: params.resourceBudget,
          llmClient,
        });
        if (conflictResult.llmPairsDeferred > 0 && conflictResult.llmCalls > 0) {
          enqueueGovernanceJob({
            db: params.db,
            kbId: params.job.kbId,
            jobType: "conflict-analysis",
            payload: params.job.payload,
            priority: GOVERNANCE_JOB_PRIORITIES.conflictAnalysisResume,
          });
        }
        return mergeGovernanceResourceUsage(emptyGovernanceResourceUsage(), {
          llmCalls: conflictResult.llmCalls,
          embeddingCalls: 0,
          similarityQueries: conflictResult.similarityQueries,
        });
      }
    case "quality-refresh":
      runQualityRefresh({
        db: params.db,
        kbId: params.job.kbId,
        chunkIds: Array.isArray(chunkIds) && chunkIds.length > 0 ? chunkIds : undefined,
      });
      return emptyGovernanceResourceUsage();
    case "orphan-scan":
      runOrphanScan({ db: params.db, kbId: params.job.kbId });
      return emptyGovernanceResourceUsage();
    case "stale-scan":
      runStaleScan({ db: params.db, kbId: params.job.kbId });
      return emptyGovernanceResourceUsage();
    case "claim-extraction":
      if (!Array.isArray(chunkIds) || chunkIds.length === 0) {
        return emptyGovernanceResourceUsage();
      }
      runClaimExtraction({ db: params.db, kbId: params.job.kbId, chunkIds });
      return emptyGovernanceResourceUsage();
    case "claim-conflict-analysis":
      runClaimConflictDetection({ db: params.db, kbId: params.job.kbId });
      return emptyGovernanceResourceUsage();
    default:
      return emptyGovernanceResourceUsage();
  }
}

export async function runGovernanceJobsForDatabase(params: {
  db: DatabaseSync;
  dbPath?: string;
  limits?: GovernanceJobRunnerLimits;
  cfg?: OpenBotConfig;
}): Promise<{ processed: number; failed: number; deferred: number }> {
  const limits = params.limits ?? DEFAULT_GOVERNANCE_JOB_LIMITS;
  const resourceBudget = createGovernanceResourceBudget(limits);
  const indexScope = params.dbPath
    ? parseKnowledgeIndexDbScope(params.dbPath)
    : { enterpriseId: null, userId: null };
  const candidateJobs = pickPendingGovernanceJobs({
    db: params.db,
    limit: Math.max(limits.maxJobsPerRound * 4, limits.maxJobsPerRound),
  });
  let processed = 0;
  let failed = 0;
  let deferred = 0;

  for (const job of candidateJobs) {
    if (processed >= limits.maxJobsPerRound) {
      deferred += 1;
      continue;
    }
    if (!canRunGovernanceJobWithBudget({ job, budget: resourceBudget, limits })) {
      deferred += 1;
      continue;
    }
    markGovernanceJobRunning({ db: params.db, jobId: job.id });
    try {
      const usage = await processGovernanceJob({
        db: params.db,
        job,
        resourceBudget,
        indexScope,
        cfg: params.cfg,
      });
      applyGovernanceResourceUsage(resourceBudget, usage);
      markGovernanceJobResolved({ db: params.db, jobId: job.id });
      processed += 1;
    } catch (error) {
      markGovernanceJobFailed({
        db: params.db,
        jobId: job.id,
        error: error instanceof Error ? error.message : String(error),
      });
      failed += 1;
    }
  }

  return { processed, failed, deferred };
}
