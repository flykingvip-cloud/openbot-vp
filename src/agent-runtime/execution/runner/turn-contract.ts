import type { RuntimeFallbackAttempt } from "../../../auto-reply/reply/agent-run-credit-usage.js";
import type { BlockReplyPipeline } from "../../../auto-reply/reply/block-reply-pipeline.js";
import type { FollowupRun } from "../../../auto-reply/reply/queue.js";
import type { TypingSignaler } from "../../../auto-reply/reply/typing-mode.js";
import type { TemplateContext } from "../../../auto-reply/templating.js";
import type { VerboseLevel } from "../../../auto-reply/thinking.js";
import type { GetReplyOptions, ReplyPayload } from "../../../auto-reply/types.js";
import type { SessionEntry } from "../../../config/sessions.js";
import type { GrowthOutcomeCommitOpts } from "../../../task-outcome/runtime-from-runner.js";
/** Internal legacy turn boundary. Typed references preserve existing adapters, not an external plugin SDK. */
import type { EmbeddedPiRunResult } from "./embedded-result.js";

export type AgentRunLoopResult =
  | {
      kind: "success";
      runId: string;
      runResult: EmbeddedPiRunResult;
      fallbackProvider?: string;
      fallbackModel?: string;
      fallbackAttempts: RuntimeFallbackAttempt[];
      didLogHeartbeatStrip: boolean;
      autoCompactionCompleted: boolean;
      /** Payload keys sent directly (not via pipeline) during tool flush. */
      directlySentBlockKeys?: Set<string>;
      /** True when this turn already invoked tools. Empty Layer C may then emit a process sentence. */
      didUseTools?: boolean;
      /**
       * Commit growth/operational outcome after delivery classification.
       * Must be called exactly once on the success path (agent-runner).
       * Pass explicit acceptance/delivery from a resolved contract to close success;
       * bare success or processPlaceholder leaves the task incomplete.
       */
      commitGrowthOutcome: (
        success: boolean,
        opts?: GrowthOutcomeCommitOpts,
      ) => void | Promise<void>;
    }
  | { kind: "final"; payload: ReplyPayload };

export type AgentTurnExecutionParams = {
  /** Trusted server binding only; never sourced from the user message. */
  resolveExecutionConstraints?: import("./embedded-request.js").RunEmbeddedPiAgentParams["resolveExecutionConstraints"];
  commandBody: string;
  followupRun: FollowupRun;
  sessionCtx: TemplateContext;
  opts?: GetReplyOptions;
  typingSignals: TypingSignaler;
  blockReplyPipeline: BlockReplyPipeline | null;
  blockStreamingEnabled: boolean;
  blockReplyChunking?: {
    minChars: number;
    maxChars: number;
    breakPreference: "paragraph" | "newline" | "sentence";
    flushOnParagraph?: boolean;
  };
  resolvedBlockStreamingBreak: "text_end" | "message_end";
  applyReplyToMode: (payload: ReplyPayload) => ReplyPayload;
  shouldEmitToolResult: () => boolean;
  shouldEmitToolOutput: () => boolean;
  pendingToolTasks: Set<Promise<void>>;
  resetSessionAfterCompactionFailure: (reason: string) => Promise<boolean>;
  resetSessionAfterRoleOrderingConflict: (reason: string) => Promise<boolean>;
  isHeartbeat: boolean;
  sessionKey?: string;
  getActiveSessionEntry: () => SessionEntry | undefined;
  activeSessionStore?: Record<string, SessionEntry>;
  storePath?: string;
  resolvedVerboseLevel: VerboseLevel;
};
