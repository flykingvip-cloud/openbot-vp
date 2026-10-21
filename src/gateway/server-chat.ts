import { resolveSessionAgentId } from "../agents/agent-scope.js";
import { applyUserVisibleOutputGate } from "../agents/model-output-boundary.js";
import { DEFAULT_HEARTBEAT_ACK_MAX_CHARS, stripHeartbeatToken } from "../auto-reply/heartbeat.js";
import { noteUnresolvedChatRunError } from "../auto-reply/reply/chat-run-error-escalation.js";
import { normalizeVerboseLevel } from "../auto-reply/thinking.js";
import { isSilentReplyText, SILENT_REPLY_TOKEN } from "../auto-reply/tokens.js";
import { loadConfig } from "../config/config.js";
import { type AgentEventPayload, getAgentRunContext } from "../infra/agent-events.js";
import { resolveHeartbeatVisibility } from "../infra/heartbeat-visibility.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { stripAssistantScratchpadFromText } from "../shared/text/assistant-scratchpad.js";
import { getRunReplyLanguage } from "../shared/text/run-reply-language.js";
import { deriveThinkingProgress } from "../shared/text/thinking-progress.js";
import {
  enforceVisibleReplyLanguage,
  visibleReplyNeedsChineseRewrite,
} from "../shared/text/visible-reply-language.js";
import {
  isUnsupportedImageSoftFailure,
  UNSUPPORTED_IMAGE_DIALOGUE,
} from "../shared/unsupported-image-failure.js";
import { stripInlineDirectiveTagsForDisplay } from "../utils/directive-tags.js";
import { markChatRunNotUndoable, type ChatAbortControllerEntry } from "./chat-abort.js";
import { isCollaborationSpaceChildSessionKey } from "./chat-event-isolation.js";
import {
  listChatSessionInterestedUserIds,
  resolveChatRunTenantId,
  resolveUniqueBoundChatSessionTenantId,
} from "./chat-session-interest.js";
import {
  deliverPreparedChatFinal,
  prepareChatDeliverablePublish,
  type PreparedChatDeliverable,
} from "./knowledge/deliverables/chat-deliverable-publish.js";
import { loadSessionEntrySyncFallback } from "./tenant-context.js";
import { formatForLog } from "./ws-log.js";

const log = createSubsystemLogger("gateway/server-chat");

/** Group finals are prepared on the parent `broadcastChatFinal` path, not here. */
function isCollaborationGroupSessionKey(sessionKey: string): boolean {
  const raw = sessionKey.trim();
  return raw.toLowerCase().startsWith("space:") || /:space:/i.test(raw);
}

/**
 * 1:1 settle may write the agent workspace, so it needs the same owner chat.send
 * already authorized. Exactly one interested user is unambiguous. Zero or many
 * stays unset and settle fails closed instead of picking a host workspace.
 */
function resolveDirectDeliverableIdentity(
  sessionKey: string,
  clientRunId: string,
  sourceRunId: string,
): { tenantId: string | null; userId: string | null } {
  const interested = [...listChatSessionInterestedUserIds(sessionKey)];
  return {
    tenantId:
      resolveChatRunTenantId(clientRunId) ??
      resolveChatRunTenantId(sourceRunId) ??
      resolveUniqueBoundChatSessionTenantId(sessionKey),
    userId: interested.length === 1 ? (interested[0] ?? null) : null,
  };
}

function errorTextForTerminal(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }
  if (error == null) {
    return "";
  }
  return formatForLog(error);
}

function resolveRunReplyLanguage(clientRunId: string, sourceRunId?: string): "zh" | "en" | null {
  return getRunReplyLanguage(clientRunId) ?? getRunReplyLanguage(sourceRunId);
}

function resolveHeartbeatAckMaxChars(): number {
  try {
    const cfg = loadConfig();
    return Math.max(
      0,
      cfg.agents?.defaults?.heartbeat?.ackMaxChars ?? DEFAULT_HEARTBEAT_ACK_MAX_CHARS,
    );
  } catch {
    return DEFAULT_HEARTBEAT_ACK_MAX_CHARS;
  }
}

function resolveHeartbeatContext(runId: string, sourceRunId?: string) {
  const primary = getAgentRunContext(runId);
  if (primary?.isHeartbeat) {
    return primary;
  }
  if (sourceRunId && sourceRunId !== runId) {
    const source = getAgentRunContext(sourceRunId);
    if (source?.isHeartbeat) {
      return source;
    }
  }
  return primary;
}

/**
 * Check if heartbeat ACK/noise should be hidden from interactive chat surfaces.
 */
