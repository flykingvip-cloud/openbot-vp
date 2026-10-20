import { describe, expect, it } from "vitest";
import { sanitizeChatHistoryMessagesForTest } from "./chat.js";

describe("chat.history toolResult sanitization", () => {
  it("keeps an outbound 1:1 sentence that a normal assistant scratchpad would drop", () => {
    const sentence = "我先查一下文档。";
    const sanitized = sanitizeChatHistoryMessagesForTest([
      {
        role: "assistant",
        content: [{ type: "text", text: sentence }],
      },
      {
        role: "assistant",
        openclawPeerOutbound: true,
        sentTo: [{ label: "大白管家", agentId: "steward" }],
        content: [{ type: "text", text: sentence }],
      },
    ]);
    const plain = sanitized[0] as { content: Array<{ text?: string }> };
    const outbound = sanitized[1] as { content: Array<{ text?: string }> };
    expect(plain.content[0]?.text ?? "").not.toContain(sentence);
    expect(outbound.content[0]?.text).toContain(sentence);
  });

  it("preserves trailing EXIT:0 on long toolResult text via head+tail truncation", () => {
    const body = `${"x".repeat(50_000)}\nEXIT:0`;
    const sanitized = sanitizeChatHistoryMessagesForTest([
      {
        role: "toolResult",
        content: [{ type: "text", text: body }],
        details: { status: "completed", exitCode: 0 },
      },
    ]);
    const message = sanitized[0] as {
      role: string;
      content: Array<{ text?: string }>;
      details?: unknown;
    };
    expect(message.role).toBe("toolResult");
    expect(message.details).toBeUndefined();
    const text = message.content.map((block) => block.text ?? "").join("");
    expect(text.length).toBeLessThan(body.length);
    expect(text).toContain("...(truncated)...");
    expect(text.endsWith("EXIT:0") || text.includes("\nEXIT:0")).toBe(true);
  });

  it("surfaces EXIT:exitCode from details when body has no exit footer", () => {
    const sanitized = sanitizeChatHistoryMessagesForTest([
      {
        role: "toolResult",
        content: [{ type: "text", text: "ok output only" }],
        details: { status: "completed", exitCode: 0 },
      },
    ]);
    const message = sanitized[0] as {
      content: Array<{ text?: string }>;
      details?: unknown;
    };
    expect(message.details).toBeUndefined();
    expect(message.content[0]?.text).toContain("EXIT:0");
  });

  it("keeps a visible reply that sits beside a tool block", () => {
    const essay = "这一轮的可见回复已经写好。";
    const sanitized = sanitizeChatHistoryMessagesForTest([
      {
        role: "assistant",
        content: [
          { type: "text", text: essay },
          { type: "toolCall", name: "search" },
        ],
      },
    ]);
    expect(JSON.stringify(sanitized)).toContain(essay);
  });

  it("drops a silent token even when a tool block sits beside it", () => {
    const sanitized = sanitizeChatHistoryMessagesForTest([
      {
        role: "assistant",
        content: [
          { type: "text", text: "NO_REPLY" },
          { type: "toolCall", name: "search" },
        ],
      },
    ]);
    expect(sanitized).toEqual([]);
  });

  it("does not head-truncate short assistant messages differently", () => {
    const text = "hello assistant";
    const sanitized = sanitizeChatHistoryMessagesForTest([
      { role: "assistant", content: [{ type: "text", text }] },
    ]);
    const message = sanitized[0] as { content: Array<{ text?: string }> };
    expect(message.content[0]?.text).toBe(text);
  });
});
