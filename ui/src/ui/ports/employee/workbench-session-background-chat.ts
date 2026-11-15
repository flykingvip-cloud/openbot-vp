import {
  CHAT_TURN_ERROR_UNCONFIRMED_TEXT,
  classifyInteractionFailure,
  formatInteractionFailureReply,
  INTERACTION_MODEL_FAILURE_TEXT,
  INTERACTION_QUEUE_TIMEOUT_TEXT,
  INTERACTION_TIMEOUT_TEXT,
} from "../../../../../src/agent-runtime/model/interaction-resource-wait.ts";
import { sanitizeUserFacingChatError } from "../../chat-error-sanitize.ts";
import { extractText } from "../../chat/message-extract.ts";
import { transcriptContainsChatError } from "../../chat/run-failure-transcript.ts";
import {
  readWorkbenchSessionTranscript,
  writeWorkbenchSessionTranscript,
} from "./workbench-session-transcript-cache.ts";

/** In-memory only: finished run ids must not be revived into occupancy. */
const finishedBackgroundRuns = new Set<string>();
/** In-memory only: a visible terminal was already written for this run. */
const displayedBackgroundTerminals = new Set<string>();

function sameBackgroundRun(
  eventRunId: string | null | undefined,
  openRunId: string | null | undefined,
): boolean {
  const event = eventRunId?.trim() ?? "";
  const open = openRunId?.trim() ?? "";
  if (!event || !open) {
    return false;
  }
  return event === open || event.startsWith(`${open}:`) || open.startsWith(`${event}:`);
}

function isTerminalChatState(state: string): boolean {
  return state === "final" || state === "aborted" || state === "error";
}

export function resetFinishedBackgroundWorkbenchRunsForTests(): void {
  finishedBackgroundRuns.clear();
  displayedBackgroundTerminals.clear();
}

export type BackgroundWorkbenchChatEvent = {
  runId?: string | null;
  sessionKey?: string | null;
  state?: string | null;
  message?: unknown;
  /** Production error events put the body here, not necessarily on message. */
  errorMessage?: string | null;
  /** Existing terminal protocol fact when the host provided one. */
  businessExecution?: "none" | "unknown";
  thinking?: unknown;
};

function asAssistantMessage(message: unknown, fallbackText: string): unknown {
  if (message && typeof message === "object" && !Array.isArray(message)) {
    const role = (message as { role?: unknown }).role;
    if (typeof role === "string" && role.trim().toLowerCase() === "assistant") {
      const text = extractText(message)?.trim() ?? "";
      if (text) {
        return message;
      }
    }
  }
  const text = fallbackText.trim();
  if (!text) {
    return undefined;
  }
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    timestamp: Date.now(),
  };
}

function isHostPreAdmissionTerminal(raw: string): boolean {
  return (
    raw === INTERACTION_TIMEOUT_TEXT ||
    raw === INTERACTION_MODEL_FAILURE_TEXT ||
    raw === INTERACTION_QUEUE_TIMEOUT_TEXT
  );
}

function visibleFailureText(raw: string, businessExecution?: "none" | "unknown"): string {
  if (businessExecution === "unknown") {
    return raw === CHAT_TURN_ERROR_UNCONFIRMED_TEXT
      ? raw
      : String(sanitizeUserFacingChatError(raw)).trim() || CHAT_TURN_ERROR_UNCONFIRMED_TEXT;
  }
  if (businessExecution === "none" || isHostPreAdmissionTerminal(raw)) {
    return formatInteractionFailureReply(raw);
  }
  const kind = classifyInteractionFailure(raw);
  if (kind === "queue_timeout") {
    return formatInteractionFailureReply(raw);
  }
  if (kind === "timeout" || kind === "empty") {
    // Timeout keywords alone cannot prove that admission never happened.
    return CHAT_TURN_ERROR_UNCONFIRMED_TEXT;
  }
  return String(sanitizeUserFacingChatError(raw)).trim() || raw;
}

function occupyingEmptyFallback(businessExecution?: "none" | "unknown"): string {
  return businessExecution === "none" ? INTERACTION_TIMEOUT_TEXT : CHAT_TURN_ERROR_UNCONFIRMED_TEXT;
}

/**
 * Project a visible terminal bubble. Occupying-run empty abort/timeout must
 * not stay silent. A control-only terminal on another run stays unsealed so a
 * later only-valid receipt can still land.
 */
function projectBackgroundTerminalAssistant(
  payload: BackgroundWorkbenchChatEvent,
  opts: { fallbackStream: string; occupyingRun: boolean },
): unknown {
  const state = payload.state?.trim() ?? "";
  const messageText = extractText(payload.message)?.trim() ?? "";
  const errorRaw = typeof payload.errorMessage === "string" ? payload.errorMessage.trim() : "";

  if (state === "error" || errorRaw) {
    const raw = errorRaw || messageText;
    if (raw) {
      return asAssistantMessage(
        payload.message,
        visibleFailureText(raw, payload.businessExecution),
      );
    }
    if (opts.occupyingRun) {
      return asAssistantMessage(undefined, occupyingEmptyFallback(payload.businessExecution));
    }
    return undefined;
  }

  if (state === "aborted") {
    if (messageText) {
      return asAssistantMessage(payload.message, messageText);
    }
    if (opts.occupyingRun) {
      return asAssistantMessage(undefined, occupyingEmptyFallback(payload.businessExecution));
    }
    return undefined;
  }

  const fromMessage = asAssistantMessage(payload.message, messageText);
  if (fromMessage) {
    return fromMessage;
  }
  const stream = opts.fallbackStream.trim();
  if (stream) {
    return asAssistantMessage(undefined, stream);
  }
  if (opts.occupyingRun) {
    return asAssistantMessage(undefined, occupyingEmptyFallback(payload.businessExecution));
  }
  return undefined;
}

