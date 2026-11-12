import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MentionMetadata } from "../../../../src/organization/mention-types.js";
import type {
  RuntimeIdentity,
  RuntimeOrganizationContext,
} from "../../../../src/organization/runtime.js";
import { DEFAULT_CHAT_CONTEXT_SCOPE } from "../chat/context-scope.ts";
import {
  readWorkbenchSessionTranscript,
  resetWorkbenchSessionTranscriptCacheForTests,
} from "../ports/employee/workbench-session-transcript-cache.ts";
import {
  messageTriggersComputerPreview,
  resetAccountComputerPreviewForTests,
} from "../views/account-computer-preview.ts";
import {
  clearAssetSuggestionDismissalsForTests,
  dismissAssetSuggestion,
} from "./asset-incubation/suggestion-dismiss.ts";
import {
  __test,
  abortChatRun,
  handleChatEvent,
  loadChatHistory,
  loadOlderChatHistory,
  sendChatMessage,
  type ChatEventPayload,
  type ChatState,
} from "./chat.ts";

function createState(overrides: Partial<ChatState> = {}): ChatState {
  return {
    chatAttachments: [],
    chatLoading: false,
    chatHistoryNextBefore: null,
    chatHistoryHasMore: false,
    chatHistoryLoadingMore: false,
    chatMessage: "",
    chatMessages: [],
    chatRunId: null,
    chatSending: false,
    chatStream: null,
    chatStreamStartedAt: null,
    chatStreamSessionKey: null,
    chatThinkingProgress: null,
    chatThinkingLevel: null,
    client: null,
    connected: true,
    lastError: null,
    sessionKey: "main",
    ...overrides,
  };
}

function createRuntimeIdentity(overrides: Partial<RuntimeIdentity> = {}): RuntimeIdentity {
  return {
    agentId: overrides.agentId ?? "sender",
    displayName: overrides.displayName ?? "Sender",
    permissions: overrides.permissions ?? [],
    reachableAgents: overrides.reachableAgents ?? [],
    identitySource: overrides.identitySource ?? "fallback",
    capabilities: overrides.capabilities ?? [],
    ...overrides,
  };
}

function createOrganizationContext(
  overrides: Partial<RuntimeOrganizationContext> = {},
): RuntimeOrganizationContext {
  const self = overrides.self ?? createRuntimeIdentity();
  return {
    self,
    members: overrides.members ?? [
      self,
      {
        agentId: "agent-a",
        displayName: "Agent A",
      },
    ],
    coordinator: overrides.coordinator,
    organization: overrides.organization,
    activeProject: overrides.activeProject,
    activeTasks: overrides.activeTasks,
  };
}

function createMention(overrides: Partial<MentionMetadata> = {}): MentionMetadata {
  return {
    mention_id: overrides.mention_id ?? "mention-1",
    agentId: overrides.agentId ?? "agent-a",
    displayName: overrides.displayName ?? "Agent A",
    offset: overrides.offset ?? 3,
    length: overrides.length ?? 8,
  };
}

beforeEach(() => {
  __test.resetLegacyChatHistoryIncludeToolsUnsupported();
  __test.resetTerminalChatRuns();
});

