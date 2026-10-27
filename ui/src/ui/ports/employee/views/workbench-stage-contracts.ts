import type { TemplateResult } from "lit";
import { shouldRenderChatStrip } from "../../../../../../src/progress-ledger/view-copy.ts";
import type { Locale } from "../../../../i18n/index.ts";
import type { GatewayBrowserClient } from "../../../gateway.ts";
import type { ThemeMode } from "../../../theme.ts";
import type { WorkspaceCloudProvider } from "../../../types.ts";
import type { renderCron } from "../../../views/cron.ts";
import type { MyAccumulationProps } from "../../../views/my-accumulation.ts";
import type { WorkbenchDataSpaceSettings } from "../data-space.ts";
import type { DevicePairingList } from "../semantic/view-controller-facade.ts";
import type {
  ExtractedSkillPreview,
  QuickSaveSkillFormData,
} from "../semantic/view-controller-facade.ts";
import type {
  UserOperationalIdentityBindingRequestSummary,
  UserOperationalIdentityContinuationSummary,
  UserOperationalIdentityNav,
  UserOperationalIdentitySnapshot,
} from "../semantic/view-controller-facade.ts";
import type { DataDirectoryPanelState } from "./data-directory-page.ts";
import type { EmployeeAssignedTasksCenterProps } from "./employee-assigned-tasks-center.ts";
import type { EmployeeSupervisorCenterProps } from "./employee-supervisor-center.ts";
import type {
  WorkbenchFutureKnowledgeSurface,
  WorkbenchProactiveCollaborationSurface,
} from "./home-page-contracts.ts";
import { findProgressForSession, renderProgressLedgerChatStrip } from "./personal-cron-progress.ts";
import type { WorkbenchDaibaiStageCapabilityContract } from "./workbench-capability-contracts.ts";
import type { WorkbenchSignalBundle } from "./workbench-signals.ts";
import {
  DEFAULT_WORKBENCH_SYSTEM_SETTINGS_TAB,
  type GroupProfileView,
  type WorkbenchAuthorizationIdentityTab,
  type WorkbenchPersonalSettingsTab,
  type WorkbenchSettingsGroupDraft,
  type WorkbenchCollaborationMemberGovernanceState,
  type WorkbenchSettingsGroupEntry,
  type WorkbenchSettingsRecentAccessEntry,
  type WorkbenchSettingsRobotEntry,
  type WorkbenchSettingsView,
  type WorkbenchSystemAuthorizationKey,
  type WorkbenchSystemSettingsTab,
  type WorkbenchMyTasksLaneCounts,
  type WorkbenchTasksSubTab,
  type WorkbenchWorkspaceSelectorMode,
  type WorkbenchWorkspaceSelectorState,
} from "./workbench-types.ts";

export type WorkbenchStageConversationContract = {
  authPanel: TemplateResult | null;
  chatContent: TemplateResult;
  chatComposer: TemplateResult | null;
  activeSessionKey: string;
  progressStrip?: TemplateResult | null;
  pendingOperationalIdentityBindingRequests?: UserOperationalIdentityBindingRequestSummary[];
  pendingOperationalIdentityContinuationsReady?: UserOperationalIdentityContinuationSummary[];
  pendingOperationalIdentityContinuationsOAuth?: UserOperationalIdentityContinuationSummary[];
  pendingOperationalIdentityContinuationsBinding?: UserOperationalIdentityContinuationSummary[];
  onOpenOperationalIdentityBindingFlow?: () => void;
  onResumeOperationalIdentityContinuation?: (continuationToken?: string) => void;
  onCompleteOperationalIdentityOAuthForContinuation?: (input: {
    continuationToken: string;
    provider: string;
    displayName?: string;
  }) => void;
  onOpenPersonalEmailBrowserGuideFromChat?: () => void;
};

export type WorkbenchCollaborationStageContract = {
  activeSessionKey: string;
  groupMembers: Array<{
    id: string;
    kind: string;
    name?: string | null;
    handle?: string | null;
    avatarUrl?: string | null;
  }>;
  ownedAgents: Array<{
    id: string;
    name?: string | null;
    identity?: {
      name?: string | null;
      emoji?: string | null;
    } | null;
    scope?: string | null;
    shareStatus?: string | null;
  }>;
  pendingBotApprovalCount: number;
  memberGovernanceDrawerOpen?: boolean;
  artifactPreviewOpen?: boolean;
  onOpenAssistantSettings: () => void;
  onOpenMemberGovernance: () => void;
  onOpenFilePreview: () => void;
  onClosePreview: () => void;
  onComposeFromPreview: (prompt: string) => void;
  memberGovernance: WorkbenchCollaborationMemberGovernanceState | null;
  onMemberGovernancePromptChange: (value: string) => void;
  onMemberGovernanceParse: () => void;
  onMemberGovernanceOpenSelector: (kind: "human" | "bot" | null) => void;
  onMemberGovernanceSearchChange: (value: string) => void;
  onMemberGovernanceToggleHumanSelection: (id: string) => void;
  onMemberGovernanceToggleBotSelection: (id: string) => void;
  onMemberGovernanceCommitSelection: () => void;
  onMemberGovernanceInviteHuman: (id: string) => void;
  onMemberGovernanceInviteBot: (id: string) => void;
  onMemberGovernanceCancelInvite: (intentId: string) => void;
  onMemberGovernanceRemoveMember: (id: string, kind: "human" | "bot") => void;
  onMemberGovernanceApproveBotInvite: (agentId: string) => void;
  onMemberGovernanceRejectBotInvite: (agentId: string) => void;
  onMemberGovernanceAcceptSelfInvite: () => void;
  onMemberGovernanceRejectSelfInvite: () => void;
  onMemberGovernanceReset: () => void;
  onLeaveCollaborationGroup?: () => void;
  onTransferCollaborationGroupOwnershipToHuman?: (userId: string) => void;
  collaborationRoundPlan?:
    | import("../../../../../../src/gateway/collaboration-dispatch/types.js").CollaborationRoundPlanPayload
    | null;
  collaborationSpeakingAgentId?: string | null;
  collaborationRulesSummary?: string[];
  collaborationRulesSections?: import("../../../collaboration/collaboration-rules-summary.ts").CollaborationRulesDrawerSection[];
  collaborationReasonDrawerOpen?: boolean;
  collaborationRulesDrawerOpen?: boolean;
  onOpenCollaborationReasonDrawer?: () => void;
  onCloseCollaborationReasonDrawer?: () => void;
  onOpenCollaborationRulesDrawer?: () => void;
  onCloseCollaborationRulesDrawer?: () => void;
  collaborationOptionalSuggestions?: import("../semantic/view-controller-facade.ts").CollaborationOptionalSuggestion[];
  collaborationMissionAdvanceBusy?: boolean;
  collaborationMissionAdvanceNotice?: string | null;
  collaborationMissionAdvanceError?: string | null;
  onAdvanceCollaborationMission?: () => void | Promise<void>;
  onDismissCollaborationOptionalSuggestion?: (id: string) => void;
};

