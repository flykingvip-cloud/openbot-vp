/**
 * Agent Growth OS — get/recompute 响应组装（P0/P1/P2 onboarding 契约）。
 */

import { buildGrowthDossierProjection, type GrowthDossierProjection } from "./dossier.js";
import { collectInstalledSkillKeys } from "./installed-skills.js";
import {
  deriveGrowthFunnelFlags,
  resolveNextGrowthAction,
  type GrowthCapabilityGapView,
  type GrowthFunnelFlags,
  type NextGrowthAction,
} from "./next-action.js";
import { refreshPendingTaskGapViews } from "./pending-task-gap-sync.js";
import { buildCapabilityGapViews } from "./signals.js";
import { resolveTemplateOrDefault } from "./templates/index.js";
import type { GrowthStatus } from "./types.js";

export type RobotGrowthStatusPayload = {
  agentId: string;
  growthStatus: GrowthStatus;
  capabilityGaps: GrowthCapabilityGapView[];
  funnel: GrowthFunnelFlags;
  recommendation: NextGrowthAction;
  /** P1：任务缺口视图（来自 pendingTaskContext，随安装刷新 status）。 */
  taskGaps?: GrowthCapabilityGapView[];
  /** P2：成长档案四区投影（服务端算好）。 */
  dossier?: GrowthDossierProjection;
};

export function buildRobotGrowthStatusPayload(params: {
  agentId: string;
  growthStatus: GrowthStatus;
  preferCultivate?: boolean;
  installedSkillKeys?: Iterable<string>;
}): RobotGrowthStatusPayload {
  const template = resolveTemplateOrDefault(params.growthStatus.templateId);
  const installedSkillKeys = params.installedSkillKeys ?? collectInstalledSkillKeys(params.agentId);
  const capabilityGaps = buildCapabilityGapViews({ template, installedSkillKeys });
  const taskGaps = params.growthStatus.pendingTaskContext
    ? refreshPendingTaskGapViews(params.growthStatus.pendingTaskContext, installedSkillKeys)
    : [];
  const funnel = deriveGrowthFunnelFlags({
    lifecycleState: params.growthStatus.lifecycleState,
    preludeDismissedAtMs: params.growthStatus.preludeDismissedAtMs,
    milestones: params.growthStatus.milestones,
    isActivated: params.growthStatus.isActivated,
  });
  const pendingDraft = params.growthStatus.pendingTaskContext?.draftText ?? null;
  const recommendation = resolveNextGrowthAction({
    lifecycleState: params.growthStatus.lifecycleState,
    funnel,
    gaps: capabilityGaps,
    preferCultivate: params.preferCultivate === true,
    taskGaps,
    pendingDraftText: pendingDraft,
  });
  const dossier = buildGrowthDossierProjection({
    growthStatus: params.growthStatus,
    capabilityGaps,
    recommendation,
    funnel,
  });
  return {
    agentId: params.agentId,
    growthStatus: params.growthStatus,
    capabilityGaps,
    funnel,
    recommendation,
    dossier,
    ...(taskGaps.length > 0 ? { taskGaps } : {}),
  };
}
