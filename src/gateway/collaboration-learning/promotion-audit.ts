import { appendCollaborationPromotionAuditRecord } from "../collaboration-ledger/writer.js";
import { readCollaborationBehaviorBuffer } from "./behavior-buffer.js";
import type { GroupLifecycleStatus, GroupPromotionPolicy } from "./group-charter-types.js";
import { readGroupCharter } from "./group-charter.js";
import { DEFAULT_GROUP_PROMOTION_POLICY } from "./promotion-policy.js";
import { createWorkspaceCollaborationStores } from "./shared.js";

export type PromotionAuditDecision = {
  allowed: boolean;
  reason: string;
  policy: GroupPromotionPolicy;
  lifecycleStatus: GroupLifecycleStatus;
};

export function resolvePromotionPolicyFromCharter(charter: {
  lifecycleStatus: GroupLifecycleStatus;
  promotionPolicy?: Partial<GroupPromotionPolicy> | null;
}): GroupPromotionPolicy {
  return {
    ...DEFAULT_GROUP_PROMOTION_POLICY,
    ...charter.promotionPolicy,
  };
}

export async function evaluateGroupPromotionPolicy(params: {
  groupId: string;
  confidentialityTier?: string | null;
  /** P0.1 Q2: trusted tenant for runtime-namespace ledger/behavior reads. */
  tenantId?: string | null;
}): Promise<PromotionAuditDecision> {
  const { fileStore, groupStorage } = createWorkspaceCollaborationStores();
  const [charter, behaviorBuffer, profile] = await Promise.all([
    readGroupCharter({ fileStore, groupId: params.groupId }),
    readCollaborationBehaviorBuffer(params.groupId, params.tenantId),
    groupStorage.readProfile(params.groupId),
  ]);
  if (!charter && !profile) {
    return {
      allowed: true,
      reason: "default_allowed",
      policy: DEFAULT_GROUP_PROMOTION_POLICY,
      lifecycleStatus: "ACTIVE",
    };
  }
  const lifecycleStatus = charter?.lifecycleStatus ?? "ACTIVE";
  const policy = charter
    ? resolvePromotionPolicyFromCharter(charter)
    : DEFAULT_GROUP_PROMOTION_POLICY;
  if (policy.requireLifecycleActive && lifecycleStatus !== "ACTIVE") {
    return {
      allowed: false,
      reason: "lifecycle_blocked",
      policy,
      lifecycleStatus,
    };
  }
  if (!policy.allowAutoPromote) {
    return {
      allowed: false,
      reason: "auto_promote_disabled",
      policy,
      lifecycleStatus,
    };
  }
  if (policy.blockSecretAutoPromote && params.confidentialityTier === "secret") {
    return {
      allowed: false,
      reason: "secret_requires_review",
      policy,
      lifecycleStatus,
    };
  }
  const minRate = policy.minGroupParticipationRate;
  const aggregateParticipationRate = behaviorBuffer?.aggregateParticipationRate;
  if (
    typeof minRate === "number" &&
    typeof aggregateParticipationRate === "number" &&
    aggregateParticipationRate < minRate
  ) {
    return {
      allowed: false,
      reason: "low_group_participation",
      policy,
      lifecycleStatus,
    };
  }
  return {
    allowed: true,
    reason: "allowed",
    policy,
    lifecycleStatus,
  };
}

export async function recordPromotionAudit(params: {
  groupId: string;
  botId: string;
  capsuleId?: string;
  projectionId?: string;
  assetId?: string;
  promoted: boolean;
  reason: string;
  sourceGroupId: string;
  targetScope: "personal" | "group" | "tenant";
  /** P0.1 Q2: trusted tenant for runtime-namespace ledger writes. */
  tenantId?: string | null;
}): Promise<void> {
  await appendCollaborationPromotionAuditRecord(params);
}

export { DEFAULT_GROUP_PROMOTION_POLICY } from "./promotion-policy.js";
