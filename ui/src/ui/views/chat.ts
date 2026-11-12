import { html, nothing, type TemplateResult } from "lit";
import { ref } from "lit/directives/ref.js";
import { repeat } from "lit/directives/repeat.js";
import type { MentionCandidate } from "../../../../src/organization/mention-types.js";
import { isDaibaiGuideTranscriptMessage } from "../../../../src/shared/daibai-guide-card.ts";
import {
  isHiddenToolUseScratchpadMessage,
  isToolUseProgressMessage,
  toolUseProgressNarration,
} from "../../../../src/shared/text/assistant-scratchpad.js";
import type { ThinkingProgressSnapshot } from "../../../../src/shared/text/thinking-progress.js";
import { isUnsupportedImageSoftFailure } from "../../../../src/shared/unsupported-image-failure.js";
import { t } from "../../i18n/index.ts";
import { exitComputerFullscreenSize } from "../account-computer/desktop-input-capability.ts";
import { sanitizeUserFacingChatError } from "../chat-error-sanitize.ts";
import { CHAT_ATTACHMENT_ACCEPT, isSupportedAttachmentFile } from "../chat/attachment-kinds.ts";
import {
  checkpointBoundaryCanTruncate,
  collapseConsecutiveDuplicateUserTurns,
  getMessageIdForCheckpoint,
  projectCheckpointPlacements,
  resolveCheckpointPlaceBeforeUserIndex,
} from "../chat/checkpoint-placement.ts";
import { shouldHideCollaborationAssistantMessage } from "../chat/collaboration-message-filter.ts";
import { CHAT_HISTORY_RENDER_LIMIT } from "../chat/constants.ts";
import type { ChatContextExpansionSuggestion } from "../chat/context-expansion.ts";
import type { ChatContextScopeState, ChatContextSourceCatalogItem } from "../chat/context-scope.ts";
import {
  applyConversationPeekVisibility,
  buildConversationPeeks,
  CONVERSATION_PEEK_PAD_Y_PX,
  CONVERSATION_PEEK_TOP_INSET_PX,
  conversationPeekFitLimit,
  conversationPeekWaveLength,
  type ConversationPeek,
} from "../chat/conversation-peeks.ts";
import {
  matchConversationTaskProgressEntry,
  renderConversationTaskInlineProgress,
  type ConversationTaskProgressEntry,
} from "../chat/conversation-task-progress.ts";
import { focusChatMessageInView } from "../chat/focus-message.ts";
import {
  renderMessageGroup,
  renderPeerExchange,
  renderReadingIndicatorGroup,
  renderStreamingGroup,
  renderThinkingProgressGroup,
  renderToolProgressGroup,
  buildChatSenderIdentityLookup,
  type ChatParticipantAgent,
} from "../chat/grouped-render.ts";
import {
  renderHumanAttentionCards,
  type HumanAttentionAction,
  type HumanAttentionActDetail,
  type HumanAttentionCardView,
} from "../chat/human-attention-card.ts";
import { extractText } from "../chat/message-extract.ts";
import { normalizeMessage, normalizeRoleForGrouping } from "../chat/message-normalizer.ts";
import {
  readOwnerDecision,
  renderOwnerDecisionCards,
  type OwnerDecisionAction,
  type OwnerDecisionCardView,
  type OwnerDecisionHydrationTarget,
} from "../chat/owner-decision-card.ts";
import {
  decodeDataUrlText,
  encodeTextDataUrl,
  foldedPastePreview,
  isMarkupClipboardFile,
  mergeRestoredPasteIntoDraft,
  planComposerPaste,
  readClipboardText,
} from "../chat/paste-as-attachment.ts";
import { foldPeerExchangeThread } from "../chat/peer-exchange.ts";
import type { ChatQuoteDraft } from "../chat/quote-draft.ts";
import { presentChatScopedRunFailure } from "../chat/run-failure-transcript.ts";
import {
  resolveSpaceAwareAssistantIdentity,
  resolveSpaceStreamSpeaker,
} from "../chat/space-stream-identity.ts";
import {
  readStewardCallAuthorization,
  renderStewardCallAuthorizationCards,
} from "../chat/steward-call-authorization-card.ts";
import {
  readTaskOutcomeRejectRef,
  type TaskOutcomeRejectRef,
  type TaskOutcomeRejectUiResult,
} from "../chat/task-outcome-reject.ts";
import {
  buildMentionInsertion,
  resolveComposerMentionInsertToken,
} from "../components/mention/mention-insert.ts";
import {
  deriveMentionPopupItems,
  handleMentionPopupKeydown,
  renderMentionPopup,
  type MentionPopupItem,
} from "../components/mention/mention-popup.ts";
import { findActiveTrigger } from "../components/mention/mention-trigger-detector.ts";
import type { GatewayConnectionPhase } from "../gateway-connection-phase.ts";
import type {
  LoginMethodChoiceUi,
  LoginSaveOfferUi,
} from "../gateway-subscriptions/account-computer-login.ts";
import { icons } from "../icons.ts";
import { detectTextDirection } from "../text-direction.ts";
import type { ArtifactWorkspaceSidebar, SessionsListResult } from "../types.ts";
import type {
  ChatArtifact,
  ChatCheckpoint,
  ChatItem,
  MessageGroup,
  TaskCard,
} from "../types/chat-types.ts";
import type { ChatAttachment, ChatQueueItem } from "../ui-types.ts";
import { renderAccountComputerLoginThreadCards } from "./account-computer-login-cards.ts";
import {
  computerKeyboardTarget,
  computerMainFlex,
  computerSplitClasses,
  defaultComputerPreviewModel,
  renderComputerOperatorMark,
  renderComputerPreviewBody,
  renderComputerPreviewHeaderActions,
  renderComputerPreviewTabs,
  renderComputerUsingChip,
  type ComputerPreviewModel,
  type ComputerPreviewSize,
  type ComputerPreviewSurface,
} from "./account-computer-preview.ts";
import {
  renderArtifactSidebar,
  renderArtifactSidebarEmpty,
  renderArtifactSidebarHeaderActions,
  renderDeliverableSaveToast,
} from "./artifact-sidebar.ts";
import {
  renderChatContextExpansionBanner,
  renderChatContextScopePicker,
} from "./chat-context-scope.ts";
import { renderMarkdownSidebar } from "./markdown-sidebar.ts";
import { renderSecureFormThreadCards } from "./secure-form-card.ts";
import type { UsageCostClient } from "./usage-cost/usage-cost-client.ts";
import { renderUsageCostDisclosure } from "./usage-cost/usage-cost-panel.ts";
import "../components/resizable-divider.ts";

export type CompactionIndicatorStatus = {
  active: boolean;
  startedAt: number | null;
  completedAt: number | null;
};

export type FallbackIndicatorStatus = {
  phase?: "active" | "cleared";
  selected: string;
  active: string;
  previous?: string;
  reason?: string;
  attempts: string[];
  occurredAt: number;
};

export type ChatProps = {
  sessionKey: string;
  onSessionKeyChange: (next: string) => void;
  renderMode?: "full" | "composer-only" | "workbench-compact";
  hideContextScope?: boolean;
  thinkingLevel: string | null;
  showThinking: boolean;
  showToolMessages?: boolean;
  showToolCards?: boolean;
  loading: boolean;
  sending: boolean;
  canAbort?: boolean;
  canUndo?: boolean;
  // Per-turn checkpoint rollback (chat-checkpoint-rollback). Replaces the old
  // single top-of-thread restore bar with inline per-checkpoint dividers.
  checkpoints?: ChatCheckpoint[];
  pendingRestoreCheckpointId?: string | null;
  restoreInFlightCheckpointId?: string | null;
  compactionStatus?: CompactionIndicatorStatus | null;
  fallbackStatus?: FallbackIndicatorStatus | null;
  messages: unknown[];
  toolMessages: unknown[];
  streamSegments: Array<{ text: string; ts: number; replyLanguage?: "zh" | "en" | null }>;
  stream: string | null;
  streamStartedAt: number | null;
  /** Turn language for the live stream, so the bubble cleaner matches history. */
  streamReplyLanguage?: "zh" | "en" | null;
  /** Host tick while a turn is in flight; omit in tests to keep static thinking copy. */
  thinkingNowMs?: number;
  /** Process-channel thinking structure + progress (cleared when delivery streams). */
  thinkingProgress?: ThinkingProgressSnapshot | null;
  /**
   * Ephemeral phase label for the live turn (正在思考 / 正在起草 / 正在验证 / 正在整理).
   * Not a transcript message.
   */
  workProgressLabel?: string | null;
  /** Live toolUse narration shown inside the work-progress card. */
  workProgressNarration?: string | null;
  /** Inline ConversationTask progress rows anchored to user messages. */
  conversationTaskProgressEntries?: ConversationTaskProgressEntry[];
  /** Active client run id; group bot turns append `:${agentId}`. */
  chatRunId?: string | null;
  /** Child bot session key for the active collaboration stream. */
  chatStreamSessionKey?: string | null;
  assistantAvatarUrl?: string | null;
  draft: string;
  quoteDraft?: ChatQuoteDraft | null;
  onQuoteDraftChange?: (next: ChatQuoteDraft | null) => void;
  queue: ChatQueueItem[];
  connected: boolean;
  /** 任务卡片上的用量查询。缺省时不发请求。 */
  usageClient?: UsageCostClient | null;
  usageRerender?: (() => void) | null;
  canSend: boolean;
  disabledReason: string | null;
  /** Transport phase. Auth/pairing stays off this and keeps disabledReason as today. */
  gatewayConnectionPhase?: GatewayConnectionPhase;
  /** Shown with the unreachable banner. Resets the reconnect budget. */
  onRetryGatewayConnection?: () => void;
  /**
   * L2 long-task incident strip (binding fail / gateway reconnect / occupied / stuck).
   * Host builds via resolveLongTaskIncidentState + formatLongTaskIncidentLabel.
   */
  longTaskIncidentLabel?: string | null;
  /**
   * L2 board progress beside long task (done / blocker / last persist).
   * Host builds via summarizeLongTaskBoardProgress + formatLongTaskBoardProgressLine.
   */
  longTaskBoardProgressLine?: string | null;
  error: string | null;
  sessions: SessionsListResult | null;
  // Focus mode
  focusMode: boolean;
  // Sidebar state
  sidebarOpen?: boolean;
  sidebarPreviewMode?: "markdown" | "artifact";
  computerPreview?: ComputerPreviewModel;
  onComputerSelectSurface?: (surface: ComputerPreviewSurface) => void;
  onComputerSetSize?: (size: ComputerPreviewSize) => void;
  onComputerTakeover?: () => void;
  onComputerHandBack?: () => void;
  /** M1b: session-level stream reconnect (no location.reload). */
  onComputerReconnectStream?: (reason?: "network" | "stream" | "credential") => void;
  onComputerStreamCredentialInvalid?: () => void;
  onComputerEnd?: () => void;
  onComputerOpen?: () => void;
  onComputerNarrowReturn?: () => void;
  onComputerChip?: () => void;
  sidebarContent?: string | null;
  sidebarError?: string | null;
  artifactWorkspace?: ArtifactWorkspaceSidebar | null;
  deliverableSaveState?: import("../wiring/deliverable-save.ts").DeliverableSaveState | null;
  deliverableSaveToast?: import("../wiring/deliverable-save.ts").DeliverableSaveToast | null;
  showArtifactLibraryTrigger?: boolean;
  collaborationTargets?: Array<{
    sessionKey: string;
    label: string;
    sublabel?: string | null;
    current?: boolean;
  }>;
  feedbackSummary?: {
    total: number;
    up: number;
    down: number;
    reasons?: Record<string, number>;
  } | null;
  authPanel?: TemplateResult | null;
  taskRunId?: string | null;
  splitRatio?: number;
  assistantName: string;
  assistantAvatar: string | null;
  /** Agent id for this conversation. The computer pill must not show this id. */
  assistantAgentId?: string | null;
  /** Agent roster used to resolve per-sender avatars in collaboration threads. */
  participantAgents?: ChatParticipantAgent[];
  /** 当前登录用户展示名；用于纠正 transcript 中误写入的设备名（Chrome · Mac）。 */
  localUserDisplayName?: string | null;
  mentionCandidates?: MentionCandidate[];
  /** Collaboration-only educational hint above the room input. */
  composeHint?: string | null;
  focusSwitchGate?: {
    currentTitle: string;
    incomingTitle: string;
  } | null;
  onFocusSwitchParkAndStart?: () => void;
  onFocusSwitchCancelAndStart?: () => void;
  onFocusSwitchKeepCurrent?: () => void;
  /** 同意 dispatches the pending steward call; 不同意 refuses it. */
  onStewardCallAuthorizationDecision?: (action: "同意" | "不同意", authorizationId: string) => void;
  onOwnerDecision?: (
    action: OwnerDecisionAction,
    card: OwnerDecisionCardView,
    detail?: import("../chat/owner-decision-card.ts").OwnerDecisionDetail,
  ) => void;
  /** Local-only owner-decision card UI changes (e.g. revise textarea expand). */
  onOwnerDecisionUIChange?: () => void;
  /** Fetch todolist statuses so confirmed/superseded cards disable before click. */
  onOwnerDecisionHydrateStatuses?: (targets: OwnerDecisionHydrationTarget[]) => void;
  /** Re-send the card for the same proposal version. Does not confirm or re-propose. */
  onOwnerDecisionRetry?: (card: OwnerDecisionCardView) => void;
  onOwnerDecisionLoadRecoveries?: () => void;
  onHumanAttentionAct?: (
    action: HumanAttentionAction,
    card: HumanAttentionCardView,
    detail?: HumanAttentionActDetail,
  ) => void;
  /** First-visit password vs QR choice for the Account Computer login page. */
  loginMethodChoice?: LoginMethodChoiceUi | null;
  /** Opt-in “是否保存该网站登录信息” after a typed password fill. */
  loginSaveOffer?: LoginSaveOfferUi | null;
  loginCardBusy?: boolean;
  loginCardError?: string | null;
  onLoginMethodChoose?: (choiceId: string, method: "password" | "qr") => void;
  onLoginSaveDecision?: (saveId: string, save: boolean) => void;
  /** Secure Form + dedicated-Chrome handoff — conversation-inline (not fullscreen). */
  secureFormOffered?: import("../gateway-subscriptions/secure-form.ts").SecureFormOfferedUi | null;
  secureFormHandoff?:
    | import("../gateway-subscriptions/secure-form.ts").SecureFormHandoffActiveUi
    | null;
  secureFormReceipt?: import("../gateway-subscriptions/secure-form.ts").SecureFormReceiptUi | null;
  secureFormValues?: Record<string, string>;
  secureFormBusy?: boolean;
  secureFormError?: string | null;
  onSecureFormFieldInput?: (fieldId: string, value: string) => void;
  onSecureFormSubmit?: () => void;
  onSecureFormClose?: () => void;
  onSecureFormUseComputer?: () => void;
  onSecureFormHandoffReturn?: () => void;
  onSecureFormHandoffDismiss?: () => void;
  currentMentionAgentId?: string | null;
  threadPrelude?: TemplateResult | null;
  /** Content glued under the transcript (after messages, above composer), e.g. steward confirm cards. */
  threadEpilogue?: TemplateResult | null;
  // File attachments
  attachments?: ChatAttachment[];
  /** When false, image attachments show a clear "model does not support vision" hint. */
  imageInputSupported?: boolean;
  onAttachmentsChange?: (attachments: ChatAttachment[]) => void;
  onAttachmentAssetResolve?: (query: {
    fileName: string;
    sizeBytes?: number;
    lastModified?: number;
    allowLatestFallback?: boolean;
  }) => Promise<ChatAttachment | null>;
  onAttachmentAssetUpsert?: (attachment: {
    fileName: string;
    mimeType: string;
    dataUrl: string;
    sizeBytes?: number;
    lastModified?: number;
  }) => Promise<Partial<ChatAttachment> | null>;
  // Scroll control
  showNewMessages?: boolean;
  onScrollToBottom?: () => void;
  // Event handlers
  historyHasMore?: boolean;
  historyLoadingMore?: boolean;
  onLoadOlderHistory?: () => void;
  onRefresh: () => void;
  onToggleFocusMode: () => void;
  onDraftChange: (next: string) => void;
  onSend: () => void;
  /** Interactive Choice 「确认并继续」: submit readable summary as a new user turn. */
  onSubmitChoice?: (text: string) => void;
  /** OGUI Form P0: submit ogui-answer with submissionId → chat.send idempotencyKey. */
  onSubmitForm?: (text: string, meta: { submissionId: string }) => void;
  /** Status slice from chat.history / SessionEntry.oguiDecisions. */
  oguiDecisions?: import("../chat/ogui-form-view.ts").OguiDecisionStatusLookup;
  contextScope?: ChatContextScopeState;
  contextSources?: ChatContextSourceCatalogItem[];
  contextSourcesLoading?: boolean;
  onContextScopeChange?: (next: ChatContextScopeState) => void;
  onLoadContextSources?: () => void;
  contextExpansion?: ChatContextExpansionSuggestion | null;
  onAcceptContextExpansion?: () => void;
  onDismissContextExpansion?: () => void;
  onAbort?: () => void;
  onUndo?: () => void;
  onRequestRestoreCheckpoint?: (checkpointId: string) => void;
  onConfirmRestoreCheckpoint?: (checkpointId: string) => void;
  onCancelRestoreCheckpoint?: () => void;
  onQueueRemove: (id: string) => void;
  onNewSession: () => void;
  onOpenSidebar?: (content: string) => void;
  onCloseSidebar?: () => void;
  onOpenArtifact?: (artifactId: string) => void;
  /** Artifact ids confirmed missing from workspace — chips stay non-openable. */
  unavailableArtifactIds?: readonly string[];
  onOpenArtifactLibrary?: () => void;
  onLoadMessageFeedbackInsights?: (message: unknown) => Promise<unknown>;
  onMessageFeedback?: (
    message: unknown,
    kind: "up" | "down",
    reason?: string,
  ) => void | Promise<void>;
  onMessageCollaborate?: (
    text: string,
    opts: { mode: "draft" | "send"; targetSessionKey?: string; targetLabel?: string },
  ) => Promise<string>;
  onTaskCardStateChange?: () => void;
  onRejectTaskOutcome?: (ref: TaskOutcomeRejectRef) => Promise<TaskOutcomeRejectUiResult>;
  taskOutcomeRejectNotice?: { key: string; text: string } | null;
  onSplitRatioChange?: (ratio: number) => void;
  onChatScroll?: (event: Event) => void;
  onRequestArtifactEditAccess?: (
    artifactId: string,
    targetSessionKey?: string,
  ) => void | Promise<void>;
  onGrantArtifactToTarget?: (artifactId: string, targetSessionKey?: string) => void | Promise<void>;
  onCreateArtifactVersion?: (artifactId: string) => void | Promise<void>;
  onNotifyArtifactVersion?: (
    artifactId: string,
    versionId: string,
    targetSessionKey?: string,
  ) => void | Promise<void>;
  onApproveArtifactAccessRequest?: (intentId: string, artifactId: string) => void | Promise<void>;
  onRejectArtifactAccessRequest?: (intentId: string, artifactId: string) => void | Promise<void>;
  onGrantArtifactAccess?: (intentId: string, artifactId: string) => void | Promise<void>;
  onRevokeArtifactAccess?: (grantId: string, artifactId: string) => void | Promise<void>;
  onSaveDeliverable?: (mode?: "save_as") => void | Promise<void>;
  onConfirmDeliverableOverwrite?: () => void;
  onConfirmDeliverableSaveAs?: () => void;
  onCancelDeliverableSaveDecision?: () => void;
  onDeliverableSaveAsFilenameChange?: (filename: string) => void;
  onDeliverableInlineEditApplied?: (content: string) => void;
  assetIncubationLevel?:
    | import("../controllers/asset-incubation/types.ts").AssetIncubationLevel
    | null;
  assetIncubationReason?: string | null;
  showWeakAssetIncubationHint?: boolean;
  showSystemAssetIncubationHint?: boolean;
  showEnterpriseSubmitFromIncubation?: boolean;
  onOpenSkillSaveFromPreview?: (preferEnterprise?: boolean) => void | Promise<void>;
  onDismissAssetIncubationFromPreview?: () => void;
  onOpenCronTaskDetail?: (jobId: string) => void;
  onOpenCronTaskResult?: (message: unknown) => void;
};