export type WorkbenchStageModuleContract = {
  collaboration: WorkbenchCollaborationStageContract;
  daibai: WorkbenchDaibaiStageCapabilityContract;
  knowledge: WorkbenchFutureKnowledgeSurface;
  settings: {
    view: WorkbenchSettingsView;
    userProfileName: string;
    userProfileSignature: string;
    tenantLabel: string;
    currentSeatTitle?: string | null;
    currentSeatStatus?: string | null;
    currentSeatStatusLabel?: string | null;
    pendingSeatOffer?: {
      offerId: string;
      seatTitle: string;
      defaultAgentId?: string | null;
      defaultAgentLabel?: string | null;
      agentIds?: string[];
      agentToolLabels?: string[];
      omittedAgentIds?: string[];
      omittedAgentToolLabels?: string[];
      defaultSpaceIds?: string[];
      defaultSpaceLabels?: string[];
      reauthorizationRequired?: boolean;
      offeredAt: string;
    } | null;
    defaultAgentId?: string | null;
    defaultAgentLabel?: string | null;
    agentIds?: string[];
    robotTeamLabels?: string[];
    defaultSpaceIds?: string[];
    defaultSpaceLabels?: string[];
    defaultWorkspaceRoot?: string | null;
    defaultWorkspaceRootDraft?: string | null;
    defaultWorkspaceRootSaving?: boolean;
    defaultWorkspaceRootError?: string | null;
    defaultWorkspaceRootNotice?: string | null;
    dataSpace?: WorkbenchDataSpaceSettings | null;
    dataDirectoryPanel?: DataDirectoryPanelState | null;
    memoryCenterPanel?: import("./memory-center-page.ts").MemoryCenterPanelState | null;
    authorizationFullDiskAccessGranted?: boolean | null;
    authorizationAccessibilityGranted?: boolean | null;
    authorizationAutomationGranted?: boolean | null;
    authorizationNotificationsGranted?: boolean | null;
    authorizationHostConnected?: boolean;
    authorizationAppleDesktop?: boolean;
    systemAuthorizationNotice?: string | null;
    systemAuthorizationError?: string | null;
    devicePairingList?: DevicePairingList | null;
    devicePairingLoading?: boolean;
    devicePairingError?: string | null;
    devicePairingCurrentDeviceId?: string | null;
    devicePairingConnectedAtMs?: number | null;
    cronProps?: Parameters<typeof renderCron>[0];
    supervisorProps?: EmployeeSupervisorCenterProps | null;
    client?: GatewayBrowserClient | null;
    workspaceSelector?: WorkbenchWorkspaceSelectorState | null;
    workspaceNotice?: string | null;
    systemTab: WorkbenchSystemSettingsTab;
    personalTab: WorkbenchPersonalSettingsTab;
    authorizationIdentityTab: WorkbenchAuthorizationIdentityTab;
    tasksSubTab: WorkbenchTasksSubTab;
    assignedTasksProps?: EmployeeAssignedTasksCenterProps | null;
    myTasksLaneCounts?: WorkbenchMyTasksLaneCounts | null;
    myAccumulationProps?: MyAccumulationProps | null;
    skillSaveModalOpen?: boolean;
    skillSaveModalBusy?: boolean;
    skillSaveModalError?: string | null;
    skillSaveModalFormData?: QuickSaveSkillFormData | null;
    skillExtractedPreview?: ExtractedSkillPreview | null;
    skillAvailableGroups?: Array<{ id: string; name: string }>;
    skillSaveModalPreferEnterpriseSubmit?: boolean;
    skillSaveModalShowEnterpriseSubmitAction?: boolean;
    onSkillSaveFormChange?: (patch: Partial<QuickSaveSkillFormData>) => void;
    onSubmitSkillSave?: () => Promise<void> | void;
    onSubmitSkillSaveAndContinue?: () => Promise<void> | void;
    onCloseSkillSave?: () => void;
    recentAccessEntries?: WorkbenchSettingsRecentAccessEntry[];
    robotRosterStatus?: "ready" | "unbound" | "zero" | "query_failed" | "sync_failed";
    robotEntries?: WorkbenchSettingsRobotEntry[];
    groupEntries?: WorkbenchSettingsGroupEntry[];
    myBotDetail?: import("./workbench-types.ts").WorkbenchMyBotDetailState | null;
    collaborationGroupProjection?:
      | import("../semantic/collaboration-group-read-model.ts").CollaborationGroupProjection
      | null;
    collaborationGroupProjectionLoading?: boolean;
    selectedGroupKey?: string | null;
    selectedGroupEntry?: WorkbenchSettingsGroupEntry | null;
    selectedGroupDraft?: WorkbenchSettingsGroupDraft | null;
    systemGroupSaving?: boolean;
    systemGroupError?: string | null;
    systemGroupNotice?: string | null;
    systemSettingsPendingGroupId?: string | null;
    chatFocusMode: boolean;
    chatShowThinking: boolean;
    platformAuthEnabled: boolean;
    passwordChangeBusy: boolean;
    passwordChangeError: string | null;
    passwordChangeNotice: string | null;
    pendingSeatOfferBusy: boolean;
    pendingSeatOfferError: string | null;
    pendingSeatOfferNotice: string | null;
    passwordCurrentValue: string;
    passwordNewValue: string;
    currentLocale: Locale;
    currentTheme: ThemeMode;
    connected: boolean;
    onLocaleChange: (locale: Locale) => void;
    onThemeChange: (theme: ThemeMode) => void;
    onUserProfileNameChange: (value: string) => void;
    onUserProfileSignatureChange: (value: string) => void;
    onDefaultWorkspaceRootDraftChange: (value: string) => void;
    onSaveDefaultWorkspaceRoot: () => Promise<void> | void;
    onOpenWorkspaceSelector: (
      mode: WorkbenchWorkspaceSelectorMode,
      target?: { id?: string | null; label?: string | null; path?: string | null } | null,
    ) => Promise<void> | void;
    onCloseWorkspaceSelector: () => void;
    onChooseWorkspaceSelector: () => Promise<void> | void;
    onBrowseWorkspaceSelector: () => Promise<void> | void;
    onWorkspaceSelectorPathDraftChange: (value: string) => void;
    onUseCurrentWorkspaceSelectorDirectory: () => void;
    onNavigateWorkspaceSelector: (path: string | null) => Promise<void> | void;
    onSelectWorkspaceSelectorPath: (path: string) => void;
    onApplyWorkspaceSelector: () => Promise<void> | void;
    onOpenSystemAuthorization: (key: WorkbenchSystemAuthorizationKey) => void;
    onRefreshMyDevices?: () => Promise<void> | void;
    onRemoveMyDevice?: (deviceId: string) => Promise<void> | void;
    onApproveMyDevicePairing?: (requestId: string) => Promise<void> | void;
    onRejectMyDevicePairing?: (requestId: string) => Promise<void> | void;
    onRemoveMyDevices?: (deviceIds: string[]) => Promise<void> | void;
    onWorkspaceSelectorCloudProviderChange: (value: WorkspaceCloudProvider) => void;
    onWorkspaceSelectorCloudRegionChange: (value: string) => void;
    onWorkspaceSelectorCloudBucketChange: (value: string) => void;
    onWorkspaceSelectorCloudRootPrefixChange: (value: string) => void;
    onWorkspaceSelectorCloudEndpointChange: (value: string) => void;
    onWorkspaceSelectorCloudAccountNameChange: (value: string) => void;
    onGenerateWorkspaceSelectorCloudConfig: () => Promise<void> | void;
    onTestWorkspaceSelectorCloudConnection: () => Promise<void> | void;
    onChatFocusModeChange: (value: boolean) => void;
    onChatShowThinkingChange: (value: boolean) => void;
    onPasswordCurrentChange: (value: string) => void;
    onPasswordNewChange: (value: string) => void;
    onChangePassword: () => Promise<void> | void;
    onOpenForgotPassword: () => Promise<void> | void;
    onAcceptPendingSeatOffer: (offerId: string) => Promise<void> | void;
    onDeclinePendingSeatOffer: (offerId: string) => Promise<void> | void;
    onSystemTabChange: (tab: WorkbenchSystemSettingsTab) => void;
    onPersonalTabChange: (tab: WorkbenchPersonalSettingsTab) => void;
    onRevealDataDirectoryInFinder?: () => Promise<void> | void;
    onOpenDataMigrationWizard?: () => void;
    onCloseDataMigrationWizard?: () => void;
    onDataMigrationTargetDraftChange?: (value: string) => void;
    onChooseDataMigrationTarget?: () => Promise<void> | void;
    onStartDataMigration?: () => Promise<void> | void;
    onExportOpenBotData?: () => Promise<void> | void;
    onForgetMemoryAgentIdChange?: (value: string) => void;
    onForgetMemoryKeyChange?: (value: string) => void;
    onForgetMemoryEntry?: () => Promise<void> | void;
    onMemoryCenterAgentIdChange?: (value: string) => void;
    onMemoryCenterKeyChange?: (value: string) => void;
    onMemoryCenterAtomIdChange?: (value: string) => void;
    onMemoryCenterForget?: () => Promise<void> | void;
    onMemoryCenterStatusViewChange?: (value: "active" | "tentative") => void;
    onRevokeAccessGrant?: (grantId: string) => Promise<void> | void;
    onTasksSubTabChange: (tab: WorkbenchTasksSubTab) => void;
    onSystemSettingsGroupSelect: (groupId: string) => void;
    onSystemSettingsGroupDraftChange: (patch: Partial<WorkbenchSettingsGroupDraft>) => void;
    onSaveSystemSettingsGroup: () => Promise<void> | void;
    onResetSystemSettingsGroup: () => Promise<void> | void;
    onDissolveSystemSettingsGroup: () => Promise<void> | void;
    onLeaveSystemSettingsGroup: () => Promise<void> | void;
    onTransferSystemSettingsGroupOwnership: (userId: string) => Promise<void> | void;
    onOpenSystemSettingsGroupMembers: () => void;
    onExportSystemSettingsGroupSummary: () => void;
    onResolveSystemSettingsGroupSwitch?: (
      action: "save" | "discard" | "cancel",
    ) => Promise<void> | void;
    onSelectSession: (sessionKey: string) => void;
    onOpenInstallCapability: (robotId: string) => void;
    onOpenMyAssets?: () => void;
    onOpenMyBotDetail?: (agentId: string) => void;
    onCloseMyBotDetail?: () => void;
    onMyBotDetailTabChange?: (tab: import("./workbench-types.ts").WorkbenchMyBotDetailTab) => void;
    onMyBotIdentityDraftChange?: (
      patch: Partial<import("./workbench-types.ts").WorkbenchMyBotIdentityDraft>,
    ) => void;
    onSaveMyBotIdentity?: () => Promise<void> | void;
    onMyBotOpenGroup?: (groupId: string) => void;
    onDeleteOwnedRobot?: (
      agentId: string,
      displayName: string,
      memoryDisposal?: "delete_all" | "keep_artifacts_conversations" | "soft_unbind",
    ) => Promise<void> | void;
    ownedRobotDeletePrompt?: { agentId: string; name: string } | null;
    ownedRobotDeleteDisposition?: "delete_all" | "keep_artifacts_conversations" | "soft_unbind";
    onOpenOwnedRobotDeletePrompt?: (agentId: string, name: string) => void;
    onOwnedRobotDeleteDispositionChange?: (
      value: "delete_all" | "keep_artifacts_conversations" | "soft_unbind",
    ) => void;
    onCancelOwnedRobotDelete?: () => void;
    onConfirmOwnedRobotDelete?: () => Promise<void> | void;
    ownedRobotDeleteBusyId?: string | null;
    ownedRobotDeleteError?: string | null;
    onLogout: () => void;
    userOperationalIdentitySnapshot?: UserOperationalIdentitySnapshot | null;
    userOperationalIdentityBusy?: boolean;
    userOperationalIdentityError?: string | null;
    userOperationalIdentityNotice?: string | null;
    userOperationalIdentityNav?: UserOperationalIdentityNav;
    userOperationalIdentityUsageRange?: import("../semantic/view-controller-facade.ts").UserOperationalIdentityUsageRange;
    userOperationalIdentityUsageEventId?: string | null;
    onUserOperationalIdentityUsageRangeChange?: (
      range: import("../semantic/view-controller-facade.ts").UserOperationalIdentityUsageRange,
    ) => void;
    onSelectUserOperationalIdentityUsageEvent?: (eventId: string | null) => void;
    userOperationalIdentityEditorOpen?: boolean;
    userOperationalIdentityEditorProvider?: string;
    userOperationalIdentityEditorDisplayName?: string;
    userOperationalIdentityEditorCredentialHandleId?: string;
    userOperationalIdentityEditorAppId?: string;
    userOperationalIdentityEditorAppSecret?: string;
    userOperationalIdentityEditorSmtpHost?: string;
    userOperationalIdentityEditorSmtpPort?: string;
    userOperationalIdentityEditorSmtpUser?: string;
    userOperationalIdentityEditorImapHost?: string;
    userOperationalIdentityEditorImapPort?: string;
    userOperationalIdentityEditorImapUser?: string;
    userOperationalIdentityEditorPersonalEmailPresetNote?: string | null;
    userOperationalIdentityEditorUsePlatformSmtp?: boolean;
    userOperationalIdentityEditorIdentityId?: string | null;
    wechatPersonalQrWorkerOnline?: boolean | null;
    wechatPersonalQrStatus?: "idle" | "offline" | "scanning" | "logged_in" | "error";
    wechatPersonalQrDataUrl?: string | null;
    wechatPersonalQrMessage?: string | null;
    wechatPersonalQrWxid?: string | null;
    ownedAgents?: WorkbenchCollaborationStageContract["ownedAgents"];
    userOperationalIdentityEditorGrantAgentId?: string | null;
    userOperationalIdentityReturnSessionKey?: string | null;
    userOperationalIdentityContinuationNotice?: string | null;
    onRefreshUserOperationalIdentities?: () => Promise<void> | void;
    onOpenUserOperationalIdentityEditor?: (provider?: string) => void;
    onUserOperationalIdentityNavChange?: (nav: UserOperationalIdentityNav) => void;
    onCloseUserOperationalIdentityEditor?: () => void;
    onSubmitUserOperationalIdentityEditor?: () => Promise<void> | void;
    onStartWechatPersonalQr?: () => Promise<void> | void;
    onRecheckWechatPersonalChannel?: () => Promise<void> | void;
    onUserOperationalIdentityEditorGrantAgentIdChange?: (value: string) => void;
    onVerifyUserOperationalIdentityCredentials?: (identityId: string) => Promise<void> | void;
    onCompleteUserOperationalIdentityOAuthForContinuation?: (input: {
      continuationToken: string;
      provider: string;
      displayName?: string;
    }) => Promise<void> | void;
    onUserOperationalIdentityEditorProviderChange?: (value: string) => void;
    onUserOperationalIdentityEditorDisplayNameChange?: (value: string) => void;
    onUserOperationalIdentityEditorCredentialHandleIdChange?: (value: string) => void;
    onUserOperationalIdentityEditorAppIdChange?: (value: string) => void;
    onUserOperationalIdentityEditorAppSecretChange?: (value: string) => void;
    onUserOperationalIdentityEditorSmtpHostChange?: (value: string) => void;
    onUserOperationalIdentityEditorSmtpPortChange?: (value: string) => void;
    onUserOperationalIdentityEditorSmtpUserChange?: (value: string) => void;
    onUserOperationalIdentityEditorImapHostChange?: (value: string) => void;
    onUserOperationalIdentityEditorImapPortChange?: (value: string) => void;
    onUserOperationalIdentityEditorImapUserChange?: (value: string) => void;
    onUserOperationalIdentityEditorUsePlatformSmtpChange?: (value: boolean) => void;
    onOpenPersonalEmailWebmail?: () => void;
    onOpenPersonalEmailAuthCodeSettings?: () => void;
    onRevokeUserOperationalIdentity?: (identityId: string) => Promise<void> | void;
    onReauthorizeUserOperationalIdentity?: (identityId: string) => Promise<void> | void;
    onCompleteUserOperationalIdentityBindingRequest?: (requestId: string) => Promise<void> | void;
    onConfirmUserOperationalIdentityGrant?: (input: {
      identityId: string;
      agentId: string;
      agentScope: "owned" | "shared" | "group";
      allowedActions: string[];
      sessionKey?: string | null;
    }) => Promise<void> | void;
    onRevokeUserOperationalIdentityGrant?: (grantId: string) => Promise<void> | void;
    onLoadRobotEnterpriseIdentities?: (agentId: string) => void;
    onApplyRobotIdentityGrants?: (input: {
      agentId: string;
      agentScope: "owned" | "shared" | "group";
      desired: Array<{ identityId: string; allowedActions: string[] }>;
    }) => Promise<void> | void;
    onApplyIdentityRobotGrants?: (input: {
      identityId: string;
      desiredAgentIds: string[];
      agentScopesById?: Record<string, "owned" | "shared" | "group">;
    }) => Promise<void> | void;
    onApplyRobotEnterpriseIdentities?: (input: {
      agentId: string;
      desiredIdentityIds: string[];
    }) => Promise<void> | void;
    onApplyEnterpriseIdentityRobots?: (input: {
      identityId: string;
      agentIds: string[];
    }) => Promise<void> | void;
    onSyncEnterpriseOperationalIdentities?: () => void | Promise<void>;
    onOpenUserOperationalIdentityBindingFlow?: () => void;
    onOpenPersonalOperationalIdentity?: (options?: {
      openEditor?: boolean;
      agentId?: string;
      scroll?: boolean;
    }) => void;
    robotIdentityGrantFocusAgentId?: string | null;
    enterpriseIdentityBindingFocusAgentId?: string | null;
    onReturnToRobotIdentityGrant?: () => void;
    onRobotIdentityGrantFocusHandled?: () => void;
    onResumeUserOperationalIdentityContinuation?: (
      continuationToken?: string,
    ) => Promise<void> | void;
  } | null;
  signals: WorkbenchSignalBundle | null;
};

