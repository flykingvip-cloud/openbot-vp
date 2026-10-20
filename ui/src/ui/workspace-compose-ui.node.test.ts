// @vitest-environment jsdom
import { render } from "lit";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../i18n/index.ts";
import "../styles.css";
import { DEFAULT_CHAT_CONTEXT_SCOPE } from "./chat/context-scope.ts";
import { mountApp as mountTestApp, registerAppMountHooks } from "./test-helpers/app-mount.ts";
import type { SessionsListResult } from "./types.ts";
import { renderChat, type ChatProps } from "./views/chat.ts";

registerAppMountHooks();

const DAIBAI_ONBOARDING_GUIDE_PROMPT =
  "请你以新用户引导员的身份，用对话方式给我一个简洁的首次登录操作指南，并说明接下来你还能继续代办什么。";

beforeEach(async () => {
  await i18n.setLocale("en");
});

function mountApp(pathname: string) {
  return mountTestApp(pathname);
}

async function waitForCompactCompose(app: ReturnType<typeof mountApp>) {
  for (let i = 0; i < 80; i += 1) {
    const compose = app.querySelector(".chat-compose--workbench-compact");
    if (compose) {
      return compose;
    }
    await app.updateComplete;
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  }
  return null;
}

describe("workspace compose UI targets", () => {
  it("does not auto-send daibai onboarding on workspace home", async () => {
    const app = mountApp("/");
    const sendSpy = vi.spyOn(app, "handleSendChat").mockResolvedValue(undefined as never);
    app.connected = true;
    app.chatMessages = [];
    app.workbenchPrimaryModule = "assistant";
    await app.updateComplete;
    await waitForCompactCompose(app);

    const calls = sendSpy.mock.calls.map((call) => call[0]);
    expect(calls).not.toContain(DAIBAI_ONBOARDING_GUIDE_PROMPT);
    sendSpy.mockRestore();
  });

  it("suppresses platform update banner when an update is available", async () => {
    const app = mountApp("/platform");
    app.connected = true;
    app.updateAvailable = {
      latestVersion: "9.9.9",
      currentVersion: "1.0.0",
      channel: "stable",
    };
    await app.updateComplete;

    expect(app.querySelector(".update-banner")).toBeNull();
    expect(app.textContent ?? "").not.toContain("Update available:");
  });

  it("renders the context capsule above the compact compose row", async () => {
    const app = mountApp("/");
    app.connected = true;
    app.workbenchPrimaryModule = "assistant";
    await app.updateComplete;
    const compose = await waitForCompactCompose(app);
    expect(compose).not.toBeNull();

    const shell = compose?.querySelector(".chat-compose__shell--compact");
    const tab = compose?.querySelector(".chat-compose__context-tab");
    const row = compose?.querySelector(".chat-compose__row");
    expect(shell).not.toBeNull();
    expect(tab).not.toBeNull();
    expect(row).not.toBeNull();
    expect(shell?.contains(tab ?? null)).toBe(true);
    expect(shell?.contains(row ?? null)).toBe(true);

    const tabStyle = getComputedStyle(tab as Element);
    expect(tabStyle.display).not.toBe("none");
    expect(tabStyle.visibility).not.toBe("hidden");
  });

  it("renders a single-row compact compose textarea inside the workbench shell", () => {
    const container = document.createElement("div");
    render(renderChat(createCompactChatProps()), container);
    const compose = container.querySelector(".chat-compose--workbench-compact");
    const shell = compose?.querySelector(".chat-compose__shell--compact");
    const textarea = compose?.querySelector("textarea");
    expect(compose).not.toBeNull();
    expect(shell).not.toBeNull();
    expect(textarea).not.toBeNull();
    expect(textarea?.getAttribute("rows")).toBe("1");
    expect(shell?.contains(textarea ?? null)).toBe(true);
  });
});

function createSessions(): SessionsListResult {
  return {
    ts: 0,
    path: "",
    count: 0,
    defaults: { model: null, contextTokens: null },
    sessions: [],
  };
}

function createCompactChatProps(overrides: Partial<ChatProps> = {}): ChatProps {
  return {
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
    onChatScroll: () => undefined,
    onDraftChange: () => undefined,
    onSend: () => undefined,
    onAbort: () => undefined,
    onQueueRemove: () => undefined,
    onNewSession: () => undefined,
    contextScope: DEFAULT_CHAT_CONTEXT_SCOPE,
    contextSources: [],
    contextSourcesLoading: false,
    onContextScopeChange: () => undefined,
    onLoadContextSources: () => undefined,
    contextExpansion: null,
    onAcceptContextExpansion: () => undefined,
    onDismissContextExpansion: () => undefined,
    renderMode: "workbench-compact",
    ...overrides,
  };
}
