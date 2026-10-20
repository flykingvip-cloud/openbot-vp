import type {
  AgentLearningAsset,
  CapsuleSensitivity,
  GroupMemoryCapsule,
  LearningProjection,
  ProjectionEligibilityReason,
  ProjectionType,
  TransformationRule,
} from "../types/learning.js";

type ProjectionActor = { actorId?: string; actorKind?: string };

export interface ProjectionEligibility {
  allowed: boolean;
  reason: ProjectionEligibilityReason;
  projectionType: ProjectionType;
  transformationRule?: TransformationRule;
  requiresApproval: boolean;
}

function isCapsuleApproved(capsule: GroupMemoryCapsule): boolean {
  return capsule.status === undefined || capsule.status === "approved";
}

function isCapsuleRevoked(capsule: GroupMemoryCapsule): boolean {
  return capsule.status === "revoked";
}

function normalizeSensitivity(capsule: GroupMemoryCapsule): CapsuleSensitivity {
  return capsule.sensitivity ?? "internal";
}

function requiresApprovalForSensitivity(sensitivity: CapsuleSensitivity): boolean {
  return sensitivity === "restricted";
}

function resolveProjectionType(capsule: GroupMemoryCapsule): ProjectionType {
  const sensitivity = normalizeSensitivity(capsule);
  const reusability = capsule.reusability ?? "group_only";

  if (sensitivity === "secret" || reusability === "group_only") {
    return "group_only";
  }

  if (sensitivity === "restricted") {
    return "personal_abstracted";
  }

  if (reusability === "exportable") {
    return "personal_transferable";
  }

  return "personal_abstracted";
}

function resolveTransformationRule(capsule: GroupMemoryCapsule): TransformationRule | undefined {
  const projectionType = resolveProjectionType(capsule);
  const sensitivity = normalizeSensitivity(capsule);
  const capsuleType = capsule.capsuleType;

  if (projectionType === "group_only" || projectionType === "none") {
    return undefined;
  }

  if (sensitivity === "restricted") {
    return capsuleType === "decision_rule" ? "policy_only" : "anonymized";
  }

  if (capsuleType === "decision_rule" || capsuleType === "playbook") {
    return "policy_only";
  }

  if (capsuleType === "pattern" || capsuleType === "anti_pattern") {
    return "pattern_only";
  }

  return "summary";
}

export function evaluateCapsuleProjectionEligibility(
  capsule: GroupMemoryCapsule,
  actor: ProjectionActor,
): ProjectionEligibility {
  if (!actor.actorId?.trim()) {
    return {
      allowed: false,
      reason: "missing_actor",
      projectionType: "none",
      requiresApproval: false,
    };
  }

  if (isCapsuleRevoked(capsule)) {
    return {
      allowed: false,
      reason: "capsule_revoked",
      projectionType: "none",
      requiresApproval: false,
    };
  }

  if (!isCapsuleApproved(capsule)) {
    return {
      allowed: false,
      reason: "capsule_not_approved",
      projectionType: "none",
      requiresApproval: false,
    };
  }

  const sensitivity = normalizeSensitivity(capsule);
  const projectionType = resolveProjectionType(capsule);
  const transformationRule = resolveTransformationRule(capsule);
  const requiresApproval = requiresApprovalForSensitivity(sensitivity);

  if (projectionType === "group_only") {
    return {
      allowed: false,
      reason: sensitivity === "secret" ? "secret_capsule" : "group_only_capsule",
      projectionType,
      requiresApproval,
    };
  }

  return {
    allowed: true,
    reason: requiresApproval ? "restricted_capsule_requires_approval" : "ok",
    projectionType,
    transformationRule,
    requiresApproval,
  };
}

export function canProjectCapsuleToLearningAsset(
  capsule: GroupMemoryCapsule,
  actor: ProjectionActor,
): boolean {
  return evaluateCapsuleProjectionEligibility(capsule, actor).allowed;
}

export function canBindCapsuleToBot(botId: string, capsule: GroupMemoryCapsule): boolean {
  if (!botId.trim()) {
    return false;
  }
  return evaluateCapsuleProjectionEligibility(capsule, {
    actorId: botId,
    actorKind: "bot",
  }).allowed;
}

export function canRevokeLearningAsset(asset: AgentLearningAsset): boolean {
  return asset.status === undefined || asset.status === "active";
}

function isProjectionApproved(projection: LearningProjection): boolean {
  if (projection.approvalStatus === "rejected") {
    return false;
  }

  if (projection.requiresApproval) {
    return projection.approvalStatus === "approved";
  }

  return (
    projection.approvalStatus === undefined ||
    projection.approvalStatus === "approved" ||
    projection.approvalStatus === "auto_approved"
  );
}

function isProjectionPromotable(projection: LearningProjection): boolean {
  return (
    projection.projectionType === "personal_abstracted" ||
    projection.projectionType === "personal_transferable"
  );
}

function isProjectionExpired(projection: LearningProjection, now = Date.now()): boolean {
  return typeof projection.expiresAt === "number" && projection.expiresAt <= now;
}

function resolvePromotionFailureReason(
  projection: LearningProjection,
): ProjectionEligibilityReason | null {
  if (projection.approvalStatus === "rejected") {
    return "projection_rejected";
  }
  if (projection.approvalStatus === "revoked" || typeof projection.revokedAt === "number") {
    return "projection_revoked";
  }
  if (isProjectionExpired(projection)) {
    return "projection_expired";
  }
  if (!isProjectionPromotable(projection)) {
    return "projection_not_promotable";
  }
  if (!isProjectionApproved(projection)) {
    return "projection_not_approved";
  }
  return null;
}

export function canPromoteProjectionToAsset(
  projection: LearningProjection,
  capsule: GroupMemoryCapsule,
  actor: ProjectionActor,
): boolean {
  const eligibility = evaluateCapsuleProjectionEligibility(capsule, actor);

  if (!eligibility.allowed) {
    return false;
  }

  return resolvePromotionFailureReason(projection) === null;
}

export function getProjectionPromotionFailureReason(
  projection: LearningProjection,
  capsule: GroupMemoryCapsule,
  actor: ProjectionActor,
): ProjectionEligibilityReason {
  const eligibility = evaluateCapsuleProjectionEligibility(capsule, actor);
  if (!eligibility.allowed) {
    return eligibility.reason;
  }
  return resolvePromotionFailureReason(projection) ?? "ok";
}
