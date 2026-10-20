/**
 * Agent Growth OS — 上岗主建议决策器（P0，纯函数）。
 *
 * 默认任务优先；preferCultivate 时把身份确认提前。不新建第二套生命周期。
 */

import type { LifecycleState } from "./types.js";

export type GrowthCapabilityGapView = {
  key: string;
  label: string;
  kind: "skill" | "oauth" | "knowledge_binding" | "workflow";
  status: "missing" | "pending_integration" | "satisfied";
};

export type GrowthFunnelFlags = {
  hasSessionOpened: boolean;
  hasIdentityCompleted: boolean;
  hasFirstSkillInstalled: boolean;
  hasFirstMissionSent: boolean;
  hasFirstMissionSuccess: boolean;
  preludeDismissed: boolean;
};

export type NextGrowthActionKind =
  | "start_work"
  | "confirm_identity"
  | "install_capabilities"
  | "verify_with_task"
  | "none";

export type NextGrowthActionTarget = {
  focusComposer?: boolean;
  prefill?: string;
  module?: "assistant" | "knowledge" | "settings";
  tab?: "skills";
  recommendedSkillKeys?: string[];
  /** P1：有 pending 草稿时由 UI 拉起「继续原任务」条，不预填 composer。 */
  resumePendingTask?: boolean;
};

export type NextGrowthAction = {
  kind: NextGrowthActionKind;
  reason: string;
  priority: number;
  gaps: GrowthCapabilityGapView[];
  canSkip: boolean;
  target: NextGrowthActionTarget;
};

const NONE: NextGrowthAction = {
  kind: "none",
  reason: "growth.recommend.none",
  priority: 999,
  gaps: [],
  canSkip: true,
  target: {},
};

function unmetSkillGaps(gaps: GrowthCapabilityGapView[]): GrowthCapabilityGapView[] {
  return gaps.filter((gap) => gap.kind === "skill" && gap.status === "missing");
}

export function deriveGrowthFunnelFlags(params: {
  lifecycleState: LifecycleState;
  preludeDismissedAtMs?: number | null;
  milestones?: {
    sessionOpenedAtMs?: number | null;
    identityCompletedAtMs?: number | null;
    firstSkillInstalledAtMs?: number | null;
    firstMissionSentAtMs?: number | null;
    firstMissionSuccessAtMs?: number | null;
  } | null;
  isActivated?: boolean;
}): GrowthFunnelFlags {
  const milestones = params.milestones ?? {};
  const positive = (value: unknown): boolean =>
    typeof value === "number" && Number.isFinite(value) && value > 0;
  return {
    hasSessionOpened: positive(milestones.sessionOpenedAtMs),
    hasIdentityCompleted: positive(milestones.identityCompletedAtMs),
    hasFirstSkillInstalled: positive(milestones.firstSkillInstalledAtMs),
    hasFirstMissionSent: positive(milestones.firstMissionSentAtMs),
    hasFirstMissionSuccess:
      positive(milestones.firstMissionSuccessAtMs) || params.isActivated === true,
    preludeDismissed: positive(params.preludeDismissedAtMs),
  };
}

/**
 * 输入成长漏斗 + 模板缺口（+ 可选任务缺口），输出唯一主建议。
 * preferCultivate：用户主动选择「开始培养」时优先确认身份。
 * taskGaps：P1 任务解析结果；install 推荐键优先任务 unmet。
 */
export function resolveNextGrowthAction(input: {
  lifecycleState: LifecycleState;
  funnel: GrowthFunnelFlags;
  gaps: GrowthCapabilityGapView[];
  preferCultivate?: boolean;
  taskGaps?: GrowthCapabilityGapView[];
  pendingDraftText?: string | null;
}): NextGrowthAction {
  const { funnel, lifecycleState } = input;
  if (funnel.preludeDismissed || lifecycleState === "activated" || lifecycleState === "evolution") {
    return NONE;
  }

  const templateUnmet = unmetSkillGaps(input.gaps);
  const taskUnmet = unmetSkillGaps(input.taskGaps ?? []);
  const installGaps = taskUnmet.length > 0 ? taskUnmet : templateUnmet;
  const forTask = taskUnmet.length > 0;
  const preferCultivate = input.preferCultivate === true;
  const pendingDraft =
    typeof input.pendingDraftText === "string" ? input.pendingDraftText.trim() : "";

  if (preferCultivate && !funnel.hasIdentityCompleted) {
    return {
      kind: "confirm_identity",
      reason: "growth.recommend.confirm_identity",
      priority: 10,
      gaps: [],
      canSkip: true,
      target: { focusComposer: true },
    };
  }

  if (!funnel.hasFirstMissionSent && !preferCultivate) {
    return {
      kind: "start_work",
      reason: "growth.recommend.start_work",
      priority: 20,
      gaps: installGaps,
      canSkip: true,
      target: { focusComposer: true },
    };
  }

  if (installGaps.length > 0) {
    return {
      kind: "install_capabilities",
      reason: forTask
        ? "growth.recommend.install_for_task"
        : "growth.recommend.install_capabilities",
      priority: 30,
      gaps: installGaps,
      canSkip: true,
      target: {
        module: "assistant",
        tab: "skills",
        recommendedSkillKeys: installGaps.map((gap) => gap.key),
      },
    };
  }

  if (!funnel.hasIdentityCompleted) {
    return {
      kind: "confirm_identity",
      reason: "growth.recommend.confirm_identity",
      priority: 40,
      gaps: [],
      canSkip: true,
      target: { focusComposer: true },
    };
  }

  if (funnel.hasFirstMissionSent && !funnel.hasFirstMissionSuccess) {
    return {
      kind: "verify_with_task",
      reason: "growth.recommend.verify_with_task",
      priority: 50,
      gaps: [],
      canSkip: true,
      target: pendingDraft ? { resumePendingTask: true } : { focusComposer: true },
    };
  }

  if (!funnel.hasFirstMissionSent && preferCultivate) {
    return {
      kind: "start_work",
      reason: "growth.recommend.start_work",
      priority: 60,
      gaps: [],
      canSkip: true,
      target: { focusComposer: true },
    };
  }

  return NONE;
}
