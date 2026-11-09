export type UpdateAvailable = import("../../../src/infra/update-startup.js").UpdateAvailable;
import type { GroupCapabilityProfile } from "@openbot/collaboration-core";
import type { ParticipationOverlay } from "@openbot/collaboration-runtime";
import type { CronJobBase } from "../../../src/cron/types-shared.js";
import type { CollaborationSpaceEffectivePolicyView } from "../../../src/gateway/collaboration-dispatch/policy-lane-presentation.js";
import type { GatewayCollaborationLearningSnapshot } from "../../../src/gateway/collaboration-learning.js";
import type { ConfigUiHints } from "../../../src/shared/config-ui-hints-types.js";
import type {
  GatewayAgentRow as SharedGatewayAgentRow,
  SessionsListResultBase,
  SessionsPatchResultBase,
} from "../../../src/shared/session-types.js";
export type { ConfigUiHints } from "../../../src/shared/config-ui-hints-types.js";

export type ChannelsStatusSnapshot = {
  ts: number;
  channelOrder: string[];
  channelLabels: Record<string, string>;
  channelDetailLabels?: Record<string, string>;
  channelSystemImages?: Record<string, string>;
  channelMeta?: ChannelUiMetaEntry[];
  channels: Record<string, unknown>;
  channelAccounts: Record<string, ChannelAccountSnapshot[]>;
  channelDefaultAccountId: Record<string, string>;
};

export type ChannelUiMetaEntry = {
  id: string;
  label: string;
  detailLabel: string;
  description?: string;
  systemImage?: string;
};

export const CRON_CHANNEL_LAST = "last";

export type ChannelAccountSnapshot = {
  accountId: string;
  name?: string | null;
  enabled?: boolean | null;
  configured?: boolean | null;
  linked?: boolean | null;
  running?: boolean | null;
  connected?: boolean | null;
  reconnectAttempts?: number | null;
  lastConnectedAt?: number | null;
  lastError?: string | null;
  lastStartAt?: number | null;
  lastStopAt?: number | null;
  lastInboundAt?: number | null;
  lastOutboundAt?: number | null;
  lastProbeAt?: number | null;
  /** Feishu tenant_key from 企业通道. Not the OpenBot account id. */
  platformEnterpriseId?: string | null;
  enterpriseImCapability?: {
    checkedAt: string;
    projectGroupRead: "granted" | "missing" | "unknown" | "not_checked";
    projectDocs: "granted" | "missing" | "unknown" | "not_checked";
    sendAsUser: "granted" | "missing" | "unknown" | "not_checked";
    newMessageTrigger: "granted" | "missing" | "unknown" | "not_checked";
  } | null;
  enterpriseImChildExecutionBlocked?: boolean;
  enterpriseImEmployeeUiHint?: "enterprise_not_open" | "waiting_admin_scopes" | "app_can_attempt";
  mode?: string | null;
  dmPolicy?: string | null;
  allowFrom?: string[] | null;
  tokenSource?: string | null;
  botTokenSource?: string | null;
  appTokenSource?: string | null;
  credentialSource?: string | null;
  audienceType?: string | null;
  audience?: string | null;
  webhookPath?: string | null;
  webhookUrl?: string | null;
  baseUrl?: string | null;
  allowUnmentionedGroups?: boolean | null;
  cliPath?: string | null;
  dbPath?: string | null;
  port?: number | null;
  probe?: unknown;
  audit?: unknown;
  application?: unknown;
};

export type CollaborationSpaceHumanMemberTransport = {
  userId: string;
  name?: string | null;
  /** Present when roster identity is an email (or dual-written for matching). */
  email?: string | null;
  handle?: string | null;
  status?: string | null;
  presenceStatus?: "online" | "offline" | null;
  lastActiveAt?: string | null;
};

export type CollaborationSpaceBotMemberTransport = {
  agentId: string;
  name?: string | null;
  status?: string | null;
  runtimeStatus?: "online" | "busy" | "offline" | "unknown" | null;
  lastActiveAt?: string | null;
  currentTask?: string | null;
  openTaskCount?: number | null;
};

export type CollaborationSpaceMemberRosterTransport = {
  humans?: CollaborationSpaceHumanMemberTransport[];
  bots?: CollaborationSpaceBotMemberTransport[];
} | null;

