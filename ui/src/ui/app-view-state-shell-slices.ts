import type { GatewayCollaborationLearningSnapshot } from "../../../src/gateway/collaboration-learning.js";
import type { RuntimeKpiData } from "./capability/agent-runtime/index.ts";
import type { CapabilityGovernanceSnapshot } from "./capability/capability-governance/types.ts";
import type {
  RuntimeAgent,
  RuntimeCapabilityBinding,
  RuntimeGovernanceIssue,
  RuntimeTelemetry,
} from "./capability/runtime-canonical/index.ts";
import type { ConversationRecordView } from "./controllers/conversations.ts";
import type { CronModelSuggestionsState, CronState } from "./controllers/cron.ts";
import type { DevicePairingList } from "./controllers/devices.ts";
import type { ExecApprovalRequest } from "./controllers/exec-approval.ts";
import type { ExecApprovalsFile, ExecApprovalsSnapshot } from "./controllers/exec-approvals.ts";
import type { FocusSwitchGateView } from "./controllers/focus-switch-gate.ts";
import type { LocalFileApprovalRequest } from "./controllers/local-file-approval.ts";
import type { PlatformEmployeeProvisionInput } from "./controllers/platform-auth.ts";
import type {
  ExtractedSkillPreview,
  QuickSaveSkillFormData,
} from "./controllers/skill-lifecycle.ts";
import type { SkillMessage } from "./controllers/skills.ts";
import type { Tab } from "./navigation.ts";
import type {
  GroupProfileView,
  WorkbenchCollaborationMemberGovernanceCandidate,
  WorkbenchCollaborationMemberGovernanceRosterEntry,
  WorkbenchCollaborationPendingBotInvite,
  WorkbenchCollaborationPendingHumanInvite,
  WorkbenchGovernanceObjectKind,
  WorkbenchPrimaryModule,
  WorkbenchRobotWorkbenchTab,
  WorkbenchSecuritySettingsTab,
  WorkbenchSettingsGroupDraft,
  WorkbenchSettingsView,
  WorkbenchTasksSubTab,
  WorkbenchMyBotDetailTab,
  WorkbenchPersonalSettingsTab,
  WorkbenchAuthorizationIdentityTab,
  WorkbenchSystemSettingsTab,
  WorkbenchWorkspaceSelectorMode,
} from "./ports/employee/views/workbench-types.ts";
import type { UiSettings } from "./storage.ts";
import type { ThemeTransitionContext } from "./theme-transition.ts";
import type { ThemeMode } from "./theme.ts";
import type {
  AgentsFilesListResult,
  AgentsListResult,
  AgentIdentityResult,
  ArtifactWorkspaceSidebar,
  CollaborationSpacesListResult,
  CostUsageSummary,
  HealthSnapshot,
  LogEntry,
  LogLevel,
  MeshOwnershipListResult,
  NostrProfile,
  PresenceEntry,
  SessionsUsageResult,
  SessionUsageTimeSeries,
  SkillStatusReport,
  StatusSummary,
  ToolsCatalogResult,
  WorkspaceDirectoryEntry,
  WorkspaceCloudGeneratedConfig,
} from "./types.ts";
import type { SessionLogEntry } from "./views/usage.ts";

