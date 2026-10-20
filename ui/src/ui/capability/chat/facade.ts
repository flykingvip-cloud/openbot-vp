import { sessionKeysShareChatSurface } from "../../chat-session-key-match.ts";
import {
  abortChatRun,
  type ChatAbortState,
  handleChatEvent,
  loadChatHistory,
  loadOlderChatHistory,
  refreshConversationTaskProgress,
  sendChatMessage,
  type ChatEventPayload,
  type ChatEventState,
  type ChatHistoryState,
  type ChatSendState,
} from "../../controllers/chat.ts";

export type ChatCapabilityEventPayload = ChatEventPayload;
export type ChatCapabilityHistoryState = ChatHistoryState;
export type ChatCapabilitySendState = ChatSendState;
export type ChatCapabilityAbortState = ChatAbortState;
export type ChatCapabilityEventState = ChatEventState;

/**
 * Transitional capability seam for conversation/work-session messaging.
 */
export const chatCapability = {
  abortRun: abortChatRun,
  handleEvent: handleChatEvent,
  loadHistory: async (
    state: ChatHistoryState,
    options?: { forceOpenComputerPreview?: boolean },
  ) => {
    const requestedKey = state.sessionKey;
    await loadChatHistory(state, options);
    if (
      requestedKey.trim() &&
      state.sessionKey.trim() &&
      !sessionKeysShareChatSurface(requestedKey, state.sessionKey)
    ) {
      return;
    }
    void refreshConversationTaskProgress(state);
  },
  loadOlderHistory: loadOlderChatHistory,
  sendMessage: sendChatMessage,
} as const;
