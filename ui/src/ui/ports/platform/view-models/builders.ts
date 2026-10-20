import { t } from "../../../../i18n/index.ts";
import type {
  CapabilityGovernanceSnapshot,
  CapabilityInvocationMetric,
  CapabilityLifecycleState,
  CapabilityProposalStatus,
  CapabilitySourceRef,
  SecurityFinding,
  SecurityFindingSeverity,
} from "../../../capability/capability-governance/types.ts";
import type {
  RuntimeCapabilityBinding,
  RuntimeHealth,
} from "../../../capability/runtime-canonical/index.ts";
import { pathForTab } from "../../../navigation.ts";
import { buildPlatformEnterpriseLeaderboardSections } from "../../../views/asset-incubation-leaderboards-vm.ts";
import type { ChannelsProps } from "../../../views/channels.types.ts";
import type { InstancesProps } from "../../../views/instances.ts";
import type { PlatformAuthPanelProps } from "../../../views/platform-auth-panel.ts";
import type { SkillsProps } from "../../../views/skills.ts";
import { formatCost, formatTokens } from "../../../views/usage-metrics.ts";
import type { PlatformPortReadModel } from "../semantic/platform-read-model.ts";
import { platformCreateTenantHref, platformSystemSettingsHref } from "../system-settings/route.ts";
import { platformTenantObjectKey, platformTenantSectionHref } from "../tenants/adapter.ts";
import type {
  CapabilitiesVM,
  CapabilityActiveItemVM,
  CapabilityCatalogItemVM,
  CapabilityCategoryId,
  CapabilityCategoryVM,
  CapabilityDistributionRowVM,
  CapabilityHealthItemVM,
  CapabilityHealthItemVM2,
  CapabilityProposalItemVM,
  CapabilityRegistryItemVM,
  PlatformPageViewModels,
} from "./types.ts";

type BuildPlatformPageViewModelsArgs = {
  basePath: string;
  readModel: PlatformPortReadModel;
  channelsProps: ChannelsProps;
  authPanelProps: PlatformAuthPanelProps | null;
  skillsProps: SkillsProps | null;
  instancesProps: InstancesProps | null;
  configDirty: boolean;
  configSaving: boolean;
  capabilityGovernanceSnapshot?: CapabilityGovernanceSnapshot;
};

function uniqueSortedStrings(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(values.map((value) => (typeof value === "string" ? value.trim() : "")).filter(Boolean)),
  ).toSorted((left, right) => left.localeCompare(right));
}

function platformEnterpriseStatusLabel(status: "trial" | "paid" | "suspended" | "expired") {
  switch (status) {
    case "trial":
      return "试用中";
    case "paid":
      return "正式租户";
    case "suspended":
      return "已暂停";
    case "expired":
      return "试用到期";
    default:
      return status;
  }
}

function platformEnterpriseSourceLabel(source: "self-service" | "platform-created") {
  return source === "platform-created" ? "平台创建" : "自助试用";
}

function platformAttentionItem(item: string, basePath: string, fallbackMeta: string) {
  const normalized = item.toLowerCase();
  if (normalized.includes("model providers")) {
    return {
      title: "配置模型提供方",
      subtitle: "当前没有平台模型 provider，模型池和能力部署都会缺少默认入口。",
      meta: "需要补齐",
      href: pathForTab("platformModels", basePath),
    };
  }
  if (normalized.includes("channels configured")) {
    return {
      title: "配置跨租户通道",
      subtitle: "当前没有可用于跨租户分发的通道，能力和资产管理无法完成投放闭环。",
      meta: "需要补齐",
      href: pathForTab("platformAdvanced", basePath),
    };
  }
  if (normalized.includes("update") || normalized.includes("version")) {
    return {
      title: "检查运行版本",
      subtitle: item,
      meta: "有更新",
      href: pathForTab("platformAdvanced", basePath),
    };
  }
  return {
    title: item,
    subtitle: "平台关注项",
    meta: fallbackMeta,
  };
}

// ---------------------------------------------------------------------------
// Dashboard view-model builders
// ---------------------------------------------------------------------------

type DashboardHealthTone = "ok" | "warn" | "danger" | "neutral" | "setup";

function recolorTrend(
  trend:
    | {
        direction: "up" | "down" | "flat";
        label: string;
        tone: "ok" | "warn" | "danger" | "neutral";
      }
    | undefined,
  preferDown: boolean,
):
  | { direction: "up" | "down" | "flat"; label: string; tone: "ok" | "warn" | "danger" | "neutral" }
  | undefined {
  if (!trend) {
    return undefined;
  }
  if (trend.direction === "flat") {
    return { ...trend, tone: "neutral" };
  }
  const isPositive = trend.direction === "up" ? !preferDown : preferDown;
  return { ...trend, tone: isPositive ? "ok" : "warn" };
}

function computeTrend(values: readonly number[]):
  | {
      direction: "up" | "down" | "flat";
      label: string;
      tone: "ok" | "warn" | "danger" | "neutral";
    }
  | undefined {
  if (!values || values.length < 2) {
    return undefined;
  }
  const sliced = values.slice(-14);
  const midpoint = Math.max(1, Math.floor(sliced.length / 2));
  const prev = sliced.slice(0, midpoint);
  const curr = sliced.slice(midpoint);
  const avg = (arr: readonly number[]) =>
    arr.length === 0 ? 0 : arr.reduce((sum, v) => sum + v, 0) / arr.length;
  const prevAvg = avg(prev);
  const currAvg = avg(curr);
  if (prevAvg === 0 && currAvg === 0) {
    return { direction: "flat", label: "持平", tone: "neutral" };
  }
  if (prevAvg === 0) {
    return { direction: "up", label: "新增", tone: "ok" };
  }
  const delta = (currAvg - prevAvg) / prevAvg;
  const pct = Math.abs(delta * 100);
  if (pct < 2) {
    return { direction: "flat", label: "持平", tone: "neutral" };
  }
  const sign = delta > 0 ? "+" : "-";
  return {
    direction: delta > 0 ? "up" : "down",
    label: `${sign}${pct.toFixed(pct >= 10 ? 0 : 1)}%`,
    tone: "neutral",
  };
}

function buildDashboardHealth(
  readModel: PlatformPortReadModel,
  basePath: string,
): {
  items: Array<{
    id: "runtime" | "providers" | "channels" | "errorRate" | "costAttribution" | "version";
    label: string;
    value: string;
    meta: string;
    tone: DashboardHealthTone;
    href?: string;
  }>;
  tone: "ok" | "warn" | "danger" | "neutral" | "setup";
  label: string;
} {
  const runtimeTone: DashboardHealthTone = readModel.presenceCount === 0 ? "warn" : "ok";
  const providerTone: DashboardHealthTone =
    readModel.configuredProviderCount === 0
      ? "setup"
      : readModel.providerHealthDirectory.some((entry) => entry.authStatus === "warn")
        ? "warn"
        : "ok";
  const channelTone: DashboardHealthTone =
    readModel.channelCount === 0
      ? "setup"
      : readModel.connectedAccountCount === 0 && readModel.accountCount > 0
        ? "warn"
        : "ok";
  const errorRate = readModel.currentUsageOverview.errorRate;
  const errorTone: DashboardHealthTone =
    readModel.currentUsageOverview.totalMessages === 0
      ? "neutral"
      : errorRate >= 0.05
        ? "danger"
        : errorRate >= 0.02
          ? "warn"
          : "ok";

  const items = [
    {
      id: "runtime" as const,
      label: "Runtime",
      value: readModel.presenceCount > 0 ? `${readModel.presenceCount} 在线` : "无上报节点",
      meta:
        readModel.runtimeHosts.length > 0 ? `${readModel.runtimeHosts.length} 台主机` : "等待上线",
      tone: runtimeTone,
      href: pathForTab("platformAdvanced", basePath),
    },
    {
      id: "providers" as const,
      label: "模型提供方",
      value:
        readModel.configuredProviderCount > 0
          ? `${readModel.configuredProviderCount} 个可用`
          : "未配置",
      meta: readModel.providerHealthDirectory.some((entry) => entry.authStatus === "warn")
        ? `${
            readModel.providerHealthDirectory.filter((entry) => entry.authStatus === "warn").length
          } 个缺凭证`
        : `${readModel.configuredModelCount} 个模型入池`,
      tone: providerTone,
      href: pathForTab("platformModels", basePath),
    },
    {
      id: "channels" as const,
      label: "分发通道",
      value:
        readModel.channelCount > 0
          ? `${readModel.connectedAccountCount}/${readModel.accountCount || readModel.channelCount} 已连接`
          : "未配置",
      meta: readModel.channelCount === 0 ? "等待配置" : `${readModel.channelCount} 个通道`,
      tone: channelTone,
      href: pathForTab("platformAdvanced", basePath),
    },
    {
      id: "errorRate" as const,
      label: "错误率",
      value:
        readModel.currentUsageOverview.totalMessages > 0
          ? `${(errorRate * 100).toFixed(errorRate >= 0.01 ? 1 : 2)}%`
          : "—",
      meta:
        readModel.currentUsageOverview.totalMessages > 0
          ? `${readModel.currentUsageOverview.errorCount} 错 / ${readModel.currentUsageOverview.totalMessages} 请求`
          : "暂无请求记录",
      tone: errorTone,
      href: pathForTab("platformModels", basePath),
    },
  ];

  const worst = items.reduce<DashboardHealthTone>((acc, item) => {
    const rank: Record<DashboardHealthTone, number> = {
      ok: 0,
      neutral: 1,
      setup: 2,
      warn: 3,
      danger: 4,
    };
    return rank[item.tone] > rank[acc] ? item.tone : acc;
  }, "ok");

  const label =
    worst === "danger"
      ? "平台存在告警"
      : worst === "warn"
        ? "平台需关注"
        : worst === "setup"
          ? "平台待初始化"
          : "平台运行正常";

  const overallTone =
    worst === "danger" ? "danger" : worst === "warn" ? "warn" : worst === "setup" ? "setup" : "ok";

  return { items, tone: overallTone, label };
}

