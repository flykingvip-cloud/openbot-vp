// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { CapabilitySummary } from "../capability/employee-capability/types.ts";
import type {
  EnterpriseCapabilityAsset,
  InstallRelation,
} from "../capability/enterprise-capability/types.ts";
import type {
  CapabilityCatalogItemVM,
  CapabilityDistributionRowVM,
  CapabilityHealthItemVM2,
} from "../ports/platform/view-models/types.ts";
import type { SkillStatusEntry } from "../types.ts";
import {
  buildEmployeeAssetDetailVM,
  buildEnterpriseAssetDetailVM,
  buildPlatformAssetDetailVM,
} from "./asset-detail-vm.ts";

function createEnterpriseCapability(): EnterpriseCapabilityAsset {
  return {
    id: "cap-enterprise-1",
    name: "合同审查助手",
    description: "辅助法务完成合同要点审查。",
    usageScenarios: ["合同审查"],
    applicableScope: { kind: "department", id: "dept-legal", name: "法务部" },
    domain: "法务",
    maturity: "企业标准",
    healthStatus: "效果稳定",
    healthManualLock: false,
    healthNoTelemetry: false,
    lifecycle: "published",
    valueSummary: {
      monthlyExecutions: 42,
      departmentCoverageCount: 2,
      reuseGrowthRate30d: 12,
    },
    credibilityIndicators: {
      verifiedDepartments: ["法务部"],
      productionUsageDays: 60,
    },
    reuseData: {
      robotCount: 4,
      employeeCount: 9,
      departmentCount: 2,
      trend30Days: [1, 2, 3],
      growthPercentage: 12,
    },
    source: {
      employee: { id: "emp-1", name: "王莉" },
      robot: { id: "robot-1", name: "法务助手" },
      task: { id: "task-1", summary: "合同风险审查" },
    },
    contributionHistory: [
      {
        id: "con-1",
        employeeId: "emp-1",
        employeeName: "王莉",
        timestamp: 1710000000000,
        type: "初始提交",
        summary: "提交法务审查模板。",
      },
    ],
    reviewHistory: [
      {
        id: "rev-1",
        reviewerId: "mgr-1",
        reviewerName: "赵主管",
        timestamp: 1711000000000,
        result: "通过",
        opinion: "可以推广。",
      },
    ],
    avatar: null,
    createdAt: 1710000000000,
    updatedAt: 1711000000000,
  };
}

function createInstallRelations(): InstallRelation[] {
  return [
    {
      id: "inst-1",
      capabilityId: "cap-enterprise-1",
      capabilityName: "合同审查助手",
      robotId: "robot-1",
      robotName: "法务助手",
      installedAt: 1711200000000,
      source: "管理员推送",
      status: "正常运行",
    },
  ];
}

function createEmployeeCapability(): CapabilitySummary {
  return {
    id: "cap-employee-1",
    name: "客户情绪分析",
    summary: "分析客户消息中的情绪倾向。",
    usageExamples: ["客户投诉处理"],
    inputDescription: "客户消息",
    outputDescription: "情绪摘要和建议",
    tags: ["客户", "分析"],
    category: "客户服务",
    avatar: null,
    health: "偶尔异常",
    shareVisibility: "审核中",
    maturity: null,
    attribution: {
      sourceRobot: { id: "robot-2", name: "销售助手" },
      sourceTaskSummary: "客户服务任务",
      firstFormedScenario: "首次在客户投诉处理时形成",
      highFrequencyScenarios: ["客户投诉"],
    },
    usage: {
      robots: [{ id: "robot-2", name: "销售助手" }],
      totalUsageCount: 18,
      lastUsedAt: 1711200000000,
    },
    usageMetrics: {
      robotCount: 2,
      groupCount: 1,
      totalUsageCount: 18,
      lastUsedAt: 1711200000000,
    },
    recentUpdate: {
      id: "recap-1",
      at: 1711200000000,
      headline: "最近更新 · 优化了场景说明",
    },
    versionInfo: {
      currentVersion: "1.1.0",
      versionCount: 2,
      submittedVersion: "1.0.0",
    },
    isDraft: false,
    createdAt: 1710000000000,
    updatedAt: 1711200000000,
    applicationSummary: "已在 2 个机器人中应用",
    feedbackSummary: "企业正在审核",
    enterpriseReview: {
      statusLabel: "审核中",
      nextStep: "等待企业管理员开始审核。",
      submittedAt: 1711200000000,
      reviewerNote: "先看资产边界。",
    },
    enterpriseLifecycle: {
      stage: "under_review",
      stageLabel: "审核中",
      nextStep: "等待企业管理员开始审核。",
      reviewerNote: "先看资产边界。",
    },
    sourceContextLabel: "来自客户服务任务",
    optimizationTargets: [{ kind: "group", id: "group-1", name: "销售协作组" }],
  };
}

