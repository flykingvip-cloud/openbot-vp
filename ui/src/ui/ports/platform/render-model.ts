import type {
  ControlUiPlatformAuthMode,
  ControlUiPlatformAuthState,
} from "../../../../../src/gateway/control-ui-contract.js";
import { t } from "../../../i18n/index.ts";
import {
  applyCapabilityGovernanceViewState,
  selectCapabilityGovernanceSnapshot,
} from "../../capability/capability-governance/facade.ts";
import {
  ensureOperationalIdentityGovernanceOverview,
  readOperationalIdentityGovernancePanelState,
} from "../../controllers/operational-identity-governance.ts";
import { PLATFORM_SURFACE_TABS } from "../../navigation.ts";
import { canExecuteGatewayMethod } from "../../routing/port-permissions.ts";
import type { ChannelsProps } from "../../views/channels.types.ts";
import type { InstancesProps } from "../../views/instances.ts";
import type { LogsProps } from "../../views/logs.ts";
import type { NodesProps } from "../../views/nodes.ts";
import type { PlatformAuthPanelProps } from "../../views/platform-auth-panel.ts";
import type { SessionsProps } from "../../views/sessions.ts";
import type { SkillsProps } from "../../views/skills.ts";
import { getOrCreateCapabilityGovernanceViewState } from "./capability-governance-state.ts";
import { resolveActivePlatformAuthSession } from "./platform-auth-session.ts";
import type { PlatformPortState } from "./port-state.ts";
import type { PlatformPortActions } from "./render-actions.ts";
import { buildPlatformPortReadModel } from "./semantic/platform-read-model.ts";
import { buildPlatformPageViewModels } from "./view-models/builders.ts";
import type { PlatformPortRenderModel } from "./view-types.ts";

type BuildPlatformPortRenderModelArgs = {
  state: PlatformPortState;
  actions: PlatformPortActions;
  configValue: Record<string, unknown> | null;
};

function buildSystemSettingsFallbackAuthState(
  mode: ControlUiPlatformAuthMode,
): ControlUiPlatformAuthState {
  const availableModes: ControlUiPlatformAuthMode[] = [
    "platform-bootstrap",
    "platform-super-admin-login",
    "platform-admin-login",
  ];
  return {
    enabled: true,
    hasUsers: false,
    hasPlatformAdmins: false,
    requiresPlatformBootstrap: mode === "platform-bootstrap",
    availableModes,
  };
}

