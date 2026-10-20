import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { describe, expect, it } from "vitest";
import { assembleMessagesWithBudget, estimateMessageTokensRough } from "./context-assemble.js";

function user(text: string): AgentMessage {
  return { role: "user", content: text, timestamp: Date.now() } as unknown as AgentMessage;
}
function assistant(text: string): AgentMessage {
  return { role: "assistant", content: text, timestamp: Date.now() } as unknown as AgentMessage;
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
});
