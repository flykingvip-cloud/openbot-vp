/**
 * Gated personal-scope learning candidate write + approve/revoke helpers.
 *
 * Does NOT open `collaboration.learning.privateMemoryPromote`. Personal
 * candidates live under scope `agent:<botId>` and require an explicit actor
 * approval before they become active learning assets (shared recall / inject).
 *
 * Permission source for approve/revoke: caller-supplied `actorId` (operator /
 * owner). Capsules remain `candidate` until approved; recall filters
 * active-only (`status === undefined | "active"`).
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

export type WritePersonalLearningCandidateParams = {
  botId: string;
  reason: string;
  detail?: string | null;
  /** Required gate — who is writing the candidate (not auto-promoted). */
  actorId: string;
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
  // Stamp writer for audit; approval still required.
  const stamped: GroupMemoryCapsule = {
    ...capsule,
    metadata: {
      ...capsule.metadata,
      personalScopeWriter: actorId,
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
  /** Required gate — who approves (approve→promote; never silent). */
  actorId: string;
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
  const result = await approveCandidateCapsule({
    groupId: scopeId,
    capsuleId: params.capsuleId,
    actorId: params.actorId,
  });
  return { ...result, scopeId };
}

/**
 * Revoke an active personal learning asset so recall stops injecting it.
 */
export async function revokePersonalLearningAsset(params: {
  botId: string;
  assetId: string;
  actorId: string;
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
  const found = assets.some((asset) => asset.assetId === assetId);
  if (!found) {
    return { ok: false, reason: "asset_not_found", scopeId };
  }
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
