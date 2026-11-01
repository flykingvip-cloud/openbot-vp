import { describe, expect, it } from "vitest";
import { handleChatEvent, type ChatEventPayload, type ChatState } from "./chat.ts";

function createState(overrides: Partial<ChatState> = {}): ChatState {
  return {
    chatAttachments: [],
    chatLoading: false,
    chatHistoryNextBefore: null,
    chatHistoryHasMore: false,
    chatHistoryLoadingMore: false,
    chatMessage: "",
    chatMessages: [],
    chatRunId: "run-1",
    chatSending: false,
    chatStream: null,
    chatStreamStartedAt: null,
    chatStreamSessionKey: null,
    chatThinkingProgress: null,
    chatThinkingLevel: null,
    client: null,
    connected: true,
    lastError: null,
    sessionKey: "agent:bot:main",
    ...overrides,
  } as ChatState;
}

const assistant = {
  role: "assistant",
  content: [{ type: "text", text: "做完了" }],
};

describe("chat final task update", () => {
  it("appends a task card only when the final event carries a complete tip", () => {
    const bare = createState();
    handleChatEvent(bare, {
      runId: "run-1",
      sessionKey: "agent:bot:main",
      state: "final",
      message: assistant,
    });
    expect(JSON.stringify(bare.chatMessages)).not.toContain("task_update");

    const partial = createState();
    handleChatEvent(partial, {
      runId: "run-1",
      sessionKey: "agent:bot:main",
      state: "final",
      message: assistant,
      taskUpdate: {
        type: "task_update",
        task: { id: "card-1", agentId: "bot", outcomeVersion: 2 },
      },
    } as ChatEventPayload);
    expect(JSON.stringify(partial.chatMessages)).not.toContain("task_update");

    const ready = createState();
    handleChatEvent(ready, {
      runId: "run-1",
      sessionKey: "agent:bot:main",
      state: "final",
      message: assistant,
      taskUpdate: {
        type: "task_update",
        task: {
          id: "chat:bot:agent:bot:main:run-1",
          title: "任务结果",
          step_current: 1,
          step_total: 1,
          step_name: "已完成",
          status: "success",
          taskId: "chat:bot:agent:bot:main:run-1",
          agentId: "bot",
          outcomeVersion: 3,
        },
      },
    });
    const card = ready.chatMessages.find(
      (message) =>
        message &&
        typeof message === "object" &&
        (message as { type?: string }).type === "task_update",
    ) as { task?: { taskId?: string; agentId?: string; outcomeVersion?: number } } | undefined;
    expect(card?.task).toMatchObject({
      taskId: "chat:bot:agent:bot:main:run-1",
      agentId: "bot",
      outcomeVersion: 3,
    });
  });
});
