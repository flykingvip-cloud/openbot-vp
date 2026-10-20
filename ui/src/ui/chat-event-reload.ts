import type { AgentEventPayload } from "./app-tool-stream.ts";
import type { ChatCapabilityEventPayload } from "./capability/chat/index.ts";

function isSameChatTurnRunId(eventRunId: string, openRunId: string | null | undefined): boolean {
  const open = openRunId?.trim() ?? "";
  const event = eventRunId.trim();
  if (!open || !event) {
    return false;
  }
  return event === open || event.startsWith(`${open}:`);
}

function messageRole(message: unknown): string {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return "";
  }
  const role = (message as Record<string, unknown>).role;
  return typeof role === "string" ? role.trim().toLowerCase() : "";
}

/** True when an optimistic / live turn already has assistant rows on screen. */
export function hasLocalAssistantReplyForTurn(
  chatMessages: readonly unknown[],
  parentRunId: string,
): boolean {
  const turnUserId = `local-${parentRunId.trim()}`;
  let afterTurnUser = false;
  for (const message of chatMessages) {
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      continue;
    }
    const id = (message as Record<string, unknown>).id;
    if (typeof id === "string" && id === turnUserId) {
      afterTurnUser = true;
      continue;
    }
    if (afterTurnUser && messageRole(message) === "assistant") {
      return true;
    }
  }
  // Child bot finals may land after chatRunId cleared; accept trailing assistant rows.
  for (let index = chatMessages.length - 1; index >= 0; index -= 1) {
    const message = chatMessages[index];
    if (messageRole(message) === "user") {
      break;
    }
    if (messageRole(message) === "assistant") {
      return true;
    }
  }
  return false;
}

export function shouldSkipHistoryReloadForParentFinal(params: {
  payload?: ChatCapabilityEventPayload;
  chatMessages: readonly unknown[];
  chatRunId?: string | null;
}): boolean {
  if (!shouldReloadHistoryForFinalEvent(params.payload)) {
    return false;
  }
  const runId = typeof params.payload?.runId === "string" ? params.payload.runId.trim() : "";
  if (!runId) {
    return false;
  }
  if (params.payload?.message && typeof params.payload.message === "object") {
    return false;
  }
  if (params.chatRunId && isSameChatTurnRunId(runId, params.chatRunId)) {
    return hasLocalAssistantReplyForTurn(params.chatMessages, runId);
  }
  return hasLocalAssistantReplyForTurn(params.chatMessages, runId);
}

/** Primary gate: reload only when terminal rules say so AND local child rows are not already visible. */
export function shouldReloadShellChatHistoryForFinalEvent(params: {
  state: string | null | undefined;
  hadToolEvents: boolean;
  payload?: ChatCapabilityEventPayload;
  chatMessages: readonly unknown[];
  chatRunId?: string | null;
}): boolean {
  if (
    !shouldReloadHistoryForTerminalChatEvent({
      state: params.state,
      hadToolEvents: params.hadToolEvents,
      payload: params.payload,
    })
  ) {
    return false;
  }
  return !shouldSkipHistoryReloadForParentFinal({
    payload: params.payload,
    chatMessages: params.chatMessages,
    chatRunId: params.chatRunId,
  });
}

export type TerminalChatEventState = "final" | "error" | "aborted";

export function isTerminalChatEventState(
  state: string | null | undefined,
): state is TerminalChatEventState {
  return state === "final" || state === "error" || state === "aborted";
}

export function shouldReloadHistoryForFinalEvent(payload?: ChatCapabilityEventPayload): boolean {
  if (!payload || payload.state !== "final") {
    return false;
  }
  // chat.inject already appends via handleForeignRunFinalEvent; reloading drops it if the
  // optimistic row is not yet visible in chat.history (session rotation / persistence lag).
  if (typeof payload.runId === "string" && payload.runId.startsWith("inject-")) {
    return false;
  }
  if (!payload.message || typeof payload.message !== "object") {
    return true;
  }
  const message = payload.message as Record<string, unknown>;
  const role = typeof message.role === "string" ? message.role.toLowerCase() : "";
  if (role && role !== "assistant") {
    return true;
  }
  return false;
}

export function shouldReloadHistoryForTerminalChatEvent(params: {
  state: string | null | undefined;
  hadToolEvents: boolean;
  payload?: ChatCapabilityEventPayload;
}): boolean {
  if (!isTerminalChatEventState(params.state)) {
    return false;
  }
  if (params.hadToolEvents && params.state === "final") {
    return true;
  }
  if (params.state !== "final") {
    return false;
  }
  return shouldReloadHistoryForFinalEvent(params.payload);
}

export function shouldReloadHistoryForAgentToolResult(payload?: AgentEventPayload): boolean {
  const toolData = payload?.data;
  return (
    payload?.stream === "tool" && typeof toolData?.phase === "string" && toolData.phase === "result"
  );
}
