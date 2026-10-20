import { isMemoryFlushHistoryMessage } from "../../../../src/auto-reply/reply/memory-flush-prompt.js";
import type { MentionMetadata } from "../../../../src/organization/mention-types.js";
import type {
  RuntimeIdentity,
  RuntimeOrganizationContext,
} from "../../../../src/organization/runtime.js";
import {
  canonicalizeWorkbenchChatSessionKey,
  parseAgentSessionKey,
} from "../../../../src/sessions/session-key-utils.js";
import {
  isSafeThinkingProgressSnapshot,
  type ThinkingProgressSnapshot,
} from "../../../../src/shared/text/thinking-progress.js";
import {
  isUnsupportedImageSoftFailure,
  UNSUPPORTED_IMAGE_DIALOGUE,
} from "../../../../src/shared/unsupported-image-failure.js";
import type { AppPortState } from "../app-port-state.ts";
import { clearCompactionStatus, resetToolStream } from "../app-tool-stream.ts";
import type { CompactionHost, ToolStreamHost } from "../app-tool-stream.ts";
import { sanitizeUserFacingChatError } from "../chat-error-sanitize.ts";
import {
  chatEventMatchesOpenSession,
  sessionKeysShareChatSurface,
} from "../chat-session-key-match.ts";
import { shouldHideCollaborationAssistantMessage } from "../chat/collaboration-message-filter.ts";
import { DEFAULT_CHAT_CONTEXT_SCOPE, toChatSendContextScope } from "../chat/context-scope.ts";
import {
  setConversationTaskProgressEntries,
  type ConversationTaskProgressEntry,
} from "../chat/conversation-task-progress.ts";
import {
  resolvePreviewArtifactRecord,
  withGeneratedPreviewArtifact,
} from "../chat/generated-preview-artifact.ts";
import { mergeIncomingHistoryWithLocalUserTurn } from "../chat/merge-local-user-history.ts";
import { extractText } from "../chat/message-extract.ts";
import { composeQuotedUserMessage } from "../chat/quote-draft.ts";
import { transcriptContainsChatError } from "../chat/run-failure-transcript.ts";
import { resolveSpaceStreamSpeaker } from "../chat/space-stream-identity.ts";
import {
  isStewardCallAuthorizationDecision,
  readStewardCallAuthorization,
} from "../chat/steward-call-authorization-card.ts";
import { applyWorkProgress, clearWorkProgress } from "../chat/work-progress-phase.ts";
import { isGroupScopedSessionKey } from "../collaboration/resolve-group-scope.ts";
import type { GatewayBrowserClient } from "../gateway.ts";
import { importWithStaleChunkReload } from "../lazy-module.ts";
import { writeWorkbenchSessionTranscript } from "../ports/employee/workbench-session-transcript-cache.ts";
import type { SessionsListResult } from "../types.ts";
import type { ChatAttachment } from "../ui-types.ts";
import { generateUUID } from "../uuid.ts";
import {
  beginAgentComputerUse,
  noteBrowserComputerUse,
  syncComputerPreviewFromMessages,
} from "../views/account-computer-preview.ts";
import { isAssetSuggestionDismissed } from "./asset-incubation/suggestion-dismiss.ts";
import {
  applyHistoryActiveRunOccupancy,
  isGatewaySocketClosedError,
  noteTerminalChatRun,
  readHistoryActiveRun,
  resetTerminalChatRunsForTests,
  type HistoryOccupancySnapshot,
} from "./chat-history-occupancy.ts";
import { openKnowledgeUniverseAssetsPage } from "./knowledge-universe.ts";
import type { QuickSaveSkillFormData } from "./skill-lifecycle.ts";

const SILENT_REPLY_PATTERN = /^\s*NO_REPLY\s*$/;
const LEGACY_CHAT_HISTORY_INVALID_RE = /invalid chat\.history params/i;
const LEGACY_CHAT_HISTORY_INCLUDE_TOOLS_RE = /unexpected property ['"]includetools['"]/i;
let legacyChatHistoryIncludeToolsUnsupported = false;

function isSilentReplyStream(text: string): boolean {
  return SILENT_REPLY_PATTERN.test(text);
}
/** Client-side defense-in-depth: hide NO_REPLY and collaboration echo confirmations. */
function isAssistantSilentReply(message: unknown): boolean {
  return shouldHideCollaborationAssistantMessage(message);
}

/** Hide internal pre-compaction memory-flush prompts that look like user messages. */
function shouldHideChatHistoryMessage(message: unknown): boolean {
  return isAssistantSilentReply(message) || isMemoryFlushHistoryMessage(message);
}

export type ChatState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  sessionKey: string;
  workbenchPrimaryModule?: string;
  workbenchSettingsView?: "system" | "personal";
  workbenchSystemSettingsTab?: "security" | "devices" | "robots" | "groups";
  knowledgeUniversePageTab?: string;
  workbenchSkillSaveModalOpen?: boolean;
  workbenchSkillSaveModalBusy?: boolean;
  workbenchSkillSaveModalError?: string | null;
  workbenchSkillSaveModalFormData?: QuickSaveSkillFormData | null;
  workbenchSkillSavePreferEnterpriseSubmit?: boolean;
  workbenchSkillExtractedPreview?: import("./skill-lifecycle.ts").ExtractedSkillPreview | null;
  workbenchSkillSourceAgentId?: string | null;
  workbenchSkillSourceContextId?: string | null;
  workbenchAssetSuggestionVisible?: boolean;
  workbenchAssetSuggestionSource?:
    | "assistant-task-complete"
    | "group-task-complete"
    | "manual-iteration"
    | null;
  workbenchAssetSuggestionLabel?: string | null;
  workbenchTeamSelectedKey?: string;
  sessionsResult?: SessionsListResult | null;
  chatLoading: boolean;
  chatMessages: unknown[];
  /** Opaque cursor from chat.history for loading older pages (CL-P1-02). */
  chatHistoryNextBefore: string | null;
  chatHistoryHasMore: boolean;
  chatHistoryLoadingMore: boolean;
  chatThinkingLevel: string | null;
  chatSending: boolean;
  chatMessage: string;
  chatAttachments: ChatAttachment[];
  /** Composer quote chip; applied at send time, not stored in the textarea. */
  chatQuoteDraft?: import("../chat/quote-draft.ts").ChatQuoteDraft | null;
  chatRunId: string | null;
  chatStream: string | null;
  chatStreamStartedAt: number | null;
  /** Language of the in-flight turn, stamped onto live deltas and history. */
  chatStreamReplyLanguage?: "zh" | "en" | null;
  /** Child bot session key for the active collaboration stream (delta source). */
  chatStreamSessionKey: string | null;
  /** Process-channel thinking structure + progress (cleared when delivery streams). */
  chatThinkingProgress: ThinkingProgressSnapshot | null;
  /**
   * Ephemeral live-turn phase (正在思考 / 正在起草 / 正在验证 / 正在整理).
   * Not transcript text and not progress-ledger evidence.
   */
  workProgressPhase?: import("../chat/work-progress-phase.ts").WorkProgressPhase | null;
  workProgressToolsInFlight?: number;
  /** Live toolUse narration folded into the work-progress card. */
  workProgressNarration?: string | null;
  chatContextScope?: import("../chat/context-scope.ts").ChatContextScopeState;
  chatContextSourceCatalog?:
    | import("../chat/context-scope.ts").ChatContextSourceCatalogItem[]
    | null;
  chatContextSourceCatalogLoading?: boolean;
  chatContextExpansion?:
    | import("../chat/context-expansion.ts").ChatContextExpansionSuggestion
    | null;
  lastError: string | null;
  conversationTaskProgress?: import("../../../../src/progress-ledger/types.ts").ProgressView | null;
  /** When true, history reload must not flip the visible loading spinner. */
  chatHistoryQuietReload?: boolean;
  /**
   * One-shot. The next history load replaces local bubbles, including an
   * intentional empty rewind after checkpoint restore.
   */
  chatHistoryReplaceLocal?: boolean;
  chatHumanTakeoverObserved?: boolean;
  /**
   * Logged-in employee's canonical steward key from hello defaults.
   * Used so bare `main` only matches this user's employee steward session.
   */
  stewardMainSessionKey?: string | null;
};

export type ChatHistoryState = Pick<
  ChatState,
  | "client"
  | "connected"
  | "sessionKey"
  | "workbenchPrimaryModule"
  | "workbenchTeamSelectedKey"
  | "sessionsResult"
  | "chatLoading"
  | "chatMessages"
  | "chatHistoryNextBefore"
  | "chatHistoryHasMore"
  | "chatHistoryLoadingMore"
  | "chatThinkingLevel"
  | "chatSending"
  | "chatStream"
  | "chatStreamStartedAt"
  | "chatStreamSessionKey"
  | "chatThinkingProgress"
  | "workProgressPhase"
  | "workProgressToolsInFlight"
  | "chatRunId"
  | "lastError"
  | "conversationTaskProgress"
  | "chatHistoryQuietReload"
  | "chatHistoryReplaceLocal"
