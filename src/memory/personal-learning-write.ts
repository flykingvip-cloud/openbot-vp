/**
 * Gated personal-scope learning candidate write + approve/revoke helpers.
 *
 * Does NOT open `collaboration.learning.privateMemoryPromote`. Personal
 * candidates live under scope `agent:<botId>` and require an explicit actor
 * approval before they become active learning assets (shared recall / inject).
 *
 * Permission source for approve/revoke: trusted ownership context from call
 * entry (`ownerUserId` + `ownerAgentId`, optional tenant/securityProfile) —
 * NOT a nonempty `actorId` alone. Actor must match ownerUserId; ownerAgentId
 * must match botId; managed requires tenant and rejects cross-tenant same botId.
 * Capsules remain `candidate` until approved; recall filters active-only
 * (`status === undefined | "active"`).
 */

import type { AgentLearningAsset, GroupMemoryCapsule } from "@openbot/collaboration-core";
import {
  buildLearningRecall,
  resolvePersonalLearningScopeId,
  type LearningRecall,
} from "../auto-reply/reply/learning-recall.js";
import { deriveCandidateCapsule } from "../gateway/agent-growth/experience-capsule.js";
import {
  applyCapsuleGovernanceTransition,
  approveCandidateCapsule,
} from "../gateway/collaboration-learning/capsule-governance.js";
import { createWorkspaceCollaborationStores } from "../gateway/collaboration-learning/shared.js";

/**
 * Trusted ownership for personal-scope learning gates.
 * Built at authenticated call entry — never synthesize from write payload alone.
 */
export type PersonalLearningOwnerContext = {
  /** Authenticated user who owns this personal bot scope. */
  ownerUserId: string;
  /** Agent/bot id bound to the owner; must equal the target botId. */
  ownerAgentId: string;
  /** Tenant when managed_enterprise; omit/null for personal_local. */
  tenantId?: string | null;
  /** Trusted security mode; default personal_local. */
  securityProfile?: "personal_local" | "managed_enterprise";
};

export type PersonalLearningOwnershipDenial = {
  ok: false;
  reason:
    | "ownership_context_required"
    | "ownership_fields_required"
    | "actor_not_owner"
    | "agent_ownership_mismatch"
    | "managed_tenant_required"
    | "cross_tenant_ownership";
};

/**
 * Authorize personal approve/revoke/write. Nonempty actorId alone is insufficient.
 */
export function assertPersonalLearningOwnership(params: {
  botId: string;
  actorId: string;
  ownership: PersonalLearningOwnerContext | undefined;
  /** Tenant stamped on the stored asset/capsule (managed cross-tenant check). */
  recordedTenantId?: string | null;
}):
  | {
      ok: true;
      tenantId: string | null;
      securityProfile: "personal_local" | "managed_enterprise";
    }
  | PersonalLearningOwnershipDenial {
  if (!params.ownership) {
    return { ok: false, reason: "ownership_context_required" };
  }
  const ownerUserId = params.ownership.ownerUserId.trim();
  const ownerAgentId = params.ownership.ownerAgentId.trim();
  const actorId = params.actorId.trim();
  const botId = params.botId.trim();
  if (!ownerUserId || !ownerAgentId || !actorId || !botId) {
    return { ok: false, reason: "ownership_fields_required" };
  }
  // Nonempty actorId alone is not authorization — must match trusted owner.
  if (actorId !== ownerUserId) {
    return { ok: false, reason: "actor_not_owner" };
  }
  if (ownerAgentId !== botId) {
    return { ok: false, reason: "agent_ownership_mismatch" };
  }
  const securityProfile = params.ownership.securityProfile ?? "personal_local";
  const tenantId = params.ownership.tenantId?.trim() || null;
  if (securityProfile === "managed_enterprise" && !tenantId) {
    return { ok: false, reason: "managed_tenant_required" };
  }
  // When a recorded tenant is available, ownership tenant must match exactly
  // (personal records use null; managed records use the write-time tenant).
  if (params.recordedTenantId !== undefined) {
    const recordedNorm = params.recordedTenantId?.trim() || null;
    const ownershipNorm = securityProfile === "managed_enterprise" ? tenantId : null;
    if (recordedNorm !== ownershipNorm) {
      return { ok: false, reason: "cross_tenant_ownership" };
    }
  }
  return { ok: true, tenantId, securityProfile };
}