const COMPACTION_TOAST_DURATION_MS = 5000;
const FALLBACK_TOAST_DURATION_MS = 8000;

function adjustTextareaHeight(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

function renderCompactionIndicator(status: CompactionIndicatorStatus | null | undefined) {
  if (!status) {
    return nothing;
  }

  // Show "compacting..." while active
  if (status.active) {
    return html`
      <div class="compaction-indicator compaction-indicator--active" role="status" aria-live="polite">
        ${icons.loader} Compacting context...
      </div>
    `;
  }

  // Show "compaction complete" briefly after completion
  if (status.completedAt) {
    const elapsed = Date.now() - status.completedAt;
    if (elapsed < COMPACTION_TOAST_DURATION_MS) {
      return html`
        <div class="compaction-indicator compaction-indicator--complete" role="status" aria-live="polite">
          ${icons.check} Context compacted
        </div>
      `;
    }
  }

  return nothing;
}

function renderFallbackIndicator(status: FallbackIndicatorStatus | null | undefined) {
  if (!status) {
    return nothing;
  }
  const phase = status.phase ?? "active";
  const elapsed = Date.now() - status.occurredAt;
  if (elapsed >= FALLBACK_TOAST_DURATION_MS) {
    return nothing;
  }
  const details = [
    `Selected: ${status.selected}`,
    phase === "cleared" ? `Active: ${status.selected}` : `Active: ${status.active}`,
    phase === "cleared" && status.previous ? `Previous fallback: ${status.previous}` : null,
    status.reason ? `Reason: ${status.reason}` : null,
    Array.isArray(status.attempts) && status.attempts.length > 0
      ? `Attempts: ${status.attempts.slice(0, 3).join(" | ")}`
      : null,
  ]
    .filter(Boolean)
    .join(" • ");
  const message =
    phase === "cleared"
      ? `Fallback cleared: ${status.selected}`
      : `Fallback active: ${status.active}`;
  const className =
    phase === "cleared"
      ? "compaction-indicator compaction-indicator--fallback-cleared"
      : "compaction-indicator compaction-indicator--fallback";
  const icon = phase === "cleared" ? icons.check : icons.brain;
  return html`
    <div
      class=${className}
      role="status"
      aria-live="polite"
      title=${details}
    >
      ${icon} ${message}
    </div>
  `;
}

function generateAttachmentId(): string {
  return `att-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

const CHAT_IMAGE_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
const CHAT_FILE_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;
let mentionPopupActiveIndex = 0;

function getActiveMentionTrigger(text: string) {
  return findActiveTrigger(text, text.length);
}

function getMentionPopupItems(props: ChatProps, query: string) {
  return deriveMentionPopupItems({
    candidates: props.mentionCandidates ?? [],
    query,
    currentAgentId: props.currentMentionAgentId,
  });
}

function insertMentionSelection(params: {
  textarea: HTMLTextAreaElement;
  props: ChatProps;
  item: MentionPopupItem;
  triggerOffset: number;
}) {
  const cursor = params.textarea.selectionStart ?? params.textarea.value.length;
  const token =
    params.item.type === "all"
      ? params.item.displayName
      : resolveComposerMentionInsertToken(params.item, params.props.mentionCandidates ?? []);
  const { next, nextCursor } = buildMentionInsertion({
    value: params.textarea.value,
    triggerOffset: params.triggerOffset,
    cursor,
    displayName: token,
  });
  mentionPopupActiveIndex = 0;
  params.textarea.value = next;
  params.props.onDraftChange(next);
  adjustTextareaHeight(params.textarea);
  requestAnimationFrame(() => {
    params.textarea.focus();
    params.textarea.setSelectionRange(nextCursor, nextCursor);
  });
}

function handleMentionComposeKeydown(event: KeyboardEvent, props: ChatProps): boolean {
  const textarea = event.currentTarget as HTMLTextAreaElement;
  const cursor = textarea.selectionStart ?? textarea.value.length;
  const trigger = findActiveTrigger(textarea.value, cursor);
  if (!trigger) {
    return false;
  }
  const items = getMentionPopupItems(props, trigger.query);
  if (items.length === 0) {
    return false;
  }
  return handleMentionPopupKeydown({
    event,
    items,
    activeIndex: mentionPopupActiveIndex,
    onActiveIndexChange: (activeIndex) => {
      mentionPopupActiveIndex = activeIndex;
    },
    onSelect: (item) => {
      insertMentionSelection({
        textarea,
        props,
        item,
        triggerOffset: trigger.offset,
      });
    },
    onDismiss: () => {
      mentionPopupActiveIndex = 0;
    },
  });
}

function formatAttachmentBytes(bytes: number): string {
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

function getAttachmentMaxBytes(file: File): number {
  return file.type.startsWith("image/")
    ? CHAT_IMAGE_ATTACHMENT_MAX_BYTES
    : CHAT_FILE_ATTACHMENT_MAX_BYTES;
}

function formatAttachmentReadError(file: File, error: DOMException | null): string {
  const message = error?.message?.trim() ?? "";
  const name = error?.name ?? "";
  if (name === "NotReadableError" || /requested file|could not be read|permission/i.test(message)) {
    return `无法读取“${file.name || "该文件"}”。请确认文件已下载到本机且未被移动、锁定或被其它程序占用；如果来自微信、网盘或 iCloud，请先复制到本地文件夹后再上传。`;
  }
  return message || "无法读取附件，请重新选择文件后再试。";
}

function normalizeAttachmentName(name: string | undefined): string {
  return (name ?? "").trim().toLowerCase();
}

type StoredChatAttachment = {
  assetId: string;
  versionId: string;
  dataUrl: string;
  mimeType: string;
  fileName: string;
  contentHash: string;
  sizeBytes: number;
  lastModified: number;
  createdAt: number;
};

const chatAttachmentAssetsByName = new Map<string, StoredChatAttachment[]>();

function formatDuplicateAttachmentMessage(fileName: string | undefined): string {
  return `本地已缓存“${fileName || "该文件"}”，已引用该副本准备发送（仍需点发送才会交给机器人）。`;
}

function formatDuplicateUnreadableAttachmentMessage(fileName: string | undefined): string {
  return `检测到同名附件“${fileName || "该文件"}”，但当前没有可读取内容。请移除后重新选择本机文件。`;
}

function formatNewVersionAttachmentMessage(
  fileName: string | undefined,
  versionId: string,
): string {
  return `检测到同名文件内容不同，已将“${fileName || "该文件"}”作为新版本 ${versionId} 添加。`;
}

function getAssetVersions(fileName: string | undefined): StoredChatAttachment[] {
  const normalizedName = normalizeAttachmentName(fileName);
  return normalizedName ? (chatAttachmentAssetsByName.get(normalizedName) ?? []) : [];
}

function makeStoredAttachmentVersion(params: {
  fileName: string;
  mimeType: string;
  dataUrl: string;
  contentHash: string;
  sizeBytes: number;
  lastModified: number;
}): StoredChatAttachment {
  const normalizedName = normalizeAttachmentName(params.fileName);
  const existingVersions = getAssetVersions(params.fileName);
  return {
    assetId:
      existingVersions[0]?.assetId ??
      `asset-${normalizedName || "attachment"}-${Date.now().toString(36)}`,
    versionId: `v${existingVersions.length + 1}`,
    dataUrl: params.dataUrl,
    mimeType: params.mimeType,
    fileName: params.fileName,
    contentHash: params.contentHash,
    sizeBytes: params.sizeBytes,
    lastModified: params.lastModified,
    createdAt: Date.now(),
  };
}

function rememberStoredAttachment(stored: StoredChatAttachment): StoredChatAttachment {
  const normalizedName = normalizeAttachmentName(stored.fileName);
  if (!normalizedName) {
    return stored;
  }
  const existingVersions = chatAttachmentAssetsByName.get(normalizedName) ?? [];
  const sameHash = existingVersions.find((item) => item.contentHash === stored.contentHash);
  if (sameHash) {
    return sameHash;
  }
  chatAttachmentAssetsByName.set(normalizedName, [...existingVersions, stored]);
  return stored;
}

function seedStoredAttachmentFromAttachment(att: ChatAttachment) {
  if (!att.dataUrl || !att.fileName) {
    return;
  }
  const contentHash = att.contentHash ?? hashAttachmentDataUrl(att.dataUrl);
  const existingVersions = getAssetVersions(att.fileName);
  if (
    existingVersions.some(
      (item) =>
        item.contentHash === contentHash ||
        item.dataUrl === att.dataUrl ||
        (att.sizeBytes != null &&
          item.sizeBytes === att.sizeBytes &&
          item.lastModified === (att.lastModified ?? 0)),
    )
  ) {
    return;
  }
  rememberStoredAttachment(
    makeStoredAttachmentVersion({
      fileName: att.fileName || "attachment",
      mimeType: att.mimeType || "application/octet-stream",
      dataUrl: att.dataUrl,
      contentHash,
      sizeBytes: att.sizeBytes ?? 0,
      lastModified: att.lastModified ?? 0,
    }),
  );
}

function findStoredAttachmentForFile(
  file: File,
  opts: { allowLatestFallback?: boolean } = {},
): StoredChatAttachment | null {
  const versions = getAssetVersions(file.name);
  return (
    versions.find(
      (item) =>
        item.sizeBytes === file.size &&
        (item.lastModified === file.lastModified || item.lastModified === 0),
    ) ?? (opts.allowLatestFallback ? (versions.at(-1) ?? null) : null)
  );
}

function isStoredChatAttachment(
  attachment: StoredChatAttachment | ChatAttachment,
): attachment is StoredChatAttachment {
  return !("id" in attachment);
}

function createAttachmentFromStored(stored: StoredChatAttachment, notice: string): ChatAttachment {
  return {
    id: generateAttachmentId(),
    dataUrl: stored.dataUrl,
    mimeType: stored.mimeType,
    fileName: stored.fileName,
    assetId: stored.assetId,
    versionId: stored.versionId,
    contentHash: stored.contentHash,
    sizeBytes: stored.sizeBytes,
    lastModified: stored.lastModified,
    status: "ready",
    progress: 100,
    notice,
    error: undefined,
  };
}

function attachmentFromResolvedAsset(att: ChatAttachment, notice: string): ChatAttachment {
  return {
    ...att,
    id: generateAttachmentId(),
    status: "ready",
    progress: 100,
    notice,
    error: undefined,
  };
}

function hashAttachmentDataUrl(dataUrl: string): string {
  let hash = 0;
  for (let i = 0; i < dataUrl.length; i++) {
    hash = (hash * 31 + dataUrl.charCodeAt(i)) >>> 0;
  }
  return `local-${hash.toString(16)}`;
}

function formatUnsupportedAttachmentMessage(file: File): string {
  const name = file.name?.trim() || t("chat.attachmentUnsupportedFallbackName");
  return t("chat.attachmentUnsupported", { name });
}

function buildRejectedAttachments(
  files: File[],
  source?: ChatAttachment["source"],
): ChatAttachment[] {
  return files
    .filter((file) => !isSupportedAttachmentFile(file))
    .map((file) => ({
      id: generateAttachmentId(),
      dataUrl: "",
      mimeType: file.type || "application/octet-stream",
      fileName: file.name?.trim() || undefined,
      sizeBytes: file.size,
      lastModified: file.lastModified,
      status: "failed" as const,
      progress: 100,
      source,
      failureReason: "unsupported" as const,
      error: formatUnsupportedAttachmentMessage(file),
    }));
}

async function appendAttachmentFiles(
  files: FileList | File[],
  props: ChatProps,
  onSettled?: () => void,
  meta?: { source?: ChatAttachment["source"]; notice?: string },
) {
  if (!props.onAttachmentsChange) {
    onSettled?.();
    return;
  }

  const incoming = Array.from(files);
  const supportedFiles = incoming.filter(isSupportedAttachmentFile);
  const rejectedAttachments = buildRejectedAttachments(incoming, meta?.source);
  if (supportedFiles.length === 0) {
    if (rejectedAttachments.length > 0) {
      props.onAttachmentsChange([...(props.attachments ?? []), ...rejectedAttachments]);
    }
    onSettled?.();
    return;
  }

  const currentAttachments = props.attachments ?? [];
  for (const attachment of currentAttachments) {
    seedStoredAttachmentFromAttachment(attachment);
  }
  let existingAttachments = [...currentAttachments];
  const currentByName = new Map<string, ChatAttachment>();
  for (const attachment of existingAttachments) {
    const normalizedName = normalizeAttachmentName(attachment.fileName);
    if (normalizedName) {
      currentByName.set(normalizedName, attachment);
    }
  }
  const nextFiles: File[] = [];
  const reusedAttachments: ChatAttachment[] = [];
  for (const file of supportedFiles) {
    const normalizedName = normalizeAttachmentName(file.name);
    const currentAttachment = normalizedName ? currentByName.get(normalizedName) : undefined;
    if (currentAttachment?.dataUrl) {
      const sameKnownVersion =
        currentAttachment.sizeBytes == null ||
        (currentAttachment.sizeBytes === file.size &&
          (currentAttachment.lastModified === file.lastModified ||
            currentAttachment.lastModified === 0));
      if (sameKnownVersion) {
        existingAttachments = existingAttachments.map((att) =>
          att.id === currentAttachment.id
            ? {
                ...att,
                notice: formatDuplicateAttachmentMessage(att.fileName),
                error: undefined,
              }
            : att,
        );
        continue;
      }
    }
    if (currentAttachment && !currentAttachment.dataUrl) {
      const stored =
        findStoredAttachmentForFile(file, { allowLatestFallback: true }) ??
        (await props.onAttachmentAssetResolve?.({
          fileName: file.name,
          sizeBytes: file.size,
          lastModified: file.lastModified,
          allowLatestFallback: true,
        }));
      if (stored) {
        existingAttachments = existingAttachments.filter((att) => att.id !== currentAttachment.id);
        reusedAttachments.push(
          isStoredChatAttachment(stored)
            ? createAttachmentFromStored(stored, formatDuplicateAttachmentMessage(stored.fileName))
            : attachmentFromResolvedAsset(
                stored,
                formatDuplicateAttachmentMessage(stored.fileName),
              ),
        );
      } else {
        existingAttachments = existingAttachments.map((att) =>
          att.id === currentAttachment.id
            ? {
                ...att,
                status: "failed" as const,
                error: formatDuplicateUnreadableAttachmentMessage(att.fileName),
                notice: undefined,
              }
            : att,
        );
      }
      continue;
    }
    const stored =
      findStoredAttachmentForFile(file) ??
      (await props.onAttachmentAssetResolve?.({
        fileName: file.name,
        sizeBytes: file.size,
        lastModified: file.lastModified,
      }));
    if (stored) {
      reusedAttachments.push(
        isStoredChatAttachment(stored)
          ? createAttachmentFromStored(stored, formatDuplicateAttachmentMessage(stored.fileName))
          : attachmentFromResolvedAsset(stored, formatDuplicateAttachmentMessage(stored.fileName)),
      );
      if (normalizedName) {
        currentByName.set(normalizedName, reusedAttachments[reusedAttachments.length - 1]);
      }
      continue;
    }
    nextFiles.push(file);
  }

  if (nextFiles.length === 0) {
    props.onAttachmentsChange([
      ...existingAttachments,
      ...reusedAttachments,
      ...rejectedAttachments,
    ]);
    onSettled?.();
    return;
  }

  const baseCount = existingAttachments.length + reusedAttachments.length;
  let working: ChatAttachment[] = [
    ...existingAttachments,
    ...reusedAttachments,
    ...nextFiles.map((file) => {
      const maxBytes = getAttachmentMaxBytes(file);
      const oversized = file.size > maxBytes;
      const attachment = {
        id: generateAttachmentId(),
        dataUrl: "",
        mimeType: file.type || "application/octet-stream",
        fileName: file.name || undefined,
        sizeBytes: file.size,
        lastModified: file.lastModified,
        status: oversized ? ("failed" as const) : ("reading" as const),
        progress: oversized ? 100 : 0,
        source: meta?.source,
        notice: meta?.notice,
      };
      return oversized
        ? {
            ...attachment,
            error: `文件过大：${formatAttachmentBytes(file.size)}，上限 ${formatAttachmentBytes(maxBytes)}`,
          }
        : attachment;
    }),
    ...rejectedAttachments,
  ];
  props.onAttachmentsChange(working);

  let pendingReads = 0;
  const finishRead = () => {
    pendingReads -= 1;
    if (pendingReads === 0) {
      onSettled?.();
    }
  };

  nextFiles.forEach((file, index) => {
    const pending = working[baseCount + index];
    if (!pending) {
      return;
    }
    if (pending.status === "failed") {
      return;
    }
    const reader = new FileReader();
    pendingReads += 1;
    reader.addEventListener("progress", (event) => {
      const progress =
        event.lengthComputable && event.total > 0
          ? Math.max(1, Math.min(99, Math.round((event.loaded / event.total) * 100)))
          : 50;
      working = working.map((att) =>
        att.id === pending.id ? { ...att, status: "reading", progress } : att,
      );
      props.onAttachmentsChange?.(working);
    });
    reader.addEventListener("load", () => {
      const dataUrl = reader.result as string;
      void (async () => {
        const contentHash = hashAttachmentDataUrl(dataUrl);
        const versions = getAssetVersions(file.name);
        const sameContent = versions.find((item) => item.contentHash === contentHash);
        let stored = sameContent
          ? sameContent
          : rememberStoredAttachment(
              makeStoredAttachmentVersion({
                fileName: file.name || "attachment",
                mimeType: file.type || "application/octet-stream",
                dataUrl,
                contentHash,
                sizeBytes: file.size,
                lastModified: file.lastModified,
              }),
            );
        const serverAsset = await props
          .onAttachmentAssetUpsert?.({
            fileName: file.name || "attachment",
            mimeType: file.type || "application/octet-stream",
            dataUrl,
            sizeBytes: file.size,
            lastModified: file.lastModified,
          })
          .catch(() => null);
        if (serverAsset?.assetId && serverAsset.versionId) {
          stored = {
            ...stored,
            assetId: serverAsset.assetId,
            versionId: serverAsset.versionId,
            contentHash: serverAsset.contentHash ?? stored.contentHash,
          };
        }
        const notice = sameContent
          ? formatDuplicateAttachmentMessage(stored.fileName)
          : versions.length > 0
            ? formatNewVersionAttachmentMessage(stored.fileName, stored.versionId)
            : undefined;
        working = working.map((att) =>
          att.id === pending.id
            ? {
                ...att,
                dataUrl: stored.dataUrl,
                mimeType: stored.mimeType,
                fileName: stored.fileName,
                assetId: stored.assetId,
                versionId: stored.versionId,
                contentHash: stored.contentHash,
                sizeBytes: stored.sizeBytes,
                lastModified: stored.lastModified,
                status: "ready",
                progress: 100,
                notice: notice ?? att.notice,
                source: att.source,
                error: undefined,
              }
            : att,
        );
        props.onAttachmentsChange?.(working);
        finishRead();
      })();
    });
    reader.addEventListener("error", () => {
      const stored = findStoredAttachmentForFile(file, { allowLatestFallback: true });
      working = working.map((att) =>
        att.id === pending.id
          ? stored
            ? createAttachmentFromStored(stored, formatDuplicateAttachmentMessage(stored.fileName))
            : {
                ...att,
                status: "failed",
                error: formatAttachmentReadError(file, reader.error),
              }
          : att,
      );
      props.onAttachmentsChange?.(working);
      finishRead();
    });
    reader.addEventListener("abort", () => {
      working = working.map((att) =>
        att.id === pending.id
          ? {
              ...att,
              status: "failed",
              error: `读取“${file.name || "该文件"}”已取消，请重新选择文件后再试。`,
            }
          : att,
      );
      props.onAttachmentsChange?.(working);
      finishRead();
    });
    try {
      reader.readAsDataURL(file);
    } catch (error) {
      working = working.map((att) =>
        att.id === pending.id
          ? {
              ...att,
              status: "failed",
              error: formatAttachmentReadError(file, error instanceof DOMException ? error : null),
            }
          : att,
      );
      props.onAttachmentsChange?.(working);
      finishRead();
    }
  });

  if (pendingReads === 0) {
    onSettled?.();
  }
}

function handleAttachmentInputChange(e: Event, props: ChatProps) {
  const target = e.target as HTMLInputElement;
  if (target.files?.length) {
    const files = Array.from(target.files);
    void appendAttachmentFiles(files, props, () => {
      target.value = "";
    });
    return;
  }
  target.value = "";
}

function openAttachmentFilePicker(e: Event) {
  const root = (e.currentTarget as HTMLElement | null)?.closest(".chat-compose");
  const input = root?.querySelector<HTMLInputElement>(".chat-compose__file-input");
  input?.click();
}

function handlePaste(e: ClipboardEvent, props: ChatProps) {
  const clipboard = e.clipboardData;
  if (!clipboard) {
    return;
  }

  const files: File[] = [];
  const rejected: File[] = [];
  const items = clipboard.items;
  if (items && props.onAttachmentsChange) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind !== "file") {
        continue;
      }
      const file = item.getAsFile();
      if (!file || isMarkupClipboardFile(file)) {
        continue;
      }
      if (isSupportedAttachmentFile(file)) {
        files.push(file);
      } else {
        rejected.push(file);
      }
    }
  }

  const pastedText = readClipboardText(clipboard);
  const plan = planComposerPaste({
    files,
    text: pastedText,
  });
  if (plan.kind === "default" || !props.onAttachmentsChange) {
    if (rejected.length > 0 && props.onAttachmentsChange) {
      if (!pastedText.trim()) {
        e.preventDefault();
      }
      void appendAttachmentFiles(rejected, props);
    }
    return;
  }

  e.preventDefault();
  if (plan.kind === "files") {
    void appendAttachmentFiles([...plan.files, ...rejected], props);
    return;
  }

  if (plan.kind === "text-attachment-and-files") {
    void appendAttachmentFiles([...plan.files, ...rejected], props);
  }

  const folded: ChatAttachment = {
    id: generateAttachmentId(),
    dataUrl: encodeTextDataUrl(plan.text),
    mimeType: "text/plain",
    status: "ready",
    progress: 100,
    source: "paste",
    notice: t("chat.pasteAsAttachmentNotice", { count: String(plan.charCount) }),
  };
  const rejectedNow = plan.kind === "text-attachment" ? buildRejectedAttachments(rejected) : [];
  props.onAttachmentsChange?.([...(props.attachments ?? []), folded, ...rejectedNow]);
}

function formatAttachmentStatus(att: ChatAttachment) {
  switch (att.status) {
    case "reading":
      return att.progress != null ? `上传中 ${att.progress}%` : "上传中";
    case "ready":
      return att.notice || att.error || "已添加，待发送";
    case "uploading":
      return "发送中";
    case "sent":
      return "已发送";
    case "failed":
      return att.error || "上传失败";
    default:
      return "";
  }
}

/** Short status for the inline attachment capsule (detail goes in the tooltip). */
function formatAttachmentChipStatus(att: ChatAttachment) {
  switch (att.status) {
    case "reading":
      return att.progress != null ? `${att.progress}%` : "上传中";
    case "ready":
      // Ready is the normal resting state; whether to send is the composer's
      // concern, not the attachment's, so the capsule shows no status text.
      return "";
    case "uploading":
      return "发送中";
    case "sent":
      return "已发送";
    case "failed":
      return "失败";
    default:
      return "";
  }
}

function getAttachmentProgress(att: ChatAttachment) {
  if (att.status === "ready" || att.status === "sent") {
    return 100;
  }
  if (att.status === "failed") {
    return 100;
  }
  if (att.status === "uploading") {
    return 82;
  }
  if (att.status === "reading") {
    return Math.max(1, Math.min(99, att.progress ?? 8));
  }
  return att.dataUrl ? 100 : 0;
}

function renderAttachmentStatusBadge(att: ChatAttachment) {
  const status = att.status ?? (att.dataUrl ? "ready" : undefined);
  if (!status) {
    return nothing;
  }
  const progress = getAttachmentProgress(att);
  const label = formatAttachmentStatus({ ...att, status });
  const tone =
    status === "failed"
      ? "failed"
      : status === "ready" || status === "sent"
        ? "success"
        : "progress";
  return html`
    <span
      class=${`chat-attachment__upload-state chat-attachment__upload-state--${tone}`}
      style=${`--attachment-progress: ${progress * 3.6}deg`}
      title=${label}
      aria-label=${label}
    >
      <span class="chat-attachment__upload-ring" aria-hidden="true"></span>
      <span class="chat-attachment__upload-icon" aria-hidden="true">
        ${tone === "success" ? icons.check : tone === "failed" ? icons.x : ""}
      </span>
      <span class="chat-attachment__upload-text">${label}</span>
    </span>
  `;
}

function restorePastedAttachmentToComposer(att: ChatAttachment, props: ChatProps) {
  const pasted = decodeDataUrlText(att.dataUrl);
  if (pasted == null) {
    return;
  }
  props.onDraftChange(mergeRestoredPasteIntoDraft(props.draft, pasted));
  props.onAttachmentsChange?.((props.attachments ?? []).filter((item) => item.id !== att.id));
}

function renderFoldedPastes(props: ChatProps) {
  const folds = (props.attachments ?? []).filter(
    (att) => att.source === "paste" && att.status !== "failed",
  );
  if (folds.length === 0) {
    return nothing;
  }
  return html`
    <div class="chat-paste-folds">
      ${folds.map((att) => {
        const text = decodeDataUrlText(att.dataUrl) ?? "";
        const preview = foldedPastePreview(text);
        return html`
          <div class="chat-paste-fold" data-testid="chat-paste-fold">
            <div class="chat-paste-fold__row">
              <span class="chat-paste-fold__icon" aria-hidden="true">${icons.fileText}</span>
              <span class="chat-paste-fold__preview" title=${text}>${preview}</span>
              <button
                class="chat-paste-fold__dismiss"
                type="button"
                aria-label=${t("chat.pasteFoldDismiss")}
                @click=${() => {
                  props.onAttachmentsChange?.(
                    (props.attachments ?? []).filter((item) => item.id !== att.id),
                  );
                }}
              >
                ${icons.x}
              </button>
            </div>
            <button
              class="chat-paste-fold__expand"
              type="button"
              @click=${() => restorePastedAttachmentToComposer(att, props)}
            >
              ${t("chat.pasteRestoreToComposer")}
              <span aria-hidden="true">${icons.chevronRight}</span>
            </button>
          </div>
        `;
      })}
    </div>
  `;
}

function renderAttachmentPreview(props: ChatProps) {
  const attachments = (props.attachments ?? []).filter((att) => att.source !== "paste");
  if (attachments.length === 0) {
    return nothing;
  }

  const imageAttachments = attachments.filter((att) => att.mimeType.startsWith("image/"));
  const showUnsupportedHint = props.imageInputSupported === false && imageAttachments.length > 0;

  return html`
    <div class="chat-attachments">
      ${
        showUnsupportedHint
          ? html`<div class="chat-attachments__hint muted" role="status">
            ${t("chat.imageInputUnsupported")}
          </div>`
          : nothing
      }
      ${attachments.map((att) => {
        const isImage = att.mimeType.startsWith("image/") && att.dataUrl;
        return html`
            <div class=${`chat-attachment ${isImage ? "" : "chat-attachment--file"}`}>
              ${
                isImage
                  ? html`
                    <img
                      src=${att.dataUrl}
                      alt=${att.fileName || "Attachment preview"}
                      class="chat-attachment__img"
                    />
                  `
                  : html`
                    <div class="chat-attachment__file" title=${att.fileName || att.mimeType}>
                      ${icons.fileText}
                      <span>${att.fileName || att.mimeType}</span>
                    </div>
                  `
              }
            ${renderAttachmentStatusBadge(att)}
            <button
              class="chat-attachment__remove"
              type="button"
              aria-label="Remove attachment"
              @click=${() => {
                const next = (props.attachments ?? []).filter((a) => a.id !== att.id);
                props.onAttachmentsChange?.(next);
              }}
            >
              ${icons.x}
            </button>
          </div>
        `;
      })}
    </div>
  `;
}

/**
 * Compact, horizontal attachment capsules that sit inline with the knowledge
 * capsule in the compose context row (workbench-compact mode). Unlike the boxy
 * {@link renderAttachmentPreview} tiles, these pills flow within the composer
 * band so they never overlap the content/preview area behind the composer.
 */
function renderAttachmentChips(props: ChatProps) {
  const attachments = (props.attachments ?? []).filter((att) => att.source !== "paste");
  if (attachments.length === 0) {
    return nothing;
  }
  const removeIds = (ids: Set<string>) => {
    props.onAttachmentsChange?.((props.attachments ?? []).filter((a) => !ids.has(a.id)));
  };
  // Failed attachments are never sent (see isSendableAttachment), so give the
  // user a one-click way to clear several of them at once.
  const failedIds = new Set(
    attachments.filter((att) => att.status === "failed").map((att) => att.id),
  );
  const chips = attachments.map((att) => {
    const label = att.fileName || att.mimeType;
    const isImage = att.mimeType.startsWith("image/") && Boolean(att.dataUrl);
    const status = att.status ?? (att.dataUrl ? "ready" : undefined);
    // Short label inside the capsule; the full notice/error stays in the tooltip.
    const statusLabel = status ? formatAttachmentChipStatus({ ...att, status }) : "";
    // Tooltip: keep a real notice/error, but drop the generic "待发送" filler.
    const statusDetail =
      status === "ready"
        ? (att.notice ?? att.error ?? "")
        : status
          ? formatAttachmentStatus({ ...att, status })
          : "";
    const tone =
      status === "failed"
        ? "failed"
        : status === "ready" || status === "sent"
          ? "success"
          : "progress";
    return html`
      <span
        class=${`chat-compose__attachment-chip chat-compose__attachment-chip--${tone}`}
        role="listitem"
        title=${statusDetail ? `${label}\n${statusDetail}` : label}
      >
        ${
          isImage
            ? html`<img
                class="chat-compose__attachment-chip-thumb"
                src=${att.dataUrl}
                alt=${label}
              />`
            : html`<span class="chat-compose__attachment-chip-icon" aria-hidden="true"
                >${icons.fileText}</span
              >`
        }
        <span class="chat-compose__attachment-chip-label">${label}</span>
        ${
          statusLabel
            ? html`<span
                class=${`chat-compose__attachment-chip-status chat-compose__attachment-chip-status--${tone}`}
                >${statusLabel}</span
              >`
            : nothing
        }
        <button
          class="chat-compose__attachment-chip-remove"
          type="button"
          aria-label=${t("chat.attachmentRemove", { name: label })}
          title=${t("chat.attachmentRemove", { name: label })}
          @click=${() => removeIds(new Set([att.id]))}
        >
          ${icons.x}
        </button>
      </span>
    `;
  });
  return html`
    <div
      class="chat-compose__attachment-chips"
      role="list"
      aria-label=${t("chat.attachmentsListLabel", { count: String(attachments.length) })}
    >
      ${chips}
      ${
        failedIds.size > 1
          ? html`<button
              class="chat-compose__attachment-clear-failed"
              type="button"
              @click=${() => removeIds(failedIds)}
            >
              ${t("chat.attachmentClearFailed", { count: String(failedIds.size) })}
            </button>`
          : nothing
      }
    </div>
    ${renderAttachmentFailureNotices(attachments)}
  `;
}

function renderAttachmentFailureNotices(attachments: ChatAttachment[]) {
  // Read and size failures already explain themselves on the chip (tooltip /
  // status). The notice is only for type rejections, which previously vanished.
  const errors = attachments
    .map((att) =>
      att.status === "failed" && att.failureReason === "unsupported" ? att.error?.trim() : "",
    )
    .filter((error): error is string => Boolean(error));
  if (errors.length === 0) {
    return nothing;
  }
  return html`
    <div class="chat-compose__attachment-reject" role="status" aria-live="polite">
      ${errors.map((error) => html`<p class="chat-compose__attachment-reject-line">${error}</p>`)}
    </div>
  `;
}

export function renderChat(props: ChatProps) {
  return html`
    <section class="card chat">
      ${renderChatContent(props, renderChatCompose(props))}
    </section>
  `;
}

function resolveStreamItemIdentity(
  item: ChatItem,
  props: ChatProps,
  opts: {
    assistantIdentity: { name: string; avatar: string | null };
    senderIdentityLookup: ReturnType<typeof buildChatSenderIdentityLookup>;
  },
) {
  const itemRecord = item as {
    senderLabel?: string | null;
    agentId?: string | null;
  };
  const speaker = resolveSpaceStreamSpeaker({
    sessionKey: props.sessionKey,
    chatRunId: props.chatRunId,
    chatStreamSessionKey: props.chatStreamSessionKey,
    senderLabel: itemRecord.senderLabel,
    agentId: itemRecord.agentId,
  });
  return resolveSpaceAwareAssistantIdentity({
    sessionKey: props.sessionKey,
    senderLabel: speaker.senderLabel,
    agentId: speaker.agentId,
    stewardIdentity: opts.assistantIdentity,
    senderIdentityLookup: opts.senderIdentityLookup,
  });
}

function handleConversationPeekClick(event: Event, messageId: string) {
  const target = event.currentTarget;
  const root =
    target instanceof Element
      ? (target.closest(".chat") ?? target.closest(".employee-workbench") ?? document)
      : document;
  void focusChatMessageInView(
    {
      querySelector: (sel) => root.querySelector(sel),
    },
    messageId,
  );
}

type PeekRailObservers = {
  resize: ResizeObserver;
  mutate: MutationObserver;
};

const peekRailObservers = new WeakMap<HTMLElement, PeekRailObservers>();

function visiblePeekStrings(rail: HTMLElement): HTMLElement[] {
  return [...rail.querySelectorAll<HTMLElement>("[data-testid='chat-topic-peek-string']")].filter(
    (item) => {
      const row = item.closest(".chat-topic-peek-item");
      return !(row instanceof HTMLElement && row.hidden);
    },
  );
}

function applyPeekRailFit(rail: HTMLElement) {
  const thread = rail.closest(".chat-thread");
  if (!(thread instanceof HTMLElement)) {
    return;
  }
  rail.style.setProperty("--peek-thread-h", `${Math.max(0, thread.clientHeight)}px`);
  rail.style.setProperty("--peek-top-inset", `${CONVERSATION_PEEK_TOP_INSET_PX}px`);
  rail.style.setProperty("--peek-pad-y", `${CONVERSATION_PEEK_PAD_Y_PX}px`);
  const items = [...rail.querySelectorAll<HTMLElement>(".chat-topic-peek-item")];
  applyConversationPeekVisibility(items, conversationPeekFitLimit(thread.clientHeight));
  for (const item of items) {
    item.setAttribute("aria-hidden", item.hidden ? "true" : "false");
  }
}

function handlePeekRailPointerMove(event: PointerEvent) {
  const rail = event.currentTarget;
  if (!(rail instanceof HTMLElement)) {
    return;
  }
  applyPeekRailFit(rail);
  const strings = visiblePeekStrings(rail);
  let nearest: HTMLElement | null = null;
  let nearestDist = Number.POSITIVE_INFINITY;
  for (const item of strings) {
    const rect = item.getBoundingClientRect();
    const abs = Math.abs(event.clientY - (rect.top + rect.height / 2));
    item.style.setProperty("--peek-len", `${conversationPeekWaveLength(abs)}px`);
    if (abs < nearestDist) {
      nearestDist = abs;
      nearest = item;
    }
  }
  for (const item of strings) {
    item.classList.toggle("is-peak", item === nearest);
  }
}

function handlePeekRailPointerLeave(event: PointerEvent) {
  const rail = event.currentTarget;
  if (!(rail instanceof HTMLElement)) {
    return;
  }
  for (const item of visiblePeekStrings(rail)) {
    item.style.removeProperty("--peek-len");
    item.classList.remove("is-peak");
  }
}

function attachConversationPeekRail(el?: Element) {
  if (!(el instanceof HTMLElement)) {
    return;
  }
  applyPeekRailFit(el);
  requestAnimationFrame(() => applyPeekRailFit(el));
  if (peekRailObservers.has(el)) {
    return;
  }
  const thread = el.closest(".chat-thread");
  if (!(thread instanceof HTMLElement)) {
    return;
  }
  const resize = new ResizeObserver(() => applyPeekRailFit(el));
  resize.observe(thread);
  const mutate = new MutationObserver(() => applyPeekRailFit(el));
  const list = el.querySelector(".chat-topic-peek-strings");
  if (list) {
    mutate.observe(list, { childList: true });
  }
  peekRailObservers.set(el, { resize, mutate });
}

function renderConversationPeekRail(peeks: ConversationPeek[]) {
  if (peeks.length === 0) {
    return nothing;
  }
  return html`
    <nav
      class="chat-topic-peek-rail"
      aria-label=${t("chat.topicPeekRail")}
      data-testid="chat-topic-peek-rail"
      ${ref(attachConversationPeekRail)}
      @pointermove=${handlePeekRailPointerMove}
      @pointerleave=${handlePeekRailPointerLeave}
    >
      <ol class="chat-topic-peek-strings">
        ${peeks.map(
          (peek) => html`
            <li class="chat-topic-peek-item" hidden>
              <button
                type="button"
                class="chat-topic-peek-string"
                data-testid="chat-topic-peek-string"
                data-peek-message-id=${peek.messageId}
                aria-label=${peek.title}
                @click=${(event: Event) => handleConversationPeekClick(event, peek.messageId)}
              >
                <span class="chat-topic-peek-string__line" aria-hidden="true"></span>
                <span class="chat-topic-peek-card" data-testid="chat-topic-peek-card">
                  <span class="chat-topic-peek-card__title">${peek.title}</span>
                  ${
                    peek.preview
                      ? html`<span class="chat-topic-peek-card__preview">${peek.preview}</span>`
                      : nothing
                  }
                </span>
              </button>
            </li>
          `,
        )}
      </ol>
    </nav>
  `;
}

function renderChatThreadItem(
  item: ChatItem | MessageGroup,
  props: ChatProps,
  opts: {
    showReasoning: boolean;
    assistantIdentity: { name: string; avatar: string | null };
    senderIdentityLookup: ReturnType<typeof buildChatSenderIdentityLookup>;
  },
) {
  if (item.kind === "divider") {
    return html`
      <div class="chat-divider" role="separator" data-ts=${String(item.timestamp)}>
        <span class="chat-divider__line"></span>
        <span class="chat-divider__label">${item.label}</span>
        <span class="chat-divider__line"></span>
      </div>
    `;
  }

  if (item.kind === "thinking-progress") {
    return renderThinkingProgressGroup(
      item.progress,
      resolveStreamItemIdentity(item, props, opts),
      { startedAt: props.streamStartedAt, nowMs: props.thinkingNowMs },
      props.sessionKey,
    );
  }

  if (item.kind === "tool-progress") {
    return renderToolProgressGroup(item.texts);
  }

  if (item.kind === "reading-indicator") {
    return renderReadingIndicatorGroup(
      resolveStreamItemIdentity(item, props, opts),
      {
        startedAt: props.streamStartedAt,
        nowMs: props.thinkingNowMs,
      },
      props.sessionKey,
      props.workProgressLabel,
      props.workProgressNarration,
    );
  }

  if (item.kind === "task-card") {
    return renderTaskCard(item.task, props);
  }

  if (item.kind === "conversation-task-progress") {
    return renderConversationTaskInlineProgress(item.entry);
  }

  if (item.kind === "checkpoint") {
    return renderCheckpointDivider(item.checkpoint, props);
  }

  if (item.kind === "artifact-entry") {
    return renderArtifactEntry(item.artifact, props);
  }

  if (item.kind === "stream") {
    return renderStreamingGroup(
      item.text,
      item.startedAt,
      props.onOpenSidebar,
      resolveStreamItemIdentity(item, props, opts),
      props.sessionKey,
      item.replyLanguage ?? props.streamReplyLanguage,
      {
        oguiDecisions: props.oguiDecisions,
        onFillComposer: (text) => props.onDraftChange(text),
        onSubmitChoice: props.onSubmitChoice ? (text) => props.onSubmitChoice?.(text) : undefined,
        onSubmitForm: props.onSubmitForm
          ? (text, meta) => props.onSubmitForm?.(text, meta)
          : undefined,
      },
    );
  }

  if (item.kind === "peer-exchange" || item.kind === "group") {
    const groupOpts: Parameters<typeof renderMessageGroup>[1] = {
      onOpenSidebar: props.onOpenSidebar,
      onOpenArtifact: props.onOpenArtifact,
      unavailableArtifactIds: props.unavailableArtifactIds,
      onRequestArtifactEditAccess: props.onRequestArtifactEditAccess,
      onOpenCronTaskDetail: props.onOpenCronTaskDetail,
      onOpenCronTaskResult: props.onOpenCronTaskResult,
      onFillComposer: (text) => props.onDraftChange(text),
      onSubmitChoice: props.onSubmitChoice ? (text) => props.onSubmitChoice?.(text) : undefined,
      onSubmitForm: props.onSubmitForm
        ? (text, meta) => props.onSubmitForm?.(text, meta)
        : undefined,
      oguiDecisions: props.oguiDecisions,
      onQuoteMessage: props.onQuoteDraftChange
        ? (quote) => props.onQuoteDraftChange?.(quote)
        : undefined,
      showReasoning: opts.showReasoning,
      showToolCards: props.showToolCards,
      assistantName: props.assistantName,
      assistantAvatar: opts.assistantIdentity.avatar,
      localUserDisplayName: props.localUserDisplayName,
      senderIdentityLookup: opts.senderIdentityLookup,
      sessionKey: props.sessionKey,
    };
    if (item.kind === "peer-exchange") {
      return renderPeerExchange(item, groupOpts);
    }
    return renderMessageGroup(item, groupOpts);
  }

  return nothing;
}

function renderLoadEarlierControl(props: ChatProps) {
  if (!props.historyHasMore || !props.onLoadOlderHistory) {
    return nothing;
  }
  return html`
    <div class="chat-history-more">
      <button
        type="button"
        class="btn btn--ghost chat-history-more__btn"
        ?disabled=${Boolean(props.historyLoadingMore)}
        @click=${props.onLoadOlderHistory}
      >
        ${props.historyLoadingMore ? t("chat.loadingEarlier") : t("chat.loadEarlier")}
      </button>
    </div>
  `;
}

export function renderChatContent(
  props: ChatProps,
  compose: TemplateResult | typeof nothing = nothing,
) {
  props = presentChatScopedRunFailure(props);
  const splitRatio = props.splitRatio ?? 0.6;
  const computer = props.computerPreview ?? defaultComputerPreviewModel();
  const computerFullscreen = computer.surface === "computer" && computer.size === "fullscreen";
  const sidebarOpen = Boolean(props.sidebarOpen && props.onCloseSidebar);
  const showSidebar = sidebarOpen || computer.parkFrame;
  const useArtifactPreview =
    props.sidebarPreviewMode === "artifact" || Boolean(props.artifactWorkspace);
  const activeSession = props.sessions?.sessions?.find((row) => row.key === props.sessionKey);
  const reasoningLevel = activeSession?.reasoningLevel ?? "off";
  // Workbench keeps process-channel progress ephemeral and never paints
  // historical thinking into the user-visible log.
  const showReasoning =
    props.renderMode !== "workbench-compact" && props.showThinking && reasoningLevel !== "off";
  const assistantIdentity = {
    name: props.assistantName,
    avatar: props.assistantAvatar ?? props.assistantAvatarUrl ?? null,
  };
  const senderIdentityLookup = buildChatSenderIdentityLookup(props.participantAgents ?? []);
  const artifactSidebarBody = useArtifactPreview
    ? props.artifactWorkspace
      ? renderArtifactSidebar({
          workspace: props.artifactWorkspace,
          collaborationTargets: props.collaborationTargets,
          onRequestEditAccess: props.onRequestArtifactEditAccess,
          onGrantTargetAccess: props.onGrantArtifactToTarget,
          onCreateVersion: props.onCreateArtifactVersion,
          onNotifyVersion: props.onNotifyArtifactVersion,
          onApproveIntent: props.onApproveArtifactAccessRequest,
          onRejectIntent: props.onRejectArtifactAccessRequest,
          onGrantIntent: props.onGrantArtifactAccess,
          onRevokeGrant: props.onRevokeArtifactAccess,
          deliverableSaveState: props.deliverableSaveState,
          onSaveDeliverable: props.onSaveDeliverable,
          onConfirmDeliverableOverwrite: props.onConfirmDeliverableOverwrite,
          onConfirmDeliverableSaveAs: props.onConfirmDeliverableSaveAs,
          onCancelDeliverableSaveDecision: props.onCancelDeliverableSaveDecision,
          onDeliverableSaveAsFilenameChange: props.onDeliverableSaveAsFilenameChange,
          onDeliverableInlineEditApplied: props.onDeliverableInlineEditApplied,
          assetIncubationLevel: props.assetIncubationLevel,
          assetIncubationReason: props.assetIncubationReason,
          showWeakAssetIncubationHint: props.showWeakAssetIncubationHint,
          showSystemAssetIncubationHint: props.showSystemAssetIncubationHint,
          showEnterpriseSubmitFromIncubation: props.showEnterpriseSubmitFromIncubation,
          onOpenSkillSaveFromPreview: props.onOpenSkillSaveFromPreview,
          onDismissAssetIncubationFromPreview: props.onDismissAssetIncubationFromPreview,
        })
      : renderArtifactSidebarEmpty({
          message: props.sidebarContent,
        })
    : null;
  const history = collapseConsecutiveDuplicateUserTurns(
    Array.isArray(props.messages) ? props.messages : [],
  );
  // Keep the rail on the same transcript window as buildChatItems.
  const conversationPeeks = buildConversationPeeks(history.slice(-CHAT_HISTORY_RENDER_LIMIT));
  const thread = html`
    <div
      class=${conversationPeeks.length > 0 ? "chat-thread chat-thread--has-peeks" : "chat-thread"}
      role="log"
      aria-live="polite"
      @scroll=${props.onChatScroll}
    >
      ${renderConversationPeekRail(conversationPeeks)}
      ${renderLoadEarlierControl(props)}
      ${props.threadPrelude ?? nothing}
      ${
        props.loading && history.length === 0 && props.gatewayConnectionPhase !== "unreachable"
          ? html`
              <div
                class="chat-thread-skeleton"
                role="status"
                aria-live="polite"
                aria-label=${t("chat.loading")}
              >
                <div class="chat-thread-skeleton__row chat-thread-skeleton__row--assistant">
                  <div class="chat-thread-skeleton__bubble"></div>
                </div>
                <div class="chat-thread-skeleton__row chat-thread-skeleton__row--user">
                  <div class="chat-thread-skeleton__bubble"></div>
                </div>
                <div class="chat-thread-skeleton__row chat-thread-skeleton__row--assistant">
                  <div class="chat-thread-skeleton__bubble"></div>
                </div>
                <div class="chat-thread-skeleton__row chat-thread-skeleton__row--user">
                  <div class="chat-thread-skeleton__bubble"></div>
                </div>
              </div>
            `
          : nothing
      }
      ${repeat(
        buildChatItems(props),
        (item) => item.key,
        (item) =>
          renderChatThreadItem(item, props, {
            showReasoning,
            assistantIdentity,
            senderIdentityLookup,
          }),
      )}
      ${renderFocusSwitchThreadCard(props)}
      ${renderStewardCallAuthorizationCards(history, {
        busy: props.sending,
        onDecide: props.onStewardCallAuthorizationDecision,
      })}
      ${renderOwnerDecisionCards(history, {
        busy: props.sending,
        onDecide: props.onOwnerDecision,
        onUIChange: props.onOwnerDecisionUIChange,
        onHydrateStatuses: props.onOwnerDecisionHydrateStatuses,
        onRetryDelivery: props.onOwnerDecisionRetry,
        onLoadRecoveries: props.onOwnerDecisionLoadRecoveries,
      })}
      ${renderHumanAttentionCards(history, {
        busy: props.sending,
        onAct: props.onHumanAttentionAct,
      })}
      ${renderAccountComputerLoginThreadCards({
        sessionKey: props.sessionKey,
        choice: props.loginMethodChoice,
        save: props.loginSaveOffer,
        busy: props.loginCardBusy,
        error: props.loginCardError,
        onChoose: props.onLoginMethodChoose,
        onSave: props.onLoginSaveDecision,
      })}
      ${renderSecureFormThreadCards({
        sessionKey: props.sessionKey,
        offered: props.secureFormOffered,
        handoff: props.secureFormHandoff,
        receipt: props.secureFormReceipt,
        values: props.secureFormValues,
        busy: props.secureFormBusy,
        error: props.secureFormError,
        onFieldInput: props.onSecureFormFieldInput,
        onSubmit: props.onSecureFormSubmit,
        onClose: props.onSecureFormClose,
        onUseComputer: props.onSecureFormUseComputer,
        onHandBack: props.onSecureFormHandoffReturn,
        onHandoffDismiss: props.onSecureFormHandoffDismiss,
      })}
      ${props.threadEpilogue ?? nothing}
    </div>
  `;

  const queued = Array.isArray(props.queue) ? props.queue : [];
  return html`
    ${
      props.disabledReason
        ? html`<div
            class="callout"
            role="status"
            data-gateway-connection=${props.gatewayConnectionPhase ?? "blocked"}
          >
            <div>${props.disabledReason}</div>
            ${
              props.gatewayConnectionPhase === "unreachable" && props.onRetryGatewayConnection
                ? html`<button
                    type="button"
                    class="btn btn--sm callout__retry"
                    @click=${props.onRetryGatewayConnection}
                  >
                    ${t("chat.retryConnection")}
                  </button>`
                : nothing
            }
          </div>`
        : nothing
    }

    ${
      props.longTaskIncidentLabel || props.longTaskBoardProgressLine
        ? html`<div
            class="callout"
            role="status"
            data-long-task-incident=${props.longTaskIncidentLabel ? "1" : "0"}
            data-long-task-board-progress=${props.longTaskBoardProgressLine ? "1" : "0"}
          >
            ${
              props.longTaskIncidentLabel
                ? html`<div class="chat-long-task-incident">${props.longTaskIncidentLabel}</div>`
                : nothing
            }
            ${
              props.longTaskBoardProgressLine
                ? html`<div class="chat-long-task-board-progress">${props.longTaskBoardProgressLine}</div>`
                : nothing
            }
          </div>`
        : nothing
    }

    ${
      props.error && !isUnsupportedImageSoftFailure(props.error)
        ? html`<div class="callout danger">${sanitizeUserFacingChatError(props.error)}</div>`
        : nothing
    }

    ${
      props.focusMode
        ? html`
          <button
            class="chat-focus-exit"
            type="button"
            @click=${props.onToggleFocusMode}
            aria-label=${t("chat.exitFocusMode")}
            title=${t("chat.exitFocusMode")}
          >
            ${icons.x}
          </button>
        `
        : nothing
    }

    <div
      class=${computerSplitClasses(sidebarOpen, computer)}
      data-keyboard-target=${computerKeyboardTarget(computer)}
      @keydown=${(event: KeyboardEvent) => {
        if (event.key !== "Escape") {
          return;
        }
        if (computer.surface !== "computer" || computer.size !== "fullscreen") {
          return;
        }
        event.preventDefault();
        props.onComputerSetSize?.(exitComputerFullscreenSize());
      }}
    >
      <div
        class="chat-main"
        style="flex: ${computerMainFlex(sidebarOpen, splitRatio, computer)}"
      >
        ${thread}
        ${computer.showChip ? renderComputerUsingChip(() => props.onComputerChip?.()) : nothing}
        ${compose}
      </div>

      ${
        showSidebar
          ? html`
            ${
              sidebarOpen && !(computer.surface === "computer" && computer.size !== "docked")
                ? html`
                  <resizable-divider
                    .splitRatio=${splitRatio}
                    @resize=${(e: CustomEvent) => props.onSplitRatioChange?.(e.detail.splitRatio)}
                  ></resizable-divider>
                `
                : nothing
            }
            <div class="chat-sidebar ${computer.parkFrame && !sidebarOpen ? "chat-sidebar--parked" : ""}">
              ${renderDeliverableSaveToast(props.deliverableSaveToast)}
              ${renderMarkdownSidebar({
                content: useArtifactPreview ? null : (props.sidebarContent ?? null),
                error: props.sidebarError ?? null,
                bodyContent: artifactSidebarBody,
                omitHeader: computerFullscreen,
                leading: computerFullscreen
                  ? null
                  : renderComputerPreviewTabs(computer, props.onComputerSelectSurface),
                activeSurface: computer.surface,
                computerBody: renderComputerPreviewBody(computer, {
                  onReconnectStream: props.onComputerReconnectStream,
                  onStreamCredentialInvalid: props.onComputerStreamCredentialInvalid,
                }),
                computerHeaderActions: computerFullscreen
                  ? null
                  : renderComputerPreviewHeaderActions(computer, {
                      onSetSize: props.onComputerSetSize,
                      onTakeover: props.onComputerTakeover,
                      onHandBack: props.onComputerHandBack,
                      onOpen: props.onComputerOpen,
                      onEnd: props.onComputerEnd,
                      onNarrowReturn: props.onComputerNarrowReturn,
                    }),
                title:
                  computer.surface === "computer"
                    ? null
                    : useArtifactPreview
                      ? props.artifactWorkspace?.artifact.title?.trim() ||
                        t("chat.artifactPreviewTitle")
                      : t("markdownSidebar.title"),
                titleContent: computerFullscreen
                  ? null
                  : computer.surface === "computer"
                    ? renderComputerOperatorMark(
                        computer,
                        {
                          name: props.assistantName,
                          avatar: props.assistantAvatar ?? props.assistantAvatarUrl ?? null,
                          agentId: props.assistantAgentId,
                        },
                        props.participantAgents,
                      )
                    : null,
                closeLabel:
                  computer.surface === "computer"
                    ? computerFullscreen
                      ? t("chat.computerExitFullscreen")
                      : t("chat.computerClosePreview")
                    : undefined,
                headerActions:
                  useArtifactPreview && props.artifactWorkspace
                    ? renderArtifactSidebarHeaderActions({
                        workspace: props.artifactWorkspace,
                        collaborationTargets: props.collaborationTargets,
                        onRequestEditAccess: props.onRequestArtifactEditAccess,
                        onGrantTargetAccess: props.onGrantArtifactToTarget,
                        onCreateVersion: props.onCreateArtifactVersion,
                        onNotifyVersion: props.onNotifyArtifactVersion,
                        onApproveIntent: props.onApproveArtifactAccessRequest,
                        onRejectIntent: props.onRejectArtifactAccessRequest,
                        onGrantIntent: props.onGrantArtifactAccess,
                        onRevokeGrant: props.onRevokeArtifactAccess,
                        deliverableSaveState: props.deliverableSaveState,
                        onSaveDeliverable: props.onSaveDeliverable,
                        onDeliverableInlineEditApplied: props.onDeliverableInlineEditApplied,
                      })
                    : null,
                onClose: () => {
                  if (computerFullscreen) {
                    props.onComputerSetSize?.(exitComputerFullscreenSize());
                    return;
                  }
                  props.onCloseSidebar?.();
                },
                onViewRawText: () => {
                  if (!props.sidebarContent || !props.onOpenSidebar) {
                    return;
                  }
                  props.onOpenSidebar(`\`\`\`\n${props.sidebarContent}\n\`\`\``);
                },
              })}
            </div>
          `
          : nothing
      }
    </div>

    ${
      queued.length
        ? html`
          <div class="chat-queue" role="status" aria-live="polite">
            <div class="chat-queue__title">${t("chat.queued", { count: String(queued.length) })}</div>
            <div class="chat-queue__list">
              ${queued.map(
                (item) => html`
                  <div class="chat-queue__item">
                    <div class="chat-queue__text">
                      ${
                        item.text ||
                        (item.attachments?.length
                          ? t("chat.queuedImage", { count: String(item.attachments.length) })
                          : "")
                      }
                    </div>
                    <button
                      class="btn chat-queue__remove"
                      type="button"
                      aria-label=${t("chat.removeQueued")}
                      @click=${() => props.onQueueRemove(item.id)}
                    >
                      ${icons.x}
                    </button>
                  </div>
                `,
              )}
            </div>
          </div>
        `
        : nothing
    }

    ${renderFallbackIndicator(props.fallbackStatus)}
    ${renderCompactionIndicator(props.compactionStatus)}

    ${
      props.showNewMessages
        ? html`
          <button
            class="btn chat-new-messages"
            type="button"
            @click=${props.onScrollToBottom}
          >
            ${t("chat.newMessages")} ${icons.arrowDown}
          </button>
        `
        : nothing
    }
  `;
}

