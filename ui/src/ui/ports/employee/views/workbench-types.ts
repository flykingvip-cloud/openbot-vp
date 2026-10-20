import type {
  AgentLearningAsset,
  BotParticipationProfile,
  Decision,
  Deliverable,
  GroupCapabilityProfile,
  GroupMemoryCapsule,
  LearningProjection,
  ParticipationCapabilityOverlay,
  Review,
  Task,
} from "@openbot/collaboration-core";
import type { ParticipationOverlay } from "@openbot/collaboration-runtime";
import type { TemplateResult } from "lit";
import type { CollaborationSpaceEffectivePolicyView } from "../../../../../../src/gateway/collaboration-dispatch/policy-lane-presentation.js";
import type { Locale } from "../../../../i18n/index.ts";
import type { StewardSessionDefaults } from "../../../builtin-steward-selection.ts";
import type { GatewayBrowserClient } from "../../../gateway.ts";
import type { ThemeMode } from "../../../theme.ts";
import type {
  CollaborationGroupOperatingStateTransport as UiCollaborationGroupOperatingStateTransport,
  CollaborationSpaceBotMemberTransport as UiCollaborationSpaceBotMemberTransport,
  CollaborationSpaceHumanMemberTransport as UiCollaborationSpaceHumanMemberTransport,
  WorkspaceCloudProvider,
} from "../../../types.ts";
import type { renderCron } from "../../../views/cron.ts";
import type { MyAccumulationProps } from "../../../views/my-accumulation.ts";
import type { RobotCapabilityTabProps } from "../../../views/robot-capability-tab.ts";
import type { WorkbenchDataSpaceSettings } from "../data-space.ts";
import type {
  AgentTemplateListItemView,
  GrowthStatusView,
} from "../semantic/view-controller-facade.ts";
import type { WorkbenchRobotHealth } from "../semantic/view-controller-facade.ts";
import type { AssetIncubationLevel } from "../semantic/view-controller-facade.ts";
import type { DevicePairingList } from "../semantic/view-controller-facade.ts";
import type {
  ExtractedSkillPreview,
  QuickSaveSkillFormData,
} from "../semantic/view-controller-facade.ts";
import type {
  UserOperationalIdentityNav,
  UserOperationalIdentitySnapshot,
} from "../semantic/view-controller-facade.ts";
import type { DataDirectoryPanelState } from "./data-directory-page.ts";
import type { EmployeeAssignedTasksCenterProps } from "./employee-assigned-tasks-center.ts";
import type { EmployeeSupervisorCenterProps } from "./employee-supervisor-center.ts";
import type { WorkbenchKnowledgeSurface } from "./home-page-contracts.ts";
import type { WorkbenchNavSelectionHandlers as NavHandlers } from "./workbench-actions.ts";
import type { WorkbenchModuleSelectionHandlers as ModuleHandlers } from "./workbench-actions.ts";
import type {
  WorkbenchDaibaiStageCapabilityContract,
  WorkbenchScheduleEntryDraftInput,
} from "./workbench-capability-contracts.ts";
import type {
  WorkbenchFrontstageModel,
  WorkbenchSessionSummary,
  WorkbenchSidebarItem,
  WorkbenchTeamEntry,
} from "./workbench-home-model.ts";
import type {
  WorkbenchNoticesSummary,
  WorkbenchPendingTasksSummary,
  WorkbenchScheduleItemView,
  WorkbenchScheduleSummary,
  WorkbenchSignalBundle,
  WorkbenchStewardSuggestionSummary,
  WorkbenchUpcomingCollaborationSummary,
} from "./workbench-signals.ts";

export type WorkbenchPrimaryModule =
  | "assistant"
  | "collaboration"
  | "knowledge"
  | "settings"
  | "tasks";
/** 「我的任务」模块内部二级分段：定时任务 / 待我处理 / 开发监督。 */
export type WorkbenchTasksSubTab = "cron" | "assigned" | "supervisor" | "minutes";

export type WorkbenchMyTasksLaneCounts = {
  cronCount?: number;
  assignedCount?: number;
  supervisedCount?: number;
};

export type WorkbenchSettingsView = "system" | "personal";
export type WorkbenchSecuritySettingsTab =
  | "identity"
  | "isolation"
  | "authorization"
  | "data-lifecycle"
  | "audit";

export type WorkbenchSystemSettingsTab =
  | "security"
  | "devices"
  | "robots"
  | "groups"
  | "models"
  | "evolution";

/** System settings tab order. 「进化」 stays last. Opening settings still lands on security. */
export const WORKBENCH_SYSTEM_SETTINGS_TAB_ORDER = [
  "security",
  "devices",
  "robots",
  "groups",
  "models",
  "evolution",
] as const satisfies readonly WorkbenchSystemSettingsTab[];

type MissingSystemSettingsTab = Exclude<
  WorkbenchSystemSettingsTab,
  (typeof WORKBENCH_SYSTEM_SETTINGS_TAB_ORDER)[number]
>;
const _workbenchSystemSettingsTabsCovered: MissingSystemSettingsTab extends never ? true : never =
  true;
void _workbenchSystemSettingsTabsCovered;

export const DEFAULT_WORKBENCH_SYSTEM_SETTINGS_TAB: WorkbenchSystemSettingsTab = "security";
export type WorkbenchPersonalSettingsTab =
  | "account"
  | "authorization"
  | "preferences"
  | "security"
  /** @deprecated Legacy deep-link; normalizes to `security` (隐私与记忆). */
  | "memory"
  | "data"
  | "devices";

/** 个人设置 → 授权 Tab 内：个人自有 / 企业身份 分段切换。 */
export type WorkbenchAuthorizationIdentityTab = "personal" | "enterprise";
export type WorkbenchSystemAuthorizationKey =
  | "fullDiskAccess"
  | "accessibility"
  | "automation"
  | "notifications";
export type WorkbenchRobotWorkbenchTab =
  | "overview"
  | "tasks"
  | "outputs"
  | "workspace"
  | "skills"
  | "memory";

export type WorkbenchSettingsRecentAccessEntry = {
  key: string;
  title: string;
  subtitle: string;
  updatedAt: number | null;
};

export type WorkbenchSettingsRobotEntry = {
  id: string;
  sessionKey: string;
  name: string;
  emoji: string | null;
  source: "owned" | "participating";
  /**
   * Trusted grant scope for personal operational-identity authorization.
   * Seat-owned position robots are `shared` (explicit grant) even when listed as source=owned.
   */
  operationalAgentScope?: "owned" | "shared" | "group";
  status: "running" | "paused";
  /**
   * 真实运行健康（就绪 + 渠道连通），来自 agents.runtime-health；与 status（近期活动）分开。
   * Phase 1+：列表层仅展示三色简略态；完整渠道明细不得出现在员工设置页。
   */
  health?: WorkbenchRobotHealth;
  shareStatus: string | null;
  workspaceState: "configured" | "unconfigured";
  workspacePath?: string | null;
  lastActiveAt: number | null;
  growthStatus?: GrowthStatusView | null;
  /** Phase 0+：详情抽屉可用（My Bots 六块）。 */
  detailAvailable?: boolean;
  capabilityCount?: number;
  growthLevel?: number;
  participatingGroupCount?: number;
};

/** 我的机器人主从右栏详情状态。 */
export type WorkbenchMyBotIdentityDraft = {
  name: string;
  positioning: string;
  role: string;
  personaTraits: string;
  model: string;
};

export type WorkbenchMyBotDetailTab =
  | "identity"
  | "capabilities"
  | "growth"
  | "auth"
  | "collaboration"
  | "data"
  | "danger";

export type WorkbenchMyBotDetailState = {
  agentId: string | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  bot: import("../semantic/my-bot-read-model.ts").MyBotProjection | null;
  identityDraft: WorkbenchMyBotIdentityDraft | null;
  detailTab?: WorkbenchMyBotDetailTab;
};

