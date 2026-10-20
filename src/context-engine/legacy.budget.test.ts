import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { afterEach, describe, expect, it } from "vitest";
import { LegacyContextEngine, getLegacyProjectionForTests } from "./legacy.js";

function user(text: string): AgentMessage {
  return { role: "user", content: text, timestamp: Date.now() } as unknown as AgentMessage;
}
function assistant(text: string): AgentMessage {
  return { role: "assistant", content: text, timestamp: Date.now() } as unknown as AgentMessage;
}

describe("LegacyContextEngine budget assemble", () => {
  const prev = process.env.OPENBOT_CONVERSATION_CONTEXT_PLANNER;

  afterEach(() => {
    if (prev === undefined) {
      delete process.env.OPENBOT_CONVERSATION_CONTEXT_PLANNER;
    } else {
      process.env.OPENBOT_CONVERSATION_CONTEXT_PLANNER = prev;
    }
  });

  it("returns budgetTrace when tokenBudget is set", async () => {
    process.env.OPENBOT_CONVERSATION_CONTEXT_PLANNER = "1";
    const engine = new LegacyContextEngine();
    const messages: AgentMessage[] = [];
    for (let i = 0; i < 12; i++) {
      messages.push(user(`u${i} ${"a".repeat(180)}`));
      messages.push(assistant(`a${i} ${"b".repeat(180)}`));
    }
    messages.push(user("final question"));

    const result = await engine.assemble({
      sessionId: "sess-budget-1",
      messages,
      tokenBudget: 3_500,
    });

    expect(result.budgetTrace).toBeTruthy();
    expect(result.budgetTrace?.modelContextTokens).toBe(3_500);
    expect(typeof result.estimatedTokens).toBe("number");
    expect(result.messages[result.messages.length - 1]).toMatchObject({
      role: "user",
      content: "final question",
    });
  });

  it("pass-through without tokenBudget", async () => {
    const engine = new LegacyContextEngine();
    const messages = [user("hi")];
    const result = await engine.assemble({ sessionId: "s", messages });
    expect(result.messages).toBe(messages);
    expect(result.budgetTrace).toBeUndefined();
  });

  it("afterTurn projection is no-op when projection flag off", async () => {
    const prev = process.env.OPENBOT_CONVERSATION_PROJECTION;
    process.env.OPENBOT_CONVERSATION_PROJECTION = "0";
    try {
      const engine = new LegacyContextEngine();
      await engine.afterTurn?.({
        sessionId: "s-proj",
        sessionFile: "/tmp/x.jsonl",
        messages: [user("remember the deadline is Monday")],
        prePromptMessageCount: 0,
        runtimeContext: { sessionKey: "agent:helper:conversation:conv_abc123" },
      });
      const stored = await getLegacyProjectionForTests("conv_abc123");
      expect(stored).toBeNull();
    } finally {
      if (prev === undefined) {
        delete process.env.OPENBOT_CONVERSATION_PROJECTION;
      } else {
        process.env.OPENBOT_CONVERSATION_PROJECTION = prev;
      }
    }
  });

  it("afterTurn persists projection when enabled", async () => {
    const prev = process.env.OPENBOT_CONVERSATION_PROJECTION;
    process.env.OPENBOT_CONVERSATION_PROJECTION = "1";
    const dataRoot = `/tmp/legacy-proj-${Date.now()}`;
    try {
      const engine = new LegacyContextEngine();
      await engine.afterTurn?.({
        sessionId: "s-proj-on",
        sessionFile: "/tmp/x.jsonl",
        messages: [user("remember the deadline is Monday")],
        prePromptMessageCount: 0,
        runtimeContext: {
          sessionKey: "agent:helper:conversation:conv_persist_xyz",
          config: { data: { root: dataRoot, mode: "local", schemaVersion: 1 } },
        },
      });
      // Allow async fire-and-forget
      await new Promise((r) => setTimeout(r, 100));
      const stored = await getLegacyProjectionForTests("conv_persist_xyz", {
        data: { root: dataRoot, mode: "local", schemaVersion: 1 },
      } as never);
      expect(stored).toBeTruthy();
      expect(String(stored?.shortSummary ?? "").toLowerCase()).toContain("monday");
    } finally {
      if (prev === undefined) {
        delete process.env.OPENBOT_CONVERSATION_PROJECTION;
      } else {
        process.env.OPENBOT_CONVERSATION_PROJECTION = prev;
      }
      const { rm } = await import("node:fs/promises");
      await rm(dataRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});
