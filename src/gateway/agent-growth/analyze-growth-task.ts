/**
 * Agent Growth OS — P1：分析任务 → 写入 pendingTaskContext → 返回 growth payload。
 */

import type { OpenBotConfig } from "../../config/config.js";
import { createAgentKnowledgeLlmCaller } from "../knowledge/agent-knowledge-generator.js";
import { listSkillRecommendations } from "../skill-lifecycle-store.js";
import { createInitialGrowthStatus } from "./factory.js";
import { collectInstalledSkillKeys } from "./installed-skills.js";
import { setRobotPendingTaskContext } from "./pending-task-context.js";
import { buildRobotGrowthStatusPayload, type RobotGrowthStatusPayload } from "./recommendation.js";
import { requiredSkillKeys } from "./signals.js";
import { readRobotGrowthStatus } from "./store.js";
import {
  buildTaskSkillCandidates,
  extractTaskSkillRequirements,
  fallbackTaskGapsFromTemplate,
  toPendingTaskContext,
} from "./task-requirement-extract.js";
import { resolveTemplateOrDefault } from "./templates/index.js";
import type { GrowthPendingTaskContext } from "./types.js";

export async function analyzeAndStoreGrowthTask(params: {
  cfg: OpenBotConfig;
  agentId: string;
  draftText: string;
  source: GrowthPendingTaskContext["source"];
  preferCultivate?: boolean;
  llm?: ReturnType<typeof createAgentKnowledgeLlmCaller>;
}): Promise<RobotGrowthStatusPayload | null> {
  const draft = params.draftText.trim();
  if (!draft) {
    return null;
  }
  const current =
    (await readRobotGrowthStatus(params.cfg, params.agentId)) ??
    createInitialGrowthStatus({ kind: "robot", atMs: Date.now() });
  const template = resolveTemplateOrDefault(current.templateId);
  const installedSkillKeys = collectInstalledSkillKeys(params.agentId);
  let recommendations: Array<{ skillId: string; name: string; summary?: string }> = [];
  try {
    recommendations = listSkillRecommendations(params.agentId).map((entry) => ({
      skillId: entry.skillId,
      name: entry.name,
      summary: entry.summary,
    }));
  } catch {
    recommendations = [];
  }
  const candidates = buildTaskSkillCandidates({ template, recommendations });
  const llm =
    params.llm !== undefined
      ? params.llm
      : createAgentKnowledgeLlmCaller({ cfg: params.cfg, agentId: params.agentId });
  const extracted = await extractTaskSkillRequirements({
    draftText: draft,
    candidates,
    installedSkillKeys,
    llm,
  });
  const extract =
    extracted ??
    fallbackTaskGapsFromTemplate({
      candidates,
      installedSkillKeys,
      templateRequiredSkillKeys: requiredSkillKeys(template),
    });
  const pending = toPendingTaskContext({
    draftText: draft,
    source: params.source,
    extract,
  });
  const saved = await setRobotPendingTaskContext(params.cfg, params.agentId, pending);
  if (!saved) {
    return null;
  }
  return buildRobotGrowthStatusPayload({
    agentId: params.agentId,
    growthStatus: saved,
    preferCultivate: params.preferCultivate === true,
    installedSkillKeys,
  });
}
