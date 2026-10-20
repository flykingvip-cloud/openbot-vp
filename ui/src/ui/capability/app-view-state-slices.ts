import type { EventLogEntry } from "../app-events.ts";
import type { CompactionStatus, FallbackStatus } from "../app-tool-stream.ts";
import type { ChannelsLoadState, ChannelsWhatsAppAuthState } from "../controllers/channels.ts";
import type { ChatState } from "../controllers/chat.ts";
import type { ConfigState } from "../controllers/config.ts";
import type { ControlUiBootstrapState } from "../controllers/control-ui-bootstrap.ts";
import type { DaibaiState } from "../controllers/daibai.ts";
import type { EnterpriseOrganizationMonthlyUsageState } from "../controllers/enterprise-organization-monthly-usage.ts";
import type { EnterpriseOrganizationSnapshotState } from "../controllers/enterprise-organization-snapshot.ts";
import type { PlatformAuthHost } from "../controllers/platform-auth.ts";
import type { SessionsState } from "../controllers/sessions.ts";
import type { GatewayConnectionPhase } from "../gateway-connection-phase.ts";
import type { GatewayBrowserClient, GatewayHelloOk } from "../gateway.ts";
import type { Tab } from "../navigation.ts";
import type { UiSettings } from "../storage.ts";
import type { ThemeMode } from "../theme.ts";
import type { UpdateAvailable } from "../types.ts";
import type { ChatCheckpoint } from "../types/chat-types.ts";
import type { ChatQueueItem } from "../ui-types.ts";
import type { NostrProfileFormState } from "../views/channels.nostr-profile-form.ts";
import type { CapabilityGovernanceSnapshot } from "./capability-governance/types.ts";

export type AppViewGatewayCapabilityState = ControlUiBootstrapState & {
  settings: UiSettings;
  password: string;
  tab: Tab;
  onboarding: boolean;
  basePath: string;
  connected: boolean;
  gatewayConnectionPhase?: GatewayConnectionPhase;
  gatewayReconnectAttempt?: number;
  theme: ThemeMode;
  themeResolved: "light" | "dark";
  hello: GatewayHelloOk | null;
  lastError: string | null;
  lastErrorCode: string | null;
  eventLog: EventLogEntry[];
  pendingGatewayUrl: string | null;
  updateAvailable: UpdateAvailable | null;
  client: GatewayBrowserClient | null;
  capabilityGovernanceSnapshot: CapabilityGovernanceSnapshot | null;
  refreshSessionsAfterChat: Set<string>;
};

export type AppViewPlatformAuthCapabilityState = Pick<
  PlatformAuthHost,
  | "platformAuthMode"
  | "platformAuthBusy"
  | "platformAuthError"
  | "platformAuthEmail"
  | "platformAuthPassword"
  | "platformAuthDisplayName"
  | "platformAuthPlatformAdminDisplayName"
  | "platformAuthTenantName"
  | "platformAuthSeatTitle"
  | "platformAuthExpectedUsers"
  | "platformAuthUseCase"
  | "platformAuthCompanySize"
  | "platformAuthNeedsDemo"
  | "platformAuthIndustry"
  | "platformAuthTrialStep"
  | "platformAuthInviteCode"
  | "platformAuthMfaCode"
  | "platformAuthMfaStage"
  | "platformAuthMfaEnrollment"
  | "platformAuthMembershipChoices"
  | "platformAuthMembershipId"
  | "platformAuthCurrentPassword"
  | "platformAuthNewPassword"
  | "platformAuthPolicyTrialDays"
  | "platformAuthPolicySeatCount"
  | "platformAuthPolicyUpgradeUrl"
  | "platformAuthPolicyContactAdvisorUrl"
  | "platformAuthInstanceEnterpriseId"
  | "platformAuthInstanceTrialDays"
  | "platformAuthInstanceSeatCount"
  | "platformAuthInstanceUpgradeUrl"
  | "platformAuthInstanceContactAdvisorUrl"
  | "platformAuthCreationMode"
  | "platformAuthPlatformAdminEmail"
  | "platformAuthPlatformAdminPassword"
  | "platformAuthPlatformAdminScopes"
  | "platformAuthLoginIntent"
> & {
  forcePublicHomepage: boolean;
  platformAuthNotice: string | null;
};

export type AppViewChatCapabilityState = Omit<ChatState, "workbenchSystemSettingsTab"> & {
  /** Host tick while `chatSending`; drives live thinking elapsed labels. */
  chatThinkingNowMs: number;
  chatToolMessages: unknown[];
  chatStreamSegments: Array<{ text: string; ts: number; replyLanguage?: "zh" | "en" | null }>;
  compactionStatus: CompactionStatus | null;
  fallbackStatus: FallbackStatus | null;
  chatAvatarUrl: string | null;
  chatQueue: ChatQueueItem[];
  chatManualRefreshInFlight: boolean;
  chatNewMessagesBelow: boolean;
  // chat-checkpoint-rollback: per-turn checkpoint dividers + restore state.
  chatCheckpoints: ChatCheckpoint[];
  pendingRestoreCheckpointId: string | null;
  restoreInFlightCheckpointId: string | null;
};

export type AppViewDaibaiCapabilityState = Pick<
  DaibaiState,
  | "daibaiSourceSessionKey"
  | "daibaiLastMessage"
  | "daibaiLoading"
  | "daibaiError"
  | "daibaiAskResult"
  | "daibaiExecuteResult"
  | "daibaiActionLoading"
  | "daibaiActionPendingId"
  | "daibaiActionError"
  | "daibaiPendingConfirmation"
>;

export type AppViewConfigCapabilityState = ConfigState;

export type AppViewChannelsCapabilityState = ChannelsLoadState &
  ChannelsWhatsAppAuthState & {
    nostrProfileFormState: NostrProfileFormState | null;
    nostrProfileAccountId: string | null;
  };

export type AppViewSessionsCapabilityState = SessionsState & {
  sessionsHideCron: boolean;
};

export type AppViewCapabilityState = AppViewGatewayCapabilityState &
  AppViewPlatformAuthCapabilityState &
  AppViewChatCapabilityState &
  AppViewDaibaiCapabilityState &
  AppViewConfigCapabilityState &
  AppViewChannelsCapabilityState &
  AppViewSessionsCapabilityState &
  EnterpriseOrganizationSnapshotState &
  EnterpriseOrganizationMonthlyUsageState;
