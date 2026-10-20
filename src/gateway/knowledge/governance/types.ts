export type GovernanceStatus = "pending" | "confirmed" | "merged" | "archived" | "suppressed";

export type ChunkRelationType = "duplicate" | "conflict" | "reference";

export type GovernanceTaskType = "duplicate" | "conflict" | "claim_conflict" | "stale" | "orphan";

export type GovernanceTaskStatus = "open" | "in_review" | "resolved" | "dismissed";

export type GovernanceJobType =
  | "dedup"
  | "conflict-analysis"
  | "claim-extraction"
  | "claim-conflict-analysis"
  | "orphan-scan"
  | "stale-scan"
  | "quality-refresh";

export type GovernanceJobStatus =
  | "pending"
  | "running"
  | "retrying"
  | "dead_letter"
  | "paused"
  | "resolved";

export type ChunkGovernanceFactors = {
  trustScore: number | null;
  freshnessScore: number | null;
  governanceStatus: GovernanceStatus | null;
  conflictGroupId: string | null;
};

export type GovernanceTaskRecord = {
  id: string;
  kbId: string;
  taskType: GovernanceTaskType;
  status: GovernanceTaskStatus;
  priority: number;
  relatedChunkIds: string[];
  proposedResolution: unknown;
  assignedTo: string | null;
  createdAt: number;
  updatedAt: number;
};

export type GovernanceLlmUsageSummary = {
  llmCallCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  creditsCharged: number;
  lastCallAt: number | null;
};

export type GovernanceSummary = {
  openConflictCount: number;
  openClaimConflictCount: number;
  openDuplicateCount: number;
  openOrphanCount: number;
  openStaleCount: number;
  suppressedChunkCount: number;
  /** Indexed chunks in scope (0 = no ingest yet; UI uses for empty-state copy). */
  indexedChunkCount: number;
  llmUsage: GovernanceLlmUsageSummary;
};

export type ClaimRelationType = "duplicate" | "conflict" | "supports" | "reference";

export type ClaimGovernanceStatus = "pending" | "confirmed" | "suppressed";

export type KnowledgeClaimRecord = {
  id: string;
  kbId: string;
  chunkId: string;
  subject: string;
  predicate: string | null;
  objectValue: string;
  normalizedKey: string;
  claimText: string;
  extractionMethod: string;
  governanceStatus: ClaimGovernanceStatus;
  conflictGroupId: string | null;
  createdAt: number;
  updatedAt: number;
};

export type GovernanceJobPayload = {
  chunkIds: string[];
  docId?: string;
  versionId?: string;
};