describe("handleChatEvent", () => {
  it("clears an English progress sentence once scratchpad stripping removes it", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "I have the full paper text",
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "delta",
      message: {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "I have the full paper text and OpenBot's self-evolution docs. Now writing the WeChat article.",
          },
        ],
      },
    };
    expect(handleChatEvent(state, payload)).toBe("delta");
    expect(state.chatStream).toBe("");
  });

  it("returns null when payload is missing", () => {
    const state = createState();
    expect(handleChatEvent(state, undefined)).toBe(null);
  });

  it("returns null when sessionKey does not match", () => {
    const state = createState({ sessionKey: "main" });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "other",
      state: "final",
    };
    expect(handleChatEvent(state, payload)).toBe(null);
  });

  it("accepts steward employee remapped sessionKey as equivalent to main for the same user", () => {
    const state = createState({
      sessionKey: "main",
      stewardMainSessionKey: "agent:main:employee:alice",
      chatRunId: "run-1",
      chatMessages: [],
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "agent:main:employee:alice",
      state: "final",
      message: { role: "assistant", content: [{ type: "text", text: "你好" }] },
    };
    expect(handleChatEvent(state, payload)).toBe("final");
  });

  it("paints steward finals while the open URL still holds agent:main", () => {
    const state = createState({
      sessionKey: "agent:main",
      stewardMainSessionKey: "agent:main:employee:alice",
      chatRunId: "run-1",
      chatMessages: [],
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "agent:main:employee:alice",
      state: "final",
      message: { role: "assistant", content: [{ type: "text", text: "现场生效" }] },
    };
    expect(handleChatEvent(state, payload)).toBe("final");
    expect(state.chatMessages.at(-1)).toMatchObject({ role: "assistant" });
  });

  it("rejects another employee's steward chat events even when UI holds main", () => {
    const state = createState({
      sessionKey: "main",
      stewardMainSessionKey: "agent:main:employee:alice",
      chatRunId: "run-1",
      chatMessages: [],
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "agent:main:employee:bob",
      state: "final",
      message: { role: "assistant", content: [{ type: "text", text: "串话" }] },
    };
    expect(handleChatEvent(state, payload)).toBe(null);
    expect(state.chatMessages).toEqual([]);
  });

  it("rejects cross-user employee steward keys when both sides are remapped", () => {
    const state = createState({
      sessionKey: "agent:main:employee:alice",
      stewardMainSessionKey: "agent:main:employee:alice",
      chatRunId: "run-1",
      chatMessages: [],
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "agent:main:employee:bob",
      state: "final",
      message: { role: "assistant", content: [{ type: "text", text: "串话" }] },
    };
    expect(handleChatEvent(state, payload)).toBe(null);
  });

  it("accepts steward employee remapped sessionKey as equivalent to main", () => {
    const state = createState({
      sessionKey: "main",
      stewardMainSessionKey: "agent:main:employee:alice",
      chatRunId: "run-1",
      chatMessages: [],
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "agent:main:employee:alice",
      state: "final",
      message: { role: "assistant", content: [{ type: "text", text: "你好" }] },
    };
    expect(handleChatEvent(state, payload)).toBe("final");
  });

  it("never applies another bot's chat events onto the steward transcript", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatMessages: [],
      chatStream: null,
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "agent:bot-skill:main",
      state: "final",
      message: { role: "assistant", content: [{ type: "text", text: "skill reply" }] },
    };
    expect(handleChatEvent(state, payload)).toBe(null);
    expect(state.chatMessages).toEqual([]);
  });

  it("returns null for delta from another run", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-user",
      chatStream: "Hello",
    });
    const payload: ChatEventPayload = {
      runId: "run-announce",
      sessionKey: "main",
      state: "delta",
      message: { role: "assistant", content: [{ type: "text", text: "Done" }] },
    };
    expect(handleChatEvent(state, payload)).toBe(null);
    expect(state.chatRunId).toBe("run-user");
    expect(state.chatStream).toBe("Hello");
  });

  it("keeps the in-flight turn open when :user persist-ack arrives", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "",
      chatStreamStartedAt: 50,
    });
    const payload: ChatEventPayload = {
      runId: "run-1:user",
      sessionKey: "main",
      state: "user_echo",
      message: { role: "user", content: [{ type: "text", text: "hi" }] },
    };
    expect(handleChatEvent(state, payload)).toBe("user_echo");
    expect(state.chatRunId).toBe("run-1");
    expect(state.chatStream).toBe("");
    expect(state.chatStreamStartedAt).toBe(50);
    expect(state.chatMessages).toEqual([]);
  });

  it("accepts collaboration space events from a per-bot child sessionKey", () => {
    const state = createState({
      sessionKey: "space:grp-demo",
      chatRunId: "run-round",
      chatStream: null,
      chatMessages: [],
    });
    const payload: ChatEventPayload = {
      runId: "run-round:bot--agent",
      sessionKey: "agent:bot--agent:main:space:grp-demo",
      state: "delta",
      message: { role: "assistant", content: [{ type: "text", text: "在" }] },
    };
    expect(handleChatEvent(state, payload)).toBe("delta");
    expect(state.chatStream).toBe("在");
    expect(state.chatStreamSessionKey).toBe("agent:bot--agent:main:space:grp-demo");
  });

  it("clears thinking and stop when chat.final arrives for the open run", () => {
    const state = createState({
      sessionKey: "agent:market:main",
      chatRunId: "a0fcdff0-813a-4c95-9615-00146241d4aa",
      chatStream: "",
      chatStreamStartedAt: 1_700_000_000_000,
      chatThinkingProgress: {
        steps: [],
        activeIndex: 0,
        percent: 8,
        placeholder: "正在思考",
      },
      workProgressPhase: "thinking",
      workProgressToolsInFlight: 1,
      workProgressNarration: "打开京东",
      chatMessages: [],
    });
    const host = state as ChatState & { sidebarOpen: boolean; sidebarSurface: string };
    host.sidebarOpen = true;
    host.sidebarSurface = "computer";

    expect(
      handleChatEvent(host, {
        runId: "a0fcdff0-813a-4c95-9615-00146241d4aa",
        sessionKey: "agent:market:main",
        state: "final",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "请回复确认要点 1，我就开始排版。" }],
        },
      }),
    ).toBe("final");

    expect(host.chatMessages.at(-1)).toMatchObject({ role: "assistant" });
    expect(host.chatRunId).toBeNull();
    expect(host.chatStream).toBeNull();
    expect(host.chatStreamStartedAt).toBeNull();
    expect(host.chatThinkingProgress).toBeNull();
    expect(host.workProgressPhase).toBeNull();
    expect(host.workProgressToolsInFlight).toBe(0);
    expect(host.workProgressNarration).toBeNull();
    expect(host.sidebarOpen).toBe(true);
    expect(host.sidebarSurface).toBe("computer");
  });

  it("accepts group child runId finals on the parent chatRunId", () => {
    const state = createState({
      sessionKey: "space:grp-demo",
      chatRunId: "run-round",
      chatStream: "在",
      chatMessages: [],
    });
    const payload: ChatEventPayload = {
      runId: "run-round:bot-2",
      sessionKey: "space:grp-demo",
      state: "final",
      message: { role: "assistant", content: [{ type: "text", text: "在的" }] },
    };
    expect(handleChatEvent(state, payload)).toBe("final");
    expect(state.chatMessages).toEqual([
      expect.objectContaining({
        role: "assistant",
        agentId: "bot-2",
        content: [{ type: "text", text: "在的" }],
      }),
    ]);
  });

  it("stamps senderLabel and agentId onto space finals from collab event fields", () => {
    const state = createState({
      sessionKey: "space:grp-demo",
      chatRunId: "run-round",
      chatStream: "在",
      chatMessages: [],
    });
    const payload: ChatEventPayload = {
      runId: "run-round:bot-2",
      sessionKey: "space:grp-demo",
      state: "final",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "在的" }],
        senderLabel: "市场助手",
        agentId: "bot-2",
      },
    };
    expect(handleChatEvent(state, payload)).toBe("final");
    expect(state.chatMessages[0]).toMatchObject({
      senderLabel: "市场助手",
      agentId: "bot-2",
    });
  });

  it("ignores error events from background runs when chatRunId is idle", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: null,
      lastError: null,
    });
    const payload: ChatEventPayload = {
      runId: "run-background",
      sessionKey: "main",
      state: "error",
      errorMessage: "Error [ERR_MODULE_NOT_FOUND]: missing chunk",
    };
    expect(handleChatEvent(state, payload)).toBe(null);
    expect(state.lastError).toBeNull();
  });

  it("turns an unsupported-image error into assistant dialogue and skips the danger banner", () => {
    const state = createState({
      sessionKey: "agent:bot-2:main",
      chatRunId: "run-image",
      lastError: null,
    });
    const payload: ChatEventPayload = {
      runId: "run-image",
      sessionKey: "agent:bot-2:main",
      state: "error",
      errorMessage:
        '400: {"message":".messages[2]: You have uploaded an unsupported image. Please make sure your image is valid and has one of the following formats: webp, png, jpeg, and gif. (request_id: sha256:9994dc88d38b)","type":"invalid_request_error"}',
    };
    expect(handleChatEvent(state, payload)).toBe("error");
    expect(state.lastError).toBeNull();
    const text = JSON.stringify(state.chatMessages);
    expect(text).toContain("png、jpeg、gif 和 webp");
    expect(text).not.toContain("invalid_request_error");
  });

  it("shows a protocol JSON failure as a short reply and not the raw SyntaxError", () => {
    const state = createState({
      sessionKey: "agent:main:employee:usr-ceo",
      chatRunId: "run-protocol",
      lastError: null,
      chatMessages: [{ role: "user", content: "你好，请告诉我今天是星期几" }],
    });
    const raw = `SyntaxError: Unexpected token '今', "今天是 2026 年"... is not valid JSON`;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(
      handleChatEvent(state, {
        runId: "run-protocol",
        sessionKey: "agent:main:employee:usr-ceo",
        state: "error",
        errorMessage: raw,
      }),
    ).toBe("error");
    expect(state.chatRunId).toBeNull();
    expect(state.lastError).toBeNull();
    const visible = state.chatMessages.map((message) => JSON.stringify(message)).join("\n");
    expect(visible).toContain("没有开始任务");
    expect(visible).not.toContain("SyntaxError");
    expect(visible).not.toContain("is not valid JSON");
    expect(visible).not.toContain("今天是 2026 年");
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("puts an active run error in the transcript and leaves the crash rail clear", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "",
      lastError: "previous send failure",
      chatMessages: [{ role: "user", content: "继续执行你的任务" }],
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "error",
      errorMessage: "Cannot read properties of undefined (reading 'length')",
    };
    expect(handleChatEvent(state, payload)).toBe("error");
    expect(state.lastError).toBe("previous send failure");
    expect(state.chatRunId).toBeNull();
    expect(state.chatMessages.map((message) => JSON.stringify(message)).join("\n")).toContain(
      "服务暂时不可用",
    );
    expect(
      state.chatMessages.filter((message) => JSON.stringify(message).includes("服务暂时不可用")),
    ).toHaveLength(1);
    expect(JSON.stringify(state.chatMessages)).not.toContain("reading 'length'");
  });

  it("ignores NO_REPLY delta updates", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "Hello",
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "delta",
      message: { role: "assistant", content: [{ type: "text", text: "NO_REPLY" }] },
    };

    expect(handleChatEvent(state, payload)).toBe("delta");
    expect(state.chatStream).toBe("Hello");
  });

  it("appends final payload from another run without clearing active stream", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-user",
      chatStream: "Working...",
      chatStreamStartedAt: 123,
    });
    const payload: ChatEventPayload = {
      runId: "run-announce",
      sessionKey: "main",
      state: "final",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Sub-agent findings" }],
      },
    };
    expect(handleChatEvent(state, payload)).toBe(null);
    expect(state.chatRunId).toBe("run-user");
    expect(state.chatStream).toBe("Working...");
    expect(state.chatStreamStartedAt).toBe(123);
    expect(state.chatMessages).toHaveLength(1);
    expect(state.chatMessages[0]).toEqual(payload.message);
  });

  it("drops NO_REPLY final payload from another run without clearing active stream", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-user",
      chatStream: "Working...",
      chatStreamStartedAt: 123,
    });
    const payload: ChatEventPayload = {
      runId: "run-announce",
      sessionKey: "main",
      state: "final",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "NO_REPLY" }],
      },
    };

    expect(handleChatEvent(state, payload)).toBe("final");
    expect(state.chatRunId).toBe("run-user");
    expect(state.chatStream).toBe("Working...");
    expect(state.chatStreamStartedAt).toBe(123);
    expect(state.chatMessages).toEqual([]);
  });

  it("returns final for another run when payload has no message", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-user",
      chatStream: "Working...",
      chatStreamStartedAt: 123,
    });
    const payload: ChatEventPayload = {
      runId: "run-announce",
      sessionKey: "main",
      state: "final",
    };
    expect(handleChatEvent(state, payload)).toBe("final");
    expect(state.chatRunId).toBe("run-user");
    expect(state.chatMessages).toEqual([]);
  });

  it("persists streamed text when final event carries no message", () => {
    const existingMessage = {
      role: "user",
      content: [{ type: "text", text: "Hi" }],
      timestamp: 1,
    };
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "Here is my reply",
      chatStreamStartedAt: 100,
      chatMessages: [existingMessage],
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "final",
    };
    expect(handleChatEvent(state, payload)).toBe("final");
    expect(state.chatRunId).toBe(null);
    expect(state.chatStream).toBe(null);
    expect(state.chatStreamStartedAt).toBe(null);
    expect(state.chatMessages).toHaveLength(2);
    expect(state.chatMessages[0]).toEqual(existingMessage);
    expect(state.chatMessages[1]).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "Here is my reply" }],
    });
  });

  it("does not persist empty or whitespace-only stream on final", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "   ",
      chatStreamStartedAt: 100,
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "final",
    };
    expect(handleChatEvent(state, payload)).toBe("final");
    expect(state.chatRunId).toBe(null);
    expect(state.chatStream).toBe(null);
    expect(state.chatMessages).toEqual([]);
  });

  it("does not persist null stream on final with no message", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: null,
      chatStreamStartedAt: 100,
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "final",
    };
    expect(handleChatEvent(state, payload)).toBe("final");
    expect(state.chatMessages).toEqual([]);
  });

  it("removes the optimistic user row when an undo abort event arrives", () => {
    const optimistic = {
      id: "local-run-1",
      role: "user",
      content: [{ type: "text", text: "sent by mistake" }],
      timestamp: 1,
    };
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "",
      chatStreamStartedAt: 100,
      chatMessages: [optimistic],
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "aborted",
      mode: "undo",
      userMessageId: "local-run-1",
    };

    expect(handleChatEvent(state, payload)).toBe("aborted");
    expect(state.chatRunId).toBe(null);
    expect(state.chatStream).toBe(null);
    expect(state.chatMessages).toEqual([]);
  });

  it("prefers final payload message over streamed text", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "Streamed partial",
      chatStreamStartedAt: 100,
    });
    const finalMsg = {
      role: "assistant",
      content: [{ type: "text", text: "Complete reply" }],
      timestamp: 101,
    };
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "final",
      message: finalMsg,
    };
    expect(handleChatEvent(state, payload)).toBe("final");
    expect(state.chatMessages).toEqual([finalMsg]);
    expect(state.chatStream).toBe(null);
  });

  it("projects standalone assistant markdown documents as preview artifacts", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
    });
    const article = [
      "# 《Google创始人亲自下令：不会用AI员工的工程师，将被淘汰》",
      "",
      "## 当建议你用变成强制你用，意味着什么？",
      "2026年4月，Google联合创始人发出内部备忘录。".repeat(20),
      "",
      "## 企业应该如何理解这件事",
      "这不是一个AI爱好者在推特上吵架，而是企业组织方式正在改变。".repeat(20),
    ].join("\n");
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "final",
      message: {
        role: "assistant",
        content: [{ type: "text", text: article }],
        timestamp: 1776826000000,
      },
    };

    expect(handleChatEvent(state, payload)).toBe("final");
    const message = state.chatMessages[0] as Record<string, unknown>;
    const artifact = message.artifact as Record<string, unknown>;
    expect(artifact.artifactId).toMatch(/^assistant-doc:/);
    expect(artifact.title).toBe("Google创始人亲自下令：不会用AI员工的工程师，将被淘汰");
    expect(artifact.mimeType).toBe("text/markdown");
    expect((artifact.providerMetadata as Record<string, unknown>).previewText).toBe(article);
  });

  it("projects full article drafts even when they do not use markdown headings", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
    });
    const article = [
      "好的，我来起草完整文章。以下是选题二的全文：",
      "",
      "《Google创始人亲自下令：不会用AI员工的工程师，将被淘汰》",
      "",
      "当“建议你用”变成“强制你用”，意味着什么？",
      "",
      "2026年4月，Google联合创始人Sergey Brin发出了一份内部备忘录。".repeat(10),
      "",
      "备忘录的核心只有一句话：Every Gemini engineer must be forced to use internal agents for complex, multistep tasks.".repeat(
        6,
      ),
      "",
      "这不是一个AI爱好者在推特上吹牛，而是企业组织方式正在改变。".repeat(8),
    ].join("\n");
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "final",
      message: {
        role: "assistant",
        content: [{ type: "text", text: article }],
      },
    };

    expect(handleChatEvent(state, payload)).toBe("final");
    const message = state.chatMessages[0] as Record<string, unknown>;
    const artifact = message.artifact as Record<string, unknown>;
    expect(artifact.artifactId).toMatch(/^assistant-doc:/);
    expect(artifact.title).toBe("Google创始人亲自下令：不会用AI员工的工程师，将被淘汰");
    expect((artifact.providerMetadata as Record<string, unknown>).previewText).toBe(article);
  });

  it("projects article bodies that use a lead-in cue plus a plain text title", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
    });
    const article = [
      "小米AGI｜两年狂飙｜罗福莉｜MiMo",
      "",
      "风格：科技感、深蓝/紫色调、未来感",
      "",
      "以下是完整正文：",
      "",
      "小米AGI狂飙：罗福莉的两年赌约，胜算几何？",
      "",
      "“我正在Xiaomi MiMo，和一群富有创造力、才华横溢且真诚热爱的研究员，致力于构建这样的未来，全力奔赴我们心目中的AGI。”",
      "",
      "这是罗福莉加入小米后发布的一条动态。".repeat(6),
      "",
      "2026年3月19日凌晨，小米没有任何预热，悄然发布三款自研大模型。".repeat(8),
      "",
      "今天，我们把这件事说清楚。".repeat(8),
    ].join("\n");
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "final",
      message: {
        role: "assistant",
        content: [{ type: "text", text: article }],
      },
    };

    expect(handleChatEvent(state, payload)).toBe("final");
    const message = state.chatMessages[0] as Record<string, unknown>;
    const artifact = message.artifact as Record<string, unknown>;
    expect(artifact.artifactId).toMatch(/^assistant-doc:/);
    expect(artifact.title).toBe("小米AGI狂飙：罗福莉的两年赌约，胜算几何？");
    expect((artifact.providerMetadata as Record<string, unknown>).previewText).toBe(article);
  });

  it("projects full articles when the lead-in cue is separated by divider blocks", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
    });
    const article = [
      "小米AGI｜两年狂飙｜罗福莉｜MiMo",
      "风格：科技感、深蓝/紫色调、未来感",
      "",
      "---",
      "",
      "以下是完整正文：",
      "",
      "---",
      "",
      "小米AGI狂飙：罗福莉的两年赌约，胜算几何？",
      "",
      "“我正在Xiaomi MiMo，和一群富有创造力、才华横溢且真诚热爱的研究员，致力于构建这样的未来，全力奔赴我们心目中的AGI。”",
      "",
      "这是罗福莉加入小米后发布的一条动态。".repeat(6),
      "",
      "2026年3月19日凌晨，小米没有任何预热，悄然发布三款自研大模型。".repeat(8),
      "",
      "今天，我们把这件事说清楚。".repeat(8),
      "",
      "---",
      "",
      "一、小米的AGI底牌：MiMo-V2到底什么水平？",
      "",
      "先说技术。".repeat(10),
    ].join("\n");
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "final",
      message: {
        role: "assistant",
        content: [{ type: "text", text: article }],
      },
    };

    expect(handleChatEvent(state, payload)).toBe("final");
    const message = state.chatMessages[0] as Record<string, unknown>;
    const artifact = message.artifact as Record<string, unknown>;
    expect(artifact.artifactId).toMatch(/^assistant-doc:/);
    expect(artifact.title).toBe("小米AGI狂飙：罗福莉的两年赌约，胜算几何？");
    expect((artifact.providerMetadata as Record<string, unknown>).previewText).toBe(article);
  });

  it("projects full articles from multi-block assistant messages", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
    });
    const blocks = [
      "小米AGI｜两年狂飙｜罗福莉｜MiMo",
      "风格：科技感、深蓝/紫色调、未来感",
      "---",
      "以下是完整正文：",
      "---",
      "小米AGI狂飙：罗福莉的两年赌约，胜算几何？",
      "“我正在Xiaomi MiMo，和一群富有创造力、才华横溢且真诚热爱的研究员，致力于构建这样的未来，全力奔赴我们心目中的AGI。”",
      "这是罗福莉加入小米后发布的一条动态。".repeat(6),
      "2026年3月19日凌晨，小米没有任何预热，悄然发布三款自研大模型。".repeat(8),
      "今天，我们把这件事说清楚。".repeat(8),
      "---",
      "一、小米的AGI底牌：MiMo-V2到底什么水平？",
      "先说技术。".repeat(10),
    ];
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "final",
      message: {
        role: "assistant",
        content: blocks.map((text) => ({ type: "text", text })),
      },
    };

    expect(handleChatEvent(state, payload)).toBe("final");
    const message = state.chatMessages[0] as Record<string, unknown>;
    const artifact = message.artifact as Record<string, unknown>;
    expect(artifact.artifactId).toMatch(/^assistant-doc:/);
    expect(artifact.title).toBe("小米AGI狂飙：罗福莉的两年赌约，胜算几何？");
    expect((artifact.providerMetadata as Record<string, unknown>).previewText).toBe(
      blocks.join("\n\n"),
    );
  });

  it("projects standalone assistant code blocks as preview artifacts", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
    });
    const code = [
      "```ts",
      "export function buildPreviewRecord(input: string) {",
      "  return input.trim();",
      "}",
      "export function normalizePreviewRecord(input: string) {",
      "  return buildPreviewRecord(input).toLowerCase();",
      "}",
      "```",
    ].join("\n");
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "final",
      message: {
        role: "assistant",
        content: [{ type: "text", text: code }],
      },
    };

    expect(handleChatEvent(state, payload)).toBe("final");
    const message = state.chatMessages[0] as Record<string, unknown>;
    const artifact = message.artifact as Record<string, unknown>;
    expect(artifact.artifactId).toMatch(/^assistant-doc:/);
    expect(artifact.mimeType).toBe("text/x-code");
    expect((artifact.providerMetadata as Record<string, unknown>).previewText).toBe(code);
  });

  it("does not project long conversational explanations as preview artifacts", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
    });
    const explanation = [
      "老大，我来再次核实一下，这次扩大范围搜索：",
      "",
      "老大，澄清一下：我从来没有说文件存在。",
      "",
      "我的回答一直是：找不到这个文件。",
      "",
      "可能的情况：",
      "",
      "1. 市场助手在另一个会话/群聊里说了文件存在（我没有那个上下文）",
      "2. 或者有误解",
      "",
      "我这边能确认的是：",
      "- 我的 workspace 里没有 `PPT报告制作指南.md`",
      "- OpenBot skills 目录里也没有这个文件",
      "",
      "如果你觉得文件应该在，告诉我它可能在哪里创建的，我帮你再查一次。",
    ].join("\n");
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "final",
      message: {
        role: "assistant",
        content: [{ type: "text", text: explanation }],
      },
    };

    expect(handleChatEvent(state, payload)).toBe("final");
    expect(state.chatMessages[0]).toEqual(payload.message);
  });

  it("does not project task completion summaries as preview artifacts", () => {
    const state = createState({
      sessionKey: "run-1",
      chatRunId: "run-1",
    });
    const summary = [
      "配图生成完毕！以下是完整交付物：",
      "",
      "✅ 任务完成总结",
      "",
      "📰 公众号文章",
      "",
      "标题：《小米AGI狂飙：罗福莉的两年赌约，胜算几何？》",
      "",
      "核心角度：不是单纯吹小米，而是理性分析“两年AGI”这个豪言背后的乐观派 vs 怀疑派论据。".repeat(
        3,
      ),
      "",
      "三大亮点：",
      "- MiMo-V2-Pro/Omni/TTS 三款模型 + Flash 开源的战术解读",
      "- 罗福莉从互联网AI到终端AI的场景切换经验分析",
      "- AGI定义争议、数据硬约束、基础研究时间压缩等冷静思考",
      "",
      "🎨 配图（4张，已生成）",
    ].join("\n");
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "run-1",
      state: "final",
      message: {
        role: "assistant",
        content: [{ type: "text", text: summary }],
      },
    };

    expect(handleChatEvent(state, payload)).toBe("final");
    expect(state.chatMessages[0]).toEqual(payload.message);
  });

  it("does not project draft-box update summaries as preview artifacts", () => {
    const state = createState({
      sessionKey: "run-1",
      chatRunId: "run-1",
    });
    const update = [
      "草稿箱已更新！🎉",
      "",
      "现在草稿箱里的文章是完整版了，包含全部5个章节：",
      "",
      "1. 开头引入（热点切入）",
      "2. 一、小米的AGI底牌：MiMo-V2到底什么水平？",
      "3. 二、罗福莉是谁？为什么是她来操盘？",
      "4. 三、两年倒计时：乐观派 vs 怀疑派",
      "5. 四、真正的问题：小米在赌什么？",
      "6. 写在最后",
      "",
      "封面图 + 配图1 已成功插入。后台“《小米AGI狂飙：罗福莉的两年赌约，胜算几何？》”这篇，补充一下二、三章节的配图。",
      "",
      "去草稿箱看看效果吧 👀",
    ].join("\n");
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "run-1",
      state: "final",
      message: {
        role: "assistant",
        content: [{ type: "text", text: update }],
      },
    };

    expect(handleChatEvent(state, payload)).toBe("final");
    expect(state.chatMessages[0]).toEqual(payload.message);
  });

  it("projects structured assistant reports as preview artifacts", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
    });
    const report = [
      "# 市场周报：AI工具如何改变内容团队",
      "",
      "## 一、本周摘要",
      "过去一周，内容团队在选题、成稿和排版环节都明显提速。".repeat(10),
      "",
      "## 二、关键变化",
      "1. 选题判断开始依赖数据化筛选。",
      "2. 成稿阶段出现标准化模板。",
      "3. 排版和发布逐步流水线化。",
      "",
      "## 三、建议动作",
      "- 建立统一选题池",
      "- 固化文章模板",
      "- 将发布流程纳入工作台",
      "",
      "## 四、下周计划",
      "围绕公众号和短报告继续验证自动化交付链路。".repeat(8),
    ].join("\n");
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "final",
      message: {
        role: "assistant",
        content: [{ type: "text", text: report }],
      },
    };

    expect(handleChatEvent(state, payload)).toBe("final");
    const message = state.chatMessages[0] as Record<string, unknown>;
    const artifact = message.artifact as Record<string, unknown>;
    expect(artifact.artifactId).toMatch(/^assistant-doc:/);
    expect(artifact.title).toBe("市场周报：AI工具如何改变内容团队");
    expect(artifact.mimeType).toBe("text/markdown");
    expect((artifact.providerMetadata as Record<string, unknown>).previewText).toBe(report);
  });

  it("projects generated deliverable files as the document body instead of the chat wrapper", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
    });
    const body = [
      "## 模块内容概览",
      "",
      "| 章节 | 内容 |",
      "| --- | --- |",
      "| 二、优势分析（S） | 政策支持、一带一路区位、特色产业集聚、用电成本、人力成本等11项优势 |",
      "| 三、劣势分析（W） | 市场认知、跨境服务能力、平台运营能力等关键短板 |",
      "",
      "## 二、优势分析（S）",
      "",
      "银川数贸平台具备政策承接、产业集聚和区域协同的复合优势。".repeat(8),
    ].join("\n");
    const reply = [
      "完成啦！已经帮你把SWOT分析模块写好了，文件保存在：",
      "",
      "📄 银川数贸平台_SWOT分析模块.md",
      "",
      "---",
      "",
      body,
    ].join("\n");
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "final",
      message: {
        role: "assistant",
        content: [{ type: "text", text: reply }],
      },
    };

    expect(handleChatEvent(state, payload)).toBe("final");
    const message = state.chatMessages[0] as Record<string, unknown>;
    const artifact = message.artifact as Record<string, unknown>;
    expect(artifact.artifactId).toMatch(/^assistant-doc:/);
    expect(artifact.title).toBe("银川数贸平台_SWOT分析模块.md");
    expect(artifact.mimeType).toBe("text/markdown");
    expect(artifact.sourceMessage).toBe(body);
    expect((artifact.providerMetadata as Record<string, unknown>).previewText).toBe(body);
    expect(String(artifact.sourceMessage)).not.toContain("完成啦");
  });

  it("removes conversational preamble before inferred document bodies", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
    });
    const body = [
      "## 中阿数贸平台 SWOT 分析",
      "",
      "---",
      "",
      "### 🔵 S — 优势（Strengths）",
      "",
      "**1. 战略合作方资源优势（本次强化重点）**",
      "",
      "| 合作方 | 核心优势 | 对平台的赋能价值 |",
      "| --- | --- | --- |",
      "| 宁夏智慧宫 | 阿语内容、跨境文化传播、国际合作网络 | 帮助平台形成中阿双语服务能力 |",
      "",
      "该平台应将两家战略合作方的资源优势纳入核心竞争力分析。".repeat(8),
    ].join("\n");
    const reply = [
      "收到！您要强化SWOT的**优势(Strengths)**部分，纳入两家战略合作方的核心资源。让我先找到并解析这份PPT文件。",
      "",
      "找到文件了！让我解析这份PPT的内容。",
      "",
      "已完整解析PPT内容。现在为您构建包含两家战略合作方（宁夏智慧宫、深圳鹏峰）优势的SWOT分析模块。",
      "",
      "---",
      "",
      body,
    ].join("\n");
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "final",
      message: {
        role: "assistant",
        content: [{ type: "text", text: reply }],
      },
    };

    expect(handleChatEvent(state, payload)).toBe("final");
    const message = state.chatMessages[0] as Record<string, unknown>;
    const artifact = message.artifact as Record<string, unknown>;
    expect(artifact.artifactId).toMatch(/^assistant-doc:/);
    expect(artifact.title).toBe("中阿数贸平台 SWOT 分析");
    expect(artifact.sourceMessage).toBe(body);
    expect(String(artifact.sourceMessage)).not.toContain("收到");
    expect(String(artifact.sourceMessage)).not.toContain("找到文件");
    expect(String(artifact.sourceMessage)).not.toContain("已完整解析PPT内容");
    expect((artifact.providerMetadata as Record<string, unknown>).inferredDocumentBody).toBe(true);
  });

  it("removes trailing conversational prompts from inferred document bodies", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
    });
    const body = [
      "## 中阿数贸平台 SWOT 分析",
      "",
      "### 📌 核心结论",
      "",
      "> **宁夏智慧宫**解决“中东市场能不能进”的问题（文化信任+政府资源）",
      ">",
      "> **深圳鹏峰**解决“平台能不能跑通”的问题（交易系统+金融通道+运营经验）",
      ">",
      "> 两者形成“市场入口+能力支撑”的互补结构，是当前阶段最稀缺的战略组合。",
      "",
      "---",
      "",
      "### 🔵 S — 优势（Strengths）",
      "",
      "1. 合作方资源优势。".repeat(10),
    ].join("\n");
    const prompt =
      "需要我将这个SWOT分析进一步细化（如增加权重评分、策略建议矩阵），或者直接生成对应PPT页面的文字内容吗？";
    const reply = [
      "已完整解析PPT内容。现在为您构建SWOT分析模块。",
      "",
      body,
      "",
      "---",
      "",
      prompt,
    ].join("\n");
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "final",
      message: {
        role: "assistant",
        content: [{ type: "text", text: reply }],
      },
    };

    expect(handleChatEvent(state, payload)).toBe("final");
    const message = state.chatMessages[0] as Record<string, unknown>;
    const artifact = message.artifact as Record<string, unknown>;
    expect(artifact.sourceMessage).toBe(body);
    expect(String(artifact.sourceMessage)).not.toContain(prompt);
  });

  it("projects deliverable envelope tag bodies without conversational wrapper", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
    });
    const body = [
      "## 中医诊断学习简报",
      "",
      "### 💡 学习建议",
      "",
      "1. 先掌握望诊中的神色与形态观察要点。",
      "2. 熟记问诊十问的顺序与临床意义。",
      "3. 结合脉诊与闻诊形成完整四诊链条。".repeat(2),
    ].join("\n");
    const followUp =
      "怎么样老大，这份简报够详细吗？如果您需要我展开讲**某一部分**的细节，或者想看**知识导图**更直观的版本，随时说！";
    const reply = [
      "好的，学习简报如下：",
      "",
      '<<DELIVERABLE title="中医诊断学习简报">>',
      body,
      "<</DELIVERABLE>>",
      "",
      "---",
      "",
      followUp,
    ].join("\n");
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "final",
      message: {
        role: "assistant",
        content: [{ type: "text", text: reply }],
      },
    };

    expect(handleChatEvent(state, payload)).toBe("final");
    const message = state.chatMessages[0] as Record<string, unknown>;
    const artifact = message.artifact as Record<string, unknown>;
    expect(artifact.title).toBe("中医诊断学习简报");
    expect(String(artifact.sourceMessage)).toBe(body);
    expect(String(artifact.sourceMessage)).not.toContain("怎么样老大");
    expect((artifact.providerMetadata as Record<string, unknown>).deliverableEnvelope).toBe(true);
    expect((artifact.providerMetadata as Record<string, unknown>).envelopeKind).toBe("tag");
  });

  it("removes casual follow-up chatter after horizontal rules from previewable bodies", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
    });
    const body = [
      "## 中医诊断学习简报",
      "",
      "**基础** | 望诊基础（望神/望色）、问诊十问、听声音 |",
      "",
      "### 💡 学习建议",
      "",
      "1. 先掌握望诊中的神色与形态观察要点。",
      "2. 熟记问诊十问的顺序与临床意义。",
      "3. 结合脉诊与闻诊形成完整四诊链条。",
      "",
      "### 复习重点",
      "",
      "4. 将常见舌象与面色变化整理成对照表，便于临床快速检索。".repeat(3),
      "",
      "5. 通过病例复盘把四诊信息串联成完整辨证思路。".repeat(2),
    ].join("\n");
    const followUp =
      "怎么样老大，这份简报够详细吗？如果您需要我展开讲**某一部分**的细节，或者想看**知识导图**更直观的版本，随时说！";
    const reply = [body, "", "---", "", followUp].join("\n");
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "final",
      message: {
        role: "assistant",
        content: [{ type: "text", text: reply }],
      },
    };

    expect(handleChatEvent(state, payload)).toBe("final");
    const message = state.chatMessages[0] as Record<string, unknown>;
    const artifact = message.artifact as Record<string, unknown>;
    expect(String(artifact.sourceMessage)).toBe(body);
    expect(String(artifact.sourceMessage)).not.toContain("怎么样老大");
    expect(String(artifact.sourceMessage)).not.toContain("随时说");
  });

  it("removes nickname lead-in before previewable bodies", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
    });
    const body = [
      "## 中医诊断学知识导图",
      "",
      "---",
      "",
      "### 🔵 八大分支",
      "",
      "| 分支 | 要点 |",
      "| --- | --- |",
      "| 望诊 | 望神/望色/望舌/望形态 |",
      "",
      "1. 👁️ **望诊** — 望神/望色/望舌/望形态",
      "2. 👂 **闻诊** — 听声音/嗅气味",
      "3. 💬 **问诊** — 十问体系",
      "4. ✋ **切诊** — 28脉六大类",
      "5. ⚖️ **八纲辨证** — 阴阳表里寒热虚实",
      "",
      "该知识导图用于系统梳理中医诊断学核心框架。".repeat(8),
    ].join("\n");
    const leadIn = [
      "老大，知识导图已经生成好了！",
      "",
      "🎉 这是一个可交互的 HTML 页面，内容包含：",
    ].join("\n");
    const reply = [leadIn, "", body].join("\n");
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "final",
      message: {
        role: "assistant",
        content: [{ type: "text", text: reply }],
      },
    };

    expect(handleChatEvent(state, payload)).toBe("final");
    const message = state.chatMessages[0] as Record<string, unknown>;
    const artifact = message.artifact as Record<string, unknown>;
    expect(String(artifact.sourceMessage)).toContain("## 中医诊断学知识导图");
    expect(String(artifact.sourceMessage)).toContain("八大分支");
    expect(String(artifact.sourceMessage)).not.toContain("老大");
    expect(String(artifact.sourceMessage)).not.toContain("HTML 页面");
  });

  it("removes file-location and browser-open tails from previewable bodies", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
    });
    const body = [
      "## 中医诊断学知识导图",
      "",
      "1. 阴阳五行与藏象学说",
      "2. 四诊合参与辨证论治",
      "3. 常见证型与方药配伍要点说明".repeat(2),
    ].join("\n");
    const tail = [
      "文件位置：`~/AI项目/openbot/workspace-panda/中医诊断学_知识导图.html`",
      "",
      "您可以直接用浏览器打开查看交互版！也可以在当前窗口继续问我任何章节的细节 🐼🎋",
    ].join("\n");
    const reply = [body, "", tail].join("\n");
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "final",
      message: {
        role: "assistant",
        content: [{ type: "text", text: reply }],
      },
    };

    expect(handleChatEvent(state, payload)).toBe("final");
    const message = state.chatMessages[0] as Record<string, unknown>;
    const artifact = message.artifact as Record<string, unknown>;
    expect(String(artifact.sourceMessage)).toBe(body);
    expect(String(artifact.sourceMessage)).not.toContain("文件位置");
    expect(String(artifact.sourceMessage)).not.toContain("浏览器打开");
  });

  it("does not project short assistant replies as preview artifacts", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "final",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "好的，我已经完成。" }],
      },
    };

    expect(handleChatEvent(state, payload)).toBe("final");
    expect(state.chatMessages[0]).toEqual(payload.message);
  });

  it("does not throw when assistant messages have no text content", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "final",
      message: {
        role: "assistant",
        content: null,
      },
    };

    expect(handleChatEvent(state, payload)).toBe("final");
    expect(state.chatMessages[0]).toEqual(payload.message);
  });

  it("appends final payload message from own run before clearing stream state", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "Reply",
      chatStreamStartedAt: 100,
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "final",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Reply" }],
        timestamp: 101,
      },
    };
    expect(handleChatEvent(state, payload)).toBe("final");
    expect(state.chatMessages).toEqual([payload.message]);
    expect(state.chatRunId).toBe(null);
    expect(state.chatStream).toBe(null);
    expect(state.chatStreamStartedAt).toBe(null);
  });

  it("processes aborted from own run and keeps partial assistant message", () => {
    const existingMessage = {
      role: "user",
      content: [{ type: "text", text: "Hi" }],
      timestamp: 1,
    };
    const partialMessage = {
      role: "assistant",
      content: [{ type: "text", text: "Partial reply" }],
      timestamp: 2,
    };
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "Partial reply",
      chatStreamStartedAt: 100,
      chatMessages: [existingMessage],
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "aborted",
      message: partialMessage,
    };

    expect(handleChatEvent(state, payload)).toBe("aborted");
    expect(state.chatRunId).toBe(null);
    expect(state.chatStream).toBe(null);
    expect(state.chatStreamStartedAt).toBe(null);
    expect(state.chatMessages).toEqual([existingMessage, partialMessage]);
  });

  it("falls back to streamed partial when aborted payload message is invalid", () => {
    const existingMessage = {
      role: "user",
      content: [{ type: "text", text: "Hi" }],
      timestamp: 1,
    };
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "Partial reply",
      chatStreamStartedAt: 100,
      chatMessages: [existingMessage],
    });
    const payload = {
      runId: "run-1",
      sessionKey: "main",
      state: "aborted",
      message: "not-an-assistant-message",
    } as unknown as ChatEventPayload;

    expect(handleChatEvent(state, payload)).toBe("aborted");
    expect(state.chatRunId).toBe(null);
    expect(state.chatStream).toBe(null);
    expect(state.chatStreamStartedAt).toBe(null);
    expect(state.chatMessages).toHaveLength(2);
    expect(state.chatMessages[0]).toEqual(existingMessage);
    expect(state.chatMessages[1]).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "Partial reply" }],
    });
  });

  it("falls back to streamed partial when aborted payload has non-assistant role", () => {
    const existingMessage = {
      role: "user",
      content: [{ type: "text", text: "Hi" }],
      timestamp: 1,
    };
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "Partial reply",
      chatStreamStartedAt: 100,
      chatMessages: [existingMessage],
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "aborted",
      message: {
        role: "user",
        content: [{ type: "text", text: "unexpected" }],
      },
    };

    expect(handleChatEvent(state, payload)).toBe("aborted");
    expect(state.chatMessages).toHaveLength(2);
    expect(state.chatMessages[1]).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "Partial reply" }],
    });
  });

  it("processes aborted from own run without message and empty stream", () => {
    const existingMessage = {
      role: "user",
      content: [{ type: "text", text: "Hi" }],
      timestamp: 1,
    };
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "",
      chatStreamStartedAt: 100,
      chatMessages: [existingMessage],
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "aborted",
    };

    expect(handleChatEvent(state, payload)).toBe("aborted");
    expect(state.chatRunId).toBe(null);
    expect(state.chatStream).toBe(null);
    expect(state.chatStreamStartedAt).toBe(null);
    expect(state.chatMessages).toEqual([existingMessage]);
  });

  it("drops NO_REPLY final payload from another run", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-user",
      chatStream: "Working...",
      chatStreamStartedAt: 123,
    });
    const payload: ChatEventPayload = {
      runId: "run-announce",
      sessionKey: "main",
      state: "final",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "NO_REPLY" }],
      },
    };

    expect(handleChatEvent(state, payload)).toBe("final");
    expect(state.chatMessages).toEqual([]);
    expect(state.chatRunId).toBe("run-user");
    expect(state.chatStream).toBe("Working...");
  });

  it("drops NO_REPLY final payload from own run", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "NO_REPLY",
      chatStreamStartedAt: 100,
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "final",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "NO_REPLY" }],
      },
    };

    expect(handleChatEvent(state, payload)).toBe("final");
    expect(state.chatMessages).toEqual([]);
    expect(state.chatRunId).toBe(null);
    expect(state.chatStream).toBe(null);
  });

  it("does not persist NO_REPLY stream text on final without message", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "NO_REPLY",
      chatStreamStartedAt: 100,
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "final",
    };

    expect(handleChatEvent(state, payload)).toBe("final");
    expect(state.chatMessages).toEqual([]);
  });

  it("does not persist NO_REPLY stream text on abort", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "NO_REPLY",
      chatStreamStartedAt: 100,
    });
    const payload = {
      runId: "run-1",
      sessionKey: "main",
      state: "aborted",
      message: "not-an-assistant-message",
    } as unknown as ChatEventPayload;

    expect(handleChatEvent(state, payload)).toBe("aborted");
    expect(state.chatMessages).toEqual([]);
  });

  it("keeps user messages containing NO_REPLY text", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-user",
      chatStream: "Working...",
      chatStreamStartedAt: 123,
    });
    const payload: ChatEventPayload = {
      runId: "run-announce",
      sessionKey: "main",
      state: "final",
      message: {
        role: "user",
        content: [{ type: "text", text: "NO_REPLY" }],
      },
    };

    // User messages with NO_REPLY text should NOT be filtered — only assistant messages.
    expect(handleChatEvent(state, payload)).toBe(null);
    expect(state.chatMessages).toEqual([payload.message]);
  });

  it("keeps assistant message when text field has real reply but content is NO_REPLY", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "",
      chatStreamStartedAt: 100,
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "final",
      message: {
        role: "assistant",
        text: "real reply",
        content: "NO_REPLY",
      },
    };

    // entry.text takes precedence — "real reply" is NOT silent, so the message is kept.
    expect(handleChatEvent(state, payload)).toBe("final");
    expect(state.chatMessages).toHaveLength(1);
  });
  it("accepts shorter Chinese delivery after English CoT stream (non-monotonic)", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "The skill is outside my sandbox. Let me try exec.",
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "delta",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "请点本机只读授权后继续。" }],
      },
    };
    expect(handleChatEvent(state, payload)).toBe("delta");
    expect(state.chatStream).toContain("请点本机只读授权");
    expect(state.chatStream).not.toMatch(/sandbox/i);
  });

  it("still rejects simple truncation of the current stream", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "你好世界，这是完整回复。",
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "delta",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "你好世界" }],
      },
    };
    expect(handleChatEvent(state, payload)).toBe("delta");
    expect(state.chatStream).toBe("你好世界，这是完整回复。");
  });
});

