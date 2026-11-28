/* @vitest-environment jsdom */

import { render } from "lit";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../../../../i18n/index.ts";
import { __resetModelAuthorizationGrantsCacheForTest } from "../../../capability/model-authorization/gateway-client.ts";
import type { PlatformAuthPanelProps } from "../../../views/platform-auth-panel.ts";
import type { EnterprisePortReadModel } from "../semantic/enterprise-read-model.ts";
import type { EnterprisePortRenderModel } from "../view-types.ts";
import { resetOrganizationStructureTransientState } from "./enterprise-organization-surface.ts";
import { resetEnterprisePendingControlsForTests } from "./enterprise-pending-controls-panel.ts";
import { resetEnterpriseSecurityPanelStateForTests } from "./enterprise-security-controls-panel.ts";
import { renderEnterpriseSurface as renderEnterpriseSurfaceActual } from "./enterprise-surfaces.ts";
import {
  getActiveCostBudgetV2Navigation,
  resetCostBudgetV2NavigationState,
} from "./enterprise-usage-surface.ts";

type RenderSurfaceArgs = Parameters<typeof renderEnterpriseSurfaceActual>[0];
type TestSurfaceProps = Omit<
  RenderSurfaceArgs,
  "ownershipTransferEditor" | "identityManagementEditor"
> &
  Partial<Pick<RenderSurfaceArgs, "ownershipTransferEditor" | "identityManagementEditor">>;

function renderEnterpriseSurface(
  props: TestSurfaceProps,
): ReturnType<typeof renderEnterpriseSurfaceActual> {
  return renderEnterpriseSurfaceActual({
    ...props,
    ownershipTransferEditor: props.ownershipTransferEditor ?? createOwnershipTransferEditor(),
    identityManagementEditor: props.identityManagementEditor ?? createIdentityManagementEditor(),
  });
}

function createReadModel(): EnterprisePortReadModel {
  return {
    currentTenantId: "acme",
    currentTenantLabel: "Acme",
    authenticatedUser: "owner@example.com",
    membershipRole: "enterprise-admin",
    memberCount: 2,
    memberUsers: ["owner@example.com", "member@example.com"],
    memberSummaries: [
      {
        user: "owner@example.com",
        displayLabel: "Owner",
        membershipRole: "enterprise-admin",
        status: "active",
        seatTitle: "Sales Lead",
        seatStatus: "occupied",
        seatTeamLabel: "销售一组",
      },
      {
        user: "member@example.com",
        displayLabel: "Member",
        membershipRole: "member",
        status: "active",
        seatTitle: null,
        seatStatus: null,
        seatTeamLabel: null,
      },
    ],
    adminCount: 1,
    seatCount: 1,
    occupiedSeatCount: 1,
    assignedSeatCount: 1,
    vacantSeatCount: 0,
    handoverSeatCount: 0,
    frozenSeatCount: 0,
    handoverCaseCount: 0,
    pendingOfferCount: 0,
    organizationDepartmentPaths: [],
    seatSummaries: [
      {
        seatId: "seat-1",
        title: "Sales Lead",
        teamLabel: "销售一组",
        status: "occupied",
        currentEmployeeUser: "owner@example.com",
        currentEmployeeLabel: "Owner",
        roleCode: "OPS-L2-001",
        defaultAgentId: "main",
        agentIds: ["main"],
        defaultSpaceIds: ["space-sales"],
        memoryScopeIds: ["seat:seat-1"],
        responsibility: null,
      },
    ],
    handoverSummaries: [],
    offerSummaries: [],
    latestInviteCode: null,
    latestInviteExpiresAt: null,
    agentCount: 3,
    defaultAgentId: "main",
    presenceCount: 2,
    runtimeHosts: ["node-a"],
    sessionsCount: 5,
    nodeCount: 2,
    groupIds: ["group-a"],
    cronJobCount: 1,
    meshSummary: {
      userCount: 2,
      agentCount: 3,
      groupCount: 2,
      onlineAgentCount: 2,
      activeAgentCount: 2,
      activeGroupCount: 1,
      activeAgentRate: 2 / 3,
      activeGroupRate: 0.5,
      totalCost: 9.87,
      totalTokens: 1234,
      costPerSession: 1.97,
      sessionCount: 5,
      inefficientAssetCount: 1,
      unattributedCostCount: 2,
      unownedAssetCount: 2,
      governanceIssueCount: 3,
    },
    meshUsers: [
      {
        user: "owner@example.com",
        displayLabel: "Owner",
        role: "enterprise-admin",
        ownedAgentCount: 2,
        ownedGroupCount: 0,
        sessionCount: 4,
        totalCost: 7.25,
        totalTokens: 980,
        incidentCount: 1,
      },
      {
        user: "member@example.com",
        displayLabel: "Member",
        role: "member",
        ownedAgentCount: 0,
        ownedGroupCount: 0,
        sessionCount: 1,
        totalCost: 0,
        totalTokens: 0,
        incidentCount: 0,
      },
    ],
    meshAgents: [
      {
        agentId: "main",
        name: "Main Agent",
        creatorUser: "owner@example.com",
        creatorLabel: "Owner",
        creatorStatus: "owned",
        costAttributionStatus: "attributed",
        governanceStatus: "normal",
        budgetLimit: null,
        budgetUsedRatio: null,
        budgetStatus: "none",
        status: "online",
        runtimeHost: "node-a",
        groupCount: 1,
        sessionCount: 3,
        totalCost: 6.5,
        lifetimeCost: 6.5,
        totalTokens: 900,
        errorCount: 1,
        lastActiveAt: 1710000000000,
        ownership: {
          positionId: "pos-eng",
          positionLabel: "Engineering",
          createdByUserId: "owner@example.com",
          createdByUserLabel: "Owner",
          currentManagerUserId: "owner@example.com",
          currentManagerLabel: "Owner",
          createdAt: "2025-01-01T00:00:00.000Z",
        },
      },
      {
        agentId: "sales",
        name: "Sales Agent",
        creatorUser: "owner@example.com",
        creatorLabel: "Owner",
        creatorStatus: "owned",
        costAttributionStatus: "attributed",
        governanceStatus: "restricted",
        budgetLimit: null,
        budgetUsedRatio: null,
        budgetStatus: "warning",
        status: "online",
        runtimeHost: "node-a",
        groupCount: 1,
        sessionCount: 1,
        totalCost: 0.75,
        lifetimeCost: 0.75,
        totalTokens: 80,
        errorCount: 0,
        lastActiveAt: 1710000000000,
        ownership: {
          positionId: "pos-sales",
          positionLabel: "Sales",
          createdByUserId: "owner@example.com",
          createdByUserLabel: "Owner",
          currentManagerUserId: "owner@example.com",
          currentManagerLabel: "Owner",
          createdAt: "2025-01-01T00:00:00.000Z",
        },
      },
      {
        agentId: "support",
        name: "Support Agent",
        creatorUser: null,
        creatorLabel: null,
        creatorStatus: "unowned",
        costAttributionStatus: "unattributed",
        governanceStatus: "paused",
        budgetLimit: null,
        budgetUsedRatio: null,
        budgetStatus: "none",
        status: "offline",
        runtimeHost: null,
        groupCount: 0,
        sessionCount: 0,
        totalCost: 0,
        lifetimeCost: 0,
        totalTokens: 0,
        errorCount: 0,
        lastActiveAt: null,
        ownership: {
          positionId: "unassigned",
          positionLabel: "待归属岗位",
          createdByUserId: "unassigned",
          createdByUserLabel: "待确认",
          currentManagerUserId: "unassigned",
          currentManagerLabel: "待确认",
          createdAt: "2025-01-01T00:00:00.000Z",
        },
      },
    ],
    meshGroups: [
      {
        groupId: "group-a",
        name: "Revenue Squad",
        creatorUser: null,
        creatorLabel: null,
        creatorStatus: "unowned",
        costAttributionStatus: "partial",
        governanceStatus: "restricted",
        budgetLimit: null,
        budgetUsedRatio: null,
        budgetStatus: "warning",
        memberCount: 2,
        agentCount: 2,
        sessionCount: 2,
        totalCost: 2.1,
        lifetimeCost: 2.1,
        totalTokens: 254,
        incidentCount: 1,
        lastActiveAt: 1710000000000,
        ownership: {
          positionId: "unassigned",
          positionLabel: "待归属岗位",
          createdByUserId: "unassigned",
          createdByUserLabel: "待确认",
          currentManagerUserId: "unassigned",
          currentManagerLabel: "待确认",
          createdAt: "2025-01-01T00:00:00.000Z",
        },
      },
      {
        groupId: "group-b",
        name: "Ops Group",
        creatorUser: null,
        creatorLabel: null,
        creatorStatus: "unowned",
        costAttributionStatus: "unattributed",
        governanceStatus: "paused",
        budgetLimit: null,
        budgetUsedRatio: null,
        budgetStatus: "none",
        memberCount: 1,
        agentCount: 0,
        sessionCount: 0,
        totalCost: 0,
        lifetimeCost: 0,
        totalTokens: 0,
        incidentCount: 0,
        lastActiveAt: null,
        ownership: {
          positionId: "unassigned",
          positionLabel: "待归属岗位",
          createdByUserId: "unassigned",
          createdByUserLabel: "待确认",
          currentManagerUserId: "unassigned",
          currentManagerLabel: "待确认",
          createdAt: "2025-01-01T00:00:00.000Z",
        },
      },
    ],
    meshAnomalies: [
      {
        id: "group-owner-group-a",
        kind: "group",
        title: "Revenue Squad",
        reason: "协作小组未记录创建人",
        severity: "critical",
        meta: "2 个机器人",
        targetId: "group-a",
      },
      {
        id: "agent-owner-support",
        kind: "agent",
        title: "Support Agent",
        reason: "机器人未记录创建人",
        severity: "critical",
        meta: "待补创建人",
        targetId: "support",
      },
      {
        id: "group-attribution-group-a",
        kind: "group",
        title: "Revenue Squad",
        reason: "小组成本仍为推导或未归因",
        severity: "watch",
        meta: "2 个会话",
        targetId: "group-a",
      },
    ],
    totalTokens: 1234,
    totalCost: 9.87,
    missingCostEntries: 0,
    channelCount: 1,
    channelIds: ["slack"],
    accountCount: 1,
    modelMode: "strict",
    configuredProviderCount: 1,
    providerIds: ["openai"],
    configuredModelCount: 1,
    configuredModelIds: ["gpt-5.4"],
    configValid: true,
    configIssueCount: 0,
    configIssueLabels: [],
    resolverOptions: [],
    identityCount: 2,
    identityProviderCounts: { feishu: 1, "enterprise-email": 1 },
    identityProviderCatalog: [
      {
        provider: "kuaishou",
        label: "快手（企业）",
        category: "official",
        connectorIds: ["kuaishou", "kuaishou-official"],
        rolloutTier: "p0",
        registrationReady: true,
        operationalActions: [{ action: "publish_video", label: "发布视频" }],
        dataSyncActions: [{ action: "sync_video_metrics", label: "同步播放数据" }],
        reauthHint: "请在快手开放平台重新授权并更新岗位绑定的连接器凭证。",
        degradedHint: "内容发布能力取决于开放平台已审批的接口权限。",
      },
      {
        provider: "wechat-official",
        label: "微信公众号",
        category: "official",
        connectorIds: ["wechat-official", "wechat-mp"],
        rolloutTier: "p2",
        registrationReady: true,
        operationalActions: [{ action: "publish_article", label: "发布文章" }],
        dataSyncActions: [{ action: "sync_follower_stats", label: "同步粉丝数据" }],
        reauthHint: "请在微信公众平台重新授权。",
        degradedHint: "个人微信（wechat）不能注册为公众号运营身份。",
        registrationProfile: {
          summary: "填写 AppID 与 AppSecret。",
          methods: ["manual"],
          manualFields: [
            {
              key: "appId",
              label: "AppID",
              kind: "text",
              required: true,
              storage: "metadata",
            },
            {
              key: "appSecret",
              label: "AppSecret",
              kind: "password",
              required: true,
              storage: "secret",
            },
          ],
          verifyChecks: [{ key: "client_credential", label: "AppID / AppSecret 校验通过" }],
          actionRequirements: [],
        },
      },
      {
        provider: "notion",
        label: "Notion",
        category: "business",
        connectorIds: ["notion"],
        rolloutTier: "p2",
        registrationReady: true,
        operationalActions: [{ action: "create_page", label: "创建页面" }],
        dataSyncActions: [],
        reauthHint: "请重新授权 Notion Integration 并确认页面/数据库权限。",
        degradedHint: null,
      },
    ],
    identitySummaries: [
      {
        identityId: "id-feishu",
        provider: "feishu",
        providerLabel: "飞书",
        category: "communication",
        displayName: "Acme Feishu",
        status: "active",
        policyCount: 1,
        dataSourceBindingCount: 0,
        credentialBindingId: "cred-feishu",
        updatedAt: "2026-06-06T00:00:00.000Z",
      },
      {
        identityId: "id-email",
        provider: "enterprise-email",
        providerLabel: "企业邮箱",
        category: "official",
        displayName: "ops@acme.example",
        status: "reauth_required",
        policyCount: 0,
        dataSourceBindingCount: 0,
        credentialBindingId: "cred-email",
        updatedAt: "2026-06-06T00:00:00.000Z",
        statusHint: {
          status: "reauth_required",
          label: "需重授权",
          tone: "warn",
          detail: "请在 SMTP / 企业邮箱控制台重新授权凭证。",
        },
      },
    ],
    identityPolicySummaries: [
      {
        policyId: "policy-1",
        identityId: "id-feishu",
        seatIds: ["seat-1"],
        allowedAgentIds: ["main"],
        allowedActions: ["send_message"],
        enabled: true,
      },
    ],
    identityDataSourceBindings: [
      {
        bindingId: "bind-1",
        identityId: "id-feishu",
        dataSourceId: "source-crm-1",
        purpose: "source_sync",
      },
    ],
    identityEligibleDataSources: [
      {
        sourceId: "source-crm-1",
        sourceKey: "crm",
        displayName: "Acme CRM",
        connectorId: "crm",
        status: "connected",
      },
    ],
    dataSourceGovernanceDetail: {
      sourceId: "source-crm-1",
      busy: false,
      error: null,
      source: {
        sourceId: "source-crm-1",
        sourceKey: "crm",
        displayName: "Acme CRM",
        category: "crm",
        status: "connected",
        connectorId: "crm",
      },
      boundOperationalIdentities: [
        {
          bindingId: "bind-1",
          identityId: "id-feishu",
          displayName: "Acme Feishu",
          provider: "feishu",
          providerLabel: "飞书",
          status: "active",
          purpose: "source_sync",
        },
      ],
    },
    identityGovernanceStats: {
      total: 2,
      connected: 1,
      atRisk: 1,
      inUse: 1,
      unused: 0,
    },
    identityAssetSummaries: [
      {
        identityId: "id-feishu",
        displayName: "Acme Feishu",
        provider: "feishu",
        providerLabel: "飞书",
        category: "communication",
        status: "active",
        statusLabel: "正常",
        updatedAt: "2026-06-06T00:00:00.000Z",
        inUse: true,
        agentIds: ["main"],
        agentLabels: ["Main"],
        employeeAgentBindings: [],
        seatTitles: ["Sales Lead"],
        allowedActionKeys: ["send_message"],
        allowedActionLabels: ["发送消息"],
        dataSourceCount: 1,
        policyCount: 1,
        recentUsageCount: 0,
        stewardKind: "seat",
        stewardLabel: "Sales Lead",
      },
      {
        identityId: "id-email",
        displayName: "ops@acme.example",
        provider: "enterprise-email",
        providerLabel: "企业邮箱",
        category: "official",
        status: "reauth_required",
        statusLabel: "需重授权",
        updatedAt: "2026-06-06T00:00:00.000Z",
        inUse: false,
        agentIds: [],
        agentLabels: [],
        employeeAgentBindings: [],
        seatTitles: [],
        allowedActionKeys: [],
        allowedActionLabels: [],
        dataSourceCount: 0,
        policyCount: 0,
        recentUsageCount: 0,
        stewardKind: "unassigned",
        stewardLabel: "未分配",
      },
    ],
    identityProviderGroups: [
      {
        provider: "enterprise-email",
        providerLabel: "企业邮箱（员工自行配置，已移出企业目录）",
        category: "official",
        canRegister: false,
        identities: [
          {
            identityId: "id-email",
            displayName: "ops@acme.example",
            provider: "enterprise-email",
            providerLabel: "企业邮箱",
            category: "official",
            status: "reauth_required",
            statusLabel: "需重授权",
            updatedAt: "2026-06-06T00:00:00.000Z",
            inUse: false,
            agentIds: [],
            agentLabels: [],
            employeeAgentBindings: [],
            seatTitles: [],
            allowedActionKeys: [],
            allowedActionLabels: [],
            dataSourceCount: 0,
            policyCount: 0,
            recentUsageCount: 0,
            stewardKind: "unassigned",
            stewardLabel: "未分配",
          },
        ],
      },
      {
        provider: "wechat-official",
        providerLabel: "微信公众号",
        category: "official",
        canRegister: true,
        identities: [],
      },
      {
        provider: "kuaishou",
        providerLabel: "快手（企业）",
        category: "official",
        canRegister: true,
        identities: [],
      },
      {
        provider: "feishu",
        providerLabel: "飞书",
        category: "communication",
        canRegister: false,
        identities: [
          {
            identityId: "id-feishu",
            displayName: "Acme Feishu",
            provider: "feishu",
            providerLabel: "飞书",
            category: "communication",
            status: "active",
            statusLabel: "正常",
            updatedAt: "2026-06-06T00:00:00.000Z",
            inUse: true,
            agentIds: ["main"],
            agentLabels: ["Main"],
            employeeAgentBindings: [],
            seatTitles: ["Sales Lead"],
            allowedActionKeys: ["send_message"],
            allowedActionLabels: ["发送消息"],
            dataSourceCount: 1,
            policyCount: 1,
            recentUsageCount: 0,
            stewardKind: "seat",
            stewardLabel: "Sales Lead",
          },
        ],
      },
      {
        provider: "notion",
        providerLabel: "Notion",
        category: "business",
        canRegister: true,
        identities: [],
      },
    ],
    operationalIdentityLoaded: true,
    employeeIdentityBindingRows: [],
    recentIdentityBindingActivity: [],
    identityAlerts: [
      {
        identityId: "id-email",
        displayName: "ops@acme.example",
        status: "reauth_required",
        message: "请在 SMTP / 企业邮箱控制台重新授权凭证。",
      },
    ],
    operationalIdentityBusy: false,
    operationalIdentityError: null,
    operationalIdentityNotice: null,
    identityVerify: null,
    gatewayEgressIp: "8.217.93.71",
    operationalIdentityRelationships: [
      {
        identityId: "id-feishu",
        displayName: "Acme Feishu",
        providerLabel: "飞书",
        status: "active",
        seats: ["seat-1"],
        agents: ["main"],
        dataSourceIds: [],
        allowedActions: ["send_message"],
      },
    ],
    seatOperationalIdentityAccess: [
      {
        seatId: "seat-1",
        seatTitle: "Sales Lead",
        identities: [
          {
            identityId: "id-feishu",
            displayName: "Acme Feishu",
            providerLabel: "飞书",
            status: "active",
            allowedActions: ["send_message"],
            agentIds: ["main"],
          },
        ],
      },
    ],
  };
}

function createActions(): EnterprisePortRenderModel["surfaceActions"] {
  return {
    overview: {
      onRefresh: vi.fn(),
    },
    dataGovernance: {
      onRefresh: vi.fn(),
    },
    organization: {
      onRefresh: vi.fn(),
      onCreateInvite: vi.fn(),
      onInviteEnterpriseAdmin: vi.fn(),
      onImportOrganizationRows: vi.fn(),
      onBuildOrganization: vi.fn(),
      onSendActivationEmails: vi.fn(),
      onSubmitAuth: vi.fn(),
      onSwitchToEnterpriseAdmin: vi.fn(),
      onRefreshUsers: vi.fn(),
      onRefreshTeams: vi.fn(),
      onRefreshRoles: vi.fn(),
      onOffboardMember: vi.fn(),
      onSendSeatOffer: vi.fn(),
      onCancelSeatOffer: vi.fn(),
      onRemindSeatOffer: vi.fn(),
      onStartSeatHandover: vi.fn(),
      onReviewHandover: vi.fn(),
      onApproveHandover: vi.fn(),
      onRebindHandover: vi.fn(),
      onMutateOrganizationDepartment: vi.fn(async (_tenantId, mutation) => {
        if (mutation.action === "create") {
          const parent = mutation.parentPath?.trim();
          const label = mutation.label?.trim() ?? "新部门";
          return { ok: true, fullPath: parent ? `${parent}/${label}` : label };
        }
        if (mutation.action === "rename") {
          const parts = String(mutation.path).split("/");
          parts[parts.length - 1] = String(mutation.label);
          return { ok: true, fullPath: parts.join("/") };
        }
        return { ok: true as const };
      }),
      onDeleteSeat: vi.fn(async () => ({ ok: true })),
      onDeleteSeatAndMember: vi.fn(async () => ({ ok: true })),
      onCreateSeat: vi.fn(async () => ({
        ok: true,
        seat: { seatId: "seat-new", title: "新岗位", status: "vacant" },
      })),
      onUpdateSeatProfile: vi.fn(async () => ({
        ok: true,
        seat: { seatId: "seat-new", title: "新岗位", status: "vacant" },
      })),
      onTransferOwnership: vi.fn(),
      onRevokeOwnership: vi.fn(),
    },
    usageManagement: {
      onRefresh: vi.fn(),
      onUninstall: vi.fn(),
      onAcknowledge: vi.fn(),
      onUpdateGovernanceConfig: vi.fn(),
      onCronRefresh: vi.fn(),
      onCronFormChange: vi.fn(),
      onCronAdd: vi.fn(),
      onCronEdit: vi.fn(),
      onCronClone: vi.fn(),
      onCronCancelEdit: vi.fn(),
      onCronToggle: vi.fn(),
      onCronRun: vi.fn(),
      onCronRemove: vi.fn(),
      onCronLoadRuns: vi.fn(),
      onCronLoadMoreJobs: vi.fn(),
      onCronJobsFiltersChange: vi.fn(),
      onCronJobsFiltersReset: vi.fn(),
      onCronLoadMoreRuns: vi.fn(),
      onCronRunsFiltersChange: vi.fn(),
    },
    mesh: {
      onRefresh: vi.fn(),
      onRefreshOverview: vi.fn(),
      onRefreshRuntime: vi.fn(),
      onRefreshIncidents: vi.fn(),
      onTransferOwnership: vi.fn(),
      onRevokeOwnership: vi.fn(),
    },
    usage: {
      onRefresh: vi.fn(),
      onRefreshBreakdown: vi.fn(),
      onRefreshHistory: vi.fn(),
    },
    settings: {
      onRefresh: vi.fn(),
      onLogout: vi.fn(),
      onRefreshIntegrations: vi.fn(),
      onRefreshPolicies: vi.fn(),
      onRefreshIdentities: vi.fn(),
      onRevokeIdentity: vi.fn(),
      onCreateConnectorCredential: vi.fn(),
      onProbeImChannel: vi.fn(),
      onSyncChannelToOperationalIdentity: vi.fn(),
      onNavigateToImChannelCredentials: vi.fn(),
      onReauthorizeIdentity: vi.fn(),
      onVerifyIdentity: vi.fn(),
      onOpenIdentityEditor: vi.fn(),
      onOpenIdentityRevokeConfirm: vi.fn(),
      onCloseIdentityEditor: vi.fn(),
      onSubmitIdentityEditor: vi.fn(),
      onRemoveIdentityBinding: vi.fn(),
      onOpenDataSourceGovernanceDetail: vi.fn(),
      onCloseDataSourceGovernanceDetail: vi.fn(),
    },
  } as unknown as EnterprisePortRenderModel["surfaceActions"];
}

function createIdentityManagementEditor(): EnterprisePortRenderModel["identityManagementEditor"] {
  return {
    open: false,
    mode: "register",
    identityId: "",
    policyId: "",
    bindingId: "",
    displayName: "",
    credentialBindingId: "",
    provider: "",
    registerStep: "provider",
    seatIds: "",
    agentIds: "",
    allowedActions: "",
    dataSourceId: "",
    bindingPurpose: "source_sync",
    busy: false,
    error: null,
    notice: null,
    eligibleCredentialBindings: [],
    eligibleDataSources: [],
    identityOptions: [],
    onOpen: vi.fn(),
    onClose: vi.fn(),
    onDisplayNameChange: vi.fn(),
    onCredentialBindingIdChange: vi.fn(),
    onRegisterProviderSelect: vi.fn(),
    onRegisterProviderBack: vi.fn(),
    onStartOAuth: vi.fn(),
    policyPickerQuery: "",
    policyDepartmentPaths: "",
    onIdentityIdChange: vi.fn(),
    onSeatIdsChange: vi.fn(),
    onAgentIdsChange: vi.fn(),
    onAllowedActionsChange: vi.fn(),
    onPolicyPickerQueryChange: vi.fn(),
    onPolicyDepartmentPathsChange: vi.fn(),
    onDataSourceIdChange: vi.fn(),
    onBindingPurposeChange: vi.fn(),
    onSubmit: vi.fn(),
    selectedDetailIdentityId: "",
    detailTab: "usage",
    onSelectDetailIdentity: vi.fn(),
    credentialFields: {},
    credentialFieldsReady: false,
    credentialSecretsConfigured: [],
    onCredentialFieldChange: vi.fn(),
    onSaveCredentialConfig: vi.fn(),
    onDetailTabChange: vi.fn(),
    revokeConfirmIdentityId: "",
    onOpenRevokeConfirm: vi.fn(),
    onCloseRevokeConfirm: vi.fn(),
    onConfirmRevoke: vi.fn(),
    onVerifyIdentity: vi.fn(),
  } as unknown as EnterprisePortRenderModel["identityManagementEditor"];
}

function createAuthPanelProps(params: {
  status: "trial" | "expired";
  seatUsed: number;
  seatQuota: number;
}): PlatformAuthPanelProps {
  return {
    state: {
      enabled: true,
      hasUsers: true,
      hasPlatformAdmins: true,
      availableModes: ["login"],
      session: {
        provider: "trusted-proxy",
        user: "owner@example.com",
        displayName: "Owner",
        tenantId: "acme",
        role: "operator",
      },
      sessionKind: "enterprise-admin",
      tenantName: "Acme",
      membershipRole: "enterprise-admin",
      members: [
        {
          user: "owner@example.com",
          displayName: "Owner",
          membershipRole: "enterprise-admin",
          isCurrentUser: true,
        },
        {
          user: "member@example.com",
          displayName: "Member",
          membershipRole: "member",
          isCurrentUser: false,
        },
      ],
      enterprise: {
        id: "acme",
        name: "Acme",
        status: params.status,
        plan: "trial",
        billingStatus: "trialing",
        createdSource: "self-service",
        seatQuota: params.seatQuota,
        seatUsed: params.seatUsed,
        seatsRemaining: Math.max(0, params.seatQuota - params.seatUsed),
        trialEndsAt: "2026-04-20T00:00:00.000Z",
        allowReadOnlyAfterExpiry: true,
        upgradeUrl: "https://example.com/upgrade",
        contactAdvisorUrl: "https://example.com/advisor",
      },
    },
    session: {
      provider: "trusted-proxy",
      user: "owner@example.com",
      displayName: "Owner",
      tenantId: "acme",
      role: "operator",
    },
    mode: "login",
    busy: false,
    error: null,
    notice: null,
    email: "owner@example.com",
    password: "",
    displayName: "Owner",
    platformAdminDisplayName: "",
    tenantName: "Acme",
    seatTitle: "Sales Lead",
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
    onModeChange: vi.fn(),
    onEmailChange: vi.fn(),
    onPasswordChange: vi.fn(),
    onDisplayNameChange: vi.fn(),
    onPlatformAdminDisplayNameChange: vi.fn(),
    onTenantNameChange: vi.fn(),
    onSeatTitleChange: vi.fn(),
    onInviteCodeChange: vi.fn(),
    onCurrentPasswordChange: vi.fn(),
    onNewPasswordChange: vi.fn(),
    onPolicyTrialDaysChange: vi.fn(),
    onPolicySeatCountChange: vi.fn(),
    onPolicyUpgradeUrlChange: vi.fn(),
    onPolicyContactAdvisorUrlChange: vi.fn(),
    onInstanceEnterpriseIdChange: vi.fn(),
    onInstanceTrialDaysChange: vi.fn(),
    onInstanceSeatCountChange: vi.fn(),
    onInstanceUpgradeUrlChange: vi.fn(),
    onInstanceContactAdvisorUrlChange: vi.fn(),
    onPlatformAdminEmailChange: vi.fn(),
    onPlatformAdminPasswordChange: vi.fn(),
    onPlatformAdminScopesChange: vi.fn(),
    onSubmit: vi.fn(),
    onCreatePlatformAdmin: vi.fn(),
    onLogout: vi.fn(),
    onCreateInvite: vi.fn(),
    onRevokeInvite: vi.fn(),
    onRemoveMember: vi.fn(),
    onChangePassword: vi.fn(),
    onUpdateTrialPolicy: vi.fn(),
    onUpdateTrialInstance: vi.fn(),
  };
}

