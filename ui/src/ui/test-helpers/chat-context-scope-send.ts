/**
 * Test-only seam for parent-scoped contextScope browser verification.
 * Does not expose globals on window; callers inject into a mounted host/composer.
 */

import { render } from "lit";
import { vi } from "vitest";
import {
  DEFAULT_CHAT_CONTEXT_SCOPE,
  type ChatContextScopeState,
  type ChatContextSourceCatalogItem,
} from "../chat/context-scope.ts";
import {
  sendChatMessage,
  type ChatContextScopeSelection,
  type ChatState,
} from "../controllers/chat.ts";
import type { GatewayBrowserClient } from "../gateway.ts";
import type { SessionsListResult } from "../types.ts";
import { renderChat, type ChatProps } from "../views/chat.ts";

export type CapturedChatSend = {
  method: string;
  params: Record<string, unknown>;
};

export type CapturingClient = GatewayBrowserClient & {
  request: ReturnType<typeof vi.fn>;
};

function createSessions(): SessionsListResult {
  return {
    ts: 0,
    path: "",
    count: 0,
    defaults: { model: null, contextTokens: null },
    sessions: [],
  };
}

export function createCapturingGatewayClient(captures: CapturedChatSend[]): CapturingClient {
  const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
    captures.push({ method, params: params ?? {} });
    if (method === "chat.send") {
      const idempotencyKey =
        typeof params?.idempotencyKey === "string" ? params.idempotencyKey : "run-captured";
      return { runId: idempotencyKey, status: "started" };
    }
    return {};
  });
  return {
    request,
    connected: true,
  } as unknown as CapturingClient;
}

export function createChatSendState(client: CapturingClient): ChatState {
  return {
    client,
    connected: true,
    sessionKey: "main",
    chatSending: false,
    chatRunId: null,
    chatMessages: [],
    chatStream: null,
    chatStreamStartedAt: null,
    chatQueue: [],
    lastError: null,
    chatAttachments: [],
    chatMessage: "",
  } as unknown as ChatState;
}

/**
 * Mount the real chat composer and wire Send → sendChatMessage with a pending scope.
 * The pending scope is closed over in the test helper (not a production window API).
 */
export async function mountChatComposerWithPendingScope(params: {
  contextScope: ChatContextScopeSelection;
  message?: string;
}): Promise<{
  container: HTMLElement;
  captures: CapturedChatSend[];
  state: ChatState;
}> {
  const captures: CapturedChatSend[] = [];
  const client = createCapturingGatewayClient(captures);
  const state = createChatSendState(client);
  let draft = params.message ?? "";

  const container = document.createElement("div");
  document.body.append(container);

  const onSend = () => {
    const message = draft.trim() || params.message?.trim() || "";
    if (!message) {
      return;
    }
    void sendChatMessage(state, message, undefined, {
      contextScope: params.contextScope,
    });
  };

  const props: ChatProps = {
    sessionKey: "main",
    onSessionKeyChange: () => undefined,
    thinkingLevel: null,
    showThinking: false,
    loading: false,
    sending: false,
    canAbort: false,
    compactionStatus: null,
    fallbackStatus: null,
    messages: [],
    toolMessages: [],
    streamSegments: [],
    stream: null,
    streamStartedAt: null,
    assistantAvatarUrl: null,
    draft,
    queue: [],
    connected: true,
    canSend: true,
    disabledReason: null,
    error: null,
    sessions: createSessions(),
    focusMode: false,
    assistantName: "OpenBot",
    assistantAvatar: null,
    renderMode: "workbench-compact",
    onRefresh: () => undefined,
    onToggleFocusMode: () => undefined,
    // Update closed-over draft only — avoid re-render so element refs stay valid.
    onDraftChange: (next: string) => {
      draft = next;
      state.chatMessage = next;
    },
    onSend,
    onQueueRemove: () => undefined,
    onNewSession: () => undefined,
  };

  render(renderChat(props), container);

  if (!container.querySelector("textarea") || !container.querySelector(".chat-compose__send-btn")) {
    throw new Error("chat composer textarea/send button not found");
  }

  return { container, captures, state };
}

/**
 * Mount the production catalog picker and send through chatContextScope state,
 * not an injected pending payload.
 */
export async function mountChatComposerWithCatalogPicker(params: {
  catalog: ChatContextSourceCatalogItem[];
  contextScope?: ChatContextScopeState;
  message?: string;
}): Promise<{
  container: HTMLElement;
  captures: CapturedChatSend[];
  state: ChatState;
  rerender: () => void;
}> {
  const captures: CapturedChatSend[] = [];
  const client = createCapturingGatewayClient(captures);
  const state = createChatSendState(client);
  state.chatContextSourceCatalog = params.catalog;
  state.chatContextScope = params.contextScope ?? {
    ...DEFAULT_CHAT_CONTEXT_SCOPE,
    pickerOpen: true,
    expandedKeys: params.catalog
      .filter((item) => item.type === "knowledge")
      .map((item) => `knowledge:${item.id}`),
  };
  let draft = params.message ?? "";

  const container = document.createElement("div");
  document.body.append(container);

  const rerender = () => {
    const props: ChatProps = {
      sessionKey: "main",
      onSessionKeyChange: () => undefined,
      thinkingLevel: null,
      showThinking: false,
      loading: false,
      sending: false,
      canAbort: false,
      compactionStatus: null,
      fallbackStatus: null,
      messages: [],
      toolMessages: [],
      streamSegments: [],
      stream: null,
      streamStartedAt: null,
      assistantAvatarUrl: null,
      draft,
      queue: [],
      connected: true,
      canSend: true,
      disabledReason: null,
      error: null,
      sessions: createSessions(),
      focusMode: false,
      assistantName: "OpenBot",
      assistantAvatar: null,
      renderMode: "workbench-compact",
      onRefresh: () => undefined,
      onToggleFocusMode: () => undefined,
      onDraftChange: (next: string) => {
        draft = next;
        state.chatMessage = next;
      },
      onSend: () => {
        const message = draft.trim() || params.message?.trim() || "";
        if (!message) {
          return;
        }
        void sendChatMessage(state, message);
      },
      onQueueRemove: () => undefined,
      onNewSession: () => undefined,
      contextScope: state.chatContextScope,
      contextSources: params.catalog,
      onContextScopeChange: (next) => {
        state.chatContextScope = next;
        rerender();
      },
    };
    render(renderChat(props), container);
  };

  rerender();
  if (!container.querySelector("textarea") || !container.querySelector(".chat-compose__send-btn")) {
    throw new Error("chat composer textarea/send button not found");
  }
  return { container, captures, state, rerender };
}
