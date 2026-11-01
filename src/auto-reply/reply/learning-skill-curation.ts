/**
 * outcome_verified 阈值策展的落地：学习资产 → `draft` 技能 → 等人工审核。
 *
 * W4 触发时机：TaskOutcome closed+eligible 后记 outcome_verified（不是提示词注入）。
 * 幂等：策展后把 `curatedSkillId` 写回参与的资产，同一簇不会重复生成技能。
 * 普通偏好/事实更新不走此路径；技能发布仍走既有 lifecycle（draft→review→approved）。
 *
 * P1-D：草稿必须带 ownerUserId（从学习资产 metadata.personalOwnerUserId 继承），
 * 且 autoInstallEnabled=false —— draft 不能假装已安装；人工 finalize + install 后才投影。
 */

import type { AgentLearningAsset } from "@openbot/collaboration-core";
import {
  buildSkillDraftProfile,
  deriveSkillDraftCandidates,
  type SkillDraftCandidate,
} from "../../gateway/agent-growth/skill-draft-curation.js";
import { createWorkspaceCollaborationStores } from "../../gateway/collaboration-learning/shared.js";
import { saveSkillAsset } from "../../gateway/skill-lifecycle-store.js";
import { logVerbose } from "../../globals.js";
import { withLearningAssetLock } from "./learning-recall.js";

export type CuratedSkillDraft = {
  skillId: string;
  clusterKey: string;
  assetIds: string[];
  trigger: SkillDraftCandidate["trigger"];
  totalReuse: number;
  occurrences: number;
  /** Owner stamped onto the draft for personal-skills / learning.skillDraft gates. */
  ownerUserId: string | null;
};

export type CurateLearningSkillDraftsParams = {
  scopeId: string;
  botId?: string;
  reuseThreshold?: number;
  occurrenceThreshold?: number;
  atMs?: number;
  /**
   * Optional override when the caller already resolved a trusted owner
   * (e.g. personal learning path). Otherwise read from asset metadata.
   */
  ownerUserId?: string | null;
  /**
   * Isolated collaboration stores. Omitted in production, which calls loadConfig().
   */
  stores?: {
    groupRootDir?: string;
    learningStorage: {
      readLearningAssets: (scopeId: string, botId?: string) => Promise<AgentLearningAsset[]>;
      writeLearningAssets: (scopeId: string, assets: AgentLearningAsset[]) => Promise<unknown>;
    };
  };
};

/** Lineage prefix written as skill sourceLineageId (`learning:<scopeId>`). */
export const LEARNING_SKILL_LINEAGE_PREFIX = "learning:";

/**
 * Prefer newest asset's personalOwnerUserId so personal-gated learning
 * assets remain claimable via personal-skills / skillDraft RPCs.
 */
export function resolveOwnerUserIdFromLearningAssets(
  assets: AgentLearningAsset[],
  override?: string | null,
): string | null {
  const fromOverride = typeof override === "string" ? override.trim() : "";
  if (fromOverride) {
    return fromOverride;
  }
  const newestFirst = [...assets].toSorted(
    (left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0),
  );
  for (const asset of newestFirst) {
    const raw = asset.metadata?.personalOwnerUserId;
    if (typeof raw === "string" && raw.trim()) {
      return raw.trim();
    }
  }
  return null;
}

/**
 * 扫描某作用域下的学习资产，把达到 outcome_verified 阈值的经验沉淀为技能草稿。
 *
 * 返回本次新生成的草稿；无候选时返回空数组且不写盘。
 */
export async function curateLearningSkillDrafts(
  params: CurateLearningSkillDraftsParams,
): Promise<CuratedSkillDraft[]> {
  const scopeId = params.scopeId.trim();
  if (!scopeId) {
    return [];
  }
  // 与复用记账共用同一把锁：策展也是读改写，且要靠 curatedSkillId 保证幂等。
  return withLearningAssetLock(
    scopeId,
    () => curateLearningSkillDraftsLocked({ ...params, scopeId }),
    params.stores?.groupRootDir,
  );
}