function renderQuoteChip(props: ChatProps) {
  const quote = props.quoteDraft;
  if (!quote?.excerpt) {
    return nothing;
  }
  return html`
    <div class="chat-quote-chip" role="note" aria-label=${t("chat.quoteChipAria")}>
      <span class="chat-quote-chip__label">${t("chat.quote")}</span>
      <span class="chat-quote-chip__excerpt">${quote.excerpt}</span>
      <button
        class="chat-quote-chip__clear"
        type="button"
        aria-label=${t("chat.quoteClear")}
        @click=${() => props.onQuoteDraftChange?.(null)}
      >
        ${icons.x}
      </button>
    </div>
  `;
}

function renderFocusSwitchThreadCard(_props: ChatProps) {
  // Task switches are a status line in the transcript, not a blocking three-way card.
  return nothing;
}

export function renderChatCompose(props: ChatProps) {
  const canCompose = props.connected;
  const isBusy = props.sending || props.stream !== null;
  const canAbort = Boolean(props.canAbort && props.onAbort);
  const fileAttachments = (props.attachments ?? []).filter((att) => att.source !== "paste");
  const hasAttachments = fileAttachments.length > 0;
  const attachmentsBusy = (props.attachments ?? []).some((att) => att.status === "reading");
  const compactWorkbenchMode = props.renderMode === "workbench-compact";
  const composePlaceholder = props.connected
    ? hasAttachments
      ? t("chat.composePlaceholderWithAttachments")
      : t("chat.composePlaceholder")
    : props.gatewayConnectionPhase === "connecting"
      ? t("chat.connecting")
      : props.gatewayConnectionPhase === "reconnecting"
        ? t("chat.reconnecting")
        : props.gatewayConnectionPhase === "unreachable"
          ? t("chat.gatewayUnreachable")
          : t("chat.connectToStart");
  const mentionTrigger = getActiveMentionTrigger(props.draft);
  const showMentionPopup = Boolean(
    props.connected &&
    mentionTrigger &&
    (props.mentionCandidates?.length ?? 0) > 0 &&
    getMentionPopupItems(props, mentionTrigger.query).length > 0,
  );
  let composeTextarea: HTMLTextAreaElement | null = null;

  // In compact workbench mode, attachments render as horizontal capsules inline
  // with the knowledge capsule instead of a floating boxy card that overlaps the
  // content preview behind the composer.
  const attachmentChips = compactWorkbenchMode ? renderAttachmentChips(props) : nothing;
  const contextPicker = props.hideContextScope
    ? nothing
    : renderChatContextScopePicker({
        sessionKey: props.sessionKey,
        connected: props.connected,
        contextScope: props.contextScope,
        contextSources: props.contextSources,
        contextSourcesLoading: props.contextSourcesLoading,
        onContextScopeChange: props.onContextScopeChange,
        onLoadContextSources: props.onLoadContextSources,
        trailingChips: attachmentChips,
      });
  // The context picker only renders when scope editing is available. Whenever it
  // is absent, the attachment capsules still need a home, so render them in a
  // standalone tabs-style row that keeps the same left alignment and band.
  const contextScopeVisible = !props.hideContextScope && Boolean(props.onContextScopeChange);
  const standaloneAttachmentChips =
    compactWorkbenchMode && hasAttachments && !contextScopeVisible
      ? html`<div class="chat-compose__context-tabs chat-compose__context-tabs--standalone">
          ${attachmentChips}
        </div>`
      : nothing;
  const expansionBanner = props.hideContextScope
    ? nothing
    : renderChatContextExpansionBanner({
        expansion: props.contextExpansion,
        onAccept: props.onAcceptContextExpansion,
        onDismiss: props.onDismissContextExpansion,
      });
  const composeRow = html`
      <div class="chat-compose__row">
        ${
          compactWorkbenchMode
            ? html`
              <div class="chat-compose__toolbar chat-compose__toolbar--leading">
                <input
                  class="chat-compose__file-input"
                  type="file"
                  accept=${CHAT_ATTACHMENT_ACCEPT}
                  multiple
                  ?disabled=${!props.connected}
                  @change=${(e: Event) => handleAttachmentInputChange(e, props)}
                />
                <button
                  class="btn btn--icon chat-compose__icon-btn"
                  type="button"
                  ?disabled=${!props.connected}
                  aria-label=${t("chat.attachFiles")}
                  title=${t("chat.attachFiles")}
                  @click=${openAttachmentFilePicker}
                >
                  ${icons.paperclip}
                </button>
              </div>
            `
            : nothing
        }
        <label class="field chat-compose__field">
          <span class="chat-compose__field-label">${t("chat.messageLabel")}</span>
          ${renderFoldedPastes(props)}
          <textarea
            rows="1"
            ${ref((el) => {
              composeTextarea = (el as HTMLTextAreaElement | null) ?? null;
              if (composeTextarea) {
                adjustTextareaHeight(composeTextarea);
              }
            })}
            .value=${props.draft}
            dir=${detectTextDirection(props.draft)}
            ?disabled=${!props.connected}
            @keydown=${(e: KeyboardEvent) => {
              if (handleMentionComposeKeydown(e, props)) {
                return;
              }
              if (e.key !== "Enter") {
                return;
              }
              if (e.isComposing || e.keyCode === 229) {
                return;
              }
              if (e.shiftKey) {
                return;
              }
              if (!props.connected) {
                return;
              }
              e.preventDefault();
              if (canCompose) {
                props.onSend();
              }
            }}
            @input=${(e: Event) => {
              const target = e.target as HTMLTextAreaElement;
              adjustTextareaHeight(target);
              mentionPopupActiveIndex = 0;
              props.onDraftChange(target.value);
            }}
            @paste=${(e: ClipboardEvent) => handlePaste(e, props)}
            placeholder=${composePlaceholder}
          ></textarea>
          ${
            showMentionPopup && mentionTrigger
              ? renderMentionPopup({
                  id: "chat-mention-popup",
                  open: true,
                  query: mentionTrigger.query,
                  candidates: props.mentionCandidates ?? [],
                  currentAgentId: props.currentMentionAgentId,
                  caretPosition: { top: 0, left: 0 },
                  activeIndex: mentionPopupActiveIndex,
                  onActiveIndexChange: (activeIndex) => {
                    mentionPopupActiveIndex = activeIndex;
                  },
                  onSelect: (item) => {
                    if (!composeTextarea) {
                      return;
                    }
                    insertMentionSelection({
                      textarea: composeTextarea,
                      props,
                      item,
                      triggerOffset: mentionTrigger.offset,
                    });
                  },
                  onDismiss: () => {
                    mentionPopupActiveIndex = 0;
                  },
                })
              : nothing
          }
        </label>
        ${
          compactWorkbenchMode
            ? html`
              <div class="chat-compose__toolbar chat-compose__toolbar--trailing">
                <button
                  class="btn btn--icon chat-compose__icon-btn"
                  type="button"
                  ?disabled=${!props.connected || canAbort}
                  aria-label="Voice"
                  title="Voice"
                >
                  ${icons.mic}
                </button>
                <button
                  class="btn primary chat-compose__send-btn ${
                    canAbort ? "chat-compose__send-btn--stop" : ""
                  }"
                  type="button"
                  ?disabled=${!props.connected || (!canAbort && attachmentsBusy)}
                  aria-label=${
                    canAbort ? t("chat.stop") : isBusy ? t("chat.queue") : t("chat.send")
                  }
                  title=${canAbort ? t("chat.stop") : isBusy ? t("chat.queue") : t("chat.send")}
                  @click=${canAbort ? props.onAbort : props.onSend}
                >
                  ${canAbort ? icons.stopSquare : icons.arrowDown}
                </button>
              </div>
            `
            : html`
              <div class="chat-compose__actions">
                <button
                  class="btn"
                  ?disabled=${!props.connected || (!canAbort && props.sending)}
                  @click=${canAbort ? props.onAbort : props.onNewSession}
                >
                  ${canAbort ? t("chat.stop") : t("chat.newSession")}
                </button>
                <button
                  class="btn primary"
                  ?disabled=${!props.connected || attachmentsBusy}
                  @click=${props.onSend}
                >
                  ${isBusy ? t("chat.queue") : t("chat.send")}<kbd class="btn-kbd">↵</kbd>
                </button>
              </div>
            `
        }
      </div>
  `;
  const composeHint = props.composeHint?.trim()
    ? html`<p class="chat-compose__mention-hint" data-testid="collaboration-mention-hint">
          ${props.composeHint.trim()}
        </p>`
    : nothing;
  const composeStack = html`
    ${contextPicker}
    ${standaloneAttachmentChips}
    ${expansionBanner}
    ${composeHint}
    ${renderQuoteChip(props)}
    ${composeRow}
  `;

  return html`
    <div class="chat-compose ${compactWorkbenchMode ? "chat-compose--workbench-compact" : ""}">
      ${compactWorkbenchMode ? nothing : renderAttachmentPreview(props)}
      ${
        compactWorkbenchMode
          ? html`
            <div class="chat-compose__shell chat-compose__shell--compact">
              ${composeStack}
            </div>
          `
          : composeStack
      }
    </div>
  `;
}

