// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  setShellSessionDraftKey,
  switchShellSession,
  type ShellSessionDraftState,
  type ShellSessionSwitchState,
} from "./app-session-actions.ts";
import { DEFAULT_CHAT_CONTEXT_SCOPE } from "./chat/context-scope.ts";
import type { UiSettings } from "./storage.ts";
import type { ChatAttachment, ChatQueueItem } from "./ui-types.ts";

const ATTACHMENT: ChatAttachment = {
  id: "file-1",
  dataUrl: "data:text/plain;base64,ZmFrZQ==",
  mimeType: "text/plain",
  fileName: "file-1.txt",
};

const QUEUE_ITEM: ChatQueueItem = {
  id: "queued-1",
  text: "queued",
  createdAt: 1,
};

function createState(): ShellSessionSwitchState {
  const settings: UiSettings = {
    gatewayUrl: "",
    token: "",
    sessionKey: "main",
    lastActiveSessionKey: "main",
    sessionSeenAt: { main: 1 },
    theme: "system",
    chatFocusMode: false,
    chatShowThinking: true,
    splitRatio: 0.6,
    navCollapsed: false,
    navGroupsCollapsed: {},
  };
  const state = {
    hello: null,
    workbenchTeamSelectedKey: "main",
    sessionKey: "main",
    chatMessage: "draft",
    chatMessages: [{ role: "assistant", content: [{ type: "text", text: "leftover 1:1" }] }],
    chatLoading: false,
    chatAttachments: [ATTACHMENT],
    chatContextScope: { ...DEFAULT_CHAT_CONTEXT_SCOPE },
    chatContextExpansion: null,
    chatStream: "stream",
    chatStreamStartedAt: 123,
    chatStreamSessionKey: "agent:bot-2:main:space:alpha",
    chatRunId: "run-1",
    chatThinkingProgress: null,
    chatQueue: [QUEUE_ITEM],
    settings,
    applySettings: vi.fn((next) => {
      state.settings = next;
    }),
    loadAssistantIdentity: vi.fn(async () => undefined),
    resetToolStream: vi.fn(),
    resetChatScroll: vi.fn(),
    setTab: vi.fn(),
  } satisfies ShellSessionSwitchState;
  return state;
}

function createDraftState(): ShellSessionDraftState {
  const state = createState();
  return {
    sessionKey: state.sessionKey,
    chatMessage: state.chatMessage,
    settings: state.settings,
    applySettings: state.applySettings,
    loadAssistantIdentity: state.loadAssistantIdentity,
    resetToolStream: state.resetToolStream,
  };
}

describe("switchShellSession", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/control?session=main");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("switches session state and preserves attachments/queue by default", () => {
    vi.spyOn(Date, "now").mockReturnValue(1000);
    const state = createState();
    state.chatContextScope = {
      ...DEFAULT_CHAT_CONTEXT_SCOPE,
      preset: "knowledge",
      lifetime: "session",
      pickerOpen: true,
    };
    state.chatContextExpansion = {
      runId: "run-expand",
      reason: "empty",
      proposedSources: [{ type: "knowledge", id: "kb-product", label: "产品资料库" }],
    };

    switchShellSession(state, "agent:main:space:alpha");

    expect(state.workbenchTeamSelectedKey).toBe("agent:main:space:alpha");
    expect(state.sessionKey).toBe("agent:main:space:alpha");
    expect(state.chatMessage).toBe("");
    expect(state.chatMessages).toEqual([]);
    expect(state.chatLoading).toBe(true);
    expect(state.chatContextScope).toEqual({ ...DEFAULT_CHAT_CONTEXT_SCOPE });
    expect(state.chatContextExpansion).toBeNull();
    expect(state.chatAttachments).toEqual([ATTACHMENT]);
    expect(state.chatQueue).toEqual([QUEUE_ITEM]);
    expect(state.chatStream).toBeNull();
    expect(state.chatStreamStartedAt).toBeNull();
    expect(state.chatStreamSessionKey).toBeNull();
    expect(state.chatRunId).toBeNull();
    expect(state.applySettings).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionKey: "agent:main:space:alpha",
        lastActiveSessionKey: "agent:main:space:alpha",
        sessionSeenAt: {
          main: 1,
          "agent:main:space:alpha": 1000,
          // Personal/pre-hello: no employee own steward → legacy unpartitioned space cursor.
          "space:alpha": 1000,
        },
      }),
    );
    expect(state.resetToolStream).toHaveBeenCalledTimes(1);
    expect(state.resetChatScroll).toHaveBeenCalledTimes(1);
    expect(state.loadAssistantIdentity).toHaveBeenCalledTimes(1);
    expect(state.setTab).not.toHaveBeenCalled();
  });

  it("clears attachments and queue, runs callback, and changes tab when requested", () => {
    vi.spyOn(Date, "now").mockReturnValue(2000);
    const state = createState();
    const onAfterSwitch = vi.fn();

    switchShellSession(state, "space:alpha", {
      clearAttachments: true,
      clearQueue: true,
      targetTab: "me",
      onAfterSwitch,
    });

    expect(state.chatAttachments).toEqual([]);
    expect(state.chatQueue).toEqual([]);
    expect(onAfterSwitch).toHaveBeenCalledWith("space:alpha");
    expect(state.setTab).toHaveBeenCalledWith("me");
  });

  it("syncs the session query param when requested", () => {
    vi.spyOn(Date, "now").mockReturnValue(3000);
    const state = createState();

    switchShellSession(state, "space:beta", {
      syncUrl: true,
      replaceUrl: true,
    });

    expect(new URL(window.location.href).searchParams.get("session")).toBe("space:beta");
  });

  it("updates overview-style draft session key without full switch side effects", () => {
    const state = createDraftState();

    setShellSessionDraftKey(state, "agent:main:space:draft");

    expect(state.sessionKey).toBe("agent:main:space:draft");
    expect(state.chatMessage).toBe("");
    expect(state.resetToolStream).toHaveBeenCalledTimes(1);
    expect(state.applySettings).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionKey: "agent:main:space:draft",
        lastActiveSessionKey: "agent:main:space:draft",
      }),
    );
    expect(state.loadAssistantIdentity).toHaveBeenCalledTimes(1);
  });
});