export function buildPlatformPortRenderModel({
  state,
  actions,
  configValue,
}: BuildPlatformPortRenderModelArgs): PlatformPortRenderModel {
  const readModel = buildPlatformPortReadModel(state, configValue);
  const effectivePlatformAuthState =
    state.platformAuthState ??
    (state.tab === "platformSystemSettings"
      ? buildSystemSettingsFallbackAuthState(state.platformAuthMode)
      : null);
  const canManagePlatform = Boolean(
    effectivePlatformAuthState?.canManagePlatform ||
    effectivePlatformAuthState?.availableModes?.includes("platform-enterprise-create"),
  );
  const authPanelProps: PlatformAuthPanelProps | null = effectivePlatformAuthState?.enabled
    ? {
        state: effectivePlatformAuthState,
        session:
          resolveActivePlatformAuthSession(state) ?? effectivePlatformAuthState.session ?? null,
        mode: state.platformAuthMode,
        busy: state.platformAuthBusy,
        error: state.platformAuthError,
        notice: state.platformAuthNotice,
        email: state.platformAuthEmail,
        password: state.platformAuthPassword,
        displayName: state.platformAuthDisplayName,
        platformAdminDisplayName: state.platformAuthPlatformAdminDisplayName,
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
        creationMode: state.platformAuthCreationMode ?? "quick-trial",
        platformAdminEmail: state.platformAuthPlatformAdminEmail,
        platformAdminPassword: state.platformAuthPlatformAdminPassword,
        platformAdminScopes: state.platformAuthPlatformAdminScopes,
        compact: state.tab !== "platformSystemSettings",
        onModeChange: (next) => {
          if (next === "platform-enterprise-create" && !canManagePlatform) {
            state.platformAuthNotice = t("overview.platformAuth.platform.adminCreateOnly");
            return;
          }
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
        onPlatformAdminDisplayNameChange: (next) => {
          state.platformAuthPlatformAdminDisplayName = next;
          state.platformAuthNotice = null;
        },
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
        onCreationModeChange: (next) => {
          state.platformAuthCreationMode = next;
          state.platformAuthNotice = null;
        },
        onPlatformAdminEmailChange: (next) => {
          state.platformAuthPlatformAdminEmail = next;
          state.platformAuthNotice = null;
        },
        onPlatformAdminPasswordChange: (next) => {
          state.platformAuthPlatformAdminPassword = next;
          state.platformAuthNotice = null;
        },
        onPlatformAdminScopesChange: (next) => {
          state.platformAuthPlatformAdminScopes = [...next];
          state.platformAuthNotice = null;
        },
        onSubmit: () => void state.submitPlatformAuth(),
        onCreatePlatformAdmin: () => void state.createPlatformAdmin(),
        onRemovePlatformAdmin: (user) => void state.removePlatformAdmin(user),
        onLogout: () => void state.logoutPlatformAuth(),
        onSetMfaPolicy: (requireMfa) => void state.setPlatformMfaPolicy(requireMfa),
        onCreateInvite: () => void state.createPlatformAuthInvite(),
        onRevokeInvite: (code) => void state.revokePlatformAuthInvite(code),
        onRemoveMember: (user) => void state.removePlatformAuthMember(user),
        onChangePassword: () => void state.changePlatformAuthPassword(),
        onUpdateTrialPolicy: () => void state.updatePlatformTrialPolicy(),
        onUpdateTrialInstance: () => void state.updatePlatformTrialInstance(),
      }
    : null;
  const channelsProps: ChannelsProps = {
    connected: state.connected,
    loading: state.channelsLoading,
    snapshot: state.channelsSnapshot,
    // channels.status load failure. Channel cards read snapshot lastError.
    // This is not host.lastError and must not drive gateway banners.
    lastError: state.channelsError,
    lastSuccessAt: state.channelsLastSuccess,
    whatsappMessage: state.whatsappLoginMessage,
    whatsappQrDataUrl: state.whatsappLoginQrDataUrl,
    whatsappConnected: state.whatsappLoginConnected,
    whatsappBusy: state.whatsappBusy,
    configSchema: state.configSchema,
    configSchemaLoading: state.configSchemaLoading,
    configForm: state.configForm,
    configUiHints: state.configUiHints,
    configSaving: state.configSaving,
    configFormDirty: state.configFormDirty,
    nostrProfileFormState: state.nostrProfileFormState,
    nostrProfileAccountId: state.nostrProfileAccountId,
    onRefresh: (probe) => actions.channels.onRefresh(probe),
    onWhatsAppStart: (force) => actions.channels.onWhatsAppStart(force),
    onWhatsAppWait: () => actions.channels.onWhatsAppWait(),
    onWhatsAppLogout: () => actions.channels.onWhatsAppLogout(),
    onConfigPatch: (path, value) => actions.channels.onConfigPatch(path, value),
    onConfigSave: () => actions.channels.onConfigSave(),
    onConfigReload: () => actions.channels.onConfigReload(),
    onNostrProfileEdit: (accountId, profile) =>
      actions.channels.onNostrProfileEdit(accountId, profile),
    onNostrProfileCancel: () => actions.channels.onNostrProfileCancel(),
    onNostrProfileFieldChange: (field, value) =>
      actions.channels.onNostrProfileFieldChange(field, value),
    onNostrProfileSave: () => actions.channels.onNostrProfileSave(),
    onNostrProfileImport: () => actions.channels.onNostrProfileImport(),
    onNostrProfileToggleAdvanced: () => actions.channels.onNostrProfileToggleAdvanced(),
  };
  const readOnlyReason = t("common.readOnlyNotice");
  const canManageCapabilities =
    canManagePlatform ||
    canExecuteGatewayMethod(state, "skills.update") ||
    canExecuteGatewayMethod(state, "skills.install");
  const skillsProps: SkillsProps | null = state.connected
    ? {
        loading: state.skillsLoading,
        report: state.skillsReport,
        error: state.skillsError,
        canManage: canManageCapabilities,
        readOnlyReason: canManageCapabilities ? null : readOnlyReason,
        filter: state.skillsFilter,
        edits: state.skillEdits,
        busyKey: state.skillsBusyKey,
        messages: state.skillMessages,
        onFilterChange: (next) => {
          state.skillsFilter = next;
        },
        onRefresh: actions.skills.onRefresh,
        onToggle: actions.skills.onToggle,
        onEdit: actions.skills.onEdit,
        onSaveKey: actions.skills.onSaveKey,
        onInstall: actions.skills.onInstall,
      }
    : null;
  const instancesProps: InstancesProps = {
    loading: state.presenceLoading,
    entries: state.presenceEntries,
    lastError: state.presenceError,
    statusMessage: state.presenceStatus,
    onRefresh: actions.instances.onRefresh,
  };
  const nodesProps: NodesProps = {
    loading: state.nodesLoading,
    nodes: state.nodes,
    devicesLoading: state.devicesLoading,
    devicesError: state.devicesError,
    devicesList: state.devicesList,
    configForm: state.configForm,
    configLoading: state.configLoading,
    configSaving: state.configSaving,
    configDirty: state.configFormDirty,
    configFormMode: state.configFormMode,
    execApprovalsLoading: state.execApprovalsLoading,
    execApprovalsSaving: state.execApprovalsSaving,
    execApprovalsDirty: state.execApprovalsDirty,
    execApprovalsSnapshot: state.execApprovalsSnapshot,
    execApprovalsForm: state.execApprovalsForm,
    execApprovalsSelectedAgent: state.execApprovalsSelectedAgent,
    execApprovalsTarget: state.execApprovalsTarget,
    execApprovalsTargetNodeId: state.execApprovalsTargetNodeId,
    canManageDevices: true,
    canManageBindings: true,
    canManageExecApprovals: true,
    readOnlyReason: null,
    onRefresh: () => actions.advanced.onRefreshNodes(),
    onDevicesRefresh: () => actions.advanced.onRefreshDevices(),
    onDeviceApprove: (requestId) => actions.advanced.onDeviceApprove(requestId),
    onDeviceReject: (requestId) => actions.advanced.onDeviceReject(requestId),
    onDeviceRotate: (deviceId, role, scopes) =>
      actions.advanced.onDeviceRotate(deviceId, role, scopes),
    onDeviceRevoke: (deviceId, role) => actions.advanced.onDeviceRevoke(deviceId, role),
    onLoadConfig: () => actions.advanced.onLoadBindingsConfig(),
    onLoadExecApprovals: () => actions.advanced.onLoadExecApprovals(),
    onBindDefault: (nodeId) => actions.advanced.onBindDefaultNode(nodeId),
    onBindAgent: (agentIndex, nodeId) => actions.advanced.onBindAgentNode(agentIndex, nodeId),
    onSaveBindings: () => actions.advanced.onSaveBindings(),
    onExecApprovalsTargetChange: (kind, nodeId) =>
      actions.advanced.onExecApprovalsTargetChange(kind, nodeId),
    onExecApprovalsSelectAgent: (agentId) => actions.advanced.onExecApprovalsSelectAgent(agentId),
    onExecApprovalsPatch: (path, value) => actions.advanced.onExecApprovalsPatch(path, value),
    onExecApprovalsRemove: (path) => actions.advanced.onExecApprovalsRemove(path),
    onSaveExecApprovals: () => actions.advanced.onSaveExecApprovals(),
  };
  const sessionsProps: SessionsProps = {
    loading: state.sessionsLoading,
    result: state.sessionsResult,
    error: state.sessionsError,
    activeMinutes: state.sessionsFilterActive,
    limit: state.sessionsFilterLimit,
    includeGlobal: state.sessionsIncludeGlobal,
    includeUnknown: state.sessionsIncludeUnknown,
    basePath: state.basePath,
    onFiltersChange: (next) => {
      state.sessionsFilterActive = next.activeMinutes;
      state.sessionsFilterLimit = next.limit;
      state.sessionsIncludeGlobal = next.includeGlobal;
      state.sessionsIncludeUnknown = next.includeUnknown;
    },
    onRefresh: () => actions.advanced.onRefreshSessions(),
    onPatch: (key, patch) => actions.advanced.onPatchSession(key, patch),
    onDelete: (key) => actions.advanced.onDeleteSession(key),
  };
  const logsProps: LogsProps = {
    loading: state.logsLoading,
    error: state.logsError,
    file: state.logsFile,
    entries: state.logsEntries,
    filterText: state.logsFilterText,
    levelFilters: state.logsLevelFilters,
    autoFollow: state.logsAutoFollow,
    truncated: state.logsTruncated,
    onFilterTextChange: (next) => {
      state.logsFilterText = next;
    },
    onLevelToggle: (level, enabled) => {
      state.logsLevelFilters = {
        ...state.logsLevelFilters,
        [level]: enabled,
      };
    },
    onToggleAutoFollow: (next) => {
      state.logsAutoFollow = next;
    },
    onRefresh: () => actions.advanced.onRefreshLogs(),
    onExport: () => undefined,
    onScroll: () => undefined,
  };
  const capabilityGovernanceViewState = getOrCreateCapabilityGovernanceViewState();
  const derivedCapabilityGovernanceSnapshot = selectCapabilityGovernanceSnapshot({
    skillsReport: state.skillsReport,
    runtimeBindings: readModel.runtimeBindings,
    state: capabilityGovernanceViewState,
  });
  const persistedCapabilityGovernanceSnapshot = state.capabilityGovernanceSnapshot;
  // Persisted rows win over skill-derived duplicates, then optimistic review
  // overrides apply to both. Otherwise an approved proposal stays in 待审阅
  // until the next snapshot refresh, and the approve click looks inert.
  const mergedCapabilityGovernanceSnapshot = persistedCapabilityGovernanceSnapshot
    ? {
        proposals: [
          ...persistedCapabilityGovernanceSnapshot.proposals,
          ...derivedCapabilityGovernanceSnapshot.proposals.filter(
            (proposal) =>
              !persistedCapabilityGovernanceSnapshot.proposals.some(
                (persisted) => persisted.proposalId === proposal.proposalId,
              ),
          ),
        ],
        registry: [
          ...persistedCapabilityGovernanceSnapshot.registry,
          ...derivedCapabilityGovernanceSnapshot.registry.filter(
            (entry) =>
              !persistedCapabilityGovernanceSnapshot.registry.some(
                (persisted) => persisted.manifest.id === entry.manifest.id,
              ),
          ),
        ],
        metrics: derivedCapabilityGovernanceSnapshot.metrics,
      }
    : derivedCapabilityGovernanceSnapshot;
  const capabilityGovernanceSnapshot = applyCapabilityGovernanceViewState(
    mergedCapabilityGovernanceSnapshot,
    capabilityGovernanceViewState,
  );
  const pageViewModels = buildPlatformPageViewModels({
    basePath: state.basePath,
    readModel,
    channelsProps,
    authPanelProps,
    skillsProps,
    instancesProps,
    configDirty: state.configFormDirty,
    configSaving: state.configSaving,
    capabilityGovernanceSnapshot,
  });
  if (state.tab === "platformDashboard") {
    ensureOperationalIdentityGovernanceOverview({
      client: state.client,
      connected: state.connected,
      refreshKey: `platform:${state.hello?.auth?.user ?? state.platformAuthState?.sessionKind ?? "anonymous"}`,
    });
  }
  return {
    state,
    subnavProps: {
      tabs: [...PLATFORM_SURFACE_TABS],
      activeTab: state.tab,
      basePath: state.basePath,
      ariaLabel: t("nav.platform"),
      onOpenConsoleTab: (tab) => state.setTab(tab),
    },
    readModel,
    channelsProps,
    skillsProps,
    instancesProps,
    nodesProps,
    sessionsProps,
    logsProps,
    authPanelProps,
    operationalIdentityGovernancePanel: readOperationalIdentityGovernancePanelState(),
    pageViewModels,
    surfaceActions: {
      dashboard: actions.dashboard,
      tenants: {
        ...actions.tenants,
        onApproveTrialApplication: (input) => state.approvePlatformTrialApplication(input),
        onRejectTrialApplication: (input) => state.rejectPlatformTrialApplication(input),
        onUpdateTrialInstance: async (input) => {
          state.platformAuthInstanceEnterpriseId = input.enterpriseId;
          // Dialogs send only the fields they intend to change. Clear leftovers so a
          // seat-only save does not also restart the trial window (or vice versa).
          state.platformAuthInstanceTrialDays =
            input.trialDays != null ? String(input.trialDays) : "";
          state.platformAuthInstanceSeatCount =
            input.seatCount != null ? String(input.seatCount) : "";
          state.platformAuthInstanceUpgradeUrl = "";
          state.platformAuthInstanceContactAdvisorUrl = "";
          const controller = new AbortController();
          const timer = window.setTimeout(() => controller.abort(), 15_000);
          try {
            // quiet: dialog owns submitting UI; avoid global platformAuthBusy freezing the page.
            await state.updatePlatformTrialInstance({
              quiet: true,
              signal: controller.signal,
            });
            return !state.platformAuthError;
          } finally {
            window.clearTimeout(timer);
          }
        },
        onUpdateEnterpriseAdmin: async (input) => {
          state.platformAuthNotice = null;
          state.platformAuthError = null;
          const controller = new AbortController();
          const timer = window.setTimeout(() => controller.abort(), 15_000);
          try {
            if (typeof state.updatePlatformEnterpriseAdmin !== "function") {
              state.platformAuthError = "管理员更新能力未就绪，请刷新页面后重试。";
              return false;
            }
            await state.updatePlatformEnterpriseAdmin(input, {
              quiet: true,
              signal: controller.signal,
            });
            if (!state.platformAuthError) {
              state.platformAuthNotice = input.resendActivation
                ? "管理员信息已更新，激活邮件已发送。"
                : "管理员信息已更新。";
            }
            return !state.platformAuthError;
          } catch (error) {
            state.platformAuthError =
              error instanceof Error ? error.message : "更新管理员失败，请重试。";
            return false;
          } finally {
            window.clearTimeout(timer);
          }
        },
        onResendEnterpriseAdminActivation: async (input) => {
          state.platformAuthNotice = null;
          state.platformAuthError = null;
          const controller = new AbortController();
          const timer = window.setTimeout(() => controller.abort(), 15_000);
          try {
            if (typeof state.resendPlatformEnterpriseAdminActivation !== "function") {
              state.platformAuthError = "重发激活能力未就绪，请刷新页面后重试。";
              return false;
            }
            await state.resendPlatformEnterpriseAdminActivation(input, {
              quiet: true,
              signal: controller.signal,
            });
            if (!state.platformAuthError && !state.platformAuthNotice) {
              state.platformAuthNotice = "管理员激活邮件已重发。";
            }
            return !state.platformAuthError;
          } catch (error) {
            state.platformAuthError =
              error instanceof Error ? error.message : "重发激活邮件失败，请重试。";
            return false;
          } finally {
            window.clearTimeout(timer);
          }
        },
      },
      capabilities: actions.capabilities,
      models: actions.models,
      platformAgents: actions.platformAgents,
      advanced: actions.advanced,
      systemSettings: actions.systemSettings,
      skills: actions.skills,
      instances: actions.instances,
    },
  };
}