describe("loadChatHistory", () => {
  it("does not banner when local chat rows are missing and history is empty", async () => {
    const state = createState({
      client: {
        request: vi.fn().mockResolvedValue({ messages: [] }),
      } as unknown as ChatState["client"],
      connected: true,
      sessionKey: "agent:collab:room",
    });
    Reflect.deleteProperty(state, "chatMessages");

    await loadChatHistory(state);

    expect(state.lastError).toBeNull();
    expect(state.chatMessages).toEqual([]);
  });

  it("keeps an already visible assistant reply when history reloads empty", async () => {
    const essay = "这一轮的可见回复已经写好。";
    const state = createState({
      client: {
        request: vi.fn().mockResolvedValue({ messages: [] }),
      } as unknown as ChatState["client"],
      connected: true,
      sessionKey: "agent:collab:room",
      chatMessages: [
        {
          role: "assistant",
          content: [{ type: "text", text: essay }],
          timestamp: 1,
        },
      ],
    });

    await loadChatHistory(state);

    expect(state.lastError).toBeNull();
    expect(JSON.stringify(state.chatMessages)).toContain(essay);
  });

  it("does not open 电脑 on session-switch history when the sidebar is closed", async () => {
    const messages = [
      {
        role: "assistant",
        senderLabel: "市场助手",
        content: [{ type: "text", text: "我已经在云电脑里打开京东了，电脑 Tab 可见。" }],
      },
      {
        role: "assistant",
        toolName: "browser",
        content: [{ type: "text", text: "browser open https://jd.com" }],
      },
    ];
    const sessionKeys = ["agent:market:main", "agent:main:space:ops-room"] as const;
    expect(messages.every((message) => messageTriggersComputerPreview(message))).toBe(true);

    for (const sessionKey of sessionKeys) {
      const refresh = vi.fn();
      const state = createState({
        client: {
          request: vi.fn().mockResolvedValue({ messages }),
        } as unknown as ChatState["client"],
        connected: true,
        sessionKey,
      });
      const host = state as ChatState & {
        sidebarOpen: boolean;
        sidebarSurface: string;
        computerPreviewRevision: number;
        refreshAccountComputerPreview: (action: "open" | "status" | "end") => void;
        syncAccountComputerPreview: () => void;
      };
      host.sidebarOpen = false;
      host.sidebarSurface = "artifact";
      host.computerPreviewRevision = 4;
      host.refreshAccountComputerPreview = refresh;
      host.syncAccountComputerPreview = refresh;

      await loadChatHistory(host);

      expect(host.chatMessages.length).toBeGreaterThan(0);
      expect(host.sidebarOpen).toBe(false);
      expect(host.sidebarSurface).toBe("artifact");
      expect(host.computerPreviewRevision).toBe(4);
      expect(refresh).not.toHaveBeenCalled();
    }

    const openArtifact = createState({
      client: {
        request: vi.fn().mockResolvedValue({ messages }),
      } as unknown as ChatState["client"],
      connected: true,
      sessionKey: "agent:market:main",
    }) as ChatState & { sidebarOpen: boolean; sidebarSurface: string };
    openArtifact.sidebarOpen = true;
    openArtifact.sidebarSurface = "artifact";
    await loadChatHistory(openArtifact);
    expect(openArtifact.sidebarOpen).toBe(true);
    expect(openArtifact.sidebarSurface).toBe("artifact");
  });

  it("force-opens 电脑 on hard-refresh history when the transcript used browser or 云电脑", async () => {
    const messages = [
      {
        role: "assistant",
        senderLabel: "市场助手",
        content: [{ type: "text", text: "我已经在云电脑里打开京东了，电脑 Tab 可见。" }],
      },
      {
        role: "assistant",
        toolName: "browser",
        content: [{ type: "text", text: "browser open https://jd.com" }],
      },
    ];
    const sync = vi.fn();
    const state = createState({
      client: {
        request: vi.fn().mockResolvedValue({ messages }),
      } as unknown as ChatState["client"],
      connected: true,
      sessionKey: "agent:market:main",
    });
    const host = state as ChatState & {
      sidebarOpen: boolean;
      sidebarSurface: string;
      assistantName: string;
      syncAccountComputerPreview: () => void;
    };
    host.sidebarOpen = false;
    host.sidebarSurface = "artifact";
    host.assistantName = "市场助手";
    host.syncAccountComputerPreview = sync;

    try {
      await loadChatHistory(host, { forceOpenComputerPreview: true });

      expect(host.sidebarOpen).toBe(true);
      expect(host.sidebarSurface).toBe("computer");
      expect(sync).toHaveBeenCalled();
    } finally {
      resetAccountComputerPreviewForTests();
    }
  });

  it("filters NO_REPLY assistant messages from history", async () => {
    const messages = [
      { role: "user", content: [{ type: "text", text: "Hello" }] },
      { role: "assistant", content: [{ type: "text", text: "NO_REPLY" }] },
      { role: "assistant", content: [{ type: "text", text: "Real answer" }] },
      { role: "assistant", text: "  NO_REPLY  " },
    ];
    const mockClient = {
      request: vi.fn().mockResolvedValue({ messages, thinkingLevel: "low" }),
    };
    const state = createState({
      client: mockClient as unknown as ChatState["client"],
      connected: true,
    });

    await loadChatHistory(state);

    expect(state.chatMessages).toHaveLength(2);
    expect(state.chatMessages[0]).toEqual(messages[0]);
    expect(state.chatMessages[1]).toEqual(messages[2]);
    expect(state.chatThinkingLevel).toBe("low");
    expect(state.chatLoading).toBe(false);
  });

  it("filters pre-compaction memory-flush user prompts from history", async () => {
    const messages = [
      { role: "user", content: [{ type: "text", text: "你好" }] },
      {
        role: "user",
        senderLabel: "CEO",
        content: [
          {
            type: "text",
            text: "Pre-compaction memory flush. Store durable memories only in memory/2026-08-11.md (create memory/ if needed). Treat workspace bootstrap/reference files such as MEMORY.md as read-only during this flush.",
          },
        ],
      },
      { role: "assistant", content: [{ type: "text", text: "好的" }] },
    ];
    const mockClient = {
      request: vi.fn().mockResolvedValue({ messages }),
    };
    const state = createState({
      client: mockClient as unknown as ChatState["client"],
      connected: true,
    });

    await loadChatHistory(state);

    expect(state.chatMessages).toHaveLength(2);
    expect(state.chatMessages[0]).toEqual(messages[0]);
    expect(state.chatMessages[1]).toEqual(messages[2]);
  });

  it("keeps the local user instruction and stop control when a quiet reload returns assistant results", async () => {
    const request = vi.fn().mockResolvedValue({
      messages: [{ role: "assistant", content: [{ type: "text", text: "检索情况" }] }],
    });
    const localUser = {
      id: "local-run-1",
      role: "user",
      content: [{ type: "text", text: "请检索订单参谋 MCP" }],
    };
    const state = createState({
      connected: true,
      client: { request } as unknown as ChatState["client"],
      chatMessages: [localUser],
      chatRunId: "run-1",
      chatStream: "正在检索",
      chatHistoryQuietReload: true,
    });

    await loadChatHistory(state);

    expect(state.chatMessages[0]).toEqual(localUser);
    expect(state.chatMessages[1]).toEqual({
      role: "assistant",
      content: [{ type: "text", text: "检索情况" }],
    });
    expect(state.chatRunId).toBe("run-1");
    expect(state.chatStream).toBe("正在检索");
  });

  it("keeps the stop control when a tool-result reload already has assistant rows", async () => {
    const request = vi.fn().mockResolvedValue({
      messages: [
        { role: "user", content: [{ type: "text", text: "请检索订单参谋 MCP" }] },
        { role: "assistant", content: [{ type: "text", text: "正在调用工具" }] },
      ],
    });
    const state = createState({
      connected: true,
      client: { request } as unknown as ChatState["client"],
      chatRunId: "run-1",
      chatStream: "正在检索",
    });

    await loadChatHistory(state);

    expect(state.chatRunId).toBe("run-1");
    expect(state.chatStream).toBe("正在检索");
  });

  it("does not restore a run id that a terminal event cleared while history was loading", async () => {
    const state = createState({
      connected: true,
      chatRunId: "run-1",
      chatStream: "正在检索",
    });
    const request = vi.fn().mockImplementation(async () => {
      state.chatRunId = null;
      state.chatStream = null;
      return {
        messages: [{ role: "assistant", content: [{ type: "text", text: "完成" }] }],
      };
    });
    state.client = { request } as unknown as ChatState["client"];

    await loadChatHistory(state);

    expect(state.chatRunId).toBeNull();
    expect(state.chatStream).toBeNull();
  });

  it("adopts an in-flight server run after reconnect and keeps later deltas abortable", async () => {
    const request = vi.fn().mockResolvedValue({
      messages: [{ role: "user", content: [{ type: "text", text: "写周报" }] }],
      activeRun: { runId: "run-live", text: "周报草稿" },
    });
    const state = createState({
      connected: true,
      client: { request } as unknown as ChatState["client"],
      chatRunId: null,
      chatStream: null,
    });

    await loadChatHistory(state);

    expect(state.chatRunId).toBe("run-live");
    expect(state.chatStream).toBe("周报草稿");
    expect(state.workProgressPhase).toBe("drafting");
    expect(
      handleChatEvent(state, {
        runId: "run-live",
        sessionKey: "main",
        state: "delta",
        message: { role: "assistant", content: [{ type: "text", text: "周报草稿已经写完" }] },
      }),
    ).toBe("delta");
    expect(state.chatStream).toBe("周报草稿已经写完");

    const abort = vi.fn().mockResolvedValue({ aborted: true });
    state.client = { request: abort } as unknown as ChatState["client"];
    await abortChatRun(state);
    expect(abort).toHaveBeenCalledWith("chat.abort", {
      sessionKey: "main",
      runId: "run-live",
    });
  });

  it("leaves occupancy for a live abort so the aborted event can keep the partial", async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, aborted: true, runIds: ["run-live"] });
    const state = createState({
      connected: true,
      client: { request } as unknown as ChatState["client"],
      chatRunId: "run-live",
      chatStream: "写到一半",
      workProgressPhase: "drafting",
    });

    await expect(abortChatRun(state)).resolves.toBe(true);

    expect(state.chatRunId).toBe("run-live");
    expect(state.chatStream).toBe("写到一半");
    expect(state.workProgressPhase).toBe("drafting");
  });

  it("clears local busy state when stop returns aborted false", async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, aborted: false, runIds: [] });
    const state = createState({
      connected: true,
      client: { request } as unknown as ChatState["client"],
      chatRunId: "a0fcdff0-813a-4c95-9615-00146241d4aa",
      chatStream: "",
      chatStreamStartedAt: 1_700_000_000_000,
      chatThinkingProgress: {
        steps: [],
        activeIndex: 0,
        percent: 8,
        placeholder: "正在思考",
      },
      workProgressPhase: "thinking",
      workProgressToolsInFlight: 1,
      workProgressNarration: "打开京东",
    });

    await expect(abortChatRun(state)).resolves.toBe(true);

    expect(request).toHaveBeenCalledWith("chat.abort", {
      sessionKey: "main",
      runId: "a0fcdff0-813a-4c95-9615-00146241d4aa",
    });
    expect(state.chatRunId).toBeNull();
    expect(state.chatStream).toBeNull();
    expect(state.chatStreamStartedAt).toBeNull();
    expect(state.chatThinkingProgress).toBeNull();
    expect(state.workProgressPhase).toBeNull();
    expect(state.workProgressToolsInFlight).toBe(0);
    expect(state.workProgressNarration).toBeNull();
    expect(state.lastError).toBeNull();
  });

  it("clears local busy state when stop errors because the gateway has no active run", async () => {
    const request = vi.fn().mockRejectedValue(new Error("no active run for unknown runId"));
    const state = createState({
      connected: true,
      client: { request } as unknown as ChatState["client"],
      chatRunId: "a0fcdff0-813a-4c95-9615-00146241d4aa",
      chatStream: "",
      workProgressPhase: "thinking",
      chatThinkingProgress: {
        steps: [],
        activeIndex: 0,
        percent: 8,
        placeholder: "正在思考",
      },
    });

    await expect(abortChatRun(state)).resolves.toBe(true);

    expect(state.chatRunId).toBeNull();
    expect(state.chatStream).toBeNull();
    expect(state.workProgressPhase).toBeNull();
    expect(state.chatThinkingProgress).toBeNull();
    expect(state.lastError).toBeNull();
  });

  it("keeps local busy state when stop fails for an unrelated gateway error", async () => {
    const request = vi.fn().mockRejectedValue(new Error("gateway closed (1006)"));
    const state = createState({
      connected: true,
      client: { request } as unknown as ChatState["client"],
      chatRunId: "run-live",
      chatStream: "仍在写",
      workProgressPhase: "drafting",
    });

    await expect(abortChatRun(state)).resolves.toBe(false);

    expect(state.chatRunId).toBe("run-live");
    expect(state.chatStream).toBe("仍在写");
    expect(state.workProgressPhase).toBe("drafting");
    expect(state.lastError).toContain("gateway closed");
  });

  it("clears stale occupancy when history says the session is idle", async () => {
    const request = vi.fn().mockResolvedValue({
      messages: [{ role: "assistant", content: [{ type: "text", text: "完成" }] }],
      activeRun: null,
    });
    const state = createState({
      connected: true,
      client: { request } as unknown as ChatState["client"],
      chatRunId: "run-finished",
      chatStream: "完成中",
      chatSending: false,
    });

    await loadChatHistory(state);

    expect(state.chatRunId).toBeNull();
    expect(state.chatStream).toBeNull();
  });

  it("does not re-adopt a stale activeRun after chat.final while the computer preview stays open", async () => {
    const runId = "a0fcdff0-813a-4c95-9615-00146241d4aa";
    const state = createState({
      sessionKey: "agent:market:main",
      chatRunId: runId,
      chatStream: "",
      workProgressPhase: "thinking",
      workProgressToolsInFlight: 0,
      chatThinkingProgress: {
        steps: [],
        activeIndex: 0,
        percent: 8,
        placeholder: "正在思考",
      },
      chatMessages: [],
    });
    const host = state as ChatState & { sidebarOpen: boolean; sidebarSurface: string };
    host.sidebarOpen = true;
    host.sidebarSurface = "computer";
    handleChatEvent(host, {
      runId,
      sessionKey: "agent:market:main",
      state: "final",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "请确认后我再排版。" }],
      },
    });
    expect(host.chatRunId).toBeNull();

    const request = vi.fn().mockResolvedValue({
      messages: [
        { role: "user", content: [{ type: "text", text: "写试用申请" }] },
        { role: "assistant", content: [{ type: "text", text: "请确认后我再排版。" }] },
      ],
      activeRun: { runId, text: "" },
    });
    host.client = { request } as unknown as ChatState["client"];

    await loadChatHistory(host);

    expect(host.chatRunId).toBeNull();
    expect(host.chatStream).toBeNull();
    expect(host.chatThinkingProgress).toBeNull();
    expect(host.workProgressPhase).toBeNull();
    expect(host.workProgressToolsInFlight).toBe(0);
    expect(host.sidebarOpen).toBe(true);
    expect(host.sidebarSurface).toBe("computer");
  });

  it("clears thinking and stop when history reports no activeRun", async () => {
    const request = vi.fn().mockResolvedValue({
      messages: [{ role: "assistant", content: [{ type: "text", text: "请确认后我再排版。" }] }],
      activeRun: null,
    });
    const state = createState({
      connected: true,
      client: { request } as unknown as ChatState["client"],
      chatRunId: "a0fcdff0-813a-4c95-9615-00146241d4aa",
      chatStream: "",
      chatThinkingProgress: {
        steps: [],
        activeIndex: 0,
        percent: 8,
        placeholder: "正在思考",
      },
      workProgressPhase: "thinking",
      workProgressNarration: "打开京东",
      chatSending: false,
    });
    const host = state as ChatState & { sidebarSurface: string };
    host.sidebarSurface = "computer";

    await loadChatHistory(host);

    expect(host.chatRunId).toBeNull();
    expect(host.chatStream).toBeNull();
    expect(host.chatThinkingProgress).toBeNull();
    expect(host.workProgressPhase).toBeNull();
    expect(host.workProgressNarration).toBeNull();
    expect(host.sidebarSurface).toBe("computer");

    host.client = {
      request: vi.fn().mockResolvedValue({
        messages: [{ role: "assistant", content: [{ type: "text", text: "请确认后我再排版。" }] }],
        activeRun: { runId: "a0fcdff0-813a-4c95-9615-00146241d4aa", text: "" },
      }),
    } as unknown as ChatState["client"];
    await loadChatHistory(host);
    expect(host.chatRunId).toBeNull();
    expect(host.workProgressPhase).toBeNull();
  });

  it("keeps a newer local run when history still reports a finalized run", async () => {
    const finished = "a0fcdff0-813a-4c95-9615-00146241d4aa";
    const state = createState({
      chatRunId: finished,
      chatStream: "",
      workProgressPhase: "thinking",
    });
    handleChatEvent(state, {
      runId: finished,
      sessionKey: "main",
      state: "final",
      message: { role: "assistant", content: [{ type: "text", text: "已结束" }] },
    });
    state.chatRunId = "run-next";
    state.chatStream = "下一轮";
    state.workProgressPhase = "drafting";
    state.client = {
      request: vi.fn().mockResolvedValue({
        messages: [{ role: "assistant", content: [{ type: "text", text: "已结束" }] }],
        activeRun: { runId: finished, text: "" },
      }),
    } as unknown as ChatState["client"];

    await loadChatHistory(state);

    expect(state.chatRunId).toBe("run-next");
    expect(state.chatStream).toBe("下一轮");
    expect(state.workProgressPhase).toBe("drafting");
  });

  it("does not let an idle activeRun snapshot restore a run a terminal event already cleared", async () => {
    const state = createState({
      connected: true,
      chatRunId: "run-1",
      chatStream: "正在检索",
    });
    const request = vi.fn().mockImplementation(async () => {
      state.chatRunId = null;
      state.chatStream = null;
      return {
        messages: [{ role: "assistant", content: [{ type: "text", text: "完成" }] }],
        activeRun: { runId: "run-1", text: "正在检索" },
      };
    });
    state.client = { request } as unknown as ChatState["client"];

    await loadChatHistory(state);

    expect(state.chatRunId).toBeNull();
    expect(state.chatStream).toBeNull();
  });

  it("keeps compose occupancy on a quiet reload while the turn has no assistant yet", async () => {
    const request = vi.fn().mockResolvedValue({ messages: [] });
    const localUser = {
      id: "local-run-1",
      role: "user",
      content: [{ type: "text", text: "请检索订单参谋 MCP" }],
    };
    const state = createState({
      connected: true,
      client: { request } as unknown as ChatState["client"],
      chatMessages: [localUser],
      chatRunId: "run-1",
      chatStream: "正在检索",
      chatHistoryQuietReload: true,
    });

    await loadChatHistory(state);

    expect(state.chatMessages).toEqual([localUser]);
    expect(state.chatRunId).toBe("run-1");
    expect(state.chatStream).toBe("正在检索");
  });

  it("keeps assistant message when text field has real content but content is NO_REPLY", async () => {
    const messages = [{ role: "assistant", text: "real reply", content: "NO_REPLY" }];
    const mockClient = {
      request: vi.fn().mockResolvedValue({ messages }),
    };
    const state = createState({
      client: mockClient as unknown as ChatState["client"],
      connected: true,
    });

    await loadChatHistory(state);

    // text takes precedence — "real reply" is NOT silent, so message is kept.
    expect(state.chatMessages).toHaveLength(1);
  });

  it("projects historical standalone assistant documents as preview artifacts", async () => {
    const article = [
      "《市场周报：AI工具如何改变内容团队》",
      "",
      "## 背景",
      "这是一份已经写入历史记录的公众号文章。".repeat(18),
      "",
      "## 结论",
      "它应该在刷新页面后仍然可以进入文件预览区。".repeat(18),
    ].join("\n");
    const messages = [
      {
        role: "assistant",
        content: [{ type: "text", text: article }],
        timestamp: 1776826000000,
      },
    ];
    const mockClient = {
      request: vi.fn().mockResolvedValue({ messages }),
    };
    const state = createState({
      client: mockClient as unknown as ChatState["client"],
      connected: true,
    });

    await loadChatHistory(state);

    const message = state.chatMessages[0] as Record<string, unknown>;
    const artifact = message.artifact as Record<string, unknown>;
    expect(artifact.artifactId).toMatch(/^assistant-doc:/);
    expect(artifact.title).toBe("市场周报：AI工具如何改变内容团队");
    expect((artifact.providerMetadata as Record<string, unknown>).previewText).toBe(article);
  });

  it("keeps collaboration history requests on the space alias session", async () => {
    const request = vi.fn().mockResolvedValue({
      messages: [{ role: "assistant", content: [{ type: "text", text: "history" }] }],
    });
    const state = createState({
      sessionKey: "space:alpha",
      sessionsResult: {
        count: 2,
        sessions: [
          { key: "space:alpha", kind: "unknown", updatedAt: 10 },
          { key: "agent:main:space:alpha", kind: "group", updatedAt: 20 },
        ],
        defaults: { model: null, contextTokens: null },
        path: "/tmp/sessions.json",
        ts: Date.now(),
      },
      connected: true,
      client: { request } as unknown as ChatState["client"],
    });

    await loadChatHistory(state);

    expect(request).toHaveBeenCalledWith("chat.history", {
      sessionKey: "space:alpha",
      limit: 200,
      includeTools: false,
    });
    expect(state.sessionKey).toBe("space:alpha");
  });

  it("does not rewrite collaboration space aliases even when bound sessions exist", async () => {
    const request = vi.fn().mockResolvedValue({
      messages: [{ role: "assistant", content: [{ type: "text", text: "history" }] }],
    });
    const state = createState({
      sessionKey: "space:alpha",
      sessionsResult: {
        count: 3,
        sessions: [
          { key: "space:alpha", kind: "unknown", updatedAt: 10 },
          {
            key: "agent:main:space:alpha",
            kind: "direct",
            chatType: "direct",
            updatedAt: 30,
          },
          {
            key: "agent:main:main:space:alpha",
            kind: "group",
            chatType: "group",
            updatedAt: 20,
          },
        ],
        defaults: { model: null, contextTokens: null },
        path: "/tmp/sessions.json",
        ts: Date.now(),
      },
      connected: true,
      client: { request } as unknown as ChatState["client"],
    });

    await loadChatHistory(state);

    expect(request).toHaveBeenCalledWith("chat.history", {
      sessionKey: "space:alpha",
      limit: 200,
      includeTools: false,
    });
    expect(state.sessionKey).toBe("space:alpha");
  });

  it("sends humanTakeoverObserved when the UI flagged an explicit takeover", async () => {
    const request = vi.fn().mockResolvedValue({ runId: "run-takeover", status: "started" });
    const state = createState({
      connected: true,
      chatHumanTakeoverObserved: true,
      client: { request } as unknown as ChatState["client"],
    });

    await sendChatMessage(state, "retry with my edits");

    expect(request).toHaveBeenCalledWith(
      "chat.send",
      expect.objectContaining({
        message: "retry with my edits",
        humanTakeoverObserved: true,
      }),
    );
    expect(state.chatHumanTakeoverObserved).toBe(false);
  });

  it("sends a focused context scope and resets turn-scoped selection after success", async () => {
    const request = vi.fn().mockResolvedValue({ runId: "run-scope", status: "started" });
    const state = createState({
      connected: true,
      sessionKey: "main",
      chatContextScope: {
        ...DEFAULT_CHAT_CONTEXT_SCOPE,
        preset: "conversation",
        lifetime: "turn",
        pickerOpen: true,
      },
      client: { request } as unknown as ChatState["client"],
    });

    await sendChatMessage(state, "帮我改这句话");

    expect(request).toHaveBeenCalledWith(
      "chat.send",
      expect.objectContaining({
        message: "帮我改这句话",
        contextScope: { mode: "minimal", lifetime: "turn" },
      }),
    );
    expect(state.chatContextScope).toEqual({
      ...DEFAULT_CHAT_CONTEXT_SCOPE,
    });
  });

  it("keeps session-scoped knowledge selection across sends", async () => {
    const request = vi.fn().mockResolvedValue({ runId: "run-scope-session", status: "started" });
    const state = createState({
      connected: true,
      sessionKey: "main",
      chatContextScope: {
        ...DEFAULT_CHAT_CONTEXT_SCOPE,
        preset: "knowledge",
        lifetime: "session",
        pickerOpen: true,
      },
      client: { request } as unknown as ChatState["client"],
    });

    await sendChatMessage(state, "查一下产品资料");

    expect(request).toHaveBeenCalledWith(
      "chat.send",
      expect.objectContaining({
        contextScope: {
          mode: "focused",
          lifetime: "session",
          sources: [{ type: "knowledge", id: "authorized" }],
        },
      }),
    );
    expect(state.chatContextScope).toMatchObject({
      preset: "knowledge",
      lifetime: "session",
      pickerOpen: false,
      consumeReceipts: [],
    });
  });

  it("sends selected file and API sources as focused context", async () => {
    const request = vi.fn().mockResolvedValue({ runId: "run-scope-custom", status: "started" });
    const state = createState({
      connected: true,
      sessionKey: "main",
      chatContextScope: {
        ...DEFAULT_CHAT_CONTEXT_SCOPE,
        preset: "custom",
        lifetime: "session",
        selectedSources: [
          { type: "file", id: "doc-roadmap", label: "roadmap.md" },
          { type: "api", id: "src-crm", label: "CRM" },
        ],
      },
      client: { request } as unknown as ChatState["client"],
    });

    await sendChatMessage(state, "只看这份路线图和 CRM");

    expect(request).toHaveBeenCalledWith(
      "chat.send",
      expect.objectContaining({
        contextScope: {
          mode: "focused",
          lifetime: "session",
          sources: [
            { type: "file", id: "doc-roadmap" },
            { type: "api", id: "src-crm" },
          ],
        },
      }),
    );
    expect(state.chatContextScope?.selectedSources).toEqual([
      { type: "file", id: "doc-roadmap", label: "roadmap.md" },
      { type: "api", id: "src-crm", label: "CRM" },
    ]);
  });

  it("keeps catalog parentId on focused chat.send sources", async () => {
    const request = vi.fn().mockResolvedValue({ runId: "run-scope-parent", status: "started" });
    const state = createState({
      connected: true,
      sessionKey: "main",
      chatContextSourceCatalog: [
        { type: "knowledge", id: "kb-product", label: "产品资料" },
        { type: "file", id: "doc-roadmap", label: "roadmap.md", parentId: "kb-product" },
      ],
      chatContextScope: {
        ...DEFAULT_CHAT_CONTEXT_SCOPE,
        preset: "custom",
        selectedSources: [{ type: "file", id: "doc-roadmap", label: "roadmap.md" }],
      },
      client: { request } as unknown as ChatState["client"],
    });

    await sendChatMessage(state, "只看路线图");

    expect(request).toHaveBeenCalledWith(
      "chat.send",
      expect.objectContaining({
        contextScope: {
          mode: "focused",
          lifetime: "turn",
          sources: [{ type: "file", id: "doc-roadmap", parentId: "kb-product" }],
        },
      }),
    );
  });

  it("sends confirmed expansion sources on retry and ignores a dismissed suggestion", async () => {
    const request = vi.fn().mockResolvedValue({ runId: "run-expand", status: "started" });
    const accepted = createState({
      connected: true,
      sessionKey: "main",
      chatMessages: [{ role: "user", content: "查差旅政策" }],
      chatContextScope: { ...DEFAULT_CHAT_CONTEXT_SCOPE },
      chatContextExpansion: {
        runId: "run-expand",
        reason: "empty",
        proposedSources: [{ type: "knowledge", id: "kb-product", label: "产品资料库" }],
      },
      client: { request } as unknown as ChatState["client"],
    });
    const { applyContextExpansionToScope } = await import("../chat/context-expansion.ts");
    accepted.chatContextScope = applyContextExpansionToScope(
      accepted.chatContextScope,
      accepted.chatContextExpansion?.proposedSources ?? [],
    );
    accepted.chatContextExpansion = null;
    await sendChatMessage(accepted, "查差旅政策");
    expect(request).toHaveBeenCalledWith(
      "chat.send",
      expect.objectContaining({
        contextScope: {
          mode: "focused",
          lifetime: "turn",
          sources: [{ type: "knowledge", id: "kb-product" }],
        },
      }),
    );

    const dismissed = createState({
      connected: true,
      sessionKey: "main",
      chatContextScope: { ...DEFAULT_CHAT_CONTEXT_SCOPE },
      chatContextExpansion: {
        runId: "run-expand",
        reason: "empty",
        proposedSources: [{ type: "knowledge", id: "kb-product", label: "产品资料库" }],
      },
      client: { request } as unknown as ChatState["client"],
    });
    dismissed.chatContextExpansion = null;
    await sendChatMessage(dismissed, "查差旅政策");
    expect(request.mock.calls.at(-1)?.[1]).not.toHaveProperty("contextScope");
  });

  it("sends collaboration messages through the selected space alias", async () => {
    const request = vi.fn().mockResolvedValue({ runId: "run-1", status: "started" });
    const state = createState({
      sessionKey: "agent:main:space:alpha",
      workbenchPrimaryModule: "collaboration",
      workbenchTeamSelectedKey: "space:alpha",
      connected: true,
      client: { request } as unknown as ChatState["client"],
    });

    await sendChatMessage(state, "open discussion");

    expect(request).toHaveBeenCalledWith(
      "chat.send",
      expect.objectContaining({
        sessionKey: "space:alpha",
        message: "open discussion",
      }),
    );
    expect(state.sessionKey).toBe("space:alpha");
  });

  it("preserves typed knowledge parent scope in chat.send", async () => {
    const request = vi.fn().mockResolvedValue({ runId: "run-typed-scope", status: "started" });
    const state = createState({
      connected: true,
      client: { request } as unknown as ChatState["client"],
    });

    await sendChatMessage(state, "只看路线图", undefined, {
      contextScope: {
        mode: "focused",
        lifetime: "turn",
        sources: [{ type: "file", id: "doc-roadmap", parentId: "kb-product" }],
      },
    });

    expect(request).toHaveBeenCalledWith(
      "chat.send",
      expect.objectContaining({
        contextScope: {
          mode: "focused",
          lifetime: "turn",
          sources: [{ type: "file", id: "doc-roadmap", parentId: "kb-product" }],
        },
      }),
    );
  });

  it("sends mention metadata when mention authority allows the targets", async () => {
    const request = vi.fn().mockResolvedValue({ runId: "run-1", status: "started" });
    const organizationContext = createOrganizationContext();
    const mentions = [createMention()];
    const state = createState({
      connected: true,
      client: { request } as unknown as ChatState["client"],
    });

    await sendChatMessage(state, "Hi @Agent A", undefined, {
      mentions,
      mentionAuthority: {
        senderIdentity: organizationContext.self,
        organizationContext,
      },
    });

    expect(request).toHaveBeenCalledWith(
      "chat.send",
      expect.objectContaining({
        message: "Hi @Agent A",
        mentions,
      }),
    );
  });

  it("blocks disallowed mentions before creating an optimistic message", async () => {
    const request = vi.fn().mockResolvedValue({ runId: "run-1", status: "started" });
    const senderIdentity = createRuntimeIdentity({ permissions: [] });
    const organizationContext = createOrganizationContext({ self: senderIdentity });
    const state = createState({
      connected: true,
      client: { request } as unknown as ChatState["client"],
    });

    const result = await sendChatMessage(state, "Ping @system", undefined, {
      mentions: [
        createMention({
          mention_id: "mention-system",
          agentId: "__system__",
          displayName: "system",
          offset: 5,
          length: 7,
        }),
      ],
      mentionAuthority: {
        senderIdentity,
        organizationContext,
      },
    });

    expect(result).toBeNull();
    expect(request).not.toHaveBeenCalled();
    expect(state.chatMessages).toEqual([]);
    expect(state.lastError).toContain("无法发送提及");
    expect(state.lastError).toContain("@system");
  });

  it("rolls back the optimistic user bubble when chat.send is rejected", async () => {
    const request = vi.fn().mockRejectedValue(new Error("unknown collaboration space"));
    const existing = {
      id: "keep-me",
      role: "assistant" as const,
      content: [{ type: "text", text: "prior" }],
      timestamp: 1,
    };
    const state = createState({
      connected: true,
      client: { request } as unknown as ChatState["client"],
      chatMessages: [existing],
    });

    const result = await sendChatMessage(state, "你好");

    expect(result).toBeNull();
    expect(state.chatMessages).toEqual([existing]);
    expect(state.lastError).toContain("当前协作空间尚未开通或不可写入");
    expect(state.chatRunId).toBeNull();
    expect(state.chatSending).toBe(false);
  });

  it("keeps the optimistic user row when the socket closes after chat.send", async () => {
    const request = vi.fn().mockRejectedValue(new Error("gateway closed (1006): "));
    const state = createState({
      connected: true,
      client: { request } as unknown as ChatState["client"],
      chatMessages: [],
    });

    const result = await sendChatMessage(state, "写周报");

    expect(result).toEqual(expect.any(String));
    expect(state.chatMessages).toEqual([
      expect.objectContaining({
        role: "user",
        content: [{ type: "text", text: "写周报" }],
      }),
    ]);
    expect(state.chatRunId).toBe(result);
    expect(state.lastError).toBeNull();
    expect(state.chatSending).toBe(false);
    expect(request).toHaveBeenCalledWith(
      "chat.send",
      expect.objectContaining({ idempotencyKey: result }),
    );
  });

  it("still drops the optimistic user row when the gateway rejects the send", async () => {
    const request = vi.fn().mockRejectedValue(new Error("gateway not connected"));
    const state = createState({
      connected: true,
      client: { request } as unknown as ChatState["client"],
    });

    const result = await sendChatMessage(state, "写周报");

    expect(result).toBeNull();
    expect(state.chatMessages).toEqual([]);
    expect(state.chatRunId).toBeNull();
  });

  it("sends document attachments as files", async () => {
    const request = vi.fn().mockResolvedValue({ runId: "run-1", status: "started" });
    const state = createState({
      connected: true,
      client: { request } as unknown as ChatState["client"],
    });

    await sendChatMessage(state, "", [
      {
        id: "att-1",
        dataUrl: `data:application/pdf;base64,${Buffer.from("pdf").toString("base64")}`,
        mimeType: "application/pdf",
        fileName: "report.pdf",
      },
    ]);

    expect(request).toHaveBeenCalledWith(
      "chat.send",
      expect.objectContaining({
        message: expect.stringContaining('<attachment name="report.pdf"'),
        attachments: [
          {
            type: "file",
            mimeType: "application/pdf",
            fileName: "report.pdf",
            content: Buffer.from("pdf").toString("base64"),
          },
        ],
      }),
    );
    expect(state.chatMessages.at(-1)).toEqual(
      expect.objectContaining({
        content: [
          {
            type: "file",
            fileName: "report.pdf",
            mimeType: "application/pdf",
            status: "sent",
          },
        ],
      }),
    );
  });

  it("omits failed attachments from the chat.send payload", async () => {
    const request = vi.fn().mockResolvedValue({ runId: "run-1", status: "started" });
    const state = createState({
      connected: true,
      client: { request } as unknown as ChatState["client"],
    });
    const pdf = Buffer.from("pdf").toString("base64");

    await sendChatMessage(state, "review", [
      {
        id: "att-ok",
        dataUrl: `data:application/pdf;base64,${pdf}`,
        mimeType: "application/pdf",
        fileName: "report.pdf",
        status: "ready",
      },
      {
        id: "att-rejected",
        dataUrl: "",
        mimeType: "application/octet-stream",
        fileName: "setup.exe",
        status: "failed",
        failureReason: "unsupported",
        error: "Cannot attach “setup.exe”",
      },
    ]);

    expect(request).toHaveBeenCalledWith(
      "chat.send",
      expect.objectContaining({
        attachments: [
          {
            type: "file",
            mimeType: "application/pdf",
            fileName: "report.pdf",
            content: pdf,
          },
        ],
      }),
    );
    const payload = request.mock.calls.find((call) => call[0] === "chat.send")?.[1] as {
      message?: string;
      attachments?: Array<{ fileName?: string }>;
    };
    expect(payload.attachments).toHaveLength(1);
    expect(JSON.stringify(payload)).not.toContain("setup.exe");
  });

  it("sends file attachments even when the browser data URL has an empty MIME slot", async () => {
    const request = vi.fn().mockResolvedValue({ runId: "run-1", status: "started" });
    const state = createState({
      connected: true,
      client: { request } as unknown as ChatState["client"],
    });
    const content = Buffer.from("docx bytes").toString("base64");

    await sendChatMessage(state, "review this", [
      {
        id: "att-1",
        dataUrl: `data:;base64,${content}`,
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        fileName: "report.docx",
      },
    ]);

    expect(request).toHaveBeenCalledWith(
      "chat.send",
      expect.objectContaining({
        message: expect.stringContaining('<attachment name="report.docx"'),
        attachments: [
          {
            type: "file",
            mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            fileName: "report.docx",
            content,
          },
        ],
      }),
    );
  });

  it("shows a readable error when attachment processing hits a call-stack overflow", async () => {
    const request = vi.fn().mockRejectedValue(new RangeError("Maximum call stack size exceeded"));
    const state = createState({
      connected: true,
      client: { request } as unknown as ChatState["client"],
    });

    await sendChatMessage(state, "review", [
      {
        id: "att-1",
        dataUrl: `data:application/pdf;base64,${Buffer.from("pdf").toString("base64")}`,
        mimeType: "application/pdf",
        fileName: "ebook.pdf",
      },
    ]);

    expect(state.lastError).toContain("处理附件时发生内部错误");
    expect(state.lastError).toMatch(/PDF|拆分|压缩/);
    expect(state.chatMessages).toEqual([]);
  });

  it("shows a readable attachment size error when the gateway rejects an oversized file", async () => {
    const request = vi
      .fn()
      .mockRejectedValue(
        new Error(
          "GatewayRequestError: Error: attachment report.pdf: exceeds size limit (31457280 > 26214400 bytes)",
        ),
      );
    const state = createState({
      connected: true,
      client: { request } as unknown as ChatState["client"],
    });

    await sendChatMessage(state, "review", [
      {
        id: "att-1",
        dataUrl: `data:application/pdf;base64,${Buffer.from("pdf").toString("base64")}`,
        mimeType: "application/pdf",
        fileName: "report.pdf",
      },
    ]);

    expect(state.lastError).toContain("附件“report.pdf”过大");
    expect(state.lastError).toContain("25 MB");
    expect(state.lastError).toContain("30 MB");
    expect(state.chatMessages).toEqual([]);
  });

  it("uses the selected collaboration space even when the active session is stale", async () => {
    const request = vi.fn().mockResolvedValue({ runId: "run-1", status: "started" });
    const state = createState({
      sessionKey: "agent:main:space:beta",
      workbenchPrimaryModule: "collaboration",
      workbenchTeamSelectedKey: "space:alpha",
      connected: true,
      client: { request } as unknown as ChatState["client"],
    });

    await sendChatMessage(state, "do not misroute");

    expect(request).toHaveBeenCalledWith(
      "chat.send",
      expect.objectContaining({
        sessionKey: "space:alpha",
      }),
    );
    expect(state.sessionKey).toBe("space:alpha");
  });

  it("sends to the selected assistant when sessionKey still points at another bot", async () => {
    const request = vi.fn().mockResolvedValue({ runId: "run-skill", status: "started" });
    const state = createState({
      sessionKey: "main",
      workbenchPrimaryModule: "assistant",
      workbenchTeamSelectedKey: "agent:bot-skill:main",
      connected: true,
      chatMessages: [{ role: "assistant", content: [{ type: "text", text: "steward leftover" }] }],
      client: { request } as unknown as ChatState["client"],
    });

    await sendChatMessage(state, "继续孵化");

    expect(request).toHaveBeenCalledWith(
      "chat.send",
      expect.objectContaining({
        sessionKey: "agent:bot-skill:main",
        message: "继续孵化",
      }),
    );
    expect(state.sessionKey).toBe("agent:bot-skill:main");
    // Previous bot transcript must not remain after realignment.
    expect(state.chatMessages.some((msg) => JSON.stringify(msg).includes("steward leftover"))).toBe(
      false,
    );
  });

  it("opens the employee asset flow directly for explicit save-to-my-assets commands", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "skill-lifecycle.extract") {
        return {
          suggestedName: "公众号文章编辑与发布",
          suggestedSummary: "将当前工作沉淀为个人资产",
          confidence: 0.88,
          detectedAt: Date.now(),
          profile: {
            name: "公众号文章编辑与发布",
            summary: "将当前工作沉淀为个人资产",
            visibility: "private",
          },
        };
      }
      return { runId: "run-1", status: "started" };
    });
    const state = createState({
      connected: true,
      client: { request } as unknown as ChatState["client"],
      chatMessages: [
        {
          role: "assistant",
          artifact: {
            artifactId: "artifact-wechat-1",
            title: "WeChat Draft",
          },
        },
      ],
    });

    const result = await sendChatMessage(
      state,
      "请将该技能发布到“我的资产”中，不是ClawHub 企业市场",
    );

    expect(result).toBeTruthy();
    expect(request).toHaveBeenCalledWith("skill-lifecycle.extract", {
      agentId: "main",
      contextId: "artifact-wechat-1",
    });
    expect(request).not.toHaveBeenCalledWith("chat.send", expect.anything());
    expect(state.workbenchPrimaryModule).toBe("knowledge");
    expect(state.knowledgeUniversePageTab).toBe("assets");
    expect(state.workbenchSkillSaveModalOpen).toBe(true);
    expect(state.workbenchSkillSavePreferEnterpriseSubmit).toBe(false);
    expect(state.workbenchSkillSaveModalFormData?.name).toBe("公众号文章编辑与发布");
    expect(state.chatMessages.at(-1)).toEqual(
      expect.objectContaining({
        role: "assistant",
      }),
    );
  });

  it("opens the employee asset flow in enterprise-submit mode for explicit enterprise commands", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "skill-lifecycle.extract") {
        return {
          suggestedName: "公众号文章编辑与发布",
          suggestedSummary: "整理后进入企业资产库审核",
          confidence: 0.9,
          detectedAt: Date.now(),
          profile: {
            name: "公众号文章编辑与发布",
            summary: "整理后进入企业资产库审核",
            visibility: "private",
          },
        };
      }
      return { runId: "run-1", status: "started" };
    });
    const state = createState({
      connected: true,
      client: { request } as unknown as ChatState["client"],
    });

    await sendChatMessage(state, "请把当前成果整理后提交企业审核");

    expect(request).toHaveBeenCalledWith("skill-lifecycle.extract", {
      agentId: "main",
      contextId: "main",
    });
    expect(state.workbenchSkillSaveModalOpen).toBe(true);
    expect(state.workbenchSkillSavePreferEnterpriseSubmit).toBe(true);
    expect(state.workbenchSkillSaveModalFormData?.assetType).toBe("workflow");
  });

  it("does not auto-open asset organize after 暂不处理 for the same session", async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
    });
    try {
      dismissAssetSuggestion({
        contextId: "artifact-wechat-1",
        sessionKey: "main",
      });
      const request = vi.fn(async () => ({ runId: "run-1", status: "started" }));
      const state = createState({
        connected: true,
        client: { request } as unknown as ChatState["client"],
        chatMessages: [
          {
            role: "assistant",
            artifact: {
              artifactId: "artifact-wechat-1",
              title: "WeChat Draft",
            },
          },
        ],
      });

      await sendChatMessage(state, "请将该技能发布到“我的资产”中，不是ClawHub 企业市场");

      expect(request).toHaveBeenCalledWith(
        "chat.send",
        expect.objectContaining({
          message: expect.stringContaining("我的资产"),
        }),
      );
      expect(state.workbenchSkillSaveModalOpen).toBeFalsy();
    } finally {
      clearAssetSuggestionDismissalsForTests();
      vi.unstubAllGlobals();
    }
  });

  it("sends growthGateProceed when options.growthGateProceed is true", async () => {
    const request = vi.fn().mockResolvedValue({ runId: "run-gate", status: "started" });
    const state = createState({
      connected: true,
      client: { request } as unknown as ChatState["client"],
    });

    await sendChatMessage(state, "继续原任务", undefined, { growthGateProceed: true });

    expect(request).toHaveBeenCalledWith(
      "chat.send",
      expect.objectContaining({
        message: "继续原任务",
        growthGateProceed: true,
      }),
    );
  });

  it("sends growthGateProceed when host flag is authorized after resume", async () => {
    const request = vi.fn().mockResolvedValue({ runId: "run-gate-2", status: "started" });
    const state = createState({
      connected: true,
      client: { request } as unknown as ChatState["client"],
    }) as ChatState & { workbenchGrowthGateProceedAuthorized?: boolean };
    state.workbenchGrowthGateProceedAuthorized = true;

    await sendChatMessage(state, "增强后继续");

    expect(request).toHaveBeenCalledWith(
      "chat.send",
      expect.objectContaining({
        message: "增强后继续",
        growthGateProceed: true,
      }),
    );
    expect(state.workbenchGrowthGateProceedAuthorized).toBe(false);
  });
});

