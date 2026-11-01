/** @vitest-environment jsdom */
import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import { renderChat, type ChatProps } from "../views/chat.ts";
import {
  formatRejectNotice,
  readTaskOutcomeRejectRef,
  rejectNoticeFromPayload,
} from "./task-outcome-reject.ts";

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
    sessions: { sessions: [] } as ChatProps["sessions"],
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

describe("task outcome reject card", () => {
  it("hides the button unless the server sent taskId, agentId, and outcomeVersion", () => {
    expect(readTaskOutcomeRejectRef({ id: "card-1", taskId: "task-1", agentId: "bot" })).toBeNull();
    expect(
      readTaskOutcomeRejectRef({ taskId: "task-1", agentId: "bot", outcomeVersion: 2 }),
    ).toEqual({ taskId: "task-1", agentId: "bot", outcomeVersion: 2 });

    const container = document.createElement("div");
    const onRejectTaskOutcome = vi.fn();
    render(
      renderChat(
        props({
          onRejectTaskOutcome,
          messages: [
            {
              type: "task_update",
              task: {
                id: "card-1",
                title: "交付",
                step_current: 1,
                step_total: 1,
                step_name: "完成",
                status: "success",
              },
            },
          ],
        }),
      ),
      container,
    );
    expect(container.querySelector("[data-testid=reject-task-outcome]")).toBeNull();

    render(
      renderChat(
        props({
          onRejectTaskOutcome,
          messages: [
            {
              type: "task_update",
              task: {
                id: "card-1",
                title: "交付",
                step_current: 1,
                step_total: 1,
                step_name: "完成",
                status: "success",
                taskId: "task-1",
                agentId: "bot",
                outcomeVersion: 4,
              },
            },
          ],
        }),
      ),
      container,
    );
    const button = container.querySelector("[data-testid=reject-task-outcome]");
    expect(button?.textContent).toContain("结果不符合要求");
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onRejectTaskOutcome).toHaveBeenCalledWith({
      taskId: "task-1",
      agentId: "bot",
      outcomeVersion: 4,
    });
  });

  it("shows the corrected judgement and never claims the task was re-run", () => {
    expect(
      formatRejectNotice(
        rejectNoticeFromPayload({
          ok: true,
          record: { taskJudgement: "failure", reasonCode: "correction" },
        }),
      ),
    ).toBe("当前判定：失败（correction）");
    expect(formatRejectNotice({ ok: false, code: "version_conflict" })).toBe("证据已过期");
    expect(formatRejectNotice({ ok: false, code: "unauthorized" })).toBe("无法关联身份");
    expect(formatRejectNotice({ ok: false, code: "forbidden" })).toBe("权限不足");
    const container = document.createElement("div");
    render(
      renderChat(
        props({
          onRejectTaskOutcome: async () => ({ ok: true, judgement: "failure" }),
          taskOutcomeRejectNotice: {
            key: "task-1:4",
            text: "当前判定：失败（correction）",
          },
          messages: [
            {
              type: "task_update",
              task: {
                id: "card-1",
                title: "交付",
                step_current: 1,
                step_total: 1,
                step_name: "完成",
                status: "success",
                taskId: "task-1",
                agentId: "bot",
                outcomeVersion: 4,
              },
            },
          ],
        }),
      ),
      container,
    );
    const note =
      container.querySelector("[data-testid=reject-task-outcome-note]")?.textContent ?? "";
    expect(note).toContain("当前判定：失败");
    expect(note).not.toContain("已重新执行");
  });
});