>;

export type ChatSendState = Pick<
  ChatState,
  | "client"
  | "connected"
  | "sessionKey"
  | "workbenchPrimaryModule"
  | "workbenchTeamSelectedKey"
  | "chatMessages"
  | "chatSending"
  | "chatRunId"
  | "chatStream"
  | "chatStreamStartedAt"
  | "chatStreamSessionKey"
  | "chatThinkingProgress"
  | "workProgressPhase"
  | "workProgressToolsInFlight"
  | "lastError"
  | "chatHumanTakeoverObserved"
> & {
  chatContextScope?: import("../chat/context-scope.ts").ChatContextScopeState;
  chatContextSourceCatalog?:
    | import("../chat/context-scope.ts").ChatContextSourceCatalogItem[]
    | null;
  chatContextExpansion?:
    | import("../chat/context-expansion.ts").ChatContextExpansionSuggestion
    | null;
};

export type ChatMentionAuthorityContext = {
  senderIdentity: RuntimeIdentity;
  organizationContext: RuntimeOrganizationContext;
};

export type ChatContextScopeSelection = {
  mode?: "minimal" | "auto" | "focused" | "deep";
  lifetime?: "turn" | "session";
  sources?: Array<{
    type: "conversation" | "group" | "knowledge" | "folder" | "file" | "api";
    id: string;
    parentId?: string;
  }>;
};

export type ChatSendOptions = {
  mentions?: MentionMetadata[];
  mentionAuthority?: ChatMentionAuthorityContext;
  /** Agent Growth OS：诞生回合自我认知问候（仅 birth/growing，首条发送）。 */
  growthBirthTurn?: boolean;
  /** 诞生回合占位发送：不插入乐观 user 气泡。 */
  suppressOptimisticUserMessage?: boolean;
  /** Pending steward-call card this 同意 / 不同意 decides. */
  stewardCallAuthorizationId?: string;
  /** P1 C+3：用户已选择「先做再说」或增强后续发，放行门控。 */
  growthGateProceed?: boolean;
  /** EA-B1: user chose to park current focus and send the new task. */
  focusSwitchProceed?: boolean;
  /** EA-B1: user consented to cancel current focus and send the new task. */
  focusSwitchCancel?: boolean;
  /** 定时任务结果跟进：附带 cron 上下文给 gateway。 */
  cronReplyContext?: {
    jobId: string;
    runId?: string;
    jobName?: string;
  };
  /** Turn-scoped typed knowledge selection. Child sources retain their parent domain. */
  contextScope?: ChatContextScopeSelection;
  /** Structured composer quote; transport sends body + metadata separately. */
  composerQuote?: import("../chat/quote-draft.ts").ChatQuoteDraft;
  /** Optimistic bubble text when composerQuote is present. */
  displayMessage?: string;
  /**
   * Optional chat.send idempotencyKey (existing Gateway field — not a schema expand).
   * OGUI Form P0 passes submission_id here so retries with the same submit do not double-run.
   */
  idempotencyKey?: string;
};

export type ChatAbortState = Pick<
  ChatState,
  | "client"
  | "connected"
  | "sessionKey"
  | "chatRunId"
  | "lastError"
  | "chatMessages"
  | "chatStream"
  | "chatStreamStartedAt"
  | "chatStreamSessionKey"
  | "chatThinkingProgress"
  | "workProgressPhase"
  | "workProgressToolsInFlight"
> & {
  chatStreamReplyLanguage?: "zh" | "en" | null;
  workProgressNarration?: string | null;
};

export type ChatEventState = Pick<
  ChatState,
  | "sessionKey"
  | "chatMessages"
  | "chatRunId"
  | "chatStream"
  | "chatStreamStartedAt"
  | "chatStreamSessionKey"
  | "chatStreamReplyLanguage"
  | "chatThinkingProgress"
  | "workProgressPhase"
  | "workProgressToolsInFlight"
  | "lastError"
  | "stewardMainSessionKey"
>;

export type ChatEventPayload = {
  runId: string;
  sessionKey: string;
  state: "delta" | "final" | "aborted" | "error" | "thinking" | "user_echo";
  /** Server dropped a scratchpad snapshot; clear the in-progress bubble. */
  retract?: boolean;
  mode?: "stop" | "undo";
  userMessageId?: string;
  message?: unknown;
  /** Process-channel only; never Layer C delivery text. */
  thinking?: ThinkingProgressSnapshot;
  errorMessage?: string;
};

function maybeResetToolStream(state: ChatHistoryState) {
  const toolHost = state as ChatHistoryState & Partial<ToolStreamHost>;
  if (
    toolHost.toolStreamById instanceof Map &&
    Array.isArray(toolHost.toolStreamOrder) &&
    Array.isArray(toolHost.chatToolMessages) &&
    Array.isArray(toolHost.chatStreamSegments)
  ) {
    resetToolStream(toolHost as ToolStreamHost);
  }
}

function isCollaborationSpaceSessionKey(sessionKey: string): boolean {
  return isGroupScopedSessionKey(sessionKey);
}

function resolvePreferredChatSessionKey(
  sessionKey: string,
  sessionsResult: SessionsListResult | null | undefined,
) {
  void sessionsResult;
  return canonicalizeWorkbenchChatSessionKey(sessionKey.trim());
}

function resolveChatSendSessionKey(state: ChatSendState) {
  const current = canonicalizeWorkbenchChatSessionKey(state.sessionKey.trim());
  const selected = canonicalizeWorkbenchChatSessionKey(
    state.workbenchTeamSelectedKey?.trim() ?? "",
  );
  if (state.workbenchPrimaryModule === "collaboration" && selected.startsWith("space:")) {
    return selected;
  }
  // Hard isolation: never send to a different bot than the nav selection shows.
  // Sidebar/header read workbenchTeamSelectedKey; align send/history even when
  // workbenchPrimaryModule is stale (e.g. still "collaboration" after picking 大白).
  if (
    selected &&
    !selected.startsWith("space:") &&
    !sessionKeysShareChatSurface(selected, current)
  ) {
    return selected;
  }
  return current;
}

function resolveChatHistorySessionKey(
  state: Pick<ChatState, "sessionKey" | "workbenchPrimaryModule" | "workbenchTeamSelectedKey">,
): string {
  return resolveChatSendSessionKey(state as ChatSendState);
}

function realignSessionKeyForSend(state: ChatSendState, sessionKey: string) {
  if (!sessionKey || sessionKey === state.sessionKey) {
    return;
  }
  // Drop the previous bot's transcript so a desync cannot look like crosstalk.
  state.sessionKey = sessionKey;
  state.chatMessages = [];
  state.chatStream = null;
  state.chatStreamStartedAt = null;
  state.chatStreamSessionKey = null;
  state.chatThinkingProgress = null;
  state.chatRunId = null;
}

function toErrorMessage(err: unknown): string {
  if (typeof err === "string") {
    return err;
  }
  if (err instanceof Error && typeof err.message === "string" && err.message.trim()) {
    return err.message;
  }
  if (err && typeof err === "object") {
    try {
      const serialized = JSON.stringify(err);
      if (serialized) {
        return serialized;
      }
    } catch {
      // ignore
    }
  }
  return String(err);
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const precision = unitIndex === 0 || value >= 10 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

function formatChatSendError(err: unknown): string {
  const raw = toErrorMessage(err)
    .replace(/^GatewayRequestError:\s*/i, "")
    .trim();
  const oversize = /attachment\s+(.+?):\s+exceeds size limit\s+\((\d+)\s*>\s*(\d+)\s+bytes\)/i.exec(
    raw,
  );
  if (oversize) {
    const [, name = "附件", actualRaw = "0", limitRaw = "0"] = oversize;
    const actual = Number(actualRaw);
    const limit = Number(limitRaw);
    return `附件“${name.trim()}”过大，当前可读取上限为 ${formatBytes(limit)}，该文件为 ${formatBytes(actual)}。请压缩、拆分后重试，或上传较小版本。`;
  }
  if (
    /Maximum call stack size exceeded/i.test(raw) ||
    /too much recursion/i.test(raw) ||
    (err instanceof RangeError && /call stack/i.test(err.message))
  ) {
    return "处理附件时发生内部错误（文件可能过大或 PDF 结构过于复杂）。请尝试：拆分/压缩 PDF、先去掉附件只发文字，或换一个较小的可读副本后再试。";
  }
  if (/do not have permission to access this chat session/i.test(raw)) {
    return "当前会话无权访问，请从左侧重新选择助手后再试。";
  }
  return sanitizeUserFacingChatError(raw || "chat error");
}

type AssetCommandIntent =
  | { kind: "save-to-my-assets"; acknowledgement: string }
  | { kind: "save-and-submit-enterprise"; acknowledgement: string };

function detectAssetCommandIntent(text: string): AssetCommandIntent | null {
  const normalized = text.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  const assetAction =
    /(我的资产|资产草稿|纳入资产|沉淀(?:到|为)?资产|保存(?:到|为)?资产|整理为资产)/i.test(text);
  const rejectExternalTarget =
    /(不是\s*clawhub|不要(?:发|发布|推)到\s*clawhub|不是\s*企业市场|不要(?:发|发布|推)到\s*企业市场)/i.test(
      text,
    );
  const enterpriseSubmit =
    /(提交(?:到)?企业|推(?:进|送)?到企业(?:端)?(?:资产库|审核)?|进入企业审核|提交企业资产包)/i.test(
      text,
    );
  if (enterpriseSubmit) {
    return {
      kind: "save-and-submit-enterprise",
      acknowledgement: "已切换到企业资产包整理流程。系统会先沉淀到“我的资产”，再进入企业提交确认。",
    };
  }
  if (assetAction || rejectExternalTarget) {
    return {
      kind: "save-to-my-assets",
      acknowledgement: "已切换到“我的资产”整理流程，不会发布到 ClawHub 或企业市场。",
    };
  }
  return null;
}

function findLatestAssetContextId(messages: unknown[], sessionKey: string): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const entry = messages[index];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    if (typeof record.artifactId === "string" && record.artifactId.trim()) {
      return record.artifactId.trim();
    }
    const artifactRecord =
      record.artifact && typeof record.artifact === "object" && !Array.isArray(record.artifact)
        ? (record.artifact as Record<string, unknown>)
        : null;
    if (typeof artifactRecord?.artifactId === "string" && artifactRecord.artifactId.trim()) {
      return artifactRecord.artifactId.trim();
    }
    const generated = resolvePreviewArtifactRecord(record);
    if (typeof generated?.artifactId === "string" && generated.artifactId.trim()) {
      return generated.artifactId.trim();
    }
  }
  return sessionKey;
}

