/**
 * Collaboration context P3 — private long-term memory promote-only path.
 *
 * Hard invariants:
 * - Bot private LTM stays in personal learning scope (`agent:<botId>`) only.
 * - Entry into group memory / learning assets requires an explicit **promote**
 *   that reuses DefaultLearningPromotionService + promotion audit
 *   (confidentiality + ledger). Never a dirty write into GROUP_PUBLIC.
 * - Per-bot private-chat (DM) history must not be mirrored into GROUP_PUBLIC.
 * - GROUP_PUBLIC remains SoT for group transcript; no per-bot full history copy.
 *
 * Flag: collaboration.learning.privateMemoryPromote (default OFF).
 * Floor live unchanged.
 */

import type { CapsuleSensitivity, GroupMemoryCapsule } from "@openbot/collaboration-core";
import { DefaultLearningPromotionService } from "@openbot/collaboration-runtime";
import { resolvePersonalLearningScopeId } from "../../auto-reply/reply/learning-recall.js";
import type { OpenBotConfig } from "../../config/config.js";
import { readCollaborationBehaviorBuffer } from "./behavior-buffer.js";
import { readGroupCharter } from "./group-charter.js";
import {
  evaluateGroupPromotionPolicy,
  recordPromotionAudit,
  resolvePromotionPolicyFromCharter,
  type PromotionAuditDecision,
} from "./promotion-audit.js";
import { DEFAULT_GROUP_PROMOTION_POLICY } from "./promotion-policy.js";
import { createWorkspaceCollaborationStores, resolveCollaborationGroupTenantId } from "./shared.js";

/** Marker on private LTM payloads — must never serialize into GROUP_PUBLIC. */
export const PRIVATE_LTM_MARKER = "__privateLongTermMemory" as const;

/** Marker on attempted DM-history mirror payloads — refused on transcript write. */
export const PRIVATE_DM_HISTORY_MIRROR_MARKER = "__privateDmHistoryMirror" as const;

export type CollaborationPrivateLongTermMemory = {
  readonly [PRIVATE_LTM_MARKER]: true;
  botId: string;
  /** Personal learning scope id (`agent:<botId>`). */
  scopeId: string;
  capsuleId?: string;
  summary?: string;
  createdAtMs: number;
};

export type PrivateMemoryPromoteResult = {
  promoted: boolean;
  reason: string;
  projectionId?: string;
  assetId?: string;
  sourceScopeId?: string;
  groupId?: string;
  confidentialityTier?: string;
};

export function isCollaborationPrivateMemoryPromoteEnabled(cfg?: OpenBotConfig | null): boolean {
  return cfg?.collaboration?.learning?.privateMemoryPromote === true;
}

export function resolvePrivateMemoryScopeId(botId: string): string {
  return resolvePersonalLearningScopeId(botId);
}

export function createPrivateLongTermMemoryRecord(params: {
  botId: string;
  capsuleId?: string;
  summary?: string;
  createdAtMs?: number;
}): CollaborationPrivateLongTermMemory {
  const botId = params.botId.trim();
  if (!botId) {
    throw new Error("createPrivateLongTermMemoryRecord: botId is required");
  }
  return {
    [PRIVATE_LTM_MARKER]: true,
    botId,
    scopeId: resolvePrivateMemoryScopeId(botId),
    ...(params.capsuleId?.trim() ? { capsuleId: params.capsuleId.trim() } : {}),
    ...(params.summary?.trim() ? { summary: params.summary.trim() } : {}),
    createdAtMs: params.createdAtMs ?? Date.now(),
  };
}

const PRIVATE_LTM_BODY_RE = /"__privateLongTermMemory"\s*:\s*true/;
const PRIVATE_DM_MIRROR_BODY_RE = /"__privateDmHistoryMirror"\s*:\s*true/;

function recordHasTrueMarker(
  record: Record<string, unknown>,
  key: typeof PRIVATE_LTM_MARKER | typeof PRIVATE_DM_HISTORY_MIRROR_MARKER,
): boolean {
  return record[key] === true;
}