export type WorkbenchSettingsGroupEntry = {
  sessionKey: string;
  title: string;
  avatar?: string | null;
  groupId: string | null;
  visibilityScope?: string | null;
  groupType?: string | null;
  lifecycleStatus?: string | null;
  memberCount: number;
  activeHumanCount?: number;
  activeBotCount?: number;
  pendingHumanInviteCount?: number;
  pendingBotInviteCount?: number;
  role: "owner" | "member";
  ownerUserId?: string | null;
  ownerLabel?: string | null;
  adminUserIds?: string[];
  coordinatorBotId?: string | null;
  coordinatorBotLabel?: string | null;
  purpose?: string | null;
  currentMission?: string | null;
  collaborationMode?: string | null;
  successCriteria?: string[];
  systemInstructions?: string[];
  confidentialityTier?: string | null;
  finalDecisionPolicy?: {
    mode?: string | null;
    defaultFinalDeciderRole?: string | null;
    allowAgentPublishProposal?: boolean | null;
  } | null;
  rulesSummary?: string[];
  currentOperatingPhase?: string | null;
  /** @deprecated 请读 bootstrapArtifactsReady */
  onboardingInitialized?: boolean;
  bootstrapArtifactsReady?: boolean;
  growthStatus?: GrowthStatusView | null;
  policyMaxVisibleBotRepliesPerRound?: number | null;
  workspacePath?: string | null;
  members?: {
    humans?: Array<{
      userId: string;
      name?: string | null;
      email?: string | null;
      handle?: string | null;
      status?: string | null;
    }>;
    bots?: Array<{
      agentId: string;
      name?: string | null;
      status?: string | null;
      lastActiveAt?: string | null;
      currentTask?: string | null;
    }>;
  } | null;
  invites?: {
    humans?: Array<{
      userId: string;
      name?: string | null;
      email?: string | null;
      handle?: string | null;
      status?: string | null;
    }>;
    bots?: Array<{
      agentId: string;
      name?: string | null;
      status?: string | null;
    }>;
  } | null;
  /** Phase 3：成员四列表（身份/职责/贡献度/最近活跃）；贡献度可由 collaboration.space.get 补齐 */
  memberRows?: import("../semantic/collaboration-group-read-model.ts").CollaborationGroupMemberProjection[];
  /** Phase 3：群治理只读补充（开放讨论 / 最大回复数） */
  policyOpenDiscussion?: boolean | null;
};

export type WorkbenchSettingsGroupDraft = {
  groupId: string;
  title: string;
  avatar: string;
  purpose: string;
  currentMission: string;
  coordinatorBotId: string;
  collaborationMode: string;
  confidentialityTier: string;
  visibilityScope: string;
  successCriteriaText: string;
  rulesSummaryText: string;
  finalDecisionMode: string;
  finalDecisionRole: string;
  allowAgentPublishProposal: boolean;
  openDiscussionWithoutMention: boolean;
  maxVisibleBotRepliesPerRound: number;
  workspacePath: string;
};

export type WorkbenchRobotWorkbenchTaskEntry = {
  id: string;
  title: string;
  updatedAt: number | null;
  status: "running" | "done" | "failed";
};

export type WorkbenchRobotWorkbenchOutputEntry = {
  id: string;
  title: string;
  type: "doc" | "ppt" | "sheet" | "report" | "other";
  createdAt: number | null;
};

export type WorkbenchTeamFilter = "all" | "assistants" | "members" | "spaces";

export type GroupProfileView =
  | "overview"
  | "chat"
  | "governance"
  | "learning-lineage"
  | "participation-detail"
  | "capsules"
  | "capsule-detail"
  | "projection-detail"
  | "asset-detail"
  | "member-detail"
  | "binding-detail"
  | "members"
  | "bindings"
  | "tasks"
  | "task-detail"
  | "deliverables"
  | "deliverable-detail"
  | "reviews"
  | "review-detail"
  | "decisions"
  | "decision-detail"
  | "memories"
  | "insights";

export type WorkbenchGovernanceObjectKind =
  | "task"
  | "deliverable"
  | "review"
  | "decision"
  | "capsule";

export type WorkbenchGovernanceHandoffDraft = {
  from: string;
  to: string;
  reason: string;
  remainingWork: string;
  acceptanceCriteria: string[];
  completedArtifacts?: string[];
  assumptions?: string[];
  blockers?: string[];
};

export type WorkbenchGovernanceTransitionOpts = {
  selectedOption?: string;
  handoff?: WorkbenchGovernanceHandoffDraft;
};

export type WorkbenchNavSelectionHandlers = NavHandlers;
export type WorkbenchModuleSelectionHandlers = ModuleHandlers;

export type WorkbenchSidebarMembersProps = {
  navGroupsCollapsed?: Record<string, boolean>;
  groupMembersBySelectionKey?: Record<
    string,
    Array<{ name?: string | null; handle?: string | null }>
  >;
  growthStatusBySelectionKey?: Record<string, GrowthStatusView>;
  activeSessionKey?: string;
  activeGrowthStatus?: GrowthStatusView | null;
  directoryOrgs?: unknown[];
  shellReadModel?: { agents?: WorkbenchSidebarItem[] };
  onGroupProfileViewChange?: ((view: GroupProfileView) => void) | null;
  onPrimaryModuleChange?: ((module: WorkbenchPrimaryModule) => void) | null;
  onTeamSelectedKeyChange?: ((key: string) => void) | null;
  onSelectSession?: ((sessionKey: string) => void) | null;
  onLoadGroupMembers?:
    | ((params: {
        selectionKey: string;
        channelId: string;
        title: string;
        fallbackGroupId?: string | null;
        force?: boolean;
      }) => Promise<void>)
    | null;
  onToggleSidebarGroup?: ((groupId: string) => void) | null;
};

export type WorkbenchSettingsSurfaceProps = Record<string, unknown>;

export type WorkbenchSharedAgentEntry = {
  id: string;
  name?: string | null;
  identity?: {
    name?: string | null;
    emoji?: string | null;
  } | null;
  ownerId?: string | null;
  ownerName?: string | null;
  scope?: string | null;
  shareStatus?: string | null;
};

export type WorkbenchCollaborationHumanMemberSnapshot = {
  userId: UiCollaborationSpaceHumanMemberTransport["userId"];
  name: UiCollaborationSpaceHumanMemberTransport["name"] | null;
  handle: UiCollaborationSpaceHumanMemberTransport["handle"] | null;
  status: UiCollaborationSpaceHumanMemberTransport["status"] | null;
  presenceStatus?: UiCollaborationSpaceHumanMemberTransport["presenceStatus"];
  lastActiveAt?: UiCollaborationSpaceHumanMemberTransport["lastActiveAt"];
};

export type WorkbenchCollaborationBotMemberSnapshot = {
  agentId: UiCollaborationSpaceBotMemberTransport["agentId"];
  name: UiCollaborationSpaceBotMemberTransport["name"] | null;
  status: UiCollaborationSpaceBotMemberTransport["status"] | null;
  runtimeStatus?: UiCollaborationSpaceBotMemberTransport["runtimeStatus"];
  lastActiveAt?: UiCollaborationSpaceBotMemberTransport["lastActiveAt"];
  currentTask?: UiCollaborationSpaceBotMemberTransport["currentTask"];
  openTaskCount?: UiCollaborationSpaceBotMemberTransport["openTaskCount"];
};

export type WorkbenchCollaborationMemberRosterSnapshot = {
  humans: WorkbenchCollaborationHumanMemberSnapshot[];
  bots: WorkbenchCollaborationBotMemberSnapshot[];
};

export type WorkbenchCollaborationInviteRosterSnapshot = WorkbenchCollaborationMemberRosterSnapshot;

