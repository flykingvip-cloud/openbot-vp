import { html, nothing } from "lit";
import { ifDefined } from "lit/directives/if-defined.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import type { VisibleReplyLanguage } from "../../../../src/shared/text/assistant-scratchpad.js";
import type { ThinkingProgressSnapshot } from "../../../../src/shared/text/thinking-progress.js";
import { THINKING_PROGRESS_PLACEHOLDER } from "../../../../src/shared/text/thinking-progress.js";
import { stripInlineDirectiveTagsForDisplay } from "../../../../src/utils/directive-tags.ts";
import { i18n, t } from "../../i18n/index.ts";
import type { AssistantIdentity } from "../assistant-identity.ts";
import { isBrowserDeviceSenderLabel } from "../client-display-name.ts";
import { isGroupScopedSessionKey } from "../collaboration/resolve-group-scope.ts";
import {
  collaborationSuppressKindLabelZh,
  readCollaborationSuppressKind,
} from "../collaboration/suppress-reason-labels.ts";
import { icons } from "../icons.ts";
import { toSanitizedMarkdownHtml } from "../markdown.ts";
import { openExternalUrlSafe } from "../open-external-url.ts";
import {
  dispatchDiagnosisConversationAction,
  parseDiagnoseConversationActions,
} from "../ports/diagnosis/diagnosis-conversation-action.ts";
import { detectTextDirection } from "../text-direction.ts";
import type { MessageGroup } from "../types/chat-types.ts";
import { isArtifactPreviewMiss } from "../wiring/workspace-file-preview.ts";
import { renderChatDeliveryView, tryFillChatComposer } from "./chat-delivery-view.ts";
import {
  isCollaborationSupplementMessage,
  parseChatDelivery,
  shouldUseChatDeliveryComponent,
} from "./chat-delivery.ts";
import { handleCodeBlockCopyClick, withCodeBlockCopyButtons } from "./code-block-copy.ts";
import { readCollaborationWrap } from "./collaboration-round-grouping.ts";
import { renderTurnCopyButton } from "./copy-buttons.ts";
import {
  isCronParkedNoticeMessage,
  parseCronResultSurfaceSections,
  readCronResultMessageMeta,
} from "./cron-result-message.ts";
import { resolveMessageDomId } from "./focus-message.ts";
import {
  isDeliverableResultArtifact,
  resolvePreviewArtifactRecords,
} from "./generated-preview-artifact.ts";
import { heartbeatParkReasonFromMessage } from "./heartbeat-parked-notice.ts";
import {
  extractTextCached,
  extractThinkingCached,
  formatReasoningMarkdown,
} from "./message-extract.ts";
import { stripRobotHandoffBanner } from "./message-normalizer.ts";
import {
  isToolResultMessage,
  normalizeMessage,
  normalizeRoleForGrouping,
} from "./message-normalizer.ts";
import {
  renderOguiFormView,
  resolveOguiFormDecisionStatus,
  type OguiDecisionStatusLookup,
} from "./ogui-form-view.ts";
import { parseOguiFormFromText, stripOguiFormFences } from "./ogui-form.ts";
import {
  dismissParkedReminder,
  isParkedReminderDismissed,
  parseParkedTaskReminder,
  parseParkedWakeTaskId,
} from "./parked-task-reminder.ts";
import {
  peerRouteFromNormalized,
  type PeerExchangeFold,
  type PeerRoute,
  type PeerRouteParty,
} from "./peer-exchange.ts";
import { buildQuoteDraft, type ChatQuoteDraft } from "./quote-draft.ts";
import { scrubFalseDeliveryClaims } from "./scrub-false-delivery-claims.js";
import { resolveSpaceAwareAssistantIdentity } from "./space-stream-identity.ts";
import { formatThinkingElapsed, thinkingElapsedMs } from "./thinking-elapsed.ts";

type ImageBlock = {
  url: string;
  alt?: string;
};

type ArtifactReference = {
  artifactId: string;
  title: string;
  versionLabel?: string;
  /** True when the producer explicitly declared this as a deliverable (first-class 成果, not a
   * conversation excerpt). Drives the 成果 vs 对话摘录 badge distinction. */
  declared?: boolean;
  /** Workspace basename or URL host used on the 打开成果 chip (never a prose title alone). */
  targetLabel?: string;
  /** `file=` was declared but the bytes were never written. Chip must not look synced. */
  workspaceUnwritten?: boolean;
  /** Technical delivery is not ready. The chip must not say the file was delivered. */
  deliveryBlocked?: boolean;
  deliveryStatusLabel?: string;
};

type FileBlock = {
  name: string;
  mimeType?: string;
  status?: string;
};

type GroupedMessageRenderOptions = {
  isStreaming: boolean;
  showReasoning: boolean;
  showToolCards?: boolean;
  onOpenArtifact?: (artifactId: string) => void;
  /** Confirmed workspace-file misses — do not keep 「打开成果」 openable. */
  unavailableArtifactIds?: readonly string[];
  onRequestArtifactEditAccess?: (artifactId: string) => void | Promise<void>;
  onOpenCronTaskDetail?: (jobId: string) => void;
  onOpenCronTaskResult?: (message: unknown) => void;
  onFillComposer?: (text: string) => void;
  /** Interactive Choice: confirm submits a new user turn. */
  onSubmitChoice?: (text: string) => void;
  /**
   * OGUI Form P0: submit readable summary + ogui-answer.
   * Prefer over onSubmitChoice so idempotencyKey can equal submission_id.
   */
  onSubmitForm?: (text: string, meta: { submissionId: string }) => void;
  /** SessionEntry.oguiDecisions status slice. Absent keeps legacy submit operable. */
  oguiDecisions?: OguiDecisionStatusLookup;
  onQuoteMessage?: (quote: ChatQuoteDraft) => void;
  /** HH:mm on the last assistant text bubble; also gates copy/quote. */
  turnTimestamp?: string | null;
  /** 1:1 routing chip drawn in the footer action row, left of the timestamp. */
  peerRoute?: PeerRoute | null;
  senderIdentityLookup?: ChatSenderIdentityLookup;
};

/**
 * Resolve the IANA zone used for chat bubble day boundaries + display.
 * Prefer an explicit user/tenant zone; otherwise the browser/runtime zone;
 * never hardcode a product-wide city (multi-tenant employees are not all in Shanghai).
 */
export function resolveChatTimestampTimeZone(explicit?: string | null): string {
  const trimmed = typeof explicit === "string" ? explicit.trim() : "";
  if (trimmed) {
    return trimmed;
  }
  try {
    const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (typeof resolved === "string" && resolved.trim()) {
      return resolved.trim();
    }
  } catch {
    // Fall through.
  }
  return "UTC";
}

/**
 * Same calendar day → `HH:mm` (locale may add 上午/下午).
 * Cross-day → include month/day (and year when needed) so a thread that spans
 * midnights does not look shuffled (`9:50 PM` then bare `9:22 AM`).
 *
 * Day-boundary and clock use the **same** timezone.
 */
