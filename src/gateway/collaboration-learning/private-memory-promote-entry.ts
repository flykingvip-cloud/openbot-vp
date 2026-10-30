/**
 * Authorized production entry for private→group memory promote (P1-C).
 *
 * Loads the capsule from personal scope `agent:<botId>` (clients cannot invent
 * another owner's capsule payload), applies personal-learning ownership gates,
 * then calls `promotePrivateMemoryCapsuleToGroup`.
 *
 * Idempotency: promote derives stable projectionId/assetId from source scope +
 * capsule version + target tenant/group/bot. Learning storage upserts by those
 * ids, so repeat promote rewrites the same capsule/projection/asset rows rather
 * than minting new UUIDs. Audit may append again. Does not corrupt prior assets.
 *
 * Trusted context: RPC must pass target-group `stores` + `tenantId` from
 * `resolveTrustedWriteContext`. Ownership compares capsule-stamped tenant to the
 * caller-trusted tenant (not capsule labels against themselves). Managed
 * enterprise without trusted stores/tenant fail-closes (no default-store reopen).
 *
 * Revoke limitation: personal `revokePersonalLearningAsset` does not revoke the
 * group-side clone. Group revoke uses `collaboration.capsule.transition`
 * (toStatus=revoked) / asset lifecycle on the target group. Documented gap —
 * no automatic cross-scope revoke in this entry.
 *
 * Flag `collaboration.learning.privateMemoryPromote` stays default OFF.
 */

import type { GroupMemoryCapsule } from "@openbot/collaboration-core";
import type { OpenBotConfig } from "../../config/config.js";
import {
  assertPersonalLearningOwnership,
  type PersonalLearningOwnerContext,
} from "../../memory/personal-learning-write.js";
import {
  promotePrivateMemoryCapsuleToGroup,
  resolvePrivateMemoryScopeId,
  type PrivateMemoryPromoteResult,
  type PromotePrivateMemoryDeps,
} from "./private-memory-promote.js";
import { createWorkspaceCollaborationStores } from "./shared.js";

export type AuthorizedPrivateMemoryPromoteParams = {
  botId: string;
  groupId: string;
  capsuleId: string;
  /** Identified actor from delivery ACL (required by caller). */
  actorId: string;
  cfg?: OpenBotConfig | null;
  confidentialityTier?: string;
  /**
   * Trusted tenant from `resolveTrustedWriteContext` / authz — compared to the
   * capsule-stamped recorded tenant. Do not invent from capsule metadata alone.
   */
  tenantId?: string | null;
  /** Trusted security profile from authz context when available. */
  securityProfile?: "personal_local" | "managed_enterprise";
  /**
   * Trusted target-group stores from authz. Target learning writes use
   * `stores.learningStorage` when provided (RPC production path).
   */
  stores?: {
    learningStorage: PromotePrivateMemoryDeps["learningStorage"];
  };
  deps?: PromotePrivateMemoryDeps & {
    readCapsules?: (scopeId: string) => Promise<GroupMemoryCapsule[]>;
  };
};

export type AuthorizedPrivateMemoryPromoteResult = PrivateMemoryPromoteResult & {
  capsuleId: string;
};

function readStampedOwnership(
  capsule: GroupMemoryCapsule,
  botId: string,
): PersonalLearningOwnerContext | undefined {
  const meta = capsule.metadata ?? {};
  const ownerUserId =
    typeof meta.personalOwnerUserId === "string" ? meta.personalOwnerUserId.trim() : "";
  const ownerAgentIdRaw =
    typeof meta.personalOwnerAgentId === "string" ? meta.personalOwnerAgentId.trim() : "";
  const ownerAgentId = ownerAgentIdRaw || botId;
  if (!ownerUserId || !ownerAgentId) {
    return undefined;
  }
  const securityProfile =
    meta.personalSecurityProfile === "managed_enterprise" ? "managed_enterprise" : "personal_local";
  const tenantRaw = meta.personalOwnerTenantId;
  const tenantId =
    typeof tenantRaw === "string" ? tenantRaw.trim() || null : tenantRaw === null ? null : null;
  return {
    ownerUserId,
    ownerAgentId,
    securityProfile,
    ...(tenantId !== undefined ? { tenantId } : {}),
  };
}

function recordedTenantFromCapsule(capsule: GroupMemoryCapsule): string | null | undefined {
  const raw = capsule.metadata?.personalOwnerTenantId;
  if (raw === undefined) {
    return undefined;
  }
  if (typeof raw === "string") {
    return raw.trim() || null;
  }
  return raw === null ? null : null;
}

