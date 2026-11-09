import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { createAnthropicPayloadLogger } from "../../../agents/anthropic-payload-log.js";
import type {
  analyzeBootstrapBudget,
  buildBootstrapPromptWarning,
} from "../../../agents/bootstrap-budget.js";
import type { resolveBootstrapContextForRun } from "../../../agents/bootstrap-files.js";
import type { createCacheTrace } from "../../../agents/cache-trace.js";
import type { ResolvedTimeFormat } from "../../../agents/date-time.js";
import type { buildExecutionPreflight } from "../../../agents/execution-preflight/index.js";
import type { resolveDefaultModelForAgent } from "../../../agents/model-selection.js";
import type { resolveOwnerDisplaySetting } from "../../../agents/owner-display.js";
import type { MessagingToolSend } from "../../../agents/pi-embedded-messaging.js";
import type { buildEmbeddedExtensionFactories } from "../../../agents/pi-embedded-runner/extensions.js";
import type { buildEmbeddedSandboxInfo } from "../../../agents/pi-embedded-runner/sandbox-info.js";
import type { resolveEmbeddedRunSkillEntries } from "../../../agents/pi-embedded-runner/skills-runtime.js";
import type { splitSdkTools } from "../../../agents/pi-embedded-runner/tool-split.js";
import type { subscribeEmbeddedPiSession } from "../../../agents/pi-embedded-subscribe.js";
import type { createPreparedEmbeddedPiSettingsManager } from "../../../agents/pi-project-settings.js";
import type { toClientToolDefinitions } from "../../../agents/pi-tool-definition-adapter.js";
import type { resolveToolLoopDetectionConfig } from "../../../agents/pi-tools.js";
import type { AnyAgentTool } from "../../../agents/pi-tools.types.js";
import type { createProtocolBoundaryState } from "../../../agents/protocol-violation.js";
import type { AccountComputerWebRoute } from "../../../agents/sandbox/account-computer-browser-routing.js";
import type { buildSystemPromptParams } from "../../../agents/system-prompt-params.js";
import type { SessionSystemPromptReport } from "../../../config/sessions/types.js";
import type { resolveSeatTurnContext } from "../../../gateway/seat-rules/turn-context.js";
import type { getGlobalHookRunner } from "../../../plugins/hook-runner-global.js";
import type { createContextCompileState } from "../../capabilities/index.js";
import type { resolveAttemptSandbox } from "../../capabilities/index.js";
import type { openAttemptSession } from "../../state/index.js";
import type { ClientToolDefinition } from "./embedded-request.js";
import type { EmbeddedPiQueueHandle } from "./run-registry.js";