describe("loadChatHistory", () => {
  it("filters assistant NO_REPLY messages and keeps user NO_REPLY messages", async () => {
    const request = vi.fn().mockResolvedValue({
      messages: [
        { role: "assistant", content: [{ type: "text", text: "NO_REPLY" }] },
        { role: "assistant", content: [{ type: "text", text: "visible answer" }] },
        { role: "user", content: [{ type: "text", text: "NO_REPLY" }] },
      ],
      thinkingLevel: "low",
    });
    const state = createState({
      connected: true,
      client: { request } as unknown as ChatState["client"],
    });

    await loadChatHistory(state);

    expect(request).toHaveBeenCalledWith("chat.history", {
      sessionKey: "main",
      limit: 200,
      includeTools: false,
    });
    expect(state.chatMessages).toEqual([
      { role: "assistant", content: [{ type: "text", text: "visible answer" }] },
      { role: "user", content: [{ type: "text", text: "NO_REPLY" }] },
    ]);
    expect(state.chatThinkingLevel).toBe("low");
    expect(state.chatLoading).toBe(false);
    expect(state.lastError).toBeNull();
  });

  it("retries without includeTools when connected to a legacy gateway", async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(
        new Error(
          "GatewayRequestError: invalid chat.history params: at root: unexpected property 'includeTools'",
        ),
      )
      .mockResolvedValueOnce({
        messages: [{ role: "assistant", content: [{ type: "text", text: "history restored" }] }],
        thinkingLevel: "off",
      });
    const state = createState({
      connected: true,
      client: { request } as unknown as ChatState["client"],
    });

    await loadChatHistory(state);

    expect(request).toHaveBeenNthCalledWith(1, "chat.history", {
      sessionKey: "main",
      limit: 200,
      includeTools: false,
    });
    expect(request).toHaveBeenNthCalledWith(2, "chat.history", {
      sessionKey: "main",
      limit: 200,
    });
    expect(state.chatMessages).toEqual([
      { role: "assistant", content: [{ type: "text", text: "history restored" }] },
    ]);
    expect(state.lastError).toBeNull();
  });

  it("skips includeTools after legacy fallback is detected once", async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(
        new Error(
          "GatewayRequestError: invalid chat.history params: at root: unexpected property 'includeTools'",
        ),
      )
      .mockResolvedValueOnce({ messages: [] })
      .mockResolvedValueOnce({ messages: [] });
    const state = createState({
      connected: true,
      client: { request } as unknown as ChatState["client"],
    });

    await loadChatHistory(state);
    await loadChatHistory(state);

    expect(request).toHaveBeenNthCalledWith(3, "chat.history", {
      sessionKey: "main",
      limit: 200,
    });
  });

  it("loads history for the selected assistant when nav and sessionKey diverge", async () => {
    const request = vi.fn().mockResolvedValue({ messages: [], thinkingLevel: null });
    const state = createState({
      connected: true,
      sessionKey: "agent:bot-skill:main",
      workbenchPrimaryModule: "assistant",
      workbenchTeamSelectedKey: "main",
      client: { request } as unknown as ChatState["client"],
    });

    await loadChatHistory(state);

    expect(request).toHaveBeenCalledWith("chat.history", {
      sessionKey: "main",
      limit: 200,
      includeTools: false,
    });
    expect(state.sessionKey).toBe("main");
  });

  it("loads steward history when nav is main but primaryModule is still collaboration", async () => {
    const request = vi.fn().mockResolvedValue({ messages: [], thinkingLevel: null });
    const state = createState({
      connected: true,
      sessionKey: "agent:bot-skill:main",
      workbenchPrimaryModule: "collaboration",
      workbenchTeamSelectedKey: "main",
      client: { request } as unknown as ChatState["client"],
    });

    await loadChatHistory(state);

    expect(request).toHaveBeenCalledWith("chat.history", {
      sessionKey: "main",
      limit: 200,
      includeTools: false,
    });
    expect(state.sessionKey).toBe("main");
  });
});

