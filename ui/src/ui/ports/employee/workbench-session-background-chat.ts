import { extractText } from "../../chat/message-extract.ts";
import {
  readWorkbenchSessionTranscript,
  writeWorkbenchSessionTranscript,
} from "./workbench-session-transcript-cache.ts";

/** In-memory only: finished run ids must not be revived into occupancy. */
const finishedBackgroundRuns = new Set<string>();

function sameBackgroundRun(eventRunId: string | null | undefined, openRunId: string | null | undefined): boolean {
  const event = eventRunId?.trim() ?? "";
  const open = openRunId?.trim() ?? "";
  if (!event || !open) {
    return false;
  }
  return event === open || event.startsWith(`${open}:`) || open.startsWith(`${event}:`);
}

export function resetFinishedBackgroundWorkbenchRunsForTests(): void {
  finishedBackgroundRuns.clear();
}

export type BackgroundWorkbenchChatEvent = {
  runId?: string | null;
  sessionKey?: string | null;
  state?: string | null;
  message?: unknown;
  thinking?: unknown;
};

function asAssistantMessage(message: unknown, fallbackText: string): unknown {
  if (message && typeof message === "object" && !Array.isArray(message)) {
    const role = (message as { role?: unknown }).role;
    if (typeof role === "string" && role.trim().toLowerCase() === "assistant") {
      return message;
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
  if (eventRunId && finishedBackgroundRuns.has(eventRunId)) {
    return;
  }
  if (openRunId && eventRunId && !sameBackgroundRun(eventRunId, openRunId)) {
    // B's terminal or stream must not clear or overwrite A's occupancy.
    if (state === "final" || state === "aborted" || state === "error") {
      const assistant = asAssistantMessage(payload.message, streamText);
      if (assistant) {
        messages.push(assistant);
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
      if (eventRunId) {
        finishedBackgroundRuns.add(eventRunId);
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

  if (state === "final" || state === "aborted" || state === "error") {
    const assistant = asAssistantMessage(payload.message, streamText || existing?.chatStream || "");
    if (assistant) {
      messages.push(assistant);
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