export type CollaborationSpaceInviteRosterTransport = CollaborationSpaceMemberRosterTransport;

export type CollaborationGroupOperatingStateTransport = {
  groupId: string;
  groupProfile?: {
    displayName?: string | null;
    visibilityScope?: string | null;
    groupType?: string | null;
    lifecycleStatus?: string | null;
    ownerUserId?: string | null;
    purpose?: string | null;
    currentMission?: string | null;
    discussionScope?: string | null;
    expectedOutputs?: string[] | null;
    collaborationMode?: string | null;
    successCriteria?: string[] | null;
  } | null;
  governance?: {
    ownerUserId?: string | null;
    adminUserIds?: string[] | null;
    coordinatorBotId?: string | null;
    finalDecisionPolicy?: {
      mode?: string | null;
      defaultFinalDeciderRole?: string | null;
      allowAgentPublishProposal?: boolean | null;
    } | null;
  } | null;
  collaborationPolicy?: {
    humanStartsNewRound?: boolean | null;
    mentionBotMustRespond?: boolean | null;
    mentionHumanNotifiesOnly?: boolean | null;
    openDiscussionWithoutMention?: boolean | null;
    maxVisibleBotRepliesPerRound?: number | null;
    botMaySelfAdvanceWithoutHuman?: boolean | null;
    entersWaitingForHumanAfterVisibleTurnsExhausted?: boolean | null;
    replyLanguage?: "zh" | "en" | "inherit" | null;
  } | null;
  memberRoleMap?: Array<{
    memberId: string;
    memberKind?: string | null;
    label?: string | null;
    governanceRole?: string | null;
    collaborationRole?: string | null;
    status?: string | null;
  }> | null;
  activeContext?: {
    currentOperatingPhase?: string | null;
    currentMission?: string | null;
    currentTaskId?: string | null;
    currentReviewId?: string | null;
    currentDecisionId?: string | null;
    currentDeliverableId?: string | null;
    waitingForHuman?: boolean | null;
    summary?: string | null;
    updatedAtMs?: number | null;
  } | null;
  onboardingStatus?: {
    initialized?: boolean | null;
    bootstrappedAtMs?: number | null;
    bootstrapMemoryId?: string | null;
    charterCapsuleId?: string | null;
  } | null;
  bootstrapStatus?: {
    initialized?: boolean | null;
    bootstrappedAtMs?: number | null;
    bootstrapMemoryId?: string | null;
    charterCapsuleId?: string | null;
    workspaceInitialized?: boolean | null;
  } | null;
  growthStatus?: {
    lifecycleState?: string | null;
    dimensions?: {
      identity?: number | null;
      capability?: number | null;
      knowledge?: number | null;
      habits?: number | null;
      alignment?: number | null;
    } | null;
    activationScore?: number | null;
    operationalScore?: number | null;
    capabilityReadiness?: boolean | null;
    isActivated?: boolean | null;
    templateId?: string | null;
  } | null;
  groupMemoryRefs?: {
    bootstrapMemoryId?: string | null;
    charterCapsuleId?: string | null;
    latestCapsuleIds?: string[] | null;
  } | null;
  updatedAtMs?: number | null;
} | null;

export type CollaborationPolicyTransport =
  NonNullable<CollaborationGroupOperatingStateTransport>["collaborationPolicy"];

export type CollaborationSpaceSnapshotTransport = {
  id: string;
  groupId?: string | null;
  title?: string | null;
  avatar?: string | null;
  visibilityScope?: string | null;
  ownerUserId?: string | null;
  purpose?: string | null;
  currentMission?: string | null;
  coordinatorBotId?: string | null;
  collaborationMode?: string | null;
  successCriteria?: string[] | null;
  systemInstructions?: string[] | null;
  confidentialityTier?: string | null;
  finalDecisionPolicy?: {
    mode?: string | null;
    defaultFinalDeciderRole?: string | null;
    allowAgentPublishProposal?: boolean | null;
  } | null;
  operatingState?: CollaborationGroupOperatingStateTransport;
  /**
   * P1-A5 ⑤ (BP-20): server-compiled frozen EffectivePolicy + provenance
   * (collaboration.spaces.list / collaboration.space.get). The UI renders it and never
   * compiles policy itself.
   */
  effectivePolicy?: CollaborationSpaceEffectivePolicyView | null;
  workspacePath?: string | null;
  members?: CollaborationSpaceMemberRosterTransport;
  invites?: CollaborationSpaceInviteRosterTransport;
};