describe("loadOlderChatHistory", () => {
  it("does not banner when the local transcript list is missing", async () => {
    const older = {
      id: "m-older",
      role: "assistant",
      content: [{ type: "text", text: "更早的一条" }],
    };
    const state = createState({
      connected: true,
      chatHistoryHasMore: true,
      chatHistoryNextBefore: "cursor-1",
      client: {
        request: vi.fn().mockResolvedValue({
          messages: [older],
          nextBefore: null,
          hasMore: false,
        }),
      } as unknown as ChatState["client"],
    });
    Reflect.deleteProperty(state, "chatMessages");

    await loadOlderChatHistory(state);

    expect(state.lastError).toBeNull();
    expect(state.chatMessages).toEqual([expect.objectContaining({ id: "m-older" })]);
  });

  it("stores nextBefore/hasMore from chat.history and prepends older pages", async () => {
    const page1 = [
      { id: "m2", role: "user", content: [{ type: "text", text: "newer" }] },
      { id: "m3", role: "assistant", content: [{ type: "text", text: "reply" }] },
    ];
    const page2 = [{ id: "m1", role: "user", content: [{ type: "text", text: "older" }] }];
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        messages: page1,
        nextBefore: "cursor-page1",
        hasMore: true,
      })
      .mockResolvedValueOnce({
        messages: page2,
        nextBefore: null,
        hasMore: false,
      });
    const state = createState({
      connected: true,
      client: { request } as unknown as ChatState["client"],
    });

    await loadChatHistory(state);
    expect(state.chatHistoryHasMore).toBe(true);
    expect(state.chatHistoryNextBefore).toBe("cursor-page1");
    expect(state.chatMessages).toHaveLength(2);

    await loadOlderChatHistory(state);
    expect(request).toHaveBeenNthCalledWith(2, "chat.history", {
      sessionKey: "main",
      limit: 200,
      before: "cursor-page1",
      includeTools: false,
    });
    expect(state.chatMessages).toHaveLength(3);
    expect((state.chatMessages[0] as { id?: string }).id).toBe("m1");
    expect(state.chatHistoryHasMore).toBe(false);
    expect(state.chatHistoryNextBefore).toBeNull();
    expect(state.chatHistoryLoadingMore).toBe(false);
  });

  it("keeps live rows when history returns an empty page with hasMore", async () => {
    const live = {
      id: "local-probe",
      role: "user",
      content: [{ type: "text", text: "路径探测B" }],
    };
    const request = vi.fn().mockResolvedValue({
      messages: [],
      nextBefore: "cursor-stale-index",
      hasMore: true,
    });
    const state = createState({
      connected: true,
      client: { request } as unknown as ChatState["client"],
      chatMessages: [live],
    });

    await loadChatHistory(state);

    expect(state.chatMessages).toEqual([live]);
    expect(state.chatHistoryHasMore).toBe(true);
    expect(state.chatHistoryNextBefore).toBe("cursor-stale-index");
  });

  it("keeps live rows when history returns an empty terminal page", async () => {
    const live = {
      id: "local-probe",
      role: "assistant",
      content: [{ type: "text", text: "路径探测C" }],
    };
    const request = vi.fn().mockResolvedValue({
      messages: [],
      nextBefore: null,
      hasMore: false,
    });
    const state = createState({
      connected: true,
      client: { request } as unknown as ChatState["client"],
      chatMessages: [live],
    });

    await loadChatHistory(state);

    expect(state.chatMessages).toEqual([live]);
    expect(state.chatHistoryHasMore).toBe(false);
  });

  it("replaces optimistic local rows when a checkpoint restore reloads an empty transcript", async () => {
    resetWorkbenchSessionTranscriptCacheForTests();
    const live = {
      id: "local-1",
      role: "user",
      content: [{ type: "text", text: "你好" }],
    };
    const request = vi.fn().mockResolvedValue({
      messages: [],
      nextBefore: null,
      hasMore: false,
    });
    const state = createState({
      connected: true,
      sessionKey: "agent:market:main",
      client: { request } as unknown as ChatState["client"],
      chatMessages: [
        { id: "m0", role: "assistant", content: [{ type: "text", text: "之前" }] },
        live,
      ],
      chatHistoryReplaceLocal: true,
    });

    await loadChatHistory(state);

    expect(state.chatMessages).toEqual([]);
    expect(state.chatHistoryReplaceLocal).toBe(false);
    expect(readWorkbenchSessionTranscript("agent:market:main")?.messages).toEqual([]);
    resetWorkbenchSessionTranscriptCacheForTests();
  });

  it("does not reopen the computer preview from historical 云电脑 text", async () => {
    const request = vi.fn().mockResolvedValue({
      messages: [
        {
          role: "assistant",
          content: [{ type: "text", text: "我已经在云电脑里打开京东了" }],
        },
      ],
    });
    const state = createState({
      connected: true,
      client: { request } as unknown as ChatState["client"],
    });
    const host = state as ChatState & { sidebarOpen?: boolean; sidebarSurface?: string };
    host.sidebarOpen = false;
    host.sidebarSurface = "artifact";

    await loadChatHistory(state);

    expect(host.sidebarOpen).toBe(false);
    expect(host.sidebarSurface).toBe("artifact");
  });

  it("does not keep main employee history when loading an empty collaboration space transcript", async () => {
    const leftover = {
      role: "assistant",
      content: [
        {
          type: "text",
          text: "Workspace authorization failed. Managed Enterprise does not fall back to legacy workspace paths.",
        },
      ],
    };
    const request = vi.fn().mockResolvedValue({
      messages: [],
      nextBefore: null,
      hasMore: false,
    });
    const state = createState({
      connected: true,
      sessionKey: "agent:main:employee:alice",
      workbenchPrimaryModule: "collaboration",
      workbenchTeamSelectedKey: "space:grp-test",
      client: { request } as unknown as ChatState["client"],
      chatMessages: [leftover],
    });

    await loadChatHistory(state);

    expect(request).toHaveBeenCalledWith("chat.history", {
      sessionKey: "space:grp-test",
      limit: 200,
      includeTools: false,
    });
    expect(state.sessionKey).toBe("space:grp-test");
    expect(state.chatMessages).toEqual([]);
  });

  it("clears foreign bubbles when history realigns across chat surfaces", async () => {
    const leftover = {
      role: "user",
      content: [{ type: "text", text: "hello from steward" }],
    };
    const request = vi.fn().mockResolvedValue({
      messages: [{ role: "assistant", content: [{ type: "text", text: "group only" }] }],
    });
    const state = createState({
      connected: true,
      sessionKey: "agent:main:employee:alice",
      workbenchPrimaryModule: "collaboration",
      workbenchTeamSelectedKey: "space:grp-test",
      client: { request } as unknown as ChatState["client"],
      chatMessages: [leftover],
    });

    await loadChatHistory(state);

    expect(state.sessionKey).toBe("space:grp-test");
    expect(state.chatMessages).toEqual([
      { role: "assistant", content: [{ type: "text", text: "group only" }] },
    ]);
  });

  it("dedupes overlapping ids when prepending older history", async () => {
    const request = vi.fn().mockResolvedValue({
      messages: [
        { id: "m1", role: "user", content: [{ type: "text", text: "dup" }] },
        { id: "m0", role: "user", content: [{ type: "text", text: "older-unique" }] },
      ],
      nextBefore: null,
      hasMore: false,
    });
    const state = createState({
      connected: true,
      client: { request } as unknown as ChatState["client"],
      chatMessages: [{ id: "m1", role: "user", content: [{ type: "text", text: "dup" }] }],
      chatHistoryHasMore: true,
      chatHistoryNextBefore: "cursor-x",
    });

    await loadOlderChatHistory(state);
    expect(state.chatMessages).toHaveLength(2);
    expect((state.chatMessages[0] as { id?: string }).id).toBe("m0");
    expect((state.chatMessages[1] as { id?: string }).id).toBe("m1");
  });

  it("does not apply history after the user switched sessions", async () => {
    let resolveHistory: ((value: unknown) => void) | undefined;
    const request = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveHistory = resolve;
        }),
    );
    const state = createState({
      connected: true,
      sessionKey: "agent:bot-a:main",
      client: { request } as unknown as ChatState["client"],
      chatMessages: [],
    });

    const pending = loadChatHistory(state);
    state.sessionKey = "agent:bot-b:main";
    state.chatMessages = [{ role: "assistant", content: [{ type: "text", text: "b-cache" }] }];
    state.chatLoading = true;
    resolveHistory?.({
      messages: [{ role: "assistant", content: [{ type: "text", text: "from-a" }] }],
    });
    await pending;

    expect(state.chatMessages).toEqual([
      { role: "assistant", content: [{ type: "text", text: "b-cache" }] },
    ]);
    expect(state.chatLoading).toBe(true);
  });

  it("no-ops when hasMore is false", async () => {
    const request = vi.fn();
    const state = createState({
      connected: true,
      client: { request } as unknown as ChatState["client"],
      chatHistoryHasMore: false,
      chatHistoryNextBefore: null,
    });
    await loadOlderChatHistory(state);
    expect(request).not.toHaveBeenCalled();
  });
});

