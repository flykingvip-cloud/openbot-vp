/**
 * Shared capsule → projection → AgentLearningAsset promotion (evolution closure).
 *
 * Invoked only after governance approval (`collaboration.capsule.transition(approved)`)
 * so task / review / memory-flush capsules share the same eligibility, audit, and persistence rules.
 */

import type {
  CapsuleReusability,
  CapsuleSensitivity,
  GroupMemoryCapsule,
  ParticipationConfidentialityTier,
} from "@openbot/collaboration-core";
import { DefaultLearningPromotionService } from "@openbot/collaboration-runtime";
import { listAgentIds } from "../../agents/agent-scope.js";
import { loadConfig } from "../../config/config.js";
import { normalizeAgentId } from "../../routing/session-key.js";
import { stringValue } from "../records.js";
import { evaluateGroupPromotionPolicy, recordPromotionAudit } from "./promotion-audit.js";
import { createWorkspaceCollaborationStores, resolveCollaborationGroupTenantId } from "./shared.js";

export type CapsulePromotionResult = {
  promoted: boolean;
  reason: string;
  projectionId?: string;
  assetId?: string;
  targetBotId?: string;
};

/** Default reusability upgrade on governance approve (unless explicit or secret). */
export function resolveReusabilityOnApprove(
  capsule: GroupMemoryCapsule,
  explicit?: CapsuleReusability,
): CapsuleReusability {
  if (explicit) {
    return explicit;
  }
  if (capsule.sensitivity === "secret") {
    return capsule.reusability ?? "group_only";
  }
  if ((capsule.reusability ?? "group_only") === "group_only") {
    return "promotable";
  }
  return capsule.reusability ?? "group_only";
}

function readMetadataString(capsule: GroupMemoryCapsule, key: string): string | undefined {
  return stringValue(capsule.metadata?.[key]) ?? undefined;
}

/** Resolve bot target for projection from capsule authorship / participation metadata. */
export function resolveTargetBotIdForCapsule(
  capsule: GroupMemoryCapsule,
  validAgentIds: string[],
): string | null {
  const normalizedIds = new Set(validAgentIds.map((id) => normalizeAgentId(id)));
  const createdBy = capsule.createdBy?.trim();
  if (createdBy) {
    const normalized = normalizeAgentId(createdBy);
    if (normalizedIds.has(normalized)) {
      return normalized;
    }
  }
  const participationId = readMetadataString(capsule, "sourceParticipationId");
  if (participationId) {
    const botPart = participationId.split("::").at(1)?.trim();
    if (botPart) {
      const normalized = normalizeAgentId(botPart);
      if (normalizedIds.has(normalized)) {
        return normalized;
      }
    }
  }
  for (const sourceId of capsule.sourceIds ?? []) {
    const trimmed = sourceId.trim();
    if (!trimmed) {
      continue;
    }
    const normalized = normalizeAgentId(trimmed);
    if (normalizedIds.has(normalized)) {
      return normalized;
    }
  }
  return null;
}

function mapSensitivityToTier(sensitivity: CapsuleSensitivity | undefined): string | null {
  switch (sensitivity) {
    case "secret":
      return "secret";
    case "restricted":
      return "restricted";
    case "public":
      return "public";
    default:
      return "internal";
  }
}

