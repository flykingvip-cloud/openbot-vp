/**
 * Agent Growth OS — 初始状态工厂与重算编排（spec: agent-growth-lifecycle, P0A）。
 *
 * 纯函数：创建初始 GrowthStatus（创建挂钩 5.1 / 小组 state 4.2 复用），
 * 以及在维度/信号变化后重算 activationScore + capabilityReadiness + lifecycleState（recompute RPC 3.1）。
 */

import { deriveLifecycleState } from "./lifecycle.js";
import { createMilestones, recordMilestone } from "./milestones.js";
import { computeActivationScore, computeCapabilityReadiness } from "./readiness.js";
import { resolveTemplateOrDefault, DEFAULT_TEMPLATE_ID } from "./templates/index.js";
import type {
  CapabilityReadinessSignals,
  GrowthDimension,
  GrowthEntityKind,
  GrowthStatus,
} from "./types.js";

const ZERO_ROBOT_DIMENSIONS: GrowthDimension = {
  identity: 0,
  capability: 0,
  knowledge: 0,
  habits: 0,
};

const ZERO_GROUP_DIMENSIONS: GrowthDimension = {
  identity: 0,
  capability: 0,
  knowledge: 0,
  habits: 0,
  alignment: 0,
};

/** 创建初始 GrowthStatus（lifecycleState=birth、维度归零、绑定模板）。 */
export function createInitialGrowthStatus(params: {
  kind: GrowthEntityKind;
  atMs: number;
  templateId?: string | null;
}): GrowthStatus {
  const template = resolveTemplateOrDefault(params.templateId);
  const dimensions =
    params.kind === "group" ? { ...ZERO_GROUP_DIMENSIONS } : { ...ZERO_ROBOT_DIMENSIONS };
  return {
    lifecycleState: "birth",
    dimensions,
    birthAtMs: params.atMs,
    activationScore: 0,
    operationalScore: null,
    capabilityReadiness: false,
    isActivated: false,
    activatedAtMs: null,
    templateId: params.templateId ?? DEFAULT_TEMPLATE_ID,
    templateVersion: template.version,
    ...(params.kind === "group" ? { alignmentComplete: false } : {}),
    milestones: createMilestones(params.atMs),
  };
}

/**
 * 重算派生字段：给定最新维度 + 能力信号（+ 可选 alignment），
 * 重算 activationScore、capabilityReadiness、lifecycleState。不修改 milestones/isActivated。
 */
export function recomputeGrowthStatus(
  current: GrowthStatus,
  input: {
    dimensions: GrowthDimension;
    signals: CapabilityReadinessSignals;
    alignmentComplete?: boolean;
    nowMs?: number;
    /** P2：实战表现分（来自运营遥测信号）。提供时覆盖；未提供则保留原值。 */
    operationalScore?: number | null;
  },
): GrowthStatus {
  const template = resolveTemplateOrDefault(current.templateId);
  const activationScore = computeActivationScore(input.dimensions, template);
  const capabilityReadiness = computeCapabilityReadiness(input.dimensions, template, input.signals);
  const next: GrowthStatus = {
    ...current,
    dimensions: input.dimensions,
    activationScore,
    capabilityReadiness,
    ...(input.operationalScore === undefined ? {} : { operationalScore: input.operationalScore }),
    ...(input.alignmentComplete === undefined
      ? {}
      : { alignmentComplete: input.alignmentComplete }),
  };
  const lifecycleState = deriveLifecycleState(next, template.missionReadyThreshold);
  // R7.4：进入 mission_ready 时幂等记录 missionReadyAtMs（first-write-wins）。
  const milestones =
    lifecycleState === "mission_ready"
      ? recordMilestone(next.milestones, "missionReadyAtMs", input.nowMs ?? Date.now())
      : next.milestones;
  return { ...next, lifecycleState, milestones };
}
