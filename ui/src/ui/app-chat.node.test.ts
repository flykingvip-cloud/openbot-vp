import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleSendChat, isChatBusy, isChatSendInFlight, refreshChat } from "./app-chat.ts";
import * as appScroll from "./app-scroll.ts";
import { chatCapability } from "./capability/chat/index.ts";
import { sessionsCapability } from "./capability/sessions/index.ts";
import type { ChatQuoteDraft } from "./chat/quote-draft.ts";
import type { ChatAttachment, ChatQueueItem } from "./ui-types.ts";

function createSendHost(overrides: {
  chatMessage: string;
  chatQuoteDraft?: ChatQuoteDraft | null;
  chatAttachments?: ChatAttachment[];
}) {
  return {
    connected: true,
    chatSending: false,
    chatRunId: null as string | null,
    chatQueue: [] as ChatQueueItem[],
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

describe("handleSendChat mid-task delivery", () => {
  beforeEach(() => {
    vi.spyOn(appScroll, "scheduleChatScroll").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reaches chat.send while background run occupies chatRunId (does not FE-hold)", async () => {
    const send = vi.spyOn(chatCapability, "sendMessage").mockResolvedValue("run-b" as never);
    const host = createSendHost({ chatMessage: "进度如何？" });
    host.chatRunId = "run-a";
    host.chatSending = false;
    expect(isChatBusy(host as never)).toBe(true);
    expect(isChatSendInFlight(host as never)).toBe(false);

    await handleSendChat(host as never);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[3]).toMatchObject({ preserveActiveRunOccupancy: true });
    expect(host.chatQueue).toEqual([]);
  });

  it("still enqueues when chatSending (duplicate-submit guard)", async () => {
    const send = vi.spyOn(chatCapability, "sendMessage").mockResolvedValue("run-b" as never);
    const host = createSendHost({ chatMessage: "补充：只要国内" });
    host.chatRunId = "run-a";
    host.chatSending = true;

    await handleSendChat(host as never);

    expect(send).not.toHaveBeenCalled();
    expect(host.chatQueue).toHaveLength(1);
    expect(host.chatQueue[0]?.text).toContain("补充：只要国内");
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
