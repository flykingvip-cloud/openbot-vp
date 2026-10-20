import crypto from "node:crypto";
import {
  canPromoteProjectionToAsset,
  evaluateCapsuleProjectionEligibility,
  getProjectionPromotionFailureReason,
  type AgentLearningAsset,
  type GroupMemoryCapsule,
  type LearningProjection,
} from "@openbot/collaboration-core";

type PromotionActor = { actorId?: string; actorKind?: string };

export interface ProjectCapsuleResult {
  allowed: boolean;
  reason: string;
  projection?: LearningProjection;
}

export interface PromoteProjectionResult {
  promoted: boolean;
  reason: string;
  asset?: AgentLearningAsset;
}

export interface LearningPromotionService {
  projectCapsule(params: {
    groupId: string;
    capsule: GroupMemoryCapsule;
    targetBotId: string;
    actor: PromotionActor;
    sourceParticipationId?: string;
    approvalMode?: "auto" | "pending" | "approved";
  }): Promise<ProjectCapsuleResult>;
  promoteProjection(params: {
    projection: LearningProjection;
    capsule: GroupMemoryCapsule;
    actor: PromotionActor;
  }): Promise<PromoteProjectionResult>;
}

export type LearningPromotionDependencies = {
  createProjectionId?: () => string;
  createAssetId?: () => string;
  saveProjection?: (projection: LearningProjection) => Promise<void>;
  saveLearningAsset?: (asset: AgentLearningAsset) => Promise<void>;
};

function resolveProjectionApprovalStatus(params: {
  requiresApproval: boolean;
  approvalMode: "auto" | "pending" | "approved";
}): LearningProjection["approvalStatus"] {
  if (params.requiresApproval) {
    return params.approvalMode === "approved" ? "approved" : "pending";
  }
  if (params.approvalMode === "approved") {
    return "approved";
  }
  return "auto_approved";
}

function mapCapsuleTypeToAssetType(
  capsuleType: GroupMemoryCapsule["capsuleType"],
): AgentLearningAsset["assetType"] {
  switch (capsuleType) {
    case "decision_rule":
      return "decision_rule";
    case "playbook":
      return "playbook";
    case "skill_delta":
      return "skill_delta";
    case "pattern":
    case "anti_pattern":
      return "pattern";
    default:
      return "lesson";
  }
}

function readStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? [
        ...new Set(
          value
            .filter((entry): entry is string => typeof entry === "string")
            .map((entry) => entry.trim())
            .filter(Boolean),
        ),
      ]
    : [];
}

/**
 * 从胶囊里收拢"能力名"标签。
 *
 * 读回侧（`readPromotedCapabilitiesForBot`）只认 `abstractedContent.capabilities` /
 * `metadata.skills`，而此前本函数从不写这两个键 —— 结果是每一条晋升出来的学习资产
 * 读回时都是空数组（写得进、读不出）。这里统一从胶囊的多个来源归集。
 */
function collectCapabilities(capsule: GroupMemoryCapsule): string[] {
  const structuredContent = capsule.structuredContent ?? {};
  return [
    ...new Set([
      ...readStringList(structuredContent.capabilities),
      ...readStringList(structuredContent.skills),
      ...readStringList(capsule.metadata?.capabilities),
      ...readStringList(capsule.metadata?.skills),
    ]),
  ];
}

/**
 * 构造可复述的教训正文。
 *
 * `lesson` 是给系统提示词用的**人类可读单行**（读回侧直接渲染），与仅供审计的
 * `source` 原始结构化内容分开：前者进提示词，后者不进。
 */
function buildLessonText(params: {
  capsule: GroupMemoryCapsule;
  title?: string;
  summary?: string;
}): string | undefined {
  const parts = [params.title, params.summary].filter((part): part is string =>
    Boolean(part?.trim()),
  );
  if (parts.length === 0) {
    return undefined;
  }
  const prefix = params.capsule.capsuleType === "anti_pattern" ? "避免" : undefined;
  const body = [...new Set(parts)].join(" — ");
  return prefix ? `${prefix}：${body}` : body;
}

