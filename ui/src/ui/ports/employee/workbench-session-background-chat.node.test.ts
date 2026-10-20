import { beforeEach, describe, expect, it } from "vitest";
import { applyBackgroundWorkbenchChatEvent } from "./workbench-session-background-chat.ts";
import {
  readWorkbenchSessionTranscript,
  resetWorkbenchSessionTranscriptCacheForTests,
  writeWorkbenchSessionTranscript,
} from "./workbench-session-transcript-cache.ts";

describe("applyBackgroundWorkbenchChatEvent", () => {
  beforeEach(() => {
    resetWorkbenchSessionTranscriptCacheForTests();
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
});