export type WorkbenchCollaborationSpaceSnapshot = {
  id: string;
  groupId: string | null;
  title: string | null;
  avatar?: string | null;
  visibilityScope?: string | null;
  ownerUserId?: string | null;
  coordinatorBotId?: string | null;
  purpose?: string | null;
  currentMission?: string | null;
  collaborationMode?: string | null;
  finalDecisionPolicy?: GroupCapabilityProfile["finalDecisionPolicy"] | null;
  workspacePath?: string | null;
  systemInstructions?: string[];
  confidentialityTier?: string | null;
  operatingState?: UiCollaborationGroupOperatingStateTransport;
  /** P1-A5 ⑤ (BP-20): server-compiled frozen EffectivePolicy + provenance. */
  effectivePolicy?: CollaborationSpaceEffectivePolicyView | null;
  members: WorkbenchCollaborationMemberRosterSnapshot;
  invites: WorkbenchCollaborationInviteRosterSnapshot;
};

export type WorkbenchCollaborationGovernanceSnapshot = {
  sessionKey: string;
  groupId?: string | null;
  personalCapabilities: string[];
  groupProfile?: GroupCapabilityProfile | null;
  participationOverlay?: ParticipationOverlay | null;
  learningObjects?: {
    groupId: string;
    botId?: string | null;
    groupCapabilities: GroupCapabilityProfile | null;
    participations: BotParticipationProfile[];
    participationOverlays: ParticipationCapabilityOverlay[];
    capsules: GroupMemoryCapsule[];
    projections: LearningProjection[];
    assets: AgentLearningAsset[];
    tasks: Task[];
    deliverables: Deliverable[];
    reviews: Review[];
    decisions: Decision[];
  } | null;
  learningObjectsLoading?: boolean;
  learningObjectsError?: string | null;
  observabilityLoading?: boolean;
  observabilityError?: string | null;
  observabilitySnapshot?:
    | import("../../../controllers/collaboration-observability.ts").CollaborationObservabilitySnapshot
    | null;
  onRefreshCollaborationObservability?: (() => void) | null;
  governanceActionBusyKey?: string | null;
  governanceActionError?: string | null;
  selectedTaskId?: string | null;
  selectedDeliverableId?: string | null;
  selectedReviewId?: string | null;
  selectedDecisionId?: string | null;
  selectedCapsuleId?: string | null;
  selectedDecisionOptionDraft?: string | null;
  selectedDecisionRationaleDraft?: string | null;
  selectedDecisionOptionsDraft?: Array<{ optionId: string; title: string }> | null;
};

export type WorkbenchCollaborationMemberGovernanceRosterEntry = {
  id: string;
  label: string;
  kind: "human" | "bot";
  /** Live WS presence for humans; bots omit this and may use runtimeStatus elsewhere. */
  presenceStatus?: "online" | "offline" | null;
};

export type WorkbenchCollaborationMemberGovernanceCandidate = {
  id: string;
  label: string;
  subtitle?: string;
  kind: "human" | "bot";
  actionMode: "add" | "invite";
  orgSegments?: string[];
  disabled?: boolean;
};

export type WorkbenchCollaborationPendingHumanInvite = {
  intentId: string;
  label: string;
  message?: string;
};

export type WorkbenchCollaborationPendingBotInvite = {
  agentId: string;
  label: string;
  ownerId?: string;
  ownerName?: string;
  canApprove?: boolean;
};

export type WorkbenchCreatorDirectoryEntry = {
  name: string;
  path: string;
};

export type WorkbenchCreatorDirectoryBrowserState = {
  open: boolean;
  busy: boolean;
  error: string | null;
  currentPath: string;
  parentPath: string | null;
  entries: WorkbenchCreatorDirectoryEntry[];
};

export type WorkbenchCreatorSelectionEntry = {
  id: string;
  label: string;
  subtitle?: string;
  group?: string;
  ownerId?: string;
  ownerName?: string;
  /** When set, create-space bot routing uses this instead of ownerId heuristics. */
  actionMode?: "add" | "invite";
};

export type WorkbenchCreatorValidationState = {
  state: "idle" | "validating" | "valid" | "invalid";
  message: string | null;
  resolvedPath: string | null;
  readable: boolean;
  writable: boolean;
};

export type WorkbenchCreatorCloudConfigState = {
  endpoint: string;
  bucket: string;
  rootPrefix: string;
  region?: string;
  accountName?: string;
} | null;

export type WorkbenchCreatorCloudConnectionState = {
  state: "idle" | "testing" | "success" | "error";
  message: string | null;
  canRead: boolean;
  canWrite: boolean;
};

export type WorkbenchWorkspaceSelectorMode = "default-local" | "default-cloud" | "robot-local";

export type WorkbenchWorkspaceSelectorHostContext = {
  isLocalGateway: boolean;
  platform: string;
  homedir: string;
  supportsNativeDirectoryChooser: boolean;
  browseRoots: Array<{ id: string; label: string; path: string }>;
};

export type WorkbenchWorkspaceSelectorState = {
  open: boolean;
  mode: WorkbenchWorkspaceSelectorMode;
  title: string;
  description: string;
  localDirectoryBrowser: WorkbenchCreatorDirectoryBrowserState | null;
  hostContext?: WorkbenchWorkspaceSelectorHostContext | null;
  selectedPath: string;
  targetId?: string | null;
  targetLabel?: string | null;
  cloudProvider?: WorkspaceCloudProvider;
  cloudRegion?: string;
  cloudBucket?: string;
  cloudRootPrefix?: string;
  cloudEndpoint?: string;
  cloudAccountName?: string;
  cloudGeneratedConfig?: WorkbenchCreatorCloudConfigState;
  cloudConnection?: WorkbenchCreatorCloudConnectionState;
};

export type WorkbenchCollaborationMemberGovernanceState = {
  activeGroupKey: string | null;
  activeGroupRole?: "owner" | "member" | null;
  currentOwnerUserId?: string | null;
  title: string;
  prompt: string;
  busy: boolean;
  invitingHumanId?: string | null;
  invitingBotId?: string | null;
  error: string | null;
  result: string | null;
  canReset: boolean;
  selectorKind: "human" | "bot" | null;
  search: string;
  currentHumans: WorkbenchCollaborationMemberGovernanceRosterEntry[];
  currentBots: WorkbenchCollaborationMemberGovernanceRosterEntry[];
  pendingHumanInvites: WorkbenchCollaborationPendingHumanInvite[];
  pendingBotInvites: WorkbenchCollaborationPendingBotInvite[];
  /** Present when the signed-in user has a pending human invite for this space. */
  selfPendingInvite?: WorkbenchCollaborationPendingHumanInvite | null;
  candidateHumans: WorkbenchCollaborationMemberGovernanceCandidate[];
  candidateBots: WorkbenchCollaborationMemberGovernanceCandidate[];
  selectedHumanIds: string[];
  selectedBotIds: string[];
};

export type WorkbenchAgentCreatorStep = "intent" | "review" | "identity";
export type WorkbenchAgentCreatorRoleSource = "ai" | "template";
export type WorkbenchDesignTagCategory = "capability" | "workMode" | "permission";

export type WorkbenchDesignTagDraft = {
  familyId: string;
  roleId: string;
  capabilities: string[];
  workModes: string[];
  permissions: string[];
  customTags: Array<{ id: string; category: WorkbenchDesignTagCategory; label: string }>;
  addingCategory: WorkbenchDesignTagCategory | null;
  addingText: string;
};

export type WorkbenchAgentDesignMappingView = {
  headline: string;
  requestItems: Array<{ label: string; text: string }>;
  role: {
    display: string;
    resolutionKind: string;
    blueprintId?: string;
    evidence: string[];
  };
  capabilities: Array<{ need: string; status: string; skillKey?: string }>;
  workMode: { taskPatterns: string[]; schedule?: string; delivery?: string };
  safetyBoundary: Array<{ id: string; effect: string; risk: string }>;
  gaps: { questions: string[]; missing: string[]; unresolved: string[] };
};

