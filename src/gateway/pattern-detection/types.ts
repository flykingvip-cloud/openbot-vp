export type PatternSample = {
  sampleId: string;
  agentId: string;
  tenantId: string | null;
  runId: string | null;
  taskId: string | null;
  sessionKey: string | null;
  recordedAt: number;
  /** Structural fingerprints for similarity (not raw user text by default). */
  inputStructureHash: string;
  outputStructureHash: string;
  toolTraceHash: string | null;
  /** Concrete tool names observed on the run (for contract.toolsRequired). */
  toolsUsed?: string[] | null;
  success: boolean | null;
  humanEdited: boolean | null;
};

export type PatternCandidateStatus = "candidate" | "rejected" | "approved" | "published";

export type PatternCandidateQuality = {
  successRate: number | null;
  humanEditRate: number | null;
  independentTaskCount: number;
  timeSpanMs: number;
};

export type PatternCandidateContract = {
  inputDescription: string;
  outputDescription: string;
  toolsRequired: string[];
  dependencies: string[];
  riskLevel: "low" | "medium" | "high";
  requiresHumanApproval: true;
  quality: PatternCandidateQuality;
};

/** Snapshot of thresholds/policy at human approval time (audit + re-validation). */
export type PatternApprovalPolicySnapshot = {
  policyVersion: string;
  minIndependent: number;
  minConfidence: number;
  minSuccessRate: number;
  capturedAt: number;
};

export type PatternCandidate = {
  candidateId: string;
  agentId: string;
  tenantId: string | null;
  status: PatternCandidateStatus;
  sampleCount: number;
  independentTaskCount: number;
  independentRunIds: string[];
  firstSeenAt: number;
  lastSeenAt: number;
  overallConfidence: number;
  suggestedName: string;
  suggestedSummary: string;
  sampleIds: string[];
  lineage: {
    evidenceKind: "server-pattern-samples";
    structureKey: string;
  };
  /** Executable-skill oriented contract (not yet a published skill). */
  contract: PatternCandidateContract;
  /** Human approver principal (operator id / subject). */
  approvedBy?: string | null;
  approvedAt?: number | null;
  /** Policy thresholds captured at approval. */
  approvalPolicySnapshot?: PatternApprovalPolicySnapshot | null;
  /**
   * Explicit intent that skill-auto may create an install job for this candidate.
   * Without this (or a pre-existing skillAutoJobs record), auto pass must not touch the candidate.
   */
  autoInstallIntent?: boolean;
  /** Skill id after publish (durable; preferred over parsing suggestedSummary). */
  publishedSkillId?: string | null;
  createdAt: number;
  updatedAt: number;
};

export type IngestPatternSampleInput = {
  agentId: string;
  tenantId?: string | null;
  operatorUserId?: string | null;
  runId?: string | null;
  taskId?: string | null;
  sessionKey?: string | null;
  recordedAt?: number;
  inputStructureHash: string;
  outputStructureHash: string;
  toolTraceHash?: string | null;
  /** Concrete tool names for contract derivation (preferred over toolTraceHash alone). */
  toolsUsed?: string[] | null;
  success?: boolean | null;
  humanEdited?: boolean | null;
  /** Optional free-form labels used only for suggested name/summary. */
  suggestedNameHint?: string;
  suggestedSummaryHint?: string;
};