function appendUniqueAssistant(messages: unknown[], assistant: unknown, rawHint: string): boolean {
  const text = extractText(assistant)?.trim() ?? "";
  if (!text) {
    return false;
  }
  if (
    transcriptContainsChatError(messages, rawHint || text) ||
    transcriptContainsChatError(messages, text)
  ) {
    return false;
  }
  messages.push(assistant);
  return true;
}

/**
 * While the open thread is another robot/group, keep this session's occupancy
 * in the transcript cache so switching back can restore the user instruction
 * and the in-flight compose state. Does not abort the gateway run.
 */
export function applyBackgroundWorkbenchChatEvent(payload: BackgroundWorkbenchChatEvent): void {
  const sessionKey = payload.sessionKey?.trim() ?? "";
  if (!sessionKey) {
    return;
  }
  const existing = readWorkbenchSessionTranscript(sessionKey);
  const messages = existing?.messages.slice() ?? [];
  const state = payload.state?.trim() ?? "";
  const streamText = extractText(payload.message) ?? "";
  const eventRunId = payload.runId?.trim() || null;
  const openRunId = existing?.chatRunId?.trim() || null;
  const terminal = isTerminalChatState(state);
  if (eventRunId && displayedBackgroundTerminals.has(eventRunId)) {
    return;
  }
  if (eventRunId && finishedBackgroundRuns.has(eventRunId) && !terminal) {
    return;
  }
  const occupyingRun = Boolean(openRunId && eventRunId && sameBackgroundRun(eventRunId, openRunId));
  if (openRunId && eventRunId && !sameBackgroundRun(eventRunId, openRunId)) {
    // B's terminal or stream must not clear or overwrite A's occupancy.
    if (terminal) {
      const assistant = projectBackgroundTerminalAssistant(payload, {
        fallbackStream: "",
        occupyingRun: false,
      });
      if (assistant) {
        const hint =
          (typeof payload.errorMessage === "string" ? payload.errorMessage.trim() : "") ||
          extractText(assistant) ||
          "";
        if (appendUniqueAssistant(messages, assistant, hint)) {
          writeWorkbenchSessionTranscript(sessionKey, {
            ...existing,
            messages,
            chatRunId: openRunId,
            chatStream: existing?.chatStream ?? null,
            chatStreamStartedAt: existing?.chatStreamStartedAt ?? null,
            chatStreamSessionKey: existing?.chatStreamSessionKey ?? sessionKey,
            chatThinkingProgress: existing?.chatThinkingProgress ?? null,
          });
        }
        displayedBackgroundTerminals.add(eventRunId);
      }
    }
    return;
  }

  if (state === "thinking") {
    if (!openRunId && eventRunId && finishedBackgroundRuns.has(eventRunId)) {
      return;
    }
    writeWorkbenchSessionTranscript(sessionKey, {
      messages,
      chatHistoryNextBefore: existing?.chatHistoryNextBefore,
      chatHistoryHasMore: existing?.chatHistoryHasMore,
      chatRunId: payload.runId ?? existing?.chatRunId ?? null,
      chatStream: existing?.chatStream ?? "",
      chatStreamStartedAt: existing?.chatStreamStartedAt ?? Date.now(),
      chatStreamSessionKey: sessionKey,
      chatThinkingProgress: payload.thinking ?? existing?.chatThinkingProgress ?? null,
    });
    return;
  }

  if (state === "delta") {
    if (!openRunId && eventRunId && finishedBackgroundRuns.has(eventRunId)) {
      return;
    }
    writeWorkbenchSessionTranscript(sessionKey, {
      messages,
      chatHistoryNextBefore: existing?.chatHistoryNextBefore,
      chatHistoryHasMore: existing?.chatHistoryHasMore,
      chatRunId: payload.runId ?? existing?.chatRunId ?? null,
      chatStream: streamText || existing?.chatStream || "",
      chatStreamStartedAt: existing?.chatStreamStartedAt ?? Date.now(),
      chatStreamSessionKey: sessionKey,
      chatThinkingProgress: streamText.trim() ? null : (existing?.chatThinkingProgress ?? null),
    });
    return;
  }

  if (terminal) {
    const assistant = projectBackgroundTerminalAssistant(payload, {
      fallbackStream: streamText || existing?.chatStream || "",
      occupyingRun,
    });
    if (assistant) {
      const hint =
        (typeof payload.errorMessage === "string" ? payload.errorMessage.trim() : "") ||
        extractText(assistant) ||
        "";
      appendUniqueAssistant(messages, assistant, hint);
      if (eventRunId) {
        displayedBackgroundTerminals.add(eventRunId);
      }
    }
    if (eventRunId) {
      finishedBackgroundRuns.add(eventRunId);
    }
    writeWorkbenchSessionTranscript(sessionKey, {
      messages,
      chatHistoryNextBefore: existing?.chatHistoryNextBefore ?? null,
      chatHistoryHasMore: existing?.chatHistoryHasMore ?? false,
      chatRunId: null,
      chatStream: null,
      chatStreamStartedAt: null,
      chatStreamSessionKey: null,
      chatThinkingProgress: null,
    });
  }
}