export function formatGroupTimestamp(
  value: number,
  nowMs: number = Date.now(),
  timeZone?: string | null,
): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return "";
  }
  const tz = resolveChatTimestampTimeZone(timeZone);
  const dayKey = (ms: number) => new Date(ms).toLocaleDateString("en-CA", { timeZone: tz }); // YYYY-MM-DD
  const sameDay = dayKey(value) === dayKey(nowMs);
  const sameYear = dayKey(value).slice(0, 4) === dayKey(nowMs).slice(0, 4);
  let locale: string | undefined;
  try {
    locale = i18n.getLocale() === "zh-CN" ? "zh-CN" : undefined;
  } catch {
    locale = undefined;
  }
  const options: Intl.DateTimeFormatOptions = {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
  };
  if (!sameDay) {
    options.month = "numeric";
    options.day = "numeric";
    if (!sameYear) {
      options.year = "numeric";
    }
  }
  try {
    return date.toLocaleString(locale, options);
  } catch {
    return date.toLocaleString("en-US", options);
  }
}

function readMessageTimestamp(message: unknown, fallback: number): number {
  if (!message || typeof message !== "object") {
    return fallback;
  }
  const timestamp = (message as { timestamp?: unknown }).timestamp;
  return typeof timestamp === "number" && Number.isFinite(timestamp) ? timestamp : fallback;
}

type ThinkingClockOpts = {
  startedAt?: number | null;
  nowMs?: number | null;
};

function resolveThinkingLiveCopy(placeholder: string, clock?: ThinkingClockOpts) {
  const elapsedMs = clock?.nowMs == null ? null : thinkingElapsedMs(clock.startedAt, clock.nowMs);
  if (elapsedMs == null) {
    return { title: placeholder, elapsed: null as string | null };
  }
  const elapsed = formatThinkingElapsed(elapsedMs, i18n.getLocale());
  return { title: t("chat.thinkingLive", { elapsed }), elapsed };
}

const INTERNAL_SENDER_LABELS = new Set(["openbot-control-ui", "webchat", "webchat-ui"]);

function normalizeIdentityLookupKey(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

export type ChatParticipantAgent = {
  id: string;
  name?: string | null;
  identity?: {
    name?: string | null;
    emoji?: string | null;
    avatar?: string | null;
    avatarUrl?: string | null;
  } | null;
};

export type ChatSenderIdentityLookup = {
  resolve: (label: string | null | undefined) => Pick<AssistantIdentity, "name" | "avatar"> | null;
};

function resolveParticipantAvatar(
  agent: ChatParticipantAgent,
): Pick<AssistantIdentity, "name" | "avatar"> {
  const name = agent.identity?.name?.trim() || agent.name?.trim() || agent.id;
  const avatar =
    agent.identity?.avatarUrl?.trim() ||
    agent.identity?.avatar?.trim() ||
    agent.identity?.emoji?.trim() ||
    null;
  return { name, avatar };
}

export function buildChatSenderIdentityLookup(
  agents: ChatParticipantAgent[] = [],
): ChatSenderIdentityLookup {
  const byKey = new Map<string, Pick<AssistantIdentity, "name" | "avatar">>();
  for (const agent of agents) {
    const identity = resolveParticipantAvatar(agent);
    for (const key of [agent.id, agent.name, agent.identity?.name]) {
      const normalized = normalizeIdentityLookupKey(key);
      if (normalized) {
        byKey.set(normalized, identity);
      }
    }
  }
  return {
    resolve(label) {
      const normalized = normalizeIdentityLookupKey(label);
      if (!normalized) {
        return null;
      }
      return byKey.get(normalized) ?? null;
    },
  };
}

function initialsForSenderLabel(label: string): string {
  const words = label
    .split(/[\s_-]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 2);
  const value = words.map((part) => part[0]?.toUpperCase() ?? "").join("");
  return value || label.charAt(0).toUpperCase() || "A";
}

function normalizeDisplayedSenderLabel(senderLabel: string | null | undefined) {
  const normalized = senderLabel?.trim();
  if (!normalized) {
    return null;
  }
  if (INTERNAL_SENDER_LABELS.has(normalized.toLowerCase())) {
    return null;
  }
  if (isBrowserDeviceSenderLabel(normalized)) {
    return null;
  }
  return normalized;
}

function resolveUserMessageWho(
  senderLabel: string | null | undefined,
  localUserDisplayName?: string | null,
): string {
  const normalized = normalizeDisplayedSenderLabel(senderLabel);
  if (normalized) {
    return normalized;
  }
  const local = localUserDisplayName?.trim();
  if (local) {
    return local;
  }
  return "You";
}

function extractImages(message: unknown): ImageBlock[] {
  const m = message as Record<string, unknown>;
  const content = m.content;
  const images: ImageBlock[] = [];

  if (Array.isArray(content)) {
    for (const block of content) {
      if (typeof block !== "object" || block === null) {
        continue;
      }
      const b = block as Record<string, unknown>;

      if (b.type === "image") {
        // Handle source object format (from sendChatMessage)
        const source = b.source as Record<string, unknown> | undefined;
        if (source?.type === "base64" && typeof source.data === "string") {
          const data = source.data;
          const mediaType = (source.media_type as string) || "image/png";
          // If data is already a data URL, use it directly
          const url = data.startsWith("data:") ? data : `data:${mediaType};base64,${data}`;
          images.push({ url });
        } else if (typeof b.url === "string") {
          images.push({ url: b.url });
        }
      } else if (b.type === "image_url") {
        // OpenAI format
        const imageUrl = b.image_url as Record<string, unknown> | undefined;
        if (typeof imageUrl?.url === "string") {
          images.push({ url: imageUrl.url });
        }
      }
    }
  }

  return images;
}

function extractFiles(message: unknown): FileBlock[] {
  const m = message as Record<string, unknown>;
  const content = m.content;
  const files: FileBlock[] = [];
  if (!Array.isArray(content)) {
    return files;
  }
  for (const block of content) {
    if (!block || typeof block !== "object") {
      continue;
    }
    const b = block as Record<string, unknown>;
    if (b.type !== "file") {
      continue;
    }
    const name =
      typeof b.fileName === "string"
        ? b.fileName
        : typeof b.file_name === "string"
          ? b.file_name
          : typeof b.name === "string"
            ? b.name
            : "attachment";
    files.push({
      name,
      mimeType:
        typeof b.mimeType === "string"
          ? b.mimeType
          : typeof b.mime_type === "string"
            ? b.mime_type
            : undefined,
      status: typeof b.status === "string" ? b.status : undefined,
    });
  }
  return files;
}

function resolveArtifactTargetLabel(artifact: Record<string, unknown>): string | undefined {
  const metadata =
    artifact.providerMetadata && typeof artifact.providerMetadata === "object"
      ? (artifact.providerMetadata as Record<string, unknown>)
      : null;
  const target =
    metadata?.deliverableTarget && typeof metadata.deliverableTarget === "object"
      ? (metadata.deliverableTarget as Record<string, unknown>)
      : null;
  const file =
    (typeof target?.workspaceFilename === "string" && target.workspaceFilename.trim()) ||
    (typeof metadata?.workspaceFilename === "string" && metadata.workspaceFilename.trim()) ||
    "";
  if (file) {
    return file.split("/").filter(Boolean).at(-1) || file;
  }
  const url =
    (typeof target?.url === "string" && target.url.trim()) ||
    (typeof artifact.openUrl === "string" && artifact.openUrl.trim()) ||
    "";
  if (url) {
    try {
      return new URL(url).pathname.split("/").filter(Boolean).at(-1) || url;
    } catch {
      return url;
    }
  }
  return undefined;
}

function readDeliverablePublish(message: unknown): {
  presentation?: string;
  reasonLabel?: string | null;
} | null {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return null;
  }
  const raw = (message as Record<string, unknown>).deliverablePublish;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const presentation = typeof record.presentation === "string" ? record.presentation : undefined;
  const reasonLabel =
    typeof record.reasonLabel === "string" && record.reasonLabel.trim()
      ? record.reasonLabel.trim()
      : null;
  return { presentation, reasonLabel };
}

