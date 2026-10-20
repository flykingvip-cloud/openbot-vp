import type { AgentInternalEvent } from "../../agents/internal-events.js";
import type { ClientToolDefinition } from "../../agents/pi-embedded-runner/run/params.js";
import type { SpawnedRunMetadata } from "../../agents/spawned-context.js";
import type { ChannelOutboundTargetMode } from "../../channels/plugins/types.js";
import type { RunGovernanceSnapshot } from "../../gateway/governance/decision.js";
import type { InputProvenance } from "../../sessions/input-provenance.js";

/** Image content block for Claude API multimodal messages. */
export type ImageContent = {
  type: "image";
  data: string;
  mimeType: string;
};

export type AgentStreamParams = {
  /** Provider stream params override (best-effort). */
  temperature?: number;
  maxTokens?: number;
};

export type AgentRunContext = {
  messageChannel?: string;
  accountId?: string;
  groupId?: string | null;
  groupChannel?: string | null;
  groupSpace?: string | null;
  currentChannelId?: string;
  currentThreadTs?: string;
  replyToMode?: "off" | "first" | "all";
  hasRepliedRef?: { value: boolean };
};

export type AgentCommandOpts = {
  message: string;
  /** Optional image attachments for multimodal messages. */
  images?: ImageContent[];
  /** Optional client-provided tools (OpenResponses hosted tools). */
  clientTools?: ClientToolDefinition[];
  /** Agent id override (must exist in config). */
  agentId?: string;
  to?: string;
  sessionId?: string;
  sessionKey?: string;
  thinking?: string;
  thinkingOnce?: string;
  verbose?: string;
  json?: boolean;
  timeout?: string;
  deliver?: boolean;
  /** Override delivery target (separate from session routing). */
  replyTo?: string;
  /** Override delivery channel (separate from session routing). */
  replyChannel?: string;
  /** Override delivery account id (separate from session routing). */
  replyAccountId?: string;
  /** Override delivery thread/topic id (separate from session routing). */
  threadId?: string | number;
  /** Message channel context (webchat|voicewake|whatsapp|...). */
  messageChannel?: string;
  channel?: string; // delivery channel (whatsapp|telegram|...)
  /** Account ID for multi-account channel routing (e.g., WhatsApp account). */
  accountId?: string;
  /** Context for embedded run routing (channel/account/thread). */
  runContext?: AgentRunContext;
  /** Whether this caller is authorized for owner-only tools (defaults true for local CLI calls). */
  senderIsOwner?: boolean;
  /** Group/spawn metadata for subagent policy inheritance and routing context. */
  groupId?: SpawnedRunMetadata["groupId"];
  groupChannel?: SpawnedRunMetadata["groupChannel"];
  groupSpace?: SpawnedRunMetadata["groupSpace"];
  spawnedBy?: SpawnedRunMetadata["spawnedBy"];
  deliveryTargetMode?: ChannelOutboundTargetMode;
  bestEffortDeliver?: boolean;
  abortSignal?: AbortSignal;
  lane?: string;
  /** Parent governance snapshot staged for a subagent child run (PR-1b). */
  spawnGovernanceSnapshot?: RunGovernanceSnapshot;
  /**
   * Execution entry stamped on this run's model and commercial-gate shadow envelopes
   * (`entry`). Set by the trusted caller: the CLI process (`E3`), gateway boot (`E2`).
   * `agentCommandFromIngress` always forces `E2`. Unset stamps nothing. The subagent
   * lane writes neither envelope, so it never carries `E2` / `E3`.
   */
  governanceEntry?: AgentCommandGovernanceEntry;
  runId?: string;
  extraSystemPrompt?: string;
  internalEvents?: AgentInternalEvent[];
  inputProvenance?: InputProvenance;
  /** Per-call stream param overrides (best-effort). */
  streamParams?: AgentStreamParams;
  /** Explicit workspace directory override (for subagents to inherit parent workspace). */
  workspaceDir?: SpawnedRunMetadata["workspaceDir"];
  /** Per-request model fallback chain (`provider/model` strings) for `runWithModelFallback`. */
  modelFallbacks?: string[];
  /**
   * Gateway WS identity for tenant session-store / workspace routing (managed BYOK).
   * When set, agent RPC reads/writes the per-tenant store instead of `~/.openbot/agents/...`.
   */
  gatewayClientUser?: string;
  gatewayClientSessionDomain?: "platform" | "enterprise" | "employee";
  gatewayClientPlatformUserId?: string;
  gatewayClientSessionTenantId?: string;
  gatewayClientSessionEnterpriseId?: string;
  gatewayClientSessionMembershipId?: string;
  executionIdentity?: import("../../gateway/execution-identity-context.js").ExecutionIdentityContext;
};

/** Registry ids for the two agent command entries: gateway ingress and the local CLI. */
export type AgentCommandGovernanceEntry = "E2" | "E3";

/** Ingress never chooses its own entry; `agentCommandFromIngress` stamps `E2`. */
export type AgentCommandIngressOpts = Omit<
  AgentCommandOpts,
  "senderIsOwner" | "governanceEntry"
> & {
  /** Ingress callsites must always pass explicit owner authorization state. */
  senderIsOwner: boolean;
};
