// @vitest-environment jsdom
import { html, render } from "lit";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { i18n } from "../../i18n/index.ts";
import type { AppViewState } from "../app-view-state.ts";
import {
  parseExecApprovalRequested,
  type ExecApprovalRequest,
} from "../controllers/exec-approval.ts";
import { renderChat, type ChatProps } from "./chat.ts";
import { renderExecApprovalPrompt, renderLocalExecPermissionInline } from "./exec-approval.ts";

beforeAll(async () => {
  await i18n.setLocale("en");
});

const NOW = Date.now();

function request(overrides: Record<string, unknown> = {}): ExecApprovalRequest {
  const parsed = parseExecApprovalRequested({
    id: "approval-1",
    createdAtMs: NOW,
    expiresAtMs: NOW + 60_000,
    request: {
      command: "printf 'openbot-local-ok\\n' > \"$HOME/Desktop/OpenBot-Local-Proof.txt\"",
      cwd: "/Users/demo",
      host: "node",
      nodeId: "mac-1",
      nodeDisplayName: "UPBEYONDdeMacBook-Pro.local",
      security: "allowlist",
      ask: "on-miss",
    },
    ...overrides,
  });
  if (!parsed) {
    throw new Error("fixture failed to parse");
  }
  return parsed;
}

function mount(entry: ExecApprovalRequest, nodes: Array<Record<string, unknown>> = []) {
  const container = document.createElement("div");
  const handleExecApprovalDecision = vi.fn();
  const state = {
    execApprovalQueue: [entry],
    execApprovalBusy: false,
    execApprovalError: null,
    nodes,
    handleExecApprovalDecision,
  } as unknown as AppViewState;
  render(renderExecApprovalPrompt(state), container);
  return { container, handleExecApprovalDecision };
}