function extractArtifactReferences(message: unknown): ArtifactReference[] {
  const artifacts = resolvePreviewArtifactRecords(message).filter(isDeliverableResultArtifact);
  const publish = readDeliverablePublish(message);
  const publishBlocks =
    publish?.presentation === "undelivered" || publish?.presentation === "pending_recovery";
  const publishAllows = publish?.presentation === "delivered";
  const refs: ArtifactReference[] = [];
  for (const artifact of artifacts) {
    const artifactId = typeof artifact.artifactId === "string" ? artifact.artifactId.trim() : "";
    if (!artifactId) {
      continue;
    }
    const title =
      typeof artifact.title === "string" && artifact.title.trim()
        ? artifact.title.trim()
        : artifactId;
    const versionLabel =
      typeof artifact.versionLabel === "string" && artifact.versionLabel.trim()
        ? artifact.versionLabel.trim()
        : undefined;
    const metadata =
      artifact.providerMetadata && typeof artifact.providerMetadata === "object"
        ? (artifact.providerMetadata as Record<string, unknown>)
        : null;
    const metaBlocks =
      metadata?.workspaceUnwritten === true ||
      metadata?.previewUnavailable === true ||
      metadata?.deliveryUndelivered === true ||
      metadata?.settleRetryable === true ||
      metadata?.settleConflict === true;
    const deliveryBlocked = publishBlocks || (!publishAllows && metaBlocks);
    const deliveryStatusLabel = deliveryBlocked
      ? `${
          publish?.presentation === "pending_recovery"
            ? t("chat.deliverablePendingRecovery")
            : t("chat.deliverableUndelivered")
        }${publish?.reasonLabel ? `：${publish.reasonLabel}` : ""}`
      : undefined;
    refs.push({
      artifactId,
      title,
      versionLabel,
      declared: metadata?.declared === true,
      targetLabel: resolveArtifactTargetLabel(artifact),
      workspaceUnwritten: metadata?.workspaceUnwritten === true,
      deliveryBlocked,
      deliveryStatusLabel,
    });
  }
  return refs;
}

function readGroupAssistantAgentId(group: MessageGroup): string | null {
  for (const entry of group.messages) {
    const message = entry.message;
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      continue;
    }
    const agentId = (message as Record<string, unknown>).agentId;
    if (typeof agentId === "string" && agentId.trim()) {
      return agentId.trim();
    }
  }
  return null;
}

export function renderReadingIndicatorGroup(
  assistant?: AssistantIdentity,
  clock?: ThinkingClockOpts,
  sessionKey?: string,
  statusLabel?: string | null,
  narration?: string | null,
) {
  const showColumnAvatar = isGroupScopedSessionKey(sessionKey ?? "");
  const phaseLabel = statusLabel?.trim() ?? "";
  const live = resolveThinkingLiveCopy(
    t("chat.thinkingLive", { elapsed: formatThinkingElapsed(0, i18n.getLocale()) }),
    clock,
  );
  const title = phaseLabel || live.title;
  const showLabel = Boolean(phaseLabel) || clock?.nowMs != null;
  const narrationLine = narration?.trim() ?? "";
  return html`
    <div class="chat-group assistant${showColumnAvatar ? "" : " chat-group--solo"}">
      ${showColumnAvatar ? renderAvatar("assistant", assistant, assistant?.name) : nothing}
      <div class="chat-group-messages">
        <div class="chat-bubble chat-reading-indicator" role="status" aria-live="polite" aria-label=${title}>
          ${
            showLabel
              ? html`<span
                  class="chat-reading-indicator__label"
                  data-testid=${phaseLabel ? "chat-work-progress" : nothing}
                >${phaseLabel || live.title}</span>`
              : nothing
          }
          <span class="chat-reading-indicator__dots">
            <span></span><span></span><span></span>
          </span>
          ${
            narrationLine
              ? html`<details class="chat-reading-indicator__narration">
                  <summary>过程</summary>
                  <p data-testid="chat-work-progress-narration">${narrationLine}</p>
                </details>`
              : nothing
          }
        </div>
      </div>
    </div>
  `;
}

/**
 * Process-channel UI: thinking structure + progress while delivery text is empty.
 * Labels must stay Chinese/neutral — never dump raw English CoT.
 */
export function renderToolProgressGroup(texts: string[]) {
  const visible = texts.map((text) => text.trim()).filter(Boolean);
  if (visible.length === 0) {
    return nothing;
  }
  return html`
    <details class="chat-tool-progress">
      <summary class="chat-tool-progress__summary">过程</summary>
      ${visible.map(
        (text) =>
          html`<p class="chat-tool-progress__line" data-testid="chat-tool-progress-line">${text}</p>`,
      )}
    </details>
  `;
}

export function renderThinkingProgressGroup(
  progress: ThinkingProgressSnapshot | null | undefined,
  assistant?: AssistantIdentity,
  clock?: ThinkingClockOpts,
  _sessionKey?: string,
) {
  const placeholder = progress?.placeholder?.trim() || THINKING_PROGRESS_PLACEHOLDER;
  const live = resolveThinkingLiveCopy(placeholder, clock);
  const steps = Array.isArray(progress?.steps) ? progress.steps : [];
  const percent =
    typeof progress?.percent === "number" && Number.isFinite(progress.percent)
      ? Math.max(0, Math.min(100, progress.percent))
      : 8;
  const meta = live.elapsed ?? `${Math.round(percent)}%`;

  return html`
    <div class="chat-group assistant">
      ${renderAvatar("assistant", assistant, assistant?.name)}
      <div class="chat-group-messages">
        <div
          class="chat-bubble chat-thinking-progress"
          role="status"
          aria-live="polite"
          aria-label=${live.title}
        >
          <div class="chat-thinking-progress__header">
            <span class="chat-thinking-progress__title">${live.title}</span>
            <span class="chat-thinking-progress__percent">${meta}</span>
          </div>
          <div
            class="chat-thinking-progress__bar"
            role="progressbar"
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow=${Math.round(percent)}
          >
            <span style="width: ${percent}%"></span>
          </div>
          ${
            steps.length > 0
              ? html`
                <ol class="chat-thinking-progress__steps">
                  ${steps.map(
                    (step) => html`
                      <li
                        class="chat-thinking-progress__step chat-thinking-progress__step--${step.status}"
                        data-status=${step.status}
                      >
                        <span class="chat-thinking-progress__step-mark" aria-hidden="true"></span>
                        <span class="chat-thinking-progress__step-label">${step.label}</span>
                      </li>
                    `,
                  )}
                </ol>
              `
              : nothing
          }
        </div>
      </div>
    </div>
  `;
}