describe("handleChatEvent thinking progress (process channel)", () => {
  it("stores sanitized thinking structure and clears it when delivery delta arrives", () => {
    const state = createState({
      chatRunId: "run-1",
      chatStream: "",
      chatStreamStartedAt: Date.now(),
    });
    const thinkingPayload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "thinking",
      thinking: {
        steps: [
          { id: "step-0", label: "理解问题", status: "done" },
          { id: "step-1", label: "组织回答", status: "active" },
        ],
        activeIndex: 1,
        percent: 42,
        placeholder: "正在梳理思路…",
      },
    };
    expect(handleChatEvent(state, thinkingPayload)).toBe("thinking");
    expect(state.chatThinkingProgress?.steps[1]?.label).toBe("组织回答");
    expect(state.chatStream).toBe("");

    const deltaPayload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "delta",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "本机微信数据在容器目录里。" }],
      },
    };
    expect(handleChatEvent(state, deltaPayload)).toBe("delta");
    expect(state.chatStream).toContain("本机微信");
    expect(state.chatThinkingProgress).toBeNull();
  });

  it("opens empty stream slot when thinking arrives with null chatStream", () => {
    const state = createState({
      chatRunId: "run-3",
      chatStream: null,
      chatStreamStartedAt: null,
    });
    const thinkingPayload: ChatEventPayload = {
      runId: "run-3",
      sessionKey: "main",
      state: "thinking",
      thinking: {
        steps: [
          { id: "step-0", label: "理解问题", status: "active" },
          { id: "step-1", label: "组织回答", status: "pending" },
        ],
        activeIndex: 0,
        percent: 12,
        placeholder: "正在梳理思路…",
      },
    };
    expect(handleChatEvent(state, thinkingPayload)).toBe("thinking");
    expect(state.chatStream).toBe("");
    expect(state.chatStreamStartedAt).toEqual(expect.any(Number));
    expect(state.chatThinkingProgress?.steps[0]?.label).toBe("理解问题");
  });

  it("rejects unsafe thinking payloads that look like raw CoT", () => {
    const state = createState({
      chatRunId: "run-2",
      chatStream: "",
    });
    const bad: ChatEventPayload = {
      runId: "run-2",
      sessionKey: "main",
      state: "thinking",
      thinking: {
        steps: [{ id: "x", label: "Let me check sandbox", status: "active" }],
        activeIndex: 0,
        percent: 10,
        placeholder: "正在梳理思路…",
      },
    };
    expect(handleChatEvent(state, bad)).toBe("thinking");
    expect(state.chatThinkingProgress).toBeNull();
  });
});