export type WritePersonalLearningCandidateParams = {
  botId: string;
  reason: string;
  detail?: string | null;
  /** Audit actor; must match ownership.ownerUserId. */
  actorId: string;
  /** Trusted ownership from call entry (required). */
  ownership: PersonalLearningOwnerContext;
  atMs?: number;
  capsuleId?: string;
};

export type WritePersonalLearningCandidateResult =
  | { ok: true; scopeId: string; capsuleId: string; status: "candidate" }
  | { ok: false; reason: string };

/**
 * Write a personal-scope experience candidate under `agent:<botId>`.
 * Status stays `candidate` — does not appear in shared/personal recall until
 * `approvePersonalLearningCandidate` runs.
 */
export async function writePersonalLearningCandidate(
  params: WritePersonalLearningCandidateParams,
): Promise<WritePersonalLearningCandidateResult> {
  const botId = params.botId.trim();
  const actorId = params.actorId.trim();
  const reason = params.reason.trim();
  if (!botId || !actorId || !reason) {
    return { ok: false, reason: "botId_actorId_reason_required" };
  }
  const ownershipGate = assertPersonalLearningOwnership({
    botId,
    actorId,
    ownership: params.ownership,
  });
  if (!ownershipGate.ok) {
    return { ok: false, reason: ownershipGate.reason };
  }
  const scopeId = resolvePersonalLearningScopeId(botId);
  const now = params.atMs ?? Date.now();
  const capsule = deriveCandidateCapsule({
    trigger: "human_takeover",
    scopeId,
    botId,
    reason,
    detail: params.detail ?? null,
    confidentialityTier: "internal",
    atMs: now,
    ...(params.capsuleId ? { capsuleId: params.capsuleId } : {}),
  });
  if (!capsule) {
    return { ok: false, reason: "insufficient_experience_input" };
  }
  // Stamp writer + ownership for audit; approval still required.
  const stamped: GroupMemoryCapsule = {
    ...capsule,
    metadata: {
      ...capsule.metadata,
      personalScopeWriter: actorId,
      personalOwnerUserId: params.ownership.ownerUserId.trim(),
      personalOwnerAgentId: botId,
      personalOwnerTenantId: ownershipGate.tenantId,
      personalSecurityProfile: ownershipGate.securityProfile,
      gatedWrite: "personal_learning_write",
    },
  };
  const { learningStorage } = createWorkspaceCollaborationStores();
  await learningStorage.appendCapsule(scopeId, stamped);
  return { ok: true, scopeId, capsuleId: stamped.capsuleId, status: "candidate" };
}

export type ApprovePersonalLearningCandidateParams = {
  botId: string;
  capsuleId: string;
  /** Audit actor; must match ownership.ownerUserId. */
  actorId: string;
  /** Trusted ownership from call entry (required). */
  ownership: PersonalLearningOwnerContext;
};

/**
 * Approve + promote a personal-scope candidate. Reuses group governance
 * transition with scopeId = `agent:<botId>` (learning storage key).
 */