export type AppViewWorkbenchState = {
  workbenchTeamSelectedKey: string;
  workbenchPrimaryModule: WorkbenchPrimaryModule;
  workbenchSettingsView: WorkbenchSettingsView;
  workbenchSystemSettingsTab: WorkbenchSystemSettingsTab;
  workbenchPersonalSettingsTab: WorkbenchPersonalSettingsTab;
  workbenchPersonalAuthorizationIdentityTab: WorkbenchAuthorizationIdentityTab;
  workbenchTasksSubTab: WorkbenchTasksSubTab;
  /** Employee shell header profile menu open state. */
  workbenchHeaderProfileMenuOpen?: boolean;
  workbenchSecuritySettingsTab?: WorkbenchSecuritySettingsTab;
  workbenchSystemSettingsSelectedGroupId?: string | null;
  /** Phase 3：协作小组四块投影（含成员贡献度） */
  workbenchCollaborationGroupProjection?:
    | import("./ports/employee/semantic/collaboration-group-read-model.ts").CollaborationGroupProjection
    | null;
  workbenchCollaborationGroupProjectionLoading?: boolean;
  /** 我的机器人主从详情当前 agentId（原六块抽屉已退役为页内右栏） */
  workbenchMyBotDetailAgentId?: string | null;
  workbenchMyBotDetailTab?: WorkbenchMyBotDetailTab;
  workbenchMyBotProjection?:
    | import("./ports/employee/semantic/my-bot-read-model.ts").MyBotProjection
    | null;
  workbenchMyBotDetailLoading?: boolean;
  workbenchMyBotDetailSaving?: boolean;
  workbenchMyBotDetailError?: string | null;
  workbenchCapsuleDetailId: string | null;
  workbenchMyBotIdentityDraft?: {
    name: string;
    positioning: string;
    role: string;
    personaTraits: string;
    model: string;
  } | null;
  workbenchSystemSettingsGroupDraft?: WorkbenchSettingsGroupDraft | null;
  workbenchSystemSettingsGroupSaving?: boolean;
  workbenchSystemSettingsGroupError?: string | null;
  workbenchSystemSettingsGroupNotice?: string | null;
  workbenchRobotWorkbenchTab: WorkbenchRobotWorkbenchTab;
  /** Conversation Catalog panel state (CL-P1-03). */
  workbenchConversationsLoading?: boolean;
  /** Active ConversationTask Progress Ledger projection for the open chat. */
  conversationTaskProgress?: import("../../../src/progress-ledger/types.ts").ProgressView | null;
  workbenchConversationsError?: string | null;
  workbenchConversationsBusy?: boolean;
  workbenchConversationsAgentId?: string | null;
  workbenchConversationsGroupId?: string | null;
  workbenchConversationsRows?: ConversationRecordView[];
  workbenchConversationsShowArchived?: boolean;
  workbenchConversationsPanelOpen?: boolean;
  workbenchConversationsNextCursor?: string | null;
  workbenchConversationsHasMore?: boolean;
  workbenchConversationsSwitchGeneration?: number;
  workbenchActiveConversationId?: string | null;
  workbenchConversationReadOnly?: boolean;
  workbenchGroupProfileView: GroupProfileView;
  workbenchTaskDetailId: string | null;
  workbenchCronFocusJobId: string | null;
  workbenchSupervisorInitialTaskId: string | null;
  chatFocusSwitchGate?: FocusSwitchGateView | null;
  workbenchDeliverableDetailId: string | null;
  workbenchReviewDetailId: string | null;
  workbenchDecisionDetailId: string | null;
  workbenchDecisionSelectedOptionDraft: string | null;
  workbenchDecisionRationaleDraft: string | null;
  workbenchDecisionOptionsDraft: Array<{ optionId: string; title: string }> | null;
  workbenchMemberGovernanceGroupKey?: string | null;
  workbenchMemberGovernanceTitle?: string;
  workbenchMemberGovernancePrompt?: string;
  workbenchMemberGovernanceBusy?: boolean;
  workbenchMemberGovernanceInvitingHumanId?: string | null;
  workbenchMemberGovernanceInvitingBotId?: string | null;
  workbenchMemberGovernanceError?: string | null;
  workbenchMemberGovernanceResult?: string | null;
  workbenchPendingGroupConfigProposal?: {
    groupId: string;
    fingerprint: string;
    summaryLines: string[];
    proposal: import("./ports/employee/group-config-proposal.ts").GroupConfigProposal;
    sourceSessionKey: string | null;
  } | null;
  workbenchGroupConfigProposalDismissedFingerprint?: string | null;
  workbenchGroupConfigProposalBusy?: boolean;
  workbenchGroupConfigProposalError?: string | null;
  workbenchGroupConfigProposalNotice?: string | null;
  workbenchMemberGovernanceCurrentHumans?: WorkbenchCollaborationMemberGovernanceRosterEntry[];
  workbenchMemberGovernanceCurrentBots?: WorkbenchCollaborationMemberGovernanceRosterEntry[];
  workbenchMemberGovernancePendingInvites?: WorkbenchCollaborationPendingHumanInvite[];
  workbenchMemberGovernancePendingBotInvites?: WorkbenchCollaborationPendingBotInvite[];
  workbenchMemberGovernanceCandidateHumans?: WorkbenchCollaborationMemberGovernanceCandidate[];
  workbenchMemberGovernanceCandidateBots?: WorkbenchCollaborationMemberGovernanceCandidate[];
  workbenchMemberGovernanceSelectorKind?: "human" | "bot" | null;
  workbenchMemberGovernanceSearch?: string;
  workbenchMemberGovernanceSelectedHumanIds?: string[];
  workbenchMemberGovernanceSelectedBotIds?: string[];
  workbenchCollaborationOrgBotDirectory?: import("./ports/employee/collaboration-org-bot-directory.ts").CollaborationOrgBotDirectoryEntry[];
  workbenchAgentCreatorOpen?: boolean;
  workbenchAgentCreatorBusy?: boolean;
  workbenchOwnedRobotEditDraft?: {
    agentId: string;
    name: string;
    emoji: string;
    theme: string;
  } | null;
  workbenchOwnedRobotEditBusy?: boolean;
  workbenchOwnedRobotEditError?: string | null;
  workbenchOwnedRobotDeleteBusyId?: string | null;
  workbenchOwnedRobotDeleteError?: string | null;
  workbenchOwnedRobotDeletePrompt?: { agentId: string; name: string } | null;
  workbenchOwnedRobotDeleteDisposition?:
    | "delete_all"
    | "keep_artifacts_conversations"
    | "soft_unbind";
  /** 从某个机器人行发起「安装能力」时记录的目标机器人，供资产页安装流程使用。 */
  workbenchInstallTargetRobotId?: string | null;
  /** 存在未保存修改时用户尝试切换到的目标小组 id；用于自绘「保存并切换/放弃/取消」确认。 */
  workbenchSystemSettingsPendingGroupId?: string | null;
  workbenchDataDirectoryLoading?: boolean;
  workbenchDataDirectoryError?: string | null;
  workbenchDataDirectoryMode?: "local" | "managed" | null;
  workbenchDataDirectoryDisplayRoot?: string | null;
  workbenchDataDirectoryVolumeName?: string | null;
  workbenchDataDirectoryUsedLabel?: string | null;
  workbenchDataMigrationOpen?: boolean;
  workbenchDataMigrationBusy?: boolean;
  workbenchDataMigrationMessage?: string | null;
  workbenchDataMigrationTargetDraft?: string;
  workbenchDataExportBusy?: boolean;
  workbenchDataExportPath?: string | null;
  workbenchDataAccessGrants?: Array<{
    id: string;
    agentId: string;
    resourceType: string;
    resourcePath: string;
    grantedAt: string;
  }>;
  workbenchDataAccessGrantsLoading?: boolean;
  workbenchForgetMemoryAgentId?: string;
  workbenchForgetMemoryKey?: string;
  workbenchForgetMemoryBusy?: boolean;
  workbenchForgetMemoryMessage?: string | null;
  workbenchForgetMemoryEntries?: Array<{ key: string; label: string; updatedAtMs: number }>;
  workbenchForgetMemoryEntriesLoading?: boolean;
  workbenchMemoryCenterMode?: "local" | "managed" | null;
  workbenchMemoryCenterLoading?: boolean;
  workbenchMemoryCenterError?: string | null;
  workbenchMemoryCenterAgentId?: string;
  workbenchMemoryCenterKey?: string;
  workbenchMemoryCenterAtomId?: string;
  workbenchMemoryCenterBusy?: boolean;
  workbenchMemoryCenterMessage?: string | null;
  workbenchMemoryCenterEntries?: Array<{
    key: string;
    label: string;
    bytes: number;
    updatedAtMs: number;
  }>;
  workbenchMemoryCenterAtoms?: Array<{
    id: string;
    summary: string;
    atomType: string;
    whyHint?: string;
    scope: {
      kind: "agent" | "space" | "group";
      visibility: "private" | "shared";
      agentId?: string;
      spaceId?: string;
      groupKey?: string;
    };
    botId: string;
    privacyLevel?: "private" | "shared" | "org" | "public";
    syncEligible: boolean;
    shared: boolean;
    status: string;
    updatedAtMs: number;
    confidence?: number;
  }>;
  workbenchMemoryCenterViewMode?: "files" | "atoms" | "mixed";
  workbenchMemoryCenterEntriesLoading?: boolean;
  workbenchAgentCreatorError?: string | null;
  workbenchAgentCreatorName?: string;
  workbenchAgentCreatorEmoji?: string;
  workbenchAgentCreatorStep?: import("./ports/employee/views/workbench-types.ts").WorkbenchAgentCreatorStep;
  workbenchAgentCreatorRoleSource?: import("./ports/employee/views/workbench-types.ts").WorkbenchAgentCreatorRoleSource;
  workbenchAgentCreatorDesign?:
    | import("./ports/employee/views/workbench-types.ts").WorkbenchAgentDesignState
    | null;
  workbenchAgentCreatorTemplateId?: string;
  workbenchAgentCreatorTemplates?: import("./controllers/agent-growth.ts").AgentTemplateListItemView[];
  workbenchAgentCreatorTemplatesLoading?: boolean;
  workbenchAgentCreatorWorkspaceKind?: "local" | "cloud";
  workbenchAgentCreatorLocalPath?: string;
  workbenchAgentCreatorLocalValidationState?: "idle" | "validating" | "valid" | "invalid";
  workbenchAgentCreatorLocalValidationMessage?: string | null;
  workbenchAgentCreatorLocalResolvedPath?: string | null;
  workbenchAgentCreatorLocalReadable?: boolean;
  workbenchAgentCreatorLocalWritable?: boolean;
  workbenchAgentCreatorLocalBrowserOpen?: boolean;
  workbenchAgentCreatorLocalBrowserBusy?: boolean;
  workbenchAgentCreatorLocalBrowserError?: string | null;
  workbenchAgentCreatorLocalBrowserCurrentPath?: string;
  workbenchAgentCreatorLocalBrowserParentPath?: string | null;
  workbenchAgentCreatorLocalBrowserEntries?: WorkspaceDirectoryEntry[];
  workbenchWorkspaceCloudProvider?:
    | "aliyun-oss"
    | "aws-s3"
    | "azure-blob"
    | "huawei-obs"
    | "s3-compatible";
  workbenchWorkspaceCloudRegion?: string;
  workbenchWorkspaceCloudBucket?: string;
  workbenchWorkspaceCloudRootPrefix?: string;
  workbenchWorkspaceCloudEndpoint?: string;
  workbenchWorkspaceCloudAccountName?: string;
  workbenchWorkspaceCloudAccessKeyId?: string;
  workbenchWorkspaceCloudSecretAccessKey?: string;
  workbenchWorkspaceCloudGeneratedConfig?: WorkspaceCloudGeneratedConfig | null;
  workbenchWorkspaceCloudConnectionState?: "idle" | "testing" | "success" | "error";
  workbenchWorkspaceCloudConnectionMessage?: string | null;
  workbenchWorkspaceCloudCanRead?: boolean;
  workbenchWorkspaceCloudCanWrite?: boolean;
  workbenchWorkspaceCloudBrowserOpen?: boolean;
  workbenchWorkspaceCloudBrowserBusy?: boolean;
  workbenchWorkspaceCloudBrowserError?: string | null;
  workbenchWorkspaceCloudBrowserCurrentPath?: string;
  workbenchWorkspaceCloudBrowserParentPath?: string | null;
  workbenchWorkspaceCloudBrowserEntries?: WorkspaceDirectoryEntry[];
  workbenchWorkspaceCloudSelectedPath?: string;
  workbenchDefaultWorkspaceRootDraft?: string | null;
  workbenchDefaultWorkspaceRootSaving?: boolean;
  workbenchDefaultWorkspaceRootError?: string | null;
  workbenchDefaultWorkspaceRootNotice?: string | null;
  workbenchSystemAuthorizationNotice?: string | null;
  workbenchSystemAuthorizationError?: string | null;
  workbenchWorkspaceSelectorOpen?: boolean;
  workbenchWorkspaceSelectorMode?: WorkbenchWorkspaceSelectorMode;
  workbenchWorkspaceSelectorTitle?: string;
  workbenchWorkspaceSelectorDescription?: string;
  workbenchWorkspaceSelectorSelectedPath?: string;
  workbenchWorkspaceSelectorTargetId?: string | null;
  workbenchWorkspaceSelectorTargetLabel?: string | null;
  workbenchWorkspaceSelectorLocalBrowserOpen?: boolean;
  workbenchWorkspaceSelectorLocalBrowserBusy?: boolean;
  workbenchWorkspaceSelectorLocalBrowserError?: string | null;
  workbenchWorkspaceSelectorLocalBrowserCurrentPath?: string;
  workbenchWorkspaceSelectorLocalBrowserParentPath?: string | null;
  workbenchWorkspaceSelectorLocalBrowserEntries?: WorkspaceDirectoryEntry[];
  workbenchSpaceCreatorOpen?: boolean;
  workbenchSpaceCreatorBusy?: boolean;
  workbenchSpaceCreatorError?: string | null;
  workbenchSpaceCreatorTitle?: string;
  workbenchSpaceCreatorAvatar?: string;
  workbenchSpaceCreatorPurpose?: string;
  workbenchSpaceCreatorCurrentMission?: string;
  workbenchSpaceCreatorSystemInstructions?: string;
  workbenchSpaceCreatorGroupId?: string;
  workbenchSpaceCreatorGroupIdTouched?: boolean;
  workbenchSpaceCreatorStep?: "details" | "members";
  workbenchSpaceCreatorSelectedHumanIds?: string[];
  workbenchSpaceCreatorSelectedBotIds?: string[];
  workbenchSpaceCreatorCoordinatorBotId?: string;
  workbenchSkillSaveModalOpen?: boolean;
  workbenchSkillSaveModalBusy?: boolean;
  workbenchSkillSaveModalError?: string | null;
  workbenchSkillSaveModalFormData?: QuickSaveSkillFormData | null;
  workbenchSkillSavePreferEnterpriseSubmit?: boolean;
  workbenchSkillExtractedPreview?: ExtractedSkillPreview | null;
  workbenchSkillSourceAgentId?: string | null;
  workbenchSkillSourceContextId?: string | null;
  workbenchAssetSuggestionVisible?: boolean;
  workbenchAssetSuggestionSource?:
    | "assistant-task-complete"
    | "group-task-complete"
    | "manual-iteration";
  workbenchAssetSuggestionLabel?: string | null;
  workbenchAssetIncubationLevel?:
    | import("./controllers/asset-incubation/types.ts").AssetIncubationLevel
    | null;
  workbenchAssetIncubationDecision?:
    | import("./controllers/asset-incubation/types.ts").AssetIncubationDecision
    | null;
  workbenchAssetWeakHintVisible?: boolean;
  workbenchPatternDetectionSubscribedScopes?: string[];
  workbenchSearchQuery: string;
  workbenchRemoteOpen: boolean;
  workbenchRemoteQuery: string;
  sidebarOpen: boolean;
  sidebarPreviewMode: "markdown" | "artifact";
  sidebarSurface: "artifact" | "computer";
  computerPreviewSize: "docked" | "expanded" | "fullscreen";
  computerNarrowChat: boolean;
  computerPreviewRevision: number;
  refreshAccountComputerPreview?: (action: "open" | "status" | "end") => Promise<void>;
  sidebarContent: string | null;
  sidebarError: string | null;
  sidebarArtifactWorkspace: ArtifactWorkspaceSidebar | null;
  sidebarDeliverableSaveState: import("./wiring/deliverable-save.ts").DeliverableSaveState | null;
  sidebarDeliverableSaveToast: import("./wiring/deliverable-save.ts").DeliverableSaveToast | null;
  workbenchBrandLogoError: string | null;
  workbenchActiveGrowthStatus: import("./controllers/agent-growth.ts").GrowthStatusView | null;
  workbenchGrowthBirthAwakening: boolean;
  workbenchGrowthBirthTurnSentKey: string | null;
  workbenchGrowthPreferCultivate: boolean;
  splitRatio: number;
  scrollToBottom: (opts?: { smooth?: boolean }) => void;
  collaborationSpacesLoading: boolean;
  collaborationSpacesResult: CollaborationSpacesListResult;
  collaborationSpacesError: string | null;
  collaborationLearningLoading: boolean;
  collaborationLearningError: string | null;
  collaborationLearningSnapshot: GatewayCollaborationLearningSnapshot | null;
  collaborationLearningRequestKey: string | null;
  collaborationObservabilityLoading: boolean;
  collaborationObservabilityError: string | null;
  collaborationObservabilitySnapshot:
    | import("./controllers/collaboration-observability.ts").CollaborationObservabilitySnapshot
    | null;
  collaborationObservabilityRequestKey: string | null;
  collaborationGovernanceActionBusyKey: string | null;
  collaborationGovernanceActionError: string | null;
  collaborationRoundPlan:
    | import("../../../src/gateway/collaboration-dispatch/types.js").CollaborationRoundPlanPayload
    | null;
  collaborationRoundPlanSessionKey: string | null;
  collaborationRoundSummaries: Record<string, string>;
  workbenchCollaborationReasonDrawerOpen: boolean;
  workbenchCollaborationRulesDrawerOpen: boolean;
  workbenchMemberGovernanceDrawerOpen: boolean;
  collaborationOptionalSuggestions: import("./controllers/collaboration-optional-suggestions.ts").CollaborationOptionalSuggestion[];
  collaborationMissionAdvanceBusy: boolean;
  collaborationMissionAdvanceNotice: string | null;
  collaborationMissionAdvanceError: string | null;
  knowledgeUniverseLoading: boolean;
  knowledgeUniverseError: string | null;
  knowledgeUniverseQuery: string;
  knowledgeUniversePageTab: import("./ports/employee/views/home-page-contracts.ts").KnowledgeUniversePageTab;
  knowledgeUniverseBrowseSubTab: import("./ports/employee/views/home-page-contracts.ts").KnowledgeUniverseBrowseSubTab;
  knowledgeUniversePersonalCollectDrawerOpen: boolean;
  knowledgeUniversePersonalDrawerMode: import("./ports/employee/views/home-page-contracts.ts").KnowledgeUniversePersonalDrawerMode;
  knowledgeUniverseSelectedNodeId: string | null;
  knowledgeUniverseSelectedObject:
    | import("./capability/knowledge-universe/types.ts").KnowledgeObject
    | null;
  knowledgeUniverseSourceSummary:
    | import("./capability/knowledge-universe/types.ts").KnowledgeSourceSummary
    | null;
  knowledgeUniverseGraph:
    | import("./capability/knowledge-universe/types.ts").RelationshipGraph
    | null;
  knowledgeUniverseGraphViewModel:
    | import("./capability/knowledge-universe/types.ts").GraphViewModel
    | null;
  knowledgeUniverseSearchResults: import("./capability/knowledge-universe/types.ts").KnowledgeObject[];
  knowledgeUniverseWorkspaceSearchGroups: import("./capability/knowledge-universe/workspace-endpoints.ts").WorkspaceSearchGroup[];
  knowledgeUniverseWorkspaceSearchTotalCount: number;
  knowledgeUniverseWorkspaceSearchMode:
    | import("./capability/knowledge-universe/workspace-endpoints.ts").WorkspaceSearchMode
    | null;
  knowledgeUniverseSelectedWorkspaceSearchHitId: string | null;
  knowledgeUniverseSelectedWorkspaceSearchDeliverableId: string | null;
  knowledgeUniverseOpenDeliverableMoreMenuId: string | null;
  knowledgeUniverseDataCapabilities: import("./capability/knowledge-universe/types.ts").DataCapabilityDescriptor[];
  knowledgeUniverseSourceBrowse: import("./capability/knowledge-universe/types.ts").KnowledgeSourceBrowse;
  knowledgeUniverseExternalDataSources: import("./capability/knowledge-universe/types.ts").ExternalDataSourceSummary[];
  knowledgeUniversePersonalCollectTitle: string;
  knowledgeUniversePersonalCollectSummary: string;
  knowledgeUniversePersonalCollectTags: string;
  knowledgeUniversePersonalCollectUrl: string;
  knowledgeUniversePersonalDatasetText: string;
  knowledgeUniversePersonalUploadAttachment:
    | import("./capability/knowledge-universe/endpoints.ts").KnowledgePersonalDocumentAttachment
    | null;
  knowledgeUniversePersonalActionBusy: boolean;
  knowledgeUniversePersonalActionNotice: string | null;
  knowledgeUniversePersonalActionError: string | null;
  knowledgeUniverseAccessRequestBusyCapabilityId: string | null;
  knowledgeUniverseAccessRequestBusyProjectionId: string | null;
  knowledgeUniverseAccessRequestNotice: string | null;
  knowledgeUniverseCapabilityPreview?:
    | import("./capability/knowledge-universe/types.ts").KnowledgeCapabilityPreviewState
    | null;
  knowledgeUniverseCapabilityInvocation?:
    | import("./capability/knowledge-universe/types.ts").KnowledgeCapabilityInvocationState
    | null;
  knowledgeUniversePersonalManageObjectId: string | null;
  knowledgeUniversePersonalManageObjectTitle: string | null;
  knowledgeUniversePersonalManageTags: string;
  knowledgeUniversePersonalManageBusy: boolean;
  knowledgeUniversePersonalManageNotice: string | null;
  knowledgeUniversePersonalVersions: import("./capability/knowledge-universe/types.ts").PersonalKnowledgeVersionSummary[];
  knowledgeUniversePersonalVersionCompareFrom: string;
  knowledgeUniversePersonalVersionCompareTo: string;
  knowledgeUniversePersonalVersionDiff:
    | import("./capability/knowledge-universe/types.ts").PersonalKnowledgeVersionDiff
    | null;
  knowledgeUniverseRecommendations: import("./capability/knowledge-universe/types.ts").KnowledgeRecommendationItem[];
  knowledgeUniverseDiscoveryEvents: import("./capability/knowledge-universe/types.ts").KnowledgeDiscoveryEvent[];
  knowledgeUniverseActionSuggestions: import("./capability/knowledge-universe/types.ts").KnowledgeActionSuggestion[];
  knowledgeUniverseHomeInsightsDegraded: boolean;
  knowledgeUniverseHomeFocus:
    | import("./ports/employee/views/home-page-contracts.ts").KnowledgeHomeFocus
    | null;
  knowledgeUniverseRecentVisits: import("./capability/knowledge-universe/types.ts").KnowledgeRecentVisit[];
  knowledgeUniverseRelatedGroups:
    | import("./capability/knowledge-universe/types.ts").KnowledgeRelatedGroups
    | null;
  knowledgeUniverseGraphZoom: number;
  knowledgeUniverseGraphPanX: number;
  knowledgeUniverseGraphPanY: number;
  knowledgeUniverseHoveredNodeId: string | null;
  knowledgeUniverseKnowledgeBases: import("./capability/knowledge-universe/workspace-endpoints.ts").KnowledgeBaseSummary[];
  knowledgeUniverseSelectedKnowledgeBaseId: string | null;
  knowledgeUniverseKbSearchQuery: string;
  knowledgeUniverseKbSearchEvidence: import("./capability/knowledge-universe/workspace-endpoints.ts").KnowledgeEvidenceDto[];
  knowledgeUniverseKbSearchMode: "indexed" | "substring" | null;
  knowledgeUniverseKbSearchSubstringResults: import("./capability/knowledge-universe/types.ts").KnowledgeObject[];
  knowledgeUniverseWorkspaceDeliverables: import("./capability/knowledge-universe/workspace-endpoints.ts").WorkspaceDeliverableDto[];
  knowledgeUniverseWorkspaceDeliverableStatusFilter: import("./ports/employee/views/home-page-contracts.ts").WorkspaceDeliverableStatusFilter;
  knowledgeUniverseWorkspaceBusy: boolean;
  knowledgeUniverseWorkspaceNotice: string | null;
  knowledgeUniverseWorkspaceError: string | null;
  knowledgeUniverseWorkspaceHint: string | null;
  knowledgeUniverseWorkspaceDeliverablesUnavailable: boolean;
  knowledgeUniverseNewKnowledgeBaseTitle: string;
  knowledgeUniverseNewKnowledgeBaseDescription: string;
  knowledgeUniverseNewKnowledgeBaseVisibility: import("./capability/knowledge-universe/workspace-endpoints.ts").KnowledgeBaseSummary["visibility"];
  knowledgeUniverseRelationsInsightExpanded: boolean;
  knowledgeUniverseSupplySectionExpanded: boolean;
  knowledgeUniverseSearchScope: import("./ports/employee/views/home-page-contracts.ts").KnowledgeUniverseSearchScope;
  knowledgeUniverseSelectedKbSearchHighlightKey: string | null;
  knowledgeUniverseWorkspaceDeliverablesExpanded: boolean;
  knowledgeUniverseWorkspaceDeliverableTrace:
    | import("./capability/knowledge-universe/workspace-endpoints.ts").WorkspaceDeliverableTraceDto
    | null;
  knowledgeUniverseWorkspaceDeliverableTraceLoading: boolean;
  knowledgeUniverseDeliverableDetailFocus:
    | import("./capability/knowledge-universe/workspace-endpoints.ts").DeliverableDetailFocus
    | null;
  knowledgeUniversePinnedKnowledgeBaseIds: string[];
  knowledgeUniverseFavoriteKnowledgeBaseIds: string[];
  knowledgeUniverseLibraryWorkspaceContentTab: import("./ports/employee/views/home-page-contracts.ts").LibraryWorkspaceContentTab;
  knowledgeUniverseLibraryWorkspaceDocumentsLoading: boolean;
  knowledgeUniverseLibraryWorkspaceDocuments: import("./capability/knowledge-universe/workspace-endpoints.ts").KnowledgeBaseDocumentSummaryDto[];
  knowledgeUniverseLibraryWorkspaceSourcesLoading: boolean;
  knowledgeUniverseLibraryWorkspaceSources: import("./capability/knowledge-universe/workspace-endpoints.ts").KnowledgeBaseSourceListItemDto[];
  knowledgeUniverseLibraryWorkspaceSourcesPlaneFilter: import("./ports/employee/views/home-page-contracts.ts").LibraryWorkspaceSourcesPlaneFilter;
  knowledgeUniverseLibraryWorkspaceSnippets: import("./capability/knowledge-universe/workspace-endpoints.ts").KnowledgeBaseSnippetSummaryDto[];
  knowledgeUniverseLibraryWorkspaceSnippetsLoading: boolean;
  knowledgeUniverseLibraryWorkspaceRecycleLoading: boolean;
  knowledgeUniverseLibraryWorkspaceRecycleDocuments: import("./capability/knowledge-universe/workspace-endpoints.ts").KnowledgeBaseDocumentSummaryDto[];
  knowledgeUniverseLibraryWorkspaceEvictedChunks: import("./capability/knowledge-universe/workspace-endpoints.ts").KnowledgeBaseEvictedChunkSummaryDto[];
  knowledgeUniverseLibraryWorkspaceWebPagesLoading: boolean;
  knowledgeUniverseLibraryWorkspaceWebPages: import("./capability/knowledge-universe/workspace-endpoints.ts").KnowledgeBaseWebPageSummaryDto[];
  knowledgeUniverseLibraryWorkspaceDatasetsLoading: boolean;
  knowledgeUniverseLibraryWorkspaceDatasets: import("./capability/knowledge-universe/workspace-endpoints.ts").KnowledgeBaseDatasetSummaryDto[];
  knowledgeUniverseLibraryWorkspaceAgentKnowledgeLoading: boolean;
  knowledgeUniverseLibraryWorkspaceAgentKnowledge: import("./capability/knowledge-universe/workspace-endpoints.ts").KnowledgeBaseAgentKnowledgeDto[];
  knowledgeUniverseLibraryWorkspaceMembersLoading: boolean;
  knowledgeUniverseLibraryWorkspaceMembers: import("./capability/knowledge-universe/workspace-endpoints.ts").KnowledgeBaseMemberDto[];
  knowledgeUniverseLibraryWorkspaceInviteDrawerOpen: boolean;
  knowledgeUniverseLibraryWorkspaceInviteEmail: string;
  knowledgeUniverseLibraryWorkspaceInviteRole: import("./capability/knowledge-universe/workspace-endpoints.ts").KnowledgeBaseMemberRoleDto;
  knowledgeUniverseLibraryWorkspaceSettingsKbId: string | null;
  knowledgeUniverseLibraryWorkspaceSettingsTitle: string;
  knowledgeUniverseLibraryWorkspaceInlineRenameKbId: string | null;
  knowledgeUniverseLibraryWorkspaceImportOpen: boolean;
  knowledgeUniverseLibraryWorkspaceImportLockSpace: boolean;
  knowledgeUniverseLibraryWorkspaceImportKind:
    | import("./ports/employee/views/home-page-contracts.ts").SpaceImportKind
    | null;
  knowledgeUniverseLibraryWorkspaceBindSourceKind: import("./ports/employee/views/home-page-contracts.ts").ActiveSourceBindKind;
  knowledgeUniverseLibraryWorkspaceBindSourceTitle: string;
  knowledgeUniverseLibraryWorkspaceBindSourceEndpoint: string;
  knowledgeUniverseLibraryWorkspaceLocalFolderPath: string;
  knowledgeUniverseLibraryWorkspaceLocalFolderLabel: string;
  knowledgeUniverseLibraryWorkspaceLocalFolderDeletePolicy: import("./capability/knowledge-universe/endpoints.ts").LocalFolderDeletePolicy;
  knowledgeUniverseLibraryWorkspaceLocalFolderWatcherEnabled: boolean;
  knowledgeUniverseLibraryWorkspaceLocalFolderMode: import("./capability/knowledge-universe/endpoints.ts").LocalFolderBindingMode;
  knowledgeUniverseLibraryWorkspaceLocalFolderStatusItems: import("./capability/knowledge-universe/endpoints.ts").LocalFolderStatusItem[];
  knowledgeUniverseLibraryWorkspaceMaterialsKindFilter: import("./ports/employee/views/home-page-contracts.ts").LibraryWorkspaceMaterialsKindFilter;
  knowledgeUniverseLibraryWorkspaceConnectorBindDraft: import("./views/knowledge-universe-space-connector-bind.ts").SpaceConnectorBindDraft;
  knowledgeUniverseLibraryWorkspaceConnectorCatalog: import("./capability/enterprise-data-capability/types.ts").DataConnectorCatalogEntry[];
  knowledgeUniverseLibraryWorkspaceConnectorCatalogLoading: boolean;
  knowledgeUniverseLibraryWorkspaceConnectorCatalogError: string | null;
  knowledgeUniverseLibraryWorkspacePassiveConnectorLocator: string;
  knowledgeUniverseLibraryWorkspacePassiveConnectorLabel: string;
  knowledgeUniverseLibraryWorkspaceConnectorCredentials: import("./capability/enterprise-data-capability/types.ts").DataConnectorCredentialRecord[];
  knowledgeUniverseLibraryWorkspaceConnectorCredentialsLoading: boolean;
  knowledgeUniverseLibraryWorkspaceConnectorProbeOk: boolean | null;
  knowledgeUniverseLibraryWorkspaceConnectorProbeMessage: string | null;
  knowledgeUniverseLibraryWorkspaceConnectorProbeBusy: boolean;
  knowledgeUniverseLibraryWorkspaceConnectorOAuthBusy: boolean;
  knowledgeUniverseLibraryWorkspaceConnectorOAuthNotice: string | null;
  knowledgeUniverseLibraryWorkspaceConnectorOAuthError: string | null;
  knowledgeUniverseLibraryWorkspaceConnectorOAuthSessionId: string | null;
  knowledgeUniverseLibraryWorkspaceConnectorOAuthSimulateAllowed: boolean;
  knowledgeUniverseLibraryWorkspaceHttpRestExpanded: boolean;
  knowledgeUniverseLibraryWorkspaceDatasetImportTab: import("./views/knowledge-universe-dataset-import.ts").DatasetImportTab;
  knowledgeUniverseLibraryWorkspaceDatasetFileAttachment:
    | import("./capability/knowledge-universe/personal-document-upload.ts").PersonalDocumentUploadAttachment
    | null;
  knowledgeUniverseLibraryWorkspaceDatasetPreview:
    | import("./views/knowledge-universe-dataset-import.ts").DatasetImportPreview
    | null;
  knowledgeUniverseLibraryWorkspaceDatasetPreviewError: string | null;
  knowledgeUniverseLibraryWorkspaceUrlImportMode: import("./views/knowledge-universe-url-import.ts").WebUrlImportMode;
  knowledgeUniverseLibraryWorkspaceUrlImportText: string;
  knowledgeUniverseLibraryWorkspaceUrlImportAdvancedOpen: boolean;
  knowledgeUniverseLibraryWorkspaceUrlSyncSchedule: import("./views/knowledge-universe-url-import.ts").WebUrlSyncSchedule;
  knowledgeUniverseLibraryWorkspaceUrlStripNavAds: boolean;
  knowledgeUniverseLibraryWorkspaceUrlMainContentOnly: boolean;
  knowledgeUniverseLibraryWorkspaceNoteTags: string[];
  knowledgeUniverseLibraryWorkspaceNoteTagDraft: string;
  knowledgeUniverseLibraryWorkspaceNoteTagSuggestionsOpen: boolean;
  knowledgeUniverseLibraryWorkspaceNoteTagHistory: string[];
  knowledgeUniverseLibraryWorkspaceNoteAiBusy: boolean;
  knowledgeUniverseLibraryWorkspaceFileImportItems: import("./views/knowledge-universe-file-import.ts").FileImportQueueItem[];
  knowledgeUniverseLibraryWorkspaceFileImportAdvancedOpen: boolean;
  knowledgeUniverseLibraryWorkspaceFileChunkingStrategy: import("./views/knowledge-universe-file-import.ts").FileChunkingStrategy;
  knowledgeUniverseLibraryWorkspaceFileOcrEnabled: boolean;
  knowledgeUniverseSearchPanelOpen: boolean;
  knowledgeUniverseGovernanceNotice: string | null;
  knowledgeUniverseViewerOwnerLabel: string | null;
  knowledgeUniverseGovernanceSummary:
    | import("./capability/knowledge-universe/endpoints.ts").KnowledgeGovernanceSummary
    | null;
  knowledgeUniverseGovernanceTasks: import("./capability/knowledge-universe/endpoints.ts").KnowledgeGovernanceTask[];
  knowledgeUniverseGovernanceLoading: boolean;
  knowledgeUniverseGovernanceError: string | null;
  knowledgeUniverseGovernanceTaskBusyId: string | null;
  knowledgeUniverseGovernanceSelectedTaskId: string | null;
  knowledgeUniverseGovernanceTaskGraph:
    | import("./capability/knowledge-universe/types.ts").RelationshipGraph
    | null;
  knowledgeUniverseGovernanceTaskGraphViewModel:
    | import("./capability/knowledge-universe/types.ts").GraphViewModel
    | null;
  knowledgeUniverseGovernanceTaskGraphLoading: boolean;
  knowledgeUniverseGovernanceTaskGraphZoom: number;
  knowledgeUniverseGovernanceTaskGraphPanX: number;
  knowledgeUniverseGovernanceTaskGraphPanY: number;
  knowledgeUniverseGovernanceTaskGraphSelectedNodeId: string | null;
  knowledgeUniverseGovernanceTaskGraphHoveredNodeId: string | null;
  // Employee-home signal projections (M1-M4a). Sourced as `@state` on the app
  // component; declared here so the AppPortState contract exposes them to the
  // workbench render model (buildWorkbenchSnapshot).
  workbenchPendingTasks:
    | import("./ports/employee/views/workbench-signals.ts").WorkbenchPendingTasksSummary
    | null;
  workbenchMyTasks:
    | import("./ports/employee/views/workbench-signals.ts").WorkbenchMyTasksSummary
    | null;
  workbenchNotices:
    | import("./ports/employee/views/workbench-signals.ts").WorkbenchNoticesSummary
    | null;
  workbenchUpcomingCollaboration:
    | import("./ports/employee/views/workbench-signals.ts").WorkbenchUpcomingCollaborationSummary
    | null;
  workbenchSchedule:
    | import("./ports/employee/views/workbench-signals.ts").WorkbenchScheduleSummary
    | null;
  workbenchStewardSuggestion:
    | import("./ports/employee/views/workbench-signals.ts").WorkbenchStewardSuggestionSummary
    | null;
  /** CollabDispatch D1: organizer meeting release confirm card (chat primary). */
  meetingPendingConfirmation:
    | import("./controllers/meeting-confirmation.ts").MeetingPendingConfirmation
    | null;
  meetingConfirmationLoading: boolean;
  meetingConfirmationError: string | null;
  /** True when the shown meeting card is stale and must be reissued, not extended. */
  meetingConfirmationOldCardInvalid: boolean;
  meetingConfirmRelease:
    | import("./controllers/meeting-confirmation.ts").MeetingConfirmRelease
    | null;
  meetingScheduleReplayNeeded: boolean;
  meetingScheduleReplayMeetingId: string | null;
};

