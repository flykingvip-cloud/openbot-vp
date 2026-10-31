import { beforeEach, describe, expect, it, vi } from "vitest";
import { setChatActionsTestHooks } from "../../app-chat-actions.ts";
import type { UiSettings } from "../../storage.ts";
import type { ChatAttachment, ChatQueueItem } from "../../ui-types.ts";
import {
  type EmployeeWorkbenchSessionState,
  resolveWorkspacePrimaryModuleForSelection,
  switchEmployeeWorkbenchSession,
} from "./render-actions.ts";
import { resetWorkbenchSessionTranscriptCacheForTests } from "./workbench-session-transcript-cache.ts";

const ATTACHMENT: ChatAttachment = {
  id: "file",
  dataUrl: "data:text/plain;base64,ZmFrZQ==",
  mimeType: "text/plain",
  fileName: "file.txt",
};

const QUEUE_ITEM: ChatQueueItem = {
  id: "queued",
  text: "queued",
  createdAt: 1,
};

describe("employee render actions", () => {
  beforeEach(() => {
    resetWorkbenchSessionTranscriptCacheForTests();
    setChatActionsTestHooks({ reloadShellChatHistory: async () => undefined });
  });

  it("reloads chat history when switching the active workbench session", () => {
    const reloadShellChatHistory = vi.fn(async () => undefined);
    setChatActionsTestHooks({ reloadShellChatHistory });
    const settings: UiSettings = {
      gatewayUrl: "",
      token: "",
      sessionKey: "main",
      lastActiveSessionKey: "main",
      sessionSeenAt: {},
      theme: "system",
      chatFocusMode: false,
      chatShowThinking: true,
      splitRatio: 0.6,
      navCollapsed: false,
      navGroupsCollapsed: {},
    };
    const state = {
      basePath: "",
      hello: null,
      connected: true,
      client: {} as never,
      lastError: null,
      workbenchPrimaryModule: "assistant",
      workbenchGroupProfileView: "chat",
      workbenchTeamSelectedKey: "main",
      sessionKey: "main",
      chatMessage: "",
      chatAttachments: [],
      chatLoading: false,
      chatSending: false,
      chatMessages: [
        { role: "assistant", content: [{ type: "text", text: "Workspace authorization failed" }] },
      ],
      chatAvatarUrl: null,
      chatThinkingLevel: null,
      chatStream: null,
      chatStreamStartedAt: null,
      chatStreamSessionKey: null,
      chatRunId: null,
      chatQueue: [],
      sessionsResult: null,
      settings,
      resetToolStream: vi.fn(),
      resetChatScroll: vi.fn(),
      applySettings: vi.fn(),
      loadAssistantIdentity: vi.fn(async () => undefined),
      workbenchTaskDetailId: null,
      workbenchDeliverableDetailId: null,
      workbenchReviewDetailId: null,
      workbenchDecisionDetailId: null,
      workbenchCapsuleDetailId: null,
      workbenchDecisionSelectedOptionDraft: null,
      workbenchDecisionRationaleDraft: null,
      workbenchDecisionOptionsDraft: null,
      workbenchActiveGrowthStatus: null,
      workbenchGrowthBirthAwakening: false,
      workbenchGrowthBirthTurnSentKey: null,
    } satisfies EmployeeWorkbenchSessionState;

    switchEmployeeWorkbenchSession(state, "agent:main:space:alpha", "collaboration");

    expect(reloadShellChatHistory).toHaveBeenCalledWith(state, { refreshAvatar: true });
    expect(state.workbenchTeamSelectedKey).toBe("space:alpha");
    expect(state.chatMessages).toEqual([]);
    expect(state.chatLoading).toBe(true);
  });

  it("clears main 1:1 transcript before collaboration history paints", () => {
    const reloadShellChatHistory = vi.fn(async () => undefined);
    setChatActionsTestHooks({ reloadShellChatHistory });
    const settings: UiSettings = {
      gatewayUrl: "",
      token: "",
      sessionKey: "agent:main:employee:alice",
      lastActiveSessionKey: "agent:main:employee:alice",
      sessionSeenAt: {},
      theme: "system",
      chatFocusMode: false,
      chatShowThinking: true,
      splitRatio: 0.6,
      navCollapsed: false,
      navGroupsCollapsed: {},
    };
    const state = {
      basePath: "",
      hello: null,
      connected: true,
      client: {} as never,
      lastError: null,
      workbenchPrimaryModule: "assistant",
      workbenchGroupProfileView: "chat",
      workbenchTeamSelectedKey: "agent:main:employee:alice",
      sessionKey: "agent:main:employee:alice",
      chatMessage: "",
      chatAttachments: [],
      chatLoading: false,
      chatSending: false,
      chatMessages: [
        {
          role: "assistant",
          content: [
            {
              type: "text",
              text: "Workspace authorization failed. Managed Enterprise does not fall back to legacy workspace paths.",
            },
          ],
        },
      ],
      chatAvatarUrl: null,
      chatThinkingLevel: null,
      chatStream: null,
      chatStreamStartedAt: null,
      chatStreamSessionKey: null,
      chatRunId: null,
      chatQueue: [],
      sessionsResult: null,
      settings,
      resetToolStream: vi.fn(),
      resetChatScroll: vi.fn(),
      applySettings: vi.fn(),
      loadAssistantIdentity: vi.fn(async () => undefined),
      workbenchTaskDetailId: null,
      workbenchDeliverableDetailId: null,
      workbenchReviewDetailId: null,
      workbenchDecisionDetailId: null,
      workbenchCapsuleDetailId: null,
      workbenchDecisionSelectedOptionDraft: null,
      workbenchDecisionRationaleDraft: null,
      workbenchDecisionOptionsDraft: null,
      workbenchActiveGrowthStatus: null,
      workbenchGrowthBirthAwakening: false,
      workbenchGrowthBirthTurnSentKey: null,
    } satisfies EmployeeWorkbenchSessionState;

    switchEmployeeWorkbenchSession(state, "space:grp-test", "collaboration");

    expect(state.sessionKey).toBe("space:grp-test");
    expect(state.workbenchPrimaryModule).toBe("collaboration");
    expect(state.chatMessages).toEqual([]);
    expect(state.chatLoading).toBe(true);
  });

  it("treats scoped collaboration sessions as collaboration selections", () => {
    expect(
      resolveWorkspacePrimaryModuleForSelection("agent:main:space:alpha", ["space:alpha"]),
    ).toBe("collaboration");
  });

  it("switches the active session without overwriting the selected collaboration nav key", () => {
    const settings: UiSettings = {
      gatewayUrl: "",
      token: "",
      sessionKey: "main",
      lastActiveSessionKey: "main",
      sessionSeenAt: {},
      theme: "system",
      chatFocusMode: false,
      chatShowThinking: true,
      splitRatio: 0.6,
      navCollapsed: false,
      navGroupsCollapsed: {},
    };
    const state = {
      basePath: "",
      hello: null,
      connected: true,
      client: {} as never,
      lastError: null,
      workbenchPrimaryModule: "assistant",
      workbenchGroupProfileView: "overview",
      workbenchTeamSelectedKey: "space:alpha",
      sessionKey: "main",
      chatMessage: "draft",
      chatAttachments: [ATTACHMENT],
      chatLoading: false,
      chatSending: false,
      chatMessages: [],
      chatAvatarUrl: null,
      chatThinkingLevel: null,
      chatStream: "stream",
      chatStreamStartedAt: 123,
      chatStreamSessionKey: "agent:bot-2:main:space:alpha",
      chatRunId: "run-1",
      chatQueue: [QUEUE_ITEM],
      sessionsResult: null,
      settings,
      resetToolStream: vi.fn(),
      resetChatScroll: vi.fn(),
      applySettings: vi.fn(),
      loadAssistantIdentity: vi.fn(async () => undefined),
      workbenchTaskDetailId: null,
      workbenchDeliverableDetailId: null,
      workbenchReviewDetailId: null,
      workbenchDecisionDetailId: null,
      workbenchCapsuleDetailId: null,
      workbenchDecisionSelectedOptionDraft: null,
      workbenchDecisionRationaleDraft: null,
      workbenchDecisionOptionsDraft: null,
      workbenchActiveGrowthStatus: null,
      workbenchGrowthBirthAwakening: false,
      workbenchGrowthBirthTurnSentKey: null,
    } satisfies EmployeeWorkbenchSessionState & { workbenchTeamSelectedKey: string };

    switchEmployeeWorkbenchSession(state, "agent:main:space:alpha", "collaboration");

    expect(state.workbenchTeamSelectedKey).toBe("space:alpha");
    expect(state.sessionKey).toBe("space:alpha");
    expect(state.workbenchGroupProfileView).toBe("chat");
  });

  it("realigns nav selection when switching onto a different bot surface", () => {
    const settings: UiSettings = {
      gatewayUrl: "",
      token: "",
      sessionKey: "main",
      lastActiveSessionKey: "main",
      sessionSeenAt: {},
      theme: "system",
      chatFocusMode: false,
      chatShowThinking: true,
      splitRatio: 0.6,
      navCollapsed: false,
      navGroupsCollapsed: {},
    };
    const state = {
      basePath: "",
      hello: null,
      connected: true,
      client: {} as never,
      lastError: null,
      workbenchPrimaryModule: "assistant",
      workbenchGroupProfileView: "chat",
      workbenchTeamSelectedKey: "main",
      sessionKey: "main",
      chatMessage: "",
      chatAttachments: [],
      chatLoading: false,
      chatSending: false,
      chatMessages: [],
      chatAvatarUrl: null,
      chatThinkingLevel: null,
      chatStream: null,
      chatStreamStartedAt: null,
      chatStreamSessionKey: null,
      chatRunId: null,
      chatQueue: [],
      sessionsResult: null,
      settings,
      resetToolStream: vi.fn(),
      resetChatScroll: vi.fn(),
      applySettings: vi.fn(),
      loadAssistantIdentity: vi.fn(async () => undefined),
      workbenchTaskDetailId: null,
      workbenchDeliverableDetailId: null,
      workbenchReviewDetailId: null,
      workbenchDecisionDetailId: null,
      workbenchCapsuleDetailId: null,
      workbenchDecisionSelectedOptionDraft: null,
      workbenchDecisionRationaleDraft: null,
      workbenchDecisionOptionsDraft: null,
      workbenchActiveGrowthStatus: null,
      workbenchGrowthBirthAwakening: false,
      workbenchGrowthBirthTurnSentKey: null,
    } satisfies EmployeeWorkbenchSessionState;

    switchEmployeeWorkbenchSession(state, "agent:bot-skill:main", "assistant");

    expect(state.sessionKey).toBe("agent:bot-skill:main");
    expect(state.workbenchTeamSelectedKey).toBe("agent:bot-skill:main");
  });

  it("restores a cached transcript immediately when switching back", () => {
    const reloadShellChatHistory = vi.fn(async () => undefined);
    setChatActionsTestHooks({ reloadShellChatHistory });
    const settings: UiSettings = {
      gatewayUrl: "",
      token: "",
      sessionKey: "agent:bot-a:main",
      lastActiveSessionKey: "agent:bot-a:main",
      sessionSeenAt: {},
      theme: "system",
      chatFocusMode: false,
      chatShowThinking: true,
      splitRatio: 0.6,
      navCollapsed: false,
      navGroupsCollapsed: {},
    };
    const botAMessages = [{ role: "assistant", content: [{ type: "text", text: "hello from A" }] }];
    const state = {
      basePath: "",
      hello: null,
      connected: true,
      client: {} as never,
      lastError: null,
      workbenchPrimaryModule: "assistant",
      workbenchGroupProfileView: "chat",
      workbenchTeamSelectedKey: "agent:bot-a:main",
      sessionKey: "agent:bot-a:main",
      chatMessage: "",
      chatAttachments: [],
      chatLoading: false,
      chatSending: false,
      chatMessages: botAMessages,
      chatAvatarUrl: null,
      chatThinkingLevel: null,
      chatStream: null,
      chatStreamStartedAt: null,
      chatStreamSessionKey: null,
      chatRunId: null,
      chatQueue: [],
      sessionsResult: null,
      settings,
      resetToolStream: vi.fn(),
      resetChatScroll: vi.fn(),
      applySettings: vi.fn(),
      loadAssistantIdentity: vi.fn(async () => undefined),
      workbenchTaskDetailId: null,
      workbenchDeliverableDetailId: null,
      workbenchReviewDetailId: null,
      workbenchDecisionDetailId: null,
      workbenchCapsuleDetailId: null,
      workbenchDecisionSelectedOptionDraft: null,
      workbenchDecisionRationaleDraft: null,
      workbenchDecisionOptionsDraft: null,
      workbenchActiveGrowthStatus: null,
      workbenchGrowthBirthAwakening: false,
      workbenchGrowthBirthTurnSentKey: null,
    } satisfies EmployeeWorkbenchSessionState;

    switchEmployeeWorkbenchSession(state, "agent:bot-b:main", "assistant");
    expect(state.chatMessages).toEqual([]);
    expect(state.chatLoading).toBe(true);

    switchEmployeeWorkbenchSession(state, "agent:bot-a:main", "assistant");
    expect(state.chatMessages).toEqual(botAMessages);
    expect(state.chatLoading).toBe(false);
    expect(reloadShellChatHistory).toHaveBeenLastCalledWith(state, { refreshAvatar: false });
  });

  it("restores a group transcript from either the space alias or the scoped mirror", () => {
    const reloadShellChatHistory = vi.fn(async () => undefined);
    setChatActionsTestHooks({ reloadShellChatHistory });
    const settings: UiSettings = {
      gatewayUrl: "",
      token: "",
      sessionKey: "agent:main:space:alpha",
      lastActiveSessionKey: "agent:main:space:alpha",
      sessionSeenAt: {},
      theme: "system",
      chatFocusMode: false,
      chatShowThinking: true,
      splitRatio: 0.6,
      navCollapsed: false,
      navGroupsCollapsed: {},
    };
    const groupMessages = [{ role: "assistant", content: [{ type: "text", text: "group cache" }] }];
    const state = {
      basePath: "",
      hello: null,
      connected: true,
      client: {} as never,
      lastError: null,
      workbenchPrimaryModule: "collaboration",
      workbenchGroupProfileView: "chat",
      workbenchTeamSelectedKey: "space:alpha",
      sessionKey: "agent:main:space:alpha",
      chatMessage: "",
      chatAttachments: [],
      chatLoading: false,
      chatSending: false,
      chatMessages: groupMessages,
      chatAvatarUrl: null,
      chatThinkingLevel: null,
      chatStream: null,
      chatStreamStartedAt: null,
      chatStreamSessionKey: null,
      chatRunId: null,
      chatQueue: [],
      sessionsResult: null,
      settings,
      resetToolStream: vi.fn(),
      resetChatScroll: vi.fn(),
      applySettings: vi.fn(),
      loadAssistantIdentity: vi.fn(async () => undefined),
      workbenchTaskDetailId: null,
      workbenchDeliverableDetailId: null,
      workbenchReviewDetailId: null,
      workbenchDecisionDetailId: null,
      workbenchCapsuleDetailId: null,
      workbenchDecisionSelectedOptionDraft: null,
      workbenchDecisionRationaleDraft: null,
      workbenchDecisionOptionsDraft: null,
      workbenchActiveGrowthStatus: null,
      workbenchGrowthBirthAwakening: false,
      workbenchGrowthBirthTurnSentKey: null,
    } satisfies EmployeeWorkbenchSessionState;

    switchEmployeeWorkbenchSession(state, "agent:bot-b:main", "assistant");
    expect(state.chatLoading).toBe(true);

    switchEmployeeWorkbenchSession(state, "space:alpha", "collaboration");
    expect(state.chatMessages).toEqual(groupMessages);
    expect(state.chatLoading).toBe(false);
    expect(reloadShellChatHistory).toHaveBeenLastCalledWith(state, { refreshAvatar: false });
  });

  it("does not restart history when nav re-enters the same group via the space alias", () => {
    const reloadShellChatHistory = vi.fn(async () => undefined);
    setChatActionsTestHooks({ reloadShellChatHistory });
    const settings: UiSettings = {
      gatewayUrl: "",
      token: "",
      sessionKey: "agent:main:space:alpha",
      lastActiveSessionKey: "agent:main:space:alpha",
      sessionSeenAt: {},
      theme: "system",
      chatFocusMode: false,
      chatShowThinking: true,
      splitRatio: 0.6,
      navCollapsed: false,
      navGroupsCollapsed: {},
    };
    const groupMessages = [{ role: "assistant", content: [{ type: "text", text: "keep" }] }];
    const state = {
      basePath: "",
      hello: null,
      connected: true,
      client: {} as never,
      lastError: null,
      workbenchPrimaryModule: "collaboration",
      workbenchGroupProfileView: "chat",
      workbenchTeamSelectedKey: "space:alpha",
      sessionKey: "agent:main:space:alpha",
      chatMessage: "",
      chatAttachments: [],
      chatLoading: false,
      chatSending: false,
      chatMessages: groupMessages,
      chatAvatarUrl: null,
      chatThinkingLevel: null,
      chatStream: null,
      chatStreamStartedAt: null,
      chatStreamSessionKey: null,
      chatRunId: null,
      chatQueue: [],
      sessionsResult: null,
      settings,
      resetToolStream: vi.fn(),
      resetChatScroll: vi.fn(),
      applySettings: vi.fn(),
      loadAssistantIdentity: vi.fn(async () => undefined),
      workbenchTaskDetailId: null,
      workbenchDeliverableDetailId: null,
      workbenchReviewDetailId: null,
      workbenchDecisionDetailId: null,
      workbenchCapsuleDetailId: null,
      workbenchDecisionSelectedOptionDraft: null,
      workbenchDecisionRationaleDraft: null,
      workbenchDecisionOptionsDraft: null,
      workbenchActiveGrowthStatus: null,
      workbenchGrowthBirthAwakening: false,
      workbenchGrowthBirthTurnSentKey: null,
    } satisfies EmployeeWorkbenchSessionState;

    switchEmployeeWorkbenchSession(state, "space:alpha", "collaboration");

    expect(state.sessionKey).toBe("space:alpha");
    expect(state.chatMessages).toEqual(groupMessages);
    expect(state.chatLoading).toBe(false);
    expect(reloadShellChatHistory).not.toHaveBeenCalled();
  });

  it("keeps a loading transcript so switching back does not blank the thread", () => {
    const reloadShellChatHistory = vi.fn(async () => undefined);
    setChatActionsTestHooks({ reloadShellChatHistory });
    const settings: UiSettings = {
      gatewayUrl: "",
      token: "",
      sessionKey: "agent:bot-a:main",
      lastActiveSessionKey: "agent:bot-a:main",
      sessionSeenAt: {},
      theme: "system",
      chatFocusMode: false,
      chatShowThinking: true,
      splitRatio: 0.6,
      navCollapsed: false,
      navGroupsCollapsed: {},
    };
    const botAMessages = [{ role: "assistant", content: [{ type: "text", text: "partial A" }] }];
    const state = {
      basePath: "",
      hello: null,
      connected: true,
      client: {} as never,
      lastError: null,
      workbenchPrimaryModule: "assistant",
      workbenchGroupProfileView: "chat",
      workbenchTeamSelectedKey: "agent:bot-a:main",
      sessionKey: "agent:bot-a:main",
      chatMessage: "",
      chatAttachments: [],
      chatLoading: true,
      chatSending: false,
      chatMessages: botAMessages,
      chatAvatarUrl: null,
      chatThinkingLevel: null,
      chatStream: null,
      chatStreamStartedAt: null,
      chatStreamSessionKey: null,
      chatRunId: null,
      chatQueue: [],
      sessionsResult: null,
      settings,
      resetToolStream: vi.fn(),
      resetChatScroll: vi.fn(),
      applySettings: vi.fn(),
      loadAssistantIdentity: vi.fn(async () => undefined),
      workbenchTaskDetailId: null,
      workbenchDeliverableDetailId: null,
      workbenchReviewDetailId: null,
      workbenchDecisionDetailId: null,
      workbenchCapsuleDetailId: null,
      workbenchDecisionSelectedOptionDraft: null,
      workbenchDecisionRationaleDraft: null,
      workbenchDecisionOptionsDraft: null,
      workbenchActiveGrowthStatus: null,
      workbenchGrowthBirthAwakening: false,
      workbenchGrowthBirthTurnSentKey: null,
    } satisfies EmployeeWorkbenchSessionState;

    switchEmployeeWorkbenchSession(state, "agent:bot-b:main", "assistant");
    expect(state.chatMessages).toEqual([]);
    expect(state.chatLoading).toBe(true);

    switchEmployeeWorkbenchSession(state, "agent:bot-a:main", "assistant");
    expect(state.chatMessages).toEqual(botAMessages);
    expect(state.chatLoading).toBe(false);
    expect(reloadShellChatHistory).toHaveBeenLastCalledWith(state, { refreshAvatar: false });
  });

  it("restores in-flight run occupancy when switching back to the same robot", () => {
    const reloadShellChatHistory = vi.fn(async () => undefined);
    setChatActionsTestHooks({ reloadShellChatHistory });
    const settings: UiSettings = {
      gatewayUrl: "",
      token: "",
      sessionKey: "agent:skill:main",
      lastActiveSessionKey: "agent:skill:main",
      sessionSeenAt: {},
      theme: "system",
      chatFocusMode: false,
      chatShowThinking: true,
      splitRatio: 0.6,
      navCollapsed: false,
      navGroupsCollapsed: {},
    };
    const userTask = {
      id: "local-run-keep",
      role: "user",
      content: [{ type: "text", text: "请检索订单参谋 MCP" }],
    };
    const state = {
      basePath: "",
      hello: null,
      connected: true,
      client: {} as never,
      lastError: null,
      workbenchPrimaryModule: "assistant",
      workbenchGroupProfileView: "chat",
      workbenchTeamSelectedKey: "agent:skill:main",
      sessionKey: "agent:skill:main",
      chatMessage: "",
      chatAttachments: [],
      chatLoading: false,
      chatSending: false,
      chatMessages: [userTask],
      chatAvatarUrl: null,
      chatThinkingLevel: null,
      chatStream: "正在检索",
      chatStreamStartedAt: 42,
      chatStreamSessionKey: "agent:skill:main",
      chatRunId: "run-keep",
      chatQueue: [],
      sessionsResult: null,
      settings,
      resetToolStream: vi.fn(),
      resetChatScroll: vi.fn(),
      applySettings: vi.fn(),
      loadAssistantIdentity: vi.fn(async () => undefined),
      workbenchTaskDetailId: null,
      workbenchDeliverableDetailId: null,
      workbenchReviewDetailId: null,
      workbenchDecisionDetailId: null,
      workbenchCapsuleDetailId: null,
      workbenchDecisionSelectedOptionDraft: null,
      workbenchDecisionRationaleDraft: null,
      workbenchDecisionOptionsDraft: null,
      workbenchActiveGrowthStatus: null,
      workbenchGrowthBirthAwakening: false,
      workbenchGrowthBirthTurnSentKey: null,
    } satisfies EmployeeWorkbenchSessionState;

    switchEmployeeWorkbenchSession(state, "agent:bot-b:main", "assistant");
    expect(state.chatRunId).toBeNull();
    expect(state.chatStream).toBeNull();

    switchEmployeeWorkbenchSession(state, "agent:skill:main", "assistant");
    expect(state.chatMessages).toEqual([userTask]);
    expect(state.chatRunId).toBe("run-keep");
    expect(state.chatStream).toBe("正在检索");
    expect(state.chatLoading).toBe(false);
  });

  it("keeps an open computer dock and drops the previous bot checkpoints on assistant switch", () => {
    const settings: UiSettings = {
      gatewayUrl: "",
      token: "",
      sessionKey: "agent:bot-a:main",
      lastActiveSessionKey: "agent:bot-a:main",
      sessionSeenAt: {},
      theme: "system",
      chatFocusMode: false,
      chatShowThinking: true,
      splitRatio: 0.6,
      navCollapsed: false,
      navGroupsCollapsed: {},
    };
    const state = {
      basePath: "",
      hello: null,
      connected: true,
      client: {} as never,
      lastError: null,
      workbenchPrimaryModule: "assistant",
      workbenchGroupProfileView: "chat",
      workbenchTeamSelectedKey: "agent:bot-a:main",
      sessionKey: "agent:bot-a:main",
      chatMessage: "",
      chatAttachments: [],
      chatLoading: false,
      chatSending: false,
      chatMessages: [{ role: "user", content: [{ type: "text", text: "你好" }] }],
      chatAvatarUrl: null,
      chatThinkingLevel: null,
      chatStream: null,
      chatStreamStartedAt: null,
      chatStreamSessionKey: null,
      chatRunId: null,
      chatQueue: [],
      sessionsResult: null,
      settings,
      resetToolStream: vi.fn(),
      resetChatScroll: vi.fn(),
      applySettings: vi.fn(),
      loadAssistantIdentity: vi.fn(async () => undefined),
      workbenchTaskDetailId: null,
      workbenchDeliverableDetailId: null,
      workbenchReviewDetailId: null,
      workbenchDecisionDetailId: null,
      workbenchCapsuleDetailId: null,
      workbenchDecisionSelectedOptionDraft: null,
      workbenchDecisionRationaleDraft: null,
      workbenchDecisionOptionsDraft: null,
      workbenchActiveGrowthStatus: null,
      workbenchGrowthBirthAwakening: false,
      workbenchGrowthBirthTurnSentKey: null,
      sidebarOpen: true,
      chatCheckpoints: [{ checkpointId: "cp-a" }],
      pendingRestoreCheckpointId: "cp-a",
    } satisfies EmployeeWorkbenchSessionState;

    switchEmployeeWorkbenchSession(state, "agent:bot-a:main", "assistant");
    expect(state.sidebarOpen).toBe(true);
    expect(state.chatCheckpoints).toEqual([{ checkpointId: "cp-a" }]);

    switchEmployeeWorkbenchSession(state, "agent:bot-b:main", "assistant");
    expect(state.sidebarOpen).toBe(true);
    expect(state.chatCheckpoints).toEqual([]);
    expect(state.pendingRestoreCheckpointId).toBeNull();
    expect(state.chatCheckpointLoadState?.checkpoints ?? []).toEqual([]);
    expect(state.chatCheckpointDiagnostics ?? []).toEqual([]);
  });
});