/** Explicit attempt-local state. Fields are populated by ordered phases, never arbitrary keys. */
export type EmbeddedAttemptState = {
  abortRun: (isTimeout?: boolean, reason?: unknown) => void;
  abortTimer: NodeJS.Timeout;
  abortWarnTimer: NodeJS.Timeout | undefined;
  abortable: <T>(promise: Promise<T>) => Promise<T>;
  aborted: boolean;
  accountComputerRoute: AccountComputerWebRoute | undefined;
  accountComputerTurnPromptText: string | undefined;
  accountSandboxLocations: boolean;
  activeSession: AgentSession;
  agentDir: string;
  allCustomTools: ReturnType<typeof splitSdkTools>["customTools"];
  allowedToolNames: Set<string>;
  anthropicPayloadLogger: ReturnType<typeof createAnthropicPayloadLogger>;
  appendPrompt: string;
  attemptToolLanes: {
    constructed: string[];
    afterPolicy: string[];
    afterPreflight: string[];
    client: string[];
  };
  bootstrapAnalysis: ReturnType<typeof analyzeBootstrapBudget>;
  bootstrapMaxChars: number;
  bootstrapPromptWarning: ReturnType<typeof buildBootstrapPromptWarning>;
  bootstrapPromptWarningMode: "off" | "once" | "always";
  bootstrapTotalMaxChars: number;
  cacheTrace: ReturnType<typeof createCacheTrace>;
  ceilingClientTools: ClientToolDefinition[] | undefined;
  channelActions:
    | (
        | "search"
        | "send"
        | "broadcast"
        | "poll"
        | "poll-vote"
        | "react"
        | "reactions"
        | "read"
        | "edit"
        | "unsend"
        | "reply"
        | "sendWithEffect"
        | "renameGroup"
        | "setGroupIcon"
        | "addParticipant"
        | "removeParticipant"
        | "leaveGroup"
        | "sendAttachment"
        | "delete"
        | "pin"
        | "unpin"
        | "list-pins"
        | "permissions"
        | "thread-create"
        | "thread-list"
        | "thread-reply"
        | "sticker"
        | "sticker-search"
        | "member-info"
        | "role-info"
        | "emoji-list"
        | "emoji-upload"
        | "sticker-upload"
        | "role-add"
        | "role-remove"
        | "channel-info"
        | "channel-list"
        | "channel-create"
        | "channel-edit"
        | "channel-delete"
        | "channel-move"
        | "category-create"
        | "category-edit"
        | "category-delete"
        | "topic-create"
        | "voice-status"
        | "event-list"
        | "event-create"
        | "timeout"
        | "kick"
        | "ban"
        | "set-presence"
        | "download-file"
      )[]
    | undefined;
  clientToolCallDetected: { name: string; params: Record<string, unknown> } | null;
  clientToolDefs: ReturnType<typeof toClientToolDefinitions>;
  clientToolLoopDetection: ReturnType<typeof resolveToolLoopDetectionConfig>;
  clientTools: ClientToolDefinition[] | undefined;
  compactionOccurredThisAttempt: boolean;
  contextCompileState: ReturnType<typeof createContextCompileState>;
  defaultModelLabel: string;
  defaultModelRef: ReturnType<typeof resolveDefaultModelForAgent>;
  docsPath: string | null;
  effectiveFsWorkspaceOnly: boolean;
  effectiveWorkspace: string;
  executionPreferenceHint: string | undefined;
  executionPreflight: ReturnType<typeof buildExecutionPreflight>;
  executionTaskId: string;
  extensionFactories: ReturnType<typeof buildEmbeddedExtensionFactories>;
  hookAgentId: string;
  hookRunner: ReturnType<typeof getGlobalHookRunner>;
  isDefaultAgent: boolean;
  isProbeSession: boolean;
  lifecycleSkillNamesLoaded: string[];
  machineName: string;
  makeAbortError: (signal: AbortSignal) => Error;
  messageToolHints: string[] | undefined;
  messagesSnapshot: AgentMessage[];
  modelHasVision: boolean;
  onAbort: () => void;
  operatorComputerBindingTarget:
    | { tenantId: string; seatId: string; operatorUserId: string }
    | undefined;
  operatorEmail: string | undefined;
  ownerDisplay: ReturnType<typeof resolveOwnerDisplaySetting>;
  policyTools: AnyAgentTool[];
  preCompactionSessionId: string;
  preCompactionSnapshot: AgentMessage[] | null;
  prePromptMessageCount: number;
  preferredNodeIds: string[];
  preparedSession: Awaited<ReturnType<typeof openAttemptSession>>;
  preparedSkillContext: {
    input: EmbeddedAttemptState["skillContextInput"];
    selection: ReturnType<typeof resolveEmbeddedRunSkillEntries>;
  };
  prevCwd: string;
  promptError: unknown;
  promptErrorSource: "prompt" | "compaction" | null;
  promptMode: "minimal" | "full";
  promptStartedAt: number;
  protocolBoundaryState: ReturnType<typeof createProtocolBoundaryState>;
  providerSafeClientTools: ClientToolDefinition[] | undefined;
  queueHandle: EmbeddedPiQueueHandle;
  reactionGuidance: { level: "minimal" | "extensive"; channel: string } | undefined;
  reasoningTagHint: boolean;
  removeContextCompiler: (() => void) | undefined;
  removeReplyLanguageReminder: (() => void) | undefined;
  removeToolResultContextGuard: (() => void) | undefined;
  removeVisibleReplyRewriter: (() => void) | undefined;
  resolvedStreamApiKey: string | undefined;
  resolvedWorkspace: string;
  resourceLoader: DefaultResourceLoader | undefined;
  restoreSkillEnv: (() => void) | undefined;
  runAbortController: AbortController;
  runtimeCapabilities: string[] | undefined;
  runtimeChannel: string | undefined;
  sandbox: Awaited<ReturnType<typeof resolveAttemptSandbox>>;
  sandboxInfo: ReturnType<typeof buildEmbeddedSandboxInfo>;
  sandboxSessionKey: string;
  seatExecPreference: NonNullable<
    Awaited<ReturnType<typeof resolveSeatTurnContext>>
  >["execPreference"];
  seatTurnForExec: Awaited<ReturnType<typeof resolveSeatTurnContext>>;
  session: AgentSession | undefined;
  sessionIdUsed: string;
  sessionLabel: string;
  sessionLock: { release: () => Promise<void> };
  sessionManager: Awaited<ReturnType<typeof openAttemptSession>>["manager"] | undefined;
  settingsManager: ReturnType<typeof createPreparedEmbeddedPiSettingsManager>;
  skillContextInput: Parameters<typeof resolveEmbeddedRunSkillEntries>[0];
  skillsPrompt: string;
  subscription: ReturnType<typeof subscribeEmbeddedPiSession>;
  systemPromptOverride: (defaultPrompt?: string) => string;
  systemPromptReport: SessionSystemPromptReport;
  systemPromptText: string;
  timedOut: boolean;
  timedOutDuringCompaction: boolean;
  toolConstruction: { createTools: () => AnyAgentTool[]; readConstructedCount: () => number };
  tools: AnyAgentTool[];
  toolsEnabled: boolean;
  toolsRaw: AnyAgentTool[];
  ttsHint: string | undefined;
  workspaceNotes: string[] | undefined;
  skillEntries: ReturnType<typeof resolveEmbeddedRunSkillEntries>["skillEntries"];
  preferLiveEntries: boolean;
  hookAdjustedBootstrapFiles: Awaited<
    ReturnType<typeof resolveBootstrapContextForRun>
  >["bootstrapFiles"];
  contextFiles: Awaited<ReturnType<typeof resolveBootstrapContextForRun>>["contextFiles"];
  defaultAgentId: string;
  sessionAgentId: string;
  runtimeInfo: ReturnType<typeof buildSystemPromptParams>["runtimeInfo"];
  userTimezone: string;
  userTime: string | undefined;
  userTimeFormat: ResolvedTimeFormat | undefined;
  transcriptPolicy: Awaited<ReturnType<typeof openAttemptSession>>["transcriptPolicy"];
  hadSessionFile: boolean;
  customTools: ReturnType<typeof splitSdkTools>["customTools"];
  filteredCustomTools: ReturnType<typeof splitSdkTools>["customTools"];
  customToolAllowlist: string[];
  assistantTexts: string[];
  toolMetas: {
    toolName?: string;
    meta?: string;
    toolCallId?: string;
    success?: boolean;
    startedAt?: number;
  }[];
  unsubscribe: () => void;
  waitForCompactionRetry: () => Promise<void>;
  isCompactionInFlight: () => boolean;
  flushPendingCompactionEnd: () => void;
  getMessagingToolSentTexts: () => string[];
  getMessagingToolSentMediaUrls: () => string[];
  getMessagingToolSentTargets: () => MessagingToolSend[];
  getSuccessfulCronAdds: () => number;
  didSendViaMessagingTool: () => boolean;
  getLastToolError: () =>
    | {
        toolName: string;
        meta?: string;
        error?: string;
        mutatingAction?: boolean;
        actionFingerprint?: string;
      }
    | undefined;
  getUsageTotals: () =>
    | {
        input: number | undefined;
        output: number | undefined;
        cacheRead: number | undefined;
        cacheWrite: number | undefined;
        total: number | undefined;
      }
    | undefined;
  getCompactionCount: () => number;
};
