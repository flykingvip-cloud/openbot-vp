/**
 * Agent Growth OS — 跨 handler 幂等写入机器人成长里程碑（P0）。
 */

import type { OpenBotConfig } from "../../config/config.js";
import { createInitialGrowthStatus } from "./factory.js";
import { applyActivationTransition, deriveLifecycleState } from "./lifecycle.js";
import { recordMilestone } from "./milestones.js";
import { updateRobotGrowthStatus } from "./store.js";
import { resolveTemplateOrDefault } from "./templates/index.js";
import type { GrowthMilestones, GrowthStatus } from "./types.js";

function applyMilestone(
  base: GrowthStatus,
  key: keyof GrowthMilestones,
  atMs: number,
): GrowthStatus {
  if (key === "firstMissionSuccessAtMs") {
    const activated = applyActivationTransition(base, { type: "first_mission_success", atMs });
    const template = resolveTemplateOrDefault(activated.templateId);
    return {
      ...activated,
      lifecycleState: deriveLifecycleState(activated, template.missionReadyThreshold),
    };
  }
  const milestones = recordMilestone(base.milestones, key, atMs);
  const next = { ...base, milestones };
  const template = resolveTemplateOrDefault(next.templateId);
  return {
    ...next,
    lifecycleState: deriveLifecycleState(next, template.missionReadyThreshold),
  };
}

/** first-write-wins 写入机器人里程碑；不存在 growth-status 时初始化。 */
export async function recordRobotGrowthMilestone(
  cfg: OpenBotConfig,
  agentId: string,
  key: keyof GrowthMilestones,
  atMs = Date.now(),
): Promise<GrowthStatus | null> {
  return await updateRobotGrowthStatus(cfg, agentId, (current) => {
    const base = current ?? createInitialGrowthStatus({ kind: "robot", atMs });
    return applyMilestone(base, key, atMs);
  });
}