export type WorkbenchAgentDesignState = {
  intentText: string;
  revisionText: string;
  busy: boolean;
  sessionId: string | null;
  sessionStatus: string | null;
  mapping: WorkbenchAgentDesignMappingView | null;
  tagDraft: WorkbenchDesignTagDraft | null;
  canConfirm: boolean;
  confirmed: boolean;
  validationStatus: string | null;
  createRequest: {
    name: string;
    blueprintId?: string;
    blueprintVersion?: string;
    skillKeys: string[];
  } | null;
  instantiateNote: string | null;
};

export type WorkbenchAgentCreatorState = {
  open: boolean;
  busy: boolean;
  error: string | null;
  name: string;
  emoji: string;
  step?: WorkbenchAgentCreatorStep;
  roleSource?: WorkbenchAgentCreatorRoleSource;
  design: WorkbenchAgentDesignState;
  templateId: string;
  templates: AgentTemplateListItemView[];
  templatesLoading: boolean;
  managedWorkspace?: boolean;
  workspaceKind: "local" | "cloud";
  localPath: string;
  localValidation: WorkbenchCreatorValidationState;
  localDirectoryBrowser: WorkbenchCreatorDirectoryBrowserState | null;
  cloudProvider: WorkspaceCloudProvider;
  cloudRegion: string;
  cloudBucket: string;
  cloudRootPrefix: string;
  cloudEndpoint: string;
  cloudAccountName: string;
  cloudAccessKeyId: string;
  cloudSecretAccessKey: string;
  cloudGeneratedConfig: WorkbenchCreatorCloudConfigState;
  cloudConnection: WorkbenchCreatorCloudConnectionState;
  cloudDirectoryBrowser: WorkbenchCreatorDirectoryBrowserState | null;
  cloudSelectedPath: string;
};

export type WorkbenchSpaceCreatorState = {
  open: boolean;
  busy: boolean;
  error: string | null;
  title: string;
  avatar: string;
  purpose: string;
  currentMission: string;
  systemInstructions: string;
  groupId: string;
  step: "details" | "members";
  candidateHumans: WorkbenchCreatorSelectionEntry[];
  candidateBots: WorkbenchCreatorSelectionEntry[];
  selectedHumanIds: string[];
  selectedBotIds: string[];
  coordinatorBotId: string;
};

export type WorkbenchCollaborationSpacesSnapshot = {
  spaces: WorkbenchCollaborationSpaceSnapshot[];
  archivedGroupIds?: string[];
};

export type WorkbenchShellReadModel = {
  agents?: WorkbenchSidebarItem[];
  contacts?: WorkbenchSidebarItem[];
  groups?: WorkbenchSidebarItem[];
  teamAssistants?: WorkbenchTeamEntry[];
  teamMembers?: WorkbenchTeamEntry[];
  activeSession?: WorkbenchSessionSummary | null;
  activeSessionUpdatedAt?: number | null;
};

export type WorkbenchCollaborationReadModel = {
  teamSpaces?: WorkbenchTeamEntry[];
  savedTeamCount?: number;
};

