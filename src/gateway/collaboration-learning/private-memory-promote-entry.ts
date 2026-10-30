/**
 * Authorized production entry for private→group memory promote (P1-C).
 *
 * Loads the capsule from personal scope `agent:<botId>` (clients cannot invent
 * another owner's capsule payload), applies personal-learning ownership gates,
 * then calls `promotePrivateMemoryCapsuleToGroup`.
 *
 * Idempotency: promote derives stable projectionId/assetId from source scope +
 * capsule version + target tenant/group/bot. When the stable asset already
 * exists, retry returns the same ids without mutating status/reuseCount/
 * createdAt/version (network retry must not resurrect revoked assets). Audit
 * may append again.
 *
 * Trusted context: RPC must pass target-group `stores` + `tenantId` from
 * `resolveTrustedWriteContext`. Source capsule reads, target policy
 * (fileStore/groupStorage), and learning writes all bind to those trusted
 * stores/locator — not a silent default-store reopen. Ownership compares
 * capsule-stamped tenant to the caller-trusted tenant (not capsule labels
 * against themselves). Managed enterprise without trusted stores/tenant
 * fail-closes.
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
   * Trusted target-group stores from authz. Source capsule reads, target
   * policy (fileStore/groupStorage), and learning writes bind here when
   * provided (RPC production path).
   */
  stores?: {
    learningStorage: PromotePrivateMemoryDeps["learningStorage"];
    fileStore?: PromotePrivateMemoryDeps["fileStore"];
    groupStorage?: PromotePrivateMemoryDeps["groupStorage"];
  };
  /**
   * Optional explicit source-scope stores. When omitted, source reads use
   * `stores.learningStorage` (same trusted locator) rather than reopening
   * default workspace stores.
   */
  sourceStores?: {
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

  // Bind source reads to trusted stores when provided — never reopen default
  // workspace stores on the managed / RPC path just to load agent:<botId>.
  const sourceLearningStorage =
    params.sourceStores?.learningStorage ??
    params.stores?.learningStorage ??
    params.deps?.learningStorage ??
    undefined;
  const targetLearningStorage =
    params.stores?.learningStorage ?? params.deps?.learningStorage ?? undefined;

  // Managed enterprise must carry trusted tenant + stores before any store reopen.
  if (params.securityProfile === "managed_enterprise") {
    const trustedTenant = typeof params.tenantId === "string" ? params.tenantId.trim() : "";
    if (params.tenantId === undefined || !trustedTenant || !targetLearningStorage) {
      return {
        capsuleId,
        promoted: false,
        reason: "managed_requires_trusted_context",
        sourceScopeId,
        groupId,
      };
    }
  }

  const readCapsules =
    params.deps?.readCapsules ??
    (async (scopeId: string) => {
      if (sourceLearningStorage) {
        return sourceLearningStorage.readCapsules(scopeId);
      }
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

  // Managed enterprise (capsule-stamped) must carry trusted tenant + target stores.
  // Do not reopen default local stores for managed writes.
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

  const targetFileStore = params.stores?.fileStore ?? params.deps?.fileStore;
  const targetGroupStorage = params.stores?.groupStorage ?? params.deps?.groupStorage;

  const result = await promotePrivateMemoryCapsuleToGroup({
    botId,
    groupId,
    capsule,
    actor: actorId,
    ...(params.confidentialityTier ? { confidentialityTier: params.confidentialityTier } : {}),
    deps: {
      cfg: params.cfg ?? params.deps?.cfg ?? null,
      ...(targetLearningStorage ? { learningStorage: targetLearningStorage } : {}),
      ...(targetFileStore ? { fileStore: targetFileStore } : {}),
      ...(targetGroupStorage ? { groupStorage: targetGroupStorage } : {}),
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