export function renderStreamingGroup(
  text: string,
  startedAt: number,
  _onOpenSidebar?: (content: string) => void,
  assistant?: AssistantIdentity,
  _sessionKey?: string,
  replyLanguage?: VisibleReplyLanguage | null,
  ogui?: {
    oguiDecisions?: OguiDecisionStatusLookup;
    onFillComposer?: (text: string) => void;
    onSubmitChoice?: (text: string) => void;
    onSubmitForm?: (text: string, meta: { submissionId: string }) => void;
  },
) {
  const visible = stripInlineDirectiveTagsForDisplay(text, replyLanguage).text.trim();
  if (!visible) {
    return nothing;
  }

  return html`
    <div class="chat-group assistant">
      ${renderAvatar("assistant", assistant, assistant?.name)}
      <div class="chat-group-messages">
        ${renderGroupedMessage(
          {
            role: "assistant",
            content: [{ type: "text", text: visible }],
            timestamp: startedAt,
          },
          {
            isStreaming: true,
            showReasoning: false,
            oguiDecisions: ogui?.oguiDecisions,
            onFillComposer: ogui?.onFillComposer,
            onSubmitChoice: ogui?.onSubmitChoice,
            onSubmitForm: ogui?.onSubmitForm,
          },
        )}
      </div>
    </div>
  `;
}

export function renderMessageGroup(
  group: MessageGroup,
  opts: {
    onOpenSidebar?: (content: string) => void;
    onOpenArtifact?: (artifactId: string) => void;
    unavailableArtifactIds?: readonly string[];
    onRequestArtifactEditAccess?: (artifactId: string) => void | Promise<void>;
    onOpenCronTaskDetail?: (jobId: string) => void;
    onOpenCronTaskResult?: (message: unknown) => void;
    onFillComposer?: (text: string) => void;
    onSubmitChoice?: (text: string) => void;
    onSubmitForm?: (text: string, meta: { submissionId: string }) => void;
    oguiDecisions?: OguiDecisionStatusLookup;
    onQuoteMessage?: (quote: ChatQuoteDraft) => void;
    showReasoning: boolean;
    showToolCards?: boolean;
    assistantName?: string;
    assistantAvatar?: string | null;
    localUserDisplayName?: string | null;
    senderIdentityLookup?: ChatSenderIdentityLookup;
    sessionKey?: string;
  },
) {
  const normalizedRole = normalizeRoleForGrouping(group.role);
  const assistantName = opts.assistantName ?? "Assistant";
  const senderLabel = normalizeDisplayedSenderLabel(group.senderLabel);
  const messageAgentId = readGroupAssistantAgentId(group);
  const avatarIdentity =
    normalizedRole === "assistant"
      ? resolveSpaceAwareAssistantIdentity({
          sessionKey: opts.sessionKey ?? "",
          senderLabel,
          agentId: messageAgentId,
          stewardIdentity: {
            name: assistantName,
            avatar: opts.assistantAvatar ?? null,
          },
          senderIdentityLookup: opts.senderIdentityLookup,
        })
      : {
          name: assistantName,
          avatar: opts.assistantAvatar ?? null,
        };
  const peerParties = group.peerLabels?.filter((label) => label.trim()) ?? [];
  const who =
    normalizedRole === "user"
      ? resolveUserMessageWho(group.senderLabel, opts.localUserDisplayName)
      : normalizedRole === "peer" || normalizedRole === "peer-out"
        ? (peerParties[0] ?? senderLabel ?? "数字人")
        : normalizedRole === "assistant"
          ? (senderLabel ?? avatarIdentity.name)
          : normalizedRole;
  const roleClass =
    normalizedRole === "user"
      ? "user"
      : normalizedRole === "peer"
        ? "peer"
        : normalizedRole === "peer-out"
          ? "peer-out"
          : normalizedRole === "assistant"
            ? "assistant"
            : "other";
  const timestamp = formatGroupTimestamp(group.timestamp);
  const isWrapSummary = group.messages.some((entry) => readCollaborationWrap(entry.message));
  const isPeerExchange = normalizedRole === "peer" || normalizedRole === "peer-out";
  // 1:1 and group assistant turns share the original left column avatar.
  const showColumnAvatar =
    normalizedRole === "user" ||
    normalizedRole === "assistant" ||
    normalizedRole === "peer" ||
    normalizedRole === "peer-out";
  const lastTurnMetaIndex =
    normalizedRole === "assistant"
      ? group.messages.reduce((found, item, index) => {
          return isRenderableAssistantTurnText(item.message) ? index : found;
        }, -1)
      : -1;

  return html`
    <div class="chat-group ${roleClass}${showColumnAvatar ? "" : " chat-group--solo"}">
      ${
        showColumnAvatar
          ? renderAvatar(isPeerExchange ? "peer" : group.role, avatarIdentity, who)
          : nothing
      }
      <div class="chat-group-messages">
        ${group.messages.map((item, index) =>
          renderGroupedMessage(item.message, {
            isStreaming: group.isStreaming && index === group.messages.length - 1,
            showReasoning: opts.showReasoning,
            showToolCards: opts.showToolCards,
            onOpenArtifact: opts.onOpenArtifact,
            unavailableArtifactIds: opts.unavailableArtifactIds,
            onRequestArtifactEditAccess: opts.onRequestArtifactEditAccess,
            onOpenCronTaskDetail: opts.onOpenCronTaskDetail,
            onOpenCronTaskResult: opts.onOpenCronTaskResult,
            onFillComposer: opts.onFillComposer,
            onSubmitChoice: opts.onSubmitChoice,
            onSubmitForm: opts.onSubmitForm,
            oguiDecisions: opts.oguiDecisions,
            onQuoteMessage: opts.onQuoteMessage,
            senderIdentityLookup: opts.senderIdentityLookup,
            peerRoute: peerRouteFromNormalized(normalizeMessage(item.message)),
            turnTimestamp:
              isPeerExchange && !group.isStreaming
                ? formatGroupTimestamp(readMessageTimestamp(item.message, group.timestamp))
                : group.isStreaming || index !== lastTurnMetaIndex
                  ? null
                  : timestamp,
          }),
        )}
        ${
          isWrapSummary
            ? html`
                <div class="chat-group-footer">
                  <span class="chat-collaboration-wrap-badge">协调总结</span>
                </div>
              `
            : nothing
        }
      </div>
    </div>
  `;
}

