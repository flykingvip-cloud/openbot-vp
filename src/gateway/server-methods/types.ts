import type { ModelCatalogEntry } from "../../agents/model-catalog.js";
import type { CliDeps } from "../../cli/deps.js";
import type { HealthSummary } from "../../commands/health.js";
import type { CronService } from "../../cron/service.js";
import type { SubsystemLogger } from "../../logging/subsystem.js";
import type { WizardSession } from "../../wizard/session.js";
import type { ChatAbortControllerEntry } from "../chat-abort.js";
import type { ExecApprovalManager } from "../exec-approval-manager.js";
import type { NodeRegistry } from "../node-registry.js";
import type { ConnectParams, ErrorShape, RequestFrame } from "../protocol/index.js";
import type { GatewayBroadcastFn, GatewayBroadcastToConnIdsFn } from "../server-broadcast.js";
import type { ChannelRuntimeSnapshot } from "../server-channels.js";
import type { DedupeEntry } from "../server-shared.js";

export type GatewayClient = {
  connect: ConnectParams;
  connId?: string;
  clientIp?: string;
  user?: string;
  /** Platform-auth user id when resolved; isolates steward chat fan-out. */
  platformUserId?: string;
  /** Paired device id from WS connect; used to recover owner when cookie/user are missing. */
  pairedDeviceId?: string;
  /**
   * Raw Ed25519 public key (base64url) verified for THIS connection at handshake.
   * Undefined for connections that authenticated by token and never proved key
   * possession, which is why capability redemption fails closed without it.
   */
  devicePublicKey?: string;
  sessionDomain?: "platform" | "enterprise" | "employee";
  sessionKind?: "platform-super-admin" | "platform-admin" | "enterprise-admin" | "member";
  /** Membership validated by the server-side platform session. */
  sessionMembershipId?: string;
  /** Enterprise validated against `sessionMembershipId`; authoritative when both are present. */
  sessionEnterpriseId?: string;
  /** Trusted-proxy tenant hint from WS handshake (URL/header); not an authority source alone. */
  sessionTenantId?: string;
  /**
   * Raw Cookie header from the WS upgrade request. Used by chat.send to hydrate
   * platform identity when connect landed on device-token auth without user.
   */
  upgradeRequestCookie?: string;
  /** Whether the upgrade peer was treated as local-direct for platform session reads. */
  upgradeRequestLocalDirect?: boolean;
  /** Browser Origin from the WS upgrade request; pins surface identity. */
  upgradeRequestOrigin?: string;
  /** Host / X-Forwarded-Host from the WS upgrade request. */
  upgradeRequestHost?: string;
  canvasHostUrl?: string;
  canvasCapability?: string;
  canvasCapabilityExpiresAtMs?: number;
};

export type RespondFn = (
  ok: boolean,
  payload?: unknown,
  error?: ErrorShape,
  meta?: Record<string, unknown>,
) => void;

export type GatewayRequestContext = {
  deps: CliDeps;
  cron: CronService;
  cronStorePath: string;
  execApprovalManager?: ExecApprovalManager;
  loadGatewayModelCatalog: () => Promise<ModelCatalogEntry[]>;
  getHealthCache: () => HealthSummary | null;
  refreshHealthSnapshot: (opts?: { probe?: boolean }) => Promise<HealthSummary>;
  logHealth: { error: (message: string) => void };
  logGateway: SubsystemLogger;
  incrementPresenceVersion: () => number;
  getHealthVersion: () => number;
  broadcast: GatewayBroadcastFn;
  broadcastToConnIds: GatewayBroadcastToConnIdsFn;
  /**
   * Isolated chat fan-out: steward employee sessions are delivered only to
   * matching platformUserId connections (see chat-event-isolation.ts).
   */
  broadcastChat: (
    sessionKey: string,
    payload: unknown,
    opts?: { dropIfSlow?: boolean; tenantId?: string | null; runId?: string | null },
  ) => void;
  nodeSendToSession: (sessionKey: string, event: string, payload: unknown) => void;
  nodeSendToAllSubscribed: (event: string, payload: unknown) => void;
  nodeSubscribe: (nodeId: string, sessionKey: string) => void;
  nodeUnsubscribe: (nodeId: string, sessionKey: string) => void;
  nodeUnsubscribeAll: (nodeId: string) => void;
  hasConnectedMobileNode: () => boolean;
  hasExecApprovalClients?: () => boolean;
  nodeRegistry: NodeRegistry;
  agentRunSeq: Map<string, number>;
  chatAbortControllers: Map<string, ChatAbortControllerEntry>;
  chatAbortedRuns: Map<string, number>;
  chatRunBuffers: Map<string, string>;
  chatDeltaSentAt: Map<string, number>;
  addChatRun: (sessionId: string, entry: { sessionKey: string; clientRunId: string }) => void;
  removeChatRun: (
    sessionId: string,
    clientRunId: string,
    sessionKey?: string,
  ) => { sessionKey: string; clientRunId: string } | undefined;
  registerToolEventRecipient: (runId: string, connId: string) => void;
  dedupe: Map<string, DedupeEntry>;
  wizardSessions: Map<string, WizardSession>;
  findRunningWizard: () => string | null;
  purgeWizardSession: (id: string) => void;
  getRuntimeSnapshot: () => ChannelRuntimeSnapshot;
  startChannel: (
    channel: import("../../channels/plugins/types.js").ChannelId,
    accountId?: string,
  ) => Promise<void>;
  stopChannel: (
    channel: import("../../channels/plugins/types.js").ChannelId,
    accountId?: string,
  ) => Promise<void>;
  markChannelLoggedOut: (
    channelId: import("../../channels/plugins/types.js").ChannelId,
    cleared: boolean,
    accountId?: string,
  ) => void;
  wizardRunner: (
    opts: import("../../commands/onboard-types.js").OnboardOptions,
    runtime: import("../../runtime.js").RuntimeEnv,
    prompter: import("../../wizard/prompts.js").WizardPrompter,
  ) => Promise<void>;
  broadcastVoiceWakeChanged: (triggers: string[]) => void;
};

export type GatewayRequestOptions = {
  req: RequestFrame;
  client: GatewayClient | null;
  isWebchatConnect: (params: ConnectParams | null | undefined) => boolean;
  respond: RespondFn;
  context: GatewayRequestContext;
};

export type GatewayRequestHandlerOptions = {
  req: RequestFrame;
  params: Record<string, unknown>;
  client: GatewayClient | null;
  isWebchatConnect: (params: ConnectParams | null | undefined) => boolean;
  respond: RespondFn;
  context: GatewayRequestContext;
};

export type GatewayRequestHandler = (opts: GatewayRequestHandlerOptions) => Promise<void> | void;

export type GatewayRequestHandlers = Record<string, GatewayRequestHandler>;