function buildAbstractedContent(params: {
  capsule: GroupMemoryCapsule;
  projection: LearningProjection;
}): Record<string, unknown> {
  const title = params.capsule.title?.trim();
  const summary = params.capsule.summary?.trim();
  const structuredContent = params.capsule.structuredContent ?? {};
  const capabilities = collectCapabilities(params.capsule);
  const lesson = buildLessonText({ capsule: params.capsule, title, summary });

  return {
    ...(title ? { title } : {}),
    ...(summary ? { summary } : {}),
    // 回流关键字段：没有它，晋升出来的资产在提示词里是不可见的。
    ...(lesson ? { lesson } : {}),
    ...(capabilities.length > 0 ? { capabilities } : {}),
    ...(params.capsule.capsuleType ? { capsuleType: params.capsule.capsuleType } : {}),
    ...(params.projection.transformationRule
      ? { transformationRule: params.projection.transformationRule }
      : {}),
    ...(Object.keys(structuredContent).length > 0 ? { source: structuredContent } : {}),
  };
}

export class DefaultLearningPromotionService implements LearningPromotionService {
  constructor(private readonly deps: LearningPromotionDependencies = {}) {}

  async projectCapsule(params: {
    groupId: string;
    capsule: GroupMemoryCapsule;
    targetBotId: string;
    actor: PromotionActor;
    sourceParticipationId?: string;
    approvalMode?: "auto" | "pending" | "approved";
  }): Promise<ProjectCapsuleResult> {
    if (params.capsule.groupId !== params.groupId) {
      return { allowed: false, reason: "group_mismatch" };
    }

    const eligibility = evaluateCapsuleProjectionEligibility(params.capsule, params.actor);
    if (!eligibility.allowed) {
      return { allowed: false, reason: eligibility.reason };
    }

    const projection: LearningProjection = {
      projectionId: this.deps.createProjectionId?.() ?? crypto.randomUUID(),
      sourceGroupId: params.groupId,
      sourceCapsuleId: params.capsule.capsuleId,
      ...(params.sourceParticipationId
        ? { sourceParticipationId: params.sourceParticipationId }
        : {}),
      targetBotId: params.targetBotId,
      projectionType: eligibility.projectionType,
      transformationRule: eligibility.transformationRule,
      sensitivity: params.capsule.sensitivity,
      confidentialityScope: params.capsule.confidentialityScope,
      requiresApproval: eligibility.requiresApproval,
      eligibilityReason: eligibility.reason,
      approvalStatus: resolveProjectionApprovalStatus({
        requiresApproval: eligibility.requiresApproval,
        approvalMode: params.approvalMode ?? "auto",
      }),
      ...(params.actor.actorId &&
      (params.approvalMode === "approved" || !eligibility.requiresApproval)
        ? { approvedBy: params.actor.actorId, approvedAt: Date.now() }
        : {}),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await this.deps.saveProjection?.(projection);
    return { allowed: true, reason: projection.approvalStatus ?? "created", projection };
  }

  async promoteProjection(params: {
    projection: LearningProjection;
    capsule: GroupMemoryCapsule;
    actor: PromotionActor;
  }): Promise<PromoteProjectionResult> {
    const reason = getProjectionPromotionFailureReason(
      params.projection,
      params.capsule,
      params.actor,
    );
    if (reason !== "ok") {
      return { promoted: false, reason };
    }

    if (!canPromoteProjectionToAsset(params.projection, params.capsule, params.actor)) {
      return { promoted: false, reason: "promotion_blocked" };
    }

    const asset: AgentLearningAsset = {
      assetId: this.deps.createAssetId?.() ?? crypto.randomUUID(),
      botId: params.projection.targetBotId,
      sourceGroupId: params.projection.sourceGroupId,
      sourceCapsuleId: params.projection.sourceCapsuleId,
      sourceProjectionId: params.projection.projectionId,
      assetType: mapCapsuleTypeToAssetType(params.capsule.capsuleType),
      abstractedContent: buildAbstractedContent({
        capsule: params.capsule,
        projection: params.projection,
      }),
      applicabilityScope:
        params.projection.projectionType === "personal_transferable" ? "tenant" : "self",
      confidence:
        params.capsule.reusability === "exportable"
          ? "high"
          : params.capsule.reusability === "reusable"
            ? "medium"
            : "low",
      sensitivity: params.projection.sensitivity ?? params.capsule.sensitivity,
      confidentialityScope:
        params.projection.confidentialityScope ?? params.capsule.confidentialityScope,
      transformationRule: params.projection.transformationRule,
      version: 1,
      effectiveFrom: Date.now(),
      status: "active",
      reuseCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await this.deps.saveLearningAsset?.(asset);
    return { promoted: true, reason: "promoted", asset };
  }
}