function groupMessages(items: ChatItem[]): Array<ChatItem | MessageGroup> {
  const result: Array<ChatItem | MessageGroup> = [];
  let currentGroup: MessageGroup | null = null;

  for (const item of items) {
    if (item.kind !== "message") {
      if (currentGroup) {
        result.push(currentGroup);
        currentGroup = null;
      }
      result.push(item);
      continue;
    }

    const normalized = normalizeMessage(item.message);
    const role = normalizeRoleForGrouping(normalized.role);
    const lowerRole = role.toLowerCase();
    const peerLabels =
      lowerRole === "peer"
        ? [normalized.senderLabel?.trim() || "数字人"]
        : lowerRole === "peer-out"
          ? (normalized.sentTo ?? []).map((target) => target.label)
          : undefined;
    const peerKey = peerLabels ? [...peerLabels].toSorted().join("\0") : "";
    const senderLabel =
      lowerRole === "peer-out"
        ? (peerLabels?.[0] ?? null)
        : lowerRole === "user" || lowerRole === "assistant" || lowerRole === "peer"
          ? (normalized.senderLabel ?? null)
          : null;
    const agentId = lowerRole === "assistant" ? (normalized.agentId ?? null) : null;
    const timestamp = normalized.timestamp || Date.now();

    if (
      !currentGroup ||
      currentGroup.role !== role ||
      ((lowerRole === "user" || lowerRole === "assistant" || lowerRole === "peer") &&
        currentGroup.senderLabel !== senderLabel) ||
      (lowerRole === "peer-out" && currentGroup.peerKey !== peerKey) ||
      (lowerRole === "assistant" && currentGroup.agentId !== agentId)
    ) {
      if (currentGroup) {
        result.push(currentGroup);
      }
      currentGroup = {
        kind: "group",
        key: `group:${role}:${item.key}`,
        role,
        senderLabel,
        agentId,
        ...(peerLabels ? { peerLabels, peerKey } : {}),
        messages: [{ message: item.message, key: item.key }],
        timestamp,
        isStreaming: false,
      };
    } else {
      currentGroup.messages.push({ message: item.message, key: item.key });
    }
  }

  if (currentGroup) {
    result.push(currentGroup);
  }
  return result;
}