describe("discuss-to-task status receipt does not end parent chat run (R6)", () => {
  const sessionKey = "space:grp-demo";
  const parentRunId = "run-parent-1";
  const receiptRunId = `${parentRunId}:discuss-to-task-receipt`;
  const persistFailCopy = "正式任务已建立（展示写入失败，请刷新后重试。）";

  function receiptPayload(overrides: Partial<ChatEventPayload> = {}): ChatEventPayload {
    return {
      runId: receiptRunId,
      sessionKey,
      state: "status",
      message: {
        id: `discuss-to-task-receipt:${parentRunId}`,
        role: "assistant",
        content: [{ type: "text", text: "正式任务已建立，任务编号 T-1。" }],
        timestamp: 1000,
        senderLabel: "协作调度",
        discussToTaskReceipt: true,
        collaborationRoundId: parentRunId,
      },
      ...overrides,
    };
  }

  it("main run stays active after receipt; thinking/delta still apply; only main final clears", () => {
    const initialThinking = {
      steps: [
        { id: "step-0", label: "理解问题", status: "done" as const },
        { id: "step-1", label: "组织回答", status: "active" as const },
      ],
      activeIndex: 1,
      percent: 40,
      placeholder: "正在梳理思路…",
    };
    const state = createState({
      sessionKey,
      chatRunId: parentRunId,
      chatStream: "",
      chatStreamStartedAt: 10,
      chatThinkingProgress: initialThinking,
      chatMessages: [],
    });

    expect(handleChatEvent(state, receiptPayload())).toBe("status");
    expect(state.chatRunId).toBe(parentRunId);
    expect(state.chatStream).toBe("");
    expect(state.chatStreamStartedAt).toBe(10);
    expect(state.chatThinkingProgress).toEqual(initialThinking);
    expect(state.chatMessages).toHaveLength(1);
    expect(JSON.stringify(state.chatMessages[0])).toContain("正式任务已建立");

    const nextThinking = {
      steps: [
        { id: "step-0", label: "理解问题", status: "done" as const },
        { id: "step-1", label: "组织回答", status: "done" as const },
        { id: "step-2", label: "继续执行", status: "active" as const },
      ],
      activeIndex: 2,
      percent: 66,
      placeholder: "正在梳理思路…",
    };
    const thinking: ChatEventPayload = {
      runId: parentRunId,
      sessionKey,
      state: "thinking",
      thinking: nextThinking,
    };
    expect(handleChatEvent(state, thinking)).toBe("thinking");
    expect(state.chatRunId).toBe(parentRunId);
    expect(state.chatThinkingProgress).toEqual(nextThinking);

    const delta: ChatEventPayload = {
      runId: parentRunId,
      sessionKey,
      state: "delta",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "主答进行中…" }],
      },
    };
    expect(handleChatEvent(state, delta)).toBe("delta");
    expect(state.chatRunId).toBe(parentRunId);
    expect(state.chatStream).toBe("主答进行中…");
    // Visible delivery clears thinking placeholder, but run stays open.
    expect(state.chatThinkingProgress).toBeNull();

    const mainFinal: ChatEventPayload = {
      runId: parentRunId,
      sessionKey,
      state: "final",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "主答完成。" }],
      },
    };
    expect(handleChatEvent(state, mainFinal)).toBe("final");
    expect(state.chatRunId).toBeNull();
    expect(state.chatStream).toBeNull();
    expect(state.chatStreamStartedAt).toBeNull();
    expect(JSON.stringify(state.chatMessages)).toContain("主答完成");
  });

  it("legacy final receipt semantics would have cleared — status must not", () => {
    const state = createState({
      sessionKey,
      chatRunId: parentRunId,
      chatStream: "partial",
      chatStreamStartedAt: 5,
      chatMessages: [],
    });
    // Guard: same runId shape with state final still clears (protocol terminal).
    const badLegacy: ChatEventPayload = {
      ...receiptPayload(),
      state: "final",
    };
    expect(handleChatEvent(state, badLegacy)).toBe("final");
    expect(state.chatRunId).toBeNull();

    const state2 = createState({
      sessionKey,
      chatRunId: parentRunId,
      chatStream: "partial",
      chatStreamStartedAt: 5,
      chatMessages: [],
    });
    expect(handleChatEvent(state2, receiptPayload())).toBe("status");
    expect(state2.chatRunId).toBe(parentRunId);
    expect(state2.chatStream).toBe("partial");
    expect(state2.chatStreamStartedAt).toBe(5);
  });

  it("persist-fail fixed copy is visible without ending the parent run", () => {
    const state = createState({
      sessionKey,
      chatRunId: parentRunId,
      chatStream: null,
      chatStreamStartedAt: 1,
      chatMessages: [],
    });
    const payload = receiptPayload({
      message: {
        id: `discuss-to-task-receipt:${parentRunId}`,
        role: "assistant",
        content: [{ type: "text", text: persistFailCopy }],
        timestamp: 1000,
        discussToTaskReceipt: true,
      },
    });
    expect(handleChatEvent(state, payload)).toBe("status");
    expect(state.chatRunId).toBe(parentRunId);
    expect(JSON.stringify(state.chatMessages)).toContain("展示写入失败");
    expect(JSON.stringify(state.chatMessages)).not.toMatch(/disk_full|EACCES/);
  });

  it("duplicate receipt is deduped while parent run stays active", () => {
    const state = createState({
      sessionKey,
      chatRunId: parentRunId,
      chatStream: "",
      chatStreamStartedAt: 2,
      chatMessages: [],
    });
    const once = receiptPayload();
    expect(handleChatEvent(state, once)).toBe("status");
    expect(handleChatEvent(state, once)).toBe("status");
    expect(state.chatMessages).toHaveLength(1);
    expect(state.chatRunId).toBe(parentRunId);
  });

  it("other sessions do not receive the receipt", () => {
    const state = createState({
      sessionKey: "space:other-group",
      chatRunId: "run-other",
      chatStream: "keep",
      chatMessages: [],
    });
    expect(handleChatEvent(state, receiptPayload())).toBeNull();
    expect(state.chatMessages).toEqual([]);
    expect(state.chatRunId).toBe("run-other");
    expect(state.chatStream).toBe("keep");
  });

  it("idle session still appends status without opening a run", () => {
    const state = createState({
      sessionKey,
      chatRunId: null,
      chatStream: null,
      chatMessages: [],
    });
    expect(handleChatEvent(state, receiptPayload())).toBe("status");
    expect(state.chatRunId).toBeNull();
    expect(state.chatStream).toBeNull();
    expect(state.chatMessages).toHaveLength(1);
  });
});

