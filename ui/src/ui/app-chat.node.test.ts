import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleSendChat, refreshChat } from "./app-chat.ts";
import * as appScroll from "./app-scroll.ts";
import { chatCapability } from "./capability/chat/index.ts";
import { sessionsCapability } from "./capability/sessions/index.ts";
import type { ChatQuoteDraft } from "./chat/quote-draft.ts";
import type { ChatAttachment } from "./ui-types.ts";

function createSendHost(overrides: {
  chatMessage: string;
  chatQuoteDraft?: ChatQuoteDraft | null;
  chatAttachments?: ChatAttachment[];
}) {
  return {
    connected: true,
    chatSending: false,
    chatRunId: null,
    chatQueue: [],
    chatMessage: overrides.chatMessage,
    chatQuoteDraft: overrides.chatQuoteDraft ?? null,
    chatAttachments: overrides.chatAttachments ?? [],
    refreshSessionsAfterChat: new Set<string>(),
    settings: { gatewayUrl: "ws://127.0.0.1:18789", sessionKey: "agent:main:main" },
    sessionKey: "agent:main:main",
    applySettings: vi.fn(),
    toolStreamById: new Map(),
    toolStreamOrder: [],
    chatToolMessages: [],
    toolStreamSyncTimer: null,
    updateComplete: Promise.resolve(),
    querySelector: () => null,
    style: {} as CSSStyleDeclaration,
    chatScrollFrame: null,
    chatScrollTimeout: null,
    chatHasAutoScrolled: false,
    chatUserNearBottom: true,
    chatNewMessagesBelow: false,
    logsScrollFrame: null,
    logsAtBottom: true,
    topbarObserver: null,
  };
}

describe("handleSendChat", () => {
  beforeEach(() => {
    vi.spyOn(appScroll, "scheduleChatScroll").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
  it("restores quote draft when a direct send fails", async () => {
    vi.spyOn(chatCapability, "sendMessage").mockResolvedValue(undefined as never);

    const quote: ChatQuoteDraft = { messageId: "m-1", excerpt: "@市场助手 请检查" };
    const host = createSendHost({
      chatMessage: "为什么？",
      chatQuoteDraft: quote,
    });

    await handleSendChat(host as never);

    expect(host.chatMessage).toBe("为什么？");
    expect(host.chatQuoteDraft).toEqual(quote);
    expect(host.chatAttachments).toEqual([]);
  });

  it("restores draft, attachments, and quote draft together on send failure", async () => {
    vi.spyOn(chatCapability, "sendMessage").mockResolvedValue(undefined as never);

    const quote: ChatQuoteDraft = { messageId: "m-2", excerpt: "引用摘要" };
    const attachments: ChatAttachment[] = [
      {
        id: "att-1",
        dataUrl: "data:text/plain;base64,dGVzdA==",
        mimeType: "text/plain",
        fileName: "note.txt",
        status: "ready",
      },
    ];
    const host = createSendHost({
      chatMessage: "请继续",
      chatQuoteDraft: quote,
      chatAttachments: attachments,
    });

    await handleSendChat(host as never);

    expect(host.chatMessage).toBe("请继续");
    expect(host.chatQuoteDraft).toEqual(quote);
    expect(host.chatAttachments).toEqual(attachments);
  });
});

describe("refreshChat", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads checkpoints alongside history on connect/tab refresh", async () => {
    vi.spyOn(chatCapability, "loadHistory").mockResolvedValue(undefined as never);
    vi.spyOn(sessionsCapability, "load").mockResolvedValue(undefined as never);
    vi.spyOn(appScroll, "scheduleChatScroll").mockImplementation(() => {});
    const loadChatCheckpoints = vi.fn().mockResolvedValue(undefined);
    const host = {
      ...createSendHost({ chatMessage: "" }),
      chatLoading: false,
      chatMessages: [],
      chatHistoryNextBefore: null,
      chatHistoryHasMore: false,
      chatHistoryLoadingMore: false,
      chatThinkingLevel: null,
      hello: null,
      basePath: "",
      assistantName: "",
      assistantAvatar: null,
      assistantAgentId: null,
      loadChatCheckpoints,
    };
    // refreshChatAvatar may call into network; stub via missing hello is ok
    await refreshChat(host as never, { scheduleScroll: false });
    expect(loadChatCheckpoints).toHaveBeenCalledTimes(1);
    expect(chatCapability.loadHistory).toHaveBeenCalledWith(expect.anything(), {
      forceOpenComputerPreview: true,
    });
  });
});