describe("local exec permission card", () => {
  it("parses the node id and machine name onto the approval request", () => {
    const parsed = request();
    expect(parsed.request.host).toBe("node");
    expect(parsed.request.nodeId).toBe("mac-1");
    expect(parsed.request.nodeDisplayName).toBe("UPBEYONDdeMacBook-Pro.local");
  });

  it("shows Always / Once / Never and resolves the machine name", () => {
    const { container, handleExecApprovalDecision } = mount(request());
    expect(container.querySelector("[data-surface='local-exec-permission']")).not.toBeNull();
    expect(container.textContent).toContain(
      "Allow OpenBot and all bots to run commands on your computer?",
    );
    expect(container.textContent).toContain("UPBEYONDdeMacBook-Pro.local");
    expect(container.textContent).toContain("View command");
    expect(container.querySelector(".exec-approval-command")?.textContent).toContain(
      "OpenBot-Local-Proof.txt",
    );

    const buttons = [...container.querySelectorAll("button")].map((button) => ({
      decision: button.getAttribute("data-decision"),
      label: button.textContent?.trim(),
    }));
    expect(buttons).toEqual([
      { decision: "allow-always", label: "Always Allow" },
      { decision: "allow-once", label: "Allow Once" },
      { decision: "deny", label: "Never" },
    ]);

    container.querySelector<HTMLButtonElement>("[data-decision='allow-once']")?.click();
    container.querySelector<HTMLButtonElement>("[data-decision='allow-always']")?.click();
    container.querySelector<HTMLButtonElement>("[data-decision='deny']")?.click();
    expect(handleExecApprovalDecision.mock.calls.map((call) => call[0])).toEqual([
      "allow-once",
      "allow-always",
      "deny",
    ]);
  });

  it("falls back to the nodes list when the approval omits a display name", () => {
    const entry = request();
    entry.request.nodeDisplayName = null;
    const { container } = mount(entry, [{ nodeId: "mac-1", displayName: "Travel-Mac.local" }]);
    expect(container.textContent).toContain("Travel-Mac.local");
    expect(container.textContent).not.toContain("mac-1");
  });

  it("prefers UPBEYOND Mac over the raw node id", () => {
    const entry = request();
    entry.request.nodeId = "f44169db-aaaa-bbbb-cccc-ddddeeee1111";
    entry.request.nodeDisplayName = "UPBEYOND Mac";
    const { container } = mount(entry, [
      { nodeId: entry.request.nodeId, displayName: "Other Mac" },
    ]);
    expect(container.textContent).toContain("UPBEYOND Mac");
    expect(container.textContent).not.toContain("f44169db");
    expect(container.textContent).not.toContain("Other Mac");
  });

  it("uses the nodes list when the display name is only the node id", () => {
    const entry = request();
    entry.request.nodeId = "f44169db-aaaa-bbbb-cccc-ddddeeee1111";
    entry.request.nodeDisplayName = entry.request.nodeId;
    const { container } = mount(entry, [{ id: entry.request.nodeId, displayName: "UPBEYOND Mac" }]);
    expect(container.textContent).toContain("UPBEYOND Mac");
    expect(container.textContent).not.toContain("f44169db");
  });

  it("shows the node id only when no display name exists", () => {
    const entry = request();
    entry.request.nodeId = "f44169db-aaaa-bbbb-cccc-ddddeeee1111";
    entry.request.nodeDisplayName = null;
    const { container } = mount(entry, []);
    expect(container.textContent).toContain("f44169db-aaaa-bbbb-cccc-ddddeeee1111");
  });

  it("implants the local card in the conversation, ahead of the composer", () => {
    const entry = request();
    entry.request.nodeDisplayName = "UPBEYOND Mac";
    const state = {
      execApprovalQueue: [entry],
      execApprovalBusy: false,
      execApprovalError: null,
      nodes: [],
      handleExecApprovalDecision: vi.fn(),
    } as unknown as AppViewState;
    const container = document.createElement("div");
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
      messages: [{ role: "assistant", content: "写好后存到你本机桌面。" }],
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
      threadEpilogue: html`${renderLocalExecPermissionInline(state)}`,
    } as unknown as ChatProps;
    render(renderChat(props), container);

    const thread = container.querySelector(".chat-thread");
    const card = thread?.querySelector("[data-surface='local-exec-permission']");
    const compose = container.querySelector(".chat-compose");
    expect(card).not.toBeNull();
    expect(card?.getAttribute("data-placement")).toBe("conversation");
    expect(card?.closest(".exec-approval-overlay")).toBeNull();
    expect(card?.textContent).toContain("UPBEYOND Mac");
    expect(card?.textContent).toContain("View command");
    expect(
      [...(card?.querySelectorAll("button") ?? [])].map((button) =>
        button.getAttribute("data-decision"),
      ),
    ).toEqual(["allow-always", "allow-once", "deny"]);
    expect(
      thread &&
        compose &&
        thread.compareDocumentPosition(compose) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const bubble = thread?.textContent ?? "";
    expect(bubble.indexOf("写好后存到你本机桌面。")).toBeGreaterThanOrEqual(0);
    expect(bubble.indexOf("写好后存到你本机桌面。")).toBeLessThan(bubble.indexOf("UPBEYOND Mac"));
  });

  it("does not cover the dialogue with an overlay when the chat hosts the card", () => {
    const entry = request();
    const container = document.createElement("div");
    const state = {
      execApprovalQueue: [entry],
      execApprovalBusy: false,
      execApprovalError: null,
      nodes: [],
      handleExecApprovalDecision: vi.fn(),
    } as unknown as AppViewState;
    render(renderExecApprovalPrompt(state, { localCardInline: true }), container);
    expect(container.querySelector(".exec-approval-overlay")).toBeNull();
    expect(container.querySelector("[data-surface='local-exec-permission']")).toBeNull();
  });

  it("keeps the command-centric card for gateway host approvals", () => {
    const entry = request();
    entry.request.host = "gateway";
    const { container } = mount(entry);
    expect(container.querySelector("[data-surface='local-exec-permission']")).toBeNull();
    expect(container.textContent).toContain("Exec approval needed");
    expect(container.textContent).toContain("Allow once");
  });
});
