import { expect, it } from "vitest";
import { LegacyContextEngine } from "./legacy.js";

it("default planner preserves tool call/result pairs", async () => {
  delete process.env.OPENBOT_CONVERSATION_CONTEXT_PLANNER;
  const engine = new LegacyContextEngine({
    conversation: { projection: { enabled: false } },
  } as never);
  const messages = [
    { role: "user", content: "old", timestamp: 1 },
    {
      role: "assistant",
      content: [
        { type: "text", text: "x".repeat(40000) },
        { type: "toolCall", id: "call_1", name: "read", arguments: { path: "x" } },
      ],
      timestamp: 2,
    },
    {
      role: "toolResult",
      toolCallId: "call_1",
      toolName: "read",
      content: [{ type: "text", text: "ok" }],
      isError: false,
      timestamp: 3,
    },
    { role: "user", content: "continue", timestamp: 4 },
  ];
  const result = await engine.assemble({
    sessionId: "review",
    messages: messages as never,
    tokenBudget: 4000,
  });
  const hasResult = result.messages.some(
    (m) =>
      (m as { role?: string }).role === "toolResult" &&
      (m as { toolCallId?: string }).toolCallId === "call_1",
  );
  const hasCall = result.messages.some((m) => {
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
          (part as { id?: string }).id === "call_1",
      )
    );
  });
  console.log({
    hasResult,
    hasCall,
    roles: result.messages.map((m) => (m as { role?: string }).role),
  });
  expect(hasResult && !hasCall).toBe(false);
});