function createHandoverEditor(): EnterprisePortRenderModel["handoverEditor"] {
  return {
    caseId: null,
    seatTitle: "",
    seatId: null,
    status: null,
    reviewSummary: "",
    exceptionFlags: "",
    successorEmail: "",
    seatStatus: null,
    defaultAgentIds: [],
    defaultSpaceIds: [],
    selectedAgentIds: [],
    selectedDataKeys: [],
    selectedSpaceIds: [],
    selectedPolicyIds: [],
    currentEmployeeEmail: null,
    currentEmployeeDisplayName: null,
    bindingStatus: null,
    busy: false,
    error: null,
    notice: null,
    draftNotice: null,
    employeePolicies: [],
    seatPolicies: [],
    teamLabel: null,
    assetSnapshot: null,
    assetQuery: "",
    assetKindFilter: "all",
    onOpen: vi.fn(),
    onClose: vi.fn(),
    onReviewSummaryChange: vi.fn(),
    onExceptionFlagsChange: vi.fn(),
    onSuccessorEmailChange: vi.fn(),
    onToggleAgentAsset: vi.fn(),
    onToggleDataAsset: vi.fn(),
    onToggleSpaceAsset: vi.fn(),
    onTogglePolicyAsset: vi.fn(),
    onAssetQueryChange: vi.fn(),
    onAssetKindFilterChange: vi.fn(),
    onSelectAllAssets: vi.fn(),
    onSelectFilteredAssets: vi.fn(),
    onClearSelectedAssets: vi.fn(),
    onSaveDraft: vi.fn(),
    onSubmitNominate: vi.fn(),
    onSubmitReview: vi.fn(),
    onSubmitApproval: vi.fn(),
    onSubmitRebind: vi.fn(),
  };
}

function createAccessControlEditor(): NonNullable<
  EnterprisePortRenderModel["accessControlEditor"]
> {
  return {
    kind: null,
    targetKey: null,
    selectedPermissionIds: [],
    notice: null,
    riskConfirmOpen: false,
    onOpen: vi.fn(),
    onClose: vi.fn(),
    onTogglePermission: vi.fn(),
    onSave: vi.fn(),
    onCancelRisk: vi.fn(),
    onConfirmRisk: vi.fn(),
  };
}

function createSeatOfferEditor(): EnterprisePortRenderModel["seatOfferEditor"] {
  return {
    mode: "offer",
    seatId: null,
    seatTitle: "",
    seatStatus: null,
    defaultAgentId: null,
    availableAgentIds: [],
    defaultSpaceIds: [],
    selectedAgentIds: [],
    selectedSpaceIds: [],
    inheritMode: "full",
    inheritMemoryScope: true,
    memoryScopeAvailable: false,
    employeeEmail: "",
    busy: false,
    error: null,
    notice: null,
    onOpen: vi.fn(),
    onClose: vi.fn(),
    onEmployeeEmailChange: vi.fn(),
    onInheritModeChange: vi.fn(),
    onToggleAgentId: vi.fn(),
    onToggleSpaceId: vi.fn(),
    onInheritMemoryScopeChange: vi.fn(),
    onSubmit: vi.fn(),
  };
}

function createOwnershipTransferEditor(): EnterprisePortRenderModel["ownershipTransferEditor"] {
  return {
    open: false,
    tenantId: null,
    subjectKind: null,
    subjectId: null,
    subjectLabel: "",
    positionId: null,
    positionLabel: "",
    currentManagerUserId: null,
    currentManagerLabel: "",
    selectedUserId: "",
    candidateMembers: [],
    busy: false,
    error: null,
    notice: null,
    onOpen: vi.fn(),
    onClose: vi.fn(),
    onSelectedUserChange: vi.fn(),
    onSubmit: vi.fn(),
  };
}

function createPositionEditor(): NonNullable<EnterprisePortRenderModel["createPositionEditor"]> {
  return {
    open: false,
    seatId: null,
    seatTitle: "",
    teamLabel: "",
    responsibility: "",
    employeeEmail: "",
    defaultAgentId: "",
    agentIds: [],
    agentOptions: ["main", "sales-bot"],
    busy: false,
    error: null,
    notice: null,
    onOpen: vi.fn(),
    onClose: vi.fn(),
    onSeatTitleChange: vi.fn(),
    onTeamLabelChange: vi.fn(),
    onResponsibilityChange: vi.fn(),
    onEmployeeEmailChange: vi.fn(),
    onDefaultAgentIdChange: vi.fn(),
    onToggleAgentId: vi.fn(),
    onSubmit: vi.fn(),
  };
}

