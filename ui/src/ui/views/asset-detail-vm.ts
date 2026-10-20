import type {
  CapabilityShareHistoryEntry,
  CapabilitySummary,
} from "../capability/employee-capability/types.ts";
import type {
  ApplicableScope,
  EnterpriseCapabilityAsset,
  InstallRelation,
} from "../capability/enterprise-capability/types.ts";
import type {
  CapabilityCatalogItemVM,
  CapabilityDistributionRowVM,
  CapabilityHealthItemVM2,
} from "../ports/platform/view-models/types.ts";
import type { SkillStatusEntry } from "../types.ts";
import { getStandardAssetDetailTab, type StandardAssetDetailTab } from "./asset-detail-tabs.ts";

export type AssetDetailFactVM = {
  label: string;
  value: string;
};

export type AssetDetailStatVM = {
  label: string;
  value: string;
};

export type AssetDetailTimelineBadgeVM = {
  label: string;
  variant: "tag" | "status";
  tone?: "success" | "danger" | "warning" | "neutral";
};

export type AssetDetailTimelineItemVM = {
  timestampLabel: string;
  primary: string;
  secondary: string;
  badge?: AssetDetailTimelineBadgeVM | null;
};

export type EnterpriseAssetDetailVM = {
  tabs: StandardAssetDetailTab[];
  definitionFacts: AssetDetailFactVM[];
  versionFacts: AssetDetailFactVM[];
  installFacts: AssetDetailFactVM[];
  contributionTimeline: AssetDetailTimelineItemVM[];
  reviewTimeline: AssetDetailTimelineItemVM[];
  installTimeline: AssetDetailTimelineItemVM[];
};

export type EmployeeAssetDetailVM = {
  tabs: StandardAssetDetailTab[];
  overviewStats: AssetDetailStatVM[];
  overviewFacts: AssetDetailFactVM[];
  definitionFacts: AssetDetailFactVM[];
  versionFacts: AssetDetailFactVM[];
  installFacts: AssetDetailFactVM[];
  versionTimeline: AssetDetailTimelineItemVM[];
  optimizationTimeline: AssetDetailTimelineItemVM[];
  shareTimeline: AssetDetailTimelineItemVM[];
};

export type PlatformAssetDetailVM = {
  tabs: StandardAssetDetailTab[];
  definitionFacts: AssetDetailFactVM[];
  versionFacts: AssetDetailFactVM[];
  installFacts: AssetDetailFactVM[];
  runtimeFacts: AssetDetailFactVM[];
  runtimeTimeline: AssetDetailTimelineItemVM[];
};

function joinOrFallback(values: string[], fallback: string): string {
  return values.length > 0 ? values.join("、") : fallback;
}

export function formatAssetDetailTimestamp(ts: number): string {
  const d = new Date(ts);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

export function formatAssetDetailRelativeTime(updatedAt?: number | null): string {
  if (!updatedAt) {
    return "暂无";
  }
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) {
    return "暂无";
  }
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const time = date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  if (startOfDate === startOfToday) {
    return `今天 ${time}`;
  }
  if (startOfDate === startOfToday - 24 * 60 * 60 * 1000) {
    return `昨天 ${time}`;
  }
  return `${date.toLocaleDateString("zh-CN", {
    month: "numeric",
    day: "numeric",
  })} ${time}`;
}

export function formatEnterpriseApplicableScope(scope: ApplicableScope): string {
  switch (scope.kind) {
    case "enterprise":
      return "全企业";
    case "department":
      return `部门：${scope.name}`;
    case "group":
      return `小组：${scope.name}`;
    case "role":
      return `角色：${scope.name}`;
  }
}

export function formatEnterpriseLifecycleLabel(
  lifecycle: EnterpriseCapabilityAsset["lifecycle"],
): string {
  switch (lifecycle) {
    case "submitted":
      return "已提交";
    case "reviewing":
      return "审核中";
    case "approved":
      return "已通过";
    case "published":
      return "已发布";
    case "deprecated":
      return "即将下线";
    case "retired":
      return "已下线";
  }
}