async function handleExplicitAssetCommand(
  state: ChatState,
  message: string,
  attachments: ChatAttachment[],
  intent: AssetCommandIntent,
): Promise<string> {
  const now = Date.now();
  const optimisticMessageId = `local-asset-command-${generateUUID()}`;
  const contentBlocks: Array<Record<string, unknown>> = [];
  if (message.trim()) {
    contentBlocks.push({ type: "text", text: message.trim() });
  }
  if (attachments.length > 0) {
    contentBlocks.push(...buildAttachmentContentBlocks(attachments, "sent"));
  }
  state.chatMessages = [
    ...state.chatMessages,
    {
      id: optimisticMessageId,
      role: "user",
      content: contentBlocks,
      timestamp: now,
    },
    buildAssistantTextMessage(intent.acknowledgement),
  ];
  state.chatSending = false;
  state.chatRunId = null;
  state.chatStream = null;
  state.chatStreamStartedAt = null;
  state.chatStreamSessionKey = null;
  state.chatThinkingProgress = null;
  state.lastError = null;
  openKnowledgeUniverseAssetsPage(state as AppPortState);
  state.workbenchAssetSuggestionVisible = false;
  state.workbenchAssetSuggestionSource = "manual-iteration";
  state.workbenchAssetSuggestionLabel =
    intent.kind === "save-and-submit-enterprise"
      ? "资产会先纳入“我的资产”，再进入企业资产包提交确认。"
      : "资产会先纳入“我的资产”草稿。";
  const parsed = parseAgentSessionKey(state.sessionKey);
  const agentId = parsed?.agentId ?? "main";
  const contextId = findLatestAssetContextId(state.chatMessages, state.sessionKey);
  state.workbenchSkillSourceAgentId = agentId;
  state.workbenchSkillSourceContextId = contextId;
  state.workbenchSkillSaveModalOpen = true;
  state.workbenchSkillSaveModalBusy = false;
  state.workbenchSkillSaveModalError = null;
  state.workbenchSkillSavePreferEnterpriseSubmit = intent.kind === "save-and-submit-enterprise";
  state.workbenchSkillSaveModalFormData = {
    name: "",
    summary: "",
    assetType: intent.kind === "save-and-submit-enterprise" ? "workflow" : "capability",
  };
  if (state.client && state.connected) {
    try {
      const result = await state.client.request<{
        profile?: unknown;
        suggestedName?: unknown;
        suggestedSummary?: unknown;
        confidence?: unknown;
        detectedAt?: unknown;
      }>("skill-lifecycle.extract", {
        agentId,
        contextId,
      });
      // User may have dismissed ("暂不处理") while extract was in flight.
      if (!state.workbenchSkillSaveModalOpen) {
        return optimisticMessageId;
      }
      const profile =
        result?.profile && typeof result.profile === "object" && !Array.isArray(result.profile)
          ? (result.profile as Record<string, unknown>)
          : {};
      const suggestedName =
        typeof result?.suggestedName === "string" && result.suggestedName.trim()
          ? result.suggestedName.trim()
          : typeof profile.name === "string"
            ? profile.name.trim()
            : "";
      const suggestedSummary =
        typeof result?.suggestedSummary === "string" && result.suggestedSummary.trim()
          ? result.suggestedSummary.trim()
          : typeof profile.summary === "string"
            ? profile.summary.trim()
            : "";
      const confidence =
        typeof result?.confidence === "number" && Number.isFinite(result.confidence)
          ? Math.max(0, Math.min(1, result.confidence))
          : 0;
      state.workbenchSkillExtractedPreview = {
        suggestedName,
        suggestedSummary,
        confidence,
        detectedAt:
          typeof result?.detectedAt === "number" && Number.isFinite(result.detectedAt)
            ? result.detectedAt
            : null,
      };
      state.workbenchSkillSaveModalFormData = {
        name: suggestedName,
        summary: suggestedSummary,
        assetType: intent.kind === "save-and-submit-enterprise" ? "workflow" : "capability",
      };
    } catch (error) {
      if (state.workbenchSkillSaveModalOpen) {
        state.workbenchSkillSaveModalError = error instanceof Error ? error.message : String(error);
      }
    }
  }
  if (
    state.workbenchSkillSaveModalOpen &&
    intent.kind === "save-and-submit-enterprise" &&
    state.workbenchSkillSaveModalFormData?.assetType === "capability"
  ) {
    state.workbenchSkillSaveModalFormData = {
      ...state.workbenchSkillSaveModalFormData,
      assetType: "workflow",
    };
  }
  return optimisticMessageId;
}

function canMentionInCurrentOrganization(params: {
  targetAgentId: string;
  mentionAuthority: ChatMentionAuthorityContext;
}): { allowed: boolean; reason?: string } {
  if (params.targetAgentId === "__all__") {
    return { allowed: true };
  }
  if (params.targetAgentId === "__system__") {
    const permissions = params.mentionAuthority.senderIdentity.permissions;
    return permissions.includes("coordinate") || permissions.includes("admin")
      ? { allowed: true }
      : { allowed: false, reason: "System mentions require coordinator permission" };
  }
  const { organizationContext } = params.mentionAuthority;
  const isCoordinator = organizationContext.coordinator?.agentId === params.targetAgentId;
  const isMember = organizationContext.members.some(
    (member) => member.agentId === params.targetAgentId,
  );
  return isCoordinator || isMember
    ? { allowed: true }
    : { allowed: false, reason: "Mention target is not in the current organization" };
}

export function validateMentionAuthorityForSend(
  mentions: MentionMetadata[] | undefined,
  mentionAuthority: ChatMentionAuthorityContext | undefined,
): { allowed: true } | { allowed: false; reason: string } {
  if (!mentions || mentions.length === 0 || !mentionAuthority) {
    return { allowed: true };
  }

  for (const mention of mentions) {
    const result = canMentionInCurrentOrganization({
      targetAgentId: mention.agentId ?? "",
      mentionAuthority,
    });
    if (!result.allowed) {
      const targetLabel =
        mention.agentId === "__system__"
          ? "@system"
          : mention.agentId === "__all__"
            ? "@all"
            : mention.displayName;
      return {
        allowed: false,
        reason: `${targetLabel}: ${
          result.reason ?? `Mention target "${mention.displayName}" is not allowed`
        }`,
      };
    }
  }

  return { allowed: true };
}

function isLegacyChatHistoryIncludeToolsUnsupportedError(err: unknown): boolean {
  const message = toErrorMessage(err);
  return (
    LEGACY_CHAT_HISTORY_INVALID_RE.test(message) &&
    LEGACY_CHAT_HISTORY_INCLUDE_TOOLS_RE.test(message)
  );
}

type ChatHistoryResponse = {
  messages?: Array<unknown>;
  thinkingLevel?: string;
  nextBefore?: string | null;
  hasMore?: boolean;
  /** In-flight server run for this session. `null` means the session is idle. */
  activeRun?: { runId?: string; text?: string } | null;
};