export type AppViewOperationsState = {
  enterpriseAccessEditorKind: "role" | "user" | null;
  enterpriseAccessEditorTargetKey: string | null;
  enterpriseAccessEditorSelectedPermissionIds: string[];
  enterpriseAccessEditorNotice: string | null;
  enterpriseAccessRiskConfirmOpen: boolean;
  enterpriseSeatOfferEditorSeatId: string | null;
  enterpriseSeatOfferEditorMode: "offer" | "activation";
  enterpriseSeatOfferEditorSeatTitle: string;
  enterpriseSeatOfferEditorSeatStatus: string | null;
  enterpriseSeatOfferEditorDefaultAgentId: string | null;
  enterpriseSeatOfferEditorAvailableAgentIds: string[];
  enterpriseSeatOfferEditorDefaultSpaceIds: string[];
  enterpriseSeatOfferEditorSelectedAgentIds: string[];
  enterpriseSeatOfferEditorSelectedSpaceIds: string[];
  enterpriseSeatOfferEditorInheritMode: "full" | "selective";
  enterpriseSeatOfferEditorInheritMemoryScope: boolean;
  enterpriseSeatOfferEditorMemoryScopeAvailable: boolean;
  enterpriseSeatOfferEditorEmployeeEmail: string;
  enterpriseSeatCreateEditorSeatId: string | null;
  enterpriseSeatCreateEditorOpen: boolean;
  enterpriseSeatCreateEditorSeatTitle: string;
  enterpriseSeatCreateEditorTeamLabel: string;
  enterpriseSeatCreateEditorResponsibility: string;
  enterpriseSeatCreateEditorEmployeeEmail: string;
  enterpriseSeatCreateEditorDefaultAgentId: string;
  enterpriseSeatCreateEditorAgentIds: string[];
  enterpriseOwnershipTransferEditorOpen: boolean;
  enterpriseOwnershipTransferEditorTenantId: string | null;
  enterpriseOwnershipTransferEditorSubjectKind: "agent" | "group" | null;
  enterpriseOwnershipTransferEditorSubjectId: string | null;
  enterpriseOwnershipTransferEditorSubjectLabel: string;
  enterpriseOwnershipTransferEditorPositionId: string | null;
  enterpriseOwnershipTransferEditorPositionLabel: string;
  enterpriseOwnershipTransferEditorCurrentManagerUserId: string | null;
  enterpriseOwnershipTransferEditorCurrentManagerLabel: string;
  enterpriseOwnershipTransferEditorSelectedUserId: string;
  enterpriseHandoverEditorCaseId: string | null;
  enterpriseHandoverEditorSeatTitle: string;
  enterpriseHandoverEditorStatus: string | null;
  enterpriseHandoverEditorReviewSummary: string;
  enterpriseHandoverEditorExceptionFlags: string;
  enterpriseHandoverEditorSuccessorEmail: string;
  enterpriseHandoverEditorSeatStatus: string | null;
  enterpriseHandoverEditorDefaultAgentIds: string[];
  enterpriseHandoverEditorDefaultSpaceIds: string[];
  enterpriseHandoverEditorSelectedAgentIds: string[];
  enterpriseHandoverEditorSelectedDataKeys: string[];
  enterpriseHandoverEditorSelectedSpaceIds: string[];
  enterpriseHandoverEditorSelectedPolicyIds: string[];
  enterpriseHandoverEditorDraftNotice: string | null;
  enterpriseHandoverEditorCurrentEmployeeEmail: string | null;
  enterpriseHandoverEditorCurrentEmployeeDisplayName: string | null;
  enterpriseHandoverEditorBindingStatus: string | null;
  enterpriseHandoverEditorEmployeePolicies: Array<{
    policyId: string;
    resourceType: string;
    resourceId: string;
    action: string;
  }>;
  enterpriseHandoverEditorSeatPolicies: Array<{
    policyId: string;
    resourceType: string;
    resourceId: string;
    action: string;
  }>;
  enterpriseOperationalIdentities:
    | import("./controllers/enterprise-operational-identity.ts").EnterpriseOperationalIdentitySnapshot
    | null;
  enterpriseOperationalIdentityBusy: boolean;
  enterpriseOperationalIdentityLoaded: boolean;
  enterpriseOperationalIdentityError: string | null;
  enterpriseOperationalIdentityNotice: string | null;
  enterpriseOperationalIdentityDetailId: string;
  enterpriseOperationalIdentityDetailTab: "usage" | "policy" | "audit" | "security";
  enterpriseIdentityEditorOpen: boolean;
  enterpriseIdentityEditorMode: "register" | "edit" | "policy" | "binding" | "credential";
  enterpriseIdentityEditorIdentityId: string;
  enterpriseIdentityEditorDisplayName: string;
  enterpriseIdentityEditorCredentialBindingId: string;
  enterpriseIdentityEditorPolicyId: string;
  enterpriseIdentityEditorSeatIds: string;
  enterpriseIdentityEditorAgentIds: string;
  enterpriseIdentityEditorAllowedActions: string;
  enterpriseIdentityEditorPolicyPickerQuery: string;
  enterpriseIdentityEditorPolicyDepartmentPaths: string;
  enterpriseIdentityEditorDataSourceId: string;
  enterpriseIdentityEditorBindingPurpose:
    | "source_authentication"
    | "source_collection"
    | "source_sync";
  enterpriseIdentityEditorBindingId: string;
  enterpriseIdentityEditorProvider: string;
  enterpriseIdentityEditorCredentialFields: Record<string, string>;
  enterpriseIdentityEditorCredentialFieldsReady: boolean;
  enterpriseIdentityEditorInitialSecretsConfigured: string[];
  enterpriseIdentityRevokeConfirmId: string;
  enterpriseIdentityVerifyId: string;
  enterpriseIdentityVerifyPhase: "idle" | "running" | "passed" | "failed";
  enterpriseIdentityVerifyMessage: string;
  tenantImSyncBusy: boolean;
  tenantImIdentityLinkHint: string | null;
  tenantImProbeBusy: boolean;
  tenantImProbeResult: import("./controllers/tenant-im-binding.ts").TenantImProbeResult | null;
  tenantImProbeError: string | null;
  userOperationalIdentities:
    | import("./controllers/user-operational-identity.ts").UserOperationalIdentitySnapshot
    | null;
  userOperationalIdentityBusy: boolean;
  userOperationalIdentityError: string | null;
  userOperationalIdentityNotice: string | null;
  userOperationalIdentityNav: import("./controllers/user-operational-identity.ts").UserOperationalIdentityNav;
  userOperationalIdentityUsageRange?: import("./controllers/user-operational-identity.ts").UserOperationalIdentityUsageRange;
  userOperationalIdentityUsageEventId?: string | null;
  userOperationalIdentityEditorOpen: boolean;
  userOperationalIdentityEditorProvider: string;
  userOperationalIdentityEditorDisplayName: string;
  userOperationalIdentityEditorCredentialHandleId: string;
  userOperationalIdentityEditorAppId: string;
  userOperationalIdentityEditorAppSecret: string;
  userOperationalIdentityEditorSmtpHost: string;
  userOperationalIdentityEditorSmtpPort: string;
  userOperationalIdentityEditorSmtpUser: string;
  userOperationalIdentityEditorImapHost: string;
  userOperationalIdentityEditorImapPort: string;
  userOperationalIdentityEditorImapUser: string;
  userOperationalIdentityEditorPersonalEmailPresetNote: string | null;
  userOperationalIdentityEditorUsePlatformSmtp: boolean;
  userOperationalIdentityEditorIdentityId: string | null;
  userOperationalIdentityEditorGrantAgentId: string;
  wechatPersonalQrWorkerOnline: boolean | null;
  wechatPersonalQrStatus: "idle" | "offline" | "scanning" | "logged_in" | "error";
  wechatPersonalQrDataUrl: string | null;
  wechatPersonalQrMessage: string | null;
  wechatPersonalQrWxid: string | null;
  userOperationalIdentityOAuthSessionId: string | null;
  userOperationalIdentityReturnSessionKey: string | null;
  userOperationalIdentityReturnModule: string | null;
  userOperationalIdentityReturnAgentId: string | null;
  workbenchRobotIdentityGrantFocusAgentId: string | null;
  userOperationalIdentityContinuationToken: string | null;
  userOperationalIdentityContinuationNotice: string | null;
  enterpriseDataSourceGovernanceSourceId: string | null;
  enterpriseDataSourceGovernanceView:
    | import("./controllers/enterprise-data-source-governance.ts").EnterpriseDataSourceGovernanceViewSnapshot
    | null;
  enterpriseDataSourceGovernanceBusy: boolean;
  enterpriseDataSourceGovernanceError: string | null;
  nodesLoading: boolean;
  nodes: Array<Record<string, unknown>>;
  devicesLoading: boolean;
  devicesError: string | null;
  devicesList: DevicePairingList | null;
  devicesCurrentDeviceId: string | null;
  gatewayConnectedAtMs: number | null;
  execApprovalsLoading: boolean;
  execApprovalsSaving: boolean;
  execApprovalsDirty: boolean;
  execApprovalsSnapshot: ExecApprovalsSnapshot | null;
  execApprovalsForm: ExecApprovalsFile | null;
  execApprovalsSelectedAgent: string | null;
  execApprovalsTarget: "gateway" | "node";
  execApprovalsTargetNodeId: string | null;
  execApprovalQueue: ExecApprovalRequest[];
  execApprovalBusy: boolean;
  execApprovalError: string | null;
  localFileApprovalQueue: LocalFileApprovalRequest[];
  localFileApprovalBusy: boolean;
  localFileApprovalError: string | null;
  secureFormOffered: import("./gateway-subscriptions/secure-form.ts").SecureFormOfferedUi | null;
  secureFormValues: Record<string, string>;
  secureFormBusy: boolean;
  secureFormError: string | null;
  secureFormReceipt: import("./gateway-subscriptions/secure-form.ts").SecureFormReceiptUi | null;
  secureFormHandoff:
    | import("./gateway-subscriptions/secure-form.ts").SecureFormHandoffActiveUi
    | null;
  loginMethodChoice:
    | import("./gateway-subscriptions/account-computer-login.ts").LoginMethodChoiceUi
    | null;
  loginSaveOffer:
    | import("./gateway-subscriptions/account-computer-login.ts").LoginSaveOfferUi
    | null;
  loginCardBusy: boolean;
  loginCardError: string | null;
  presenceLoading: boolean;
  presenceEntries: PresenceEntry[];
  presenceError: string | null;
  presenceStatus: string | null;
  agentsLoading: boolean;
  agentsList: AgentsListResult | null;
  agentsError: string | null;
  meshOwnershipLoading: boolean;
  meshOwnershipList: MeshOwnershipListResult | null;
  meshOwnershipError: string | null;
  /** Mesh detail cumulative cost; independent from monthly `usageResult`. */
  meshLifetimeUsageResult: SessionsUsageResult | null;
  agentsSelectedId: string | null;
  toolsCatalogLoading: boolean;
  toolsCatalogError: string | null;
  toolsCatalogResult: ToolsCatalogResult | null;
  agentsPanel: "overview" | "files" | "tools" | "skills" | "channels" | "cron";
  agentFilesLoading: boolean;
  agentFilesError: string | null;
  agentFilesList: AgentsFilesListResult | null;
  agentFileContents: Record<string, string>;
  agentFileDrafts: Record<string, string>;
  agentFileActive: string | null;
  agentFileSaving: boolean;
  agentIdentityLoading: boolean;
  agentIdentityError: string | null;
  agentIdentityById: Record<string, AgentIdentityResult>;
  agentSkillsLoading: boolean;
  agentSkillsError: string | null;
  agentSkillsReport: SkillStatusReport | null;
  agentSkillsAgentId: string | null;
  runtimeOverviewLoading: boolean;
  runtimeOverviewError: string | null;
  runtimeAgents: RuntimeAgent[];
  runtimeBindings: RuntimeCapabilityBinding[];
  runtimeTelemetry: RuntimeTelemetry[];
  runtimeGovernanceIssues: RuntimeGovernanceIssue[];
  runtimeKpi: RuntimeKpiData | null;
  platformModelsMode: "native" | "aor_enhanced";
  modelsManagementLoading: boolean;
  modelsManagementError: string | null;
  modelsManagementSnapshot:
    | import("./ports/platform/models/snapshot-types.ts").PlatformModelsManagementSnapshot
    | null;
};