export type CollaborationSpacesListResult = {
  spaces?: CollaborationSpaceSnapshotTransport[];
  archivedGroupIds?: string[];
} | null;

export type WorkbenchCollaborationHumanMember = CollaborationSpaceHumanMemberTransport;
export type WorkbenchCollaborationBotMember = CollaborationSpaceBotMemberTransport;
export type WorkbenchCollaborationMemberRoster = CollaborationSpaceMemberRosterTransport;
export type WorkbenchCollaborationInviteRoster = CollaborationSpaceInviteRosterTransport;
export type WorkbenchCollaborationSpaceSnapshot = CollaborationSpaceSnapshotTransport;

export type WhatsAppSelf = {
  e164?: string | null;
  jid?: string | null;
};

export type WhatsAppDisconnect = {
  at: number;
  status?: number | null;
  error?: string | null;
  loggedOut?: boolean | null;
};

export type WhatsAppStatus = {
  configured: boolean;
  linked: boolean;
  authAgeMs?: number | null;
  self?: WhatsAppSelf | null;
  running: boolean;
  connected: boolean;
  lastConnectedAt?: number | null;
  lastDisconnect?: WhatsAppDisconnect | null;
  reconnectAttempts: number;
  lastMessageAt?: number | null;
  lastEventAt?: number | null;
  lastError?: string | null;
};

export type TelegramBot = {
  id?: number | null;
  username?: string | null;
};

export type TelegramWebhook = {
  url?: string | null;
  hasCustomCert?: boolean | null;
};

export type TelegramProbe = {
  ok: boolean;
  status?: number | null;
  error?: string | null;
  elapsedMs?: number | null;
  bot?: TelegramBot | null;
  webhook?: TelegramWebhook | null;
};

export type TelegramStatus = {
  configured: boolean;
  tokenSource?: string | null;
  running: boolean;
  mode?: string | null;
  lastStartAt?: number | null;
  lastStopAt?: number | null;
  lastError?: string | null;
  probe?: TelegramProbe | null;
  lastProbeAt?: number | null;
};

export type DiscordBot = {
  id?: string | null;
  username?: string | null;
};

export type DiscordProbe = {
  ok: boolean;
  status?: number | null;
  error?: string | null;
  elapsedMs?: number | null;
  bot?: DiscordBot | null;
};

export type DiscordStatus = {
  configured: boolean;
  tokenSource?: string | null;
  running: boolean;
  lastStartAt?: number | null;
  lastStopAt?: number | null;
  lastError?: string | null;
  probe?: DiscordProbe | null;
  lastProbeAt?: number | null;
};

export type GoogleChatProbe = {
  ok: boolean;
  status?: number | null;
  error?: string | null;
  elapsedMs?: number | null;
};

export type GoogleChatStatus = {
  configured: boolean;
  credentialSource?: string | null;
  audienceType?: string | null;
  audience?: string | null;
  webhookPath?: string | null;
  webhookUrl?: string | null;
  running: boolean;
  lastStartAt?: number | null;
  lastStopAt?: number | null;
  lastError?: string | null;
  probe?: GoogleChatProbe | null;
  lastProbeAt?: number | null;
};

export type SlackBot = {
  id?: string | null;
  name?: string | null;
};

export type SlackTeam = {
  id?: string | null;
  name?: string | null;
};

export type SlackProbe = {
  ok: boolean;
  status?: number | null;
  error?: string | null;
  elapsedMs?: number | null;
  bot?: SlackBot | null;
  team?: SlackTeam | null;
};

export type SlackStatus = {
  configured: boolean;
  botTokenSource?: string | null;
  appTokenSource?: string | null;
  running: boolean;
  lastStartAt?: number | null;
  lastStopAt?: number | null;
  lastError?: string | null;
  probe?: SlackProbe | null;
  lastProbeAt?: number | null;
};