async function curateLearningSkillDraftsLocked(
  params: CurateLearningSkillDraftsParams & { scopeId: string },
): Promise<CuratedSkillDraft[]> {
  const scopeId = params.scopeId;
  const { learningStorage } = params.stores ?? createWorkspaceCollaborationStores();
  const allAssets = await learningStorage.readLearningAssets(scopeId);
  const botId = params.botId?.trim();
  const scopedAssets = botId ? allAssets.filter((asset) => asset.botId === botId) : allAssets;

  const candidates = deriveSkillDraftCandidates(scopedAssets, {
    ...(params.reuseThreshold !== undefined ? { reuseThreshold: params.reuseThreshold } : {}),
    ...(params.occurrenceThreshold !== undefined
      ? { occurrenceThreshold: params.occurrenceThreshold }
      : {}),
  });
  if (candidates.length === 0) {
    return [];
  }

  const now = params.atMs ?? Date.now();
  const curated: CuratedSkillDraft[] = [];
  const curatedByAssetId = new Map<string, string>();

  for (const candidate of candidates) {
    try {
      const clusterAssets = scopedAssets.filter((asset) =>
        candidate.assetIds.includes(asset.assetId),
      );
      const ownerUserId = resolveOwnerUserIdFromLearningAssets(clusterAssets, params.ownerUserId);
      // draft 状态：只沉淀，不发布、不装机。审核走既有 skill lifecycle
      // （finalize-draft → private，再 robot-skills.install / skillDraft.finalize）。
      const { skillId } = saveSkillAsset({
        sourceAgentId: candidate.botId,
        contextId: `${LEARNING_SKILL_LINEAGE_PREFIX}${scopeId}`,
        lifecycle: "draft",
        // P1-D: never auto-link as installed while still draft.
        autoInstallEnabled: false,
        ...(ownerUserId ? { ownerUserId } : {}),
        profile: buildSkillDraftProfile(candidate),
        runtimeDefinition: {
          prompts: [candidate.lesson],
          tools: candidate.capabilities,
        },
      });
      curated.push({
        skillId,
        clusterKey: candidate.clusterKey,
        assetIds: candidate.assetIds,
        trigger: candidate.trigger,
        totalReuse: candidate.totalReuse,
        occurrences: candidate.occurrences,
        ownerUserId,
      });
      for (const assetId of candidate.assetIds) {
        curatedByAssetId.set(assetId, skillId);
      }
    } catch (err) {
      logVerbose(`skill draft curation failed: cluster=${candidate.clusterKey} ${String(err)}`);
    }
  }

  if (curatedByAssetId.size === 0) {
    return curated;
  }

  // 幂等标记：写回 curatedSkillId，避免下一次复用又生成一份重复草稿。
  const next = allAssets.map((asset) => {
    const skillId = curatedByAssetId.get(asset.assetId);
    if (!skillId) {
      return asset;
    }
    return {
      ...asset,
      curatedSkillId: skillId,
      curatedAt: now,
      updatedAt: now,
    } satisfies AgentLearningAsset;
  });
  await learningStorage.writeLearningAssets(scopeId, next);
  return curated;
}

/** 永不 reject 的包装，供提示词组装后 fire-and-forget 调用。 */
export function curateLearningSkillDraftsSafely(params: CurateLearningSkillDraftsParams): void {
  void curateLearningSkillDrafts(params)
    .then((drafts) => {
      for (const draft of drafts) {
        logVerbose(
          `skill draft curated: skill=${draft.skillId} cluster=${draft.clusterKey} ` +
            `trigger=${draft.trigger} reuse=${draft.totalReuse} occurrences=${draft.occurrences}` +
            (draft.ownerUserId ? ` owner=${draft.ownerUserId}` : " owner=unset"),
        );
      }
    })
    .catch((err) => {
      logVerbose(`skill draft curation failed: ${String(err)}`);
    });
}