export type AppViewAnalyticsState = {
  usageLoading: boolean;
  usageResult: SessionsUsageResult | null;
  usageCostSummary: CostUsageSummary | null;
  usageError: string | null;
  usageStartDate: string;
  usageEndDate: string;
  usageSelectedSessions: string[];
  usageSelectedDays: string[];
  usageSelectedHours: number[];
  usageChartMode: "tokens" | "cost";
  usageDailyChartMode: "total" | "by-type";
  usageTimeSeriesMode: "cumulative" | "per-turn";
  usageTimeSeriesBreakdownMode: "total" | "by-type";
  usageTimeSeries: SessionUsageTimeSeries | null;
  usageTimeSeriesLoading: boolean;
  usageTimeSeriesCursorStart: number | null;
  usageTimeSeriesCursorEnd: number | null;
  usageSessionLogs: SessionLogEntry[] | null;
  usageSessionLogsLoading: boolean;
  usageSessionLogsExpanded: boolean;
  usageQuery: string;
  usageQueryDraft: string;
  usageQueryDebounceTimer: number | null;
  usageSessionSort: "tokens" | "cost" | "recent" | "messages" | "errors";
  usageSessionSortDir: "asc" | "desc";
  usageRecentSessions: string[];
  usageTimeZone: "local" | "utc";
  usageContextExpanded: boolean;
  usageHeaderPinned: boolean;
  usageSessionsTab: "all" | "recent";
  usageVisibleColumns: string[];
  usageLogFilterRoles: import("./views/usage.js").SessionLogRole[];
  usageLogFilterTools: string[];
  usageLogFilterHasTools: boolean;
  usageLogFilterQuery: string;
};

