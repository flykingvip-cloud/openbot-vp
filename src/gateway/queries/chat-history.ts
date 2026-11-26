/**
 * Chat history query facade — Phase 4 control-plane slimming.
 *
 * Re-exports the chat-history read-only query functions from
 * `server-methods/chat.ts` through an isolated import boundary.
 * New consumers MUST import from this module rather than reaching
 * into the monolithic `server-methods/chat` handler bundle.
 *
 * Future work will move implementations here; until then the
 * manifest rule `gateway-queries-chat-history-boundary` prevents
 * new direct imports of these symbols from the handler file.
 */
export {
  /** List archived transcripts for a given agent that belong to the caller (cwd-gated). */
  listOwnedSessionArchives,
  /** Shared history bounding / sanitization pipeline (live + archived transcripts). */
  boundChatHistoryMessages,
  /** Read a specific archived transcript, enforcing filename + path + cwd-ownership gates. */
  readOwnedArchiveMessages,
  /** Test-only variant of history sanitization. */
  sanitizeChatHistoryMessagesForTest,
  /** Sanitize raw user chat-send message input. */
  sanitizeChatSendMessageInput,
  /** Build user transcript content blocks from chat-send params. */
  buildUserTranscriptContentBlocks,
  /** Create a human-readable denial message for transcript creation failures. */
  transcriptCreateDeniedMessage,
} from "../server-methods/chat.js";
