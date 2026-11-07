import type { ImageContent } from "@earendil-works/pi-ai/compat";
import type { TypingController } from "./reply/typing.js";

export type BlockReplyContext = {
  abortSignal?: AbortSignal;
  timeoutMs?: number;
};

/** Context passed to onModelSelected callback with actual model used. */
export type ModelSelectedContext = {
  provider: string;
  model: string;
  thinkLevel: string | undefined;
};

export type TypingPolicy =
  | "auto"
  | "user_message"
  | "system_event"
  | "internal_webchat"
  | "heartbeat";

export type GetReplyOptions = {
  /** Trusted Gateway user ingress: user transcript already persisted, execution not admitted. */
  interactionIngress?: { userMessageId: string; persistOwnTranscript?: boolean };
  /** Explicit Gateway resume, after live authorization/stop recheck. */
  resumedTaskBinding?: import("../agent-runtime/contracts/task.js").TaskCompletionBinding;
  /** Fixed authenticated host resumes an interpreted current-task target after live rechecks. */
  onInteractionTaskResume?: (
    request: import("../agent-runtime/contracts/task.js").CurrentTaskResumeRequest & {
      sessionFile: string;
      abortSignal?: AbortSignal;
    },
  ) => Promise<import("../agent-runtime/contracts/task.js").CurrentTaskResumeResult>;
  /** Trusted transport cleanup after an accepted task replacement or owner control. */
  onInteractionTaskEffect?: (effect: {
    kind: "replace" | "pause" | "cancel";
    taskId: string;
    previousRunId?: string;
  }) => Promise<void>;
  /** Override run id for agent events (defaults to random UUID). */
  runId?: string;
  /** Abort signal for the underlying agent run. */
  abortSignal?: AbortSignal;
  /** Optional inbound images (used for webchat attachments). */
  images?: ImageContent[];
  /** Notifies when an agent run actually starts (useful for webchat command handling). */
  onAgentRunStart?: (runId: string) => void;
  /** Internal host callback; never derived from model output. */
  onTaskExecutionBound?: (
    binding: import("../agent-runtime/contracts/task.js").TaskCompletionBinding,
    context?: { sessionFile: string },
  ) => void;
  onReplyStart?: () => Promise<void> | void;
  /** Called when the typing controller cleans up (e.g., run ended with NO_REPLY). */
  onTypingCleanup?: () => void;
  onTypingController?: (typing: TypingController) => void;
  isHeartbeat?: boolean;
  /** Policy-level typing control for run classes (user/system/internal/heartbeat). */
  typingPolicy?: TypingPolicy;
  /** Force-disable typing indicators for this run (system/internal/cross-channel routes). */
  suppressTyping?: boolean;
  /** Resolved heartbeat model override (provider/model string from merged per-agent config). */
  heartbeatModelOverride?: string;
  /** Controls bootstrap workspace context injection (default: full). */
  bootstrapContextMode?: "full" | "lightweight";
  /**
   * Agent Growth OS（R16）：若为 true，在本回合注入"诞生回合"系统提示，
   * 引导新机器人做自我认知问候。默认 undefined（不影响既有行为）。
   */
  growthBirthTurn?: boolean;
  /** If true, suppress tool error warning payloads for this run. */
  suppressToolErrorWarnings?: boolean;
  onPartialReply?: (payload: ReplyPayload) => Promise<void> | void;
  onReasoningStream?: (payload: ReplyPayload) => Promise<void> | void;
  /** Called when a thinking/reasoning block ends. */
  onReasoningEnd?: () => Promise<void> | void;
  /** Called when a new assistant message starts (e.g., after tool call or thinking block). */
  onAssistantMessageStart?: () => Promise<void> | void;
  onBlockReply?: (payload: ReplyPayload, context?: BlockReplyContext) => Promise<void> | void;
  onToolResult?: (payload: ReplyPayload) => Promise<void> | void;
  /** Called when a tool phase starts/updates, before summary payloads are emitted. */
  onToolStart?: (payload: { name?: string; phase?: string }) => Promise<void> | void;
  /**
   * When true, growth metrics record this turn as a human takeover
   * (operator interrupt / steer-away). Do not set unless the takeover is real.
   */
  humanTakeoverObserved?: boolean;
  /** Called when the actual model is selected (including after fallback).
   * Use this to get model/provider/thinkLevel for responsePrefix template interpolation. */
  onModelSelected?: (ctx: ModelSelectedContext) => void;
  disableBlockStreaming?: boolean;
  /** Timeout for block reply delivery (ms). */
  blockReplyTimeoutMs?: number;
  /** If provided, only load these skills for this session (empty = no skills). */
  skillFilter?: string[];
  /** Mutable ref to track if a reply was sent (for Slack "first" threading mode). */
  hasRepliedRef?: { value: boolean };
  /** Override agent timeout in seconds (0 = no timeout). Threads through to resolveAgentTimeoutMs. */
  timeoutOverrideSeconds?: number;
  /** Optional inbound depth decision. When omitted, existing reply behavior is unchanged. */
  inboundDepthDecision?: import("./reply/inbound-depth.js").InboundDepthDecision;
  /** Turn-scoped context source request from the composer. */
  contextScopeRequest?:
    | import("../gateway/context-scope/types.js").ContextScopeRequest
    | import("../gateway/context-scope/request.js").ChatContextScopePayload;
  /** Resolved by CSC; tests/observability may read it after runPreparedReply. */
  contextScopePlan?: import("../gateway/context-scope/types.js").ContextScopePlan;
  /** Per-turn language for thinking and the user-visible reply. Follows the latest user utterance. */
  expectedReplyLanguage?: "zh" | "en" | null;
  /**
   * Expert #4: set when collaboration.explicitKnowledgeRecovery matched a recovery phrase.
   * Soft hint for UI / observability; does not write private memory to GROUP_PUBLIC.
   */
  collabKnowledgeRecoveryHint?: string;
  /**
   * R85e: mutable slot filled by agent-runner when a turn registers awaiting delivery.
   * Dispatch reads `.current` after getReply so deliveryId/taskId reach send confirm
   * even when replyOptions.runId is omitted (shared object survives options spreads).
   */
  pendingTurnDeliveryRef?: {
    current?: {
      runId: string;
      deliveryId: string;
      taskId: string;
      agentId: string;
    };
  };
};

export type ReplyPayload = {
  text?: string;
  mediaUrl?: string;
  mediaUrls?: string[];
  replyToId?: string;
  replyToTag?: boolean;
  /** True when [[reply_to_current]] was present but not yet mapped to a message id. */
  replyToCurrent?: boolean;
  /** Send audio as voice message (bubble) instead of audio file. Defaults to false. */
  audioAsVoice?: boolean;
  isError?: boolean;
  /** Marks this payload as a reasoning/thinking block. Channels that do not
   *  have a dedicated reasoning lane (e.g. WhatsApp, web) should suppress it. */
  isReasoning?: boolean;
  /** Channel-specific payload data (per-channel envelope). */
  channelData?: Record<string, unknown>;
};