function shouldHideHeartbeatChatOutput(runId: string, sourceRunId?: string): boolean {
  const runContext = resolveHeartbeatContext(runId, sourceRunId);
  if (!runContext?.isHeartbeat) {
    return false;
  }

  try {
    const cfg = loadConfig();
    const visibility = resolveHeartbeatVisibility({ cfg, channel: "webchat" });
    return !visibility.showOk;
  } catch {
    // Default to suppressing if we can't load config
    return true;
  }
}

function normalizeHeartbeatChatFinalText(params: {
  runId: string;
  sourceRunId?: string;
  text: string;
}): { suppress: boolean; text: string } {
  if (!shouldHideHeartbeatChatOutput(params.runId, params.sourceRunId)) {
    return { suppress: false, text: params.text };
  }

  const stripped = stripHeartbeatToken(params.text, {
    mode: "heartbeat",
    maxAckChars: resolveHeartbeatAckMaxChars(),
  });
  if (!stripped.didStrip) {
    return { suppress: false, text: params.text };
  }
  if (stripped.shouldSkip) {
    return { suppress: true, text: "" };
  }
  return { suppress: false, text: stripped.text };
}

function isSilentReplyLeadFragment(text: string): boolean {
  const normalized = text.trim().toUpperCase();
  if (!normalized) {
    return false;
  }
  if (!/^[A-Z_]+$/.test(normalized)) {
    return false;
  }
  if (normalized === SILENT_REPLY_TOKEN) {
    return false;
  }
  return SILENT_REPLY_TOKEN.startsWith(normalized);
}

function appendUniqueSuffix(base: string, suffix: string): string {
  if (!suffix) {
    return base;
  }
  if (!base) {
    return suffix;
  }
  if (base.endsWith(suffix)) {
    return base;
  }
  const maxOverlap = Math.min(base.length, suffix.length);
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    if (base.slice(-overlap) === suffix.slice(0, overlap)) {
      return base + suffix.slice(overlap);
    }
  }
  return base + suffix;
}

function resolveMergedAssistantText(params: {
  previousText: string;
  nextText: string;
  nextDelta: string;
}) {
  const { previousText, nextText, nextDelta } = params;
  const prevGate = applyUserVisibleOutputGate(previousText, { streaming: true });
  const nextGate = applyUserVisibleOutputGate(nextText, { streaming: true });
  const deltaGate = applyUserVisibleOutputGate(nextDelta, { streaming: true });
  if (prevGate.detected || nextGate.detected || deltaGate.detected) {
    return nextGate.visibleText;
  }
  if (nextText && previousText) {
    if (nextText.startsWith(previousText)) {
      return nextText;
    }
    if (previousText.startsWith(nextText) && !nextDelta) {
      return previousText;
    }
  }
  if (nextDelta) {
    return appendUniqueSuffix(previousText, nextDelta);
  }
  if (nextText) {
    return nextText;
  }
  return previousText;
}

export type ChatRunEntry = {
  sessionKey: string;
  clientRunId: string;
};

export type ChatRunRegistry = {
  add: (sessionId: string, entry: ChatRunEntry) => void;
  peek: (sessionId: string) => ChatRunEntry | undefined;
  shift: (sessionId: string) => ChatRunEntry | undefined;
  remove: (sessionId: string, clientRunId: string, sessionKey?: string) => ChatRunEntry | undefined;
  clear: () => void;
};

export function createChatRunRegistry(): ChatRunRegistry {
  const chatRunSessions = new Map<string, ChatRunEntry[]>();

  const add = (sessionId: string, entry: ChatRunEntry) => {
    const queue = chatRunSessions.get(sessionId);
    if (queue) {
      queue.push(entry);
    } else {
      chatRunSessions.set(sessionId, [entry]);
    }
  };

  const peek = (sessionId: string) => chatRunSessions.get(sessionId)?.[0];

  const shift = (sessionId: string) => {
    const queue = chatRunSessions.get(sessionId);
    if (!queue || queue.length === 0) {
      return undefined;
    }
    const entry = queue.shift();
    if (!queue.length) {
      chatRunSessions.delete(sessionId);
    }
    return entry;
  };

  const remove = (sessionId: string, clientRunId: string, sessionKey?: string) => {
    const queue = chatRunSessions.get(sessionId);
    if (!queue || queue.length === 0) {
      return undefined;
    }
    const idx = queue.findIndex(
      (entry) =>
        entry.clientRunId === clientRunId && (sessionKey ? entry.sessionKey === sessionKey : true),
    );
    if (idx < 0) {
      return undefined;
    }
    const [entry] = queue.splice(idx, 1);
    if (!queue.length) {
      chatRunSessions.delete(sessionId);
    }
    return entry;
  };

  const clear = () => {
    chatRunSessions.clear();
  };

  return { add, peek, shift, remove, clear };
}

