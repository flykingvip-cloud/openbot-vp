/* @vitest-environment jsdom */
import { render } from "lit";
import { beforeAll, describe, expect, it } from "vitest";
import { i18n } from "../../../../../i18n/index.ts";
import type { PlatformAuthPanelProps } from "../../../../views/platform-auth-panel.ts";
import type { EnterprisePortReadModel } from "../../semantic/enterprise-read-model.ts";
import type { EnterprisePortRenderModel } from "../../view-types.ts";
import { renderEnterpriseSurface } from "../enterprise-surfaces.ts";

beforeAll(async () => {
  await i18n.setLocale("zh-CN");
});

function noop() {}

function createReadModel(): EnterprisePortReadModel {
  return {
    currentTenantId: "acme",
    currentTenantLabel: "Acme",
    authenticatedUser: "admin@example.com",
    membershipRole: "enterprise-admin",
    memberCount: 1,
    memberUsers: ["admin@example.com"],
    memberSummaries: [
      {
        user: "admin@example.com",
        displayLabel: "Admin",
        membershipRole: "enterprise-admin",
        status: "active",
        seatTitle: null,
        seatStatus: null,
      },
    ],
    adminCount: 1,
    seatCount: 0,
    occupiedSeatCount: 0,
    vacantSeatCount: 0,
    handoverSeatCount: 0,
    frozenSeatCount: 0,
    handoverCaseCount: 0,
    pendingOfferCount: 0,
    seatSummaries: [],
    handoverSummaries: [],
    offerSummaries: [],
    latestInviteCode: null,
    latestInviteExpiresAt: null,
    agentCount: 1,
    defaultAgentId: "main",
    presenceCount: 1,
    runtimeHosts: ["node-a"],
    sessionsCount: 0,
    nodeCount: 1,
    groupIds: ["group-a"],
    cronJobCount: 0,
    meshSummary: {
      userCount: 1,
      agentCount: 6,
      groupCount: 1,
      onlineAgentCount: 1,
      activeAgentCount: 1,
      activeGroupCount: 1,
      activeAgentRate: 1,
      activeGroupRate: 1,
      totalCost: 0,
      totalTokens: 0,
      costPerSession: 0,
      sessionCount: 32,
      inefficientAssetCount: 0,
      unattributedCostCount: 0,
      unownedAssetCount: 0,
      governanceIssueCount: 0,
    },
    meshUsers: [],
    meshAgents: [],
    meshGroups: [],
    meshAnomalies: [],
    totalTokens: 0,
    totalCost: 0,
    missingCostEntries: 0,
    channelCount: 0,
    channelIds: [],
    accountCount: 0,
    modelMode: null,
    configuredProviderCount: 0,
    providerIds: [],
    configuredModelCount: 0,
    configuredModelIds: [],
    configIssueLabels: [],
    resolverOptions: [],
  } as unknown as EnterprisePortReadModel;
}

function createActions(): EnterprisePortRenderModel["surfaceActions"] {
  return {
    organization: {
      onRefresh: noop,
      onInvite: noop,
      onCloseInviteModal: noop,
      onImport: noop,
      onCloseImportModal: noop,
      onSeatOffer: noop,
      onCloseSeatOffer: noop,
      onSubmitSeatOffer: noop,
      onCancelSeatOffer: noop,
      onAcceptSeatOffer: noop,
      onDeclineSeatOffer: noop,
      onHandoverEditor: noop,
      onCloseHandoverEditor: noop,
      onSubmitHandover: noop,
      onCreatePosition: noop,
      onCloseCreatePosition: noop,
      onSubmitCreatePosition: noop,
    },
    usageManagement: {
      onRefresh: noop,
      onCreate: noop,
    },
    capabilityCenter: {
      onViewAllCapabilities: noop,
      onViewCapabilityDetail: noop,
      onViewContributionPerformance: noop,
    },
    mesh: {
      onRefreshRuntime: noop,
    },
    usage: {
      onRefreshHistory: noop,
      onRefreshBreakdown: noop,
    },
    settings: {
      onRefresh: noop,
    },
  } as unknown as EnterprisePortRenderModel["surfaceActions"];
}

