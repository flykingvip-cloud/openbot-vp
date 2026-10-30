import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { describe, expect, it } from "vitest";
import { assembleMessagesWithBudget, estimateMessageTokensRough } from "./context-assemble.js";

function user(text: string): AgentMessage {
  return { role: "user", content: text, timestamp: Date.now() } as unknown as AgentMessage;
}
function assistant(text: string): AgentMessage {
  return { role: "assistant", content: text, timestamp: Date.now() } as unknown as AgentMessage;
}

function assistantWithTool(id: string, text: string): AgentMessage {
  return {
    role: "assistant",
    content: [
      { type: "text", text },
      { type: "toolCall", id, name: "read", arguments: { path: "x" } },
    ],
    timestamp: Date.now(),
  } as unknown as AgentMessage;
}

function toolResultMsg(id: string, text = "ok"): AgentMessage {
  return {
    role: "toolResult",
    toolCallId: id,
    toolName: "read",
    content: [{ type: "text", text }],
    isError: false,
    timestamp: Date.now(),
  } as unknown as AgentMessage;
}

function hasToolCall(messages: AgentMessage[], id: string): boolean {
  return messages.some((m) => {
    if ((m as { role?: string }).role !== "assistant") {
      return false;
    }
    const content = (m as { content?: unknown }).content;
    return (
      Array.isArray(content) &&
      content.some(
        (part) =>
          part &&
          typeof part === "object" &&
          (part as { type?: string; id?: string }).type === "toolCall" &&
          (part as { id?: string }).id === id,
      )
    );
  });
}

function hasToolResult(messages: AgentMessage[], id: string): boolean {
  return messages.some(
    (m) =>
      (m as { role?: string }).role === "toolResult" &&
      (m as { toolCallId?: string }).toolCallId === id,
  );
}

describe("assembleMessagesWithBudget", () => {
  it("keeps the latest user turn even under tight budget", () => {
    const messages = [
      user("old-1 " + "x".repeat(400)),
      assistant("old-a " + "y".repeat(400)),
      user("old-2 " + "z".repeat(400)),
      assistant("old-b " + "w".repeat(400)),
      user("CURRENT REQUEST please answer"),
    ];
    const result = assembleMessagesWithBudget(messages, {
      tokenBudget: 2_000,
      enforce: true,
      outputReserveTokens: 400,
      toolProtocolReserveTokens: 200,
      mandatoryPolicyTokens: 200,
    });
    const last = result.messages[result.messages.length - 1] as { content?: string };
    expect(String(last?.content ?? "")).toContain("CURRENT REQUEST");
    expect(result.plan.trace.currentInputTokens).toBeGreaterThan(0);
  });

  it("trims older history when enforce is true", () => {
    const messages: AgentMessage[] = [];
    for (let i = 0; i < 30; i++) {
      messages.push(user(`turn-${i} ${"n".repeat(800)}`));
      messages.push(assistant(`reply-${i} ${"m".repeat(800)}`));
    }
    messages.push(user("latest"));
    const result = assembleMessagesWithBudget(messages, {
      tokenBudget: 2_500,
      enforce: true,
      outputReserveTokens: 400,
      toolProtocolReserveTokens: 200,
      mandatoryPolicyTokens: 100,
    });
    expect(result.trimmed).toBe(true);
    expect(result.droppedMessageCount).toBeGreaterThan(0);
    expect(result.messages.length).toBeLessThan(messages.length);
  });

  it("observe-only mode does not drop messages", () => {
    const messages = [user("a"), assistant("b"), user("c")];
    const result = assembleMessagesWithBudget(messages, {
      tokenBudget: 500,
      enforce: false,
    });
    expect(result.trimmed).toBe(false);
    expect(result.messages).toHaveLength(3);
    expect(result.plan.trace.modelContextTokens).toBe(500);
  });

  it("estimates tool-like messages with denser weight", () => {
    const tool = {
      role: "toolResult",
      content: "x".repeat(40),
      timestamp: Date.now(),
    } as unknown as AgentMessage;
    const plain = user("x".repeat(40));
    expect(estimateMessageTokensRough(tool)).toBeGreaterThanOrEqual(
      estimateMessageTokensRough(plain),
    );
  });

  it("accounts for retrieved memory tokens in plan trace", () => {
    const messages = [user("hi"), assistant("hello"), user("next")];
    const result = assembleMessagesWithBudget(messages, {
      tokenBudget: 10_000,
      enforce: true,
      retrievedMemoryTokens: 3_000,
      mandatoryPolicyTokens: 500,
    });
    expect(result.plan.trace.memoryAllocated).toBeGreaterThan(0);
    expect(result.plan.trace.memoryAllocated).toBeLessThanOrEqual(3_000);
  });
  it("preserves toolCall/toolResult units under tight budget", () => {
    const messages = [
      user("old"),
      assistantWithTool("call_1", "x".repeat(40_000)),
      toolResultMsg("call_1"),
      user("continue"),
    ];
    const result = assembleMessagesWithBudget(messages, {
      tokenBudget: 4_000,
      enforce: true,
      outputReserveTokens: 400,
      toolProtocolReserveTokens: 200,
      mandatoryPolicyTokens: 100,
    });
    expect(
      hasToolResult(result.messages, "call_1") && !hasToolCall(result.messages, "call_1"),
    ).toBe(false);
    const last = result.messages[result.messages.length - 1] as { content?: string };
    expect(String(last?.content ?? "")).toContain("continue");
  });

  it("keeps parallel tool calls with matching results as one unit", () => {
    const parallelAssistant = {
      role: "assistant",
      content: [
        { type: "text", text: "parallel" },
        { type: "toolCall", id: "a", name: "read", arguments: {} },
        { type: "toolCall", id: "b", name: "read", arguments: {} },
      ],
      timestamp: Date.now(),
    } as unknown as AgentMessage;
    const messages = [
      user("start"),
      parallelAssistant,
      toolResultMsg("a", "ra"),
      toolResultMsg("b", "rb"),
      user("next"),
    ];
    const result = assembleMessagesWithBudget(messages, {
      tokenBudget: 50_000,
      enforce: true,
    });
    expect(hasToolCall(result.messages, "a")).toBe(true);
    expect(hasToolCall(result.messages, "b")).toBe(true);
    expect(hasToolResult(result.messages, "a")).toBe(true);
    expect(hasToolResult(result.messages, "b")).toBe(true);
  });

  it("does not leave orphan results from consecutive tool rounds", () => {
    const messages = [
      user("u0"),
      assistantWithTool("c0", "small"),
      toolResultMsg("c0"),
      assistantWithTool("c1", "y".repeat(40_000)),
      toolResultMsg("c1"),
      user("latest"),
    ];
    const result = assembleMessagesWithBudget(messages, {
      tokenBudget: 4_000,
      enforce: true,
      outputReserveTokens: 400,
      toolProtocolReserveTokens: 200,
      mandatoryPolicyTokens: 100,
    });
    expect(hasToolResult(result.messages, "c1") && !hasToolCall(result.messages, "c1")).toBe(false);
    expect(String((result.messages.at(-1) as { content?: string })?.content ?? "")).toContain(
      "latest",
    );
  });
});