export async function approvePersonalLearningCandidate(
  params: ApprovePersonalLearningCandidateParams,
): Promise<{
  capsuleId: string;
  approved: boolean;
  promoted: boolean;
  reason: string;
  assetId?: string;
  scopeId: string;
}> {
  const botId = params.botId.trim();
  const scopeId = resolvePersonalLearningScopeId(botId);
  const { learningStorage } = createWorkspaceCollaborationStores();
  const capsules = await learningStorage.readCapsules(scopeId);
  const existing = capsules.find((c) => c.capsuleId === params.capsuleId);
  const recordedTenantRaw = existing?.metadata?.personalOwnerTenantId;
  const recordedTenantId: string | null | undefined = existing
    ? typeof recordedTenantRaw === "string"
      ? recordedTenantRaw.trim() || null
      : recordedTenantRaw === null
        ? null
        : null
    : undefined;
  const ownershipGate = assertPersonalLearningOwnership({
    botId,
    actorId: params.actorId,
    ownership: params.ownership,
    recordedTenantId,
  });
  if (!ownershipGate.ok) {
    return {
      capsuleId: params.capsuleId,
      approved: false,
      promoted: false,
      reason: ownershipGate.reason,
      scopeId,
    };
  }
  const result = await approveCandidateCapsule({
    groupId: scopeId,
    capsuleId: params.capsuleId,
    actorId: params.actorId,
    // Stable personal path: scope already names the bot; do not rely solely on
    // agents.list discovery inside promoteApprovedCapsuleIfEligible.
    targetBotId: botId,
  });
  // Propagate ownership tenant onto the promoted asset so revoke can refuse
  // cross-tenant attempts with state unchanged.
  if (result.promoted && result.assetId) {
    const assets = await learningStorage.readLearningAssets(scopeId, botId);
    const stamped = assets.map((asset: AgentLearningAsset) =>
      asset.assetId === result.assetId
        ? {
            ...asset,
            metadata: {
              ...asset.metadata,
              personalOwnerUserId: params.ownership.ownerUserId.trim(),
              personalOwnerAgentId: botId,
              personalOwnerTenantId: ownershipGate.tenantId,
              personalSecurityProfile: ownershipGate.securityProfile,
            },
          }
        : asset,
    );
    await learningStorage.writeLearningAssets(scopeId, stamped);
  }
  return { ...result, scopeId };
}

/**
 * Revoke an active personal learning asset so recall stops injecting it.
 */
export async function revokePersonalLearningAsset(params: {
  botId: string;
  assetId: string;
  actorId: string;
  /** Trusted ownership from call entry (required). */
  ownership: PersonalLearningOwnerContext;
}): Promise<{ ok: boolean; reason: string; scopeId: string }> {
  const botId = params.botId.trim();
  const assetId = params.assetId.trim();
  const actorId = params.actorId.trim();
  const scopeId = resolvePersonalLearningScopeId(botId);
  if (!botId || !assetId || !actorId) {
    return { ok: false, reason: "botId_assetId_actorId_required", scopeId };
  }
  const { learningStorage } = createWorkspaceCollaborationStores();
  const assets = await learningStorage.readLearningAssets(scopeId, botId);
  const foundAsset = assets.find((asset) => asset.assetId === assetId);
  if (!foundAsset) {
    return { ok: false, reason: "asset_not_found", scopeId };
  }
  const recordedTenantRaw = foundAsset.metadata?.personalOwnerTenantId;
  const recordedTenantId: string | null =
    typeof recordedTenantRaw === "string"
      ? recordedTenantRaw.trim() || null
      : recordedTenantRaw === null
        ? null
        : null;
  const ownershipGate = assertPersonalLearningOwnership({
    botId,
    actorId,
    ownership: params.ownership,
    recordedTenantId,
  });
  if (!ownershipGate.ok) {
    // Refuse with state unchanged — do not write.
    return { ok: false, reason: ownershipGate.reason, scopeId };
  }
  const next = assets.map((asset: AgentLearningAsset) =>
    asset.assetId === assetId
      ? {
          ...asset,
          status: "revoked" as const,
          updatedAt: Date.now(),
          metadata: {
            ...asset.metadata,
            revokedBy: actorId,
          },
        }
      : asset,
  );
  await learningStorage.writeLearningAssets(scopeId, next);
  return { ok: true, reason: "revoked", scopeId };
}

/** Read personal recall for tests (active-only via buildLearningRecall). */
export async function readPersonalLearningRecall(params: {
  botId: string;
  limit?: number;
}): Promise<LearningRecall> {
  const botId = params.botId.trim();
  const scopeId = resolvePersonalLearningScopeId(botId);
  const { learningStorage } = createWorkspaceCollaborationStores();
  const assets = await learningStorage.readLearningAssets(scopeId, botId);
  return buildLearningRecall(assets, params.limit);
}

/** Transition helper exposed for group revoke tests (candidate/approved → revoked). */
export function revokeCapsuleInMemory(
  capsule: GroupMemoryCapsule,
  actorId: string,
): GroupMemoryCapsule {
  return applyCapsuleGovernanceTransition(capsule, "revoked", { actor: actorId });
}