export type WorkbenchStageProps = {
  sessionDefaults?: StewardSessionDefaults;
  settingsView?: WorkbenchSettingsView;
  personalSettingsTab?: WorkbenchPersonalSettingsTab;
  systemSettingsTab?: WorkbenchSystemSettingsTab;
  tasksSubTab?: WorkbenchTasksSubTab;
  assignedTasksProps?: EmployeeAssignedTasksCenterProps | null;
  myTasksLaneCounts?: WorkbenchMyTasksLaneCounts | null;
  robotWorkbenchTab?: WorkbenchRobotWorkbenchTab;
  myAccumulationProps?: MyAccumulationProps | null;
  authPanel: TemplateResult | null;
  chatContent: TemplateResult;
  chatComposer: TemplateResult | null;
  activeSessionKey: string;
  daibaiGuideAcknowledged?: boolean;
  activeGrowthStatus?: GrowthStatusView | null;
  connected?: boolean;
  client?: GatewayBrowserClient | null;
  currentLocale?: Locale;
  currentTheme?: ThemeMode;
  userProfileName?: string;
  userProfileSignature?: string;
  tenantLabel?: string;
  currentSeatId?: string | null;
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
  recentAccessEntries?: WorkbenchSettingsRecentAccessEntry[];
  robotRosterStatus?: "ready" | "unbound" | "zero" | "query_failed" | "sync_failed";
  robotEntries?: WorkbenchSettingsRobotEntry[];
  groupEntries?: WorkbenchSettingsGroupEntry[];
  robotCapabilityTabProps?: RobotCapabilityTabProps | null;
  myBotDetail?: WorkbenchMyBotDetailState | null;
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
  robotWorkbenchTasks?: WorkbenchRobotWorkbenchTaskEntry[];
  robotWorkbenchOutputs?: WorkbenchRobotWorkbenchOutputEntry[];
  chatFocusMode?: boolean;
  chatShowThinking?: boolean;
  platformAuthEnabled?: boolean;
  passwordChangeBusy?: boolean;
  passwordChangeError?: string | null;
  passwordChangeNotice?: string | null;
  pendingSeatOfferBusy?: boolean;
  pendingSeatOfferError?: string | null;
  pendingSeatOfferNotice?: string | null;
  ownedRobotDeleteBusyId?: string | null;
  ownedRobotDeleteError?: string | null;
  ownedRobotDeletePrompt?: { agentId: string; name: string } | null;
  ownedRobotDeleteDisposition?: "delete_all" | "keep_artifacts_conversations" | "soft_unbind";
  onDeleteOwnedRobot?:
    | ((
        agentId: string,
        displayName: string,
        memoryDisposal?: "delete_all" | "keep_artifacts_conversations" | "soft_unbind",
      ) => Promise<void> | void)
    | null;
  onOpenOwnedRobotDeletePrompt?: ((agentId: string, name: string) => void) | null;
  onOwnedRobotDeleteDispositionChange?:
    | ((value: "delete_all" | "keep_artifacts_conversations" | "soft_unbind") => void)
    | null;
  onCancelOwnedRobotDelete?: (() => void) | null;
  onConfirmOwnedRobotDelete?: (() => Promise<void> | void) | null;
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
  onOpenForgotPassword?: (() => Promise<void> | void) | null;
  onPasswordCurrentChange?: ((value: string) => void) | null;
  onPasswordNewChange?: ((value: string) => void) | null;
  onChangePassword?: (() => Promise<void> | void) | null;
  onAcceptPendingSeatOffer?: ((offerId: string) => Promise<void> | void) | null;
  onDeclinePendingSeatOffer?: ((offerId: string) => Promise<void> | void) | null;
  onSystemSettingsTabChange?: ((tab: WorkbenchSystemSettingsTab) => void) | null;
  onPersonalSettingsTabChange?: ((tab: WorkbenchPersonalSettingsTab) => void) | null;
  onRevealDataDirectoryInFinder?: (() => Promise<void> | void) | null;
  onOpenDataMigrationWizard?: (() => void) | null;
  onCloseDataMigrationWizard?: (() => void) | null;
  onDataMigrationTargetDraftChange?: ((value: string) => void) | null;
  onStartDataMigration?: (() => Promise<void> | void) | null;
  onExportOpenBotData?: (() => Promise<void> | void) | null;
  onForgetMemoryAgentIdChange?: ((value: string) => void) | null;
  onForgetMemoryKeyChange?: ((value: string) => void) | null;
  onForgetMemoryEntry?: (() => Promise<void> | void) | null;
  onRevokeAccessGrant?: ((grantId: string) => Promise<void> | void) | null;
  onTasksSubTabChange?: ((tab: WorkbenchTasksSubTab) => void) | null;
  onRobotWorkbenchTabChange?: ((tab: WorkbenchRobotWorkbenchTab) => void) | null;
  onSystemSettingsGroupSelect?: ((groupId: string) => void) | null;
  onSystemSettingsGroupDraftChange?: ((patch: Partial<WorkbenchSettingsGroupDraft>) => void) | null;
  onSaveSystemSettingsGroup?: (() => Promise<void> | void) | null;
  onResetSystemSettingsGroup?: (() => Promise<void> | void) | null;
  onDissolveSystemSettingsGroup?: (() => Promise<void> | void) | null;
  onLeaveSystemSettingsGroup?: (() => Promise<void> | void) | null;
  onTransferSystemSettingsGroupOwnership?: ((userId: string) => Promise<void> | void) | null;
  onOpenSystemSettingsGroupMembers?: (() => void) | null;
  onExportSystemSettingsGroupSummary?: (() => void) | null;
  onResolveSystemSettingsGroupSwitch?:
    | ((action: "save" | "discard" | "cancel") => Promise<void> | void)
    | null;
  onRefreshMyDevices?: (() => Promise<void> | void) | null;
  onRotateMyDeviceToken?: (
    deviceId: string,
    role: string,
    scopes?: string[],
  ) => Promise<void> | void;
  onRevokeMyDeviceToken?: (deviceId: string, role: string) => Promise<void> | void;
  lastError?: string | null;
  groupProfileView?: GroupProfileView | null;
  collaborationSpacesSnapshot?: WorkbenchCollaborationSpacesSnapshot;
  collaborationGovernanceSnapshot?: WorkbenchCollaborationGovernanceSnapshot | null;
  collaborationRoundPlan?:
    | import("../../../../../../src/gateway/collaboration-dispatch/types.js").CollaborationRoundPlanPayload
    | null;
  collaborationSpeakingAgentId?: string | null;
  collaborationRoundSummaries?: Record<string, string>;
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
  collaborationOptionalSuggestions?: import("../semantic/view-controller-facade.ts").CollaborationOptionalSuggestion[];
  collaborationMissionAdvanceBusy?: boolean;
  collaborationMissionAdvanceNotice?: string | null;
  collaborationMissionAdvanceError?: string | null;
  onAdvanceCollaborationMission?: () => void | Promise<void>;
  onDismissCollaborationOptionalSuggestion?: (id: string) => void;
  groupMembers?: Array<{
    id: string;
    kind: string;
    name?: string | null;
    handle?: string | null;
    avatarUrl?: string | null;
  }>;
  ownedAgents?: Array<{
    id: string;
    name?: string | null;
    identity?: {
      name?: string | null;
      emoji?: string | null;
    } | null;
    scope?: string | null;
    shareStatus?: string | null;
  }>;
  pendingBotApprovalCount?: number;
  onSelectSession?: ((sessionKey: string) => void) | null;
  onOpenAssistantSettings?: (() => void) | null;
  onOpenChannelSettings?: (() => void) | null;
  onOpenCron?: (() => void) | null;
  onOpenOverview?: (() => void) | null;
  onGroupProfileViewChange?: ((view: GroupProfileView) => void) | null;
  onOpenGovernanceObjectDetail?: ((kind: WorkbenchGovernanceObjectKind, id: string) => void) | null;
  onTransitionGovernanceObject?:
    | ((
        kind: WorkbenchGovernanceObjectKind,
        id: string,
        toStatus: string,
        opts?: WorkbenchGovernanceTransitionOpts,
      ) => void)
    | null;
  onPrefillChatDraft?: ((draft: string) => void) | null;
  onDecisionOptionDraftChange?: ((optionId: string | null) => void) | null;
  onDecisionRationaleDraftChange?: ((value: string) => void) | null;
  onDecisionOptionTitleDraftChange?: ((optionId: string, value: string) => void) | null;
  onAddDecisionOptionDraft?: (() => void) | null;
  onRemoveDecisionOptionDraft?: ((optionId: string) => void) | null;
  onSaveDecisionDraft?: ((decisionId: string) => void) | null;
  collaborationMemberGovernance?: WorkbenchCollaborationMemberGovernanceState | null;
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
  /** Cloud computer is layout-fullscreen; exit lives in the stage header. */
  computerFullscreen?: boolean;
  onExitComputerFullscreen?: (() => void) | null;
  previewArtifactAvailable?: boolean;
  showSystemAssetSuggestCta?: boolean;
  showWeakAssetHint?: boolean;
  canOrganizeCurrentCapability?: boolean;
  assetIncubationLevel?: AssetIncubationLevel | null;
  skillSaveModalInline?: boolean;
  skillSaveModalOpen?: boolean;
  skillSaveModalBusy?: boolean;
  skillSaveModalError?: string | null;
  skillSaveModalFormData?: QuickSaveSkillFormData | null;
  skillSaveModalPreferEnterpriseSubmit?: boolean;
  skillExtractedPreview?: ExtractedSkillPreview | null;
  skillSaveModalShowEnterpriseSubmitAction?: boolean;
  skillAutofillHint?: string | null;
  skillAvailableGroups?: Array<{ id: string; name: string }>;
  onOpenSkillSave?: (() => void) | null;
  onOpenSkillOrganizeManual?: (() => void) | null;
  onOpenSkillSaveAndContinue?: (() => void) | null;
  onSkillSaveFormChange?: ((patch: Partial<QuickSaveSkillFormData>) => void) | null;
  onSubmitSkillSave?: (() => Promise<void> | void) | null;
  onSubmitSkillSaveAndContinue?: (() => Promise<void> | void) | null;
  onCloseSkillSave?: (() => void) | null;
  onLogout?: (() => void) | null;
  userOperationalIdentitySnapshot?: UserOperationalIdentitySnapshot | null;
  userOperationalIdentityBusy?: boolean;
  userOperationalIdentityError?: string | null;
  userOperationalIdentityNotice?: string | null;
  userOperationalIdentityNav?: UserOperationalIdentityNav;
  userOperationalIdentityUsageRange?: import("../semantic/view-controller-facade.ts").UserOperationalIdentityUsageRange;
  userOperationalIdentityUsageEventId?: string | null;
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
  userOperationalIdentityContinuationNotice?: string | null;
  robotIdentityGrantFocusAgentId?: string | null;
  onRefreshUserOperationalIdentities?: (() => Promise<void> | void) | null;
  onOpenUserOperationalIdentityEditor?: ((provider?: string) => void) | null;
  onUserOperationalIdentityNavChange?: ((nav: UserOperationalIdentityNav) => void) | null;
  onUserOperationalIdentityUsageRangeChange?:
    | ((
        range: import("../semantic/view-controller-facade.ts").UserOperationalIdentityUsageRange,
      ) => void)
    | null;
  onSelectUserOperationalIdentityUsageEvent?: ((eventId: string | null) => void) | null;
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
  onUserOperationalIdentityEditorCredentialHandleIdChange?: ((value: string) => void) | null;
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
        sessionKey?: string | null;
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
  onOpenUserOperationalIdentityBindingFlow?: (() => void) | null;
  onOpenPersonalEmailBrowserGuideFromChat?: (() => void) | null;
  onOpenPersonalOperationalIdentity?:
    | ((options?: { openEditor?: boolean; agentId?: string; scroll?: boolean }) => void)
    | null;
  onRobotIdentityGrantFocusHandled?: (() => void) | null;
  onResumeUserOperationalIdentityContinuation?:
    | ((continuationToken?: string) => Promise<void> | void)
    | null;
  onOpenInstallCapability?: ((robotId: string) => void) | null;
  onOpenMyAssets?: (() => void) | null;
  onOpenMyBotDetail?: ((agentId: string) => void) | null;
  onCloseMyBotDetail?: (() => void) | null;
  onMyBotDetailTabChange?: ((tab: WorkbenchMyBotDetailTab) => void) | null;
  onMyBotIdentityDraftChange?: ((patch: Partial<WorkbenchMyBotIdentityDraft>) => void) | null;
  onSaveMyBotIdentity?: (() => Promise<void> | void) | null;
  onMyBotOpenGroup?: ((groupId: string) => void) | null;
  sidebarOpen?: boolean;
  sidebarContent?: string | null;
  signals?: WorkbenchSignalBundle | null;
};