export function formatPlatformEmployeeVisibilityMode(
  mode?: CapabilityCatalogItemVM["employeeVisibilityMode"] | null,
): string {
  switch (mode) {
    case "direct_employee_visible":
      return "员工可直接安装";
    case "enterprise_review_required":
    default:
      return "员工安装需企业审核";
  }
}

export function formatInstallSource(source: string): string {
  switch (source) {
    case "platform-marketplace":
      return "平台市场";
    case "enterprise-distributed":
      return "企业分发";
    case "external-local":
      return "外部/本地";
    case "dabai-proxy":
      return "大白代理";
    case "robot-self-install":
      return "机器人自装";
    case "admin-push":
      return "管理员推送";
    default:
      return source;
  }
}

export function formatVersionCountLabel(count: number): string {
  return count <= 1 ? "1 次整理" : `${count} 次整理`;
}

export function formatUsageCountLabel(count: number): string {
  return `${count} 次调用`;
}

export function formatMetricCountLabel(count: number, unit: string): string {
  return `${count} ${unit}`;
}

export function buildEnterpriseAssetDetailVM(params: {
  capability: EnterpriseCapabilityAsset;
  installRelations: readonly InstallRelation[];
}): EnterpriseAssetDetailVM {
  const { capability, installRelations } = params;
  return {
    tabs: [
      getStandardAssetDetailTab("overview"),
      getStandardAssetDetailTab("definition"),
      getStandardAssetDetailTab("files"),
      {
        ...getStandardAssetDetailTab("versions"),
        badge:
          capability.reviewHistory.length + capability.contributionHistory.length > 0
            ? String(capability.reviewHistory.length + capability.contributionHistory.length)
            : null,
      },
      {
        ...getStandardAssetDetailTab("runtime"),
        badge: capability.healthNoTelemetry ? "新" : null,
      },
      {
        ...getStandardAssetDetailTab("install"),
        badge: installRelations.length > 0 ? String(installRelations.length) : null,
      },
    ],
    definitionFacts: [
      { label: "能力领域", value: capability.domain },
      { label: "适用对象", value: formatEnterpriseApplicableScope(capability.applicableScope) },
      { label: "生命周期", value: formatEnterpriseLifecycleLabel(capability.lifecycle) },
      { label: "来源员工", value: capability.source.employee.name },
      { label: "来源机器人", value: capability.source.robot.name },
      { label: "来源任务", value: capability.source.task.summary },
      { label: "创建时间", value: formatAssetDetailTimestamp(capability.createdAt) },
      { label: "更新时间", value: formatAssetDetailTimestamp(capability.updatedAt) },
    ],
    versionFacts: [
      { label: "当前生命周期", value: formatEnterpriseLifecycleLabel(capability.lifecycle) },
      { label: "最近更新时间", value: formatAssetDetailTimestamp(capability.updatedAt) },
      { label: "贡献记录数", value: `${capability.contributionHistory.length} 条` },
      { label: "审核记录数", value: `${capability.reviewHistory.length} 条` },
    ],
    installFacts: [
      { label: "安装记录数", value: `${installRelations.length} 条` },
      {
        label: "当前分发状态",
        value: installRelations.length > 0 ? "已建立岗位分发" : "尚未建立岗位分发",
      },
    ],
    contributionTimeline: capability.contributionHistory
      .toSorted((a, b) => a.timestamp - b.timestamp)
      .map((record) => ({
        timestampLabel: formatAssetDetailTimestamp(record.timestamp),
        primary: record.employeeName,
        secondary: record.summary,
        badge: {
          label: record.type,
          variant: "tag",
        },
      })),
    reviewTimeline: capability.reviewHistory
      .toSorted((a, b) => b.timestamp - a.timestamp)
      .map((record) => ({
        timestampLabel: formatAssetDetailTimestamp(record.timestamp),
        primary: record.reviewerName,
        secondary: record.opinion || "—",
        badge: {
          label: record.result,
          variant: "status",
          tone:
            record.result === "通过" ? "success" : record.result === "拒绝" ? "danger" : "warning",
        },
      })),
    installTimeline: installRelations.map((relation) => ({
      timestampLabel: formatAssetDetailTimestamp(relation.installedAt),
      primary: relation.robotName,
      secondary: relation.status,
      badge: {
        label: relation.source,
        variant: "tag",
      },
    })),
  };
}

