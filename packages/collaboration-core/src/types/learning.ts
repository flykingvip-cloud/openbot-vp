type FutureLearningMetadata = Record<string, unknown>;

export type CapsuleSourceType =
  | "session"
  | "memory"
  | "task"
  | "deliverable"
  | "review"
  | "decision";

export type GroupMemoryCapsuleType =
  | "lesson"
  | "pattern"
  | "playbook"
  | "decision_rule"
  | "skill_delta"
  | "anti_pattern";

export type CapsuleSensitivity = "public" | "internal" | "restricted" | "secret";
export type CapsuleReusability = "group_only" | "promotable" | "reusable" | "exportable";
export type CapsuleConfidentialityScope = "group" | "tenant" | "org" | "cross_org";
export type CapsuleStatus = "candidate" | "approved" | "revoked";

export type ProjectionType =
  | "none"
  | "group_only"
  | "personal_abstracted"
  | "personal_transferable";
export type TransformationRule = "summary" | "anonymized" | "pattern_only" | "policy_only";
export type ProjectionEligibilityReason =
  | "ok"
  | "missing_actor"
  | "missing_bot"
  | "capsule_not_approved"
  | "capsule_revoked"
  | "group_only_capsule"
  | "secret_capsule"
  | "restricted_capsule_requires_approval"
  | "projection_rejected"
  | "projection_revoked"
  | "projection_expired"
  | "projection_not_promotable"
  | "projection_not_approved";
export type ProjectionApprovalStatus =
  | "pending"
  | "auto_approved"
  | "approved"
  | "rejected"
  | "revoked";

export type AgentLearningAssetType =
  | "lesson"
  | "pattern"
  | "decision_rule"
  | "playbook"
  | "skill_delta";
export type AgentLearningAssetScope = "self" | "org" | "tenant";
export type AgentLearningAssetConfidence = "low" | "medium" | "high";
export type AgentLearningAssetStatus = "active" | "superseded" | "expired" | "revoked";

export interface GroupMemoryCapsule {
  capsuleId: string;
  groupId: string;
  sourceType?: CapsuleSourceType;
  sourceIds?: string[];
  capsuleType?: GroupMemoryCapsuleType;
  title?: string;
  summary?: string;
  structuredContent?: Record<string, unknown>;
  sensitivity?: CapsuleSensitivity;
  reusability?: CapsuleReusability;
  confidentialityScope?: CapsuleConfidentialityScope;
  createdBy?: string;
  approvedBy?: string;
  approvedAt?: number;
  status?: CapsuleStatus;
  /** 候选胶囊被驳回时的审计字段（`status: "revoked"` 的原因）。 */
  rejectedBy?: string;
  rejectedAt?: number;
  rejectionReason?: string;
  createdAt?: number;
  updatedAt?: number;
  metadata?: FutureLearningMetadata;
}

export interface LearningProjection {
  projectionId: string;
  sourceGroupId: string;
  sourceCapsuleId: string;
  sourceParticipationId?: string;
  targetBotId: string;
  projectionType?: ProjectionType;
  transformationRule?: TransformationRule;
  sensitivity?: CapsuleSensitivity;
  confidentialityScope?: CapsuleConfidentialityScope;
  requiresApproval?: boolean;
  eligibilityReason?: ProjectionEligibilityReason;
  approvalStatus?: ProjectionApprovalStatus;
  approvedBy?: string;
  approvedAt?: number;
  expiresAt?: number;
  revokedAt?: number;
  revokeReason?: string;
  createdAt?: number;
  updatedAt?: number;
  metadata?: FutureLearningMetadata;
}

export interface AgentLearningAsset {
  assetId: string;
  botId: string;
  sourceGroupId: string;
  sourceCapsuleId: string;
  sourceProjectionId?: string;
  assetType?: AgentLearningAssetType;
  abstractedContent?: Record<string, unknown>;
  /**
   * @deprecated W4: legacy exposure alias. Prefer `injectedCount`.
   * Historically incremented on prompt injection; must NOT alone drive skill curation.
   * Kept in sync when recording `injected` for backward-compatible readers.
   */
  reuseCount?: number;
  lastReusedAt?: number;
  /** W4: times the asset was returned from storage for a recall read. */
  retrievedCount?: number;
  lastRetrievedAt?: number;
  /** W4: times the asset was actually injected into the system prompt (exposure). */
  injectedCount?: number;
  lastInjectedAt?: number;
  /**
   * W4: times the asset was observed as adopted (model followed it).
   * Requires an explicit adoption signal — prompt injection alone is not adoption.
   */
  adoptedCount?: number;
  lastAdoptedAt?: number;
  /**
   * W4: times a TaskOutcome closed success+eligible after this asset was injected.
   * This — not injection/exposure — is the curation threshold metric.
   */
  outcomeVerifiedCount?: number;
  lastOutcomeVerifiedAt?: number;
  /** 已由 outcome_verified 阈值策展成技能草稿时记录 skillId，避免重复生成。 */
  curatedSkillId?: string;
  curatedAt?: number;
  applicabilityScope?: AgentLearningAssetScope;
  confidence?: AgentLearningAssetConfidence;
  sensitivity?: CapsuleSensitivity;
  confidentialityScope?: CapsuleConfidentialityScope;
  transformationRule?: TransformationRule;
  version?: number;
  effectiveFrom?: number;
  effectiveTo?: number;
  status?: AgentLearningAssetStatus;
  createdAt?: number;
  updatedAt?: number;
  metadata?: FutureLearningMetadata;
}
