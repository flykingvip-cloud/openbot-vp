import type { CapabilityHealthLabel, CapabilityMaturityLabel, CapabilitySummary } from "./types.ts";

export const HEALTH_LABEL_MAP = {
  healthy: "运行稳定",
  warning: "偶尔异常",
  broken: "需要重新整理",
} as const satisfies Record<string, CapabilityHealthLabel>;

export const MATURITY_LABEL_MAP = {
  forming: "初步形成",
  stable: "稳定使用",
  "multi-reuse": "多人复用",
  "enterprise-certified": "企业认证",
  standard: "企业标准",
  "core-asset": "核心资产",
} as const satisfies Record<string, CapabilityMaturityLabel>;

function projectMaturityLabel(
  maturity: keyof typeof MATURITY_LABEL_MAP | CapabilityMaturityLabel | null | undefined,
): CapabilityMaturityLabel | null {
  if (!maturity) {
    return null;
  }
  return maturity in MATURITY_LABEL_MAP
    ? MATURITY_LABEL_MAP[maturity as keyof typeof MATURITY_LABEL_MAP]
    : (maturity as CapabilityMaturityLabel);
}

export function projectToCapabilitySummary(
  value: Omit<Partial<CapabilitySummary>, "maturity"> & {
    id: string;
    name: string;
    summary: string;
    sourceRobot: { id: string; name: string };
    maturity?: keyof typeof MATURITY_LABEL_MAP | CapabilityMaturityLabel | null;
  },
): CapabilitySummary {
  const projectedMaturity = projectMaturityLabel(value.maturity);
  return {
    id: value.id,
    name: value.name,
    summary: value.summary,
    usageExamples: value.usageExamples ?? [],
    inputDescription: value.inputDescription ?? "",
    outputDescription: value.outputDescription ?? "",
    tags: value.tags ?? [],
    category: value.category ?? "",
    avatar: value.avatar ?? null,
    health: value.health ?? "运行稳定",
    shareVisibility: value.shareVisibility ?? "私有",
    maturity: projectedMaturity,
    attribution: value.attribution ?? {
      sourceRobot: value.sourceRobot,
      sourceTaskSummary: "",
      firstFormedScenario: "",
      highFrequencyScenarios: [],
    },
    usage: value.usage ?? {
      robots: [],
      totalUsageCount: 0,
      lastUsedAt: null,
    },
    usageMetrics: value.usageMetrics ?? {
      robotCount: value.usage?.robots.length ?? 0,
      groupCount: 0,
      totalUsageCount: value.usage?.totalUsageCount ?? 0,
      lastUsedAt: value.usage?.lastUsedAt ?? null,
    },
    recentUpdate: value.recentUpdate ?? null,
    versionInfo: value.versionInfo ?? {
      currentVersion: "1.0.0",
      versionCount: 1,
      submittedVersion: null,
    },
    isDraft: value.isDraft ?? false,
    createdAt: value.createdAt ?? 0,
    updatedAt: value.updatedAt ?? 0,
    enterpriseLifecycle: value.enterpriseLifecycle ?? null,
    installSource: value.installSource,
    configurationState: value.configurationState ?? "not-required",
    governanceState: value.governanceState ?? "none",
    boundRobotIds: value.boundRobotIds ?? [],
    installRequestHistory: value.installRequestHistory ?? [],
    sanitizationState: value.sanitizationState,
  };
}
