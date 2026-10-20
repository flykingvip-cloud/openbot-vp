import type { MyCapabilityListItem } from "../my-accumulation.ts";
import { loadLocalAdoptionOverlay, mergeAdoptionEvidence } from "./adoption-sync.ts";
import { deriveIncubationDecision } from "./scorer.ts";

export type OrganizationalIncubationBadge = "L4" | "admin";

export function deriveOrganizationalIncubationBadge(
  item: MyCapabilityListItem,
): OrganizationalIncubationBadge | null {
  const fromVisibility = loadLocalAdoptionOverlay({
    capabilityId: item.id,
    shareVisibility: item.shareVisibility,
  });
  const adoption = mergeAdoptionEvidence(fromVisibility, {
    distinctMemberCount: Math.max(fromVisibility.distinctMemberCount, item.usageBrief.robotCount),
    sharedToGroup: fromVisibility.sharedToGroup,
    adminRecommended: fromVisibility.adminRecommended,
    enterpriseSubmitted: fromVisibility.enterpriseSubmitted,
  });

  if (adoption.adminRecommended) {
    return "admin";
  }

  // 组织级候选是"自动晋级"结论：必须先完成规范内容填充（资产准入），否则不成立。
  // incubationReady 由后端权威计算（evaluateAssetContentReadiness）。
  if (item.incubationReady === false) {
    return null;
  }

  // 用资产的真实证据推导稳定性，而不是写死 recurrence / reviewEngineStableCluster：
  //  - 累计调用（totalUsageCount）≈ 真实复现频次
  //  - 迭代次数（versionCount）≈ 员工主动整理次数
  //  - 协作组复用数（groupCount）≈ 协作链路复用
  // 仅"分享到协作组"这一个动作不再足以晋级为组织级候选。
  const decision = deriveIncubationDecision({
    evidence: {
      recurrenceCount: item.usageMetrics.totalUsageCount,
      userInitiatedSaveCount: item.versionInfo.versionCount,
      collaborationReuseCount: item.usageMetrics.groupCount,
      adoption,
    },
    source: "review-engine",
    contextId: item.id,
  });

  if (decision.level === "L4") {
    return "L4";
  }

  return null;
}

export function organizationalBadgeLabel(badge: OrganizationalIncubationBadge): string {
  if (badge === "admin") {
    return "管理员推荐";
  }
  return "组织级候选";
}