function buildShareTimeline(history: CapabilityShareHistoryEntry[]): AssetDetailTimelineItemVM[] {
  if (history.length === 0) {
    return [];
  }
  // history is already sorted newest-first from the backend
  return history.map((entry) => ({
    timestampLabel: formatAssetDetailTimestamp(entry.sharedAt),
    primary: entry.sharedByDisplayName,
    secondary: `分享到「${entry.groupName}」`,
    badge: {
      label: "协作分享",
      variant: "tag" as const,
    },
  }));
}

export function buildEmployeeAssetDetailVM(params: {
  capability: CapabilitySummary;
  availableGroups: Array<{ id: string; name: string }>;
}): EmployeeAssetDetailVM {
  const { capability, availableGroups } = params;
  const enterpriseStage = capability.enterpriseLifecycle?.stageLabel ?? capability.shareVisibility;
  const enterpriseNextStep =
    capability.enterpriseLifecycle?.nextStep ??
    capability.enterpriseReview?.nextStep ??
    capability.feedbackSummary ??
    "继续整理后可共享或提交企业。";
  const reviewerNote =
    capability.enterpriseLifecycle?.reviewerNote ??
    capability.enterpriseReview?.reviewerNote ??
    capability.feedbackSummary ??
    null;
  const contributed =
    capability.shareVisibility === "审核中" ||
    capability.shareVisibility === "需要修改后再次提交" ||
    capability.shareVisibility === "已进入企业资产库";

  return {
    tabs: [
      getStandardAssetDetailTab("overview"),
      getStandardAssetDetailTab("definition"),
      getStandardAssetDetailTab("files"),
      {
        ...getStandardAssetDetailTab("versions"),
        badge: String(capability.versionInfo.versionCount),
      },
      {
        ...getStandardAssetDetailTab("runtime"),
        badge: capability.health === "运行稳定" ? null : "关注",
      },
      {
        ...getStandardAssetDetailTab("install"),
        badge:
          capability.usageMetrics.groupCount > 0
            ? String(capability.usageMetrics.groupCount)
            : availableGroups.length > 0
              ? "协作"
              : null,
      },
    ],
    overviewStats: [
      { label: "状态", value: enterpriseStage },
      { label: "当前版本", value: capability.versionInfo.currentVersion },
      { label: "已提交版本", value: capability.versionInfo.submittedVersion ?? "未提交" },
      { label: "迭代次数", value: formatVersionCountLabel(capability.versionInfo.versionCount) },
      {
        label: "机器人使用",
        value: formatMetricCountLabel(capability.usageMetrics.robotCount, "个机器人"),
      },
      { label: "累计调用", value: formatUsageCountLabel(capability.usageMetrics.totalUsageCount) },
      { label: "最近更新", value: formatAssetDetailRelativeTime(capability.updatedAt) },
    ],
    overviewFacts: [
      { label: "来源", value: capability.sourceContextLabel ?? "最近一次工作整理" },
      { label: "企业链路", value: enterpriseNextStep },
      { label: "一句话说明", value: capability.summary },
    ],
    definitionFacts: [
      { label: "来源", value: capability.sourceContextLabel ?? "最近一次工作整理" },
      { label: "企业链路", value: enterpriseNextStep },
      ...(reviewerNote ? [{ label: "审核意见", value: reviewerNote }] : []),
      { label: "分类", value: capability.category || "未分类" },
      { label: "标签", value: joinOrFallback(capability.tags, "暂无标签") },
      { label: "输入", value: capability.inputDescription || "暂无" },
      { label: "输出", value: capability.outputDescription || "暂无" },
    ],
    versionFacts: [
      { label: "当前版本", value: capability.versionInfo.currentVersion },
      { label: "已提交版本", value: capability.versionInfo.submittedVersion ?? "未提交" },
      { label: "整理次数", value: formatVersionCountLabel(capability.versionInfo.versionCount) },
      { label: "最近更新", value: formatAssetDetailRelativeTime(capability.updatedAt) },
    ],
    installFacts: [
      { label: "当前可见性", value: capability.shareVisibility },
      {
        label: "协作组覆盖",
        value:
          capability.usageMetrics.groupCount > 0
            ? `${capability.usageMetrics.groupCount} 个协作组正在复用`
            : "还未共享到协作组",
      },
      {
        label: "企业提交状态",
        value: contributed ? "已进入企业链路" : "可继续提交企业",
      },
      ...(capability.installSource
        ? [{ label: "安装来源", value: formatInstallSource(capability.installSource) }]
        : []),
      ...(capability.configurationState
        ? [
            {
              label: "配置状态",
              value:
                capability.configurationState === "complete"
                  ? "配置完成"
                  : capability.configurationState === "pending"
                    ? "待配置"
                    : "无需配置",
            },
          ]
        : []),
      ...(capability.governanceState && capability.governanceState !== "none"
        ? [
            {
              label: "治理状态",
              value:
                capability.governanceState === "restricted"
                  ? "已受限"
                  : capability.governanceState === "review-required"
                    ? "待审核"
                    : "已禁用",
            },
          ]
        : []),
      ...(capability.boundRobotIds && capability.boundRobotIds.length > 0
        ? [{ label: "已绑定机器人", value: `${capability.boundRobotIds.length} 个` }]
        : []),
      ...(capability.installRequestHistory && capability.installRequestHistory.length > 0
        ? [{ label: "安装请求数", value: `${capability.installRequestHistory.length} 条` }]
        : []),
      ...(capability.sanitizationState
        ? [
            {
              label: "脱敏状态",
              value:
                capability.sanitizationState === "complete"
                  ? "已脱敏"
                  : capability.sanitizationState === "in-progress"
                    ? "脱敏中"
                    : capability.sanitizationState === "failed"
                      ? "脱敏失败"
                      : "未开始",
            },
          ]
        : []),
    ],
    versionTimeline: capability.recentUpdate
      ? [
          {
            timestampLabel: formatAssetDetailRelativeTime(capability.recentUpdate.at),
            primary: "版本迭代",
            secondary: capability.recentUpdate.headline,
            badge: {
              label: "最近更新",
              variant: "tag",
            },
          },
        ]
      : [],
    optimizationTimeline:
      capability.optimizationTargets?.map((target) => ({
        timestampLabel: "回到场景",
        primary: target.name,
        secondary: target.kind === "robot" ? "回到原机器人继续优化" : "回到原协作组继续优化",
        badge: {
          label: target.kind === "robot" ? "机器人" : "协作组",
          variant: "tag",
        },
      })) ?? [],
    shareTimeline: buildShareTimeline(capability.shareHistory ?? []),
  };
}

