import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { describe, expect, it } from "vitest";
import { LegacyContextEngine } from "../../../context-engine/legacy.js";
import { sanitizeToolUseResultPairing } from "../../session-transcript-repair.js";

/**
 * Mirrors attempt.ts: contextEngine.assemble then sanitizeToolUseResultPairing
 * when repairToolUseResultPairing is enabled (always true in transcript policy).
 */
describe("attempt context assemble pairing", () => {
  it("post-assemble sanitize leaves no orphan toolResult before provider send", async () => {
    delete process.env.OPENBOT_CONVERSATION_CONTEXT_PLANNER;
    const engine = new LegacyContextEngine({
      conversation: { projection: { enabled: false } },
    } as never);
    const messages = [
      { role: "user", content: "old", timestamp: 1 },
      {
        role: "assistant",
        content: [
          { type: "text", text: "x".repeat(40_000) },
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
    ] as unknown as AgentMessage[];

    const assembled = await engine.assemble({
      sessionId: "attempt-pairing",
      messages,
      tokenBudget: 4_000,
    });
    // Same belt as attempt.ts after contextEngine.assemble
    const forProvider = sanitizeToolUseResultPairing(assembled.messages);

    const hasResult = forProvider.some(
      (m) =>
        (m as { role?: string }).role === "toolResult" &&
        (m as { toolCallId?: string }).toolCallId === "call_1",
    );
    const hasCall = forProvider.some(
      (m) =>
        (m as { role?: string }).role === "assistant" &&
        Array.isArray((m as { content?: unknown }).content) &&
        (m as { content: Array<{ type?: string; id?: string }> }).content.some(
          (p) => p.type === "toolCall" && p.id === "call_1",
        ),
    );
    expect(hasResult && !hasCall).toBe(false);
    // Either both present or both absent — never orphan result
    expect(hasResult).toBe(hasCall);
  });
});
