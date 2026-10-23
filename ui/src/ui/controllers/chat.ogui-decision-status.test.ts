// @vitest-environment jsdom
import { render } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearOguiFormDraftState } from "../chat/ogui-form-view.ts";
import {
  readWorkbenchSessionTranscript,
  resetWorkbenchSessionTranscriptCacheForTests,
  writeWorkbenchSessionTranscript,
} from "../ports/employee/workbench-session-transcript-cache.ts";
import type { SessionsListResult } from "../types.ts";
import { renderChat, type ChatProps } from "../views/chat.ts";
import {
  __test,
  handleChatEvent,
  loadChatHistory,
  sendChatMessage,
  type ChatState,
} from "./chat.ts";

const SESSION_KEY = "agent:main:main";

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
    sessionKey: SESSION_KEY,
    ...overrides,
  };
}

function createSessions(): SessionsListResult {
  return {
    ts: 0,
    path: "",
    count: 0,
    defaults: { model: null, contextTokens: null },
    sessions: [],
  };
}

function formFence(): string {
  return [
    "请拍板：",
    "",
    "```ogui-form",
    JSON.stringify(
      {
        schema_version: "ogui/v1",
        component_id: "cmp-shell",
        title: "选口径",
        fields: [
          {
            id: "choice",
            label: "口径",
            type: "single_select",
            options: [
              { value: "a", label: "甲" },
              { value: "b", label: "乙" },
            ],
          },
        ],
        decision_id: "ogd_live",
        decision_version: 1,
      },
      null,
      2,
    ),
    "```",
  ].join("\n");
}

function assistantMessage(text: string) {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    timestamp: Date.UTC(2026, 9, 23, 5, 0, 0),
  };
}

function lifecycleAnswer(): string {
  return [
    "请据此继续。",
    "",
    "```ogui-answer",
    JSON.stringify({
      schema_version: "ogui/v1",
      component_id: "cmp-shell",
      submission_id: "a1b2c3d4-e5f6-4789-a012-3456789abcde",
      answers: { choice: "a" },
      decision_id: "ogd_live",
      decision_version: 1,
    }),
    "```",
  ].join("\n");
}

function createProps(overrides: Partial<ChatProps> = {}): ChatProps {
  return {
    sessionKey: SESSION_KEY,
    onSessionKeyChange: () => undefined,
    thinkingLevel: null,
    showThinking: false,
    loading: false,
    sending: false,
    messages: [],
    toolMessages: [],
    streamSegments: [],
    stream: null,
    streamStartedAt: null,
    assistantAvatarUrl: null,
    draft: "",
    queue: [],
    connected: true,
    canSend: true,
    disabledReason: null,
    error: null,
    sessions: createSessions(),
    focusMode: false,
    assistantName: "OpenBot",
    assistantAvatar: null,
    onRefresh: () => undefined,
    onToggleFocusMode: () => undefined,
    onDraftChange: () => undefined,
    onSend: () => undefined,
    onQueueRemove: () => undefined,
    onNewSession: () => undefined,
    ...overrides,
  };
}

function mount(props: ChatProps): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  render(renderChat(props), container);
  return container;
}

beforeEach(() => {
  resetWorkbenchSessionTranscriptCacheForTests();
  __test.resetPendingOguiStatusRefresh();
  __test.resetLegacyChatHistoryIncludeToolsUnsupported();
  __test.resetTerminalChatRuns();
});

afterEach(() => {
  document.body.innerHTML = "";
  clearOguiFormDraftState();
});

