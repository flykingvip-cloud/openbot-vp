// @vitest-environment jsdom

import { render } from "lit";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { i18n } from "../../../../i18n/index.ts";
import { zh_CN } from "../../../../i18n/locales/zh-CN.ts";
import { onPopState, type SettingsHost } from "../../../app-settings.ts";
import type { Tab } from "../../../navigation.ts";
import type { PlatformAuthPanelProps } from "../../../views/platform-auth-panel.ts";
import type { EnterprisePortReadModel } from "../semantic/enterprise-read-model.ts";
import type { EnterpriseSurfaceProps } from "./enterprise-surface-types.ts";
import {
  getActiveCostBudgetV2Navigation,
  renderEnterpriseUsageSurface,
  resetCostBudgetV2NavigationState,
} from "./enterprise-usage-surface.ts";

function createReadModel(): EnterprisePortReadModel {
  return {
    currentTenantId: "acme",
    currentTenantLabel: "Acme",
    authenticatedUser: "owner@example.com",
    membershipRole: "enterprise-admin",
    memberCount: 1,
    memberUsers: ["owner@example.com"],
    memberSummaries: [],
    adminCount: 1,
    seatCount: 1,
    occupiedSeatCount: 1,
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
    agentCount: 0,
    defaultAgentId: null,
    presenceCount: 0,
    runtimeHosts: [],
    sessionsCount: 0,
    nodeCount: 0,
    connected: true,
    resolverOptions: [],
  } as unknown as EnterprisePortReadModel;
}

function createAuthPanelProps(): PlatformAuthPanelProps {
  return {
    state: {
      enabled: true,
      hasUsers: true,
      allowRegistration: false,
      sessionKind: "enterprise-admin",
      enterprise: {
        id: "acme",
        name: "Acme",
        status: "trial",
        plan: "trial",
        billingStatus: "trialing",
        createdSource: "self-service",
        seatUsed: 1,
        seatQuota: 5,
        seatsRemaining: 4,
      },
    },
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
    policyTrialDays: "14",
    policySeatCount: "5",
    policyUpgradeUrl: "",
    policyContactAdvisorUrl: "",
    instanceEnterpriseId: "",
    instanceTrialDays: "14",
    instanceSeatCount: "5",
    instanceUpgradeUrl: "",
    instanceContactAdvisorUrl: "",
    platformAdminEmail: "",
    platformAdminPassword: "",
    platformAdminScopes: [],
    onModeChange: () => undefined,
    onEmailChange: () => undefined,
    onPasswordChange: () => undefined,
    onDisplayNameChange: () => undefined,
    onTenantNameChange: () => undefined,
    onSeatTitleChange: () => undefined,
    onInviteCodeChange: () => undefined,
    onCurrentPasswordChange: () => undefined,
    onNewPasswordChange: () => undefined,
    onPlatformAdminEmailChange: () => undefined,
    onPlatformAdminPasswordChange: () => undefined,
    onPlatformAdminScopesChange: () => undefined,
    onSubmit: async () => undefined,
    onLogout: async () => undefined,
    // Focused usage-surface test: only authPanelProps.state is read; the remaining
    // callbacks/session are unused, so cast the partial fixture to the full type.
  } as unknown as PlatformAuthPanelProps;
}

function createSurfaceProps(): EnterpriseSurfaceProps {
  return {
    tab: "enterpriseUsage",
    basePath: "",
    client: null,
    agentsList: null,
    collaborationSpacesResult: null,
    readModel: createReadModel(),
    actions: {
      onRefresh: () => undefined,
      onExport: () => undefined,
    },
    authPanelProps: createAuthPanelProps(),
    accessControlEditor: null,
    createPositionEditor: null,
    seatOfferEditor: null,
    handoverEditor: null,
    ownershipTransferEditor: null,
    // The usage surface only reads readModel/authPanelProps/client; actions and
    // editors are unused here, so cast the assembled fixture to the full prop type.
  } as unknown as EnterpriseSurfaceProps;
}