const CHAT_HISTORY_PAGE_LIMIT = 200;

export async function refreshConversationTaskProgress(state: ChatHistoryState): Promise<void> {
  if (!state.client || !state.connected) {
    state.conversationTaskProgress = null;
    setConversationTaskProgressEntries([]);
    return;
  }
  const conversationId = state.sessionKey.trim();
  if (!conversationId) {
    state.conversationTaskProgress = null;
    setConversationTaskProgressEntries([]);
    return;
  }
  try {
    const res = await state.client.request<{
      progress?: import("../../../../src/progress-ledger/types.ts").ProgressView | null;
      tasks?: ConversationTaskProgressEntry[];
    }>("conversation-task.active.get", { conversationId });
    setConversationTaskProgressEntries(Array.isArray(res?.tasks) ? res.tasks : []);
    state.conversationTaskProgress = res?.progress ?? null;
  } catch {
    state.conversationTaskProgress = null;
    setConversationTaskProgressEntries([]);
  }
}

/** History pages and live rows are arrays. A missing list must not throw `reading 'length'`. */
function asChatMessages(messages: unknown): unknown[] {
  return Array.isArray(messages) ? messages : [];
}

function normalizeHistoryMessages(messages: unknown[]): unknown[] {
  return messages
    .filter((message) => !shouldHideChatHistoryMessage(message))
    .map((message) =>
      message && typeof message === "object" && !Array.isArray(message)
        ? withGeneratedPreviewArtifact(message as Record<string, unknown>)
        : message,
    );
}

function historyMessageDedupeKey(message: unknown): string | null {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return null;
  }
  const row = message as Record<string, unknown>;
  if (typeof row.id === "string" && row.id.trim()) {
    return `id:${row.id}`;
  }
  if (typeof row.messageId === "string" && row.messageId.trim()) {
    return `mid:${row.messageId}`;
  }
  return null;
}

function applyHistoryCursorFields(state: ChatHistoryState, res: ChatHistoryResponse) {
  state.chatHistoryNextBefore =
    typeof res.nextBefore === "string" && res.nextBefore.trim() ? res.nextBefore : null;
  state.chatHistoryHasMore = Boolean(res.hasMore) && Boolean(state.chatHistoryNextBefore);
}

async function requestChatHistory(
  client: GatewayBrowserClient,
  sessionKey: string,
  opts?: { before?: string; limit?: number },
): Promise<ChatHistoryResponse> {
  const baseParams: Record<string, unknown> = {
    sessionKey,
    limit: opts?.limit ?? CHAT_HISTORY_PAGE_LIMIT,
  };
  if (opts?.before) {
    baseParams.before = opts.before;
  }
  const primaryParams = legacyChatHistoryIncludeToolsUnsupported
    ? baseParams
    : { ...baseParams, includeTools: false };
  try {
    return await client.request<ChatHistoryResponse>("chat.history", primaryParams);
  } catch (err) {
    if (
      !legacyChatHistoryIncludeToolsUnsupported &&
      isLegacyChatHistoryIncludeToolsUnsupportedError(err)
    ) {
      legacyChatHistoryIncludeToolsUnsupported = true;
      return await client.request<ChatHistoryResponse>("chat.history", baseParams);
    }
    throw err;
  }
}

function isStaleChatHistoryResponse(state: ChatHistoryState, requestedKey: string): boolean {
  const current = state.sessionKey.trim();
  const requested = requestedKey.trim();
  if (!requested || !current) {
    return false;
  }
  return !sessionKeysShareChatSurface(requested, current);
}

export type LoadChatHistoryOptions = {
  /**
   * Cold Control UI / hard refresh (`refreshChat`) may focus 电脑 from history.
   * Nav session switch must omit this.
   */
  forceOpenComputerPreview?: boolean;
};

export async function loadChatHistory(state: ChatHistoryState, options?: LoadChatHistoryOptions) {
  const replaceLocal = Boolean(state.chatHistoryReplaceLocal);
  if (replaceLocal) {
    state.chatHistoryReplaceLocal = false;
  }
  if (!state.client || !state.connected) {
    return;
  }
  const alignedSessionKey = resolveChatHistorySessionKey(state);
  const resolvedSessionKey = resolvePreferredChatSessionKey(
    alignedSessionKey,
    state.sessionsResult,
  );
  const historyKey = (resolvedSessionKey || state.sessionKey).trim();
  const previousKey = state.sessionKey.trim();
  const crossSurface =
    Boolean(historyKey) &&
    Boolean(previousKey) &&
    !sessionKeysShareChatSurface(historyKey, previousKey);
  // Hard isolation: never retain another surface's bubbles across history loads.
  if (crossSurface) {
    state.chatMessages = [];
    state.chatStream = null;
    state.chatStreamStartedAt = null;
    state.chatStreamSessionKey = null;
    state.chatThinkingProgress = null;
  }
  if (resolvedSessionKey && resolvedSessionKey !== state.sessionKey) {
    state.sessionKey = resolvedSessionKey;
  }
  const quiet = Boolean(state.chatHistoryQuietReload);
  // Tool-result reloads are not quiet, and they land while the agent is still
  // running. Snapshot the stop-button occupancy for any same-session reload.
  // A terminal event clears chatRunId during the await; that must not be restored.
  const preservedOccupancy =
    !crossSurface && state.chatRunId
      ? {
          chatRunId: state.chatRunId,
          chatStream: state.chatStream,
          chatStreamStartedAt: state.chatStreamStartedAt,
          chatStreamSessionKey: state.chatStreamSessionKey,
          chatThinkingProgress: state.chatThinkingProgress,
          workProgressPhase: state.workProgressPhase ?? null,
          workProgressToolsInFlight: state.workProgressToolsInFlight ?? 0,
          workProgressNarration:
            (state as { workProgressNarration?: string | null }).workProgressNarration ?? null,
        }
      : null;
  if (!quiet) {
    state.chatLoading = true;
  }
  state.lastError = null;
  state.chatHistoryLoadingMore = false;
  try {
    const res = await requestChatHistory(state.client, resolvedSessionKey || state.sessionKey);
    if (isStaleChatHistoryResponse(state, historyKey)) {
      return;
    }
    const messages = Array.isArray(res.messages) ? res.messages : [];
    // Never replace non-empty local rows with an empty history page — corrupt
    // indexes, parent-final reloads, and persistence lag all surface as [].
    // Collaboration/group surfaces: empty transcript is valid — never fill with
    // leftover main 1:1 (employee) bubbles after a session switch.
    // Checkpoint restore sets replaceLocal so an intentional empty rewind lands.
    const isSpaceHistory = isCollaborationSpaceSessionKey(historyKey);
    const localMessages = asChatMessages(state.chatMessages);
    const keepLocal =
      !replaceLocal &&
      messages.length === 0 &&
      localMessages.length > 0 &&
      !crossSurface &&
      !isSpaceHistory &&
      sessionKeysShareChatSurface(historyKey, state.sessionKey.trim());
    if (replaceLocal) {
      state.chatMessages = normalizeHistoryMessages(messages);
    } else if (!keepLocal) {
      state.chatMessages = mergeIncomingHistoryWithLocalUserTurn(
        localMessages,
        normalizeHistoryMessages(messages),
      );
    }
    // Nav: runWorkbenchNavSelection → switchEmployeeWorkbenchSession →
    // loadChatHistory. That path omits forceOpen, so browser/云电脑 history
    // must not focus 电脑. Cold Control UI / hard refresh passes
    // forceOpenComputerPreview. Checkpoint restore still replaces local rows
    // without opening the dock.
    syncComputerPreviewFromMessages(state, state.chatMessages, {
      forceOpen: options?.forceOpenComputerPreview === true,
    });
    try {
      const { noteDaibaiGuideHistory } =
        await import("../ports/employee/daibai-guide-history-wire.ts");
      noteDaibaiGuideHistory(state);
    } catch {
      // Guide retention must not block the transcript load.
    }
    applyHistoryCursorFields(state, res);
    if (replaceLocal && historyKey) {
      writeWorkbenchSessionTranscript(
        historyKey,
        {
          messages: state.chatMessages,
          chatHistoryNextBefore: state.chatHistoryNextBefore,
          chatHistoryHasMore: state.chatHistoryHasMore,
          chatRunId: state.chatRunId,
          chatStream: state.chatStream,
          chatStreamStartedAt: state.chatStreamStartedAt,
          chatStreamSessionKey: state.chatStreamSessionKey,
          chatThinkingProgress: state.chatThinkingProgress,
        },
        { allowEmpty: true },
      );
    }
    state.chatThinkingLevel = res.thinkingLevel ?? null;
    // Assistant and tool rows appear long before the run ends. Dropping
    // chatRunId here turns the composer stop control back into send, so a
    // click never issues chat.abort. `activeRun` is authoritative after a
    // reconnect: hello no longer wipes occupancy, and a hard refresh adopts
    // the server run plus its buffered text.
    const occupancy = applyHistoryActiveRunOccupancy({
      state,
      preserved: preservedOccupancy
        ? ({
            chatRunId: preservedOccupancy.chatRunId,
            chatStream: preservedOccupancy.chatStream,
            chatStreamStartedAt: preservedOccupancy.chatStreamStartedAt,
            chatStreamSessionKey: preservedOccupancy.chatStreamSessionKey,
            chatThinkingProgress: preservedOccupancy.chatThinkingProgress,
            workProgressPhase: preservedOccupancy.workProgressPhase,
            workProgressToolsInFlight: preservedOccupancy.workProgressToolsInFlight,
            workProgressNarration: preservedOccupancy.workProgressNarration,
          } satisfies HistoryOccupancySnapshot)
        : null,
      activeRun: readHistoryActiveRun(res.activeRun),
    });
    if (occupancy === "clear") {
      maybeResetToolStream(state);
      clearWorkProgress(state);
    }
  } catch (err) {
    if (isStaleChatHistoryResponse(state, historyKey)) {
      return;
    }
    state.lastError = formatChatSendError(err);
    state.chatHistoryNextBefore = null;
    state.chatHistoryHasMore = false;
  } finally {
    if (!quiet && !isStaleChatHistoryResponse(state, historyKey)) {
      state.chatLoading = false;
    }
  }
}

