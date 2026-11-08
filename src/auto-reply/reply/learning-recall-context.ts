import { mergeRecall, renderLearningRecallPrompt } from "../../agent-runtime/context/index.js";
/**
 * 学习经验的系统提示词注入点。
 *
 * 这是"经验回流"闭环的最后一公里：把已审批并晋升的学习资产渲染成提示词片段。
 *
 * W4：注入只证明 **曝光 (injected)**，不能宣称已采用或 outcome_verified。
 * 策展改由 tip closed+eligible 后的 outcome_verified 路径触发，不在此 fire-and-forget。
 *
 * 作用域：协作群（groupId）+ 单聊个人作用域（`agent:<agentId>`），两者都注入，
 * 因为单聊里的失败经验同样需要回来。
 */
import { logVerbose } from "../../globals.js";
import {
  isTaskBoundLearningExposureKey,
  rememberPendingLearningInjection,
  type PendingLearningInjectionScope,
} from "./learning-experience-pending.js";
import {
  type LearningRecall,
  LEARNING_RECALL_LIMIT,
  readLearningRecall,
  recordLearningExperienceStageSafely,
  resolvePersonalLearningScopeId,
} from "./learning-recall.js";

export { renderLearningRecallPrompt } from "../../agent-runtime/context/index.js";

export type LearningRecallPromptBuildResult = {
  prompt: string | undefined;
  retrievedAssetIds: string[];
  injectedAssetIds: string[];
  pendingScopes: PendingLearningInjectionScope[];
};

/**
 * 组装学习经验提示词。
 *
 * 副作用（有意为之，W4 收紧）：
 * - 对读出的资产记 `retrieved`
 * - 对真正进提示词的资产记 `injected`（曝光）
 * - **不**在注入时触发技能策展；策展等 outcome_verified
 * - 若提供 **任务绑定** `exposureKey`（`run:<runId>` / `task:<taskId>`），记入 pending；
 *   禁止 agentId 猜测。无可靠 key 则不记 pending（tip 无曝光则跳过验证）。
 */
export async function buildLearningRecallSystemPrompt(params: {
  agentId?: string | null;
  groupId?: string | null;
  botId?: string | null;
  limit?: number;
  /** Task-bound pending key only (`run:…` / `task:…`). Never agentId. */
  exposureKey?: string | null;
}): Promise<string | undefined> {
  const built = await buildLearningRecallSystemPromptWithMeta(params);
  return built.prompt;
}

/** Same as buildLearningRecallSystemPrompt but returns stage meta (tests / tip attach). */
export async function buildLearningRecallSystemPromptWithMeta(params: {
  agentId?: string | null;
  groupId?: string | null;
  botId?: string | null;
  limit?: number;
  exposureKey?: string | null;
}): Promise<LearningRecallPromptBuildResult> {
  const agentId = params.agentId?.trim();
  const groupId = params.groupId?.trim();
  // 群内以 participation 的 botId 为主体；单聊回落到 agentId。
  const botId = params.botId?.trim() || agentId;
  if (!botId) {
    return { prompt: undefined, retrievedAssetIds: [], injectedAssetIds: [], pendingScopes: [] };
  }
  const limit = params.limit ?? LEARNING_RECALL_LIMIT;

  const scopes: Array<{ scopeId: string; botId: string }> = [];
  if (groupId) {
    scopes.push({ scopeId: groupId, botId });
  }
  if (agentId) {
    scopes.push({ scopeId: resolvePersonalLearningScopeId(agentId), botId: agentId });
  }
  if (scopes.length === 0) {
    return { prompt: undefined, retrievedAssetIds: [], injectedAssetIds: [], pendingScopes: [] };
  }

  const results = await Promise.all(
    scopes.map(async (scope) => {
      try {
        const recall = await readLearningRecall({ ...scope, limit });
        return { scope, recall };
      } catch (err) {
        logVerbose(`learning recall read failed: scope=${scope.scopeId} ${String(err)}`);
        return { scope, recall: null };
      }
    }),
  );

  const merged = mergeRecall(
    results
      .map((entry) => entry.recall)
      .filter((recall): recall is LearningRecall => Boolean(recall)),
    limit,
  );
  const prompt = renderLearningRecallPrompt(merged);
  const injectedSet = new Set(merged.lessons.map((lesson) => lesson.assetId));
  const retrievedAssetIds: string[] = [];
  const injectedAssetIds: string[] = [];
  const pendingScopes: PendingLearningInjectionScope[] = [];

  for (const entry of results) {
    if (!entry.recall) {
      continue;
    }
    const retrievedIds = entry.recall.lessons.map((lesson) => lesson.assetId);
    const injectedIds = retrievedIds.filter((assetId) => injectedSet.has(assetId));
    retrievedAssetIds.push(...retrievedIds);
    injectedAssetIds.push(...injectedIds);

    if (retrievedIds.length > 0) {
      recordLearningExperienceStageSafely({
        scopeId: entry.scope.scopeId,
        assetIds: retrievedIds,
        stage: "retrieved",
      });
    }
    if (injectedIds.length > 0) {
      // Exposure only — do NOT trigger curation here (W4).
      recordLearningExperienceStageSafely({
        scopeId: entry.scope.scopeId,
        assetIds: injectedIds,
        stage: "injected",
      });
      pendingScopes.push({
        scopeId: entry.scope.scopeId,
        botId: entry.scope.botId,
        assetIds: injectedIds,
      });
    }
  }

  // Refuse agentId fallback — concurrent tasks for one agent must not share pending.
  const exposureKey = params.exposureKey?.trim();
  if (exposureKey && isTaskBoundLearningExposureKey(exposureKey) && pendingScopes.length > 0) {
    rememberPendingLearningInjection({ key: exposureKey, scopes: pendingScopes });
  }

  return {
    prompt,
    retrievedAssetIds: [...new Set(retrievedAssetIds)],
    injectedAssetIds: [...new Set(injectedAssetIds)],
    pendingScopes,
  };
}
