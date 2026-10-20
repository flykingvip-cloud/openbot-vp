import { describe, expect, it, vi } from "vitest";
import {
  applyFocusSwitchBlocked,
  authorizeFocusSwitchCancel,
  authorizeFocusSwitchProceed,
  dismissFocusSwitchGate,
  isFocusSwitchBlockedResult,
  type FocusSwitchUiHost,
} from "./focus-switch-gate.ts";

function host(partial: Partial<FocusSwitchUiHost> = {}): FocusSwitchUiHost {
  return {
    chatMessage: "",
    chatMessages: [
      { id: "local-run-1", role: "user", content: [{ type: "text", text: "新调研" }] },
      { id: "keep-me", role: "assistant", content: [] },
    ],
    chatRunId: "run-1",
    chatStream: "x",
    chatStreamStartedAt: 1,
    chatSending: true,
    chatFocusSwitchGate: null,
    chatFocusSwitchProceedAuthorized: false,
    requestUpdate: vi.fn(),
    ...partial,
  };
}

describe("focus-switch-gate UI", () => {
  it("does not treat a legacy focus_switch_blocked payload as a hold", () => {
    expect(isFocusSwitchBlockedResult({ status: "focus_switch_blocked" })).toBe(false);
    expect(isFocusSwitchBlockedResult({ status: "growth_gate_blocked" })).toBe(false);
    expect(isFocusSwitchBlockedResult({ status: "started" })).toBe(false);
  });

  it("does not open a choice card or stop the in-flight send", () => {
    const h = host();
    applyFocusSwitchBlocked(
      h,
      {
        status: "focus_switch_blocked",
        runId: "run-1",
        focusSwitch: {
          blocked: true,
          currentTitle: "生成今日竞品价格检查结果",
          incomingTitle: "请使用 web-research 做一次标准深度联网调研。",
        },
      },
      "请使用 web-research 做一次标准深度联网调研。",
    );
    expect(h.chatMessages).toHaveLength(2);
    expect((h.chatMessages[0] as { id: string }).id).toBe("local-run-1");
    expect(h.chatMessage).toBe("");
    expect(h.chatFocusSwitchGate).toBeNull();
    expect(h.chatRunId).toBe("run-1");
    expect(h.chatSending).toBe(true);
  });

  it("authorizeFocusSwitchProceed enables the next send", () => {
    const h = host({
      chatFocusSwitchGate: {
        currentTitle: "旧任务",
        incomingTitle: "新任务",
        pendingDraft: "新任务",
      },
    });
    authorizeFocusSwitchProceed(h);
    expect(h.chatFocusSwitchProceedAuthorized).toBe(true);
    expect(h.chatFocusSwitchGate).toBeNull();
    expect(h.chatMessage).toBe("新任务");
  });

  it("authorizeFocusSwitchCancel records explicit user consent", () => {
    const h = host({
      chatFocusSwitchGate: {
        currentTitle: "旧任务",
        incomingTitle: "新任务",
        pendingDraft: "新任务",
      },
    });
    authorizeFocusSwitchCancel(h);
    expect(h.chatFocusSwitchCancelAuthorized).toBe(true);
    expect(h.chatFocusSwitchProceedAuthorized).toBe(false);
    expect(h.chatFocusSwitchGate).toBeNull();
    expect(h.chatMessage).toBe("新任务");
  });

  it("dismissFocusSwitchGate removes the unsent turn and keeps the draft", () => {
    const h = host({
      chatMessage: "",
      chatFocusSwitchGate: {
        currentTitle: "旧任务",
        incomingTitle: "新任务",
        pendingDraft: "请使用 web-research 做一次调研",
        pendingMessageId: "local-run-1",
      },
    });
    dismissFocusSwitchGate(h);
    expect(h.chatFocusSwitchProceedAuthorized).toBe(false);
    expect(h.chatFocusSwitchGate).toBeNull();
    expect(h.chatMessages).toHaveLength(1);
    expect((h.chatMessages[0] as { id: string }).id).toBe("keep-me");
    expect(h.chatMessage).toContain("web-research");
  });
});