describe("ogui decision status refresh", () => {
  it("marks the shell answered after an accepted lifecycle answer without reloading history", async () => {
    const messages = [assistantMessage(formFence())];
    writeWorkbenchSessionTranscript(SESSION_KEY, { messages });
    const request = vi.fn(async (method: string) => {
      if (method === "chat.send") {
        return { status: "started" };
      }
      throw new Error(`unexpected ${method}`);
    });
    const state = createState({
      client: { request } as unknown as ChatState["client"],
      chatMessages: messages,
      chatOguiDecisions: {
        ogd_live: { decisionStatus: "waiting", version: 1 },
      },
    });

    const runId = await sendChatMessage(state, lifecycleAnswer());

    expect(runId).toEqual(expect.any(String));
    expect(request).not.toHaveBeenCalledWith("chat.history", expect.anything());
    expect(state.chatOguiDecisions).toEqual({
      ogd_live: { decisionStatus: "answered", version: 1 },
    });
    expect(readWorkbenchSessionTranscript(SESSION_KEY)?.oguiDecisions).toEqual({
      ogd_live: { decisionStatus: "answered", version: 1 },
    });

    const submitted: string[] = [];
    const container = mount(
      createProps({
        messages: state.chatMessages,
        oguiDecisions: state.chatOguiDecisions ?? undefined,
        onSubmitForm: (text) => {
          submitted.push(text);
        },
      }),
    );
    const button = container.querySelector('[data-testid="ogui-form-submit"]');
    expect(button).toBeInstanceOf(HTMLButtonElement);
    if (!(button instanceof HTMLButtonElement)) {
      return;
    }
    expect(button.disabled).toBe(true);
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(submitted).toEqual([]);
  });

  it("corrects a rejected consume from the status slice without replacing the transcript", async () => {
    const messages = [assistantMessage(formFence())];
    writeWorkbenchSessionTranscript(SESSION_KEY, { messages });
    const request = vi.fn(async (method: string) => {
      if (method === "chat.send") {
        return { status: "started" };
      }
      if (method === "chat.history") {
        return {
          messages: [assistantMessage("HISTORY_PAGE_MUST_NOT_REPLACE")],
          oguiDecisionStatuses: {
            ogd_live: { decisionStatus: "waiting", version: 1 },
          },
        };
      }
      throw new Error(`unexpected ${method}`);
    });
    const state = createState({
      client: { request } as unknown as ChatState["client"],
      chatMessages: messages,
      chatOguiDecisions: {
        ogd_live: { decisionStatus: "waiting", version: 1 },
      },
    });
    const runId = await sendChatMessage(state, lifecycleAnswer());
    expect(state.chatOguiDecisions?.ogd_live?.decisionStatus).toBe("answered");

    handleChatEvent(state, {
      runId: runId ?? "",
      sessionKey: SESSION_KEY,
      state: "final",
      message: assistantMessage("ack"),
    });
    await vi.waitFor(() => {
      expect(state.chatOguiDecisions?.ogd_live?.decisionStatus).toBe("waiting");
    });
    expect(JSON.stringify(state.chatMessages)).not.toContain("HISTORY_PAGE_MUST_NOT_REPLACE");
    expect(JSON.stringify(state.chatMessages)).toContain("选口径");
    expect(readWorkbenchSessionTranscript(SESSION_KEY)?.oguiDecisions).toEqual({
      ogd_live: { decisionStatus: "waiting", version: 1 },
    });
  });

  it("leaves a legacy send and a rejected send on the previous status", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "chat.send") {
        return { status: "started" };
      }
      throw new Error(`unexpected ${method}`);
    });
    const waiting = { ogd_live: { decisionStatus: "waiting" as const, version: 1 } };
    const state = createState({
      client: { request } as unknown as ChatState["client"],
      chatOguiDecisions: waiting,
    });

    await sendChatMessage(state, "普通回复");
    expect(state.chatOguiDecisions).toEqual(waiting);

    request.mockRejectedValueOnce(new Error("gateway not connected"));
    const rejected = await sendChatMessage(state, lifecycleAnswer());
    expect(rejected).toBeNull();
    expect(state.chatOguiDecisions).toEqual(waiting);
  });

  it("overwrites a painted cache with the chat.history slice so a closed card cannot submit", async () => {
    const messages = [assistantMessage(formFence())];
    writeWorkbenchSessionTranscript(SESSION_KEY, {
      messages,
      oguiDecisions: {
        ogd_live: { decisionStatus: "waiting", version: 1 },
      },
    });
    const request = vi.fn(async (method: string) => {
      if (method === "chat.history") {
        return {
          messages,
          oguiDecisionStatuses: {
            ogd_live: { decisionStatus: "answered", version: 1 },
          },
        };
      }
      throw new Error(`unexpected ${method}`);
    });
    const state = createState({
      client: { request } as unknown as ChatState["client"],
      chatMessages: messages,
      chatOguiDecisions: {
        ogd_live: { decisionStatus: "waiting", version: 1 },
      },
    });

    await loadChatHistory(state);

    expect(state.chatOguiDecisions).toEqual({
      ogd_live: { decisionStatus: "answered", version: 1 },
    });
    const cached = readWorkbenchSessionTranscript(SESSION_KEY);
    expect(cached?.oguiDecisions).toEqual({
      ogd_live: { decisionStatus: "answered", version: 1 },
    });
    const submitted: string[] = [];
    const container = mount(
      createProps({
        messages: cached?.messages ?? [],
        oguiDecisions: cached?.oguiDecisions ?? undefined,
        onSubmitForm: (text) => {
          submitted.push(text);
        },
      }),
    );
    const button = container.querySelector('[data-testid="ogui-form-submit"]');
    expect(button).toBeInstanceOf(HTMLButtonElement);
    if (!(button instanceof HTMLButtonElement)) {
      return;
    }
    expect(button.disabled).toBe(true);
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(submitted).toEqual([]);
  });
});
