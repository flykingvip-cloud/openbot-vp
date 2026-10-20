// @vitest-environment jsdom
import { render } from "lit";
import { describe, expect, it } from "vitest";
import type { PlatformSurfaceProps } from "../shared/surface.ts";
import { renderPlatformDashboardSurface } from "./page.ts";

function createProps(): PlatformSurfaceProps {
  return {
    tab: "platformDashboard",
    basePath: "/platform",
    readModel: {
      currentTenantId: "tenant-a",
      currentTenantLabel: "Tenant A",
      knownTenantIds: ["tenant-a"],
      tenantDirectory: [{ tenantId: "tenant-a", label: "Tenant A" }],
      enterpriseDirectory: [
        { tenantId: "ent-1", label: "华东运营中心", status: "paid" },
        { tenantId: "ent-2", label: "华南客服中心", status: "trial" },
      ],
      agentDirectory: [],
      modelDirectory: [],
      gatewayCatalogModels: [],
      taskPlanDirectory: [],
      routingPolicyDirectory: [],
      gatewayCatalogCount: 0,
      defaultModelPrimary: null,
      defaultModelFallbacks: [],
      defaultImageModelPrimary: null,
      allowlistedModelRefs: [],
      allowlistEntries: [],
      aliasCount: 0,
      providerHealthDirectory: [],
      agentCount: 0,
      featureMethodCount: 0,
      channelCount: 0,
      channelIds: [],
      accountCount: 0,
      connectedAccountCount: 0,
      presenceCount: 0,
      runtimeHosts: [{ id: "runtime-1", name: "node-1" }],
      sessionsCount: 0,
      totalTokens: 0,
      totalCost: 0,
      missingCostEntries: 0,
      currentUsageOverview: {
        sessionCount: 0,
        totalTokens: 0,
        totalCost: 0,
        totalMessages: 0,
        errorCount: 0,
        errorRate: 0,
        avgLatencyMs: null,
        peakErrorDayLabel: null,
        topModelLabel: null,
        topAgentId: null,
        activeAgentCount: 0,
        activeChannelCount: 0,
        dailyCalls: [],
        dailyCost: [],
        updatedAt: null,
      },
      modelMode: null,
      configuredProviderCount: 1,
      providerIds: ["openai"],
      configuredModelCount: 0,
      configuredModelIds: [],
      installedCapabilityCount: 6,
      attentionItems: ["等待处理的候选资产"],
      currentVersion: "2026.3.9",
      latestVersion: "2026.3.9",
      hasUpdateAvailable: false,
      cronEnabled: null,
      cronNextAt: null,
      operatorUser: "ops@example.com",
      operatorRole: "super_admin",
      latestInvite: null,
      runtimeAgents: [],
      runtimeBindings: [],
      runtimeTelemetry: [],
      runtimeGovernanceIssues: [],
      runtimeKpi: undefined,
    } as never,
    channelsProps: {} as never,
    skillsProps: undefined,
    instancesProps: undefined,
    authPanelProps: null,
    pageViewModels: undefined,
    actions: {} as never,
  };
}

describe("renderPlatformDashboardSurface", () => {
  it("renders an enterprise contribution leaderboard on the platform dashboard", () => {
    const container = document.createElement("div");
    render(renderPlatformDashboardSurface(createProps()), container);

    const text = container.textContent ?? "";
    expect(text).toContain("资产孵化贡献榜");
    expect(text).toContain("热门贡献企业");
    expect(text).toContain("华东运营中心");
    const attention = container.querySelector("a.platform-dashboard__attention-item");
    expect(attention?.getAttribute("href")).toContain("/platform/advanced");
    expect(attention?.textContent).toContain("等待处理的候选资产");
  });

  it("mounts the operational identity governance panel", () => {
    const container = document.createElement("div");
    render(
      renderPlatformDashboardSurface({
        ...createProps(),
        operationalIdentityGovernancePanel: {
          overview: {
            scope: { kind: "platform" },
            totals: { identities: 3, active: 2, expired: 0, reauthRequired: 1, revoked: 0 },
            activeGrants: 5,
            pendingBindingRequests: 1,
            recentUsage: [],
            recentDenials: [],
            recentLifecycle: [],
            tenantBreakdown: [],
          },
          loading: false,
          error: null,
        },
      }),
      container,
    );

    const text = container.textContent ?? "";
    expect(text).toContain("运营身份监管");
    expect(text).toContain("身份总数");
    expect(text).toContain("活跃授权");
  });
});
