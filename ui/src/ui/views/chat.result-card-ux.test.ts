/** @vitest-environment jsdom */
import { render } from "lit";
import { describe, expect, it } from "vitest";
import { renderChat, type ChatProps } from "./chat.ts";

function props(extra: Partial<ChatProps> = {}): ChatProps {
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
    sessions: {
      sessions: [],
      ts: 0,
      path: "",
      count: 0,
      defaults: {},
    } as unknown as ChatProps["sessions"],
    focusMode: false,
    assistantName: "OpenBot",
    assistantAvatar: null,
    onRefresh: () => undefined,
    onToggleFocusMode: () => undefined,
    onDraftChange: () => undefined,
    onSend: () => undefined,
    onQueueRemove: () => undefined,
    onNewSession: () => undefined,
    ...extra,
  };
}

describe("FT-RESULT-CARD-UX history / render scrub", () => {
  it("A1/A2/A3: does not render tip-backed 任务结果 cards (incl. 进行中)", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        props({
          messages: [
            {
              type: "task_update",
              task: {
                id: "chat:bot:main:run-1",
                title: "任务结果",
                step_current: 1,
                step_total: 1,
                step_name: "进行中",
                status: "running",
                taskId: "chat:bot:main:run-1",
                agentId: "bot",
                outcomeVersion: 2,
              },
            },
          ],
        }),
      ),
      container,
    );
    expect(container.querySelectorAll(".chat-task-card")).toHaveLength(0);
    expect(container.textContent).not.toContain("任务结果");
    expect(container.textContent).not.toContain("进行中");
    expect(container.querySelector("[data-testid=reject-task-outcome]")).toBeNull();
  });

  it("A4: generic progress task_update cards still render (not closed-loop 任务结果)", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        props({
          messages: [
            {
              type: "task_update",
              task: {
                id: "install-feishu",
                title: "安装依赖并检查飞书",
                step_current: 2,
                step_total: 3,
                step_name: "健康检查",
                status: "running",
                progress: 60,
                message: "正在进行健康检查",
              },
            },
          ],
        }),
      ),
      container,
    );
    expect(container.querySelectorAll(".chat-task-card")).toHaveLength(1);
    expect(container.textContent).toContain("健康检查");
  });
});