function createAuthPanelProps(): PlatformAuthPanelProps {
  return {
    basePath: "",
    state: {
      enabled: true,
      sessionKind: "enterprise-admin",
      membershipRole: "enterprise-admin",
      tenantName: "Acme",
      enterprise: {
        id: "acme",
        name: "Acme",
        status: "trial",
        seatUsed: 1,
        seatQuota: 5,
      },
      session: {
        tenantId: "acme",
      },
    } as never,
    session: null,
    mode: "login",
    busy: false,
    error: null,
    notice: null,
    email: "",
    password: "",
    displayName: "",
    platformAdminDisplayName: "",
    tenantName: "",
    seatTitle: "",
    inviteCode: "",
    currentPassword: "",
    newPassword: "",
    policyTrialDays: "",
    policySeatCount: "",
    policyUpgradeUrl: "",
    policyContactAdvisorUrl: "",
    instanceEnterpriseId: "",
    instanceTrialDays: "",
    instanceSeatCount: "",
    instanceUpgradeUrl: "",
    instanceContactAdvisorUrl: "",
    platformAdminEmail: "",
    platformAdminPassword: "",
    platformAdminScopes: [],
    onModeChange: noop,
    onEmailChange: noop,
    onPasswordChange: noop,
    onDisplayNameChange: noop,
    onPlatformAdminDisplayNameChange: noop,
    onTenantNameChange: noop,
    onSeatTitleChange: noop,
    onInviteCodeChange: noop,
    onCurrentPasswordChange: noop,
    onNewPasswordChange: noop,
    onPolicyTrialDaysChange: noop,
    onPolicySeatCountChange: noop,
    onPolicyUpgradeUrlChange: noop,
    onPolicyContactAdvisorUrlChange: noop,
    onInstanceEnterpriseIdChange: noop,
    onInstanceTrialDaysChange: noop,
    onInstanceSeatCountChange: noop,
    onInstanceUpgradeUrlChange: noop,
    onInstanceContactAdvisorUrlChange: noop,
    onPlatformAdminEmailChange: noop,
    onPlatformAdminPasswordChange: noop,
    onPlatformAdminScopesChange: noop,
    onSubmit: noop,
  };
}