export type ChatRunState = {
  registry: ChatRunRegistry;
  buffers: Map<string, string>;
  deltaSentAt: Map<string, number>;
  /** Length of text at the time of the last broadcast, used to avoid duplicate flushes. */
  deltaLastBroadcastLen: Map<string, number>;
  /** Last delivery text broadcast on delta — allows shorter cleaned replacements. */
  deltaLastBroadcastText: Map<string, string>;
  /** Throttle for process-channel thinking progress (structure UI). */
  thinkingSentAt: Map<string, number>;
  /** Fingerprint of last thinking snapshot to skip identical repeats. */
  thinkingLastFingerprint: Map<string, string>;
  abortedRuns: Map<string, number>;
  clear: () => void;
};

export function createChatRunState(): ChatRunState {
  const registry = createChatRunRegistry();
  const buffers = new Map<string, string>();
  const deltaSentAt = new Map<string, number>();
  const deltaLastBroadcastLen = new Map<string, number>();
  const deltaLastBroadcastText = new Map<string, string>();
  const thinkingSentAt = new Map<string, number>();
  const thinkingLastFingerprint = new Map<string, string>();
  const abortedRuns = new Map<string, number>();

  const clear = () => {
    registry.clear();
    buffers.clear();
    deltaSentAt.clear();
    deltaLastBroadcastLen.clear();
    deltaLastBroadcastText.clear();
    thinkingSentAt.clear();
    thinkingLastFingerprint.clear();
    abortedRuns.clear();
  };

  return {
    registry,
    buffers,
    deltaSentAt,
    deltaLastBroadcastLen,
    deltaLastBroadcastText,
    thinkingSentAt,
    thinkingLastFingerprint,
    abortedRuns,
    clear,
  };
}

export type ToolEventRecipientRegistry = {
  add: (runId: string, connId: string) => void;
  get: (runId: string) => ReadonlySet<string> | undefined;
  markFinal: (runId: string) => void;
};

type ToolRecipientEntry = {
  connIds: Set<string>;
  updatedAt: number;
  finalizedAt?: number;
};

const TOOL_EVENT_RECIPIENT_TTL_MS = 10 * 60 * 1000;
const TOOL_EVENT_RECIPIENT_FINAL_GRACE_MS = 30 * 1000;

export function createToolEventRecipientRegistry(): ToolEventRecipientRegistry {
  const recipients = new Map<string, ToolRecipientEntry>();

  const prune = () => {
    if (recipients.size === 0) {
      return;
    }
    const now = Date.now();
    for (const [runId, entry] of recipients) {
      const cutoff = entry.finalizedAt
        ? entry.finalizedAt + TOOL_EVENT_RECIPIENT_FINAL_GRACE_MS
        : entry.updatedAt + TOOL_EVENT_RECIPIENT_TTL_MS;
      if (now >= cutoff) {
        recipients.delete(runId);
      }
    }
  };

  const add = (runId: string, connId: string) => {
    if (!runId || !connId) {
      return;
    }
    const now = Date.now();
    const existing = recipients.get(runId);
    if (existing) {
      existing.connIds.add(connId);
      existing.updatedAt = now;
    } else {
      recipients.set(runId, {
        connIds: new Set([connId]),
        updatedAt: now,
      });
    }
    prune();
  };

  const get = (runId: string) => {
    const entry = recipients.get(runId);
    if (!entry) {
      return undefined;
    }
    entry.updatedAt = Date.now();
    prune();
    return entry.connIds;
  };

  const markFinal = (runId: string) => {
    const entry = recipients.get(runId);
    if (!entry) {
      return;
    }
    entry.finalizedAt = Date.now();
    prune();
  };

  return { add, get, markFinal };
}

export type ChatEventBroadcast = (
  event: string,
  payload: unknown,
  opts?: { dropIfSlow?: boolean },
) => void;

export type NodeSendToSession = (sessionKey: string, event: string, payload: unknown) => void;

export type AgentEventHandlerOptions = {
  broadcast: ChatEventBroadcast;
  broadcastChat: (
    sessionKey: string,
    payload: unknown,
    opts?: { dropIfSlow?: boolean; tenantId?: string | null; runId?: string | null },
  ) => number | void;
  broadcastToConnIds: (
    event: string,
    payload: unknown,
    connIds: ReadonlySet<string>,
    opts?: { dropIfSlow?: boolean },
  ) => void;
  nodeSendToSession: NodeSendToSession;
  agentRunSeq: Map<string, number>;
  chatRunState: ChatRunState;
  chatAbortControllers: Map<string, ChatAbortControllerEntry>;
  resolveSessionKeyForRun: (runId: string) => string | undefined;
  clearAgentRunContext: (runId: string) => void;
  toolEventRecipients: ToolEventRecipientRegistry;
};

