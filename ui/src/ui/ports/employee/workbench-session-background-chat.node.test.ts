import { beforeEach, describe, expect, it } from "vitest";
import {
  applyBackgroundWorkbenchChatEvent,
  resetFinishedBackgroundWorkbenchRunsForTests,
} from "./workbench-session-background-chat.ts";
import {
  readWorkbenchSessionTranscript,
  resetWorkbenchSessionTranscriptCacheForTests,
  writeWorkbenchSessionTranscript,
} from "./workbench-session-transcript-cache.ts";

describe("applyBackgroundWorkbenchChatEvent", () => {
  beforeEach(() => {
    resetWorkbenchSessionTranscriptCacheForTests();
    resetFinishedBackgroundWorkbenchRunsForTests();
  });

  it("stores deltas on the background session without requiring it to be open", () => {
    writeWorkbenchSessionTranscript("agent:skill:main", {
      messages: [
        {
          id: "local-run-1",
          role: "user",
          content: [{ type: "text", text: "请检索订单参谋 MCP" }],
        },
      ],
      chatRunId: "run-1",
    });

    applyBackgroundWorkbenchChatEvent({
      sessionKey: "agent:skill:main",
      runId: "run-1",
      state: "delta",
      message: { role: "assistant", content: [{ type: "text", text: "正在检索" }] },
    });

    const cached = readWorkbenchSessionTranscript("agent:skill:main");
    expect(cached?.chatRunId).toBe("run-1");
    expect(cached?.chatStream).toBe("正在检索");
    expect(cached?.messages).toHaveLength(1);
  });

  it("appends the final assistant and clears occupancy", () => {
    writeWorkbenchSessionTranscript("agent:skill:main", {
      messages: [
        {
          id: "local-run-1",
          role: "user",
          content: [{ type: "text", text: "请检索订单参谋 MCP" }],
        },
      ],
      chatRunId: "run-1",
      chatStream: "正在检索",
    });

    applyBackgroundWorkbenchChatEvent({
      sessionKey: "agent:skill:main",
      runId: "run-1",
      state: "final",
      message: { role: "assistant", content: [{ type: "text", text: "检索情况" }] },
    });

    const cached = readWorkbenchSessionTranscript("agent:skill:main");
    expect(cached?.chatRunId).toBeNull();
    expect(cached?.messages).toEqual([
      {
        id: "local-run-1",
        role: "user",
        content: [{ type: "text", text: "请检索订单参谋 MCP" }],
      },
      { role: "assistant", content: [{ type: "text", text: "检索情况" }] },
    ]);
  });

  it("does not let B's terminal clear A's occupancy, and ignores late A events after A finished", () => {
    writeWorkbenchSessionTranscript("agent:skill:main", {
      messages: [
        {
          id: "local-run-a",
          role: "user",
          content: [{ type: "text", text: "执行长时间任务" }],
        },
      ],
      chatRunId: "run-a",
      chatStream: "正在执行",
    });

    applyBackgroundWorkbenchChatEvent({
      sessionKey: "agent:skill:main",
      runId: "run-b",
      state: "final",
      message: { role: "assistant", content: [{ type: "text", text: "你好，我在。" }] },
    });

    let cached = readWorkbenchSessionTranscript("agent:skill:main");
    expect(cached?.chatRunId).toBe("run-a");
    expect(cached?.chatStream).toBe("正在执行");
    expect(cached?.messages.map((message) => {
      const content = (message as { content?: Array<{ text?: string }> }).content;
      return content?.[0]?.text;
    })).toEqual(["执行长时间任务", "你好，我在。"]);

    applyBackgroundWorkbenchChatEvent({
      sessionKey: "agent:skill:main",
      runId: "run-a",
      state: "final",
      message: { role: "assistant", content: [{ type: "text", text: "任务完成" }] },
    });
    cached = readWorkbenchSessionTranscript("agent:skill:main");
    expect(cached?.chatRunId).toBeNull();
    expect(cached?.messages.at(-1)).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "任务完成" }],
    });

    applyBackgroundWorkbenchChatEvent({
      sessionKey: "agent:skill:main",
      runId: "run-a",
      state: "delta",
      message: { role: "assistant", content: [{ type: "text", text: "迟到增量" }] },
    });
    cached = readWorkbenchSessionTranscript("agent:skill:main");
    expect(cached?.chatRunId).toBeNull();
    expect(cached?.chatStream ?? null).toBeNull();
    expect(
      cached?.messages.some((message) => {
        const content = (message as { content?: Array<{ text?: string }> }).content;
        return content?.[0]?.text === "迟到增量";
      }),
    ).toBe(false);
  });
});
