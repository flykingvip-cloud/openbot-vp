// @vitest-environment jsdom
import { html, render } from "lit";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { i18n } from "../../i18n/index.ts";
import type { AppViewState } from "../app-view-state.ts";
import { parseLocalFileApprovalRequested } from "../controllers/local-file-approval.ts";
import { renderChat, type ChatProps } from "./chat.ts";
import {
  renderLocalFileApprovalInline,
  renderLocalFileApprovalPrompt,
} from "./local-file-approval.ts";

// Locales load asynchronously at construction; without this, t() returns raw keys
// and the copy assertions below would be vacuous.
beforeAll(async () => {
  await i18n.setLocale("en");
});

const NOW = Date.now();

function card(overrides: Record<string, unknown> = {}) {
  const parsed = parseLocalFileApprovalRequested({
    id: "ap-1",
    canonicalPath: "/Users/demo/Desktop/box-browser-auth-skills.zip",
    targetKind: "file",
    task: "inspect-archive",
    taskDescription: "inspect this archive",
    agentId: "bot-skill",
    userId: "u1",
    tenantId: "t1",
    budget: { maxEntriesRead: 30, maxTotalExpandedBytes: 5_242_880, maxCalls: 32 },
    createdAtMs: NOW,
    expiresAtMs: NOW + 90_000,
    ...overrides,
  });
  if (!parsed) {
    throw new Error("fixture failed to parse");
  }
  return parsed;
}

function mount(state: Partial<AppViewState>) {
  const container = document.createElement("div");
  const full = {
    localFileApprovalQueue: [],
    localFileApprovalBusy: false,
    localFileApprovalError: null,
    handleLocalFileApprovalDecision: vi.fn(),
    ...state,
  } as unknown as AppViewState;
  render(renderLocalFileApprovalPrompt(full), container);
  return { container, state: full };
}