/** Re-export placement helpers (shared with diagnostics). */
export {
  getMessageIdForCheckpoint,
  resolveCheckpointPlaceBeforeUserIndex,
  checkpointBoundaryCanTruncate,
} from "../chat/checkpoint-placement.ts";

/**
 * If the requested checkpoint is already at the transcript tip (restore would
 * be a no-op), retarget to the checkpoint that actually undoes the latest user
 * turn. Guards against a divider that was wrongly bound after a later restore.
 */
export function resolveEffectiveChatRestoreCheckpointId(
  checkpoints: ChatCheckpoint[],
  messages: unknown[],
  requestedCheckpointId: string,
): string {
  const history = Array.isArray(messages) ? messages : [];
  const requested = checkpoints.find((cp) => cp.checkpointId === requestedCheckpointId);
  if (requested && checkpointBoundaryCanTruncate(history, requested.boundaryMessageId)) {
    return requestedCheckpointId;
  }

  let latestUserIndex = -1;
  for (let i = history.length - 1; i >= 0; i--) {
    if (normalizeMessage(history[i]).role.toLowerCase() === "user") {
      latestUserIndex = i;
      break;
    }
  }
  if (latestUserIndex < 0) {
    return requestedCheckpointId;
  }

  let best: ChatCheckpoint | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const cp of checkpoints) {
    if (!checkpointBoundaryCanTruncate(history, cp.boundaryMessageId)) {
      continue;
    }
    const placeBefore = resolveCheckpointPlaceBeforeUserIndex(history, cp.boundaryMessageId!);
    if (placeBefore !== latestUserIndex) {
      continue;
    }
    const boundaryIndex = history.findIndex(
      (msg) => getMessageIdForCheckpoint(msg) === cp.boundaryMessageId,
    );
    const distance = latestUserIndex - boundaryIndex;
    if (
      !best ||
      distance < bestDistance ||
      (distance === bestDistance && cp.createdAt.localeCompare(best.createdAt) >= 0)
    ) {
      best = cp;
      bestDistance = distance;
    }
  }
  return best?.checkpointId ?? requestedCheckpointId;
}