/** Prefetch an older page via chat.history `before` cursor and prepend. */
export async function loadOlderChatHistory(state: ChatHistoryState) {
  if (!state.client || !state.connected) {
    return;
  }
  if (
    state.chatLoading ||
    state.chatHistoryLoadingMore ||
    !state.chatHistoryHasMore ||
    !state.chatHistoryNextBefore
  ) {
    return;
  }
  const sessionKey = resolvePreferredChatSessionKey(
    resolveChatHistorySessionKey(state),
    state.sessionsResult,
  );
  const before = state.chatHistoryNextBefore;
  state.chatHistoryLoadingMore = true;
  try {
    const res = await requestChatHistory(state.client, sessionKey || state.sessionKey, {
      before,
    });
    const older = normalizeHistoryMessages(Array.isArray(res.messages) ? res.messages : []);
    const existing = asChatMessages(state.chatMessages);
    const existingKeys = new Set(
      existing.map(historyMessageDedupeKey).filter((key): key is string => Boolean(key)),
    );
    const uniqueOlder = older.filter((message) => {
      const key = historyMessageDedupeKey(message);
      if (!key) {
        return true;
      }
      if (existingKeys.has(key)) {
        return false;
      }
      existingKeys.add(key);
      return true;
    });
    state.chatMessages = [...uniqueOlder, ...existing];
    applyHistoryCursorFields(state, res);
  } catch (err) {
    state.lastError = formatChatSendError(err);
  } finally {
    state.chatHistoryLoadingMore = false;
  }
}

export const __test = {
  isLegacyChatHistoryIncludeToolsUnsupportedError,
  resetLegacyChatHistoryIncludeToolsUnsupported: () => {
    legacyChatHistoryIncludeToolsUnsupported = false;
  },
  resetTerminalChatRuns: resetTerminalChatRunsForTests,
};

function dataUrlToBase64(
  dataUrl: string,
  fallbackMimeType?: string,
): { content: string; mimeType: string } | null {
  const match = /^data:([^;]*);base64,([\s\S]+)$/.exec(dataUrl);
  if (!match) {
    return null;
  }
  const mimeType = match[1]?.trim() || fallbackMimeType?.trim() || "application/octet-stream";
  return { mimeType, content: match[2] };
}

function isSendableAttachment(att: ChatAttachment) {
  return Boolean(att.dataUrl && att.status !== "reading" && att.status !== "failed");
}

function buildAttachmentContentBlocks(
  attachments: ChatAttachment[],
  status: "uploading" | "sent" | "failed",
): Array<Record<string, unknown>> {
  return attachments.map((att) => {
    if (att.mimeType.startsWith("image/")) {
      return {
        type: "image",
        source: {
          type: "base64",
          media_type: att.mimeType,
          data: att.dataUrl,
        },
        fileName: att.fileName,
        mimeType: att.mimeType,
        assetId: att.assetId,
        versionId: att.versionId,
        contentHash: att.contentHash,
        sizeBytes: att.sizeBytes,
        lastModified: att.lastModified,
        status,
      };
    }
    return {
      type: "file",
      fileName: att.fileName || att.mimeType,
      mimeType: att.mimeType,
      assetId: att.assetId,
      versionId: att.versionId,
      contentHash: att.contentHash,
      sizeBytes: att.sizeBytes,
      lastModified: att.lastModified,
      status,
    };
  });
}

function markOptimisticAttachmentStatus(
  state: Pick<ChatSendState, "chatMessages">,
  messageId: string,
  status: "sent" | "failed",
) {
  state.chatMessages = state.chatMessages.map((message) => {
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      return message;
    }
    const entry = message as Record<string, unknown>;
    if (entry.id !== messageId || !Array.isArray(entry.content)) {
      return message;
    }
    return {
      ...entry,
      content: entry.content.map((block) => {
        if (!block || typeof block !== "object") {
          return block;
        }
        const item = block as Record<string, unknown>;
        if (item.type !== "image" && item.type !== "file") {
          return block;
        }
        return { ...item, status };
      }),
    };
  });
}

function buildAttachmentManifestForTransport(attachments: ChatAttachment[]) {
  if (attachments.length === 0) {
    return "";
  }
  const lines = attachments.map((att, index) => {
    const name = att.fileName?.trim() || `attachment-${index + 1}`;
    const mime = att.mimeType?.trim() || "application/octet-stream";
    return `<attachment name="${name.replace(/[<>&"]/g, "_")}" mime="${mime.replace(/[<>&"]/g, "_")}" status="client_sent" />`;
  });
  return ["<attachments>", ...lines, "</attachments>"].join("\n");
}

type AssistantMessageNormalizationOptions = {
  roleRequirement: "required" | "optional";
  roleCaseSensitive?: boolean;
  requireContentArray?: boolean;
  allowTextField?: boolean;
};

function normalizeAssistantMessage(
  message: unknown,
  options: AssistantMessageNormalizationOptions,
): Record<string, unknown> | null {
  if (!message || typeof message !== "object") {
    return null;
  }
  const candidate = message as Record<string, unknown>;
  const roleValue = candidate.role;
  if (typeof roleValue === "string") {
    const role = options.roleCaseSensitive ? roleValue : roleValue.toLowerCase();
    if (role !== "assistant") {
      return null;
    }
  } else if (options.roleRequirement === "required") {
    return null;
  }

  if (options.requireContentArray) {
    return Array.isArray(candidate.content) ? candidate : null;
  }
  if (!("content" in candidate) && !(options.allowTextField && "text" in candidate)) {
    return null;
  }
  return candidate;
}

function normalizeAbortedAssistantMessage(message: unknown): Record<string, unknown> | null {
  return normalizeAssistantMessage(message, {
    roleRequirement: "required",
    roleCaseSensitive: true,
    requireContentArray: true,
  });
}

function normalizeFinalAssistantMessage(message: unknown): Record<string, unknown> | null {
  return normalizeAssistantMessage(message, {
    roleRequirement: "optional",
    allowTextField: true,
  });
}

function normalizeFinalVisibleMessage(message: unknown): Record<string, unknown> | null {
  const normalized = normalizeFinalAssistantMessage(message);
  if (normalized) {
    return normalized;
  }
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return null;
  }
  const candidate = message as Record<string, unknown>;
  const role = typeof candidate.role === "string" ? candidate.role.toLowerCase() : "";
  if (role !== "user") {
    return null;
  }
  if (!("content" in candidate) && !("text" in candidate)) {
    return null;
  }
  return candidate;
}

function appendChatMessage(
  state: Pick<ChatEventState, "chatMessages">,
  message: Record<string, unknown>,
) {
  // Defense-in-depth: never append internal memory-flush prompts as chat bubbles.
  if (isMemoryFlushHistoryMessage(message)) {
    return;
  }
  const messageId = typeof message.id === "string" ? message.id : "";
  if (
    messageId &&
    state.chatMessages.some(
      (existing) =>
        existing &&
        typeof existing === "object" &&
        !Array.isArray(existing) &&
        (existing as Record<string, unknown>).id === messageId,
    )
  ) {
    const existingMessages = Array.isArray(state.chatMessages) ? state.chatMessages : [];
    state.chatMessages = existingMessages.map((existing) =>
      existing &&
      typeof existing === "object" &&
      !Array.isArray(existing) &&
      (existing as Record<string, unknown>).id === messageId
        ? withGeneratedPreviewArtifact(message)
        : existing,
    );
    return;
  }
  state.chatMessages = [
    ...(Array.isArray(state.chatMessages) ? state.chatMessages : []),
    withGeneratedPreviewArtifact(message),
  ];
}