export type SignalProbe = {
  ok: boolean;
  status?: number | null;
  error?: string | null;
  elapsedMs?: number | null;
  version?: string | null;
};

export type SignalStatus = {
  configured: boolean;
  baseUrl: string;
  running: boolean;
  lastStartAt?: number | null;
  lastStopAt?: number | null;
  lastError?: string | null;
  probe?: SignalProbe | null;
  lastProbeAt?: number | null;
};

export type IMessageProbe = {
  ok: boolean;
  error?: string | null;
};

export type IMessageStatus = {
  configured: boolean;
  running: boolean;
  lastStartAt?: number | null;
  lastStopAt?: number | null;
  lastError?: string | null;
  cliPath?: string | null;
  dbPath?: string | null;
  probe?: IMessageProbe | null;
  lastProbeAt?: number | null;
};

export type NostrProfile = {
  name?: string | null;
  displayName?: string | null;
  about?: string | null;
  picture?: string | null;
  banner?: string | null;
  website?: string | null;
  nip05?: string | null;
  lud16?: string | null;
};

export type NostrStatus = {
  configured: boolean;
  publicKey?: string | null;
  running: boolean;
  lastStartAt?: number | null;
  lastStopAt?: number | null;
  lastError?: string | null;
  profile?: NostrProfile | null;
};

export type MSTeamsProbe = {
  ok: boolean;
  error?: string | null;
  appId?: string | null;
};

export type MSTeamsStatus = {
  configured: boolean;
  running: boolean;
  lastStartAt?: number | null;
  lastStopAt?: number | null;
  lastError?: string | null;
  port?: number | null;
  probe?: MSTeamsProbe | null;
  lastProbeAt?: number | null;
};

export type ConfigSnapshotIssue = {
  path: string;
  message: string;
};

export type ConfigSnapshot = {
  path?: string | null;
  exists?: boolean | null;
  raw?: string | null;
  hash?: string | null;
  parsed?: unknown;
  valid?: boolean | null;
  config?: Record<string, unknown> | null;
  issues?: ConfigSnapshotIssue[] | null;
};

export type ConfigSchemaResponse = {
  schema: unknown;
  uiHints: ConfigUiHints;
  version: string;
  generatedAt: string;
};

export type PresenceEntry = {
  instanceId?: string | null;
  host?: string | null;
  ip?: string | null;
  version?: string | null;
  platform?: string | null;
  deviceFamily?: string | null;
  modelIdentifier?: string | null;
  roles?: string[] | null;
  scopes?: string[] | null;
  mode?: string | null;
  lastInputSeconds?: number | null;
  reason?: string | null;
  text?: string | null;
  ts?: number | null;
};

export type GatewaySessionsDefaults = {
  model: string | null;
  contextTokens: number | null;
};

export type GatewayAgentRow = SharedGatewayAgentRow;

export type ArtifactType =
  | "binary"
  | "doc"
  | "sheet"
  | "slide"
  | "image"
  | "archive"
  | "dataset"
  | "report";

export type ArtifactStorageClass =
  | "object-store"
  | "collaborative-doc"
  | "external-link"
  | "inline-media";

export type ArtifactLifecycle =
  | "created"
  | "stored"
  | "shared"
  | "delivered"
  | "versioned"
  | "revoked"
  | "expired"
  | "archived";

export type ArtifactSubjectRef = {
  type: "user" | "bot" | "system" | "tenant" | "org";
  id: string;
};

export type SharedArtifact = {
  artifactId: string;
  artifactType: ArtifactType;
  storageClass: ArtifactStorageClass;
  title: string;
  mimeType?: string;
  size?: number;
  checksum?: string;
  provider: string;
  providerResourceId?: string;
  openUrl?: string;
  previewUrl?: string;
  downloadUrl?: string;
  editUrl?: string;
  permissionMode?: "link" | "named-principal" | "inherited";
  shareScope?: "private" | "group" | "org" | "public-link" | "invited-users";
  ownerRef?: ArtifactSubjectRef;
  tenantRef?: { id: string };
  createdBy: ArtifactSubjectRef;
  createdAt: string;
  updatedAt: string;
  sourceMessage?: string;
  sourceTaskId?: string;
  sourceSessionId?: string;
  lifecycleState: ArtifactLifecycle;
  providerMetadata?: Record<string, unknown>;
};

