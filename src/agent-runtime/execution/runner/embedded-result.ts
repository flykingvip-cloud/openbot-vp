import type { HookDeliveryResult } from "../../../agents/execution-preflight/hook-delivery.js";
import type { MessagingToolSend } from "../../../agents/pi-embedded-messaging.js";
/** Internal execution adapter contract; preserves existing host fields, not a public plugin SDK. */
import type { SessionSystemPromptReport } from "../../../config/sessions/types.js";

export type EmbeddedPiAgentMeta = {
  sessionId: string;
  provider: string;
  model: string;
  compactionCount?: number;
  promptTokens?: number;
  usage?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    total?: number;
  };
  /**
   * Usage from the last individual API call (not accumulated across tool-use
   * loops or compaction retries). Used for context-window utilization display
   * (`totalTokens` in sessions.json) because the accumulated `usage.input`
   * sums input tokens from every API call in the run, which overstates the
   * actual context size.
   */
  lastCallUsage?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    total?: number;
  };
};

export type EmbeddedPiRunMeta = {
  durationMs: number;
  agentMeta?: EmbeddedPiAgentMeta;
  aborted?: boolean;
  /** Execution preflight task id. Delivery must pass this id and must not guess another task. */
  taskId?: string;
  /** Structured delivery evidence from the same attempt. Hook surface must not infer another. */
  hookDelivery?: HookDeliveryResult;
  /** Survives when a wrapper drops hookDelivery. Does not authorize delivery by itself. */
  hookValidatorsRequired?: boolean;
  systemPromptReport?: SessionSystemPromptReport;
  error?: {
    kind:
      | "context_overflow"
      | "compaction_failure"
      | "role_ordering"
      | "image_size"
      | "retry_limit";
    message: string;
  };
  /** Stop reason for the agent run (e.g., "completed", "tool_calls"). */
  stopReason?: string;
  /** Pending tool calls when stopReason is "tool_calls". */
  pendingToolCalls?: Array<{
    id: string;
    name: string;
    arguments: string;
  }>;
};

export type EmbeddedPiRunResult = {
  payloads?: Array<{
    text?: string;
    mediaUrl?: string;
    mediaUrls?: string[];
    replyToId?: string;
    isError?: boolean;
  }>;
  meta: EmbeddedPiRunMeta;
  // True if a messaging tool (telegram, whatsapp, discord, slack, sessions_send)
  // successfully sent a message. Used to suppress agent's confirmation text.
  didSendViaMessagingTool?: boolean;
  didSendReaction?: boolean;
  didSendDeterministicApprovalPrompt?: boolean;
  // Texts successfully sent via messaging tools during the run.
  messagingToolSentTexts?: string[];
  // Media URLs successfully sent via messaging tools during the run.
  messagingToolSentMediaUrls?: string[];
  // Messaging tool targets that successfully sent a message during the run.
  messagingToolSentTargets?: MessagingToolSend[];
  // Count of successful cron.add tool calls in this run.
  successfulCronAdds?: number;
  /** Tool names/metas from the attempt — used for capability-gap usage closure. */
  toolMetas?: Array<{ toolName?: string; meta?: string }>;
};

export type EmbeddedPiCompactResult = {
  ok: boolean;
  compacted: boolean;
  reason?: string;
  result?: {
    summary: string;
    firstKeptEntryId: string;
    tokensBefore: number;
    tokensAfter?: number;
    details?: unknown;
  };
};

export type EmbeddedSandboxInfo = {
  enabled: boolean;
  workspaceDir?: string;
  containerWorkspaceDir?: string;
  workspaceAccess?: "none" | "ro" | "rw";
  agentWorkspaceMount?: string;
  browserBridgeUrl?: string;
  browserNoVncUrl?: string;
  hostBrowserAllowed?: boolean;
  /** Account Computer control bridge is attached. Host browser stays blocked. */
  accountComputerBrowser?: boolean;
  /**
   * Browser lease exists, control bridge is not ready. Prompt a retry.
   * Do not treat this as a host-browser block.
   */
  accountComputerAttachFailure?: string;
  elevated?: {
    allowed: boolean;
    defaultLevel: "on" | "off" | "ask" | "full";
  };
};