function buildDashboardMetrics(readModel: PlatformPortReadModel, basePath: string) {
  const dailyCalls = readModel.currentUsageOverview.dailyCalls ?? [];
  const dailyCost = readModel.currentUsageOverview.dailyCost ?? [];
  // 趋势按业务语义着色：调用量上升=正向(ok)，成本上升=需关注(warn)。
  const callsTrend = recolorTrend(computeTrend(dailyCalls), false);
  const costTrend = recolorTrend(computeTrend(dailyCost), true);
  const tenantsTrend = (() => {
    const count = readModel.enterpriseDirectory.length || readModel.knownTenantIds.length;
    if (count === 0) {
      return undefined;
    }
    return { direction: "flat" as const, label: "当前", tone: "neutral" as const };
  })();

  const enterpriseCount = readModel.enterpriseDirectory.length || readModel.knownTenantIds.length;
  const trialCount = readModel.enterpriseDirectory.filter(
    (entry) => entry.status === "trial",
  ).length;
  const anomalousTenants = readModel.enterpriseDirectory.filter(
    (entry) => entry.status === "expired" || entry.status === "suspended",
  ).length;

  return [
    {
      id: "tenants",
      label: "租户总数",
      value: String(enterpriseCount),
      valueTone: "neutral" as const,
      icon: "tenants" as const,
      meta:
        trialCount > 0
          ? `试用 ${trialCount} · 异常 ${anomalousTenants}`
          : anomalousTenants > 0
            ? `异常 ${anomalousTenants}`
            : "运营中",
      trend: tenantsTrend,
      href: pathForTab("platformTenants", basePath),
    },
    {
      id: "calls",
      label: "AI 调用（7 日）",
      value: formatCompactNumber(
        dailyCalls.reduce((sum, v) => sum + v, 0) || readModel.currentUsageOverview.totalMessages,
      ),
      valueTone: "neutral" as const,
      icon: "sessions" as const,
      meta: readModel.currentUsageOverview.topModelLabel
        ? `TOP ${readModel.currentUsageOverview.topModelLabel}`
        : `${readModel.sessionsCount} 个会话`,
      trend: callsTrend,
      href: pathForTab("platformModels", basePath),
    },
    {
      id: "cost",
      label: "AI 成本（7 日）",
      value: formatCost(readModel.currentUsageOverview.totalCost || readModel.totalCost),
      valueTone: readModel.missingCostEntries > 0 ? ("warn" as const) : ("neutral" as const),
      icon: "cost" as const,
      meta:
        readModel.missingCostEntries > 0
          ? `${readModel.missingCostEntries} 条待归因`
          : `${formatTokens(readModel.totalTokens)} 令牌`,
      trend: costTrend,
      href: pathForTab("platformAdvanced", basePath),
    },
    {
      id: "models",
      label: "模型供给",
      value: String(readModel.configuredModelCount),
      valueTone: readModel.configuredModelCount > 0 ? ("ok" as const) : ("warn" as const),
      icon: "models" as const,
      meta: `${readModel.configuredProviderCount} 个 Provider`,
      href: pathForTab("platformModels", basePath),
    },
    {
      id: "capabilities",
      label: "能力覆盖",
      value: String(readModel.installedCapabilityCount),
      valueTone: readModel.installedCapabilityCount > 0 ? ("ok" as const) : ("warn" as const),
      icon: "capabilities" as const,
      meta: `${readModel.featureMethodCount} 个方法 · ${readModel.channelCount} 个通道`,
      href: pathForTab("platformCapabilities", basePath),
    },
  ];
}

