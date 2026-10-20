/**
 * 学习经验的系统提示词注入点。
 *
 * 这是"经验回流"闭环的最后一公里：把已审批并晋升的学习资产渲染成提示词片段，
 * 并把本次真正注入的资产记为一次复用（喂给复用阈值策展）。
 *
 * 作用域：协作群（groupId）+ 单聊个人作用域（`agent:<agentId>`），两者都注入，
 * 因为单聊里的失败经验同样需要回来。
 */

import { logVerbose } from "../../globals.js";
import {
  type LearningRecall,
  type LearningRecallEntry,
  LEARNING_RECALL_LIMIT,
  readLearningRecall,
  recordLearningReuseSafely,
  resolvePersonalLearningScopeId,
} from "./learning-recall.js";
import { curateLearningSkillDraftsSafely } from "./learning-skill-curation.js";

const ASSET_TYPE_LABEL: Record<LearningRecallEntry["assetType"], string> = {
  lesson: "经验教训",
  pattern: "有效模式",
  decision_rule: "决策规则",
  playbook: "操作手册",
  skill_delta: "能力增量",
};

function formatEntry(entry: LearningRecallEntry): string {
  const label = entry.isAntiPattern ? "负面模式" : ASSET_TYPE_LABEL[entry.assetType];
  const reuse = entry.reuseCount > 0 ? `，已复用 ${entry.reuseCount} 次` : "";
  return `- [${label}｜置信度 ${entry.confidence}${reuse}] ${entry.lesson}`;
}

/** 渲染提示词片段（纯函数，便于单测）。 */
export function renderLearningRecallPrompt(recall: LearningRecall): string | undefined {
  if (recall.lessons.length === 0) {
    return undefined;
  }
  return [
    "## 已沉淀的经验（来自过往任务的复盘，已通过审批）",
    "在动手前先对照下面的经验；标为「负面模式」的做法不要重复。",
    ...recall.lessons.map(formatEntry),
  ].join("\n");
}

function mergeRecall(entries: LearningRecall[], limit: number): LearningRecall {
  const capabilities = [...new Set(entries.flatMap((entry) => entry.capabilities))];
  const seen = new Set<string>();
  const lessons: LearningRecallEntry[] = [];
  for (const entry of entries) {
    for (const lesson of entry.lessons) {
      if (seen.has(lesson.lesson)) {
        continue;
      }
      seen.add(lesson.lesson);
      lessons.push(lesson);
      if (lessons.length >= limit) {
        return { capabilities, lessons };
      }
    }
  }
  return { capabilities, lessons };
}

/**
 * 组装学习经验提示词。
 *
 * 副作用（有意为之）：对本次真正注入的资产累加复用次数，fire-and-forget。
 */
export async function buildLearningRecallSystemPrompt(params: {
  agentId?: string | null;
  groupId?: string | null;
  botId?: string | null;
  limit?: number;
}): Promise<string | undefined> {
  const agentId = params.agentId?.trim();
  const groupId = params.groupId?.trim();
  // 群内以 participation 的 botId 为主体；单聊回落到 agentId。
  const botId = params.botId?.trim() || agentId;
  if (!botId) {
    return undefined;
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
    return undefined;
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
  if (!prompt) {
    return undefined;
  }

  // 只对真正进了提示词的资产计复用（按作用域分别落账），随后检查复用阈值策展。
  const injected = new Set(merged.lessons.map((lesson) => lesson.assetId));
  for (const entry of results) {
    if (!entry.recall) {
      continue;
    }
    const assetIds = entry.recall.lessons
      .map((lesson) => lesson.assetId)
      .filter((assetId) => injected.has(assetId));
    if (assetIds.length === 0) {
      continue;
    }
    // 先记账再查阈值：这一次复用要算进去，否则永远差一次才毕业。
    recordLearningReuseSafely({
      scopeId: entry.scope.scopeId,
      assetIds,
      onRecorded: () => {
        curateLearningSkillDraftsSafely({
          scopeId: entry.scope.scopeId,
          botId: entry.scope.botId,
        });
      },
    });
  }
  return prompt;
}
