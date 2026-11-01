import { html, nothing } from "lit";
import { t } from "../../../../i18n/index.ts";
import { icons } from "../../../icons.ts";
import type { GrowthStatusView } from "../semantic/view-controller-facade.ts";
import type {
  EmployeeWorkbenchSurfaceRuntime,
  WorkbenchPageContract,
} from "./home-page-contracts.ts";
import { runWorkbenchModuleSelection, runWorkbenchNavSelection } from "./workbench-actions.ts";
import {
  buildWorkbenchDaibaiStageCapabilityContract,
  buildWorkbenchSignalsCapabilityContract,
  type WorkbenchViewCapabilityContract,
} from "./workbench-capability-contracts.ts";
import {
  renderModuleItem,
  renderNavItem,
  renderSidebarGroupHeader,
  renderWorkbenchBrand,
} from "./workbench-chrome.ts";
import {
  renderWorkbenchAgentCreatorDrawer,
  renderWorkbenchSpaceCreatorDrawer,
} from "./workbench-creators.ts";
import { renderWorkbenchHeader } from "./workbench-header.ts";
import { buildWorkbenchHomeModel } from "./workbench-home-model.ts";
import { buildWorkbenchNavModel } from "./workbench-nav-model.ts";
import type { WorkbenchAssistantNavItem, WorkbenchSpaceNavItem } from "./workbench-nav-model.ts";
import { buildWorkbenchShellModel } from "./workbench-shell-model.ts";
import { renderSidebarSpaceEntries } from "./workbench-sidebar-members.ts";
import { renderWorkbenchSignalsSurface } from "./workbench-signals-surface.ts";
import { renderWorkbenchStage } from "./workbench-stage.ts";
import {
  DEFAULT_WORKBENCH_SYSTEM_SETTINGS_TAB,
  type GroupProfileView,
  type WorkbenchModuleSelectionHandlers,
  type WorkbenchNavSelectionHandlers,
  type WorkbenchProps,
  type WorkbenchSidebarMembersProps,
  type WorkbenchStageProps,
} from "./workbench-types.ts";

type WorkbenchSidebarNavEntryHandlers = WorkbenchNavSelectionHandlers &
  Pick<WorkbenchProps, "onLoadGroupMembers"> & {
    onGroupProfileViewChange?: (view: GroupProfileView) => void;
  };

type WorkbenchSidebarNavEntry = WorkbenchAssistantNavItem | WorkbenchSpaceNavItem;

function buildWorkbenchNavSelectionHandlers(props: WorkbenchProps) {
  return {
    onPrimaryModuleChange: props.onPrimaryModuleChange,
    onTeamSelectedKeyChange: props.onTeamSelectedKeyChange,
    onSelectSession: props.onSelectSession,
    onAcknowledgeSiblingSessions: props.onAcknowledgeSiblingSessions ?? undefined,
  } satisfies WorkbenchNavSelectionHandlers;
}

function buildWorkbenchSidebarNavEntryHandlers(props: WorkbenchProps) {
  return {
    ...buildWorkbenchNavSelectionHandlers(props),
    onLoadGroupMembers: props.onLoadGroupMembers,
    onGroupProfileViewChange: props.onGroupProfileViewChange,
  } satisfies WorkbenchSidebarNavEntryHandlers;
}

function buildWorkbenchModuleSelectionHandlers(props: WorkbenchProps) {
  return {
    onPrimaryModuleChange: (module) => {
      if (module === "settings") {
        props.onOpenSystemSettings?.();
        return;
      }
      props.onPrimaryModuleChange(module);
    },
  } satisfies WorkbenchModuleSelectionHandlers;
}

function resolveNavItemGrowthStatus(
  item: WorkbenchSidebarNavEntry,
  props: WorkbenchProps,
): GrowthStatusView | null {
  if (item.id === "daibai") {
    return null;
  }
  const fromMap = props.growthStatusBySelectionKey?.[item.selectionKey];
  if (fromMap) {
    return fromMap;
  }
  if (item.selectionKey === props.activeSessionKey && props.activeGrowthStatus) {
    return props.activeGrowthStatus;
  }
  return null;
}

function renderSidebarNavEntries(
  items: WorkbenchSidebarNavEntry[],
  shellModel: ReturnType<typeof buildWorkbenchShellModel>,
  handlers: WorkbenchSidebarNavEntryHandlers,
  props: WorkbenchProps,
) {
  return items.map((item) =>
    renderNavItem({
      ...item,
      growthStatus: resolveNavItemGrowthStatus(item, props),
      active:
        shellModel.primaryModule === item.module &&
        (item.selectionKey === shellModel.selectedNavKey || item.active),
      onClick: () => {
        runWorkbenchNavSelection(
          {
            module: item.module,
            selectionKey: item.selectionKey,
            sourceKey: item.sourceKey,
            siblingSessionKeys: item.sessionKeys,
          },
          handlers,
        );
        if (item.module === "collaboration") {
          handlers.onGroupProfileViewChange?.("chat");
          if (item.directoryChannelId?.trim()) {
            void handlers.onLoadGroupMembers?.({
              selectionKey: item.selectionKey,
              channelId: item.directoryChannelId,
              title: item.rawTitle ?? item.title,
              fallbackGroupId: item.directoryGroupId ?? null,
            });
          }
        }
      },
    }),
  );
}

function shouldShowOverviewSignals(primaryModule: WorkbenchProps["primaryModule"]) {
  return primaryModule === "assistant" || primaryModule === "collaboration";
}