/**
 * Load personal-scope capsule by id and promote into the target group when the
 * flag is ON. Returns `flag_off` with no writes when the flag is OFF (after
 * authz). Never accepts a client-supplied capsule body.
 */
export async function promotePrivateMemoryCapsuleAuthorized(
  params: AuthorizedPrivateMemoryPromoteParams,
): Promise<AuthorizedPrivateMemoryPromoteResult> {
  const botId = params.botId.trim();
  const groupId = params.groupId.trim();
  const capsuleId = params.capsuleId.trim();
  const actorId = params.actorId.trim();
  const sourceScopeId = resolvePrivateMemoryScopeId(botId);

  if (!botId || !groupId || !capsuleId || !actorId) {
    return {
      capsuleId,
      promoted: false,
      reason: "botId_groupId_capsuleId_actorId_required",
      sourceScopeId,
      groupId,
    };
  }

  const readCapsules =
    params.deps?.readCapsules ??
    (async (scopeId: string) => {
      const { learningStorage } = createWorkspaceCollaborationStores();
      return learningStorage.readCapsules(scopeId);
    });

  const capsules = await readCapsules(sourceScopeId);
  const capsule = capsules.find((entry) => entry.capsuleId === capsuleId);
  if (!capsule) {
    return {
      capsuleId,
      promoted: false,
      reason: "capsule_not_found",
      sourceScopeId,
      groupId,
    };
  }

  // Only approved personal capsules may enter the group pathway.
  const status = capsule.status ?? "candidate";
  if (status === "revoked") {
    return {
      capsuleId,
      promoted: false,
      reason: "capsule_revoked",
      sourceScopeId,
      groupId,
    };
  }
  if (status !== "approved") {
    return {
      capsuleId,
      promoted: false,
      reason: "capsule_not_approved",
      sourceScopeId,
      groupId,
    };
  }

  const stamped = readStampedOwnership(capsule, botId);
  if (!stamped) {
    return {
      capsuleId,
      promoted: false,
      reason: "ownership_context_required",
      sourceScopeId,
      groupId,
    };
  }

  const callerProfile = params.securityProfile ?? stamped.securityProfile ?? "personal_local";
  const trustedTenantProvided = params.tenantId !== undefined;
  // Subject tenant comes from authorized caller when provided — never synthesize
  // "current subject" solely from the capsule label that is also the recorded tenant.
  const subjectTenantId = trustedTenantProvided ? params.tenantId : stamped.tenantId;

  // Managed enterprise must carry trusted tenant + target stores from authz.
  // Do not reopen default local stores for managed writes.
  const targetLearningStorage =
    params.stores?.learningStorage ?? params.deps?.learningStorage ?? undefined;
  if (callerProfile === "managed_enterprise" || stamped.securityProfile === "managed_enterprise") {
    const trustedTenant = typeof subjectTenantId === "string" ? subjectTenantId.trim() : "";
    if (!trustedTenantProvided || !trustedTenant || !targetLearningStorage) {
      return {
        capsuleId,
        promoted: false,
        reason: "managed_requires_trusted_context",
        sourceScopeId,
        groupId,
      };
    }
  }

  const ownershipGate = assertPersonalLearningOwnership({
    botId,
    actorId,
    ownership: {
      ownerUserId: stamped.ownerUserId,
      ownerAgentId: stamped.ownerAgentId,
      securityProfile: callerProfile,
      tenantId: subjectTenantId,
    },
    recordedTenantId: recordedTenantFromCapsule(capsule),
  });
  if (!ownershipGate.ok) {
    return {
      capsuleId,
      promoted: false,
      reason: ownershipGate.reason,
      sourceScopeId,
      groupId,
    };
  }

  const result = await promotePrivateMemoryCapsuleToGroup({
    botId,
    groupId,
    capsule,
    actor: actorId,
    ...(params.confidentialityTier ? { confidentialityTier: params.confidentialityTier } : {}),
    deps: {
      cfg: params.cfg ?? params.deps?.cfg ?? null,
      ...(targetLearningStorage ? { learningStorage: targetLearningStorage } : {}),
      ...(params.deps?.recordAudit ? { recordAudit: params.deps.recordAudit } : {}),
      ...(params.deps?.evaluatePolicy ? { evaluatePolicy: params.deps.evaluatePolicy } : {}),
      ...(trustedTenantProvided ? { tenantId: params.tenantId } : {}),
      ...(params.deps?.createProjectionId
        ? { createProjectionId: params.deps.createProjectionId }
        : {}),
      ...(params.deps?.createAssetId ? { createAssetId: params.deps.createAssetId } : {}),
    },
  });

  return { ...result, capsuleId };
}