export type SettingsContract = NonNullable<WorkbenchStageModuleContract["settings"]>;

type StagePropsSource = {
  authPanel: TemplateResult | null;
  chatContent: TemplateResult;
  chatComposer: TemplateResult | null;
  activeSessionKey: string;
  groupMembers?: WorkbenchCollaborationStageContract["groupMembers"];
  ownedAgents?: WorkbenchCollaborationStageContract["ownedAgents"];
  pendingBotApprovalCount?: number;
  onOpenAssistantSettings?: (() => void) | null;
  onPrefillChatDraft?: ((draft: string) => void) | null;
  onGroupProfileViewChange?: ((view: GroupProfileView) => void) | null;
  collaborationMemberGovernance?: WorkbenchCollaborationMemberGovernanceState | null;
  collaborationRoundPlan?:
    | import("../../../../../../src/gateway/collaboration-dispatch/types.js").CollaborationRoundPlanPayload
    | null;
  collaborationSpeakingAgentId?: string | null;
  collaborationRulesSummary?: string[];
  collaborationRulesSections?: import("../../../collaboration/collaboration-rules-summary.ts").CollaborationRulesDrawerSection[];
  collaborationReasonDrawerOpen?: boolean;
  collaborationRulesDrawerOpen?: boolean;
  onOpenCollaborationReasonDrawer?: () => void;
  onCloseCollaborationReasonDrawer?: () => void;
  onOpenCollaborationRulesDrawer?: () => void;
  onCloseCollaborationRulesDrawer?: () => void;
  memberGovernanceDrawerOpen?: boolean;
  artifactPreviewOpen?: boolean;
  onOpenCollaborationMemberGovernance?: () => void;
  onCloseCollaborationMemberGovernance?: () => void;
  collaborationOptionalSuggestions?: WorkbenchCollaborationStageContract["collaborationOptionalSuggestions"];
  collaborationMissionAdvanceBusy?: boolean;
  collaborationMissionAdvanceNotice?: string | null;
  collaborationMissionAdvanceError?: string | null;
  onAdvanceCollaborationMission?: () => void | Promise<void>;
  onDismissCollaborationOptionalSuggestion?: (id: string) => void;
  onMemberGovernancePromptChange?: ((value: string) => void) | null;
  onMemberGovernanceParse?: (() => void) | null;
  onMemberGovernanceOpenSelector?: ((kind: "human" | "bot" | null) => void) | null;
  onMemberGovernanceSearchChange?: ((value: string) => void) | null;
  onMemberGovernanceToggleHumanSelection?: ((id: string) => void) | null;
  onMemberGovernanceToggleBotSelection?: ((id: string) => void) | null;
  onMemberGovernanceCommitSelection?: (() => void) | null;
  onMemberGovernanceInviteHuman?: ((id: string) => void) | null;
  onMemberGovernanceInviteBot?: ((id: string) => void) | null;
  onMemberGovernanceCancelInvite?: ((intentId: string) => void) | null;
  onMemberGovernanceRemoveMember?: ((id: string, kind: "human" | "bot") => void) | null;
  onMemberGovernanceApproveBotInvite?: ((agentId: string) => void) | null;
  onMemberGovernanceRejectBotInvite?: ((agentId: string) => void) | null;
  onMemberGovernanceAcceptSelfInvite?: (() => void) | null;
  onMemberGovernanceRejectSelfInvite?: (() => void) | null;
  onMemberGovernanceReset?: (() => void) | null;
  onOpenFilePreview?: (() => void) | null;
  onLeaveSystemSettingsGroup?: (() => void) | null;
  onTransferCollaborationGroupOwnershipToHuman?: ((userId: string) => void) | null;
  onTransferSystemSettingsGroupOwnership?: ((userId: string) => void) | null;
  connected?: boolean;
  client?: GatewayBrowserClient | null;
  currentLocale?: Locale;
  currentTheme?: ThemeMode;
  userProfileName?: string;
  userProfileSignature?: string;
  tenantLabel?: string;
  currentSeatTitle?: string | null;
  currentSeatStatus?: string | null;
  currentSeatStatusLabel?: string | null;
  pendingSeatOffer?: {
    offerId: string;
    seatTitle: string;
    defaultAgentId?: string | null;
    defaultAgentLabel?: string | null;
    agentIds?: string[];
    agentToolLabels?: string[];
    omittedAgentIds?: string[];
    omittedAgentToolLabels?: string[];
    defaultSpaceIds?: string[];
    defaultSpaceLabels?: string[];
    reauthorizationRequired?: boolean;
    offeredAt: string;
  } | null;
  settingsView?: WorkbenchSettingsView;
  defaultAgentId?: string | null;
  defaultAgentLabel?: string | null;
  agentIds?: string[];
  robotTeamLabels?: string[];
  defaultSpaceIds?: string[];
  defaultSpaceLabels?: string[];
  defaultWorkspaceRoot?: string | null;
  defaultWorkspaceRootDraft?: string | null;
  defaultWorkspaceRootSaving?: boolean;
  defaultWorkspaceRootError?: string | null;
  defaultWorkspaceRootNotice?: string | null;
  dataSpace?: WorkbenchDataSpaceSettings | null;
  dataDirectoryPanel?: DataDirectoryPanelState | null;
  authorizationFullDiskAccessGranted?: boolean | null;
  authorizationAccessibilityGranted?: boolean | null;
  authorizationAutomationGranted?: boolean | null;
  authorizationNotificationsGranted?: boolean | null;
  authorizationHostConnected?: boolean;
  authorizationAppleDesktop?: boolean;
  systemAuthorizationNotice?: string | null;
  systemAuthorizationError?: string | null;
  devicePairingList?: DevicePairingList | null;
  devicePairingLoading?: boolean;
  devicePairingError?: string | null;
  devicePairingCurrentDeviceId?: string | null;
  devicePairingConnectedAtMs?: number | null;
  cronProps?: Parameters<typeof renderCron>[0];
  conversationTaskProgress?:
    | import("../../../../../../src/progress-ledger/types.ts").ProgressView
    | null;
  supervisorProps?: EmployeeSupervisorCenterProps | null;
  workspaceSelector?: WorkbenchWorkspaceSelectorState | null;
  workspaceNotice?: string | null;
  systemSettingsTab?: WorkbenchSystemSettingsTab;
  personalSettingsTab?: WorkbenchPersonalSettingsTab;
  authorizationIdentityTab?: WorkbenchAuthorizationIdentityTab;
  tasksSubTab?: WorkbenchTasksSubTab;
  assignedTasksProps?: EmployeeAssignedTasksCenterProps | null;
  myTasksLaneCounts?: WorkbenchMyTasksLaneCounts | null;
  myAccumulationProps?: MyAccumulationProps | null;
  skillSaveModalOpen?: boolean;
  skillSaveModalBusy?: boolean;
  skillSaveModalError?: string | null;
  skillSaveModalFormData?: QuickSaveSkillFormData | null;
  skillExtractedPreview?: ExtractedSkillPreview | null;
  skillAvailableGroups?: Array<{ id: string; name: string }>;
  skillSaveModalPreferEnterpriseSubmit?: boolean;
  skillSaveModalShowEnterpriseSubmitAction?: boolean;
  onSkillSaveFormChange?: ((patch: Partial<QuickSaveSkillFormData>) => void) | null;
  onSubmitSkillSave?: (() => Promise<void> | void) | null;
  onSubmitSkillSaveAndContinue?: (() => Promise<void> | void) | null;
  onCloseSkillSave?: (() => void) | null;
  recentAccessEntries?: WorkbenchSettingsRecentAccessEntry[];
  robotRosterStatus?: "ready" | "unbound" | "zero" | "query_failed" | "sync_failed";
  robotEntries?: WorkbenchSettingsRobotEntry[];
  groupEntries?: WorkbenchSettingsGroupEntry[];
  myBotDetail?: import("./workbench-types.ts").WorkbenchMyBotDetailState | null;
  collaborationGroupProjection?:
    | import("../semantic/collaboration-group-read-model.ts").CollaborationGroupProjection
    | null;
  collaborationGroupProjectionLoading?: boolean;
  onOpenMyBotDetail?: ((agentId: string) => void) | null;
  onCloseMyBotDetail?: (() => void) | null;
  onMyBotDetailTabChange?:
    | ((tab: import("./workbench-types.ts").WorkbenchMyBotDetailTab) => void)
    | null;
  onMyBotIdentityDraftChange?:
    | ((patch: Partial<import("./workbench-types.ts").WorkbenchMyBotIdentityDraft>) => void)
    | null;
  onSaveMyBotIdentity?: (() => Promise<void> | void) | null;
  onMyBotOpenGroup?: ((groupId: string) => void) | null;
  selectedGroupKey?: string | null;
  selectedGroupEntry?: WorkbenchSettingsGroupEntry | null;
  selectedGroupDraft?: WorkbenchSettingsGroupDraft | null;
  systemGroupSaving?: boolean;
  systemGroupError?: string | null;
  systemGroupNotice?: string | null;
  systemSettingsPendingGroupId?: string | null;
  chatFocusMode?: boolean;
  chatShowThinking?: boolean;
  platformAuthEnabled?: boolean;
  passwordChangeBusy?: boolean;
  passwordChangeError?: string | null;
  passwordChangeNotice?: string | null;
  pendingSeatOfferBusy?: boolean;
  pendingSeatOfferError?: string | null;
  pendingSeatOfferNotice?: string | null;
  passwordCurrentValue?: string;
  passwordNewValue?: string;
  onLocaleChange?: ((locale: Locale) => void) | null;
  onThemeChange?: ((theme: ThemeMode) => void) | null;
  onUserProfileNameChange?: ((value: string) => void) | null;
  onUserProfileSignatureChange?: ((value: string) => void) | null;
  onDefaultWorkspaceRootDraftChange?: ((value: string) => void) | null;
  onSaveDefaultWorkspaceRoot?: (() => Promise<void> | void) | null;
  onOpenWorkspaceSelector?:
    | ((
        mode: WorkbenchWorkspaceSelectorMode,
        target?: { id?: string | null; label?: string | null; path?: string | null } | null,
      ) => Promise<void> | void)
    | null;
  onCloseWorkspaceSelector?: (() => void) | null;
  onChooseWorkspaceSelector?: (() => Promise<void> | void) | null;
  onBrowseWorkspaceSelector?: (() => Promise<void> | void) | null;
  onWorkspaceSelectorPathDraftChange?: ((value: string) => void) | null;
  onUseCurrentWorkspaceSelectorDirectory?: (() => void) | null;
  onNavigateWorkspaceSelector?: ((path: string | null) => Promise<void> | void) | null;
  onSelectWorkspaceSelectorPath?: ((path: string) => void) | null;
  onApplyWorkspaceSelector?: (() => Promise<void> | void) | null;
  onOpenSystemAuthorization?: ((key: WorkbenchSystemAuthorizationKey) => void) | null;
  onRefreshMyDevices?: (() => Promise<void> | void) | null;
  onRemoveMyDevice?: ((deviceId: string) => Promise<void> | void) | null;
  onApproveMyDevicePairing?: ((requestId: string) => Promise<void> | void) | null;
  onRejectMyDevicePairing?: ((requestId: string) => Promise<void> | void) | null;
  onRemoveMyDevices?: ((deviceIds: string[]) => Promise<void> | void) | null;
  onWorkspaceSelectorCloudProviderChange?: ((value: WorkspaceCloudProvider) => void) | null;
  onWorkspaceSelectorCloudRegionChange?: ((value: string) => void) | null;
  onWorkspaceSelectorCloudBucketChange?: ((value: string) => void) | null;
  onWorkspaceSelectorCloudRootPrefixChange?: ((value: string) => void) | null;
  onWorkspaceSelectorCloudEndpointChange?: ((value: string) => void) | null;
  onWorkspaceSelectorCloudAccountNameChange?: ((value: string) => void) | null;
  onGenerateWorkspaceSelectorCloudConfig?: (() => Promise<void> | void) | null;
  onTestWorkspaceSelectorCloudConnection?: (() => Promise<void> | void) | null;
  onChatFocusModeChange?: ((value: boolean) => void) | null;
  onChatShowThinkingChange?: ((value: boolean) => void) | null;
  onPasswordCurrentChange?: ((value: string) => void) | null;
  onPasswordNewChange?: ((value: string) => void) | null;
  onChangePassword?: (() => Promise<void> | void) | null;
  onOpenForgotPassword?: (() => Promise<void> | void) | null;
  onAcceptPendingSeatOffer?: ((offerId: string) => Promise<void> | void) | null;
  onDeclinePendingSeatOffer?: ((offerId: string) => Promise<void> | void) | null;
  onSystemSettingsTabChange?: ((tab: WorkbenchSystemSettingsTab) => void) | null;
  onPersonalSettingsTabChange?: ((tab: WorkbenchPersonalSettingsTab) => void) | null;
  onRevealDataDirectoryInFinder?: (() => Promise<void> | void) | null;
  onOpenDataMigrationWizard?: (() => void) | null;
  onCloseDataMigrationWizard?: (() => void) | null;
  onDataMigrationTargetDraftChange?: ((value: string) => void) | null;
  onChooseDataMigrationTarget?: (() => Promise<void> | void) | null;
  onStartDataMigration?: (() => Promise<void> | void) | null;
  onExportOpenBotData?: (() => Promise<void> | void) | null;
  onForgetMemoryAgentIdChange?: ((value: string) => void) | null;
  onForgetMemoryKeyChange?: ((value: string) => void) | null;
  onForgetMemoryEntry?: (() => Promise<void> | void) | null;
  memoryCenterPanel?: import("./memory-center-page.ts").MemoryCenterPanelState | null;
  onMemoryCenterAgentIdChange?: ((value: string) => void) | null;
  onMemoryCenterKeyChange?: ((value: string) => void) | null;
  onMemoryCenterAtomIdChange?: ((value: string) => void) | null;
  onMemoryCenterForget?: (() => Promise<void> | void) | null;
  onMemoryCenterStatusViewChange?: ((value: "active" | "tentative") => void) | null;
  onRevokeAccessGrant?: ((grantId: string) => Promise<void> | void) | null;
  onTasksSubTabChange?: ((tab: WorkbenchTasksSubTab) => void) | null;
  onSystemSettingsGroupSelect?: ((groupId: string) => void) | null;
  onSystemSettingsGroupDraftChange?: ((patch: Partial<WorkbenchSettingsGroupDraft>) => void) | null;
  onSaveSystemSettingsGroup?: (() => Promise<void> | void) | null;
  onResetSystemSettingsGroup?: (() => Promise<void> | void) | null;
  onDissolveSystemSettingsGroup?: (() => Promise<void> | void) | null;
  onOpenSystemSettingsGroupMembers?: (() => void) | null;
  onExportSystemSettingsGroupSummary?: (() => void) | null;
  onResolveSystemSettingsGroupSwitch?:
    | ((action: "save" | "discard" | "cancel") => Promise<void> | void)
    | null;
  onSelectSession?: ((sessionKey: string) => void) | null;
  onOpenInstallCapability?: ((robotId: string) => void) | null;
  onOpenMyAssets?: (() => void) | null;
  onDeleteOwnedRobot?:
    | ((
        agentId: string,
        displayName: string,
        memoryDisposal?: "delete_all" | "keep_artifacts_conversations" | "soft_unbind",
      ) => Promise<void> | void)
    | null;
  ownedRobotDeletePrompt?: { agentId: string; name: string } | null;
  ownedRobotDeleteDisposition?: "delete_all" | "keep_artifacts_conversations" | "soft_unbind";
  onOpenOwnedRobotDeletePrompt?: ((agentId: string, name: string) => void) | null;
  onOwnedRobotDeleteDispositionChange?:
    | ((value: "delete_all" | "keep_artifacts_conversations" | "soft_unbind") => void)
    | null;
  onCancelOwnedRobotDelete?: (() => void) | null;
  onConfirmOwnedRobotDelete?: (() => Promise<void> | void) | null;
  ownedRobotDeleteBusyId?: string | null;
  ownedRobotDeleteError?: string | null;
  onLogout?: (() => void) | null;
  userOperationalIdentitySnapshot?: UserOperationalIdentitySnapshot | null;
  userOperationalIdentityBusy?: boolean;
  userOperationalIdentityError?: string | null;
  userOperationalIdentityNotice?: string | null;
  userOperationalIdentityNav?: UserOperationalIdentityNav;
  userOperationalIdentityUsageRange?: import("../semantic/view-controller-facade.ts").UserOperationalIdentityUsageRange;
  userOperationalIdentityUsageEventId?: string | null;
  onUserOperationalIdentityUsageRangeChange?:
    | ((
        range: import("../semantic/view-controller-facade.ts").UserOperationalIdentityUsageRange,
      ) => void)
    | null;
  onSelectUserOperationalIdentityUsageEvent?: ((eventId: string | null) => void) | null;
  userOperationalIdentityEditorOpen?: boolean;
  userOperationalIdentityEditorProvider?: string;
  userOperationalIdentityEditorDisplayName?: string;
  userOperationalIdentityEditorCredentialHandleId?: string;
  userOperationalIdentityEditorAppId?: string;
  userOperationalIdentityEditorAppSecret?: string;
  userOperationalIdentityEditorSmtpHost?: string;
  userOperationalIdentityEditorSmtpPort?: string;
  userOperationalIdentityEditorSmtpUser?: string;
  userOperationalIdentityEditorImapHost?: string;
  userOperationalIdentityEditorImapPort?: string;
  userOperationalIdentityEditorImapUser?: string;
  userOperationalIdentityEditorPersonalEmailPresetNote?: string | null;
  userOperationalIdentityEditorUsePlatformSmtp?: boolean;
  userOperationalIdentityEditorIdentityId?: string | null;
  wechatPersonalQrWorkerOnline?: boolean | null;
  wechatPersonalQrStatus?: "idle" | "offline" | "scanning" | "logged_in" | "error";
  wechatPersonalQrDataUrl?: string | null;
  wechatPersonalQrMessage?: string | null;
  wechatPersonalQrWxid?: string | null;
  userOperationalIdentityEditorGrantAgentId?: string | null;
  userOperationalIdentityReturnSessionKey?: string | null;
  onRefreshUserOperationalIdentities?: (() => Promise<void> | void) | null;
  onOpenUserOperationalIdentityEditor?: ((provider?: string) => void) | null;
  onUserOperationalIdentityNavChange?: ((nav: UserOperationalIdentityNav) => void) | null;
  onCloseUserOperationalIdentityEditor?: (() => void) | null;
  onSubmitUserOperationalIdentityEditor?: (() => Promise<void> | void) | null;
  onStartWechatPersonalQr?: (() => Promise<void> | void) | null;
  onRecheckWechatPersonalChannel?: (() => Promise<void> | void) | null;
  onUserOperationalIdentityEditorGrantAgentIdChange?: ((value: string) => void) | null;
  onVerifyUserOperationalIdentityCredentials?:
    | ((identityId: string) => Promise<void> | void)
    | null;
  onCompleteUserOperationalIdentityOAuthForContinuation?:
    | ((input: {
        continuationToken: string;
        provider: string;
        displayName?: string;
      }) => Promise<void> | void)
    | null;
  onUserOperationalIdentityEditorProviderChange?: ((value: string) => void) | null;
  onUserOperationalIdentityEditorDisplayNameChange?: ((value: string) => void) | null;
  onUserOperationalIdentityEditorAppIdChange?: ((value: string) => void) | null;
  onUserOperationalIdentityEditorAppSecretChange?: ((value: string) => void) | null;
  onUserOperationalIdentityEditorSmtpHostChange?: ((value: string) => void) | null;
  onUserOperationalIdentityEditorSmtpPortChange?: ((value: string) => void) | null;
  onUserOperationalIdentityEditorSmtpUserChange?: ((value: string) => void) | null;
  onUserOperationalIdentityEditorImapHostChange?: ((value: string) => void) | null;
  onUserOperationalIdentityEditorImapPortChange?: ((value: string) => void) | null;
  onUserOperationalIdentityEditorImapUserChange?: ((value: string) => void) | null;
  onUserOperationalIdentityEditorUsePlatformSmtpChange?: ((value: boolean) => void) | null;
  onOpenPersonalEmailWebmail?: (() => void) | null;
  onOpenPersonalEmailAuthCodeSettings?: (() => void) | null;
  onUserOperationalIdentityEditorCredentialHandleIdChange?: ((value: string) => void) | null;
  onRevokeUserOperationalIdentity?: ((identityId: string) => Promise<void> | void) | null;
  onReauthorizeUserOperationalIdentity?: ((identityId: string) => Promise<void> | void) | null;
  onCompleteUserOperationalIdentityBindingRequest?:
    | ((requestId: string) => Promise<void> | void)
    | null;
  onConfirmUserOperationalIdentityGrant?:
    | ((input: {
        identityId: string;
        agentId: string;
        agentScope: "owned" | "shared" | "group";
        allowedActions: string[];
      }) => Promise<void> | void)
    | null;
  onRevokeUserOperationalIdentityGrant?: ((grantId: string) => Promise<void> | void) | null;
  onLoadRobotEnterpriseIdentities?: ((agentId: string) => void) | null;
  onApplyRobotIdentityGrants?:
    | ((input: {
        agentId: string;
        agentScope: "owned" | "shared" | "group";
        desired: Array<{ identityId: string; allowedActions: string[] }>;
      }) => Promise<void> | void)
    | null;
  onApplyIdentityRobotGrants?:
    | ((input: {
        identityId: string;
        desiredAgentIds: string[];
        agentScopesById?: Record<string, "owned" | "shared" | "group">;
      }) => Promise<void> | void)
    | null;
  onApplyRobotEnterpriseIdentities?:
    | ((input: { agentId: string; desiredIdentityIds: string[] }) => Promise<void> | void)
    | null;
  onApplyEnterpriseIdentityRobots?:
    | ((input: { identityId: string; agentIds: string[] }) => Promise<void> | void)
    | null;
  onSyncEnterpriseOperationalIdentities?: (() => void | Promise<void>) | null;
  onOpenUserOperationalIdentityBindingFlow?: (() => void) | null;
  onOpenPersonalEmailBrowserGuideFromChat?: (() => void) | null;
  onOpenPersonalOperationalIdentity?:
    | ((options?: { openEditor?: boolean; agentId?: string; scroll?: boolean }) => void)
    | null;
  robotIdentityGrantFocusAgentId?: string | null;
  enterpriseIdentityBindingFocusAgentId?: string | null;
  onReturnToRobotIdentityGrant?: (() => void) | null;
  onRobotIdentityGrantFocusHandled?: (() => void) | null;
  onResumeUserOperationalIdentityContinuation?:
    | ((continuationToken?: string) => Promise<void> | void)
    | null;
  userOperationalIdentityContinuationNotice?: string | null;
  signals?: WorkbenchSignalBundle | null;
} & Partial<WorkbenchDaibaiStageCapabilityContract>;