function appendConversationTaskProgressAfterUser(
  message: unknown,
  props: ChatProps,
  items: ChatItem[],
  usedEntryIds: Set<string>,
) {
  const entries = props.conversationTaskProgressEntries ?? [];
  if (entries.length === 0) {
    return;
  }
  const messageId = getMessageIdForCheckpoint(message) ?? "";
  const userText = extractText(message)?.trim() ?? "";
  for (const entry of entries) {
    if (usedEntryIds.has(entry.taskId)) {
      continue;
    }
    if (!matchConversationTaskProgressEntry(entry, { messageId, userText })) {
      continue;
    }
    usedEntryIds.add(entry.taskId);
    items.push({
      kind: "conversation-task-progress",
      key: `conversation-task-progress:${entry.taskId}`,
      entry,
    });
    break;
  }
}

function buildChatItems(props: ChatProps): Array<ChatItem | MessageGroup> {
  const items: ChatItem[] = [];
  const taskItems = new Map<string, ChatItem & { kind: "task-card" }>();
  const usedConversationTaskProgressIds = new Set<string>();
  const checkpoints = props.checkpoints ?? [];
  const placedCheckpointIds = new Set<string>();
  const placement = projectCheckpointPlacements(checkpoints, props.messages ?? []);
  const history = placement.history;
  const showToolMessages = props.showToolMessages === true;
  const tools = showToolMessages && Array.isArray(props.toolMessages) ? props.toolMessages : [];
  const historyStart = 0;
  const checkpointBeforeRawIndex = placement.beforeUserIndex;
  let pendingCheckpoints: ChatCheckpoint[] = [];
  for (const [rawIndex, cp] of checkpointBeforeRawIndex) {
    if (rawIndex < historyStart) {
      pendingCheckpoints.push(cp);
    }
  }
  const flushPendingCheckpoints = () => {
    if (pendingCheckpoints.length === 0) {
      return;
    }
    for (const cp of pendingCheckpoints) {
      if (placedCheckpointIds.has(cp.checkpointId)) {
        continue;
      }
      placedCheckpointIds.add(cp.checkpointId);
      items.push({ kind: "checkpoint", key: `checkpoint:${cp.checkpointId}`, checkpoint: cp });
    }
    pendingCheckpoints = [];
  };
  const queueCheckpointBeforeIndex = (rawIndex: number) => {
    const cp = checkpointBeforeRawIndex.get(rawIndex);
    if (!cp || placedCheckpointIds.has(cp.checkpointId)) {
      return;
    }
    pendingCheckpoints.push(cp);
  };
  const pendingToolNarrations: string[] = [];
  /** Drop engineering / DOM debug lines from mid-run process channel. */
  const isUserFacingProcessLine = (line: string): boolean => {
    const trimmed = line.trim();
    if (!trimmed) {
      return false;
    }
    if (/DOM|querySelector|xpath|css\s*selector|data-testid/i.test(trimmed)) {
      return false;
    }
    if (/DOM\s*结构|没有直接暴露|抓链|调试/.test(trimmed)) {
      return false;
    }
    return true;
  };
  /**
   * Process channel is ephemeral UX while tools run.
   * Once a formal assistant (or any following timeline) message exists for the
   * turn, discard pending narrations — do not keep 「▶ 过程」 in the main chat.
   * keep=true only when history still ends mid-tooling (no formal text yet).
   */
  const flushToolNarrations = (opts?: { keep?: boolean }) => {
    if (pendingToolNarrations.length === 0) {
      return;
    }
    const texts = pendingToolNarrations.splice(0, pendingToolNarrations.length);
    if (!opts?.keep) {
      return;
    }
    const visible = texts.map((text) => text.trim()).filter(isUserFacingProcessLine);
    if (visible.length === 0) {
      return;
    }
    items.push({
      kind: "tool-progress",
      key: `tool-progress:${props.sessionKey}:${items.length}`,
      texts: visible,
    });
  };
  for (let i = historyStart; i < history.length; i++) {
    // Queue Restore dividers that belong immediately before this history row.
    queueCheckpointBeforeIndex(i);
    const msg = history[i];
    if (readStewardCallAuthorization(msg) || readOwnerDecision(msg)) {
      flushPendingCheckpoints();
      continue;
    }
    const event = parseChatEvent(msg);
    if (event?.type === "task_update") {
      const existing = taskItems.get(event.task.id);
      if (existing) {
        existing.task = event.task;
      } else {
        const item: ChatItem & { kind: "task-card" } = {
          kind: "task-card",
          key: `task:${event.task.id}`,
          task: event.task,
        };
        taskItems.set(event.task.id, item);
        flushPendingCheckpoints();
        items.push(item);
      }
      continue;
    }
    if (event?.type === "artifact") {
      if (shouldRenderArtifactEntry(event.artifact)) {
        flushPendingCheckpoints();
        items.push({
          kind: "artifact-entry",
          key: `artifact:${event.artifact.id}`,
          artifact: event.artifact,
        });
      }
      continue;
    }
    if (event?.type === "message") {
      flushPendingCheckpoints();
      items.push({
        kind: "message",
        key: `event-message:${i}`,
        message: {
          role: event.role,
          content: [{ type: "text", text: event.content }],
          timestamp: Date.now(),
        },
      });
      continue;
    }

    const normalized = normalizeMessage(msg);
    const raw = msg as Record<string, unknown>;
    if (shouldHideCollaborationAssistantMessage(raw) || isDaibaiGuideTranscriptMessage(raw)) {
      // Guide cards render in the 大白 prelude, hydrated from this same history.
      flushPendingCheckpoints();
      continue;
    }
    const messageLanguage =
      raw.replyLanguage === "zh" || raw.replyLanguage === "en" ? raw.replyLanguage : null;
    if (isToolUseProgressMessage(raw)) {
      const narration = toolUseProgressNarration(raw, messageLanguage);
      if (narration) {
        pendingToolNarrations.push(narration);
      }
      flushPendingCheckpoints();
      continue;
    }
    flushToolNarrations();
    if (isHiddenToolUseScratchpadMessage(raw, messageLanguage)) {
      flushPendingCheckpoints();
      continue;
    }
    const marker = getChatMarker(raw);
    if (marker && marker.kind === "compaction") {
      flushPendingCheckpoints();
      items.push({
        kind: "divider",
        key:
          typeof marker.id === "string"
            ? `divider:compaction:${marker.id}`
            : `divider:compaction:${normalized.timestamp}:${i}`,
        label: "Compaction",
        timestamp: normalized.timestamp ?? Date.now(),
      });
      continue;
    }

    const normalizedRole = normalized.role.toLowerCase();
    if (
      !showToolMessages &&
      (normalizedRole === "toolresult" || normalizedRole === "tool" || hasToolOnlyContent(raw))
    ) {
      flushPendingCheckpoints();
      continue;
    }

    if (!props.showThinking && normalizedRole === "toolresult") {
      flushPendingCheckpoints();
      continue;
    }

    flushPendingCheckpoints();
    items.push({
      kind: "message",
      key: messageKey(msg, i),
      message: msg,
    });
    if (normalizedRole === "user") {
      appendConversationTaskProgressAfterUser(msg, props, items, usedConversationTaskProgressIds);
    }
  }
  flushPendingCheckpoints();
  // Mid-run only: show process while tools are still open and no formal stream yet.
  const liveFormalText = typeof props.stream === "string" && props.stream.trim().length > 0;
  flushToolNarrations({ keep: !liveFormalText });

  // Interleave stream segments and tool cards in order. Each segment
  // contains text that was streaming before the corresponding tool started.
  // This ensures correct visual ordering: text → tool → text → tool → ...
  const segments = props.streamSegments ?? [];
  const streamSpeaker = resolveSpaceStreamSpeaker({
    sessionKey: props.sessionKey,
    chatRunId: props.chatRunId,
    chatStreamSessionKey: props.chatStreamSessionKey,
  });
  const maxLen = Math.max(segments.length, tools.length);
  for (let i = 0; i < maxLen; i++) {
    if (i < segments.length && segments[i].text.trim().length > 0) {
      items.push({
        kind: "stream" as const,
        key: `stream-seg:${props.sessionKey}:${i}`,
        text: segments[i].text,
        startedAt: segments[i].ts,
        senderLabel: streamSpeaker.senderLabel,
        agentId: streamSpeaker.agentId,
        replyLanguage: segments[i].replyLanguage ?? props.streamReplyLanguage,
      });
    }
    if (i < tools.length) {
      items.push({
        kind: "message",
        key: messageKey(tools[i], i + history.length),
        message: tools[i],
      });
    }
  }

  let showedWorkProgress = false;
  if (props.stream !== null) {
    const key = `stream:${props.sessionKey}:${props.streamStartedAt ?? "live"}`;
    if (props.stream.trim().length > 0) {
      items.push({
        kind: "stream",
        key,
        text: props.stream,
        startedAt: props.streamStartedAt ?? Date.now(),
        senderLabel: streamSpeaker.senderLabel,
        agentId: streamSpeaker.agentId,
        replyLanguage: props.streamReplyLanguage,
      });
      showedWorkProgress = false;
    } else if (props.showThinking && props.thinkingProgress) {
      items.push({
        kind: "thinking-progress",
        key,
        progress: props.thinkingProgress,
        senderLabel: streamSpeaker.senderLabel,
        agentId: streamSpeaker.agentId,
      });
      // FT-DEDUPE-THINKING-PROGRESS-UI: thinking-progress already fills the
      // empty-body progress slot — do not also paint work-progress 「正在思考」.
      showedWorkProgress = true;
    } else {
      items.push({
        kind: "reading-indicator",
        key,
        senderLabel: streamSpeaker.senderLabel,
        agentId: streamSpeaker.agentId,
      });
      showedWorkProgress = true;
    }
  }
  // Tool calls clear the stream slot. Keep the same reading indicator so the
  // phase stays on the chat the user is watching.
  if (props.workProgressLabel?.trim() && !showedWorkProgress) {
    items.push({
      kind: "reading-indicator",
      key: `work-progress:${props.sessionKey}`,
      senderLabel: streamSpeaker.senderLabel,
      agentId: streamSpeaker.agentId,
    });
  }

  return foldPeerExchangeThread(groupMessages(items));
}