describe("local file approval card", () => {
  it("renders nothing when no card is pending", () => {
    const { container } = mount({});
    expect(container.textContent?.trim()).toBe("");
  });

  it("shows what the digital human wants to do and the canonical path", () => {
    const { container } = mount({ localFileApprovalQueue: [card()] });
    expect(container.textContent).toContain("bot-skill");
    expect(container.textContent).toContain("inspect this archive");
    expect(container.textContent).toContain("/Users/demo/Desktop/box-browser-auth-skills.zip");
  });

  it("offers Always, Allow Once, and Never for a grant-eligible path", () => {
    const { container } = mount({ localFileApprovalQueue: [card()] });
    const buttons = [...container.querySelectorAll("button")];
    expect(buttons.map((button) => button.getAttribute("data-decision"))).toEqual([
      "allow-always",
      "allow-once",
      "deny",
    ]);
  });

  it("wires the three buttons to the decision handler", () => {
    const { container, state } = mount({ localFileApprovalQueue: [card()] });
    const buttons = container.querySelectorAll<HTMLButtonElement>("button");
    buttons[0].click();
    buttons[1].click();
    buttons[2].click();
    expect(state.handleLocalFileApprovalDecision).toHaveBeenNthCalledWith(1, "allow-always");
    expect(state.handleLocalFileApprovalDecision).toHaveBeenNthCalledWith(2, "allow-once");
    expect(state.handleLocalFileApprovalDecision).toHaveBeenNthCalledWith(3, "deny");
  });

  it("states the budget so a bounded task cannot look like a single read", () => {
    const { container } = mount({ localFileApprovalQueue: [card()] });
    // 30 entries / 5 MiB, from the archive task budget.
    expect(container.textContent).toContain("30");
    expect(container.textContent).toContain("MiB");
  });

  it("omits the budget line for a single-call task", () => {
    const single = card({
      task: "read-file",
      taskDescription: "read this file",
      budget: { maxEntriesRead: 1, maxTotalExpandedBytes: 2_097_152, maxCalls: 1 },
    });
    const { container } = mount({ localFileApprovalQueue: [single] });
    expect(container.querySelector('[data-field="budget"]')).toBeNull();
  });

  it("disables both buttons while a decision is in flight", () => {
    const { container } = mount({
      localFileApprovalQueue: [card()],
      localFileApprovalBusy: true,
    });
    for (const button of container.querySelectorAll<HTMLButtonElement>("button")) {
      expect(button.disabled).toBe(true);
    }
  });

  it("surfaces an error without dismissing the card", () => {
    const { container } = mount({
      localFileApprovalQueue: [card()],
      localFileApprovalError: "Local file approval failed: boom",
    });
    expect(container.querySelector(".exec-approval-error")?.textContent).toContain("boom");
    expect(container.querySelectorAll("button")).toHaveLength(3);
  });

  it("shows a pending count only when more than one card is queued", () => {
    const one = mount({ localFileApprovalQueue: [card()] });
    expect(one.container.querySelector(".exec-approval-queue")).toBeNull();

    const two = mount({
      localFileApprovalQueue: [card(), card({ id: "ap-2" })],
    });
    expect(two.container.querySelector(".exec-approval-queue")).not.toBeNull();
  });

  it("marks an elapsed card expired rather than showing a countdown", () => {
    const { container } = mount({
      localFileApprovalQueue: [card({ expiresAtMs: NOW - 1 })],
    });
    expect(container.querySelector(".exec-approval-sub")?.textContent?.trim()).toBeTruthy();
  });

  it("labels a directory target as a folder", () => {
    const dir = card({
      targetKind: "directory",
      task: "list-directory",
      taskDescription: "list this directory",
    });
    const { container } = mount({ localFileApprovalQueue: [dir] });
    expect(container.textContent).toContain("list this directory");
  });

  it("implants the disk card in the conversation, ahead of the composer", () => {
    const entry = card({
      canonicalPath: "/Users/demo/Desktop",
      targetKind: "directory",
      task: "list-directory",
      taskDescription: "list this directory",
      nodeDisplayName: "UPBEYOND Mac",
      budget: { maxEntriesRead: 1, maxTotalExpandedBytes: 0, maxCalls: 1 },
    });
    const container = document.createElement("div");
    const state = {
      localFileApprovalQueue: [entry],
      localFileApprovalBusy: false,
      localFileApprovalError: null,
      handleLocalFileApprovalDecision: vi.fn(),
    } as unknown as AppViewState;
    const props = {
      sessionKey: "main",
      onSessionKeyChange: () => undefined,
      thinkingLevel: null,
      showThinking: false,
      loading: false,
      sending: false,
      canAbort: false,
      compactionStatus: null,
      fallbackStatus: null,
      messages: [{ role: "assistant", content: "我来读取桌面整理清单。" }],
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
      sessions: { ts: 0, path: "", count: 0, defaults: {}, sessions: [] },
      focusMode: false,
      assistantName: "OpenBot",
      assistantAvatar: null,
      onRefresh: () => undefined,
      onToggleFocusMode: () => undefined,
      onDraftChange: () => undefined,
      onSend: () => undefined,
      onQueueRemove: () => undefined,
      onNewSession: () => undefined,
      threadEpilogue: html`${renderLocalFileApprovalInline(state)}`,
    } as unknown as ChatProps;
    render(renderChat(props), container);

    const thread = container.querySelector(".chat-thread");
    const cardEl = thread?.querySelector("[data-surface='local-file-approval']");
    const compose = container.querySelector(".chat-compose");
    expect(cardEl).not.toBeNull();
    expect(cardEl?.getAttribute("data-placement")).toBe("conversation");
    expect(cardEl?.closest(".exec-approval-overlay")).toBeNull();
    expect(cardEl?.textContent).toContain("/Users/demo/Desktop");
    expect(cardEl?.textContent).toContain("UPBEYOND Mac");
    expect(
      [...(cardEl?.querySelectorAll("button") ?? [])].map((button) =>
        button.getAttribute("data-decision"),
      ),
    ).toEqual(["allow-always", "allow-once", "deny"]);
    expect(
      thread &&
        compose &&
        thread.compareDocumentPosition(compose) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const bubble = thread?.textContent ?? "";
    expect(bubble.indexOf("我来读取桌面整理清单。")).toBeLessThan(
      bubble.indexOf("/Users/demo/Desktop"),
    );
  });

  it("does not cover the dialogue when the chat hosts the card", () => {
    const container = document.createElement("div");
    const state = {
      localFileApprovalQueue: [card()],
      localFileApprovalBusy: false,
      localFileApprovalError: null,
      handleLocalFileApprovalDecision: vi.fn(),
    } as unknown as AppViewState;
    render(renderLocalFileApprovalPrompt(state, { inline: true }), container);
    expect(container.querySelector(".exec-approval-overlay")).toBeNull();
    expect(container.querySelector("[data-surface='local-file-approval']")).toBeNull();
  });
});