function resolveConversationProgressStrip(props: StagePropsSource): TemplateResult | null {
  const conversationView = props.conversationTaskProgress ?? null;
  if (conversationView && shouldRenderChatStrip(conversationView)) {
    return renderProgressLedgerChatStrip(conversationView) as TemplateResult;
  }
  const jobs = props.cronProps?.jobs ?? [];
  const cronView = findProgressForSession(jobs, props.activeSessionKey) ?? null;
  if (!cronView) {
    return null;
  }
  return renderProgressLedgerChatStrip(cronView) as TemplateResult;
}

export function buildWorkbenchStageConversationContract(
  props: StagePropsSource,
): WorkbenchStageConversationContract {
  const pendingOperationalIdentityBindingRequests =
    props.userOperationalIdentitySnapshot?.pendingBindingRequests?.filter(
      (request) => request.status === "pending",
    ) ?? [];
  const pendingContinuations = props.userOperationalIdentitySnapshot?.pendingContinuations ?? [];
  const pendingOperationalIdentityContinuationsReady = pendingContinuations.filter(
    (entry) => entry.status === "ready_to_resume",
  );
  const pendingOperationalIdentityContinuationsOAuth = pendingContinuations.filter(
    (entry) => entry.status === "pending_oauth",
  );
  const pendingOperationalIdentityContinuationsBinding = pendingContinuations.filter(
    (entry) => entry.status === "pending_binding",
  );
  return {
    authPanel: props.authPanel,
    chatContent: props.chatContent,
    chatComposer: props.chatComposer,
    progressStrip: resolveConversationProgressStrip(props),
    activeSessionKey: props.activeSessionKey,
    pendingOperationalIdentityBindingRequests,
    pendingOperationalIdentityContinuationsReady,
    pendingOperationalIdentityContinuationsOAuth,
    pendingOperationalIdentityContinuationsBinding,
    onOpenOperationalIdentityBindingFlow:
      props.onOpenUserOperationalIdentityBindingFlow ?? undefined,
    onResumeOperationalIdentityContinuation:
      props.onResumeUserOperationalIdentityContinuation ?? undefined,
    onCompleteOperationalIdentityOAuthForContinuation:
      props.onCompleteUserOperationalIdentityOAuthForContinuation ?? undefined,
    onOpenPersonalEmailBrowserGuideFromChat:
      props.onOpenPersonalEmailBrowserGuideFromChat ?? undefined,
  };
}