export type ArtifactVersion = {
  versionId: string;
  artifactId: string;
  label: string;
  providerVersionRef?: string;
  createdAt: string;
  createdBy: ArtifactSubjectRef;
  changeSummary?: string;
  openUrl?: string;
  downloadUrl?: string;
};

export type ArtifactDelivery = {
  deliveryId: string;
  artifactId: string;
  versionId?: string;
  channel: "software";
  conversationRef: string;
  messageId?: string;
  renderMode: "text-link" | "card" | "native-file" | "mixed";
  renderPayload?: Record<string, unknown>;
  deliveryStatus: "pending" | "sent" | "failed";
  deliveredAt?: string;
};

export type ShareIntent = {
  intentId: string;
  artifactId: string;
  targetType: "user" | "group" | "bot" | "channel" | "org";
  targetRef: string;
  requestedRole: "view" | "comment" | "edit";
  deliveryMode: "link" | "card" | "native-attachment" | "smart";
  identityBindingMode: "named" | "link" | "inherited";
  approvalRequired: boolean;
  requestedBy: ArtifactSubjectRef;
  status: "created" | "pending_approval" | "resolved" | "failed";
  createdAt: string;
};

export type ShareGrant = {
  grantId: string;
  artifactId: string;
  provider: string;
  principalType: "user" | "service" | "org" | "link";
  principalId: string;
  grantedRole: "view" | "comment" | "edit";
  grantMode: "named-principal" | "org-link" | "public-link" | "inherited";
  openUrl?: string;
  downloadUrl?: string;
  editUrl?: string;
  expiresAt?: string;
  status: "requested" | "granted" | "revoked";
  grantedAt?: string;
  grantedBy?: ArtifactSubjectRef;
};

export type ArtifactWorkspaceSidebar = {
  artifact: SharedArtifact;
  versions: ArtifactVersion[];
  deliveries: ArtifactDelivery[];
  grants: ShareGrant[];
  intents: ShareIntent[];
};

export type ArtifactLibrarySidebar = {
  artifacts: SharedArtifact[];
  conversationRef: string;
};

export type AgentsListResult = {
  defaultId: string;
  mainKey: string;
  scope: string;
  agents: GatewayAgentRow[];
};

export type MeshOwnershipRecord = {
  tenantId: string;
  subjectKind: "agent" | "group";
  subjectId: string;
  positionId: string;
  positionLabel: string;
  createdByUserId: string;
  createdByUserLabel: string;
  currentManagerUserId: string;
  currentManagerLabel: string;
  bindingStatus: "active" | "revoked" | "transferred";
  createdAt: string;
  updatedAt: string;
};

export type MeshOwnershipListResult = {
  records: MeshOwnershipRecord[];
  /** Tenant-wide mesh roster (enterprise); not personal agents.list. */
  agents?: Array<{
    id: string;
    name?: string | null;
    identity?: { name?: string | null } | null;
    ownerId?: string | null;
    ownerName?: string | null;
  }>;
};

export type ToolCatalogProfile = {
  id: "minimal" | "coding" | "messaging" | "full";
  label: string;
};

export type ToolCatalogEntry = {
  id: string;
  label: string;
  description: string;
  source: "core" | "plugin";
  pluginId?: string;
  optional?: boolean;
  defaultProfiles: Array<"minimal" | "coding" | "messaging" | "full">;
};

export type ToolCatalogGroup = {
  id: string;
  label: string;
  source: "core" | "plugin";
  pluginId?: string;
  tools: ToolCatalogEntry[];
};

export type ToolsCatalogResult = {
  agentId: string;
  profiles: ToolCatalogProfile[];
  groups: ToolCatalogGroup[];
};

export type AgentIdentityResult = {
  agentId: string;
  name: string;
  avatar: string;
  emoji?: string;
};

export type AgentFileEntry = {
  name: string;
  path: string;
  missing: boolean;
  size?: number;
  updatedAtMs?: number;
  content?: string;
};

export type AgentsFilesListResult = {
  agentId: string;
  workspace: string;
  files: AgentFileEntry[];
};

export type AgentsFilesGetResult = {
  agentId: string;
  workspace: string;
  file: AgentFileEntry;
};