export type AppViewAutomationState = Pick<
  CronState,
  | "cronLoading"
  | "cronJobsLoadingMore"
  | "cronJobs"
  | "cronJobsTotal"
  | "cronJobsHasMore"
  | "cronJobsNextOffset"
  | "cronJobsLimit"
  | "cronJobsQuery"
  | "cronJobsEnabledFilter"
  | "cronJobsScheduleKindFilter"
  | "cronJobsLastStatusFilter"
  | "cronJobsSortBy"
  | "cronJobsSortDir"
  | "cronStatus"
  | "cronError"
  | "cronForm"
  | "cronFieldErrors"
  | "cronEditingJobId"
  | "cronRunsJobId"
  | "cronRunsLoadingMore"
  | "cronRuns"
  | "cronRunsTotal"
  | "cronRunsHasMore"
  | "cronRunsNextOffset"
  | "cronRunsLimit"
  | "cronRunsScope"
  | "cronRunsStatuses"
  | "cronRunsDeliveryStatuses"
  | "cronRunsStatusFilter"
  | "cronRunsQuery"
  | "cronRunsSortDir"
  | "cronBusy"
> &
  Pick<CronModelSuggestionsState, "cronModelSuggestions">;

export type AppViewDiagnosticsState = {
  skillsLoading: boolean;
  skillsReport: SkillStatusReport | null;
  capabilityGovernanceSnapshot: CapabilityGovernanceSnapshot | null;
  skillsError: string | null;
  skillsFilter: string;
  skillEdits: Record<string, string>;
  skillMessages: Record<string, SkillMessage>;
  skillsBusyKey: string | null;
  debugLoading: boolean;
  debugModelProbeLoading: boolean;
  debugStatus: StatusSummary | null;
  debugHealth: HealthSnapshot | null;
  debugModels: unknown[];
  debugModelProbeSummary: unknown;
  debugModelProbeError: string | null;
  debugHeartbeat: unknown;
  debugCallMethod: string;
  debugCallParams: string;
  debugCallResult: string | null;
  debugCallError: string | null;
  logsLoading: boolean;
  logsError: string | null;
  logsFile: string | null;
  logsEntries: LogEntry[];
  logsFilterText: string;
  logsLevelFilters: Record<LogLevel, boolean>;
  logsAutoFollow: boolean;
  logsTruncated: boolean;
  logsCursor: number | null;
  logsLastFetchAt: number | null;
  logsLimit: number;
  logsMaxBytes: number;
  logsAtBottom: boolean;
};

