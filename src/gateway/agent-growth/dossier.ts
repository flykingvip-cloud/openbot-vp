/**
 * Agent Growth OS — P2 成长档案四区投影（身份/能力/表现/建议）。
 *
 * 服务端算好 completeness + 摘要，UI 只渲染，不臆造 lifecycle。
 */

import {
  deriveGrowthFunnelFlags,
  type GrowthCapabilityGapView,
  type GrowthFunnelFlags,
  type NextGrowthAction,
} from "./next-action.js";
import { detectFalseReady } from "./operational-score.js";
import type { GrowthDimension, GrowthReportSnapshot, GrowthStatus } from "./types.js";

export type GrowthDossierZoneId = "identity" | "capability" | "performance" | "suggestion";

export type GrowthDossierCompleteness = Record<GrowthDossierZoneId, number>;

export type GrowthDossierProjection = {
  completeness: GrowthDossierCompleteness;
  activationScore: number;
  operationalScore: number | null;
  falseReady: boolean;
  dimensions: GrowthDimension;
  funnel: GrowthFunnelFlags;
  capabilityGaps: GrowthCapabilityGapView[];
  recommendation: NextGrowthAction;
  growthReport: GrowthReportSnapshot | null;
  level: number;
  recentEvents: Array<{ milestoneKey?: string; text: string; at?: string }>;
  sources: Array<"personal" | "group" | "skill_upgrade">;
};

const MILESTONE_LABELS: Record<string, string> = {
  createdAtMs: "创建机器人",
  sessionOpenedAtMs: "首次打开会话",
  birthPreludeShownAtMs: "完成诞生引导",
  firstCtaClickedAtMs: "完成首个引导动作",
  identityCompletedAtMs: "完善身份信息",
  firstSkillInstalledAtMs: "安装了首个能力",
  firstPermissionGrantedAtMs: "获得首个权限",
  firstKnowledgeUploadedAtMs: "上传了首份知识",
  rolesAssignedAtMs: "完成角色分配",
  workflowDefinedAtMs: "确定工作流程",
  alignmentCompletedAtMs: "完成协作对齐",
  missionReadyAtMs: "达到任务就绪",
  firstMissionSentAtMs: "发出首个任务",
  firstMissionSuccessAtMs: "首个任务成功",
  activatedAtMs: "成长激活",
};

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

/** 四区完成度：由 dimensions / gaps / funnel / score 派生。 */
export function computeDossierCompleteness(input: {
  dimensions: GrowthDimension;
  funnel: GrowthFunnelFlags;
  capabilityGaps: GrowthCapabilityGapView[];
  operationalScore: number | null;
  recommendation: NextGrowthAction;
  growthReport: GrowthReportSnapshot | null | undefined;
}): GrowthDossierCompleteness {
  const unmetSkills = input.capabilityGaps.filter(
    (gap) => gap.kind === "skill" && gap.status === "missing",
  ).length;
  const identity = input.funnel.hasIdentityCompleted
    ? Math.max(input.dimensions.identity, 80)
    : input.dimensions.identity;
  const capabilityBase = input.dimensions.capability;
  const capability =
    unmetSkills === 0
      ? Math.max(capabilityBase, input.funnel.hasFirstSkillInstalled ? 60 : capabilityBase)
      : Math.min(capabilityBase, Math.max(0, 90 - unmetSkills * 15));
  const performance =
    input.operationalScore !== null
      ? input.operationalScore
      : input.growthReport
        ? clampPercent((input.growthReport.taskSuccessRate ?? 0) * 100)
        : input.funnel.hasFirstMissionSuccess
          ? 40
          : input.funnel.hasFirstMissionSent
            ? 20
            : 0;
  const suggestion =
    input.recommendation.kind === "none"
      ? input.growthReport?.topInsights?.length
        ? 70
        : 100
      : 50;
  return {
    identity: clampPercent(identity),
    capability: clampPercent(capability),
    performance: clampPercent(performance),
    suggestion: clampPercent(suggestion),
  };
}

export function buildGrowthDossierProjection(params: {
  growthStatus: GrowthStatus;
  capabilityGaps: GrowthCapabilityGapView[];
  recommendation: NextGrowthAction;
  funnel?: GrowthFunnelFlags;
}): GrowthDossierProjection {
  const status = params.growthStatus;
  const funnel =
    params.funnel ??
    deriveGrowthFunnelFlags({
      lifecycleState: status.lifecycleState,
      preludeDismissedAtMs: status.preludeDismissedAtMs,
      milestones: status.milestones,
      isActivated: status.isActivated,
    });
  const growthReport = status.growthReport ?? null;
  const completeness = computeDossierCompleteness({
    dimensions: status.dimensions,
    funnel,
    capabilityGaps: params.capabilityGaps,
    operationalScore: status.operationalScore,
    recommendation: params.recommendation,
    growthReport,
  });
  const level = Math.max(0, Math.min(5, Math.round((status.activationScore ?? 0) / 20)));
  const recentEvents = Object.entries(status.milestones ?? {})
    .filter((entry): entry is [string, number] => typeof entry[1] === "number" && entry[1] > 0)
    .toSorted((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([key, atMs]) => ({
      milestoneKey: key,
      text: MILESTONE_LABELS[key] ?? key,
      at: new Date(atMs).toISOString(),
    }));
  const sources: Array<"personal" | "group" | "skill_upgrade"> = ["personal"];
  if (status.milestones?.firstSkillInstalledAtMs) {
    sources.push("skill_upgrade");
  }
  return {
    completeness,
    activationScore: status.activationScore,
    operationalScore: status.operationalScore,
    falseReady: detectFalseReady(status.activationScore, status.operationalScore),
    dimensions: status.dimensions,
    funnel,
    capabilityGaps: params.capabilityGaps,
    recommendation: params.recommendation,
    growthReport,
    level,
    recentEvents,
    sources,
  };
}
