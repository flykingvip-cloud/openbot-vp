import type {
  CapabilityShareVisibility,
  CapabilitySummary,
  EmployeeCapabilityConfigurationState,
  EmployeeCapabilityGovernanceState,
  EmployeeCapabilityInstallSource,
} from "../capability/employee-capability/types.ts";

export type MyCapabilityListItem = {
  id: string;
  name: string;
  summary: string;
  assetType?:
    | "prompt"
    | "template"
    | "workflow"
    | "knowledge"
    | "agent"
    | "capability"
    | "tool"
    | "mcp";
  health: CapabilitySummary["health"];
  shareVisibility: CapabilityShareVisibility;
  isDraft: boolean;
  recentUpdate: CapabilitySummary["recentUpdate"];
  updatedAt: number;
  sourceRobotName: string | null;
  sourceContextLabel?: string;
  usageBrief: {
    robotCount: number;
    lastUsedAt: number | null;
  };
  usageMetrics: CapabilitySummary["usageMetrics"];
  versionInfo: CapabilitySummary["versionInfo"];
  applicationSummary?: string;
  feedbackSummary?: string;
  enterpriseReview?: CapabilitySummary["enterpriseReview"];
  enterpriseLifecycle?: CapabilitySummary["enterpriseLifecycle"];
  optimizationTargets?: NonNullable<CapabilitySummary["optimizationTargets"]>;
  /** 安装来源（能力安装治理新增） */
  installSource?: EmployeeCapabilityInstallSource;
  /** 配置状态（能力安装治理新增） */
  configurationState?: EmployeeCapabilityConfigurationState;
  /** 治理状态（能力安装治理新增） */
  governanceState?: EmployeeCapabilityGovernanceState;
  /** 已绑定的机器人 ID 列表（能力安装治理新增） */
  boundRobotIds?: string[];
  /** 脱敏状态（能力安装治理新增） */
  sanitizationState?: "not-started" | "in-progress" | "complete" | "failed";
  /** 规范内容填充是否完成（资产孵化通道新增）；未完成不应被标记为组织级候选 */
  incubationReady?: boolean;
};

export type MyAccumulationSegment = "all" | "drafts" | "reviewing" | "contributed" | "optimize";

export type MyAccumulationFilters = {
  searchQuery: string;
  filterTag: string | null;
  filterCategory: string | null;
  filterSource: string | null;
  filterShareVisibility: CapabilityShareVisibility | null;
};

export function itemNeedsOptimization(
  item: Pick<
    MyCapabilityListItem,
    "shareVisibility" | "feedbackSummary" | "enterpriseLifecycle" | "health"
  >,
): boolean {
  return (
    item.enterpriseLifecycle?.stage === "needs_revision" ||
    item.shareVisibility === "需要修改后再次提交" ||
    item.feedbackSummary?.includes("建议优化") === true ||
    item.health === "需要重新整理" ||
    item.health === "偶尔异常"
  );
}

export function filterItemsBySegment<T extends MyCapabilityListItem>(
  items: readonly T[],
  segment: MyAccumulationSegment,
): T[] {
  switch (segment) {
    case "drafts":
      return items.filter((item) => item.isDraft);
    case "reviewing":
      return items.filter((item) => item.shareVisibility === "审核中");
    case "contributed":
      return items.filter((item) => item.shareVisibility === "已进入企业资产库");
    case "optimize":
      return items.filter((item) => itemNeedsOptimization(item));
    default:
      return [...items];
  }
}

export function filterCapabilities(
  capabilities: CapabilitySummary[],
  filters: MyAccumulationFilters,
): CapabilitySummary[] {
  const query = filters.searchQuery.trim().toLocaleLowerCase();
  return capabilities.filter((capability) => {
    const queryMatched =
      !query ||
      capability.name.toLocaleLowerCase().includes(query) ||
      capability.summary.toLocaleLowerCase().includes(query);
    const tagMatched = !filters.filterTag || capability.tags.includes(filters.filterTag);
    const categoryMatched =
      !filters.filterCategory || capability.category === filters.filterCategory;
    const sourceMatched =
      !filters.filterSource || capability.attribution.sourceRobot.name === filters.filterSource;
    const visibilityMatched =
      !filters.filterShareVisibility ||
      capability.shareVisibility === filters.filterShareVisibility;
    return queryMatched && tagMatched && categoryMatched && sourceMatched && visibilityMatched;
  });
}