export type AppViewShellActionsState = {
  requestUpdate: () => void;
  connect: () => void;
  updateComplete: Promise<unknown>;
  setTab: (tab: Tab) => void;
  setTheme: (theme: ThemeMode, context?: ThemeTransitionContext) => void;
  applySettings: (next: UiSettings) => void;
  loadOverview: () => Promise<void>;
  refreshEnterpriseOrganization: () => Promise<void>;
  submitPlatformAuth: () => Promise<void>;
  switchPlatformAuthSessionKind: (
    targetSessionKind: "enterprise-admin" | "platform-admin" | "platform-super-admin" | "member",
    tenantId?: string | null,
  ) => Promise<void>;
  submitPlatformTrialApply: () => Promise<void>;
  createPlatformAdmin: () => Promise<void>;
  removePlatformAdmin: (user: string) => Promise<void>;
  logoutPlatformAuth: () => Promise<void>;
  setPlatformMfaPolicy: (requireMfa: boolean) => Promise<void>;
  createPlatformAuthInvite: () => Promise<void>;
  invitePlatformEnterpriseAdmin: (user: string, options?: { resend?: boolean }) => Promise<void>;
  importEnterpriseOrganizationRows: (rows: PlatformEmployeeProvisionInput[]) => Promise<void>;
  buildEnterpriseOrganization: (payload: {
    departmentPaths: string[];
    seats: Array<{
      teamLabel: string;
      seatTitle: string;
      responsibility?: string | null;
      employeeName?: string | null;
      employeeEmail?: string | null;
    }>;
  }) => Promise<void>;
  sendEnterpriseOrganizationActivationEmails: (emails?: string[]) => Promise<void>;
  revokePlatformAuthInvite: (code: string) => Promise<void>;
  removePlatformAuthMember: (user: string) => Promise<void>;
  acceptPlatformSeatAssignmentOffer: (offerId: string) => Promise<void>;
  declinePlatformSeatAssignmentOffer: (offerId: string) => Promise<void>;
  sendEnterpriseSeatAssignmentOffer: (
    tenantId: string,
    seatId: string,
    employeeEmail: string,
  ) => Promise<void>;
  createEnterpriseSeat: (
    tenantId: string,
    params: {
      seatId?: string | null;
      seatTitle: string;
      teamLabel?: string | null;
      responsibility?: string | null;
      defaultAgentId?: string | null;
      agentIds?: string[];
    },
  ) => Promise<void>;
  cancelEnterpriseSeatAssignmentOffer: (tenantId: string, offerId: string) => Promise<void>;
  remindEnterpriseSeatAssignmentOffer: (
    tenantId: string,
    offerId: string,
    employeeEmail?: string | null,
  ) => Promise<void>;
  openEnterpriseSeatOfferEditor: (params: {
    seatId: string;
    seatTitle: string;
    seatStatus?: string | null;
    defaultAgentId?: string | null;
    employeeEmail?: string | null;
  }) => void;
  closeEnterpriseSeatOfferEditor: () => void;
  submitEnterpriseSeatOffer: (tenantId: string) => Promise<void>;
  openEnterpriseSeatCreateEditor: (params?: {
    seatId?: string | null;
    seatTitle?: string | null;
    teamLabel?: string | null;
    responsibility?: string | null;
    employeeEmail?: string | null;
    defaultAgentId?: string | null;
    agentIds?: string[];
  }) => void;
  closeEnterpriseSeatCreateEditor: () => void;
  submitEnterpriseSeatCreate: (tenantId: string) => Promise<void>;
  openEnterpriseOwnershipTransferEditor: (params: {
    tenantId: string;
    subjectKind: "agent" | "group";
    subjectId: string;
    subjectLabel: string;
    positionId: string;
    positionLabel: string;
    currentManagerUserId: string;
    currentManagerLabel: string;
    suggestedUserId?: string | null;
  }) => void;
  closeEnterpriseOwnershipTransferEditor: () => void;
  submitEnterpriseOwnershipTransfer: () => Promise<void>;
  startEnterpriseSeatHandover: (tenantId: string, seatId: string) => Promise<void>;
  openEnterpriseHandoverRoute: (params: {
    tenantId: string;
    handoverCaseId: string;
    seatTitle?: string;
    status?: string;
    reviewSummary?: string | null;
    exceptionFlags?: string[];
    incomingEmployeeUser?: string | null;
    replace?: boolean;
  }) => Promise<void>;
  syncEnterpriseHandoverRoute: (
    context: {
      tenantId?: string;
      handoverCaseId?: string;
      replace?: boolean;
    } | null,
  ) => Promise<void>;
  openEnterpriseHandoverEditor: (params: {
    handoverCaseId: string;
    seatTitle: string;
    status: string;
    reviewSummary?: string | null;
    exceptionFlags?: string[];
    incomingEmployeeUser?: string | null;
  }) => void;
  closeEnterpriseHandoverEditor: () => void;
  nominateEnterpriseSeatHandover: (
    tenantId: string,
    handoverCaseId: string,
    employeeEmail: string,
  ) => Promise<void>;
  reviewEnterpriseSeatHandover: (
    tenantId: string,
    handoverCaseId: string,
    reviewSummary: string,
    exceptionFlags?: string[],
    transferSelection?: import("./controllers/enterprise-seat-assets.ts").EnterpriseHandoverTransferSelection,
  ) => Promise<void>;
  approveEnterpriseSeatHandover: (tenantId: string, handoverCaseId: string) => Promise<void>;
  rebindEnterpriseSeatHandover: (
    tenantId: string,
    handoverCaseId: string,
    employeeEmail: string,
  ) => Promise<void>;
  mutateEnterpriseOrganizationDepartment: (
    tenantId: string,
    mutation: import("./controllers/enterprise-seat-assets.ts").EnterpriseOrganizationDepartmentMutation,
  ) => Promise<
    | (import("./controllers/enterprise-seat-assets.ts").EnterpriseSeatAssetsSuccess & {
        fullPath?: string;
        affectedSeatIds?: string[];
      })
    | undefined
  >;
  loadEnterpriseOperationalIdentities: (tenantId: string) => Promise<void>;
  loadEnterpriseIdentityCredentialEditPreview: (
    tenantId: string,
    identityId: string,
  ) => Promise<{
    fields: Record<string, string>;
    secretsConfigured: string[];
    credentialBindingId?: string;
    externalAccountId?: string;
  } | null>;
  createEnterpriseOperationalIdentity: (
    tenantId: string,
    input: {
      displayName: string;
      credentialBindingId: string;
      connectorProfileId?: string;
      externalAccountId?: string;
    },
  ) => Promise<unknown>;
  createEnterpriseConnectorCredential: (
    tenantId: string,
    input: { connectorId: string; allowMultiple?: boolean },
  ) => Promise<boolean>;
  syncChannelToOperationalIdentity: (tenantId: string, channelId: string) => Promise<boolean>;
  navigateToEnterpriseMessageChannels: (tenantId: string, channelId?: string) => Promise<void>;
  upsertEnterpriseOperationalIdentityCredential: (
    tenantId: string,
    input: {
      connectorId: string;
      fields: Record<string, string>;
      allowMultiple?: boolean;
      credentialBindingId?: string;
      accountLabel?: string;
      externalAccountId?: string;
    },
  ) => Promise<{ credentialBindingId: string } | null>;
  saveEnterpriseIdentityCredentialConfig: (
    tenantId: string,
  ) => Promise<{ credentialBindingId: string } | null>;
  startEnterpriseWechatOfficialOAuth: (
    tenantId: string,
    input?: { seatId?: string; displayName?: string },
  ) => Promise<boolean>;
  startEnterpriseOperationalIdentityOAuth: (
    tenantId: string,
    provider: string,
    input?: { seatId?: string; displayName?: string },
  ) => Promise<boolean>;
  verifyEnterpriseOperationalIdentity: (tenantId: string, identityId: string) => Promise<unknown>;
  updateEnterpriseOperationalIdentity: (
    tenantId: string,
    identityId: string,
    input: { displayName: string },
  ) => Promise<unknown>;
  openEnterpriseIdentityRevokeConfirm: (identityId: string) => void;
  closeEnterpriseIdentityRevokeConfirm: () => void;
  probeTenantImChannel: (
    tenantId: string,
    channelId: string,
  ) => Promise<import("./controllers/tenant-im-binding.ts").TenantImProbeResult | null>;
  navigateToEnterpriseImChannelCredentials: (tenantId: string, channelId: string) => Promise<void>;
  revokeEnterpriseOperationalIdentity: (tenantId: string, identityId: string) => Promise<boolean>;
  reauthorizeEnterpriseOperationalIdentity: (
    tenantId: string,
    identityId: string,
  ) => Promise<boolean>;
  upsertEnterpriseOperationalIdentityPolicy: (
    tenantId: string,
    input: {
      identityId: string;
      policyId?: string;
      seatIds: string[];
      allowedAgentIds: string[];
      allowedActions: string[];
      enabled?: boolean;
    },
  ) => Promise<boolean>;
  createEnterpriseOperationalIdentityBinding: (
    tenantId: string,
    input: {
      identityId: string;
      dataSourceId: string;
      purpose: "source_authentication" | "source_collection" | "source_sync";
    },
  ) => Promise<boolean>;
  removeEnterpriseOperationalIdentityBinding: (
    tenantId: string,
    bindingId: string,
  ) => Promise<boolean>;
  openEnterpriseIdentityEditor: (params: {
    mode: "register" | "edit" | "policy" | "binding" | "credential";
    identityId?: string;
    policyId?: string;
    bindingId?: string;
    displayName?: string;
    credentialBindingId?: string;
    seatIds?: string[];
    allowedAgentIds?: string[];
    allowedActions?: string[];
    dataSourceId?: string;
    purpose?: "source_authentication" | "source_collection" | "source_sync";
    provider?: string;
    credentialFields?: Record<string, string>;
    credentialFieldsReady?: boolean;
    initialSecretsConfigured?: string[];
  }) => void;
  closeEnterpriseIdentityEditor: () => void;
  submitEnterpriseIdentityEditor: (tenantId: string) => Promise<void>;
  loadEnterpriseDataSourceGovernanceView: (tenantId: string, sourceId: string) => Promise<unknown>;
  openEnterpriseDataSourceGovernanceDetail: (tenantId: string, sourceId: string) => Promise<void>;
  closeEnterpriseDataSourceGovernanceDetail: () => void;
  transferMeshOwnership: (
    tenantId: string,
    subjectKind: "agent" | "group",
    subjectId: string,
    positionId: string,
    previousUserId: string,
    newUserId: string,
    newUserLabel: string,
  ) => Promise<void>;
  revokeMeshOwnership: (
    tenantId: string,
    subjectKind: "agent" | "group",
    subjectId: string,
    revokedByUserId: string,
    revokedByUserLabel: string,
    reason?: string,
  ) => Promise<void>;
  submitEnterpriseHandoverNominate: (tenantId: string) => Promise<void>;
  submitEnterpriseHandoverReview: (tenantId: string) => Promise<void>;
  submitEnterpriseHandoverApproval: (tenantId: string) => Promise<void>;
  submitEnterpriseHandoverRebind: (tenantId: string) => Promise<void>;
  changePlatformAuthPassword: () => Promise<void>;
  openPlatformAuthForgotPassword: () => Promise<void>;
  updatePlatformTrialPolicy: () => Promise<void>;
  updatePlatformTrialInstance: (options?: {
    quiet?: boolean;
    signal?: AbortSignal;
  }) => Promise<void>;
  updatePlatformEnterpriseAdmin: (
    input: {
      enterpriseId: string;
      adminName: string;
      adminEmail: string;
      resendActivation?: boolean;
    },
    options?: { quiet?: boolean; signal?: AbortSignal },
  ) => Promise<void>;
  resendPlatformEnterpriseAdminActivation: (
    input: { enterpriseId: string },
    options?: { quiet?: boolean; signal?: AbortSignal },
  ) => Promise<void>;
  approvePlatformTrialApplication: (input: {
    applicationId: string;
    trialDays?: number;
    seatCount?: number;
    reviewNote?: string;
  }) => Promise<void>;
  rejectPlatformTrialApplication: (input: {
    applicationId: string;
    rejectionReason: string;
    reviewNote?: string;
  }) => Promise<void>;
  loadAssistantIdentity: () => Promise<void>;
  loadCron: () => Promise<void>;
  refreshWorkspace: () => Promise<void>;
  loadCollaborationLearningSnapshot: (opts?: { force?: boolean }) => Promise<void>;
  resetCollaborationLearningSnapshot: () => void;
  loadCollaborationObservabilitySnapshot: (opts?: {
    force?: boolean;
    taskId?: string | null;
  }) => Promise<void>;
  resetCollaborationObservabilitySnapshot: () => void;
  loadKnowledgeUniverseHome: (opts?: { force?: boolean }) => Promise<void>;
  loadUserOperationalIdentities: () => Promise<
    import("./controllers/user-operational-identity.ts").UserOperationalIdentitySnapshot | null
  >;
  openUserOperationalIdentityEditor: (provider?: string) => void;
  setUserOperationalIdentityNav: (
    nav: import("./controllers/user-operational-identity.ts").UserOperationalIdentityNav,
  ) => void;
  verifyUserOperationalIdentityCredentials: (identityId: string) => Promise<boolean>;
  closeUserOperationalIdentityEditor: () => void;
  submitUserOperationalIdentityEditor: () => Promise<void>;
  startWechatPersonalQr: () => Promise<void>;
  recheckWechatPersonalChannel: () => Promise<void>;
  completeUserOperationalIdentityOAuthForContinuation: (input: {
    continuationToken: string;
    provider: string;
    displayName?: string;
  }) => Promise<boolean>;
  revokeUserOperationalIdentity: (identityId: string) => Promise<unknown>;
  reauthorizeUserOperationalIdentity: (identityId: string) => Promise<boolean>;
  completeUserOperationalIdentityBindingRequest: (requestId: string) => Promise<unknown>;
  confirmUserOperationalIdentityGrant: (input: {
    identityId: string;
    agentId: string;
    agentScope: "owned" | "shared" | "group";
    allowedActions: string[];
    tenantId?: string;
    seatId?: string;
    sessionKey?: string | null;
  }) => Promise<boolean>;
  revokeUserOperationalIdentityGrant: (grantId: string) => Promise<unknown>;
  openUserOperationalIdentityBindingFlow: (params: {
    sessionKey?: string | null;
    module?: string | null;
    agentId?: string;
    provider?: string;
    requestedAction?: string;
    resumeMessage?: string;
    resumeIntentId?: string;
    requiredProviders?: string[];
    autoResume?: boolean;
  }) => void;
  resumeUserOperationalIdentityContinuationNow: (continuationToken?: string) => Promise<void>;
  transitionCollaborationGovernanceObject: (params: {
    kind: WorkbenchGovernanceObjectKind;
    id: string;
    toStatus: string;
    selectedOption?: string;
  }) => Promise<void>;
  saveCollaborationDecisionDraft: (params: {
    id: string;
    rationale?: string;
    selectedOption?: string;
    options?: Array<{ optionId: string; title: string }>;
  }) => Promise<void>;
  resetCollaborationGovernanceActionState: () => void;
  handleWhatsAppStart: (force: boolean) => Promise<void>;
  handleWhatsAppWait: () => Promise<void>;
  handleWhatsAppLogout: () => Promise<void>;
  handleChannelConfigSave: () => Promise<void>;
  handleChannelConfigReload: () => Promise<void>;
  handleNostrProfileEdit: (accountId: string, profile: NostrProfile | null) => void;
  handleNostrProfileCancel: () => void;
  handleNostrProfileFieldChange: (field: keyof NostrProfile, value: string) => void;
  handleNostrProfileSave: () => Promise<void>;
  handleNostrProfileImport: () => Promise<void>;
  handleNostrProfileToggleAdvanced: () => void;
  handleExecApprovalDecision: (decision: "allow-once" | "allow-always" | "deny") => Promise<void>;
  handleLocalFileApprovalDecision: (decision: "allow-once" | "deny") => void | Promise<void>;
  handleSecureFormFieldInput: (fieldId: string, value: string) => void;
  handleSecureFormSubmit: () => Promise<void>;
  handleSecureFormClose: () => Promise<void>;
  handleSecureFormUseComputer: () => Promise<void>;
  handleSecureFormHandoffDismiss: () => void;
  handleSecureFormHandoffReturn: () => Promise<void>;
  handleAccountComputerLoginChoose: (choiceId: string, method: "password" | "qr") => Promise<void>;
  handleAccountComputerLoginSave: (saveId: string, save: boolean) => Promise<void>;
  handleGatewayUrlConfirm: () => void;
  handleGatewayUrlCancel: () => void;
  handleConfigLoad: () => Promise<void>;
  handleConfigSave: () => Promise<void>;
  handleConfigApply: () => Promise<void>;
  handleConfigFormUpdate: (path: string, value: unknown) => void;
  handleConfigFormModeChange: (mode: "form" | "raw") => void;
  handleConfigRawChange: (raw: string) => void;
  handleInstallSkill: (key: string) => Promise<void>;
  handleUpdateSkill: (key: string) => Promise<void>;
  handleToggleSkillEnabled: (key: string, enabled: boolean) => Promise<void>;
  handleUpdateSkillEdit: (key: string, value: string) => void;
  handleSaveSkillApiKey: (key: string, apiKey: string) => Promise<void>;
  handleCronToggle: (jobId: string, enabled: boolean) => Promise<void>;
  handleCronRun: (jobId: string) => Promise<void>;
  handleCronRemove: (jobId: string) => Promise<void>;
  handleCronAdd: () => Promise<void>;
  handleCronRunsLoad: (jobId: string) => Promise<void>;
  handleCronFormUpdate: (path: string, value: unknown) => void;
  handleSessionsLoad: () => Promise<void>;
  handleSessionsPatch: (key: string, patch: unknown) => Promise<void>;
  handleLoadNodes: () => Promise<void>;
  handleLoadPresence: () => Promise<void>;
  handleLoadSkills: () => Promise<void>;
  handleLoadDebug: () => Promise<void>;
  handleLoadLogs: () => Promise<void>;
  handleDebugCall: () => Promise<void>;
  handleRunUpdate: () => Promise<void>;
  setPassword: (next: string) => void;
  setSessionKey: (next: string) => void;
  setChatMessage: (next: string) => void;
  handleSendChat: (
    messageOverride?: string,
    opts?: {
      restoreDraft?: boolean;
      focusSwitchProceed?: boolean;
      focusSwitchCancel?: boolean;
      growthGateProceed?: boolean;
      suppressOptimisticUserMessage?: boolean;
      stewardCallAuthorizationId?: string;
      idempotencyKey?: string;
    },
  ) => Promise<void>;
  handleAbortChat: () => Promise<void>;
  handleRestoreChat: () => Promise<void>;
  // chat-checkpoint-rollback: per-turn checkpoint list + inline restore flow.
  loadChatCheckpoints: () => Promise<void>;
  requestRestoreCheckpoint: (checkpointId: string) => void;
  cancelRestoreCheckpoint: () => void;
  confirmRestoreCheckpoint: (checkpointId: string) => Promise<void>;
  removeQueuedMessage: (id: string) => void;
  handleChatScroll: (event: Event) => void;
  resetToolStream: () => void;
  resetChatScroll: () => void;
  exportLogs: (lines: string[], label: string) => void;
  handleLogsScroll: (event: Event) => void;
  handleOpenSidebar: (content: string) => void;
  handleOpenArtifact: (artifactId: string) => void;
  handleOpenArtifactPreview: (message?: string | null) => void;
  askDaibai: (message?: string) => Promise<void>;
  executeDaibaiAction: (actionId: string, payload?: Record<string, unknown>) => Promise<void>;
  confirmDaibaiPendingAction: () => Promise<void>;
  cancelDaibaiPendingConfirmation: () => void;
  syncMeetingPendingConfirmation: () => Promise<void>;
  confirmMeetingPendingApproval: () => Promise<void>;
  cancelMeetingPendingConfirmation: () => void;
  dismissMeetingConfirmRelease: () => void;
  openDaibaiHelpFromModule: (params: {
    moduleLabel: string;
    contextMessage?: string;
    sourceSessionKey?: string;
  }) => Promise<void>;
  loadRobotEnterpriseIdentities: (agentId: string) => Promise<void>;
  syncEmployeeEnterpriseIdentityAccess: (agentIds: string[]) => Promise<void>;
  applyRobotOperationalIdentityGrants: (input: {
    agentId: string;
    agentScope: "owned" | "shared" | "group";
    desired: Array<{ identityId: string; allowedActions: string[] }>;
    sessionKey?: string | null;
  }) => Promise<void>;
  applyIdentityOperationalRobotGrants: (input: {
    identityId: string;
    desiredAgentIds: string[];
    agentScopesById?: Record<string, "owned" | "shared" | "group">;
    sessionKey?: string | null;
  }) => Promise<void>;
  applyRobotEnterpriseIdentityEnrollments: (input: {
    agentId: string;
    desiredIdentityIds: string[];
  }) => Promise<void>;
  applyEnterpriseIdentityRobotBindings: (input: {
    identityId: string;
    agentIds: string[];
    ownedAgentIds: string[];
  }) => Promise<void>;
  handleCloseSidebar: () => void;
  handleSaveSidebarDeliverable: () => Promise<void>;
  handleConfirmDeliverableOverwrite: () => void;
  handleConfirmDeliverableSaveAs: () => void;
  handleCancelDeliverableSaveDecision: () => void;
  handleDeliverableSaveAsFilenameChange: (filename: string) => void;
  handleDeliverableInlineEditApplied: (content: string) => void;
  handleSplitRatioChange: (ratio: number) => void;
  handleBrandLogoFileChange: (file: File | null) => Promise<void>;
  handleResetBrandLogo: () => void;
};
