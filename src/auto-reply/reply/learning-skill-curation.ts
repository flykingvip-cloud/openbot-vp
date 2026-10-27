/**
 * outcome_verified 阈值策展的落地：学习资产 → `draft` 技能 → 等人工审核。
 *
 * W4 触发时机：TaskOutcome closed+eligible 后记 outcome_verified（不是提示词注入）。
 * 幂等：策展后把 `curatedSkillId` 写回参与的资产，同一簇不会重复生成技能。
 * 普通偏好/事实更新不走此路径；技能发布仍走既有 lifecycle（draft→review→approved）。
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
};

export type CurateLearningSkillDraftsParams = {
  scopeId: string;
  botId?: string;
  reuseThreshold?: number;
  occurrenceThreshold?: number;
  atMs?: number;
};

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
  return withLearningAssetLock(scopeId, () =>
    curateLearningSkillDraftsLocked({ ...params, scopeId }),
  );
}

async function curateLearningSkillDraftsLocked(
  params: CurateLearningSkillDraftsParams & { scopeId: string },
): Promise<CuratedSkillDraft[]> {
  const scopeId = params.scopeId;
  const { learningStorage } = createWorkspaceCollaborationStores();
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
      // draft 状态：只沉淀，不发布。审核走既有 skill lifecycle（submit → reviewing → approved）。
      const { skillId } = saveSkillAsset({
        sourceAgentId: candidate.botId,
        contextId: `learning:${scopeId}`,
        lifecycle: "draft",
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
            `trigger=${draft.trigger} reuse=${draft.totalReuse} occurrences=${draft.occurrences}`,
        );
      }
    })
    .catch((err) => {
      logVerbose(`skill draft curation failed: ${String(err)}`);
    });
}
