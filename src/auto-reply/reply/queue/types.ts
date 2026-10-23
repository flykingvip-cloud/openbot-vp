import type { ExecToolDefaults } from "../../../agents/bash-tools.js";
import type { SkillSnapshot } from "../../../agents/skills.js";
import type { OpenBotConfig } from "../../../config/config.js";
import type { SessionEntry } from "../../../config/sessions.js";
import type { OguiDecisionRunBinding } from "../../../config/sessions/ogui-decision-engine.js";
import type { ExecutionIdentityContext } from "../../../gateway/execution-identity-context.js";
import type { InputProvenance } from "../../../sessions/input-provenance.js";
import type { OriginatingChannelType } from "../../templating.js";
import type { ElevatedLevel, ReasoningLevel, ThinkLevel, VerboseLevel } from "../directives.js";

export type QueueMode = "steer" | "followup" | "collect" | "steer-backlog" | "interrupt" | "queue";

export type QueueDropPolicy = "old" | "new" | "summarize";

export type QueueSettings = {
  mode: QueueMode;
  debounceMs?: number;
  cap?: number;
  dropPolicy?: QueueDropPolicy;
};

export type QueueDedupeMode = "message-id" | "prompt" | "none";

export type FollowupRun = {
  prompt: string;
  /** Provider message ID, when available (for deduplication). */
  messageId?: string;
  summaryLine?: string;
  enqueuedAt: number;
  /**
   * Originating channel for reply routing.
   * When set, replies should be routed back to this provider
   * instead of using the session's lastChannel.
   */
  originatingChannel?: OriginatingChannelType;
  /**
   * Originating destination for reply routing.
   * The chat/channel/user ID where the reply should be sent.
   */
  originatingTo?: string;
  /** Provider account id (multi-account). */
  originatingAccountId?: string;
  /** Thread id for reply routing (Telegram topic id or Matrix thread event id). */
  originatingThreadId?: string | number;
  /** Chat type for context-aware threading (e.g., DM vs channel). */
  originatingChatType?: string;
  run: {
    agentId: string;
    agentDir: string;
    sessionId: string;
    sessionKey?: string;
    messageProvider?: string;
    /** Canonical trusted turn identity. Source of truth for Seat-bound tools. */
    executionIdentity?: ExecutionIdentityContext;
    gatewayClientUser?: string;
    gatewayClientSessionDomain?: "platform" | "enterprise" | "employee";
    gatewayClientPlatformUserId?: string;
    agentAccountId?: string;
    groupId?: string;
    groupChannel?: string;
    groupSpace?: string;
    senderId?: string;
    senderName?: string;
    senderUsername?: string;
    senderE164?: string;
    senderIsOwner?: boolean;
    sessionFile: string;
    /** Collaboration rounds: suppress SessionManager user persistence on shared transcripts. */
    skipUserTranscriptPersist?: boolean;
    collaborationRoundInvoked?: boolean;
    /** Confirmed delivery fingerprint forwarded into the embedded tool loop. */
    deliveryToolSideEffect?: import("../../../gateway/collaboration-dispatch/delivery-tool-side-effect.js").DeliveryToolSideEffectSchedule;
    workspaceDir: string;
    config: OpenBotConfig;
    skillsSnapshot?: SkillSnapshot;
    provider: string;
    model: string;
    authProfileId?: string;
    authProfileIdSource?: "auto" | "user";
    thinkLevel?: ThinkLevel;
    verboseLevel?: VerboseLevel;
    reasoningLevel?: ReasoningLevel;
    elevatedLevel?: ElevatedLevel;
    execOverrides?: Pick<ExecToolDefaults, "host" | "security" | "ask" | "node">;
    bashElevated?: {
      enabled: boolean;
      allowed: boolean;
      defaultLevel: ElevatedLevel;
    };
    timeoutMs: number;
    blockReplyBreak: "text_end" | "message_end";
    ownerNumbers?: string[];
    inputProvenance?: InputProvenance;
    extraSystemPrompt?: string;
    /** When true, the embedded run creates an empty tool list (LLM-only). */
    disableTools?: boolean;
    /** Group skill allow/block applied to the embedded custom-tool allowlist. */
    skillPolicy?: import("../../../agents/skills/skill-policy.js").SkillPolicy;
    /** PR E: retrieve read-only ceiling applied at tool create and execute time. */
    inboundToolCeiling?: import("../../../agents/inbound-tool-policy.js").InboundToolCeiling;
    /** Context Compiler lane. Omitted → act budget. */
    contextLane?: import("../inbound-depth.js").InboundDepth;
    /** Bound session row for compiler candidate loading (task/group scope). */
    sessionEntry?: import("../../../config/sessions.js").SessionEntry;
    /** Present only when the OGUI decision lifecycle flag is on for this turn. */
    oguiDecisionRun?: OguiDecisionRunBinding;
    enforceFinalTag?: boolean;
    /** Pattern/knowledge: generation lineage for this turn (stable across sample ingest). */
    knowledgeLineageId?: string;
    /**
     * Pre-resolved collaboration / catalog conversation id (not sessionKey).
     * Used with groupId to load shared-task context for pattern independence.
     */
    conversationId?: string;
    /** Explicit collaboration task id when the run is bound to one. */
    collaborationTaskId?: string;
    /** Optional deliverable id when the run produces/continues a deliverable. */
    deliverableId?: string;
    /** Focused Knowledge Universe consume refs for this turn (file/folder/kb). */
    knowledgeConsumeRefs?: import("../../../gateway/knowledge/consume-ref.js").KnowledgeConsumeRef[];
    /**
     * OpenBot plugin ids from composer @plugin mentions for this turn.
     * Merged into createOpenClawCodingTools pluginToolAllowlist so optional
     * plugin tools become available (see resolvePluginTools).
     */
    mentionedPluginToolAllowlist?: string[];
  };
};

export type ResolveQueueSettingsParams = {
  cfg: OpenBotConfig;
  channel?: string;
  sessionEntry?: SessionEntry;
  inlineMode?: QueueMode;
  inlineOptions?: Partial<QueueSettings>;
};
