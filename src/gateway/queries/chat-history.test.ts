import { describe, expect, it } from "vitest";

/**
 * Phase 4 control-plane slimming: verify the query facade re-exports
 * are resolvable. These are sanity checks — the real behavior tests
 * live alongside the implementations in server-methods/chat.test.ts.
 */
describe("gateway/queries/chat-history facade", () => {
  it("re-exports listOwnedSessionArchives", async () => {
    const mod = await import("./chat-history.js");
    expect(typeof mod.listOwnedSessionArchives).toBe("function");
  });

  it("re-exports boundChatHistoryMessages", async () => {
    const mod = await import("./chat-history.js");
    expect(typeof mod.boundChatHistoryMessages).toBe("function");
  });

  it("re-exports readOwnedArchiveMessages", async () => {
    const mod = await import("./chat-history.js");
    expect(typeof mod.readOwnedArchiveMessages).toBe("function");
  });

  it("re-exports sanitizeChatHistoryMessagesForTest", async () => {
    const mod = await import("./chat-history.js");
    expect(typeof mod.sanitizeChatHistoryMessagesForTest).toBe("function");
  });

  it("re-exports sanitizeChatSendMessageInput", async () => {
    const mod = await import("./chat-history.js");
    expect(typeof mod.sanitizeChatSendMessageInput).toBe("function");
  });

  it("re-exports buildUserTranscriptContentBlocks", async () => {
    const mod = await import("./chat-history.js");
    expect(typeof mod.buildUserTranscriptContentBlocks).toBe("function");
  });

  it("re-exports transcriptCreateDeniedMessage", async () => {
    const mod = await import("./chat-history.js");
    expect(typeof mod.transcriptCreateDeniedMessage).toBe("function");
  });
});

describe("gateway/queries/index barrel", () => {
  it("re-exports everything from the chat-history facade", async () => {
    const barrel = await import("./index.js");
    const chatHistory = await import("./chat-history.js");
    for (const key of Object.keys(chatHistory)) {
      expect(barrel).toHaveProperty(key);
    }
  });
});