export function renderWorkbench(
  props: WorkbenchProps,
  capabilities?:
    | Pick<WorkbenchViewCapabilityContract, "signals" | "daibaiStage">
    | EmployeeWorkbenchSurfaceRuntime,
) {
  const resolvedSurfaceRuntime = capabilities && "view" in capabilities ? capabilities : undefined;
  const providedCapabilities = capabilities && !("view" in capabilities) ? capabilities : undefined;
  const resolvedCapabilities: Pick<WorkbenchViewCapabilityContract, "signals" | "daibaiStage"> =
    resolvedSurfaceRuntime?.view ??
      providedCapabilities ?? {
        signals: buildWorkbenchSignalsCapabilityContract(props),
        daibaiStage: buildWorkbenchDaibaiStageCapabilityContract(props),
      };
  const knowledgeSurfaceRuntime: EmployeeWorkbenchSurfaceRuntime | undefined =
    props.knowledgeSurface
      ? {
          view: resolvedCapabilities,
          proactive: resolvedSurfaceRuntime?.proactive ?? {},
          future: { knowledge: props.knowledgeSurface },
        }
      : resolvedSurfaceRuntime;

  const model = buildWorkbenchHomeModel({
    frontstageModel: props.frontstageModel ?? null,
    shellReadModel: props.shellReadModel,
    collaborationReadModel: props.collaborationReadModel,
    policyEnvelope: props.policyEnvelope,
    connected: props.connected,
    cronNext: props.cronNext,
    lastError: props.lastError,
    guideAcknowledged: props.daibaiGuideAcknowledged,
    pendingTasks: props.pendingTasks ?? null,
    notices: props.notices ?? null,
    upcomingCollaboration: props.upcomingCollaboration ?? null,
    stewardSuggestion: props.stewardSuggestion ?? null,
    schedule: props.schedule ?? null,
  });
  const { assistantItems, spaceItems, moduleItems } = buildWorkbenchNavModel({
    assistants: model.teamAssistants,
    spaces: model.teamSpaces,
    activeSessionKey: props.activeSessionKey,
    primaryModule: props.primaryModule,
    sessionDefaults: props.sessionDefaults,
  });
  const approvalCounts = props.pendingBotApprovalCountsBySelectionKey ?? {};
  const spaceItemsWithApprovals = spaceItems.map((item) => ({
    ...item,
    count: approvalCounts[item.selectionKey] ?? item.count,
  }));
  const shellModel = buildWorkbenchShellModel({
    primaryModule: props.primaryModule,
    teamSelectedKey: props.teamSelectedKey,
    activeSessionKey: props.activeSessionKey,
    connected: props.connected,
    userProfileName: props.userProfileName,
    sessionDefaults: props.sessionDefaults,
    assistantItems,
    spaceItems: spaceItemsWithApprovals,
    model,
    activeSessionUpdatedAt: props.shellReadModel.activeSessionUpdatedAt ?? null,
  });

  const aiCollapsed = props.navGroupsCollapsed.aiAssistants ?? false;
  const collaborationCollapsed = props.navGroupsCollapsed.collaborationSpaces ?? false;
  const collapsedNavItems = [...assistantItems, ...spaceItemsWithApprovals];
  const showOverviewSignals = shouldShowOverviewSignals(shellModel.primaryModule);
  const agentCreatorOpen = props.agentCreator?.open === true;
  const spaceCreatorOpen = props.spaceCreator?.open === true;
  const creatorOpen = agentCreatorOpen || spaceCreatorOpen;
  // Creator pages already carry their own H1; suppress shell "每日概览" chrome.
  const workbenchHeaderTitle = creatorOpen ? "" : shellModel.headerTitle;
  const hasWorkbenchHeaderTitle = workbenchHeaderTitle.trim().length > 0;
  const showConversationStage =
    shellModel.primaryModule === "assistant" || shellModel.primaryModule === "collaboration";
  const sidebarNavHandlers = buildWorkbenchSidebarNavEntryHandlers(props);
  const sidebarMembersProps: WorkbenchSidebarMembersProps = {
    navGroupsCollapsed: props.navGroupsCollapsed,
    groupMembersBySelectionKey: {},
    growthStatusBySelectionKey: props.growthStatusBySelectionKey,
    activeSessionKey: props.activeSessionKey,
    activeGrowthStatus: props.activeGrowthStatus ?? null,
    directoryOrgs: [],
    shellReadModel: { agents: props.shellReadModel.agents },
    onGroupProfileViewChange: props.onGroupProfileViewChange ?? null,
    onPrimaryModuleChange: props.onPrimaryModuleChange,
    onTeamSelectedKeyChange: props.onTeamSelectedKeyChange,
    onSelectSession: props.onSelectSession,
    onLoadGroupMembers: props.onLoadGroupMembers,
    onToggleSidebarGroup: props.onToggleSidebarGroup ?? null,
  };
  const moduleSelectionHandlers = buildWorkbenchModuleSelectionHandlers(props);
  const stageProps: WorkbenchStageProps = {
    authPanel: props.authPanel,
    chatContent: props.chatContent,
    chatComposer: props.chatComposer,
    activeSessionKey: props.activeSessionKey,
    activeGrowthStatus: props.activeGrowthStatus ?? null,
    connected: props.connected,
    client: props.client ?? null,
    requestUpdate: props.requestUpdate,
    settingsView: props.settingsView ?? "system",
    personalSettingsTab: props.personalSettingsTab ?? "account",
    systemSettingsTab: props.systemSettingsTab ?? DEFAULT_WORKBENCH_SYSTEM_SETTINGS_TAB,
    tasksSubTab: props.tasksSubTab ?? "cron",
    assignedTasksProps: props.assignedTasksProps ?? null,
    myTasksLaneCounts: props.myTasksLaneCounts ?? null,
    robotWorkbenchTab: props.robotWorkbenchTab ?? "overview",
    currentLocale: props.currentLocale,
    currentTheme: props.currentTheme,
    userProfileName: props.userProfileName,
    userProfileSignature: props.userProfileSignature,
    tenantLabel: props.tenantLabel,
    currentSeatTitle: props.currentSeatTitle ?? null,
    currentSeatStatus: props.currentSeatStatus ?? null,
    currentSeatStatusLabel: props.currentSeatStatusLabel ?? null,
    pendingSeatOffer: props.pendingSeatOffer ?? null,
    defaultAgentId: props.defaultAgentId ?? null,
    defaultAgentLabel: props.defaultAgentLabel ?? null,
    agentIds: props.agentIds ?? [],
    robotTeamLabels: props.robotTeamLabels ?? [],
    defaultSpaceIds: props.defaultSpaceIds ?? [],
    defaultSpaceLabels: props.defaultSpaceLabels ?? [],
    defaultWorkspaceRoot: props.defaultWorkspaceRoot ?? null,
    defaultWorkspaceRootDraft: props.defaultWorkspaceRootDraft ?? null,
    defaultWorkspaceRootSaving: Boolean(props.defaultWorkspaceRootSaving),
    defaultWorkspaceRootError: props.defaultWorkspaceRootError ?? null,
    defaultWorkspaceRootNotice: props.defaultWorkspaceRootNotice ?? null,
    dataSpace: props.dataSpace ?? null,
    dataDirectoryPanel: props.dataDirectoryPanel ?? null,
    authorizationFullDiskAccessGranted: props.authorizationFullDiskAccessGranted ?? null,
    authorizationAccessibilityGranted: props.authorizationAccessibilityGranted ?? null,
    authorizationAutomationGranted: props.authorizationAutomationGranted ?? null,
    authorizationNotificationsGranted: props.authorizationNotificationsGranted ?? null,
    authorizationHostConnected: Boolean(props.authorizationHostConnected),
    authorizationAppleDesktop: Boolean(props.authorizationAppleDesktop),
    systemAuthorizationNotice: props.systemAuthorizationNotice ?? null,
    systemAuthorizationError: props.systemAuthorizationError ?? null,
    workspaceSelector: props.workspaceSelector ?? null,
    workspaceNotice: props.workspaceNotice ?? null,
    recentAccessEntries: props.recentAccessEntries ?? [],
    robotRosterStatus: props.robotRosterStatus,
    robotEntries: props.robotEntries ?? [],
    groupEntries: props.groupEntries ?? [],
    myBotDetail: props.myBotDetail ?? null,
    collaborationGroupProjection: props.collaborationGroupProjection ?? null,
    collaborationGroupProjectionLoading: Boolean(props.collaborationGroupProjectionLoading),
    robotCapabilityTabProps: props.robotCapabilityTabProps ?? null,
    myAccumulationProps: props.myAccumulationProps ?? null,
    selectedGroupKey: props.selectedGroupKey ?? null,
    robotWorkbenchTasks: props.robotWorkbenchTasks ?? [],
    robotWorkbenchOutputs: props.robotWorkbenchOutputs ?? [],
    chatFocusMode: props.chatFocusMode,
    chatShowThinking: props.chatShowThinking,
    platformAuthEnabled: props.platformAuthEnabled,
    passwordChangeBusy: props.passwordChangeBusy,
    passwordChangeError: props.passwordChangeError,
    passwordChangeNotice: props.passwordChangeNotice,
    pendingSeatOfferBusy: props.pendingSeatOfferBusy,
    pendingSeatOfferError: props.pendingSeatOfferError,
    pendingSeatOfferNotice: props.pendingSeatOfferNotice,
    passwordCurrentValue: props.passwordCurrentValue,
    passwordNewValue: props.passwordNewValue,
    onLocaleChange: props.onLocaleChange,
    onThemeChange: props.onThemeChange,
    onUserProfileNameChange: props.onUserProfileNameChange,
    onUserProfileSignatureChange: props.onUserProfileSignatureChange,
    onDefaultWorkspaceRootDraftChange: props.onDefaultWorkspaceRootDraftChange ?? null,
    onSaveDefaultWorkspaceRoot: props.onSaveDefaultWorkspaceRoot ?? null,
    onOpenWorkspaceSelector: props.onOpenWorkspaceSelector ?? null,
    onCloseWorkspaceSelector: props.onCloseWorkspaceSelector ?? null,
    onChooseWorkspaceSelector: props.onChooseWorkspaceSelector ?? null,
    onBrowseWorkspaceSelector: props.onBrowseWorkspaceSelector ?? null,
    onWorkspaceSelectorPathDraftChange: props.onWorkspaceSelectorPathDraftChange ?? null,
    onUseCurrentWorkspaceSelectorDirectory: props.onUseCurrentWorkspaceSelectorDirectory ?? null,
    onNavigateWorkspaceSelector: props.onNavigateWorkspaceSelector ?? null,
    onSelectWorkspaceSelectorPath: props.onSelectWorkspaceSelectorPath ?? null,
    onApplyWorkspaceSelector: props.onApplyWorkspaceSelector ?? null,
    onOpenSystemAuthorization: props.onOpenSystemAuthorization ?? null,
    devicePairingList: props.devicePairingList ?? null,
    devicePairingLoading: props.devicePairingLoading ?? false,
    devicePairingError: props.devicePairingError ?? null,
    devicePairingCurrentDeviceId: props.devicePairingCurrentDeviceId ?? null,
    devicePairingConnectedAtMs: props.devicePairingConnectedAtMs ?? null,
    cronProps: props.cronProps,
    conversationTaskProgress: props.conversationTaskProgress ?? null,
    supervisorProps: props.supervisorProps,
    onWorkspaceSelectorCloudProviderChange: props.onWorkspaceSelectorCloudProviderChange ?? null,
    onWorkspaceSelectorCloudRegionChange: props.onWorkspaceSelectorCloudRegionChange ?? null,
    onWorkspaceSelectorCloudBucketChange: props.onWorkspaceSelectorCloudBucketChange ?? null,
    onWorkspaceSelectorCloudRootPrefixChange:
      props.onWorkspaceSelectorCloudRootPrefixChange ?? null,
    onWorkspaceSelectorCloudEndpointChange: props.onWorkspaceSelectorCloudEndpointChange ?? null,
    onWorkspaceSelectorCloudAccountNameChange:
      props.onWorkspaceSelectorCloudAccountNameChange ?? null,
    onGenerateWorkspaceSelectorCloudConfig: props.onGenerateWorkspaceSelectorCloudConfig ?? null,
    onTestWorkspaceSelectorCloudConnection: props.onTestWorkspaceSelectorCloudConnection ?? null,
    onChatFocusModeChange: props.onChatFocusModeChange,
    onChatShowThinkingChange: props.onChatShowThinkingChange,
    onOpenForgotPassword: props.onOpenForgotPassword,
    onPasswordCurrentChange: props.onPasswordCurrentChange,
    onPasswordNewChange: props.onPasswordNewChange,
    onChangePassword: props.onChangePassword,
    onAcceptPendingSeatOffer: props.onAcceptPendingSeatOffer ?? null,
    onDeclinePendingSeatOffer: props.onDeclinePendingSeatOffer ?? null,
    ownedRobotDeleteBusyId: props.ownedRobotDeleteBusyId ?? null,
    ownedRobotDeleteError: props.ownedRobotDeleteError ?? null,
    ownedRobotDeletePrompt: props.ownedRobotDeletePrompt ?? null,
    ownedRobotDeleteDisposition: props.ownedRobotDeleteDisposition ?? "delete_all",
    onDeleteOwnedRobot: props.onDeleteOwnedRobot ?? null,
    onOpenOwnedRobotDeletePrompt: props.onOpenOwnedRobotDeletePrompt ?? null,
    onOwnedRobotDeleteDispositionChange: props.onOwnedRobotDeleteDispositionChange ?? null,
    onCancelOwnedRobotDelete: props.onCancelOwnedRobotDelete ?? null,
    onConfirmOwnedRobotDelete: props.onConfirmOwnedRobotDelete ?? null,
    onSystemSettingsTabChange: props.onSystemSettingsTabChange,
    onPersonalSettingsTabChange: props.onPersonalSettingsTabChange,
    onRevealDataDirectoryInFinder: props.onRevealDataDirectoryInFinder ?? null,
    onOpenDataMigrationWizard: props.onOpenDataMigrationWizard ?? null,
    onCloseDataMigrationWizard: props.onCloseDataMigrationWizard ?? null,
    onDataMigrationTargetDraftChange: props.onDataMigrationTargetDraftChange ?? null,
    onStartDataMigration: props.onStartDataMigration ?? null,
    onExportOpenBotData: props.onExportOpenBotData ?? null,
    onForgetMemoryAgentIdChange: props.onForgetMemoryAgentIdChange ?? null,
    onForgetMemoryKeyChange: props.onForgetMemoryKeyChange ?? null,
    onForgetMemoryEntry: props.onForgetMemoryEntry ?? null,
    onRevokeAccessGrant: props.onRevokeAccessGrant ?? null,
    onTasksSubTabChange: props.onTasksSubTabChange,
    onRobotWorkbenchTabChange: props.onRobotWorkbenchTabChange,
    // System settings → "我的协作小组" tab handlers. Without these, clicking
    // a group in the right-hand list wires to the no-op fallback inside
    // `buildWorkbenchStageModuleContract`, which is exactly what causes the
    // "right side won't switch when I click another group" symptom.
    onSystemSettingsGroupSelect: props.onSystemSettingsGroupSelect ?? null,
    onSystemSettingsGroupDraftChange: props.onSystemSettingsGroupDraftChange ?? null,
    onSaveSystemSettingsGroup: props.onSaveSystemSettingsGroup ?? null,
    onResetSystemSettingsGroup: props.onResetSystemSettingsGroup ?? null,
    onDissolveSystemSettingsGroup: props.onDissolveSystemSettingsGroup ?? null,
    onOpenSystemSettingsGroupMembers: props.onOpenSystemSettingsGroupMembers ?? null,
    onExportSystemSettingsGroupSummary: props.onExportSystemSettingsGroupSummary ?? null,
    onResolveSystemSettingsGroupSwitch: props.onResolveSystemSettingsGroupSwitch ?? null,
    onRefreshMyDevices: props.onRefreshMyDevices ?? null,
    onRemoveMyDevice: props.onRemoveMyDevice ?? null,
    onApproveMyDevicePairing: props.onApproveMyDevicePairing ?? null,
    onRejectMyDevicePairing: props.onRejectMyDevicePairing ?? null,
    onRemoveMyDevices: props.onRemoveMyDevices ?? null,
    onRotateMyDeviceToken: props.onRotateMyDeviceToken ?? undefined,
    onRevokeMyDeviceToken: props.onRevokeMyDeviceToken ?? undefined,
    selectedGroupEntry: props.selectedGroupEntry ?? null,
    selectedGroupDraft: props.selectedGroupDraft ?? null,
    systemGroupSaving: props.systemGroupSaving,
    systemGroupError: props.systemGroupError ?? null,
    systemGroupNotice: props.systemGroupNotice ?? null,
    systemSettingsPendingGroupId: props.systemSettingsPendingGroupId ?? null,
    onSelectSession: props.onSelectSession,
    groupProfileView: props.groupProfileView ?? "chat",
    collaborationSpacesSnapshot: props.collaborationSpacesSnapshot,
    collaborationGovernanceSnapshot: props.collaborationGovernanceSnapshot ?? null,
    collaborationRoundPlan: props.collaborationRoundPlan ?? null,
    collaborationSpeakingAgentId: props.collaborationSpeakingAgentId ?? null,
    collaborationRoundSummaries: props.collaborationRoundSummaries ?? {},
    collaborationRulesSummary: props.collaborationRulesSummary ?? [],
    collaborationRulesSections: props.collaborationRulesSections ?? [],
    collaborationReasonDrawerOpen: props.collaborationReasonDrawerOpen ?? false,
    collaborationRulesDrawerOpen: props.collaborationRulesDrawerOpen ?? false,
    onOpenCollaborationReasonDrawer: props.onOpenCollaborationReasonDrawer ?? (() => undefined),
    onCloseCollaborationReasonDrawer: props.onCloseCollaborationReasonDrawer ?? (() => undefined),
    onOpenCollaborationRulesDrawer: props.onOpenCollaborationRulesDrawer ?? (() => undefined),
    onCloseCollaborationRulesDrawer: props.onCloseCollaborationRulesDrawer ?? (() => undefined),
    memberGovernanceDrawerOpen: props.memberGovernanceDrawerOpen ?? false,
    artifactPreviewOpen: props.artifactPreviewOpen ?? false,
    onOpenCollaborationMemberGovernance:
      props.onOpenCollaborationMemberGovernance ?? (() => undefined),
    onCloseCollaborationMemberGovernance:
      props.onCloseCollaborationMemberGovernance ?? (() => undefined),
    collaborationOptionalSuggestions: props.collaborationOptionalSuggestions ?? [],
    collaborationMissionAdvanceBusy: props.collaborationMissionAdvanceBusy ?? false,
    collaborationMissionAdvanceNotice: props.collaborationMissionAdvanceNotice ?? null,
    collaborationMissionAdvanceError: props.collaborationMissionAdvanceError ?? null,
    onAdvanceCollaborationMission: props.onAdvanceCollaborationMission ?? (() => undefined),
    onDismissCollaborationOptionalSuggestion:
      props.onDismissCollaborationOptionalSuggestion ?? (() => undefined),
    groupMembers: props.groupMembers ?? [],
    ownedAgents: props.ownedAgents,
    pendingBotApprovalCount: props.pendingBotApprovalCount,
    onOpenAssistantSettings: props.onOpenAssistantSettings ?? null,
    onGroupProfileViewChange: props.onGroupProfileViewChange ?? null,
    onOpenGovernanceObjectDetail: props.onOpenGovernanceObjectDetail ?? null,
    onDecisionOptionDraftChange: props.onDecisionOptionDraftChange ?? null,
    onDecisionRationaleDraftChange: props.onDecisionRationaleDraftChange ?? null,
    onDecisionOptionTitleDraftChange: props.onDecisionOptionTitleDraftChange ?? null,
    onAddDecisionOptionDraft: props.onAddDecisionOptionDraft ?? null,
    onRemoveDecisionOptionDraft: props.onRemoveDecisionOptionDraft ?? null,
    onSaveDecisionDraft: props.onSaveDecisionDraft ?? null,
    collaborationMemberGovernance: props.collaborationMemberGovernance ?? null,
    onMemberGovernancePromptChange: props.onMemberGovernancePromptChange ?? null,
    onMemberGovernanceParse: props.onMemberGovernanceParse ?? null,
    onMemberGovernanceOpenSelector: props.onMemberGovernanceOpenSelector ?? null,
    onMemberGovernanceSearchChange: props.onMemberGovernanceSearchChange ?? null,
    onMemberGovernanceToggleHumanSelection: props.onMemberGovernanceToggleHumanSelection ?? null,
    onMemberGovernanceToggleBotSelection: props.onMemberGovernanceToggleBotSelection ?? null,
    onMemberGovernanceCommitSelection: props.onMemberGovernanceCommitSelection ?? null,
    onMemberGovernanceInviteHuman: props.onMemberGovernanceInviteHuman ?? null,
    onMemberGovernanceInviteBot: props.onMemberGovernanceInviteBot ?? null,
    onMemberGovernanceCancelInvite: props.onMemberGovernanceCancelInvite ?? null,
    onMemberGovernanceRemoveMember: props.onMemberGovernanceRemoveMember ?? null,
    onMemberGovernanceApproveBotInvite: props.onMemberGovernanceApproveBotInvite ?? null,
    onMemberGovernanceRejectBotInvite: props.onMemberGovernanceRejectBotInvite ?? null,
    onMemberGovernanceAcceptSelfInvite: props.onMemberGovernanceAcceptSelfInvite ?? null,
    onMemberGovernanceRejectSelfInvite: props.onMemberGovernanceRejectSelfInvite ?? null,
    onMemberGovernanceReset: props.onMemberGovernanceReset ?? null,
    onOpenFilePreview: props.onOpenFilePreview ?? (() => undefined),
    computerFullscreen: props.computerFullscreen === true,
    onExitComputerFullscreen: props.onExitComputerFullscreen ?? null,
    previewArtifactAvailable: props.previewArtifactAvailable !== false,
    showSystemAssetSuggestCta: props.showSystemAssetSuggestCta ?? false,
    canOrganizeCurrentCapability: props.canOrganizeCurrentCapability ?? false,
    assetIncubationLevel: props.assetIncubationLevel ?? null,
    skillSaveModalInline: props.skillSaveModalInline ?? false,
    skillSaveModalOpen: props.skillSaveModalOpen ?? false,
    skillSaveModalBusy: props.skillSaveModalBusy ?? false,
    skillSaveModalError: props.skillSaveModalError ?? null,
    skillSaveModalFormData: props.skillSaveModalFormData ?? null,
    skillSaveModalPreferEnterpriseSubmit: props.skillSaveModalPreferEnterpriseSubmit ?? false,
    skillExtractedPreview: props.skillExtractedPreview ?? null,
    skillSaveModalShowEnterpriseSubmitAction:
      props.skillSaveModalShowEnterpriseSubmitAction ?? false,
    skillAvailableGroups: props.skillAvailableGroups ?? [],
    onOpenSkillSave: props.onOpenSkillSave ?? null,
    onOpenSkillOrganizeManual: props.onOpenSkillOrganizeManual ?? null,
    onSkillSaveFormChange: props.onSkillSaveFormChange ?? null,
    onSubmitSkillSave: props.onSubmitSkillSave ?? null,
    onSubmitSkillSaveAndContinue: props.onSubmitSkillSaveAndContinue ?? null,
    onCloseSkillSave: props.onCloseSkillSave ?? null,
    onLogout: props.onLogout,
    onTransitionGovernanceObject: props.onTransitionGovernanceObject ?? null,
    onPrefillChatDraft: props.onPrefillChatDraft ?? null,
    userOperationalIdentitySnapshot: props.userOperationalIdentitySnapshot ?? null,
    userOperationalIdentityBusy: Boolean(props.userOperationalIdentityBusy),
    userOperationalIdentityError: props.userOperationalIdentityError ?? null,
    userOperationalIdentityNotice: props.userOperationalIdentityNotice ?? null,
    userOperationalIdentityNav: props.userOperationalIdentityNav ?? "bound",
    userOperationalIdentityUsageRange: props.userOperationalIdentityUsageRange ?? "30d",
    userOperationalIdentityUsageEventId: props.userOperationalIdentityUsageEventId ?? null,
    userOperationalIdentityEditorOpen: Boolean(props.userOperationalIdentityEditorOpen),
    userOperationalIdentityEditorProvider: props.userOperationalIdentityEditorProvider ?? "",
    userOperationalIdentityEditorDisplayName: props.userOperationalIdentityEditorDisplayName ?? "",
    userOperationalIdentityEditorCredentialHandleId:
      props.userOperationalIdentityEditorCredentialHandleId ?? "",
    userOperationalIdentityEditorAppId: props.userOperationalIdentityEditorAppId ?? "",
    userOperationalIdentityEditorAppSecret: props.userOperationalIdentityEditorAppSecret ?? "",
    userOperationalIdentityEditorSmtpHost: props.userOperationalIdentityEditorSmtpHost ?? "",
    userOperationalIdentityEditorSmtpPort: props.userOperationalIdentityEditorSmtpPort ?? "587",
    userOperationalIdentityEditorSmtpUser: props.userOperationalIdentityEditorSmtpUser ?? "",
    userOperationalIdentityEditorImapHost: props.userOperationalIdentityEditorImapHost ?? "",
    userOperationalIdentityEditorImapPort: props.userOperationalIdentityEditorImapPort ?? "993",
    userOperationalIdentityEditorImapUser: props.userOperationalIdentityEditorImapUser ?? "",
    userOperationalIdentityEditorPersonalEmailPresetNote:
      props.userOperationalIdentityEditorPersonalEmailPresetNote ?? null,
    userOperationalIdentityEditorUsePlatformSmtp: Boolean(
      props.userOperationalIdentityEditorUsePlatformSmtp,
    ),
    userOperationalIdentityEditorIdentityId: props.userOperationalIdentityEditorIdentityId ?? null,
    wechatPersonalQrWorkerOnline: props.wechatPersonalQrWorkerOnline ?? null,
    wechatPersonalQrStatus: props.wechatPersonalQrStatus ?? "idle",
    wechatPersonalQrDataUrl: props.wechatPersonalQrDataUrl ?? null,
    wechatPersonalQrMessage: props.wechatPersonalQrMessage ?? null,
    wechatPersonalQrWxid: props.wechatPersonalQrWxid ?? null,
    userOperationalIdentityEditorGrantAgentId:
      props.userOperationalIdentityEditorGrantAgentId ?? "",
    userOperationalIdentityReturnSessionKey: props.userOperationalIdentityReturnSessionKey ?? null,
    userOperationalIdentityContinuationNotice:
      props.userOperationalIdentityContinuationNotice ?? null,
    robotIdentityGrantFocusAgentId: props.robotIdentityGrantFocusAgentId ?? null,
    onRefreshUserOperationalIdentities: props.onRefreshUserOperationalIdentities ?? null,
    onOpenUserOperationalIdentityEditor: props.onOpenUserOperationalIdentityEditor ?? null,
    onUserOperationalIdentityNavChange: props.onUserOperationalIdentityNavChange ?? null,
    onUserOperationalIdentityUsageRangeChange:
      props.onUserOperationalIdentityUsageRangeChange ?? null,
    onSelectUserOperationalIdentityUsageEvent:
      props.onSelectUserOperationalIdentityUsageEvent ?? null,
    onCloseUserOperationalIdentityEditor: props.onCloseUserOperationalIdentityEditor ?? null,
    onSubmitUserOperationalIdentityEditor: props.onSubmitUserOperationalIdentityEditor ?? null,
    onStartWechatPersonalQr: props.onStartWechatPersonalQr ?? null,
    onRecheckWechatPersonalChannel: props.onRecheckWechatPersonalChannel ?? null,
    onUserOperationalIdentityEditorGrantAgentIdChange:
      props.onUserOperationalIdentityEditorGrantAgentIdChange ?? null,
    onVerifyUserOperationalIdentityCredentials:
      props.onVerifyUserOperationalIdentityCredentials ?? null,
    onCompleteUserOperationalIdentityOAuthForContinuation:
      props.onCompleteUserOperationalIdentityOAuthForContinuation ?? null,
    onUserOperationalIdentityEditorProviderChange:
      props.onUserOperationalIdentityEditorProviderChange ?? null,
    onUserOperationalIdentityEditorDisplayNameChange:
      props.onUserOperationalIdentityEditorDisplayNameChange ?? null,
    onUserOperationalIdentityEditorCredentialHandleIdChange:
      props.onUserOperationalIdentityEditorCredentialHandleIdChange ?? null,
    onUserOperationalIdentityEditorAppIdChange:
      props.onUserOperationalIdentityEditorAppIdChange ?? null,
    onUserOperationalIdentityEditorAppSecretChange:
      props.onUserOperationalIdentityEditorAppSecretChange ?? null,
    onUserOperationalIdentityEditorSmtpHostChange:
      props.onUserOperationalIdentityEditorSmtpHostChange ?? null,
    onUserOperationalIdentityEditorSmtpPortChange:
      props.onUserOperationalIdentityEditorSmtpPortChange ?? null,
    onUserOperationalIdentityEditorSmtpUserChange:
      props.onUserOperationalIdentityEditorSmtpUserChange ?? null,
    onUserOperationalIdentityEditorUsePlatformSmtpChange:
      props.onUserOperationalIdentityEditorUsePlatformSmtpChange ?? null,
    onOpenPersonalEmailWebmail: props.onOpenPersonalEmailWebmail ?? null,
    onOpenPersonalEmailAuthCodeSettings: props.onOpenPersonalEmailAuthCodeSettings ?? null,
    onRevokeUserOperationalIdentity: props.onRevokeUserOperationalIdentity ?? null,
    onReauthorizeUserOperationalIdentity: props.onReauthorizeUserOperationalIdentity ?? null,
    onCompleteUserOperationalIdentityBindingRequest:
      props.onCompleteUserOperationalIdentityBindingRequest ?? null,
    onConfirmUserOperationalIdentityGrant: props.onConfirmUserOperationalIdentityGrant ?? null,
    onRevokeUserOperationalIdentityGrant: props.onRevokeUserOperationalIdentityGrant ?? null,
    onLoadRobotEnterpriseIdentities: props.onLoadRobotEnterpriseIdentities ?? null,
    onApplyRobotIdentityGrants: props.onApplyRobotIdentityGrants ?? null,
    onApplyIdentityRobotGrants: props.onApplyIdentityRobotGrants ?? null,
    onApplyRobotEnterpriseIdentities: props.onApplyRobotEnterpriseIdentities ?? null,
    onOpenUserOperationalIdentityBindingFlow:
      props.onOpenUserOperationalIdentityBindingFlow ?? null,
    onOpenPersonalEmailBrowserGuideFromChat: props.onOpenPersonalEmailBrowserGuideFromChat ?? null,
    onOpenPersonalOperationalIdentity: props.onOpenPersonalOperationalIdentity ?? null,
    onRobotIdentityGrantFocusHandled: props.onRobotIdentityGrantFocusHandled ?? null,
    onResumeUserOperationalIdentityContinuation:
      props.onResumeUserOperationalIdentityContinuation ?? null,
    onOpenInstallCapability: props.onOpenInstallCapability ?? null,
    onOpenMyAssets: props.onOpenMyAssets ?? null,
    onOpenMyBotDetail: props.onOpenMyBotDetail ?? null,
    onCloseMyBotDetail: props.onCloseMyBotDetail ?? null,
    onMyBotDetailTabChange: props.onMyBotDetailTabChange ?? null,
    onMyBotIdentityDraftChange: props.onMyBotIdentityDraftChange ?? null,
    onSaveMyBotIdentity: props.onSaveMyBotIdentity ?? null,
    onMyBotOpenGroup: props.onMyBotOpenGroup ?? null,
    signals: model.signals,
  };

  return html`
    <div class="employee-workbench ${props.navCollapsed ? "collapsed" : ""}">
      <aside class="employee-workbench__sidebar employee-workbench__sidebar--flat">
        ${renderWorkbenchBrand({
          brandLogoSrc: props.brandLogoSrc ?? null,
          bundledBrandLogoSrc: props.bundledBrandLogoSrc ?? null,
          customBrandLogoEnabled: Boolean(props.customBrandLogoEnabled && props.brandLogoSrc),
          brandLogoError: props.brandLogoError ?? null,
          uploadLabel: t("frontstage.workbench.surface.branding.upload"),
          resetLabel: t("frontstage.workbench.surface.branding.reset"),
          logoAlt: t("frontstage.workbench.surface.branding.logoAlt"),
          defaultTitle: "openbot",
          defaultSubtitle: t("frontstage.workbench.surface.branding.defaultSubtitle"),
          onBrandLogoFileChange: props.onBrandLogoFileChange ?? null,
          onResetBrandLogo: props.onResetBrandLogo ?? null,
          actionSlot: props.onToggleSidebar
            ? html`
                <button
                  type="button"
                  class="btn btn--sm btn--icon employee-workbench__icon-btn employee-workbench__brand-action"
                  title=${props.navCollapsed ? t("nav.expand") : t("nav.collapse")}
                  aria-label=${props.navCollapsed ? t("nav.expand") : t("nav.collapse")}
                  @click=${() => props.onToggleSidebar?.()}
                >
                  ${icons.menu}
                </button>
              `
            : null,
        })}

        <div class="employee-workbench__sidebar-scroll">
          ${
            props.navCollapsed
              ? html`
                <section class="employee-workbench__group employee-workbench__group--collapsed-list">
                  <div class="employee-workbench__group-stack employee-workbench__group-stack--flat">
                    ${renderSidebarNavEntries(collapsedNavItems, shellModel, sidebarNavHandlers, props)}
                  </div>
                </section>
                <section class="employee-workbench__modules employee-workbench__modules--flat employee-workbench__modules--collapsed">
                  ${moduleItems.map((item) =>
                    renderModuleItem({
                      ...item,
                      active: shellModel.primaryModule === item.id,
                      onClick: () => runWorkbenchModuleSelection(item.id, moduleSelectionHandlers),
                    }),
                  )}
                </section>
              `
              : html`
                <section class="employee-workbench__group">
                  ${renderSidebarGroupHeader({
                    collapsed: aiCollapsed,
                    title: t("frontstage.workbench.nav.aiAssistant"),
                    onToggle: () => props.onToggleSidebarGroup?.("aiAssistants"),
                    onAdd: props.onOpenAgentCreator ?? null,
                  })}
                  ${
                    aiCollapsed
                      ? null
                      : html`
                        <div class="employee-workbench__group-stack employee-workbench__group-stack--flat">
                          ${renderSidebarNavEntries(assistantItems, shellModel, sidebarNavHandlers, props)}
                        </div>
                      `
                  }
                </section>

                <section class="employee-workbench__group employee-workbench__group--divided">
                  ${renderSidebarGroupHeader({
                    collapsed: collaborationCollapsed,
                    title: t("frontstage.workbench.nav.collaborationSpaces"),
                    onToggle: () => props.onToggleSidebarGroup?.("collaborationSpaces"),
                    onAdd: props.onOpenSpaceCreator ?? null,
                  })}
                  ${
                    collaborationCollapsed
                      ? null
                      : html`
                        <div class="employee-workbench__group-stack employee-workbench__group-stack--flat">
                          ${renderSidebarSpaceEntries(
                            spaceItemsWithApprovals,
                            shellModel,
                            sidebarMembersProps,
                            model,
                          )}
                        </div>
                      `
                  }
                </section>

                <section class="employee-workbench__modules employee-workbench__modules--flat">
                  ${moduleItems.map((item) =>
                    renderModuleItem({
                      ...item,
                      active: shellModel.primaryModule === item.id,
                      onClick: () => runWorkbenchModuleSelection(item.id, moduleSelectionHandlers),
                    }),
                  )}
                </section>
              `
          }
        </div>
      </aside>

      <main
        class=${[
          "employee-workbench__main",
          hasWorkbenchHeaderTitle ? "" : "employee-workbench__main--titleless",
          showOverviewSignals ? "employee-workbench__main--with-signals" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        ${renderWorkbenchHeader({
          title: workbenchHeaderTitle,
          profileLabel: shellModel.profileLabel,
          connected: props.connected,
          currentLocale: props.currentLocale,
          currentTheme: props.currentTheme,
          userProfileName: props.userProfileName,
          userProfileSignature: props.userProfileSignature,
          tenantLabel: props.tenantLabel ?? "",
          onLocaleChange: props.onLocaleChange,
          onThemeChange: props.onThemeChange,
          onOpenPersonalSettings: () => props.onOpenPersonalSettings?.(),
          onLogout: props.onLogout,
        })}
        ${
          creatorOpen
            ? html`
                <div class="employee-workbench__main-creator">
                  ${
                    agentCreatorOpen && props.agentCreator
                      ? renderWorkbenchAgentCreatorDrawer({
                          state: props.agentCreator,
                          onClose: () => props.onCloseCreator?.(),
                          onNameChange: (value) => props.onAgentCreatorNameChange?.(value),
                          onEmojiChange: (value) => props.onAgentCreatorEmojiChange?.(value),
                          onTemplateChange: (value) => props.onAgentCreatorTemplateChange?.(value),
                          onWorkspaceKindChange: (value) =>
                            props.onAgentCreatorWorkspaceKindChange?.(value),
                          onLocalPathChange: (value) =>
                            props.onAgentCreatorLocalPathChange?.(value),
                          onValidateLocalWorkspace: async () => {
                            await props.onValidateAgentCreatorLocalWorkspace?.();
                          },
                          onOpenLocalBrowser: async () => {
                            await props.onOpenAgentCreatorLocalBrowser?.();
                          },
                          onCloseLocalBrowser: () => props.onCloseAgentCreatorLocalBrowser?.(),
                          onNavigateLocalBrowser: async (path) => {
                            await props.onNavigateAgentCreatorLocalBrowser?.(path);
                          },
                          onSelectLocalDirectory: (path) =>
                            props.onSelectAgentCreatorLocalDirectory?.(path),
                          onCloudProviderChange: (value) =>
                            props.onAgentCreatorCloudProviderChange?.(value),
                          onCloudRegionChange: (value) =>
                            props.onAgentCreatorCloudRegionChange?.(value),
                          onCloudBucketChange: (value) =>
                            props.onAgentCreatorCloudBucketChange?.(value),
                          onCloudRootPrefixChange: (value) =>
                            props.onAgentCreatorCloudRootPrefixChange?.(value),
                          onCloudEndpointChange: (value) =>
                            props.onAgentCreatorCloudEndpointChange?.(value),
                          onCloudAccountNameChange: (value) =>
                            props.onAgentCreatorCloudAccountNameChange?.(value),
                          onCloudAccessKeyIdChange: (value) =>
                            props.onAgentCreatorCloudAccessKeyIdChange?.(value),
                          onCloudSecretAccessKeyChange: (value) =>
                            props.onAgentCreatorCloudSecretAccessKeyChange?.(value),
                          onGenerateCloudConfig: async () => {
                            await props.onGenerateAgentCreatorCloudConfig?.();
                          },
                          onTestCloudConnection: async () => {
                            await props.onTestAgentCreatorCloudConnection?.();
                          },
                          onOpenCloudBrowser: async () => {
                            await props.onOpenAgentCreatorCloudBrowser?.();
                          },
                          onCloseCloudBrowser: () => props.onCloseAgentCreatorCloudBrowser?.(),
                          onNavigateCloudBrowser: async (path) => {
                            await props.onNavigateAgentCreatorCloudBrowser?.(path);
                          },
                          onSelectCloudDirectory: (path) =>
                            props.onSelectAgentCreatorCloudDirectory?.(path),
                          onSubmit: async () => {
                            await props.onCreateAgent?.();
                          },
                          onDesignIntentChange: (value) =>
                            props.onAgentCreatorDesignIntentChange?.(value),
                          onDesignRevisionChange: (value) =>
                            props.onAgentCreatorDesignRevisionChange?.(value),
                          onDesignTagDraftChange: (draft) =>
                            props.onAgentCreatorDesignTagDraftChange?.(draft),
                          onCompileDesign: async () => {
                            await props.onCompileAgentDesign?.();
                          },
                          onReviseDesign: async () => {
                            await props.onReviseAgentDesign?.();
                          },
                          onConfirmDesign: async () => {
                            await props.onConfirmAgentDesign?.();
                          },
                          onWizardBack: () => props.onAgentCreatorWizardBack?.(),
                          onUseTemplatePath: () => props.onAgentCreatorUseTemplatePath?.(),
                          onSelectStep: (step) => props.onAgentCreatorSelectStep?.(step),
                        })
                      : nothing
                  }
                  ${
                    spaceCreatorOpen && props.spaceCreator
                      ? renderWorkbenchSpaceCreatorDrawer({
                          state: props.spaceCreator,
                          onClose: () => props.onCloseCreator?.(),
                          onTitleChange: (value) => props.onSpaceCreatorTitleChange?.(value),
                          onAvatarChange: (value) => props.onSpaceCreatorAvatarChange?.(value),
                          onPurposeChange: (value) => props.onSpaceCreatorPurposeChange?.(value),
                          onCurrentMissionChange: (value) =>
                            props.onSpaceCreatorCurrentMissionChange?.(value),
                          onSystemInstructionsChange: (value) =>
                            props.onSpaceCreatorSystemInstructionsChange?.(value),
                          onGroupIdChange: (value) => props.onSpaceCreatorGroupIdChange?.(value),
                          onBack: () => props.onSpaceCreatorBack?.(),
                          onToggleHumanSelection: (id) =>
                            props.onSpaceCreatorToggleHumanSelection?.(id),
                          onToggleBotSelection: (id) =>
                            props.onSpaceCreatorToggleBotSelection?.(id),
                          onCoordinatorChange: (value) =>
                            props.onSpaceCreatorCoordinatorChange?.(value),
                          onSubmit: async () => {
                            await props.onCreateSpace?.();
                          },
                        })
                      : nothing
                  }
                </div>
              `
            : html`
                ${
                  showOverviewSignals
                    ? renderWorkbenchSignalsSurface(
                        shellModel.signals,
                        resolvedCapabilities.signals,
                        shellModel.stewardSuggestion,
                        props.scheduleItems ?? [],
                      )
                    : null
                }
                ${renderWorkbenchStage(
                  stageProps,
                  shellModel,
                  model,
                  showConversationStage,
                  knowledgeSurfaceRuntime,
                )}
              `
        }
      </main>
    </div>
  `;
}

export function renderWorkbenchPage(
  contract: WorkbenchPageContract,
  surfaceRuntime?: EmployeeWorkbenchSurfaceRuntime,
) {
  return renderWorkbench(contract.props, surfaceRuntime ?? contract.capabilities);
}