describe("discuss-to-task receipt identity dedupe (R7)", () => {
  const sessionKey = "space:grp-dedupe";
  const flagOffCopy = "当前组未启用正式任务能力，尚未建立正式任务。";

  function statusReceipt(params: {
    runId: string;
    text?: string;
    receiptId?: string;
  }): ChatEventPayload {
    const receiptId = params.receiptId ?? `discuss-to-task-receipt:${params.runId}`;
    return {
      runId: `${params.runId}:discuss-to-task-receipt`,
      sessionKey,
      state: "status",
      message: {
        id: receiptId,
        receiptId,
        role: "assistant",
        content: [{ type: "text", text: params.text ?? flagOffCopy }],
        timestamp: Date.now(),
        senderLabel: "协作调度",
        discussToTaskReceipt: true,
        collaborationRoundId: params.runId,
      },
    };
  }

  it("same receipt redelivery shows once", () => {
    const state = createState({
      sessionKey,
      chatRunId: "run-open",
      chatStream: "",
      chatStreamStartedAt: 1,
      chatMessages: [],
    });
    const once = statusReceipt({ runId: "req-1" });
    expect(handleChatEvent(state, once)).toBe("status");
    expect(handleChatEvent(state, once)).toBe("status");
    expect(state.chatMessages).toHaveLength(1);
    expect(state.chatRunId).toBe("run-open");
  });

  it("different requests with identical text both show", () => {
    const state = createState({
      sessionKey,
      chatRunId: "run-open",
      chatStream: "",
      chatStreamStartedAt: 1,
      chatMessages: [],
    });
    expect(handleChatEvent(state, statusReceipt({ runId: "flag-off-a" }))).toBe("status");
    expect(handleChatEvent(state, statusReceipt({ runId: "flag-off-b" }))).toBe("status");
    expect(state.chatMessages).toHaveLength(2);
    const ids = state.chatMessages.map((m) => (m as { receiptId?: string; id?: string }).receiptId);
    expect(ids).toEqual([
      "discuss-to-task-receipt:flag-off-a",
      "discuss-to-task-receipt:flag-off-b",
    ]);
    expect(JSON.stringify(state.chatMessages[0])).toContain(flagOffCopy);
    expect(JSON.stringify(state.chatMessages[1])).toContain(flagOffCopy);
    expect(state.chatRunId).toBe("run-open");
  });

  it("same-receipt status change updates in place (does not silently drop)", () => {
    const state = createState({
      sessionKey,
      chatRunId: "run-open",
      chatStream: "partial",
      chatStreamStartedAt: 2,
      chatMessages: [],
    });
    const runId = "req-change";
    expect(handleChatEvent(state, statusReceipt({ runId, text: "正式任务建立中…" }))).toBe(
      "status",
    );
    expect(state.chatMessages).toHaveLength(1);
    expect(JSON.stringify(state.chatMessages[0])).toContain("正式任务建立中");

    expect(
      handleChatEvent(state, statusReceipt({ runId, text: "正式任务已建立，任务编号 T-9。" })),
    ).toBe("status");
    expect(state.chatMessages).toHaveLength(1);
    expect(JSON.stringify(state.chatMessages[0])).toContain("任务编号 T-9");
    expect(JSON.stringify(state.chatMessages[0])).not.toContain("正式任务建立中");
    // Parent run must stay active across status update.
    expect(state.chatRunId).toBe("run-open");
    expect(state.chatStream).toBe("partial");
  });
});

describe("sendChatMessage preserveActiveRunOccupancy", () => {
  it("keeps background chatRunId when mid-task send succeeds", async () => {
    const request = vi.fn().mockResolvedValue({ ok: true });
    const state = {
      client: { request },
      connected: true,
      sessionKey: "agent:main:main",
      chatMessages: [],
      chatSending: false,
      chatRunId: "run-a" as string | null,
      chatStream: "正在调研…",
      chatStreamStartedAt: 1000 as number | null,
      chatStreamSessionKey: "agent:main:main" as string | null,
      chatThinkingProgress: null,
      workProgressPhase: "thinking" as const,
      workProgressToolsInFlight: 1,
      workProgressNarration: null,
      lastError: null,
      chatHumanTakeoverObserved: false,
    };
    const result = await sendChatMessage(state as never, "进度如何？", undefined, {
      preserveActiveRunOccupancy: true,
    });
    expect(result).toBeTruthy();
    expect(request).toHaveBeenCalledWith(
      "chat.send",
      expect.objectContaining({ message: "进度如何？" }),
    );
    expect(state.chatRunId).toBe("run-a");
    expect(state.chatStream).toBe("正在调研…");
    expect(state.chatSending).toBe(false);
  });

  it("does not clear background occupancy when mid-task send fails", async () => {
    const request = vi.fn().mockRejectedValue(new Error("ACL deny"));
    const state = {
      client: { request },
      connected: true,
      sessionKey: "agent:main:main",
      chatMessages: [],
      chatSending: false,
      chatRunId: "run-a" as string | null,
      chatStream: "partial-a" as string | null,
      chatStreamStartedAt: 1000 as number | null,
      chatStreamSessionKey: "agent:main:main" as string | null,
      chatThinkingProgress: null,
      workProgressPhase: "thinking" as const,
      workProgressToolsInFlight: 0,
      workProgressNarration: null,
      lastError: null,
      chatHumanTakeoverObserved: false,
    };
    const result = await sendChatMessage(state as never, "插问", undefined, {
      preserveActiveRunOccupancy: true,
    });
    expect(result).toBeNull();
    expect(state.chatRunId).toBe("run-a");
    expect(state.chatStream).toBe("partial-a");
    expect(state.lastError).toBeTruthy();
  });
  it("P0: A completed during RPC wait — fail must not resurrect occupancy", async () => {
    let rejectRpc!: (err: Error) => void;
    const request = vi.fn(
      () =>
        new Promise((_, rej) => {
          rejectRpc = rej as (err: Error) => void;
        }),
    );
    const state = {
      client: { request },
      connected: true,
      sessionKey: "agent:main:main",
      chatMessages: [],
      chatSending: false,
      chatRunId: "run-a" as string | null,
      chatStream: "partial-a" as string | null,
      chatStreamStartedAt: 1000 as number | null,
      chatStreamSessionKey: "agent:main:main" as string | null,
      chatThinkingProgress: null,
      workProgressPhase: "thinking" as const,
      workProgressToolsInFlight: 0,
      workProgressNarration: null,
      lastError: null,
      chatHumanTakeoverObserved: false,
    };
    const pending = sendChatMessage(state as never, "插问B", undefined, {
      preserveActiveRunOccupancy: true,
    });
    // A completed while B's RPC was in flight.
    state.chatRunId = null;
    state.chatStream = null;
    state.chatStreamStartedAt = null;
    state.chatStreamSessionKey = null;
    state.workProgressPhase = null as never;
    rejectRpc(new Error("ACL deny"));
    const result = await pending;
    expect(result).toBeNull();
    expect(state.chatRunId).toBeNull();
    expect(state.chatStream).toBeNull();
    expect(state.lastError).toBeTruthy();
  });

  it("P0: A cancelled during RPC wait — fail must not restore old runId", async () => {
    let rejectRpc!: (err: Error) => void;
    const request = vi.fn(
      () =>
        new Promise((_, rej) => {
          rejectRpc = rej as (err: Error) => void;
        }),
    );
    const state = {
      client: { request },
      connected: true,
      sessionKey: "agent:main:main",
      chatMessages: [],
      chatSending: false,
      chatRunId: "run-a" as string | null,
      chatStream: "partial-a" as string | null,
      chatStreamStartedAt: 1000 as number | null,
      chatStreamSessionKey: "agent:main:main" as string | null,
      chatThinkingProgress: null,
      workProgressPhase: "thinking" as const,
      workProgressToolsInFlight: 1,
      workProgressNarration: null,
      lastError: null,
      chatHumanTakeoverObserved: false,
    };
    const pending = sendChatMessage(state as never, "插问B", undefined, {
      preserveActiveRunOccupancy: true,
    });
    state.chatRunId = null;
    state.chatStream = null;
    rejectRpc(new Error("network"));
    await pending;
    expect(state.chatRunId).toBeNull();
    expect(state.chatStream).toBeNull();
  });

  it("P0: A produced new delta during RPC wait — fail must not roll back stream", async () => {
    let rejectRpc!: (err: Error) => void;
    const request = vi.fn(
      () =>
        new Promise((_, rej) => {
          rejectRpc = rej as (err: Error) => void;
        }),
    );
    const state = {
      client: { request },
      connected: true,
      sessionKey: "agent:main:main",
      chatMessages: [],
      chatSending: false,
      chatRunId: "run-a" as string | null,
      chatStream: "partial-a" as string | null,
      chatStreamStartedAt: 1000 as number | null,
      chatStreamSessionKey: "agent:main:main" as string | null,
      chatThinkingProgress: null,
      workProgressPhase: "thinking" as const,
      workProgressToolsInFlight: 0,
      workProgressNarration: null,
      lastError: null,
      chatHumanTakeoverObserved: false,
    };
    const pending = sendChatMessage(state as never, "插问B", undefined, {
      preserveActiveRunOccupancy: true,
    });
    state.chatStream = "partial-a\n新进度 delta";
    state.workProgressToolsInFlight = 2;
    rejectRpc(new Error("timeout"));
    await pending;
    expect(state.chatRunId).toBe("run-a");
    expect(state.chatStream).toBe("partial-a\n新进度 delta");
    expect(state.workProgressToolsInFlight).toBe(2);
  });
});