function renderAvatar(
  role: string,
  assistant?: Pick<AssistantIdentity, "name" | "avatar">,
  senderLabel?: string | null,
  extraClass = "",
) {
  const normalized = normalizeRoleForGrouping(role);
  const assistantName = assistant?.name?.trim() || "Assistant";
  const assistantAvatar = assistant?.avatar?.trim() || "";
  const senderName = senderLabel?.trim();
  const userInitial = senderName?.charAt(0).toUpperCase();
  const initial =
    normalized === "user"
      ? userInitial || "U"
      : normalized === "peer"
        ? senderName?.charAt(0) || "数"
        : normalized === "assistant"
          ? senderName
            ? initialsForSenderLabel(senderName)
            : assistantName.charAt(0).toUpperCase() || "A"
          : normalized === "tool"
            ? "⚙"
            : "?";
  const roleClass =
    normalized === "user"
      ? "user"
      : normalized === "peer"
        ? "peer"
        : normalized === "assistant"
          ? "assistant"
          : normalized === "tool"
            ? "tool"
            : "other";
  const className = ["chat-avatar", roleClass, extraClass].filter(Boolean).join(" ");
  const title = extraClass ? senderName || assistantName || undefined : undefined;

  const showAvatarArt =
    Boolean(assistantAvatar) &&
    (normalized === "assistant" || extraClass.includes("chat-avatar--chip"));
  if (assistantAvatar && showAvatarArt) {
    if (isAvatarUrl(assistantAvatar)) {
      return html`<img
        class="${className}"
        src="${assistantAvatar}"
        alt="${assistantName}"
        title=${ifDefined(title)}
      />`;
    }
    return html`<div class="${className}" title=${ifDefined(title)}>${assistantAvatar}</div>`;
  }

  return html`<div class="${className}" title=${ifDefined(title)}>${initial}</div>`;
}

function resolvePartyIdentity(
  party: PeerRouteParty,
  lookup?: ChatSenderIdentityLookup,
): Pick<AssistantIdentity, "name" | "avatar"> {
  const byLabel = lookup?.resolve(party.label);
  if (byLabel) {
    return byLabel;
  }
  if (party.agentId) {
    const byId = lookup?.resolve(party.agentId);
    if (byId) {
      return byId;
    }
  }
  return { name: party.label, avatar: null };
}

function renderPeerParties(parties: PeerRouteParty[], lookup?: ChatSenderIdentityLookup) {
  const conjunction = t("chat.peerAnd");
  return parties.map(
    (party, index) => html`
      ${index > 0 ? html`<span class="chat-peer-route__and">${conjunction}</span>` : nothing}
      <span class="chat-peer-route__who">
        ${renderAvatar(
          "peer",
          resolvePartyIdentity(party, lookup),
          party.label,
          "chat-avatar--chip",
        )}
        <span class="chat-sender-name">${party.label}</span>
      </span>
    `,
  );
}

/** Compact routing chip. Sits in the bubble footer, immediately left of the timestamp. */
function renderPeerRouteChip(route: PeerRoute, lookup?: ChatSenderIdentityLookup) {
  const verb = route.direction === "sent" ? t("chat.peerSentTo") : t("chat.peerFrom");
  return html`
    <span class="chat-peer-route" data-peer-direction=${route.direction}>
      <span class="chat-peer-route__verb">${verb}</span>
      ${renderPeerParties(route.parties, lookup)}
    </span>
  `;
}

export function renderPeerExchange(
  item: PeerExchangeFold,
  opts: Parameters<typeof renderMessageGroup>[1],
) {
  const parties: PeerRouteParty[] = item.labels.map((label) => ({ label, agentId: null }));
  return html`
    <details class="chat-peer-exchange">
      <summary class="chat-peer-exchange__summary">
        <span class="chat-peer-route" data-peer-direction="exchange">
          <span class="chat-peer-route__verb">${t("chat.peerExchange", { count: item.count })}</span>
          ${renderPeerParties(parties, opts.senderIdentityLookup)}
        </span>
      </summary>
      <div class="chat-peer-exchange__body">
        ${item.groups.map((group) => renderMessageGroup(group, opts))}
      </div>
    </details>
  `;
}

function isAvatarUrl(value: string): boolean {
  return (
    /^https?:\/\//i.test(value) || /^data:image\//i.test(value) || value.startsWith("/") // Relative paths from avatar endpoint
  );
}

function renderMessageImages(images: ImageBlock[]) {
  if (images.length === 0) {
    return nothing;
  }

  const openImage = (url: string) => {
    openExternalUrlSafe(url, { allowDataImage: true });
  };

  return html`
    <div class="chat-message-images">
      ${images.map(
        (img) => html`
          <img
            src=${img.url}
            alt=${img.alt ?? "Attached image"}
            class="chat-message-image"
            @click=${() => openImage(img.url)}
          />
        `,
      )}
    </div>
  `;
}

function renderMessageFiles(files: FileBlock[]) {
  if (files.length === 0) {
    return nothing;
  }
  return html`
    <div class="chat-message-files">
      ${files.map(
        (file) => html`
          <div class="chat-message-file" title=${file.mimeType ?? file.name}>
            <span class="chat-message-file__icon" aria-hidden="true">FILE</span>
            <span class="chat-message-file__name">${file.name}</span>
            ${
              file.status
                ? html`<span class="chat-message-file__status">${formatFileStatus(file.status)}</span>`
                : nothing
            }
          </div>
        `,
      )}
    </div>
  `;
}

function formatFileStatus(status: string) {
  switch (status) {
    case "uploading":
      return "发送中";
    case "sent":
      return "已发送";
    case "failed":
      return "失败";
    case "reading":
      return "读取中";
    case "ready":
      return "已就绪";
    default:
      return status;
  }
}

function normalizeArtifactFilename(value: string) {
  return value
    .trim()
    .replace(/^📄\s*/, "")
    .replace(/^[`*_~\s]+|[`*_~\s]+$/g, "")
    .toLowerCase();
}

function isArtifactFilenameTarget(label: string, artifact: ArtifactReference) {
  const normalizedLabel = normalizeArtifactFilename(label);
  const candidates = [artifact.targetLabel, artifact.title]
    .map((value) => (value ? normalizeArtifactFilename(value) : ""))
    .filter(Boolean);
  if (!normalizedLabel || candidates.length === 0) {
    return false;
  }
  return candidates.some(
    (normalizedTitle) =>
      normalizedLabel === normalizedTitle || normalizedLabel.includes(normalizedTitle),
  );
}

function handleArtifactTextClick(
  event: Event,
  artifacts: ArtifactReference[],
  opts: GroupedMessageRenderOptions,
) {
  if (artifacts.length === 0 || !opts.onOpenArtifact) {
    return;
  }
  const target = event.target instanceof HTMLElement ? event.target : null;
  if (target?.closest(".chat-copy-btn, .chat-msg-actions")) {
    return;
  }
  const candidate = target?.closest("a, code");
  if (!(candidate instanceof HTMLElement)) {
    return;
  }
  const label = candidate.textContent ?? "";
  const match =
    artifacts.find((artifact) => isArtifactFilenameTarget(label, artifact)) ??
    (artifacts.length === 1 ? artifacts[0] : null);
  if (!match) {
    return;
  }
  // Miss chips stay labeled unavailable, but a click must re-run the open RPC —
  // agents often write the file after the first miss in the same SPA session.
  event.preventDefault();
  event.stopPropagation();
  opts.onOpenArtifact(match.artifactId);
}

/** Sanitized chat markdown with a per-code-block copy affordance attached to each `<pre>`. */
function renderChatMarkdownHtml(markdown: string): string {
  return withCodeBlockCopyButtons(toSanitizedMarkdownHtml(markdown));
}