export function buildPlatformAssetDetailVM(params: {
  selected: CapabilityCatalogItemVM;
  linkedSkill: SkillStatusEntry | null;
  linkedDistributionRows: CapabilityDistributionRowVM[];
  healthIssues: CapabilityHealthItemVM2[];
  missing: string[];
}): PlatformAssetDetailVM {
  const { selected, linkedSkill, linkedDistributionRows, healthIssues, missing } = params;
  const runtimeBadge =
    missing.length > 0 ? String(missing.length) : healthIssues.length > 0 ? "关注" : null;
  return {
    tabs: [
      getStandardAssetDetailTab("overview"),
      getStandardAssetDetailTab("definition"),
      getStandardAssetDetailTab("files"),
      getStandardAssetDetailTab("versions"),
      {
        ...getStandardAssetDetailTab("runtime"),
        badge: runtimeBadge,
      },
      getStandardAssetDetailTab("install"),
    ],
    definitionFacts: [
      { label: "能力 ID", value: selected.id },
      { label: "能力分类", value: selected.categoryLabel },
      { label: "来源标签", value: selected.sourceLabel },
      { label: "来源归属", value: selected.sourceOrigin },
      { label: "可信级别", value: selected.trustLabel },
      { label: "发布状态", value: selected.statusLabel },
      { label: "版本号", value: selected.version ? `v${selected.version}` : "未标注" },
      { label: "Skill Key", value: selected.skillKey ?? "未映射" },
    ],
    versionFacts: [
      { label: "当前版本", value: selected.version ? `v${selected.version}` : "未标注" },
      { label: "当前状态", value: selected.statusLabel },
      { label: "来源渠道", value: selected.sourceLabel },
    ],
    installFacts: [
      { label: "能力状态", value: selected.statusLabel },
      {
        label: "员工可见性",
        value: formatPlatformEmployeeVisibilityMode(selected.employeeVisibilityMode),
      },
      { label: "默认启用", value: selected.defaultEnabled === false ? "否" : "是" },
      { label: "可直接安装", value: selected.installable ? "是" : "待补齐前置条件" },
      {
        label: "租户覆盖",
        value:
          linkedDistributionRows.length > 0
            ? `${linkedDistributionRows.length} 个租户已覆盖`
            : "暂未配置租户覆盖",
      },
    ],
    runtimeFacts: linkedSkill
      ? [
          {
            label: "运行状态",
            value: linkedSkill.disabled ? "已禁用" : missing.length > 0 ? "待补齐运行前置" : "可用",
          },
          {
            label: "命令依赖",
            value: linkedSkill.requirements.bins.length
              ? linkedSkill.requirements.bins.join(", ")
              : "无外部命令依赖",
          },
          {
            label: "环境变量",
            value: linkedSkill.requirements.env.length
              ? linkedSkill.requirements.env.join(", ")
              : "无额外环境变量",
          },
          {
            label: "配置项",
            value: linkedSkill.requirements.config.length
              ? linkedSkill.requirements.config.join(", ")
              : "无额外配置项",
          },
          {
            label: "系统限制",
            value: linkedSkill.requirements.os.length
              ? linkedSkill.requirements.os.join(", ")
              : "无特定系统限制",
          },
        ]
      : [],
    runtimeTimeline: [
      ...(linkedSkill
        ? [
            {
              timestampLabel: "当前",
              primary: linkedSkill.name,
              secondary: linkedSkill.disabled ? "已禁用，等待重新启用" : "已接入运行时技能配置",
              badge: {
                label: linkedSkill.disabled ? "已禁用" : "已接通",
                variant: "status",
                tone: linkedSkill.disabled ? "warning" : "success",
              },
            } satisfies AssetDetailTimelineItemVM,
          ]
        : []),
      ...missing.map(
        (entry) =>
          ({
            timestampLabel: "待补齐",
            primary: entry,
            secondary: entry.startsWith("bin:")
              ? "缺少命令依赖，需要安装后才能正常运行。"
              : entry.startsWith("env:")
                ? "缺少环境变量，需要补齐凭证或配置。"
                : "存在运行前置缺口，需要手动处理。",
            badge: {
              label: "待处理",
              variant: "status",
              tone: "warning",
            },
          }) satisfies AssetDetailTimelineItemVM,
      ),
      ...healthIssues.map(
        (item) =>
          ({
            timestampLabel:
              item.severity === "critical" ? "严重" : item.severity === "warning" ? "预警" : "提示",
            primary: item.subtitle,
            secondary: item.meta,
            badge: {
              label:
                item.severity === "critical"
                  ? "严重"
                  : item.severity === "warning"
                    ? "预警"
                    : "提示",
              variant: "status",
              tone:
                item.severity === "critical"
                  ? "danger"
                  : item.severity === "warning"
                    ? "warning"
                    : "neutral",
            },
          }) satisfies AssetDetailTimelineItemVM,
      ),
    ],
  };
}