function matchesRecentRunFailureNotice(
  messages: unknown[],
  message: Record<string, unknown>,
): boolean {
  const incoming = extractText(message)?.trim() ?? "";
  if (!incoming) {
    return false;
  }
  const start = Math.max(0, messages.length - 4);
  for (let index = messages.length - 1; index >= start; index -= 1) {
    const row = messages[index];
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      continue;
    }
    const id = (row as { id?: unknown }).id;
    if (typeof id !== "string" || !id.startsWith("run-error:")) {
      continue;
    }
    if ((extractText(row)?.trim() ?? "") === incoming) {
      return true;
    }
  }
  return false;
}

function appendVisibleAssistantMessage(
  state: Pick<ChatEventState, "chatMessages">,
  message: Record<string, unknown> | null,
) {
  if (!message || isAssistantSilentReply(message)) {
    return false;
  }
  const messages = Array.isArray(state.chatMessages) ? state.chatMessages : [];
  if (matchesRecentRunFailureNotice(messages, message)) {
    return true;
  }
  appendChatMessage(state, message);
  noteBrowserComputerUse(state, message);
  return true;
}

function buildAssistantTextMessage(
  text: string,
  speaker?: { senderLabel: string | null; agentId: string | null },
) {
  return withGeneratedPreviewArtifact({
    role: "assistant",
    content: [{ type: "text", text }],
    timestamp: Date.now(),
    ...(speaker?.senderLabel ? { senderLabel: speaker.senderLabel } : {}),
    ...(speaker?.agentId ? { agentId: speaker.agentId } : {}),
  });
}

function appendVisibleStreamedAssistantReply(
  state: Pick<ChatEventState, "chatMessages" | "chatStream">,
  speaker?: { senderLabel: string | null; agentId: string | null },
) {
  const streamedText = state.chatStream ?? "";
  if (!streamedText.trim() || isSilentReplyStream(streamedText)) {
    return false;
  }
  appendChatMessage(state, buildAssistantTextMessage(streamedText, speaker));
  return true;
}

function readPayloadReplyLanguage(message: unknown): "zh" | "en" | null {
  if (!message || typeof message !== "object") {
    return null;
  }
  const value = (message as { replyLanguage?: unknown }).replyLanguage;
  return value === "zh" || value === "en" ? value : null;
}

function clearActiveChatRunState(
  state: Pick<
    ChatEventState,
    | "chatRunId"
    | "chatStream"
    | "chatStreamStartedAt"
    | "chatStreamSessionKey"
    | "chatStreamReplyLanguage"
    | "chatThinkingProgress"
  >,
  eventRunId?: string | null,
) {
  // Remember the id before wiping it. A later chat.history can still report
  // this run until the gateway drops its abort controller.
  noteTerminalChatRun(state.chatRunId);
  noteTerminalChatRun(eventRunId);
  state.chatStream = null;
  state.chatStreamReplyLanguage = null;
  state.chatRunId = null;
  state.chatStreamStartedAt = null;
  state.chatStreamSessionKey = null;
  state.chatThinkingProgress = null;
  clearWorkProgress(state);
  (state as { workProgressNarration?: string | null }).workProgressNarration = null;
  // A terminal run event (final / error / undo) means no more compaction events
  // will arrive for this run, so drop any lingering "Compacting context…" pill.
  clearCompactionStatus(state as unknown as CompactionHost);
}

function removeChatMessageById(
  state: Pick<ChatEventState, "chatMessages">,
  messageId: string | null | undefined,
) {
  const targetId = typeof messageId === "string" ? messageId.trim() : "";
  if (!targetId) {
    return;
  }
  const currentMessages = Array.isArray(state.chatMessages) ? state.chatMessages : [];
  state.chatMessages = currentMessages.filter((entry) => {
    if (!entry || typeof entry !== "object") {
      return true;
    }
    return (entry as { id?: unknown }).id !== targetId;
  });
}

function readMessageIdentityField(
  message: unknown,
  field: "senderLabel" | "agentId",
): string | null {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return null;
  }
  const value = (message as Record<string, unknown>)[field];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function mergeAssistantSpeakerIdentity(
  message: Record<string, unknown>,
  speaker: { senderLabel: string | null; agentId: string | null },
): Record<string, unknown> {
  const senderLabel = readMessageIdentityField(message, "senderLabel") ?? speaker.senderLabel;
  const agentId = readMessageIdentityField(message, "agentId") ?? speaker.agentId;
  return {
    ...message,
    ...(senderLabel ? { senderLabel } : {}),
    ...(agentId ? { agentId } : {}),
  };
}

function resolveEventSpeaker(
  state: Pick<ChatEventState, "sessionKey" | "chatRunId" | "chatStreamSessionKey">,
  payload: ChatEventPayload,
) {
  return resolveSpaceStreamSpeaker({
    sessionKey: state.sessionKey,
    chatRunId: payload.runId ?? state.chatRunId,
    chatStreamSessionKey: payload.sessionKey ?? state.chatStreamSessionKey,
    senderLabel: readMessageIdentityField(payload.message, "senderLabel"),
    agentId: readMessageIdentityField(payload.message, "agentId"),
  });
}

function handleForeignRunFinalEvent(state: ChatEventState, payload: ChatEventPayload) {
  const finalMessage = normalizeFinalVisibleMessage(payload.message);
  const speaker = resolveEventSpeaker(state, payload);
  const stamped = finalMessage ? mergeAssistantSpeakerIdentity(finalMessage, speaker) : null;
  if (appendVisibleAssistantMessage(state, stamped)) {
    return null;
  }
  return "final";
}

function handleFinalChatEvent(state: ChatEventState, payload: ChatEventPayload) {
  const finalMessage = normalizeFinalVisibleMessage(payload.message);
  const speaker = resolveEventSpeaker(state, payload);
  const stamped = finalMessage ? mergeAssistantSpeakerIdentity(finalMessage, speaker) : null;
  if (!appendVisibleAssistantMessage(state, stamped)) {
    appendVisibleStreamedAssistantReply(state, speaker);
  }
  clearActiveChatRunState(state, payload.runId);
}

function handleAbortedChatEvent(state: ChatEventState, payload: ChatEventPayload) {
  if (payload.mode === "undo") {
    removeChatMessageById(state, payload.userMessageId);
    clearActiveChatRunState(state, payload.runId);
    return;
  }
  const normalizedMessage = normalizeAbortedAssistantMessage(payload.message);
  const speaker = resolveEventSpeaker(state, payload);
  const stamped = normalizedMessage
    ? mergeAssistantSpeakerIdentity(normalizedMessage, speaker)
    : null;
  if (!appendVisibleAssistantMessage(state, stamped)) {
    appendVisibleStreamedAssistantReply(state, speaker);
  }
  clearActiveChatRunState(state, payload.runId);
}

function handleErrorChatEvent(state: ChatEventState, payload: ChatEventPayload) {
  const raw = payload.errorMessage?.trim() || "chat error";
  if (isUnsupportedImageSoftFailure(raw)) {
    clearActiveChatRunState(state, payload.runId);
    appendVisibleAssistantMessage(state, {
      role: "assistant",
      content: [{ type: "text", text: UNSUPPORTED_IMAGE_DIALOGUE }],
      timestamp: Date.now(),
    });
    return;
  }
  const visible = String(sanitizeUserFacingChatError(raw)).trim() || raw;
  const speaker = resolveEventSpeaker(state, payload);
  // Keep a partial reply, then add the failure itself when the transcript
  // does not already show it. Do not set lastError: that string is the top
  // danger rail and reads as a hard crash.
  appendVisibleStreamedAssistantReply(state, speaker);
  if (!transcriptContainsChatError(state.chatMessages, raw)) {
    appendChatMessage(state, {
      ...buildAssistantTextMessage(visible, speaker),
      id: payload.runId ? `run-error:${payload.runId}` : "run-error",
    });
  }
  clearActiveChatRunState(state, payload.runId);
}

function sameAbortRun(left: string | null | undefined, right: string | null | undefined): boolean {
  const a = left?.trim() ?? "";
  const b = right?.trim() ?? "";
  if (!a || !b) {
    return true;
  }
  return a === b || a.startsWith(`${b}:`) || b.startsWith(`${a}:`);
}

/** Gateway already finished the run, so Stop has nothing left to cancel. */
function isAbsentChatRunAbortError(err: unknown): boolean {
  const message = (err instanceof Error ? err.message : typeof err === "string" ? err : "")
    .trim()
    .toLowerCase();
  if (!message) {
    return false;
  }
  return (
    message.includes("no active run") ||
    message.includes("unknown run") ||
    message.includes("run not found") ||
    message.includes("no such run") ||
    message.includes("not currently running")
  );
}

function releaseSettledChatAbort(state: ChatAbortState, runId: string | null) {
  if (!sameAbortRun(state.chatRunId, runId)) {
    return;
  }
  clearActiveChatRunState(state, runId);
}