const createSettingsHost = (tab: Tab): SettingsHost => ({
  settings: {
    gatewayUrl: "",
    token: "",
    sessionKey: "main",
    lastActiveSessionKey: "main",
    sessionSeenAt: { main: 1 },
    theme: "system",
    chatFocusMode: false,
    chatShowThinking: true,
    splitRatio: 0.6,
    navCollapsed: false,
    navGroupsCollapsed: {},
    recentEnterpriseTenantIds: ["acme"],
  },
  theme: "system",
  themeResolved: "dark",
  applySessionKey: "main",
  sessionKey: "main",
  tab,
  connected: false,
  chatHasAutoScrolled: false,
  logsAtBottom: false,
  eventLog: [],
  eventLogBuffer: [],
  basePath: "",
  cronRunsScope: "all",
  cronRunsJobId: null,
  themeMedia: null,
  themeMediaHandler: null,
  syncEnterpriseHandoverRoute: async () => undefined,
});

describe("renderEnterpriseUsageSurface", () => {
  beforeEach(async () => {
    i18n.registerTranslation("zh-CN", zh_CN);
    await i18n.setLocale("zh-CN");
    resetCostBudgetV2NavigationState({
      route: "overview",
      planOrdersPanel: "catalog",
      settingsPanel: "budget",
    });
    window.history.replaceState({}, "", "/enterprise/acme/usage/overview");
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("ignores popstate events for unrelated routes", () => {
    window.history.replaceState({}, "", "/platform/models#platform-models:usageAnalytics");
    resetCostBudgetV2NavigationState({
      route: "overview",
      planOrdersPanel: "catalog",
      settingsPanel: "budget",
    });

    expect(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    }).not.toThrow();
    expect(window.location.pathname).toBe("/platform/models");
    expect(window.location.hash).toBe("#platform-models:usageAnalytics");
    expect(getActiveCostBudgetV2Navigation().route).toBe("overview");
  });

  it("switches cost budget v2 tab when plan-orders is clicked (with popstate sync)", () => {
    const container = document.createElement("div");
    const props = createSurfaceProps();
    const host = createSettingsHost("enterpriseUsage");

    render(renderEnterpriseUsageSurface(props, ""), container);

    const planOrdersTab = [...container.querySelectorAll(".enterprise-segmented-nav__tab")].find(
      (el) => el.textContent?.includes("套餐与订单"),
    ) as HTMLButtonElement | undefined;
    expect(planOrdersTab).toBeTruthy();
    planOrdersTab!.click();
    onPopState(host);

    expect(window.location.pathname).toBe("/enterprise/acme/usage/plan-orders");
    expect(window.location.hash).toBe("#plan");
    expect(getActiveCostBudgetV2Navigation().route).toBe("plan-orders");

    render(renderEnterpriseUsageSurface(props, ""), container);
    expect(getActiveCostBudgetV2Navigation().route).toBe("plan-orders");
  });

  it("switches cost budget v2 tab when settings is clicked", () => {
    const container = document.createElement("div");
    const props = createSurfaceProps();

    render(renderEnterpriseUsageSurface(props, ""), container);
    expect(container.querySelector('[data-testid="cost-budget-v2-page"]')).toBeTruthy();

    const settingsTab = [...container.querySelectorAll(".enterprise-segmented-nav__tab")].find(
      (el) => el.textContent?.includes("设置") || el.textContent?.includes("Settings"),
    ) as HTMLButtonElement | undefined;
    expect(settingsTab).toBeTruthy();
    settingsTab!.click();

    expect(window.location.pathname).toBe("/enterprise/acme/usage/settings");
    expect(getActiveCostBudgetV2Navigation().route).toBe("settings");

    render(renderEnterpriseUsageSurface(props, ""), container);
    expect(container.querySelector('[data-testid="cost-budget-v2-settings-page"]')).toBeTruthy();
  });
});