describe("mesh governance surface wrapper", () => {
  it("renders Legacy mesh shell with embedded governance-assets-page (Phase 4)", () => {
    const container = document.createElement("div");

    render(
      renderEnterpriseSurface({
        tab: "enterpriseMesh",
        basePath: "",
        readModel: createReadModel(),
        actions: createActions(),
        authPanelProps: createAuthPanelProps(),
        seatOfferEditor: { kind: "closed" } as never,
        handoverEditor: { kind: "closed" } as never,
      } as never),
      container,
    );

    expect(container.querySelector(".enterprise-surface--mesh")).not.toBeNull();
    expect(container.querySelector(".enterprise-surface--mesh-flat")).not.toBeNull();
    expect(container.querySelector('[data-mesh-panel="ops-perf-tabs"]')).not.toBeNull();
    expect(container.querySelector(".enterprise-mesh-governance-kpi")).not.toBeNull();
    expect(container.textContent).toContain("企业成员");
    expect(container.textContent).toContain("待处置");
    expect(container.textContent).toContain("待复核");
    expect(container.textContent).toContain("待优化");
    expect(container.querySelector("governance-assets-page")).not.toBeNull();
    expect(container.querySelector('[data-mesh-panel="operations-legacy-queue"]')).toBeNull();
    expect(container.querySelector('[data-mesh-panel="operations-assets"]')).not.toBeNull();
    expect(
      container
        .querySelector('[data-mesh-panel="operations-assets"]')
        ?.classList.contains("enterprise-mesh-ops-panel"),
    ).toBe(true);
    expect(
      container.querySelector('[data-mesh-panel="operations-assets"]')?.classList.contains("card"),
    ).toBe(false);
    expect(container.querySelector(".enterprise-hero--mesh")).toBeNull();
  });

  it("shows pending KPI placeholders while agents/spaces roster is unloaded", () => {
    const container = document.createElement("div");
    const readModel = createReadModel();
    readModel.meshSummary = {
      ...readModel.meshSummary,
      agentCount: 0,
      groupCount: 0,
    };
    readModel.meshAgents = [];
    readModel.meshGroups = [];

    render(
      renderEnterpriseSurface({
        tab: "enterpriseMesh",
        basePath: "",
        readModel,
        actions: createActions(),
        authPanelProps: createAuthPanelProps(),
        agentsList: null,
        collaborationSpacesResult: null,
        seatOfferEditor: { kind: "closed" } as never,
        handoverEditor: { kind: "closed" } as never,
      } as never),
      container,
    );

    expect(container.textContent).toContain("企业成员");
    expect(container.textContent).toMatch(/机器人\s*—/);
    expect(container.textContent).toMatch(/协作小组\s*—/);
    expect(container.textContent).not.toContain("暂无机器人");
  });

  it("renders ranking + graphs panels on performance meshTab", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const previous = window.location.search;
    window.history.replaceState({}, "", `${window.location.pathname}?meshTab=performance`);

    const agentsList = {
      defaultId: "main",
      agents: [
        { id: "main", name: "大白管家" },
        { id: "bot-2", name: "市场助手" },
      ],
    };
    const collaborationSpacesResult = {
      spaces: [
        {
          id: "space-upbeyond",
          groupId: "grp-upbeyond",
          title: "upbeyond",
          members: {
            humans: [{ userId: "a@example.com", name: "Admin", status: "active" }],
            bots: [{ agentId: "main", name: "大白管家", status: "active" }],
          },
        },
      ],
    };

    try {
      render(
        renderEnterpriseSurface({
          tab: "enterpriseMesh",
          basePath: "",
          readModel: createReadModel(),
          actions: createActions(),
          authPanelProps: createAuthPanelProps(),
          agentsList,
          collaborationSpacesResult,
          seatOfferEditor: { kind: "closed" } as never,
          handoverEditor: { kind: "closed" } as never,
        } as never),
        container,
      );

      const rankingPage = container.querySelector("governance-ranking-page");
      expect(rankingPage).toBeInstanceOf(HTMLElement);
      expect(Reflect.get(rankingPage ?? {}, "readModel")).toBeTruthy();
      expect(Reflect.get(rankingPage ?? {}, "agentsList")).toStrictEqual(agentsList);
      expect(Reflect.get(rankingPage ?? {}, "collaborationSpacesResult")).toStrictEqual(
        collaborationSpacesResult,
      );
      expect(container.querySelector('[data-mesh-panel="performance-graphs"]')).not.toBeNull();
      const canvas = container.querySelector("enterprise-mesh-graph-canvas") as
        | (HTMLElement & { updateComplete?: Promise<unknown> })
        | null;
      expect(container.querySelector('[data-mesh-graph="canvas"]')).not.toBeNull();
      expect(canvas).not.toBeNull();
      // Lit CE only performs the first update after connect; keep container in document.
      await canvas?.updateComplete;
      expect(canvas?.querySelector(".enterprise-mesh-graphs__search")).not.toBeNull();
      expect(canvas?.querySelector(".enterprise-mesh-graphs__svg")).not.toBeNull();
      expect(container.querySelector('[data-mesh-graph="capability"]')).not.toBeNull();
      expect(container.querySelector('[data-mesh-graph="collaboration"]')).not.toBeNull();
      expect(container.textContent).toContain("大白管家");
      expect(container.textContent).toContain("upbeyond");
      expect(container.textContent).toContain("关系画布");
      expect(container.textContent).toContain("仅已连接");
      expect(container.textContent).toContain("机器人 → 协作组");
      expect(container.querySelector("governance-assets-page")).toBeNull();
      expect(container.querySelector('[data-mesh-panel="performance-legacy-rank"]')).toBeNull();
    } finally {
      container.remove();
      window.history.replaceState({}, "", `${window.location.pathname}${previous}`);
    }
  });

  it("passes readModel, agentsList, and collaborationSpacesResult through to governance-assets-page", () => {
    const container = document.createElement("div");
    const readModel = createReadModel();
    const agentsList = [{ agentId: "main", label: "Main" }];
    const collaborationSpacesResult = {
      spaces: [{ id: "group-a", title: "Group A" }],
    };

    render(
      renderEnterpriseSurface({
        tab: "enterpriseMesh",
        basePath: "",
        readModel,
        actions: createActions(),
        authPanelProps: createAuthPanelProps(),
        agentsList,
        collaborationSpacesResult,
        seatOfferEditor: { kind: "closed" } as never,
        handoverEditor: { kind: "closed" } as never,
      } as never),
      container,
    );

    const page = container.querySelector("governance-assets-page") as
      | (HTMLElement & {
          readModel?: unknown;
          agentsList?: unknown;
          collaborationSpacesResult?: unknown;
        })
      | null;
    expect(page).not.toBeNull();
    expect(page?.readModel).toStrictEqual(readModel);
    expect(page?.agentsList).toStrictEqual(agentsList);
    expect(page?.collaborationSpacesResult).toStrictEqual(collaborationSpacesResult);
  });

  it("loads robot rows from meshAgents when agentsList is absent", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const readModel = createReadModel();
    readModel.meshAgents = [
      {
        agentId: "main",
        name: "大白管家",
        creatorUser: "admin@example.com",
        creatorLabel: "Admin",
        creatorStatus: "owned",
        costAttributionStatus: "attributed",
        governanceStatus: "normal",
        budgetLimit: null,
        budgetUsedRatio: 0,
        budgetStatus: "none",
        status: "online",
        runtimeHost: "node-a",
        groupCount: 1,
        sessionCount: 3,
        totalCost: 1.5,
        errorCount: 0,
        ownership: {
          positionId: "seat:ceo",
          positionLabel: "CEO",
          createdByUserId: "admin@example.com",
          createdByUserLabel: "Admin",
          currentManagerUserId: "admin@example.com",
          currentManagerLabel: "Admin",
          createdAt: "2026-08-01T00:00:00.000Z",
        },
        lastActiveAt: null,
      },
      {
        agentId: "bot-2",
        name: "市场助手",
        creatorUser: "admin@example.com",
        creatorLabel: "Admin",
        creatorStatus: "owned",
        costAttributionStatus: "attributed",
        governanceStatus: "normal",
        budgetLimit: null,
        budgetUsedRatio: 0,
        budgetStatus: "none",
        status: "online",
        runtimeHost: "node-a",
        groupCount: 0,
        sessionCount: 1,
        totalCost: 0.2,
        errorCount: 0,
        ownership: {
          positionId: null,
          positionLabel: null,
          createdByUserId: "admin@example.com",
          createdByUserLabel: "Admin",
          currentManagerUserId: "admin@example.com",
          currentManagerLabel: "Admin",
          createdAt: "2026-08-01T00:00:00.000Z",
        },
        lastActiveAt: null,
      },
    ] as never;
    readModel.meshSummary = {
      ...readModel.meshSummary,
      agentCount: 2,
    };

    try {
      render(
        renderEnterpriseSurface({
          tab: "enterpriseMesh",
          basePath: "",
          readModel,
          actions: createActions(),
          authPanelProps: createAuthPanelProps(),
          agentsList: null,
          collaborationSpacesResult: null,
          seatOfferEditor: { kind: "closed" } as never,
          handoverEditor: { kind: "closed" } as never,
        } as never),
        container,
      );

      const page = container.querySelector("governance-assets-page") as
        | (HTMLElement & { updateComplete?: Promise<unknown> })
        | null;
      expect(page).not.toBeNull();
      await page?.updateComplete;
      // Allow async loadAssets to settle across Lit update cycles.
      for (let i = 0; i < 5; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        await page?.updateComplete;
        const text = page?.shadowRoot?.textContent ?? "";
        if (text.includes("大白管家")) {
          break;
        }
      }

      const shadowText = page?.shadowRoot?.textContent ?? "";
      expect(shadowText).toContain("大白管家");
      expect(shadowText).toContain("市场助手");
      expect(shadowText).not.toContain("暂无机器人");
      expect(container.querySelector(".enterprise-mesh-ops-perf-tabs")).not.toBeNull();
      expect(container.querySelector(".enterprise-mesh-object-card small")).toBeNull();
    } finally {
      container.remove();
    }
  });
});
