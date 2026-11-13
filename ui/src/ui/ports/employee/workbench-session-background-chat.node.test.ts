import { beforeEach, describe, expect, it } from "vitest";
import {
  CHAT_TURN_ERROR_UNCONFIRMED_TEXT,
  INTERACTION_TIMEOUT_TEXT,
} from "../../../../../src/agent-runtime/model/interaction-resource-wait.ts";
import { GENERIC_CHAT_ERROR_MESSAGE } from "../../chat-error-sanitize.ts";
import {
  applyBackgroundWorkbenchChatEvent,
  resetFinishedBackgroundWorkbenchRunsForTests,
} from "./workbench-session-background-chat.ts";
import {
  readWorkbenchSessionTranscript,
  resetWorkbenchSessionTranscriptCacheForTests,
  writeWorkbenchSessionTranscript,
} from "./workbench-session-transcript-cache.ts";

function transcriptTexts(sessionKey: string): string[] {
  const cached = readWorkbenchSessionTranscript(sessionKey);
  return (
    cached?.messages.map((message) => {
      const content = (message as { content?: Array<{ text?: string }> }).content;
      return content?.[0]?.text ?? "";
    }) ?? []
  );
}

function seedOccupiedSessionA(): void {
  writeWorkbenchSessionTranscript("agent:skill:main", {
    messages: [
      {
        id: "local-run-a",
        role: "user",
        content: [{ type: "text", text: "执行长时间任务" }],
      },
    ],
    chatRunId: "run-a",
    chatStream: "A正在执行",
  });
}

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
    expect(
      cached?.messages.map((message) => {
        const content = (message as { content?: Array<{ text?: string }> }).content;
        return content?.[0]?.text;
      }),
    ).toEqual(["执行长时间任务", "你好，我在。"]);

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

  it("shows B's sanitized errorMessage-only receipt while A stays occupied", () => {
    seedOccupiedSessionA();

    applyBackgroundWorkbenchChatEvent({
      sessionKey: "agent:skill:main",
      runId: "run-b",
      state: "error",
      errorMessage: "故障说明",
    });

    const cached = readWorkbenchSessionTranscript("agent:skill:main");
    expect(cached?.chatRunId).toBe("run-a");
    expect(cached?.chatStream).toBe("A正在执行");
    expect(transcriptTexts("agent:skill:main")).toEqual(["执行长时间任务", "故障说明"]);
  });

  it("does not drop B's later final when the error event had no visible receipt, and does not duplicate a shown error", () => {
    seedOccupiedSessionA();

    applyBackgroundWorkbenchChatEvent({
      sessionKey: "agent:skill:main",
      runId: "run-b",
      state: "error",
      errorMessage: "故障说明",
    });
    applyBackgroundWorkbenchChatEvent({
      sessionKey: "agent:skill:main",
      runId: "run-b",
      state: "final",
      message: { role: "assistant", content: [{ type: "text", text: "故障说明" }] },
    });

    let cached = readWorkbenchSessionTranscript("agent:skill:main");
    expect(cached?.chatRunId).toBe("run-a");
    expect(cached?.chatStream).toBe("A正在执行");
    expect(transcriptTexts("agent:skill:main")).toEqual(["执行长时间任务", "故障说明"]);

    resetWorkbenchSessionTranscriptCacheForTests();
    resetFinishedBackgroundWorkbenchRunsForTests();
    seedOccupiedSessionA();

    applyBackgroundWorkbenchChatEvent({
      sessionKey: "agent:skill:main",
      runId: "run-b",
      state: "error",
    });
    applyBackgroundWorkbenchChatEvent({
      sessionKey: "agent:skill:main",
      runId: "run-b",
      state: "final",
      message: { role: "assistant", content: [{ type: "text", text: "有效回执" }] },
    });

    cached = readWorkbenchSessionTranscript("agent:skill:main");
    expect(cached?.chatRunId).toBe("run-a");
    expect(cached?.chatStream).toBe("A正在执行");
    expect(transcriptTexts("agent:skill:main")).toEqual(["执行长时间任务", "有效回执"]);
    expect(transcriptTexts("agent:skill:main").filter((text) => text === "有效回执")).toHaveLength(
      1,
    );
  });

  it("keeps B's receipt and A's occupancy when switching back to the background session", () => {
    seedOccupiedSessionA();

    applyBackgroundWorkbenchChatEvent({
      sessionKey: "agent:skill:main",
      runId: "run-b",
      state: "error",
      errorMessage: "TypeError: Cannot read properties of undefined (reading 'length')",
    });

    const cached = readWorkbenchSessionTranscript("agent:skill:main");
    expect(cached?.chatRunId).toBe("run-a");
    expect(cached?.chatStream).toBe("A正在执行");
    expect(transcriptTexts("agent:skill:main")).toEqual([
      "执行长时间任务",
      GENERIC_CHAT_ERROR_MESSAGE,
    ]);
    expect(transcriptTexts("agent:skill:main").join("\n")).not.toContain("TypeError");
  });

  it("surfaces A's empty timeout and ignores late A deltas", () => {
    seedOccupiedSessionA();

    applyBackgroundWorkbenchChatEvent({
      sessionKey: "agent:skill:main",
      runId: "run-a",
      state: "error",
    });

    let cached = readWorkbenchSessionTranscript("agent:skill:main");
    expect(cached?.chatRunId).toBeNull();
    expect(cached?.chatStream ?? null).toBeNull();
    expect(transcriptTexts("agent:skill:main")).toEqual([
      "执行长时间任务",
      CHAT_TURN_ERROR_UNCONFIRMED_TEXT,
    ]);

    applyBackgroundWorkbenchChatEvent({
      sessionKey: "agent:skill:main",
      runId: "run-a",
      state: "delta",
      message: { role: "assistant", content: [{ type: "text", text: "迟到增量" }] },
    });

    cached = readWorkbenchSessionTranscript("agent:skill:main");
    expect(cached?.chatRunId).toBeNull();
    expect(cached?.chatStream ?? null).toBeNull();
    expect(transcriptTexts("agent:skill:main")).toEqual([
      "执行长时间任务",
      CHAT_TURN_ERROR_UNCONFIRMED_TEXT,
    ]);
  });

  it("R2: occupying empty abort after a business action must not claim no task was started", () => {
    seedOccupiedSessionA();

    applyBackgroundWorkbenchChatEvent({
      sessionKey: "agent:skill:main",
      runId: "run-a",
      state: "aborted",
    });

    expect(transcriptTexts("agent:skill:main")).toEqual([
      "执行长时间任务",
      CHAT_TURN_ERROR_UNCONFIRMED_TEXT,
    ]);
    expect(transcriptTexts("agent:skill:main").join("\n")).not.toMatch(
      /没有启动新任务|没有启动或修改任务/,
    );
  });

  it("R2: occupying empty timeout may still use the pre-admission timeout text when the host attests none", () => {
    writeWorkbenchSessionTranscript("agent:skill:main", {
      messages: [
        {
          id: "local-run-a",
          role: "user",
          content: [{ type: "text", text: "查询天气" }],
        },
      ],
      chatRunId: "run-a",
    });

    applyBackgroundWorkbenchChatEvent({
      sessionKey: "agent:skill:main",
      runId: "run-a",
      state: "error",
      businessExecution: "none",
    });

    expect(transcriptTexts("agent:skill:main")).toEqual(["查询天气", INTERACTION_TIMEOUT_TEXT]);
  });
});
