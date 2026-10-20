import { describe, expect, it } from "vitest";
import {
  hasLocalAssistantReplyForTurn,
  isTerminalChatEventState,
  shouldReloadHistoryForAgentToolResult,
  shouldReloadHistoryForFinalEvent,
  shouldReloadHistoryForTerminalChatEvent,
  shouldReloadShellChatHistoryForFinalEvent,
  shouldSkipHistoryReloadForParentFinal,
} from "./chat-event-reload.ts";

describe("shouldReloadHistoryForFinalEvent", () => {
  it("returns false for non-final events", () => {
    expect(
      shouldReloadHistoryForFinalEvent({
        runId: "run-1",
        sessionKey: "main",
        state: "delta",
        message: { role: "assistant", content: [{ type: "text", text: "x" }] },
      }),
    ).toBe(false);
  });

  it("returns true when final event has no message payload", () => {
    expect(
      shouldReloadHistoryForFinalEvent({
        runId: "run-1",
        sessionKey: "main",
        state: "final",
      }),
    ).toBe(true);
  });

  it("skips parent-final reload when child assistant rows are already on screen", () => {
    expect(
      hasLocalAssistantReplyForTurn(
        [
          { id: "local-run-1", role: "user", content: [{ type: "text", text: "你好" }] },
          { id: "a1", role: "assistant", content: [{ type: "text", text: "在的" }] },
        ],
        "run-1",
      ),
    ).toBe(true);
    expect(
      shouldSkipHistoryReloadForParentFinal({
        payload: {
          runId: "run-1",
          sessionKey: "space:grp-test",
          state: "final",
        },
        chatMessages: [
          { id: "local-run-1", role: "user", content: [{ type: "text", text: "你好" }] },
          { id: "a1", role: "assistant", content: [{ type: "text", text: "在的" }] },
        ],
        chatRunId: null,
      }),
    ).toBe(true);
    expect(
      shouldReloadShellChatHistoryForFinalEvent({
        state: "final",
        hadToolEvents: false,
        payload: {
          runId: "run-1",
          sessionKey: "space:grp-test",
          state: "final",
        },
        chatMessages: [
          { id: "local-run-1", role: "user", content: [{ type: "text", text: "你好" }] },
          { id: "a1", role: "assistant", content: [{ type: "text", text: "在的" }] },
        ],
        chatRunId: null,
      }),
    ).toBe(false);
  });

  it("returns false when final event includes assistant payload", () => {
    expect(
      shouldReloadHistoryForFinalEvent({
        runId: "run-1",
        sessionKey: "main",
        state: "final",
        message: { role: "assistant", content: [{ type: "text", text: "done" }] },
      }),
    ).toBe(false);
  });

  it("returns true when final event message role is non-assistant", () => {
    expect(
      shouldReloadHistoryForFinalEvent({
        runId: "run-1",
        sessionKey: "main",
        state: "final",
        message: { role: "user", content: [{ type: "text", text: "echo" }] },
      }),
    ).toBe(true);
  });
});

describe("isTerminalChatEventState", () => {
  it("detects terminal chat states", () => {
    expect(isTerminalChatEventState("final")).toBe(true);
    expect(isTerminalChatEventState("error")).toBe(true);
    expect(isTerminalChatEventState("aborted")).toBe(true);
    expect(isTerminalChatEventState("delta")).toBe(false);
    expect(isTerminalChatEventState(null)).toBe(false);
  });
});

describe("shouldReloadHistoryForTerminalChatEvent", () => {
  it("reloads when final event followed tool output", () => {
    expect(
      shouldReloadHistoryForTerminalChatEvent({
        state: "final",
        hadToolEvents: true,
        payload: {
          runId: "run-1",
          sessionKey: "main",
          state: "final",
          message: { role: "assistant", content: [{ type: "text", text: "done" }] },
        },
      }),
    ).toBe(true);
  });

  it("does not reload on aborted terminal states without tool events", () => {
    expect(
      shouldReloadHistoryForTerminalChatEvent({
        state: "aborted",
        hadToolEvents: false,
        payload: {
          runId: "run-1",
          sessionKey: "main",
          state: "aborted",
        },
      }),
    ).toBe(false);
  });

  it("skips reload for chat.inject final events", () => {
    expect(
      shouldReloadHistoryForTerminalChatEvent({
        state: "final",
        hadToolEvents: false,
        payload: {
          runId: "inject-abc",
          sessionKey: "agent:bot-2:main",
          state: "final",
          message: { role: "assistant", content: [{ type: "text", text: "cron" }] },
        },
      }),
    ).toBe(false);
  });

  it("falls back to final-event payload rules when no tool output was seen", () => {
    expect(
      shouldReloadHistoryForTerminalChatEvent({
        state: "final",
        hadToolEvents: false,
        payload: {
          runId: "run-1",
          sessionKey: "main",
          state: "final",
        },
      }),
    ).toBe(true);
    expect(
      shouldReloadHistoryForTerminalChatEvent({
        state: "final",
        hadToolEvents: false,
        payload: {
          runId: "run-1",
          sessionKey: "main",
          state: "final",
          message: { role: "assistant", content: [{ type: "text", text: "done" }] },
        },
      }),
    ).toBe(false);
  });
});

describe("shouldReloadHistoryForAgentToolResult", () => {
  it("reloads for tool result agent events", () => {
    expect(
      shouldReloadHistoryForAgentToolResult({
        runId: "run-1",
        seq: 1,
        stream: "tool",
        ts: Date.now(),
        data: { phase: "result" },
      }),
    ).toBe(true);
  });

  it("ignores non-result tool events", () => {
    expect(
      shouldReloadHistoryForAgentToolResult({
        runId: "run-1",
        seq: 1,
        stream: "tool",
        ts: Date.now(),
        data: { phase: "start" },
      }),
    ).toBe(false);
  });
});