function parseChatEvent(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record.type === "task_update") {
    // FT-RESULT-CARD-UX: do not project tip-backed 「任务结果」 cards into ordinary chat UI
    // (live or history). Generic progress task_update cards without that title still render.
    const taskRecord =
      record.task && typeof record.task === "object" && !Array.isArray(record.task)
        ? (record.task as Record<string, unknown>)
        : null;
    const closedLoopTitle = typeof taskRecord?.title === "string" ? taskRecord.title.trim() : "";
    if (closedLoopTitle === "任务结果") {
      return null;
    }
    const task = parseTaskCard(record.task);
    return task ? { type: "task_update" as const, task } : null;
  }
  if (record.type === "artifact") {
    const artifact = parseChatArtifact(record.artifact);
    return artifact ? { type: "artifact" as const, artifact } : null;
  }
  if (record.type === "message") {
    const role = record.role === "user" ? "user" : record.role === "assistant" ? "assistant" : null;
    const content = typeof record.content === "string" ? record.content : "";
    return role && content.trim() ? { type: "message" as const, role, content } : null;
  }
  return null;
}

function parseTaskCard(value: unknown): TaskCard | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const task = value as Record<string, unknown>;
  const id = stringField(task.id);
  const title = stringField(task.title);
  const stepName = stringField(task.step_name);
  const status = parseTaskStatus(task.status);
  const stepCurrent = numberField(task.step_current);
  const stepTotal = numberField(task.step_total);
  if (!id || !title || !stepName || !status || stepCurrent == null || stepTotal == null) {
    return null;
  }
  return {
    id,
    title,
    step_current: Math.max(1, Math.round(stepCurrent)),
    step_total: Math.max(1, Math.round(stepTotal)),
    step_name: stepName,
    status,
    ...(numberField(task.progress) != null
      ? { progress: Math.max(0, Math.min(100, Math.round(numberField(task.progress)!))) }
      : {}),
    ...(numberField(task.elapsed_time) != null
      ? { elapsed_time: Math.max(0, Math.round(numberField(task.elapsed_time)!)) }
      : {}),
    ...(stringField(task.estimated_time)
      ? { estimated_time: stringField(task.estimated_time)! }
      : {}),
    ...(stringField(task.message) ? { message: stringField(task.message)! } : {}),
    ...(() => {
      const outcomeReject = readTaskOutcomeRejectRef(task);
      return outcomeReject ? { outcomeReject } : {};
    })(),
  };
}

