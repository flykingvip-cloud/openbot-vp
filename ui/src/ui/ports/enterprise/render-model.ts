import { t } from "../../../i18n/index.ts";
import { ensureEnterpriseOperationalIdentitiesSnapshot } from "../../controllers/enterprise-operational-identity.ts";
import {
  ensureOperationalIdentityGovernanceOverview,
  readOperationalIdentityGovernancePanelState,
} from "../../controllers/operational-identity-governance.ts";
import {
  loadTenantConfig,
  patchTenantConfigValue,
  saveTenantConfig,
} from "../../controllers/tenant-channel-config.ts";
import {
  isEnterpriseImChannelId,
  resolveTenantImCallbackEntries,
} from "../../controllers/tenant-im-binding.ts";
import { ENTERPRISE_SURFACE_TABS, pathForTab } from "../../navigation.ts";
import type { CronProps } from "../../views/cron.ts";
import type { PlatformAuthPanelProps } from "../../views/platform-auth-panel.ts";
import type { EnterprisePortState } from "./port-state.ts";
import type { EnterprisePortActions } from "./render-actions.ts";
import {
  buildEnterprisePortReadModel,
  type EnterpriseResolverOption,
} from "./semantic/enterprise-read-model.ts";
import type { EnterprisePortRenderModel } from "./view-types.ts";

type BuildEnterprisePortRenderModelArgs = {
  state: EnterprisePortState;
  actions: EnterprisePortActions;
  configValue: Record<string, unknown> | null;
  currentTenantId: string | null;
  showResolver: boolean;
};

function shouldLoadEnterpriseOperationalIdentitySnapshot(state: EnterprisePortState): boolean {
  if (state.platformAuthState?.sessionKind !== "enterprise-admin") {
    return false;
  }
  return state.tab === "enterpriseSettings" || state.tab === "enterpriseOverview";
}

function shouldLoadEnterpriseOperationalIdentityGovernance(state: EnterprisePortState): boolean {
  if (state.platformAuthState?.sessionKind !== "enterprise-admin") {
    return false;
  }
  if (state.tab !== "enterpriseSettings") {
    return false;
  }
  if (typeof window === "undefined") {
    return true;
  }
  const pathname = window.location.pathname;
  if (/\/settings\/security(?:\/|$)/iu.test(pathname)) {
    return true;
  }
  if (/\/settings\/identities(?:\/|$)/iu.test(pathname)) {
    return true;
  }
  if (/\/settings\/identity-bindings(?:\/|$)/iu.test(pathname)) {
    return true;
  }
  const searchParams = new URLSearchParams(window.location.search);
  const settingsSection = searchParams.get("settingsSection");
  return (
    settingsSection === "system" ||
    settingsSection === "identities" ||
    settingsSection === "identity-bindings"
  );
}

/** Channel credentials live under 系统设置 · 渠道凭证 (and legacy /channels). */
function isEnterpriseChannelCredentialsSection(state: EnterprisePortState): boolean {
  if (state.tab === "enterpriseChannels") {
    return true;
  }
  if (state.tab !== "enterpriseSettings") {
    return false;
  }
  if (typeof window === "undefined") {
    return false;
  }
  const pathname = window.location.pathname;
  if (/\/settings\/channels(?:\/|$)/iu.test(pathname)) {
    return true;
  }
  // Legacy top-level leaf before URL rewrite
  if (/\/channels(?:\/|$)/iu.test(pathname) && !pathname.includes("/settings/")) {
    return true;
  }
  const searchParams = new URLSearchParams(window.location.search);
  return searchParams.get("settingsSection") === "channels";
}

/** Identities section also needs tenant channel form for IM soft-bridge reverse link. */
function isEnterpriseIdentitiesSection(state: EnterprisePortState): boolean {
  if (state.tab !== "enterpriseSettings") {
    return false;
  }
  if (typeof window === "undefined") {
    return false;
  }
  const pathname = window.location.pathname;
  if (/\/settings\/identities(?:\/|$)/iu.test(pathname)) {
    return true;
  }
  if (/\/settings\/identity-bindings(?:\/|$)/iu.test(pathname)) {
    return true;
  }
  const searchParams = new URLSearchParams(window.location.search);
  const settingsSection = searchParams.get("settingsSection");
  return settingsSection === "identities" || settingsSection === "identity-bindings";
}

function shouldLoadTenantChannelConfig(state: EnterprisePortState): boolean {
  return isEnterpriseChannelCredentialsSection(state) || isEnterpriseIdentitiesSection(state);
}

function mapResolverOptions(
  options: EnterpriseResolverOption[],
): EnterprisePortRenderModel["resolverProps"]["options"] {
  return options.map((option) => ({
    tenantId: option.tenantId,
    label: option.label,
    description: option.description,
    kind: option.kind,
  }));
}