function createPlatformCapability(): CapabilityCatalogItemVM {
  return {
    id: "cap-platform-1",
    title: "github",
    summary: "通过 GitHub CLI 执行 issue、PR、CI 和仓库操作。",
    categoryId: "code",
    categoryLabel: "开发工具",
    sourceLabel: "官方来源",
    sourceOrigin: "openclaw-bundled",
    version: "1.2.3",
    trustTier: "first-party",
    trustLabel: "官方",
    status: "needs-setup",
    statusLabel: "待配置",
    statusTone: "warn",
    tenantsEnabled: 2,
    calls7d: 12,
    calls7dLabel: "12",
    failureRate: 0.02,
    failureRateLabel: "2%",
    readinessGap: ["缺少命令依赖 gh"],
    installable: true,
    defaultEnabled: true,
    employeeVisibilityMode: "enterprise_review_required",
    skillKey: "github",
    homepage: "https://github.com",
  };
}

function createPlatformSkill(): SkillStatusEntry {
  return {
    name: "github",
    description: "GitHub operations",
    source: "openclaw-bundled",
    filePath: "~/.openclaw/skills/github/SKILL.md",
    baseDir: "~/.openclaw/skills",
    skillKey: "github",
    always: false,
    disabled: false,
    blockedByAllowlist: false,
    eligible: true,
    requirements: {
      bins: ["gh"],
      env: ["GITHUB_TOKEN"],
      config: [],
      os: [],
    },
    missing: {
      bins: ["gh"],
      env: [],
      config: [],
      os: [],
    },
    configChecks: [],
    install: [{ id: "brew-gh", kind: "brew", label: "安装 gh", bins: ["gh"] }],
  };
}

describe("asset detail view model builders", () => {
  it("builds enterprise tabs and fact groups", () => {
    const vm = buildEnterpriseAssetDetailVM({
      capability: createEnterpriseCapability(),
      installRelations: createInstallRelations(),
    });

    expect(vm.tabs.find((tab) => tab.id === "install")?.badge).toBe("1");
    expect(vm.definitionFacts.find((fact) => fact.label === "能力领域")?.value).toBe("法务");
    expect(vm.versionFacts.find((fact) => fact.label === "审核记录数")?.value).toBe("1 条");
  });

  it("builds employee tabs, stats, and install facts", () => {
    const vm = buildEmployeeAssetDetailVM({
      capability: createEmployeeCapability(),
      availableGroups: [{ id: "group-1", name: "销售协作组" }],
    });

    expect(vm.tabs.find((tab) => tab.id === "runtime")?.badge).toBe("关注");
    expect(vm.overviewStats.find((stat) => stat.label === "当前版本")?.value).toBe("1.1.0");
    expect(vm.installFacts.find((fact) => fact.label === "企业提交状态")?.value).toBe(
      "已进入企业链路",
    );
    // Empty share timeline when no shareHistory data
    expect(vm.shareTimeline).toEqual([]);
  });

  it("builds share timeline from shareHistory data", () => {
    const capabilityWithHistory = {
      ...createEmployeeCapability(),
      shareHistory: [
        {
          shareId: "share_abc123",
          groupId: "group-1",
          groupName: "销售协作组",
          sharedByDisplayName: "alice@example.com",
          sharedAt: 1711300000000,
        },
        {
          shareId: "share_def456",
          groupId: "group-2",
          groupName: "产品研发组",
          sharedByDisplayName: "bob@example.com",
          sharedAt: 1711200000000,
        },
      ],
    };
    const vm = buildEmployeeAssetDetailVM({
      capability: capabilityWithHistory,
      availableGroups: [{ id: "group-1", name: "销售协作组" }],
    });

    expect(vm.shareTimeline).toHaveLength(2);
    expect(vm.shareTimeline[0]).toMatchObject({
      primary: "alice@example.com",
      secondary: "分享到「销售协作组」",
      badge: { label: "协作分享", variant: "tag" },
    });
    expect(vm.shareTimeline[1]).toMatchObject({
      primary: "bob@example.com",
      secondary: "分享到「产品研发组」",
    });
    expect(vm.shareTimeline[0]?.timestampLabel).toBeTruthy();
  });

  it("builds platform tabs and runtime facts", () => {
    const vm = buildPlatformAssetDetailVM({
      selected: createPlatformCapability(),
      linkedSkill: createPlatformSkill(),
      linkedDistributionRows: [
        {
          tenantId: "tenant-1",
          tenantLabel: "Tenant A",
          tenantStatus: "paid",
          tenantStatusLabel: "已付费",
          enabledCount: 1,
          totalCount: 1,
          coverageLabel: "100%",
          coverageTone: "ok",
          defaultBundleLabel: "默认启用",
          lastChangedLabel: "刚刚",
        } satisfies CapabilityDistributionRowVM,
      ],
      healthIssues: [
        {
          id: "health-1",
          title: "github",
          subtitle: "缺少 gh",
          category: "code",
          categoryLabel: "开发工具",
          severity: "warning",
          issueKind: "missing-bin",
          meta: "需要安装 gh",
        } satisfies CapabilityHealthItemVM2,
      ],
      missing: ["bin: gh"],
    });

    expect(vm.tabs.find((tab) => tab.id === "runtime")?.badge).toBe("1");
    expect(vm.definitionFacts.find((fact) => fact.label === "Skill Key")?.value).toBe("github");
    expect(vm.runtimeFacts.find((fact) => fact.label === "命令依赖")?.value).toBe("gh");
    expect(vm.runtimeTimeline.length).toBeGreaterThan(0);
    expect(vm.runtimeTimeline.some((item) => item.primary.includes("bin: gh"))).toBe(true);
  });
});
