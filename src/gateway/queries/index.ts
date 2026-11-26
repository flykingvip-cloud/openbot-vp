/**
 * Gateway query modules — Phase 4 control-plane slimming.
 *
 * Isolated, read-only query modules extracted from the monolithic
 * gateway server-methods handlers. The control plane (thin routing/dispatch
 * layer) delegates heavy data retrieval through these modules instead of
 * mixing it with orchestration and state mutation.
 *
 * Import boundary enforced by `scripts/architecture/manifest.json`.
 */
export {
  listOwnedSessionArchives,
  boundChatHistoryMessages,
  readOwnedArchiveMessages,
  sanitizeChatHistoryMessagesForTest,
  sanitizeChatSendMessageInput,
  buildUserTranscriptContentBlocks,
  transcriptCreateDeniedMessage,
} from "./chat-history.js";