export async function promoteApprovedCapsuleIfEligible(params: {
  groupId: string;
  capsule: GroupMemoryCapsule;
  actor?: string;
  targetBotId?: string;
  approvalMode?: "auto" | "pending" | "approved";
  confidentialityTier?: ParticipationConfidentialityTier;
  sourceParticipationId?: string;
  learningStorage?: ReturnType<typeof createWorkspaceCollaborationStores>["learningStorage"];
}): Promise<CapsulePromotionResult> {
  const groupId = params.groupId.trim();
  const capsule = params.capsule;
  const tenantIdForLedger = resolveCollaborationGroupTenantId(groupId);
  if (capsule.status !== "approved") {
    return { promoted: false, reason: "capsule_not_approved" };
  }

  const cfg = loadConfig();
  const validAgentIds = listAgentIds(cfg);
  const targetBotId =
    params.targetBotId?.trim() || resolveTargetBotIdForCapsule(capsule, validAgentIds) || null;
  if (!targetBotId) {
    await recordPromotionAudit({
      groupId,
      ...(tenantIdForLedger ? { tenantId: tenantIdForLedger } : {}),
      sourceGroupId: groupId,
      botId: "unknown",
      capsuleId: capsule.capsuleId,
      promoted: false,
      reason: "missing_bot",
      targetScope: "personal",
    }).catch(() => undefined);
    return { promoted: false, reason: "missing_bot" };
  }

  const { learningStorage } = params.learningStorage
    ? { learningStorage: params.learningStorage }
    : createWorkspaceCollaborationStores();
  const promotionService = new DefaultLearningPromotionService({
    saveProjection: async (projection) => {
      await learningStorage.appendProjection(groupId, projection);
    },
    saveLearningAsset: async (asset) => {
      await learningStorage.appendLearningAsset(groupId, asset);
    },
  });

  const actorId = params.actor?.trim() || targetBotId;
  const sourceParticipationId =
    params.sourceParticipationId ?? readMetadataString(capsule, "sourceParticipationId");

  const projectionResult = await promotionService.projectCapsule({
    groupId,
    capsule,
    targetBotId,
    actor: { actorId, actorKind: "operator" },
    ...(sourceParticipationId ? { sourceParticipationId } : {}),
    approvalMode: params.approvalMode ?? "auto",
  });

  if (!projectionResult.allowed || !projectionResult.projection) {
    await recordPromotionAudit({
      groupId,
      ...(tenantIdForLedger ? { tenantId: tenantIdForLedger } : {}),
      sourceGroupId: groupId,
      botId: targetBotId,
      capsuleId: capsule.capsuleId,
      promoted: false,
      reason: projectionResult.reason,
      targetScope: "personal",
    }).catch(() => undefined);
    return {
      promoted: false,
      reason: projectionResult.reason,
      targetBotId,
    };
  }

  const promotionPolicy = await evaluateGroupPromotionPolicy({
    groupId,
    ...(tenantIdForLedger ? { tenantId: tenantIdForLedger } : {}),
    confidentialityTier:
      params.confidentialityTier ?? mapSensitivityToTier(capsule.sensitivity) ?? "internal",
  });
  if (!promotionPolicy.allowed) {
    await recordPromotionAudit({
      groupId,
      ...(tenantIdForLedger ? { tenantId: tenantIdForLedger } : {}),
      sourceGroupId: groupId,
      botId: targetBotId,
      capsuleId: capsule.capsuleId,
      projectionId: projectionResult.projection.projectionId,
      promoted: false,
      reason: promotionPolicy.reason,
      targetScope: "personal",
    }).catch(() => undefined);
    return {
      promoted: false,
      reason: promotionPolicy.reason,
      projectionId: projectionResult.projection.projectionId,
      targetBotId,
    };
  }

  const promoteResult = await promotionService.promoteProjection({
    projection: projectionResult.projection,
    capsule,
    actor: { actorId, actorKind: "operator" },
  });

  await recordPromotionAudit({
    groupId,
    sourceGroupId: groupId,
    botId: targetBotId,
    capsuleId: capsule.capsuleId,
    projectionId: projectionResult.projection.projectionId,
    assetId: promoteResult.asset?.assetId,
    promoted: promoteResult.promoted,
    reason: promoteResult.reason,
    targetScope: "personal",
  }).catch(() => undefined);

  return {
    promoted: promoteResult.promoted,
    reason: promoteResult.reason,
    projectionId: projectionResult.projection.projectionId,
    ...(promoteResult.asset ? { assetId: promoteResult.asset.assetId } : {}),
    targetBotId,
  };
}