function parseChatArtifact(value: unknown): ChatArtifact | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const artifact = value as Record<string, unknown>;
  const id = stringField(artifact.id);
  const artifactType = parseArtifactType(artifact.artifact_type);
  const title = stringField(artifact.title);
  const content = stringField(artifact.content);
  const context = parseArtifactContext(artifact.context);
  if (!id || !artifactType || !title || !content || !context) {
    return null;
  }
  return {
    id,
    artifact_type: artifactType,
    title,
    content,
    preview: artifact.preview === true,
    ...(artifact.preview_required === true ? { preview_required: true } : {}),
    context,
  };
}

function parseArtifactContext(value: unknown): ChatArtifact["context"] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const context = value as Record<string, unknown>;
  const taskId = stringField(context.task_id);
  const stepName = stringField(context.step_name);
  const purpose = stringField(context.purpose);
  const nextAction = stringField(context.next_action);
  const stepIndex = numberField(context.step_index);
  if (!taskId || !stepName || !purpose || !nextAction || stepIndex == null) {
    return null;
  }
  return {
    task_id: taskId,
    step_index: Math.max(1, Math.round(stepIndex)),
    step_name: stepName,
    purpose,
    next_action: nextAction,
  };
}

function parseTaskStatus(value: unknown): TaskCard["status"] | null {
  return value === "running" ||
    value === "waiting" ||
    value === "blocked" ||
    value === "success" ||
    value === "failed"
    ? value
    : null;
}

function parseArtifactType(value: unknown): ChatArtifact["artifact_type"] | null {
  return value === "document" ||
    value === "report" ||
    value === "markdown" ||
    value === "ppt" ||
    value === "config"
    ? value
    : null;
}

function shouldRenderArtifactEntry(artifact: ChatArtifact) {
  return artifact.preview && artifact.content.trim().length > 20;
}

function stringField(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberField(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function hasToolOnlyContent(message: Record<string, unknown>) {
  const content = message.content;
  if (!Array.isArray(content) || content.length === 0) {
    return false;
  }
  return content.every((item) => {
    if (!item || typeof item !== "object") {
      return false;
    }
    const type =
      typeof (item as Record<string, unknown>).type === "string"
        ? ((item as Record<string, unknown>).type as string).toLowerCase()
        : "";
    return (
      type === "toolcall" || type === "tool_call" || type === "toolresult" || type === "tool_result"
    );
  });
}

function renderTaskCard(task: TaskCard, props: ChatProps) {
  const progress =
    typeof task.progress === "number"
      ? task.progress
      : Math.round((Math.max(0, task.step_current - 1) / Math.max(1, task.step_total)) * 100);
  const statusLabel = {
    running: "进行中",
    waiting: "等待中",
    blocked: "已阻塞",
    success: "已完成",
    failed: "失败",
  }[task.status];
  return html`
    <section class="chat-task-card chat-task-card--${task.status}" aria-live="polite">
      <div class="chat-task-card__header">
        <div>
          <div class="chat-task-card__title">${task.title}</div>
          <div class="chat-task-card__step">
            步骤 ${task.step_current}/${task.step_total}：${task.step_name}
          </div>
        </div>
        <span class="chat-task-card__status">${statusLabel}</span>
      </div>
      <div class="chat-task-card__progress" aria-hidden="true">
        <span style="width: ${progress}%"></span>
      </div>
      <div class="chat-task-card__meta">
        ${typeof task.elapsed_time === "number" ? html`<span>${task.elapsed_time} 秒</span>` : nothing}
        ${task.estimated_time ? html`<span>预计 ${task.estimated_time}</span>` : nothing}
      </div>
      ${task.message ? html`<div class="chat-task-card__message">${task.message}</div>` : nothing}
      ${
        task.outcomeReject && props.onRejectTaskOutcome
          ? html`
              <button
                type="button"
                class="chat-task-card__reject"
                data-testid="reject-task-outcome"
                @click=${() => {
                  const ref = task.outcomeReject;
                  const reject = props.onRejectTaskOutcome;
                  if (!ref || !reject) {
                    return;
                  }
                  void reject(ref);
                }}
              >
                结果不符合要求
              </button>
              ${
                props.taskOutcomeRejectNotice?.key ===
                `${task.outcomeReject.taskId}:${task.outcomeReject.outcomeVersion}`
                  ? html`<p class="chat-task-card__reject-note" data-testid="reject-task-outcome-note">
                      ${props.taskOutcomeRejectNotice.text}
                    </p>`
                  : nothing
              }
            `
          : nothing
      }
      ${renderUsageCostDisclosure({
        surface: "user",
        taskId: task.id,
        client: props.usageClient,
        rerender: props.usageRerender,
      })}
    </section>
  `;
}

function renderCheckpointConfirm(
  checkpoint: ChatCheckpoint,
  props: ChatProps,
  isInFlight: boolean,
) {
  return html`
    <div
      class="chat-checkpoint__confirm"
      role="dialog"
      aria-modal="true"
      aria-label=${t("chat.checkpoint.confirmTitle")}
    >
      <div class="chat-checkpoint__confirm-copy">
        <span class="chat-checkpoint__confirm-desc">
          ${
            checkpoint.restorable.files
              ? t("chat.checkpoint.confirmDescription")
              : t("chat.checkpoint.confirmDescriptionConversationOnly")
          }
        </span>
        ${
          checkpoint.externalEffects.present
            ? html`
                <span class="chat-checkpoint__confirm-warning" role="alert">
                  ${t("chat.checkpoint.externalEffectsWarning")}
                </span>
              `
            : nothing
        }
      </div>
      <div class="chat-checkpoint__confirm-actions">
        <button
          type="button"
          class="btn btn--sm"
          ?disabled=${isInFlight}
          @click=${() => props.onCancelRestoreCheckpoint?.()}
        >
          ${t("chat.checkpoint.cancel")}
        </button>
        <button
          type="button"
          class="btn btn--sm btn--danger chat-checkpoint__confirm-commit"
          ?disabled=${isInFlight}
          @click=${
            isInFlight
              ? undefined
              : () => props.onConfirmRestoreCheckpoint?.(checkpoint.checkpointId)
          }
        >
          ${isInFlight ? t("chat.checkpoint.restoring") : t("chat.checkpoint.confirmRestore")}
        </button>
      </div>
    </div>
  `;
}

function renderCheckpointDivider(checkpoint: ChatCheckpoint, props: ChatProps) {
  const restorable = checkpoint.restorable.files || checkpoint.restorable.transcript;
  const runActive = Boolean(props.canAbort);
  // Disable every restore control while ANY restore is in flight (not only the
  // matching checkpoint) so repeated clicks across dividers are ignored.
  const anyRestoreInFlight = Boolean(props.restoreInFlightCheckpointId);
  const isInFlight = props.restoreInFlightCheckpointId === checkpoint.checkpointId;
  const disabled = !restorable || runActive || anyRestoreInFlight;
  const isPending = props.pendingRestoreCheckpointId === checkpoint.checkpointId;
  const disabledReason = anyRestoreInFlight
    ? t("chat.checkpoint.restoreInProgress")
    : runActive
      ? t("chat.checkpoint.restoreBusyHint")
      : restorable
        ? ""
        : t("chat.checkpoint.notRestorable");
  return html`
    <div class="chat-checkpoint" role="note">
      <div class="chat-checkpoint__bar">
        <span class="chat-checkpoint__icon" aria-hidden="true">${icons.mapPin}</span>
        <span class="chat-checkpoint__label">${t("chat.checkpoint.label")}</span>
        <span class="chat-checkpoint__line" aria-hidden="true"></span>
        <button
          type="button"
          class="btn btn--sm chat-checkpoint__action"
          ?disabled=${disabled || isInFlight}
          title=${disabledReason}
          @click=${
            disabled || isInFlight
              ? undefined
              : () => props.onRequestRestoreCheckpoint?.(checkpoint.checkpointId)
          }
        >
          ${isInFlight ? t("chat.checkpoint.restoring") : t("chat.checkpoint.restore")}
        </button>
      </div>
      ${isPending ? renderCheckpointConfirm(checkpoint, props, isInFlight) : nothing}
    </div>
  `;
}

function renderArtifactEntry(artifact: ChatArtifact, props: ChatProps) {
  const label = artifact.preview_required ? "查看并确认" : "查看";
  return html`
    <section class="chat-artifact-entry">
      <div class="chat-artifact-entry__icon" aria-hidden="true">${icons.fileText}</div>
      <div class="chat-artifact-entry__body">
        <div class="chat-artifact-entry__title">${artifact.title}</div>
        <div class="chat-artifact-entry__meta">
          ${artifact.context.step_name} · ${artifact.context.purpose}
        </div>
      </div>
      <button
        class="btn"
        type="button"
        @click=${() => {
          if (props.onOpenArtifact) {
            props.onOpenArtifact(artifact.id);
            return;
          }
          props.onOpenSidebar?.(artifact.content);
        }}
      >
        ${label}
      </button>
    </section>
  `;
}

function getChatMarker(raw: Record<string, unknown>): Record<string, unknown> | undefined {
  const current = raw.__openbot;
  if (current && typeof current === "object") {
    return current as Record<string, unknown>;
  }
  const legacy = raw.__openclaw;
  if (legacy && typeof legacy === "object") {
    return legacy as Record<string, unknown>;
  }
  return undefined;
}

function messageKey(message: unknown, index: number): string {
  const m = message as Record<string, unknown>;
  const toolCallId = typeof m.toolCallId === "string" ? m.toolCallId : "";
  if (toolCallId) {
    return `tool:${toolCallId}`;
  }
  const id = typeof m.id === "string" ? m.id : "";
  if (id) {
    return `msg:${id}`;
  }
  const messageId = typeof m.messageId === "string" ? m.messageId : "";
  if (messageId) {
    return `msg:${messageId}`;
  }
  const timestamp = typeof m.timestamp === "number" ? m.timestamp : null;
  const role = typeof m.role === "string" ? m.role : "unknown";
  if (timestamp != null) {
    return `msg:${role}:${timestamp}:${index}`;
  }
  return `msg:${role}:${index}`;
}