export function createAgentEventHandler({
  broadcast,
  broadcastChat,
  broadcastToConnIds,
  nodeSendToSession,
  agentRunSeq,
  chatRunState,
  chatAbortControllers,
  resolveSessionKeyForRun,
  clearAgentRunContext,
  toolEventRecipients,
}: AgentEventHandlerOptions) {
  const shouldBroadcastShorterDelivery = (clientRunId: string, deliveryText: string): boolean => {
    const lastText = chatRunState.deltaLastBroadcastText.get(clientRunId) ?? "";
    if (!lastText) {
      return true;
    }
    // Identical payload — skip (also prevents final flush from duplicating the latest delta).
    if (deliveryText === lastText) {
      return false;
    }
    if (deliveryText.length >= lastText.length) {
      return true;
    }
    // Allow shorter cleaned Chinese (or rewritten) delivery to replace longer English CoT.
    // Reject simple truncations of the previous broadcast.
    return !lastText.startsWith(deliveryText);
  };

  const emitThinkingProgress = (
    sessionKey: string,
    clientRunId: string,
    seq: number,
    scratchpadText: string,
    sourceRunId?: string,
  ) => {
    const snapshot = deriveThinkingProgress(
      scratchpadText,
      resolveRunReplyLanguage(clientRunId, sourceRunId),
    );
    const fingerprint = `${snapshot.activeIndex}:${snapshot.percent}:${snapshot.steps
      .map((step) => `${step.label}:${step.status}`)
      .join("|")}`;
    if (chatRunState.thinkingLastFingerprint.get(clientRunId) === fingerprint) {
      return;
    }
    const now = Date.now();
    const last = chatRunState.thinkingSentAt.get(clientRunId) ?? 0;
    if (now - last < 200) {
      return;
    }
    chatRunState.thinkingSentAt.set(clientRunId, now);
    chatRunState.thinkingLastFingerprint.set(clientRunId, fingerprint);
    const payload = {
      runId: clientRunId,
      sessionKey,
      seq,
      state: "thinking" as const,
      thinking: snapshot,
    };
    broadcastChat(sessionKey, payload, { dropIfSlow: true });
    nodeSendToSession(sessionKey, "chat", payload);
  };

  const emitChatDelta = (
    sessionKey: string,
    clientRunId: string,
    sourceRunId: string,
    seq: number,
    text: string,
    delta?: unknown,
  ) => {
    const replyLanguage = resolveRunReplyLanguage(clientRunId, sourceRunId);
    const cleanedText = stripInlineDirectiveTagsForDisplay(text, replyLanguage).text;
    const cleanedDelta =
      typeof delta === "string"
        ? stripInlineDirectiveTagsForDisplay(delta, replyLanguage).text
        : "";
    const previousText = chatRunState.buffers.get(clientRunId) ?? "";
    const rawSnapshot = typeof text === "string" ? text : "";
    if (!cleanedText.trim() && rawSnapshot.trim()) {
      // Full snapshot is scratchpad. Drop any partial that leaked into the buffer
      // and retract a bubble the UI already painted from an earlier chunk.
      chatRunState.buffers.set(clientRunId, "");
      const hadBroadcast = Boolean(chatRunState.deltaLastBroadcastText.get(clientRunId)?.trim());
      if (hadBroadcast) {
        const now = Date.now();
        const retractPayload = {
          runId: clientRunId,
          sessionKey,
          seq,
          state: "delta" as const,
          retract: true,
          message: {
            role: "assistant",
            content: [{ type: "text", text: "" }],
            timestamp: now,
            ...(replyLanguage ? { replyLanguage } : {}),
          },
        };
        broadcastChat(sessionKey, retractPayload, { dropIfSlow: true });
        nodeSendToSession(sessionKey, "chat", retractPayload);
        chatRunState.deltaLastBroadcastLen.set(clientRunId, 0);
        chatRunState.deltaLastBroadcastText.set(clientRunId, "");
        chatRunState.deltaSentAt.set(clientRunId, now);
      }
      emitThinkingProgress(sessionKey, clientRunId, seq, rawSnapshot, sourceRunId);
      return;
    }
    const mergedText = applyUserVisibleOutputGate(
      resolveMergedAssistantText({
        previousText,
        nextText: cleanedText,
        nextDelta: cleanedDelta,
      }),
      { streaming: true },
    ).visibleText;
    if (!mergedText) {
      // Display strip often empties English CoT before Layer C arrives. Still emit
      // process-channel structure from the raw assistant text (never as delta message).
      const rawScratchpad =
        (typeof text === "string" ? text : "") ||
        (typeof delta === "string" ? delta : "") ||
        previousText;
      if (rawScratchpad.trim()) {
        emitThinkingProgress(sessionKey, clientRunId, seq, rawScratchpad, sourceRunId);
      }
      return;
    }
    // Keep raw merge in the buffer for subsequent deltas; strip only for the wire.
    chatRunState.buffers.set(clientRunId, mergedText);
    const deliveryText = stripAssistantScratchpadFromText(mergedText, replyLanguage);
    if (!deliveryText) {
      // Process channel: show structure + progress while Layer C delivery is empty.
      // Never broadcast raw English CoT / scratchpad as chat.delta message text.
      emitThinkingProgress(sessionKey, clientRunId, seq, mergedText || text, sourceRunId);
      return;
    }
    // Delivery started — clear process-channel throttle bookkeeping for this run.
    chatRunState.thinkingSentAt.delete(clientRunId);
    chatRunState.thinkingLastFingerprint.delete(clientRunId);
    if (isSilentReplyText(deliveryText, SILENT_REPLY_TOKEN)) {
      return;
    }
    if (isSilentReplyLeadFragment(deliveryText)) {
      return;
    }
    if (shouldHideHeartbeatChatOutput(clientRunId, sourceRunId)) {
      return;
    }
    if (!shouldBroadcastShorterDelivery(clientRunId, deliveryText)) {
      return;
    }
    const now = Date.now();
    const last = chatRunState.deltaSentAt.get(clientRunId) ?? 0;
    if (now - last < 150) {
      return;
    }
    chatRunState.deltaSentAt.set(clientRunId, now);
    chatRunState.deltaLastBroadcastLen.set(clientRunId, deliveryText.length);
    chatRunState.deltaLastBroadcastText.set(clientRunId, deliveryText);
    const payload = {
      runId: clientRunId,
      sessionKey,
      seq,
      state: "delta" as const,
      message: {
        role: "assistant",
        content: [{ type: "text", text: deliveryText }],
        timestamp: now,
        ...(replyLanguage ? { replyLanguage } : {}),
      },
    };
    broadcastChat(sessionKey, payload, { dropIfSlow: true });
    nodeSendToSession(sessionKey, "chat", payload);
  };

  const flushBufferedChatDeltaIfNeeded = (
    sessionKey: string,
    clientRunId: string,
    sourceRunId: string,
    seq: number,
  ) => {
    const replyLanguage = resolveRunReplyLanguage(clientRunId, sourceRunId);
    const bufferedText = applyUserVisibleOutputGate(
      stripInlineDirectiveTagsForDisplay(chatRunState.buffers.get(clientRunId) ?? "", replyLanguage)
        .text,
    ).visibleText.trim();
    const normalizedHeartbeatText = normalizeHeartbeatChatFinalText({
      runId: clientRunId,
      sourceRunId,
      text: bufferedText,
    });
    const text = stripAssistantScratchpadFromText(
      normalizedHeartbeatText.text,
      replyLanguage,
    ).trim();
    const shouldSuppressSilent =
      normalizedHeartbeatText.suppress || isSilentReplyText(text, SILENT_REPLY_TOKEN);
    const shouldSuppressSilentLeadFragment = isSilentReplyLeadFragment(text);
    const shouldSuppressHeartbeatStreaming = shouldHideHeartbeatChatOutput(
      clientRunId,
      sourceRunId,
    );
    if (!text) {
      chatRunState.buffers.set(clientRunId, "");
      return;
    }
    if (
      shouldSuppressSilent ||
      shouldSuppressSilentLeadFragment ||
      shouldSuppressHeartbeatStreaming
    ) {
      return;
    }

    if (!shouldBroadcastShorterDelivery(clientRunId, text)) {
      return;
    }

    const now = Date.now();
    const flushPayload = {
      runId: clientRunId,
      sessionKey,
      seq,
      state: "delta" as const,
      message: {
        role: "assistant",
        content: [{ type: "text", text }],
        timestamp: now,
        ...(replyLanguage ? { replyLanguage } : {}),
      },
    };
    broadcastChat(sessionKey, flushPayload, { dropIfSlow: true });
    nodeSendToSession(sessionKey, "chat", flushPayload);
    chatRunState.deltaLastBroadcastLen.set(clientRunId, text.length);
    chatRunState.deltaLastBroadcastText.set(clientRunId, text);
    chatRunState.deltaSentAt.set(clientRunId, now);
  };

  const emitChatFinal = (
    sessionKey: string,
    clientRunId: string,
    sourceRunId: string,
    seq: number,
    jobState: "done" | "error",
    error?: unknown,
    stopReason?: string,
  ) => {
    const replyLanguage = resolveRunReplyLanguage(clientRunId, sourceRunId);
    const bufferedText = stripAssistantScratchpadFromText(
      applyUserVisibleOutputGate(
        stripInlineDirectiveTagsForDisplay(
          chatRunState.buffers.get(clientRunId) ?? "",
          replyLanguage,
        ).text,
      ).visibleText,
      replyLanguage,
    ).trim();
    const normalizedHeartbeatText = normalizeHeartbeatChatFinalText({
      runId: clientRunId,
      sourceRunId,
      text: bufferedText,
    });
    const text = normalizedHeartbeatText.text.trim();
    let suppressReason: "heartbeat" | "silent_reply" | null = null;
    if (normalizedHeartbeatText.suppress) {
      suppressReason = "heartbeat";
    } else if (isSilentReplyText(text, SILENT_REPLY_TOKEN)) {
      suppressReason = "silent_reply";
    }
    const shouldSuppressSilent = suppressReason !== null;
    const visibility = shouldSuppressSilent ? "skipped" : "visible";
    // Flush any throttled delta so streaming clients receive the complete text
    // before the final event. The 150 ms throttle in emitChatDelta may have
    // suppressed the most recent chunk, leaving the client with stale text.
    // Only flush if the buffer has grown since the last broadcast to avoid duplicates.
    flushBufferedChatDeltaIfNeeded(sessionKey, clientRunId, sourceRunId, seq);
    chatRunState.deltaLastBroadcastLen.delete(clientRunId);
    chatRunState.deltaLastBroadcastText.delete(clientRunId);
    chatRunState.buffers.delete(clientRunId);
    chatRunState.deltaSentAt.delete(clientRunId);
    chatRunState.thinkingSentAt.delete(clientRunId);
    chatRunState.thinkingLastFingerprint.delete(clientRunId);

    const logChatFinalBroadcast = (payload: unknown, recipientCount: number) => {
      let payloadLen = 0;
      try {
        payloadLen = JSON.stringify(payload)?.length ?? 0;
      } catch {
        payloadLen = 0;
      }
      const fields = {
        runId: clientRunId,
        sessionKey,
        recipientCount,
        visibility,
        payloadLen,
        suppressReason,
      };
      if (recipientCount === 0 || visibility === "skipped") {
        log.warn("chat.final broadcast", fields);
      } else {
        log.info("chat.final broadcast", fields);
      }
    };

    if (jobState === "error" && isUnsupportedImageSoftFailure(errorTextForTerminal(error))) {
      const payload = {
        runId: clientRunId,
        sessionKey,
        seq,
        state: "final" as const,
        message: {
          role: "assistant",
          content: [{ type: "text", text: UNSUPPORTED_IMAGE_DIALOGUE }],
          timestamp: Date.now(),
        },
      };
      const recipientCount = Number(broadcastChat(sessionKey, payload) ?? 0);
      logChatFinalBroadcast(payload, recipientCount);
      nodeSendToSession(sessionKey, "chat", payload);
      return;
    }

    if (jobState === "done") {
      // Group bot runs emit on the child key; the parent `space:<groupId>`
      // `broadcastChatFinal` is the canonical visible final. A second final here
      // paints a duplicate bubble after the UI clears chatRunId.
      if (isCollaborationSpaceChildSessionKey(sessionKey)) {
        log.info("chat.final broadcast", {
          runId: clientRunId,
          sessionKey,
          recipientCount: 0,
          visibility: "skipped",
          suppressReason: "space_child_parent_canonical",
        });
        return;
      }
      let prepared: PreparedChatDeliverable | null = null;
      let visibleText = text;
      if (text && !shouldSuppressSilent && !isCollaborationGroupSessionKey(sessionKey)) {
        const identity = resolveDirectDeliverableIdentity(sessionKey, clientRunId, sourceRunId);
        prepared = prepareChatDeliverablePublish({
          text,
          publishIntent: "agent-run-final",
          sessionKey,
          tenantId: identity.tenantId,
          groupId: null,
          agentId: resolveSessionAgentId({ sessionKey }),
          userId: identity.userId,
          clientRunId,
          taskId: null,
        });
        visibleText = prepared.text;
      }
      const payload = {
        runId: clientRunId,
        sessionKey,
        seq,
        state: "final" as const,
        ...(stopReason && { stopReason }),
        message:
          visibleText && !shouldSuppressSilent
            ? {
                role: "assistant",
                content: [{ type: "text", text: visibleText }],
                timestamp: Date.now(),
                ...(replyLanguage ? { replyLanguage } : {}),
                ...(prepared?.structured ? { deliverablePublish: prepared.view } : {}),
              }
            : undefined,
      };
      const sendFinal = () => {
        const recipientCount = Number(broadcastChat(sessionKey, payload) ?? 0);
        logChatFinalBroadcast(payload, recipientCount);
        nodeSendToSession(sessionKey, "chat", payload);
      };
      if (prepared?.idempotencyKey && prepared.record) {
        const delivered = deliverPreparedChatFinal({ prepared, send: sendFinal });
        if (!delivered.ok) {
          log.warn("chat.final deliverable broadcast failed", { runId: clientRunId, sessionKey });
        }
        return;
      }
      sendFinal();
      return;
    }
    const payload = {
      runId: clientRunId,
      sessionKey,
      seq,
      state: "error" as const,
      errorMessage: error ? formatForLog(error) : undefined,
    };
    const recipientCount = Number(broadcastChat(sessionKey, payload) ?? 0);
    logChatFinalBroadcast(payload, recipientCount);
    nodeSendToSession(sessionKey, "chat", payload);
    noteUnresolvedChatRunError({
      sessionKey,
      errorMessage: payload.errorMessage,
    });
  };

  const resolveToolVerboseLevel = (runId: string, sessionKey?: string) => {
    const runContext = getAgentRunContext(runId);
    const runVerbose = normalizeVerboseLevel(runContext?.verboseLevel);
    if (runVerbose) {
      return runVerbose;
    }
    if (!sessionKey) {
      return "off";
    }
    try {
      const { cfg, entry } = loadSessionEntrySyncFallback(sessionKey);
      const sessionVerbose = normalizeVerboseLevel(entry?.verboseLevel);
      if (sessionVerbose) {
        return sessionVerbose;
      }
      const defaultVerbose = normalizeVerboseLevel(cfg.agents?.defaults?.verboseDefault);
      return defaultVerbose ?? "off";
    } catch {
      return "off";
    }
  };

  return (evt: AgentEventPayload) => {
    const chatLink = chatRunState.registry.peek(evt.runId);
    const eventSessionKey =
      typeof evt.sessionKey === "string" && evt.sessionKey.trim() ? evt.sessionKey : undefined;
    const isControlUiVisible = getAgentRunContext(evt.runId)?.isControlUiVisible ?? true;
    const sessionKey =
      chatLink?.sessionKey ?? eventSessionKey ?? resolveSessionKeyForRun(evt.runId);
    const clientRunId = chatLink?.clientRunId ?? evt.runId;
    const eventRunId = chatLink?.clientRunId ?? evt.runId;
    const eventForClients = chatLink ? { ...evt, runId: eventRunId } : evt;
    const isAborted =
      chatRunState.abortedRuns.has(clientRunId) || chatRunState.abortedRuns.has(evt.runId);
    // Include sessionKey so Control UI can filter tool streams per session.
    const agentPayload = sessionKey ? { ...eventForClients, sessionKey } : eventForClients;
    const last = agentRunSeq.get(evt.runId) ?? 0;
    const isToolEvent = evt.stream === "tool";
    const toolVerbose = isToolEvent ? resolveToolVerboseLevel(evt.runId, sessionKey) : "off";
    // Build tool payload: strip result/partialResult unless verbose=full
    const toolPayload =
      isToolEvent && toolVerbose !== "full"
        ? (() => {
            const data = evt.data ? { ...evt.data } : {};
            delete data.result;
            delete data.partialResult;
            return sessionKey
              ? { ...eventForClients, sessionKey, data }
              : { ...eventForClients, data };
          })()
        : agentPayload;
    if (evt.seq !== last + 1) {
      broadcast("agent", {
        runId: eventRunId,
        stream: "error",
        ts: Date.now(),
        sessionKey,
        data: {
          reason: "seq gap",
          expected: last + 1,
          received: evt.seq,
        },
      });
    }
    agentRunSeq.set(evt.runId, evt.seq);
    if (isToolEvent) {
      const toolPhase = typeof evt.data?.phase === "string" ? evt.data.phase : "";
      // Flush pending assistant text before tool-start events so clients can
      // render complete pre-tool text above tool cards (not truncated by delta throttle).
      if (toolPhase === "start" && isControlUiVisible && sessionKey && !isAborted) {
        flushBufferedChatDeltaIfNeeded(sessionKey, clientRunId, evt.runId, evt.seq);
        // The flushed text is progress narration. The reply buffer must not
        // keep it, or the post-tool answer concatenates into a second bubble.
        chatRunState.buffers.set(clientRunId, "");
      }
      // Always broadcast tool events to registered WS recipients with
      // tool-events capability, regardless of verboseLevel. The verbose
      // setting only controls whether tool details are sent as channel
      // messages to messaging surfaces (Telegram, Discord, etc.).
      const recipients = toolEventRecipients.get(evt.runId);
      if (recipients && recipients.size > 0) {
        broadcastToConnIds("agent", toolPayload, recipients);
      }
    } else {
      broadcast("agent", agentPayload);
    }

    const lifecyclePhase =
      evt.stream === "lifecycle" && typeof evt.data?.phase === "string" ? evt.data.phase : null;

    if (isControlUiVisible && sessionKey) {
      // Send tool events to node/channel subscribers only when verbose is enabled;
      // WS clients already received the event above via broadcastToConnIds.
      if (!isToolEvent || toolVerbose !== "off") {
        nodeSendToSession(sessionKey, "agent", isToolEvent ? toolPayload : agentPayload);
      }
      if (!isAborted && lifecyclePhase === "start") {
        // Early process-channel ACK before first assistant token / Layer C.
        // Empty scratchpad → default steps ("理解问题…" / "Understanding…").
        emitThinkingProgress(sessionKey, clientRunId, evt.seq, "", evt.runId);
      } else if (!isAborted && evt.stream === "assistant" && typeof evt.data?.text === "string") {
        markChatRunNotUndoable(chatAbortControllers, clientRunId);
        markChatRunNotUndoable(chatAbortControllers, evt.runId);
        emitChatDelta(sessionKey, clientRunId, evt.runId, evt.seq, evt.data.text, evt.data.delta);
      } else if (!isAborted && (lifecyclePhase === "end" || lifecyclePhase === "error")) {
        const evtStopReason =
          typeof evt.data?.stopReason === "string" ? evt.data.stopReason : undefined;
        const emitLifecycleFinal = () => {
          if (chatLink) {
            const finished = chatRunState.registry.shift(evt.runId);
            if (!finished) {
              // Landmine: shift can miss when registry already drained, but clients still
              // need chat.final. Emit anyway and warn for observability.
              log.warn("chat.final registry shift missed entry; emitting anyway", {
                runId: evt.runId,
                sessionKey,
                clientRunId,
              });
              emitChatFinal(
                sessionKey,
                clientRunId,
                evt.runId,
                evt.seq,
                lifecyclePhase === "error" ? "error" : "done",
                evt.data?.error,
                evtStopReason,
              );
            } else {
              emitChatFinal(
                finished.sessionKey,
                finished.clientRunId,
                evt.runId,
                evt.seq,
                lifecyclePhase === "error" ? "error" : "done",
                evt.data?.error,
                evtStopReason,
              );
            }
          } else {
            emitChatFinal(
              sessionKey,
              eventRunId,
              evt.runId,
              evt.seq,
              lifecyclePhase === "error" ? "error" : "done",
              evt.data?.error,
              evtStopReason,
            );
          }
        };
        const bufferedForRewrite = chatRunState.buffers.get(clientRunId) ?? "";
        const replyLanguage = resolveRunReplyLanguage(clientRunId, evt.runId);
        if (
          lifecyclePhase === "end" &&
          visibleReplyNeedsChineseRewrite(bufferedForRewrite, replyLanguage)
        ) {
          void enforceVisibleReplyLanguage({
            text: bufferedForRewrite,
            expectedLanguage: "zh",
            runId: evt.runId,
          }).then((rewritten) => {
            if (rewritten && rewritten !== bufferedForRewrite) {
              chatRunState.buffers.set(clientRunId, rewritten);
            }
            emitLifecycleFinal();
          });
        } else {
          emitLifecycleFinal();
        }
      } else if (isAborted && (lifecyclePhase === "end" || lifecyclePhase === "error")) {
        chatRunState.abortedRuns.delete(clientRunId);
        chatRunState.abortedRuns.delete(evt.runId);
        chatRunState.buffers.delete(clientRunId);
        chatRunState.deltaSentAt.delete(clientRunId);
        chatRunState.deltaLastBroadcastLen.delete(clientRunId);
        chatRunState.deltaLastBroadcastText.delete(clientRunId);
        chatRunState.thinkingSentAt.delete(clientRunId);
        chatRunState.thinkingLastFingerprint.delete(clientRunId);
        if (chatLink) {
          chatRunState.registry.remove(evt.runId, clientRunId, sessionKey);
        }
      }
    } else if (!isAborted && (lifecyclePhase === "end" || lifecyclePhase === "error")) {
      // Candidate 2: visibility/session gate skipped the whole chat.final emit block.
      log.warn("chat.final broadcast", {
        runId: clientRunId,
        sessionKey,
        visibility: "skipped",
        suppressReason: !isControlUiVisible ? "control_ui_invisible" : "missing_session_key",
      });
    }

    if (lifecyclePhase === "end" || lifecyclePhase === "error") {
      toolEventRecipients.markFinal(evt.runId);
      clearAgentRunContext(evt.runId);
      agentRunSeq.delete(evt.runId);
      agentRunSeq.delete(clientRunId);
    }
  };
}
