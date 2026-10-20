/** Higher value runs first (`ORDER BY priority DESC`). Conflict detection needs LLM/similarity budget. */
export const GOVERNANCE_JOB_PRIORITIES = {
  conflictAnalysis: 30,
  conflictAnalysisResume: 28,
  dedup: 22,
  claimExtraction: 18,
  qualityRefresh: 12,
  staleScan: 10,
  orphanScan: 8,
} as const;
