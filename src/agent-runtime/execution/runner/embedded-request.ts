/** Internal execution adapter contract; preserves existing host fields, not a public plugin SDK. */
import type { ImageContent } from "@earendil-works/pi-ai/compat";
import type { ExecElevatedDefaults, ExecToolDefaults } from "../../../agents/bash-tools.js";
import type { InboundToolCeiling } from "../../../agents/inbound-tool-policy.js";
import type { BlockReplyPayload } from "../../../agents/pi-embedded-payloads.js";
import type {
  BlockReplyChunking,
  ToolResultFormat,
} from "../../../agents/pi-embedded-subscribe.js";
import type { SkillSnapshot } from "../../../agents/skills.js";
import type { ReasoningLevel, ThinkLevel, VerboseLevel } from "../../../auto-reply/thinking.js";
import type { ReplyPayload } from "../../../auto-reply/types.js";
import type { OpenBotConfig } from "../../../config/config.js";
import type { SessionEntry } from "../../../config/sessions.js";
import type { OguiDecisionRunBinding } from "../../../config/sessions/ogui-decision-engine.js";
import type { DeliveryToolSideEffectSchedule } from "../../../gateway/collaboration-dispatch/delivery-tool-side-effect.js";
import type { CollaborationPrivateRunBag } from "../../../gateway/collaboration-dispatch/private-run-bag.js";
import type { ExecutionIdentityContext } from "../../../gateway/execution-identity-context.js";
import type { RuntimeOrganizationContext } from "../../../organization/runtime.js";
import type { enqueueCommand } from "../../../process/command-queue.js";
import type { InputProvenance } from "../../../sessions/input-provenance.js";
import type { AgentStreamParams } from "../../contracts/inference.js";

// Simplified tool definition for client-provided tools (OpenResponses hosted tools)
export type ClientToolDefinition = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
};

