import type { PlannedStep } from "@openbot/aor-core";
import { describe, expect, it } from "vitest";
import { OpenBotBackend } from "./backend.js";
import type { OpenBotChatRequest, OpenBotChatResponse, OpenBotGatewayClient } from "./client.js";

class FakeClient implements OpenBotGatewayClient {
  lastRequest?: OpenBotChatRequest;
  constructor(private readonly response: OpenBotChatResponse) {}
  chat(req: OpenBotChatRequest): Promise<OpenBotChatResponse> {
    this.lastRequest = req;
    return Promise.resolve(this.response);
  }
}

const step: PlannedStep = {
  id: "s0",
  taskType: "summarization",
  skillId: "summarization",
  prompt: "summarize this",
  model: { provider: "openai", id: "gpt-5.4-mini" },
};

describe("OpenBotBackend", () => {
  it("runs and waits, returning text + usage", async () => {
    const client = new FakeClient({
      text: "a short summary",
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, costUsd: 0.001 },
    });
    const backend = new OpenBotBackend({ client });
    const handle = await backend.run(step, { sessionKey: "sess-1" });
    const result = await backend.wait(handle);

    expect(result.text).toBe("a short summary");
    expect(result.usage.totalTokens).toBe(15);
    expect(client.lastRequest?.model.id).toBe("gpt-5.4-mini");
    expect(client.lastRequest?.sessionKey).toBe("sess-1");
  });

  it("streams lifecycle + assistant events", async () => {
    const client = new FakeClient({
      text: "hello world",
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    });
    const backend = new OpenBotBackend({ client });
    const handle = await backend.run(step, {});
    const events = [];
    for await (const event of backend.stream(handle)) {
      events.push(event);
    }
    expect(events[0]).toEqual({ kind: "lifecycle", phase: "start" });
    expect(events.some((e) => e.kind === "assistant" && e.delta === "hello world")).toBe(true);
    expect(events.at(-1)).toEqual({ kind: "lifecycle", phase: "end" });
  });

  it("forwards the fallback chain to the gateway client", async () => {
    const client = new FakeClient({
      text: "ok",
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    });
    const backend = new OpenBotBackend({ client });
    const handle = await backend.run(
      { ...step, fallbackModels: [{ provider: "openai", id: "gpt-5.4" }] },
      {},
    );
    await backend.wait(handle);
    expect(client.lastRequest?.fallbackModels).toEqual([{ provider: "openai", id: "gpt-5.4" }]);
  });

  it("reports known models via capabilities", async () => {
    const client = new FakeClient({
      text: "",
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    });
    const backend = new OpenBotBackend({
      client,
      knownModels: [{ provider: "openai", id: "gpt-5.4" }],
    });
    const caps = await backend.capabilities();
    expect(caps.models).toHaveLength(1);
  });
});
