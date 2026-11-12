import { LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import type {
  ControlUiAuthMode,
  ControlUiBootstrapConfig,
  ControlUiEmailDeliverySummary,
  ControlUiMembershipChoice,
  ControlUiPlatformAuthMode,
  ControlUiPlatformAuthState,
  ControlUiPlatformTenantCreationMode,
  ControlUiTrustedProxySession,
} from "../../../src/gateway/control-ui-contract.js";
/** Production cutover stamp — changes bundle hash for cache bust. */
export const OPENBOT_UI_BUILD_STAMP = "20260806T142600Z";
import { isPptxWorkspaceFilename } from "../../../src/gateway/office-slide-draft.ts";
import { parseAgentSessionKey } from "../../../src/sessions/session-key-utils.ts";
import { i18n, I18nController, isSupportedLocale, t } from "../i18n/index.ts";
import {
  handleChannelConfigReload as handleChannelConfigReloadInternal,
  handleChannelConfigSave as handleChannelConfigSaveInternal,
  handleNostrProfileCancel as handleNostrProfileCancelInternal,
  handleNostrProfileEdit as handleNostrProfileEditInternal,
  handleNostrProfileFieldChange as handleNostrProfileFieldChangeInternal,
  handleNostrProfileImport as handleNostrProfileImportInternal,
  handleNostrProfileSave as handleNostrProfileSaveInternal,
  handleNostrProfileToggleAdvanced as handleNostrProfileToggleAdvancedInternal,
  handleWhatsAppLogout as handleWhatsAppLogoutInternal,
  handleWhatsAppStart as handleWhatsAppStartInternal,
  handleWhatsAppWait as handleWhatsAppWaitInternal,
} from "./app-channels.ts";
import {
  ChatRestoreNotConnectedError,
  ChatRestoreTimeoutError,
  readRestoreErrorReasonCode,
  reloadShellChatHistory,
  resolveChatRestoreSessionKey,
  restoreShellChat,
} from "./app-chat-actions.ts";
import {
  handleAbortChat as handleAbortChatInternal,
  handleSendChat as handleSendChatInternal,
  removeQueuedMessage as removeQueuedMessageInternal,
} from "./app-chat.ts";
import { DEFAULT_CRON_FORM, DEFAULT_LOG_LEVEL_FILTERS } from "./app-defaults.ts";
import {
  closeEnterpriseHandoverEditor as closeEnterpriseHandoverEditorInternal,
  openEnterpriseHandoverEditor as openEnterpriseHandoverEditorInternal,
  openEnterpriseHandoverRoute as openEnterpriseHandoverRouteInternal,
  syncEnterpriseHandoverRoute as syncEnterpriseHandoverRouteInternal,
} from "./app-enterprise-handover.ts";
import type { EventLogEntry } from "./app-events.ts";
import { connectGateway as connectGatewayInternal } from "./app-gateway.ts";
import {
  adaptChatAbortHost,
  adaptChatQueueHost,
  adaptChatSendHost,
  adaptDaibaiState,
  adaptGatewayHost,
  adaptLifecycleHost,
  adaptEnterpriseOperationalIdentityHost,
  adaptPlatformAuthHost,
  adaptScrollHost,
  adaptSettingsHost,
  adaptToolStreamHost,
} from "./app-host-adapters.ts";
import {
  handleConnected,
  handleDisconnected,
  handleFirstUpdated,
  handleUpdated,
} from "./app-lifecycle.ts";
import { renderApp } from "./app-render.ts";
import {
  exportLogs as exportLogsInternal,
  handleChatScroll as handleChatScrollInternal,
  handleLogsScroll as handleLogsScrollInternal,
  resetChatScroll as resetChatScrollInternal,
  scheduleChatScroll as scheduleChatScrollInternal,
} from "./app-scroll.ts";
import {
  applySettings as applySettingsInternal,
  loadCron as loadCronInternal,
  loadEnterpriseTabShell as loadEnterpriseTabShellInternal,
  loadOverview as loadOverviewInternal,
  refreshActiveTab as refreshActiveTabInternal,
  setTab as setTabInternal,
  setTheme as setThemeInternal,
  onPopState as onPopStateInternal,
  onHashChange as onHashChangeInternal,
  syncUrlWithSessionKey,
} from "./app-settings.ts";
import * as sidebarActions from "./app-sidebar-actions.ts";
import {
  resetToolStream as resetToolStreamInternal,
  type ToolStreamEntry,
  type CompactionStatus,
  type FallbackStatus,
} from "./app-tool-stream.ts";
import type { AppViewState } from "./app-view-state.ts";
import { normalizeAssistantIdentity } from "./assistant-identity.ts";
import { trimCustomBrandLogoDataUrl } from "./brand-assets.ts";
import type { RuntimeKpiData } from "./capability/agent-runtime/index.ts";
import { assistantIdentityCapability } from "./capability/assistant-identity/index.ts";
import type { CapabilityGovernanceSnapshot } from "./capability/capability-governance/types.ts";
import type {
  RuntimeAgent,
  RuntimeCapabilityBinding,
  RuntimeGovernanceIssue,
  RuntimeTelemetry,
} from "./capability/runtime-canonical/index.ts";
import {
  adaptAssistantIdentityLoadCapabilityState,
  adaptSpacesLoadCapabilityState,
} from "./capability/view-state.ts";
import { sessionKeysShareChatSurface } from "./chat-session-key-match.ts";
import {
  createChatCheckpointLoadState,
  type ChatCheckpointLoadState,
} from "./chat/checkpoint-load-state.ts";
import {
  applyChatCheckpointSessionIsolation,
  loadChatCheckpointsForHost,
} from "./chat/checkpoint-session-isolation.ts";
import { type ChatCheckpointVisibilityDiagnostic } from "./chat/checkpoint-visibility-diagnostics.ts";
import type { ChatContextExpansionSuggestion } from "./chat/context-expansion.ts";
import {
  DEFAULT_CHAT_CONTEXT_SCOPE,
  type ChatContextScopeState,
  type ChatContextSourceCatalogItem,
} from "./chat/context-scope.ts";
import type { OguiDecisionStatusLookup } from "./chat/ogui-form-view.ts";
import type { ChatQuoteDraft } from "./chat/quote-draft.ts";
import { resolveGroupIdFromSessionContext } from "./collaboration/resolve-group-scope.ts";
import { formatAdminActivationEmailReceipt } from "./controllers/admin-activation-email-receipt.ts";
import {
  resetCollaborationGovernanceActionState,
  saveCollaborationDecisionDraft,
  transitionCollaborationGovernanceObject,
} from "./controllers/collaboration-governance-actions.ts";
import {
  loadCollaborationLearningSnapshot,
  resetCollaborationLearningSnapshot,
} from "./controllers/collaboration-learning.ts";
import {
  loadCollaborationObservabilitySnapshot,
  resetCollaborationObservabilitySnapshot,
} from "./controllers/collaboration-observability.ts";
import type { CronFieldErrors } from "./controllers/cron.ts";
import {
  askDaibai as askDaibaiInternal,
  cancelDaibaiPendingConfirmation as cancelDaibaiPendingConfirmationInternal,
  confirmDaibaiPendingAction as confirmDaibaiPendingActionInternal,
  executeDaibaiAction as executeDaibaiActionInternal,
  openDaibaiHelpFromModule as openDaibaiHelpFromModuleInternal,
  type DaibaiPendingConfirmation,
} from "./controllers/daibai.ts";
import type { DevicePairingList } from "./controllers/devices.ts";
import {
  closeEnterpriseDataSourceGovernanceView,
  loadEnterpriseDataSourceGovernanceView,
} from "./controllers/enterprise-data-source-governance.ts";
import {
  createEnterpriseOperationalIdentity as createEnterpriseOperationalIdentityCommand,
  createEnterpriseOperationalIdentityBinding as createEnterpriseOperationalIdentityBindingCommand,
  createEnterpriseConnectorCredential as createEnterpriseConnectorCredentialCommand,
  loadEnterpriseOperationalIdentities as loadEnterpriseOperationalIdentitiesCommand,
  reauthorizeEnterpriseOperationalIdentity as reauthorizeEnterpriseOperationalIdentityCommand,
  removeEnterpriseOperationalIdentityBinding as removeEnterpriseOperationalIdentityBindingCommand,
  revokeEnterpriseOperationalIdentity as revokeEnterpriseOperationalIdentityCommand,
  startEnterpriseOperationalIdentityOAuth as startEnterpriseOperationalIdentityOAuthCommand,
  updateEnterpriseOperationalIdentity as updateEnterpriseOperationalIdentityCommand,
  upsertEnterpriseOperationalIdentityCredential as upsertEnterpriseOperationalIdentityCredentialCommand,
  verifyEnterpriseOperationalIdentity as verifyEnterpriseOperationalIdentityCommand,
  upsertEnterpriseOperationalIdentityPolicy as upsertEnterpriseOperationalIdentityPolicyCommand,
} from "./controllers/enterprise-operational-identity.ts";
import { loadEnterpriseOrganizationMonthlyUsage } from "./controllers/enterprise-organization-monthly-usage.ts";
import { refreshEnterpriseOrganizationSnapshot } from "./controllers/enterprise-organization-snapshot.ts";
import {
  approveEnterpriseSeatHandover as approveEnterpriseSeatHandoverCommand,
  cancelEnterpriseSeatAssignmentOffer as cancelEnterpriseSeatAssignmentOfferCommand,
  createEnterpriseSeat as createEnterpriseSeatCommand,
  listEnterpriseSeats as listEnterpriseSeatsCommand,
  remindEnterpriseSeatAssignmentOffer as remindEnterpriseSeatAssignmentOfferCommand,
  nominateEnterpriseSeatHandover as nominateEnterpriseSeatHandoverCommand,
  mutateEnterpriseOrganizationDepartment as mutateEnterpriseOrganizationDepartmentCommand,
  type EnterpriseOrganizationDepartmentMutation,
  rebindEnterpriseSeatHandover as rebindEnterpriseSeatHandoverCommand,
  reviewEnterpriseSeatHandover as reviewEnterpriseSeatHandoverCommand,
  sendEnterpriseSeatAssignmentOffer as sendEnterpriseSeatAssignmentOfferCommand,
  startEnterpriseSeatHandover as startEnterpriseSeatHandoverCommand,
  updateEnterpriseSeatProfile as updateEnterpriseSeatProfileCommand,
} from "./controllers/enterprise-seat-assets.ts";
import type { ExecApprovalRequest } from "./controllers/exec-approval.ts";
import type { ExecApprovalsFile, ExecApprovalsSnapshot } from "./controllers/exec-approvals.ts";
import type { FocusSwitchGateView } from "./controllers/focus-switch-gate.ts";
import { loadKnowledgeUniverseHome as loadKnowledgeUniverseHomeInternal } from "./controllers/knowledge-universe.ts";
import type { LocalFileApprovalRequest } from "./controllers/local-file-approval.ts";
import {
  acceptPlatformSeatAssignmentOffer,
  changePlatformAuthPassword,
  createPlatformAdmin,
  createPlatformAuthInvite,
  declinePlatformSeatAssignmentOffer,
  inviteEmployeeToNewPosition,
  invitePlatformEnterpriseAdmin,
  logoutPlatformAuth,
  removePlatformAdmin,
  removePlatformAuthMember,
  provisionPlatformAuthEmployee,
  revokePlatformAuthInvite,
  sendPlatformEmployeeActivations,
  setPlatformMfaPolicy,
  submitPlatformAuth,
  submitPlatformTrialApply,
  switchPlatformAuthSessionKind,
  type PlatformEmployeeProvisionInput,
  updatePlatformEnterpriseAdmin,
  updatePlatformTrialInstance,
  updatePlatformTrialPolicy,
  resendPlatformEnterpriseAdminActivation,
  approvePlatformTrialApplication,
  rejectPlatformTrialApplication,
} from "./controllers/platform-auth.ts";
import { loadPlatformModelsManagementSnapshot } from "./controllers/platform-models-management.ts";
import type { SkillMessage } from "./controllers/skills.ts";
import { refreshWorkbenchSignals } from "./controllers/spaces.ts";
import {
  probeTenantImChannel as probeTenantImChannelCommand,
  type TenantImProbeResult,
} from "./controllers/tenant-im-binding.ts";
import {
  applyIdentityOperationalRobotGrants,
  applyRobotEnterpriseIdentityEnrollments,
  applyRobotOperationalIdentityGrants,
  bindUserOperationalIdentityViaOAuth,
  bindUserOperationalIdentityViaWechatPersonalExisting,
  recheckWechatPersonalChannel as runRecheckWechatPersonalChannel,
  closeUserOperationalIdentityEditor,
  completeUserOperationalIdentityBindingRequest,
  confirmUserOperationalIdentityGrant as confirmUserOperationalIdentityGrantCommand,
  createUserOperationalIdentity,
  handoffUserOperationalIdentityTask,
  loadRobotEnterpriseIdentityAccess,
  loadUserOperationalIdentities,
  openUserOperationalIdentityEditor,
  verifyUserOperationalIdentityCredentials,
  reauthorizeUserOperationalIdentity,
  resumeUserOperationalIdentityContinuationFlow,
  resumeUserOperationalIdentityOAuthFromReturn,
  revokeUserOperationalIdentity,
  revokeUserOperationalIdentityGrantRecord,
  setUserOperationalIdentityBindingReturnContext,
  setUserOperationalIdentityNav,
  clearUserOperationalIdentityBindingReturnContext,
  clearUserOperationalIdentityContinuationToken,
  type UserOperationalIdentityNav,
} from "./controllers/user-operational-identity.ts";
import type { GatewayConnectionPhase } from "./gateway-connection-phase.ts";
import type { GatewayBrowserClient, GatewayHelloOk } from "./gateway.ts";
import { pathForTab, type Tab } from "./navigation.ts";
import { subscribeCrossPortShellReady } from "./ports/cross-port-shell-lazy.ts";
import {
  runDiagnosisActionDispatch,
  setDiagnosisApiClient,
} from "./ports/diagnosis/diagnosis-api.ts";
import {
  DIAGNOSIS_CONVERSATION_ACTION_EVENT,
  readDiagnosisConversationAction,
} from "./ports/diagnosis/diagnosis-conversation-action.ts";
import {
  DIAGNOSIS_OPEN_SESSION_EVENT,
  readDiagnosisOpenSession,
} from "./ports/diagnosis/diagnosis-open-session.ts";
import {
  openPersonalOperationalIdentitySection,
  returnToRobotOperationalIdentityGrant,
} from "./ports/employee/operational-identity-navigation.ts";
import {
  DEFAULT_WORKBENCH_SYSTEM_SETTINGS_TAB,
  type GroupProfileView,
  type WorkbenchAgentCreatorRoleSource,
  type WorkbenchAgentCreatorStep,
  type WorkbenchAgentDesignState,
  type WorkbenchGovernanceObjectKind,
  type WorkbenchPrimaryModule,
  type WorkbenchRobotWorkbenchTab,
  type WorkbenchSettingsGroupDraft,
  type WorkbenchSettingsView,
  type WorkbenchPersonalSettingsTab,
  type WorkbenchSystemSettingsTab,
  type WorkbenchTasksSubTab,
  type WorkbenchMyBotDetailTab,
} from "./ports/employee/views/workbench-types.ts";
import { filterTransferableHandoverPolicyIds } from "./ports/enterprise/views/enterprise-handover-asset-helpers.ts";
import { subscribeEnterpriseSurfaceReady } from "./ports/enterprise/views/enterprise-surface-lazy.ts";
import {
  consoleHostEmployeeHomeUrl,
  replaceLocationWithPublicHomepage,
  shouldUsePublicHomepageForCurrentLocation,
} from "./public-home.ts";
import { landTabForConfirmedSession } from "./routing/confirmed-session-land.ts";
import { passwordResetLoginMode, passwordResetLoginTab } from "./routing/password-reset-link.ts";
import { loadSettings, type UiSettings } from "./storage.ts";
import type { ResolvedTheme, ThemeMode } from "./theme.ts";
import type {
  AgentsListResult,
  AgentsFilesListResult,
  AgentIdentityResult,
  ArtifactWorkspaceSidebar,
  ConfigSnapshot,
  ConfigUiHints,
  CronJob,
  CronRunLogEntry,
  CronStatus,
  HealthSnapshot,
  LogEntry,
  MeshOwnershipListResult,
  LogLevel,
  PresenceEntry,
  ChannelsStatusSnapshot,
  SessionsListResult,
  SkillStatusReport,
  ToolsCatalogResult,
  StatusSummary,
  NostrProfile,
} from "./types.ts";
import type { ChatCheckpoint } from "./types/chat-types.ts";
import { type ChatAttachment, type ChatQueueItem, type CronFormState } from "./ui-types.ts";
import { generateUUID } from "./uuid.ts";
import type { NostrProfileFormState } from "./views/channels.nostr-profile-form.ts";
import { resolveEffectiveChatRestoreCheckpointId } from "./views/chat.ts";
import { createEmptySpaceConnectorBindDraft } from "./views/knowledge-universe-space-connector-bind.ts";
import { createArtifactWorkspaceFromMessage } from "./wiring/artifact-workspace-from-message.ts";
import { runAppChatSend, type AppChatSendOptions } from "./wiring/chat-send.ts";
import {
  DELIVERABLE_SAVE_TOAST_MS,
  extractArtifactSavePayload,
  inferInitialDeliverableSaveState,
  markDeliverableSaveDirty,
  resolveDeliverableSaveToastMessage,
  resolveSaveKnowledgeBaseId,
  DeliverableSaveCancelledError,
  saveAndArchiveSidebarDeliverable,
  type DeliverableSaveDecisionChoice,
  type DeliverableSaveState,
  type DeliverableSaveToast,
} from "./wiring/deliverable-save.ts";
import { openArtifactDeliverablePreview } from "./wiring/group-deliverable-preview-flow.ts";
import {
  cancelShellMeetingPendingConfirmation,
  confirmShellMeetingPendingApproval,
  dismissShellMeetingConfirmRelease,
  syncShellMeetingPendingConfirmation,
  type MeetingConfirmRelease,
  type MeetingPendingConfirmation,
} from "./wiring/meeting-confirmation.ts";
import { persistWorkspacePptxSlideDraft } from "./wiring/pptx-preview-edit.ts";
import { resolveStewardWorkspaceFilename } from "./wiring/steward-workspace-file.ts";
import { applyWorkspaceFilePreview } from "./wiring/workspace-file-preview.ts";

declare global {
  interface Window {
    __OPENBOT_CONTROL_UI_BASE_PATH__?: string;
  }
}

const bootAssistantIdentity = normalizeAssistantIdentity({});
const asSidebarHost = (app: object) => app as sidebarActions.SidebarActionHost;

function resolveOnboardingMode(): boolean {
  if (!window.location.search) {
    return false;
  }
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("onboarding");
  if (!raw) {
    return false;
  }
  const normalized = raw.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function resolveInitialWorkbenchPrimaryModule(_settings: UiSettings): WorkbenchPrimaryModule {
  return "assistant";
}

type SeatOfferEmailDelivery = {
  status: "sent" | "queued" | "failed";
  reason?: "smtp_not_configured" | "unsupported_notification" | "missing_recipient";
  error?: string;
};

function formatSeatOfferEmailNotice(params: {
  delivery?: SeatOfferEmailDelivery;
  email?: string | null;
  sentAction: string;
  sentFallback: string;
  queuedPrefix: string;
}): string {
  const target = params.email?.trim();
  if (!params.delivery || params.delivery.status === "sent") {
    return target ? `已向 ${target} ${params.sentAction}。` : params.sentFallback;
  }
  if (params.delivery.status === "failed") {
    const error = params.delivery.error?.trim() || "请检查 SMTP 配置";
    return `${params.queuedPrefix}，但邮件发送失败：${error}。`;
  }
  if (params.delivery.reason === "smtp_not_configured") {
    return `${params.queuedPrefix}，但邮件服务未配置，邮件尚未发出。`;
  }
  return `${params.queuedPrefix}，但邮件尚未发出，请检查成员邮箱和邮件服务配置。`;
}

function normalizeSeatOfferEmailDelivery(
  delivery?: SeatOfferEmailDelivery | ControlUiEmailDeliverySummary,
): SeatOfferEmailDelivery | undefined {
  if (!delivery) {
    return undefined;
  }
  if ("status" in delivery) {
    return delivery;
  }
  if (delivery.failed > 0) {
    return {
      status: "failed",
      ...(delivery.errors?.[0] ? { error: delivery.errors[0] } : {}),
    };
  }
  if (delivery.queued > 0 || delivery.skipped > 0) {
    return {
      status: "queued",
      ...(delivery.queuedReason ? { reason: delivery.queuedReason } : {}),
    };
  }
  return { status: "sent" };
}

function formatActivationDeliveryNotice(summary: ControlUiEmailDeliverySummary): string {
  const details = [
    summary.sent > 0 ? `${summary.sent} 封已发出` : "",
    summary.queued > 0
      ? summary.queuedReason === "smtp_not_configured"
        ? `${summary.queued} 封未发出（Gateway 未配置邮件服务：请在 ~/.openbot/.env 设置 OPENBOT_SMTP_* 后重启 Gateway）`
        : `${summary.queued} 封未发出（邮件服务未配置或等待重试）`
      : "",
    summary.failed > 0
      ? `${summary.failed} 封发送失败${summary.errors?.[0] ? `：${summary.errors[0]}` : ""}`
      : "",
    summary.skipped > 0 ? `${summary.skipped} 条未找到待激活记录` : "",
  ]
    .filter(Boolean)
    .join("，");
  return `已处理 ${summary.total} 条邀请激活。${details}`;
}

function readVisibleChatTailId(messages: unknown[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || typeof message !== "object") {
      continue;
    }
    const record = message as {
      transcriptEntryId?: unknown;
      id?: unknown;
      messageId?: unknown;
    };
    const id = record.transcriptEntryId ?? record.id ?? record.messageId;
    if (typeof id === "string" && id.trim()) {
      return id.trim();
    }
  }
  return null;
}

@customElement("openbot-app")
export class OpenBotApp extends LitElement {
  private i18nController = new I18nController(this);
  private unsubscribeEnterpriseSurfaceReady: (() => void) | null = null;
  private unsubscribeCrossPortShellReady: (() => void) | null = null;
  clientInstanceId = generateUUID();
  connectGeneration = 0;
  @state() settings: UiSettings = loadSettings();
  constructor() {
    super();
    if (isSupportedLocale(this.settings.locale)) {
      void i18n.setLocale(this.settings.locale);
    }
    this.workbenchPrimaryModule = resolveInitialWorkbenchPrimaryModule(this.settings);
  }
  @state() password = "";
  @state() workbenchTeamSelectedKey = "";
  @state() workbenchPrimaryModule: WorkbenchPrimaryModule = "assistant";
  @state() workbenchSettingsView: WorkbenchSettingsView = "system";
  @state() workbenchSystemSettingsTab: WorkbenchSystemSettingsTab =
    DEFAULT_WORKBENCH_SYSTEM_SETTINGS_TAB;
  @state() workbenchPersonalSettingsTab: WorkbenchPersonalSettingsTab = "account";
  // 「我的任务」模块内部二级分段（瞬态，默认定时任务）。
  @state() workbenchTasksSubTab: WorkbenchTasksSubTab = "cron";
  @state() workbenchHeaderProfileMenuOpen = false;
  @state() workbenchSystemSettingsSelectedGroupId: string | null = null;
  /** Phase 3：当前选中协作小组的四块投影（含贡献度） */
  @state() workbenchCollaborationGroupProjection:
    | import("./ports/employee/semantic/collaboration-group-read-model.ts").CollaborationGroupProjection
    | null = null;
  @state() workbenchCollaborationGroupProjectionLoading = false;
  @state() workbenchMyBotDetailAgentId: string | null = null;
  /** 我的机器人主从右栏子 Tab */
  @state() workbenchMyBotDetailTab: WorkbenchMyBotDetailTab = "identity";
  @state() workbenchMyBotProjection:
    | import("./ports/employee/semantic/my-bot-read-model.ts").MyBotProjection
    | null = null;
  @state() workbenchMyBotDetailLoading = false;
  @state() workbenchMyBotDetailSaving = false;
  @state() workbenchMyBotDetailError: string | null = null;
  @state() workbenchMyBotIdentityDraft: {
    name: string;
    positioning: string;
    role: string;
    personaTraits: string;
    model: string;
  } | null = null;
  @state() workbenchSystemSettingsGroupDraft: WorkbenchSettingsGroupDraft | null = null;
  @state() workbenchSystemSettingsGroupSaving = false;
  @state() workbenchSystemSettingsGroupError: string | null = null;
  @state() workbenchSystemSettingsGroupNotice: string | null = null;
  @state() workbenchRobotWorkbenchTab: WorkbenchRobotWorkbenchTab = "overview";
  @state() workbenchGroupProfileView: GroupProfileView = "chat";
  @state() workbenchTaskDetailId: string | null = null;
  @state() workbenchCronFocusJobId: string | null = null;
  @state() workbenchSupervisorInitialTaskId: string | null = null;
  @state() chatCronReplyContext: { jobId: string; runId?: string; jobName?: string } | null = null;
  @state() chatFocusSwitchGate: FocusSwitchGateView | null = null;
  @state() workbenchDeliverableDetailId: string | null = null;
  @state() workbenchReviewDetailId: string | null = null;
  @state() workbenchDecisionDetailId: string | null = null;
  @state() workbenchDecisionSelectedOptionDraft: string | null = null;
  @state() workbenchDecisionRationaleDraft: string | null = null;
  @state() workbenchDecisionOptionsDraft: Array<{ optionId: string; title: string }> | null = null;
  @state() workbenchMemberGovernanceGroupKey: string | null = null;
  @state() workbenchMemberGovernanceTitle = "";
  @state() workbenchMemberGovernancePrompt = "";
  @state() workbenchMemberGovernanceBusy = false;
  @state() workbenchMemberGovernanceInvitingHumanId: string | null = null;
  @state() workbenchMemberGovernanceInvitingBotId: string | null = null;
  @state() workbenchMemberGovernanceError: string | null = null;
  @state() workbenchMemberGovernanceResult: string | null = null;
  @state() workbenchMemberGovernanceCurrentHumans: Array<{
    id: string;
    label: string;
    kind: "human" | "bot";
  }> = [];
  @state() workbenchMemberGovernanceCurrentBots: Array<{
    id: string;
    label: string;
    kind: "human" | "bot";
  }> = [];
  @state() workbenchMemberGovernancePendingInvites: Array<{
    intentId: string;
    label: string;
    message?: string;
  }> = [];
  @state() workbenchMemberGovernancePendingBotInvites: Array<{
    agentId: string;
    label: string;
    ownerId?: string;
    ownerName?: string;
    canApprove?: boolean;
  }> = [];
  @state() workbenchMemberGovernanceCandidateHumans: Array<{
    id: string;
    label: string;
    subtitle?: string;
    kind: "human" | "bot";
    actionMode: "add" | "invite";
    orgSegments?: string[];
    disabled?: boolean;
  }> = [];
  @state() workbenchMemberGovernanceCandidateBots: Array<{
    id: string;
    label: string;
    subtitle?: string;
    kind: "human" | "bot";
    actionMode: "add" | "invite";
    orgSegments?: string[];
    disabled?: boolean;
  }> = [];
  @state() workbenchMemberGovernanceSelectorKind: "human" | "bot" | null = null;
  @state() workbenchMemberGovernanceSearch = "";
  @state() workbenchMemberGovernanceSelectedHumanIds: string[] = [];
  @state() workbenchMemberGovernanceSelectedBotIds: string[] = [];
  @state() workbenchCollaborationOrgBotDirectory: Array<{
    agentId: string;
    label: string;
    ownerUserId: string | null;
    ownerLabel: string | null;
    scope: string | null;
  }> = [];
  @state() workbenchAgentCreatorOpen = false;
  @state() workbenchAgentCreatorBusy = false;
  @state() workbenchOwnedRobotDeleteBusyId: string | null = null;
  @state() workbenchOwnedRobotDeleteError: string | null = null;
  @state() workbenchAgentCreatorError: string | null = null;
  @state() workbenchAgentCreatorName = "";
  @state() workbenchAgentCreatorEmoji = "";
  @state() workbenchAgentCreatorStep: WorkbenchAgentCreatorStep = "intent";
  @state() workbenchAgentCreatorRoleSource: WorkbenchAgentCreatorRoleSource = "ai";
  @state() workbenchAgentCreatorDesign: WorkbenchAgentDesignState | null = null;
  @state() workbenchAgentCreatorTemplateId = "";
  @state()
  workbenchAgentCreatorTemplates: import("./controllers/agent-growth.ts").AgentTemplateListItemView[] =
    [];
  @state() workbenchAgentCreatorTemplatesLoading = false;
  @state() workbenchAgentCreatorWorkspaceKind: "local" | "cloud" = "local";
  @state() workbenchAgentCreatorLocalPath = "";
  @state() workbenchAgentCreatorLocalValidationState: "idle" | "validating" | "valid" | "invalid" =
    "idle";
  @state() workbenchAgentCreatorLocalValidationMessage: string | null = null;
  @state() workbenchAgentCreatorLocalResolvedPath: string | null = null;
  @state() workbenchAgentCreatorLocalReadable = false;
  @state() workbenchAgentCreatorLocalWritable = false;
  @state() workbenchAgentCreatorLocalBrowserOpen = false;
  @state() workbenchAgentCreatorLocalBrowserBusy = false;
  @state() workbenchAgentCreatorLocalBrowserError: string | null = null;
  @state() workbenchAgentCreatorLocalBrowserCurrentPath = "";
  @state() workbenchAgentCreatorLocalBrowserParentPath: string | null = null;
  @state() workbenchAgentCreatorLocalBrowserEntries: Array<{ name: string; path: string }> = [];
  @state() workbenchWorkspaceCloudProvider:
    | "aliyun-oss"
    | "aws-s3"
    | "azure-blob"
    | "huawei-obs"
    | "s3-compatible" = "aliyun-oss";
  @state() workbenchWorkspaceCloudRegion = "";
  @state() workbenchWorkspaceCloudBucket = "";
  @state() workbenchWorkspaceCloudRootPrefix = "";
  @state() workbenchWorkspaceCloudEndpoint = "";
  @state() workbenchWorkspaceCloudAccountName = "";
  @state() workbenchWorkspaceCloudAccessKeyId = "";
  @state() workbenchWorkspaceCloudSecretAccessKey = "";
  @state() workbenchWorkspaceCloudGeneratedConfig:
    | import("./types.js").WorkspaceCloudGeneratedConfig
    | null = null;
  @state() workbenchWorkspaceCloudConnectionState: "idle" | "testing" | "success" | "error" =
    "idle";
  @state() workbenchWorkspaceCloudConnectionMessage: string | null = null;
  @state() workbenchWorkspaceCloudCanRead = false;
  @state() workbenchWorkspaceCloudCanWrite = false;
  @state() workbenchWorkspaceCloudBrowserOpen = false;
  @state() workbenchWorkspaceCloudBrowserBusy = false;
  @state() workbenchWorkspaceCloudBrowserError: string | null = null;
  @state() workbenchWorkspaceCloudBrowserCurrentPath = "";
  @state() workbenchWorkspaceCloudBrowserParentPath: string | null = null;
  @state() workbenchWorkspaceCloudBrowserEntries: Array<{ name: string; path: string }> = [];
  @state() workbenchWorkspaceCloudSelectedPath = "";
  @state() workbenchDefaultWorkspaceRootDraft: string | null = null;
  @state() workbenchDefaultWorkspaceRootSaving = false;
  @state() workbenchDefaultWorkspaceRootError: string | null = null;
  @state() workbenchDefaultWorkspaceRootNotice: string | null = null;
  @state() workbenchDataDirectoryLoading = false;
  @state() workbenchDataDirectoryError: string | null = null;
  @state() workbenchDataDirectoryMode: "local" | "managed" | null = null;
  @state() workbenchDataDirectoryDisplayRoot: string | null = null;
  @state() workbenchDataDirectoryVolumeName: string | null = null;
  @state() workbenchDataDirectoryUsedLabel: string | null = null;
  @state() workbenchDataMigrationOpen = false;
  @state() workbenchDataMigrationBusy = false;
  @state() workbenchDataMigrationMessage: string | null = null;
  @state() workbenchDataMigrationTargetDraft = "";
  @state() workbenchDataExportBusy = false;
  @state() workbenchDataExportPath: string | null = null;
  @state() workbenchDataAccessGrants: Array<{
    id: string;
    agentId: string;
    resourceType: string;
    resourcePath: string;
    grantedAt: string;
  }> = [];
  @state() workbenchDataAccessGrantsLoading = false;
  @state() workbenchForgetMemoryAgentId = "";
  @state() workbenchForgetMemoryKey = "";
  @state() workbenchForgetMemoryBusy = false;
  @state() workbenchForgetMemoryMessage: string | null = null;
  @state() workbenchOwnedRobotDeletePrompt: { agentId: string; name: string } | null = null;
  @state() workbenchOwnedRobotDeleteDisposition:
    | "delete_all"
    | "keep_artifacts_conversations"
    | "soft_unbind" = "delete_all";
  @state() workbenchInstallTargetRobotId: string | null = null;
  @state() workbenchSystemSettingsPendingGroupId: string | null = null;
  @state() workbenchWorkspaceSelectorOpen = false;
  @state() workbenchWorkspaceSelectorMode: "default-local" | "default-cloud" | "robot-local" =
    "default-local";
  @state() workbenchWorkspaceSelectorTitle = "";
  @state() workbenchWorkspaceSelectorDescription = "";
  @state() workbenchWorkspaceSelectorSelectedPath = "";
  @state() workbenchWorkspaceSelectorTargetId: string | null = null;
  @state() workbenchWorkspaceSelectorTargetLabel: string | null = null;
  @state() workbenchWorkspaceSelectorLocalBrowserOpen = false;
  @state() workbenchWorkspaceSelectorLocalBrowserBusy = false;
  @state() workbenchWorkspaceSelectorLocalBrowserError: string | null = null;
  @state() workbenchWorkspaceSelectorLocalBrowserCurrentPath = "";
  @state() workbenchWorkspaceSelectorLocalBrowserParentPath: string | null = null;
  @state() workbenchWorkspaceSelectorLocalBrowserEntries: Array<{ name: string; path: string }> =
    [];
  @state() workbenchSpaceCreatorOpen = false;
  @state() workbenchSpaceCreatorBusy = false;
  @state() workbenchSpaceCreatorError: string | null = null;
  @state() workbenchSpaceCreatorTitle = "";
  @state() workbenchSpaceCreatorAvatar = "🛰️";
  @state() workbenchSpaceCreatorPurpose = "";
  @state() workbenchSpaceCreatorCurrentMission = "";
  @state() workbenchSpaceCreatorSystemInstructions = "";
  @state() workbenchSpaceCreatorGroupId = "";
  @state() workbenchSpaceCreatorGroupIdTouched = false;
  @state() workbenchSpaceCreatorStep: "details" | "members" = "details";
  @state() workbenchSpaceCreatorSelectedHumanIds: string[] = [];
  @state() workbenchSpaceCreatorSelectedBotIds: string[] = [];
  @state() workbenchSpaceCreatorCoordinatorBotId = "";
  @state() workbenchSkillSaveModalOpen = false;
  @state() workbenchSkillSaveModalBusy = false;
  @state() workbenchSkillSaveModalError: string | null = null;
  @state() workbenchSkillSaveModalFormData:
    | import("./controllers/skill-lifecycle.ts").QuickSaveSkillFormData
    | null = null;
  @state() workbenchSkillSavePreferEnterpriseSubmit = false;
  @state() workbenchSkillExtractedPreview:
    | import("./controllers/skill-lifecycle.ts").ExtractedSkillPreview
    | null = null;
  @state() workbenchSkillSourceAgentId: string | null = null;
  @state() workbenchSkillSourceContextId: string | null = null;
  @state() workbenchAssetSuggestionVisible = false;
  @state() workbenchAssetSuggestionSource:
    | "assistant-task-complete"
    | "group-task-complete"
    | "manual-iteration"
    | null = null;
  @state() workbenchAssetSuggestionLabel: string | null = null;
  workbenchAssetIncubationLevel:
    | import("./controllers/asset-incubation/types.ts").AssetIncubationLevel
    | null = null;
  @state() workbenchAssetIncubationDecision:
    | import("./controllers/asset-incubation/types.ts").AssetIncubationDecision
    | null = null;
  @state() workbenchAssetWeakHintVisible = false;
  @state() workbenchPatternDetectionSubscribedScopes: string[] = [];
  @state() workbenchSearchQuery = "";
  @state() workbenchRemoteOpen = false;
  @state() workbenchRemoteQuery = "";
  @state() daibaiSourceSessionKey: string | null = null;
  /** Pending 「应用到协作小组」 card parsed from steward chat (group-config-proposal). */
  @state() workbenchPendingGroupConfigProposal: {
    groupId: string;
    fingerprint: string;
    summaryLines: string[];
    proposal: import("./ports/employee/group-config-proposal.ts").GroupConfigProposal;
    sourceSessionKey: string | null;
  } | null = null;
  @state() workbenchGroupConfigProposalDismissedFingerprint: string | null = null;
  @state() workbenchGroupConfigProposalBusy = false;
  @state() workbenchGroupConfigProposalError: string | null = null;
  @state() workbenchGroupConfigProposalNotice: string | null = null;
  @state() daibaiLastMessage: string | null = null;
  @state() tab: Tab = "me";
  @state() onboarding = resolveOnboardingMode();
  @state() connected = false;
  @state() gatewayConnectionPhase: GatewayConnectionPhase = "connecting";
  @state() gatewayReconnectAttempt = 0;
  @state() theme: ThemeMode = this.settings.theme ?? "system";
  @state() themeResolved: ResolvedTheme = "dark";
  @state() hello: GatewayHelloOk | null = null;
  @state() lastError: string | null = null;
  @state() lastErrorCode: string | null = null;
  @state() eventLog: EventLogEntry[] = [];
  private eventLogBuffer: EventLogEntry[] = [];
  private toolStreamSyncTimer: number | null = null;
  private sidebarCloseTimer: number | null = null;

  @state() assistantName = bootAssistantIdentity.name;
  @state() assistantAvatar = bootAssistantIdentity.avatar;
  @state() assistantAgentId = bootAssistantIdentity.agentId ?? null;
  @state() serverVersion: string | null = null;
  @state() bootstrapAuthMode: ControlUiAuthMode | null = null;
  @state() bootstrapAuthSession: ControlUiTrustedProxySession | null = null;
  @state() workspaceHost: ControlUiBootstrapConfig["workspaceHost"] | null = null;
  @state() bootstrapDataSpace: ControlUiBootstrapConfig["dataSpace"] | null = null;
  @state() platformAuthState: ControlUiPlatformAuthState | null = null;
  @state() forcePublicHomepage = false;
  @state() platformAuthMode: ControlUiPlatformAuthMode = "employee-register";
  @state() platformAuthBusy = false;
  @state() platformAuthError: string | null = null;
  @state() platformAuthNotice: string | null = null;
  @state() platformAuthEmail = "";
  @state() platformAuthPassword = "";
  @state() platformAuthDisplayName = "";
  @state() platformAuthPlatformAdminDisplayName = "";
  @state() platformAuthTenantName = "";
  @state() platformAuthSeatTitle = "";
  @state() platformAuthExpectedUsers = "";
  @state() platformAuthUseCase = "";
  @state() platformAuthCompanySize = "";
  @state() platformAuthNeedsDemo = "";
  @state() platformAuthIndustry = "";
  @state() platformAuthTrialStep: 1 | 2 = 1;
  @state() platformAuthInviteCode = "";
  @state() platformAuthSeatOfferId: string | null = null;
  @state() platformAuthMfaCode = "";
  @state() platformAuthMfaStage: "none" | "code" | "enroll" = "none";
  @state() platformAuthMfaEnrollment: { otpAuthUrl: string; recoveryCodes: string[] } | null = null;
  @state() platformAuthMembershipChoices: ControlUiMembershipChoice[] = [];
  @state() platformAuthMembershipId = "";
  @state() platformAuthCurrentPassword = "";
  @state() platformAuthNewPassword = "";
  @state() platformAuthPolicyTrialDays = "";
  @state() platformAuthPolicySeatCount = "";
  @state() platformAuthPolicyUpgradeUrl = "";
  @state() platformAuthPolicyContactAdvisorUrl = "";
  @state() platformAuthInstanceEnterpriseId = "";
  @state() platformAuthInstanceTrialDays = "";
  @state() platformAuthInstanceSeatCount = "";
  @state() platformAuthInstanceUpgradeUrl = "";
  @state() platformAuthInstanceContactAdvisorUrl = "";
  @state() platformAuthCreationMode: ControlUiPlatformTenantCreationMode = "quick-trial";
  @state() platformAuthPlatformAdminEmail = "";
  @state() platformAuthPlatformAdminPassword = "";
  @state() platformAuthPlatformAdminScopes: string[] = [];
  platformAuthLoginIntent: "enterprise-admin" | "platform-admin" | undefined = undefined;
  @state() enterpriseAccessEditorKind: "role" | "user" | null = null;
  @state() enterpriseAccessEditorTargetKey: string | null = null;
  @state() enterpriseAccessEditorSelectedPermissionIds: string[] = [];
  @state() enterpriseAccessEditorNotice: string | null = null;
  @state() enterpriseAccessRiskConfirmOpen = false;
  @state() enterpriseSeatOfferEditorSeatId: string | null = null;
  @state() enterpriseSeatOfferEditorMode: "offer" | "activation" = "offer";
  @state() enterpriseSeatOfferEditorSeatTitle = "";
  @state() enterpriseSeatOfferEditorSeatStatus: string | null = null;
  @state() enterpriseSeatOfferEditorDefaultAgentId: string | null = null;
  @state() enterpriseSeatOfferEditorAvailableAgentIds: string[] = [];
  @state() enterpriseSeatOfferEditorDefaultSpaceIds: string[] = [];
  @state() enterpriseSeatOfferEditorSelectedAgentIds: string[] = [];
  @state() enterpriseSeatOfferEditorSelectedSpaceIds: string[] = [];
  @state() enterpriseSeatOfferEditorInheritMode: "full" | "selective" = "full";
  @state() enterpriseSeatOfferEditorInheritMemoryScope = true;
  @state() enterpriseSeatOfferEditorMemoryScopeAvailable = false;
  @state() enterpriseSeatOfferEditorEmployeeEmail = "";
  @state() enterpriseSeatCreateEditorSeatId: string | null = null;
  @state() enterpriseSeatCreateEditorOpen = false;
  @state() enterpriseSeatCreateEditorSeatTitle = "";
  @state() enterpriseSeatCreateEditorTeamLabel = "";
  @state() enterpriseSeatCreateEditorResponsibility = "";
  @state() enterpriseSeatCreateEditorEmployeeEmail = "";
  @state() enterpriseSeatCreateEditorDefaultAgentId = "";
  @state() enterpriseSeatCreateEditorAgentIds: string[] = [];
  @state() enterpriseOwnershipTransferEditorOpen = false;
  @state() enterpriseOwnershipTransferEditorTenantId: string | null = null;
  @state() enterpriseOwnershipTransferEditorSubjectKind: "agent" | "group" | null = null;
  @state() enterpriseOwnershipTransferEditorSubjectId: string | null = null;
  @state() enterpriseOwnershipTransferEditorSubjectLabel = "";
  @state() enterpriseOwnershipTransferEditorPositionId: string | null = null;
  @state() enterpriseOwnershipTransferEditorPositionLabel = "";
  @state() enterpriseOwnershipTransferEditorCurrentManagerUserId: string | null = null;
  @state() enterpriseOwnershipTransferEditorCurrentManagerLabel = "";
  @state() enterpriseOwnershipTransferEditorSelectedUserId = "";
  @state() enterpriseHandoverEditorCaseId: string | null = null;
  @state() enterpriseHandoverEditorSeatTitle = "";
  @state() enterpriseHandoverEditorSeatId: string | null = null;
  @state() enterpriseHandoverEditorStatus: string | null = null;
  @state() enterpriseHandoverEditorReviewSummary = "";
  @state() enterpriseHandoverEditorExceptionFlags = "";
  @state() enterpriseHandoverEditorSuccessorEmail = "";
  @state() enterpriseHandoverEditorSeatStatus: string | null = null;
  @state() enterpriseHandoverEditorDefaultAgentIds: string[] = [];
  @state() enterpriseHandoverEditorDefaultSpaceIds: string[] = [];
  @state() enterpriseHandoverEditorSelectedAgentIds: string[] = [];
  @state() enterpriseHandoverEditorSelectedDataKeys: string[] = [];
  @state() enterpriseHandoverEditorSelectedSpaceIds: string[] = [];
  @state() enterpriseHandoverEditorSelectedPolicyIds: string[] = [];
  @state() enterpriseHandoverEditorDraftNotice: string | null = null;
  @state() enterpriseHandoverEditorCurrentEmployeeEmail: string | null = null;
  @state() enterpriseHandoverEditorCurrentEmployeeDisplayName: string | null = null;
  @state() enterpriseHandoverEditorBindingStatus: string | null = null;
  @state() enterpriseHandoverEditorEmployeePolicies: Array<{
    policyId: string;
    resourceType: string;
    resourceId: string;
    action: string;
  }> = [];
  @state() enterpriseHandoverEditorSeatPolicies: Array<{
    policyId: string;
    resourceType: string;
    resourceId: string;
    action: string;
  }> = [];
  @state() enterpriseHandoverEditorTeamLabel: string | null = null;
  @state() enterpriseHandoverEditorAssetSnapshot: {
    agentIds: string[];
    spaceIds: string[];
    memoryScopeIds: string[];
    memoryScopes: Array<{ scopeId: string; transferClass: string }>;
    connectorProfiles: Array<{
      profileId: string;
      credentialReauthorizationRequired: boolean;
    }>;
    connectorCredentialReauthorizationRequired: boolean;
    frozenAssetBindingIds: string[];
    rebindRequiredAssetBindingIds: string[];
    sessionDataTransfer:
      | import("./ports/enterprise/views/enterprise-handover-asset-helpers.ts").EnterpriseHandoverSessionDataTransferSnapshot
      | null;
  } | null = null;
  @state() enterpriseHandoverEditorAssetQuery = "";
  @state()
  enterpriseHandoverEditorAssetKindFilter: import("./ports/enterprise/view-types.ts").HandoverAssetCategoryFilter =
    "all";
  @state() enterpriseOperationalIdentities:
    | import("./controllers/enterprise-operational-identity.ts").EnterpriseOperationalIdentitySnapshot
    | null = null;
  @state() enterpriseOperationalIdentityBusy = false;
  @state() enterpriseOperationalIdentityLoaded = false;
  @state() enterpriseOperationalIdentityError: string | null = null;
  @state() enterpriseOperationalIdentityNotice: string | null = null;
  @state() enterpriseOperationalIdentityDetailId = "";
  @state() enterpriseOperationalIdentityDetailTab: "usage" | "policy" | "audit" | "security" =
    "usage";
  @state() enterpriseIdentityEditorOpen = false;
  @state() enterpriseIdentityEditorMode: "register" | "edit" | "policy" | "binding" | "credential" =
    "register";
  @state() enterpriseIdentityEditorIdentityId = "";
  @state() enterpriseIdentityEditorDisplayName = "";
  @state() enterpriseIdentityEditorCredentialBindingId = "";
  @state() enterpriseIdentityEditorPolicyId = "";
  @state() enterpriseIdentityEditorSeatIds = "";
  @state() enterpriseIdentityEditorAgentIds = "";
  @state() enterpriseIdentityEditorAllowedActions = "";
  @state() enterpriseIdentityEditorDataSourceId = "";
  @state() enterpriseIdentityEditorBindingPurpose:
    | "source_authentication"
    | "source_collection"
    | "source_sync" = "source_sync";
  @state() enterpriseIdentityEditorBindingId = "";
  @state() enterpriseIdentityEditorProvider = "";
  @state() enterpriseIdentityEditorPolicyPickerQuery = "";
  @state() enterpriseIdentityEditorPolicyDepartmentPaths = "";
  @state() enterpriseIdentityEditorCredentialFields: Record<string, string> = {};
  @state() enterpriseIdentityEditorCredentialFieldsReady = true;
  @state() enterpriseIdentityEditorInitialSecretsConfigured: string[] = [];
  @state() enterpriseIdentityRevokeConfirmId = "";
  @state() enterpriseIdentityVerifyId = "";
  @state() enterpriseIdentityVerifyPhase: "idle" | "running" | "passed" | "failed" = "idle";
  @state() enterpriseIdentityVerifyMessage = "";
  @state() enterpriseDataSourceGovernanceSourceId: string | null = null;
  @state()
  enterpriseDataSourceGovernanceView:
    | import("./controllers/enterprise-data-source-governance.ts").EnterpriseDataSourceGovernanceViewSnapshot
    | null = null;
  @state() enterpriseDataSourceGovernanceBusy = false;
  @state() enterpriseDataSourceGovernanceError: string | null = null;
  @state() userOperationalIdentities:
    | import("./controllers/user-operational-identity.ts").UserOperationalIdentitySnapshot
    | null = null;
  @state() userOperationalIdentityBusy = false;
  @state() userOperationalIdentityError: string | null = null;
  @state() userOperationalIdentityNotice: string | null = null;
  @state() userOperationalIdentityNav: UserOperationalIdentityNav = "bound";
  @state() userOperationalIdentityEditorOpen = false;
  @state() userOperationalIdentityEditorProvider = "";
  @state() userOperationalIdentityEditorDisplayName = "";
  @state() userOperationalIdentityEditorCredentialHandleId = "";
  @state() userOperationalIdentityEditorAppId = "";
  @state() userOperationalIdentityEditorAppSecret = "";
  @state() userOperationalIdentityEditorSmtpHost = "";
  @state() userOperationalIdentityEditorSmtpPort = "587";
  @state() userOperationalIdentityEditorSmtpUser = "";
  @state() userOperationalIdentityEditorImapHost = "";
  @state() userOperationalIdentityEditorImapPort = "993";
  @state() userOperationalIdentityEditorImapUser = "";
  @state() userOperationalIdentityEditorPersonalEmailPresetNote: string | null = null;
  @state() userOperationalIdentityEditorUsePlatformSmtp = false;
  @state() userOperationalIdentityEditorIdentityId: string | null = null;
  @state() userOperationalIdentityEditorGrantAgentId = "";
  @state() wechatPersonalQrWorkerOnline: boolean | null = null;
  @state() wechatPersonalQrStatus: "idle" | "offline" | "scanning" | "logged_in" | "error" = "idle";
  @state() wechatPersonalQrDataUrl: string | null = null;
  @state() wechatPersonalQrMessage: string | null = null;
  @state() wechatPersonalQrWxid: string | null = null;
  @state() userOperationalIdentityOAuthSessionId: string | null = null;
  @state() userOperationalIdentityReturnSessionKey: string | null = null;
  @state() userOperationalIdentityReturnModule: string | null = null;
  @state() userOperationalIdentityReturnAgentId: string | null = null;
  @state() workbenchRobotIdentityGrantFocusAgentId: string | null = null;
  @state() userOperationalIdentityContinuationToken: string | null = null;
  @state() userOperationalIdentityContinuationNotice: string | null = null;
  @state() sessionKey = this.settings.sessionKey;
  @state() chatLoading = false;
  @state() chatSending = false;
  @state() chatMessage = "";
  @state() chatMessages: unknown[] = [];
  /** Latest chat.history status slice for SessionEntry.oguiDecisions. */
  @state() chatOguiDecisions: OguiDecisionStatusLookup | null = null;
  @state() conversationTaskProgress:
    | import("../../../src/progress-ledger/types.ts").ProgressView
    | null = null;
  @state() chatToolMessages: unknown[] = [];
  @state() chatStreamSegments: Array<{
    text: string;
    ts: number;
    replyLanguage?: "zh" | "en" | null;
  }> = [];
  @state() chatStream: string | null = null;
  @state() chatStreamStartedAt: number | null = null;
  @state() chatStreamReplyLanguage: "zh" | "en" | null = null;
  @state() chatStreamSessionKey: string | null = null;
  @state() chatThinkingProgress:
    | import("../../../src/shared/text/thinking-progress.js").ThinkingProgressSnapshot
    | null = null;
  /** Ephemeral live-turn phase. Not transcript and not task evidence. */
  @state() workProgressPhase: import("./chat/work-progress-phase.ts").WorkProgressPhase | null =
    null;
  workProgressToolsInFlight = 0;
  @state() workProgressNarration: string | null = null;
  @state() chatRunId: string | null = null;
  @state() compactionStatus: CompactionStatus | null = null;
  @state() fallbackStatus: FallbackStatus | null = null;
  @state() chatAvatarUrl: string | null = null;
  @state() chatThinkingLevel: string | null = null;
  @state() chatQueue: ChatQueueItem[] = [];
  @state() chatAttachments: ChatAttachment[] = [];
  @state() chatQuoteDraft: ChatQuoteDraft | null = null;
  @state() chatThinkingNowMs = 0;
  @state() chatContextScope: ChatContextScopeState = { ...DEFAULT_CHAT_CONTEXT_SCOPE };
  @state() chatContextSourceCatalog: ChatContextSourceCatalogItem[] | null = null;
  @state() chatContextSourceCatalogLoading = false;
  @state() chatContextExpansion: ChatContextExpansionSuggestion | null = null;
  @state() chatManualRefreshInFlight = false;
  // Per-turn checkpoint rollback (chat-checkpoint-rollback).
  @state() chatCheckpoints: ChatCheckpoint[] = [];
  /** P0 load observability: idle/loading/ready/error/stale/empty (empty ≠ error). */
  @state() chatCheckpointLoadState: ChatCheckpointLoadState = createChatCheckpointLoadState();
  /** P0 visibility diagnostics (ids + reason codes only; no chat bodies). */
  @state() chatCheckpointDiagnostics: ChatCheckpointVisibilityDiagnostic[] = [];
  @state() pendingRestoreCheckpointId: string | null = null;
  @state() restoreInFlightCheckpointId: string | null = null;
  /** One-shot flag consumed by the history reload after a confirmed restore. */
  chatHistoryReplaceLocal = false;
  @state() daibaiLoading = false;
  @state() daibaiError: string | null = null;
  @state() daibaiAskResult: import("../../../src/shared/daibai-types.js").DaibaiAskResult | null =
    null;
  @state() daibaiExecuteResult:
    | import("../../../src/shared/daibai-types.js").DaibaiExecuteResult
    | null = null;
  @state() daibaiActionLoading = false;
  @state() daibaiActionPendingId: string | null = null;
  @state() daibaiActionError: string | null = null;
  @state() daibaiPendingConfirmation: DaibaiPendingConfirmation | null = null;
  @state() meetingPendingConfirmation: MeetingPendingConfirmation | null = null;
  @state() meetingConfirmationLoading = false;
  @state() meetingConfirmationError: string | null = null;
  /** Expired or consumed meeting cards stay visible as invalid; reissue does not reuse the old token. */
  @state() meetingConfirmationOldCardInvalid = false;
  @state() meetingConfirmRelease: MeetingConfirmRelease | null = null;
  @state() meetingScheduleReplayNeeded = false;
  @state() meetingScheduleReplayMeetingId: string | null = null;
  // Sidebar state for tool output viewing
  @state() sidebarOpen = false;
  @state() sidebarPreviewMode: "markdown" | "artifact" = "markdown";
  @state() sidebarSurface: "artifact" | "computer" = "artifact";
  @state() computerPreviewSize: "docked" | "expanded" | "fullscreen" = "docked";
  @state() computerNarrowChat = false;
  @state() computerPreviewRevision = 0;
  @state() sidebarContent: string | null = null;
  @state() sidebarError: string | null = null;
  @state() sidebarArtifactWorkspace: ArtifactWorkspaceSidebar | null = null;
  /** Workspace-file misses — chips for these ids stay non-openable. */
  @state() artifactPreviewMissIds: string[] = [];
  @state() sidebarDeliverableSaveState: DeliverableSaveState | null = null;
  @state() sidebarDeliverableSaveToast: DeliverableSaveToast | null = null;
  private sidebarDeliverableSaveToastTimer: number | null = null;
  private deliverableSaveDecisionResolve:
    | ((choice: DeliverableSaveDecisionChoice | null) => void)
    | null = null;
  @state() workbenchBrandLogoError: string | null = null;
  @state() workbenchActiveGrowthStatus:
    | import("./controllers/agent-growth.ts").GrowthStatusView
    | null = null;
  @state() workbenchGrowthBirthAwakening = false;
  @state() workbenchGrowthBirthTurnSentKey: string | null = null;
  @state() workbenchGrowthPreferCultivate = false;
  @state() splitRatio = this.settings.splitRatio;

  @state() nodesLoading = false;
  @state() nodes: Array<Record<string, unknown>> = [];
  @state() devicesLoading = false;
  @state() devicesError: string | null = null;
  @state() devicesList: DevicePairingList | null = null;
  @state() devicesCurrentDeviceId: string | null = null;
  @state() gatewayConnectedAtMs: number | null = null;
  @state() execApprovalsLoading = false;
  @state() execApprovalsSaving = false;
  @state() execApprovalsDirty = false;
  @state() execApprovalsSnapshot: ExecApprovalsSnapshot | null = null;
  @state() execApprovalsForm: ExecApprovalsFile | null = null;
  @state() execApprovalsSelectedAgent: string | null = null;
  @state() execApprovalsTarget: "gateway" | "node" = "gateway";
  @state() execApprovalsTargetNodeId: string | null = null;
  @state() execApprovalQueue: ExecApprovalRequest[] = [];
  @state() localFileApprovalQueue: LocalFileApprovalRequest[] = [];
  @state() localFileApprovalBusy = false;
  @state() localFileApprovalError: string | null = null;
  @state() execApprovalBusy = false;
  @state() execApprovalError: string | null = null;
  @state() secureFormOffered:
    | import("./gateway-subscriptions/secure-form.ts").SecureFormOfferedUi
    | null = null;
  @state() secureFormValues: Record<string, string> = {};
  @state() secureFormBusy = false;
  @state() secureFormError: string | null = null;
  @state() secureFormReceipt:
    | import("./gateway-subscriptions/secure-form.ts").SecureFormReceiptUi
    | null = null;
  @state() secureFormHandoff:
    | import("./gateway-subscriptions/secure-form.ts").SecureFormHandoffActiveUi
    | null = null;
  @state() loginMethodChoice:
    | import("./gateway-subscriptions/account-computer-login.ts").LoginMethodChoiceUi
    | null = null;
  @state() loginSaveOffer:
    | import("./gateway-subscriptions/account-computer-login.ts").LoginSaveOfferUi
    | null = null;
  @state() loginCardBusy = false;
  @state() loginCardError: string | null = null;
  @state() pendingGatewayUrl: string | null = null;
  pendingGatewayToken: string | null = null;

  @state() configLoading = false;
  @state() configRaw = "{\n}\n";
  @state() configRawOriginal = "";
  @state() configValid: boolean | null = null;
  @state() configIssues: unknown[] = [];
  @state() configSaving = false;
  @state() configApplying = false;
  @state() updateRunning = false;
  @state() applySessionKey = this.settings.lastActiveSessionKey;
  @state() configSnapshot: ConfigSnapshot | null = null;
  @state() configSchema: unknown = null;
  @state() configSchemaVersion: string | null = null;
  @state() configSchemaLoading = false;
  @state() configUiHints: ConfigUiHints = {};
  @state() configForm: Record<string, unknown> | null = null;
  @state() configFormOriginal: Record<string, unknown> | null = null;
  @state() configFormDirty = false;
  @state() configFormMode: "form" | "raw" = "form";
  @state() configSearchQuery = "";
  @state() configActiveSection: string | null = null;
  @state() configActiveSubsection: string | null = null;
  @state() tenantConfigTenantId: string | null = null;
  @state() tenantConfigForm: Record<string, unknown> | null = null;
  @state() tenantConfigBaseHash: string | null = null;
  @state() tenantConfigLoading = false;
  @state() tenantConfigSaving = false;
  @state() tenantConfigDirty = false;
  /** Tenant channel credential failure. Kept off host.lastError so chat stays a gateway signal. */
  @state() tenantConfigError: string | null = null;
  /** Enterprise IM soft-bridge: tenant-scoped channel probe (does not overwrite platform channelsSnapshot). */
  @state() tenantImProbeBusy = false;
  @state() tenantImProbeResult: TenantImProbeResult | null = null;
  @state() tenantImProbeError: string | null = null;
  @state() tenantImSyncBusy = false;
  @state() tenantImIdentityLinkHint: string | null = null;

  @state() channelsLoading = false;
  @state() channelsSnapshot: ChannelsStatusSnapshot | null = null;
  @state() channelsError: string | null = null;
  @state() channelsLastSuccess: number | null = null;
  @state() whatsappLoginMessage: string | null = null;
  @state() whatsappLoginQrDataUrl: string | null = null;
  @state() whatsappLoginConnected: boolean | null = null;
  @state() whatsappBusy = false;
  @state() nostrProfileFormState: NostrProfileFormState | null = null;
  @state() nostrProfileAccountId: string | null = null;

  @state() presenceLoading = false;
  @state() presenceEntries: PresenceEntry[] = [];
  @state() presenceError: string | null = null;
  @state() presenceStatus: string | null = null;

  @state() agentsLoading = false;
  @state() agentsList: AgentsListResult | null = null;
  @state() agentsError: string | null = null;
  @state() meshOwnershipLoading = false;
  @state() meshOwnershipList: MeshOwnershipListResult | null = null;
  @state() meshOwnershipError: string | null = null;
  /** Mesh detail cumulative cost; independent from monthly `usageResult`. */
  @state() meshLifetimeUsageResult: import("./types.js").SessionsUsageResult | null = null;
  @state() agentsSelectedId: string | null = null;
  @state() toolsCatalogLoading = false;
  @state() toolsCatalogError: string | null = null;
  @state() toolsCatalogResult: ToolsCatalogResult | null = null;
  @state() agentsPanel: "overview" | "files" | "tools" | "skills" | "channels" | "cron" =
    "overview";
  @state() agentFilesLoading = false;
  @state() agentFilesError: string | null = null;
  @state() agentFilesList: AgentsFilesListResult | null = null;
  @state() agentFileContents: Record<string, string> = {};
  @state() agentFileDrafts: Record<string, string> = {};
  @state() agentFileActive: string | null = null;
  @state() agentFileSaving = false;
  @state() agentIdentityLoading = false;
  @state() agentIdentityError: string | null = null;
  @state() agentIdentityById: Record<string, AgentIdentityResult> = {};
  @state() agentSkillsLoading = false;
  @state() agentSkillsError: string | null = null;
  @state() agentSkillsReport: SkillStatusReport | null = null;
  @state() agentSkillsAgentId: string | null = null;
  @state() runtimeOverviewLoading = false;
  @state() runtimeOverviewError: string | null = null;
  @state() runtimeAgents: RuntimeAgent[] = [];
  @state() runtimeBindings: RuntimeCapabilityBinding[] = [];
  @state() runtimeTelemetry: RuntimeTelemetry[] = [];
  @state() runtimeGovernanceIssues: RuntimeGovernanceIssue[] = [];
  @state() runtimeKpi: RuntimeKpiData | null = null;
  @state() platformModelsMode: "native" | "aor_enhanced" = "native";
  @state() modelsManagementLoading = false;
  @state() modelsManagementError: string | null = null;
  @state() modelsManagementSnapshot:
    | import("./ports/platform/models/snapshot-types.ts").PlatformModelsManagementSnapshot
    | null = null;

  @state() sessionsLoading = false;
  @state() sessionsResult: SessionsListResult | null = null;
  @state() sessionsError: string | null = null;
  @state() collaborationSpacesLoading = false;
  @state() collaborationSpacesResult: import("./types.js").CollaborationSpacesListResult = null;
  @state() collaborationSpacesError: string | null = null;
  @state() enterpriseOrganizationSnapshot:
    | import("../../../src/gateway/control-ui-contract.js").ControlUiPlatformOrganizationSnapshot
    | null = null;
  @state() enterpriseOrganizationSnapshotLoading = false;
  @state() enterpriseOrganizationSnapshotError: string | null = null;
  @state() enterpriseOrganizationMonthlyUsageLoading = false;
  @state() enterpriseOrganizationMonthlyUsageError: string | null = null;
  @state() enterpriseOrganizationMonthlyUsage: {
    tenantId: string;
    startDate: string;
    endDate: string;
    agents: Array<{
      agentId: string;
      totalTokens: number;
      totalCost: number;
      sessionCount: number;
      lastActiveAt: number | null;
    }>;
    users: Array<{
      userId: string;
      totalTokens: number;
      totalCost: number;
      sessionCount: number;
      lastActiveAt: number | null;
    }>;
    seats: Array<{
      seatId: string;
      agentIds: string[];
      totalTokens: number;
      totalCost: number;
      sessionCount: number;
      lastActiveAt: number | null;
      unmatchedAgentIds: string[];
    }>;
    unmatchedAgentIds: string[];
  } | null = null;
  @state() sessionsFilterActive = "";
  @state() sessionsFilterLimit = "120";
  @state() sessionsIncludeGlobal = true;
  @state() sessionsIncludeUnknown = false;
  @state() sessionsHideCron = true;
  @state() collaborationLearningLoading = false;
  @state() collaborationLearningError: string | null = null;
  @state() collaborationLearningSnapshot = null;
  @state() collaborationLearningRequestKey: string | null = null;
  @state() collaborationObservabilityLoading = false;
  @state() collaborationObservabilityError: string | null = null;
  @state() collaborationObservabilitySnapshot = null;
  @state() collaborationObservabilityRequestKey: string | null = null;
  @state() collaborationGovernanceActionBusyKey: string | null = null;
  @state() collaborationGovernanceActionError: string | null = null;
  @state()
  collaborationRoundPlan:
    | import("../../../src/gateway/collaboration-dispatch/types.js").CollaborationRoundPlanPayload
    | null = null;
  @state() collaborationRoundPlanSessionKey: string | null = null;
  @state() collaborationRoundSummaries: Record<string, string> = {};
  @state() workbenchCollaborationReasonDrawerOpen = false;
  @state() workbenchCollaborationRulesDrawerOpen = false;
  @state() workbenchMemberGovernanceDrawerOpen = false;
  @state()
  collaborationOptionalSuggestions: import("./controllers/collaboration-optional-suggestions.ts").CollaborationOptionalSuggestion[] =
    [];
  @state() collaborationMissionAdvanceBusy = false;
  @state() collaborationMissionAdvanceNotice: string | null = null;
  @state() collaborationMissionAdvanceError: string | null = null;
  @state() knowledgeUniverseLoading = false;
  @state() knowledgeUniverseError: string | null = null;
  @state() knowledgeUniverseQuery = "";
  @state()
  knowledgeUniversePageTab: import("./ports/employee/views/home-page-contracts.ts").KnowledgeUniversePageTab =
    "workbench";
  @state()
  knowledgeUniverseBrowseSubTab: import("./ports/employee/views/home-page-contracts.ts").KnowledgeUniverseBrowseSubTab =
    "personal";
  @state() knowledgeUniversePersonalCollectDrawerOpen = false;
  @state()
  knowledgeUniversePersonalDrawerMode: import("./ports/employee/views/home-page-contracts.ts").KnowledgeUniversePersonalDrawerMode =
    "collect";
  @state() knowledgeUniverseSelectedNodeId: string | null = null;
  @state() knowledgeUniverseSelectedObject:
    | import("./capability/knowledge-universe/types.ts").KnowledgeObject
    | null = null;
  @state() knowledgeUniverseSourceSummary:
    | import("./capability/knowledge-universe/types.ts").KnowledgeSourceSummary
    | null = null;
  @state() knowledgeUniverseGraph:
    | import("./capability/knowledge-universe/types.ts").RelationshipGraph
    | null = null;
  @state() knowledgeUniverseGraphViewModel:
    | import("./capability/knowledge-universe/types.ts").GraphViewModel
    | null = null;
  @state()
  knowledgeUniverseSearchResults: import("./capability/knowledge-universe/types.ts").KnowledgeObject[] =
    [];
  @state()
  knowledgeUniverseWorkspaceSearchGroups: import("./capability/knowledge-universe/workspace-endpoints.ts").WorkspaceSearchGroup[] =
    [];
  @state() knowledgeUniverseWorkspaceSearchTotalCount = 0;
  @state()
  knowledgeUniverseWorkspaceSearchMode:
    | import("./capability/knowledge-universe/workspace-endpoints.ts").WorkspaceSearchMode
    | null = null;
  @state() knowledgeUniverseSelectedWorkspaceSearchHitId: string | null = null;
  @state() knowledgeUniverseSelectedWorkspaceSearchDeliverableId: string | null = null;
  @state() knowledgeUniverseOpenDeliverableMoreMenuId: string | null = null;
  @state()
  knowledgeUniverseDataCapabilities: import("./capability/knowledge-universe/types.ts").DataCapabilityDescriptor[] =
    [];
  @state()
  knowledgeUniverseSourceBrowse: import("./capability/knowledge-universe/types.ts").KnowledgeSourceBrowse =
    { personal: [], enterprise: [], enterpriseRestricted: [] };
  @state()
  knowledgeUniverseExternalDataSources: import("./capability/knowledge-universe/types.ts").ExternalDataSourceSummary[] =
    [];
  @state() knowledgeUniversePersonalCollectTitle = "";
  @state() knowledgeUniversePersonalCollectSummary = "";
  @state() knowledgeUniversePersonalCollectTags = "";
  @state() knowledgeUniversePersonalCollectUrl = "";
  @state() knowledgeUniversePersonalDatasetText = "";
  @state() knowledgeUniversePersonalUploadAttachment:
    | import("./capability/knowledge-universe/endpoints.ts").KnowledgePersonalDocumentAttachment
    | null = null;
  @state() knowledgeUniversePersonalActionBusy = false;
  @state() knowledgeUniversePersonalActionNotice: string | null = null;
  @state() knowledgeUniversePersonalActionError: string | null = null;
  @state() knowledgeUniverseAccessRequestBusyCapabilityId: string | null = null;
  @state() knowledgeUniverseAccessRequestBusyProjectionId: string | null = null;
  @state() knowledgeUniverseAccessRequestNotice: string | null = null;
  @state()
  knowledgeUniverseCapabilityPreview:
    | import("./capability/knowledge-universe/types.ts").KnowledgeCapabilityPreviewState
    | null = null;
  @state()
  knowledgeUniverseCapabilityInvocation:
    | import("./capability/knowledge-universe/types.ts").KnowledgeCapabilityInvocationState
    | null = null;
  @state() knowledgeUniversePersonalManageObjectId: string | null = null;
  @state() knowledgeUniversePersonalManageObjectTitle: string | null = null;
  @state() knowledgeUniversePersonalManageTags = "";
  @state() knowledgeUniversePersonalManageBusy = false;
  @state() knowledgeUniversePersonalManageNotice: string | null = null;
  @state()
  knowledgeUniversePersonalVersions: import("./capability/knowledge-universe/types.ts").PersonalKnowledgeVersionSummary[] =
    [];
  @state() knowledgeUniversePersonalVersionCompareFrom = "";
  @state() knowledgeUniversePersonalVersionCompareTo = "";
  @state() knowledgeUniversePersonalVersionDiff:
    | import("./capability/knowledge-universe/types.ts").PersonalKnowledgeVersionDiff
    | null = null;
  @state()
  knowledgeUniverseRecommendations: import("./capability/knowledge-universe/types.ts").KnowledgeRecommendationItem[] =
    [];
  @state()
  knowledgeUniverseDiscoveryEvents: import("./capability/knowledge-universe/types.ts").KnowledgeDiscoveryEvent[] =
    [];
  @state()
  knowledgeUniverseActionSuggestions: import("./capability/knowledge-universe/types.ts").KnowledgeActionSuggestion[] =
    [];
  @state() knowledgeUniverseHomeInsightsDegraded = false;
  @state()
  knowledgeUniverseHomeFocus:
    | import("./ports/employee/views/home-page-contracts.ts").KnowledgeHomeFocus
    | null = null;
  @state()
  knowledgeUniverseRecentVisits: import("./capability/knowledge-universe/types.ts").KnowledgeRecentVisit[] =
    [];
  @state() knowledgeUniverseRelatedGroups:
    | import("./capability/knowledge-universe/types.ts").KnowledgeRelatedGroups
    | null = null;
  @state() knowledgeUniverseGraphZoom = 1;
  @state() knowledgeUniverseGraphPanX = 0;
  @state() knowledgeUniverseGraphPanY = 0;
  @state() knowledgeUniverseHoveredNodeId: string | null = null;
  @state()
  knowledgeUniverseKnowledgeBases: import("./capability/knowledge-universe/workspace-endpoints.ts").KnowledgeBaseSummary[] =
    [];
  @state() knowledgeUniverseSelectedKnowledgeBaseId: string | null = null;
  @state() knowledgeUniverseKbSearchQuery = "";
  @state()
  knowledgeUniverseKbSearchEvidence: import("./capability/knowledge-universe/workspace-endpoints.ts").KnowledgeEvidenceDto[] =
    [];
  @state() knowledgeUniverseKbSearchMode: "indexed" | "substring" | null = null;
  @state()
  knowledgeUniverseKbSearchSubstringResults: import("./capability/knowledge-universe/types.ts").KnowledgeObject[] =
    [];
  @state()
  knowledgeUniverseWorkspaceDeliverables: import("./capability/knowledge-universe/workspace-endpoints.ts").WorkspaceDeliverableDto[] =
    [];
  @state()
  knowledgeUniverseWorkspaceDeliverableStatusFilter: import("./ports/employee/views/home-page-contracts.ts").WorkspaceDeliverableStatusFilter =
    "all";
  @state() knowledgeUniverseWorkspaceBusy = false;
  @state() knowledgeUniverseWorkspaceNotice: string | null = null;
  @state() knowledgeUniverseWorkspaceError: string | null = null;
  @state() knowledgeUniverseWorkspaceHint: string | null = null;
  @state() knowledgeUniverseWorkspaceDeliverablesUnavailable = false;
  @state() knowledgeUniverseNewKnowledgeBaseTitle = "";
  @state() knowledgeUniverseNewKnowledgeBaseDescription = "";
  @state()
  knowledgeUniverseNewKnowledgeBaseVisibility: import("./capability/knowledge-universe/workspace-endpoints.ts").KnowledgeBaseSummary["visibility"] =
    "private";
  @state() knowledgeUniverseRelationsInsightExpanded = false;
  @state() knowledgeUniverseSupplySectionExpanded = false;
  @state()
  knowledgeUniverseSearchScope: import("./ports/employee/views/home-page-contracts.ts").KnowledgeUniverseSearchScope =
    "workspace";
  @state() knowledgeUniverseSelectedKbSearchHighlightKey: string | null = null;
  @state() knowledgeUniverseWorkspaceDeliverablesExpanded = false;
  @state()
  knowledgeUniverseWorkspaceDeliverableTrace:
    | import("./capability/knowledge-universe/workspace-endpoints.ts").WorkspaceDeliverableTraceDto
    | null = null;
  @state() knowledgeUniverseWorkspaceDeliverableTraceLoading = false;
  @state()
  knowledgeUniverseDeliverableDetailFocus:
    | import("./capability/knowledge-universe/workspace-endpoints.ts").DeliverableDetailFocus
    | null = null;
  @state() knowledgeUniversePinnedKnowledgeBaseIds: string[] = [];
  @state() knowledgeUniverseFavoriteKnowledgeBaseIds: string[] = [];
  @state()
  knowledgeUniverseLibraryWorkspaceContentTab: import("./ports/employee/views/home-page-contracts.ts").LibraryWorkspaceContentTab =
    "documents";
  @state() knowledgeUniverseLibraryWorkspaceDocumentsLoading = false;
  @state()
  knowledgeUniverseLibraryWorkspaceDocuments: import("./capability/knowledge-universe/workspace-endpoints.ts").KnowledgeBaseDocumentSummaryDto[] =
    [];
  @state() knowledgeUniverseLibraryWorkspaceSourcesLoading = false;
  @state()
  knowledgeUniverseLibraryWorkspaceSources: import("./capability/knowledge-universe/workspace-endpoints.ts").KnowledgeBaseSourceListItemDto[] =
    [];
  @state()
  knowledgeUniverseLibraryWorkspaceSourcesPlaneFilter: import("./ports/employee/views/home-page-contracts.ts").LibraryWorkspaceSourcesPlaneFilter =
    "all";
  @state()
  knowledgeUniverseLibraryWorkspaceSnippets: import("./capability/knowledge-universe/workspace-endpoints.ts").KnowledgeBaseSnippetSummaryDto[] =
    [];
  @state() knowledgeUniverseLibraryWorkspaceSnippetsLoading = false;
  @state() knowledgeUniverseLibraryWorkspaceRecycleLoading = false;
  @state()
  knowledgeUniverseLibraryWorkspaceRecycleDocuments: import("./capability/knowledge-universe/workspace-endpoints.ts").KnowledgeBaseDocumentSummaryDto[] =
    [];
  @state()
  knowledgeUniverseLibraryWorkspaceEvictedChunks: import("./capability/knowledge-universe/workspace-endpoints.ts").KnowledgeBaseEvictedChunkSummaryDto[] =
    [];
  @state() knowledgeUniverseLibraryWorkspaceWebPagesLoading = false;
  @state()
  knowledgeUniverseLibraryWorkspaceWebPages: import("./capability/knowledge-universe/workspace-endpoints.ts").KnowledgeBaseWebPageSummaryDto[] =
    [];
  @state() knowledgeUniverseLibraryWorkspaceDatasetsLoading = false;
  @state()
  knowledgeUniverseLibraryWorkspaceDatasets: import("./capability/knowledge-universe/workspace-endpoints.ts").KnowledgeBaseDatasetSummaryDto[] =
    [];
  @state() knowledgeUniverseLibraryWorkspaceAgentKnowledgeLoading = false;
  @state()
  knowledgeUniverseLibraryWorkspaceAgentKnowledge: import("./capability/knowledge-universe/workspace-endpoints.ts").KnowledgeBaseAgentKnowledgeDto[] =
    [];
  @state() knowledgeUniverseLibraryWorkspaceMembersLoading = false;
  @state()
  knowledgeUniverseLibraryWorkspaceMembers: import("./capability/knowledge-universe/workspace-endpoints.ts").KnowledgeBaseMemberDto[] =
    [];
  @state() knowledgeUniverseLibraryWorkspaceInviteDrawerOpen = false;
  @state() knowledgeUniverseLibraryWorkspaceInviteEmail = "";
  @state()
  knowledgeUniverseLibraryWorkspaceInviteRole: import("./capability/knowledge-universe/workspace-endpoints.ts").KnowledgeBaseMemberRoleDto =
    "viewer";
  @state() knowledgeUniverseLibraryWorkspaceInlineRenameKbId: string | null = null;
  @state() knowledgeUniverseLibraryWorkspaceSettingsKbId: string | null = null;
  @state() knowledgeUniverseLibraryWorkspaceSettingsTitle = "";
  @state() knowledgeUniverseLibraryWorkspaceImportOpen = false;
  @state() knowledgeUniverseLibraryWorkspaceImportLockSpace = true;
  @state()
  knowledgeUniverseLibraryWorkspaceImportKind:
    | import("./ports/employee/views/home-page-contracts.ts").SpaceImportKind
    | null = null;
  @state()
  knowledgeUniverseLibraryWorkspaceBindSourceKind: import("./ports/employee/views/home-page-contracts.ts").ActiveSourceBindKind =
    "api";
  @state() knowledgeUniverseLibraryWorkspaceBindSourceTitle = "";
  @state() knowledgeUniverseLibraryWorkspaceBindSourceEndpoint = "";
  @state() knowledgeUniverseLibraryWorkspaceLocalFolderPath = "";
  @state() knowledgeUniverseLibraryWorkspaceLocalFolderLabel = "";
  @state()
  knowledgeUniverseLibraryWorkspaceLocalFolderDeletePolicy: import("./capability/knowledge-universe/endpoints.ts").LocalFolderDeletePolicy =
    "snapshot";
  @state() knowledgeUniverseLibraryWorkspaceLocalFolderWatcherEnabled = false;
  @state()
  knowledgeUniverseLibraryWorkspaceLocalFolderMode: import("./capability/knowledge-universe/endpoints.ts").LocalFolderBindingMode =
    "managed_push";
  @state()
  knowledgeUniverseLibraryWorkspaceLocalFolderStatusItems: import("./capability/knowledge-universe/endpoints.ts").LocalFolderStatusItem[] =
    [];
  @state()
  knowledgeUniverseLibraryWorkspaceMaterialsKindFilter: import("./ports/employee/views/home-page-contracts.ts").LibraryWorkspaceMaterialsKindFilter =
    "all";
  @state()
  knowledgeUniverseLibraryWorkspaceConnectorBindDraft: import("./views/knowledge-universe-space-connector-bind.ts").SpaceConnectorBindDraft =
    createEmptySpaceConnectorBindDraft();
  @state()
  knowledgeUniverseLibraryWorkspaceConnectorCatalog: import("./capability/enterprise-data-capability/types.ts").DataConnectorCatalogEntry[] =
    [];
  @state() knowledgeUniverseLibraryWorkspaceConnectorCatalogLoading = false;
  @state() knowledgeUniverseLibraryWorkspaceConnectorCatalogError: string | null = null;
  @state()
  knowledgeUniverseLibraryWorkspaceConnectorCredentials: import("./capability/enterprise-data-capability/types.ts").DataConnectorCredentialRecord[] =
    [];
  @state() knowledgeUniverseLibraryWorkspaceConnectorCredentialsLoading = false;
  @state() knowledgeUniverseLibraryWorkspaceConnectorProbeOk: boolean | null = null;
  @state() knowledgeUniverseLibraryWorkspaceConnectorProbeMessage: string | null = null;
  @state() knowledgeUniverseLibraryWorkspaceConnectorProbeBusy = false;
  @state() knowledgeUniverseLibraryWorkspaceConnectorOAuthBusy = false;
  @state() knowledgeUniverseLibraryWorkspaceConnectorOAuthNotice: string | null = null;
  @state() knowledgeUniverseLibraryWorkspaceConnectorOAuthError: string | null = null;
  @state() knowledgeUniverseLibraryWorkspaceConnectorOAuthSessionId: string | null = null;
  @state() knowledgeUniverseLibraryWorkspaceConnectorOAuthSimulateAllowed = false;
  @state() knowledgeUniverseLibraryWorkspaceHttpRestExpanded = false;
  @state()
  knowledgeUniverseLibraryWorkspaceDatasetImportTab: import("./views/knowledge-universe-dataset-import.ts").DatasetImportTab =
    "file";
  @state()
  knowledgeUniverseLibraryWorkspaceDatasetFileAttachment:
    | import("./capability/knowledge-universe/personal-document-upload.ts").PersonalDocumentUploadAttachment
    | null = null;
  @state()
  knowledgeUniverseLibraryWorkspaceDatasetPreview:
    | import("./views/knowledge-universe-dataset-import.ts").DatasetImportPreview
    | null = null;
  @state() knowledgeUniverseLibraryWorkspaceDatasetPreviewError: string | null = null;
  @state()
  knowledgeUniverseLibraryWorkspaceUrlImportMode: import("./views/knowledge-universe-url-import.ts").WebUrlImportMode =
    "batch";
  @state() knowledgeUniverseLibraryWorkspaceUrlImportText = "";
  @state() knowledgeUniverseLibraryWorkspaceUrlImportAdvancedOpen = false;
  @state()
  knowledgeUniverseLibraryWorkspaceUrlSyncSchedule: import("./views/knowledge-universe-url-import.ts").WebUrlSyncSchedule =
    "once";
  @state() knowledgeUniverseLibraryWorkspaceUrlStripNavAds = true;
  @state() knowledgeUniverseLibraryWorkspaceUrlMainContentOnly = false;
  @state() knowledgeUniverseLibraryWorkspaceNoteTags: string[] = [];
  @state() knowledgeUniverseLibraryWorkspaceNoteTagDraft = "";
  @state() knowledgeUniverseLibraryWorkspaceNoteTagSuggestionsOpen = false;
  @state() knowledgeUniverseLibraryWorkspaceNoteTagHistory: string[] = [];
  @state() knowledgeUniverseLibraryWorkspaceNoteAiBusy = false;
  @state()
  knowledgeUniverseLibraryWorkspaceFileImportItems: import("./views/knowledge-universe-file-import.ts").FileImportQueueItem[] =
    [];
  @state() knowledgeUniverseLibraryWorkspaceFileImportAdvancedOpen = false;
  @state()
  knowledgeUniverseLibraryWorkspaceFileChunkingStrategy: import("./views/knowledge-universe-file-import.ts").FileChunkingStrategy =
    "auto";
  @state() knowledgeUniverseLibraryWorkspaceFileOcrEnabled = true;
  @state() knowledgeUniverseSearchPanelOpen = false;
  @state()
  knowledgeUniverseGovernanceSummary:
    | import("./capability/knowledge-universe/endpoints.ts").KnowledgeGovernanceSummary
    | null = null;
  @state()
  knowledgeUniverseGovernanceTasks: import("./capability/knowledge-universe/endpoints.ts").KnowledgeGovernanceTask[] =
    [];
  @state() knowledgeUniverseGovernanceLoading = false;
  @state() knowledgeUniverseGovernanceError: string | null = null;
  @state() knowledgeUniverseGovernanceTaskBusyId: string | null = null;
  @state() knowledgeUniverseGovernanceSelectedTaskId: string | null = null;
  @state()
  knowledgeUniverseGovernanceTaskGraph:
    | import("./capability/knowledge-universe/types.ts").RelationshipGraph
    | null = null;
  @state()
  knowledgeUniverseGovernanceTaskGraphViewModel:
    | import("./capability/knowledge-universe/types.ts").GraphViewModel
    | null = null;
  @state() knowledgeUniverseGovernanceTaskGraphLoading = false;
  @state() knowledgeUniverseGovernanceTaskGraphZoom = 1;
  @state() knowledgeUniverseGovernanceTaskGraphPanX = 0;
  @state() knowledgeUniverseGovernanceTaskGraphPanY = 0;
  @state() knowledgeUniverseGovernanceTaskGraphSelectedNodeId: string | null = null;
  @state() knowledgeUniverseGovernanceTaskGraphHoveredNodeId: string | null = null;

  @state() usageLoading = false;
  @state() usageResult: import("./types.js").SessionsUsageResult | null = null;
  @state() usageCostSummary: import("./types.js").CostUsageSummary | null = null;
  @state() usageError: string | null = null;
  @state() usageStartDate = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();
  @state() usageEndDate = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();
  @state() usageSelectedSessions: string[] = [];
  @state() usageSelectedDays: string[] = [];
  @state() usageSelectedHours: number[] = [];
  @state() usageChartMode: "tokens" | "cost" = "tokens";
  @state() usageDailyChartMode: "total" | "by-type" = "by-type";
  @state() usageTimeSeriesMode: "cumulative" | "per-turn" = "per-turn";
  @state() usageTimeSeriesBreakdownMode: "total" | "by-type" = "by-type";
  @state() usageTimeSeries: import("./types.js").SessionUsageTimeSeries | null = null;
  @state() usageTimeSeriesLoading = false;
  @state() usageTimeSeriesCursorStart: number | null = null;
  @state() usageTimeSeriesCursorEnd: number | null = null;
  @state() usageSessionLogs: import("./views/usage.js").SessionLogEntry[] | null = null;
  @state() usageSessionLogsLoading = false;
  @state() usageSessionLogsExpanded = false;
  // Applied query (used to filter the already-loaded sessions list client-side).
  @state() usageQuery = "";
  // Draft query text (updates immediately as the user types; applied via debounce or "Search").
  @state() usageQueryDraft = "";
  @state() usageSessionSort: "tokens" | "cost" | "recent" | "messages" | "errors" = "recent";
  @state() usageSessionSortDir: "desc" | "asc" = "desc";
  @state() usageRecentSessions: string[] = [];
  @state() usageTimeZone: "local" | "utc" = "local";
  @state() usageContextExpanded = false;
  @state() usageHeaderPinned = false;
  @state() usageSessionsTab: "all" | "recent" = "all";
  @state() usageVisibleColumns: string[] = [
    "channel",
    "agent",
    "provider",
    "model",
    "messages",
    "tools",
    "errors",
    "duration",
  ];
  @state() usageLogFilterRoles: import("./views/usage.js").SessionLogRole[] = [];
  @state() usageLogFilterTools: string[] = [];
  @state() usageLogFilterHasTools = false;
  @state() usageLogFilterQuery = "";

  // Non-reactive (don’t trigger renders just for timer bookkeeping).
  usageQueryDebounceTimer: number | null = null;

  @state() cronLoading = false;
  @state() cronJobsLoadingMore = false;
  @state() cronJobs: CronJob[] = [];
  @state() cronJobsTotal = 0;
  @state() cronJobsHasMore = false;
  @state() cronJobsNextOffset: number | null = null;
  @state() cronJobsLimit = 50;
  @state() cronJobsQuery = "";
  @state() cronJobsEnabledFilter: import("./types.js").CronJobsEnabledFilter = "all";
  @state() cronJobsScheduleKindFilter: import("./controllers/cron.js").CronJobsScheduleKindFilter =
    "all";
  @state() cronJobsLastStatusFilter: import("./controllers/cron.js").CronJobsLastStatusFilter =
    "all";
  @state() cronJobsSortBy: import("./types.js").CronJobsSortBy = "nextRunAtMs";
  @state() cronJobsSortDir: import("./types.js").CronSortDir = "asc";
  @state() cronStatus: CronStatus | null = null;
  @state() workbenchPendingTasks:
    | import("./ports/employee/views/workbench-signals.js").WorkbenchPendingTasksSummary
    | null = null;
  @state() workbenchMyTasks:
    | import("./ports/employee/views/workbench-signals.js").WorkbenchMyTasksSummary
    | null = null;
  @state() workbenchNotices:
    | import("./ports/employee/views/workbench-signals.js").WorkbenchNoticesSummary
    | null = null;
  @state() workbenchUpcomingCollaboration:
    | import("./ports/employee/views/workbench-signals.js").WorkbenchUpcomingCollaborationSummary
    | null = null;
  @state() workbenchSchedule:
    | import("./ports/employee/views/workbench-signals.js").WorkbenchScheduleSummary
    | null = null;
  @state() workbenchStewardSuggestion:
    | import("./ports/employee/views/workbench-signals.js").WorkbenchStewardSuggestionSummary
    | null = null;
  @state() cronError: string | null = null;
  @state() cronForm: CronFormState = { ...DEFAULT_CRON_FORM };
  @state() cronFieldErrors: CronFieldErrors = {};
  @state() cronEditingJobId: string | null = null;
  @state() cronRunsJobId: string | null = null;
  @state() cronRunsLoadingMore = false;
  @state() cronRuns: CronRunLogEntry[] = [];
  @state() cronRunsTotal = 0;
  @state() cronRunsHasMore = false;
  @state() cronRunsNextOffset: number | null = null;
  @state() cronRunsLimit = 50;
  @state() cronRunsScope: import("./types.js").CronRunScope = "all";
  @state() cronRunsStatuses: import("./types.js").CronRunsStatusValue[] = [];
  @state() cronRunsDeliveryStatuses: import("./types.js").CronDeliveryStatus[] = [];
  @state() cronRunsStatusFilter: import("./types.js").CronRunsStatusFilter = "all";
  @state() cronRunsQuery = "";
  @state() cronRunsSortDir: import("./types.js").CronSortDir = "desc";
  @state() cronModelSuggestions: string[] = [];
  @state() cronBusy = false;

  @state() updateAvailable: import("./types.js").UpdateAvailable | null = null;

  @state() skillsLoading = false;
  @state() skillsReport: SkillStatusReport | null = null;
  @state() capabilityGovernanceSnapshot: CapabilityGovernanceSnapshot | null = null;
  @state() skillsError: string | null = null;
  @state() skillsFilter = "";
  @state() skillEdits: Record<string, string> = {};
  @state() skillsBusyKey: string | null = null;
  @state() skillMessages: Record<string, SkillMessage> = {};

  @state() debugLoading = false;
  @state() debugModelProbeLoading = false;
  @state() debugStatus: StatusSummary | null = null;
  @state() debugHealth: HealthSnapshot | null = null;
  @state() debugModels: unknown[] = [];
  @state() debugModelProbeSummary: unknown = null;
  @state() debugModelProbeError: string | null = null;
  @state() debugHeartbeat: unknown = null;
  @state() debugCallMethod = "";
  @state() debugCallParams = "{}";
  @state() debugCallResult: string | null = null;
  @state() debugCallError: string | null = null;

  @state() logsLoading = false;
  @state() logsError: string | null = null;
  @state() logsFile: string | null = null;
  @state() logsEntries: LogEntry[] = [];
  @state() logsFilterText = "";
  @state() logsLevelFilters: Record<LogLevel, boolean> = {
    ...DEFAULT_LOG_LEVEL_FILTERS,
  };
  @state() logsAutoFollow = true;
  @state() logsTruncated = false;
  @state() logsCursor: number | null = null;
  @state() logsLastFetchAt: number | null = null;
  @state() logsLimit = 500;
  @state() logsMaxBytes = 250_000;
  @state() logsAtBottom = true;

  client: GatewayBrowserClient | null = null;
  private chatScrollFrame: number | null = null;
  private chatScrollTimeout: number | null = null;
  private chatHasAutoScrolled = false;
  private chatUserNearBottom = true;
  @state() chatNewMessagesBelow = false;
  private nodesPollInterval: number | null = null;
  private logsPollInterval: number | null = null;
  private debugPollInterval: number | null = null;
  private logsScrollFrame: number | null = null;
  private toolStreamById = new Map<string, ToolStreamEntry>();
  private toolStreamOrder: string[] = [];
  refreshSessionsAfterChat = new Set<string>();
  basePath = "";
  private popStateHandler = () => onPopStateInternal(adaptSettingsHost(this));
  private hashChangeHandler = () => onHashChangeInternal(adaptSettingsHost(this));
  private themeMedia: MediaQueryList | null = null;
  private themeMediaHandler: ((event: MediaQueryListEvent) => void) | null = null;
  private topbarObserver: ResizeObserver | null = null;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    handleConnected(adaptLifecycleHost(this));
    void this.handleUserOperationalIdentityOAuthReturnFromUrl();
    this.unsubscribeEnterpriseSurfaceReady = subscribeEnterpriseSurfaceReady(() => {
      this.requestUpdate();
    });
    this.unsubscribeCrossPortShellReady = subscribeCrossPortShellReady(() => {
      this.requestUpdate();
    });
    this.addEventListener(
      DIAGNOSIS_CONVERSATION_ACTION_EVENT,
      this.handleDiagnosisConversationAction,
    );
    this.addEventListener(DIAGNOSIS_OPEN_SESSION_EVENT, this.handleDiagnosisOpenSession);
  }

  protected firstUpdated() {
    handleFirstUpdated(adaptLifecycleHost(this));
    void this.refreshStoredCustomBrandLogoTrim();
  }

  private async refreshStoredCustomBrandLogoTrim() {
    const current = this.settings.customBrandLogoDataUrl;
    if (!current) {
      return;
    }
    const trimmed = await trimCustomBrandLogoDataUrl(current);
    if (trimmed !== current) {
      this.applySettings({
        ...this.settings,
        customBrandLogoDataUrl: trimmed,
      });
    }
  }

  disconnectedCallback() {
    this.unsubscribeEnterpriseSurfaceReady?.();
    this.unsubscribeEnterpriseSurfaceReady = null;
    this.unsubscribeCrossPortShellReady?.();
    this.unsubscribeCrossPortShellReady = null;
    this.removeEventListener(
      DIAGNOSIS_CONVERSATION_ACTION_EVENT,
      this.handleDiagnosisConversationAction,
    );
    this.removeEventListener(DIAGNOSIS_OPEN_SESSION_EVENT, this.handleDiagnosisOpenSession);
    handleDisconnected(adaptLifecycleHost(this));
    super.disconnectedCallback();
  }

  protected updated(changed: Map<PropertyKey, unknown>) {
    handleUpdated(adaptLifecycleHost(this), changed);
  }

  connect() {
    connectGatewayInternal(adaptGatewayHost(this));
  }

  handleChatScroll(event: Event) {
    handleChatScrollInternal(adaptScrollHost(this), event);
  }

  handleLogsScroll(event: Event) {
    handleLogsScrollInternal(adaptScrollHost(this), event);
  }

  exportLogs(lines: string[], label: string) {
    exportLogsInternal(lines, label);
  }

  resetToolStream() {
    resetToolStreamInternal(adaptToolStreamHost(this));
  }

  resetChatScroll() {
    resetChatScrollInternal(adaptScrollHost(this));
  }

  scrollToBottom(opts?: { smooth?: boolean }) {
    resetChatScrollInternal(adaptScrollHost(this));
    scheduleChatScrollInternal(adaptScrollHost(this), true, Boolean(opts?.smooth));
  }

  async loadAssistantIdentity() {
    await assistantIdentityCapability.load(adaptAssistantIdentityLoadCapabilityState(this));
  }

  async submitPlatformAuth() {
    this.platformAuthNotice = null;
    const submittedMode = this.platformAuthMode;
    const submittedLoginIntent = this.platformAuthLoginIntent;
    const result = await submitPlatformAuth(adaptPlatformAuthHost(this));
    this.platformAuthLoginIntent = undefined;
    if (!this.platformAuthError && submittedMode === "password-reset" && result?.passwordReset) {
      const reset = result.passwordReset;
      const tab = passwordResetLoginTab(reset.loginPath, reset.returnSurface);
      this.platformAuthMode = passwordResetLoginMode(tab);
      this.platformAuthNotice = result.notice ?? "密码已更新。请从原来的登录入口重新登录。";
      this.platformAuthError = null;
      if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        const base = (this.basePath ?? "").replace(/\/+$/, "");
        url.pathname = reset.loginPath === "/" ? base || "/" : `${base}${reset.loginPath}`;
        url.search = "";
        url.hash = "";
        window.history.replaceState({}, "", url.href);
      }
      this.setTab(tab);
      return;
    }
    if (!this.platformAuthError) {
      const landOnEmployeeWorkspace = () => {
        this.setTab("me");
        if (shouldUsePublicHomepageForCurrentLocation(this.basePath)) {
          syncUrlWithSessionKey(adaptSettingsHost(this), this.sessionKey, true);
        }
      };
      const platformLoginSucceeded =
        (submittedMode === "platform-bootstrap" ||
          submittedMode === "platform-super-admin-login" ||
          submittedMode === "platform-admin-login") &&
        Boolean(this.platformAuthState?.sessionKind);
      if (
        submittedMode === "platform-bootstrap" ||
        submittedMode === "platform-super-admin-login" ||
        submittedMode === "platform-admin-login" ||
        submittedMode === "enterprise-activate" ||
        submittedMode === "employee-register" ||
        submittedMode === "login" ||
        submittedMode === "password-reset"
      ) {
        this.forcePublicHomepage = false;
      }
      const confirmedSession = Boolean(this.platformAuthState?.session);
      const confirmedTab = confirmedSession
        ? landTabForConfirmedSession(this.platformAuthState)
        : null;
      if (
        confirmedSession &&
        (submittedMode === "platform-bootstrap" ||
          submittedMode === "platform-super-admin-login" ||
          submittedMode === "platform-admin-login" ||
          submittedMode === "login" ||
          submittedMode === "enterprise-activate" ||
          submittedMode === "employee-register") &&
        !confirmedTab
      ) {
        this.platformAuthError = "登录结果与入口不一致，已停止进入工作台。";
        this.platformAuthNotice = null;
        return;
      }
      if (confirmedTab === "platformDashboard") {
        this.setTab("platformDashboard");
      } else if (confirmedTab === "enterpriseOverview") {
        this.setTab("enterpriseOverview");
      } else if (confirmedTab === "me") {
        if (this.platformAuthSeatOfferId?.trim()) {
          this.workbenchPrimaryModule = "settings";
          this.workbenchSettingsView = "personal";
        }
        landOnEmployeeWorkspace();
      }
      const mfaChallengePending =
        this.platformAuthMfaStage === "code" || this.platformAuthMfaStage === "enroll";
      const platformMfaEntry =
        submittedMode === "platform-super-admin-login" || submittedMode === "platform-admin-login";
      if (mfaChallengePending) {
        // A password login is not finished while an authenticator step is open.
        // Only the platform entry shows that step. Employee and enterprise
        // login must not announce a signed-in workspace in the meantime.
        this.platformAuthNotice = platformMfaEntry
          ? t(
              this.platformAuthMfaStage === "enroll"
                ? "authHome.mfa.enrollNotice"
                : "authHome.mfa.requiredNotice",
            )
          : null;
      } else if (
        submittedMode === "platform-bootstrap" ||
        submittedMode === "platform-super-admin-login" ||
        submittedMode === "platform-admin-login"
      ) {
        if (platformLoginSucceeded) {
          this.platformAuthNotice =
            result?.notice ?? t("overview.platformAuth.notice.platformLoginSuccess");
        }
      } else if (submittedMode === "login") {
        const enterpriseWorkspace =
          submittedLoginIntent === "enterprise-admin" ||
          (this.platformAuthState?.sessionDomain === "enterprise" &&
            this.platformAuthState?.sessionKind === "enterprise-admin");
        this.platformAuthNotice =
          result?.notice ??
          t(
            enterpriseWorkspace
              ? "overview.platformAuth.notice.login"
              : "overview.platformAuth.notice.employeeLogin",
          );
      } else {
        this.platformAuthNotice =
          result?.notice ?? t(`overview.platformAuth.notice.${submittedMode}`);
      }
    }
  }

  async submitPlatformTrialApply() {
    this.platformAuthNotice = null;
    const result = await submitPlatformTrialApply(adaptPlatformAuthHost(this));
    if (!this.platformAuthError) {
      this.platformAuthTrialStep = 1;
      this.platformAuthNotice = result?.notice ?? t("authHome.trialApply.notice.auto");
    }
  }

  async logoutPlatformAuth() {
    this.platformAuthNotice = null;
    await logoutPlatformAuth(adaptPlatformAuthHost(this));
    if (!this.platformAuthError) {
      const employeeHome =
        typeof window !== "undefined" ? consoleHostEmployeeHomeUrl(window.location.host) : null;
      if (employeeHome) {
        window.location.assign(employeeHome);
        return;
      }
      this.forcePublicHomepage = true;
      this.platformAuthMode = "employee-register";
      this.tab = "me";
      replaceLocationWithPublicHomepage(this.basePath);
      this.platformAuthNotice = t("overview.platformAuth.logoutSuccess");
    }
  }

  async switchPlatformAuthSessionKind(
    targetSessionKind: "enterprise-admin" | "platform-admin" | "platform-super-admin" | "member",
    tenantId?: string | null,
  ) {
    this.platformAuthNotice = null;
    await switchPlatformAuthSessionKind(adaptPlatformAuthHost(this), {
      targetSessionKind,
      tenantId,
    });
  }

  async setPlatformMfaPolicy(requireMfa: boolean) {
    this.platformAuthNotice = null;
    await setPlatformMfaPolicy(adaptPlatformAuthHost(this), requireMfa);
  }

  async createPlatformAuthInvite() {
    this.platformAuthNotice = null;
    await createPlatformAuthInvite(adaptPlatformAuthHost(this));
    if (!this.platformAuthError) {
      this.platformAuthSeatTitle = "";
      this.platformAuthNotice =
        this.platformAuthState?.sessionKind === "enterprise-admin"
          ? t("overview.platformAuth.employee.issueSuccess", {
              email: this.platformAuthEmail.trim(),
            })
          : t("overview.platformAuth.invite.createSuccess");
    }
  }

  async importEnterpriseOrganizationRows(rows: PlatformEmployeeProvisionInput[]) {
    const entries = rows.filter(
      (row) =>
        row.employeeName.trim() &&
        row.employeeEmail.trim() &&
        row.seatTitle.trim() &&
        (row.teamLabel?.trim() ?? ""),
    );
    this.platformAuthNotice = null;
    this.platformAuthError = null;
    if (entries.length === 0) {
      this.platformAuthError = "没有可导入的组织身份，请检查姓名、邮箱、部门和岗位字段。";
      return;
    }
    const tenantId =
      this.platformAuthState?.enterprise?.id?.trim() ||
      this.platformAuthState?.session?.tenantId?.trim() ||
      "";
    if (!tenantId) {
      this.platformAuthError = "缺少企业租户，无法创建岗位。";
      return;
    }
    this.platformAuthBusy = true;
    const failures: string[] = [];
    let importedCount = 0;
    try {
      for (const entry of entries) {
        try {
          if (entry.seatId?.trim()) {
            await provisionPlatformAuthEmployee(
              adaptPlatformAuthHost(this),
              {
                ...entry,
                seatId: entry.seatId.trim(),
                sendActivationEmail: false,
              },
              {
                manageBusy: false,
                throwOnError: true,
              },
            );
          } else {
            await inviteEmployeeToNewPosition({
              host: adaptPlatformAuthHost(this),
              tenantId,
              employeeName: entry.employeeName,
              employeeEmail: entry.employeeEmail,
              seatTitle: entry.seatTitle,
              teamLabel: entry.teamLabel,
              responsibility: entry.responsibility,
              sendActivationEmail: false,
              manageBusy: false,
              throwOnError: true,
            });
          }
          importedCount += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          failures.push(`${entry.seatTitle} / ${entry.employeeEmail}: ${message}`);
        }
      }
      if (importedCount > 0) {
        await mutateEnterpriseOrganizationDepartmentCommand(adaptPlatformAuthHost(this), tenantId, {
          action: "sync-structure",
          paths: entries.map((entry) => entry.teamLabel?.trim() ?? "").filter(Boolean),
        });
        await this.loadOverview();
      }
      if (failures.length > 0) {
        this.platformAuthNotice = importedCount
          ? `已导入 ${importedCount} 条组织身份，部门结构已自动对齐，成员仍为未激活。请进入邀请激活发送邮件。`
          : null;
        this.platformAuthError = `导入失败 ${failures.length} 条：${failures.slice(0, 3).join("；")}`;
        return;
      }
      this.platformAuthNotice = `已导入 ${importedCount} 条组织身份，部门结构已自动对齐，岗位数字人已生成，成员仍为未激活。请进入邀请激活发送邮件。`;
    } finally {
      this.platformAuthBusy = false;
    }
  }

  async buildEnterpriseOrganization(payload: {
    departmentPaths: string[];
    seats: Array<{
      teamLabel: string;
      seatTitle: string;
      responsibility?: string | null;
      employeeName?: string | null;
      employeeEmail?: string | null;
    }>;
  }) {
    this.platformAuthNotice = null;
    this.platformAuthError = null;
    const tenantId = this.platformAuthState?.enterprise?.id ?? null;
    if (!tenantId) {
      this.platformAuthError = "缺少企业租户上下文，请从企业端组织页重新进入。";
      return;
    }
    const departmentPaths = Array.from(
      new Set(
        [...payload.departmentPaths, ...payload.seats.map((seat) => seat.teamLabel)]
          .map((path) => path?.trim() ?? "")
          .filter((path) => path && path !== "未分组"),
      ),
    );
    const memberRows = payload.seats
      .filter(
        (seat) => seat.seatTitle.trim() && seat.employeeName?.trim() && seat.employeeEmail?.trim(),
      )
      .map((seat) => ({
        employeeName: seat.employeeName!.trim(),
        employeeEmail: seat.employeeEmail!.trim(),
        seatTitle: seat.seatTitle.trim(),
        teamLabel: seat.teamLabel.trim() || null,
        responsibility: seat.responsibility?.trim() || null,
      }));
    const memberSeatKeys = new Set(
      memberRows.map((row) => `${row.teamLabel ?? ""}::${row.seatTitle}`),
    );
    const vacantSeats = payload.seats.filter((seat) => {
      if (!seat.seatTitle.trim()) {
        return false;
      }
      if (seat.employeeName?.trim() && seat.employeeEmail?.trim()) {
        return false;
      }
      return !memberSeatKeys.has(`${seat.teamLabel.trim() || ""}::${seat.seatTitle.trim()}`);
    });
    if (departmentPaths.length === 0 && memberRows.length === 0 && vacantSeats.length === 0) {
      this.platformAuthError = "请至少添加一个部门或岗位。";
      return;
    }
    this.platformAuthBusy = true;
    const failures: string[] = [];
    let createdSeatCount = 0;
    let memberCount = 0;
    try {
      if (departmentPaths.length > 0) {
        await mutateEnterpriseOrganizationDepartmentCommand(adaptPlatformAuthHost(this), tenantId, {
          action: "sync-structure",
          paths: departmentPaths,
        });
      }
      for (const seat of vacantSeats) {
        const result = await createEnterpriseSeatCommand(adaptPlatformAuthHost(this), tenantId, {
          seatTitle: seat.seatTitle.trim(),
          teamLabel: seat.teamLabel.trim() || null,
          responsibility: seat.responsibility?.trim() || null,
        });
        if (result?.seat) {
          createdSeatCount += 1;
        } else {
          failures.push(`${seat.seatTitle}: ${this.platformAuthError ?? "岗位创建失败"}`);
          this.platformAuthError = null;
        }
      }
      for (const row of memberRows) {
        try {
          await inviteEmployeeToNewPosition({
            host: adaptPlatformAuthHost(this),
            tenantId,
            employeeName: row.employeeName,
            employeeEmail: row.employeeEmail,
            seatTitle: row.seatTitle,
            teamLabel: row.teamLabel,
            responsibility: row.responsibility,
            sendActivationEmail: false,
            manageBusy: false,
            throwOnError: true,
          });
          memberCount += 1;
        } catch (error) {
          failures.push(
            `${row.seatTitle}/${row.employeeEmail}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      await this.loadOverview();
      const summaryParts = [
        departmentPaths.length > 0 ? `部门 ${departmentPaths.length} 条` : "",
        createdSeatCount > 0 ? `空岗 ${createdSeatCount} 个` : "",
        memberCount > 0 ? `待激活成员 ${memberCount} 名` : "",
      ].filter(Boolean);
      if (failures.length > 0) {
        this.platformAuthNotice = summaryParts.length
          ? `已搭建：${summaryParts.join(" · ")}。`
          : null;
        this.platformAuthError = `部分内容未创建（${failures.length}）：${failures.slice(0, 3).join("；")}`;
        return;
      }
      this.platformAuthNotice = summaryParts.length
        ? `组织已搭建：${summaryParts.join(" · ")}。岗位数字人已生成，成员仍待邀请激活。`
        : "组织结构已更新。";
    } finally {
      this.platformAuthBusy = false;
    }
  }

  async sendEnterpriseOrganizationActivationEmails(emails?: string[]) {
    this.platformAuthNotice = null;
    // Quiet: invite UI owns per-email busy state; do not raise global platformAuthBusy.
    const payload = await sendPlatformEmployeeActivations(
      adaptPlatformAuthHost(this),
      { emails },
      { quiet: true },
    );
    if (!this.platformAuthError) {
      await this.loadOverview();
      const summary = payload?.activationDelivery;
      if (!summary) {
        this.platformAuthNotice = "激活邮件已处理。";
        return;
      }
      this.platformAuthNotice = formatActivationDeliveryNotice(summary);
    }
  }

  async createPlatformAdmin() {
    this.platformAuthNotice = null;
    await createPlatformAdmin(adaptPlatformAuthHost(this));
    if (!this.platformAuthError) {
      this.platformAuthNotice = t("overview.platformAuth.platform.adminManager.createSuccess");
    }
  }

  async removePlatformAdmin(user: string) {
    this.platformAuthNotice = null;
    await removePlatformAdmin(adaptPlatformAuthHost(this), user);
    if (!this.platformAuthError) {
      this.platformAuthNotice = t("overview.platformAuth.platform.adminManager.removeSuccess", {
        user,
      });
    }
  }

  async revokePlatformAuthInvite(code: string) {
    this.platformAuthNotice = null;
    await revokePlatformAuthInvite(adaptPlatformAuthHost(this), code);
    if (!this.platformAuthError) {
      this.platformAuthNotice = t("overview.platformAuth.invite.revokeSuccess");
    }
  }

  /**
   * 企业端「邀请管理员」: send an admin invite email to an existing employee from
   * the directory. The invitee keeps the employee password and gains dual
   * identity (employee + enterprise admin) after accepting.
   */
  async invitePlatformEnterpriseAdmin(user: string, options?: { resend?: boolean }) {
    this.platformAuthNotice = null;
    const payload = await invitePlatformEnterpriseAdmin(adaptPlatformAuthHost(this), user, options);
    if (this.platformAuthError || !payload) {
      return;
    }
    const receipt = formatAdminActivationEmailReceipt(payload.emailDelivery, user);
    if (receipt.level === "ok") {
      this.platformAuthNotice = `管理员邀请${options?.resend ? "已重新" : "已"}发送。${receipt.text}对方使用原员工账号和密码从企业端登录即可接受。`;
    } else {
      this.platformAuthNotice = "管理员邀请已创建。";
      this.platformAuthError = receipt.text;
    }
  }

  async removePlatformAuthMember(user: string) {
    this.platformAuthNotice = null;
    await removePlatformAuthMember(adaptPlatformAuthHost(this), user);
    if (!this.platformAuthError) {
      this.platformAuthNotice = t("overview.platformAuth.members.removeSuccess", { user });
    }
  }

  async acceptPlatformSeatAssignmentOffer(offerId: string) {
    this.platformAuthNotice = null;
    const result = await acceptPlatformSeatAssignmentOffer(adaptPlatformAuthHost(this), offerId);
    if (!this.platformAuthError) {
      this.platformAuthSeatOfferId = null;
      this.platformAuthNotice = result?.notice ?? "已接受岗位绑定。";
    }
  }

  async declinePlatformSeatAssignmentOffer(offerId: string) {
    this.platformAuthNotice = null;
    const result = await declinePlatformSeatAssignmentOffer(adaptPlatformAuthHost(this), offerId);
    if (!this.platformAuthError) {
      this.platformAuthSeatOfferId = null;
      this.platformAuthNotice = result?.notice ?? "已拒绝岗位绑定。";
    }
  }

  async sendEnterpriseSeatAssignmentOffer(tenantId: string, seatId: string, employeeEmail: string) {
    this.platformAuthNotice = null;
    const result = await sendEnterpriseSeatAssignmentOfferCommand(
      adaptPlatformAuthHost(this),
      tenantId,
      seatId,
      employeeEmail,
      this.enterpriseSeatOfferEditorInheritMode,
      this.enterpriseSeatOfferEditorSelectedAgentIds,
      this.enterpriseSeatOfferEditorSelectedSpaceIds,
      this.enterpriseSeatOfferEditorInheritMemoryScope,
    );
    if (!this.platformAuthError) {
      const notice = formatSeatOfferEmailNotice({
        delivery: result?.emailDelivery,
        email: employeeEmail,
        sentAction: "发送岗位绑定确认邮件",
        sentFallback: "已发送岗位绑定确认邮件。",
        queuedPrefix: "已创建岗位绑定确认",
      });
      this.platformAuthNotice = result?.conflicts?.length
        ? `${notice} 存在 ${result.conflicts.length} 项待处理冲突。`
        : notice;
    }
  }

  async cancelEnterpriseSeatAssignmentOffer(tenantId: string, offerId: string) {
    this.platformAuthNotice = null;
    await cancelEnterpriseSeatAssignmentOfferCommand(
      adaptPlatformAuthHost(this),
      tenantId,
      offerId,
    );
    if (!this.platformAuthError) {
      this.platformAuthNotice = "已撤回岗位绑定确认。";
    }
  }

  async remindEnterpriseSeatAssignmentOffer(
    tenantId: string,
    offerId: string,
    employeeEmail?: string | null,
  ) {
    this.platformAuthNotice = null;
    const result = await remindEnterpriseSeatAssignmentOfferCommand(
      adaptPlatformAuthHost(this),
      tenantId,
      offerId,
    );
    if (!this.platformAuthError) {
      this.platformAuthNotice = formatSeatOfferEmailNotice({
        delivery: result?.emailDelivery,
        email: employeeEmail,
        sentAction: "发送岗位绑定提醒邮件",
        sentFallback: "已发送岗位绑定提醒邮件。",
        queuedPrefix: "已记录岗位绑定提醒",
      });
    }
  }

  async listEnterpriseSeats(tenantId: string) {
    await listEnterpriseSeatsCommand(adaptPlatformAuthHost(this), tenantId);
  }

  async loadEnterpriseOperationalIdentities(tenantId: string) {
    await loadEnterpriseOperationalIdentitiesCommand(
      adaptEnterpriseOperationalIdentityHost(this),
      tenantId,
    );
  }

  async createEnterpriseOperationalIdentity(
    tenantId: string,
    input: {
      displayName: string;
      credentialBindingId: string;
      connectorProfileId?: string;
      externalAccountId?: string;
    },
  ) {
    return createEnterpriseOperationalIdentityCommand(
      adaptEnterpriseOperationalIdentityHost(this),
      tenantId,
      input,
    );
  }

  async revokeEnterpriseOperationalIdentity(tenantId: string, identityId: string) {
    const ok = await revokeEnterpriseOperationalIdentityCommand(
      adaptEnterpriseOperationalIdentityHost(this),
      tenantId,
      identityId,
    );
    if (ok) {
      this.closeEnterpriseIdentityRevokeConfirm();
    }
    return ok;
  }

  async verifyEnterpriseOperationalIdentity(tenantId: string, identityId: string) {
    return verifyEnterpriseOperationalIdentityCommand(
      adaptEnterpriseOperationalIdentityHost(this),
      tenantId,
      identityId,
    );
  }

  async createEnterpriseConnectorCredential(tenantId: string, connectorId: string) {
    return createEnterpriseConnectorCredentialCommand(
      adaptEnterpriseOperationalIdentityHost(this),
      tenantId,
      { connectorId },
    );
  }

  async probeTenantImChannel(tenantId: string, channelId: string) {
    return probeTenantImChannelCommand(this, { tenantId, channelId });
  }

  async syncChannelToOperationalIdentity(tenantId: string, connectorId: string) {
    const { pushAppHistoryState } = await import("./request-app-rerender.ts");
    this.tenantImSyncBusy = true;
    this.tenantImIdentityLinkHint = null;
    try {
      const ok = await this.createEnterpriseConnectorCredential(tenantId, connectorId);
      if (!ok) {
        this.tenantImIdentityLinkHint = "同步失败：无法创建连接器凭证绑定。";
        return false;
      }
      await this.loadEnterpriseOperationalIdentities(tenantId);
      const binding =
        this.enterpriseOperationalIdentities?.eligibleCredentialBindings.find(
          (entry) => entry.connectorId === connectorId && entry.status === "active",
        ) ??
        this.enterpriseOperationalIdentities?.eligibleCredentialBindings.find(
          (entry) => entry.connectorId === connectorId,
        ) ??
        null;
      if (!binding) {
        this.tenantImIdentityLinkHint =
          "凭证绑定已创建，但未找到可注册项；请到「企业身份」手动注册。";
        return false;
      }
      const settingsBase = pathForTab("enterpriseSettings", this.basePath, { tenantId });
      pushAppHistoryState(`${settingsBase}/identities`);
      this.openEnterpriseIdentityEditor({
        mode: "register",
        displayName: connectorId,
        credentialBindingId: binding.credentialBindingId,
      });
      this.tenantImIdentityLinkHint = "已同步连接器凭证，请确认显示名后完成运营身份注册。";
      return true;
    } finally {
      this.tenantImSyncBusy = false;
    }
  }

  async navigateToEnterpriseImChannelCredentials(tenantId: string, channelId: string) {
    const { pushAppHistoryState } = await import("./request-app-rerender.ts");
    this.configActiveSection = channelId;
    pushAppHistoryState(pathForTab("enterpriseChannels", this.basePath, { tenantId }));
  }

  async reauthorizeEnterpriseOperationalIdentity(tenantId: string, identityId: string) {
    return reauthorizeEnterpriseOperationalIdentityCommand(
      adaptEnterpriseOperationalIdentityHost(this),
      tenantId,
      identityId,
    );
  }

  async upsertEnterpriseOperationalIdentityPolicy(
    tenantId: string,
    input: {
      identityId: string;
      policyId?: string;
      seatIds: string[];
      allowedAgentIds: string[];
      allowedActions: string[];
      enabled?: boolean;
    },
  ) {
    return upsertEnterpriseOperationalIdentityPolicyCommand(
      adaptEnterpriseOperationalIdentityHost(this),
      tenantId,
      input,
    );
  }

  openEnterpriseIdentityEditor(params: {
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
    initialSecretsConfigured?: string[];
    credentialFieldsReady?: boolean;
  }) {
    this.enterpriseIdentityEditorOpen = true;
    this.enterpriseIdentityEditorMode = params.mode;
    this.enterpriseIdentityEditorIdentityId = params.identityId?.trim() ?? "";
    this.enterpriseIdentityEditorPolicyId = params.policyId?.trim() ?? "";
    this.enterpriseIdentityEditorBindingId = params.bindingId?.trim() ?? "";
    this.enterpriseIdentityEditorDisplayName = params.displayName?.trim() ?? "";
    this.enterpriseIdentityEditorCredentialBindingId = params.credentialBindingId?.trim() ?? "";
    this.enterpriseIdentityEditorProvider = params.provider?.trim() ?? "";
    this.enterpriseIdentityEditorSeatIds = (params.seatIds ?? []).join(", ");
    this.enterpriseIdentityEditorAgentIds = "";
    this.enterpriseIdentityEditorAllowedActions = (params.allowedActions ?? []).join(", ");
    this.enterpriseIdentityEditorPolicyPickerQuery = "";
    this.enterpriseIdentityEditorPolicyDepartmentPaths = "";
    this.enterpriseIdentityEditorDataSourceId = params.dataSourceId?.trim() ?? "";
    this.enterpriseIdentityEditorBindingPurpose = params.purpose ?? "source_sync";
    this.enterpriseIdentityEditorCredentialFields = { ...params.credentialFields };
    this.enterpriseIdentityEditorInitialSecretsConfigured = [
      ...(params.initialSecretsConfigured ?? []),
    ];
    this.enterpriseIdentityEditorCredentialFieldsReady = params.credentialFieldsReady ?? true;
    this.enterpriseOperationalIdentityError = null;
    this.enterpriseOperationalIdentityNotice = null;
  }

  openEnterpriseIdentityRevokeConfirm(identityId: string) {
    this.enterpriseIdentityRevokeConfirmId = identityId.trim();
  }

  closeEnterpriseIdentityRevokeConfirm() {
    this.enterpriseIdentityRevokeConfirmId = "";
  }

  closeEnterpriseIdentityEditor() {
    this.enterpriseIdentityEditorOpen = false;
    this.enterpriseIdentityEditorIdentityId = "";
    this.enterpriseIdentityEditorPolicyId = "";
    this.enterpriseIdentityEditorBindingId = "";
    this.enterpriseIdentityEditorDisplayName = "";
    this.enterpriseIdentityEditorCredentialBindingId = "";
    this.enterpriseIdentityEditorProvider = "";
    this.enterpriseIdentityEditorSeatIds = "";
    this.enterpriseIdentityEditorAgentIds = "";
    this.enterpriseIdentityEditorAllowedActions = "";
    this.enterpriseIdentityEditorPolicyPickerQuery = "";
    this.enterpriseIdentityEditorPolicyDepartmentPaths = "";
    this.enterpriseIdentityEditorDataSourceId = "";
    this.enterpriseIdentityEditorBindingPurpose = "source_sync";
    this.enterpriseIdentityEditorCredentialFields = {};
    this.enterpriseIdentityEditorCredentialFieldsReady = true;
    this.enterpriseIdentityEditorInitialSecretsConfigured = [];
  }

  async saveEnterpriseIdentityCredentialConfig(tenantId: string) {
    const normalizedTenantId = tenantId.trim();
    const provider = this.enterpriseIdentityEditorProvider.trim();
    const catalog = this.enterpriseOperationalIdentities?.providerCatalog ?? [];
    const entry = catalog.find((item) => item.provider === provider);
    const connectorId = entry?.connectorIds[0]?.trim() ?? "";
    if (!normalizedTenantId || !connectorId) {
      this.enterpriseOperationalIdentityError = "无法识别当前平台通道，请关闭后重试。";
      return null;
    }
    const identityId = this.enterpriseIdentityEditorIdentityId.trim();
    const identity = (this.enterpriseOperationalIdentities?.identities ?? []).find(
      (item) => item.identityId === identityId,
    );
    return upsertEnterpriseOperationalIdentityCredentialCommand(
      adaptEnterpriseOperationalIdentityHost(this),
      normalizedTenantId,
      {
        connectorId,
        fields: this.enterpriseIdentityEditorCredentialFields,
        allowMultiple: this.enterpriseIdentityEditorMode === "register",
        credentialBindingId:
          this.enterpriseIdentityEditorCredentialBindingId.trim() ||
          identity?.credentialBindingId ||
          undefined,
        accountLabel: this.enterpriseIdentityEditorDisplayName.trim() || undefined,
      },
    );
  }

  async startEnterpriseOperationalIdentityOAuth(
    tenantId: string,
    provider: string,
    input?: { seatId?: string; displayName?: string },
  ) {
    return startEnterpriseOperationalIdentityOAuthCommand(
      adaptEnterpriseOperationalIdentityHost(this),
      tenantId,
      provider,
      {
        ...input,
        identityId: this.enterpriseIdentityEditorIdentityId.trim() || undefined,
        credentialBindingId: this.enterpriseIdentityEditorCredentialBindingId.trim() || undefined,
        displayName:
          input?.displayName?.trim() ||
          this.enterpriseIdentityEditorDisplayName.trim() ||
          undefined,
      },
    );
  }

  async updateEnterpriseOperationalIdentity(
    tenantId: string,
    identityId: string,
    input: { displayName: string },
  ) {
    return updateEnterpriseOperationalIdentityCommand(
      adaptEnterpriseOperationalIdentityHost(this),
      tenantId,
      identityId,
      input,
    );
  }

  async submitEnterpriseIdentityEditor(tenantId: string) {
    const normalizedTenantId = tenantId.trim();
    if (!normalizedTenantId) {
      return;
    }
    const host = adaptEnterpriseOperationalIdentityHost(this);
    if (this.enterpriseIdentityEditorMode === "register") {
      const fields = this.enterpriseIdentityEditorCredentialFields ?? {};
      const hasFieldValues = Object.values(fields).some((value) => value.trim().length > 0);
      let bindingId = this.enterpriseIdentityEditorCredentialBindingId.trim();
      if (hasFieldValues) {
        const saved = await this.saveEnterpriseIdentityCredentialConfig(normalizedTenantId);
        if (!saved) {
          return;
        }
        bindingId = saved.credentialBindingId;
        this.enterpriseIdentityEditorCredentialBindingId = bindingId;
      }
      if (!bindingId) {
        this.enterpriseOperationalIdentityError = "请填写凭证、扫码授权，或选择已有凭证后再连接。";
        return;
      }
      await createEnterpriseOperationalIdentityCommand(host, normalizedTenantId, {
        displayName: this.enterpriseIdentityEditorDisplayName.trim(),
        credentialBindingId: bindingId,
      });
    } else if (this.enterpriseIdentityEditorMode === "credential") {
      await this.saveEnterpriseIdentityCredentialConfig(normalizedTenantId);
    } else if (this.enterpriseIdentityEditorMode === "edit") {
      const identityId = this.enterpriseIdentityEditorIdentityId.trim();
      if (!identityId) {
        this.enterpriseOperationalIdentityError = "无法识别要重命名的身份。";
        return;
      }
      await updateEnterpriseOperationalIdentityCommand(host, normalizedTenantId, identityId, {
        displayName: this.enterpriseIdentityEditorDisplayName.trim(),
      });
    } else if (this.enterpriseIdentityEditorMode === "policy") {
      const seatIds = this.enterpriseIdentityEditorSeatIds
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
      await upsertEnterpriseOperationalIdentityPolicyCommand(host, normalizedTenantId, {
        identityId: this.enterpriseIdentityEditorIdentityId.trim(),
        policyId: this.enterpriseIdentityEditorPolicyId.trim() || undefined,
        seatIds,
        allowedAgentIds: [],
        allowedActions: this.enterpriseIdentityEditorAllowedActions
          .split(",")
          .map((entry) => entry.trim())
          .filter(Boolean),
        enabled: true,
      });
    } else {
      await createEnterpriseOperationalIdentityBindingCommand(host, normalizedTenantId, {
        identityId: this.enterpriseIdentityEditorIdentityId.trim(),
        dataSourceId: this.enterpriseIdentityEditorDataSourceId.trim(),
        purpose: this.enterpriseIdentityEditorBindingPurpose,
      });
    }
    if (!this.enterpriseOperationalIdentityError) {
      this.closeEnterpriseIdentityEditor();
    }
  }

  async removeEnterpriseOperationalIdentityBinding(tenantId: string, bindingId: string) {
    const removed = await removeEnterpriseOperationalIdentityBindingCommand(
      adaptEnterpriseOperationalIdentityHost(this),
      tenantId,
      bindingId,
    );
    if (
      removed &&
      this.enterpriseDataSourceGovernanceSourceId &&
      this.enterpriseDataSourceGovernanceView
    ) {
      await this.loadEnterpriseDataSourceGovernanceView(
        tenantId,
        this.enterpriseDataSourceGovernanceSourceId,
      );
    }
    return removed;
  }

  async loadEnterpriseDataSourceGovernanceView(tenantId: string, sourceId: string) {
    return loadEnterpriseDataSourceGovernanceView(this, tenantId, sourceId);
  }

  async openEnterpriseDataSourceGovernanceDetail(tenantId: string, sourceId: string) {
    await this.loadEnterpriseDataSourceGovernanceView(tenantId, sourceId);
  }

  closeEnterpriseDataSourceGovernanceDetail() {
    closeEnterpriseDataSourceGovernanceView(this);
  }

  async loadUserOperationalIdentities() {
    return loadUserOperationalIdentities(this);
  }

  async loadRobotEnterpriseIdentities(agentId: string) {
    await loadRobotEnterpriseIdentityAccess(this, agentId);
  }

  async applyRobotOperationalIdentityGrants(input: {
    agentId: string;
    agentScope: "owned" | "shared" | "group";
    desired: Array<{ identityId: string; allowedActions: string[] }>;
    sessionKey?: string | null;
  }) {
    await applyRobotOperationalIdentityGrants(this, input);
  }

  async applyIdentityOperationalRobotGrants(input: {
    identityId: string;
    desiredAgentIds: string[];
    agentScopesById?: Record<string, "owned" | "shared" | "group">;
    sessionKey?: string | null;
  }) {
    await applyIdentityOperationalRobotGrants(this, input);
  }

  async applyRobotEnterpriseIdentityEnrollments(input: {
    agentId: string;
    desiredIdentityIds: string[];
  }) {
    await applyRobotEnterpriseIdentityEnrollments(this, input);
  }

  openUserOperationalIdentityEditor(provider?: string) {
    openUserOperationalIdentityEditor(this, provider);
    if (!this.userOperationalIdentityEditorGrantAgentId.trim()) {
      this.userOperationalIdentityEditorGrantAgentId =
        this.userOperationalIdentityReturnAgentId?.trim() || "";
    }
  }

  setUserOperationalIdentityNav(nav: UserOperationalIdentityNav) {
    setUserOperationalIdentityNav(this, nav);
  }

  async verifyUserOperationalIdentityCredentials(identityId: string) {
    return verifyUserOperationalIdentityCredentials(this, identityId);
  }

  closeUserOperationalIdentityEditor() {
    closeUserOperationalIdentityEditor(this);
  }

  private async tryResumeUserOperationalIdentityContinuation(): Promise<boolean> {
    const token = this.userOperationalIdentityContinuationToken?.trim();
    if (!token) {
      return false;
    }
    const resume = await resumeUserOperationalIdentityContinuationFlow(this, {
      continuationToken: token,
    });
    if (!resume) {
      return false;
    }
    const module =
      resume.workbenchModule ?? this.userOperationalIdentityReturnModule ?? "assistant";
    this.workbenchPrimaryModule =
      module === "collaboration"
        ? "collaboration"
        : module === "knowledge"
          ? "knowledge"
          : "assistant";
    if (resume.sessionKey) {
      this.sessionKey = resume.sessionKey;
    }
    this.chatMessage = resume.resumeMessage;
    this.userOperationalIdentityContinuationNotice = resume.autoResume
      ? "身份已就绪，正在恢复原任务…"
      : "身份已就绪，可继续原任务。";
    clearUserOperationalIdentityContinuationToken(this);
    clearUserOperationalIdentityBindingReturnContext(this);
    if (resume.autoResume) {
      await this.handleSendChat(resume.resumeMessage);
    }
    return true;
  }

  private async handleUserOperationalIdentityOAuthReturnFromUrl() {
    if (typeof window === "undefined" || !window.location.search) {
      return;
    }
    const params = new URLSearchParams(window.location.search);
    const status = params.get("userIdentityOAuth")?.trim();
    const sessionId = params.get("userIdentityOAuthSessionId")?.trim();
    const errorMessage = params.get("userIdentityOAuthMessage")?.trim();
    if (!status || !sessionId || sessionId === "unknown") {
      return;
    }
    params.delete("userIdentityOAuth");
    params.delete("userIdentityOAuthSessionId");
    params.delete("userIdentityOAuthMessage");
    params.delete("userIdentityOAuthBasePath");
    const nextSearch = params.toString();
    const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash}`;
    window.history.replaceState({}, "", nextUrl);
    this.workbenchPrimaryModule = "settings";
    this.workbenchSettingsView = "personal";
    if (status === "error") {
      this.userOperationalIdentityError = errorMessage || "OAuth 授权失败。";
      return;
    }
    const waitForGateway = async () => {
      for (let index = 0; index < 30; index += 1) {
        if (this.connected && this.client) {
          return true;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 200));
      }
      return false;
    };
    if (!(await waitForGateway())) {
      this.userOperationalIdentityError = "网关未连接，无法完成 OAuth 回调。";
      return;
    }
    const ok = await resumeUserOperationalIdentityOAuthFromReturn(this, sessionId);
    if (ok) {
      await this.tryResumeUserOperationalIdentityContinuation();
    }
  }

  async recheckWechatPersonalChannel() {
    await runRecheckWechatPersonalChannel(this);
  }

  async startWechatPersonalQr() {
    await bindUserOperationalIdentityViaWechatPersonalExisting(this, {
      displayName: this.userOperationalIdentityEditorDisplayName.trim() || "微信个人号",
      agentId:
        this.userOperationalIdentityEditorGrantAgentId.trim() ||
        this.userOperationalIdentityReturnAgentId?.trim() ||
        undefined,
    });
  }

  async submitUserOperationalIdentityEditor() {
    const provider = this.userOperationalIdentityEditorProvider.trim();
    const catalog = this.userOperationalIdentities?.providerCatalog ?? [];
    const entry = catalog.find((item) => item.provider === provider);
    const manualKind =
      entry?.manualKind ??
      (provider === "wechat-official"
        ? "wechat_oa"
        : provider === "personal-email"
          ? "smtp"
          : null);
    await createUserOperationalIdentity(this, {
      displayName: this.userOperationalIdentityEditorDisplayName.trim(),
      provider,
      externalAccountId: this.userOperationalIdentityEditorCredentialHandleId.trim() || undefined,
      appId: this.userOperationalIdentityEditorAppId.trim() || undefined,
      appSecret: this.userOperationalIdentityEditorAppSecret.trim() || undefined,
      accountHandle:
        manualKind === "social_account" || manualKind === "smtp"
          ? this.userOperationalIdentityEditorCredentialHandleId.trim() || undefined
          : undefined,
      accessToken:
        manualKind === "social_account" || manualKind === "smtp"
          ? this.userOperationalIdentityEditorAppSecret.trim() || undefined
          : undefined,
      smtpFrom:
        manualKind === "smtp"
          ? this.userOperationalIdentityEditorCredentialHandleId.trim() || undefined
          : undefined,
      smtpHost:
        manualKind === "smtp"
          ? this.userOperationalIdentityEditorSmtpHost.trim() || undefined
          : undefined,
      smtpPort:
        manualKind === "smtp"
          ? this.userOperationalIdentityEditorSmtpPort.trim() || undefined
          : undefined,
      smtpUser:
        manualKind === "smtp"
          ? this.userOperationalIdentityEditorSmtpUser.trim() || undefined
          : undefined,
      smtpPass:
        manualKind === "smtp"
          ? this.userOperationalIdentityEditorAppSecret.trim() || undefined
          : undefined,
      imapHost:
        manualKind === "smtp"
          ? this.userOperationalIdentityEditorImapHost.trim() || undefined
          : undefined,
      imapPort:
        manualKind === "smtp"
          ? this.userOperationalIdentityEditorImapPort.trim() || undefined
          : undefined,
      imapUser:
        manualKind === "smtp"
          ? this.userOperationalIdentityEditorImapUser.trim() || undefined
          : undefined,
      usePlatformSmtp:
        manualKind === "smtp" ? this.userOperationalIdentityEditorUsePlatformSmtp : undefined,
      identityId: this.userOperationalIdentityEditorIdentityId ?? undefined,
      continuationToken: this.userOperationalIdentityContinuationToken ?? undefined,
      callbackOrigin: window.location.origin,
      basePath: this.basePath,
    });
    if (this.userOperationalIdentityError) {
      return;
    }
    if (await this.tryResumeUserOperationalIdentityContinuation()) {
      return;
    }
    if (this.userOperationalIdentityReturnSessionKey && this.userOperationalIdentityReturnModule) {
      this.workbenchPrimaryModule =
        this.userOperationalIdentityReturnModule === "collaboration"
          ? "collaboration"
          : "assistant";
      if (this.userOperationalIdentityReturnSessionKey) {
        this.sessionKey = this.userOperationalIdentityReturnSessionKey;
      }
      clearUserOperationalIdentityBindingReturnContext(this);
      return;
    }
    if (
      returnToRobotOperationalIdentityGrant(
        this as unknown as Parameters<typeof returnToRobotOperationalIdentityGrant>[0],
        () => {
          this.requestUpdate();
        },
      )
    ) {
      return;
    }
  }

  async completeUserOperationalIdentityOAuthForContinuation(input: {
    continuationToken: string;
    provider: string;
    displayName?: string;
  }) {
    this.userOperationalIdentityContinuationToken = input.continuationToken;
    const ok = await bindUserOperationalIdentityViaOAuth(this, {
      displayName: input.displayName?.trim() || input.provider,
      provider: input.provider,
      continuationToken: input.continuationToken,
      externalAccountId: this.userOperationalIdentityEditorCredentialHandleId.trim() || undefined,
      callbackOrigin: typeof window !== "undefined" ? window.location.origin : undefined,
      returnPath:
        typeof window !== "undefined"
          ? window.location.pathname + window.location.search
          : undefined,
    });
    if (ok) {
      await this.tryResumeUserOperationalIdentityContinuation();
    }
    return ok;
  }

  async revokeUserOperationalIdentity(identityId: string) {
    return revokeUserOperationalIdentity(this, identityId);
  }

  async reauthorizeUserOperationalIdentity(identityId: string) {
    const ok = await reauthorizeUserOperationalIdentity(this, identityId);
    if (ok) {
      await this.tryResumeUserOperationalIdentityContinuation();
    }
    return ok;
  }

  async confirmUserOperationalIdentityGrant(input: {
    identityId: string;
    agentId: string;
    agentScope: "owned" | "shared" | "group";
    allowedActions: string[];
    tenantId?: string;
    seatId?: string;
    sessionKey?: string | null;
  }) {
    const ok = await confirmUserOperationalIdentityGrantCommand(this, input);
    if (ok) {
      await this.tryResumeUserOperationalIdentityContinuation();
    }
    return ok;
  }

  async revokeUserOperationalIdentityGrant(grantId: string) {
    return revokeUserOperationalIdentityGrantRecord(this, grantId);
  }

  async completeUserOperationalIdentityBindingRequest(requestId: string) {
    const ok = await completeUserOperationalIdentityBindingRequest(this, requestId);
    if (ok && (await this.tryResumeUserOperationalIdentityContinuation())) {
      return ok;
    }
    if (
      ok &&
      this.userOperationalIdentityReturnSessionKey &&
      this.userOperationalIdentityReturnModule
    ) {
      this.workbenchPrimaryModule =
        this.userOperationalIdentityReturnModule === "collaboration"
          ? "collaboration"
          : "assistant";
      this.sessionKey = this.userOperationalIdentityReturnSessionKey;
      clearUserOperationalIdentityBindingReturnContext(this);
    }
    return ok;
  }

  openUserOperationalIdentityBindingFlow(params: {
    sessionKey?: string | null;
    module?: string | null;
    agentId?: string;
    provider?: string;
    requestedAction?: string;
    resumeMessage?: string;
    resumeIntentId?: string;
    requiredProviders?: string[];
    autoResume?: boolean;
  }) {
    setUserOperationalIdentityBindingReturnContext(this, params);
    const agentId =
      params.agentId?.trim() ||
      parseAgentSessionKey(params.sessionKey ?? this.sessionKey)?.agentId?.trim() ||
      "main";
    const provider = params.provider?.trim() || "github-personal";
    const requestedAction = params.requestedAction?.trim() || "create_issue";
    const sessionKey = params.sessionKey ?? this.sessionKey;
    void (async () => {
      await handoffUserOperationalIdentityTask(this, {
        agentId,
        provider,
        requestedAction,
        sessionKey,
        workbenchModule: params.module ?? this.workbenchPrimaryModule,
        resumeMessage: params.resumeMessage ?? (this.chatMessage.trim() || undefined),
        resumeIntentId: params.resumeIntentId,
        requiredProviders: params.requiredProviders,
        autoResume: params.autoResume !== false,
      });
    })();
    openPersonalOperationalIdentitySection(
      this as unknown as Parameters<typeof openPersonalOperationalIdentitySection>[0],
      {
        openEditor: true,
        agentId,
        provider,
        scroll: true,
      },
      () => {
        this.requestUpdate();
      },
    );
  }

  async resumeUserOperationalIdentityContinuationNow(continuationToken?: string) {
    if (continuationToken?.trim()) {
      this.userOperationalIdentityContinuationToken = continuationToken.trim();
    } else {
      const ready = this.userOperationalIdentities?.pendingContinuations?.find(
        (entry) => entry.status === "ready_to_resume",
      );
      if (ready?.continuationToken) {
        this.userOperationalIdentityContinuationToken = ready.continuationToken;
      }
    }
    await this.tryResumeUserOperationalIdentityContinuation();
  }

  openEnterpriseSeatOfferEditor(params: {
    mode?: "offer" | "activation";
    seatId: string;
    seatTitle: string;
    seatStatus?: string | null;
    defaultAgentId?: string | null;
    availableAgentIds?: string[];
    defaultSpaceIds?: string[];
    memoryScopeAvailable?: boolean;
    employeeEmail?: string | null;
  }) {
    this.platformAuthNotice = null;
    this.closeEnterpriseHandoverEditor();
    this.enterpriseSeatOfferEditorMode = params.mode ?? "offer";
    this.enterpriseSeatOfferEditorSeatId = params.seatId;
    this.enterpriseSeatOfferEditorSeatTitle = params.seatTitle;
    this.enterpriseSeatOfferEditorSeatStatus = params.seatStatus ?? null;
    this.enterpriseSeatOfferEditorDefaultAgentId = params.defaultAgentId ?? null;
    this.enterpriseSeatOfferEditorAvailableAgentIds = [...(params.availableAgentIds ?? [])];
    this.enterpriseSeatOfferEditorDefaultSpaceIds = [...(params.defaultSpaceIds ?? [])];
    this.enterpriseSeatOfferEditorSelectedAgentIds = [...(params.availableAgentIds ?? [])];
    this.enterpriseSeatOfferEditorSelectedSpaceIds = [...(params.defaultSpaceIds ?? [])];
    this.enterpriseSeatOfferEditorInheritMode = "full";
    this.enterpriseSeatOfferEditorInheritMemoryScope = params.memoryScopeAvailable !== false;
    this.enterpriseSeatOfferEditorMemoryScopeAvailable = params.memoryScopeAvailable === true;
    this.enterpriseSeatOfferEditorEmployeeEmail = params.employeeEmail?.trim() ?? "";
  }

  closeEnterpriseSeatOfferEditor() {
    this.enterpriseSeatOfferEditorMode = "offer";
    this.enterpriseSeatOfferEditorSeatId = null;
    this.enterpriseSeatOfferEditorSeatTitle = "";
    this.enterpriseSeatOfferEditorSeatStatus = null;
    this.enterpriseSeatOfferEditorDefaultAgentId = null;
    this.enterpriseSeatOfferEditorAvailableAgentIds = [];
    this.enterpriseSeatOfferEditorDefaultSpaceIds = [];
    this.enterpriseSeatOfferEditorSelectedAgentIds = [];
    this.enterpriseSeatOfferEditorSelectedSpaceIds = [];
    this.enterpriseSeatOfferEditorInheritMode = "full";
    this.enterpriseSeatOfferEditorInheritMemoryScope = true;
    this.enterpriseSeatOfferEditorMemoryScopeAvailable = false;
    this.enterpriseSeatOfferEditorEmployeeEmail = "";
  }

  openEnterpriseSeatCreateEditor(params?: {
    seatId?: string | null;
    seatTitle?: string | null;
    teamLabel?: string | null;
    responsibility?: string | null;
    employeeEmail?: string | null;
    defaultAgentId?: string | null;
    agentIds?: string[];
  }) {
    this.platformAuthError = null;
    this.platformAuthNotice = null;
    this.closeEnterpriseSeatOfferEditor();
    this.closeEnterpriseHandoverEditor();
    const defaultAgentId = params?.defaultAgentId?.trim() ?? "";
    this.enterpriseSeatCreateEditorOpen = true;
    this.enterpriseSeatCreateEditorSeatId = params?.seatId?.trim() || null;
    this.enterpriseSeatCreateEditorSeatTitle = params?.seatTitle?.trim() ?? "";
    this.enterpriseSeatCreateEditorTeamLabel = params?.teamLabel?.trim() ?? "";
    this.enterpriseSeatCreateEditorResponsibility = params?.responsibility?.trim() ?? "";
    this.enterpriseSeatCreateEditorEmployeeEmail = params?.employeeEmail?.trim() ?? "";
    this.enterpriseSeatCreateEditorDefaultAgentId = defaultAgentId;
    this.enterpriseSeatCreateEditorAgentIds = this.normalizeEnterpriseSeatAgentIds({
      defaultAgentId,
      agentIds: params?.agentIds ?? [],
    });
  }

  closeEnterpriseSeatCreateEditor() {
    this.enterpriseSeatCreateEditorOpen = false;
    this.enterpriseSeatCreateEditorSeatId = null;
    this.enterpriseSeatCreateEditorSeatTitle = "";
    this.enterpriseSeatCreateEditorTeamLabel = "";
    this.enterpriseSeatCreateEditorResponsibility = "";
    this.enterpriseSeatCreateEditorEmployeeEmail = "";
    this.enterpriseSeatCreateEditorDefaultAgentId = "";
    this.enterpriseSeatCreateEditorAgentIds = [];
  }

  openEnterpriseOwnershipTransferEditor(params: {
    tenantId: string;
    subjectKind: "agent" | "group";
    subjectId: string;
    subjectLabel: string;
    positionId: string;
    positionLabel: string;
    currentManagerUserId: string;
    currentManagerLabel: string;
    suggestedUserId?: string | null;
  }) {
    this.platformAuthError = null;
    this.platformAuthNotice = null;
    this.closeEnterpriseSeatOfferEditor();
    this.closeEnterpriseHandoverEditor();
    this.enterpriseOwnershipTransferEditorOpen = true;
    this.enterpriseOwnershipTransferEditorTenantId = params.tenantId;
    this.enterpriseOwnershipTransferEditorSubjectKind = params.subjectKind;
    this.enterpriseOwnershipTransferEditorSubjectId = params.subjectId;
    this.enterpriseOwnershipTransferEditorSubjectLabel = params.subjectLabel.trim();
    this.enterpriseOwnershipTransferEditorPositionId = params.positionId.trim();
    this.enterpriseOwnershipTransferEditorPositionLabel =
      params.positionLabel.trim() || params.positionId.trim();
    this.enterpriseOwnershipTransferEditorCurrentManagerUserId = params.currentManagerUserId.trim();
    this.enterpriseOwnershipTransferEditorCurrentManagerLabel =
      params.currentManagerLabel.trim() || params.currentManagerUserId.trim();
    this.enterpriseOwnershipTransferEditorSelectedUserId = params.suggestedUserId?.trim() ?? "";
  }

  closeEnterpriseOwnershipTransferEditor() {
    this.enterpriseOwnershipTransferEditorOpen = false;
    this.enterpriseOwnershipTransferEditorTenantId = null;
    this.enterpriseOwnershipTransferEditorSubjectKind = null;
    this.enterpriseOwnershipTransferEditorSubjectId = null;
    this.enterpriseOwnershipTransferEditorSubjectLabel = "";
    this.enterpriseOwnershipTransferEditorPositionId = null;
    this.enterpriseOwnershipTransferEditorPositionLabel = "";
    this.enterpriseOwnershipTransferEditorCurrentManagerUserId = null;
    this.enterpriseOwnershipTransferEditorCurrentManagerLabel = "";
    this.enterpriseOwnershipTransferEditorSelectedUserId = "";
  }

  normalizeEnterpriseSeatAgentIds(params: {
    defaultAgentId?: string | null;
    agentIds?: string[];
  }): string[] {
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const value of [params.defaultAgentId, ...(params.agentIds ?? [])]) {
      const id = value?.trim();
      if (!id || seen.has(id)) {
        continue;
      }
      seen.add(id);
      ids.push(id);
    }
    return ids;
  }

  async createEnterpriseSeat(
    tenantId: string,
    params: {
      seatId?: string | null;
      seatTitle: string;
      teamLabel?: string | null;
      responsibility?: string | null;
      defaultAgentId?: string | null;
      agentIds?: string[];
    },
  ) {
    this.platformAuthNotice = null;
    const seatId = params.seatId?.trim();
    const result = seatId
      ? await updateEnterpriseSeatProfileCommand(
          adaptPlatformAuthHost(this),
          tenantId,
          seatId,
          params,
        )
      : await createEnterpriseSeatCommand(adaptPlatformAuthHost(this), tenantId, params);
    if (!this.platformAuthError) {
      const verb = seatId ? "已更新岗位" : "已创建岗位";
      const teamSuffix = result?.seat?.teamLabel?.trim() ? `，团队：${result.seat.teamLabel}` : "";
      const roleCodeSuffix = result?.seat?.roleCode ? `，数字人：${result.seat.roleCode}` : "";
      this.platformAuthNotice = `${verb} ${result?.seat?.title ?? params.seatTitle}${teamSuffix}${roleCodeSuffix}。`;
    }
    return result;
  }

  async submitEnterpriseSeatCreate(tenantId: string) {
    const seatId = this.enterpriseSeatCreateEditorSeatId;
    const seatTitle = this.enterpriseSeatCreateEditorSeatTitle.trim();
    const teamLabel = this.enterpriseSeatCreateEditorTeamLabel.trim();
    const responsibility = this.enterpriseSeatCreateEditorResponsibility.trim();
    const employeeEmail = this.enterpriseSeatCreateEditorEmployeeEmail.trim();
    if (!seatTitle) {
      this.platformAuthError = "请输入岗位名称。";
      return;
    }
    if (!seatId && employeeEmail) {
      this.platformAuthNotice = null;
      const payload = await inviteEmployeeToNewPosition({
        host: adaptPlatformAuthHost(this),
        tenantId,
        employeeName: employeeEmail,
        employeeEmail,
        seatTitle,
        teamLabel: teamLabel || null,
        responsibility: responsibility || null,
        sendActivationEmail: true,
      });
      if (!this.platformAuthError) {
        await this.loadOverview();
        const delivery =
          normalizeSeatOfferEmailDelivery(payload?.activationDelivery) ??
          normalizeSeatOfferEmailDelivery(payload?.emailDelivery);
        this.platformAuthNotice = formatSeatOfferEmailNotice({
          delivery,
          email: employeeEmail,
          sentAction: "发送激活邮件",
          sentFallback: "已创建岗位并发送激活邮件。",
          queuedPrefix: "已创建岗位与待激活成员",
        });
        this.closeEnterpriseSeatCreateEditor();
      }
      return;
    }
    await this.createEnterpriseSeat(tenantId, {
      seatId,
      seatTitle,
      teamLabel: teamLabel || null,
      responsibility: responsibility || null,
    });
    if (!this.platformAuthError) {
      this.closeEnterpriseSeatCreateEditor();
    }
  }

  async submitEnterpriseSeatOffer(tenantId: string) {
    const seatId = this.enterpriseSeatOfferEditorSeatId?.trim();
    const employeeEmail = this.enterpriseSeatOfferEditorEmployeeEmail.trim();
    if (!seatId) {
      return;
    }
    if (!employeeEmail) {
      this.platformAuthError = "请输入接收岗位绑定确认的员工邮箱。";
      return;
    }
    if (this.enterpriseSeatOfferEditorMode === "activation") {
      const pendingEmail = this.platformAuthState?.organization?.seats
        ?.find((seat) => seat.seatId === seatId)
        ?.pendingEmployeeUser?.trim();
      const payload =
        pendingEmail && pendingEmail === employeeEmail
          ? await sendPlatformEmployeeActivations(adaptPlatformAuthHost(this), {
              emails: [employeeEmail],
            })
          : await provisionPlatformAuthEmployee(adaptPlatformAuthHost(this), {
              employeeName: employeeEmail,
              employeeEmail,
              seatId,
              seatTitle: this.enterpriseSeatOfferEditorSeatTitle.trim(),
              sendActivationEmail: true,
            });
      if (!this.platformAuthError) {
        await this.loadOverview();
        const delivery =
          normalizeSeatOfferEmailDelivery(payload?.activationDelivery) ??
          normalizeSeatOfferEmailDelivery(payload?.emailDelivery);
        this.platformAuthNotice = formatSeatOfferEmailNotice({
          delivery,
          email: employeeEmail,
          sentAction: "发送激活邮件",
          sentFallback: "已发送激活邮件。",
          queuedPrefix: "已创建待激活成员",
        });
      }
    } else {
      await this.sendEnterpriseSeatAssignmentOffer(tenantId, seatId, employeeEmail);
    }
    if (!this.platformAuthError) {
      this.closeEnterpriseSeatOfferEditor();
    }
  }

  openEnterpriseHandoverEditor(params: {
    handoverCaseId: string;
    seatTitle: string;
    seatId?: string | null;
    status: string;
    reviewSummary?: string | null;
    exceptionFlags?: string[];
    incomingEmployeeUser?: string | null;
  }) {
    openEnterpriseHandoverEditorInternal(this, params);
  }

  async openEnterpriseHandoverRoute(params: {
    tenantId: string;
    handoverCaseId: string;
    seatTitle?: string;
    status?: string;
    reviewSummary?: string | null;
    exceptionFlags?: string[];
    incomingEmployeeUser?: string | null;
    replace?: boolean;
  }) {
    await openEnterpriseHandoverRouteInternal(this, params);
  }

  async syncEnterpriseHandoverRoute(
    context: {
      tenantId?: string;
      handoverCaseId?: string;
      replace?: boolean;
    } | null,
  ) {
    await syncEnterpriseHandoverRouteInternal(this, context);
  }

  closeEnterpriseHandoverEditor() {
    closeEnterpriseHandoverEditorInternal(this);
  }

  async startEnterpriseSeatHandover(tenantId: string, seatId: string) {
    this.platformAuthNotice = null;
    const result = await startEnterpriseSeatHandoverCommand(
      adaptPlatformAuthHost(this),
      tenantId,
      seatId,
    );
    if (!this.platformAuthError) {
      const handoverCaseId =
        result?.updatedSnapshot?.organization?.handovers.find((entry) => entry.seatId === seatId)
          ?.handoverCaseId ??
        this.platformAuthState?.organization?.handovers.find((entry) => entry.seatId === seatId)
          ?.handoverCaseId ??
        null;
      this.platformAuthNotice = result?.conflicts?.length
        ? `已发起岗位交接，存在 ${result.conflicts.length} 项待处理冲突。`
        : "已发起岗位交接。";
      if (handoverCaseId) {
        await this.openEnterpriseHandoverRoute({
          tenantId,
          handoverCaseId,
          replace: false,
        });
      }
    }
  }

  async nominateEnterpriseSeatHandover(
    tenantId: string,
    handoverCaseId: string,
    employeeEmail: string,
  ) {
    this.platformAuthNotice = null;
    const result = await nominateEnterpriseSeatHandoverCommand(
      adaptPlatformAuthHost(this),
      tenantId,
      handoverCaseId,
      employeeEmail,
    );
    if (!this.platformAuthError) {
      this.platformAuthNotice = result?.conflicts?.length
        ? `已指定继任者，存在 ${result.conflicts.length} 项待处理冲突。`
        : "已指定继任者，可继续审查岗位资产。";
      this.enterpriseHandoverEditorStatus = "asset_review";
      this.enterpriseHandoverEditorSuccessorEmail = employeeEmail;
      await this.syncEnterpriseHandoverRoute({
        tenantId,
        handoverCaseId,
        replace: true,
      });
    }
  }

  async reviewEnterpriseSeatHandover(
    tenantId: string,
    handoverCaseId: string,
    reviewSummary: string,
    exceptionFlags: string[] = [],
    transferSelection?: import("./controllers/enterprise-seat-assets.ts").EnterpriseHandoverTransferSelection,
  ) {
    this.platformAuthNotice = null;
    const result = await reviewEnterpriseSeatHandoverCommand(
      adaptPlatformAuthHost(this),
      tenantId,
      handoverCaseId,
      reviewSummary,
      exceptionFlags,
      transferSelection,
    );
    if (!this.platformAuthError) {
      this.platformAuthNotice = result?.conflicts?.length
        ? `已提交交接审查，记录了 ${result.conflicts.length} 项异常标记。`
        : "已提交交接审查。";
      this.enterpriseHandoverEditorStatus = "pending_approval";
      await this.syncEnterpriseHandoverRoute({
        tenantId,
        handoverCaseId,
        replace: true,
      });
    }
  }

  async approveEnterpriseSeatHandover(tenantId: string, handoverCaseId: string) {
    this.platformAuthNotice = null;
    await approveEnterpriseSeatHandoverCommand(
      adaptPlatformAuthHost(this),
      tenantId,
      handoverCaseId,
    );
    if (!this.platformAuthError) {
      this.platformAuthNotice = "已批准交接冻结。";
      this.enterpriseHandoverEditorStatus = "frozen";
      await this.syncEnterpriseHandoverRoute({
        tenantId,
        handoverCaseId,
        replace: true,
      });
    }
  }

  async rebindEnterpriseSeatHandover(
    tenantId: string,
    handoverCaseId: string,
    employeeEmail: string,
  ) {
    this.platformAuthNotice = null;
    await rebindEnterpriseSeatHandoverCommand(
      adaptPlatformAuthHost(this),
      tenantId,
      handoverCaseId,
      employeeEmail,
    );
    if (!this.platformAuthError) {
      this.platformAuthNotice = `已将岗位交接绑定给 ${employeeEmail}。`;
      this.closeEnterpriseHandoverEditor();
    }
  }

  async mutateEnterpriseOrganizationDepartment(
    tenantId: string,
    mutation: EnterpriseOrganizationDepartmentMutation,
  ) {
    this.platformAuthNotice = null;
    this.platformAuthError = null;
    const result = await mutateEnterpriseOrganizationDepartmentCommand(
      adaptPlatformAuthHost(this),
      tenantId,
      mutation,
    );
    if (!this.platformAuthError) {
      await this.loadOverview();
      return result;
    }
    return undefined;
  }

  async transferMeshOwnership(
    tenantId: string,
    subjectKind: "agent" | "group",
    subjectId: string,
    positionId: string,
    previousUserId: string,
    newUserId: string,
    newUserLabel: string,
  ) {
    this.platformAuthNotice = null;
    if (!this.client || !this.connected) {
      this.platformAuthError = "当前未连接到网关，无法转移归属。";
      return;
    }
    await this.client.request("mesh.ownership.transfer", {
      tenantId,
      subjectKind,
      subjectId,
      positionId,
      previousUserId,
      newUserId,
      newUserLabel,
    });
    await this.loadOverview();
    if (!this.platformAuthError) {
      this.platformAuthNotice = `已将 ${subjectKind === "agent" ? "机器人" : "协作小组"} 归属转移给 ${newUserLabel}。`;
    }
  }

  async submitEnterpriseOwnershipTransfer() {
    const tenantId = this.enterpriseOwnershipTransferEditorTenantId?.trim();
    const subjectKind = this.enterpriseOwnershipTransferEditorSubjectKind;
    const subjectId = this.enterpriseOwnershipTransferEditorSubjectId?.trim();
    const positionId = this.enterpriseOwnershipTransferEditorPositionId?.trim();
    const previousUserId = this.enterpriseOwnershipTransferEditorCurrentManagerUserId?.trim();
    const newUserId = this.enterpriseOwnershipTransferEditorSelectedUserId.trim();
    if (!tenantId || !subjectKind || !subjectId || !positionId || !previousUserId) {
      this.platformAuthError = "当前归属信息不完整，无法提交转移。";
      return;
    }
    if (!newUserId) {
      this.platformAuthError = "请选择新的归属负责人。";
      return;
    }
    const nextMember =
      this.platformAuthState?.members?.find((entry) => entry.user === newUserId) ?? null;
    const newUserLabel = nextMember?.displayName?.trim() || nextMember?.user?.trim() || newUserId;
    await this.transferMeshOwnership(
      tenantId,
      subjectKind,
      subjectId,
      positionId,
      previousUserId,
      newUserId,
      newUserLabel,
    );
    if (!this.platformAuthError) {
      this.closeEnterpriseOwnershipTransferEditor();
    }
  }

  async revokeMeshOwnership(
    tenantId: string,
    subjectKind: "agent" | "group",
    subjectId: string,
    revokedByUserId: string,
    revokedByUserLabel: string,
    reason?: string,
  ) {
    this.platformAuthNotice = null;
    if (!this.client || !this.connected) {
      this.platformAuthError = "当前未连接到网关，无法解绑归属。";
      return;
    }
    await this.client.request("mesh.ownership.revoke", {
      tenantId,
      subjectKind,
      subjectId,
      revokedByUserId,
      revokedByUserLabel,
      reason,
    });
    await this.loadOverview();
    if (!this.platformAuthError) {
      this.platformAuthNotice = `已解绑 ${subjectKind === "agent" ? "机器人" : "协作小组"} 当前归属。`;
    }
  }

  async submitEnterpriseHandoverNominate(tenantId: string) {
    const handoverCaseId = this.enterpriseHandoverEditorCaseId?.trim();
    const successorEmail = this.enterpriseHandoverEditorSuccessorEmail.trim();
    if (!handoverCaseId) {
      return;
    }
    if (!successorEmail) {
      this.platformAuthError = "请选择或输入继任员工邮箱。";
      return;
    }
    await this.nominateEnterpriseSeatHandover(tenantId, handoverCaseId, successorEmail);
  }

  async submitEnterpriseHandoverReview(tenantId: string) {
    const handoverCaseId = this.enterpriseHandoverEditorCaseId?.trim();
    if (!handoverCaseId) {
      return;
    }
    const reviewSummary = this.enterpriseHandoverEditorReviewSummary.trim();
    if (!reviewSummary) {
      this.platformAuthError = "请输入交接审查摘要。";
      return;
    }
    const exceptionFlags = this.enterpriseHandoverEditorExceptionFlags
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    const allHandoverPolicies = [
      ...this.enterpriseHandoverEditorEmployeePolicies,
      ...this.enterpriseHandoverEditorSeatPolicies,
    ];
    const transferSelection = {
      agentIds: [...this.enterpriseHandoverEditorSelectedAgentIds],
      spaceIds: [...this.enterpriseHandoverEditorSelectedSpaceIds],
      dataKeys: [...this.enterpriseHandoverEditorSelectedDataKeys],
      policyIds: filterTransferableHandoverPolicyIds(
        this.enterpriseHandoverEditorSelectedPolicyIds,
        allHandoverPolicies,
      ),
    };
    await this.reviewEnterpriseSeatHandover(
      tenantId,
      handoverCaseId,
      reviewSummary,
      exceptionFlags,
      transferSelection,
    );
  }

  async submitEnterpriseHandoverApproval(tenantId: string) {
    const handoverCaseId = this.enterpriseHandoverEditorCaseId?.trim();
    if (!handoverCaseId) {
      return;
    }
    await this.approveEnterpriseSeatHandover(tenantId, handoverCaseId);
  }

  async submitEnterpriseHandoverRebind(tenantId: string) {
    const handoverCaseId = this.enterpriseHandoverEditorCaseId?.trim();
    const successorEmail = this.enterpriseHandoverEditorSuccessorEmail.trim();
    if (!handoverCaseId) {
      return;
    }
    if (!successorEmail) {
      this.platformAuthError = "请输入继任员工邮箱。";
      return;
    }
    await this.rebindEnterpriseSeatHandover(tenantId, handoverCaseId, successorEmail);
  }

  async changePlatformAuthPassword() {
    this.platformAuthNotice = null;
    await changePlatformAuthPassword(adaptPlatformAuthHost(this), {
      currentPassword: this.platformAuthCurrentPassword,
      newPassword: this.platformAuthNewPassword,
    });
    if (!this.platformAuthError) {
      this.platformAuthCurrentPassword = "";
      this.platformAuthNewPassword = "";
      this.platformAuthNotice = t("overview.platformAuth.passwordChangeSuccess");
    }
  }

  async openPlatformAuthForgotPassword() {
    const email = this.platformAuthState?.session?.user?.trim() ?? this.platformAuthEmail.trim();
    if (email) {
      this.platformAuthEmail = email;
    }
    this.platformAuthNotice = null;
    this.platformAuthError = null;
    this.platformAuthCurrentPassword = "";
    this.platformAuthNewPassword = "";
    await this.logoutPlatformAuth();
    if (!this.platformAuthError) {
      this.platformAuthMode = "forgot-password";
    }
  }

  async updatePlatformTrialPolicy() {
    this.platformAuthNotice = null;
    await updatePlatformTrialPolicy(adaptPlatformAuthHost(this), {
      ...(this.platformAuthPolicyTrialDays.trim()
        ? { defaultTrialDays: Number.parseInt(this.platformAuthPolicyTrialDays.trim(), 10) }
        : {}),
      ...(this.platformAuthPolicySeatCount.trim()
        ? { defaultTrialSeatCount: Number.parseInt(this.platformAuthPolicySeatCount.trim(), 10) }
        : {}),
      upgradeUrl: this.platformAuthPolicyUpgradeUrl.trim(),
      contactAdvisorUrl: this.platformAuthPolicyContactAdvisorUrl.trim(),
    });
    if (!this.platformAuthError) {
      this.platformAuthNotice = t("overview.platformAuth.platform.policyUpdated");
    }
  }

  async updatePlatformTrialInstance(options?: { quiet?: boolean; signal?: AbortSignal }) {
    this.platformAuthNotice = null;
    await updatePlatformTrialInstance(
      adaptPlatformAuthHost(this),
      {
        enterpriseId: this.platformAuthInstanceEnterpriseId.trim(),
        ...(this.platformAuthInstanceTrialDays.trim()
          ? { trialDays: Number.parseInt(this.platformAuthInstanceTrialDays.trim(), 10) }
          : {}),
        ...(this.platformAuthInstanceSeatCount.trim()
          ? { seatCount: Number.parseInt(this.platformAuthInstanceSeatCount.trim(), 10) }
          : {}),
        upgradeUrl: this.platformAuthInstanceUpgradeUrl.trim(),
        contactAdvisorUrl: this.platformAuthInstanceContactAdvisorUrl.trim(),
      },
      options,
    );
    if (!this.platformAuthError) {
      this.platformAuthNotice = t("overview.platformAuth.platform.instanceUpdated");
    }
  }

  async updatePlatformEnterpriseAdmin(
    input: {
      enterpriseId: string;
      adminName: string;
      adminEmail: string;
      resendActivation?: boolean;
    },
    options?: { quiet?: boolean; signal?: AbortSignal },
  ) {
    this.platformAuthNotice = null;
    await updatePlatformEnterpriseAdmin(adaptPlatformAuthHost(this), input, options);
  }

  async resendPlatformEnterpriseAdminActivation(
    input: { enterpriseId: string },
    options?: { quiet?: boolean; signal?: AbortSignal },
  ) {
    this.platformAuthNotice = null;
    await resendPlatformEnterpriseAdminActivation(adaptPlatformAuthHost(this), input, options);
  }

  async approvePlatformTrialApplication(input: {
    applicationId: string;
    trialDays?: number;
    seatCount?: number;
    reviewNote?: string;
  }) {
    this.platformAuthNotice = null;
    await approvePlatformTrialApplication(adaptPlatformAuthHost(this), input);
    if (!this.platformAuthError) {
      this.platformAuthNotice = "试用申请已通过，激活邮件已发出。";
      await this.loadOverview();
    }
  }

  async rejectPlatformTrialApplication(input: {
    applicationId: string;
    rejectionReason: string;
    reviewNote?: string;
  }) {
    this.platformAuthNotice = null;
    await rejectPlatformTrialApplication(adaptPlatformAuthHost(this), input);
    if (!this.platformAuthError) {
      this.platformAuthNotice = "试用申请已拒绝。";
      await this.loadOverview();
    }
  }

  applySettings(next: UiSettings) {
    applySettingsInternal(adaptSettingsHost(this), next);
  }

  setTab(next: Tab) {
    setTabInternal(adaptSettingsHost(this), next);
  }

  setTheme(next: ThemeMode, context?: Parameters<typeof setThemeInternal>[2]) {
    setThemeInternal(adaptSettingsHost(this), next, context);
  }

  async loadOverview() {
    await loadOverviewInternal(adaptSettingsHost(this));
    await refreshEnterpriseOrganizationSnapshot(this);
  }

  /** 组织页刷新：强制重拉 organization shell（含独立月度用量 RPC）+ snapshot。 */
  async refreshEnterpriseOrganization() {
    await loadEnterpriseTabShellInternal(adaptSettingsHost(this), "enterpriseOrganization", {
      force: true,
    });
    await Promise.all([
      refreshEnterpriseOrganizationSnapshot(this),
      loadEnterpriseOrganizationMonthlyUsage(
        this as unknown as Parameters<typeof loadEnterpriseOrganizationMonthlyUsage>[0],
      ),
    ]);
  }

  async loadCron() {
    await loadCronInternal(adaptSettingsHost(this));
  }

  async refreshWorkspace() {
    await refreshActiveTabInternal(adaptSettingsHost(this));
  }

  async loadCollaborationLearningSnapshot(opts?: { force?: boolean }) {
    await loadCollaborationLearningSnapshot(this, opts);
  }

  async loadCollaborationObservabilitySnapshot(opts?: { force?: boolean; taskId?: string | null }) {
    await loadCollaborationObservabilitySnapshot(this, opts);
  }

  resetCollaborationObservabilitySnapshot() {
    resetCollaborationObservabilitySnapshot(this);
  }

  async loadModelsManagement() {
    await loadPlatformModelsManagementSnapshot(this);
  }

  resetCollaborationLearningSnapshot() {
    resetCollaborationLearningSnapshot(this);
    resetCollaborationObservabilitySnapshot(this);
  }

  async loadKnowledgeUniverseHome(opts?: { force?: boolean }) {
    await loadKnowledgeUniverseHomeInternal(
      this as unknown as Parameters<typeof loadKnowledgeUniverseHomeInternal>[0],
      opts,
    );
  }

  async transitionCollaborationGovernanceObject(params: {
    kind: WorkbenchGovernanceObjectKind;
    id: string;
    toStatus: string;
    selectedOption?: string;
  }) {
    await transitionCollaborationGovernanceObject(this, params);
  }

  async saveCollaborationDecisionDraft(params: {
    id: string;
    rationale?: string;
    selectedOption?: string;
    options?: Array<{ optionId: string; title: string }>;
  }) {
    await saveCollaborationDecisionDraft(this, params);
  }

  resetCollaborationGovernanceActionState() {
    resetCollaborationGovernanceActionState(this);
  }

  async askDaibai(message?: string) {
    await askDaibaiInternal(adaptDaibaiState(this), message);
  }

  async executeDaibaiAction(actionId: string, payload?: Record<string, unknown>) {
    await executeDaibaiActionInternal(adaptDaibaiState(this), actionId, payload);
    await this.refreshSignalsAfterScheduleDaibaiWrite();
  }

  async confirmDaibaiPendingAction() {
    await confirmDaibaiPendingActionInternal(adaptDaibaiState(this));
    await this.refreshSignalsAfterScheduleDaibaiWrite();
  }

  private async refreshSignalsAfterScheduleDaibaiWrite() {
    if (
      this.daibaiExecuteResult?.status === "executed" &&
      this.daibaiExecuteResult.actionId === "schedule.entry.add"
    ) {
      await refreshWorkbenchSignals(adaptSpacesLoadCapabilityState(this));
    }
  }

  cancelDaibaiPendingConfirmation() {
    cancelDaibaiPendingConfirmationInternal(adaptDaibaiState(this));
  }

  async syncMeetingPendingConfirmation() {
    await syncShellMeetingPendingConfirmation(adaptSpacesLoadCapabilityState(this));
  }

  async confirmMeetingPendingApproval() {
    // Pause-release: wake the same steward conversation without a silent void.
    // Suppress optimistic user bubble — epilogue already shows release progress.
    await confirmShellMeetingPendingApproval(adaptSpacesLoadCapabilityState(this), (userMessage) =>
      this.handleSendChat(userMessage, { suppressOptimisticUserMessage: true }),
    );
  }

  cancelMeetingPendingConfirmation() {
    cancelShellMeetingPendingConfirmation(adaptSpacesLoadCapabilityState(this));
  }

  dismissMeetingConfirmRelease() {
    dismissShellMeetingConfirmRelease(adaptSpacesLoadCapabilityState(this));
  }

  async openDaibaiHelpFromModule(params: {
    moduleLabel: string;
    contextMessage?: string;
    sourceSessionKey?: string;
  }) {
    await openDaibaiHelpFromModuleInternal(adaptDaibaiState(this), params);
    // Load steward history before send so the UI does not keep showing the prior
    // collaboration-group transcript while the message goes to 大白.
    await reloadShellChatHistory(this as unknown as Parameters<typeof reloadShellChatHistory>[0], {
      refreshAvatar: true,
    });
    await this.handleSendChat();
  }

  private readonly handleDiagnosisOpenSession = (event: Event) => {
    const detail = readDiagnosisOpenSession(event);
    if (!detail) {
      return;
    }
    this.sessionKey = detail.sessionKey;
    if (this.tab !== "me") {
      this.setTab("me");
    }
  };

  private readonly handleDiagnosisConversationAction = (event: Event) => {
    const action = readDiagnosisConversationAction(event);
    if (!action) {
      return;
    }
    if (
      action.handoffChannel === "diagnosed_agent_session" &&
      action.targetAgentId &&
      action.targetSessionKey
    ) {
      if (this.tab !== "me") {
        this.setTab("me");
      }
      void this.dispatchDiagnoseAgentHandoff(action);
      return;
    }
    // Owner / steward items stay in the Da Bai conversation.
    if (action.source === "chat") {
      void this.handleSendChat(action.prompt);
      return;
    }
    if (this.tab !== "me") {
      this.setTab("me");
    }
    void this.openDaibaiHelpFromModule({
      moduleLabel: "智能诊断",
      contextMessage: action.prompt,
    });
  };

  private async dispatchDiagnoseAgentHandoff(action: {
    title: string;
    prompt: string;
    targetAgentId?: string;
    targetSessionKey?: string;
  }) {
    if (!action.targetAgentId || !action.targetSessionKey) {
      return;
    }
    setDiagnosisApiClient(this.client);
    const result = await runDiagnosisActionDispatch({
      title: action.title || "诊断建议",
      agentPrompt: action.prompt,
      targetAgentId: action.targetAgentId,
      targetSessionKey: action.targetSessionKey,
    });
    if (result?.ok) {
      await reloadShellChatHistory(
        this as unknown as Parameters<typeof reloadShellChatHistory>[0],
        {
          refreshAvatar: true,
        },
      );
      return;
    }
    if (result?.reason === "session_missing" || result?.reason === "unavailable") {
      await this.openDaibaiHelpFromModule({
        moduleLabel: "智能诊断",
        contextMessage: action.prompt,
      });
    }
  }

  async handleAbortChat() {
    await handleAbortChatInternal(adaptChatAbortHost(this));
  }

  async handleRestoreChat() {
    try {
      await restoreShellChat(this);
    } catch (err) {
      this.lastError = this.formatCheckpointRestoreError(err);
    }
  }

  /** Fetch the active session's restorable checkpoints for the inline dividers. */
  async loadChatCheckpoints() {
    await loadChatCheckpointsForHost(this);
  }

  /** P0: clear checkpoints + load state when the restore session surface changes. */
  isolateChatCheckpointLoadForSession(nextSessionKey: string | null) {
    applyChatCheckpointSessionIsolation(this, nextSessionKey);
  }

  requestRestoreCheckpoint(checkpointId: string) {
    if (this.restoreInFlightCheckpointId) {
      // A restore is already running: ignore further restore clicks.
      return;
    }
    this.pendingRestoreCheckpointId = checkpointId;
  }

  cancelRestoreCheckpoint() {
    this.pendingRestoreCheckpointId = null;
  }

  private formatCheckpointRestoreError(err: unknown): string {
    if (err instanceof ChatRestoreNotConnectedError) {
      return t("chat.checkpoint.restoreDisconnected");
    }
    if (
      err instanceof ChatRestoreTimeoutError ||
      readRestoreErrorReasonCode(err) === "RESTORE_TIMEOUT"
    ) {
      return t("chat.checkpoint.restoreTimedOut");
    }
    if (readRestoreErrorReasonCode(err) === "RESTORE_IN_PROGRESS") {
      return t("chat.checkpoint.restoreInProgress");
    }
    const rawMessage = err instanceof Error ? err.message : typeof err === "string" ? err : "";
    const raw = rawMessage
      .replace(/^GatewayRequestError:\s*/i, "")
      .replace(/^failed to restore checkpoint:\s*/i, "")
      .trim();
    const detail = raw || t("chat.checkpoint.restoreFailed");
    return detail === t("chat.checkpoint.restoreFailed")
      ? detail
      : `${t("chat.checkpoint.restoreFailed")}: ${detail}`;
  }

  /**
   * Confirm a checkpoint restore. Targets the specific checkpoint via
   * chat.restore({ checkpointId }), which reverts workspace files + truncates
   * the transcript to that checkpoint's boundary. No receipt message is
   * injected — we reload the (now truncated) conversation so the rollback
   * itself is the confirmation, and refresh the inline checkpoint dividers.
   */
  async confirmRestoreCheckpoint(checkpointId: string) {
    if (this.restoreInFlightCheckpointId) {
      // Ignore repeated confirm clicks while a restore is running; the backend
      // also rejects duplicates with RESTORE_IN_PROGRESS.
      return;
    }
    if (!this.client || !this.connected) {
      this.lastError = t("chat.checkpoint.restoreDisconnected");
      this.pendingRestoreCheckpointId = null;
      return;
    }
    const effectiveCheckpointId = resolveEffectiveChatRestoreCheckpointId(
      this.chatCheckpoints,
      this.chatMessages,
      checkpointId,
    );
    this.restoreInFlightCheckpointId = effectiveCheckpointId;
    let restored = false;
    try {
      const result = await restoreShellChat(this, effectiveCheckpointId);
      this.pendingRestoreCheckpointId = null;
      if (result?.queued) {
        // The RPC returned before any rollback. Reloading history here looks
        // like a successful restore of an unchanged thread.
        this.lastError = t("chat.checkpoint.restoreQueued");
        return;
      }
      this.lastError = null;
      restored = true;
    } catch (err) {
      this.pendingRestoreCheckpointId = null;
      this.lastError = this.formatCheckpointRestoreError(err);
    } finally {
      // Drop the busy flag as soon as chat.restore settles. A hung history
      // reload must not leave 「正在恢复…」 stuck.
      this.restoreInFlightCheckpointId = null;
    }
    if (!restored) {
      return;
    }
    const beforeCount = this.chatMessages.length;
    const beforeTail = readVisibleChatTailId(this.chatMessages);
    const restoredSessionKey = resolveChatRestoreSessionKey(this);
    this.chatHistoryReplaceLocal = true;
    try {
      // reloadShellChatHistory also refreshes the checkpoint dividers via
      // loadChatCheckpoints, so the truncated history + dividers stay in sync.
      await reloadShellChatHistory(this as unknown as Parameters<typeof reloadShellChatHistory>[0]);
    } catch (err) {
      this.chatHistoryReplaceLocal = false;
      this.lastError = this.formatCheckpointRestoreError(err);
      return;
    }
    if (!sessionKeysShareChatSurface(this.sessionKey, restoredSessionKey)) {
      return;
    }
    const afterCount = this.chatMessages.length;
    const afterTail = readVisibleChatTailId(this.chatMessages);
    if (beforeCount > 0 && afterCount === beforeCount && afterTail === beforeTail) {
      this.lastError = t("chat.checkpoint.restoreUnchanged");
    }
  }

  removeQueuedMessage(id: string) {
    removeQueuedMessageInternal(adaptChatQueueHost(this), id);
  }

  async handleSendChat(messageOverride?: string, opts?: AppChatSendOptions) {
    await runAppChatSend(
      this,
      handleSendChatInternal,
      adaptChatSendHost(this),
      messageOverride,
      opts,
    );
  }

  async handleWhatsAppStart(force: boolean) {
    await handleWhatsAppStartInternal(this, force);
  }

  async handleWhatsAppWait() {
    await handleWhatsAppWaitInternal(this);
  }

  async handleWhatsAppLogout() {
    await handleWhatsAppLogoutInternal(this);
  }

  async handleChannelConfigSave() {
    await handleChannelConfigSaveInternal(this);
  }

  async handleChannelConfigReload() {
    await handleChannelConfigReloadInternal(this);
  }

  handleNostrProfileEdit(accountId: string, profile: NostrProfile | null) {
    handleNostrProfileEditInternal(this, accountId, profile);
  }

  handleNostrProfileCancel() {
    handleNostrProfileCancelInternal(this);
  }

  handleNostrProfileFieldChange(field: keyof NostrProfile, value: string) {
    handleNostrProfileFieldChangeInternal(this, field, value);
  }

  async handleNostrProfileSave() {
    await handleNostrProfileSaveInternal(this);
  }

  async handleNostrProfileImport() {
    await handleNostrProfileImportInternal(this);
  }

  handleNostrProfileToggleAdvanced() {
    handleNostrProfileToggleAdvancedInternal(this);
  }

  /**
   * Answer a disk read card.
   *
   * Only two decisions exist; the gateway rejects anything else rather than
   * downgrading it, so there is no "always allow" path to guard against here.
   */
  async handleLocalFileApprovalDecision(decision: "allow-once" | "deny") {
    const active = this.localFileApprovalQueue[0];
    if (!active || !this.client || this.localFileApprovalBusy) {
      return;
    }
    this.localFileApprovalBusy = true;
    this.localFileApprovalError = null;
    try {
      await this.client.request("localFiles.approval.resolve", {
        id: active.id,
        decision,
      });
      this.localFileApprovalQueue = this.localFileApprovalQueue.filter(
        (entry) => entry.id !== active.id,
      );
    } catch (err) {
      // Leave the card up: the request may still be answerable, and silently
      // dropping it would look like an approval that never happened.
      this.localFileApprovalError = `Local file approval failed: ${String(err)}`;
    } finally {
      this.localFileApprovalBusy = false;
    }
  }

  async handleExecApprovalDecision(decision: "allow-once" | "allow-always" | "deny") {
    const active = this.execApprovalQueue[0];
    if (!active || !this.client || this.execApprovalBusy) {
      return;
    }
    this.execApprovalBusy = true;
    this.execApprovalError = null;
    try {
      await this.client.request("exec.approval.resolve", {
        id: active.id,
        decision,
      });
      this.execApprovalQueue = this.execApprovalQueue.filter((entry) => entry.id !== active.id);
    } catch (err) {
      this.execApprovalError = `Exec approval failed: ${String(err)}`;
    } finally {
      this.execApprovalBusy = false;
    }
  }

  handleSecureFormFieldInput(fieldId: string, value: string) {
    if (!this.secureFormOffered || this.secureFormBusy) {
      return;
    }
    this.secureFormValues = { ...this.secureFormValues, [fieldId]: value };
  }

  async handleSecureFormSubmit() {
    const offered = this.secureFormOffered;
    if (!offered || !this.client || this.secureFormBusy) {
      return;
    }
    this.secureFormBusy = true;
    this.secureFormError = null;
    const values: Record<string, string> = { ...this.secureFormValues };
    try {
      await this.client.request("secure_form.submit", {
        formId: offered.formId,
        sessionKey: offered.sessionKey,
        values,
      });
      // Receipt WS event clears the card; clear local values immediately so
      // secrets never linger even if the event is delayed.
      for (const key of Object.keys(this.secureFormValues)) {
        this.secureFormValues[key] = "";
        delete this.secureFormValues[key];
      }
      this.secureFormValues = {};
    } catch (err) {
      this.secureFormError = `Secure form submit failed: ${String(err)}`;
    } finally {
      // Zeroize the local copy used for the RPC.
      for (const key of Object.keys(values)) {
        values[key] = "";
        delete values[key];
      }
      this.secureFormBusy = false;
    }
  }

  async handleSecureFormClose() {
    const offered = this.secureFormOffered;
    if (!offered || !this.client || this.secureFormBusy) {
      return;
    }
    this.secureFormBusy = true;
    this.secureFormError = null;
    try {
      await this.client.request("secure_form.cancel", {
        formId: offered.formId,
        code: "user_declined",
      });
      for (const key of Object.keys(this.secureFormValues)) {
        this.secureFormValues[key] = "";
        delete this.secureFormValues[key];
      }
      this.secureFormValues = {};
      this.secureFormOffered = null;
    } catch (err) {
      this.secureFormError = `Secure form close failed: ${String(err)}`;
    } finally {
      this.secureFormBusy = false;
    }
  }

  async handleSecureFormUseComputer() {
    const offered = this.secureFormOffered;
    if (!offered || !this.client || this.secureFormBusy) {
      return;
    }
    this.secureFormBusy = true;
    this.secureFormError = null;
    try {
      // Decision C: cancel Form (cancelled_by_takeover) then takeControl via handoff.
      await this.client.request("secure_form.handoff", {
        sessionKey: offered.sessionKey,
        relatedFormId: offered.formId,
        reason: "user_takeover",
      });
      for (const key of Object.keys(this.secureFormValues)) {
        this.secureFormValues[key] = "";
        delete this.secureFormValues[key];
      }
      this.secureFormValues = {};
      this.secureFormOffered = null;
      // Decision F: local entry card until WS handoff_active (or if broadcast races ahead).
      this.secureFormHandoff = {
        sessionKey: offered.sessionKey,
        instruction: "", // body falls back to i18n chat.secureFormHandoffHint
        reason: "user_takeover",
      };
      // Refresh docked preview so the Tab shows user control / 交给AI — never fullscreen jump.
      const { takeoverComputerPreview, setComputerPreviewSize } =
        await import("./views/account-computer-preview.ts");
      if (this.computerPreviewSize === "fullscreen") {
        setComputerPreviewSize(this, "docked");
      }
      takeoverComputerPreview(this, "你");
      void this.refreshAccountComputerPreview?.("open");
    } catch (err) {
      this.secureFormError = `Secure form handoff failed: ${String(err)}`;
    } finally {
      this.secureFormBusy = false;
    }
  }

  handleSecureFormHandoffDismiss() {
    // Card is dismissible; Tab「交给AI」remains while controlledBy.kind===user (E).
    this.secureFormHandoff = null;
  }

  async handleSecureFormHandoffReturn() {
    // Same path as computer chrome「交给AI」: local yield + browser.preview releaseControl.
    if (this.secureFormBusy) {
      return;
    }
    this.secureFormBusy = true;
    this.secureFormError = null;
    try {
      const { handBackComputerPreview } = await import("./views/account-computer-preview.ts");
      handBackComputerPreview(this);
      this.secureFormHandoff = null;
      void this.refreshAccountComputerPreview?.("open");
    } catch (err) {
      this.secureFormError = `Secure form handback failed: ${String(err)}`;
    } finally {
      this.secureFormBusy = false;
    }
  }

  async handleAccountComputerLoginChoose(choiceId: string, method: "password" | "qr") {
    if (!this.client || this.loginCardBusy) {
      return;
    }
    this.loginCardBusy = true;
    this.loginCardError = null;
    try {
      await this.client.request("account_computer_login.choose", { choiceId, method });
      if (this.loginMethodChoice?.choiceId === choiceId) {
        this.loginMethodChoice = null;
      }
    } catch (err) {
      this.loginCardError = `Login choice failed: ${String(err)}`;
    } finally {
      this.loginCardBusy = false;
    }
  }

  async handleAccountComputerLoginSave(saveId: string, save: boolean) {
    if (!this.client || this.loginCardBusy) {
      return;
    }
    this.loginCardBusy = true;
    this.loginCardError = null;
    try {
      await this.client.request("account_computer_login.save_decision", { saveId, save });
      if (this.loginSaveOffer?.saveId === saveId) {
        this.loginSaveOffer = null;
      }
    } catch (err) {
      this.loginCardError = `Save login failed: ${String(err)}`;
    } finally {
      this.loginCardBusy = false;
    }
  }

  handleGatewayUrlConfirm() {
    const nextGatewayUrl = this.pendingGatewayUrl;
    if (!nextGatewayUrl) {
      return;
    }
    const nextToken = this.pendingGatewayToken?.trim() || "";
    this.pendingGatewayUrl = null;
    this.pendingGatewayToken = null;
    applySettingsInternal(adaptSettingsHost(this), {
      ...this.settings,
      gatewayUrl: nextGatewayUrl,
      token: nextToken,
    });
    this.connect();
  }

  handleGatewayUrlCancel() {
    this.pendingGatewayUrl = null;
    this.pendingGatewayToken = null;
  }

  // Sidebar handlers for tool output viewing
  handleOpenSidebar(content: string) {
    if (this.sidebarCloseTimer != null) {
      window.clearTimeout(this.sidebarCloseTimer);
      this.sidebarCloseTimer = null;
    }
    this.sidebarPreviewMode = "markdown";
    this.sidebarSurface = "artifact";
    this.sidebarArtifactWorkspace = null;
    this.sidebarContent = content;
    this.sidebarError = null;
    this.sidebarOpen = true;
  }

  handleOpenArtifactPreview(message?: string | null) {
    if (this.sidebarCloseTimer != null) {
      window.clearTimeout(this.sidebarCloseTimer);
      this.sidebarCloseTimer = null;
    }
    this.sidebarPreviewMode = "artifact";
    this.sidebarSurface = "artifact";
    this.sidebarArtifactWorkspace = null;
    this.sidebarContent = message?.trim() || null;
    this.sidebarError = null;
    this.sidebarOpen = true;
  }

  async handleOpenArtifact(artifactId: string) {
    const workspace = createArtifactWorkspaceFromMessage(this.chatMessages, artifactId);
    if (!workspace) {
      this.sidebarDeliverableSaveState = null;
      this.sidebarDeliverableSaveToast = null;
      this.handleOpenArtifactPreview();
      return;
    }
    this.sidebarDeliverableSaveState = inferInitialDeliverableSaveState(workspace);
    const client = adaptDaibaiState(this).client;
    await openArtifactDeliverablePreview({
      host: this,
      workspace,
      client,
      sessionKey: this.sessionKey,
      sessionsResult: this.sessionsResult,
      workbenchTeamSelectedKey: this.workbenchTeamSelectedKey,
    });
  }

  private showDeliverableSaveToast(toast: DeliverableSaveToast) {
    this.sidebarDeliverableSaveToast = toast;
    if (this.sidebarDeliverableSaveToastTimer != null) {
      window.clearTimeout(this.sidebarDeliverableSaveToastTimer);
    }
    this.sidebarDeliverableSaveToastTimer = window.setTimeout(() => {
      this.sidebarDeliverableSaveToast = null;
      this.sidebarDeliverableSaveToastTimer = null;
    }, DELIVERABLE_SAVE_TOAST_MS);
  }

  private showSidebarDeliverableSaveToast(state: DeliverableSaveState) {
    this.showDeliverableSaveToast({
      message: resolveDeliverableSaveToastMessage(state),
      kind: state.status === "kb_failed" ? "error" : "success",
      shownAt: Date.now(),
    });
  }

  handleDeliverableInlineEditApplied(content: string) {
    const workspace = this.sidebarArtifactWorkspace;
    const filename = workspace ? resolveStewardWorkspaceFilename(workspace) : null;
    const isPptx = isPptxWorkspaceFilename(filename);
    if (!isPptx) {
      this.sidebarContent = content;
    }
    if (workspace) {
      this.sidebarArtifactWorkspace = {
        ...workspace,
        artifact: {
          ...workspace.artifact,
          ...(!isPptx ? { sourceMessage: content } : {}),
          providerMetadata: {
            ...workspace.artifact.providerMetadata,
            previewText: content,
          },
        },
      };
    }
    const nextState = markDeliverableSaveDirty(this.sidebarDeliverableSaveState);
    if (nextState) {
      this.sidebarDeliverableSaveState = nextState;
    }
    if (isPptx && filename) {
      void this.persistPptxPreviewEdit(filename, content);
    }
  }

  private async persistPptxPreviewEdit(filename: string, draft: string) {
    const workspace = this.sidebarArtifactWorkspace;
    if (!workspace) {
      return;
    }
    const groupId = resolveGroupIdFromSessionContext({
      sessionKey: this.sessionKey,
      sessionsResult: this.sessionsResult,
      workbenchTeamSelectedKey: this.workbenchTeamSelectedKey,
    });
    let file: Awaited<ReturnType<typeof persistWorkspacePptxSlideDraft>>;
    try {
      file = await persistWorkspacePptxSlideDraft({
        client: adaptDaibaiState(this).client,
        filename,
        draft,
        expectedContentHash:
          typeof workspace.artifact.providerMetadata?.contentHash === "string"
            ? workspace.artifact.providerMetadata.contentHash
            : undefined,
        groupId,
        sessionKey: this.sessionKey,
      });
    } catch (error) {
      this.showDeliverableSaveToast({
        message: String(error).includes("ARTIFACT_VERSION_CONFLICT")
          ? t("chat.deliverableEditStale")
          : t("chat.deliverableSaveFailed"),
        kind: "error",
        shownAt: Date.now(),
      });
      return;
    }
    if (!file) {
      this.showDeliverableSaveToast({
        message: t("chat.deliverableSaveFailed"),
        kind: "error",
        shownAt: Date.now(),
      });
      return;
    }
    if (this.sidebarArtifactWorkspace?.artifact.artifactId !== workspace.artifact.artifactId) {
      return;
    }
    if (this.sidebarArtifactWorkspace.artifact.providerMetadata?.previewText !== draft) {
      this.sidebarArtifactWorkspace = {
        ...this.sidebarArtifactWorkspace,
        artifact: {
          ...this.sidebarArtifactWorkspace.artifact,
          providerMetadata: {
            ...this.sidebarArtifactWorkspace.artifact.providerMetadata,
            contentHash: file.contentHash,
            fileBase64: file.base64,
          },
        },
      };
      return;
    }
    applyWorkspaceFilePreview({
      host: this,
      workspace: this.sidebarArtifactWorkspace ?? workspace,
      file,
      filename: file.relativePath || filename,
    });
  }

  async handleSaveSidebarDeliverable(mode?: "save_as") {
    const workspace = this.sidebarArtifactWorkspace;
    if (!workspace || this.sidebarDeliverableSaveState?.busy) {
      return;
    }
    const savePayload = extractArtifactSavePayload(workspace);
    const content = this.sidebarContent ?? savePayload.content;
    if (!content.trim() && !savePayload.contentBase64) {
      this.showDeliverableSaveToast({
        message: t("chat.deliverableSaveFailed"),
        kind: "error",
        shownAt: Date.now(),
      });
      return;
    }
    const knowledgeBaseId = resolveSaveKnowledgeBaseId();
    const groupId = resolveGroupIdFromSessionContext({
      sessionKey: this.sessionKey,
      sessionsResult: this.sessionsResult,
      workbenchTeamSelectedKey: this.workbenchTeamSelectedKey,
    });
    const priorState =
      this.sidebarDeliverableSaveState ?? inferInitialDeliverableSaveState(workspace);
    this.sidebarDeliverableSaveState = {
      ...priorState,
      busy: true,
      error: null,
    };
    try {
      const result = await saveAndArchiveSidebarDeliverable({
        client: this.client,
        workspace,
        sessionKey: this.sessionKey,
        groupId,
        knowledgeBaseId,
        content,
        ...(savePayload.contentBase64 ? { contentBase64: savePayload.contentBase64 } : {}),
        deliverableId: workspace.artifact.artifactId,
        ...(mode === "save_as"
          ? {
              saveMode: "save_as" as const,
              saveAsFilename: workspace.artifact.providerMetadata?.workspaceFilename as
                | string
                | undefined,
            }
          : {}),
        askSaveDecision: (prompt) =>
          new Promise((resolve) => {
            this.deliverableSaveDecisionResolve?.(null);
            this.deliverableSaveDecisionResolve = resolve;
            this.sidebarDeliverableSaveState = {
              ...priorState,
              busy: false,
              pendingDecision: prompt,
              saveAsFilenameDraft: prompt.suggestedSaveAsFilename,
            };
          }),
      });
      this.sidebarDeliverableSaveState = {
        artifactId: workspace.artifact.artifactId,
        status: "saved",
        knowledgeBaseTitle: result.knowledgeBaseTitle,
        busy: false,
        dirty: false,
      };
      this.showSidebarDeliverableSaveToast(this.sidebarDeliverableSaveState);
      if (this.sidebarArtifactWorkspace) {
        this.sidebarArtifactWorkspace = {
          ...this.sidebarArtifactWorkspace,
          artifact: {
            ...this.sidebarArtifactWorkspace.artifact,
            providerMetadata: {
              ...this.sidebarArtifactWorkspace.artifact.providerMetadata,
              saved: true,
              savedRawHash: result.rawHash,
              savedKnowledgeBaseTitle: result.knowledgeBaseTitle,
              relatedKnowledgeBaseId: result.knowledgeBaseId,
              ...(result.documentId ? { knowledgeDocumentId: result.documentId } : {}),
              ...(result.logicalId ? { logicalId: result.logicalId } : {}),
              ...(result.relativePath ? { workspaceFilename: result.relativePath } : {}),
              ...(result.groupId ? { groupId: result.groupId } : {}),
              savedFilename: result.relativePath,
            },
          },
        };
      }
    } catch (error) {
      if (error instanceof DeliverableSaveCancelledError) {
        this.sidebarDeliverableSaveState = { ...priorState, busy: false };
        return;
      }
      const message = error instanceof Error ? error.message : t("chat.deliverableSaveFailed");
      const failedState: DeliverableSaveState = {
        artifactId: workspace.artifact.artifactId,
        status: "kb_failed",
        busy: false,
        error: message,
      };
      this.sidebarDeliverableSaveState = failedState;
      this.showSidebarDeliverableSaveToast(failedState);
    }
  }

  handleConfirmDeliverableOverwrite() {
    sidebarActions.confirmDeliverableOverwrite(asSidebarHost(this));
  }

  handleConfirmDeliverableSaveAs() {
    sidebarActions.confirmDeliverableSaveAs(asSidebarHost(this));
  }

  handleCancelDeliverableSaveDecision() {
    sidebarActions.cancelDeliverableSaveDecision(asSidebarHost(this));
  }

  handleDeliverableSaveAsFilenameChange(filename: string) {
    sidebarActions.changeDeliverableSaveAsFilename(asSidebarHost(this), filename);
  }

  handleCloseSidebar() {
    sidebarActions.closeSidebar(asSidebarHost(this));
  }

  syncAccountComputerPreview() {
    void this.refreshAccountComputerPreview("open");
  }

  async refreshAccountComputerPreview(action: "open" | "status" | "end") {
    const {
      applyServerComputerPreview,
      clearComputerPreviewStreamError,
      computerPreviewNeedsStreamRetry,
      computerPreviewOpenPlan,
      computerSessionRequestsInput,
      endComputerPreview,
      noteComputerPreviewInputClaim,
      noteComputerPreviewStreamError,
      readComputerPreviewModel,
      scheduleComputerPreviewStreamRetry,
      suspendComputerPreviewInput,
    } = await import("./views/account-computer-preview.ts");
    if (action === "end") {
      endComputerPreview(this);
    } else if (action === "open") {
      // M1: opening preview always focuses the 电脑 tab (visible ≤5s connecting).
      this.sidebarOpen = true;
      this.sidebarSurface = "computer";
      this.computerNarrowChat = false;
    }
    if (!this.client || !this.connected) {
      this.computerPreviewRevision += 1;
      return;
    }
    const { resolveWorkbenchChatSessionKey } = await import("./chat/workbench-visible-messages.ts");
    const sessionKey = resolveWorkbenchChatSessionKey({
      selectedKey: this.workbenchTeamSelectedKey,
      sessionKey: this.sessionKey,
    });
    // Keep computer preview keyed to the header chat when selection raced ahead.
    if (sessionKey && sessionKey !== this.sessionKey) {
      this.sessionKey = sessionKey;
    }
    const userLabel = t("chat.computerYou");
    const formLocked = Boolean(this.secureFormOffered);
    const authHandoffActive = Boolean(
      this.secureFormHandoff && this.secureFormHandoff.sessionKey === sessionKey,
    );
    const plan = computerPreviewOpenPlan(this, {
      action,
      formLocked,
      userLabel,
      authHandoffActive,
    });
    if (plan.takeControl) {
      noteComputerPreviewInputClaim(this, userLabel);
    } else if (formLocked && computerSessionRequestsInput(sessionKey)) {
      suspendComputerPreviewInput(this);
    }
    try {
      const payload = await this.client.request<{
        tenantId: string;
        userId: string;
        status: "COLD" | "STARTING" | "READY" | "REAUTH_REQUIRED" | "DISCONNECTED";
        streamUrl?: string;
        failure?: string;
        controlledBy?: { kind: "agent" | "user"; label: string } | null;
      }>("browser.preview", {
        action: plan.action,
        sessionKey,
        ...(plan.takeControl ? { takeControl: true } : {}),
        ...(plan.releaseControl ? { releaseControl: true } : {}),
        ...(plan.explicitHandback ? { explicitHandback: true } : {}),
      });
      clearComputerPreviewStreamError();
      applyServerComputerPreview({
        tenantId: payload.tenantId,
        userId: payload.userId,
        sessionKey,
        action: plan.action,
        status: payload.status,
        streamUrl: payload.streamUrl,
        failure: payload.failure,
        controlledBy: payload.controlledBy,
        grantsInput: plan.takeControl,
      });
    } catch (err) {
      // Keep the local tab; surface a retryable connecting/error state instead of a white stage.
      const message = err instanceof Error ? err.message : "preview failed";
      noteComputerPreviewStreamError(message);
    }
    this.computerPreviewRevision += 1;
    if (action !== "end") {
      const model = readComputerPreviewModel(this, null);
      if (computerPreviewNeedsStreamRetry(model)) {
        scheduleComputerPreviewStreamRetry(this);
      }
    }
  }

  handleSplitRatioChange(ratio: number) {
    sidebarActions.changeSplitRatio(asSidebarHost(this), ratio);
  }

  async handleBrandLogoFileChange(file: File | null) {
    await sidebarActions.changeBrandLogoFile(asSidebarHost(this), file);
  }

  handleResetBrandLogo() {
    sidebarActions.resetBrandLogo(asSidebarHost(this));
  }

  render() {
    return renderApp(this as unknown as AppViewState);
  }
}
