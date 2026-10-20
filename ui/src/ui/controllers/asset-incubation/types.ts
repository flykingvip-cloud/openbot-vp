import type { AssetType } from "../skill-models.ts";

export type AssetIncubationLevel = "L1" | "L2" | "L3" | "L4";

export type AssetIncubationSource =
  | "session-detector"
  | "pattern-miner"
  | "review-engine"
  | "user-initiated";

export type AssetAdoptionEvidence = {
  distinctMemberCount: number;
  sharedToGroup: boolean;
  adminRecommended: boolean;
  enterpriseSubmitted: boolean;
};

export type AssetEvidence = {
  /** Single-session structured / reusable quality, 0–1 */
  sessionQuality: number;
  /** Same fingerprint recurrence (Phase 1 uses normalizedIntentKey) */
  recurrenceCount: number;
  /** User-initiated organize count for same context family */
  userInitiatedSaveCount: number;
  /** Copy / download / share / submit */
  externalizationCount: number;
  /** Collaboration chain segment reuse */
  collaborationReuseCount: number;
  /** Stable edit-pattern repeats (Phase 2) */
  editPatternStabilityCount: number;
  /** Organizational adoption — L4 only */
  adoption: AssetAdoptionEvidence;
  /** Review Engine flagged stable cluster */
  reviewEngineStableCluster: boolean;
};

export type AssetSignalTraceEntry = {
  kind: string;
  weight: number;
  at: number;
};

export type AssetIncubationDecision = {
  evidence: AssetEvidence;
  level: AssetIncubationLevel;
  /** Auxiliary sort key 0–1 */
  score: number;
  reason: string;
  signalTrace: AssetSignalTraceEntry[];
  source: AssetIncubationSource;
  contextId: string | null;
};

/** Detected-stage record; Draft persistence uses EmployeeSkillProfile */
export type PatternFingerprint = {
  clusterId: string;
  outputSchemaHash?: string;
  workflowSignature?: string;
};

export type AssetIncubationRecord = {
  id: string;
  title: string;
  summary: string;
  assetType: AssetType;
  sourceContextIds: string[];
  sourceAgentIds: string[];
  evidence: AssetEvidence;
  lifecycle: "detected" | "draft";
  version: string;
  detectedAt: number;
  fingerprint?: PatternFingerprint;
};

/** Context passed into inline skill save from incubation surfaces. */
export type SkillSaveIncubationContext = {
  source: AssetIncubationSource | "weekly-digest";
  contextId: string;
  clusterFingerprint?: string | null;
  incubationDecision?: AssetIncubationDecision | null;
};

export type AssetIncubationThresholds = {
  recurrenceForL3: number;
  userInitiatedSaveForL3: number;
  externalizationForL3: number;
  collaborationReuseForL3: number;
  editPatternStabilityForL3: number;
  adoptionMemberCountForL4: number;
  /** Minimum sessionQuality for L1 */
  sessionQualityForL1: number;
  /** Minimum sessionQuality for L2 when artifact+structure path */
  sessionQualityForL2: number;
};

export const DEFAULT_INCUBATION_THRESHOLDS: AssetIncubationThresholds = {
  recurrenceForL3: 3,
  userInitiatedSaveForL3: 2,
  externalizationForL3: 2,
  collaborationReuseForL3: 2,
  editPatternStabilityForL3: 3,
  adoptionMemberCountForL4: 3,
  sessionQualityForL1: 0.35,
  sessionQualityForL2: 0.55,
};

export function createEmptyAdoptionEvidence(): AssetAdoptionEvidence {
  return {
    distinctMemberCount: 0,
    sharedToGroup: false,
    adminRecommended: false,
    enterpriseSubmitted: false,
  };
}

export function createEmptyEvidence(): AssetEvidence {
  return {
    sessionQuality: 0,
    recurrenceCount: 0,
    userInitiatedSaveCount: 0,
    externalizationCount: 0,
    collaborationReuseCount: 0,
    editPatternStabilityCount: 0,
    adoption: createEmptyAdoptionEvidence(),
    reviewEngineStableCluster: false,
  };
}