/**
 * `aborted: true` means the gateway is still cancelling a live run. Leave
 * occupancy until the aborted chat event lands so the partial reply is kept.
 * `aborted: false` (or an empty ack) means chat.final already dropped the
 * controller and no further chat event will clear the composer.
 */
function abortResultLeavesRunLive(result: unknown): boolean {
  if (!result || typeof result !== "object") {
    return false;
  }
  const record = result as { aborted?: unknown; runIds?: unknown };
  if (record.aborted === true) {
    return true;
  }
  return Array.isArray(record.runIds) && record.runIds.length > 0 && record.aborted !== false;
}

export async function sendChatMessage(
  state: ChatSendState,
  message: string,
  attachments?: ChatAttachment[],
  options: ChatSendOptions = {},
): Promise<string | null> {
  if (!state.client || !state.connected) {
    return null;
  }
  const growthBirthTurn = options.growthBirthTurn === true;
  const body = message.trim();
  const decidingStewardCall =
    (body === "同意" || body === "不同意") &&
    state.chatMessages.some((message) => readStewardCallAuthorization(message));
  const suppressOptimisticUser =
    options.suppressOptimisticUserMessage === true || decidingStewardCall;
  const composerQuote = options.composerQuote ?? null;
  const msg =
    options.displayMessage?.trim() ??
    (composerQuote ? composeQuotedUserMessage(composerQuote, body) : body);
  const sendableAttachments = attachments?.filter(isSendableAttachment) ?? [];
  const hasAttachments = sendableAttachments.length > 0;
  const transportMessage =
    body || (growthBirthTurn ? "\u200b" : "") || (hasAttachments ? "" : null);
  if (transportMessage === null && !hasAttachments) {
    return null;
  }

  const explicitAssetIntent = detectAssetCommandIntent(msg);
  if (explicitAssetIntent) {
    const contextId = findLatestAssetContextId(
      (state as unknown as ChatState).chatMessages ?? [],
      state.sessionKey,
    );
    // After "暂不处理", skip auto-jump into organize-draft for this session/context.
    // Manual organize entry points remain available.
    if (
      !isAssetSuggestionDismissed({
        contextId,
        sessionKey: state.sessionKey,
      })
    ) {
      return await handleExplicitAssetCommand(
        state as unknown as ChatState,
        msg,
        sendableAttachments,
        explicitAssetIntent,
      );
    }
  }

  const mentionAuthority = validateMentionAuthorityForSend(
    options.mentions,
    options.mentionAuthority,
  );
  if (!mentionAuthority.allowed) {
    state.lastError = `无法发送提及：${mentionAuthority.reason}`;
    return null;
  }

  // M1: user asks to open 云电脑 — focus 电脑 Tab + request preview before tools arrive
  // (hard-refresh / chat-only path must not stay on artifact).
  if (/打开云电脑|云电脑|打开电脑|看京东|去京东/.test(msg)) {
    const assistantName =
      typeof (state as { assistantName?: string }).assistantName === "string"
        ? (state as { assistantName?: string }).assistantName
        : "Agent";
    beginAgentComputerUse(state as never, assistantName || "Agent");
    const syncHost = state as {
      syncAccountComputerPreview?: () => void;
      refreshAccountComputerPreview?: (action: "open" | "status" | "end") => void | Promise<void>;
    };
    if (typeof syncHost.syncAccountComputerPreview === "function") {
      syncHost.syncAccountComputerPreview();
    } else if (typeof syncHost.refreshAccountComputerPreview === "function") {
      void syncHost.refreshAccountComputerPreview("open");
    }
  }

  const now = Date.now();
  const runId =
    typeof options.idempotencyKey === "string" && options.idempotencyKey.trim()
      ? options.idempotencyKey.trim()
      : generateUUID();
  const optimisticMessageId = `local-${runId}`;

  // Build user message content blocks
  const contentBlocks: Array<Record<string, unknown>> = [];
  if (msg) {
    contentBlocks.push({ type: "text", text: msg });
  }
  if (hasAttachments) {
    contentBlocks.push(...buildAttachmentContentBlocks(sendableAttachments, "uploading"));
  }

  if (!suppressOptimisticUser) {
    state.chatMessages = [
      ...state.chatMessages,
      {
        id: optimisticMessageId,
        role: "user",
        content: contentBlocks,
        timestamp: now,
      },
    ];
  }

  state.chatSending = true;
  state.lastError = null;
  const sessionKey = resolveChatSendSessionKey(state);
  realignSessionKeyForSend(state, sessionKey);
  state.chatRunId = runId;
  state.chatStream = "";
  state.chatStreamStartedAt = now;
  state.chatThinkingProgress = null;
  applyWorkProgress(state, { type: "turn-start" });
  // Steward workbench may still hold a template prelude from user.daibai.ask; clear it
  // when a real model turn starts so inventory text cannot look like the assistant reply.
  if ("daibaiAskResult" in state) {
    (state as { daibaiAskResult: unknown }).daibaiAskResult = null;
  }

  // Convert attachments to API format
  const apiAttachments = hasAttachments
    ? sendableAttachments
        .map((att) => {
          const parsed = dataUrlToBase64(att.dataUrl, att.mimeType);
          if (!parsed) {
            return null;
          }
          return {
            type: parsed.mimeType.startsWith("image/") ? "image" : "file",
            mimeType: parsed.mimeType,
            fileName: att.fileName,
            assetId: att.assetId,
            versionId: att.versionId,
            contentHash: att.contentHash,
            sizeBytes: att.sizeBytes,
            lastModified: att.lastModified,
            content: parsed.content,
          };
        })
        .filter((a): a is NonNullable<typeof a> => a !== null)
    : undefined;
  const messageForTransport =
    hasAttachments && transportMessage
      ? [transportMessage, buildAttachmentManifestForTransport(sendableAttachments)]
          .filter(Boolean)
          .join("\n\n")
      : transportMessage || buildAttachmentManifestForTransport(sendableAttachments);

  const growthGateProceed =
    options.growthGateProceed === true ||
    (state as { workbenchGrowthGateProceedAuthorized?: boolean })
      .workbenchGrowthGateProceedAuthorized === true;
  const focusSwitchProceed =
    options.focusSwitchProceed === true ||
    (state as { chatFocusSwitchProceedAuthorized?: boolean }).chatFocusSwitchProceedAuthorized ===
      true;
  const focusSwitchCancel =
    options.focusSwitchCancel === true ||
    (state as { chatFocusSwitchCancelAuthorized?: boolean }).chatFocusSwitchCancelAuthorized ===
      true;

  try {
    const contextScope = toChatSendContextScope(
      state.chatContextScope,
      sessionKey,
      state.chatContextSourceCatalog ?? [],
    );
    state.chatContextExpansion = null;
    const humanTakeoverObserved = state.chatHumanTakeoverObserved === true;
    const result = await state.client.request("chat.send", {
      sessionKey,
      message: messageForTransport,
      deliver: false,
      idempotencyKey: runId,
      attachments: apiAttachments,
      ...(composerQuote ? { composerQuote } : {}),
      ...(humanTakeoverObserved ? { humanTakeoverObserved: true } : {}),
      ...(options.mentions && options.mentions.length > 0 ? { mentions: options.mentions } : {}),
      ...(growthBirthTurn ? { growthBirthTurn: true } : {}),
      ...(growthGateProceed ? { growthGateProceed: true } : {}),
      ...(focusSwitchProceed ? { focusSwitchProceed: true } : {}),
      ...(focusSwitchCancel ? { focusSwitchCancel: true } : {}),
      ...(options.stewardCallAuthorizationId
        ? { stewardCallAuthorizationId: options.stewardCallAuthorizationId }
        : {}),
      ...(options.cronReplyContext ? { cronReplyContext: options.cronReplyContext } : {}),
      ...(options.contextScope
        ? { contextScope: options.contextScope }
        : contextScope
          ? { contextScope }
          : {}),
    });
    if (isStewardCallAuthorizationDecision(result)) {
      const authorizationId = result.authorizationId ?? "";
      state.chatMessages = state.chatMessages.filter((message) => {
        const pending = readStewardCallAuthorization(message);
        return pending ? pending.id !== authorizationId : true;
      });
      if (result.status === "accepted" && result.runId) {
        state.chatRunId = result.runId;
        state.chatStream = state.chatStream ?? "";
        if (state.chatStreamStartedAt == null) {
          state.chatStreamStartedAt = Date.now();
        }
        return result.runId;
      }
      state.chatRunId = null;
      state.chatStream = null;
      state.chatStreamStartedAt = null;
      state.chatStreamSessionKey = null;
      state.chatThinkingProgress = null;
      clearWorkProgress(state);
      return null;
    }
    const { applyGrowthGateBlocked, isGrowthGateBlockedResult } = await importWithStaleChunkReload(
      () => import("./growth-task-gate.ts"),
    );
    if (isGrowthGateBlockedResult(result)) {
      applyGrowthGateBlocked(
        state as unknown as import("./growth-task-gate.ts").GrowthGateUiHost,
        result,
        msg,
      );
      return null;
    }
    const { applyFocusSwitchBlocked, isFocusSwitchBlockedResult } =
      await importWithStaleChunkReload(() => import("./focus-switch-gate.ts"));
    if (isFocusSwitchBlockedResult(result)) {
      applyFocusSwitchBlocked(
        state as unknown as import("./focus-switch-gate.ts").FocusSwitchUiHost,
        result,
        msg,
      );
      return null;
    }
    if (focusSwitchProceed || focusSwitchCancel) {
      (state as { chatFocusSwitchProceedAuthorized?: boolean }).chatFocusSwitchProceedAuthorized =
        false;
      (state as { chatFocusSwitchCancelAuthorized?: boolean }).chatFocusSwitchCancelAuthorized =
        false;
      (state as { chatFocusSwitchGate?: unknown }).chatFocusSwitchGate = null;
    }
    if (growthGateProceed) {
      (
        state as { workbenchGrowthGateProceedAuthorized?: boolean }
      ).workbenchGrowthGateProceedAuthorized = false;
      (
        state as { workbenchGrowthContinueBannerVisible?: boolean }
      ).workbenchGrowthContinueBannerVisible = false;
      (state as { workbenchGrowthPendingTask?: unknown }).workbenchGrowthPendingTask = null;
    }
    if (!suppressOptimisticUser) {
      markOptimisticAttachmentStatus(state, optimisticMessageId, "sent");
    }
    if (humanTakeoverObserved) {
      state.chatHumanTakeoverObserved = false;
    }
    if (msg === "/new" || state.chatContextScope?.lifetime !== "session") {
      state.chatContextScope = { ...DEFAULT_CHAT_CONTEXT_SCOPE };
    } else if (state.chatContextScope) {
      state.chatContextScope = {
        ...state.chatContextScope,
        pickerOpen: false,
        consumeReceipts: [],
      };
    }
    return runId;
  } catch (err) {
    // The frame was already on the socket. A close is not an RPC rejection:
    // the gateway may have stored this idempotency key and kept the run.
    if (isGatewaySocketClosedError(err)) {
      if (!suppressOptimisticUser) {
        markOptimisticAttachmentStatus(state, optimisticMessageId, "sent");
      }
      state.lastError = null;
      return runId;
    }
    const error = formatChatSendError(err);
    state.chatRunId = null;
    state.chatStream = null;
    state.chatStreamStartedAt = null;
    state.chatStreamSessionKey = null;
    state.chatThinkingProgress = null;
    clearWorkProgress(state);
    state.lastError = error;
    // Optimistic rows are pending, not transcript. RPC deny must not leave a
    // successful-looking user bubble (ACL / unknown space / attach reject).
    if (!suppressOptimisticUser) {
      removeChatMessageById(state, optimisticMessageId);
    }
    return null;
  } finally {
    state.chatSending = false;
  }
}