/** True when a value embeds private LTM that must not hit GROUP_PUBLIC without promote. */
export function containsPrivateLongTermMemoryMarker(value: unknown): boolean {
  if (typeof value === "string") {
    return PRIVATE_LTM_BODY_RE.test(value);
  }
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (recordHasTrueMarker(record, PRIVATE_LTM_MARKER)) {
    return true;
  }
  if (record.privateLongTermMemory && typeof record.privateLongTermMemory === "object") {
    return recordHasTrueMarker(
      record.privateLongTermMemory as Record<string, unknown>,
      PRIVATE_LTM_MARKER,
    );
  }
  for (const nested of Object.values(record)) {
    if (typeof nested === "string" && PRIVATE_LTM_BODY_RE.test(nested)) {
      return true;
    }
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      if (recordHasTrueMarker(nested as Record<string, unknown>, PRIVATE_LTM_MARKER)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * True when a payload attempts to mirror per-bot private-chat history into
 * GROUP_PUBLIC (forbidden; GROUP_PUBLIC remains SoT via normal group writes only).
 */
export function containsPrivateDmHistoryMirrorMarker(value: unknown): boolean {
  if (typeof value === "string") {
    return PRIVATE_DM_MIRROR_BODY_RE.test(value);
  }
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (recordHasTrueMarker(record, PRIVATE_DM_HISTORY_MIRROR_MARKER)) {
    return true;
  }
  if (record.privateDmHistoryMirror === true) {
    return true;
  }
  if (record.source === "private_dm_history_mirror" || record.source === "private_dm_mirror") {
    return true;
  }
  for (const nested of Object.values(record)) {
    if (typeof nested === "string" && PRIVATE_DM_MIRROR_BODY_RE.test(nested)) {
      return true;
    }
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      const nestedRecord = nested as Record<string, unknown>;
      if (recordHasTrueMarker(nestedRecord, PRIVATE_DM_HISTORY_MIRROR_MARKER)) {
        return true;
      }
      if (nestedRecord.source === "private_dm_history_mirror") {
        return true;
      }
    }
  }
  return false;
}

/**
 * Hard guard for GROUP_PUBLIC / transcript writers.
 * Refuses private LTM dirty writes and private-DM history mirrors.
 */
export function assertNoPrivateMemoryDirtyWriteToGroupPublic(
  value: unknown,
  context = "GROUP_PUBLIC",
): void {
  if (containsPrivateLongTermMemoryMarker(value)) {
    throw new Error(
      `Refusing to write private long-term memory into ${context}; use explicit promote to group learning assets`,
    );
  }
  if (containsPrivateDmHistoryMirrorMarker(value)) {
    throw new Error(
      `Refusing to mirror private-chat history into ${context}; GROUP_PUBLIC remains SoT without per-bot DM copies`,
    );
  }
}

function mapTierToSensitivity(tier: string | undefined): CapsuleSensitivity {
  switch (tier) {
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

function mapSensitivityToTier(sensitivity: CapsuleSensitivity | undefined): string {
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

/**
 * Rewrite a personal-scope capsule so it can enter the group learning pathway.
 * Does **not** write transcript; only prepares a group-scoped capsule clone.
 */
export function preparePrivateCapsuleForGroupPromote(params: {
  capsule: GroupMemoryCapsule;
  groupId: string;
  botId?: string;
  confidentialityTier?: string;
  actorId?: string;
}): GroupMemoryCapsule {
  const groupId = params.groupId.trim();
  const now = Date.now();
  const tier =
    params.confidentialityTier ?? mapSensitivityToTier(params.capsule.sensitivity) ?? "internal";
  const scopeBot = params.botId?.trim() || params.capsule.createdBy?.trim() || "unknown";
  const approved =
    params.capsule.status === "approved"
      ? params.capsule
      : {
          ...params.capsule,
          status: "approved" as const,
          approvedBy: params.actorId?.trim() || params.capsule.createdBy || "promote",
          approvedAt: now,
          reusability:
            params.capsule.reusability === "group_only" || !params.capsule.reusability
              ? ("promotable" as const)
              : params.capsule.reusability,
        };

  return {
    ...approved,
    groupId,
    sensitivity: mapTierToSensitivity(tier),
    confidentialityScope: approved.confidentialityScope ?? "group",
    updatedAt: now,
    metadata: {
      ...approved.metadata,
      promotedFromPrivateScope: true,
      sourcePrivateScopeId: resolvePrivateMemoryScopeId(scopeBot),
      confidentialityTier: tier,
    },
  };
}

/**
 * Evaluate target-group promotion policy against an explicit trusted locator.
 * Kept in this landing stream so privateMemory.promote does not reopen default
 * workspace stores for charter/profile (FLOOR promotion-audit stays untouched).
 */
export async function evaluatePrivateMemoryTargetPromotionPolicy(params: {
  groupId: string;
  confidentialityTier?: string | null;
  tenantId?: string | null;
  fileStore: ReturnType<typeof createWorkspaceCollaborationStores>["fileStore"];
  groupStorage: ReturnType<typeof createWorkspaceCollaborationStores>["groupStorage"];
}): Promise<PromotionAuditDecision> {
  const [charter, behaviorBuffer, profile] = await Promise.all([
    readGroupCharter({ fileStore: params.fileStore, groupId: params.groupId }),
    readCollaborationBehaviorBuffer(params.groupId, params.tenantId),
    params.groupStorage.readProfile(params.groupId),
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

export type PromotePrivateMemoryDeps = {
  cfg?: OpenBotConfig | null;
  learningStorage?: ReturnType<typeof createWorkspaceCollaborationStores>["learningStorage"];
  /** Trusted target fileStore for policy/charter reads (same locator as writes). */
  fileStore?: ReturnType<typeof createWorkspaceCollaborationStores>["fileStore"];
  /** Trusted target groupStorage for policy/profile reads (same locator as writes). */
  groupStorage?: ReturnType<typeof createWorkspaceCollaborationStores>["groupStorage"];
  recordAudit?: typeof recordPromotionAudit;
  evaluatePolicy?: typeof evaluateGroupPromotionPolicy;
  /** Trusted tenant from authorized caller (RPC ctx); preferred over group-id resolution. */
  tenantId?: string | null;
  createProjectionId?: () => string;
  createAssetId?: () => string;
};

/** Idempotency key: source scope + capsule version + target tenant/group + bot. */
export function buildPrivateMemoryPromoteIdempotencyKey(params: {
  sourceScopeId: string;
  capsuleId: string;
  capsuleVersion: string | number;
  groupId: string;
  botId: string;
  tenantId?: string | null;
}): string {
  const tenant = (params.tenantId?.trim() || "personal").replace(/[^a-zA-Z0-9._:-]/g, "_");
  const scope = params.sourceScopeId.trim() || "unknown-scope";
  const capsuleId = params.capsuleId.trim() || "unknown-capsule";
  const version = String(params.capsuleVersion ?? 0);
  const groupId = params.groupId.trim() || "unknown-group";
  const botId = params.botId.trim() || "unknown-bot";
  return `privprom:${tenant}:${scope}:${capsuleId}:v${version}:${groupId}:${botId}`;
}

export function stablePrivatePromoteProjectionId(idempotencyKey: string): string {
  return `proj:${idempotencyKey}`;
}

export function stablePrivatePromoteAssetId(idempotencyKey: string): string {
  return `asset:${idempotencyKey}`;
}

/**
 * Explicit promote: private LTM capsule (personal scope) → group learning asset.
 *
 * - Flag OFF → `{ promoted: false, reason: "flag_off" }` (no side effects).
 * - Never appends to GROUP_PUBLIC transcript.
 * - Reuses DefaultLearningPromotionService + evaluateGroupPromotionPolicy + audit.
 */
export async function promotePrivateMemoryCapsuleToGroup(params: {
  botId: string;
  groupId: string;
  capsule: GroupMemoryCapsule;
  actor?: string;
  confidentialityTier?: string;
  deps?: PromotePrivateMemoryDeps;
}): Promise<PrivateMemoryPromoteResult> {
  const botId = params.botId.trim();
  const groupId = params.groupId.trim();
  const sourceScopeId = resolvePrivateMemoryScopeId(botId);
  const cfg = params.deps?.cfg;
  const confidentialityTier =
    params.confidentialityTier ?? mapSensitivityToTier(params.capsule.sensitivity) ?? "internal";

  if (!isCollaborationPrivateMemoryPromoteEnabled(cfg ?? null)) {
    return {
      promoted: false,
      reason: "flag_off",
      sourceScopeId,
      groupId,
      confidentialityTier,
    };
  }
  if (!botId || !groupId) {
    return { promoted: false, reason: "missing_bot_or_group", sourceScopeId, groupId };
  }

  const learningStorage =
    params.deps?.learningStorage ?? createWorkspaceCollaborationStores().learningStorage;
  const recordAudit = params.deps?.recordAudit ?? recordPromotionAudit;
  // Prefer trusted tenant from authorized caller; fall back to group-derived ledger tenant.
  const tenantIdForLedger =
    params.deps?.tenantId !== undefined
      ? params.deps.tenantId
      : resolveCollaborationGroupTenantId(groupId);
  const actorId = params.actor?.trim() || botId;

  const groupCapsule = preparePrivateCapsuleForGroupPromote({
    capsule: params.capsule,
    groupId,
    botId,
    confidentialityTier,
    actorId,
  });

  // Gates BEFORE any target persistence: policy/lifecycle/sensitivity must not
  // leave a capsule body in the target group on deny (audit-only on reject).
  const hasTrustedFile = params.deps?.fileStore != null;
  const hasTrustedGroup = params.deps?.groupStorage != null;
  if (hasTrustedFile !== hasTrustedGroup) {
    return {
      promoted: false,
      reason: "trusted_policy_stores_incomplete",
      sourceScopeId,
      groupId,
      confidentialityTier,
    };
  }

  const policyArgs = {
    groupId,
    // Preserve explicit null from trusted caller (do not drop via truthy spread).
    ...(params.deps?.tenantId !== undefined || tenantIdForLedger
      ? { tenantId: tenantIdForLedger ?? null }
      : {}),
    confidentialityTier,
  };

  let promotionPolicy: PromotionAuditDecision;
  if (params.deps?.evaluatePolicy) {
    promotionPolicy = await params.deps.evaluatePolicy({
      ...policyArgs,
      ...(params.deps.fileStore ? { fileStore: params.deps.fileStore } : {}),
      ...(params.deps.groupStorage ? { groupStorage: params.deps.groupStorage } : {}),
    } as Parameters<typeof evaluateGroupPromotionPolicy>[0]);
  } else if (hasTrustedFile && params.deps?.fileStore && params.deps?.groupStorage) {
    // Bind charter/profile to the same trusted locator as writes — do not reopen defaults.
    promotionPolicy = await evaluatePrivateMemoryTargetPromotionPolicy({
      ...policyArgs,
      fileStore: params.deps.fileStore,
      groupStorage: params.deps.groupStorage,
    });
  } else {
    promotionPolicy = await evaluateGroupPromotionPolicy(policyArgs);
  }
  if (!promotionPolicy.allowed) {
    await recordAudit({
      groupId,
      ...(tenantIdForLedger ? { tenantId: tenantIdForLedger } : {}),
      sourceGroupId: sourceScopeId,
      botId,
      capsuleId: groupCapsule.capsuleId,
      promoted: false,
      reason: promotionPolicy.reason,
      targetScope: "group",
    }).catch(() => undefined);
    return {
      promoted: false,
      reason: promotionPolicy.reason,
      sourceScopeId,
      groupId,
      confidentialityTier,
    };
  }

  const capsuleVersion =
    params.capsule.updatedAt ?? params.capsule.approvedAt ?? params.capsule.createdAt ?? 0;
  const idempotencyKey = buildPrivateMemoryPromoteIdempotencyKey({
    sourceScopeId,
    capsuleId: groupCapsule.capsuleId,
    capsuleVersion,
    groupId,
    botId,
    tenantId: tenantIdForLedger,
  });
  const projectionId =
    params.deps?.createProjectionId?.() ?? stablePrivatePromoteProjectionId(idempotencyKey);
  const assetId = params.deps?.createAssetId?.() ?? stablePrivatePromoteAssetId(idempotencyKey);

  // Operational idempotency: if the stable asset already exists, return the same
  // receipt without rebuilding status/reuseCount/createdAt/version (network retry
  // must not resurrect revoked assets or clear counters).
  if (typeof learningStorage.readLearningAssets === "function") {
    const existingAssets = await learningStorage.readLearningAssets(groupId, botId);
    const existingAsset = existingAssets.find((entry) => entry.assetId === assetId);
    if (existingAsset) {
      const existingProjectionId = existingAsset.sourceProjectionId?.trim() || projectionId;
      await recordAudit({
        groupId,
        ...(tenantIdForLedger ? { tenantId: tenantIdForLedger } : {}),
        sourceGroupId: sourceScopeId,
        botId,
        capsuleId: groupCapsule.capsuleId,
        projectionId: existingProjectionId,
        assetId: existingAsset.assetId,
        promoted: true,
        reason: "promoted",
        targetScope: "group",
      }).catch(() => undefined);
      return {
        promoted: true,
        reason: "promoted",
        projectionId: existingProjectionId,
        assetId: existingAsset.assetId,
        sourceScopeId,
        groupId,
        confidentialityTier,
      };
    }
  }

  // Persist approved clone into group capsule store (learning pathway), not transcript.
  await learningStorage.appendCapsule(groupId, groupCapsule);

  const promotionService = new DefaultLearningPromotionService({
    createProjectionId: () => projectionId,
    createAssetId: () => assetId,
    saveProjection: async (projection) => {
      // Preserve an already-persisted projection row (partial-retry no-op).
      if (typeof learningStorage.readProjections === "function") {
        const existing = await learningStorage.readProjections(groupId);
        if (existing.some((entry) => entry.projectionId === projection.projectionId)) {
          return;
        }
      }
      await learningStorage.appendProjection(groupId, projection);
    },
    saveLearningAsset: async (asset) => {
      // Belt-and-suspenders: never overwrite lifecycle/counters on stable id hit.
      if (typeof learningStorage.readLearningAssets === "function") {
        const existing = await learningStorage.readLearningAssets(groupId);
        const prior = existing.find((entry) => entry.assetId === asset.assetId);
        if (prior) {
          return;
        }
      }
      await learningStorage.appendLearningAsset(groupId, asset);
    },
  });

  const projectionResult = await promotionService.projectCapsule({
    groupId,
    capsule: groupCapsule,
    targetBotId: botId,
    actor: { actorId, actorKind: "operator" },
    approvalMode: "approved",
  });

  if (!projectionResult.allowed || !projectionResult.projection) {
    await recordAudit({
      groupId,
      ...(tenantIdForLedger ? { tenantId: tenantIdForLedger } : {}),
      sourceGroupId: sourceScopeId,
      botId,
      capsuleId: groupCapsule.capsuleId,
      promoted: false,
      reason: projectionResult.reason,
      targetScope: "group",
    }).catch(() => undefined);
    return {
      promoted: false,
      reason: projectionResult.reason,
      sourceScopeId,
      groupId,
      confidentialityTier,
    };
  }

  const promoteResult = await promotionService.promoteProjection({
    projection: projectionResult.projection,
    capsule: groupCapsule,
    actor: { actorId, actorKind: "operator" },
  });

  await recordAudit({
    groupId,
    ...(tenantIdForLedger ? { tenantId: tenantIdForLedger } : {}),
    sourceGroupId: sourceScopeId,
    botId,
    capsuleId: groupCapsule.capsuleId,
    projectionId: projectionResult.projection.projectionId,
    assetId: promoteResult.asset?.assetId,
    promoted: promoteResult.promoted,
    reason: promoteResult.reason,
    targetScope: "group",
  }).catch(() => undefined);

  return {
    promoted: promoteResult.promoted,
    reason: promoteResult.reason,
    projectionId: projectionResult.projection.projectionId,
    ...(promoteResult.asset ? { assetId: promoteResult.asset.assetId } : {}),
    sourceScopeId,
    groupId,
    confidentialityTier,
  };
}