export function buildEnterprisePortRenderModel({
  state,
  actions,
  configValue,
  currentTenantId,
  showResolver,
}: BuildEnterprisePortRenderModelArgs): EnterprisePortRenderModel {
  if (!showResolver && currentTenantId) {
    const identityRefreshKey = `enterprise:${currentTenantId}:${state.platformAuthState?.sessionKind ?? "anonymous"}`;
    if (shouldLoadEnterpriseOperationalIdentitySnapshot(state)) {
      ensureEnterpriseOperationalIdentitiesSnapshot(state, currentTenantId, identityRefreshKey);
    }
    if (shouldLoadEnterpriseOperationalIdentityGovernance(state)) {
      ensureOperationalIdentityGovernanceOverview({
        client: state.client,
        connected: state.connected,
        refreshKey: identityRefreshKey,
      });
    }
  }

  const readModel = buildEnterprisePortReadModel(state, configValue, currentTenantId);

  /** Prefer IM channels (Channel-only product track) when listing credential types. */
  const preferredIm = ["wecom", "feishu", "dingtalk"] as const;
  const rawChannelIds = Array.from(
    new Set(
      (
        state.channelsSnapshot?.channelMeta?.map((entry) => entry.id) ??
        state.channelsSnapshot?.channelOrder ?? [...preferredIm]
      )
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  );
  const enabledChannelIds = [
    ...preferredIm.filter((id) => rawChannelIds.includes(id)),
    ...rawChannelIds
      .filter((id) => !(preferredIm as readonly string[]).includes(id))
      .toSorted((a, b) => a.localeCompare(b, "zh-CN")),
  ];
  const selectedEnterpriseChannelId =
    enabledChannelIds.length === 0
      ? null
      : enabledChannelIds.includes(state.configActiveSection ?? "")
        ? (state.configActiveSection as string)
        : enabledChannelIds[0];

  if (
    shouldLoadTenantChannelConfig(state) &&
    currentTenantId &&
    state.connected &&
    state.client &&
    !state.tenantConfigLoading &&
    !state.tenantConfigSaving &&
    state.tenantConfigTenantId !== currentTenantId
  ) {
    void loadTenantConfig(state, currentTenantId);
  }

  const cronProps: CronProps = {
    basePath: state.basePath,
    loading: state.cronLoading,
    jobsLoadingMore: state.cronJobsLoadingMore,
    status: state.cronStatus,
    jobs: state.cronJobs,
    jobsTotal: state.cronJobsTotal,
    jobsHasMore: state.cronJobsHasMore,
    jobsQuery: state.cronJobsQuery,
    jobsEnabledFilter: state.cronJobsEnabledFilter,
    jobsScheduleKindFilter: state.cronJobsScheduleKindFilter,
    jobsLastStatusFilter: state.cronJobsLastStatusFilter,
    jobsSortBy: state.cronJobsSortBy,
    jobsSortDir: state.cronJobsSortDir,
    error: state.platformAuthError ?? state.lastError,
    busy: state.cronBusy,
    form: state.cronForm,
    fieldErrors: state.cronFieldErrors,
    canSubmit: Object.values(state.cronFieldErrors).every((value) => !value),
    canManageJobs: true,
    canRunJobs: true,
    readOnlyReason: null,
    editingJobId: state.cronEditingJobId,
    channels: state.channelsSnapshot?.channelMeta?.length
      ? state.channelsSnapshot.channelMeta.map((entry) => entry.id)
      : (state.channelsSnapshot?.channelOrder ?? []),
    channelLabels: state.channelsSnapshot?.channelLabels ?? {},
    channelMeta: state.channelsSnapshot?.channelMeta ?? [],
    runsJobId: state.cronRunsJobId,
    runs: state.cronRuns,
    runsTotal: state.cronRunsTotal,
    runsHasMore: state.cronRunsHasMore,
    runsLoadingMore: state.cronRunsLoadingMore,
    runsScope: state.cronRunsScope,
    runsStatuses: state.cronRunsStatuses,
    runsDeliveryStatuses: state.cronRunsDeliveryStatuses,
    runsStatusFilter: state.cronRunsStatusFilter,
    runsQuery: state.cronRunsQuery,
    runsSortDir: state.cronRunsSortDir,
    agentSuggestions: [],
    modelSuggestions: [],
    thinkingSuggestions: ["off", "minimal", "low", "medium", "high"],
    timezoneSuggestions: ["UTC", "Asia/Shanghai", "America/Los_Angeles"],
    deliveryToSuggestions: [],
    accountSuggestions: [],
    onFormChange: (patch) => actions.usageManagement.onCronFormChange(patch),
    onRefresh: () => actions.usageManagement.onCronRefresh(),
    onAdd: () => actions.usageManagement.onCronAdd(),
    onEdit: (job) => actions.usageManagement.onCronEdit(job),
    onClone: (job) => actions.usageManagement.onCronClone(job),
    onCancelEdit: () => actions.usageManagement.onCronCancelEdit(),
    onToggle: (job, enabled) => actions.usageManagement.onCronToggle(job, enabled),
    onRun: (job, mode) => actions.usageManagement.onCronRun(job, mode),
    onRemove: (job) => actions.usageManagement.onCronRemove(job),
    onLoadRuns: (jobId) => actions.usageManagement.onCronLoadRuns(jobId),
    onLoadMoreJobs: () => actions.usageManagement.onCronLoadMoreJobs(),
    onJobsFiltersChange: (patch) => actions.usageManagement.onCronJobsFiltersChange(patch),
    onJobsFiltersReset: () => actions.usageManagement.onCronJobsFiltersReset(),
    onLoadMoreRuns: () => actions.usageManagement.onCronLoadMoreRuns(),
    onRunsFiltersChange: (patch) => actions.usageManagement.onCronRunsFiltersChange(patch),
  };

  const authPanelProps: PlatformAuthPanelProps | null = state.platformAuthState?.enabled
    ? {
        state: state.platformAuthState,
        session:
          state.platformAuthState.session ??
          (state.hello?.auth?.provider === "trusted-proxy" && state.hello.auth.user
            ? {
                provider: "trusted-proxy" as const,
                user: state.hello.auth.user,
                displayName: state.hello.auth.displayName,
                tenantId: state.hello.auth.tenantId,
                role: state.hello.auth.role,
                scopes: state.hello.auth.scopes,
              }
            : state.bootstrapAuthSession),
        mode: state.platformAuthMode,
        busy: state.platformAuthBusy,
        error: state.platformAuthError,
        notice: state.platformAuthNotice,
        email: state.platformAuthEmail,
        password: state.platformAuthPassword,
        displayName: state.platformAuthDisplayName,
        platformAdminDisplayName: "",
        tenantName: state.platformAuthTenantName,
        seatTitle: state.platformAuthSeatTitle,
        inviteCode: state.platformAuthInviteCode,
        currentPassword: state.platformAuthCurrentPassword,
        newPassword: state.platformAuthNewPassword,
        policyTrialDays: state.platformAuthPolicyTrialDays,
        policySeatCount: state.platformAuthPolicySeatCount,
        policyUpgradeUrl: state.platformAuthPolicyUpgradeUrl,
        policyContactAdvisorUrl: state.platformAuthPolicyContactAdvisorUrl,
        instanceEnterpriseId: state.platformAuthInstanceEnterpriseId,
        instanceTrialDays: state.platformAuthInstanceTrialDays,
        instanceSeatCount: state.platformAuthInstanceSeatCount,
        instanceUpgradeUrl: state.platformAuthInstanceUpgradeUrl,
        instanceContactAdvisorUrl: state.platformAuthInstanceContactAdvisorUrl,
        platformAdminEmail: "",
        platformAdminPassword: "",
        platformAdminScopes: [],
        onModeChange: (next) => {
          state.platformAuthMode = next;
          state.platformAuthNotice = null;
        },
        onEmailChange: (next) => {
          state.platformAuthEmail = next;
          state.platformAuthNotice = null;
        },
        onPasswordChange: (next) => {
          state.platformAuthPassword = next;
          state.platformAuthNotice = null;
        },
        onDisplayNameChange: (next) => {
          state.platformAuthDisplayName = next;
          state.platformAuthNotice = null;
        },
        onPlatformAdminDisplayNameChange: () => undefined,
        onTenantNameChange: (next) => {
          state.platformAuthTenantName = next;
          state.platformAuthNotice = null;
        },
        onSeatTitleChange: (next) => {
          state.platformAuthSeatTitle = next;
          state.platformAuthNotice = null;
        },
        onInviteCodeChange: (next) => {
          state.platformAuthInviteCode = next;
          state.platformAuthNotice = null;
        },
        onCurrentPasswordChange: (next) => {
          state.platformAuthCurrentPassword = next;
          state.platformAuthNotice = null;
        },
        onNewPasswordChange: (next) => {
          state.platformAuthNewPassword = next;
          state.platformAuthNotice = null;
        },
        onPolicyTrialDaysChange: (next) => {
          state.platformAuthPolicyTrialDays = next;
          state.platformAuthNotice = null;
        },
        onPolicySeatCountChange: (next) => {
          state.platformAuthPolicySeatCount = next;
          state.platformAuthNotice = null;
        },
        onPolicyUpgradeUrlChange: (next) => {
          state.platformAuthPolicyUpgradeUrl = next;
          state.platformAuthNotice = null;
        },
        onPolicyContactAdvisorUrlChange: (next) => {
          state.platformAuthPolicyContactAdvisorUrl = next;
          state.platformAuthNotice = null;
        },
        onInstanceEnterpriseIdChange: (next) => {
          state.platformAuthInstanceEnterpriseId = next;
          state.platformAuthNotice = null;
        },
        onInstanceTrialDaysChange: (next) => {
          state.platformAuthInstanceTrialDays = next;
          state.platformAuthNotice = null;
        },
        onInstanceSeatCountChange: (next) => {
          state.platformAuthInstanceSeatCount = next;
          state.platformAuthNotice = null;
        },
        onInstanceUpgradeUrlChange: (next) => {
          state.platformAuthInstanceUpgradeUrl = next;
          state.platformAuthNotice = null;
        },
        onInstanceContactAdvisorUrlChange: (next) => {
          state.platformAuthInstanceContactAdvisorUrl = next;
          state.platformAuthNotice = null;
        },
        onPlatformAdminEmailChange: () => undefined,
        onPlatformAdminPasswordChange: () => undefined,
        onPlatformAdminScopesChange: () => undefined,
        onSubmit: () => void state.submitPlatformAuth(),
        onCreatePlatformAdmin: () => undefined,
        onLogout: () => void state.logoutPlatformAuth(),
        onCreateInvite: () => void state.createPlatformAuthInvite(),
        onRevokeInvite: (code) => void state.revokePlatformAuthInvite(code),
        onRemoveMember: (user) => void state.removePlatformAuthMember(user),
        onChangePassword: () => void state.changePlatformAuthPassword(),
        onUpdateTrialPolicy: () => void state.updatePlatformTrialPolicy(),
        onUpdateTrialInstance: () => void state.updatePlatformTrialInstance(),
      }
    : null;

  return {
    state,
    subnavProps: {
      tabs: [...ENTERPRISE_SURFACE_TABS],
      activeTab: state.tab,
      basePath: state.basePath,
      enterpriseTenantId: currentTenantId,
      ariaLabel: t("nav.enterprise"),
      onOpenConsoleTab: (tab) => state.setTab(tab),
    },
    isResolverSurface: showResolver,
    resolverProps: {
      currentTenantId,
      authenticatedUser: readModel.authenticatedUser,
      options: mapResolverOptions(readModel.resolverOptions),
      onOpenTenant: (tenantId) => {
        state.applySettings({
          ...state.settings,
          recentEnterpriseTenantIds: [
            tenantId,
            ...(state.settings.recentEnterpriseTenantIds ?? []).filter(
              (entry) => entry !== tenantId,
            ),
          ].slice(0, 8),
        });
        const target = pathForTab("enterpriseOverview", state.basePath, { tenantId });
        if (typeof window !== "undefined") {
          window.history.pushState({}, "", target);
        }
        state.setTab("enterpriseOverview");
      },
    },
    client: state.client,
    readModel,
    operationalIdentityGovernancePanel: readOperationalIdentityGovernancePanelState(),
    surfaceActions: {
      overview: actions.overview,
      organization: actions.organization,
      dataGovernance: actions.dataGovernance,
      usageManagement: actions.usageManagement,
      mesh: actions.mesh,
      usage: actions.usage,
      settings: actions.settings,
    },
    authPanelProps,
    cronProps,
    channelCredentialsEditor: {
      tenantId: currentTenantId,
      channelIds: enabledChannelIds,
      channelLabels: {
        wecom: "企业微信",
        feishu: "飞书",
        dingtalk: "钉钉",
        ...state.channelsSnapshot?.channelLabels,
      },
      selectedChannelId: selectedEnterpriseChannelId,
      configForm: state.tenantConfigForm,
      configSchema: state.configSchema,
      configUiHints: state.configUiHints ?? {},
      loading: state.tenantConfigLoading,
      saving: state.tenantConfigSaving,
      dirty: state.tenantConfigDirty,
      error: state.tenantConfigError,
      callbackEntries: selectedEnterpriseChannelId
        ? resolveTenantImCallbackEntries({
            form: state.tenantConfigForm,
            channelId: selectedEnterpriseChannelId,
          })
        : [],
      probeBusy: state.tenantImProbeBusy,
      probeResult: state.tenantImProbeResult,
      probeError: state.tenantImProbeError,
      syncBusy: state.tenantImSyncBusy,
      identityLinkHint: state.tenantImIdentityLinkHint,
      onSelectChannel: (channelId) => {
        state.configActiveSection = channelId;
        state.tenantImProbeResult = null;
        state.tenantImProbeError = null;
      },
      onPatch: (path, value) => {
        patchTenantConfigValue(state, path, value);
      },
      onSave: () => {
        if (!currentTenantId) {
          return;
        }
        void saveTenantConfig(state, currentTenantId, {
          validateChannelId: selectedEnterpriseChannelId,
        });
      },
      onReload: () => {
        if (!currentTenantId) {
          return;
        }
        void loadTenantConfig(state, currentTenantId);
      },
      onProbe: () => {
        if (!currentTenantId || !selectedEnterpriseChannelId) {
          return;
        }
        void actions.settings.onProbeImChannel(currentTenantId, selectedEnterpriseChannelId);
      },
      onSyncOperationalIdentity: () => {
        if (!currentTenantId || !selectedEnterpriseChannelId) {
          return;
        }
        if (!isEnterpriseImChannelId(selectedEnterpriseChannelId)) {
          return;
        }
        void actions.settings.onSyncChannelToOperationalIdentity(
          currentTenantId,
          selectedEnterpriseChannelId,
        );
      },
    },
    accessControlEditor: {
      kind: state.enterpriseAccessEditorKind,
      targetKey: state.enterpriseAccessEditorTargetKey,
      selectedPermissionIds: state.enterpriseAccessEditorSelectedPermissionIds,
      notice: state.enterpriseAccessEditorNotice,
      riskConfirmOpen: state.enterpriseAccessRiskConfirmOpen,
      onOpen: ({ kind, targetKey, permissionIds }) => {
        state.enterpriseAccessEditorKind = kind;
        state.enterpriseAccessEditorTargetKey = targetKey;
        state.enterpriseAccessEditorSelectedPermissionIds = [...permissionIds];
        state.enterpriseAccessEditorNotice = null;
        state.enterpriseAccessRiskConfirmOpen = false;
      },
      onClose: () => {
        state.enterpriseAccessEditorKind = null;
        state.enterpriseAccessEditorTargetKey = null;
        state.enterpriseAccessEditorSelectedPermissionIds = [];
        state.enterpriseAccessEditorNotice = null;
        state.enterpriseAccessRiskConfirmOpen = false;
      },
      onTogglePermission: (permissionId) => {
        state.enterpriseAccessEditorSelectedPermissionIds =
          state.enterpriseAccessEditorSelectedPermissionIds.includes(permissionId)
            ? state.enterpriseAccessEditorSelectedPermissionIds.filter(
                (entry) => entry !== permissionId,
              )
            : [...state.enterpriseAccessEditorSelectedPermissionIds, permissionId];
        state.enterpriseAccessEditorNotice = null;
        state.enterpriseAccessRiskConfirmOpen = false;
      },
      onSave: ({ hasHighRisk }) => {
        if (hasHighRisk) {
          state.enterpriseAccessRiskConfirmOpen = true;
          state.enterpriseAccessEditorNotice = null;
          return;
        }
        state.enterpriseAccessEditorNotice =
          "网关未连接，权限没有写入。只有 usage:budget 会在提交后改变鉴权。";
        state.enterpriseAccessRiskConfirmOpen = false;
      },
      onCancelRisk: () => {
        state.enterpriseAccessRiskConfirmOpen = false;
      },
      onConfirmRisk: () => {
        state.enterpriseAccessEditorNotice = "网关未连接，高风险权限没有写入。";
        state.enterpriseAccessRiskConfirmOpen = false;
      },
    },
    createPositionEditor: {
      open: state.enterpriseSeatCreateEditorOpen,
      seatId: state.enterpriseSeatCreateEditorSeatId,
      seatTitle: state.enterpriseSeatCreateEditorSeatTitle,
      teamLabel: state.enterpriseSeatCreateEditorTeamLabel,
      responsibility: state.enterpriseSeatCreateEditorResponsibility,
      employeeEmail: state.enterpriseSeatCreateEditorEmployeeEmail,
      defaultAgentId: state.enterpriseSeatCreateEditorDefaultAgentId,
      agentIds: state.enterpriseSeatCreateEditorAgentIds,
      agentOptions: Array.from(
        new Set(
          [
            readModel.defaultAgentId,
            ...readModel.seatSummaries.map((entry) => entry.defaultAgentId),
            ...readModel.seatSummaries.flatMap((entry) => entry.agentIds),
            ...state.enterpriseSeatCreateEditorAgentIds,
            state.enterpriseSeatCreateEditorDefaultAgentId,
            ...readModel.meshAgents.map((entry) => entry.agentId),
          ].filter(
            (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
          ),
        ),
      ).toSorted((left, right) => left.localeCompare(right, "zh-CN")),
      busy: state.platformAuthBusy,
      error: state.platformAuthError,
      notice: state.platformAuthNotice,
      onOpen: (params) => state.openEnterpriseSeatCreateEditor(params),
      onClose: () => state.closeEnterpriseSeatCreateEditor(),
      onSeatTitleChange: (value) => {
        state.enterpriseSeatCreateEditorSeatTitle = value;
        state.platformAuthError = null;
        state.platformAuthNotice = null;
      },
      onTeamLabelChange: (value) => {
        state.enterpriseSeatCreateEditorTeamLabel = value;
        state.platformAuthError = null;
        state.platformAuthNotice = null;
      },
      onResponsibilityChange: (value) => {
        state.enterpriseSeatCreateEditorResponsibility = value;
        state.platformAuthError = null;
        state.platformAuthNotice = null;
      },
      onEmployeeEmailChange: (value) => {
        state.enterpriseSeatCreateEditorEmployeeEmail = value;
        state.platformAuthError = null;
        state.platformAuthNotice = null;
      },
      onDefaultAgentIdChange: (value) => {
        const previousDefaultId = state.enterpriseSeatCreateEditorDefaultAgentId.trim();
        const nextDefaultId = value.trim();
        const nextAgentIds = state.enterpriseSeatCreateEditorAgentIds.filter(
          (entry) => entry !== previousDefaultId,
        );
        if (nextDefaultId && !nextAgentIds.includes(nextDefaultId)) {
          nextAgentIds.unshift(nextDefaultId);
        }
        state.enterpriseSeatCreateEditorAgentIds = nextAgentIds.slice(0, 5);
        state.enterpriseSeatCreateEditorDefaultAgentId = value;
        state.platformAuthError = null;
        state.platformAuthNotice = null;
      },
      onToggleAgentId: (value) => {
        const agentId = value.trim();
        if (!agentId) {
          return;
        }
        const defaultAgentId = state.enterpriseSeatCreateEditorDefaultAgentId.trim();
        const selected = state.enterpriseSeatCreateEditorAgentIds;
        if (selected.includes(agentId)) {
          if (agentId === defaultAgentId) {
            return;
          }
          state.enterpriseSeatCreateEditorAgentIds = selected.filter((entry) => entry !== agentId);
          state.platformAuthError = null;
          state.platformAuthNotice = null;
          return;
        }
        if (selected.length >= 5) {
          state.platformAuthError = "岗位负责人最多创建 5 个 Bot。";
          state.platformAuthNotice = null;
          return;
        }
        state.enterpriseSeatCreateEditorAgentIds = [...selected, agentId];
        state.platformAuthError = null;
        state.platformAuthNotice = null;
      },
      onSubmit: () => {
        if (readModel.currentTenantId) {
          void state.submitEnterpriseSeatCreate(readModel.currentTenantId);
        }
      },
    },
    seatOfferEditor: {
      mode: state.enterpriseSeatOfferEditorMode,
      seatId: state.enterpriseSeatOfferEditorSeatId,
      seatTitle: state.enterpriseSeatOfferEditorSeatTitle,
      seatStatus: state.enterpriseSeatOfferEditorSeatStatus,
      defaultAgentId: state.enterpriseSeatOfferEditorDefaultAgentId,
      availableAgentIds: state.enterpriseSeatOfferEditorAvailableAgentIds,
      defaultSpaceIds: state.enterpriseSeatOfferEditorDefaultSpaceIds,
      selectedAgentIds: state.enterpriseSeatOfferEditorSelectedAgentIds,
      selectedSpaceIds: state.enterpriseSeatOfferEditorSelectedSpaceIds,
      inheritMode: state.enterpriseSeatOfferEditorInheritMode,
      inheritMemoryScope: state.enterpriseSeatOfferEditorInheritMemoryScope,
      memoryScopeAvailable: state.enterpriseSeatOfferEditorMemoryScopeAvailable,
      employeeEmail: state.enterpriseSeatOfferEditorEmployeeEmail,
      busy: state.platformAuthBusy,
      error: state.platformAuthError,
      notice: state.platformAuthNotice,
      onOpen: (params) => state.openEnterpriseSeatOfferEditor(params),
      onClose: () => state.closeEnterpriseSeatOfferEditor(),
      onEmployeeEmailChange: (value) => {
        state.enterpriseSeatOfferEditorEmployeeEmail = value;
        state.platformAuthNotice = null;
      },
      onInheritModeChange: (value) => {
        state.enterpriseSeatOfferEditorInheritMode = value;
        state.platformAuthNotice = null;
      },
      onToggleAgentId: (value) => {
        const agentId = value.trim();
        if (!agentId) {
          return;
        }
        const selected = state.enterpriseSeatOfferEditorSelectedAgentIds;
        state.enterpriseSeatOfferEditorSelectedAgentIds = selected.includes(agentId)
          ? selected.filter((entry) => entry !== agentId)
          : [...selected, agentId];
        state.platformAuthNotice = null;
      },
      onToggleSpaceId: (value) => {
        const spaceId = value.trim();
        if (!spaceId) {
          return;
        }
        const selected = state.enterpriseSeatOfferEditorSelectedSpaceIds;
        state.enterpriseSeatOfferEditorSelectedSpaceIds = selected.includes(spaceId)
          ? selected.filter((entry) => entry !== spaceId)
          : [...selected, spaceId];
        state.platformAuthNotice = null;
      },
      onInheritMemoryScopeChange: (value) => {
        state.enterpriseSeatOfferEditorInheritMemoryScope = value;
        state.platformAuthNotice = null;
      },
      onSubmit: () => {
        if (readModel.currentTenantId) {
          void state.submitEnterpriseSeatOffer(readModel.currentTenantId);
        }
      },
    },
    handoverEditor: {
      caseId: state.enterpriseHandoverEditorCaseId,
      seatTitle: state.enterpriseHandoverEditorSeatTitle,
      seatId: state.enterpriseHandoverEditorSeatId,
      status: state.enterpriseHandoverEditorStatus,
      reviewSummary: state.enterpriseHandoverEditorReviewSummary,
      exceptionFlags: state.enterpriseHandoverEditorExceptionFlags,
      successorEmail: state.enterpriseHandoverEditorSuccessorEmail,
      seatStatus: state.enterpriseHandoverEditorSeatStatus,
      defaultAgentIds: state.enterpriseHandoverEditorDefaultAgentIds,
      defaultSpaceIds: state.enterpriseHandoverEditorDefaultSpaceIds,
      selectedAgentIds: state.enterpriseHandoverEditorSelectedAgentIds,
      selectedDataKeys: state.enterpriseHandoverEditorSelectedDataKeys,
      selectedSpaceIds: state.enterpriseHandoverEditorSelectedSpaceIds,
      selectedPolicyIds: state.enterpriseHandoverEditorSelectedPolicyIds,
      draftNotice: state.enterpriseHandoverEditorDraftNotice,
      currentEmployeeEmail: state.enterpriseHandoverEditorCurrentEmployeeEmail,
      currentEmployeeDisplayName: state.enterpriseHandoverEditorCurrentEmployeeDisplayName,
      bindingStatus: state.enterpriseHandoverEditorBindingStatus,
      teamLabel: state.enterpriseHandoverEditorTeamLabel,
      assetSnapshot: state.enterpriseHandoverEditorAssetSnapshot,
      assetQuery: state.enterpriseHandoverEditorAssetQuery,
      assetKindFilter: state.enterpriseHandoverEditorAssetKindFilter,
      busy: state.platformAuthBusy,
      error: state.platformAuthError,
      notice: state.platformAuthNotice,
      employeePolicies: state.enterpriseHandoverEditorEmployeePolicies,
      seatPolicies: state.enterpriseHandoverEditorSeatPolicies,
      onOpen: (params) => {
        if (!readModel.currentTenantId) {
          state.openEnterpriseHandoverEditor(params);
          return;
        }
        void state.openEnterpriseHandoverRoute({
          tenantId: readModel.currentTenantId,
          handoverCaseId: params.handoverCaseId,
          seatTitle: params.seatTitle,
          status: params.status,
          reviewSummary: params.reviewSummary,
          exceptionFlags: params.exceptionFlags,
          incomingEmployeeUser: params.incomingEmployeeUser,
        });
      },
      onClose: () => state.closeEnterpriseHandoverEditor(),
      onReviewSummaryChange: (value) => {
        state.enterpriseHandoverEditorReviewSummary = value;
        state.platformAuthNotice = null;
        state.enterpriseHandoverEditorDraftNotice = null;
      },
      onExceptionFlagsChange: (value) => {
        state.enterpriseHandoverEditorExceptionFlags = value;
        state.platformAuthNotice = null;
        state.enterpriseHandoverEditorDraftNotice = null;
      },
      onSuccessorEmailChange: (value) => {
        state.enterpriseHandoverEditorSuccessorEmail = value;
        state.platformAuthNotice = null;
        state.enterpriseHandoverEditorDraftNotice = null;
      },
      onToggleAgentAsset: (id) => {
        state.enterpriseHandoverEditorSelectedAgentIds =
          state.enterpriseHandoverEditorSelectedAgentIds.includes(id)
            ? state.enterpriseHandoverEditorSelectedAgentIds.filter((entry) => entry !== id)
            : [...state.enterpriseHandoverEditorSelectedAgentIds, id];
        state.enterpriseHandoverEditorDraftNotice = null;
      },
      onToggleDataAsset: (key) => {
        state.enterpriseHandoverEditorSelectedDataKeys =
          state.enterpriseHandoverEditorSelectedDataKeys.includes(key)
            ? state.enterpriseHandoverEditorSelectedDataKeys.filter((entry) => entry !== key)
            : [...state.enterpriseHandoverEditorSelectedDataKeys, key];
        state.enterpriseHandoverEditorDraftNotice = null;
      },
      onToggleSpaceAsset: (id) => {
        state.enterpriseHandoverEditorSelectedSpaceIds =
          state.enterpriseHandoverEditorSelectedSpaceIds.includes(id)
            ? state.enterpriseHandoverEditorSelectedSpaceIds.filter((entry) => entry !== id)
            : [...state.enterpriseHandoverEditorSelectedSpaceIds, id];
        state.enterpriseHandoverEditorDraftNotice = null;
      },
      onTogglePolicyAsset: (id) => {
        state.enterpriseHandoverEditorSelectedPolicyIds =
          state.enterpriseHandoverEditorSelectedPolicyIds.includes(id)
            ? state.enterpriseHandoverEditorSelectedPolicyIds.filter((entry) => entry !== id)
            : [...state.enterpriseHandoverEditorSelectedPolicyIds, id];
        state.enterpriseHandoverEditorDraftNotice = null;
      },
      onAssetQueryChange: (value) => {
        state.enterpriseHandoverEditorAssetQuery = value;
      },
      onAssetKindFilterChange: (value) => {
        state.enterpriseHandoverEditorAssetKindFilter = value;
      },
      onSelectAllAssets: () => {
        state.enterpriseHandoverEditorSelectedAgentIds = [
          ...state.enterpriseHandoverEditorDefaultAgentIds,
        ];
        const seatId =
          state.enterpriseHandoverEditorSeatId ??
          readModel.seatSummaries.find(
            (seat) => seat.title === state.enterpriseHandoverEditorSeatTitle,
          )?.seatId ??
          null;
        const seatGroupIds = seatId
          ? readModel.meshGroups
              .filter((group) => group.ownership.positionId === seatId)
              .map((group) => group.groupId)
          : [];
        state.enterpriseHandoverEditorSelectedSpaceIds = [
          ...new Set([...state.enterpriseHandoverEditorDefaultSpaceIds, ...seatGroupIds]),
        ];
        state.enterpriseHandoverEditorSelectedDataKeys = [
          "recent_sessions",
          "knowledge",
          "history_archive",
        ];
        state.enterpriseHandoverEditorSelectedPolicyIds = [
          ...state.enterpriseHandoverEditorEmployeePolicies.map((policy) => policy.policyId),
          ...state.enterpriseHandoverEditorSeatPolicies.map((policy) => policy.policyId),
        ];
        state.enterpriseHandoverEditorDraftNotice = null;
      },
      onSelectFilteredAssets: () => {
        state.enterpriseHandoverEditorSelectedAgentIds = [
          ...state.enterpriseHandoverEditorDefaultAgentIds,
        ];
        const seatId =
          state.enterpriseHandoverEditorSeatId ??
          readModel.seatSummaries.find(
            (seat) => seat.title === state.enterpriseHandoverEditorSeatTitle,
          )?.seatId ??
          null;
        const seatGroupIds = seatId
          ? readModel.meshGroups
              .filter((group) => group.ownership.positionId === seatId)
              .map((group) => group.groupId)
          : [];
        state.enterpriseHandoverEditorSelectedSpaceIds = [
          ...new Set([...state.enterpriseHandoverEditorDefaultSpaceIds, ...seatGroupIds]),
        ];
        state.enterpriseHandoverEditorSelectedDataKeys = [
          "recent_sessions",
          "knowledge",
          "history_archive",
        ];
        state.enterpriseHandoverEditorSelectedPolicyIds = [
          ...state.enterpriseHandoverEditorEmployeePolicies.map((policy) => policy.policyId),
          ...state.enterpriseHandoverEditorSeatPolicies.map((policy) => policy.policyId),
        ];
        state.enterpriseHandoverEditorDraftNotice = null;
      },
      onClearSelectedAssets: () => {
        state.enterpriseHandoverEditorSelectedAgentIds = [];
        state.enterpriseHandoverEditorSelectedSpaceIds = [];
        state.enterpriseHandoverEditorSelectedDataKeys = [];
        state.enterpriseHandoverEditorSelectedPolicyIds = [];
        state.enterpriseHandoverEditorDraftNotice = null;
      },
      onSaveDraft: () => {
        state.enterpriseHandoverEditorDraftNotice = "已保存本地草稿，可稍后继续处理。";
        state.platformAuthNotice = null;
      },
      onSubmitNominate: () => {
        if (readModel.currentTenantId) {
          void state.submitEnterpriseHandoverNominate(readModel.currentTenantId);
        }
      },
      onSubmitReview: () => {
        if (readModel.currentTenantId) {
          void state.submitEnterpriseHandoverReview(readModel.currentTenantId);
        }
      },
      onSubmitApproval: () => {
        if (readModel.currentTenantId) {
          void state.submitEnterpriseHandoverApproval(readModel.currentTenantId);
        }
      },
      onSubmitRebind: () => {
        if (readModel.currentTenantId) {
          void state.submitEnterpriseHandoverRebind(readModel.currentTenantId);
        }
      },
    },
    identityManagementEditor: {
      open: state.enterpriseIdentityEditorOpen,
      mode: state.enterpriseIdentityEditorMode,
      identityId: state.enterpriseIdentityEditorIdentityId,
      policyId: state.enterpriseIdentityEditorPolicyId,
      bindingId: state.enterpriseIdentityEditorBindingId,
      displayName: state.enterpriseIdentityEditorDisplayName,
      credentialBindingId: state.enterpriseIdentityEditorCredentialBindingId,
      provider: state.enterpriseIdentityEditorProvider,
      registerStep:
        state.enterpriseIdentityEditorMode === "register" &&
        !(state.enterpriseIdentityEditorProvider ?? "").trim()
          ? "provider"
          : "connect",
      seatIds: state.enterpriseIdentityEditorSeatIds,
      agentIds: state.enterpriseIdentityEditorAgentIds,
      allowedActions: state.enterpriseIdentityEditorAllowedActions,
      policyPickerQuery: state.enterpriseIdentityEditorPolicyPickerQuery,
      policyDepartmentPaths: state.enterpriseIdentityEditorPolicyDepartmentPaths,
      dataSourceId: state.enterpriseIdentityEditorDataSourceId,
      bindingPurpose: state.enterpriseIdentityEditorBindingPurpose,
      busy: state.enterpriseOperationalIdentityBusy,
      error: state.enterpriseOperationalIdentityError,
      notice: state.enterpriseOperationalIdentityNotice,
      eligibleCredentialBindings:
        state.enterpriseOperationalIdentities?.eligibleCredentialBindings ?? [],
      eligibleDataSources: state.enterpriseOperationalIdentities?.eligibleDataSources ?? [],
      identityOptions: (state.enterpriseOperationalIdentities?.identities ?? []).map((entry) => ({
        identityId: entry.identityId,
        displayName: entry.displayName,
        providerLabel: entry.providerLabel,
      })),
      onOpen: (params) => state.openEnterpriseIdentityEditor(params),
      onClose: () => state.closeEnterpriseIdentityEditor(),
      onDisplayNameChange: (value) => {
        state.enterpriseIdentityEditorDisplayName = value;
      },
      onCredentialBindingIdChange: (value) => {
        state.enterpriseIdentityEditorCredentialBindingId = value;
      },
      onRegisterProviderSelect: (provider) => {
        const catalog = state.enterpriseOperationalIdentities?.providerCatalog ?? [];
        const entry = catalog.find((item) => item.provider === provider);
        const existingCount = (state.enterpriseOperationalIdentities?.identities ?? []).filter(
          (identity) => identity.provider === provider,
        ).length;
        state.enterpriseIdentityEditorProvider = provider;
        state.enterpriseIdentityEditorCredentialBindingId = "";
        state.enterpriseIdentityEditorCredentialFields = {};
        state.enterpriseIdentityEditorCredentialFieldsReady = true;
        state.enterpriseIdentityEditorInitialSecretsConfigured = [];
        if (!(state.enterpriseIdentityEditorDisplayName ?? "").trim() && entry) {
          state.enterpriseIdentityEditorDisplayName =
            existingCount > 0 ? `${entry.label} ${existingCount + 1}` : entry.label;
        }
        (state as { requestUpdate?: () => void }).requestUpdate?.();
      },
      onRegisterProviderBack: () => {
        state.enterpriseIdentityEditorProvider = "";
        state.enterpriseIdentityEditorCredentialBindingId = "";
        state.enterpriseIdentityEditorCredentialFields = {};
        (state as { requestUpdate?: () => void }).requestUpdate?.();
      },
      onStartOAuth: (provider) => {
        const tenantId = currentTenantId ?? readModel.currentTenantId ?? "";
        if (!tenantId) {
          state.enterpriseOperationalIdentityError = "无法识别当前企业租户，请刷新页面后重试。";
          return;
        }
        void state.startEnterpriseOperationalIdentityOAuth(tenantId, provider, {
          displayName: state.enterpriseIdentityEditorDisplayName,
        });
      },
      onIdentityIdChange: (value) => {
        state.enterpriseIdentityEditorIdentityId = value;
      },
      onSeatIdsChange: (value) => {
        state.enterpriseIdentityEditorSeatIds = value;
      },
      onAgentIdsChange: (value) => {
        state.enterpriseIdentityEditorAgentIds = value;
      },
      onAllowedActionsChange: (value) => {
        state.enterpriseIdentityEditorAllowedActions = value;
      },
      onPolicyPickerQueryChange: (value) => {
        state.enterpriseIdentityEditorPolicyPickerQuery = value;
      },
      onPolicyDepartmentPathsChange: (value) => {
        state.enterpriseIdentityEditorPolicyDepartmentPaths = value;
      },
      onDataSourceIdChange: (value) => {
        state.enterpriseIdentityEditorDataSourceId = value;
      },
      onBindingPurposeChange: (value) => {
        state.enterpriseIdentityEditorBindingPurpose = value;
      },
      onSubmit: () => {
        const tenantId = currentTenantId ?? readModel.currentTenantId ?? "";
        if (!tenantId) {
          state.enterpriseOperationalIdentityError = "无法识别当前企业租户，请刷新页面后重试。";
          return;
        }
        void state.submitEnterpriseIdentityEditor(tenantId);
      },
      selectedDetailIdentityId: state.enterpriseOperationalIdentityDetailId,
      detailTab: state.enterpriseOperationalIdentityDetailTab,
      onSelectDetailIdentity: (identityId) => {
        state.enterpriseOperationalIdentityDetailId = identityId;
        if (state.enterpriseIdentityEditorOpen) {
          state.closeEnterpriseIdentityEditor();
        }
        state.enterpriseOperationalIdentityDetailTab = "usage";
      },
      onSaveCredentialConfig: () => {
        if (readModel.currentTenantId) {
          void state.saveEnterpriseIdentityCredentialConfig(readModel.currentTenantId);
        }
      },
      credentialFields: state.enterpriseIdentityEditorCredentialFields,
      credentialFieldsReady: state.enterpriseIdentityEditorCredentialFieldsReady,
      credentialSecretsConfigured: (() => {
        if (state.enterpriseIdentityEditorMode !== "credential") {
          return [];
        }
        const identityId = (state.enterpriseIdentityEditorIdentityId ?? "").trim();
        const identity = (state.enterpriseOperationalIdentities?.identities ?? []).find(
          (entry) => entry.identityId === identityId,
        );
        return (
          identity?.credentialEditPreview?.secretsConfigured ??
          state.enterpriseIdentityEditorInitialSecretsConfigured ??
          []
        );
      })(),
      onCredentialFieldChange: (key, value) => {
        state.enterpriseIdentityEditorCredentialFields = {
          ...state.enterpriseIdentityEditorCredentialFields,
          [key]: value,
        };
      },
      onDetailTabChange: (tab) => {
        state.enterpriseOperationalIdentityDetailTab = tab;
      },
      revokeConfirmIdentityId: state.enterpriseIdentityRevokeConfirmId ?? "",
      onOpenRevokeConfirm: (identityId) => {
        state.openEnterpriseIdentityRevokeConfirm(identityId);
      },
      onCloseRevokeConfirm: () => {
        state.closeEnterpriseIdentityRevokeConfirm();
      },
      onConfirmRevoke: () => {
        const tenantId = readModel.currentTenantId;
        const identityId = (state.enterpriseIdentityRevokeConfirmId ?? "").trim();
        if (tenantId && identityId) {
          void state.revokeEnterpriseOperationalIdentity(tenantId, identityId);
        }
      },
      onVerifyIdentity: (identityId) => {
        const tenantId = readModel.currentTenantId;
        if (tenantId && identityId.trim()) {
          void state.verifyEnterpriseOperationalIdentity(tenantId, identityId.trim());
        }
      },
      onMarkEmployeeBindingActivityRead: () => {
        state.enterpriseOperationalIdentityNotice = null;
        (state as { requestUpdate?: () => void }).requestUpdate?.();
      },
    },
    ownershipTransferEditor: {
      open: state.enterpriseOwnershipTransferEditorOpen,
      tenantId: state.enterpriseOwnershipTransferEditorTenantId,
      subjectKind: state.enterpriseOwnershipTransferEditorSubjectKind,
      subjectId: state.enterpriseOwnershipTransferEditorSubjectId,
      subjectLabel: state.enterpriseOwnershipTransferEditorSubjectLabel,
      positionId: state.enterpriseOwnershipTransferEditorPositionId,
      positionLabel: state.enterpriseOwnershipTransferEditorPositionLabel,
      currentManagerUserId: state.enterpriseOwnershipTransferEditorCurrentManagerUserId,
      currentManagerLabel: state.enterpriseOwnershipTransferEditorCurrentManagerLabel,
      selectedUserId: state.enterpriseOwnershipTransferEditorSelectedUserId,
      candidateMembers: readModel.memberSummaries.filter(
        (entry) =>
          entry.user !== state.enterpriseOwnershipTransferEditorCurrentManagerUserId &&
          Boolean(entry.seatTitle?.trim()),
      ),
      busy: state.platformAuthBusy,
      error: state.platformAuthError,
      notice: state.platformAuthNotice,
      onOpen: (params) => state.openEnterpriseOwnershipTransferEditor(params),
      onClose: () => state.closeEnterpriseOwnershipTransferEditor(),
      onSelectedUserChange: (value) => {
        state.enterpriseOwnershipTransferEditorSelectedUserId = value;
        state.platformAuthError = null;
        state.platformAuthNotice = null;
      },
      onSubmit: () => {
        void state.submitEnterpriseOwnershipTransfer();
      },
    },
  };
}
