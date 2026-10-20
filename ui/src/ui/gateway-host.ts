import type { ExecApprovalCapabilityQueueEntry } from "./capability/exec-approval/index.ts";
import type { LocalFileApprovalCapabilityQueueEntry } from "./capability/local-file-approval/index.ts";
import type { GatewayConnectionPhase } from "./gateway-connection-phase.ts";
import type { GatewayBrowserClient, GatewayHelloOk } from "./gateway.ts";
import type { UiSettings } from "./storage.ts";
import type {
  AgentsListResult,
  HealthSnapshot,
  PresenceEntry,
  StatusSummary,
  UpdateAvailable,
} from "./types.ts";

/** Minimal host surface shared by gateway connect + event subscription modules. */
export type GatewayHost = {
  settings: UiSettings;
  password: string;
  clientInstanceId: string;
  client: GatewayBrowserClient | null;
  connected: boolean;
  /** Banner phase for transport flaps. Auth failures use "blocked". */
  gatewayConnectionPhase: GatewayConnectionPhase;
  /** Silent transient closes since the last hello or fresh connect. */
  gatewayReconnectAttempt: number;
  hello: GatewayHelloOk | null;
  lastError: string | null;
  lastErrorCode: string | null;
  onboarding?: boolean;
  eventLogBuffer: import("./app-events.ts").EventLogEntry[];
  eventLog: import("./app-events.ts").EventLogEntry[];
  tab: import("./navigation.ts").Tab;
  presenceEntries: PresenceEntry[];
  presenceError: string | null;
  presenceStatus: StatusSummary | null;
  agentsLoading: boolean;
  agentsList: AgentsListResult | null;
  agentsError: string | null;
  toolsCatalogLoading: boolean;
  toolsCatalogError: string | null;
  toolsCatalogResult: import("./types.ts").ToolsCatalogResult | null;
  debugHealth: HealthSnapshot | null;
  assistantName: string;
  assistantAvatar: string | null;
  assistantAgentId: string | null;
  serverVersion: string | null;
  bootstrapAuthMode: import("../../../src/gateway/control-ui-contract.js").ControlUiAuthMode | null;
  bootstrapAuthSession:
    | import("../../../src/gateway/control-ui-contract.js").ControlUiTrustedProxySession
    | null;
  platformAuthState?:
    | import("../../../src/gateway/control-ui-contract.js").ControlUiPlatformAuthState
    | null;
  sessionKey: string;
  workbenchTeamSelectedKey?: string;
  workbenchAssetSuggestionVisible: boolean;
  workbenchAssetSuggestionSource:
    | "assistant-task-complete"
    | "group-task-complete"
    | "manual-iteration"
    | null;
  workbenchAssetSuggestionLabel: string | null;
  workbenchAssetIncubationLevel:
    | import("./controllers/asset-incubation/types.ts").AssetIncubationLevel
    | null;
  workbenchAssetIncubationDecision:
    | import("./controllers/asset-incubation/types.ts").AssetIncubationDecision
    | null;
  workbenchAssetWeakHintVisible: boolean;
  workbenchPatternDetectionSubscribedScopes: string[];
  workbenchSkillSourceContextId: string | null;
  chatRunId: string | null;
  refreshSessionsAfterChat: Set<string>;
  execApprovalQueue: ExecApprovalCapabilityQueueEntry[];
  execApprovalError: string | null;
  localFileApprovalQueue: LocalFileApprovalCapabilityQueueEntry[];
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
  updateAvailable: UpdateAvailable | null;
  workbenchSystemSettingsGroupNotice?: string | null;
};