export type AgentsFilesSetResult = {
  ok: true;
  agentId: string;
  workspace: string;
  file: AgentFileEntry;
};

export type AgentsWorkspaceBrowseEntry = {
  name: string;
  path: string;
};

export type AgentsWorkspaceBrowseResult = {
  currentPath: string;
  parentPath?: string;
  entries: AgentsWorkspaceBrowseEntry[];
};

export type WorkspaceDirectoryEntry = {
  name: string;
  path: string;
};

export type WorkspaceLocalValidateResult = {
  ok: boolean;
  resolvedPath: string;
  isDirectory: boolean;
  readable: boolean;
  writable: boolean;
  errorCode?: string;
  message?: string;
};

export type WorkspaceLocalBrowseResult = {
  currentPath: string;
  parentPath?: string;
  entries: WorkspaceDirectoryEntry[];
};

export type WorkspaceLocalChooseResult = {
  cancelled: boolean;
  path?: string;
  message?: string;
};

export type WorkspaceCloudProvider =
  | "aliyun-oss"
  | "aws-s3"
  | "azure-blob"
  | "huawei-obs"
  | "s3-compatible";

export type WorkspaceCloudGeneratedConfig = {
  provider: WorkspaceCloudProvider;
  endpoint: string;
  bucket: string;
  rootPrefix: string;
  region?: string;
  accountName?: string;
};

export type WorkspaceCloudConnectionResult = {
  ok: true;
  capabilities: {
    canRead: boolean;
    canWrite: boolean;
  };
};

export type WorkspaceCloudBrowseResult = {
  bucket: string;
  currentPath: string;
  parentPath?: string;
  directories: WorkspaceDirectoryEntry[];
};

export type WorkspacesCreateResult = {
  ok: true;
  workspaceId: string;
  runtimePath: string;
  workspace: {
    id: string;
    name: string;
    kind: "local" | "cloud";
    status: "draft" | "testing" | "ready" | "error";
    runtimePath: string;
    createdAt: string;
    updatedAt: string;
    credentialRef?: string;
    lastError?: string | null;
  };
};

export type GatewaySessionRow = {
  key: string;
  kind: "direct" | "group" | "global" | "unknown";
  label?: string;
  displayName?: string;
  derivedTitle?: string;
  lastMessagePreview?: string;
  channel?: string;
  groupChannel?: string;
  groupId?: string;
  chatType?: string;
  surface?: string;
  subject?: string;
  room?: string;
  space?: string;
  updatedAt: number | null;
  sessionId?: string;
  systemSent?: boolean;
  abortedLastRun?: boolean;
  thinkingLevel?: string;
  verboseLevel?: string;
  reasoningLevel?: string;
  elevatedLevel?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  model?: string;
  modelProvider?: string;
  contextTokens?: number;
  collaborationPersonalCapabilities?: string[];
  collaborationGroupProfile?: GroupCapabilityProfile;
  collaborationParticipationOverlay?: ParticipationOverlay;
};

export type SessionsListResult = SessionsListResultBase<GatewaySessionsDefaults, GatewaySessionRow>;
export type { GatewayCollaborationLearningSnapshot };

export type SessionsPatchResult = SessionsPatchResultBase<{
  sessionId: string;
  updatedAt?: number;
  thinkingLevel?: string;
  verboseLevel?: string;
  reasoningLevel?: string;
  elevatedLevel?: string;
}>;

export type {
  CostUsageDailyEntry,
  CostUsageSummary,
  SessionsUsageEntry,
  SessionsUsageResult,
  SessionsUsageTotals,
  SessionUsageTimePoint,
  SessionUsageTimeSeries,
} from "./usage-types.ts";

export type CronSchedule =
  | { kind: "at"; at: string }
  | { kind: "every"; everyMs: number; anchorMs?: number }
  | { kind: "cron"; expr: string; tz?: string; staggerMs?: number };

export type CronSessionTarget = "main" | "isolated";
export type CronWakeMode = "next-heartbeat" | "now";

export type CronPayload =
  | { kind: "systemEvent"; text: string }
  | {
      kind: "agentTurn";
      message: string;
      model?: string;
      thinking?: string;
      timeoutSeconds?: number;
      lightContext?: boolean;
    };