export function buildWorkbenchStageModuleContract(
  props: StagePropsSource,
  _model: unknown,
  surfaces?: {
    collaboration?: WorkbenchProactiveCollaborationSurface;
    daibai?: unknown;
    knowledge?: WorkbenchFutureKnowledgeSurface;
  },
): WorkbenchStageModuleContract {
  const changeGroupProfileView = props.onGroupProfileViewChange ?? null;
  return {
    collaboration: {
      activeSessionKey: props.activeSessionKey,
      groupMembers: props.groupMembers ?? [],
      ownedAgents: props.ownedAgents ?? [],
      pendingBotApprovalCount: props.pendingBotApprovalCount ?? 0,
      memberGovernanceDrawerOpen: props.memberGovernanceDrawerOpen ?? false,
      artifactPreviewOpen: props.artifactPreviewOpen ?? false,
      onOpenAssistantSettings: props.onOpenAssistantSettings ?? (() => undefined),
      onOpenMemberGovernance: () => {
        if (props.onOpenCollaborationMemberGovernance) {
          props.onOpenCollaborationMemberGovernance();
          return;
        }
        changeGroupProfileView?.("members");
      },
      onOpenFilePreview: props.onOpenFilePreview ?? (() => undefined),
      onClosePreview: () => {
        if (props.onCloseCollaborationMemberGovernance) {
          props.onCloseCollaborationMemberGovernance();
          return;
        }
        changeGroupProfileView?.("chat");
      },
      onComposeFromPreview: (prompt: string) => {
        changeGroupProfileView?.("chat");
        props.onPrefillChatDraft?.(prompt);
      },
      memberGovernance: props.collaborationMemberGovernance ?? null,
      onMemberGovernancePromptChange: props.onMemberGovernancePromptChange ?? (() => undefined),
      onMemberGovernanceParse: props.onMemberGovernanceParse ?? (() => undefined),
      onMemberGovernanceOpenSelector: props.onMemberGovernanceOpenSelector ?? (() => undefined),
      onMemberGovernanceSearchChange: props.onMemberGovernanceSearchChange ?? (() => undefined),
      onMemberGovernanceToggleHumanSelection:
        props.onMemberGovernanceToggleHumanSelection ?? (() => undefined),
      onMemberGovernanceToggleBotSelection:
        props.onMemberGovernanceToggleBotSelection ?? (() => undefined),
      onMemberGovernanceCommitSelection:
        props.onMemberGovernanceCommitSelection ?? (() => undefined),
      onMemberGovernanceInviteHuman: props.onMemberGovernanceInviteHuman ?? (() => undefined),
      onMemberGovernanceInviteBot: props.onMemberGovernanceInviteBot ?? (() => undefined),
      onMemberGovernanceCancelInvite: props.onMemberGovernanceCancelInvite ?? (() => undefined),
      onMemberGovernanceRemoveMember: props.onMemberGovernanceRemoveMember ?? (() => undefined),
      onMemberGovernanceApproveBotInvite:
        props.onMemberGovernanceApproveBotInvite ?? (() => undefined),
      onMemberGovernanceRejectBotInvite:
        props.onMemberGovernanceRejectBotInvite ?? (() => undefined),
      onMemberGovernanceAcceptSelfInvite:
        props.onMemberGovernanceAcceptSelfInvite ?? (() => undefined),
      onMemberGovernanceRejectSelfInvite:
        props.onMemberGovernanceRejectSelfInvite ?? (() => undefined),
      onMemberGovernanceReset: props.onMemberGovernanceReset ?? (() => undefined),
      onLeaveCollaborationGroup: props.onLeaveSystemSettingsGroup ?? (() => undefined),
      // Collaboration stage reuses the system-settings ownership transfer handler.
      onTransferCollaborationGroupOwnershipToHuman:
        props.onTransferSystemSettingsGroupOwnership ??
        props.onTransferCollaborationGroupOwnershipToHuman ??
        (() => undefined),
      collaborationRoundPlan: props.collaborationRoundPlan ?? null,
      collaborationSpeakingAgentId: props.collaborationSpeakingAgentId ?? null,
      collaborationRulesSummary: props.collaborationRulesSummary ?? [],
      collaborationRulesSections: props.collaborationRulesSections ?? [],
      collaborationReasonDrawerOpen: props.collaborationReasonDrawerOpen ?? false,
      collaborationRulesDrawerOpen: props.collaborationRulesDrawerOpen ?? false,
      onOpenCollaborationReasonDrawer: props.onOpenCollaborationReasonDrawer ?? (() => undefined),
      onCloseCollaborationReasonDrawer: props.onCloseCollaborationReasonDrawer ?? (() => undefined),
      onOpenCollaborationRulesDrawer: props.onOpenCollaborationRulesDrawer ?? (() => undefined),
      onCloseCollaborationRulesDrawer: props.onCloseCollaborationRulesDrawer ?? (() => undefined),
      collaborationOptionalSuggestions: props.collaborationOptionalSuggestions ?? [],
      collaborationMissionAdvanceBusy: Boolean(props.collaborationMissionAdvanceBusy),
      collaborationMissionAdvanceNotice: props.collaborationMissionAdvanceNotice ?? null,
      collaborationMissionAdvanceError: props.collaborationMissionAdvanceError ?? null,
      onAdvanceCollaborationMission: props.onAdvanceCollaborationMission ?? (() => undefined),
      onDismissCollaborationOptionalSuggestion:
        props.onDismissCollaborationOptionalSuggestion ?? (() => undefined),
    },
    daibai:
      (surfaces?.daibai && typeof surfaces.daibai === "object" ? surfaces.daibai : props) ?? {},
    knowledge: surfaces?.knowledge ?? null,
    settings: {
      view: props.settingsView ?? "system",
      userProfileName: props.userProfileName?.trim() || "OpenBot",
      userProfileSignature: props.userProfileSignature ?? "",
      tenantLabel: props.tenantLabel ?? "",
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
      memoryCenterPanel: props.memoryCenterPanel ?? null,
      authorizationFullDiskAccessGranted: props.authorizationFullDiskAccessGranted ?? null,
      authorizationAccessibilityGranted: props.authorizationAccessibilityGranted ?? null,
      authorizationAutomationGranted: props.authorizationAutomationGranted ?? null,
      authorizationNotificationsGranted: props.authorizationNotificationsGranted ?? null,
      authorizationHostConnected: Boolean(props.authorizationHostConnected),
      authorizationAppleDesktop: Boolean(props.authorizationAppleDesktop),
      systemAuthorizationNotice: props.systemAuthorizationNotice ?? null,
      systemAuthorizationError: props.systemAuthorizationError ?? null,
      devicePairingList: props.devicePairingList ?? null,
      devicePairingLoading: Boolean(props.devicePairingLoading),
      devicePairingError: props.devicePairingError ?? null,
      devicePairingCurrentDeviceId: props.devicePairingCurrentDeviceId ?? null,
      devicePairingConnectedAtMs: props.devicePairingConnectedAtMs ?? null,
      cronProps: props.cronProps,
      supervisorProps: props.supervisorProps ?? null,
      client: props.client ?? null,
      workspaceSelector: props.workspaceSelector ?? null,
      workspaceNotice: props.workspaceNotice ?? null,
      systemTab: props.systemSettingsTab ?? DEFAULT_WORKBENCH_SYSTEM_SETTINGS_TAB,
      personalTab: props.personalSettingsTab ?? "account",
      authorizationIdentityTab: props.authorizationIdentityTab ?? "personal",
      tasksSubTab: props.tasksSubTab ?? "cron",
      assignedTasksProps: props.assignedTasksProps ?? null,
      myTasksLaneCounts: props.myTasksLaneCounts ?? null,
      myAccumulationProps: props.myAccumulationProps ?? null,
      skillSaveModalOpen: Boolean(props.skillSaveModalOpen),
      skillSaveModalBusy: Boolean(props.skillSaveModalBusy),
      skillSaveModalError: props.skillSaveModalError ?? null,
      skillSaveModalFormData: props.skillSaveModalFormData ?? null,
      skillExtractedPreview: props.skillExtractedPreview ?? null,
      skillAvailableGroups: props.skillAvailableGroups ?? [],
      skillSaveModalPreferEnterpriseSubmit: Boolean(props.skillSaveModalPreferEnterpriseSubmit),
      skillSaveModalShowEnterpriseSubmitAction: Boolean(
        props.skillSaveModalShowEnterpriseSubmitAction,
      ),
      onSkillSaveFormChange: props.onSkillSaveFormChange ?? (() => undefined),
      onSubmitSkillSave: props.onSubmitSkillSave ?? (() => undefined),
      onSubmitSkillSaveAndContinue: props.onSubmitSkillSaveAndContinue ?? (() => undefined),
      onCloseSkillSave: props.onCloseSkillSave ?? (() => undefined),
      recentAccessEntries: props.recentAccessEntries ?? [],
      robotRosterStatus: props.robotRosterStatus,
      robotEntries: props.robotEntries ?? [],
      groupEntries: props.groupEntries ?? [],
      myBotDetail: props.myBotDetail ?? null,
      collaborationGroupProjection: props.collaborationGroupProjection ?? null,
      collaborationGroupProjectionLoading: Boolean(props.collaborationGroupProjectionLoading),
      selectedGroupKey: props.selectedGroupKey ?? null,
      selectedGroupEntry: props.selectedGroupEntry ?? null,
      selectedGroupDraft: props.selectedGroupDraft ?? null,
      systemGroupSaving: Boolean(props.systemGroupSaving),
      systemGroupError: props.systemGroupError ?? null,
      systemGroupNotice: props.systemGroupNotice ?? null,
      systemSettingsPendingGroupId: props.systemSettingsPendingGroupId ?? null,
      chatFocusMode: Boolean(props.chatFocusMode),
      chatShowThinking: props.chatShowThinking !== false,
      platformAuthEnabled: Boolean(props.platformAuthEnabled),
      passwordChangeBusy: Boolean(props.passwordChangeBusy),
      passwordChangeError: props.passwordChangeError ?? null,
      passwordChangeNotice: props.passwordChangeNotice ?? null,
      pendingSeatOfferBusy: Boolean(props.pendingSeatOfferBusy),
      pendingSeatOfferError: props.pendingSeatOfferError ?? null,
      pendingSeatOfferNotice: props.pendingSeatOfferNotice ?? null,
      passwordCurrentValue: props.passwordCurrentValue ?? "",
      passwordNewValue: props.passwordNewValue ?? "",
      currentLocale: props.currentLocale === "en" ? "en" : "zh-CN",
      currentTheme:
        props.currentTheme === "dark" || props.currentTheme === "system"
          ? props.currentTheme
          : "light",
      connected: Boolean(props.connected),
      onLocaleChange: props.onLocaleChange ?? (() => undefined),
      onThemeChange: props.onThemeChange ?? (() => undefined),
      onUserProfileNameChange: props.onUserProfileNameChange ?? (() => undefined),
      onUserProfileSignatureChange: props.onUserProfileSignatureChange ?? (() => undefined),
      onDefaultWorkspaceRootDraftChange:
        props.onDefaultWorkspaceRootDraftChange ?? (() => undefined),
      onSaveDefaultWorkspaceRoot: props.onSaveDefaultWorkspaceRoot ?? (() => undefined),
      onOpenWorkspaceSelector: props.onOpenWorkspaceSelector ?? (() => undefined),
      onCloseWorkspaceSelector: props.onCloseWorkspaceSelector ?? (() => undefined),
      onChooseWorkspaceSelector: props.onChooseWorkspaceSelector ?? (() => undefined),
      onBrowseWorkspaceSelector: props.onBrowseWorkspaceSelector ?? (() => undefined),
      onWorkspaceSelectorPathDraftChange:
        props.onWorkspaceSelectorPathDraftChange ?? (() => undefined),
      onUseCurrentWorkspaceSelectorDirectory:
        props.onUseCurrentWorkspaceSelectorDirectory ?? (() => undefined),
      onNavigateWorkspaceSelector: props.onNavigateWorkspaceSelector ?? (() => undefined),
      onSelectWorkspaceSelectorPath: props.onSelectWorkspaceSelectorPath ?? (() => undefined),
      onApplyWorkspaceSelector: props.onApplyWorkspaceSelector ?? (() => undefined),
      onOpenSystemAuthorization: props.onOpenSystemAuthorization ?? (() => undefined),
      onRefreshMyDevices: props.onRefreshMyDevices ?? (() => undefined),
      onRemoveMyDevice: props.onRemoveMyDevice ?? (() => undefined),
      onApproveMyDevicePairing: props.onApproveMyDevicePairing ?? (() => undefined),
      onRejectMyDevicePairing: props.onRejectMyDevicePairing ?? (() => undefined),
      onRemoveMyDevices: props.onRemoveMyDevices ?? (() => undefined),
      onWorkspaceSelectorCloudProviderChange:
        props.onWorkspaceSelectorCloudProviderChange ?? (() => undefined),
      onWorkspaceSelectorCloudRegionChange:
        props.onWorkspaceSelectorCloudRegionChange ?? (() => undefined),
      onWorkspaceSelectorCloudBucketChange:
        props.onWorkspaceSelectorCloudBucketChange ?? (() => undefined),
      onWorkspaceSelectorCloudRootPrefixChange:
        props.onWorkspaceSelectorCloudRootPrefixChange ?? (() => undefined),
      onWorkspaceSelectorCloudEndpointChange:
        props.onWorkspaceSelectorCloudEndpointChange ?? (() => undefined),
      onWorkspaceSelectorCloudAccountNameChange:
        props.onWorkspaceSelectorCloudAccountNameChange ?? (() => undefined),
      onGenerateWorkspaceSelectorCloudConfig:
        props.onGenerateWorkspaceSelectorCloudConfig ?? (() => undefined),
      onTestWorkspaceSelectorCloudConnection:
        props.onTestWorkspaceSelectorCloudConnection ?? (() => undefined),
      onChatFocusModeChange: props.onChatFocusModeChange ?? (() => undefined),
      onChatShowThinkingChange: props.onChatShowThinkingChange ?? (() => undefined),
      onPasswordCurrentChange: props.onPasswordCurrentChange ?? (() => undefined),
      onPasswordNewChange: props.onPasswordNewChange ?? (() => undefined),
      onChangePassword: props.onChangePassword ?? (() => undefined),
      onOpenForgotPassword: props.onOpenForgotPassword ?? (() => undefined),
      onAcceptPendingSeatOffer: props.onAcceptPendingSeatOffer ?? (() => undefined),
      onDeclinePendingSeatOffer: props.onDeclinePendingSeatOffer ?? (() => undefined),
      onSystemTabChange: props.onSystemSettingsTabChange ?? (() => undefined),
      onPersonalTabChange: props.onPersonalSettingsTabChange ?? (() => undefined),
      onRevealDataDirectoryInFinder: props.onRevealDataDirectoryInFinder ?? (() => undefined),
      onOpenDataMigrationWizard: props.onOpenDataMigrationWizard ?? (() => undefined),
      onCloseDataMigrationWizard: props.onCloseDataMigrationWizard ?? (() => undefined),
      onDataMigrationTargetDraftChange: props.onDataMigrationTargetDraftChange ?? (() => undefined),
      onChooseDataMigrationTarget: props.onChooseDataMigrationTarget ?? (() => undefined),
      onStartDataMigration: props.onStartDataMigration ?? (() => undefined),
      onExportOpenBotData: props.onExportOpenBotData ?? (() => undefined),
      onForgetMemoryAgentIdChange: props.onForgetMemoryAgentIdChange ?? (() => undefined),
      onForgetMemoryKeyChange: props.onForgetMemoryKeyChange ?? (() => undefined),
      onForgetMemoryEntry: props.onForgetMemoryEntry ?? (() => undefined),
      onMemoryCenterAgentIdChange: props.onMemoryCenterAgentIdChange ?? (() => undefined),
      onMemoryCenterKeyChange: props.onMemoryCenterKeyChange ?? (() => undefined),
      onMemoryCenterAtomIdChange: props.onMemoryCenterAtomIdChange ?? (() => undefined),
      onMemoryCenterForget: props.onMemoryCenterForget ?? (() => undefined),
      onMemoryCenterStatusViewChange: props.onMemoryCenterStatusViewChange ?? (() => undefined),
      onRevokeAccessGrant: props.onRevokeAccessGrant ?? (() => undefined),
      onTasksSubTabChange: props.onTasksSubTabChange ?? (() => undefined),
      onSystemSettingsGroupSelect: props.onSystemSettingsGroupSelect ?? (() => undefined),
      onSystemSettingsGroupDraftChange: props.onSystemSettingsGroupDraftChange ?? (() => undefined),
      onSaveSystemSettingsGroup: props.onSaveSystemSettingsGroup ?? (() => undefined),
      onResetSystemSettingsGroup: props.onResetSystemSettingsGroup ?? (() => undefined),
      onDissolveSystemSettingsGroup: props.onDissolveSystemSettingsGroup ?? (() => undefined),
      onLeaveSystemSettingsGroup: props.onLeaveSystemSettingsGroup ?? (() => undefined),
      onTransferSystemSettingsGroupOwnership:
        props.onTransferSystemSettingsGroupOwnership ?? (() => undefined),
      onOpenSystemSettingsGroupMembers: props.onOpenSystemSettingsGroupMembers ?? (() => undefined),
      onExportSystemSettingsGroupSummary:
        props.onExportSystemSettingsGroupSummary ?? (() => undefined),
      onResolveSystemSettingsGroupSwitch:
        props.onResolveSystemSettingsGroupSwitch ?? (() => undefined),
      onSelectSession: props.onSelectSession ?? (() => undefined),
      onOpenInstallCapability: props.onOpenInstallCapability ?? (() => undefined),
      onOpenMyAssets: props.onOpenMyAssets ?? (() => undefined),
      onOpenMyBotDetail: props.onOpenMyBotDetail ?? (() => undefined),
      onCloseMyBotDetail: props.onCloseMyBotDetail ?? (() => undefined),
      onMyBotDetailTabChange: props.onMyBotDetailTabChange ?? (() => undefined),
      onMyBotIdentityDraftChange: props.onMyBotIdentityDraftChange ?? (() => undefined),
      onSaveMyBotIdentity: props.onSaveMyBotIdentity ?? (() => undefined),
      onMyBotOpenGroup: props.onMyBotOpenGroup ?? (() => undefined),
      onDeleteOwnedRobot: props.onDeleteOwnedRobot ?? (() => undefined),
      ownedRobotDeletePrompt: props.ownedRobotDeletePrompt ?? null,
      ownedRobotDeleteDisposition: props.ownedRobotDeleteDisposition ?? "delete_all",
      onOpenOwnedRobotDeletePrompt: props.onOpenOwnedRobotDeletePrompt ?? (() => undefined),
      onOwnedRobotDeleteDispositionChange:
        props.onOwnedRobotDeleteDispositionChange ?? (() => undefined),
      onCancelOwnedRobotDelete: props.onCancelOwnedRobotDelete ?? (() => undefined),
      onConfirmOwnedRobotDelete: props.onConfirmOwnedRobotDelete ?? (() => undefined),
      ownedRobotDeleteBusyId: props.ownedRobotDeleteBusyId ?? null,
      ownedRobotDeleteError: props.ownedRobotDeleteError ?? null,
      onLogout: props.onLogout ?? (() => undefined),
      userOperationalIdentitySnapshot: props.userOperationalIdentitySnapshot ?? null,
      userOperationalIdentityBusy: Boolean(props.userOperationalIdentityBusy),
      userOperationalIdentityError: props.userOperationalIdentityError ?? null,
      userOperationalIdentityNotice: props.userOperationalIdentityNotice ?? null,
      userOperationalIdentityNav: props.userOperationalIdentityNav ?? "bound",
      userOperationalIdentityUsageRange: props.userOperationalIdentityUsageRange ?? "30d",
      userOperationalIdentityUsageEventId: props.userOperationalIdentityUsageEventId ?? null,
      onUserOperationalIdentityUsageRangeChange:
        props.onUserOperationalIdentityUsageRangeChange ?? (() => undefined),
      onSelectUserOperationalIdentityUsageEvent:
        props.onSelectUserOperationalIdentityUsageEvent ?? (() => undefined),
      userOperationalIdentityEditorOpen: Boolean(props.userOperationalIdentityEditorOpen),
      userOperationalIdentityEditorProvider: props.userOperationalIdentityEditorProvider ?? "",
      userOperationalIdentityEditorDisplayName:
        props.userOperationalIdentityEditorDisplayName ?? "",
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
      userOperationalIdentityEditorIdentityId:
        props.userOperationalIdentityEditorIdentityId ?? null,
      wechatPersonalQrWorkerOnline: props.wechatPersonalQrWorkerOnline ?? null,
      wechatPersonalQrStatus: props.wechatPersonalQrStatus ?? "idle",
      wechatPersonalQrDataUrl: props.wechatPersonalQrDataUrl ?? null,
      wechatPersonalQrMessage: props.wechatPersonalQrMessage ?? null,
      wechatPersonalQrWxid: props.wechatPersonalQrWxid ?? null,
      ownedAgents: props.ownedAgents ?? [],
      userOperationalIdentityEditorGrantAgentId:
        props.userOperationalIdentityEditorGrantAgentId ?? "",
      userOperationalIdentityReturnSessionKey:
        props.userOperationalIdentityReturnSessionKey ?? null,
      userOperationalIdentityContinuationNotice:
        props.userOperationalIdentityContinuationNotice ?? null,
      onRefreshUserOperationalIdentities:
        props.onRefreshUserOperationalIdentities ?? (() => undefined),
      onOpenUserOperationalIdentityEditor:
        props.onOpenUserOperationalIdentityEditor ?? (() => undefined),
      onUserOperationalIdentityNavChange:
        props.onUserOperationalIdentityNavChange ?? (() => undefined),
      onCloseUserOperationalIdentityEditor:
        props.onCloseUserOperationalIdentityEditor ?? (() => undefined),
      onSubmitUserOperationalIdentityEditor:
        props.onSubmitUserOperationalIdentityEditor ?? (() => undefined),
      onStartWechatPersonalQr: props.onStartWechatPersonalQr ?? (() => undefined),
      onRecheckWechatPersonalChannel: props.onRecheckWechatPersonalChannel ?? (() => undefined),
      onUserOperationalIdentityEditorGrantAgentIdChange:
        props.onUserOperationalIdentityEditorGrantAgentIdChange ?? (() => undefined),
      onVerifyUserOperationalIdentityCredentials:
        props.onVerifyUserOperationalIdentityCredentials ?? (() => undefined),
      onCompleteUserOperationalIdentityOAuthForContinuation:
        props.onCompleteUserOperationalIdentityOAuthForContinuation ?? (() => undefined),
      onUserOperationalIdentityEditorProviderChange:
        props.onUserOperationalIdentityEditorProviderChange ?? (() => undefined),
      onUserOperationalIdentityEditorDisplayNameChange:
        props.onUserOperationalIdentityEditorDisplayNameChange ?? (() => undefined),
      onUserOperationalIdentityEditorCredentialHandleIdChange:
        props.onUserOperationalIdentityEditorCredentialHandleIdChange ?? (() => undefined),
      onUserOperationalIdentityEditorAppIdChange:
        props.onUserOperationalIdentityEditorAppIdChange ?? (() => undefined),
      onUserOperationalIdentityEditorAppSecretChange:
        props.onUserOperationalIdentityEditorAppSecretChange ?? (() => undefined),
      onUserOperationalIdentityEditorSmtpHostChange:
        props.onUserOperationalIdentityEditorSmtpHostChange ?? (() => undefined),
      onUserOperationalIdentityEditorSmtpPortChange:
        props.onUserOperationalIdentityEditorSmtpPortChange ?? (() => undefined),
      onUserOperationalIdentityEditorSmtpUserChange:
        props.onUserOperationalIdentityEditorSmtpUserChange ?? (() => undefined),
      onUserOperationalIdentityEditorImapHostChange:
        props.onUserOperationalIdentityEditorImapHostChange ?? (() => undefined),
      onUserOperationalIdentityEditorImapPortChange:
        props.onUserOperationalIdentityEditorImapPortChange ?? (() => undefined),
      onUserOperationalIdentityEditorImapUserChange:
        props.onUserOperationalIdentityEditorImapUserChange ?? (() => undefined),
      onUserOperationalIdentityEditorUsePlatformSmtpChange:
        props.onUserOperationalIdentityEditorUsePlatformSmtpChange ?? (() => undefined),
      onOpenPersonalEmailWebmail: props.onOpenPersonalEmailWebmail ?? (() => undefined),
      onOpenPersonalEmailAuthCodeSettings:
        props.onOpenPersonalEmailAuthCodeSettings ?? (() => undefined),
      onRevokeUserOperationalIdentity: props.onRevokeUserOperationalIdentity ?? (() => undefined),
      onReauthorizeUserOperationalIdentity:
        props.onReauthorizeUserOperationalIdentity ?? (() => undefined),
      onCompleteUserOperationalIdentityBindingRequest:
        props.onCompleteUserOperationalIdentityBindingRequest ?? (() => undefined),
      onConfirmUserOperationalIdentityGrant:
        props.onConfirmUserOperationalIdentityGrant ?? (() => undefined),
      onRevokeUserOperationalIdentityGrant:
        props.onRevokeUserOperationalIdentityGrant ?? (() => undefined),
      onLoadRobotEnterpriseIdentities: props.onLoadRobotEnterpriseIdentities ?? (() => undefined),
      onApplyRobotIdentityGrants: props.onApplyRobotIdentityGrants ?? (() => undefined),
      onApplyIdentityRobotGrants: props.onApplyIdentityRobotGrants ?? (() => undefined),
      onApplyRobotEnterpriseIdentities: props.onApplyRobotEnterpriseIdentities ?? (() => undefined),
      onApplyEnterpriseIdentityRobots: props.onApplyEnterpriseIdentityRobots ?? (() => undefined),
      onSyncEnterpriseOperationalIdentities:
        props.onSyncEnterpriseOperationalIdentities ?? (() => undefined),
      onOpenUserOperationalIdentityBindingFlow:
        props.onOpenUserOperationalIdentityBindingFlow ?? (() => undefined),
      onOpenPersonalOperationalIdentity:
        props.onOpenPersonalOperationalIdentity ?? (() => undefined),
      robotIdentityGrantFocusAgentId: props.robotIdentityGrantFocusAgentId ?? null,
      enterpriseIdentityBindingFocusAgentId: props.enterpriseIdentityBindingFocusAgentId ?? null,
      onReturnToRobotIdentityGrant: props.onReturnToRobotIdentityGrant ?? (() => undefined),
      onRobotIdentityGrantFocusHandled: props.onRobotIdentityGrantFocusHandled ?? (() => undefined),
      onResumeUserOperationalIdentityContinuation:
        props.onResumeUserOperationalIdentityContinuation ?? (() => undefined),
    },
    signals: props.signals ?? null,
  };
}