function isRenderableAssistantTurnText(message: unknown): boolean {
  if (isToolResultMessage(message)) {
    return false;
  }
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return false;
  }
  const role =
    typeof (message as { role?: unknown }).role === "string"
      ? String((message as { role: string }).role).toLowerCase()
      : "";
  if (role === "toolresult" || role === "tool_result" || role === "tool") {
    return false;
  }
  const record = message as Record<string, unknown>;
  if (typeof record.toolCallId === "string" || typeof record.tool_call_id === "string") {
    return false;
  }
  return Boolean(extractTextCached(message)?.trim());
}

function renderGroupedMessage(message: unknown, opts: GroupedMessageRenderOptions) {
  const m = message as Record<string, unknown>;
  const rawRole = typeof m.role === "string" ? m.role : "unknown";
  const normalizedForRoute = normalizeMessage(message);
  const peerRoute = opts.peerRoute ?? peerRouteFromNormalized(normalizedForRoute);
  // Outbound envelopes are stored as assistant leaves. Render them as peer chrome,
  // not as a group-assistant turn (no sender-name, no delivery card).
  const role = peerRoute ? normalizedForRoute.role : rawRole;
  const isToolResult =
    isToolResultMessage(message) ||
    rawRole.toLowerCase() === "toolresult" ||
    rawRole.toLowerCase() === "tool_result" ||
    typeof m.toolCallId === "string" ||
    typeof m.tool_call_id === "string";

  const images = extractImages(message);
  const hasImages = images.length > 0;
  const files = extractFiles(message);
  const hasFiles = files.length > 0;
  const artifacts = extractArtifactReferences(message);
  const artifact = artifacts[0] ?? null;
  const cronResult = role === "assistant" ? readCronResultMessageMeta(message) : null;
  const isCronParkedNotice = Boolean(cronResult && isCronParkedNoticeMessage(message));
  const parkedReminder =
    role === "assistant" && !isCronParkedNotice ? parseParkedTaskReminder(message) : null;
  const isParkedTaskReminder = Boolean(parkedReminder);
  const heartbeatParkReason =
    role === "assistant" && !isCronParkedNotice && !isParkedTaskReminder
      ? heartbeatParkReasonFromMessage(message)
      : undefined;
  const isHeartbeatParkedNotice = Boolean(heartbeatParkReason);
  const parkedCardKey = `${opts.turnTimestamp ?? ""}:${extractTextCached(message) ?? ""}`.slice(
    0,
    240,
  );
  const parkedReminderDismissed =
    (isParkedTaskReminder || isHeartbeatParkedNotice || isCronParkedNotice) &&
    isParkedReminderDismissed(parkedCardKey);
  const hasArtifactActions =
    artifacts.length > 0 && Boolean(opts.onOpenArtifact || opts.onRequestArtifactEditAccess);
  const hasCronActions = Boolean(
    cronResult && (opts.onOpenCronTaskDetail || opts.onOpenCronTaskResult),
  );

  const extractedRaw = extractTextCached(message);
  const extractedText = extractedRaw ? stripRobotHandoffBanner(extractedRaw) : extractedRaw;
  const extractedThinking =
    opts.showReasoning && role === "assistant" ? extractThinkingCached(message) : null;
  const markdownBase = extractedText?.trim() ? extractedText : null;
  const reasoningMarkdown = extractedThinking ? formatReasoningMarkdown(extractedThinking) : null;
  // History JSONL is append-only; outbound scrub does not rewrite old bubbles.
  // Re-apply the delivery copy gate at render when the card is undelivered /
  // pending_recovery or any artifact is delivery-blocked (preview miss).
  const publishForCopyGate = readDeliverablePublish(message);
  const scrubHistoryCopy =
    role === "assistant" &&
    Boolean(markdownBase) &&
    (publishForCopyGate?.presentation === "undelivered" ||
      publishForCopyGate?.presentation === "pending_recovery" ||
      artifacts.some((entry) => entry.deliveryBlocked));
  const markdown =
    scrubHistoryCopy && markdownBase ? scrubFalseDeliveryClaims(markdownBase) : markdownBase;
  const isArtifactOutput =
    role === "assistant" && artifacts.length > 0 && Boolean(markdown?.trim());
  const isCronResultOutput =
    role === "assistant" && Boolean(cronResult) && Boolean(markdown?.trim()) && !isCronParkedNotice;
  const cronSections =
    isCronResultOutput && markdown ? parseCronResultSurfaceSections(markdown) : null;
  const copyText = (extractedText ?? markdown ?? "").trim();
  const turnTimestamp = opts.turnTimestamp?.trim() || "";
  // One assistant cycle = one action row, on the last text bubble only.
  // 1:1 peer bubbles use that same row: routing chip, then time, copy, and menu.
  const showTurnActions =
    !opts.isStreaming &&
    (role === "assistant" || role === "peer" || role === "peer-out") &&
    Boolean(copyText) &&
    Boolean(turnTimestamp);
  const showMetaRow = Boolean(turnTimestamp) || showTurnActions || Boolean(peerRoute);

  const isSupplement = isCollaborationSupplementMessage(message);
  const suppressKind = readCollaborationSuppressKind(message);
  const suppressKindLabel = collaborationSuppressKindLabelZh(suppressKind);
  const useDelivery =
    role === "assistant" &&
    !isArtifactOutput &&
    !isCronResultOutput &&
    !isCronParkedNotice &&
    !isHeartbeatParkedNotice &&
    !isParkedTaskReminder &&
    Boolean(markdown?.trim()) &&
    shouldUseChatDeliveryComponent(markdown!, {
      streaming: opts.isStreaming,
      isSupplement,
    });
  const delivery = useDelivery && markdown ? parseChatDelivery(markdown) : null;
  // OGUI Form P0: fenced ```ogui-form``` disables delivery chrome (``` gate), so
  // parse + render on the plain markdown path. A complete fence in the
  // in-flight bubble uses the same decisionStatus lookup. An unfinished
  // fence has no closing ``` and stays markdown.
  const oguiForm =
    role === "assistant" && markdown && !delivery ? parseOguiFormFromText(markdown) : null;
  const markdownForDisplay =
    oguiForm && markdown ? stripOguiFormFences(markdown) || null : markdown;
  const diagnoseActions =
    role === "assistant" && markdown && !opts.isStreaming
      ? parseDiagnoseConversationActions(markdown)
      : [];

  const bubbleClasses = [
    "chat-bubble",
    isArtifactOutput ? "chat-bubble--artifact-output" : "",
    isCronResultOutput || isCronParkedNotice || isHeartbeatParkedNotice || isParkedTaskReminder
      ? "chat-bubble--cron-result"
      : "",
    delivery ? "chat-bubble--delivery" : "",
    suppressKindLabel ? "chat-bubble--collab-suppress" : "",
    oguiForm ? "chat-bubble--ogui-form" : "",
    opts.isStreaming ? "streaming" : "",
    "fade-in",
  ]
    .filter(Boolean)
    .join(" ");

  if (isToolResult) {
    return nothing;
  }

  if (!markdown && !hasImages && !hasFiles && !isArtifactOutput) {
    return nothing;
  }

  const messageDomId = resolveMessageDomId(message);
  const metaRow = showMetaRow
    ? html`
        <div class="chat-msg-actions">
          ${peerRoute ? renderPeerRouteChip(peerRoute, opts.senderIdentityLookup) : nothing}
          ${
            turnTimestamp
              ? html`<span class="chat-group-timestamp">${turnTimestamp}</span>`
              : nothing
          }
          ${showTurnActions ? renderTurnCopyButton(copyText, messageDomId || null) : nothing}
          ${
            showTurnActions && opts.onQuoteMessage
              ? html`
                  <button
                    class="chat-msg-action-btn chat-msg-quote-btn"
                    type="button"
                    title=${t("chat.quote")}
                    aria-label=${t("chat.quoteChipAria")}
                    @click=${(event: Event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      const draft = buildQuoteDraft({
                        messageId: messageDomId || null,
                        text: copyText,
                      });
                      if (draft) {
                        opts.onQuoteMessage?.(draft);
                      }
                    }}
                  >
                    <span class="chat-msg-action-btn__icon" aria-hidden="true">
                      ${icons.quote}
                    </span>
                  </button>
                `
              : nothing
          }
        </div>
      `
    : nothing;

  return html`
    <div
      class="${bubbleClasses}"
      data-message-id=${ifDefined(messageDomId || undefined)}
      @click=${handleCodeBlockCopyClick}
    >
      ${
        suppressKindLabel
          ? html`<div class="chat-collab-suppress-badge" data-suppress-kind=${suppressKind ?? ""}>
              ${suppressKindLabel}
            </div>`
          : nothing
      }
      ${
        isArtifactOutput
          ? html`
              <div class="chat-artifact-output-header">
                <span
                  class="chat-artifact-output-header__badge ${
                    artifact?.declared ? "" : "chat-artifact-output-header__badge--excerpt"
                  }"
                >
                  ${artifact?.declared ? t("chat.artifactResultBadge") : t("chat.artifactExcerptBadge")}
                </span>
                <span class="chat-artifact-output-header__title">
                  ${artifact?.title ?? "Artifact"}
                </span>
              </div>
            `
          : nothing
      }
      ${
        (isCronResultOutput || isCronParkedNotice) && cronResult
          ? html`
              <div class="chat-cron-result-header">
                <span class="chat-cron-result-header__badge">定时任务</span>
                <span class="chat-cron-result-header__title">
                  ${cronResult.jobName ?? "定时执行结果"}
                </span>
              </div>
            `
          : isParkedTaskReminder || isHeartbeatParkedNotice
            ? html`
                <div class="chat-cron-result-header">
                  <span class="chat-cron-result-header__badge">${t("chat.parkedTaskReminderBadge")}</span>
                </div>
              `
            : nothing
      }
      ${renderMessageImages(images)}
      ${renderMessageFiles(files)}
      ${
        reasoningMarkdown
          ? html`<details class="chat-thinking-fold">
              <summary class="chat-thinking-fold__summary">${t("chat.thinkingProcess")}</summary>
              <div class="chat-thinking">${unsafeHTML(
                toSanitizedMarkdownHtml(reasoningMarkdown),
              )}</div>
            </details>`
          : nothing
      }
      ${
        isCronParkedNotice && cronResult
          ? parkedReminderDismissed
            ? html`<div class="chat-delivery"><div class="chat-delivery__detail">${t("chat.parkedTaskPausedAck")}</div></div>`
            : renderChatDeliveryView(
                {
                  conclusion: t("chat.cronParkedNoticeConclusion", {
                    name: cronResult.jobName?.trim() || t("chat.cronParkedNoticeFallbackName"),
                  }),
                  detail:
                    cronResult.parkReason === "reject_park_full"
                      ? t("chat.cronParkedNoticeDetailFull")
                      : t("chat.cronParkedNoticeDetail"),
                  choices: [
                    { key: "A", label: t("chat.parkedTaskResume") },
                    { key: "B", label: t("chat.parkedTaskPause") },
                    { key: "C", label: t("chat.parkedTaskClose") },
                  ],
                },
                {
                  onChoiceSelect: (choice) => {
                    const taskId = cronResult.jobId?.trim() || parseParkedWakeTaskId(message) || "";
                    if (choice.key === "B") {
                      dismissParkedReminder(parkedCardKey);
                      if (taskId) {
                        opts.onSubmitChoice?.(`暂停挂起 ${taskId}`);
                      } else {
                        opts.onFillComposer?.("");
                      }
                      return;
                    }
                    if (!taskId) {
                      if (choice.key === "A") {
                        opts.onOpenCronTaskDetail?.(cronResult.jobId);
                      }
                      return;
                    }
                    if (choice.key === "A") {
                      opts.onSubmitChoice?.(`继续挂起 ${taskId}`);
                      return;
                    }
                    if (choice.key === "C") {
                      dismissParkedReminder(parkedCardKey);
                      opts.onSubmitChoice?.(`取消挂起 ${taskId}`);
                    }
                  },
                },
              )
          : isParkedTaskReminder && parkedReminder
            ? parkedReminderDismissed
              ? html`<div class="chat-delivery"><div class="chat-delivery__detail">${t("chat.parkedTaskPausedAck")}</div></div>`
              : renderChatDeliveryView(
                  {
                    conclusion: t("chat.parkedTaskReminderConclusion"),
                    detail: parkedReminder.title
                      ? t("chat.parkedTaskReminderDetailNamed", {
                          title: parkedReminder.title,
                        })
                      : t("chat.parkedTaskReminderDetail"),
                    choices: [
                      { key: "A", label: t("chat.parkedTaskResume") },
                      { key: "B", label: t("chat.parkedTaskPause") },
                      { key: "C", label: t("chat.parkedTaskClose") },
                    ],
                  },
                  {
                    onChoiceSelect: (choice) => {
                      if (choice.key === "B") {
                        dismissParkedReminder(parkedCardKey);
                        opts.onSubmitChoice?.(`暂停挂起 ${parkedReminder.taskId}`);
                        return;
                      }
                      if (choice.key === "A") {
                        dismissParkedReminder(parkedCardKey);
                        opts.onSubmitChoice?.(`继续挂起 ${parkedReminder.taskId}`);
                        return;
                      }
                      if (choice.key === "C") {
                        dismissParkedReminder(parkedCardKey);
                        opts.onSubmitChoice?.(`取消挂起 ${parkedReminder.taskId}`);
                      }
                    },
                  },
                )
            : isHeartbeatParkedNotice
              ? parkedReminderDismissed
                ? html`<div class="chat-delivery"><div class="chat-delivery__detail">${t("chat.parkedTaskPausedAck")}</div></div>`
                : renderChatDeliveryView(
                    {
                      conclusion: t("chat.heartbeatParkedNoticeConclusion"),
                      detail:
                        heartbeatParkReason === "reject_park_full"
                          ? t("chat.heartbeatParkedNoticeDetailFull")
                          : t("chat.heartbeatParkedNoticeDetail"),
                      choices: [
                        { key: "A", label: t("chat.parkedTaskResume") },
                        { key: "B", label: t("chat.parkedTaskPause") },
                        { key: "C", label: t("chat.parkedTaskClose") },
                      ],
                    },
                    {
                      onChoiceSelect: (choice) => {
                        const taskId = parseParkedWakeTaskId(message) ?? "";
                        if (choice.key === "B") {
                          dismissParkedReminder(parkedCardKey);
                          if (taskId) {
                            opts.onSubmitChoice?.(`暂停挂起 ${taskId}`);
                          } else {
                            opts.onFillComposer?.("");
                          }
                          return;
                        }
                        if (!taskId) {
                          return;
                        }
                        if (choice.key === "A") {
                          dismissParkedReminder(parkedCardKey);
                          opts.onSubmitChoice?.(`继续挂起 ${taskId}`);
                          return;
                        }
                        if (choice.key === "C") {
                          dismissParkedReminder(parkedCardKey);
                          opts.onSubmitChoice?.(`取消挂起 ${taskId}`);
                        }
                      },
                    },
                  )
              : cronSections
                ? html`
              <div class="chat-cron-result-section">
                <div class="chat-cron-result-section__label">任务摘要</div>
                <div class="chat-text" dir="auto">
                  ${unsafeHTML(renderChatMarkdownHtml(cronSections.summaryMarkdown))}
                </div>
              </div>
              <div class="chat-cron-result-section chat-cron-result-section--deliverable">
                <div class="chat-cron-result-section__header">
                  <div class="chat-cron-result-section__label">任务成果</div>
                </div>
                <div class="chat-text chat-cron-result-deliverable-preview" dir="auto">
                  ${unsafeHTML(renderChatMarkdownHtml(cronSections.deliverableMarkdown))}
                </div>
              </div>
              ${
                cronSections.footerMarkdown
                  ? html`
                      <div class="chat-cron-result-footer">
                        <div class="chat-text chat-cron-result-footer__text" dir="auto">
                          ${unsafeHTML(renderChatMarkdownHtml(cronSections.footerMarkdown))}
                        </div>
                      </div>
                    `
                  : nothing
              }
            `
                : delivery
                  ? renderChatDeliveryView(delivery, {
                      // Supplement without choices: never render empty option UI.
                      hideChoices:
                        isSupplement && !(delivery.choices && delivery.choices.length > 0),
                      // Fill composer on click (preview); confirm submits a real turn when wired.
                      onFillComposer:
                        opts.onFillComposer ??
                        ((text: string) => {
                          tryFillChatComposer(text);
                        }),
                      onSubmitChoice: opts.onSubmitChoice,
                    })
                  : markdown
                    ? html`
                      ${
                        markdownForDisplay?.trim()
                          ? html`<div
                              class="chat-text"
                              dir="${detectTextDirection(markdownForDisplay)}"
                              @click=${(event: Event) =>
                                handleArtifactTextClick(event, artifacts, opts)}
                            >${unsafeHTML(renderChatMarkdownHtml(markdownForDisplay))}</div>`
                          : nothing
                      }
                      ${
                        oguiForm
                          ? renderOguiFormView(oguiForm, {
                              onFillComposer:
                                opts.onFillComposer ??
                                ((text: string) => {
                                  tryFillChatComposer(text);
                                }),
                              onSubmitForm: opts.onSubmitForm
                                ? opts.onSubmitForm
                                : opts.onSubmitChoice
                                  ? (text: string) => {
                                      opts.onSubmitChoice?.(text);
                                    }
                                  : undefined,
                              decisionStatus: resolveOguiFormDecisionStatus(
                                oguiForm,
                                opts.oguiDecisions,
                              ),
                            })
                          : nothing
                      }
                    `
                    : nothing
      }
      ${
        diagnoseActions.length > 0
          ? html`
              <div class="chat-diagnosis-actions" data-testid="diagnosis-chat-actions">
                ${diagnoseActions.map(
                  (action) => html`
                    <button
                      type="button"
                      class="btn btn--sm"
                      data-testid="diagnosis-action-run"
                      title=${
                        action.handoffChannel === "diagnosed_agent_session"
                          ? "交给被诊断数字人（1:1 会话，不是协作小组）"
                          : "在当前对话发送，由管家执行"
                      }
                      @click=${(event: Event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        dispatchDiagnosisConversationAction(
                          event.currentTarget as EventTarget,
                          action,
                          "chat",
                        );
                      }}
                    >
                      ${action.title}
                    </button>
                  `,
                )}
              </div>
            `
          : nothing
      }
      ${
        isArtifactOutput && artifacts.length > 0 && hasArtifactActions
          ? artifacts.map(
              (entry) => html`
                <div class="chat-response-reference-summary chat-response-reference-summary--artifact">
                  <span>
                    ${entry.targetLabel ?? entry.title}${entry.versionLabel ? ` (${entry.versionLabel})` : ""}
                  </span>
                  ${
                    entry.deliveryBlocked
                      ? html`
                          <span
                            data-artifact-id=${entry.artifactId}
                            data-testid="artifact-delivery-undelivered"
                          >
                            ${entry.deliveryStatusLabel}
                          </span>
                        `
                      : opts.onOpenArtifact
                        ? entry.workspaceUnwritten ||
                          isArtifactPreviewMiss(opts.unavailableArtifactIds, entry.artifactId)
                          ? html`
                              <button
                                class="btn"
                                type="button"
                                data-artifact-id=${entry.artifactId}
                                data-testid=${
                                  entry.workspaceUnwritten
                                    ? "artifact-open-unwritten"
                                    : "artifact-open-missing"
                                }
                                title=${t(
                                  entry.workspaceUnwritten
                                    ? "chat.artifactPreviewNotWrittenTitle"
                                    : "chat.stewardFileUnavailable",
                                )}
                                @click=${() => opts.onOpenArtifact?.(entry.artifactId)}
                              >
                                ${t(
                                  entry.workspaceUnwritten
                                    ? "chat.artifactPreviewNotWrittenTitle"
                                    : "chat.artifactPreviewFileMissingTitle",
                                )}
                              </button>
                            `
                          : html`
                            <button
                              class="btn"
                              type="button"
                              data-artifact-id=${entry.artifactId}
                              @click=${() => opts.onOpenArtifact?.(entry.artifactId)}
                            >
                              ${t("chat.openArtifact")}
                            </button>
                          `
                        : nothing
                  }
                  ${
                    opts.onRequestArtifactEditAccess
                      ? html`
                          <button
                            class="btn"
                            type="button"
                            @click=${() =>
                              void opts.onRequestArtifactEditAccess?.(entry.artifactId)}
                          >
                            ${t("chat.requestArtifactEditAccess")}
                          </button>
                        `
                      : nothing
                  }
                </div>
              `,
            )
          : nothing
      }
      ${
        isCronResultOutput && cronResult && hasCronActions
          ? html`
              <div class="chat-cron-result-actions">
                ${
                  opts.onOpenCronTaskDetail
                    ? html`
                        <button
                          class="btn btn--sm"
                          type="button"
                          @click=${() => opts.onOpenCronTaskDetail?.(cronResult.jobId)}
                        >
                          了解任务详情
                        </button>
                      `
                    : nothing
                }
                ${
                  opts.onOpenCronTaskResult
                    ? html`
                        <button
                          class="btn btn--sm btn--primary"
                          type="button"
                          @click=${() => opts.onOpenCronTaskResult?.(message)}
                        >
                          打开任务成果
                        </button>
                      `
                    : nothing
                }
              </div>
            `
          : nothing
      }
      ${metaRow}
    </div>
  `;
}
