// @vitest-environment jsdom
import { render } from "lit";
import { afterEach, describe, expect, it } from "vitest";
import type { SessionsListResult } from "../types.ts";
import { renderChat, type ChatProps } from "../views/chat.ts";
import { clearOguiFormDraftState } from "./ogui-form-view.ts";

function createSessions(): SessionsListResult {
  return {
    ts: 0,
    path: "",
    count: 0,
    defaults: { model: null, contextTokens: null },
    sessions: [],
  };
}

function createProps(overrides: Partial<ChatProps> = {}): ChatProps {
  return {
    sessionKey: "agent:main:main",
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

function formFence(decision?: { decision_id: string; decision_version: number }): string {
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
        ...(decision
          ? { decision_id: decision.decision_id, decision_version: decision.decision_version }
          : {}),
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

function mount(props: ChatProps): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  render(renderChat(props), container);
  return container;
}

function choose(container: HTMLElement, label: string): void {
  const option = [...container.querySelectorAll("button")].find((button) =>
    button.textContent?.includes(label),
  );
  expect(option).toBeInstanceOf(HTMLButtonElement);
  option?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function submitButton(container: HTMLElement): HTMLButtonElement {
  const button = container.querySelector('[data-testid="ogui-form-submit"]');
  expect(button).toBeInstanceOf(HTMLButtonElement);
  return button as HTMLButtonElement;
}

describe("chat shell OGUI decision status", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    clearOguiFormDraftState();
  });

  it("disables submit for a historical fence whose session record is closed (Ev8)", () => {
    const submitted: string[] = [];
    const messages = [
      assistantMessage(formFence({ decision_id: "ogd_historical", decision_version: 1 })),
    ];
    const onSubmitForm = (text: string) => {
      submitted.push(text);
    };
    const open = mount(createProps({ messages, onSubmitForm }));
    choose(open, "甲");
    open.remove();

    const closed = mount(
      createProps({
        messages,
        onSubmitForm,
        oguiDecisions: {
          ogd_historical: { decisionStatus: "expired", version: 1 },
        },
      }),
    );
    const button = submitButton(closed);
    expect(button.disabled).toBe(true);
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(submitted).toEqual([]);
  });

  it("keeps a waiting decision operable from the same shell path (Ev8)", () => {
    const submitted: string[] = [];
    const container = mount(
      createProps({
        messages: [
          assistantMessage(formFence({ decision_id: "ogd_waiting", decision_version: 1 })),
        ],
        oguiDecisions: {
          ogd_waiting: { decisionStatus: "waiting", version: 1 },
        },
        onSubmitForm: (text) => {
          submitted.push(text);
        },
      }),
    );
    choose(container, "甲");
    container.remove();
    const ready = mount(
      createProps({
        messages: [
          assistantMessage(formFence({ decision_id: "ogd_waiting", decision_version: 1 })),
        ],
        oguiDecisions: {
          ogd_waiting: { decisionStatus: "waiting", version: 1 },
        },
        onSubmitForm: (text) => {
          submitted.push(text);
        },
      }),
    );
    const button = submitButton(ready);
    expect(button.disabled).toBe(false);
    button.click();
    expect(submitted).toHaveLength(1);
    expect(submitted[0]).toContain("```ogui-answer");
  });

  it("leaves a legacy fence operable when the session has no decision record (Ev8)", () => {
    const submitted: string[] = [];
    const onSubmitForm = (text: string) => {
      submitted.push(text);
    };
    const open = mount(
      createProps({
        messages: [assistantMessage(formFence())],
        onSubmitForm,
      }),
    );
    choose(open, "甲");
    open.remove();
    const ready = mount(
      createProps({
        messages: [assistantMessage(formFence())],
        onSubmitForm,
      }),
    );
    const button = submitButton(ready);
    expect(button.disabled).toBe(false);
    button.click();
    expect(submitted).toHaveLength(1);
  });

  it("does not close a fence whose decision_id is missing from the session map (Ev8)", () => {
    const submitted: string[] = [];
    const messages = [
      assistantMessage(formFence({ decision_id: "ogd_missing", decision_version: 1 })),
    ];
    const onSubmitForm = (text: string) => {
      submitted.push(text);
    };
    const open = mount(
      createProps({
        messages,
        oguiDecisions: {
          ogd_other: { decisionStatus: "answered", version: 1 },
        },
        onSubmitForm,
      }),
    );
    choose(open, "甲");
    open.remove();
    const ready = mount(
      createProps({
        messages,
        oguiDecisions: {
          ogd_other: { decisionStatus: "answered", version: 1 },
        },
        onSubmitForm,
      }),
    );
    const button = submitButton(ready);
    expect(button.disabled).toBe(false);
    button.click();
    expect(submitted).toHaveLength(1);
  });
});