function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return "—";
  }
  if (value === 0) {
    return "0";
  }
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`;
  }
  if (abs >= 10_000) {
    return `${(value / 1_000).toFixed(0)}k`;
  }
  if (abs >= 1_000) {
    return `${(value / 1_000).toFixed(1)}k`;
  }
  return String(Math.round(value));
}

function buildDashboardAttention(
  readModel: PlatformPortReadModel,
  basePath: string,
): Array<{
  id: string;
  severity: "critical" | "warning" | "info";
  category: "tenant" | "model" | "runtime" | "channel" | "cost" | "version" | "security";
  title: string;
  subtitle: string;
  meta?: string;
  actions: Array<{ label: string; href: string; kind: "primary" | "secondary" }>;
}> {
  const items: Array<{
    id: string;
    severity: "critical" | "warning" | "info";
    category: "tenant" | "model" | "runtime" | "channel" | "cost" | "version" | "security";
    title: string;
    subtitle: string;
    meta?: string;
    actions: Array<{ label: string; href: string; kind: "primary" | "secondary" }>;
  }> = [];

  // Suspended / expired tenants are critical
  const suspendedTenants = readModel.enterpriseDirectory.filter(
    (entry) => entry.status === "suspended" || entry.status === "expired",
  );
  for (const tenant of suspendedTenants.slice(0, 3)) {
    items.push({
      id: `tenant-${tenant.tenantId}`,
      severity: tenant.status === "expired" ? "critical" : "warning",
      category: "tenant",
      title: tenant.label,
      subtitle:
        tenant.status === "expired" ? "试用已到期，租户处于只读状态" : "租户已暂停，需要运营审核",
      meta: tenant.trialEndsAt,
      actions: [
        {
          label: tenant.status === "expired" ? "处理转化" : "查看详情",
          href: pathForTab("enterpriseOverview", basePath, { tenantId: tenant.tenantId }),
          kind: "primary",
        },
      ],
    });
  }

  // Trials about to expire (within 7 days)
  const nowMs = Date.now();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  const expiringTrials = readModel.enterpriseDirectory.filter((entry) => {
    if (entry.status !== "trial" || !entry.trialEndsAt) {
      return false;
    }
    const ms = Date.parse(entry.trialEndsAt);
    return Number.isFinite(ms) && ms - nowMs >= 0 && ms - nowMs <= sevenDaysMs;
  });
  for (const tenant of expiringTrials.slice(0, 3)) {
    items.push({
      id: `trial-${tenant.tenantId}`,
      severity: "warning",
      category: "tenant",
      title: `${tenant.label} 试用即将到期`,
      subtitle: `到期时间 ${tenant.trialEndsAt}`,
      meta: "7 日内",
      actions: [
        {
          label: "处理转化",
          href: pathForTab("enterpriseUsage", basePath, { tenantId: tenant.tenantId }),
          kind: "primary",
        },
        {
          label: "延长试用",
          href: platformTenantSectionHref(
            basePath,
            platformTenantObjectKey({ tenantId: tenant.tenantId }),
            "billing",
          ),
          kind: "secondary",
        },
      ],
    });
  }

  // Provider auth issues
  const providerAuthWarnings = readModel.providerHealthDirectory.filter(
    (entry) => entry.authStatus === "warn",
  );
  for (const provider of providerAuthWarnings.slice(0, 2)) {
    items.push({
      id: `provider-${provider.providerId}`,
      severity: "critical",
      category: "model",
      title: `${provider.providerId} 缺少凭证`,
      subtitle: provider.issue,
      meta: `${provider.modelCount} 个模型`,
      actions: [
        {
          label: "配置凭证",
          href: pathForTab("platformModels", basePath),
          kind: "primary",
        },
      ],
    });
  }

  // Model probe failures
  const probeFailures = (readModel.modelProbeDirectory ?? []).filter(
    (entry) => entry.status !== "ok",
  );
  for (const probe of probeFailures.slice(0, 2)) {
    items.push({
      id: `probe-${probe.providerId}-${probe.modelId ?? "default"}`,
      severity: probe.status === "auth" || probe.status === "billing" ? "critical" : "warning",
      category: "model",
      title: `${probe.providerId}${probe.modelId ? `/${probe.modelId}` : ""} 探测异常`,
      subtitle: probe.error || probe.label,
      meta: probe.status.toUpperCase(),
      actions: [
        {
          label: "查看模型治理",
          href: pathForTab("platformModels", basePath),
          kind: "primary",
        },
      ],
    });
  }

  // Cost attribution
  if (readModel.missingCostEntries > 0) {
    items.push({
      id: "cost-attribution",
      severity: readModel.missingCostEntries > 20 ? "warning" : "info",
      category: "cost",
      title: `${readModel.missingCostEntries} 条成本记录缺归因`,
      subtitle: "成本数据不完整，租户成本分摊可能失真",
      meta: formatCost(readModel.totalCost),
      actions: [
        {
          label: "查看使用分析",
          href: pathForTab("platformAdvanced", basePath),
          kind: "primary",
        },
      ],
    });
  }

  // Version update
  if (readModel.hasUpdateAvailable) {
    items.push({
      id: "version-update",
      severity: "info",
      category: "version",
      title: "平台有新版本可用",
      subtitle: `当前 ${readModel.currentVersion ?? t("common.na")} → 最新 ${
        readModel.latestVersion ?? t("common.na")
      }`,
      actions: [
        {
          label: "查看版本",
          href: pathForTab("platformAdvanced", basePath),
          kind: "primary",
        },
      ],
    });
  }

  // Provider / channel setup
  if (readModel.configuredProviderCount === 0) {
    items.push({
      id: "no-providers",
      severity: "critical",
      category: "model",
      title: "尚未配置模型提供方",
      subtitle: "平台无法路由任何 AI 调用，请先在模型治理中配置 provider 与默认主模型",
      actions: [
        {
          label: "前往模型治理",
          href: pathForTab("platformModels", basePath),
          kind: "primary",
        },
      ],
    });
  }
  if (readModel.channelCount === 0) {
    items.push({
      id: "no-channels",
      severity: "warning",
      category: "channel",
      title: "尚未配置分发通道",
      subtitle: "无法完成能力与代理的跨租户投放，至少配置一条通道以开启分发闭环",
      actions: [
        {
          label: "前往高级控制",
          href: pathForTab("platformAdvanced", basePath),
          kind: "primary",
        },
      ],
    });
  }

  const severityRank: Record<"critical" | "warning" | "info", number> = {
    critical: 3,
    warning: 2,
    info: 1,
  };
  return items.toSorted((a, b) => severityRank[b.severity] - severityRank[a.severity]);
}

function buildDashboardQuickActions(readModel: PlatformPortReadModel, basePath: string) {
  return [
    {
      id: "create-tenant",
      label: "创建租户",
      description: "代企业创建租户与管理员激活",
      icon: "creation" as const,
      href: platformCreateTenantHref(basePath),
      emphasis: "primary" as const,
    },
    {
      id: "models-governance",
      label: "异常模型治理",
      description: `${(readModel.modelProbeDirectory ?? []).filter((e) => e.status !== "ok").length} 个异常 · 回退策略`,
      icon: "models" as const,
      href: pathForTab("platformModels", basePath),
      emphasis: "default" as const,
    },
    {
      id: "runtime",
      label: "Runtime 管理",
      description: `${readModel.presenceCount} 个在线主机`,
      icon: "advanced" as const,
      href: pathForTab("platformAdvanced", basePath),
      emphasis: "default" as const,
    },
    {
      id: "capabilities",
      label: "能力分发",
      description: `${readModel.installedCapabilityCount} 项已安装`,
      icon: "capabilities" as const,
      href: pathForTab("platformCapabilities", basePath),
      emphasis: "default" as const,
    },
    {
      id: "agents",
      label: "资产管理",
      description: `${readModel.agentCount} 个机器人运行实例`,
      icon: "agents" as const,
      href: pathForTab("platformAgents", basePath),
      emphasis: "default" as const,
    },
    {
      id: "audit",
      label: "审计与日志",
      description: "会话、登录与操作审计",
      icon: "audit" as const,
      href: platformSystemSettingsHref(basePath, "security"),
      emphasis: "default" as const,
    },
  ];
}

function buildDashboardSignals(readModel: PlatformPortReadModel) {
  const usage = readModel.currentUsageOverview;
  return [
    {
      id: "tokens",
      label: "令牌消耗",
      value: formatTokens(usage.totalTokens || readModel.totalTokens),
      meta: usage.topModelLabel ? `TOP ${usage.topModelLabel}` : "平台累计",
      tone: "neutral" as const,
    },
    {
      id: "latency",
      label: "平均延迟",
      value:
        typeof usage.avgLatencyMs === "number"
          ? `${Math.round(usage.avgLatencyMs)} ms`
          : t("common.na"),
      meta: "最近 7 日",
      tone:
        typeof usage.avgLatencyMs === "number" && usage.avgLatencyMs > 3000
          ? ("warn" as const)
          : ("neutral" as const),
    },
    {
      id: "model-policy",
      label: "默认模型策略",
      value: readModel.modelMode ?? t("common.na"),
      meta: readModel.defaultModelPrimary
        ? `主模型 ${readModel.defaultModelPrimary}`
        : "未声明主模型",
      tone: readModel.defaultModelPrimary ? ("ok" as const) : ("warn" as const),
    },
  ];
}

function nowLabel(): string {
  try {
    return new Date().toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

// --- capability governance helpers -----------------------------------

const SOURCE_KIND_LABEL: Record<CapabilitySourceRef["kind"], string> = {
  bundled: "官方内置",
  workspace: "工作区技能",
  managed: "托管目录",
  plugin: "插件提供",
  extra: "附加目录",
  personal: "个人目录",
  upload: "上传",
  npm: "npm 源",
  github: "GitHub Topic",
  clawhub: "OpenBot 技能库",
  "mcp-registry": "MCP 注册中心",
};

const PROPOSAL_STATUS_LABEL: Record<CapabilityProposalStatus, string> = {
  proposed: "待审阅",
  under_review: "审阅中",
  approved: "已批准",
  rejected: "已拒绝",
  withdrawn: "已撤回",
};

const LIFECYCLE_LABEL: Record<CapabilityLifecycleState, string> = {
  draft: "草稿",
  review: "审查中",
  approved: "已批准",
  active: "已启用",
  deprecated: "已弃用",
  retired: "已下线",
};

const FINDING_SEVERITY_ORDER: SecurityFindingSeverity[] = [
  "info",
  "low",
  "medium",
  "high",
  "critical",
];

function highestFindingSeverity(
  findings: readonly SecurityFinding[] | null | undefined,
): SecurityFindingSeverity | null {
  if (!findings || findings.length === 0) {
    return null;
  }
  return findings.reduce<SecurityFindingSeverity>((acc, f) => {
    return FINDING_SEVERITY_ORDER.indexOf(f.severity) > FINDING_SEVERITY_ORDER.indexOf(acc)
      ? f.severity
      : acc;
  }, "info");
}

function summarizeDistributionScope(
  entry: CapabilityGovernanceSnapshot["registry"][number],
): string {
  const scope = entry.distribution.scope;
  const parts: string[] = [];
  if (!scope.tenantIds || scope.tenantIds.length === 0) {
    parts.push("全部租户");
  } else {
    parts.push(`${scope.tenantIds.length} 个租户`);
  }
  if (scope.channelIds && scope.channelIds.length > 0) {
    parts.push(`${scope.channelIds.length} 个通道`);
  }
  if (scope.agentIds && scope.agentIds.length > 0) {
    parts.push(`${scope.agentIds.length} 个代理`);
  }
  parts.push(
    entry.distribution.employeeVisibilityMode === "direct_employee_visible"
      ? "员工直达可见"
      : "企业筛选后可见",
  );
  parts.push(entry.distribution.defaultEnabled ? "默认启用" : "默认停用");
  return parts.join(" · ");
}

export function isPendingCapabilityReviewStatus(status: CapabilityProposalStatus): boolean {
  return status === "proposed" || status === "under_review";
}

function buildDiscoveredItems(snapshot: CapabilityGovernanceSnapshot): CapabilityProposalItemVM[] {
  return snapshot.proposals
    .filter((proposal) => isPendingCapabilityReviewStatus(proposal.status))
    .map((proposal) => {
      const severity = highestFindingSeverity(proposal.findings);
      return {
        proposalId: proposal.proposalId,
        capabilityId: proposal.manifest.id,
        title: proposal.manifest.name,
        subtitle: proposal.manifest.description || proposal.manifest.source.origin,
        status: proposal.status,
        statusLabel: PROPOSAL_STATUS_LABEL[proposal.status],
        sourceLabel: SOURCE_KIND_LABEL[proposal.manifest.source.kind],
        trustTier: proposal.manifest.source.trustTier,
        riskLevel: proposal.manifest.risk.level,
        findingCount: proposal.findings?.length ?? 0,
        highestFindingSeverity: severity,
        submittedAt: proposal.submittedAt,
      };
    });
}

function buildRegisteredItems(snapshot: CapabilityGovernanceSnapshot): CapabilityRegistryItemVM[] {
  return snapshot.registry.map((entry) => ({
    capabilityId: entry.manifest.id,
    manifestId: entry.manifest.id,
    title: entry.manifest.name,
    subtitle: entry.manifest.description || entry.manifest.source.origin,
    lifecycleState: entry.lifecycleState,
    lifecycleLabel: LIFECYCLE_LABEL[entry.lifecycleState],
    sourceLabel: SOURCE_KIND_LABEL[entry.manifest.source.kind],
    trustTier: entry.manifest.source.trustTier,
    riskLevel: entry.manifest.risk.level,
    distributionSummary: summarizeDistributionScope(entry),
    defaultEnabled: entry.distribution.defaultEnabled,
    employeeVisibilityMode: entry.distribution.employeeVisibilityMode,
  }));
}

function buildActiveItems(
  snapshot: CapabilityGovernanceSnapshot,
  skillEntries: NonNullable<SkillsProps["report"]>["skills"],
): CapabilityActiveItemVM[] {
  const bySkillKey = new Map(skillEntries.map((s) => [s.skillKey, s]));
  return snapshot.registry
    .filter((entry) => entry.lifecycleState === "active")
    .map((entry) => {
      const skill = bySkillKey.get(entry.manifest.skillKey);
      const missing = skill
        ? [
            ...(skill.missing?.bins ?? []).map((bin) => `缺 bin ${bin}`),
            ...(skill.missing?.env ?? []).map((env) => `缺 env ${env}`),
            ...(skill.missing?.config ?? []).map((path) => `缺 config ${path}`),
            ...(skill.missing?.os ?? []).map((os) => `仅限 ${os}`),
          ]
        : [];
      const meta = missing.length > 0 ? `${missing.length} 项缺失` : "就绪";
      return {
        capabilityId: entry.manifest.id,
        title: entry.manifest.name,
        subtitle: entry.manifest.description || entry.manifest.source.origin,
        meta,
        sourceLabel: SOURCE_KIND_LABEL[entry.manifest.source.kind],
        lifecycleState: entry.lifecycleState,
        riskLevel: entry.manifest.risk.level,
        missing,
      };
    });
}

function buildHealthItems(
  snapshot: CapabilityGovernanceSnapshot,
  skillEntries: NonNullable<SkillsProps["report"]>["skills"],
  readModel: PlatformPortReadModel,
): CapabilityHealthItemVM[] {
  const healthItems: CapabilityHealthItemVM[] = [];
  const bySkillKey = new Map(skillEntries.map((s) => [s.skillKey, s]));

  for (const entry of snapshot.registry) {
    const skill = bySkillKey.get(entry.manifest.skillKey);
    if (!skill) {
      continue;
    }
    const missingBins = skill.missing?.bins ?? [];
    const missingEnv = skill.missing?.env ?? [];
    const missingConfig = skill.missing?.config ?? [];
    const installCount = entry.manifest.install?.length ?? 0;
    for (const bin of missingBins) {
      healthItems.push({
        capabilityId: entry.manifest.id,
        title: entry.manifest.name,
        subtitle: `缺失依赖 ${bin}`,
        meta: installCount > 0 ? "可一键安装" : "需手动安装",
        severity: "setup",
        kind: "missing-bin",
      });
    }
    for (const env of missingEnv) {
      healthItems.push({
        capabilityId: entry.manifest.id,
        title: entry.manifest.name,
        subtitle: `缺失环境变量 ${env}`,
        meta: "需要配置",
        severity: "setup",
        kind: "missing-env",
      });
    }
    for (const configPath of missingConfig) {
      healthItems.push({
        capabilityId: entry.manifest.id,
        title: entry.manifest.name,
        subtitle: `缺失配置 ${configPath}`,
        meta: "需要配置",
        severity: "setup",
        kind: "missing-config",
      });
    }
    if (skill.blockedByAllowlist) {
      healthItems.push({
        capabilityId: entry.manifest.id,
        title: entry.manifest.name,
        subtitle: "被平台 allowlist 阻断",
        meta: "需策略调整",
        severity: "attention",
        kind: "blocked",
      });
    }
  }

  for (const attention of readModel.attentionItems) {
    healthItems.push({
      capabilityId: `platform:${attention}`,
      title: attention,
      subtitle: "平台关注项",
      meta: "需运营处理",
      severity: "attention",
      kind: "platform",
    });
  }

  return healthItems;
}

// Summary tone rules (addresses the "不适用" bug):
// - setup: operator hasn't onboarded (no providers AND no registry entries)
// - warn: registry exists but blocking attention items are queued
// - ok: registry populated and no blocking issues
function buildCapabilitiesSummary(
  snapshot: CapabilityGovernanceSnapshot,
  readModel: PlatformPortReadModel,
  healthItems: CapabilityHealthItemVM[],
) {
  const hasProviders = readModel.configuredProviderCount > 0;
  const blocking = healthItems.filter((h) => h.severity === "attention").length;
  const healthTone: "ok" | "warn" | "setup" =
    !hasProviders && snapshot.registry.length === 0 ? "setup" : blocking > 0 ? "warn" : "ok";
  const healthValue =
    healthTone === "setup"
      ? "待配置"
      : healthTone === "warn"
        ? `${blocking} 项关注`
        : t("common.ok");
  return [
    { label: "能力目录", value: String(snapshot.registry.length) },
    { label: "发现池", value: String(snapshot.proposals.length) },
    {
      label: "已启用",
      value: String(snapshot.registry.filter((e) => e.lifecycleState === "active").length),
    },
    { label: "部署健康", value: healthValue, tone: healthTone },
  ];
}

// ---------------------------------------------------------------------------
// Capabilities view-model builders (taxonomy + distribution + health)
// ---------------------------------------------------------------------------

const CAPABILITY_CATEGORY_LABEL: Record<CapabilityCategoryId, string> = {
  chat: "对话助手",
  vision: "图像视觉",
  rag: "知识检索",
  ocr: "文档处理",
  search: "搜索发现",
  workflow: "工作流",
  automation: "系统自动化",
  browser: "网页浏览",
  code: "开发工具",
  integration: "办公协同",
  media: "音视频",
  other: "其它",
};

const CAPABILITY_CATEGORY_DESCRIPTION: Record<CapabilityCategoryId, string> = {
  chat: "问答、总结、生成与对话型助手能力",
  vision: "图像识别、生成与多模态理解",
  rag: "文档检索、知识库与问答能力",
  ocr: "PDF、Office、表单与文本抽取处理",
  search: "网页、本地与信息聚合检索",
  workflow: "多步流程、审批与任务编排",
  automation: "定时、触发器与系统级自动化",
  browser: "浏览器自动化与网页操作",
  code: "开发、评审、调试与工程辅助",
  integration: "办公协同、连接器与业务集成",
  media: "音频、视频与语音处理能力",
  other: "通用能力或暂未归类能力",
};

function classifyCapability(params: {
  name: string;
  description: string;
  sourceOrigin: string;
}): CapabilityCategoryId {
  const haystack = `${params.name} ${params.description} ${params.sourceOrigin}`.toLowerCase();
  const directCode =
    /\b(github|gh-issues|coding-agent|skill-creator|session-logs|blucli|gog|ordercli)\b/.test(
      haystack,
    );
  if (directCode) {
    return "code";
  }
  const directIntegration =
    /\b(apple-reminders|notion|obsidian|slack|trello|discord|imsg|bluebubbles|things-mac|himalaya)\b/.test(
      haystack,
    );
  if (directIntegration) {
    return "integration";
  }
  const directAutomation = /\b(healthcheck|voice-call|wacli|weather|blogwatcher)\b/.test(haystack);
  if (directAutomation) {
    return "automation";
  }
  const directChat = /\b(gemini|summarize|oracle)\b/.test(haystack);
  if (directChat) {
    return "chat";
  }
  if (
    /\b(rag|retriev|vector|embed|knowledge[ -]?base|knowledge[ -]?graph|doc[ -]?qa)\b/.test(
      haystack,
    )
  ) {
    return "rag";
  }
  if (
    /\b(ocr|invoice|receipt|pdf|document[ -]?parse|form[ -]?extract|textract|tesseract)\b/.test(
      haystack,
    )
  ) {
    return "ocr";
  }
  if (
    /\b(vision|image|vlm|clip|yolo|diffusion|midjourney|stable[ -]?diffusion|canvas|draw|generate[ -]?image)\b/.test(
      haystack,
    )
  ) {
    return "vision";
  }
  if (/\b(audio|voice|tts|stt|speech|whisper|video|ffmpeg|transcribe)\b/.test(haystack)) {
    return "media";
  }
  if (
    /\b(search|bing|google|brave|duckduckgo|serper|searx|web[ -]?search|web-research|网页调研)\b/.test(
      haystack,
    )
  ) {
    return "search";
  }
  if (
    /\b(browser|puppeteer|playwright|chromium|selenium|scrape|crawl|fetch[ -]?page|browser-scan-proxy|扫码登录|扫码代操作)\b/.test(
      haystack,
    )
  ) {
    return "browser";
  }
  if (/\b(workflow|flow|pipeline|approval|task[ -]?queue|orchestrat)\b/.test(haystack)) {
    return "workflow";
  }
  if (/\b(cron|schedule|automation|trigger|webhook|automat)\b/.test(haystack)) {
    return "automation";
  }
  if (
    /\b(code|git|repo|compile|lint|ide|typescript|python|node|interpret|execute|sandbox)\b/.test(
      haystack,
    )
  ) {
    return "code";
  }
  if (
    /\b(slack|discord|telegram|notion|jira|github|gitlab|zoom|gmail|outlook|calendar|sheet|integration|connector)\b/.test(
      haystack,
    )
  ) {
    return "integration";
  }
  if (/\b(chat|assistant|persona|conversation|responder|dialog|agent)\b/.test(haystack)) {
    return "chat";
  }
  return "other";
}

const CAPABILITY_TRUST_TIER_SHORT_LABEL: Record<
  "first-party" | "workspace" | "user" | "third-party" | "external",
  string
> = {
  "first-party": "官方",
  workspace: "工作区",
  user: "用户",
  "third-party": "第三方",
  external: "外部",
};

function capabilityItemStatus(params: {
  disabled: boolean;
  eligible: boolean;
  blockedByAllowlist: boolean;
  missingCount: number;
  installed: boolean;
}): {
  status: CapabilityCatalogItemVM["status"];
  label: string;
  tone: "ok" | "warn" | "danger" | "neutral";
} {
  if (params.disabled) {
    return { status: "disabled", label: "已停用", tone: "neutral" };
  }
  if (params.blockedByAllowlist) {
    return { status: "blocked", label: "策略阻断", tone: "danger" };
  }
  if (params.missingCount > 0) {
    return { status: "needs-setup", label: "需配置", tone: "warn" };
  }
  if (params.installed && params.eligible) {
    return { status: "installed", label: "已启用", tone: "ok" };
  }
  return { status: "available", label: "可启用", tone: "neutral" };
}

function buildInvocationMetricsByCapability(
  snapshot: CapabilityGovernanceSnapshot,
): Map<string, CapabilityInvocationMetric[]> {
  const metricsByCapability = new Map<string, CapabilityInvocationMetric[]>();
  for (const metric of snapshot.metrics) {
    const list = metricsByCapability.get(metric.capabilityId) ?? [];
    list.push(metric);
    metricsByCapability.set(metric.capabilityId, list);
  }
  return metricsByCapability;
}

function buildRuntimeBindingsByCapability(
  bindings: readonly RuntimeCapabilityBinding[] | undefined,
): Map<string, RuntimeCapabilityBinding[]> {
  const bindingsByCapability = new Map<string, RuntimeCapabilityBinding[]>();
  for (const binding of bindings ?? []) {
    const list = bindingsByCapability.get(binding.capabilityId) ?? [];
    list.push(binding);
    bindingsByCapability.set(binding.capabilityId, list);
  }
  return bindingsByCapability;
}

function formatFailureRateLabel(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }
  return `${(value * 100).toFixed(value < 0.01 ? 2 : 1)}%`;
}

function summarizeCapabilityUsage(params: {
  status: CapabilityCatalogItemVM["status"];
  metricEntries: readonly CapabilityInvocationMetric[];
  runtimeBindings: readonly RuntimeCapabilityBinding[];
}): {
  calls7d: number;
  calls7dLabel: string;
  failureRate: number;
  failureRateLabel: string;
} {
  if (params.status !== "installed") {
    return {
      calls7d: 0,
      calls7dLabel: "—",
      failureRate: 0,
      failureRateLabel: "—",
    };
  }

  if (params.metricEntries.length > 0) {
    const invocationCount = params.metricEntries.reduce(
      (sum, metric) => sum + metric.invocationCount,
      0,
    );
    const errorCount = params.metricEntries.reduce((sum, metric) => sum + metric.errorCount, 0);
    const failureRate = invocationCount > 0 ? errorCount / invocationCount : 0;
    return {
      calls7d: invocationCount,
      calls7dLabel: invocationCount > 0 ? formatCompactInt(invocationCount) : "0",
      failureRate,
      failureRateLabel: formatFailureRateLabel(failureRate),
    };
  }

  if (params.runtimeBindings.length > 0) {
    const calls7d = params.runtimeBindings.reduce(
      (sum, binding) => sum + binding.invocationMetrics.calls7d,
      0,
    );
    const successfulCalls = params.runtimeBindings.reduce(
      (sum, binding) =>
        sum + binding.invocationMetrics.calls7d * binding.invocationMetrics.successRate7d,
      0,
    );
    const failureRate = calls7d > 0 ? 1 - successfulCalls / calls7d : 0;
    return {
      calls7d,
      calls7dLabel: calls7d > 0 ? formatCompactInt(calls7d) : "0",
      failureRate,
      failureRateLabel: formatFailureRateLabel(failureRate),
    };
  }

  return {
    calls7d: 0,
    calls7dLabel: "—",
    failureRate: 0,
    failureRateLabel: "—",
  };
}

function inferCapabilityHealthFromBindings(
  bindings: readonly RuntimeCapabilityBinding[],
): RuntimeHealth | null {
  if (bindings.length === 0) {
    return null;
  }
  const severityRank: Record<RuntimeHealth, number> = {
    unavailable: 4,
    unhealthy: 3,
    degraded: 2,
    healthy: 1,
  };
  return bindings.reduce<RuntimeHealth>((worst, binding) => {
    return severityRank[binding.healthStatus] > severityRank[worst] ? binding.healthStatus : worst;
  }, "healthy");
}

function buildCapabilityCatalog(params: {
  snapshot: CapabilityGovernanceSnapshot;
  skillEntries: NonNullable<SkillsProps["report"]>["skills"];
  readModel: PlatformPortReadModel;
}): CapabilityCatalogItemVM[] {
  const { snapshot, skillEntries, readModel } = params;
  const items: CapabilityCatalogItemVM[] = [];
  const metricsByCapability = buildInvocationMetricsByCapability(snapshot);
  const runtimeBindingsByCapability = buildRuntimeBindingsByCapability(readModel.runtimeBindings);

  const skillByKey = new Map(skillEntries.map((s) => [s.skillKey, s] as const));

  const processedKeys = new Set<string>();

  for (const entry of snapshot.registry) {
    const skill = skillByKey.get(entry.manifest.skillKey);
    processedKeys.add(entry.manifest.skillKey);
    const missingCount = skill
      ? (skill.missing?.bins?.length ?? 0) +
        (skill.missing?.env?.length ?? 0) +
        (skill.missing?.config?.length ?? 0) +
        (skill.missing?.os?.length ?? 0)
      : 0;
    const readiness = skill
      ? [
          ...(skill.missing?.bins ?? []).map((b) => `缺 bin ${b}`),
          ...(skill.missing?.env ?? []).map((e) => `缺 env ${e}`),
          ...(skill.missing?.config ?? []).map((p) => `缺 config ${p}`),
          ...(skill.missing?.os ?? []).map((os) => `仅限 ${os}`),
        ]
      : [];
    const statusInfo = capabilityItemStatus({
      disabled: skill?.disabled ?? false,
      eligible: skill?.eligible ?? false,
      blockedByAllowlist: skill?.blockedByAllowlist ?? false,
      missingCount,
      installed: entry.lifecycleState === "active",
    });
    const category =
      entry.manifest.categoryId ??
      classifyCapability({
        name: entry.manifest.name,
        description: entry.manifest.description,
        sourceOrigin: entry.manifest.source.origin,
      });
    const tenantsBase = readModel.enterpriseDirectory.length || readModel.knownTenantIds.length;
    const tenantsEnabled = entry.distribution.defaultEnabled
      ? tenantsBase
      : (entry.distribution.scope.tenantIds?.length ?? 0);
    const usageSummary = summarizeCapabilityUsage({
      status: statusInfo.status,
      metricEntries: metricsByCapability.get(entry.manifest.id) ?? [],
      runtimeBindings: runtimeBindingsByCapability.get(entry.manifest.id) ?? [],
    });

    items.push({
      id: entry.manifest.id,
      title: entry.manifest.name,
      summary: entry.manifest.description || entry.manifest.source.origin,
      categoryId: category,
      categoryLabel: CAPABILITY_CATEGORY_LABEL[category],
      sourceLabel: CAPABILITY_TRUST_TIER_SHORT_LABEL[entry.manifest.source.trustTier],
      sourceOrigin: entry.manifest.source.origin,
      version: entry.manifest.version,
      trustTier: entry.manifest.source.trustTier,
      trustLabel: CAPABILITY_TRUST_TIER_SHORT_LABEL[entry.manifest.source.trustTier],
      status: statusInfo.status,
      statusLabel: statusInfo.label,
      statusTone: statusInfo.tone,
      tenantsEnabled,
      calls7d: usageSummary.calls7d,
      calls7dLabel: usageSummary.calls7dLabel,
      failureRate: usageSummary.failureRate,
      failureRateLabel: usageSummary.failureRateLabel,
      readinessGap: readiness,
      installable: (skill?.install?.length ?? 0) > 0,
      defaultEnabled: entry.distribution.defaultEnabled,
      employeeVisibilityMode: entry.distribution.employeeVisibilityMode,
      skillKey: skill?.skillKey,
      homepage: skill?.homepage,
    });
  }

  // Secondary: skills not yet in registry (raw discovery fallback)
  for (const skill of skillEntries) {
    if (processedKeys.has(skill.skillKey)) {
      continue;
    }
    const missingCount =
      (skill.missing?.bins?.length ?? 0) +
      (skill.missing?.env?.length ?? 0) +
      (skill.missing?.config?.length ?? 0) +
      (skill.missing?.os?.length ?? 0);
    const readiness = [
      ...(skill.missing?.bins ?? []).map((b) => `缺 bin ${b}`),
      ...(skill.missing?.env ?? []).map((e) => `缺 env ${e}`),
      ...(skill.missing?.config ?? []).map((p) => `缺 config ${p}`),
      ...(skill.missing?.os ?? []).map((os) => `仅限 ${os}`),
    ];
    const statusInfo = capabilityItemStatus({
      disabled: skill.disabled,
      eligible: skill.eligible,
      blockedByAllowlist: skill.blockedByAllowlist,
      missingCount,
      installed: !skill.disabled && skill.eligible,
    });
    const category = classifyCapability({
      name: skill.name,
      description: skill.description,
      sourceOrigin: skill.source,
    });
    items.push({
      id: `skill:${skill.skillKey}`,
      title: skill.name,
      summary: skill.description || skill.source,
      categoryId: category,
      categoryLabel: CAPABILITY_CATEGORY_LABEL[category],
      sourceLabel: skill.bundled ? "官方" : "工作区",
      sourceOrigin: skill.source,
      version: null,
      trustTier: skill.bundled ? "first-party" : "workspace",
      trustLabel: skill.bundled ? "官方" : "工作区",
      status: statusInfo.status,
      statusLabel: statusInfo.label,
      statusTone: statusInfo.tone,
      tenantsEnabled:
        statusInfo.status === "installed"
          ? readModel.enterpriseDirectory.length || readModel.knownTenantIds.length
          : 0,
      calls7d: 0,
      calls7dLabel: "—",
      failureRate: 0,
      failureRateLabel: "—",
      readinessGap: readiness,
      installable: skill.install.length > 0,
      skillKey: skill.skillKey,
      homepage: skill.homepage,
    });
  }

  return items;
}

function formatCompactInt(value: number): string {
  if (!Number.isFinite(value) || value === 0) {
    return "0";
  }
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (abs >= 10_000) {
    return `${(value / 1_000).toFixed(0)}k`;
  }
  if (abs >= 1_000) {
    return `${(value / 1_000).toFixed(1)}k`;
  }
  return String(Math.round(value));
}

function buildCapabilityCategories(items: CapabilityCatalogItemVM[]): CapabilityCategoryVM[] {
  const categoryOrder: CapabilityCategoryId[] = [
    "chat",
    "vision",
    "rag",
    "ocr",
    "search",
    "workflow",
    "automation",
    "browser",
    "code",
    "integration",
    "media",
    "other",
  ];
  const byCategory = new Map<CapabilityCategoryId, CapabilityCatalogItemVM[]>();
  for (const item of items) {
    const bucket = byCategory.get(item.categoryId) ?? [];
    bucket.push(item);
    byCategory.set(item.categoryId, bucket);
  }
  const result: CapabilityCategoryVM[] = [];
  for (const id of categoryOrder) {
    const bucket = byCategory.get(id);
    if (!bucket || bucket.length === 0) {
      continue;
    }
    const installed = bucket.filter((item) => item.status === "installed").length;
    const topUsageItem = bucket.slice().toSorted((a, b) => b.calls7d - a.calls7d)[0];
    result.push({
      id,
      label: CAPABILITY_CATEGORY_LABEL[id],
      description: CAPABILITY_CATEGORY_DESCRIPTION[id],
      icon: id,
      total: bucket.length,
      installed,
      highlight: topUsageItem && topUsageItem.calls7d > 0 ? topUsageItem.title : undefined,
    });
  }
  return result;
}

function buildCapabilityDistribution(
  readModel: PlatformPortReadModel,
  snapshot: CapabilityGovernanceSnapshot,
  items: CapabilityCatalogItemVM[],
  basePath: string,
): CapabilityDistributionRowVM[] {
  const totalCapabilities = items.filter((item) => item.status === "installed").length;
  const registryById = new Map(
    snapshot.registry.map((entry) => [entry.manifest.id, entry] as const),
  );
  const directory =
    readModel.enterpriseDirectory.length > 0
      ? readModel.enterpriseDirectory
      : readModel.tenantDirectory.map((entry) => ({
          tenantId: entry.tenantId,
          label: entry.label,
          status: "unknown" as const,
        }));
  return directory.map((entry) => {
    const status = (entry as { status?: string }).status ?? "unknown";
    const statusLabel =
      status === "trial"
        ? "试用中"
        : status === "paid"
          ? "正式"
          : status === "suspended"
            ? "已暂停"
            : status === "expired"
              ? "已到期"
              : "—";
    const enabledCount = items.filter((item) => {
      if (item.status !== "installed") {
        return false;
      }
      const runtimeBindings = (readModel.runtimeBindings ?? []).filter(
        (binding) => binding.capabilityId === item.id,
      );
      if (runtimeBindings.length > 0) {
        return runtimeBindings.some((binding) => {
          const agent = (readModel.runtimeAgents ?? []).find(
            (candidate) => candidate.runtimeAgentId === binding.runtimeAgentId,
          );
          return agent ? agent.tenantCoverage.includes(entry.tenantId) : false;
        });
      }
      const registryEntry = registryById.get(item.id);
      if (!registryEntry) {
        return false;
      }
      const tenantIds = registryEntry.distribution.scope.tenantIds;
      return !tenantIds || tenantIds.length === 0
        ? registryEntry.distribution.defaultEnabled
        : tenantIds.includes(entry.tenantId);
    }).length;
    const coverageRatio = totalCapabilities === 0 ? 0 : enabledCount / totalCapabilities;
    const coverageTone: "ok" | "warn" | "danger" | "neutral" =
      totalCapabilities === 0
        ? "neutral"
        : coverageRatio >= 0.6
          ? "ok"
          : coverageRatio >= 0.3
            ? "warn"
            : "danger";
    return {
      tenantId: entry.tenantId,
      tenantLabel: entry.label,
      tenantStatus:
        status === "trial" || status === "paid" || status === "suspended" || status === "expired"
          ? status
          : "unknown",
      tenantStatusLabel: statusLabel,
      enabledCount,
      totalCount: totalCapabilities,
      coverageLabel:
        totalCapabilities === 0
          ? "—"
          : `${enabledCount} / ${totalCapabilities} · ${(coverageRatio * 100).toFixed(0)}%`,
      coverageTone,
      defaultBundleLabel: "平台默认",
      lastChangedLabel:
        "usageSummary" in entry && typeof entry.usageSummary?.updatedAt === "number"
          ? "已接入租户摘要"
          : readModel.runtimeBindings && readModel.runtimeBindings.length > 0
            ? "已接入 Runtime"
            : "策略口径",
      href: pathForTab("enterpriseOverview", basePath, { tenantId: entry.tenantId }),
    };
  });
}

function buildCapabilityHealthV2(params: {
  snapshot: CapabilityGovernanceSnapshot;
  skillEntries: NonNullable<SkillsProps["report"]>["skills"];
  readModel: PlatformPortReadModel;
  basePath: string;
}): CapabilityHealthItemVM2[] {
  const { snapshot, skillEntries, readModel, basePath } = params;
  const bySkillKey = new Map(skillEntries.map((s) => [s.skillKey, s] as const));
  const items: CapabilityHealthItemVM2[] = [];

  for (const entry of snapshot.registry) {
    const skill = bySkillKey.get(entry.manifest.skillKey);
    if (!skill) {
      continue;
    }
    const category = classifyCapability({
      name: entry.manifest.name,
      description: entry.manifest.description,
      sourceOrigin: entry.manifest.source.origin,
    });
    const missingBins = skill.missing?.bins ?? [];
    const missingEnv = skill.missing?.env ?? [];
    const missingConfig = skill.missing?.config ?? [];
    const installCount = entry.manifest.install?.length ?? 0;
    for (const bin of missingBins) {
      items.push({
        id: `bin-${entry.manifest.id}-${bin}`,
        title: entry.manifest.name,
        subtitle: `缺失依赖 ${bin}`,
        category,
        categoryLabel: CAPABILITY_CATEGORY_LABEL[category],
        severity: "warning",
        issueKind: "missing-bin",
        meta: installCount > 0 ? "可一键安装" : "需手动安装",
        action: {
          label: "查看能力",
          href: pathForTab("platformCapabilities", basePath),
        },
      });
    }
    for (const env of missingEnv) {
      items.push({
        id: `env-${entry.manifest.id}-${env}`,
        title: entry.manifest.name,
        subtitle: `缺失环境变量 ${env}`,
        category,
        categoryLabel: CAPABILITY_CATEGORY_LABEL[category],
        severity: "critical",
        issueKind: "missing-env",
        meta: "需配置密钥或凭证",
        action: { label: "前往配置", href: pathForTab("platformCapabilities", basePath) },
      });
    }
    for (const cfg of missingConfig) {
      items.push({
        id: `cfg-${entry.manifest.id}-${cfg}`,
        title: entry.manifest.name,
        subtitle: `缺失配置 ${cfg}`,
        category,
        categoryLabel: CAPABILITY_CATEGORY_LABEL[category],
        severity: "warning",
        issueKind: "missing-config",
        meta: "需补齐配置",
        action: { label: "前往配置", href: pathForTab("platformCapabilities", basePath) },
      });
    }
    if (skill.blockedByAllowlist) {
      items.push({
        id: `block-${entry.manifest.id}`,
        title: entry.manifest.name,
        subtitle: "被平台 allowlist 阻断",
        category,
        categoryLabel: CAPABILITY_CATEGORY_LABEL[category],
        severity: "critical",
        issueKind: "blocked",
        meta: "需策略调整",
        action: {
          label: "模型治理",
          href: pathForTab("platformModels", basePath),
        },
      });
    }

    const runtimeBindings = (params.readModel.runtimeBindings ?? []).filter(
      (binding) => binding.capabilityId === entry.manifest.id,
    );
    const inferredHealth = inferCapabilityHealthFromBindings(runtimeBindings);
    if (inferredHealth === "unhealthy" || inferredHealth === "unavailable") {
      const impactedBindings = runtimeBindings.length;
      items.push({
        id: `runtime-health-${entry.manifest.id}`,
        title: entry.manifest.name,
        subtitle: inferredHealth === "unavailable" ? "运行时已不可用" : "运行时健康显著下降",
        category,
        categoryLabel: CAPABILITY_CATEGORY_LABEL[category],
        severity: "critical",
        issueKind: "stale",
        meta: `${impactedBindings} 条绑定受影响`,
        action: {
          label: "前往 Runtime",
          href: pathForTab("platformAgents", basePath),
        },
      });
    } else if (inferredHealth === "degraded") {
      items.push({
        id: `runtime-health-${entry.manifest.id}`,
        title: entry.manifest.name,
        subtitle: "运行时出现劣化",
        category,
        categoryLabel: CAPABILITY_CATEGORY_LABEL[category],
        severity: "warning",
        issueKind: "stale",
        meta: `${runtimeBindings.length} 条绑定需关注`,
        action: {
          label: "前往 Runtime",
          href: pathForTab("platformAgents", basePath),
        },
      });
    }
  }

  // Platform-level attention that ties into capability domain
  for (const attention of readModel.attentionItems) {
    const normalized = attention.toLowerCase();
    if (!normalized.includes("channel") && !normalized.includes("capabilit")) {
      continue;
    }
    items.push({
      id: `platform-${attention}`,
      title: attention,
      subtitle: "平台级关注项",
      category: "other",
      categoryLabel: CAPABILITY_CATEGORY_LABEL.other,
      severity: "info",
      issueKind: "platform",
      meta: "需运营处理",
      action: {
        label: "查看高级控制",
        href: pathForTab("platformAdvanced", basePath),
      },
    });
  }

  const severityRank: Record<"critical" | "warning" | "info", number> = {
    critical: 3,
    warning: 2,
    info: 1,
  };
  return items.toSorted((a, b) => severityRank[b.severity] - severityRank[a.severity]);
}

function buildCapabilitiesVMPlus(args: {
  basePath: string;
  readModel: PlatformPortReadModel;
  snapshot: CapabilityGovernanceSnapshot | undefined;
  skillsProps: SkillsProps | null;
}): CapabilitiesVM {
  const base = buildCapabilitiesVM(args);
  const snapshot: CapabilityGovernanceSnapshot = args.snapshot ?? {
    proposals: [],
    registry: [],
    metrics: [],
  };
  const skillEntries = args.skillsProps?.report?.skills ?? [];
  const catalog = buildCapabilityCatalog({
    snapshot,
    skillEntries,
    readModel: args.readModel,
  });
  const installed = catalog.filter((item) => item.status === "installed");
  const categories = buildCapabilityCategories(catalog);
  const distributionRows = buildCapabilityDistribution(
    args.readModel,
    snapshot,
    catalog,
    args.basePath,
  );
  const healthItemsV2 = buildCapabilityHealthV2({
    snapshot,
    skillEntries,
    readModel: args.readModel,
    basePath: args.basePath,
  });
  const criticalCount = healthItemsV2.filter((item) => item.severity === "critical").length;
  const warningCount = healthItemsV2.filter((item) => item.severity === "warning").length;
  const healthTone: "ok" | "warn" | "danger" | "setup" =
    args.readModel.configuredProviderCount === 0 && snapshot.registry.length === 0
      ? "setup"
      : criticalCount > 0
        ? "danger"
        : warningCount > 0
          ? "warn"
          : "ok";
  const healthScoreLabel =
    healthTone === "setup"
      ? "待配置"
      : healthTone === "ok"
        ? "良好"
        : healthTone === "warn"
          ? `${warningCount} 项预警`
          : `${criticalCount} 项告警`;
  const tenantsCovered = distributionRows.filter((row) => row.enabledCount > 0).length;

  return {
    ...base,
    catalogItems: catalog,
    installedItems: installed,
    categories,
    distributionRows,
    healthItemsV2,
    summaryMetrics: {
      totalInCatalog: catalog.length,
      totalInstalled: installed.length,
      tenantsCovered,
      healthScoreLabel,
      healthTone,
      attentionCount: healthItemsV2.length,
      criticalCount,
    },
  };
}

function buildCapabilitiesVM(args: {
  basePath: string;
  readModel: PlatformPortReadModel;
  snapshot: CapabilityGovernanceSnapshot | undefined;
  skillsProps: SkillsProps | null;
}): CapabilitiesVM {
  const { basePath, readModel, snapshot: rawSnapshot, skillsProps } = args;
  const snapshot: CapabilityGovernanceSnapshot = rawSnapshot ?? {
    proposals: [],
    registry: [],
    metrics: [],
  };
  const skillEntries = skillsProps?.report?.skills ?? [];
  const discoveredItems = buildDiscoveredItems(snapshot);
  const registeredItems = buildRegisteredItems(snapshot);
  const activeItems = buildActiveItems(snapshot, skillEntries);
  const healthItems = buildHealthItems(snapshot, skillEntries, readModel);
  const summary = buildCapabilitiesSummary(snapshot, readModel, healthItems);

  const discoveredCounts = {
    proposed: snapshot.proposals.filter((p) => p.status === "proposed").length,
    underReview: snapshot.proposals.filter((p) => p.status === "under_review").length,
    withFindings: snapshot.proposals.filter((p) => (p.findings?.length ?? 0) > 0).length,
    rejected: snapshot.proposals.filter((p) => p.status === "rejected").length,
    total: snapshot.proposals.length,
  };

  const setupChecklist = [
    {
      title: "管理能力目录",
      subtitle: "在平台能力中心登记或安装可分发能力；新增项会以提案形式进入发现池。",
      meta: "能力来源",
      href: pathForTab("platformCapabilities", basePath),
    },
    {
      title: "配置模型提供方",
      subtitle: "补齐 provider/model 后，能力部署健康才能判断模型依赖。",
      meta: readModel.configuredProviderCount > 0 ? "已配置" : "待补齐",
      href: pathForTab("platformModels", basePath),
    },
    {
      title: "配置通道分发",
      subtitle: "在高级通道区绑定账号，作为能力跨租户投放面。",
      meta: readModel.connectedAccountCount > 0 ? "已配置" : "待补齐",
      href: pathForTab("platformAdvanced", basePath),
    },
  ];

  return {
    summary,
    // Placeholder fields — filled by `buildCapabilitiesVMPlus`
    summaryMetrics: {
      totalInCatalog: 0,
      totalInstalled: 0,
      tenantsCovered: 0,
      healthScoreLabel: "—",
      healthTone: "ok",
      attentionCount: 0,
      criticalCount: 0,
    },
    categories: [],
    catalogItems: [],
    installedItems: [],
    distributionRows: [],
    healthItemsV2: [],
    setupNotes:
      readModel.attentionItems.length > 0
        ? readModel.attentionItems
        : ["当前能力部署健康状态正常。"],
    setupChecklist,
    discoveredItems,
    discoveredCounts,
    registeredItems,
    activeItems,
    healthItems,
    skillsProps,
    snapshot,
  };
}

export function buildPlatformPageViewModels({
  basePath,
  readModel,
  channelsProps,
  authPanelProps,
  skillsProps,
  instancesProps,
  configDirty,
  configSaving,
  capabilityGovernanceSnapshot,
}: BuildPlatformPageViewModelsArgs): PlatformPageViewModels {
  const canManagePlatform = Boolean(
    authPanelProps?.state?.canManagePlatform ||
    authPanelProps?.state?.availableModes?.includes("platform-enterprise-create"),
  );
  const canManagePlatformAdmins = Boolean(authPanelProps?.state?.canManagePlatformAdmins);
  const enterpriseItems =
    readModel.enterpriseDirectory.length > 0
      ? readModel.enterpriseDirectory
      : readModel.tenantDirectory.map((entry) => ({
          tenantId: entry.tenantId,
          label: entry.label,
          status: "trial" as const,
          createdSource: "platform-created" as const,
          seatQuota: 0,
          seatUsed: 0,
          seatsRemaining: 0,
          trialEndsAt: undefined,
        }));
  const trialItems = enterpriseItems.filter((entry) => entry.status === "trial");
  const attentionItems = enterpriseItems.filter(
    (entry) => entry.status === "expired" || entry.status === "suspended",
  );
  const routingCandidates = uniqueSortedStrings([
    ...readModel.modelDirectory.map((entry) => `${entry.providerId}/${entry.modelId}`),
    ...readModel.gatewayCatalogModels.map((entry) => `${entry.providerId}/${entry.modelId}`),
    readModel.defaultModelPrimary,
    readModel.defaultImageModelPrimary,
    ...readModel.defaultModelFallbacks,
    ...readModel.allowlistedModelRefs,
  ]);

  const dashboardHealth = buildDashboardHealth(readModel, basePath);
  const dashboardMetrics = buildDashboardMetrics(readModel, basePath);
  const dashboardAttention = buildDashboardAttention(readModel, basePath);
  const dashboardQuickActions = buildDashboardQuickActions(readModel, basePath);
  const dashboardSignals = buildDashboardSignals(readModel);
  const dashboardAttentionCounts = {
    critical: dashboardAttention.filter((item) => item.severity === "critical").length,
    warning: dashboardAttention.filter((item) => item.severity === "warning").length,
    info: dashboardAttention.filter((item) => item.severity === "info").length,
    total: dashboardAttention.length,
  };

  return {
    dashboard: {
      updatedAtLabel: nowLabel() || null,
      health: dashboardHealth.items,
      overallHealthTone: dashboardHealth.tone,
      overallHealthLabel: dashboardHealth.label,
      metrics: dashboardMetrics,
      attention: dashboardAttention,
      attentionCounts: dashboardAttentionCounts,
      quickActions: dashboardQuickActions,
      signals: dashboardSignals,
      contributionLeaderboards: buildPlatformEnterpriseLeaderboardSections({
        enterprises: readModel.enterpriseDirectory.map((entry) => ({
          tenantId: entry.tenantId,
          label: entry.label,
          status: entry.status,
          contributionSummary: entry.contributionSummary,
        })),
        installedCapabilityCount: readModel.installedCapabilityCount,
        runtimeHostCount: readModel.runtimeHosts.length,
        attentionCount: readModel.attentionItems.length,
      }),
    },
    tenants: {
      summary: [
        { label: "可管理租户", value: String(enterpriseItems.length) },
        { label: "试用租户", value: String(trialItems.length) },
        {
          label: "关注租户",
          value: String(attentionItems.length),
          tone: attentionItems.length > 0 ? "warn" : "ok",
        },
        { label: "当前运营人", value: readModel.operatorUser ?? t("common.na") },
      ],
      chips: [
        `当前租户: ${readModel.currentTenantLabel ?? t("common.na")}`,
        `角色: ${readModel.operatorRole ?? t("common.na")}`,
        `运行主机: ${String(readModel.runtimeHosts.length)}`,
        `已连接账户: ${String(readModel.connectedAccountCount)}`,
      ],
      canManagePlatform,
      overviewItems: [
        {
          title: "创建企业租户",
          subtitle: canManagePlatform
            ? "由平台管理员直接创建企业与管理员激活记录。"
            : "当前会话只读，请切换到具备平台管理权限的管理员。",
          meta: canManagePlatform ? "创建租户" : "需要平台管理员",
          href: platformCreateTenantHref(basePath),
        },
        {
          title: "处理试用转化队列",
          subtitle:
            trialItems.length > 0
              ? "优先处理即将到期、需要转化或需要平台介入的试用租户。"
              : "当前没有待转化试用，仍可查看最新激活记录与租户覆盖情况。",
          meta: `${trialItems.length} 个试用租户`,
          href: trialItems[0]
            ? pathForTab("enterpriseUsage", basePath, { tenantId: trialItems[0].tenantId })
            : platformCreateTenantHref(basePath),
        },
        ...(enterpriseItems[0]
          ? [
              {
                title: "进入企业管理页",
                subtitle: `直接查看 ${enterpriseItems[0].label} 的总览、席位与使用情况。`,
                meta: `${enterpriseItems.length} 个租户`,
                href: pathForTab("enterpriseOverview", basePath, {
                  tenantId: enterpriseItems[0].tenantId,
                }),
              },
            ]
          : []),
        ...(readModel.latestInvite
          ? [
              {
                title: "最近激活记录",
                subtitle: `${readModel.latestInvite.tenantName ?? readModel.latestInvite.tenantId ?? "未命名租户"} · 激活码已签发`,
                meta: readModel.latestInvite.expiresAt,
                href: platformCreateTenantHref(basePath),
              },
            ]
          : []),
      ],
      tenantItems: enterpriseItems.map((entry) => ({
        title: entry.label,
        subtitle: `${platformEnterpriseStatusLabel(entry.status)} · ${platformEnterpriseSourceLabel(entry.createdSource)}`,
        meta:
          entry.seatQuota > 0
            ? `${entry.seatUsed}/${entry.seatQuota} 席位`
            : entry.tenantId === readModel.currentTenantId
              ? "当前"
              : "待配置",
        href: pathForTab("enterpriseOverview", basePath, { tenantId: entry.tenantId }),
      })),
      trialItems: [
        ...trialItems.map((entry) => ({
          title: entry.label,
          subtitle: `试用租户 · ${entry.trialEndsAt ? `到期 ${entry.trialEndsAt}` : "待观察"}`,
          meta: `${entry.seatUsed}/${entry.seatQuota} 席位`,
          href: pathForTab("enterpriseUsage", basePath, { tenantId: entry.tenantId }),
        })),
        ...attentionItems.map((entry) => ({
          title: entry.label,
          subtitle: platformEnterpriseStatusLabel(entry.status),
          meta: entry.trialEndsAt ?? "需要平台处理",
          href: platformCreateTenantHref(basePath),
        })),
      ],
      coverageItems: [
        ...readModel.runtimeHosts.map((host) => ({
          title: host,
          subtitle: "运行活动主机",
          meta: `${readModel.sessionsCount} 个会话`,
          href: pathForTab("platformAdvanced", basePath, {
            context: { runtimeId: host, sourcePort: "platform", sourcePage: "platformTenants" },
          }),
        })),
        ...readModel.channelIds.slice(0, 2).map((channelId) => ({
          title: channelId,
          subtitle: "租户分发通道",
          meta: `${readModel.connectedAccountCount} 个已连接账户`,
          href: pathForTab("platformAdvanced", basePath),
        })),
        ...readModel.providerIds.slice(0, 2).map((providerId) => ({
          title: providerId,
          subtitle: "模型提供方覆盖",
          meta: `${readModel.configuredModelCount} 个模型`,
          href: pathForTab("platformModels", basePath),
        })),
      ],
    },
    capabilities: buildCapabilitiesVMPlus({
      basePath,
      readModel,
      snapshot: capabilityGovernanceSnapshot,
      skillsProps,
    }),
    models: {
      summary: [
        { label: "模型池", value: String(readModel.configuredModelCount) },
        { label: "策略", value: readModel.modelMode ?? t("common.na") },
        { label: "建议", value: String(readModel.featureMethodCount) },
        {
          label: "覆盖项",
          value: String(readModel.missingCostEntries),
          tone: readModel.missingCostEntries > 0 ? "warn" : undefined,
        },
      ],
      sectionLinks: [
        {
          id: "model-pool",
          label: "模型池",
          meta: `${readModel.configuredModelCount} 个模型`,
        },
        {
          id: "model-routing",
          label: "路由与 Allowlist",
          meta: `${routingCandidates.length} 个候选`,
        },
        {
          id: "model-catalog",
          label: "目录与 Provider",
          meta: `${readModel.gatewayCatalogCount} 个目录项`,
        },
        {
          id: "model-governance",
          label: "策略与覆盖",
          meta: `${readModel.attentionItems.length + readModel.missingCostEntries} 个关注`,
        },
      ],
      mode:
        readModel.modelMode === "merge" || readModel.modelMode === "replace"
          ? readModel.modelMode
          : null,
      modeLabel:
        readModel.modelMode === "replace"
          ? "Replace: 仅使用平台显式配置"
          : "Merge: 内置模型目录 + 平台覆盖",
      canManage: canManagePlatform,
      configDirty,
      configSaving,
      providerEntries: readModel.providerIds.map((providerId) => {
        const providerModels = readModel.modelDirectory.filter(
          (entry) => entry.providerId === providerId,
        );
        const sample = providerModels[0] ?? null;
        return {
          providerId,
          api: sample?.providerApi ?? sample?.api ?? t("common.na"),
          baseUrl: sample?.baseUrl ?? t("common.na"),
          baseUrlRaw: sample?.baseUrl ?? "",
          auth: sample?.auth ?? "api-key",
          modelCount: providerModels.length,
        };
      }),
      providerHealthEntries: readModel.providerHealthDirectory.map((entry) => ({
        providerId: entry.providerId,
        authMode: entry.authMode,
        authStatus: entry.authStatus,
        authLabel: entry.authLabel,
        modelCount: entry.modelCount,
        catalogCount: entry.catalogCount,
        issue: entry.issue,
      })),
      standardModels: readModel.modelDirectory.map((entry) => ({
        providerId: entry.providerId,
        modelId: entry.modelId,
        name: entry.name ?? entry.modelId,
        api: entry.api ?? entry.providerApi ?? t("common.na"),
        baseUrl: entry.baseUrl ?? t("common.na"),
        baseUrlRaw: entry.baseUrl ?? "",
        auth: entry.auth ?? "api-key",
        reasoning: entry.reasoning,
        inputs: entry.input,
        contextWindow: entry.contextWindow ? String(entry.contextWindow) : t("common.na"),
        contextWindowRaw: entry.contextWindow,
        maxTokens: entry.maxTokens ? String(entry.maxTokens) : t("common.na"),
        maxTokensRaw: entry.maxTokens,
        costTier: entry.costTier,
        supportsTools: entry.supportsTools,
      })),
      gatewayCatalogEntries: readModel.gatewayCatalogModels.map((entry) => ({
        providerId: entry.providerId,
        modelId: entry.modelId,
        name: entry.name,
        contextWindow: entry.contextWindow ? String(entry.contextWindow) : t("common.na"),
        contextWindowRaw: entry.contextWindow,
        inPool: readModel.modelDirectory.some(
          (configured) =>
            configured.providerId === entry.providerId && configured.modelId === entry.modelId,
        ),
      })),
      gatewayCatalogItems: readModel.gatewayCatalogModels.map((entry) => ({
        title: `${entry.providerId}/${entry.modelId}`,
        subtitle: entry.name,
        meta: entry.contextWindow ? `${entry.contextWindow} 上下文` : "网关目录模型",
      })),
      routingPrimary: readModel.defaultModelPrimary,
      routingFallbacks: readModel.defaultModelFallbacks,
      routingImagePrimary: readModel.defaultImageModelPrimary,
      routingCandidates,
      allowlistItems: readModel.allowlistedModelRefs,
      allowlistEntries: readModel.allowlistEntries,
      aliasCount: readModel.aliasCount,
      modelItems: readModel.modelDirectory.map((entry) => ({
        title: entry.modelId,
        subtitle: `${entry.providerId}${entry.api ? ` · ${entry.api}` : ""}`,
        meta:
          [
            entry.contextWindow ? `${entry.contextWindow} 上下文` : null,
            entry.maxTokens ? `${entry.maxTokens} 输出` : null,
            entry.costTier !== "unknown" ? `成本:${entry.costTier}` : null,
          ]
            .filter(Boolean)
            .join(" · ") || "已配置模型",
      })),
      policyItems: [
        {
          title: "平台默认策略",
          subtitle: `当前模式 ${readModel.modelMode ?? t("common.na")}`,
          meta: `${readModel.providerIds.length} 个提供方参与`,
        },
        {
          title: "系统默认主模型",
          subtitle: readModel.defaultModelPrimary ?? "尚未声明默认主模型",
          meta:
            readModel.defaultModelFallbacks.length > 0
              ? `Fallback ${readModel.defaultModelFallbacks.length} 个`
              : "无 fallback",
        },
        ...readModel.providerIds.map((providerId) => ({
          title: `${providerId} 策略对象`,
          subtitle: "提供方默认选择与分配规则",
          meta: `${readModel.modelDirectory.filter((entry) => entry.providerId === providerId).length} 个模型`,
        })),
      ],
      matchingItems: [
        {
          title: "目录合并策略",
          subtitle:
            readModel.modelMode === "replace"
              ? "replace 模式下，系统只允许当前平台显式配置的 provider/model 进入模型池。"
              : "merge 模式下，系统保留内置目录，并用平台配置覆盖同名 provider/model 的 baseUrl、API 与模型参数。",
          meta: readModel.modelMode ?? "merge",
        },
        {
          title: "模型选择输入",
          subtitle:
            "智能匹配优先读取 agents.defaults.model.primary / fallbacks，再结合输入类型、工具兼容性、上下文窗口与成本层级筛选候选模型。",
          meta: readModel.defaultModelPrimary ?? "默认主模型未配置",
        },
        {
          title: "回退与约束",
          subtitle:
            "当目标模型缺少鉴权、输入类型不匹配、未进入 allowlist 或上下文不足时，应回退到 fallback 或同能力标签模型。",
          meta:
            readModel.defaultModelFallbacks.length > 0
              ? readModel.defaultModelFallbacks.join(", ")
              : "未配置 fallback",
        },
        {
          title: "Allowlist 与别名",
          subtitle:
            "平台模型池进入系统前，还会受到 agents.defaults.models 的 allowlist / alias 约束。",
          meta: `${readModel.allowlistedModelRefs.length} 个 allowlist · ${readModel.aliasCount} 个 alias`,
        },
      ],
      overrideItems: readModel.enterpriseDirectory.map((entry) => ({
        title: entry.label,
        subtitle: "租户级模型覆盖入口",
        meta: `${platformEnterpriseStatusLabel(entry.status)} · ${entry.seatUsed}/${entry.seatQuota || 0} 席位`,
        href: pathForTab("enterpriseSettings", basePath, { tenantId: entry.tenantId }),
      })),
      issueItems: [
        ...(readModel.gatewayCatalogCount === 0
          ? [
              {
                title: "尚未加载网关模型目录",
                subtitle: "点击“刷新目录”后，可对照当前网关实际可见模型与平台标准模型池。",
                meta: "目录未加载",
              },
            ]
          : []),
        ...(readModel.modelMode === "replace" && readModel.configuredModelCount === 0
          ? [
              {
                title: "Replace 模式下模型池为空",
                subtitle: "当前平台配置要求只使用显式配置模型，但模型池没有任何 provider/model。",
                meta: "高风险",
              },
            ]
          : []),
        ...(readModel.defaultModelPrimary
          ? []
          : [
              {
                title: "系统默认主模型未配置",
                subtitle:
                  "应至少配置 agents.defaults.model.primary，避免智能匹配缺少统一入口模型。",
                meta: "需要补齐",
              },
            ]),
        ...(readModel.gatewayCatalogCount > 0
          ? readModel.modelDirectory
              .filter(
                (entry) =>
                  !readModel.gatewayCatalogModels.some(
                    (catalog) =>
                      catalog.providerId === entry.providerId && catalog.modelId === entry.modelId,
                  ),
              )
              .slice(0, 6)
              .map((entry) => ({
                title: `${entry.providerId}/${entry.modelId} 未进入网关目录`,
                subtitle:
                  "平台已配置，但 `models.list` 当前未返回该模型；需要检查 provider 配置、模型 ID 或目录生成。",
                meta: entry.api ?? "待核查",
              }))
          : []),
        ...(readModel.missingCostEntries > 0
          ? [
              {
                title: `${readModel.missingCostEntries} 条记录缺少成本归因`,
                subtitle: "模型成本覆盖需要补齐",
                meta: formatCost(readModel.totalCost),
                href: pathForTab("platformAdvanced", basePath),
              },
            ]
          : []),
        ...readModel.attentionItems.map((item) =>
          platformAttentionItem(item, basePath, readModel.currentVersion ?? t("common.na")),
        ),
      ],
    },
    agents: {
      summary: [
        { label: "资产舰队", value: String(readModel.agentCount) },
        { label: "资产目录", value: String(readModel.knownTenantIds.length) },
        { label: "工作区覆盖", value: String(readModel.sessionsCount) },
        { label: "当前运营人", value: readModel.operatorUser ?? t("common.na") },
      ],
      actionItems: [
        {
          title: "选择平台代理资产",
          subtitle: "在平台资产管理中挑选成熟代理，发布为平台共享资产。",
          meta: "创建来源",
          href: pathForTab("platformAgents", basePath, {
            context: { sourcePort: "platform", sourcePage: "platformAgents" },
          }),
        },
        {
          title: "绑定企业租户",
          subtitle: "先确认企业目录，再把共享运行能力分发到目标租户。",
          meta: "分发目标",
          href: pathForTab("platformTenants", basePath),
        },
        {
          title: "补齐模型与能力",
          subtitle: "资产管理需要模型池、能力目录和通道分发共同就绪。",
          meta: "依赖检查",
          href: pathForTab("platformCapabilities", basePath),
        },
      ],
      fleetItems: readModel.agentDirectory.map((entry) => ({
        title: entry.label,
        subtitle: entry.isDefault ? "默认机器人运行实例" : "机器人运行实例",
        meta: `${readModel.installedCapabilityCount} 个能力 · ${readModel.configuredModelCount} 个模型`,
        href: pathForTab("platformAgents", basePath, {
          context: { agentId: entry.agentId, sourcePort: "platform", sourcePage: "platformAgents" },
        }),
      })),
      directoryItems: readModel.enterpriseDirectory.map((entry) => ({
        title: entry.label,
        subtitle: "企业侧资产分发目录",
        meta: `${readModel.agentDirectory.length} 个共享代理`,
        href: pathForTab("enterpriseCapabilityCenter", basePath, { tenantId: entry.tenantId }),
      })),
      workspaceItems: [
        ...readModel.runtimeHosts.map((host) => ({
          title: host,
          subtitle: "运行工作区",
          meta: `${readModel.sessionsCount} 个会话`,
          href: pathForTab("platformAdvanced", basePath, {
            context: { runtimeId: host, sourcePort: "platform", sourcePage: "platformAgents" },
          }),
        })),
        ...readModel.agentDirectory.slice(0, 4).map((entry) => ({
          title: entry.label,
          subtitle: "资产绑定状态",
          meta: `${readModel.providerIds.length} 个提供方 · ${readModel.channelIds.length} 个通道`,
        })),
      ],
    },
    advanced: {
      summary: [
        { label: t("platformPort.stats.channels"), value: String(readModel.channelCount) },
        { label: t("platformPort.stats.accounts"), value: String(readModel.accountCount) },
        { label: t("platformPort.stats.runtimeHosts"), value: String(readModel.presenceCount) },
        { label: t("platformPort.stats.cost"), value: formatCost(readModel.totalCost) },
      ],
      chips: [
        `下次唤醒 ${readModel.cronNextAt ? new Date(readModel.cronNextAt).toLocaleString("zh-CN") : t("common.na")}`,
        `版本 ${readModel.currentVersion ?? t("common.na")}`,
        `最新 ${readModel.latestVersion ?? t("common.na")}`,
      ],
      channelsProps,
      instancesProps,
      usageItems: [
        ...(readModel.missingCostEntries > 0
          ? [
              {
                title: `${readModel.missingCostEntries} 条使用记录需要补归因`,
                subtitle: "使用卫生队列",
                meta: formatCost(readModel.totalCost),
              },
            ]
          : []),
        ...readModel.attentionItems
          .slice(0, 4)
          .map((item) =>
            platformAttentionItem(item, basePath, `${formatTokens(readModel.totalTokens)} 令牌`),
          ),
      ],
      domainItems: readModel.tenantDirectory.map((entry) => ({
        title: entry.label,
        subtitle: entry.tenantId,
        meta: `${readModel.providerIds.length} 个提供方`,
        href: pathForTab("enterpriseOverview", basePath, {
          tenantId: entry.tenantId,
        }),
      })),
    },
    systemSettings: {
      summary: [
        {
          label: "当前会话",
          value: authPanelProps?.state?.sessionKind
            ? t(`overview.platformAuth.sessionKind.${authPanelProps.state.sessionKind}`)
            : t("common.na"),
        },
        {
          label: "平台管理员",
          value: String(authPanelProps?.state?.platformAdmins?.length ?? 0),
        },
        {
          label: "系统设置权限",
          value: canManagePlatform ? t("common.enabled") : t("common.disabled"),
        },
        { label: "已知租户", value: String(readModel.knownTenantIds.length) },
      ],
      notes: [
        "在这里统一处理平台管理员、企业租户创建、试用策略与企业级覆盖设置。",
        "一般管理员可进入平台设置；只有超级管理员可以管理平台管理员。",
      ],
      entryItems: [
        {
          title: "打开平台账号入口",
          subtitle: "返回主入口完成平台管理员登录、初始化或企业激活。",
          meta: "账号入口",
          href: pathForTab("me", basePath),
        },
        {
          title: "申请企业试用",
          subtitle: "企业用户可从试用入口提交申请，平台管理员再处理转化。",
          meta: "试用流程",
          href: pathForTab("trialApply", basePath),
        },
        {
          title: "查看租户队列",
          subtitle: "已登录后从租户模块处理企业创建、试用与转化队列。",
          meta: "运营队列",
          href: pathForTab("platformTenants", basePath),
        },
      ],
      canManagePlatform,
      canManagePlatformAdmins,
      authPanelProps,
    },
  };
}