export async function abortChatRun(
  state: ChatAbortState,
  opts?: { mode?: "stop" | "undo" },
): Promise<boolean> {
  if (!state.client || !state.connected) {
    return false;
  }
  const runId = state.chatRunId;
  try {
    const result = await state.client.request(
      "chat.abort",
      runId
        ? { sessionKey: state.sessionKey, runId, ...(opts?.mode ? { mode: opts.mode } : {}) }
        : { sessionKey: state.sessionKey, ...(opts?.mode ? { mode: opts.mode } : {}) },
    );
    if (!abortResultLeavesRunLive(result)) {
      releaseSettledChatAbort(state, runId);
    }
    return true;
  } catch (err) {
    if (isAbsentChatRunAbortError(err)) {
      releaseSettledChatAbort(state, runId);
      return true;
    }
    state.lastError = String(err);
    return false;
  }
}

function isSameChatTurnRunId(eventRunId: string, openRunId: string | null | undefined): boolean {
  const open = openRunId?.trim() ?? "";
  const event = eventRunId.trim();
  if (!open || !event) {
    return false;
  }
  return event === open || event.startsWith(`${open}:`);
}

function unstrippedAssistantText(message: unknown): string {
  if (!message || typeof message !== "object") {
    return "";
  }
  const content = (message as { content?: unknown; text?: unknown }).content;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (!part || typeof part !== "object") {
          return "";
        }
        const item = part as { type?: unknown; text?: unknown };
        return item.type === "text" && typeof item.text === "string" ? item.text : "";
      })
      .filter((part) => part.trim().length > 0)
      .join("\n");
  }
  const text = (message as { text?: unknown }).text;
  return typeof text === "string" ? text : "";
}

export function handleChatEvent(state: ChatEventState, payload?: ChatEventPayload) {
  if (!payload) {
    return null;
  }
  // Steward main ↔ *own* employee remap only; never equate different users or agentIds.
  // Collaboration spaces also accept per-bot child keys (`agent:bot:main:space:grp-…`).
  const ownStewardSessionKey =
    state.stewardMainSessionKey?.trim() ||
    (state.sessionKey.startsWith("agent:main:employee:") ? state.sessionKey : null);
  if (
    !chatEventMatchesOpenSession(payload.sessionKey, state.sessionKey, {
      ownStewardSessionKey,
    })
  ) {
    return null;
  }

  // Events from another run (e.g. sub-agent announce, background deliver:false tasks):
  // ignore unless final (history refresh). Without this, background cron/AI runs that error
  // while chatRunId is idle would pollute lastError in unrelated UI surfaces.
  // See https://github.com/openclaw/openclaw/issues/1909
  // Group bot turns emit `${clientRunId}:${agentId}` / `${clientRunId}:user`.
  if (payload.runId && !isSameChatTurnRunId(payload.runId, state.chatRunId)) {
    if (payload.state === "final") {
      return handleForeignRunFinalEvent(state, payload);
    }
    return null;
  }

  const visibleText = extractText(payload.message);
  applyWorkProgress(state, {
    type: "chat",
    state: payload.state,
    hasVisibleText:
      payload.state === "delta" &&
      typeof visibleText === "string" &&
      Boolean(visibleText.trim()) &&
      !isSilentReplyStream(visibleText),
  });

  if (payload.state === "thinking") {
    const streamSessionKey = payload.sessionKey?.trim();
    if (streamSessionKey) {
      state.chatStreamSessionKey = streamSessionKey;
    }
    // Only accept sanitized process snapshots — never treat thinking as delivery.
    if (isSafeThinkingProgressSnapshot(payload.thinking)) {
      // Keep showing progress only while visible delivery text has not started.
      if (!state.chatStream || !state.chatStream.trim()) {
        // Ensure stream slot is open so buildChatItems can render thinking-progress
        // (shared by 1:1 大白 and collaboration) instead of staying on null.
        if (state.chatStream === null) {
          state.chatStream = "";
        }
        if (state.chatStreamStartedAt == null) {
          state.chatStreamStartedAt = Date.now();
        }
        state.chatThinkingProgress = payload.thinking;
      }
    }
  } else if (payload.state === "delta") {
    if (payload.retract) {
      state.chatStream = "";
      return "delta";
    }
    const streamSessionKey = payload.sessionKey?.trim();
    if (streamSessionKey) {
      state.chatStreamSessionKey = streamSessionKey;
    }
    const next = extractText(payload.message);
    const replyLanguage = readPayloadReplyLanguage(payload.message);
    if (replyLanguage) {
      state.chatStreamReplyLanguage = replyLanguage;
    }
    if (typeof next === "string" && next.trim() && !isSilentReplyStream(next)) {
      const current = state.chatStream ?? "";
      // Length-only monotonic updates leave English CoT on screen when a later
      // delta is the shorter Chinese delivery after scratchpad strip. Accept
      // shorter text when it is not a simple truncation of the current stream.
      if (!current || next.length >= current.length || !current.startsWith(next)) {
        state.chatStream = next;
      }
      // Visible delivery started — hide process-channel placeholder.
      if (next.trim()) {
        state.chatThinkingProgress = null;
      }
    } else {
      const raw = unstrippedAssistantText(payload.message).trim();
      // Scratchpad-only text extracts to empty. A silent NO_REPLY is not that case
      // and must leave the stream already on screen alone.
      if (raw && !isSilentReplyStream(raw) && !(typeof next === "string" && next.trim())) {
        state.chatStream = "";
      }
    }
  } else if (payload.state === "user_echo") {
    // Persist-ack only. Closing the turn here ate thinking/delta after :user.
    return "user_echo";
  } else if (payload.state === "final") {
    handleFinalChatEvent(state, payload);
  } else if (payload.state === "aborted") {
    handleAbortedChatEvent(state, payload);
  } else if (payload.state === "error") {
    handleErrorChatEvent(state, payload);
  }
  return payload.state;
}
