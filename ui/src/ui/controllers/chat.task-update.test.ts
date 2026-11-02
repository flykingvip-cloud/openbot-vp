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

describe("FT-RESULT-CARD-UX chat final task update", () => {
  it("A1/A3: does not append tip-backed 任务结果 cards into ordinary user chat", () => {
    const bare = createState();
    handleChatEvent(bare, {
      runId: "run-1",
      sessionKey: "agent:bot:main",
      state: "final",
      message: assistant,
    });
    expect(JSON.stringify(bare.chatMessages)).not.toContain("task_update");

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
          step_name: "进行中",
          status: "running",
          taskId: "chat:bot:agent:bot:main:run-1",
          agentId: "bot",
          outcomeVersion: 3,
        },
      },
    });
    expect(JSON.stringify(ready.chatMessages)).not.toContain("task_update");
    expect(JSON.stringify(ready.chatMessages)).not.toContain("任务结果");
    expect(JSON.stringify(ready.chatMessages)).not.toContain("暂无用量");
  });

  it("A2: incomplete tip payload with 进行中 + reject triple is still not appended", () => {
    const state = createState();
    handleChatEvent(state, {
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
          step_name: "进行中",
          status: "running",
          taskId: "chat:bot:agent:bot:main:run-1",
          agentId: "bot",
          outcomeVersion: 1,
        },
      },
    } as ChatEventPayload);
    const blob = JSON.stringify(state.chatMessages);
    expect(blob).not.toContain("task_update");
    expect(blob).not.toContain("进行中");
  });
});