describe("enterprise trial restriction surfaces", () => {
  beforeEach(async () => {
    await i18n.setLocale("en");
    window.history.pushState({}, "", "/openclaw");
    resetOrganizationStructureTransientState();
  });

  it("replaces the normal enterprise workspace with a trial-ended restriction surface", () => {
    const container = document.createElement("div");

    render(
      renderEnterpriseSurface({
        tab: "enterpriseOverview",
        basePath: "/openclaw",
        readModel: createReadModel(),
        actions: createActions(),
        authPanelProps: createAuthPanelProps({
          status: "expired",
          seatUsed: 2,
          seatQuota: 5,
        }),
        seatOfferEditor: createSeatOfferEditor(),
        handoverEditor: createHandoverEditor(),
        ownershipTransferEditor: createOwnershipTransferEditor(),
      }),
      container,
    );

    expect(container.textContent).toContain("Trial ended");
    expect(container.textContent).toContain(
      "Core workspace access is paused until this enterprise upgrades or contacts an advisor.",
    );
    expect(container.textContent).not.toContain("Change password");
    expect(container.textContent).not.toContain("Overview");
  });

  it("shows a seat limit warning while keeping the normal enterprise workspace available", () => {
    const container = document.createElement("div");

    render(
      renderEnterpriseSurface({
        tab: "enterpriseOverview",
        basePath: "/openclaw",
        readModel: createReadModel(),
        actions: createActions(),
        authPanelProps: createAuthPanelProps({
          status: "trial",
          seatUsed: 5,
          seatQuota: 5,
        }),
        seatOfferEditor: createSeatOfferEditor(),
        handoverEditor: createHandoverEditor(),
      }),
      container,
    );

    expect(container.textContent).toContain(i18n.t("tabs.enterpriseOverview"));
    expect(container.textContent).toContain("优先处理");
    expect(container.textContent).toContain("试用席位已满");
  });

  it("prompts for enterprise login instead of rendering an empty tenant when no admin session exists", () => {
    const container = document.createElement("div");
    const authPanelProps = createAuthPanelProps({
      status: "trial",
      seatUsed: 1,
      seatQuota: 5,
    });
    authPanelProps.state = {
      ...authPanelProps.state!,
      session: undefined,
      sessionKind: undefined,
      membershipRole: undefined,
      enterprise: undefined,
      members: undefined,
    };
    authPanelProps.session = null;

    render(
      renderEnterpriseSurface({
        tab: "enterpriseOrganization",
        basePath: "/openclaw",
        readModel: createReadModel(),
        actions: createActions(),
        authPanelProps,
        seatOfferEditor: createSeatOfferEditor(),
        handoverEditor: createHandoverEditor(),
      }),
      container,
    );

    expect(container.textContent).toContain("请先登录企业账户");
    expect(container.textContent).toContain("企业管理员会话");
    expect(container.textContent).toContain("企业登录");
    expect(container.textContent).not.toContain("岗位数字人治理队列");
  });

  it("offers one-click enterprise-admin switch when platform session shares the same enterprise admin email", () => {
    const container = document.createElement("div");
    const onSwitchToEnterpriseAdmin = vi.fn();
    const authPanelProps = createAuthPanelProps({
      status: "trial",
      seatUsed: 1,
      seatQuota: 5,
    });
    authPanelProps.state = {
      ...authPanelProps.state!,
      sessionKind: "platform-admin",
      membershipRole: "enterprise-admin",
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
      session: {
        provider: "trusted-proxy",
        user: "owner@example.com",
        tenantId: "acme",
        role: "admin",
        scopes: [],
      },
    };

    render(
      renderEnterpriseSurface({
        tab: "enterpriseOrganization",
        basePath: "/openclaw",
        readModel: createReadModel(),
        actions: {
          ...createActions(),
          organization: {
            ...createActions().organization,
            onSwitchToEnterpriseAdmin,
          },
        },
        authPanelProps,
        seatOfferEditor: createSeatOfferEditor(),
        handoverEditor: createHandoverEditor(),
      }),
      container,
    );

    expect(container.textContent).toContain("需要切换到企业管理员身份");
    expect(container.textContent).toContain("以企业管理员身份继续");
    expect(container.textContent).not.toContain("企业登录");
  });

  it("rejects pure employee sessions without framing return-to-employee as a secondary escape", () => {
    const container = document.createElement("div");
    const onSwitchToEnterpriseAdmin = vi.fn();
    const authPanelProps = createAuthPanelProps({
      status: "trial",
      seatUsed: 1,
      seatQuota: 5,
    });
    authPanelProps.state = {
      ...authPanelProps.state!,
      sessionKind: "member",
      membershipRole: "member",
      enterprise: {
        id: "acme",
        name: "Acme",
        status: "paid",
        plan: "paid",
        billingStatus: "active",
        createdSource: "self-service",
        seatUsed: 1,
        seatQuota: 5,
        seatsRemaining: 4,
      },
      session: {
        provider: "trusted-proxy",
        user: "owner@example.com",
        tenantId: "acme",
        role: "operator",
        scopes: [],
      },
    };

    render(
      renderEnterpriseSurface({
        tab: "enterpriseOrganization",
        basePath: "/openclaw",
        readModel: createReadModel(),
        actions: {
          ...createActions(),
          organization: {
            ...createActions().organization,
            onSwitchToEnterpriseAdmin,
          },
        },
        authPanelProps,
        seatOfferEditor: createSeatOfferEditor(),
        handoverEditor: createHandoverEditor(),
      }),
      container,
    );

    expect(container.textContent).toContain("没有企业管理员资格");
    expect(container.textContent).toContain("请从员工端登录");
    expect(container.textContent).toContain("从员工端登录");
    expect(container.textContent).not.toContain("以企业管理员身份继续");
    expect(container.querySelector('a[href$="/enterprise/login"]')).toBeNull();
    expect(container.textContent).not.toContain("返回员工首页");
  });

  it("renders the overview page as a command center", () => {
    const container = document.createElement("div");

    render(
      renderEnterpriseSurface({
        tab: "enterpriseOverview",
        basePath: "/openclaw",
        readModel: createReadModel(),
        actions: createActions(),
        authPanelProps: createAuthPanelProps({
          status: "trial",
          seatUsed: 1,
          seatQuota: 5,
        }),
        seatOfferEditor: createSeatOfferEditor(),
        handoverEditor: createHandoverEditor(),
      }),
      container,
    );

    expect(container.textContent).toContain(i18n.t("tabs.enterpriseOverview"));
    expect(container.textContent).toContain("优先处理");
    expect(container.textContent).toContain("治理队列");
    expect(container.querySelector("supervisor-node-binding-requests-card")).not.toBeNull();
    expect(container.textContent).toContain("快捷入口");
    expect(container.textContent).toContain("系统状态");
    // 治理概览已并入优先处理的治理队列，不再作为独立区块出现。
    expect(container.textContent).not.toContain("治理概览");
    expect(container.textContent).not.toContain("最近操作");
    expect(container.textContent).not.toContain("运营待办");
    expect(container.textContent).not.toContain("成本快照");

    // 基线迁移（任务 5.2）：KPI 区改用统一 renderEnterpriseKpiGrid（.enterprise-kpi-grid），
    // 旧的 .enterprise-overview-snapshot__* 自造结构已删除。
    expect(container.querySelector(".enterprise-kpi-grid")).not.toBeNull();
    expect(container.querySelector(".enterprise-overview-snapshot__grid")).toBeNull();
    expect(container.querySelector(".enterprise-overview-snapshot__item")).toBeNull();

    // KPI 卡保持 .enterprise-card；card 分区内的优先处理行 / 资产闭环行 / 治理队列行
    // 扁平为行栈（.enterprise-overview-row），不再嵌套 .enterprise-card（卡中卡）。
    expect(
      container.querySelectorAll(".enterprise-kpi-grid .enterprise-card--interactive").length,
    ).toBeGreaterThan(0);
    expect(
      container.querySelectorAll(
        ".enterprise-overview-priority-row.enterprise-overview-row--interactive",
      ).length,
    ).toBeGreaterThan(0);
    expect(
      container.querySelectorAll(
        ".enterprise-overview-asset-row.enterprise-overview-row--interactive",
      ).length,
    ).toBeGreaterThan(0);
    expect(
      container.querySelectorAll(
        ".enterprise-overview-queue-row.enterprise-overview-row--interactive",
      ).length,
    ).toBeGreaterThan(0);
    expect(container.querySelectorAll(".enterprise-overview-section .enterprise-card").length).toBe(
      0,
    );
    expect(container.querySelectorAll(".enterprise-overview-section.card").length).toBe(0);
    expect(
      container.querySelectorAll(".enterprise-overview-section.enterprise-card").length,
    ).toBeGreaterThan(0);

    // 总览 hub 页不重复主导航级长说明；页眉仅保留标题。
    const header = container.querySelector(".enterprise-module-header");
    expect(header).not.toBeNull();
    expect(header?.querySelector(".enterprise-page__subtitle")).toBeNull();
    expect(header?.querySelector("button")).toBeNull();
  });

  it("keeps each overview fact in exactly one layer (no duplicated status badges)", () => {
    const container = document.createElement("div");

    render(
      renderEnterpriseSurface({
        tab: "enterpriseOverview",
        basePath: "/openclaw",
        readModel: createReadModel(),
        actions: createActions(),
        authPanelProps: createAuthPanelProps({
          status: "trial",
          seatUsed: 1,
          seatQuota: 5,
        }),
        seatOfferEditor: createSeatOfferEditor(),
        handoverEditor: createHandoverEditor(),
      }),
      container,
    );

    const text = container.textContent ?? "";
    // 「Runtime」同名不同源矛盾已修复：侧栏只保留以 presenceCount 计数的「运行节点」。
    expect(text).not.toContain("Runtime");
    expect(text).toContain("运行节点");
    // 顶部状态条徽章已删除：企业数据 / 模型配置 只在侧栏「系统状态」出现一次。
    expect(text.match(/企业数据/g) ?? []).toHaveLength(1);
    expect(text.match(/模型配置/g) ?? []).toHaveLength(1);
    // 头部不再有跳转到首屏区块的冗余主按钮。
    expect(text).not.toContain("进入优先处理");
    expect(text).not.toContain("立即处理");
    expect(text).not.toContain("进入组织处理");
    expect(text).not.toContain("另有");
    expect(text).toContain("条成本未归因");
    expect(text).not.toContain("归因缺失");
  });

  it("does not mount the operational identity governance panel on the overview page", () => {
    const container = document.createElement("div");

    render(
      renderEnterpriseSurface({
        tab: "enterpriseOverview",
        basePath: "/openclaw",
        readModel: createReadModel(),
        operationalIdentityGovernancePanel: {
          overview: {
            scope: { kind: "tenant", tenantId: "acme" },
            totals: { identities: 4, active: 3, expired: 0, reauthRequired: 1, revoked: 0 },
            activeGrants: 6,
            pendingBindingRequests: 2,
            recentUsage: [],
            recentDenials: [],
            recentLifecycle: [],
          },
          loading: false,
          error: null,
        },
        actions: createActions(),
        authPanelProps: createAuthPanelProps({
          status: "trial",
          seatUsed: 1,
          seatQuota: 5,
        }),
        seatOfferEditor: createSeatOfferEditor(),
        handoverEditor: createHandoverEditor(),
      }),
      container,
    );

    expect(container.textContent ?? "").toContain("运营身份监管");
    expect(container.querySelector('[aria-label="运营身份监管"]')).toBeNull();
  });

  it("mounts the operational identity governance panel in settings security section", () => {
    window.history.pushState({}, "", "/enterprise/acme/settings/security");
    const container = document.createElement("div");

    render(
      renderEnterpriseSurface({
        tab: "enterpriseSettings",
        basePath: "",
        readModel: createReadModel(),
        operationalIdentityGovernancePanel: {
          overview: {
            scope: { kind: "tenant", tenantId: "acme" },
            totals: { identities: 4, active: 3, expired: 0, reauthRequired: 1, revoked: 0 },
            activeGrants: 6,
            pendingBindingRequests: 2,
            recentUsage: [],
            recentDenials: [],
            recentLifecycle: [],
          },
          loading: false,
          error: null,
        },
        actions: createActions(),
        authPanelProps: createAuthPanelProps({
          status: "trial",
          seatUsed: 1,
          seatQuota: 5,
        }),
        accessControlEditor: createAccessControlEditor(),
        seatOfferEditor: createSeatOfferEditor(),
        handoverEditor: createHandoverEditor(),
      }),
      container,
    );

    const text = container.textContent ?? "";
    expect(text).toContain("运营身份监管");
    expect(text).toContain("本企业");
    expect(text).toContain("待绑定请求");
    expect(text).not.toContain("平台（全部租户）");
  });

  it("renders the data capability center as a top-level enterprise surface", () => {
    const container = document.createElement("div");
    const actions = createActions();

    render(
      renderEnterpriseSurface({
        tab: "enterpriseDataGovernanceCenter",
        basePath: "/openclaw",
        readModel: createReadModel(),
        actions,
        authPanelProps: createAuthPanelProps({
          status: "trial",
          seatUsed: 1,
          seatQuota: 5,
        }),
        seatOfferEditor: createSeatOfferEditor(),
        handoverEditor: createHandoverEditor(),
      }),
      container,
    );

    // 重命名后的模块名 + 总览 KPI / 面板（数据源、数据产品、审批中心）。
    expect(container.textContent).toContain("Enterprise Data Capability Center");
    expect(container.textContent).toContain("数据源");
    expect(container.textContent).toContain("数据产品");
    expect(container.textContent).toContain("待审批中心");
    expect(container.textContent).toContain("数据源健康状态");
    // 旧运营身份概览已被整屏替换。
    expect(container.textContent).not.toContain("治理关系概览");

    const refreshButton = Array.from(container.querySelectorAll("button")).find((entry) =>
      /Refresh|刷新/u.test(entry.textContent ?? ""),
    );
    // 刷新入口若出现，应走 surface-local 重载，不再依赖全局 action；点击不应抛错。
    if (refreshButton) {
      expect(() =>
        refreshButton.dispatchEvent(new MouseEvent("click", { bubbles: true })),
      ).not.toThrow();
    }
  });

  it("renders organization action buttons for offboard and handover flow", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const readModel = {
      ...createReadModel(),
      seatSummaries: [
        {
          seatId: "seat-1",
          title: "Sales Lead",
          teamLabel: "销售一组",
          status: "occupied" as const,
          currentEmployeeUser: "member@example.com",
          currentEmployeeLabel: "Member",
          roleCode: "SALES-L2-001",
          defaultAgentId: "main",
          agentIds: ["main"],
          defaultSpaceIds: ["space-sales"],
          memoryScopeIds: ["seat:seat-1"],
          responsibility: "Own regional sales outcomes.",
        },
        {
          seatId: "seat-2",
          title: "Vacant Sales",
          teamLabel: "销售团队",
          status: "vacant" as const,
          currentEmployeeUser: null,
          currentEmployeeLabel: null,
          roleCode: "SALES-L2-002",
          defaultAgentId: "agent-sales",
          agentIds: ["agent-sales"],
          defaultSpaceIds: ["space-sales"],
          memoryScopeIds: ["seat:seat-2"],
          responsibility: null,
        },
        {
          seatId: "seat-3",
          title: "Ops Lead",
          teamLabel: "运营团队",
          status: "occupied" as const,
          currentEmployeeUser: "owner@example.com",
          currentEmployeeLabel: "Owner",
          roleCode: "OPS-L2-001",
          defaultAgentId: "main",
          agentIds: ["main"],
          defaultSpaceIds: ["space-ops"],
          memoryScopeIds: ["seat:seat-3"],
          responsibility: null,
        },
      ],
      handoverSummaries: [
        {
          handoverCaseId: "handover-review",
          seatTitle: "Sales Lead",
          status: "asset_review" as const,
          outgoingEmployeeUser: "member@example.com",
          incomingEmployeeUser: null,
          createdAt: "2026-05-05T03:20:00.000Z",
          completedAt: null,
        },
        {
          handoverCaseId: "handover-approve",
          seatTitle: "Support Backup",
          status: "pending_approval" as const,
          outgoingEmployeeUser: "member@example.com",
          incomingEmployeeUser: null,
          createdAt: "2026-05-04T08:20:00.000Z",
          completedAt: null,
        },
        {
          handoverCaseId: "handover-rebind",
          seatTitle: "Ops Coordinator",
          status: "frozen" as const,
          outgoingEmployeeUser: "member@example.com",
          incomingEmployeeUser: null,
          createdAt: "2026-05-03T01:20:00.000Z",
          completedAt: null,
        },
      ],
      offerSummaries: [
        {
          assignmentId: "assign-offer-1",
          assignmentType: "internal",
          offerId: "offer-1",
          seatId: "seat-2",
          seatTitle: "Vacant Sales",
          targetEmployeeUser: "successor@example.com",
          status: "pending",
          defaultAgentId: "agent-sales",
          agentIds: ["agent-sales"],
          defaultSpaceIds: ["space-sales"],
          offeredAt: "2026-05-05T02:30:00.000Z",
          expiresAt: null,
        },
      ],
      handoverCaseCount: 3,
      handoverSeatCount: 1,
      frozenSeatCount: 1,
      pendingOfferCount: 1,
      seatCount: 3,
      occupiedSeatCount: 2,
      vacantSeatCount: 1,
    } satisfies EnterprisePortReadModel;
    const actions = createActions();
    const handoverEditor = createHandoverEditor();
    const seatOfferEditor = createSeatOfferEditor();
    const container = document.createElement("div");

    render(
      renderEnterpriseSurface({
        tab: "enterpriseOrganization",
        basePath: "/openclaw",
        readModel,
        actions,
        authPanelProps: createAuthPanelProps({
          status: "trial",
          seatUsed: 1,
          seatQuota: 5,
        }),
        seatOfferEditor,
        handoverEditor,
      }),
      container,
    );

    const clickByAriaLabel = (label: string, selector = "button") => {
      const button = container.querySelector<HTMLElement>(`${selector}[aria-label="${label}"]`);
      expect(button).toBeTruthy();
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    };

    expect(container.textContent).toContain(i18n.t("tabs.enterpriseOrganization"));
    expect(container.querySelector(".enterprise-module-header")).not.toBeNull();
    expect(container.querySelector(".enterprise-page__subtitle")).toBeNull();
    expect(container.querySelectorAll(".enterprise-org-table-card.card").length).toBe(0);
    expect(container.querySelectorAll(".enterprise-org-table-card").length).toBeGreaterThan(0);
    expect(container.querySelector(".enterprise-org-surface-bar")).not.toBeNull();
    expect(
      container.querySelector(
        ".enterprise-org-surface-bar .enterprise-org-workforce-header__toolbar",
      ),
    ).not.toBeNull();
    expect(
      container.querySelector(".enterprise-org-surface-bar .enterprise-segmented-nav"),
    ).toBeNull();
    expect(container.textContent).not.toContain("组织治理");
    expect(container.textContent).not.toContain("运营概览");
    expect(container.textContent).not.toContain("查看更多");
    expect(container.textContent).not.toContain("优先治理");
    expect(container.textContent).not.toContain("组织快照");
    expect(
      container.querySelectorAll(".enterprise-org-overview .enterprise-kpi-card--compact").length,
    ).toBe(6);
    expect(
      container.querySelectorAll(".enterprise-org-overview a.enterprise-kpi-card").length,
    ).toBe(6);
    expect(container.textContent).not.toContain("数字人总数");
    expect(container.textContent).not.toContain("归因缺失");
    expect(container.textContent).not.toContain("Runtime 异常");
    expect(container.textContent).not.toContain("本月消耗（Token）");
    expect(container.textContent).not.toContain("Workforce Structure");
    expect(container.textContent).not.toContain("创建岗位数字人");
    expect(container.textContent).not.toContain("组织架构");
    expect(container.querySelector(".enterprise-org-layout__rail .enterprise-org-tree")).toBeNull();
    expect(container.textContent).toContain("待激活");
    expect(container.textContent).toContain("全部团队");
    expect(container.textContent).not.toContain("全部岗位");
    expect(container.textContent).not.toContain("全部状态");
    expect(container.textContent).not.toContain("已归档");
    expect(container.textContent).toContain("待确认任命");
    expect(container.textContent).not.toContain("最近岗位任命");
    expect(container.textContent).not.toContain("assign-offer-1");
    expect(container.textContent).toContain("岗位数字人治理队列");
    expect(container.textContent).not.toContain("Workforce Structure · 协作组视图");
    expect(container.textContent).toContain("搭建组织");
    expect(container.textContent).toContain("邀请激活");
    // 工具栏不再提供隐式目标的「发起交接」；交接仅保留在行级/详情（有明确目标）。
    const workforceToolbar = container.querySelector(
      ".enterprise-org-surface-bar .enterprise-org-workforce-header__toolbar",
    );
    expect(workforceToolbar).not.toBeNull();
    expect(workforceToolbar?.textContent ?? "").not.toContain("发起交接");
    // 治理队列表头语义与单元格对齐，且无死的筛选/导出按钮。
    expect(container.textContent).toContain("办理状态");
    expect(container.textContent).toContain("最近活动");
    expect(container.textContent).toContain("岗位数字人随岗位自动生成，不能单独新建。");
    const tableToolbarButtons = Array.from(
      container.querySelectorAll(".enterprise-org-table-card__toolbar button"),
    ).map((entry) => entry.textContent?.trim());
    expect(tableToolbarButtons).not.toContain("筛选");
    expect(tableToolbarButtons).not.toContain("导出");
    expect(container.textContent).toContain("共 3 条");
    expect(container.textContent).toContain("第 1 / 1 页");
    expect(container.textContent).toContain("前往");
    expect(container.textContent).toContain("10 条/页");
    expect(container.textContent).not.toContain("Change password");

    clickByAriaLabel("交接");
    clickByAriaLabel("继续审查");
    clickByAriaLabel("查看确认");
    clickByAriaLabel("提醒");
    expect(actions.organization.onStartSeatHandover).toHaveBeenCalledWith("acme", "seat-3");
    expect(seatOfferEditor.onOpen).toHaveBeenCalledWith({
      seatId: "seat-2",
      seatTitle: "Vacant Sales",
      seatStatus: "vacant",
      defaultAgentId: "agent-sales",
      availableAgentIds: ["agent-sales"],
      defaultSpaceIds: ["space-sales"],
      memoryScopeAvailable: true,
      employeeEmail: "successor@example.com",
    });
    expect(actions.organization.onRemindSeatOffer).toHaveBeenCalledWith(
      "acme",
      "offer-1",
      "successor@example.com",
    );
    expect(handoverEditor.onOpen).toHaveBeenCalledWith({
      handoverCaseId: "handover-review",
      seatTitle: "Sales Lead",
      status: "asset_review",
      incomingEmployeeUser: null,
    });
    expect(confirmSpy).toHaveBeenCalled();
    expect(container.textContent).toContain("状态");
    expect(container.textContent).not.toContain("最近活跃");
    expect(container.textContent).toContain("资产审查中");
    expect(container.textContent).toContain("等待成员确认");
    expect(container.textContent).toContain("交接中");
    expect(container.textContent).toContain("待确认");

    window.history.pushState({}, "", "/openclaw?organizationView=member");
    const memberContainer = document.createElement("div");
    render(
      renderEnterpriseSurface({
        tab: "enterpriseOrganization",
        basePath: "/openclaw",
        readModel,
        actions,
        authPanelProps: createAuthPanelProps({
          status: "trial",
          seatUsed: 1,
          seatQuota: 5,
        }),
        seatOfferEditor,
        handoverEditor,
      }),
      memberContainer,
    );

    expect(memberContainer.textContent).toContain("成员视图");
    expect(memberContainer.textContent).not.toContain("Workforce Structure");
    expect(
      memberContainer.querySelector(
        ".enterprise-org-table-card__header--toolbar .enterprise-org-table-card__filters",
      ),
    ).not.toBeNull();
    expect(memberContainer.textContent).not.toContain("岗位数字人治理队列");
  });

  it("renders nested organization departments in the directory tree", () => {
    window.history.pushState({}, "", "/openclaw?organizationSurface=structure");
    const container = document.createElement("div");
    const readModel = {
      ...createReadModel(),
      seatSummaries: [
        {
          seatId: "seat-east",
          title: "华东销售",
          teamLabel: "销售部/华东区",
          status: "occupied" as const,
          currentEmployeeUser: "owner@example.com",
          currentEmployeeLabel: "Owner",
          roleCode: "SALES-EAST",
          defaultAgentId: "main",
          agentIds: ["main"],
          defaultSpaceIds: ["space-sales"],
          memoryScopeIds: ["seat:seat-east"],
          responsibility: null,
        },
      ],
    } satisfies EnterprisePortReadModel;

    render(
      renderEnterpriseSurface({
        tab: "enterpriseOrganization",
        basePath: "/openclaw",
        readModel,
        actions: createActions(),
        authPanelProps: createAuthPanelProps({
          status: "trial",
          seatUsed: 1,
          seatQuota: 5,
        }),
        seatOfferEditor: createSeatOfferEditor(),
        handoverEditor: createHandoverEditor(),
      }),
      container,
    );

    const nestedTeam = container.querySelector(
      '.enterprise-org-tree__team[data-org-team-path="销售部/华东区"]',
    );
    expect(nestedTeam).not.toBeNull();
    expect(container.textContent).toContain("华东区");
    expect(container.textContent).toContain("华东销售");
  });

  it("builds the organization manually from the empty state", () => {
    window.history.pushState({}, "", "/openclaw");
    const container = document.createElement("div");
    const actions = createActions();
    const emptyReadModel = {
      ...createReadModel(),
      seatCount: 0,
      seatSummaries: [],
      organizationDepartmentPaths: [],
    } satisfies EnterprisePortReadModel;
    const renderSurface = () =>
      render(
        renderEnterpriseSurface({
          tab: "enterpriseOrganization",
          basePath: "/openclaw",
          readModel: emptyReadModel,
          actions,
          authPanelProps: createAuthPanelProps({ status: "trial", seatUsed: 0, seatQuota: 5 }),
          createPositionEditor: createPositionEditor(),
          seatOfferEditor: createSeatOfferEditor(),
          handoverEditor: createHandoverEditor(),
        }),
        container,
      );

    renderSurface();
    expect(container.textContent).toContain("还没有组织名录");

    const manualCta = Array.from(container.querySelectorAll("button")).find(
      (entry) => entry.textContent?.trim() === "手工搭建",
    );
    expect(manualCta).toBeTruthy();
    manualCta?.click();
    renderSurface();
    expect(container.querySelector(".enterprise-org-layout--structure")).not.toBeNull();
    expect(container.querySelector(".enterprise-org-layout__workspace")).not.toBeNull();
    // 空租户结构页保留首跑入口（手工搭建 / 从 Excel 导入），而不是只剩闲置文案。
    expect(container.textContent).toContain("还没有组织名录");
    expect(container.querySelector(".enterprise-org-build")).toBeNull();
    // 手工搭建不打开导入面板。
    expect(container.querySelector("[data-org-builder-root]")).toBeNull();

    // 结构页内再点手工搭建 → 直接打开新建部门编辑器（不再自循环回目录）。
    const workspaceManualCta = Array.from(container.querySelectorAll("button")).find(
      (entry) => entry.textContent?.trim() === "手工搭建",
    );
    expect(workspaceManualCta).toBeTruthy();
    workspaceManualCta?.click();
    renderSurface();
    expect(container.textContent).toContain("新建部门");
  });

  it("opens the Excel import workspace from the empty state", () => {
    window.history.pushState({}, "", "/openclaw");
    const container = document.createElement("div");
    const actions = createActions();
    const emptyReadModel = {
      ...createReadModel(),
      seatCount: 0,
      seatSummaries: [],
      organizationDepartmentPaths: [],
    } satisfies EnterprisePortReadModel;
    const renderSurface = () =>
      render(
        renderEnterpriseSurface({
          tab: "enterpriseOrganization",
          basePath: "/openclaw",
          readModel: emptyReadModel,
          actions,
          authPanelProps: createAuthPanelProps({ status: "trial", seatUsed: 0, seatQuota: 5 }),
          createPositionEditor: createPositionEditor(),
          seatOfferEditor: createSeatOfferEditor(),
          handoverEditor: createHandoverEditor(),
        }),
        container,
      );

    renderSurface();
    expect(container.textContent).toContain("还没有组织名录");

    const importCta = Array.from(container.querySelectorAll("button")).find(
      (entry) => entry.textContent?.trim() === "从 Excel 导入",
    );
    expect(importCta).toBeTruthy();
    importCta?.click();
    renderSurface();
    expect(window.location.search).toContain("organizationSurface=structure");
    expect(container.querySelector(".enterprise-org-layout--structure")).not.toBeNull();
    expect(container.querySelector("[data-org-builder-root]")).not.toBeNull();
    expect(container.textContent).toContain("下载模版");
  });

  it("supports inline create on the structure page directory tree", async () => {
    window.history.pushState({}, "", "/openclaw?organizationSurface=structure");
    const container = document.createElement("div");
    const actions = createActions();
    const createPosition = createPositionEditor();
    const seatOfferEditor = createSeatOfferEditor();
    let readModel = {
      ...createReadModel(),
      seatSummaries: [
        {
          seatId: "seat-vacant",
          title: "销售助理",
          teamLabel: "销售部",
          status: "vacant" as const,
          currentEmployeeUser: null,
          currentEmployeeLabel: null,
          roleCode: null,
          defaultAgentId: null,
          agentIds: [],
          defaultSpaceIds: [],
          memoryScopeIds: [],
          responsibility: null,
        },
      ],
    } satisfies EnterprisePortReadModel;

    const renderSurface = () =>
      render(
        renderEnterpriseSurface({
          tab: "enterpriseOrganization",
          basePath: "/openclaw",
          readModel,
          actions,
          authPanelProps: createAuthPanelProps({ status: "trial", seatUsed: 1, seatQuota: 5 }),
          createPositionEditor: createPosition,
          seatOfferEditor,
          handoverEditor: createHandoverEditor(),
        }),
        container,
      );

    renderSurface();

    expect(
      container.querySelector(".enterprise-org-layout__rail .enterprise-org-tree"),
    ).not.toBeNull();
    expect(container.querySelector(".enterprise-org-build")).toBeNull();
    expect(container.querySelector(".enterprise-org-layout__workspace")).not.toBeNull();
    expect(container.textContent).toContain("点击左侧部门或岗位查看详情");
    expect(container.textContent).not.toContain("岗位数字人治理队列");
    expect(container.textContent).not.toContain("搭建策略");
    expect(container.textContent).not.toContain("逐级搭建");
    // Directory tree hint is scope-only when a department filter is active; no drag/batch copy.

    const menuButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".enterprise-org-tree__menu-panel button"),
    ).map((entry) => entry.textContent?.trim());
    expect(menuButtons).not.toContain("移动");
    expect(menuButtons).not.toContain("合并到…");

    const importButton = Array.from(container.querySelectorAll("button")).find((entry) =>
      entry.textContent?.includes("从 Excel 导入"),
    );
    expect(importButton).toBeTruthy();
    importButton?.click();
    renderSurface();
    expect(container.querySelector("[data-org-builder-root]")).not.toBeNull();
    expect(container.textContent).toContain("下载模版");
    expect(container.textContent).toContain("上传模版");

    const closeImport = Array.from(container.querySelectorAll("button")).find(
      (entry) => entry.textContent?.trim() === "关闭",
    );
    closeImport?.click();
    renderSurface();

    const newSubDept = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".enterprise-org-tree__menu-panel button"),
    ).find((entry) => entry.textContent?.trim() === "新建子部门");
    expect(newSubDept).toBeTruthy();
    newSubDept?.click();
    await Promise.resolve();
    readModel = {
      ...readModel,
      organizationDepartmentPaths: ["销售部/新部门", "销售部"],
    };
    renderSurface();
    expect(actions.organization.onMutateOrganizationDepartment).toHaveBeenCalledWith(
      "acme",
      expect.objectContaining({ action: "create", label: "新部门", parentPath: "销售部" }),
    );
    expect(container.querySelector(".enterprise-org-tree__inline-input")).not.toBeNull();

    const newPosition = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".enterprise-org-tree__menu-panel button"),
    ).find((entry) => entry.textContent?.trim() === "新建岗位");
    expect(newPosition).toBeTruthy();
    newPosition?.click();
    renderSurface();
    expect(createPosition.onOpen).toHaveBeenCalledWith(
      expect.objectContaining({ teamLabel: "销售部", seatTitle: "新岗位" }),
    );

    const bindMember = container.querySelector<HTMLButtonElement>(
      ".enterprise-org-tree__bind-member",
    );
    expect(bindMember?.textContent?.trim()).toBe("邀请入职");
    bindMember?.click();
    seatOfferEditor.seatId = "seat-vacant";
    seatOfferEditor.seatTitle = "销售助理";
    seatOfferEditor.seatStatus = "vacant";
    seatOfferEditor.mode = "activation";
    renderSurface();
    // 操作区激活时左侧组织树保持可见（仅手动折叠），通过 is-workspace-active 让出空间。
    expect(
      container.querySelector(".enterprise-org-layout--structure.is-workspace-active"),
    ).not.toBeNull();
    expect(
      container.querySelector(".enterprise-org-layout--structure.is-rail-collapsed"),
    ).toBeNull();
    expect(
      container.querySelector(".enterprise-org-layout__rail .enterprise-org-tree"),
    ).not.toBeNull();
    expect(window.location.search).toContain("organizationSeat=seat-vacant");
    expect(seatOfferEditor.onOpen).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "activation",
        seatId: "seat-vacant",
        seatTitle: "销售助理",
        seatStatus: "vacant",
      }),
    );
  });

  it("renders the structure workspace instead of the legacy builder panel", async () => {
    window.history.pushState(
      {},
      "",
      `/openclaw?organizationSurface=structure&organizationTeam=${encodeURIComponent("销售部")}`,
    );
    const container = document.createElement("div");
    const actions = createActions();
    const createPosition = createPositionEditor();
    const readModel = {
      ...createReadModel(),
      organizationDepartmentPaths: ["销售部"],
      seatSummaries: [
        {
          seatId: "seat-1",
          title: "销售经理",
          teamLabel: "销售部",
          status: "occupied" as const,
          currentEmployeeUser: "owner@example.com",
          currentEmployeeLabel: "Owner",
          roleCode: null,
          defaultAgentId: null,
          agentIds: [],
          defaultSpaceIds: [],
          memoryScopeIds: [],
          responsibility: null,
        },
      ],
    } satisfies EnterprisePortReadModel;
    const renderSurface = () =>
      render(
        renderEnterpriseSurface({
          tab: "enterpriseOrganization",
          basePath: "/openclaw",
          readModel,
          actions,
          authPanelProps: createAuthPanelProps({ status: "trial", seatUsed: 1, seatQuota: 5 }),
          createPositionEditor: createPosition,
          seatOfferEditor: createSeatOfferEditor(),
          handoverEditor: createHandoverEditor(),
        }),
        container,
      );

    renderSurface();
    expect(container.querySelector(".enterprise-org-context")).toBeNull();
    expect(container.querySelector(".enterprise-org-workspace")).not.toBeNull();
    expect(
      container.querySelector(
        ".enterprise-org-structure-inspector, .enterprise-org-position-detail",
      ),
    ).not.toBeNull();
    expect(container.textContent).toContain("部门岗位");
    expect(container.querySelector(".model-assets-drawer-overlay")).toBeNull();

    const newPosition = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".enterprise-org-tree__menu-panel button"),
    ).find((entry) => entry.textContent?.trim() === "新建岗位");
    expect(newPosition).toBeTruthy();
    newPosition?.click();
    renderSurface();
    expect(createPosition.onOpen).toHaveBeenCalledWith(
      expect.objectContaining({ teamLabel: "销售部", seatTitle: "新岗位" }),
    );
  });

  it("edits a position inline from the structure inspector without leaving the page", async () => {
    window.history.pushState(
      {},
      "",
      `/openclaw?organizationSurface=structure&organizationTeam=${encodeURIComponent("销售部")}&organizationSeat=seat-1`,
    );
    const container = document.createElement("div");
    const actions = createActions();
    const createPosition = createPositionEditor();
    const readModel = {
      ...createReadModel(),
      organizationDepartmentPaths: ["销售部"],
      seatSummaries: [
        {
          seatId: "seat-1",
          title: "销售经理",
          teamLabel: "销售部",
          status: "occupied" as const,
          currentEmployeeUser: "owner@example.com",
          currentEmployeeLabel: "Owner",
          roleCode: null,
          defaultAgentId: null,
          agentIds: [],
          defaultSpaceIds: [],
          memoryScopeIds: [],
          responsibility: "负责销售线索",
        },
      ],
    } satisfies EnterprisePortReadModel;
    const renderSurface = () =>
      render(
        renderEnterpriseSurface({
          tab: "enterpriseOrganization",
          basePath: "/openclaw",
          readModel,
          actions,
          authPanelProps: createAuthPanelProps({ status: "trial", seatUsed: 1, seatQuota: 5 }),
          createPositionEditor: createPosition,
          seatOfferEditor: createSeatOfferEditor(),
          handoverEditor: createHandoverEditor(),
        }),
        container,
      );

    renderSurface();
    // 选中岗位 → 操作区显示岗位检视面板（非整页 drawer）。
    expect(container.querySelector(".enterprise-org-position-detail")).not.toBeNull();
    expect(container.querySelector(".model-assets-drawer-overlay")).toBeNull();

    const editPosition = container.querySelector<HTMLButtonElement>(
      '[data-archive-meta="edit-position"]',
    );
    expect(editPosition).toBeTruthy();
    expect(editPosition?.textContent?.trim()).toBe("编辑");
    editPosition?.click();
    renderSurface();

    // 编辑动作在操作区内就地打开，且未离开 structure 视图、未弹出整页模态。
    expect(createPosition.onOpen).toHaveBeenCalledWith(
      expect.objectContaining({ seatId: "seat-1", seatTitle: "销售经理", teamLabel: "销售部" }),
    );
    expect(window.location.search).toContain("organizationSurface=structure");
    expect(container.querySelector(".enterprise-org-modal-overlay")).toBeNull();
    expect(
      container.querySelector(".enterprise-org-layout__rail .enterprise-org-tree"),
    ).not.toBeNull();
  });

  it("navigates to a child department from the inspector and opens move/merge from the footer", () => {
    window.history.pushState(
      {},
      "",
      `/openclaw?organizationSurface=structure&organizationTeam=${encodeURIComponent("销售部")}`,
    );
    const container = document.createElement("div");
    const actions = createActions();
    const readModel = {
      ...createReadModel(),
      organizationDepartmentPaths: ["销售部", "销售部/华东区"],
      seatSummaries: [
        {
          seatId: "seat-1",
          title: "销售经理",
          teamLabel: "销售部",
          status: "occupied" as const,
          currentEmployeeUser: "owner@example.com",
          currentEmployeeLabel: "Owner",
          roleCode: null,
          defaultAgentId: null,
          agentIds: [],
          defaultSpaceIds: [],
          memoryScopeIds: [],
          responsibility: null,
        },
      ],
    } satisfies EnterprisePortReadModel;
    const renderSurface = () =>
      render(
        renderEnterpriseSurface({
          tab: "enterpriseOrganization",
          basePath: "/openclaw",
          readModel,
          actions,
          authPanelProps: createAuthPanelProps({ status: "trial", seatUsed: 1, seatQuota: 5 }),
          createPositionEditor: createPositionEditor(),
          seatOfferEditor: createSeatOfferEditor(),
          handoverEditor: createHandoverEditor(),
        }),
        container,
      );

    renderSurface();
    const inspector = container.querySelector(".enterprise-org-structure-inspector");
    expect(inspector).not.toBeNull();

    // 子部门 chip 是可导航按钮：点击后检视面板切到子部门。
    const childButton = container.querySelector<HTMLButtonElement>(
      "[data-inspector-child-department]",
    );
    expect(childButton).not.toBeNull();
    expect(childButton?.textContent).toContain("华东区");
    childButton?.click();
    renderSurface();
    expect(new URLSearchParams(window.location.search).get("organizationTeam")).toBe(
      "销售部/华东区",
    );
    expect(container.querySelector(".enterprise-org-structure-inspector")?.textContent).toContain(
      "销售部/华东区",
    );

    // 检视面板底部提供 移动/合并 入口，复用部门编辑器。
    const footerButton = (label: string) =>
      Array.from(
        container.querySelectorAll<HTMLButtonElement>(".enterprise-org-structure-inspector button"),
      ).find((entry) => entry.textContent?.trim() === label);
    const moveButton = footerButton("移动");
    expect(moveButton).toBeTruthy();
    moveButton?.click();
    renderSurface();
    expect(container.textContent).toContain("移动部门");

    // 关闭部门编辑器 → 回到同一个部门检视面板，而不是闲置态。
    const editorClose = container.querySelector<HTMLButtonElement>(
      ".enterprise-org-department-editor .enterprise-org-ws__header button",
    );
    expect(editorClose).toBeTruthy();
    editorClose?.click();
    renderSurface();
    expect(container.querySelector(".enterprise-org-structure-inspector")).not.toBeNull();
    expect(new URLSearchParams(window.location.search).get("organizationTeam")).toBe(
      "销售部/华东区",
    );

    const mergeButton = footerButton("合并");
    expect(mergeButton).toBeTruthy();
    mergeButton?.click();
    renderSurface();
    expect(container.textContent).toContain("合并部门");
  });

  it("keeps the seat detail visible after closing bind/edit editors and renders them without modal chrome", () => {
    window.history.pushState(
      {},
      "",
      `/openclaw?organizationSurface=structure&organizationTeam=${encodeURIComponent("销售部")}&organizationSeat=seat-1`,
    );
    const container = document.createElement("div");
    const actions = createActions();
    const readModel = {
      ...createReadModel(),
      organizationDepartmentPaths: ["销售部"],
      seatSummaries: [
        {
          seatId: "seat-1",
          title: "销售经理",
          teamLabel: "销售部",
          status: "occupied" as const,
          currentEmployeeUser: "owner@example.com",
          currentEmployeeLabel: "Owner",
          roleCode: null,
          defaultAgentId: null,
          agentIds: [],
          defaultSpaceIds: [],
          memoryScopeIds: [],
          responsibility: null,
        },
      ],
    } satisfies EnterprisePortReadModel;
    const seatOffer = createSeatOfferEditor();
    const createPosition = createPositionEditor();
    const renderSurface = () =>
      render(
        renderEnterpriseSurface({
          tab: "enterpriseOrganization",
          basePath: "/openclaw",
          readModel,
          actions,
          authPanelProps: createAuthPanelProps({ status: "trial", seatUsed: 1, seatQuota: 5 }),
          createPositionEditor: createPosition,
          seatOfferEditor: seatOffer,
          handoverEditor: createHandoverEditor(),
        }),
        container,
      );

    // 绑定编辑器打开：工作区呈现，无模态壳。
    seatOffer.seatId = "seat-1";
    seatOffer.seatTitle = "销售经理";
    renderSurface();
    expect(container.querySelector(".enterprise-org-modal-overlay")).toBeNull();
    expect(container.querySelector(".enterprise-org-modal__header")).toBeNull();
    expect(container.querySelector(".enterprise-org-ws__header")).not.toBeNull();

    // 关闭绑定编辑器（app 层只重置编辑器态，不清 URL）→ 回到岗位详情，而不是闲置态。
    seatOffer.seatId = null;
    seatOffer.seatTitle = "";
    renderSurface();
    expect(container.querySelector(".enterprise-org-position-detail")).not.toBeNull();
    expect(new URLSearchParams(window.location.search).get("organizationSeat")).toBe("seat-1");

    // 编辑岗位编辑器同理。
    createPosition.open = true;
    createPosition.seatId = "seat-1";
    createPosition.seatTitle = "销售经理";
    createPosition.teamLabel = "销售部";
    renderSurface();
    expect(container.querySelector(".enterprise-org-modal-overlay")).toBeNull();
    expect(container.querySelector(".enterprise-org-modal__header")).toBeNull();
    expect(container.querySelector(".enterprise-org-ws__header")).not.toBeNull();

    createPosition.open = false;
    createPosition.seatId = null;
    renderSurface();
    expect(container.querySelector(".enterprise-org-position-detail")).not.toBeNull();
    expect(new URLSearchParams(window.location.search).get("organizationSeat")).toBe("seat-1");

    // 邀请激活工作区同样只有 orgWs 头部，没有模态壳。
    window.history.pushState(
      {},
      "",
      `/openclaw?organizationSurface=structure&organizationTeam=${encodeURIComponent("销售部")}&organizationSeat=seat-1&organizationInvite=1`,
    );
    renderSurface();
    expect(container.textContent).toContain("批量查看待激活成员");
    expect(container.querySelector(".enterprise-org-modal-overlay")).toBeNull();
    expect(container.querySelector(".enterprise-org-modal__header")).toBeNull();
    expect(container.querySelector(".enterprise-org-ws__header")).not.toBeNull();
  });

  it("closes the import workspace and lands on activation with a success notice after import", async () => {
    window.history.pushState({}, "", "/openclaw?organizationSurface=structure");
    const container = document.createElement("div");
    const actions = createActions();
    const emptyReadModel = {
      ...createReadModel(),
      seatCount: 0,
      seatSummaries: [],
      organizationDepartmentPaths: [],
    } satisfies EnterprisePortReadModel;
    const renderSurface = () =>
      render(
        renderEnterpriseSurface({
          tab: "enterpriseOrganization",
          basePath: "/openclaw",
          readModel: emptyReadModel,
          actions,
          authPanelProps: createAuthPanelProps({ status: "trial", seatUsed: 0, seatQuota: 5 }),
          createPositionEditor: createPositionEditor(),
          seatOfferEditor: createSeatOfferEditor(),
          handoverEditor: createHandoverEditor(),
        }),
        container,
      );

    renderSurface();
    const importCta = Array.from(container.querySelectorAll("button")).find(
      (entry) => entry.textContent?.trim() === "从 Excel 导入",
    );
    expect(importCta).toBeTruthy();
    importCta?.click();
    renderSurface();
    expect(container.querySelector("[data-org-builder-root]")).not.toBeNull();

    // 选择 CSV → 预览缓存生成后导入按钮可用。
    const fileInput = container.querySelector<HTMLInputElement>(
      '[data-org-builder-root] input[type="file"]',
    );
    expect(fileInput).not.toBeNull();
    // 本文件在 chromium 中运行，浏览器原生 File 自带 .text()，直接承载 CSV 内容。
    const csv = new File(
      ["姓名,邮箱,部门,岗位\n张三,zhang@example.com,销售部,销售经理\n"],
      "org.csv",
      { type: "text/csv" },
    );
    Object.defineProperty(fileInput!, "files", { value: [csv] });
    fileInput!.dispatchEvent(new Event("change"));
    await vi.waitFor(() => {
      renderSurface();
      const importButton = Array.from(container.querySelectorAll("button")).find(
        (entry) => entry.textContent?.trim() === "导入组织名录",
      );
      expect(importButton).toBeTruthy();
      expect(importButton?.disabled).toBe(false);
    });

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    try {
      const importButton = Array.from(container.querySelectorAll("button")).find(
        (entry) => entry.textContent?.trim() === "导入组织名录",
      );
      importButton?.click();
      await vi.waitFor(() => {
        expect(actions.organization.onImportOrganizationRows).toHaveBeenCalledWith([
          expect.objectContaining({
            employeeEmail: "zhang@example.com",
            teamLabel: "销售部",
            seatTitle: "销售经理",
          }),
        ]);
      });
      renderSurface();
      // 导入成功后：收起导入面板，落地邀请激活工作区并展示成功文案。
      expect(container.querySelector("[data-org-builder-root]")).toBeNull();
      expect(window.location.search).toContain("organizationInvite=1");
      expect(container.querySelector("[data-organization-import-success]")).not.toBeNull();
      expect(container.textContent).toContain(
        "已导入 1 条组织身份，岗位数字人已生成，成员仍待邀请激活。",
      );
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it("deletes a vacant seat from the structure inspector", async () => {
    window.history.pushState(
      {},
      "",
      `/openclaw?organizationSurface=structure&organizationTeam=${encodeURIComponent("销售部")}&organizationSeat=seat-vacant`,
    );
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const container = document.createElement("div");
    const actions = createActions();
    const readModel = {
      ...createReadModel(),
      organizationDepartmentPaths: ["销售部"],
      seatSummaries: [
        {
          seatId: "seat-vacant",
          title: "待删岗位",
          teamLabel: "销售部",
          status: "vacant" as const,
          currentEmployeeUser: null,
          currentEmployeeLabel: null,
          roleCode: null,
          defaultAgentId: null,
          agentIds: [],
          defaultSpaceIds: [],
          memoryScopeIds: [],
          responsibility: null,
        },
      ],
    } satisfies EnterprisePortReadModel;
    render(
      renderEnterpriseSurface({
        tab: "enterpriseOrganization",
        basePath: "/openclaw",
        readModel,
        actions,
        authPanelProps: createAuthPanelProps({ status: "trial", seatUsed: 1, seatQuota: 5 }),
        createPositionEditor: createPositionEditor(),
        seatOfferEditor: createSeatOfferEditor(),
        handoverEditor: createHandoverEditor(),
      }),
      container,
    );

    const deleteButton = Array.from(container.querySelectorAll("button")).find(
      (entry) => entry.textContent?.trim() === "删除岗位",
    );
    expect(deleteButton).toBeTruthy();
    expect(deleteButton?.disabled).toBe(false);
    deleteButton?.click();
    await Promise.resolve();
    expect(confirmSpy).toHaveBeenCalled();
    expect(actions.organization.onDeleteSeat).toHaveBeenCalledWith("acme", "seat-vacant");
    confirmSpy.mockRestore();
  });

  it("bulk-deletes deletable seats and shows partial-failure feedback", async () => {
    window.history.pushState({}, "", "/openclaw?organizationView=position");
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const container = document.createElement("div");
    const actions = createActions();
    actions.organization.onDeleteSeat = vi.fn(async (_tenantId: string, seatId: string) => {
      if (seatId === "seat-fail") {
        return undefined;
      }
      return { ok: true as const };
    });
    const readModel = {
      ...createReadModel(),
      organizationDepartmentPaths: ["销售部"],
      seatSummaries: [
        {
          seatId: "seat-vacant",
          title: "空岗壳",
          teamLabel: "销售部",
          status: "vacant" as const,
          currentEmployeeUser: null,
          currentEmployeeLabel: null,
          roleCode: null,
          defaultAgentId: null,
          agentIds: [],
          defaultSpaceIds: [],
          memoryScopeIds: [],
          responsibility: null,
        },
        {
          seatId: "seat-fail",
          title: "待激活岗",
          teamLabel: "销售部",
          status: "assigned" as const,
          currentEmployeeUser: null,
          currentEmployeeLabel: null,
          pendingEmployeeUser: "hire@example.com",
          pendingEmployeeDisplayName: "Hire",
          roleCode: null,
          defaultAgentId: null,
          agentIds: [],
          defaultSpaceIds: [],
          memoryScopeIds: [],
          responsibility: null,
        },
        {
          seatId: "seat-busy",
          title: "在岗",
          teamLabel: "销售部",
          status: "occupied" as const,
          currentEmployeeUser: "owner@example.com",
          currentEmployeeLabel: "Owner",
          roleCode: null,
          defaultAgentId: null,
          agentIds: [],
          defaultSpaceIds: [],
          memoryScopeIds: [],
          responsibility: null,
        },
      ],
    } satisfies EnterprisePortReadModel;

    const renderSurface = () =>
      render(
        renderEnterpriseSurface({
          tab: "enterpriseOrganization",
          basePath: "/openclaw",
          readModel,
          actions,
          authPanelProps: createAuthPanelProps({ status: "trial", seatUsed: 1, seatQuota: 5 }),
          createPositionEditor: createPositionEditor(),
          seatOfferEditor: createSeatOfferEditor(),
          handoverEditor: createHandoverEditor(),
        }),
        container,
      );

    renderSurface();
    const checkboxes = Array.from(
      container.querySelectorAll<HTMLInputElement>(
        '.enterprise-org-row__risk input[type="checkbox"]',
      ),
    );
    expect(checkboxes.length).toBeGreaterThanOrEqual(2);
    for (const checkbox of checkboxes) {
      if (!checkbox.disabled) {
        checkbox.checked = true;
        checkbox.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }
    renderSurface();

    const bulkDelete = container.querySelector<HTMLButtonElement>(
      "[data-organization-bulk-delete]",
    );
    expect(bulkDelete).toBeTruthy();
    expect(bulkDelete?.disabled).toBe(false);
    expect(bulkDelete?.getAttribute("title") ?? "").toMatch(/空岗壳或未注册待激活岗/);
    expect(bulkDelete?.textContent).toMatch(/删除所选岗位/);
    bulkDelete?.click();
    await Promise.resolve();
    await Promise.resolve();
    renderSurface();

    expect(actions.organization.onDeleteSeat).toHaveBeenCalledWith("acme", "seat-vacant");
    expect(actions.organization.onDeleteSeat).toHaveBeenCalledWith("acme", "seat-fail");
    expect(actions.organization.onDeleteSeat).not.toHaveBeenCalledWith("acme", "seat-busy");
    const feedback = container.querySelector("[data-organization-bulk-delete-feedback]");
    expect(feedback?.textContent).toMatch(/已删除 1 个岗位/);
    expect(feedback?.textContent).toMatch(/待激活岗/);
    confirmSpy.mockRestore();
  });

  it("opens position detail in structure workspace when clicking a governance queue row", () => {
    window.history.pushState({}, "", "/openclaw");
    const container = document.createElement("div");
    const readModel = {
      ...createReadModel(),
      seatSummaries: [
        {
          seatId: "seat-gov",
          title: "CEO",
          teamLabel: "管理层",
          status: "occupied" as const,
          currentEmployeeUser: "owner@example.com",
          currentEmployeeLabel: "Owner",
          roleCode: null,
          defaultAgentId: "main",
          agentIds: ["main"],
          defaultSpaceIds: [],
          memoryScopeIds: [],
          responsibility: "企业战略与数字人资产总负责",
        },
      ],
    } satisfies EnterprisePortReadModel;
    const renderSurface = () =>
      render(
        renderEnterpriseSurface({
          tab: "enterpriseOrganization",
          basePath: "/openclaw",
          readModel,
          actions: createActions(),
          authPanelProps: createAuthPanelProps({ status: "trial", seatUsed: 1, seatQuota: 5 }),
          createPositionEditor: createPositionEditor(),
          seatOfferEditor: createSeatOfferEditor(),
          handoverEditor: createHandoverEditor(),
        }),
        container,
      );

    renderSurface();
    const row = container.querySelector<HTMLElement>(".enterprise-org-row");
    expect(row).toBeTruthy();
    row?.click();
    renderSurface();
    expect(window.location.search).toContain("organizationSurface=structure");
    expect(window.location.search).toContain("organizationSeat=seat-gov");
    expect(window.location.search).toContain("organizationFrom=governance");
    expect(container.querySelector(".enterprise-org-layout--structure")).not.toBeNull();
    expect(container.querySelector(".enterprise-org-position-detail")).not.toBeNull();
    expect(container.querySelector(".model-assets-drawer-overlay")).toBeNull();
    expect(container.textContent).toContain("删除岗位");
    expect(container.textContent).toContain("返回模块首页");

    // 「来自治理台」记录在 URL 上：刷新（重置内存态 + 重渲）后返回入口仍在。
    resetOrganizationStructureTransientState();
    renderSurface();
    expect(container.textContent).toContain("返回模块首页");

    const backHome = Array.from(container.querySelectorAll("button")).find(
      (entry) => entry.textContent?.trim() === "返回模块首页",
    );
    expect(backHome).toBeTruthy();
    backHome?.click();
    renderSurface();
    expect(window.location.search).not.toContain("organizationSurface=structure");
    expect(window.location.search).not.toContain("organizationSeat=seat-gov");
    expect(window.location.search).not.toContain("organizationFrom=governance");
    expect(container.querySelector(".enterprise-org-layout--structure")).toBeNull();
    expect(container.querySelector(".enterprise-org-overview")).not.toBeNull();
    expect(container.textContent).toContain("岗位数字人治理队列");
  });

  it("enters the same position detail from member and AI governance rows", () => {
    window.history.pushState({}, "", "/openclaw?organizationView=member");
    const container = document.createElement("div");
    const renderSurface = () =>
      render(
        renderEnterpriseSurface({
          tab: "enterpriseOrganization",
          basePath: "/openclaw",
          readModel: createReadModel(),
          actions: createActions(),
          authPanelProps: createAuthPanelProps({ status: "trial", seatUsed: 1, seatQuota: 5 }),
          createPositionEditor: createPositionEditor(),
          seatOfferEditor: createSeatOfferEditor(),
          handoverEditor: createHandoverEditor(),
        }),
        container,
      );

    renderSurface();
    expect(container.textContent).toContain("成员视图");
    const memberSeatButton = Array.from(container.querySelectorAll("button")).find(
      (entry) => entry.textContent?.trim() === "查看岗位",
    );
    expect(memberSeatButton).toBeTruthy();
    memberSeatButton?.click();
    renderSurface();
    expect(window.location.search).toContain("organizationSurface=structure");
    expect(window.location.search).toContain("organizationSeat=seat-1");
    expect(window.location.search).toContain("organizationFrom=governance");
    expect(container.querySelector(".enterprise-org-layout--structure")).not.toBeNull();
    expect(container.querySelector(".enterprise-org-position-detail")).not.toBeNull();
    expect(container.textContent).toContain("返回模块首页");

    // 数字人视图的「查看岗位」走同一入口。
    resetOrganizationStructureTransientState();
    window.history.pushState({}, "", "/openclaw?organizationView=ai");
    renderSurface();
    const aiSeatButton = Array.from(container.querySelectorAll("button")).find(
      (entry) => entry.textContent?.trim() === "查看岗位",
    );
    expect(aiSeatButton).toBeTruthy();
    aiSeatButton?.click();
    renderSurface();
    expect(window.location.search).toContain("organizationSurface=structure");
    expect(window.location.search).toContain("organizationSeat=seat-1");
    expect(window.location.search).toContain("organizationFrom=governance");
    expect(container.querySelector(".enterprise-org-position-detail")).not.toBeNull();
  });

  it("hosts the ownership transfer editor inside the structure workspace without an overlay", () => {
    window.history.pushState({}, "", "/openclaw");
    const container = document.createElement("div");
    const ownershipTransferEditor = {
      ...createOwnershipTransferEditor(),
      open: true,
      tenantId: "acme",
      subjectKind: "group" as const,
      subjectId: "group-a",
      subjectLabel: "Revenue Squad",
      positionId: "pos-eng",
      positionLabel: "Engineering",
      currentManagerUserId: "owner@example.com",
      currentManagerLabel: "Owner",
      candidateMembers: [
        {
          user: "member@example.com",
          displayLabel: "Member",
          seatTitle: null,
          seatStatus: null,
        },
      ],
    };

    render(
      renderEnterpriseSurface({
        tab: "enterpriseOrganization",
        basePath: "/openclaw",
        readModel: createReadModel(),
        actions: createActions(),
        authPanelProps: createAuthPanelProps({ status: "trial", seatUsed: 1, seatQuota: 5 }),
        createPositionEditor: createPositionEditor(),
        seatOfferEditor: createSeatOfferEditor(),
        handoverEditor: createHandoverEditor(),
        ownershipTransferEditor,
      }),
      container,
    );

    // 归属转移在操作区内就地呈现（组织树保持可见），不再弹整页模态。
    expect(container.querySelector(".enterprise-org-layout--structure")).not.toBeNull();
    expect(
      container.querySelector(".enterprise-org-layout__rail .enterprise-org-tree"),
    ).not.toBeNull();
    expect(container.querySelector(".enterprise-org-modal-overlay")).toBeNull();
    expect(container.textContent).toContain("归属转移");
    expect(container.textContent).toContain("确认转移");
  });

  it("keeps structure after closing invite, and returns home via title or trail", () => {
    window.history.pushState({}, "", "/openclaw?organizationSurface=structure");
    const container = document.createElement("div");
    const seatOfferEditor = createSeatOfferEditor();
    seatOfferEditor.onClose = vi.fn(() => {
      seatOfferEditor.seatId = null;
      seatOfferEditor.seatTitle = "";
      seatOfferEditor.seatStatus = null;
      seatOfferEditor.mode = "offer";
      seatOfferEditor.employeeEmail = "";
    });
    Object.assign(seatOfferEditor, {
      mode: "activation" as const,
      seatId: "seat-2",
      seatTitle: "销售助理",
      seatStatus: "vacant" as const,
      employeeEmail: "member@example.com",
    });

    const renderSurface = () =>
      render(
        renderEnterpriseSurface({
          tab: "enterpriseOrganization",
          basePath: "/openclaw",
          readModel: createReadModel(),
          actions: createActions(),
          authPanelProps: createAuthPanelProps({ status: "trial", seatUsed: 1, seatQuota: 5 }),
          createPositionEditor: createPositionEditor(),
          seatOfferEditor,
          handoverEditor: createHandoverEditor(),
        }),
        container,
      );

    renderSurface();
    expect(container.querySelector(".enterprise-org-layout--structure")).not.toBeNull();
    expect(container.querySelector(".enterprise-org-trail")).not.toBeNull();
    expect(container.textContent).toContain("组织目录");
    expect(container.textContent).toContain("邀请新成员");
    expect(container.querySelector("button.enterprise-page__title--link")).not.toBeNull();

    const closeInvite = container.querySelector<HTMLButtonElement>(
      ".enterprise-org-ws__header button",
    );
    expect(closeInvite?.textContent?.trim()).toBe("关闭");
    closeInvite?.click();
    renderSurface();
    expect(seatOfferEditor.onClose).toHaveBeenCalled();
    expect(window.location.search).toContain("organizationSurface=structure");
    expect(container.querySelector(".enterprise-org-layout--structure")).not.toBeNull();
    expect(container.querySelector(".enterprise-org-overview")).toBeNull();
    expect(container.querySelector(".enterprise-org-ws__title")).toBeNull();
    expect(container.textContent).not.toContain("发送激活");

    Object.assign(seatOfferEditor, {
      mode: "activation" as const,
      seatId: "seat-2",
      seatTitle: "销售助理",
      seatStatus: "vacant" as const,
      employeeEmail: "member@example.com",
    });
    renderSurface();

    const titleHome = container.querySelector<HTMLButtonElement>(
      "button.enterprise-page__title--link",
    );
    expect(titleHome).toBeTruthy();
    titleHome?.click();
    renderSurface();
    expect(window.location.search).not.toContain("organizationSurface=structure");
    expect(container.querySelector(".enterprise-org-layout--structure")).toBeNull();
    expect(container.querySelector(".enterprise-org-overview")).not.toBeNull();
    expect(container.querySelector("button.enterprise-page__title--link")).toBeNull();

    window.history.pushState({}, "", "/openclaw?organizationSurface=structure");
    Object.assign(seatOfferEditor, {
      mode: "activation" as const,
      seatId: "seat-2",
      seatTitle: "销售助理",
      seatStatus: "vacant" as const,
      employeeEmail: "member@example.com",
    });
    renderSurface();
    const trailHome = container.querySelectorAll<HTMLButtonElement>(
      ".enterprise-org-trail__link",
    )[0];
    expect(trailHome).toBeTruthy();
    trailHome?.click();
    renderSurface();
    expect(window.location.search).not.toContain("organizationSurface=structure");
    expect(container.querySelector(".enterprise-org-overview")).not.toBeNull();
  });

  it("hosts an open position editor inside the workspace even from the governance view", () => {
    // 默认进入治理队列视图（无 organizationSurface=structure）。
    window.history.pushState({}, "", "/openclaw");
    const container = document.createElement("div");
    const createPosition = createPositionEditor();

    render(
      renderEnterpriseSurface({
        tab: "enterpriseOrganization",
        basePath: "/openclaw",
        readModel: createReadModel(),
        actions: createActions(),
        authPanelProps: createAuthPanelProps({ status: "trial", seatUsed: 1, seatQuota: 5 }),
        createPositionEditor: {
          ...createPosition,
          open: true,
          seatId: "seat-1",
          seatTitle: "客服专员",
          teamLabel: "客户管理部",
        },
        seatOfferEditor: createSeatOfferEditor(),
        handoverEditor: createHandoverEditor(),
      }),
      container,
    );

    // 编辑器打开即切到「组织树 + 操作区」模式，表单在操作区内就地呈现。
    expect(container.querySelector(".enterprise-org-layout--structure")).not.toBeNull();
    expect(
      container.querySelector(".enterprise-org-layout__rail .enterprise-org-tree"),
    ).not.toBeNull();
    expect(container.textContent).toContain("配置岗位");
    // 不再弹出脱离操作区的整页模态，也不渲染治理队列表格。
    expect(container.querySelector(".enterprise-org-modal-overlay")).toBeNull();
    expect(container.textContent).not.toContain("岗位数字人治理队列");
  });

  it("opens organization lifecycle modals from toolbar and quick actions", () => {
    const container = document.createElement("div");
    const createPosition = createPositionEditor();
    const actions = createActions();

    render(
      renderEnterpriseSurface({
        tab: "enterpriseOrganization",
        basePath: "/openclaw",
        readModel: createReadModel(),
        actions,
        authPanelProps: createAuthPanelProps({
          status: "trial",
          seatUsed: 1,
          seatQuota: 5,
        }),
        createPositionEditor: createPosition,
        seatOfferEditor: createSeatOfferEditor(),
        handoverEditor: createHandoverEditor(),
      }),
      container,
    );

    const createButtons = Array.from(container.querySelectorAll("button")).filter(
      (entry) => entry.textContent?.trim() === "添加岗位",
    );
    expect(createButtons.length).toBe(1);
    createButtons[0]?.click();
    expect(createPosition.onOpen).toHaveBeenCalledTimes(1);

    const buildButton = Array.from(container.querySelectorAll("button")).find(
      (entry) => entry.textContent?.trim() === "搭建组织",
    );
    expect(buildButton).toBeTruthy();
    buildButton?.click();
    const renderBuilder = () =>
      render(
        renderEnterpriseSurface({
          tab: "enterpriseOrganization",
          basePath: "/openclaw",
          readModel: createReadModel(),
          actions,
          authPanelProps: createAuthPanelProps({
            status: "trial",
            seatUsed: 1,
            seatQuota: 5,
          }),
          createPositionEditor: createPosition,
          seatOfferEditor: createSeatOfferEditor(),
          handoverEditor: createHandoverEditor(),
        }),
        container,
      );
    renderBuilder();
    expect(container.querySelector(".enterprise-org-layout--structure")).not.toBeNull();
    expect(container.textContent).toContain("从 Excel 导入");

    const importButton = Array.from(container.querySelectorAll("button")).find((entry) =>
      entry.textContent?.includes("从 Excel 导入"),
    );
    expect(importButton).toBeTruthy();
    importButton?.click();
    renderBuilder();
    expect(container.textContent).toContain("导入组织名录");
    expect(container.textContent).toContain("下载模版");
    expect(container.textContent).toContain("上传模版");
    expect(container.textContent).toContain("下载 Excel 模版");
    expect(container.textContent).not.toContain("部门层级");
    expect(container.textContent).not.toContain("导入只建立组织结构");

    window.history.pushState({}, "", "/openclaw");
    render(
      renderEnterpriseSurface({
        tab: "enterpriseOrganization",
        basePath: "/openclaw",
        readModel: createReadModel(),
        actions,
        authPanelProps: createAuthPanelProps({
          status: "trial",
          seatUsed: 1,
          seatQuota: 5,
        }),
        createPositionEditor: createPosition,
        seatOfferEditor: createSeatOfferEditor(),
        handoverEditor: createHandoverEditor(),
      }),
      container,
    );
    const inviteButton = Array.from(container.querySelectorAll("button")).find(
      (entry) => entry.textContent?.trim() === "邀请激活",
    );
    expect(inviteButton).toBeTruthy();
    inviteButton?.click();
    render(
      renderEnterpriseSurface({
        tab: "enterpriseOrganization",
        basePath: "/openclaw",
        readModel: createReadModel(),
        actions,
        authPanelProps: createAuthPanelProps({
          status: "trial",
          seatUsed: 1,
          seatQuota: 5,
        }),
        createPositionEditor: createPosition,
        seatOfferEditor: createSeatOfferEditor(),
        handoverEditor: createHandoverEditor(),
      }),
      container,
    );
    expect(actions.organization.onCreateInvite).not.toHaveBeenCalled();
    expect(container.textContent).toContain("待激活成员");
    expect(container.textContent).toContain("待确认成员");
    expect(container.textContent).not.toContain("激活逻辑");
  });

  it("renders create position as structure plus generated digital employee only", () => {
    const container = document.createElement("div");
    const createPosition = {
      ...createPositionEditor(),
      open: true,
      seatTitle: "销售负责人",
      teamLabel: "销售一组",
      responsibility: "负责销售线索跟进、客户会议记录和方案输出",
    };

    render(
      renderEnterpriseSurface({
        tab: "enterpriseOrganization",
        basePath: "/openclaw",
        readModel: createReadModel(),
        actions: createActions(),
        authPanelProps: createAuthPanelProps({
          status: "trial",
          seatUsed: 1,
          seatQuota: 5,
        }),
        createPositionEditor: createPosition,
        seatOfferEditor: createSeatOfferEditor(),
        handoverEditor: createHandoverEditor(),
      }),
      container,
    );

    expect(container.textContent).toContain("数字人预览");
    expect(container.textContent).toContain("销售负责人数字人");
    expect(container.textContent).not.toContain("SALES-L2-001");
    expect(container.textContent).toContain("未绑定");
    expect(container.textContent).toContain("AI 工作空间");
    expect(container.textContent).toContain("任职邮箱（可选）");
    expect(container.textContent).toContain("不会产生待确认绑定");
    expect(container.querySelector("[data-create-position-email]")).not.toBeNull();
    expect(container.textContent).toContain("创建岗位");
    expect(container.textContent).not.toContain("岗位是企业责任主体");
    expect(container.textContent).not.toContain("创建岗位不创建Bot");
    expect(container.textContent).not.toContain("阻塞项：请先填写岗位名称");
    expect(container.textContent).not.toContain("默认AI");
    expect(container.textContent).not.toContain("岗位AI工具集");
    expect(container.textContent).not.toContain("创建岗位数字人");
  });

  it("shows optional email when editing a pending-activation seat", () => {
    window.history.pushState({}, "", "/openclaw?organizationSurface=structure");
    const container = document.createElement("div");
    const createPosition = {
      ...createPositionEditor(),
      open: true,
      seatId: "seat-pending",
      seatTitle: "体验官-丁总",
      teamLabel: "客户体验官",
      employeeEmail: "lindading0825@gmail.com",
    };
    const readModel = {
      ...createReadModel(),
      seatSummaries: [
        {
          seatId: "seat-pending",
          title: "体验官-丁总",
          teamLabel: "客户体验官",
          status: "assigned" as const,
          currentEmployeeUser: null,
          currentEmployeeLabel: null,
          pendingEmployeeUser: "lindading0825@gmail.com",
          pendingEmployeeDisplayName: "丁总",
          pendingActivationExpiresAt: null,
          roleCode: "CXO-L1-001",
          defaultAgentId: null,
          agentIds: [],
          defaultSpaceIds: [],
          memoryScopeIds: [],
          responsibility: null,
        },
      ],
    } satisfies EnterprisePortReadModel;

    render(
      renderEnterpriseSurface({
        tab: "enterpriseOrganization",
        basePath: "/openclaw",
        readModel,
        actions: createActions(),
        authPanelProps: createAuthPanelProps({ status: "trial", seatUsed: 1, seatQuota: 5 }),
        createPositionEditor: createPosition,
        seatOfferEditor: createSeatOfferEditor(),
        handoverEditor: createHandoverEditor(),
      }),
      container,
    );

    expect(container.textContent).toContain("配置岗位");
    expect(container.textContent).toContain("任职邮箱（可选）");
    expect(container.querySelector("[data-create-position-email]")).not.toBeNull();
    expect(container.textContent).toContain("保存并发送激活");
  });

  it("shows unnamed position instead of email in invite activation table", () => {
    window.history.pushState({}, "", "/openclaw?organizationSurface=structure");
    const container = document.createElement("div");
    const readModel = {
      ...createReadModel(),
      seatSummaries: [
        {
          seatId: "seat-email-title",
          title: "person@example.com",
          teamLabel: "客户体验官",
          status: "assigned" as const,
          currentEmployeeUser: null,
          currentEmployeeLabel: null,
          pendingEmployeeUser: "person@example.com",
          pendingEmployeeDisplayName: "person@example.com",
          pendingActivationExpiresAt: null,
          roleCode: null,
          defaultAgentId: null,
          agentIds: [],
          defaultSpaceIds: [],
          memoryScopeIds: [],
          responsibility: null,
        },
      ],
    } satisfies EnterprisePortReadModel;
    const renderSurface = () =>
      render(
        renderEnterpriseSurface({
          tab: "enterpriseOrganization",
          basePath: "/openclaw",
          readModel,
          actions: createActions(),
          authPanelProps: createAuthPanelProps({ status: "trial", seatUsed: 1, seatQuota: 5 }),
          createPositionEditor: createPositionEditor(),
          seatOfferEditor: createSeatOfferEditor(),
          handoverEditor: createHandoverEditor(),
        }),
        container,
      );

    renderSurface();
    const inviteButton = Array.from(container.querySelectorAll("button")).find(
      (entry) => entry.textContent?.trim() === "邀请激活",
    );
    inviteButton?.click();
    renderSurface();

    const positionCell = container.querySelector(
      ".enterprise-org-activation-table__cell--position",
    );
    expect(positionCell?.textContent?.trim()).toBe("未命名岗位");
    expect(container.querySelector(".enterprise-org-ws__body")).not.toBeNull();
  });

  it("shows 处理中 only on the invite row currently sending activation", async () => {
    const container = document.createElement("div");
    let resolveSend: (() => void) | undefined;
    const onSendActivationEmails = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSend = resolve;
        }),
    );
    const actions = createActions();
    actions.organization.onSendActivationEmails = onSendActivationEmails;
    const readModel = {
      ...createReadModel(),
      seatCount: 2,
      occupiedSeatCount: 0,
      vacantSeatCount: 0,
      assignedSeatCount: 2,
      seatSummaries: [
        {
          seatId: "seat-a",
          title: "人海",
          teamLabel: "运营中心",
          status: "assigned" as const,
          currentEmployeeUser: null,
          currentEmployeeLabel: null,
          pendingEmployeeUser: "alice@example.com",
          pendingEmployeeDisplayName: "Alice",
          pendingActivationExpiresAt: null,
          roleCode: null,
          defaultAgentId: null,
          agentIds: [],
          defaultSpaceIds: [],
          memoryScopeIds: [],
          responsibility: null,
        },
        {
          seatId: "seat-b",
          title: "体验官-kevin",
          teamLabel: "客户体验官",
          status: "assigned" as const,
          currentEmployeeUser: null,
          currentEmployeeLabel: null,
          pendingEmployeeUser: "kevin@example.com",
          pendingEmployeeDisplayName: "Kevin",
          pendingActivationExpiresAt: null,
          roleCode: null,
          defaultAgentId: null,
          agentIds: [],
          defaultSpaceIds: [],
          memoryScopeIds: [],
          responsibility: null,
        },
      ],
    } satisfies EnterprisePortReadModel;

    const renderSurface = (busy = false) =>
      render(
        renderEnterpriseSurface({
          tab: "enterpriseOrganization",
          basePath: "/openclaw",
          readModel,
          actions,
          authPanelProps: {
            ...createAuthPanelProps({
              status: "trial",
              seatUsed: 1,
              seatQuota: 5,
            }),
            busy,
          },
          seatOfferEditor: createSeatOfferEditor(),
          handoverEditor: createHandoverEditor(),
        }),
        container,
      );

    window.history.pushState({}, "", "/openclaw?organizationInvite=1");
    renderSurface(false);

    const actionButtonsInInviteTable = () =>
      Array.from(
        container.querySelectorAll(
          ".enterprise-org-activation-table__row .enterprise-org-activation-table__cell--actions button",
        ),
      ).filter(
        (entry) =>
          entry.textContent?.trim() === "发送激活" || entry.textContent?.trim() === "处理中...",
      );
    expect(actionButtonsInInviteTable()).toHaveLength(2);
    expect(
      actionButtonsInInviteTable().every((entry) => entry.textContent?.trim() === "发送激活"),
    ).toBe(true);

    const aliceRow = Array.from(
      container.querySelectorAll(".enterprise-org-activation-table__row"),
    ).find((row) => row.textContent?.includes("alice@example.com"));
    const aliceSend = aliceRow?.querySelector("button");
    expect(aliceSend?.textContent?.trim()).toBe("发送激活");
    aliceSend?.click();
    await Promise.resolve();
    // Global auth busy must not flip every row; only the in-flight email shows 处理中.
    renderSurface(true);

    const labels = actionButtonsInInviteTable().map((entry) => entry.textContent?.trim());
    expect(labels.filter((label) => label === "处理中...")).toHaveLength(1);
    expect(labels.filter((label) => label === "发送激活")).toHaveLength(1);
    const busyRow = Array.from(
      container.querySelectorAll(".enterprise-org-activation-table__row"),
    ).find((row) => row.textContent?.includes("处理中..."));
    expect(busyRow?.textContent).toContain("alice@example.com");
    expect(busyRow?.textContent).not.toContain("kevin@example.com");
    expect(onSendActivationEmails).toHaveBeenCalledWith(["alice@example.com"]);

    resolveSend?.();
    await onSendActivationEmails.mock.results[0]?.value;
    renderSurface(false);
    expect(
      actionButtonsInInviteTable().every((entry) => entry.textContent?.trim() === "发送激活"),
    ).toBe(true);
  });

  it("opens activation-mode editor from invite rows that still lack a pending email", () => {
    const container = document.createElement("div");
    const seatOfferEditor = createSeatOfferEditor();
    const readModel = {
      ...createReadModel(),
      seatCount: 2,
      occupiedSeatCount: 1,
      vacantSeatCount: 1,
      seatSummaries: [
        ...createReadModel().seatSummaries,
        {
          seatId: "seat-vacant",
          title: "销售助理",
          teamLabel: "销售一部",
          status: "vacant",
          currentEmployeeUser: null,
          currentEmployeeLabel: null,
          pendingEmployeeUser: null,
          pendingEmployeeDisplayName: null,
          pendingActivationExpiresAt: null,
          roleCode: "SALES-L1-002",
          defaultAgentId: null,
          agentIds: [],
          defaultSpaceIds: [],
          memoryScopeIds: [],
          responsibility: null,
        },
      ],
    } satisfies EnterprisePortReadModel;

    render(
      renderEnterpriseSurface({
        tab: "enterpriseOrganization",
        basePath: "/openclaw",
        readModel,
        actions: createActions(),
        authPanelProps: createAuthPanelProps({
          status: "trial",
          seatUsed: 1,
          seatQuota: 5,
        }),
        seatOfferEditor,
        handoverEditor: createHandoverEditor(),
      }),
      container,
    );

    const inviteButton = Array.from(container.querySelectorAll("button")).find(
      (entry) => entry.textContent?.trim() === "邀请激活",
    );
    expect(inviteButton).toBeTruthy();
    inviteButton?.click();

    render(
      renderEnterpriseSurface({
        tab: "enterpriseOrganization",
        basePath: "/openclaw",
        readModel,
        actions: createActions(),
        authPanelProps: createAuthPanelProps({
          status: "trial",
          seatUsed: 1,
          seatQuota: 5,
        }),
        seatOfferEditor,
        handoverEditor: createHandoverEditor(),
      }),
      container,
    );

    const fillEmailButton = Array.from(container.querySelectorAll("button")).find(
      (entry) => entry.textContent?.trim() === "补邮箱并发送",
    );
    expect(fillEmailButton).toBeTruthy();
    fillEmailButton?.click();
    expect(seatOfferEditor.onOpen).toHaveBeenCalledWith({
      mode: "activation",
      seatId: "seat-vacant",
      seatTitle: "销售助理",
      seatStatus: "vacant",
      defaultAgentId: null,
      availableAgentIds: [],
      defaultSpaceIds: [],
      memoryScopeAvailable: false,
      employeeEmail: null,
    });
    expect(container.textContent).toContain("待激活成员");
  });

  it("separates pending confirmations from activation rows in the invite modal", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const container = document.createElement("div");
    const seatOfferEditor = createSeatOfferEditor();
    const actions = createActions();
    const readModel = {
      ...createReadModel(),
      seatCount: 2,
      occupiedSeatCount: 1,
      vacantSeatCount: 1,
      pendingOfferCount: 1,
      seatSummaries: [
        ...createReadModel().seatSummaries,
        {
          seatId: "seat-confirm",
          title: "客户成功经理",
          teamLabel: "客户成功部",
          status: "assigned",
          currentEmployeeUser: null,
          currentEmployeeLabel: null,
          pendingEmployeeUser: null,
          pendingEmployeeDisplayName: null,
          pendingActivationExpiresAt: null,
          roleCode: "CS-L2-001",
          defaultAgentId: "cs-bot",
          agentIds: ["cs-bot"],
          defaultSpaceIds: ["space-cs"],
          memoryScopeIds: ["seat:seat-confirm"],
          responsibility: null,
        },
      ],
      offerSummaries: [
        {
          assignmentId: "assign-confirm-1",
          assignmentType: "internal",
          offerId: "offer-confirm-1",
          seatId: "seat-confirm",
          seatTitle: "客户成功经理",
          targetEmployeeUser: "owner@example.com",
          status: "pending",
          defaultAgentId: "cs-bot",
          agentIds: ["cs-bot"],
          defaultSpaceIds: ["space-cs"],
          offeredAt: "2026-06-05T08:00:00.000Z",
          expiresAt: null,
        },
      ],
    } satisfies EnterprisePortReadModel;

    render(
      renderEnterpriseSurface({
        tab: "enterpriseOrganization",
        basePath: "/openclaw",
        readModel,
        actions,
        authPanelProps: createAuthPanelProps({
          status: "trial",
          seatUsed: 1,
          seatQuota: 5,
        }),
        seatOfferEditor,
        handoverEditor: createHandoverEditor(),
      }),
      container,
    );

    const inviteButton = Array.from(container.querySelectorAll("button")).find(
      (entry) => entry.textContent?.trim() === "邀请激活",
    );
    expect(inviteButton).toBeTruthy();
    inviteButton?.click();

    render(
      renderEnterpriseSurface({
        tab: "enterpriseOrganization",
        basePath: "/openclaw",
        readModel,
        actions,
        authPanelProps: createAuthPanelProps({
          status: "trial",
          seatUsed: 1,
          seatQuota: 5,
        }),
        seatOfferEditor,
        handoverEditor: createHandoverEditor(),
      }),
      container,
    );

    expect(container.textContent).toContain("待激活成员");
    expect(container.textContent).toContain("待确认成员");
    expect(container.textContent).toContain("重新发送提醒");
    expect(container.textContent).not.toContain("客户成功经理发送激活");

    const remindButton = Array.from(container.querySelectorAll("button")).find(
      (entry) => entry.textContent?.trim() === "重新发送提醒",
    );
    expect(remindButton).toBeTruthy();
    remindButton?.click();

    expect(actions.organization.onRemindSeatOffer).toHaveBeenCalledWith(
      "acme",
      "offer-confirm-1",
      "owner@example.com",
    );
    expect(confirmSpy).toHaveBeenCalled();
  });

  it("opens activation-mode editor from vacant row quick actions", () => {
    const container = document.createElement("div");
    const seatOfferEditor = createSeatOfferEditor();
    const readModel = {
      ...createReadModel(),
      seatCount: 2,
      occupiedSeatCount: 1,
      vacantSeatCount: 1,
      seatSummaries: [
        ...createReadModel().seatSummaries,
        {
          seatId: "seat-vacant",
          title: "销售助理",
          teamLabel: "销售一部",
          status: "vacant",
          currentEmployeeUser: null,
          currentEmployeeLabel: null,
          pendingEmployeeUser: null,
          pendingEmployeeDisplayName: null,
          pendingActivationExpiresAt: null,
          roleCode: "SALES-L1-002",
          defaultAgentId: null,
          agentIds: [],
          defaultSpaceIds: [],
          memoryScopeIds: [],
          responsibility: null,
        },
      ],
    } satisfies EnterprisePortReadModel;

    render(
      renderEnterpriseSurface({
        tab: "enterpriseOrganization",
        basePath: "/openclaw",
        readModel,
        actions: createActions(),
        authPanelProps: createAuthPanelProps({
          status: "trial",
          seatUsed: 1,
          seatQuota: 5,
        }),
        seatOfferEditor,
        handoverEditor: createHandoverEditor(),
      }),
      container,
    );

    const replenishButton = container.querySelector<HTMLButtonElement>('button[aria-label="补人"]');
    expect(replenishButton).toBeTruthy();
    replenishButton?.click();

    expect(seatOfferEditor.onOpen).toHaveBeenCalledWith({
      seatId: "seat-vacant",
      seatTitle: "销售助理",
      seatStatus: "vacant",
      defaultAgentId: null,
      availableAgentIds: [],
      defaultSpaceIds: [],
      memoryScopeAvailable: false,
      employeeEmail: null,
    });
  });

  it("renders and submits the seat assignment offer editor panel", () => {
    const container = document.createElement("div");
    const seatOfferEditor = createSeatOfferEditor();

    render(
      renderEnterpriseSurface({
        tab: "enterpriseOrganization",
        basePath: "/openclaw",
        readModel: createReadModel(),
        actions: createActions(),
        authPanelProps: createAuthPanelProps({
          status: "trial",
          seatUsed: 1,
          seatQuota: 5,
        }),
        seatOfferEditor: {
          ...seatOfferEditor,
          seatId: "seat-2",
          seatTitle: "Vacant Sales",
          seatStatus: "vacant",
          defaultAgentId: "agent-sales",
          employeeEmail: "successor@example.com",
        },
        handoverEditor: createHandoverEditor(),
      }),
      container,
    );

    expect(container.textContent).toContain("分配在职成员");
    expect(container.textContent).toContain("Vacant Sales");
    expect(container.textContent).toContain("空岗");
    expect(container.textContent).toContain("岗位数字人");
    expect(container.textContent).not.toContain("管理员在这里发送岗位邀请");
    expect(container.textContent).not.toContain("阻塞项：请先填写");
    expect(container.textContent).not.toContain("agent-sales");
    const input = container.querySelector<HTMLInputElement>('input[type="email"]');
    expect(input).not.toBeNull();
    input!.value = "successor@example.com";
    input!.dispatchEvent(new Event("input"));

    const submitButton = Array.from(container.querySelectorAll("button")).find(
      (entry) => entry.textContent?.trim() === "发送绑定确认",
    );
    expect(submitButton).toBeTruthy();
    submitButton?.click();

    expect(seatOfferEditor.onEmployeeEmailChange).toHaveBeenCalledWith("successor@example.com");
    expect(seatOfferEditor.onSubmit).toHaveBeenCalled();
  });

  it("renders activation-mode editor copy for missing pending emails", () => {
    const container = document.createElement("div");
    const seatOfferEditor = createSeatOfferEditor();

    render(
      renderEnterpriseSurface({
        tab: "enterpriseOrganization",
        basePath: "/openclaw",
        readModel: createReadModel(),
        actions: createActions(),
        authPanelProps: createAuthPanelProps({
          status: "trial",
          seatUsed: 1,
          seatQuota: 5,
        }),
        seatOfferEditor: {
          ...seatOfferEditor,
          mode: "activation",
          seatId: "seat-2",
          seatTitle: "销售助理",
          seatStatus: "vacant",
          defaultAgentId: null,
          employeeEmail: "member@example.com",
        },
        handoverEditor: createHandoverEditor(),
      }),
      container,
    );

    expect(container.textContent).toContain("邀请新成员");
    expect(container.textContent).toContain("成员使用激活码注册后自动绑定本岗位");
    expect(container.textContent).not.toContain("先补齐成员邮箱并发送激活链接");
    const submitButton = Array.from(container.querySelectorAll("button")).find(
      (entry) => entry.textContent?.trim() === "发送激活",
    );
    expect(submitButton).toBeTruthy();
  });

  it("renders and submits the handover nominate step", () => {
    const readModel = {
      ...createReadModel(),
      memberSummaries: [
        ...createReadModel().memberSummaries,
        {
          user: "successor@example.com",
          displayLabel: "Successor",
          membershipRole: "member",
          status: "active",
          seatTitle: "Finance Lead",
          seatStatus: "occupied",
          seatTeamLabel: null,
        },
      ],
      seatSummaries: [
        ...createReadModel().seatSummaries,
        {
          seatId: "seat-2",
          title: "Finance Lead",
          teamLabel: "财务组",
          status: "occupied",
          currentEmployeeUser: "successor@example.com",
          currentEmployeeLabel: "Successor",
          roleCode: "OPS-L2-002",
          defaultAgentId: null,
          agentIds: [],
          defaultSpaceIds: [],
          memoryScopeIds: [],
          responsibility: null,
        },
      ],
      handoverSummaries: [
        {
          handoverCaseId: "handover-draft",
          seatTitle: "Sales Lead",
          status: "draft" as const,
          outgoingEmployeeUser: "member@example.com",
          incomingEmployeeUser: null,
          createdAt: "2026-05-05T03:20:00.000Z",
          completedAt: null,
        },
      ],
      handoverCaseCount: 1,
    } satisfies EnterprisePortReadModel;
    const actions = createActions();
    const handoverEditor = createHandoverEditor();
    const container = document.createElement("div");

    render(
      renderEnterpriseSurface({
        tab: "enterpriseOrganization",
        basePath: "/openclaw",
        readModel,
        actions,
        authPanelProps: createAuthPanelProps({
          status: "trial",
          seatUsed: 1,
          seatQuota: 5,
        }),
        seatOfferEditor: createSeatOfferEditor(),
        handoverEditor: {
          ...handoverEditor,
          caseId: "handover-draft",
          seatTitle: "Sales Lead",
          status: "draft",
          successorEmail: "",
          seatStatus: "handover_pending",
          currentEmployeeEmail: "member@example.com",
          currentEmployeeDisplayName: "Member",
        },
      }),
      container,
    );

    expect(container.textContent).toContain("岗位交接");
    expect(container.textContent).toContain("选择继任者");
    expect(container.textContent).toContain("先确定继任负责人");
    expect(container.textContent).toContain("组织目录");
    expect(container.textContent).toContain("销售一组");
    expect(container.textContent).toContain("财务组");
    expect(container.textContent).not.toContain("审计日志");

    const handoverPanel = container.querySelector(".enterprise-handover-panel");
    expect(handoverPanel).not.toBeNull();
    const orgTree = handoverPanel!.querySelector(".enterprise-org-tree");
    expect(orgTree).not.toBeNull();
    const selectFromTree = Array.from(orgTree!.querySelectorAll("button")).find(
      (entry) =>
        entry.textContent?.trim() === "选择" &&
        entry.closest(".enterprise-org-tree__node--member")?.textContent?.includes("Successor"),
    );
    expect(selectFromTree).toBeTruthy();
    selectFromTree?.click();
    expect(handoverEditor.onSuccessorEmailChange).toHaveBeenCalledWith("successor@example.com");

    const nominateButton = Array.from(container.querySelectorAll("button")).find(
      (entry) => entry.textContent?.trim() === "确认继任者",
    );
    expect(nominateButton).toBeTruthy();
    expect((nominateButton as HTMLButtonElement).disabled).toBe(true);
  });

  it("renders and submits the handover review step", () => {
    const readModel = {
      ...createReadModel(),
      handoverSummaries: [
        {
          handoverCaseId: "handover-review",
          seatTitle: "Sales Lead",
          status: "asset_review" as const,
          outgoingEmployeeUser: "member@example.com",
          incomingEmployeeUser: "successor@example.com",
          createdAt: "2026-05-05T03:20:00.000Z",
          completedAt: null,
        },
      ],
      handoverCaseCount: 1,
    } satisfies EnterprisePortReadModel;
    const actions = createActions();
    const handoverEditor = createHandoverEditor();
    const container = document.createElement("div");

    render(
      renderEnterpriseSurface({
        tab: "enterpriseOrganization",
        basePath: "/openclaw",
        readModel,
        actions,
        authPanelProps: createAuthPanelProps({
          status: "trial",
          seatUsed: 1,
          seatQuota: 5,
        }),
        seatOfferEditor: createSeatOfferEditor(),
        handoverEditor: {
          ...handoverEditor,
          caseId: "handover-review",
          seatTitle: "Sales Lead",
          status: "asset_review",
          reviewSummary: "初始摘要",
          exceptionFlags: "connector_rebind_required",
          successorEmail: "successor@example.com",
          seatStatus: "handover_pending",
          defaultAgentIds: ["agent-main"],
          defaultSpaceIds: ["space-sales"],
          selectedAgentIds: ["agent-main"],
          selectedDataKeys: ["recent_sessions", "knowledge"],
          selectedSpaceIds: ["space-sales"],
          selectedPolicyIds: ["employee-policy-1", "seat-policy-1"],
          currentEmployeeEmail: "member@example.com",
          currentEmployeeDisplayName: "Member",
          bindingStatus: "active",
          employeePolicies: [
            {
              policyId: "employee-policy-1",
              resourceType: "connector",
              resourceId: "hubspot",
              action: "use",
            },
          ],
          seatPolicies: [
            {
              policyId: "seat-policy-1",
              resourceType: "memory",
              resourceId: "sales-playbook",
              action: "read",
            },
          ],
        },
      }),
      container,
    );

    expect(container.textContent).toContain("岗位交接");
    expect(container.textContent).toContain("选择继承资产");
    expect(container.textContent).toContain("岗位可继承资产");
    expect(container.textContent).toContain("风险提示");
    expect(container.textContent).not.toContain("审计日志");

    const handoverCard = container.querySelector(".enterprise-handover-panel");
    expect(handoverCard).not.toBeNull();

    const textarea = handoverCard?.querySelector("textarea");
    expect(textarea).not.toBeNull();
    textarea!.value = "已完成审查";
    textarea!.dispatchEvent(new Event("input"));

    const firstCheckbox = handoverCard!.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(firstCheckbox).not.toBeNull();
    firstCheckbox!.checked = false;
    firstCheckbox!.dispatchEvent(new Event("change"));

    const exceptionInput = handoverCard!.querySelector<HTMLInputElement>(
      'input[placeholder*="connector_rebind_required"]',
    );
    expect(exceptionInput).not.toBeNull();
    exceptionInput!.value = "connector_rebind_required, memory_review_pending";
    exceptionInput!.dispatchEvent(new Event("input"));

    const submitButton = Array.from(container.querySelectorAll("button")).find(
      (entry) => entry.textContent?.trim() === "确认资产并提交审查",
    );
    expect(submitButton).toBeTruthy();
    submitButton?.click();

    expect(handoverEditor.onReviewSummaryChange).toHaveBeenCalledWith("已完成审查");
    expect(handoverEditor.onToggleAgentAsset).toHaveBeenCalledWith("agent-main");
    expect(handoverEditor.onExceptionFlagsChange).toHaveBeenCalledWith(
      "connector_rebind_required, memory_review_pending",
    );
    expect(handoverEditor.onSubmitReview).toHaveBeenCalled();
    expect(container.textContent).toContain("Sales Lead");
  });

  it("shows session transfer results on completed handover review", () => {
    const readModel = {
      ...createReadModel(),
      handoverSummaries: [
        {
          handoverCaseId: "handover-done",
          seatTitle: "Sales Lead",
          status: "completed" as const,
          outgoingEmployeeUser: "member@example.com",
          incomingEmployeeUser: "successor@example.com",
          createdAt: "2026-05-05T03:20:00.000Z",
          completedAt: "2026-06-12T12:00:00.000Z",
        },
      ],
      handoverCaseCount: 1,
    } satisfies EnterprisePortRenderModel["readModel"];
    const container = document.createElement("div");

    render(
      renderEnterpriseSurface({
        tab: "enterpriseOrganization",
        basePath: "/openclaw",
        readModel,
        actions: createActions(),
        authPanelProps: createAuthPanelProps({
          status: "trial",
          seatUsed: 1,
          seatQuota: 5,
        }),
        seatOfferEditor: createSeatOfferEditor(),
        handoverEditor: {
          ...createHandoverEditor(),
          caseId: "handover-done",
          seatTitle: "Sales Lead",
          status: "completed",
          successorEmail: "successor@example.com",
          assetSnapshot: {
            agentIds: ["agent-main"],
            spaceIds: ["space-sales"],
            memoryScopeIds: [],
            memoryScopes: [],
            connectorProfiles: [],
            connectorCredentialReauthorizationRequired: false,
            frozenAssetBindingIds: [],
            rebindRequiredAssetBindingIds: [],
            sessionDataTransfer: {
              recentSessions: true,
              historyArchive: true,
              coveredAgentIds: ["agent-main"],
              executedAt: "2026-06-12T12:00:00.000Z",
              archivedSessionIds: ["sess-old"],
              recentSessionIds: ["sess-recent"],
              archivedTranscriptCount: 2,
            },
          },
        },
      }),
      container,
    );

    expect(container.textContent).toContain("交接已完成");
    expect(container.textContent).toContain("会话数据迁移结果");
    expect(container.textContent).toContain("已标记继承 1 个");
    expect(container.textContent).toContain("已归档 1 个会话（2 个 transcript 文件）");
  });

  it("disables controls outside the active step and surfaces current workflow state", () => {
    const readModel = {
      ...createReadModel(),
      handoverSummaries: [
        {
          handoverCaseId: "handover-frozen",
          seatTitle: "Finance Lead",
          status: "frozen" as const,
          outgoingEmployeeUser: "member@example.com",
          incomingEmployeeUser: "successor@example.com",
          createdAt: "2026-05-05T03:20:00.000Z",
          completedAt: null,
        },
      ],
      handoverCaseCount: 1,
      frozenSeatCount: 1,
    } satisfies EnterprisePortReadModel;
    const container = document.createElement("div");

    render(
      renderEnterpriseSurface({
        tab: "enterpriseOrganization",
        basePath: "/openclaw",
        readModel,
        actions: createActions(),
        authPanelProps: createAuthPanelProps({
          status: "trial",
          seatUsed: 1,
          seatQuota: 5,
        }),
        seatOfferEditor: createSeatOfferEditor(),
        handoverEditor: {
          ...createHandoverEditor(),
          caseId: "handover-frozen",
          seatTitle: "Finance Lead",
          status: "frozen",
          reviewSummary: "",
          exceptionFlags: "",
          successorEmail: "",
          selectedDataKeys: ["recent_sessions", "knowledge"],
          notice: "已批准交接冻结。",
        },
      }),
      container,
    );

    expect(container.textContent).toContain("确认交接");
    expect(container.textContent).toContain("已批准交接冻结。");
    expect(container.textContent).toContain("完成继任绑定");
    expect(container.textContent).not.toContain("阻塞项：请先填写继任员工邮箱，用于发送绑定确认。");

    const handoverCard = container.querySelector(".enterprise-handover-panel");
    expect(handoverCard).not.toBeNull();

    const textarea = handoverCard?.querySelector("textarea") as HTMLTextAreaElement | null;
    expect(textarea).toBeNull();

    const rebindButton = Array.from(container.querySelectorAll("button")).find(
      (entry) => entry.textContent?.trim() === "完成继任绑定",
    );
    expect(rebindButton?.disabled).toBe(false);
  });

  it("renders the mesh page through the new workforce governance surface", () => {
    const container = document.createElement("div");

    render(
      renderEnterpriseSurface({
        tab: "enterpriseMesh",
        basePath: "/openclaw",
        readModel: createReadModel(),
        actions: createActions(),
        authPanelProps: createAuthPanelProps({
          status: "trial",
          seatUsed: 1,
          seatQuota: 5,
        }),
        seatOfferEditor: createSeatOfferEditor(),
        handoverEditor: createHandoverEditor(),
      }),
      container,
    );

    expect(container.querySelector("governance-assets-page")).not.toBeNull();
  });

  it("shows the new governance queue shell on the mesh route", () => {
    const container = document.createElement("div");

    render(
      renderEnterpriseSurface({
        tab: "enterpriseMesh",
        basePath: "",
        readModel: createReadModel(),
        actions: createActions(),
        authPanelProps: createAuthPanelProps({
          status: "trial",
          seatUsed: 1,
          seatQuota: 5,
        }),
        seatOfferEditor: createSeatOfferEditor(),
        handoverEditor: createHandoverEditor(),
      }),
      container,
    );

    expect(container.querySelector("governance-assets-page")).not.toBeNull();
  });

  it("keeps the mesh route renderable with queue query state", () => {
    window.history.pushState(
      {},
      "",
      "/enterprise/acme/mesh/overview/agents/sales?queue=restrict&rankView=agent",
    );
    const container = document.createElement("div");

    render(
      renderEnterpriseSurface({
        tab: "enterpriseMesh",
        basePath: "",
        readModel: createReadModel(),
        actions: createActions(),
        authPanelProps: createAuthPanelProps({
          status: "trial",
          seatUsed: 1,
          seatQuota: 5,
        }),
        seatOfferEditor: createSeatOfferEditor(),
        handoverEditor: createHandoverEditor(),
      }),
      container,
    );

    expect(container.querySelector("governance-assets-page")).not.toBeNull();
  });

  it("keeps the mesh route renderable with ranking query state", () => {
    window.history.pushState(
      {},
      "",
      "/enterprise/acme/mesh/overview?rankView=agent&agentRank=efficiency",
    );
    const container = document.createElement("div");

    render(
      renderEnterpriseSurface({
        tab: "enterpriseMesh",
        basePath: "",
        readModel: createReadModel(),
        actions: createActions(),
        authPanelProps: createAuthPanelProps({
          status: "trial",
          seatUsed: 1,
          seatQuota: 5,
        }),
        seatOfferEditor: createSeatOfferEditor(),
        handoverEditor: createHandoverEditor(),
      }),
      container,
    );

    expect(container.querySelector("governance-assets-page")).not.toBeNull();
  });

  it("keeps the mesh route renderable with top-level tab query state", () => {
    window.history.pushState({}, "", "/enterprise/acme/mesh/overview?rankView=group");
    const container = document.createElement("div");

    render(
      renderEnterpriseSurface({
        tab: "enterpriseMesh",
        basePath: "",
        readModel: createReadModel(),
        actions: createActions(),
        authPanelProps: createAuthPanelProps({
          status: "trial",
          seatUsed: 1,
          seatQuota: 5,
        }),
        seatOfferEditor: createSeatOfferEditor(),
        handoverEditor: createHandoverEditor(),
      }),
      container,
    );

    expect(container.querySelector("governance-assets-page")).not.toBeNull();
  });

  it("keeps the mesh route renderable with governance filter query state", () => {
    window.history.pushState(
      {},
      "",
      "/enterprise/acme/mesh/overview?queue=owner&rankView=governance",
    );
    const container = document.createElement("div");

    render(
      renderEnterpriseSurface({
        tab: "enterpriseMesh",
        basePath: "",
        readModel: createReadModel(),
        actions: createActions(),
        authPanelProps: createAuthPanelProps({
          status: "trial",
          seatUsed: 1,
          seatQuota: 5,
        }),
        seatOfferEditor: createSeatOfferEditor(),
        handoverEditor: createHandoverEditor(),
      }),
      container,
    );

    expect(container.querySelector("governance-assets-page")).not.toBeNull();
  });

  it("keeps the mesh route renderable with deep-link style URLs", () => {
    window.history.pushState({}, "", "/enterprise/acme/mesh/overview/groups/group-a");
    const container = document.createElement("div");

    render(
      renderEnterpriseSurface({
        tab: "enterpriseMesh",
        basePath: "",
        readModel: createReadModel(),
        actions: createActions(),
        authPanelProps: createAuthPanelProps({
          status: "trial",
          seatUsed: 1,
          seatQuota: 5,
        }),
        seatOfferEditor: createSeatOfferEditor(),
        handoverEditor: createHandoverEditor(),
      }),
      container,
    );

    expect(container.querySelector("governance-assets-page")).not.toBeNull();
  });

  it("renders the cost & budget page with 4 visual tabs", () => {
    window.history.pushState({}, "", "/enterprise/acme/usage/overview");
    const container = document.createElement("div");

    render(
      renderEnterpriseSurface({
        tab: "enterpriseUsage",
        basePath: "",
        client: null,
        readModel: createReadModel(),
        actions: createActions(),
        authPanelProps: createAuthPanelProps({
          status: "trial",
          seatUsed: 1,
          seatQuota: 5,
        }),
        seatOfferEditor: createSeatOfferEditor(),
        handoverEditor: createHandoverEditor(),
      }),
      container,
    );

    expect(container.textContent).toContain("Cost & Budget");
    for (const label of ["Overview", "Plan & orders", "Seats", "Settings"]) {
      expect(container.textContent).toContain(label);
    }
    expect(container.textContent).not.toContain("Invoices");
    expect(container.querySelector('[data-testid="cost-budget-v2-page"]')).toBeTruthy();
  });

  it("switches cost budget v2 tab when settings is clicked", () => {
    resetCostBudgetV2NavigationState({
      route: "overview",
      planOrdersPanel: "catalog",
      settingsPanel: "budget",
    });
    window.history.pushState({}, "", "/enterprise/acme/usage/overview");
    const container = document.createElement("div");
    const surfaceProps = {
      tab: "enterpriseUsage" as const,
      basePath: "",
      client: null,
      readModel: createReadModel(),
      actions: createActions(),
      authPanelProps: createAuthPanelProps({
        status: "trial",
        seatUsed: 1,
        seatQuota: 5,
      }),
      seatOfferEditor: createSeatOfferEditor(),
      handoverEditor: createHandoverEditor(),
    };

    render(renderEnterpriseSurface(surfaceProps), container);
    const overviewTab = [
      ...container.querySelectorAll(
        '[data-testid="cost-budget-v2-page"] .enterprise-segmented-nav__tab',
      ),
    ].find((el) => el.textContent?.includes("Overview")) as HTMLButtonElement | undefined;
    expect(overviewTab?.getAttribute("aria-selected")).toBe("true");

    const settingsTab = [
      ...container.querySelectorAll(
        '[data-testid="cost-budget-v2-page"] .enterprise-segmented-nav__tab',
      ),
    ].find((el) => el.textContent?.includes("Settings")) as HTMLButtonElement | undefined;
    expect(settingsTab).toBeTruthy();
    settingsTab!.click();

    expect(window.location.pathname).toBe("/enterprise/acme/usage/settings");
    expect(getActiveCostBudgetV2Navigation().route).toBe("settings");

    render(renderEnterpriseSurface(surfaceProps), container);
    expect(container.querySelector('[data-testid="cost-budget-v2-settings-page"]')).toBeTruthy();
    expect(container.textContent).toContain("Gateway disconnected");
  });

  it("redirects the deprecated usage-management tab to the capability center surface", () => {
    // 模块已整合：旧 `enterpriseUsageManagement` tab 经 normalizeLegacyTab 落到能力中心 surface。
    window.history.pushState({}, "", "/enterprise/acme/capabilities?tab=robots");
    const container = document.createElement("div");
    const request = vi.fn(async () => ({
      items: [],
      pagination: { currentPage: 1, pageSize: 10, totalItems: 0 },
      kpis: {
        totalRobots: 0,
        totalMonthlyExecutions: 0,
        totalEmployeeCoverage: 0,
        averageSuccessRate: 0,
      },
      stats: {},
    }));
    const client = { request, connected: true } as never;

    render(
      renderEnterpriseSurface({
        tab: "enterpriseUsageManagement",
        basePath: "",
        client,
        readModel: createReadModel(),
        actions: createActions(),
        authPanelProps: createAuthPanelProps({ status: "trial", seatUsed: 1, seatQuota: 5 }),
        seatOfferEditor: createSeatOfferEditor(),
        handoverEditor: createHandoverEditor(),
      }),
      container,
    );

    // 能力中心 shell 渲染（而非已删除的 usage-management surface）。
    expect(container.querySelector(".enterprise-capability-center-shell")).not.toBeNull();
  });

  it("routes capability center entry buttons to the legacy capability management pages", () => {
    window.history.pushState({}, "", "/enterprise/acme/capabilities?view=high-value");
    const container = document.createElement("div");
    const request = vi.fn(async (method: string) => {
      switch (method) {
        case "enterprise-capability.stats":
          return {
            stats: {
              totalCapabilities: 3,
              publishedCapabilities: 2,
              coveredEmployees: 12,
              coveredRobots: 3,
              monthlyUsageCount: 88,
              changes: {
                totalCapabilities: { value: 1, type: "absolute" },
                publishedCapabilities: { value: 1, type: "absolute" },
                coveredEmployees: { value: 5, type: "percentage" },
                coveredRobots: { value: 1, type: "absolute" },
                monthlyUsageCount: { value: 8, type: "percentage" },
              },
              updatedAt: Date.now(),
            },
          };
        case "enterprise-capability.domain-distribution":
          return {
            domains: [
              {
                domain: "销售",
                capabilityCount: 1,
                representativeCapabilities: ["线索分析"],
                coverageRate: 33,
              },
            ],
          };
        case "enterprise-capability.list":
          return {
            items: [
              {
                id: "cap-1",
                name: "线索分析",
                description: "分析销售线索优先级",
                usageScenarios: ["销售跟进"],
                applicableScope: { kind: "enterprise" },
                domain: "销售",
                maturity: "企业认证",
                healthStatus: "效果稳定",
                lifecycle: "published",
                valueSummary: {
                  monthlyExecutions: 88,
                  departmentCoverageCount: 2,
                  reuseGrowthRate30d: 12,
                },
                reuseData: {
                  robotCount: 2,
                  employeeCount: 8,
                  departmentCount: 2,
                  trend30Days: Array.from({ length: 30 }, () => 3),
                  growthPercentage: 12,
                },
                sourceEmployeeName: "Owner",
                avatar: null,
              },
            ],
            pagination: { currentPage: 1, pageSize: 10, totalItems: 1 },
          };
        case "enterprise-capability.contribution-performance":
          return {
            items: [
              {
                employeeId: "owner",
                employeeName: "Owner",
                department: "销售部",
                totalContributions: 6,
                approvedCount: 5,
                approvalRate: 83,
                averageMaturityLevel: 4,
                totalReuseRobots: 2,
                totalReuseEmployees: 8,
                averageSuccessRate: 94,
              },
            ],
          };
        case "enterprise-capability.contribution-records":
          return {
            items: [],
            pagination: { currentPage: 1, pageSize: 20, totalItems: 0 },
          };
        case "enterprise-capability.install-management":
          return {
            items: [],
            pagination: { currentPage: 1, pageSize: 50, totalItems: 0 },
            summary: {
              adminPushCount: 0,
              employeeSelfInstallCount: 0,
              coveredRobotCount: 0,
              coveredCapabilityCount: 0,
              coveredPositionCount: 0,
            },
          };
        case "enterprise-usage.list-robot-capability-views":
          // 「安装与运行」合并 Tab 会同时预载机器人运行数据。
          return {
            items: [],
            pagination: { currentPage: 1, pageSize: 10, totalItems: 0 },
            kpis: {
              totalRobots: 0,
              totalMonthlyExecutions: 0,
              totalEmployeeCoverage: 0,
              averageSuccessRate: 0,
            },
          };
        default:
          throw new Error(`unexpected method ${method}`);
      }
    });
    const client = { request, connected: true } as never;

    render(
      renderEnterpriseSurface({
        tab: "enterpriseCapabilityCenter",
        basePath: "",
        client: client,
        readModel: createReadModel(),
        actions: createActions(),
        authPanelProps: createAuthPanelProps({
          status: "trial",
          seatUsed: 1,
          seatQuota: 5,
        }),
        seatOfferEditor: createSeatOfferEditor(),
        handoverEditor: createHandoverEditor(),
      }),
      container,
    );

    expect(request).toHaveBeenCalledWith("enterprise-capability.stats", expect.any(Object));
    expect(request).toHaveBeenCalledWith(
      "enterprise-capability.domain-distribution",
      expect.any(Object),
    );
    expect(request).toHaveBeenCalledWith("enterprise-capability.list", expect.any(Object));
    expect(request).not.toHaveBeenCalledWith(
      "enterprise-capability.contribution-performance",
      expect.any(Object),
    );
    expect(request).not.toHaveBeenCalledWith(
      "enterprise-capability.review-queue",
      expect.any(Object),
    );
    expect(request).not.toHaveBeenCalledWith(
      "enterprise-capability.install-management",
      expect.any(Object),
    );

    const leaderboardTab = Array.from(container.querySelectorAll("button")).find((entry) =>
      entry.textContent?.includes("贡献排行"),
    );
    expect(leaderboardTab).toBeDefined();
    leaderboardTab?.click();
    expect(window.location.search).toContain("tab=leaderboard");
    render(
      renderEnterpriseSurface({
        tab: "enterpriseCapabilityCenter",
        basePath: "",
        client: client,
        readModel: createReadModel(),
        actions: createActions(),
        authPanelProps: createAuthPanelProps({
          status: "trial",
          seatUsed: 1,
          seatQuota: 5,
        }),
        seatOfferEditor: createSeatOfferEditor(),
        handoverEditor: createHandoverEditor(),
      }),
      container,
    );
    expect(container.textContent).toContain("查看完整贡献绩效");
    expect(request).toHaveBeenCalledWith(
      "enterprise-capability.contribution-performance",
      expect.any(Object),
    );

    window.history.pushState({}, "", "/enterprise/acme/capabilities");
    render(
      renderEnterpriseSurface({
        tab: "enterpriseCapabilityCenter",
        basePath: "",
        client: client,
        readModel: createReadModel(),
        actions: createActions(),
        authPanelProps: createAuthPanelProps({
          status: "trial",
          seatUsed: 1,
          seatQuota: 5,
        }),
        seatOfferEditor: createSeatOfferEditor(),
        handoverEditor: createHandoverEditor(),
      }),
      container,
    );

    const installWorkbenchCard = container.querySelector<HTMLAnchorElement>(
      'a.enterprise-kpi-card[aria-label="管理安装"]',
    );
    expect(installWorkbenchCard).toBeTruthy();
    installWorkbenchCard?.click();
    expect(window.location.search).toContain("tab=install");

    window.history.pushState({}, "", "/enterprise/acme/capabilities/contribution-records");
    render(
      renderEnterpriseSurface({
        tab: "enterpriseCapabilityCenter",
        basePath: "",
        client: client,
        readModel: createReadModel(),
        actions: createActions(),
        authPanelProps: createAuthPanelProps({
          status: "trial",
          seatUsed: 1,
          seatQuota: 5,
        }),
        seatOfferEditor: createSeatOfferEditor(),
        handoverEditor: createHandoverEditor(),
      }),
      container,
    );
    expect(window.location.pathname).toBe("/enterprise/acme/capabilities/contribution-performance");
    expect(container.textContent).toContain("贡献流水");

    window.history.pushState({}, "", "/enterprise/acme/capabilities/install-management");
    render(
      renderEnterpriseSurface({
        tab: "enterpriseCapabilityCenter",
        basePath: "",
        client: client,
        readModel: createReadModel(),
        actions: createActions(),
        authPanelProps: createAuthPanelProps({
          status: "trial",
          seatUsed: 1,
          seatQuota: 5,
        }),
        seatOfferEditor: createSeatOfferEditor(),
        handoverEditor: createHandoverEditor(),
      }),
      container,
    );
    expect(window.location.search).toContain("tab=install");
    expect(window.location.pathname).toBe("/enterprise/acme/capabilities");
  });

  it("keeps capability center overview lazy and avoids secondary data preloads", () => {
    window.history.pushState({}, "", "/enterprise/acme/capabilities");
    const container = document.createElement("div");
    const request = vi.fn(async (method: string) => {
      switch (method) {
        case "enterprise-capability.stats":
          return {
            stats: {
              totalCapabilities: 3,
              publishedCapabilities: 2,
              coveredEmployees: 12,
              coveredRobots: 3,
              monthlyUsageCount: 88,
              changes: {
                totalCapabilities: { value: 1, type: "absolute" },
                publishedCapabilities: { value: 1, type: "absolute" },
                coveredEmployees: { value: 5, type: "percentage" },
                coveredRobots: { value: 1, type: "absolute" },
                monthlyUsageCount: { value: 8, type: "percentage" },
              },
              updatedAt: Date.now(),
            },
          };
        case "enterprise-capability.domain-distribution":
          return {
            domains: [
              {
                domain: "销售",
                capabilityCount: 1,
                representativeCapabilities: ["线索分析"],
                coverageRate: 33,
              },
            ],
          };
        case "enterprise-capability.list":
          return {
            items: [],
            pagination: { currentPage: 1, pageSize: 10, totalItems: 0 },
          };
        default:
          throw new Error(`unexpected method ${method}`);
      }
    });
    const client = { request, connected: true } as never;

    render(
      renderEnterpriseSurface({
        tab: "enterpriseCapabilityCenter",
        basePath: "",
        client,
        readModel: createReadModel(),
        actions: createActions(),
        authPanelProps: createAuthPanelProps({
          status: "trial",
          seatUsed: 1,
          seatQuota: 5,
        }),
        seatOfferEditor: createSeatOfferEditor(),
        handoverEditor: createHandoverEditor(),
      }),
      container,
    );

    const methods = request.mock.calls.map(([method]) => method).toSorted();
    expect(methods).toEqual(
      [
        "enterprise-capability.domain-distribution",
        "enterprise-capability.list",
        "enterprise-capability.stats",
      ].toSorted(),
    );
    expect(container.querySelector(".enterprise-capability-center-shell")).not.toBeNull();
    expect(container.textContent).toContain("待审核承接单");
  });

  it("routes capability center secondary pages from legacy entry points", async () => {
    window.history.pushState({}, "", "/enterprise/acme/capabilities?view=high-value");
    const container = document.createElement("div");
    const request = vi.fn(async (method: string) => {
      switch (method) {
        case "enterprise-capability.list":
          return {
            items: [
              {
                id: "cap-1",
                name: "线索分析",
                description: "分析销售线索优先级",
                usageScenarios: ["销售跟进"],
                applicableScope: { kind: "enterprise" },
                domain: "销售",
                maturity: "企业认证",
                healthStatus: "效果稳定",
                lifecycle: "published",
                valueSummary: {
                  monthlyExecutions: 88,
                  departmentCoverageCount: 2,
                  reuseGrowthRate30d: 12,
                },
                reuseData: {
                  robotCount: 2,
                  employeeCount: 8,
                  departmentCount: 2,
                  trend30Days: Array.from({ length: 30 }, () => 3),
                  growthPercentage: 12,
                },
                sourceEmployeeName: "Owner",
                avatar: null,
              },
            ],
            pagination: { currentPage: 1, pageSize: 10, totalItems: 1 },
          };
        case "enterprise-capability.stats":
          return {
            stats: {
              totalCapabilities: 1,
              publishedCapabilities: 1,
              coveredEmployees: 8,
              coveredRobots: 2,
              monthlyUsageCount: 88,
              changes: {
                totalCapabilities: { value: 0, type: "absolute" },
                publishedCapabilities: { value: 0, type: "absolute" },
                coveredEmployees: { value: 0, type: "percentage" },
                coveredRobots: { value: 0, type: "absolute" },
                monthlyUsageCount: { value: 0, type: "percentage" },
              },
              updatedAt: Date.now(),
            },
          };
        case "enterprise-capability.domain-distribution":
          return { domains: [] };
        case "enterprise-capability.contribution-performance":
          return { items: [] };
        case "enterprise-capability.detail":
          return {
            capability: {
              id: "cap-1",
              name: "线索分析",
              description: "分析销售线索优先级",
              usageScenarios: ["销售跟进"],
              applicableScope: { kind: "enterprise" },
              domain: "销售",
              maturity: "企业认证",
              healthStatus: "效果稳定",
              healthManualLock: false,
              healthNoTelemetry: false,
              lifecycle: "published",
              valueSummary: {
                monthlyExecutions: 88,
                departmentCoverageCount: 2,
                reuseGrowthRate30d: 12,
              },
              credibilityIndicators: {
                verifiedDepartments: ["销售部"],
                productionUsageDays: 45,
              },
              reuseData: {
                robotCount: 2,
                employeeCount: 8,
                departmentCount: 2,
                trend30Days: Array.from({ length: 30 }, () => 3),
                growthPercentage: 12,
              },
              source: {
                employee: { id: "owner", name: "Owner" },
                robot: { id: "main", name: "Main Agent" },
                task: { id: "task-1", summary: "分析线索优先级" },
              },
              provenance: {
                origin: "员工创建",
                createdBy: "Owner",
                createdAt: Date.now(),
                derivationChain: [],
              },
              contributionHistory: [],
              reviewHistory: [],
              avatar: null,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
          };
        default:
          throw new Error(`unexpected method ${method}`);
      }
    });
    const client = { request } as never;

    render(
      renderEnterpriseSurface({
        tab: "enterpriseCapabilityCenter",
        basePath: "",
        client: client,
        readModel: createReadModel(),
        actions: createActions(),
        authPanelProps: createAuthPanelProps({
          status: "trial",
          seatUsed: 1,
          seatQuota: 5,
        }),
        seatOfferEditor: createSeatOfferEditor(),
        handoverEditor: createHandoverEditor(),
      }),
      container,
    );

    expect(container.textContent).toContain("全部技能");
    expect(container.textContent).not.toContain("更多筛选");

    await vi.waitFor(() => {
      render(
        renderEnterpriseSurface({
          tab: "enterpriseCapabilityCenter",
          basePath: "",
          client: client,
          readModel: createReadModel(),
          actions: createActions(),
          authPanelProps: createAuthPanelProps({
            status: "trial",
            seatUsed: 1,
            seatQuota: 5,
          }),
          seatOfferEditor: createSeatOfferEditor(),
          handoverEditor: createHandoverEditor(),
        }),
        container,
      );
      expect(container.textContent).toContain("线索分析");
    });

    const detailButton = Array.from(container.querySelectorAll("button")).find(
      (entry) => entry.textContent?.trim() === "查看详情",
    );
    expect(detailButton).toBeDefined();
    detailButton?.click();

    await vi.waitFor(() => {
      render(
        renderEnterpriseSurface({
          tab: "enterpriseCapabilityCenter",
          basePath: "",
          client: client,
          readModel: createReadModel(),
          actions: createActions(),
          authPanelProps: createAuthPanelProps({
            status: "trial",
            seatUsed: 1,
            seatQuota: 5,
          }),
          seatOfferEditor: createSeatOfferEditor(),
          handoverEditor: createHandoverEditor(),
        }),
        container,
      );
      expect(request).toHaveBeenCalledWith(
        "enterprise-capability.detail",
        expect.objectContaining({ capabilityId: "cap-1" }),
      );
    });

    await vi.waitFor(() => {
      render(
        renderEnterpriseSurface({
          tab: "enterpriseCapabilityCenter",
          basePath: "",
          client: client,
          readModel: createReadModel(),
          actions: createActions(),
          authPanelProps: createAuthPanelProps({
            status: "trial",
            seatUsed: 1,
            seatQuota: 5,
          }),
          seatOfferEditor: createSeatOfferEditor(),
          handoverEditor: createHandoverEditor(),
        }),
        container,
      );
      expect(container.textContent).toContain("基本信息");
      expect(container.textContent).toContain("价值摘要");
    });

    // 点击"定义"标签查看溯源信息
    await vi.waitFor(() => {
      render(
        renderEnterpriseSurface({
          tab: "enterpriseCapabilityCenter",
          basePath: "",
          client: client,
          readModel: createReadModel(),
          actions: createActions(),
          authPanelProps: createAuthPanelProps({
            status: "trial",
            seatUsed: 1,
            seatQuota: 5,
          }),
          seatOfferEditor: createSeatOfferEditor(),
          handoverEditor: createHandoverEditor(),
        }),
        container,
      );
      expect(container.textContent).toContain("溯源信息");
    });
  });

  it("renders enterprise capability center jobs route with embedded cron panel", () => {
    window.history.pushState({}, "", "/enterprise/acme/capabilities/jobs");
    const container = document.createElement("div");

    render(
      renderEnterpriseSurface({
        tab: "enterpriseCapabilityCenter",
        basePath: "",
        client: null,
        readModel: createReadModel(),
        actions: createActions(),
        authPanelProps: createAuthPanelProps({
          status: "trial",
          seatUsed: 1,
          seatQuota: 5,
        }),
        seatOfferEditor: createSeatOfferEditor(),
        handoverEditor: createHandoverEditor(),
        cronProps: {
          basePath: "",
          loading: false,
          jobsLoadingMore: false,
          status: null,
          jobs: [],
          jobsTotal: 0,
          jobsHasMore: false,
          jobsQuery: "",
          jobsEnabledFilter: "all",
          jobsScheduleKindFilter: "all",
          jobsLastStatusFilter: "all",
          jobsSortBy: "nextRunAtMs",
          jobsSortDir: "asc",
          error: null,
          busy: false,
          form: {} as never,
          fieldErrors: {} as never,
          canSubmit: true,
          canManageJobs: true,
          canRunJobs: true,
          readOnlyReason: null,
          editingJobId: null,
          channels: [],
          channelLabels: {},
          channelMeta: [],
          runsJobId: null,
          runs: [],
          runsTotal: 0,
          runsHasMore: false,
          runsLoadingMore: false,
          runsScope: "all",
          runsStatuses: [],
          runsDeliveryStatuses: [],
          runsStatusFilter: "all",
          runsQuery: "",
          runsSortDir: "desc",
          agentSuggestions: [],
          modelSuggestions: [],
          thinkingSuggestions: [],
          timezoneSuggestions: [],
          deliveryToSuggestions: [],
          accountSuggestions: [],
          onFormChange: vi.fn(),
          onRefresh: vi.fn(),
          onAdd: vi.fn(),
          onEdit: vi.fn(),
          onClone: vi.fn(),
          onCancelEdit: vi.fn(),
          onToggle: vi.fn(),
          onRun: vi.fn(),
          onRemove: vi.fn(),
          onLoadRuns: vi.fn(),
          onLoadMoreJobs: vi.fn(),
          onJobsFiltersChange: vi.fn(),
          onJobsFiltersReset: vi.fn(),
          onLoadMoreRuns: vi.fn(),
          onRunsFiltersChange: vi.fn(),
        },
      }),
      container,
    );

    expect(container.textContent).toContain("定时任务");
  });

  it("loads incubation candidates and upstream report tracking on the incubation route", async () => {
    window.history.pushState({}, "", "/enterprise/acme/capabilities/incubation");
    const container = document.createElement("div");
    let hasSubmittedReport = false;
    const request = vi.fn(async (method: string) => {
      switch (method) {
        case "enterprise-capability.stats":
          return {
            stats: {
              totalCapabilities: 1,
              publishedCapabilities: 1,
              coveredEmployees: 8,
              coveredRobots: 2,
              monthlyUsageCount: 188,
              changes: {
                totalCapabilities: { value: 0, type: "absolute" },
                publishedCapabilities: { value: 0, type: "absolute" },
                coveredEmployees: { value: 0, type: "percentage" },
                coveredRobots: { value: 0, type: "absolute" },
                monthlyUsageCount: { value: 0, type: "percentage" },
              },
              updatedAt: Date.now(),
            },
          };
        case "enterprise-capability.domain-distribution":
          return { domains: [] };
        case "enterprise-capability.list":
          return {
            items: [],
            pagination: { currentPage: 1, pageSize: 50, totalItems: 0 },
          };
        case "enterprise-capability.contribution-performance":
          return { items: [] };
        case "incubation.candidate-pool":
          return {
            stats: {
              totalCandidates: 1,
              newThisMonth: 0,
              recommendedCount: hasSubmittedReport ? 1 : 0,
              platformApprovedCount: 0,
            },
            candidates: [
              {
                capabilityId: "cap-incubate",
                name: "销售复盘助手",
                maturity: "企业认证",
                calls30d: 188,
                departmentCount: 3,
                successRate: 0.92,
                domain: "销售",
                score: {
                  reuseBreath: 48,
                  effectStability: 92,
                  businessCoverage: 69,
                  employeeSatisfaction: null,
                  compositeScore: 70,
                },
              },
            ],
          };
        case "enterprise-capability.platform-submissions":
          return {
            reports: hasSubmittedReport
              ? [
                  {
                    reportId: "report-1",
                    capabilityId: "cap-incubate",
                    capabilityName: "销售复盘助手",
                    uploadedAt: Date.now(),
                    proposalStatus: "pending",
                  },
                ]
              : [],
          };
        case "incubation.decide":
          return { decisionId: "decision-1", succeeded: true };
        // P0 能力安装治理：脱敏流程 mock
        case "enterprise-capability.sanitization-preview":
          return {
            capabilityId: "cap-incubate",
            overallCompleteness: 0.5,
            totalFindings: 2,
            unresolvedFindings: 2,
            findings: [
              {
                id: "f-1",
                category: "company-name",
                severity: "medium",
                description: "发现公司名",
                count: 1,
                resolved: false,
                originalValue: "Test Inc.",
              },
              {
                id: "f-2",
                category: "internal-endpoint",
                severity: "high",
                description: "发现内部端点",
                count: 1,
                resolved: false,
                originalValue: "https://internal.test",
              },
            ],
            canProceed: false,
          };
        case "enterprise-capability.sanitization-confirm":
          return {
            capabilityId: "cap-incubate",
            sanitizationState: "complete",
            sanitizedPackageId: "spkg-123",
            appliedReplacements: 2,
            artifactHash: "sha256-abc123",
            canSubmitToPlatform: true,
          };
        case "enterprise-capability.submit-to-platform":
          hasSubmittedReport = true;
          return {
            capabilityId: "cap-incubate",
            submissionId: "sub-123",
            sanitizedPackageId: "spkg-123",
            artifactHash: "sha256-abc123",
            status: "submitted",
            submittedAt: Date.now(),
            message: "已提交平台审核队列",
          };
        default:
          throw new Error(`unexpected method ${method}`);
      }
    });
    const client = { request, connected: true } as never;

    render(
      renderEnterpriseSurface({
        tab: "enterpriseCapabilityCenter",
        basePath: "",
        client: client,
        readModel: createReadModel(),
        actions: createActions(),
        authPanelProps: createAuthPanelProps({
          status: "trial",
          seatUsed: 1,
          seatQuota: 5,
        }),
        seatOfferEditor: createSeatOfferEditor(),
        handoverEditor: createHandoverEditor(),
      }),
      container,
    );

    await vi.waitFor(() => {
      expect(request).toHaveBeenCalledWith(
        "incubation.candidate-pool",
        expect.objectContaining({ domainFilter: null, sortBy: "calls30d" }),
      );
      expect(request).toHaveBeenCalledWith("enterprise-capability.platform-submissions", {});
    });

    await vi.waitFor(() => {
      render(
        renderEnterpriseSurface({
          tab: "enterpriseCapabilityCenter",
          basePath: "",
          client: client,
          readModel: createReadModel(),
          actions: createActions(),
          authPanelProps: createAuthPanelProps({
            status: "trial",
            seatUsed: 1,
            seatQuota: 5,
          }),
          seatOfferEditor: createSeatOfferEditor(),
          handoverEditor: createHandoverEditor(),
        }),
        container,
      );

      expect(container.textContent).toContain("孵化中心");
      expect(container.textContent).toContain("销售复盘助手");
      expect(container.textContent).toContain("当前候选能力数");
      expect(container.textContent).toContain("推荐上报平台");
    });

    vi.spyOn(window, "confirm").mockReturnValue(true);
    container
      .querySelector<HTMLButtonElement>('button[aria-label="推荐 销售复盘助手 上报平台"]')
      ?.click();

    // P0 能力安装治理：脱敏流程替代旧的 incubation 路径
    await vi.waitFor(() => {
      expect(request).toHaveBeenCalledWith(
        "enterprise-capability.sanitization-preview",
        expect.objectContaining({
          capabilityId: "cap-incubate",
        }),
      );
      expect(request).toHaveBeenCalledWith(
        "enterprise-capability.sanitization-confirm",
        expect.objectContaining({
          capabilityId: "cap-incubate",
          replacements: expect.any(Array),
        }),
      );
      expect(request).toHaveBeenCalledWith(
        "enterprise-capability.submit-to-platform",
        expect.objectContaining({
          capabilityId: "cap-incubate",
          capabilityName: "销售复盘助手",
        }),
      );
    });

    await vi.waitFor(() => {
      render(
        renderEnterpriseSurface({
          tab: "enterpriseCapabilityCenter",
          basePath: "",
          client: client,
          readModel: createReadModel(),
          actions: createActions(),
          authPanelProps: createAuthPanelProps({
            status: "trial",
            seatUsed: 1,
            seatQuota: 5,
          }),
          seatOfferEditor: createSeatOfferEditor(),
          handoverEditor: createHandoverEditor(),
        }),
        container,
      );
      expect(container.textContent).toContain("已推荐上报");
      expect(container.textContent).toContain("待审批");
    });
  });

  it("waits for gateway connection before loading incubation route data", () => {
    window.history.pushState({}, "", "/enterprise/acme/capabilities/incubation");
    const container = document.createElement("div");
    const request = vi.fn(async (method: string) => {
      switch (method) {
        case "enterprise-capability.stats":
          return {
            stats: {
              totalCapabilities: 0,
              publishedCapabilities: 0,
              coveredEmployees: 0,
              coveredRobots: 0,
              monthlyUsageCount: 0,
              changes: {
                totalCapabilities: { value: 0, type: "absolute" },
                publishedCapabilities: { value: 0, type: "absolute" },
                coveredEmployees: { value: 0, type: "absolute" },
                coveredRobots: { value: 0, type: "absolute" },
                monthlyUsageCount: { value: 0, type: "absolute" },
              },
              updatedAt: Date.now(),
            },
          };
        case "enterprise-capability.domain-distribution":
          return { domains: [] };
        case "enterprise-capability.list":
          return {
            items: [],
            pagination: { currentPage: 1, pageSize: 50, totalItems: 0 },
          };
        case "enterprise-capability.contribution-performance":
          return { items: [] };
        default:
          throw new Error(`unexpected method ${method}`);
      }
    });
    const client = { request, connected: false } as never;

    render(
      renderEnterpriseSurface({
        tab: "enterpriseCapabilityCenter",
        basePath: "",
        client,
        readModel: createReadModel(),
        actions: createActions(),
        authPanelProps: createAuthPanelProps({
          status: "trial",
          seatUsed: 1,
          seatQuota: 5,
        }),
        seatOfferEditor: createSeatOfferEditor(),
        handoverEditor: createHandoverEditor(),
      }),
      container,
    );

    const incubationCalls = request.mock.calls.filter(
      ([method]) =>
        String(method).startsWith("incubation.") || String(method).startsWith("upstream."),
    );
    expect(incubationCalls).toHaveLength(0);
    expect(container.textContent).toContain("正在连接企业能力数据");
    expect(container.textContent).not.toContain("gateway not connected");
  });

  it("keeps incubation tracking usable when the running gateway lacks upstream report handlers", async () => {
    window.history.pushState({}, "", "/enterprise/acme/capabilities/incubation");
    const container = document.createElement("div");
    const request = vi.fn(async (method: string) => {
      switch (method) {
        case "enterprise-capability.stats":
          return {
            stats: {
              totalCapabilities: 0,
              publishedCapabilities: 0,
              coveredEmployees: 0,
              coveredRobots: 0,
              monthlyUsageCount: 0,
              changes: {
                totalCapabilities: { value: 0, type: "absolute" },
                publishedCapabilities: { value: 0, type: "absolute" },
                coveredEmployees: { value: 0, type: "absolute" },
                coveredRobots: { value: 0, type: "absolute" },
                monthlyUsageCount: { value: 0, type: "absolute" },
              },
              updatedAt: Date.now(),
            },
          };
        case "enterprise-capability.domain-distribution":
          return { domains: [] };
        case "enterprise-capability.list":
          return {
            items: [],
            pagination: { currentPage: 1, pageSize: 50, totalItems: 0 },
          };
        case "enterprise-capability.contribution-performance":
          return { items: [] };
        case "incubation.candidate-pool":
          return {
            stats: {
              totalCandidates: 0,
              newThisMonth: 0,
              recommendedCount: 0,
              platformApprovedCount: 0,
            },
            candidates: [],
          };
        case "enterprise-capability.platform-submissions":
          throw new Error("unknown method: enterprise-capability.platform-submissions");
        default:
          throw new Error(`unexpected method ${method}`);
      }
    });
    const client = { request, connected: true } as never;

    render(
      renderEnterpriseSurface({
        tab: "enterpriseCapabilityCenter",
        basePath: "",
        client,
        readModel: createReadModel(),
        actions: createActions(),
        authPanelProps: createAuthPanelProps({
          status: "trial",
          seatUsed: 1,
          seatQuota: 5,
        }),
        seatOfferEditor: createSeatOfferEditor(),
        handoverEditor: createHandoverEditor(),
      }),
      container,
    );

    await vi.waitFor(() => {
      expect(request).toHaveBeenCalledWith("enterprise-capability.platform-submissions", {});
    });
    await vi.waitFor(() => {
      render(
        renderEnterpriseSurface({
          tab: "enterpriseCapabilityCenter",
          basePath: "",
          client,
          readModel: createReadModel(),
          actions: createActions(),
          authPanelProps: createAuthPanelProps({
            status: "trial",
            seatUsed: 1,
            seatQuota: 5,
          }),
          seatOfferEditor: createSeatOfferEditor(),
          handoverEditor: createHandoverEditor(),
        }),
        container,
      );
      expect(container.textContent).toContain("暂无上报记录");
      expect(container.textContent).not.toContain("unknown method");
      expect(container.textContent).not.toContain("上报记录加载失败");
    });
  });

  it("keeps capability center legacy navigation semantics across overview, all, and install pages", async () => {
    window.history.pushState({}, "", "/enterprise/acme/capabilities?view=high-value");
    const container = document.createElement("div");
    const request = vi.fn(async (method: string) => {
      switch (method) {
        case "enterprise-capability.stats":
          return {
            stats: {
              totalCapabilities: 2,
              publishedCapabilities: 2,
              coveredEmployees: 8,
              coveredRobots: 2,
              monthlyUsageCount: 42,
              changes: {
                totalCapabilities: { value: 0, type: "absolute" },
                publishedCapabilities: { value: 0, type: "absolute" },
                coveredEmployees: { value: 0, type: "percentage" },
                coveredRobots: { value: 0, type: "absolute" },
                monthlyUsageCount: { value: 0, type: "percentage" },
              },
              updatedAt: Date.now(),
            },
          };
        case "enterprise-capability.domain-distribution":
          return { domains: [] };
        case "enterprise-capability.contribution-performance":
          return { items: [] };
        case "enterprise-capability.list":
          return {
            items: [
              {
                id: "cap-1",
                name: "线索分析",
                description: "分析销售线索优先级",
                usageScenarios: ["销售跟进"],
                applicableScope: { kind: "enterprise" },
                domain: "销售",
                maturity: "企业认证",
                healthStatus: "效果稳定",
                lifecycle: "published",
                valueSummary: {
                  monthlyExecutions: 42,
                  departmentCoverageCount: 2,
                  reuseGrowthRate30d: 8,
                },
                reuseData: {
                  robotCount: 2,
                  employeeCount: 8,
                  departmentCount: 2,
                  trend30Days: Array.from({ length: 30 }, () => 2),
                  growthPercentage: 8,
                },
                sourceEmployeeName: "Owner",
                avatar: null,
              },
            ],
            pagination: { currentPage: 1, pageSize: 10, totalItems: 1 },
          };
        case "enterprise-capability.install-management":
          return {
            items: [],
            pagination: { currentPage: 1, pageSize: 50, totalItems: 0 },
            summary: {
              adminPushCount: 0,
              employeeSelfInstallCount: 0,
              coveredRobotCount: 0,
              coveredCapabilityCount: 0,
              coveredPositionCount: 0,
            },
          };
        case "enterprise-capability.review-queue":
          return {
            items: [],
            pagination: { currentPage: 1, pageSize: 20, totalItems: 0 },
          };
        default:
          throw new Error(`unexpected method ${method}`);
      }
    });
    const client = { request } as never;

    render(
      renderEnterpriseSurface({
        tab: "enterpriseCapabilityCenter",
        basePath: "",
        client: client,
        readModel: createReadModel(),
        actions: createActions(),
        authPanelProps: createAuthPanelProps({
          status: "trial",
          seatUsed: 1,
          seatQuota: 5,
        }),
        seatOfferEditor: createSeatOfferEditor(),
        handoverEditor: createHandoverEditor(),
      }),
      container,
    );

    await vi.waitFor(() => {
      render(
        renderEnterpriseSurface({
          tab: "enterpriseCapabilityCenter",
          basePath: "",
          client: client,
          readModel: createReadModel(),
          actions: createActions(),
          authPanelProps: createAuthPanelProps({
            status: "trial",
            seatUsed: 1,
            seatQuota: 5,
          }),
          seatOfferEditor: createSeatOfferEditor(),
          handoverEditor: createHandoverEditor(),
        }),
        container,
      );
      expect(container.textContent).toContain("全部技能");
      expect(container.querySelector("#skills")).not.toBeNull();
    });

    const viewSkillsCard = container.querySelector<HTMLAnchorElement>(
      'a.enterprise-kpi-card[aria-label="查看技能列表"]',
    );
    expect(viewSkillsCard).toBeTruthy();
    viewSkillsCard?.click();
    expect(window.location.pathname).toBe("/enterprise/acme/capabilities");
    expect(window.location.search).not.toContain("tab=");

    window.history.pushState({}, "", "/enterprise/acme/capabilities/all");
    render(
      renderEnterpriseSurface({
        tab: "enterpriseCapabilityCenter",
        basePath: "",
        client: client,
        readModel: createReadModel(),
        actions: createActions(),
        authPanelProps: createAuthPanelProps({
          status: "trial",
          seatUsed: 1,
          seatQuota: 5,
        }),
        seatOfferEditor: createSeatOfferEditor(),
        handoverEditor: createHandoverEditor(),
      }),
      container,
    );
    expect(window.location.pathname).toBe("/enterprise/acme/capabilities");
    expect(container.querySelector("#skills")).not.toBeNull();
    expect(container.querySelector(".enterprise-capability-center-page__scope-switch")).toBeNull();
  });

  it("broadcasts employee asset refresh after approving an enterprise review task", async () => {
    window.history.pushState({}, "", "/enterprise/acme/capabilities/review-queue");
    const container = document.createElement("div");
    const refreshSignal = vi.fn();
    window.addEventListener("openbot:employee-asset-status-changed", refreshSignal);
    const request = vi.fn(async (method: string) => {
      switch (method) {
        case "enterprise-capability.stats":
          return {
            stats: {
              totalCapabilities: 0,
              publishedCapabilities: 0,
              coveredEmployees: 0,
              coveredRobots: 0,
              monthlyUsageCount: 0,
              changes: {},
            },
          };
        case "enterprise-capability.domain-distribution":
          return { domains: [] };
        case "enterprise-capability.list":
          return {
            items: [],
            pagination: { currentPage: 1, pageSize: 50, totalItems: 0 },
          };
        case "enterprise-capability.contribution-performance":
          return { items: [] };
        case "enterprise-capability.review-queue":
          return {
            items: [
              {
                item: {
                  id: "review-1",
                  capabilityId: "cap-1",
                  capabilityName: "销售客户周报模版",
                  capabilitySummary: "用于周会前整理客户进展与风险",
                  usageScenarios: ["销售"],
                  sourceEmployee: { id: "alice@example.com", name: "Alice" },
                  sourceRobot: { id: "sales-assistant", name: "销售助手" },
                  sourceTaskSummary: "客户周报整理",
                  usageCount: 12,
                  robotCount: 1,
                  lastUsedAt: null,
                  submittedAt: 1_700_000_000_000,
                  status: "待审核",
                  enterpriseAssetPackage: {
                    packageTitle: "公众号文章编辑与发布",
                    packageSummary: "用于整理、生成并发布公众号文章的复合资产包",
                    assetPackageType: "composite_pack",
                    businessScenario: "公众号文章编辑与发布",
                    inputArtifacts: ["标题", "正文 Markdown"],
                    outputArtifacts: ["已发布文章", "发布记录"],
                    dependencies: ["publish.js", "wechat-config.md"],
                    executionMode: "semi_automatic",
                    riskTags: ["external_publish", "credential_required", "brand_risk"],
                    targetTeams: ["市场", "新媒体"],
                    verifiedInProduction: true,
                    promotionIntent: "enterprise_standard",
                    needsEnterpriseSecrets: true,
                    notes: "需企业统一托管公众号凭证",
                  },
                },
                assessment: {
                  security: {
                    sensitiveInfo: false,
                    dangerousOps: false,
                    externalCalls: false,
                    permissionRisk: false,
                  },
                  quality: {
                    successRate30d: 96,
                    robotCount: 1,
                    employeeCount: 3,
                    namingCompliant: true,
                  },
                },
              },
            ],
            pagination: { currentPage: 1, pageSize: 20, totalItems: 1 },
          };
        case "enterprise-capability.review":
          return {
            reviewTaskId: "review-1",
            capabilityId: "cap-1",
            record: {
              id: "review-record-1",
              reviewerId: "enterprise-admin",
              reviewerName: "企业管理员",
              timestamp: Date.now(),
              result: "通过",
              opinion: "适合进入企业资产库",
            },
          };
        default:
          throw new Error(`unexpected method ${method}`);
      }
    });
    const client = { request, connected: true } as never;

    try {
      render(
        renderEnterpriseSurface({
          tab: "enterpriseCapabilityCenter",
          basePath: "",
          client,
          readModel: createReadModel(),
          actions: createActions(),
          authPanelProps: createAuthPanelProps({
            status: "trial",
            seatUsed: 1,
            seatQuota: 5,
          }),
          seatOfferEditor: createSeatOfferEditor(),
          handoverEditor: createHandoverEditor(),
        }),
        container,
      );

      await vi.waitFor(() => {
        render(
          renderEnterpriseSurface({
            tab: "enterpriseCapabilityCenter",
            basePath: "",
            client,
            readModel: createReadModel(),
            actions: createActions(),
            authPanelProps: createAuthPanelProps({
              status: "trial",
              seatUsed: 1,
              seatQuota: 5,
            }),
            seatOfferEditor: createSeatOfferEditor(),
            handoverEditor: createHandoverEditor(),
          }),
          container,
        );
        expect(container.textContent).toContain("销售客户周报模版");
        expect(container.textContent).toContain("公众号文章编辑与发布");
        expect(container.textContent).toContain("composite_pack");
        expect(container.textContent).toContain("semi_automatic");
      });

      const approveButton = Array.from(container.querySelectorAll("button")).find(
        (entry) => entry.textContent?.trim() === "通过",
      );
      expect(approveButton).toBeDefined();
      const executionSelect = container.querySelector<HTMLSelectElement>(
        'select[data-review-field="executionMode"]',
      );
      expect(executionSelect).not.toBeNull();
      executionSelect!.value = "semi_automatic";
      executionSelect!.dispatchEvent(new Event("change", { bubbles: true }));
      const secretsCheckbox = container.querySelector<HTMLInputElement>(
        'input[data-review-field="needsEnterpriseSecrets"]',
      );
      expect(secretsCheckbox).not.toBeNull();
      secretsCheckbox!.checked = true;
      const incubationCheckbox = container.querySelector<HTMLInputElement>(
        'input[data-review-field="promoteToIncubation"]',
      );
      expect(incubationCheckbox).not.toBeNull();
      incubationCheckbox!.checked = true;
      approveButton?.click();

      await vi.waitFor(() => {
        expect(request).toHaveBeenCalledWith(
          "enterprise-capability.review",
          expect.objectContaining({
            reviewTaskId: "review-1",
            result: "通过",
            approval: expect.objectContaining({
              executionMode: "semi_automatic",
              needsEnterpriseSecrets: true,
              promoteToIncubation: true,
            }),
          }),
        );
      });

      await vi.waitFor(() => {
        expect(refreshSignal).toHaveBeenCalledTimes(1);
      });

      await vi.waitFor(() => {
        render(
          renderEnterpriseSurface({
            tab: "enterpriseCapabilityCenter",
            basePath: "",
            client,
            readModel: createReadModel(),
            actions: createActions(),
            authPanelProps: createAuthPanelProps({
              status: "trial",
              seatUsed: 1,
              seatQuota: 5,
            }),
            seatOfferEditor: createSeatOfferEditor(),
            handoverEditor: createHandoverEditor(),
          }),
          container,
        );
        expect(container.textContent).toContain("员工端“我的资产”会同步显示正式资产状态");
      });
    } finally {
      window.removeEventListener("openbot:employee-asset-status-changed", refreshSignal);
    }
  });

  it("switches capability center top-level views through the view query parameter", () => {
    window.history.pushState({}, "", "/enterprise/acme/capabilities?view=domains");
    const container = document.createElement("div");
    const request = vi.fn(async (method: string) => {
      switch (method) {
        case "enterprise-capability.stats":
          return {
            stats: {
              totalCapabilities: 1,
              publishedCapabilities: 1,
              coveredEmployees: 8,
              coveredRobots: 2,
              monthlyUsageCount: 42,
              changes: {
                totalCapabilities: { value: 0, type: "absolute" },
                publishedCapabilities: { value: 0, type: "absolute" },
                coveredEmployees: { value: 0, type: "percentage" },
                coveredRobots: { value: 0, type: "absolute" },
                monthlyUsageCount: { value: 0, type: "percentage" },
              },
              updatedAt: Date.now(),
            },
          };
        case "enterprise-capability.domain-distribution":
          return {
            domains: [
              {
                domain: "销售",
                capabilityCount: 1,
                representativeCapabilities: ["线索分析"],
                coverageRate: 100,
              },
            ],
          };
        case "enterprise-capability.list":
          return {
            items: [
              {
                id: "cap-1",
                name: "线索分析",
                description: "分析销售线索优先级",
                usageScenarios: ["销售跟进"],
                applicableScope: { kind: "enterprise" },
                domain: "销售",
                maturity: "企业认证",
                healthStatus: "效果稳定",
                lifecycle: "published",
                valueSummary: {
                  monthlyExecutions: 42,
                  departmentCoverageCount: 2,
                  reuseGrowthRate30d: 8,
                },
                reuseData: {
                  robotCount: 2,
                  employeeCount: 8,
                  departmentCount: 2,
                  trend30Days: Array.from({ length: 30 }, () => 2),
                  growthPercentage: 8,
                },
                sourceEmployeeName: "Owner",
                avatar: null,
              },
            ],
            pagination: { currentPage: 1, pageSize: 10, totalItems: 1 },
          };
        case "enterprise-capability.contribution-performance":
          return { items: [] };
        default:
          throw new Error(`unexpected method ${method}`);
      }
    });
    const client = { request } as never;

    render(
      renderEnterpriseSurface({
        tab: "enterpriseCapabilityCenter",
        basePath: "",
        client: client,
        readModel: createReadModel(),
        actions: createActions(),
        authPanelProps: createAuthPanelProps({
          status: "trial",
          seatUsed: 1,
          seatQuota: 5,
        }),
        seatOfferEditor: createSeatOfferEditor(),
        handoverEditor: createHandoverEditor(),
      }),
      container,
    );

    expect(container.textContent).toContain("能力领域");
    expect(container.querySelector("#skills")).not.toBeNull();
    expect(container.querySelector("#domains")).toBeNull();
  });

  it("renders the capability center disconnected notice when there is no gateway client", () => {
    // 旧「能力应用管理」登录态拦截已随模块整合移除；能力中心用数据未连接提示兜底。
    window.history.pushState({}, "", "/enterprise/acme/capabilities?tab=robots");
    const container = document.createElement("div");
    const readModel = {
      ...createReadModel(),
      connected: false,
      lastError: "unauthorized",
      authenticatedUser: null,
      membershipRole: null,
    };
    const authPanelProps = createAuthPanelProps({
      status: "trial",
      seatUsed: 1,
      seatQuota: 5,
    });

    render(
      renderEnterpriseSurface({
        tab: "enterpriseUsageManagement",
        basePath: "",
        client: null,
        readModel,
        actions: createActions(),
        authPanelProps,
        seatOfferEditor: createSeatOfferEditor(),
        handoverEditor: createHandoverEditor(),
      }),
      container,
    );

    // 落到能力中心 shell，并展示数据未连接提示。
    expect(container.querySelector(".enterprise-capability-center-shell")).not.toBeNull();
    expect(container.textContent).toContain("企业数据未连接");
  });

  it("classifies gateway auth failures separately from missing enterprise data", () => {
    window.history.pushState({}, "", "/enterprise/acme");
    const container = document.createElement("div");
    const readModel = {
      ...createReadModel(),
      connected: false,
      authenticatedUser: null,
      bootstrapAuthMode: "trusted-proxy" as const,
      lastError:
        "unauthorized: platform session missing (sign in through platform or enterprise login, then refresh)",
    };

    render(
      renderEnterpriseSurface({
        tab: "enterpriseOverview",
        basePath: "",
        client: null,
        readModel,
        actions: createActions(),
        authPanelProps: createAuthPanelProps({
          status: "trial",
          seatUsed: 1,
          seatQuota: 5,
        }),
        seatOfferEditor: createSeatOfferEditor(),
        handoverEditor: createHandoverEditor(),
      }),
      container,
    );

    expect(container.textContent).toContain("Gateway 认证未完成");
    expect(container.textContent).toContain("平台或反向代理登录");
    expect(container.textContent).not.toContain("Control UI 设置");
  });

  it("classifies legacy token auth failures separately from missing enterprise data", () => {
    window.history.pushState({}, "", "/enterprise/acme");
    const container = document.createElement("div");
    const readModel = {
      ...createReadModel(),
      connected: false,
      bootstrapAuthMode: "token" as const,
      lastError:
        "unauthorized: gateway token missing (open the dashboard URL and paste the token in Control UI settings)",
    };

    render(
      renderEnterpriseSurface({
        tab: "enterpriseOverview",
        basePath: "",
        client: null,
        readModel,
        actions: createActions(),
        authPanelProps: createAuthPanelProps({
          status: "trial",
          seatUsed: 1,
          seatQuota: 5,
        }),
        seatOfferEditor: createSeatOfferEditor(),
        handoverEditor: createHandoverEditor(),
      }),
      container,
    );

    expect(container.textContent).toContain("Gateway 认证未完成");
    expect(container.textContent).toContain("Control UI 设置");
  });

  it("renders creator governance candidates in mesh agent detail", () => {
    window.history.pushState({}, "", "/enterprise/acme/mesh/overview/agents/main");
    const container = document.createElement("div");

    render(
      renderEnterpriseSurface({
        tab: "enterpriseMesh",
        basePath: "",
        readModel: createReadModel(),
        actions: createActions(),
        authPanelProps: createAuthPanelProps({
          status: "trial",
          seatUsed: 1,
          seatQuota: 5,
        }),
        seatOfferEditor: createSeatOfferEditor(),
        handoverEditor: createHandoverEditor(),
      }),
      container,
    );

    expect(container.querySelector("governance-assets-page")).not.toBeNull();
  });

  it("renders the new mesh experience on agent-style deep links", () => {
    window.history.pushState({}, "", "/enterprise/acme/mesh/overview/agents/main");
    const container = document.createElement("div");

    render(
      renderEnterpriseSurface({
        tab: "enterpriseMesh",
        basePath: "",
        readModel: createReadModel(),
        actions: createActions(),
        authPanelProps: createAuthPanelProps({
          status: "trial",
          seatUsed: 1,
          seatQuota: 5,
        }),
        seatOfferEditor: createSeatOfferEditor(),
        handoverEditor: createHandoverEditor(),
      }),
      container,
    );

    expect(container.querySelector("governance-assets-page")).not.toBeNull();
  });

  it("keeps the new mesh experience renderable with ownership transfer context", () => {
    window.history.pushState({}, "", "/enterprise/acme/mesh/overview/agents/main");
    const container = document.createElement("div");
    const readModel = createReadModel();
    const ownershipTransferEditor = createOwnershipTransferEditor();
    readModel.memberSummaries = [
      ...readModel.memberSummaries,
      {
        user: "successor@example.com",
        displayLabel: "Successor",
        membershipRole: "member",
        status: "active",
        seatTitle: "Growth Lead",
        seatStatus: "occupied",
        seatTeamLabel: null,
      },
    ];

    render(
      renderEnterpriseSurface({
        tab: "enterpriseMesh",
        basePath: "",
        readModel,
        actions: createActions(),
        authPanelProps: createAuthPanelProps({
          status: "trial",
          seatUsed: 1,
          seatQuota: 5,
        }),
        seatOfferEditor: createSeatOfferEditor(),
        handoverEditor: createHandoverEditor(),
        ownershipTransferEditor,
      }),
      container,
    );

    expect(container.querySelector("governance-assets-page")).not.toBeNull();
  });

  it("triggers revoke ownership action from organization group table", () => {
    window.history.pushState({}, "", "/enterprise/acme/organization?organizationView=group");
    const container = document.createElement("div");
    const actions = createActions();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    render(
      renderEnterpriseSurface({
        tab: "enterpriseOrganization",
        basePath: "",
        readModel: createReadModel(),
        actions,
        authPanelProps: createAuthPanelProps({
          status: "trial",
          seatUsed: 1,
          seatQuota: 5,
        }),
        seatOfferEditor: createSeatOfferEditor(),
        handoverEditor: createHandoverEditor(),
        ownershipTransferEditor: createOwnershipTransferEditor(),
      }),
      container,
    );

    const revokeButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (entry) => entry.textContent?.trim() === "解绑小组归属",
    );
    expect(revokeButton).toBeDefined();
    revokeButton?.click();

    expect(actions.organization.onRevokeOwnership).toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("renders the new mesh page element on people deep links", () => {
    window.history.pushState({}, "", "/enterprise/acme/mesh/overview/people/owner%40example.com");
    const container = document.createElement("div");

    render(
      renderEnterpriseSurface({
        tab: "enterpriseMesh",
        basePath: "",
        readModel: createReadModel(),
        actions: createActions(),
        authPanelProps: createAuthPanelProps({
          status: "trial",
          seatUsed: 1,
          seatQuota: 5,
        }),
        seatOfferEditor: createSeatOfferEditor(),
        handoverEditor: createHandoverEditor(),
      }),
      container,
    );

    expect(container.querySelector("governance-assets-page")).not.toBeNull();
  });

  it("renders access control center in settings and supports matrix filtering", () => {
    window.history.pushState(
      {},
      "",
      "/enterprise/acme/settings?accessView=matrix&accessMatrix=risk",
    );
    const container = document.createElement("div");

    render(
      renderEnterpriseSurface({
        tab: "enterpriseSettings",
        basePath: "",
        readModel: createReadModel(),
        actions: createActions(),
        authPanelProps: createAuthPanelProps({
          status: "trial",
          seatUsed: 1,
          seatQuota: 5,
        }),
        accessControlEditor: createAccessControlEditor(),
        seatOfferEditor: createSeatOfferEditor(),
        handoverEditor: createHandoverEditor(),
      }),
      container,
    );

    expect(container.textContent).toContain("System Settings");
    expect(container.textContent).toContain("企业信息");
    expect(container.textContent).toContain("管理员");
    const settingsTabs = [
      ...(container
        .querySelector(".enterprise-settings-shell .enterprise-segmented-nav")
        ?.querySelectorAll('[role="tab"]') ?? []),
    ].map((tab) => tab.textContent?.trim());
    expect(settingsTabs).toContain("模型管理");
    expect(settingsTabs).not.toContain("模型与密钥");
    expect(settingsTabs).not.toContain("集成");
    expect(container.textContent).toContain("企业身份");
    expect(container.textContent).toContain("企业通道");
    expect(container.textContent).toContain("安全");
    expect(container.querySelector(".enterprise-settings-shell")).not.toBeNull();
    expect(container.querySelector(".enterprise-settings-hub")).toBeNull();
    expect(
      container.querySelectorAll('.enterprise-segmented-nav [role="tab"]').length,
    ).toBeGreaterThanOrEqual(7);
  });

  it("opens the add-provider editor without refreshing the page", async () => {
    window.history.pushState({}, "", "/enterprise/acme/settings/integrations?modelsView=keys");
    const container = document.createElement("div");
    const actions = createActions();
    render(
      renderEnterpriseSurface({
        tab: "enterpriseSettings",
        basePath: "",
        readModel: createReadModel(),
        actions,
        client: { connected: false } as never,
        authPanelProps: createAuthPanelProps({ status: "trial", seatUsed: 1, seatQuota: 5 }),
        accessControlEditor: createAccessControlEditor(),
        seatOfferEditor: createSeatOfferEditor(),
        handoverEditor: createHandoverEditor(),
      }),
      container,
    );
    document.body.append(container);

    const editorHost = container.querySelector("enterprise-integrations-providers") as
      | (HTMLElement & { updateComplete?: Promise<unknown> })
      | null;
    await editorHost?.updateComplete;
    expect(container.textContent).toContain("模型与 API Key");
    expect(container.textContent).toContain("模型名称");
    expect(container.textContent).toContain("席位配置");
    expect(container.textContent).toContain("套餐下发 · 只读");
    expect(container.textContent).toContain("平台提供");
    expect(container.textContent).not.toContain("密钥已配置");
    expect(container.querySelector("model-authorization-section")).toBeNull();
    expect(container.textContent).toContain("模型授权");
    expect(container.textContent).toContain("模型与 API Key");
    expect(container.textContent).not.toMatch(/Slack|GitHub Connect|Linear/);

    const add = container.querySelector("[data-testid='enterprise-add-provider']");
    expect(add).not.toBeNull();
    (add as HTMLButtonElement).click();
    await editorHost?.updateComplete;
    expect(container.querySelector("[data-testid='enterprise-provider-editor']")).not.toBeNull();
    expect(actions.settings.onRefresh).not.toHaveBeenCalled();
    expect(actions.settings.onRefreshIntegrations).not.toHaveBeenCalled();
    container.remove();
  });

  it("splits model settings into org authorization and API keys", async () => {
    __resetModelAuthorizationGrantsCacheForTest();
    window.history.pushState({}, "", "/enterprise/acme/settings/integrations");
    const container = document.createElement("div");
    const client = {
      connected: true,
      request: vi.fn(async (method: string) => {
        if (method !== "enterprise-model-grant.list") {
          throw new Error(`unexpected ${method}`);
        }
        return {
          entitlement: { tenantId: "acme", allowedModelIds: ["p/a", "p/b"], updatedAt: "x" },
          allowedModelIds: ["p/a", "p/b"],
          ceilingModelIds: ["p/a", "p/b"],
          grants: [
            {
              tenantId: "acme",
              subjectType: "seat",
              subjectId: "seat-1",
              grantedModelIds: ["p/a"],
              status: "active",
              updatedAt: "2026-08-07T14:37:48.038Z",
            },
            {
              tenantId: "acme",
              subjectType: "seat",
              subjectId: "seat-orphan",
              grantedModelIds: ["p/outside"],
              status: "active",
              updatedAt: "x",
            },
          ],
        };
      }),
    };
    const renderSurface = () => {
      render(
        renderEnterpriseSurface({
          tab: "enterpriseSettings",
          basePath: "",
          readModel: createReadModel(),
          actions: createActions(),
          client: client as never,
          authPanelProps: createAuthPanelProps({ status: "trial", seatUsed: 1, seatQuota: 5 }),
          accessControlEditor: createAccessControlEditor(),
          seatOfferEditor: createSeatOfferEditor(),
          handoverEditor: createHandoverEditor(),
        }),
        container,
      );
    };
    renderSurface();
    document.body.append(container);
    const section: (Element & { updateComplete: Promise<unknown> }) | null =
      container.querySelector("model-authorization-section");
    expect(section).not.toBeNull();
    await section?.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));
    await section?.updateComplete;

    const innerTabs = [
      ...container.querySelectorAll(
        "[data-testid='enterprise-models-settings'] .enterprise-segmented-nav [role='tab']",
      ),
    ].map((tab) => tab.textContent?.trim());
    expect(innerTabs).toEqual(["模型授权", "模型与 API Key"]);
    expect(container.textContent).toContain("席位 2 · 员工 0 · 已授权 2 种 · 上界 2");
    expect(container.textContent).not.toContain("Ceiling");
    const ceiling = container.querySelector("[data-testid='model-auth-ceiling-details']");
    expect(ceiling?.hasAttribute("open")).toBe(false);
    expect(ceiling?.textContent).toContain("企业可授权模型（2）");
    expect(ceiling?.textContent).toContain("不能授权：p/outside");
    const previewTitle = container.querySelector(".model-auth-preview__title");
    expect(previewTitle?.textContent).toContain("Owner");
    expect(previewTitle?.textContent).toContain("Sales Lead");
    expect(previewTitle?.textContent).not.toContain("OPS-L2-001");
    expect(previewTitle?.getAttribute("title")).toContain("seat-1");
    expect(container.querySelector("details.model-auth-preview__meta")?.textContent).toContain(
      "岗位角色：OPS-L2-001",
    );
    expect(container.textContent).toContain("未挂到组织的授权");
    expect(container.querySelector("[data-org-seat-id='seat-1']")).not.toBeNull();
    expect(container.querySelector(".model-auth-directory__hint")).toBeNull();
    expect(container.querySelector("enterprise-integrations-providers")).toBeNull();

    const orphan = container.querySelector<HTMLElement>("[data-subject-key='seat:seat-orphan']");
    orphan?.click();
    await section?.updateComplete;
    expect(container.querySelector("[data-testid='model-auth-preview']")?.textContent).toContain(
      "seat-orphan",
    );
    expect(container.querySelector(".badge.warn")?.textContent).toContain("越界");

    const keysTab = [...container.querySelectorAll<HTMLButtonElement>("[role='tab']")].find(
      (tab) => tab.textContent?.trim() === "模型与 API Key",
    );
    keysTab?.click();
    expect(window.location.search).toContain("modelsView=keys");
    renderSurface();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container.querySelector("enterprise-integrations-providers")).not.toBeNull();
    expect(container.querySelector("model-authorization-section")).toBeNull();
    expect(container.textContent).toContain("添加提供方");
    container.remove();
  });

  it("states the retention consequence on the governance settings section", () => {
    window.history.pushState({}, "", "/enterprise/acme/settings/governance");
    const container = document.createElement("div");
    render(
      renderEnterpriseSurface({
        tab: "enterpriseSettings",
        basePath: "",
        readModel: createReadModel(),
        actions: createActions(),
        authPanelProps: createAuthPanelProps({ status: "trial", seatUsed: 1, seatQuota: 5 }),
        accessControlEditor: createAccessControlEditor(),
        seatOfferEditor: createSeatOfferEditor(),
        handoverEditor: createHandoverEditor(),
      }),
      container,
    );

    expect(container.querySelector("[data-retention-consequence]")?.textContent).toContain(
      "对话会按此保留，到期归档或删除。",
    );
    expect(container.textContent).not.toContain("代码不落盘");
    expect(container.textContent).not.toContain("隐私模式");
  });

  it("labels operational-identity OAuth as an external connect action", () => {
    window.history.pushState({}, "", "/enterprise/acme/settings/identities");
    const container = document.createElement("div");
    const editor = createIdentityManagementEditor();
    editor.open = true;
    editor.mode = "register";
    editor.registerStep = "connect";
    editor.provider = "kuaishou";
    const readModel = createReadModel();
    const kuaishou = readModel.identityProviderCatalog.find(
      (entry) => entry.provider === "kuaishou",
    );
    if (kuaishou) {
      kuaishou.registrationProfile = {
        summary: "快手 OAuth",
        methods: ["oauth"],
        oauthHint: "在快手开放平台完成 OAuth 授权。",
        verifyChecks: [],
        actionRequirements: [],
      };
    }

    render(
      renderEnterpriseSurface({
        tab: "enterpriseSettings",
        basePath: "",
        readModel,
        actions: createActions(),
        authPanelProps: createAuthPanelProps({ status: "trial", seatUsed: 1, seatQuota: 5 }),
        accessControlEditor: createAccessControlEditor(),
        seatOfferEditor: createSeatOfferEditor(),
        handoverEditor: createHandoverEditor(),
        identityManagementEditor: editor,
      }),
      container,
    );

    const connect = container.querySelector("[data-oauth-external]");
    expect(connect?.textContent).toContain("连接 ↗");
    expect(container.textContent).toContain("将打开 快手（企业） 完成登录授权。");
    expect(container.textContent).not.toContain("扫码授权");
  });

  it("routes 邀请管理员 into the employee directory instead of provisioning a new employee", () => {
    window.history.pushState({}, "", "/enterprise/acme/settings/access");
    const container = document.createElement("div");
    const actions = createActions();
    render(
      renderEnterpriseSurface({
        tab: "enterpriseSettings",
        basePath: "",
        readModel: createReadModel(),
        actions,
        authPanelProps: createAuthPanelProps({ status: "trial", seatUsed: 1, seatQuota: 5 }),
        accessControlEditor: createAccessControlEditor(),
        seatOfferEditor: createSeatOfferEditor(),
        handoverEditor: createHandoverEditor(),
      }),
      container,
    );

    const inviteAdmin = container.querySelector<HTMLAnchorElement>(
      '[data-testid="enterprise-access-invite-admin"]',
    );
    expect(inviteAdmin).not.toBeNull();
    expect(inviteAdmin?.tagName).toBe("A");
    expect(inviteAdmin?.textContent).toContain("邀请管理员");
    const href = inviteAdmin?.getAttribute("href") ?? "";
    expect(href).toContain("/enterprise/acme/organization");
    expect(href).toContain("organizationView=member");
    expect(href).toContain("organizationAdminInvite=1");
    inviteAdmin?.click();
    expect(actions.organization.onCreateInvite).not.toHaveBeenCalled();
    expect(actions.organization.onInviteEnterpriseAdmin).not.toHaveBeenCalled();
  });

  it("sends an admin invite from the employee directory for eligible employees only", () => {
    window.history.pushState({}, "", "/openclaw?organizationView=member&organizationAdminInvite=1");
    const container = document.createElement("div");
    const actions = createActions();
    const readModel = createReadModel();
    readModel.memberSummaries = [
      { ...readModel.memberSummaries[0], isCurrentUser: true },
      ...readModel.memberSummaries.slice(1),
      {
        user: "dual@example.com",
        displayLabel: "Dual",
        membershipRole: "enterprise-admin",
        membershipRoles: ["enterprise-admin", "member"],
        status: "active",
        seatTitle: null,
        seatStatus: null,
        seatTeamLabel: null,
      },
      {
        user: "pending@example.com",
        displayLabel: "Pending",
        membershipRole: "member",
        membershipRoles: ["member"],
        adminInvitePendingExpiresAt: "2099-01-01T00:00:00.000Z",
        status: "active",
        seatTitle: null,
        seatStatus: null,
        seatTeamLabel: null,
      },
    ];
    const renderSurface = () =>
      render(
        renderEnterpriseSurface({
          tab: "enterpriseOrganization",
          basePath: "/openclaw",
          readModel,
          actions,
          authPanelProps: createAuthPanelProps({ status: "trial", seatUsed: 1, seatQuota: 5 }),
          createPositionEditor: createPositionEditor(),
          seatOfferEditor: createSeatOfferEditor(),
          handoverEditor: createHandoverEditor(),
        }),
        container,
      );
    renderSurface();

    expect(
      container.querySelector('[data-testid="organization-admin-invite-hint"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain("管理员 · 员工（双重身份）");
    expect(
      container.querySelector('[data-testid="organization-admin-invite-pending"]')?.textContent,
    ).toContain("管理员邀请待接受");
    const inviteButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[data-testid="organization-invite-admin"]'),
    );
    // Owner (current admin) and the dual-identity admin get no invite action.
    expect(inviteButtons.map((entry) => entry.textContent?.trim())).toEqual([
      "邀请为管理员",
      "重发管理员邀请",
    ]);

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    inviteButtons[0]?.click();
    inviteButtons[1]?.click();
    confirmSpy.mockRestore();
    expect(actions.organization.onInviteEnterpriseAdmin).toHaveBeenNthCalledWith(
      1,
      "member@example.com",
      undefined,
    );
    expect(actions.organization.onInviteEnterpriseAdmin).toHaveBeenNthCalledWith(
      2,
      "pending@example.com",
      { resend: true },
    );
    expect(actions.organization.onCreateInvite).not.toHaveBeenCalled();
  });

  it("renders access permission drawer and risk confirmation modal", () => {
    window.history.pushState(
      {},
      "",
      "/enterprise/acme/settings?accessView=users&accessUser=owner%40example.com",
    );
    const container = document.createElement("div");
    const editor = createAccessControlEditor();
    editor.kind = "user";
    editor.targetKey = "owner@example.com";
    editor.selectedPermissionIds = ["member:view", "settings:policy"];
    editor.riskConfirmOpen = true;

    render(
      renderEnterpriseSurface({
        tab: "enterpriseSettings",
        basePath: "",
        readModel: createReadModel(),
        actions: createActions(),
        authPanelProps: createAuthPanelProps({
          status: "trial",
          seatUsed: 1,
          seatQuota: 5,
        }),
        accessControlEditor: editor,
        seatOfferEditor: createSeatOfferEditor(),
        handoverEditor: createHandoverEditor(),
      }),
      container,
    );

    expect(container.textContent).toContain("编辑权限");
    expect(container.textContent).toContain("成员生效权限");
    expect(container.textContent).toContain("高风险权限草稿");
    expect(container.textContent).toContain("不会写入权限");
    expect(container.textContent).toContain("管理策略");
    expect(container.textContent).toContain("确认草稿");
    expect(container.textContent).not.toContain("确认授予");
    // 成员视图已有左右分栏：权限编辑器内联在右侧详情栏，不再用浮层抽屉。
    expect(container.querySelector(".enterprise-access-drawer-overlay")).toBeNull();
    expect(
      container.querySelector(".enterprise-access-detail .enterprise-access-drawer__header"),
    ).not.toBeNull();
    // 列表行为行栈 + 分隔线，不再嵌套 enterprise-card（卡中卡）。
    expect(container.querySelectorAll(".enterprise-access-list .enterprise-card").length).toBe(0);
  });

  it("renders enterprise security password change wired to auth panel handlers", async () => {
    window.history.pushState({}, "", "/enterprise/acme/settings/security");
    const container = document.createElement("div");
    const authPanelProps = createAuthPanelProps({
      status: "trial",
      seatUsed: 1,
      seatQuota: 5,
    });
    authPanelProps.currentPassword = "old-pass";
    authPanelProps.newPassword = "new-pass";

    render(
      renderEnterpriseSurface({
        tab: "enterpriseSettings",
        basePath: "",
        readModel: createReadModel(),
        actions: createActions(),
        authPanelProps,
        accessControlEditor: createAccessControlEditor(),
        seatOfferEditor: createSeatOfferEditor(),
        handoverEditor: createHandoverEditor(),
      }),
      container,
    );

    expect(container.textContent).toContain("安全");
    expect(container.textContent).toContain("导出审计");
    expect(container.textContent).toContain("退出企业管理员");
    const pendingAudit = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("导出审计"),
    );
    expect(pendingAudit?.disabled).toBe(true);
    const currentPasswordInput = container.querySelector<HTMLInputElement>(
      'input[autocomplete="current-password"]',
    );
    const newPasswordInput = container.querySelector<HTMLInputElement>(
      'input[autocomplete="new-password"]',
    );
    expect(currentPasswordInput).not.toBeNull();
    expect(newPasswordInput).not.toBeNull();

    expect(currentPasswordInput?.value).toBe("old-pass");
    expect(newPasswordInput?.value).toBe("new-pass");

    const submitButton = container.querySelector<HTMLButtonElement>(
      ".enterprise-settings-password-form button.btn--primary",
    );
    expect(submitButton).not.toBeNull();
    submitButton?.click();
    expect(authPanelProps.onChangePassword).toHaveBeenCalledTimes(1);
  });

  it("disables unimplemented security mutations and confirms admin logout", () => {
    window.history.pushState({}, "", "/enterprise/acme/settings/security");
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const actions = createActions();
    const container = document.createElement("div");

    render(
      renderEnterpriseSurface({
        tab: "enterpriseSettings",
        basePath: "",
        readModel: createReadModel(),
        actions,
        authPanelProps: createAuthPanelProps({
          status: "trial",
          seatUsed: 1,
          seatQuota: 5,
        }),
        accessControlEditor: createAccessControlEditor(),
        seatOfferEditor: createSeatOfferEditor(),
        handoverEditor: createHandoverEditor(),
      }),
      container,
    );

    const buttonText = (button: Element) => (button.textContent ?? "").replace(/\s+/g, "");
    const buttonByLabel = (label: string) =>
      [...container.querySelectorAll("button")].find((button) => buttonText(button) === label);

    for (const label of ["导出审计", "启用", "调整", "配置", "查看", "全部下线", "导出"]) {
      const button = buttonByLabel(label);
      expect(button, label).toBeTruthy();
      expect(button?.disabled, label).toBe(true);
      button?.click();
    }
    expect(actions.settings.onRefreshPolicies).not.toHaveBeenCalled();
    expect(actions.settings.onLogout).not.toHaveBeenCalled();

    const logout = buttonByLabel("退出企业管理员");
    expect(logout?.disabled).not.toBe(true);
    logout?.click();
    expect(confirmSpy).toHaveBeenCalled();
    expect(actions.settings.onLogout).not.toHaveBeenCalled();

    confirmSpy.mockReturnValue(true);
    logout?.click();
    expect(actions.settings.onLogout).toHaveBeenCalledTimes(1);
    confirmSpy.mockRestore();
  });

  it("wires MFA enroll and login-session revoke only when the gateway is connected", async () => {
    resetEnterpriseSecurityPanelStateForTests();
    resetEnterprisePendingControlsForTests();
    window.history.pushState({}, "", "/enterprise/acme/settings/security");
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === "enterprise.security.mfa.enroll" && params?.action === "start") {
        return {
          ok: true,
          enabled: false,
          otpAuthUrl: "otpauth://totp/OpenBot:admin@example.com?secret=SECRET",
          recoveryCodes: ["abcd-efgh"],
        };
      }
      if (method === "enterprise.security.mfa.enroll" && params?.action === "confirm") {
        return params.code === "000000"
          ? { ok: false, enabled: false, reason: "code_invalid" }
          : { ok: true, enabled: true };
      }
      if (method === "enterprise.security.sessions.list") {
        return {
          sessions: [
            {
              sessionId: "sess-current",
              userId: "user-1",
              createdAt: "2026-10-01T00:00:00.000Z",
              lastSeenAt: "2026-10-02T00:00:00.000Z",
              current: true,
            },
          ],
        };
      }
      if (method === "enterprise.security.sessions.revoke") {
        return { ok: true, revoked: ["sess-other"] };
      }
      if (method === "enterprise.security.session-policy.set") {
        return { ok: false, reason: "out_of_range" };
      }
      if (method === "enterprise.security.ip-allowlist.set") {
        return { ok: false, reason: "would_lock_out_caller" };
      }
      if (method === "enterprise.security.audit.export") {
        return { ok: false, reason: "export_unavailable" };
      }
      throw new Error(`unexpected ${method}`);
    });
    const client = { connected: true, request };
    const container = document.createElement("div");
    const renderSecurity = () => {
      render(
        renderEnterpriseSurface({
          tab: "enterpriseSettings",
          basePath: "",
          client: client as never,
          readModel: createReadModel(),
          actions: createActions(),
          authPanelProps: createAuthPanelProps({ status: "trial", seatUsed: 1, seatQuota: 5 }),
          accessControlEditor: createAccessControlEditor(),
          seatOfferEditor: createSeatOfferEditor(),
          handoverEditor: createHandoverEditor(),
        }),
        container,
      );
    };
    renderSecurity();

    const buttonText = (button: Element) => (button.textContent ?? "").replace(/\s+/g, "");
    const buttonByLabel = (label: string) =>
      [...container.querySelectorAll("button")].find((button) => buttonText(button) === label);

    expect(buttonByLabel("调整")?.disabled).toBe(false);
    expect(buttonByLabel("配置")?.disabled).toBe(false);
    expect(buttonByLabel("导出审计")?.disabled).toBe(false);
    expect(buttonByLabel("启用")?.disabled).toBe(false);

    buttonByLabel("调整")?.click();
    await vi.waitFor(() => {
      renderSecurity();
      expect(container.textContent).toContain("没有写入");
    });
    expect(container.textContent).not.toContain("空闲超时已设为");

    buttonByLabel("启用")?.click();
    await vi.waitFor(() => {
      renderSecurity();
      expect(container.textContent).toContain("otpauth://totp/OpenBot");
    });
    expect(container.textContent).toContain("abcd-efgh");
    expect(container.textContent).toContain("验证码确认前，登录还不会要求双因素。");

    const fillCode = (value: string) => {
      const code = container.querySelector<HTMLInputElement>(
        '[data-testid="enterprise-security-mfa-code"]',
      );
      expect(code).not.toBeNull();
      code!.value = value;
      code!.dispatchEvent(new Event("input", { bubbles: true }));
    };
    fillCode("000000");
    buttonByLabel("确认")?.click();
    await vi.waitFor(() => {
      renderSecurity();
      expect(container.textContent).toContain("验证码不正确");
    });
    expect(container.textContent).not.toContain("双因素已启用");

    fillCode("123456");
    buttonByLabel("确认")?.click();
    await vi.waitFor(() => {
      renderSecurity();
      expect(container.textContent).toContain("双因素已启用。下次登录需要验证码。");
    });

    buttonByLabel("查看")?.click();
    await vi.waitFor(() => {
      renderSecurity();
      expect(container.textContent).toContain("sess-current");
    });
    expect(container.textContent).toContain("当前");

    buttonByLabel("全部下线")?.click();
    await vi.waitFor(() => {
      renderSecurity();
      expect(container.textContent).toContain("已下线 1 个其他登录");
    });
    expect(request.mock.calls.some((call) => call[0] === "sessions.list")).toBe(false);
    expect(
      request.mock.calls.some((call) => call[0] === "enterprise.security.sessions.revoke"),
    ).toBe(true);
    confirmSpy.mockRestore();
    resetEnterpriseSecurityPanelStateForTests();
    resetEnterprisePendingControlsForTests();
  });

  it("keeps enterprise profile master data read-only and refreshes organization", () => {
    window.history.pushState({}, "", "/enterprise/acme/settings/profile");
    const actions = createActions();
    const container = document.createElement("div");

    render(
      renderEnterpriseSurface({
        tab: "enterpriseSettings",
        basePath: "",
        readModel: createReadModel(),
        actions,
        authPanelProps: createAuthPanelProps({
          status: "trial",
          seatUsed: 1,
          seatQuota: 5,
        }),
        accessControlEditor: createAccessControlEditor(),
        seatOfferEditor: createSeatOfferEditor(),
        handoverEditor: createHandoverEditor(),
      }),
      container,
    );

    expect(container.textContent).not.toContain("编辑企业信息");
    expect(container.textContent).toContain("此处只读");
    const refresh = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("刷新组织"),
    );
    expect(refresh?.disabled).not.toBe(true);
    refresh?.click();
    expect(actions.organization.onRefresh).toHaveBeenCalledTimes(1);
    expect(actions.settings.onRefreshPolicies).not.toHaveBeenCalled();
  });

  it("does not paint a present admin count as a warning on settings overview", () => {
    window.history.pushState({}, "", "/enterprise/acme/settings");
    const container = document.createElement("div");

    render(
      renderEnterpriseSurface({
        tab: "enterpriseSettings",
        basePath: "",
        readModel: createReadModel(),
        actions: createActions(),
        authPanelProps: createAuthPanelProps({
          status: "trial",
          seatUsed: 1,
          seatQuota: 5,
        }),
        accessControlEditor: createAccessControlEditor(),
        seatOfferEditor: createSeatOfferEditor(),
        handoverEditor: createHandoverEditor(),
      }),
      container,
    );

    const adminStat = [...container.querySelectorAll(".enterprise-settings-stat")].find(
      (stat) => stat.querySelector(".enterprise-settings-stat__label")?.textContent === "管理员",
    );
    expect(adminStat?.textContent).toContain("1");
    expect(adminStat?.querySelector(".is-warn")).toBeNull();
  });

  it("renders enterprise operational identity settings section with status badges", () => {
    window.history.pushState({}, "", "/enterprise/acme/settings/identities");
    const container = document.createElement("div");
    const actions = createActions();

    render(
      renderEnterpriseSurface({
        tab: "enterpriseSettings",
        basePath: "",
        readModel: createReadModel(),
        actions,
        authPanelProps: createAuthPanelProps({ status: "trial", seatUsed: 1, seatQuota: 5 }),
        accessControlEditor: createAccessControlEditor(),
        seatOfferEditor: createSeatOfferEditor(),
        handoverEditor: createHandoverEditor(),
      }),
      container,
    );

    expect(container.textContent).toContain("企业身份");
    expect(container.textContent).not.toContain("飞书 / 企业微信 / 钉钉");
    expect(container.textContent).not.toContain("同步为运营身份");
    const navs = [...container.querySelectorAll(".enterprise-segmented-nav")];
    const topTabs = [...(navs[0]?.querySelectorAll('[role="tab"]') ?? [])].map((tab) =>
      tab.textContent?.trim(),
    );
    expect(topTabs).toContain("企业身份");
    expect(topTabs).not.toContain("绑定总览");
    const identityTabs = [...(navs[1]?.querySelectorAll('[role="tab"]') ?? [])].map((tab) =>
      tab.textContent?.trim(),
    );
    expect(identityTabs).toEqual(["身份目录", "绑定总览"]);
    const identityToolbar = container.querySelector(".enterprise-identity-workspace__toolbar");
    expect(identityToolbar).not.toBeNull();
    expect(container.querySelector(".enterprise-access--compact-chrome")).not.toBeNull();
    expect(identityToolbar?.textContent).toContain("身份目录");
    expect(identityToolbar?.textContent).toContain("连接身份");
    expect(container.textContent).toContain("连接身份");
    expect(container.textContent).toContain("选择平台通道");
    expect(container.textContent).toContain("企业官方与新媒体");
    expect(container.textContent).toContain("企业业务系统");
    expect(container.textContent).toContain("微信公众号");
    expect(container.textContent).not.toContain("尚未连接此平台");
    expect(container.textContent).not.toContain("在已配置的身份之间切换");
    expect(container.textContent).not.toContain("员工自行配置，已移出企业目录");
    expect(container.querySelector(".enterprise-identity-layout")).not.toBeNull();
    expect(container.querySelector(".enterprise-identity-nav")).not.toBeNull();
    expect(container.textContent).toContain("已连接身份");
    expect(container.textContent).toContain("ops@acme.example");
    expect(container.querySelectorAll("[data-identity-nav-delete]").length).toBe(0);
    expect(container.querySelector(".enterprise-identity-nav .enterprise-access-tag")).toBeNull();
    expect(container.querySelector("[data-identity-connect-landing]")).not.toBeNull();
    expect(container.textContent).not.toContain("DataSource 详情");
    expect(container.querySelector("[data-employee-binding-overview]")).toBeNull();
    expect(container.textContent).not.toContain("员工绑定总览");
  });

  it("renders employee binding overview as its own settings tab", () => {
    window.history.pushState({}, "", "/enterprise/acme/settings/identity-bindings");
    const container = document.createElement("div");

    render(
      renderEnterpriseSurface({
        tab: "enterpriseSettings",
        basePath: "",
        readModel: createReadModel(),
        actions: createActions(),
        authPanelProps: createAuthPanelProps({ status: "trial", seatUsed: 1, seatQuota: 5 }),
        accessControlEditor: createAccessControlEditor(),
        seatOfferEditor: createSeatOfferEditor(),
        handoverEditor: createHandoverEditor(),
      }),
      container,
    );

    expect(container.textContent).toContain("绑定总览");
    const navs = [...container.querySelectorAll(".enterprise-segmented-nav")];
    const topTabs = [...(navs[0]?.querySelectorAll('[role="tab"]') ?? [])].map((tab) =>
      tab.textContent?.trim(),
    );
    expect(topTabs).toContain("企业身份");
    expect(topTabs).not.toContain("绑定总览");
    expect(container.querySelector("[data-employee-binding-overview]")).not.toBeNull();
    expect(container.textContent).toContain("同步");
    expect(container.textContent).toContain("绑定记录");
    expect(container.textContent).toContain("暂无员工绑定记录。");
    expect(container.textContent).toContain("身份目录");
    expect(container.textContent).not.toContain("连接身份");
    expect(container.textContent).not.toContain("选择平台通道");
  });

  it("renders operational identity relationship summary in identities settings", () => {
    window.history.pushState({}, "", "/enterprise/acme/settings/identities");
    const container = document.createElement("div");
    const editor = createIdentityManagementEditor();
    const readModel = createReadModel();
    const template = readModel.identityAssetSummaries[0];
    readModel.identityAssetSummaries = [
      ...readModel.identityAssetSummaries,
      {
        ...template,
        identityId: "id-wechat-official",
        displayName: "公众号主号",
        provider: "wechat-official",
        providerLabel: "微信公众号",
      },
    ];
    editor.selectedDetailIdentityId = "id-wechat-official";

    render(
      renderEnterpriseSurface({
        tab: "enterpriseSettings",
        basePath: "",
        readModel,
        actions: createActions(),
        authPanelProps: createAuthPanelProps({ status: "trial", seatUsed: 1, seatQuota: 5 }),
        accessControlEditor: createAccessControlEditor(),
        seatOfferEditor: createSeatOfferEditor(),
        handoverEditor: createHandoverEditor(),
        identityManagementEditor: editor,
      }),
      container,
    );

    const nav = container.querySelector(".enterprise-identity-nav");
    expect(nav).not.toBeNull();
    expect(nav?.textContent).toContain("公众号主号");
    expect(nav?.textContent).not.toContain("在已配置的身份之间切换");
    expect(container.querySelector("[data-identity-nav-delete='id-wechat-official']")).toBeNull();
    expect(
      container.querySelector("[data-identity-detail-delete='id-wechat-official']"),
    ).not.toBeNull();
    expect(container.textContent).toContain("删除");
    expect(container.textContent).not.toContain("断开");
    expect(container.textContent).toContain("公众号主号");
    expect(container.textContent).toContain("开放岗位");
    expect(container.textContent).toContain("Sales Lead");
    expect(container.textContent).toContain("发送消息");
    expect(container.textContent).toContain("员工绑定");
    expect(container.textContent).not.toContain("数字身份");
    expect(container.textContent).not.toContain("平台通道");
    expect(container.textContent).not.toContain("保存凭证的企业成员");
    expect(container.querySelector(".enterprise-identity-detail")).not.toBeNull();
  });

  it("renders provider catalog picker as the first register step", () => {
    window.history.pushState({}, "", "/enterprise/acme/settings/identities");
    const container = document.createElement("div");
    const editor = createIdentityManagementEditor();
    editor.open = true;
    editor.mode = "register";
    editor.registerStep = "provider";
    editor.onRegisterProviderSelect = vi.fn();

    render(
      renderEnterpriseSurface({
        tab: "enterpriseSettings",
        basePath: "",
        readModel: createReadModel(),
        actions: createActions(),
        authPanelProps: createAuthPanelProps({ status: "trial", seatUsed: 1, seatQuota: 5 }),
        accessControlEditor: createAccessControlEditor(),
        seatOfferEditor: createSeatOfferEditor(),
        handoverEditor: createHandoverEditor(),
        identityManagementEditor: editor,
      }),
      container,
    );

    expect(container.textContent).toContain("选择平台通道");
    expect(container.textContent).toContain("微信公众号");
    expect(container.textContent).toContain("Notion");
    expect(container.textContent).toContain("快手（企业）");
    expect(container.querySelector(".enterprise-identity-register-provider-grid")).not.toBeNull();
    const providerButtons = [
      ...container.querySelectorAll<HTMLButtonElement>(
        "button.enterprise-identity-register-provider",
      ),
    ];
    expect(providerButtons.some((button) => button.textContent?.includes("飞书"))).toBe(false);
    expect(providerButtons.some((button) => button.textContent?.includes("企业邮箱"))).toBe(false);
    expect(providerButtons.some((button) => button.textContent?.includes("Jira"))).toBe(false);
    const wechatButton = providerButtons.find((button) =>
      button.textContent?.includes("微信公众号"),
    );
    expect(wechatButton).toBeTruthy();
    wechatButton?.click();
    expect(editor.onRegisterProviderSelect).toHaveBeenCalledWith("wechat-official");
  });

  it("keeps connect and provider picker clickable while identity refresh is busy", () => {
    window.history.pushState({}, "", "/enterprise/acme/settings/identities");
    const container = document.createElement("div");
    const editor = createIdentityManagementEditor();
    editor.open = true;
    editor.mode = "register";
    editor.registerStep = "provider";
    editor.busy = true;
    editor.onRegisterProviderSelect = vi.fn();
    const readModel = createReadModel();
    readModel.operationalIdentityBusy = true;

    render(
      renderEnterpriseSurface({
        tab: "enterpriseSettings",
        basePath: "",
        readModel,
        actions: createActions(),
        authPanelProps: createAuthPanelProps({ status: "trial", seatUsed: 1, seatQuota: 5 }),
        accessControlEditor: createAccessControlEditor(),
        seatOfferEditor: createSeatOfferEditor(),
        handoverEditor: createHandoverEditor(),
        identityManagementEditor: editor,
      }),
      container,
    );

    const connectButton = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.includes("连接身份"),
    );
    expect(connectButton?.disabled).toBe(false);
    const wechatButton = [
      ...container.querySelectorAll<HTMLButtonElement>(
        "button.enterprise-identity-register-provider",
      ),
    ].find((button) => button.textContent?.includes("微信公众号"));
    expect(wechatButton).toBeTruthy();
    expect(wechatButton?.disabled).toBe(false);
    wechatButton?.click();
    expect(editor.onRegisterProviderSelect).toHaveBeenCalledWith("wechat-official");
  });

  it("keeps the identity editor in the right pane and omits DataSource governance", () => {
    window.history.pushState({}, "", "/enterprise/acme/settings/identities");
    const container = document.createElement("div");
    const editor = createIdentityManagementEditor();
    editor.open = true;
    editor.mode = "register";
    editor.registerStep = "connect";
    editor.provider = "wechat-official";

    render(
      renderEnterpriseSurface({
        tab: "enterpriseSettings",
        basePath: "",
        readModel: createReadModel(),
        actions: createActions(),
        authPanelProps: createAuthPanelProps({ status: "trial", seatUsed: 1, seatQuota: 5 }),
        accessControlEditor: createAccessControlEditor(),
        seatOfferEditor: createSeatOfferEditor(),
        handoverEditor: createHandoverEditor(),
        identityManagementEditor: editor,
      }),
      container,
    );

    expect(container.textContent).not.toContain("DataSource 详情");
    expect(container.querySelector("[data-identity-editor-pane]")).not.toBeNull();
    expect(
      container.querySelector(".enterprise-identity-layout [data-identity-editor-pane]"),
    ).not.toBeNull();
    expect(container.textContent).toContain("连接「微信公众号」");
    expect(container.textContent).toContain("AppID");
    expect(container.textContent).not.toContain("扫码授权");
    expect(container.textContent).not.toContain("authorizer_token");
    expect(container.textContent).toContain("保存连接");
    expect(container.textContent).toContain("8.217.93.71");
    expect(container.textContent).toContain("加入公众号 IP 白名单后认证");
    expect(container.textContent).not.toMatch(/DataSource/);
    expect(container.textContent).not.toContain("Seat IDs");
  });

  it("renders open-scope picker instead of raw seat CSV", () => {
    window.history.pushState({}, "", "/enterprise/acme/settings/identities");
    const container = document.createElement("div");
    const editor = createIdentityManagementEditor();
    editor.open = true;
    editor.mode = "policy";
    editor.identityId = "id-feishu";

    render(
      renderEnterpriseSurface({
        tab: "enterpriseSettings",
        basePath: "",
        readModel: createReadModel(),
        actions: createActions(),
        authPanelProps: createAuthPanelProps({ status: "trial", seatUsed: 1, seatQuota: 5 }),
        accessControlEditor: createAccessControlEditor(),
        seatOfferEditor: createSeatOfferEditor(),
        handoverEditor: createHandoverEditor(),
        identityManagementEditor: editor,
      }),
      container,
    );

    expect(container.textContent).toContain("管理开放范围");
    expect(container.textContent).toContain("授权岗位");
    expect(container.textContent).not.toContain("Seat IDs（逗号分隔，必填）");
    expect(container.textContent).not.toContain("Agent IDs");
    expect(container.textContent).toContain("保存开放范围");
    expect(container.querySelector("details.edc-org-tree__dept")).not.toBeNull();
    expect(container.querySelector("summary.edc-org-tree__row--dept")).not.toBeNull();
  });

  it("does not offer open-scope editing for leftover catalog identities", () => {
    window.history.pushState({}, "", "/enterprise/acme/settings/identities");
    const container = document.createElement("div");
    const editor = createIdentityManagementEditor();
    editor.selectedDetailIdentityId = "id-email";

    render(
      renderEnterpriseSurface({
        tab: "enterpriseSettings",
        basePath: "",
        readModel: createReadModel(),
        actions: createActions(),
        authPanelProps: createAuthPanelProps({ status: "trial", seatUsed: 1, seatQuota: 5 }),
        accessControlEditor: createAccessControlEditor(),
        seatOfferEditor: createSeatOfferEditor(),
        handoverEditor: createHandoverEditor(),
        identityManagementEditor: editor,
      }),
      container,
    );

    expect(container.textContent).toContain("ops@acme.example");
    expect(container.textContent).toContain("已移出目录");
    expect(container.textContent).not.toContain("管理开放范围");
    expect(container.textContent).not.toContain("开始配置策略");
    expect(container.querySelector("[data-identity-detail-delete='id-email']")).not.toBeNull();
    expect(container.textContent).not.toContain("断开");
  });

  it("shows identity verify progress and result next to the test button", () => {
    window.history.pushState({}, "", "/enterprise/acme/settings/identities");
    const container = document.createElement("div");
    const editor = createIdentityManagementEditor();
    editor.selectedDetailIdentityId = "id-email";
    const actions = createActions();
    const readModel = createReadModel();
    readModel.operationalIdentityBusy = true;
    readModel.identityVerify = {
      identityId: "id-email",
      phase: "running",
      message: "正在向平台验证凭证…",
    };

    render(
      renderEnterpriseSurface({
        tab: "enterpriseSettings",
        basePath: "",
        readModel,
        actions,
        authPanelProps: createAuthPanelProps({ status: "trial", seatUsed: 1, seatQuota: 5 }),
        accessControlEditor: createAccessControlEditor(),
        seatOfferEditor: createSeatOfferEditor(),
        handoverEditor: createHandoverEditor(),
        identityManagementEditor: editor,
      }),
      container,
    );

    const verifyButton = container.querySelector<HTMLButtonElement>(
      "[data-identity-verify='id-email']",
    );
    expect(verifyButton?.textContent?.trim()).toBe("测试中…");
    expect(verifyButton?.disabled).toBe(true);
    expect(
      container.querySelector("[data-identity-verify-status='id-email']")?.textContent,
    ).toContain("正在向平台验证凭证");
    expect(container.textContent).not.toContain("有 5 条新的员工绑定变更");

    readModel.operationalIdentityBusy = false;
    readModel.identityVerify = {
      identityId: "id-email",
      phase: "passed",
      message: "连接测试通过：必填配置项齐全，身份可正常使用。",
    };
    render(
      renderEnterpriseSurface({
        tab: "enterpriseSettings",
        basePath: "",
        readModel,
        actions,
        authPanelProps: createAuthPanelProps({ status: "trial", seatUsed: 1, seatQuota: 5 }),
        accessControlEditor: createAccessControlEditor(),
        seatOfferEditor: createSeatOfferEditor(),
        handoverEditor: createHandoverEditor(),
        identityManagementEditor: editor,
      }),
      container,
    );

    const passedButton = container.querySelector<HTMLButtonElement>(
      "[data-identity-verify='id-email']",
    );
    expect(passedButton?.textContent?.trim()).toBe("测试连接");
    expect(
      container.querySelector("[data-identity-verify-status='id-email']")?.textContent,
    ).toContain("连接测试通过");
    passedButton?.click();
    expect(actions.settings.onVerifyIdentity).toHaveBeenCalledWith("acme", "id-email");
  });

  it("opens revoke confirm from the identity detail delete control", () => {
    window.history.pushState({}, "", "/enterprise/acme/settings/identities");
    const container = document.createElement("div");
    const editor = createIdentityManagementEditor();
    editor.selectedDetailIdentityId = "id-email";
    const actions = createActions();

    render(
      renderEnterpriseSurface({
        tab: "enterpriseSettings",
        basePath: "",
        readModel: createReadModel(),
        actions,
        authPanelProps: createAuthPanelProps({ status: "trial", seatUsed: 1, seatQuota: 5 }),
        accessControlEditor: createAccessControlEditor(),
        seatOfferEditor: createSeatOfferEditor(),
        handoverEditor: createHandoverEditor(),
        identityManagementEditor: editor,
      }),
      container,
    );

    expect(container.querySelector("[data-identity-nav-delete]")).toBeNull();
    const deleteButton = container.querySelector<HTMLButtonElement>(
      "[data-identity-detail-delete='id-email']",
    );
    expect(deleteButton).not.toBeNull();
    expect(deleteButton?.textContent?.trim()).toBe("删除");
    deleteButton?.click();
    expect(actions.settings.onOpenIdentityRevokeConfirm).toHaveBeenCalledWith("id-email");
  });

  it("renders a compact revoke confirm without explanatory copy", () => {
    window.history.pushState({}, "", "/enterprise/acme/settings/identities");
    const container = document.createElement("div");
    const editor = createIdentityManagementEditor();
    editor.revokeConfirmIdentityId = "id-email";

    render(
      renderEnterpriseSurface({
        tab: "enterpriseSettings",
        basePath: "",
        readModel: createReadModel(),
        actions: createActions(),
        authPanelProps: createAuthPanelProps({ status: "trial", seatUsed: 1, seatQuota: 5 }),
        accessControlEditor: createAccessControlEditor(),
        seatOfferEditor: createSeatOfferEditor(),
        handoverEditor: createHandoverEditor(),
        identityManagementEditor: editor,
      }),
      container,
    );

    const dialog = container.querySelector("[role='alertdialog']");
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain("确认删除");
    expect(dialog?.textContent).toContain("确定删除「ops@acme.example」？");
    expect(dialog?.textContent).not.toContain("此操作需要二次确认");
    expect(dialog?.textContent).not.toContain("相关策略与绑定记录");
    expect(dialog?.textContent).not.toContain("若仍有机器人");
    expect(dialog?.textContent).not.toContain("员工自行配置");
    expect(dialog?.querySelector(".enterprise-identity-editor-modal__sub")).toBeNull();
    expect(dialog?.querySelector(".enterprise-identity-revoke-modal__hint")).toBeNull();
  });

  it("renders credential and rename editors in the right pane", () => {
    window.history.pushState({}, "", "/enterprise/acme/settings/identities");
    const container = document.createElement("div");
    const editor = createIdentityManagementEditor();
    editor.open = true;
    editor.mode = "credential";
    editor.provider = "wechat-official";
    editor.identityId = "id-wechat-official";
    editor.credentialFieldsReady = true;

    render(
      renderEnterpriseSurface({
        tab: "enterpriseSettings",
        basePath: "",
        readModel: createReadModel(),
        actions: createActions(),
        authPanelProps: createAuthPanelProps({ status: "trial", seatUsed: 1, seatQuota: 5 }),
        accessControlEditor: createAccessControlEditor(),
        seatOfferEditor: createSeatOfferEditor(),
        handoverEditor: createHandoverEditor(),
        identityManagementEditor: editor,
      }),
      container,
    );

    expect(container.querySelector("[data-identity-editor-pane]")).not.toBeNull();
    expect(container.textContent).toContain("编辑凭证");
    expect(container.textContent).toContain("AppID");
    expect(container.textContent).toContain("保存凭证");
    expect(container.textContent).not.toContain("Seat IDs");

    editor.mode = "edit";
    editor.displayName = "公众号主号";
    render(
      renderEnterpriseSurface({
        tab: "enterpriseSettings",
        basePath: "",
        readModel: createReadModel(),
        actions: createActions(),
        authPanelProps: createAuthPanelProps({ status: "trial", seatUsed: 1, seatQuota: 5 }),
        accessControlEditor: createAccessControlEditor(),
        seatOfferEditor: createSeatOfferEditor(),
        handoverEditor: createHandoverEditor(),
        identityManagementEditor: editor,
      }),
      container,
    );

    expect(container.textContent).toContain("重命名账号");
    expect(container.textContent).toContain("保存名称");
    expect(container.textContent).not.toContain("绑定数据源");
  });

  it("keeps new access roles disabled and labels permission saves as local drafts", () => {
    window.history.pushState({}, "", "/enterprise/acme/settings/access");
    const container = document.createElement("div");
    const editor = createAccessControlEditor();
    editor.kind = "role";
    editor.targetKey = "operator";
    render(
      renderEnterpriseSurface({
        tab: "enterpriseSettings",
        basePath: "",
        readModel: createReadModel(),
        actions: createActions(),
        authPanelProps: createAuthPanelProps({
          status: "trial",
          seatUsed: 1,
          seatQuota: 5,
        }),
        accessControlEditor: editor,
        seatOfferEditor: createSeatOfferEditor(),
        handoverEditor: createHandoverEditor(),
      }),
      container,
    );

    const createRole = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("新建角色"),
    );
    expect(createRole?.disabled).toBe(true);
    expect(createRole?.title).toContain("尚未接入");
    const saveDraft = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("保存草稿"),
    );
    expect(saveDraft?.title).toContain("不会写入权限");
    expect(container.textContent).toContain("正式提交尚未接入");
    expect(container.textContent).toContain("不会写入权限");
  });
});