export type RunEmbeddedPiAgentParams = {
  sessionId: string;
  /** Trusted host binding; never accepted from model or tool arguments. */
  taskExecutionBinding?: import("../../contracts/task-binding.js").TaskCompletionBinding;
  sessionKey?: string;
  agentId?: string;
  messageChannel?: string;
  messageProvider?: string;
  agentAccountId?: string;
  /** What initiated this agent run: "user", "heartbeat", "cron", or "memory". */
  trigger?: string;
  /** Relative workspace path that memory-triggered writes are allowed to append to. */
  memoryFlushWritePath?: string;
  /** Delivery target (e.g. telegram:group:123:topic:456) for topic/thread routing. */
  messageTo?: string;
  /** Thread/topic identifier for routing replies to the originating thread. */
  messageThreadId?: string | number;
  /** Group id for channel-level tool policy resolution. */
  groupId?: string | null;
  /** Group channel label (e.g. #general) for channel-level tool policy resolution. */
  groupChannel?: string | null;
  /** Group space label (e.g. guild/team id) for channel-level tool policy resolution. */
  groupSpace?: string | null;
  /** Parent session key for subagent policy inheritance. */
  spawnedBy?: string | null;
  senderId?: string | null;
  senderName?: string | null;
  senderUsername?: string | null;
  senderE164?: string | null;
  /** Whether the sender is an owner (required for owner-only tools). */
  senderIsOwner?: boolean;
  /** Current channel ID for auto-threading (Slack). */
  currentChannelId?: string;
  /** Current thread timestamp for auto-threading (Slack). */
  currentThreadTs?: string;
  /** Current inbound message id for action fallbacks (e.g. Telegram react). */
  currentMessageId?: string | number;
  /** Reply-to mode for Slack auto-threading. */
  replyToMode?: "off" | "first" | "all";
  /** Mutable ref to track if a reply was sent (for "first" mode). */
  hasRepliedRef?: { value: boolean };
  /** Require explicit message tool targets (no implicit last-route sends). */
  requireExplicitMessageTarget?: boolean;
  /** If true, omit the message tool from the tool list. */
  disableMessageTool?: boolean;
  /** Canonical trusted turn identity for Seat-bound tools. */
  executionIdentity?: ExecutionIdentityContext;
  gatewayClientUser?: string;
  gatewayClientSessionDomain?: "platform" | "enterprise" | "employee";
  gatewayClientPlatformUserId?: string;
  gatewayClientSessionEnterpriseId?: string;
  gatewayClientSessionMembershipId?: string;
  sessionFile: string;
  /**
   * When true (collaboration rounds), SessionManager must not persist another user
   * message — the gateway already wrote the shared GROUP_PUBLIC user turn.
   */
  skipUserTranscriptPersist?: boolean;
  /** True when this embedded run was invoked from a collaboration group round. */
  collaborationRoundInvoked?: boolean;
  /**
   * Confirmed delivery step fingerprint. Side-effecting tools in this run claim
   * the durable ledger before execute. Omitted on ordinary chat turns.
   */
  deliveryToolSideEffect?: DeliveryToolSideEffectSchedule | null;
  /**
   * Ephemeral per-bot private run bag for this turn. Forwarded into the tool loop
   * so scheduleDurableToolSideEffect can index claimed side effects in-memory.
   * Never written to GROUP_PUBLIC.
   */
  privateRunBag?: CollaborationPrivateRunBag;
  workspaceDir: string;
  agentDir?: string;
  config?: OpenBotConfig;
  skillsSnapshot?: SkillSnapshot;
  prompt: string;
  images?: ImageContent[];
  /** Optional client-provided tools (OpenResponses hosted tools). */
  clientTools?: ClientToolDefinition[];
  /** Disable built-in tools for this run (LLM-only mode). */
  disableTools?: boolean;
  /**
   * Omit the default heartbeat prompt. Cron reminders are not heartbeat wakes;
   * leaving the prompt in makes the model answer HEARTBEAT_OK.
   */
  omitHeartbeatPrompt?: boolean;
  /** Group skill allow/block applied to the embedded custom-tool allowlist. */
  skillPolicy?: import("../../../agents/skills/skill-policy.js").SkillPolicy;
  /** PR E retrieve read-only ceiling; applied at create and execute time. */
  inboundToolCeiling?: InboundToolCeiling;
  /** Focused Knowledge Universe consume refs for knowledge_search / knowledge_get. */
  knowledgeConsumeRefs?: import("../../../gateway/knowledge/consume-ref.js").KnowledgeConsumeRef[];
  /**
   * OpenBot plugin ids from composer @plugin mentions; merged into
   * createOpenClawCodingTools pluginToolAllowlist for this turn.
   */
  mentionedPluginToolAllowlist?: string[];
  /** Context Compiler lane budget. Unknown/omitted uses act (largest) so execution is not starved. */
  contextLane?: import("../../../auto-reply/reply/inbound-depth.js").InboundDepth;
  /** Bound session row so the compiler can load the active task, not just the latest. */
  sessionEntry?: SessionEntry;
  /**
   * Batch 11 OGUI decision binding. Absent when the lifecycle flag is off.
   * Presence does not enable LIVE or PRODUCTION_GO.
   */
  oguiDecisionRun?: OguiDecisionRunBinding;
  provider?: string;
  model?: string;
  authProfileId?: string;
  authProfileIdSource?: "auto" | "user";
  thinkLevel?: ThinkLevel;
  verboseLevel?: VerboseLevel;
  reasoningLevel?: ReasoningLevel;
  toolResultFormat?: ToolResultFormat;
  /** If true, suppress tool error warning payloads for this run (including mutating tools). */
  suppressToolErrorWarnings?: boolean;
  /** Bootstrap context mode for workspace file injection. */
  bootstrapContextMode?: "full" | "lightweight";
  /** Run kind hint for context mode behavior. */
  bootstrapContextRunKind?: "default" | "heartbeat" | "cron";
  /** Seen bootstrap truncation warning signatures for this session (once mode dedupe). */
  bootstrapPromptWarningSignaturesSeen?: string[];
  /** Last shown bootstrap truncation warning signature for this session. */
  bootstrapPromptWarningSignature?: string;
  execOverrides?: Pick<ExecToolDefaults, "host" | "security" | "ask" | "node">;
  bashElevated?: ExecElevatedDefaults;
  timeoutMs: number;
  runId: string;
  abortSignal?: AbortSignal;
  shouldEmitToolResult?: () => boolean;
  shouldEmitToolOutput?: () => boolean;
  onPartialReply?: (payload: { text?: string; mediaUrls?: string[] }) => void | Promise<void>;
  onAssistantMessageStart?: () => void | Promise<void>;
  onBlockReply?: (payload: BlockReplyPayload) => void | Promise<void>;
  onBlockReplyFlush?: () => void | Promise<void>;
  onBlockReplyDiscard?: () => void | Promise<void>;
  blockReplyBreak?: "text_end" | "message_end";
  blockReplyChunking?: BlockReplyChunking;
  onReasoningStream?: (payload: { text?: string; mediaUrls?: string[] }) => void | Promise<void>;
  onReasoningEnd?: () => void | Promise<void>;
  onToolResult?: (payload: ReplyPayload) => void | Promise<void>;
  onAgentEvent?: (evt: { stream: string; data: Record<string, unknown> }) => void;
  lane?: string;
  enqueue?: typeof enqueueCommand;
  extraSystemPrompt?: string;
  organizationContext?: RuntimeOrganizationContext;
  inputProvenance?: InputProvenance;
  streamParams?: AgentStreamParams;
  ownerNumbers?: string[];
  enforceFinalTag?: boolean;
  /**
   * Allow a single run attempt even when all auth profiles are in cooldown,
   * but only for inferred transient cooldowns like `rate_limit` or `overloaded`.
   *
   * This is used by model fallback when trying sibling models on providers
   * where transient service pressure is often model-scoped.
   */
  allowTransientCooldownProbe?: boolean;
  /**
   * Enterprise BYOK per-request auth/baseUrl override.
   * Resolved outside this runner; never written to loadConfig().
   */
  providerAuthOverride?: {
    apiKey: string;
    source?: string;
    baseUrl?: string;
    protocol?: string;
  };
  /** Canonical tenant-isolated model id for usage/audit (ent/...). */
  enterpriseRuntimeModelId?: string;
};