export type WorkbenchProps = Partial<WorkbenchDaibaiStageCapabilityContract> & {
  sessionDefaults?: StewardSessionDefaults;
  navCollapsed?: boolean;
  navGroupsCollapsed: Record<string, boolean>;
  brandLogoSrc?: string | null;
  bundledBrandLogoSrc?: string | null;
  customBrandLogoEnabled?: boolean;
  brandLogoError?: string | null;
  primaryModule: WorkbenchPrimaryModule;
  teamSelectedKey: string;
  activeSessionKey: string;
  activeGrowthStatus?: GrowthStatusView | null;
  growthStatusBySelectionKey?: Record<string, GrowthStatusView>;
  connected: boolean;
  client?: GatewayBrowserClient | null;
  currentLocale: Locale;
  currentTheme: ThemeMode;
  userProfileName: string;
  userProfileSignature: string;
  daibaiGuideAcknowledged?: boolean;
  tenantLabel?: string;
  currentSeatId?: string | null;
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
  settingsView?: WorkbenchSettingsView;
  personalSettingsTab?: WorkbenchPersonalSettingsTab;
  systemSettingsTab?: WorkbenchSystemSettingsTab;
  tasksSubTab?: WorkbenchTasksSubTab;
  assignedTasksProps?: EmployeeAssignedTasksCenterProps | null;
  myTasksLaneCounts?: WorkbenchMyTasksLaneCounts | null;
  robotWorkbenchTab?: WorkbenchRobotWorkbenchTab;
  myAccumulationProps?: MyAccumulationProps | null;
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
  recentAccessEntries?: WorkbenchSettingsRecentAccessEntry[];
  robotRosterStatus?: "ready" | "unbound" | "zero" | "query_failed" | "sync_failed";
  robotEntries?: WorkbenchSettingsRobotEntry[];
  groupEntries?: WorkbenchSettingsGroupEntry[];
  robotCapabilityTabProps?: RobotCapabilityTabProps | null;
  myBotDetail?: WorkbenchMyBotDetailState | null;
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
  robotWorkbenchTasks?: WorkbenchRobotWorkbenchTaskEntry[];
  robotWorkbenchOutputs?: WorkbenchRobotWorkbenchOutputEntry[];
  chatFocusMode?: boolean;
  chatShowThinking?: boolean;
  platformAuthEnabled?: boolean;
  passwordChangeBusy?: boolean;
  passwordChangeError?: string | null;
  passwordChangeNotice?: string | null;
  pendingSeatOfferBusy?: boolean;
  pendingSeatOfferError?: string | null;
  pendingSeatOfferNotice?: string | null;
  ownedRobotDeleteBusyId?: string | null;
  ownedRobotDeleteError?: string | null;
  ownedRobotDeletePrompt?: { agentId: string; name: string } | null;
  ownedRobotDeleteDisposition?: "delete_all" | "keep_artifacts_conversations" | "soft_unbind";
  passwordCurrentValue?: string;
  passwordNewValue?: string;
  userOperationalIdentitySnapshot?: UserOperationalIdentitySnapshot | null;
  userOperationalIdentityBusy?: boolean;
  userOperationalIdentityError?: string | null;
  userOperationalIdentityNotice?: string | null;
  userOperationalIdentityNav?: UserOperationalIdentityNav;
  userOperationalIdentityUsageRange?: import("../semantic/view-controller-facade.ts").UserOperationalIdentityUsageRange;
  userOperationalIdentityUsageEventId?: string | null;
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
  userOperationalIdentityEditorGrantAgentId?: string;
  userOperationalIdentityReturnSessionKey?: string | null;
  userOperationalIdentityContinuationNotice?: string | null;
  onRefreshUserOperationalIdentities?: () => Promise<void> | void;
  onOpenUserOperationalIdentityEditor?: (provider?: string) => void;
  onUserOperationalIdentityNavChange?: (nav: UserOperationalIdentityNav) => void;
  onUserOperationalIdentityUsageRangeChange?: (
    range: import("../semantic/view-controller-facade.ts").UserOperationalIdentityUsageRange,
  ) => void;
  onSelectUserOperationalIdentityUsageEvent?: (eventId: string | null) => void;
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
    tenantId?: string;
    seatId?: string;
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
  onOpenUserOperationalIdentityBindingFlow?: () => void;
  onOpenPersonalEmailBrowserGuideFromChat?: () => void;
  onOpenPersonalOperationalIdentity?: (options?: {
    openEditor?: boolean;
    agentId?: string;
    scroll?: boolean;
  }) => void;
  robotIdentityGrantFocusAgentId?: string | null;
  onRobotIdentityGrantFocusHandled?: () => void;
  onResumeUserOperationalIdentityContinuation?: (
    continuationToken?: string,
  ) => Promise<void> | void;
  frontstageModel?: WorkbenchFrontstageModel | null;
  shellReadModel: WorkbenchShellReadModel;
  collaborationReadModel: WorkbenchCollaborationReadModel;
  knowledgeSurface?: WorkbenchKnowledgeSurface | null;
  collaborationSpacesSnapshot?: WorkbenchCollaborationSpacesSnapshot;
  collaborationGovernanceSnapshot?: WorkbenchCollaborationGovernanceSnapshot | null;
  collaborationRoundPlan?:
    | import("../../../../../../src/gateway/collaboration-dispatch/types.js").CollaborationRoundPlanPayload
    | null;
  collaborationSpeakingAgentId?: string | null;
  collaborationRoundSummaries?: Record<string, string>;
  collaborationRulesSummary?: string[];
  collaborationRulesSections?: import("../../../collaboration/collaboration-rules-summary.ts").CollaborationRulesDrawerSection[];
  collaborationReasonDrawerOpen?: boolean;
  collaborationRulesDrawerOpen?: boolean;
  onOpenCollaborationReasonDrawer?: () => void;
  onCloseCollaborationReasonDrawer?: () => void;
  onOpenCollaborationRulesDrawer?: () => void;
  onCloseCollaborationRulesDrawer?: () => void;
  previewArtifactAvailable?: boolean;
  memberGovernanceDrawerOpen?: boolean;
  artifactPreviewOpen?: boolean;
  onOpenCollaborationMemberGovernance?: () => void;
  onCloseCollaborationMemberGovernance?: () => void;
  collaborationOptionalSuggestions?: import("../semantic/view-controller-facade.ts").CollaborationOptionalSuggestion[];
  collaborationMissionAdvanceBusy?: boolean;
  collaborationMissionAdvanceNotice?: string | null;
  collaborationMissionAdvanceError?: string | null;
  onAdvanceCollaborationMission?: () => void | Promise<void>;
  onDismissCollaborationOptionalSuggestion?: (id: string) => void;
  policyEnvelope?: unknown;
  cronNext: number | null;
  lastError: string | null;
  groupProfileView?: GroupProfileView | null;
  authPanel: TemplateResult | null;
  chatContent: TemplateResult;
  chatComposer: TemplateResult | null;
  sidebarOpen?: boolean;
  sidebarContent?: string | null;
  groupMembers?: WorkbenchStageProps["groupMembers"];
  sharedAgents: WorkbenchSharedAgentEntry[];
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
  pendingBotApprovalCountsBySelectionKey?: Record<string, number>;
  sharedAgentDraftId: string;
  sharedAgentDraftName: string;
  sharedAgentDraftOwnerId: string;
  sharedAgentDraftOwnerName: string;
  sharedAgentDraftEmoji: string;
  sharedAgentBusy: boolean;
  sharedAgentError: string | null;
  onLocaleChange: (locale: Locale) => void;
  onThemeChange: (theme: ThemeMode) => void;
  onUserProfileNameChange: (value: string) => void;
  onUserProfileSignatureChange: (value: string) => void;
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
  onOpenForgotPassword?: (() => Promise<void> | void) | null;
  onPasswordCurrentChange?: ((value: string) => void) | null;
  onPasswordNewChange?: ((value: string) => void) | null;
  onChangePassword?: (() => Promise<void> | void) | null;
  onAcceptPendingSeatOffer?: ((offerId: string) => Promise<void> | void) | null;
  onDeclinePendingSeatOffer?: ((offerId: string) => Promise<void> | void) | null;
  onSystemSettingsTabChange?: ((tab: WorkbenchSystemSettingsTab) => void) | null;
  onPersonalSettingsTabChange?: ((tab: WorkbenchPersonalSettingsTab) => void) | null;
  onRevealDataDirectoryInFinder?: (() => Promise<void> | void) | null;
  onOpenDataMigrationWizard?: (() => void) | null;
  onCloseDataMigrationWizard?: (() => void) | null;
  onDataMigrationTargetDraftChange?: ((value: string) => void) | null;
  onStartDataMigration?: (() => Promise<void> | void) | null;
  onExportOpenBotData?: (() => Promise<void> | void) | null;
  onForgetMemoryAgentIdChange?: ((value: string) => void) | null;
  onForgetMemoryKeyChange?: ((value: string) => void) | null;
  onForgetMemoryEntry?: (() => Promise<void> | void) | null;
  onRevokeAccessGrant?: ((grantId: string) => Promise<void> | void) | null;
  onTasksSubTabChange?: ((tab: WorkbenchTasksSubTab) => void) | null;
  onRobotWorkbenchTabChange?: ((tab: WorkbenchRobotWorkbenchTab) => void) | null;
  onSystemSettingsGroupSelect?: ((groupId: string) => void) | null;
  onSystemSettingsGroupDraftChange?: ((patch: Partial<WorkbenchSettingsGroupDraft>) => void) | null;
  onSaveSystemSettingsGroup?: (() => Promise<void> | void) | null;
  onResetSystemSettingsGroup?: (() => Promise<void> | void) | null;
  onDissolveSystemSettingsGroup?: (() => Promise<void> | void) | null;
  onLeaveSystemSettingsGroup?: (() => Promise<void> | void) | null;
  onTransferSystemSettingsGroupOwnership?: ((userId: string) => Promise<void> | void) | null;
  onOpenSystemSettingsGroupMembers?: (() => void) | null;
  onExportSystemSettingsGroupSummary?: (() => void) | null;
  onResolveSystemSettingsGroupSwitch?:
    | ((action: "save" | "discard" | "cancel") => Promise<void> | void)
    | null;
  onRefreshMyDevices?: (() => Promise<void> | void) | null;
  onRotateMyDeviceToken?: (
    deviceId: string,
    role: string,
    scopes?: string[],
  ) => Promise<void> | void;
  onRevokeMyDeviceToken?: (deviceId: string, role: string) => Promise<void> | void;
  onSharedAgentDraftIdChange: (value: string) => void;
  onSharedAgentDraftNameChange: (value: string) => void;
  onSharedAgentDraftOwnerIdChange: (value: string) => void;
  onSharedAgentDraftOwnerNameChange: (value: string) => void;
  onSharedAgentDraftEmojiChange: (value: string) => void;
  onUpsertSharedAgent: () => Promise<void>;
  onImportOwnedAgents: () => Promise<void>;
  onRemoveSharedAgent: (agentId: string) => Promise<void>;
  onLogout: () => void;
  profileMenuOpen: boolean;
  onProfileMenuOpenChange: (open: boolean) => void;
  onPrimaryModuleChange: (module: WorkbenchPrimaryModule) => void;
  onOpenSystemSettings?: (() => void) | null;
  onOpenPersonalSettings?: (() => void) | null;
  onTeamSelectedKeyChange: (
    key: string,
    options?: { preferredModule?: WorkbenchPrimaryModule },
  ) => void;
  onOpenInstallCapability?: ((robotId: string) => void) | null;
  onOpenMyAssets?: (() => void) | null;
  onOpenMyBotDetail?: ((agentId: string) => void) | null;
  onCloseMyBotDetail?: (() => void) | null;
  onMyBotDetailTabChange?: ((tab: WorkbenchMyBotDetailTab) => void) | null;
  onMyBotIdentityDraftChange?: ((patch: Partial<WorkbenchMyBotIdentityDraft>) => void) | null;
  onSaveMyBotIdentity?: (() => Promise<void> | void) | null;
  onMyBotOpenGroup?: ((groupId: string) => void) | null;
  onDeleteOwnedRobot?:
    | ((
        agentId: string,
        displayName: string,
        memoryDisposal?: "delete_all" | "keep_artifacts_conversations" | "soft_unbind",
      ) => Promise<void> | void)
    | null;
  onOpenOwnedRobotDeletePrompt?: ((agentId: string, name: string) => void) | null;
  onOwnedRobotDeleteDispositionChange?:
    | ((value: "delete_all" | "keep_artifacts_conversations" | "soft_unbind") => void)
    | null;
  onCancelOwnedRobotDelete?: (() => void) | null;
  onConfirmOwnedRobotDelete?: (() => Promise<void> | void) | null;
  onSelectSession: (
    sessionKey: string,
    options?: { preferredModule?: WorkbenchPrimaryModule },
  ) => void;
  /**
   * Acknowledge sibling sessions when the user opens a nav entry. The shell
   * uses this to bump `sessionSeenAt` for every session that contributes to
   * an assistant's or space's unread badge so the count clears immediately
   * after the user clicks it. Optional so older callers stay compatible.
   */
  onAcknowledgeSiblingSessions?: ((sessionKeys: readonly string[]) => void) | null;
  onToggleSidebar?: (() => void) | null;
  onToggleSidebarGroup?: ((groupId: string) => void) | null;
  onOpenAssistantSettings?: (() => void) | null;
  onOpenChannelSettings?: (() => void) | null;
  onOpenCron?: (() => void) | null;
  onOpenOverview?: (() => void) | null;
  /** Open a single 今日日程 entry for reading. cron:<jobId> -> cron task detail. */
  onOpenScheduleEntry?: ((entryId: string) => void) | null;
  /** Open a collaboration space (待办事项 collaboration entry) by its groupId. */
  onOpenCollaborationSpace?: ((groupId: string) => void) | null;
  /**
   * Open a collaboration invite from 待办事项 (`invite:bot:…` / `invite:human:…`)
   * into the member-governance approval surface.
   */
  onOpenCollaborationInvite?:
    | ((params: { kind: "bot" | "human"; groupId: string; subjectId: string }) => void)
    | null;
  /**
   * Deep-link from the steward suggestion bar by server `kind`
   * (attention/conflict → knowledge governance; other kinds → steward inbox).
   */
  onOpenStewardSuggestion?: ((kind: string) => void) | null;
  /** CollabDispatch D1: workbench mirror → chat meeting confirm card. */
  onOpenMeetingInviteReview?: (() => void) | null;
  onConfirmTenantNotice?: ((noticeId: string) => void | Promise<void>) | null;
  onAddScheduleEntry?: ((input: WorkbenchScheduleEntryDraftInput) => void | Promise<void>) | null;
  onCancelScheduleEntry?: ((id: string) => void | Promise<void>) | null;
  scheduleItems?: WorkbenchScheduleItemView[] | null;
  /** Gateway pending-work projection — threaded into home signals (待办事项). */
  pendingTasks?: WorkbenchPendingTasksSummary | null;
  notices?: WorkbenchNoticesSummary | null;
  upcomingCollaboration?: WorkbenchUpcomingCollaborationSummary | null;
  stewardSuggestion?: WorkbenchStewardSuggestionSummary | null;
  schedule?: WorkbenchScheduleSummary | null;
  onPrefillChatDraft?: ((draft: string) => void) | null;
  onOpenAgentCreator?: (() => void) | null;
  onOpenSpaceCreator?: (() => void) | null;
  agentCreator?: WorkbenchAgentCreatorState | null;
  spaceCreator?: WorkbenchSpaceCreatorState | null;
  onCloseCreator?: (() => void) | null;
  onAgentCreatorNameChange?: ((value: string) => void) | null;
  onAgentCreatorEmojiChange?: ((value: string) => void) | null;
  onAgentCreatorTemplateChange?: ((value: string) => void) | null;
  onAgentCreatorWorkspaceKindChange?: ((value: "local" | "cloud") => void) | null;
  onAgentCreatorLocalPathChange?: ((value: string) => void) | null;
  onValidateAgentCreatorLocalWorkspace?: (() => Promise<void>) | null;
  onOpenAgentCreatorLocalBrowser?: (() => Promise<void>) | null;
  onCloseAgentCreatorLocalBrowser?: (() => void) | null;
  onNavigateAgentCreatorLocalBrowser?: ((path: string | null) => Promise<void>) | null;
  onSelectAgentCreatorLocalDirectory?: ((path: string) => void) | null;
  onAgentCreatorCloudProviderChange?: ((value: WorkspaceCloudProvider) => void) | null;
  onAgentCreatorCloudRegionChange?: ((value: string) => void) | null;
  onAgentCreatorCloudBucketChange?: ((value: string) => void) | null;
  onAgentCreatorCloudRootPrefixChange?: ((value: string) => void) | null;
  onAgentCreatorCloudEndpointChange?: ((value: string) => void) | null;
  onAgentCreatorCloudAccountNameChange?: ((value: string) => void) | null;
  onAgentCreatorCloudAccessKeyIdChange?: ((value: string) => void) | null;
  onAgentCreatorCloudSecretAccessKeyChange?: ((value: string) => void) | null;
  onGenerateAgentCreatorCloudConfig?: (() => Promise<void>) | null;
  onTestAgentCreatorCloudConnection?: (() => Promise<void>) | null;
  onOpenAgentCreatorCloudBrowser?: (() => Promise<void>) | null;
  onCloseAgentCreatorCloudBrowser?: (() => void) | null;
  onNavigateAgentCreatorCloudBrowser?: ((path: string | null) => Promise<void>) | null;
  onSelectAgentCreatorCloudDirectory?: ((path: string) => void) | null;
  onCreateAgent?: (() => Promise<void>) | null;
  onAgentCreatorDesignIntentChange?: ((value: string) => void) | null;
  onAgentCreatorDesignRevisionChange?: ((value: string) => void) | null;
  onAgentCreatorDesignTagDraftChange?: ((draft: WorkbenchDesignTagDraft) => void) | null;
  onCompileAgentDesign?: (() => Promise<void>) | null;
  onReviseAgentDesign?: (() => Promise<void>) | null;
  onConfirmAgentDesign?: (() => Promise<void>) | null;
  onAgentCreatorWizardBack?: (() => void) | null;
  onAgentCreatorUseTemplatePath?: (() => void) | null;
  onAgentCreatorSelectStep?: ((step: WorkbenchAgentCreatorStep) => void) | null;
  onSpaceCreatorTitleChange?: ((value: string) => void) | null;
  onSpaceCreatorAvatarChange?: ((value: string) => void) | null;
  onSpaceCreatorPurposeChange?: ((value: string) => void) | null;
  onSpaceCreatorCurrentMissionChange?: ((value: string) => void) | null;
  onSpaceCreatorSystemInstructionsChange?: ((value: string) => void) | null;
  onSpaceCreatorGroupIdChange?: ((value: string) => void) | null;
  onSpaceCreatorBack?: (() => void) | null;
  onSpaceCreatorToggleHumanSelection?: ((id: string) => void) | null;
  onSpaceCreatorToggleBotSelection?: ((id: string) => void) | null;
  onSpaceCreatorCoordinatorChange?: ((value: string) => void) | null;
  onCreateSpace?: (() => Promise<void>) | null;
  onOpenGovernanceObjectDetail?: (kind: WorkbenchGovernanceObjectKind, id: string) => void;
  onTransitionGovernanceObject?: (
    kind: WorkbenchGovernanceObjectKind,
    id: string,
    toStatus: string,
    opts?: WorkbenchGovernanceTransitionOpts,
  ) => void;
  onDecisionOptionDraftChange?: (optionId: string | null) => void;
  onDecisionRationaleDraftChange?: (value: string) => void;
  onDecisionOptionTitleDraftChange?: (optionId: string, value: string) => void;
  onAddDecisionOptionDraft?: () => void;
  onRemoveDecisionOptionDraft?: (optionId: string) => void;
  onSaveDecisionDraft?: (decisionId: string) => void;
  collaborationMemberGovernance?: WorkbenchCollaborationMemberGovernanceState | null;
  onMemberGovernancePromptChange?: (value: string) => void;
  onMemberGovernanceParse?: () => void;
  onMemberGovernanceOpenSelector?: (kind: "human" | "bot" | null) => void;
  onMemberGovernanceSearchChange?: (value: string) => void;
  onMemberGovernanceToggleHumanSelection?: (id: string) => void;
  onMemberGovernanceToggleBotSelection?: (id: string) => void;
  onMemberGovernanceCommitSelection?: () => void;
  onMemberGovernanceInviteHuman?: (id: string) => void;
  onMemberGovernanceInviteBot?: (id: string) => void;
  onMemberGovernanceCancelInvite?: (intentId: string) => void;
  onMemberGovernanceRemoveMember?: (id: string, kind: "human" | "bot") => void;
  onMemberGovernanceApproveBotInvite?: (agentId: string) => void;
  onMemberGovernanceRejectBotInvite?: (agentId: string) => void;
  onMemberGovernanceAcceptSelfInvite?: () => void;
  onMemberGovernanceRejectSelfInvite?: () => void;
  onMemberGovernanceReset?: () => void;
  onOpenFilePreview?: (() => void) | null;
  /** Cloud computer is layout-fullscreen; exit lives in the stage header. */
  computerFullscreen?: boolean;
  onExitComputerFullscreen?: (() => void) | null;
  showSystemAssetSuggestCta?: boolean;
  showWeakAssetHint?: boolean;
  canOrganizeCurrentCapability?: boolean;
  assetIncubationLevel?: AssetIncubationLevel | null;
  skillSaveModalInline?: boolean;
  skillSaveModalOpen?: boolean;
  skillSaveModalBusy?: boolean;
  skillSaveModalError?: string | null;
  skillSaveModalFormData?: QuickSaveSkillFormData | null;
  skillSaveModalPreferEnterpriseSubmit?: boolean;
  skillExtractedPreview?: ExtractedSkillPreview | null;
  skillSaveModalShowEnterpriseSubmitAction?: boolean;
  skillAutofillHint?: string | null;
  skillAvailableGroups?: Array<{ id: string; name: string }>;
  onOpenSkillSave?: (() => void) | null;
  onOpenSkillOrganizeManual?: (() => void) | null;
  onOpenSkillSaveAndContinue?: (() => void) | null;
  onSkillSaveFormChange?: ((patch: Partial<QuickSaveSkillFormData>) => void) | null;
  onSubmitSkillSave?: (() => Promise<void> | void) | null;
  onSubmitSkillSaveAndContinue?: (() => Promise<void> | void) | null;
  onCloseSkillSave?: (() => void) | null;
  onLoadGroupMembers: (params: {
    selectionKey: string;
    channelId: string;
    title: string;
    fallbackGroupId?: string | null;
    force?: boolean;
  }) => Promise<void>;
  onGroupProfileViewChange?: (view: GroupProfileView) => void;
  onBrandLogoFileChange?: (file: File | null) => Promise<void>;
  onResetBrandLogo?: () => void;
};

export type { UiCollaborationGroupOperatingStateTransport };