export type CronDelivery = {
  mode: "none" | "announce" | "webhook";
  channel?: string;
  to?: string;
  accountId?: string;
  bestEffort?: boolean;
  failureDestination?: CronFailureDestination;
  surfaces?: Array<"workbench-agent-main" | "workbench-collab-group">;
};

export type CronFailureDestination = {
  channel?: string;
  to?: string;
  mode?: "announce" | "webhook";
  accountId?: string;
};

export type CronFailureAlert = {
  after?: number;
  channel?: string;
  to?: string;
  cooldownMs?: number;
  mode?: "announce" | "webhook";
  accountId?: string;
};

export type CronJobState = {
  nextRunAtMs?: number;
  runningAtMs?: number;
  lastRunAtMs?: number;
  lastStatus?: "ok" | "error" | "skipped";
  lastError?: string;
  lastDurationMs?: number;
  lastFailureAlertAtMs?: number;
};

export type CronJob = CronJobBase<
  CronSchedule,
  CronSessionTarget,
  CronWakeMode,
  CronPayload,
  CronDelivery,
  CronFailureAlert | false
> & {
  state?: CronJobState;
  /** Canonical Progress Ledger projection. Absent when the feature is off or no ledger exists. */
  progress?: import("../../../src/progress-ledger/types.ts").ProgressView;
};

export type CronStatus = {
  enabled: boolean;
  jobs: number;
  nextWakeAtMs?: number | null;
};

export type CronJobsEnabledFilter = "all" | "enabled" | "disabled";
export type CronJobsSortBy = "nextRunAtMs" | "updatedAtMs" | "name";
export type CronSortDir = "asc" | "desc";
export type CronRunsStatusFilter = "all" | "ok" | "error" | "skipped";
export type CronRunsStatusValue = "ok" | "error" | "skipped";
export type CronDeliveryStatus = "delivered" | "not-delivered" | "unknown" | "not-requested";
export type CronRunScope = "job" | "all";

export type CronRunLogEntry = {
  ts: number;
  jobId: string;
  jobName?: string;
  status?: CronRunsStatusValue;
  durationMs?: number;
  error?: string;
  summary?: string;
  deliveryStatus?: CronDeliveryStatus;
  deliveryError?: string;
  delivered?: boolean;
  runAtMs?: number;
  nextRunAtMs?: number;
  model?: string;
  provider?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    cache_read_tokens?: number;
    cache_write_tokens?: number;
  };
  sessionId?: string;
  sessionKey?: string;
};

export type CronJobsListResult = {
  jobs?: CronJob[];
  total?: number;
  offset?: number;
  limit?: number;
  hasMore?: boolean;
  nextOffset?: number | null;
};

export type CronRunsResult = {
  entries?: CronRunLogEntry[];
  total?: number;
  offset?: number;
  limit?: number;
  hasMore?: boolean;
  nextOffset?: number | null;
};

export type SkillsStatusConfigCheck = {
  path: string;
  satisfied: boolean;
};

export type SkillInstallOption = {
  id: string;
  kind: "brew" | "node" | "go" | "uv";
  label: string;
  bins: string[];
};

export type SkillStatusEntry = {
  name: string;
  description: string;
  source: string;
  filePath: string;
  baseDir: string;
  skillKey: string;
  bundled?: boolean;
  primaryEnv?: string;
  emoji?: string;
  homepage?: string;
  always: boolean;
  disabled: boolean;
  blockedByAllowlist: boolean;
  eligible: boolean;
  requirements: {
    bins: string[];
    env: string[];
    config: string[];
    os: string[];
  };
  missing: {
    bins: string[];
    env: string[];
    config: string[];
    os: string[];
  };
  configChecks: SkillsStatusConfigCheck[];
  install: SkillInstallOption[];
};

export type SkillStatusReport = {
  workspaceDir: string;
  managedSkillsDir: string;
  skills: SkillStatusEntry[];
};

export type StatusSummary = Record<string, unknown>;

export type HealthSnapshot = Record<string, unknown>;

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export type LogEntry = {
  raw: string;
  time?: string | null;
  level?: LogLevel | null;
  subsystem?: string | null;
  message?: string | null;
  meta?: Record<string, unknown> | null;
};
