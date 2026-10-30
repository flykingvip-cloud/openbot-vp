import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  normalizeMessage,
  normalizeRoleForGrouping,
  isToolResultMessage,
} from "./message-normalizer.ts";

describe("message-normalizer", () => {
  describe("normalizeMessage", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("normalizes message with string content", () => {
      const result = normalizeMessage({
        role: "user",
        content: "Hello world",
        timestamp: 1000,
        id: "msg-1",
      });

      expect(result).toEqual({
        role: "user",
        content: [{ type: "text", text: "Hello world" }],
        timestamp: 1000,
        id: "msg-1",
        senderLabel: null,
        agentId: null,
      });
    });

    it("normalizes message with array content", () => {
      const result = normalizeMessage({
        role: "assistant",
        content: [
          { type: "text", text: "Here is the result" },
          { type: "tool_use", name: "bash", args: { command: "ls" } },
        ],
        timestamp: 2000,
      });

      expect(result.role).toBe("assistant");
      expect(result.content).toHaveLength(2);
      expect(result.content[0]).toEqual({
        type: "text",
        text: "Here is the result",
        name: undefined,
        args: undefined,
      });
      expect(result.content[1]).toEqual({
        type: "tool_use",
        text: undefined,
        name: "bash",
        args: { command: "ls" },
      });
    });

    it("normalizes message with text field (alternative format)", () => {
      const result = normalizeMessage({
        role: "user",
        text: "Alternative format",
      });

      expect(result.content).toEqual([{ type: "text", text: "Alternative format" }]);
    });

    it("detects tool result by toolCallId", () => {
      const result = normalizeMessage({
        role: "assistant",
        toolCallId: "call-123",
        content: "Tool output",
      });

      expect(result.role).toBe("toolResult");
    });

    it("detects tool result by tool_call_id (snake_case)", () => {
      const result = normalizeMessage({
        role: "assistant",
        tool_call_id: "call-456",
        content: "Tool output",
      });

      expect(result.role).toBe("toolResult");
    });

    it("handles missing role", () => {
      const result = normalizeMessage({ content: "No role" });
      expect(result.role).toBe("unknown");
    });

    it("handles missing content", () => {
      const result = normalizeMessage({ role: "user" });
      expect(result.content).toEqual([]);
    });

    it("keeps sibling text when a content part is missing", () => {
      const result = normalizeMessage({
        role: "assistant",
        timestamp: 1000,
        content: [
          { type: "text", text: "可见回复还在。" },
          null,
          { type: "toolCall", name: "search" },
        ],
      });
      expect(result.content.map((item) => item.text).filter(Boolean)).toEqual(["可见回复还在。"]);
    });

    it("uses current timestamp when not provided", () => {
      const result = normalizeMessage({ role: "user", content: "Test" });
      expect(result.timestamp).toBe(Date.now());
    });

    it("handles arguments field (alternative to args)", () => {
      const result = normalizeMessage({
        role: "assistant",
        content: [{ type: "tool_use", name: "test", arguments: { foo: "bar" } }],
      });

      expect(result.content[0].args).toEqual({ foo: "bar" });
    });

    it("preserves top-level sender labels", () => {
      const result = normalizeMessage({
        role: "user",
        content: "Hello from Telegram",
        senderLabel: "Iris",
      });

      expect(result.role).toBe("user");
      expect(result.senderLabel).toBe("Iris");
    });

    it("shows a robot-to-robot line as the sending robot, not the signed-in person", () => {
      const result = normalizeMessage({
        role: "user",
        content: [
          "[任务接收]",
          "角色：客（接收方）",
          "主会话：agent:main:employee:90fed19a-1c8b-4420-87e0-bcc6165e32fa",
          "客：高级秘书",
          "闭环：接收 → 执行 → 返回。请在本会话执行，完成后只在本会话回复可回传给发出方的结果。不是协作小组共享。",
          "",
          "请准备明天的会议资料",
        ].join("\n"),
        provenance: { kind: "inter_session", sourceSenderLabel: "大白管家" },
      });

      expect(result.role).toBe("peer");
      expect(result.senderLabel).toBe("大白管家");
      expect(result.content).toEqual([{ type: "text", text: "请准备明天的会议资料" }]);
      expect(JSON.stringify(result)).not.toContain("90fed19a");
    });

    it("keeps a durable sentTo envelope as peer-out without handover prose", () => {
      const result = normalizeMessage({
        role: "assistant",
        content: "[任务发出]\n对象会话：agent:steward:main\n\n请准备明天的会议资料",
        sentTo: [
          { label: "大白管家", agentId: "steward", sessionKey: "agent:steward:main" },
          { label: "高级秘书", agentId: "secretary" },
        ],
        openclawPeerOutbound: true,
      });
      expect(result.role).toBe("peer-out");
      expect(result.sentTo).toEqual([
        { label: "大白管家", agentId: "steward", sessionKey: "agent:steward:main" },
        { label: "高级秘书", agentId: "secretary", sessionKey: null },
      ]);
      expect(result.content).toEqual([{ type: "text", text: "请准备明天的会议资料" }]);
      expect(JSON.stringify(result.content)).not.toContain("任务发出");
    });
  });

  describe("normalizeRoleForGrouping", () => {
    it("returns tool for toolresult", () => {
      expect(normalizeRoleForGrouping("toolresult")).toBe("tool");
      expect(normalizeRoleForGrouping("toolResult")).toBe("tool");
      expect(normalizeRoleForGrouping("TOOLRESULT")).toBe("tool");
    });

    it("returns tool for tool_result", () => {
      expect(normalizeRoleForGrouping("tool_result")).toBe("tool");
      expect(normalizeRoleForGrouping("TOOL_RESULT")).toBe("tool");
    });

    it("returns tool for tool", () => {
      expect(normalizeRoleForGrouping("tool")).toBe("tool");
      expect(normalizeRoleForGrouping("Tool")).toBe("tool");
    });

    it("returns tool for function", () => {
      expect(normalizeRoleForGrouping("function")).toBe("tool");
      expect(normalizeRoleForGrouping("Function")).toBe("tool");
    });

    it("preserves user role", () => {
      expect(normalizeRoleForGrouping("user")).toBe("user");
      expect(normalizeRoleForGrouping("User")).toBe("User");
    });

    it("preserves assistant role", () => {
      expect(normalizeRoleForGrouping("assistant")).toBe("assistant");
    });

    it("preserves system role", () => {
      expect(normalizeRoleForGrouping("system")).toBe("system");
    });
  });

  describe("isToolResultMessage", () => {
    it("returns true for toolresult role", () => {
      expect(isToolResultMessage({ role: "toolresult" })).toBe(true);
      expect(isToolResultMessage({ role: "toolResult" })).toBe(true);
      expect(isToolResultMessage({ role: "TOOLRESULT" })).toBe(true);
    });

    it("returns true for tool_result role", () => {
      expect(isToolResultMessage({ role: "tool_result" })).toBe(true);
      expect(isToolResultMessage({ role: "TOOL_RESULT" })).toBe(true);
    });

    it("returns false for other roles", () => {
      expect(isToolResultMessage({ role: "user" })).toBe(false);
      expect(isToolResultMessage({ role: "assistant" })).toBe(false);
      expect(isToolResultMessage({ role: "tool" })).toBe(false);
    });

    it("returns false for missing role", () => {
      expect(isToolResultMessage({})).toBe(false);
      expect(isToolResultMessage({ content: "test" })).toBe(false);
    });

    it("returns false for non-string role", () => {
      expect(isToolResultMessage({ role: 123 })).toBe(false);
      expect(isToolResultMessage({ role: null })).toBe(false);
    });
  });

  it("strips turn_completion markers and hides internal continue prompts", () => {
    const leaked = normalizeMessage({
      role: "assistant",
      content:
        "[turn_completion state=true_fork options=option_a|option_b]\n请选 A 或 B。\n\n等待你确认下一步。",
    });
    const text = leaked.content.map((c) => ("text" in c ? c.text : "")).join("\n");
    expect(text).not.toMatch(/turn_completion|state=true_fork/);
    expect(text).toContain("请选 A 或 B");

    const hidden = normalizeMessage({
      role: "user",
      content: "Internal task-board continue:\nContinue the same task now.",
    });
    expect(hidden.content).toEqual([]);
  });
});
