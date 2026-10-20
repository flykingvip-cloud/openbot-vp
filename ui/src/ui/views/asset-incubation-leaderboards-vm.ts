import type { ContributionPerformanceItem } from "../capability/enterprise-capability/types.ts";
import type { DashboardVM } from "../ports/platform/view-models/types.ts";
import type { AssetLeaderboardSectionVM } from "./asset-incubation-leaderboards.ts";

export function scoreEnterpriseContributor(item: ContributionPerformanceItem): number {
  return (
    item.totalContributions * 4 +
    item.approvedCount * 8 +
    item.totalReuseEmployees * 2 +
    item.totalReuseRobots * 3 +
    item.averageMaturityLevel * 5 +
    item.averageSuccessRate
  );
}

export function scoreEnterpriseIterationContributor(item: ContributionPerformanceItem): number {
  return (
    item.totalReuseRobots * 5 +
    item.totalReuseEmployees * 3 +
    item.averageSuccessRate * 2 +
    item.approvalRate +
    item.totalContributions * 2
  );
}

export function buildEnterpriseContributorLeaderboardSections(
  contributors: ContributionPerformanceItem[],
): AssetLeaderboardSectionVM[] {
  const resolveName = (item: ContributionPerformanceItem): string => {
    const name = item.employeeName?.trim();
    if (name) {
      return name;
    }
    const dept = item.department?.trim();
    return dept ? `${dept} · 贡献者` : "未具名贡献者";
  };

  const creatorEntries = contributors
    .slice()
    .toSorted((a, b) => scoreEnterpriseContributor(b) - scoreEnterpriseContributor(a))
    .slice(0, 3)
    .map((item, index) => ({
      id: item.employeeId,
      entityType: "employee" as const,
      rank: index + 1,
      name: resolveName(item),
      subtitle: `${item.department} · 资产创作者`,
      description: "持续贡献高质量资产，并推动其正式入库与复用。",
      badge: item.approvalRate >= 80 ? "高通过率" : null,
      highlights: [
        `审核通过率 ${item.approvalRate}%`,
        `平均成熟度 ${item.averageMaturityLevel.toFixed(1)}`,
        `复用员工 ${item.totalReuseEmployees}`,
      ],
      primaryMetric: { label: "贡献资产", value: `${item.totalContributions} 项` },
      secondaryMetric: { label: "通过审核", value: `${item.approvedCount} 项` },
    }));

  const iterationEntries = contributors
    .slice()
    .toSorted(
      (a, b) => scoreEnterpriseIterationContributor(b) - scoreEnterpriseIterationContributor(a),
    )
    .slice(0, 3)
    .map((item, index) => ({
      id: `${item.employeeId}-iteration`,
      entityType: "employee" as const,
      rank: index + 1,
      name: resolveName(item),
      subtitle: `${item.department} · 迭代推动者`,
      description: "多次推动资产优化，并让资产在更多机器人和员工中复用。",
      badge: item.totalReuseRobots >= 10 ? "高扩散" : null,
      highlights: [
        `机器人复用 ${item.totalReuseRobots}`,
        `员工复用 ${item.totalReuseEmployees}`,
        `平均成功率 ${item.averageSuccessRate}%`,
      ],
      primaryMetric: { label: "机器人复用", value: `${item.totalReuseRobots}` },
      secondaryMetric: { label: "员工复用", value: `${item.totalReuseEmployees}` },
    }));

  return [
    {
      title: "创作者榜",
      description: "鼓励持续沉淀高质量资产，并推动其正式进入企业资产库。",
      entries: creatorEntries,
      emptyTitle: "暂无创作者榜数据",
      emptyDescription: "待接通贡献绩效后显示本期创作者榜。",
    },
    {
      title: "迭代贡献榜",
      description: "鼓励多次参与资产打磨、修订和跨团队复用扩散的贡献者。",
      entries: iterationEntries,
      emptyTitle: "暂无迭代贡献榜数据",
      emptyDescription: "待接通复用与成功率数据后显示迭代贡献榜。",
    },
  ];
}

export function buildPlatformEnterpriseLeaderboardSections(params: {
  enterprises: Array<{
    tenantId: string;
    label: string;
    status: string;
    contributionSummary?: {
      submittedAssetPackages?: number;
      approvedAssets?: number;
      incubationCandidates?: number;
      platformCandidates?: number;
      crossTenantReuseCount?: number;
      publishedSharedAssets?: number;
    };
  }>;
  installedCapabilityCount: number;
  runtimeHostCount: number;
  attentionCount: number;
}): AssetLeaderboardSectionVM[] {
  const entries = params.enterprises.slice(0, 3).map((entry, index) => {
    const contributionAssetCount =
      entry.contributionSummary?.submittedAssetPackages ??
      Math.max(1, params.installedCapabilityCount - index);
    const candidateCount =
      entry.contributionSummary?.platformCandidates ??
      entry.contributionSummary?.incubationCandidates ??
      Math.max(0, params.enterprises.length - index);
    const publishedSharedAssets = entry.contributionSummary?.publishedSharedAssets ?? 0;
    const crossTenantReuseCount = entry.contributionSummary?.crossTenantReuseCount ?? 0;
    const score =
      contributionAssetCount * 10 +
      candidateCount * 8 +
      publishedSharedAssets * 6 +
      crossTenantReuseCount * 5 +
      params.runtimeHostCount * 2 -
      index * 3;
    return {
      id: entry.tenantId,
      entityType: "enterprise" as const,
      rank: index + 1,
      name: entry.label,
      subtitle: "企业贡献者",
      description: "持续输出资产包并推动平台候选孵化。",
      badge: entry.status === "paid" ? "活跃企业" : null,
      highlights: [
        `综合贡献分 ${score}`,
        `租户状态 ${entry.status}`,
        `跨企业复用 ${crossTenantReuseCount}`,
      ],
      primaryMetric: {
        label: "平台贡献资产",
        value: `${contributionAssetCount} 项`,
      },
      secondaryMetric: {
        label: "进入平台候选",
        value: `${candidateCount} 项`,
      },
    };
  });

  return [
    {
      title: "热门贡献企业",
      description: "平台端重点关注持续提交资产、进入候选池并形成共享扩散的企业。",
      entries,
      emptyTitle: "暂无企业贡献榜数据",
      emptyDescription: "待接通企业贡献统计后显示。",
    },
  ];
}

export function withDashboardContributionLeaderboards(params: {
  dashboard: DashboardVM;
  enterprises: Array<{ tenantId: string; label: string; status: string }>;
  installedCapabilityCount: number;
  runtimeHostCount: number;
  attentionCount: number;
}): DashboardVM {
  return {
    ...params.dashboard,
    contributionLeaderboards: buildPlatformEnterpriseLeaderboardSections({
      enterprises: params.enterprises,
      installedCapabilityCount: params.installedCapabilityCount,
      runtimeHostCount: params.runtimeHostCount,
      attentionCount: params.attentionCount,
    }),
  };
}
